import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ApiResponse<T = unknown> = {
  success: boolean;
  message: string;
  data?: T;
};

type TokenInfo = {
  expires: number;
  ip: string;
};

type Inventory = {
  bag: number;
  waterBottle: number;
  tShirt: number;
  topThreeCount: number;
  topTwoCount: number;
};

type Participant = {
  name: string;
  email: string;
  profileUrl: string;
  profileStatus: string;
  accessCodeRedeemed: boolean;
  allCompleted: boolean;
  badgesCount: number;
  badgeNames: string;
  gamesCount: number;
  gameNames: string;
  originalIndex: number;
  rank: number;
};

type AllocationRow = {
  rank: number;
  name: string;
  email: string;
  items: string[];
};

type AllocationParticipant = {
  rank: number;
  name: string;
  email: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const isVercel = process.env.VERCEL === "1";
const runtimeRoot = isVercel ? "/tmp/gdgocgu-csj" : rootDir;

const csvPath = path.join(rootDir, "data.csv");
const listCsvPath = path.join(rootDir, "list.csv");
const backupDir = path.join(runtimeRoot, "backups");
const tokensPath = path.join(backupDir, "tokens.json");
const inventoryPath = path.join(backupDir, "inventory.json");
const adminPassword = process.env.ADMIN_PASSWORD ?? "";
const adminDailyTokenSeed = process.env.ADMIN_DAILY_TOKEN_SEED ?? adminPassword;
const maxFileSizeBytes = 10 * 1024 * 1024;
const staticListMode = true;

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSizeBytes },
});
const leaderboardRateLimits = new Map<string, number[]>();

initializeRuntimeStorage();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/leaderboard", (_req, res) => {
  const clientIp = getClientIp(_req);
  const now = Date.now();
  const cutoff = now - 60_000;
  const existing = leaderboardRateLimits.get(clientIp) ?? [];
  const recent = existing.filter((ts) => ts >= cutoff);

  if (recent.length >= 60) {
    return sendResponse(res, false, "Rate limit exceeded. Please try again later.");
  }

  recent.push(now);
  leaderboardRateLimits.set(clientIp, recent);

  if (staticListMode) {
    const resolvedListPath = resolveReadableFilePath([listCsvPath, path.join(process.cwd(), "list.csv")]);
    if (!resolvedListPath) {
      return sendResponse(res, false, "list.csv not available");
    }

    const listContent = fs.readFileSync(resolvedListPath, "utf-8");
    const csvContent = buildLeaderboardCsvFromList(listContent);

    return sendResponse(res, true, "Data retrieved", {
      content: csvContent,
      modified: Math.floor(fs.statSync(resolvedListPath).mtimeMs / 1000),
    });
  }

  if (!fs.existsSync(csvPath)) {
    return sendResponse(res, false, "Data not available");
  }

  const content = fs.readFileSync(csvPath, "utf-8");
  const sanitizedContent = removeEmailsFromCSV(content);

  return sendResponse(res, true, "Data retrieved", {
    content: sanitizedContent,
    modified: Math.floor(fs.statSync(csvPath).mtimeMs / 1000),
  });
});

app.get("/api/stats", (_req, res) => {
  if (staticListMode) {
    const resolvedListPath = resolveReadableFilePath([listCsvPath, path.join(process.cwd(), "list.csv")]);
    if (!resolvedListPath) {
      return sendResponse(res, false, "list.csv file not found");
    }

    const participants = parseAllocationParticipants(fs.readFileSync(resolvedListPath, "utf-8"));
    const total = participants.length;

    return sendResponse(res, true, "Statistics retrieved", {
      total,
      completed: 0,
      completedPercent: 0,
      redeemed: 0,
      redeemedPercent: 0,
      inProgress: 0,
      inProgressPercent: 0,
      badges: {
        total: 0,
        average: 0,
        max: 0,
        highUsers: 0,
      },
      games: {
        total: 0,
        average: 0,
        max: 0,
        usersWithGames: 0,
      },
    });
  }

  if (!fs.existsSync(csvPath)) {
    return sendResponse(res, false, "CSV file not found");
  }

  const users = parseParticipants(fs.readFileSync(csvPath, "utf-8"));
  const total = users.length;

  let completed = 0;
  let redeemed = 0;
  let inProgress = 0;
  let totalBadges = 0;
  let totalGames = 0;
  let maxBadges = 0;
  let maxGames = 0;
  let highBadgeUsers = 0;
  let usersWithGames = 0;

  for (const user of users) {
    if (user.allCompleted) completed += 1;
    if (user.accessCodeRedeemed) redeemed += 1;
    if (!user.allCompleted && (user.badgesCount > 0 || user.gamesCount > 0)) {
      inProgress += 1;
    }

    totalBadges += user.badgesCount;
    totalGames += user.gamesCount;
    maxBadges = Math.max(maxBadges, user.badgesCount);
    maxGames = Math.max(maxGames, user.gamesCount);

    if (user.badgesCount >= 15) highBadgeUsers += 1;
    if (user.gamesCount > 0) usersWithGames += 1;
  }

  return sendResponse(res, true, "Statistics retrieved", {
    total,
    completed,
    completedPercent: percent(completed, total),
    redeemed,
    redeemedPercent: percent(redeemed, total),
    inProgress,
    inProgressPercent: percent(inProgress, total),
    badges: {
      total: totalBadges,
      average: average(totalBadges, total),
      max: maxBadges,
      highUsers: highBadgeUsers,
    },
    games: {
      total: totalGames,
      average: average(totalGames, total),
      max: maxGames,
      usersWithGames,
    },
  });
});

app.get("/api/data", (req, res) => {
  const authHeader = req.header("authorization") ?? "";
  if (!validateDailyAuthToken(authHeader)) {
    return sendResponse(res, false, "Unauthorized access", undefined, 401);
  }

  if (!fs.existsSync(csvPath)) {
    return sendResponse(res, false, "CSV file not found", undefined, 404);
  }

  const content = fs.readFileSync(csvPath, "utf-8");
  return sendResponse(res, true, "Data retrieved", {
    content,
    size: Buffer.byteLength(content),
    modified: Math.floor(fs.statSync(csvPath).mtimeMs / 1000),
  });
});

app.post("/api/admin/verify", (req, res) => {
  if (!adminPassword) {
    return sendResponse(res, false, "ADMIN_PASSWORD is not configured on server", undefined, 500);
  }

  const password = String(req.body?.password ?? "");
  if (!password || password !== adminPassword) {
    return sendResponse(res, false, "Invalid password", undefined, 401);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const ip = getClientIp(req);

  const tokens = loadTokens();
  tokens[token] = { expires, ip };
  saveTokens(tokens);

  return sendResponse(res, true, "Password verified", { token, expires });
});

app.post("/api/admin/upload", authenticateAdminToken, upload.single("file"), (req, res) => {
  if (staticListMode) {
    return sendResponse(
      res,
      false,
      "Static mode enabled. Update list.csv directly in the project; uploads are disabled.",
      undefined,
      400,
    );
  }

  if (!req.file) {
    return sendResponse(res, false, "No file uploaded or upload error", undefined, 400);
  }

  const originalName = req.file.originalname || "";
  if (!originalName.toLowerCase().endsWith(".csv")) {
    return sendResponse(res, false, "Only CSV files are allowed", undefined, 400);
  }

  const content = req.file.buffer.toString("utf-8");
  const csvType = detectCSVType(content);
  if (csvType === "invalid") {
    return sendResponse(
      res,
      false,
      "Invalid CSV format. Upload either leaderboard data.csv (with required headers) or one-column list.csv.",
      undefined,
      400,
    );
  }

  const targetFileName = csvType === "leaderboard" ? "data.csv" : "list.csv";
  const targetPath = path.join(rootDir, targetFileName);

  if (fs.existsSync(targetPath)) {
    const backupName = `${targetFileName.replace(".csv", "")}_backup_${timestampLabel()}.csv`;
    fs.copyFileSync(targetPath, path.join(backupDir, backupName));
  }

  fs.writeFileSync(targetPath, content, "utf-8");

  return sendResponse(res, true, "File uploaded successfully", {
    filename: targetFileName,
    type: csvType,
    size: Buffer.byteLength(content),
    modified: Math.floor(fs.statSync(targetPath).mtimeMs / 1000),
  });
});

app.get("/api/admin/info", (_req, res) => {
  if (staticListMode) {
    const resolvedListPath = resolveReadableFilePath([listCsvPath, path.join(process.cwd(), "list.csv")]);
    if (!resolvedListPath) {
      return sendResponse(res, false, "list.csv file not found", undefined, 404);
    }

    const content = fs.readFileSync(resolvedListPath, "utf-8");
    const userCount = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length;

    return sendResponse(res, true, "File info retrieved", {
      filename: "list.csv",
      size: Buffer.byteLength(content),
      modified: Math.floor(fs.statSync(resolvedListPath).mtimeMs / 1000),
      userCount,
      dataFileExists: fs.existsSync(csvPath),
      listFileExists: true,
      staticMode: true,
    });
  }

  const dataExists = fs.existsSync(csvPath);
  const listExists = fs.existsSync(listCsvPath);

  if (!dataExists && !listExists) {
    return sendResponse(res, false, "CSV file not found", undefined, 404);
  }

  const targetPath = dataExists ? csvPath : listCsvPath;
  const targetFile = dataExists ? "data.csv" : "list.csv";
  const content = fs.readFileSync(targetPath, "utf-8");
  const parsed = parseRows(content);
  const userCount = targetFile === "data.csv" ? Math.max(0, parsed.length - 1) : parsed.length;

  return sendResponse(res, true, "File info retrieved", {
    filename: targetFile,
    size: Buffer.byteLength(content),
    modified: Math.floor(fs.statSync(targetPath).mtimeMs / 1000),
    userCount,
    dataFileExists: dataExists,
    listFileExists: listExists,
  });
});

app.get("/api/admin/download", authenticateAdminToken, (_req, res) => {
  if (staticListMode) {
    const resolvedListPath = resolveReadableFilePath([listCsvPath, path.join(process.cwd(), "list.csv")]);
    if (!resolvedListPath) {
      return sendResponse(res, false, "list.csv file not found", undefined, 404);
    }

    const fileName = `list_backup_${timestampLabel()}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(fs.readFileSync(resolvedListPath));
    return;
  }

  if (!fs.existsSync(csvPath)) {
    return sendResponse(res, false, "CSV file not found", undefined, 404);
  }

  const fileName = `data_backup_${timestampLabel()}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(fs.readFileSync(csvPath));
});

app.get("/api/admin/inventory", authenticateAdminToken, (_req, res) => {
  return sendResponse(res, true, "Inventory loaded", loadInventory());
});

app.post("/api/admin/inventory", authenticateAdminToken, (req, res) => {
  const bag = clampNonNegativeInt(req.body?.bag);
  const waterBottle = clampNonNegativeInt(req.body?.waterBottle);
  const tShirt = clampNonNegativeInt(req.body?.tShirt);
  const topThreeCount = clampNonNegativeInt(req.body?.topThreeCount);
  const topTwoCount = clampNonNegativeInt(req.body?.topTwoCount);

  const inventory: Inventory = {
    bag,
    waterBottle,
    tShirt,
    topThreeCount,
    topTwoCount,
  };
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), "utf-8");

  return sendResponse(res, true, "Inventory updated", inventory);
});

app.get("/api/admin/allocations", authenticateAdminToken, (_req, res) => {
  const resolvedListPath = resolveReadableFilePath([listCsvPath, path.join(process.cwd(), "list.csv")]);
  if (!resolvedListPath) {
    return sendResponse(res, false, "list.csv file not found", undefined, 404);
  }

  const participants = parseAllocationParticipants(fs.readFileSync(resolvedListPath, "utf-8"));
  const inventory = loadInventory();
  const result = buildAllocations(participants, inventory);

  return sendResponse(res, true, "Allocations generated", {
    inventory,
    ...result,
  });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return sendResponse(res, false, "File size exceeds 10MB limit", undefined, 400);
  }
  console.error(error);
  return sendResponse(res, false, "Unexpected server error", undefined, 500);
});

app.use(express.static(rootDir));

app.get("*", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

const port = Number(process.env.PORT ?? 3000);
if (!isVercel) {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

export default app;

function initializeRuntimeStorage(): void {
  try {
    ensureFolder(backupDir);
    ensureInventoryFile();
  } catch (error) {
    console.error("Runtime storage initialization warning:", error);
  }
}

function sendResponse<T>(
  res: Response,
  success: boolean,
  message: string,
  data?: T,
  statusCode = 200,
): Response<ApiResponse<T>> {
  const payload: ApiResponse<T> = { success, message };
  if (data !== undefined) {
    payload.data = data;
  }
  return res.status(statusCode).json(payload);
}

function authenticateAdminToken(req: Request, res: Response, next: NextFunction): void | Response {
  const token = extractToken(req);
  if (!token) {
    return sendResponse(res, false, "Unauthorized", undefined, 401);
  }

  const tokens = loadTokens();
  const info = tokens[token];
  const now = Math.floor(Date.now() / 1000);
  const ip = getClientIp(req);

  pruneExpiredTokens(tokens, now);

  if (!info || info.expires < now || info.ip !== ip) {
    return sendResponse(res, false, "Unauthorized", undefined, 401);
  }

  next();
}

function extractToken(req: Request): string {
  const authHeader = req.header("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  if (queryToken) {
    return queryToken;
  }

  const bodyToken = typeof req.body?.token === "string" ? req.body.token : "";
  return bodyToken;
}

function validateDailyAuthToken(authHeader: string): boolean {
  if (!adminDailyTokenSeed) {
    return false;
  }

  const expectedToken = `Bearer ${crypto.createHash("sha256").update(`${adminDailyTokenSeed}${todayISO()}`).digest("hex")}`;
  return authHeader === expectedToken;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadTokens(): Record<string, TokenInfo> {
  initializeRuntimeStorage();

  if (!fs.existsSync(tokensPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(tokensPath, "utf-8")) as Record<string, TokenInfo>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveTokens(tokens: Record<string, TokenInfo>): void {
  try {
    initializeRuntimeStorage();
    fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf-8");
  } catch (error) {
    console.error("Unable to persist tokens:", error);
  }
}

function pruneExpiredTokens(tokens: Record<string, TokenInfo>, nowSec = Math.floor(Date.now() / 1000)): void {
  let changed = false;
  for (const [token, info] of Object.entries(tokens)) {
    if (!info || info.expires < nowSec) {
      delete tokens[token];
      changed = true;
    }
  }
  if (changed) {
    saveTokens(tokens);
  }
}

function parseRows(csvText: string): string[][] {
  return parse(csvText, {
    skip_empty_lines: true,
    relax_quotes: true,
  }) as string[][];
}

function parseParticipants(csvText: string): Participant[] {
  const rows = parseRows(csvText);
  if (rows.length <= 1) {
    return [];
  }

  const participants: Participant[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length < 10) {
      continue;
    }

    let userName = (row[0] ?? "").trim() || "Unknown";
    const userEmail = (row[1] ?? "").trim();

    if (userName === "gdg.nit@gmail.com") {
      userName = "Suman Jash";
    } else if (
      userName === "https://www.cloudskillsboost.google/public_profiles/d1b5eca9-3675-41a9-bf18-b995d8622d29"
    ) {
      userName = "Mohd Faraz";
    }

    participants.push({
      name: userName,
      email: userEmail,
      profileUrl: (row[2] ?? "").trim(),
      profileStatus: (row[3] ?? "").trim(),
      accessCodeRedeemed: (row[4] ?? "").trim() === "Yes",
      allCompleted: (row[5] ?? "").trim() === "Yes",
      badgesCount: Number.parseInt(row[6] ?? "0", 10) || 0,
      badgeNames: (row[7] ?? "").trim(),
      gamesCount: Number.parseInt(row[8] ?? "0", 10) || 0,
      gameNames: (row[9] ?? "").trim(),
      originalIndex: i,
      rank: 0,
    });
  }

  participants.sort((a, b) => {
    if (b.badgesCount !== a.badgesCount) {
      return b.badgesCount - a.badgesCount;
    }
    if (b.gamesCount !== a.gamesCount) {
      return b.gamesCount - a.gamesCount;
    }
    return a.originalIndex - b.originalIndex;
  });

  participants.forEach((p, index) => {
    p.rank = index + 1;
  });

  return participants;
}

function removeEmailsFromCSV(csvText: string): string {
  const rows = parse(csvText, {
    relax_quotes: true,
  }) as string[][];

  const cleanedRows = rows.map((row, index) => {
    if (index === 0) {
      return row;
    }

    const copy = [...row];
    if (copy.length > 1) {
      copy[1] = "";
    }
    return copy;
  });

  return cleanedRows
    .map((row) => row.map((field) => `"${String(field ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function buildLeaderboardCsvFromList(listCsvText: string): string {
  const participants = parseAllocationParticipants(listCsvText);
  const inventory = loadInventory();
  const allocation = buildAllocations(participants, inventory);

  const rows: string[][] = [
    [
      "User Name",
      "User Email",
      "Profile URL",
      "Profile Status",
      "Access Code Redeemed",
      "All Completed",
      "Badges Count",
      "Badge Names",
      "Games Count",
      "Game Names",
    ],
  ];

  for (const row of allocation.rows) {
    const itemCount = row.items.length;
    const itemText = row.items.join(" + ");

    rows.push([
      row.name,
      "",
      "",
      "Active",
      itemCount > 0 ? "Yes" : "No",
      "No",
      String(itemCount),
      itemText,
      "0",
      "-",
    ]);
  }

  return rows
    .map((cols) => cols.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function validateCSVContent(csvText: string): boolean {
  return detectCSVType(csvText) !== "invalid";
}

function detectCSVType(csvText: string): "leaderboard" | "list" | "invalid" {
  const rows = parseRows(csvText.trim());
  if (rows.length < 2) {
    return "invalid";
  }

  const header = rows[0].join(",").toLowerCase();
  const requiredColumns = ["user name", "user email", "profile url"];
  if (requiredColumns.every((col) => header.includes(col))) {
    return "leaderboard";
  }

  const isSingleColumn = rows.every((row) => row.length === 1 && String(row[0] ?? "").trim().length > 0);
  if (isSingleColumn) {
    return "list";
  }

  return "invalid";
}

function buildAllocations(participants: AllocationParticipant[], inventoryInput: Inventory): {
  summary: {
    participants: number;
    allocatedParticipants: number;
    topThreeCount: number;
    topTwoCount: number;
    bagGiven: number;
    bottleGiven: number;
    tShirtGiven: number;
    inventoryLeft: Inventory;
  };
  rows: AllocationRow[];
} {
  const inventory = { ...inventoryInput };
  const topThreeCount = inventory.topThreeCount;
  const topTwoCount = inventory.topTwoCount;
  const topTwoEndRank = topThreeCount + topTwoCount;
  const rows: AllocationRow[] = [];

  for (const participant of participants) {
    const items: string[] = [];

    if (participant.rank <= topThreeCount) {
      maybeGive("Bag", "bag", items, inventory);
      maybeGive("Water Bottle", "waterBottle", items, inventory);
      maybeGive("T-Shirt", "tShirt", items, inventory);
    } else if (participant.rank <= topTwoEndRank) {
      giveRandomUniqueItems(2, items, inventory);
    } else {
      giveRandomUniqueItems(1, items, inventory);
    }

    rows.push({
      rank: participant.rank,
      name: participant.name,
      email: participant.email,
      items,
    });
  }

  const bagGiven = rows.filter((r) => r.items.includes("Bag")).length;
  const bottleGiven = rows.filter((r) => r.items.includes("Water Bottle")).length;
  const tShirtGiven = rows.filter((r) => r.items.includes("T-Shirt")).length;

  return {
    summary: {
      participants: participants.length,
      allocatedParticipants: rows.filter((r) => r.items.length > 0).length,
      topThreeCount,
      topTwoCount,
      bagGiven,
      bottleGiven,
      tShirtGiven,
      inventoryLeft: inventory,
    },
    rows,
  };
}

function maybeGive(
  displayName: "Bag" | "Water Bottle" | "T-Shirt",
  key: keyof Inventory,
  rowItems: string[],
  inventory: Inventory,
): void {
  if (inventory[key] <= 0) {
    return;
  }
  inventory[key] -= 1;
  rowItems.push(displayName);
}

function giveRandomUniqueItems(count: number, rowItems: string[], inventory: Inventory): void {
  const options: Array<{ label: "Bag" | "Water Bottle" | "T-Shirt"; key: keyof Inventory }> = [];

  if (inventory.bag > 0) {
    options.push({ label: "Bag", key: "bag" });
  }
  if (inventory.waterBottle > 0) {
    options.push({ label: "Water Bottle", key: "waterBottle" });
  }
  if (inventory.tShirt > 0) {
    options.push({ label: "T-Shirt", key: "tShirt" });
  }

  shuffle(options);

  for (const option of options.slice(0, count)) {
    if (inventory[option.key] > 0) {
      inventory[option.key] -= 1;
      rowItems.push(option.label);
    }
  }
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function loadInventory(): Inventory {
  try {
    initializeRuntimeStorage();
    const raw = JSON.parse(fs.readFileSync(inventoryPath, "utf-8")) as Partial<Inventory>;
    const topThreeCount =
      typeof raw.topThreeCount === "number" ? clampNonNegativeInt(raw.topThreeCount) : 30;
    const topTwoCount = typeof raw.topTwoCount === "number" ? clampNonNegativeInt(raw.topTwoCount) : 20;

    return {
      bag: clampNonNegativeInt(raw.bag),
      waterBottle: clampNonNegativeInt(raw.waterBottle),
      tShirt: clampNonNegativeInt(raw.tShirt),
      topThreeCount,
      topTwoCount,
    };
  } catch {
    return { bag: 0, waterBottle: 0, tShirt: 0, topThreeCount: 30, topTwoCount: 20 };
  }
}

function ensureInventoryFile(): void {
  if (!fs.existsSync(inventoryPath)) {
    try {
      fs.writeFileSync(
        inventoryPath,
        JSON.stringify({ bag: 0, waterBottle: 0, tShirt: 0, topThreeCount: 30, topTwoCount: 20 }, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.error("Unable to initialize inventory file:", error);
    }
  }
}

function resolveReadableFilePath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore invalid/unreadable candidate and continue.
    }
  }
  return null;
}

function parseAllocationParticipants(listCsvText: string): AllocationParticipant[] {
  const lines = listCsvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((name, index) => ({
    rank: index + 1,
    name,
    email: "",
  }));
}

function clampNonNegativeInt(value: unknown): number {
  const n = Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return n;
}

function ensureFolder(folderPath: string): void {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

function percent(part: number, total: number): number {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function average(sum: number, total: number): number {
  if (!total) return 0;
  return Number((sum / total).toFixed(1));
}

function timestampLabel(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return req.socket.remoteAddress ?? "unknown";
}
