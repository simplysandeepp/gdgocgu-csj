<?php
error_reporting(E_ALL);
ini_set('display_errors', 0);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

define('UPLOAD_DIR', __DIR__ . '/');
define('CSV_FILE', 'data.csv');
define('BACKUP_DIR', __DIR__ . '/backups/');
define('MAX_FILE_SIZE', 10 * 1024 * 1024);

define('ADMIN_PASSWORD_PLAIN', 'gdg@admin2025');
define('ADMIN_PASSWORD_HASH', password_hash(ADMIN_PASSWORD_PLAIN, PASSWORD_DEFAULT));
define('TOKENS_FILE', BACKUP_DIR . 'tokens.json');

function sendResponse($success, $message, $data = null) {
    $response = [
        'success' => $success,
        'message' => $message
    ];
    
    if ($data !== null) {
        $response['data'] = $data;
    }
    
    echo json_encode($response);
    exit();
}

function verifyPassword($password) {
    return password_verify($password, ADMIN_PASSWORD_HASH);
}

if (!file_exists(BACKUP_DIR)) {
    mkdir(BACKUP_DIR, 0755, true);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'upload':
        handleUpload();
        break;
    
    case 'info':
        handleInfo();
        break;
    
    case 'download':
        handleDownload();
        break;
    
    case 'verify':
        handleVerify();
        break;
    
    default:
        sendResponse(false, 'Invalid action');
}

function handleUpload() {
    $token = $_POST['token'] ?? $_GET['token'] ?? '';
    $authHeader = getAuthorizationHeader();
    if (!$token && $authHeader) {
        if (stripos($authHeader, 'bearer ') === 0) {
            $token = trim(substr($authHeader, 7));
        }
    }

    if (!verifyToken($token)) {
        sendResponse(false, 'Unauthorized');
    }
    
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        sendResponse(false, 'No file uploaded or upload error');
    }
    
    $file = $_FILES['file'];
    $fileInfo = pathinfo($file['name']);
    if (strtolower($fileInfo['extension']) !== 'csv') {
        sendResponse(false, 'Only CSV files are allowed');
    }
    
    if ($file['size'] > MAX_FILE_SIZE) {
        sendResponse(false, 'File size exceeds 10MB limit');
    }
    
    $content = file_get_contents($file['tmp_name']);
    
    if (!validateCSVContent($content)) {
        sendResponse(false, 'Invalid CSV format. Please check your file structure.');
    }
    
    $csvPath = UPLOAD_DIR . CSV_FILE;
    if (file_exists($csvPath)) {
        $backupName = 'data_backup_' . date('Y-m-d_H-i-s') . '.csv';
        $backupPath = BACKUP_DIR . $backupName;
        
        if (!copy($csvPath, $backupPath)) {
            sendResponse(false, 'Failed to create backup');
        }
    }
    
    if (!move_uploaded_file($file['tmp_name'], $csvPath)) {
        sendResponse(false, 'Failed to save uploaded file');
    }
    
    chmod($csvPath, 0644);
    
    sendResponse(true, 'File uploaded successfully', [
        'filename' => CSV_FILE,
        'size' => filesize($csvPath),
        'modified' => filemtime($csvPath)
    ]);
}

function handleInfo() {
    $csvPath = UPLOAD_DIR . CSV_FILE;
    
    if (!file_exists($csvPath)) {
        sendResponse(false, 'CSV file not found');
    }
    
    $lines = file($csvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $userCount = count($lines) - 1;
    
    sendResponse(true, 'File info retrieved', [
        'filename' => CSV_FILE,
        'size' => filesize($csvPath),
        'modified' => filemtime($csvPath),
        'userCount' => max(0, $userCount)
    ]);
}

function handleDownload() {
    $token = $_GET['token'] ?? $_POST['token'] ?? '';
    $authHeader = getAuthorizationHeader();
    if (!$token && $authHeader) {
        if (stripos($authHeader, 'bearer ') === 0) {
            $token = trim(substr($authHeader, 7));
        }
    }

    if (!verifyToken($token)) {
        sendResponse(false, 'Unauthorized');
    }

    $csvPath = UPLOAD_DIR . CSV_FILE;
    if (!file_exists($csvPath)) {
        sendResponse(false, 'CSV file not found');
    }
    
    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename="data_backup_' . date('Y-m-d_H-i-s') . '.csv"');
    header('Content-Length: ' . filesize($csvPath));
    
    readfile($csvPath);
    exit();
}

function handleVerify() {
    $password = $_POST['password'] ?? '';

    if (!verifyPassword($password)) {
        sendResponse(false, 'Invalid password');
    }

    if (!file_exists(BACKUP_DIR)) {
        mkdir(BACKUP_DIR, 0755, true);
    }

    $token = bin2hex(random_bytes(32));
    $expires = time() + 3600; // 1 hour
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

    $tokens = loadTokens();
    $tokens[$token] = [
        'expires' => $expires,
        'ip' => $ip
    ];
    saveTokens($tokens);

    sendResponse(true, 'Password verified', [
        'token' => $token,
        'expires' => $expires
    ]);
}

function loadTokens() {
    if (!file_exists(TOKENS_FILE)) return [];
    $data = json_decode(@file_get_contents(TOKENS_FILE), true);
    if (!is_array($data)) return [];
    return $data;
}

function saveTokens($tokens) {
    file_put_contents(TOKENS_FILE, json_encode($tokens, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function cleanExpiredTokens() {
    $tokens = loadTokens();
    $now = time();
    $changed = false;
    foreach ($tokens as $t => $info) {
        if ($info['expires'] < $now) {
            unset($tokens[$t]);
            $changed = true;
        }
    }
    if ($changed) saveTokens($tokens);
}

function verifyToken($token) {
    if (empty($token)) return false;
    cleanExpiredTokens();
    $tokens = loadTokens();
    if (!isset($tokens[$token])) return false;
    // Optionally enforce IP match
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (isset($tokens[$token]['ip']) && $tokens[$token]['ip'] !== $ip) return false;
    return $tokens[$token]['expires'] >= time();
}

function getAuthorizationHeader() {
    foreach (array("Authorization", "authorization", "HTTP_AUTHORIZATION") as $h) {
        if (!empty($_SERVER[$h])) return $_SERVER[$h];
    }
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (!empty($headers['Authorization'])) return $headers['Authorization'];
        if (!empty($headers['authorization'])) return $headers['authorization'];
    }
    return '';
}

function validateCSVContent($content) {
    $lines = explode("\n", trim($content));
    
    if (count($lines) < 2) {
        return false;
    }
    
    $header = strtolower($lines[0]);
    $requiredColumns = ['user name', 'user email', 'profile url'];
    
    foreach ($requiredColumns as $col) {
        if (stripos($header, $col) === false) {
            return false;
        }
    }
    
    return true;
}

function sanitizeFilename($filename) {
    $filename = preg_replace('/[^a-zA-Z0-9._-]/', '', $filename);
    return $filename;
}

function logSecurityEvent($event, $details = '') {
    $logFile = __DIR__ . '/security.log';
    $timestamp = date('Y-m-d H:i:s');
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $logEntry = "[$timestamp] [$ip] $event - $details\n";
    
    file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX);
}
?>
