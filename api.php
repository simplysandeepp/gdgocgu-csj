<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

define('CSV_FILE', __DIR__ . '/data.csv');

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

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'stats':
        getStatistics();
        break;
    
    case 'data':
        getData();
        break;
    
    case 'leaderboard':
        getLeaderboardData();
        break;
    
    default:
        sendResponse(false, 'Invalid action');
}

function getLeaderboardData() {
    static $rateLimits = []; 
    $clientIP = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $currentTime = time();

    if (!isset($rateLimits[$clientIP])) {
        $rateLimits[$clientIP] = [];
    }

    $rateLimits[$clientIP] = array_filter($rateLimits[$clientIP], function ($timestamp) use ($currentTime) {
        return ($currentTime - $timestamp) < 60;
    });

    if (count($rateLimits[$clientIP]) >= 60) {
        sendResponse(false, 'Rate limit exceeded. Please try again later.');
    }

    $rateLimits[$clientIP][] = $currentTime;

    if (!file_exists(CSV_FILE)) {
        sendResponse(false, 'Data not available');
    }

    $content = file_get_contents(CSV_FILE);
    $sanitizedContent = removeEmailsFromCSV($content);

    sendResponse(true, 'Data retrieved', [
        'content' => $sanitizedContent,
        'modified' => filemtime(CSV_FILE)
    ]);
}


function removeEmailsFromCSV($csvContent) {
    $lines = explode("\n", $csvContent);
    $sanitizedLines = [];
    
    foreach ($lines as $index => $line) {
        if ($index === 0 || trim($line) === '') {
            $sanitizedLines[] = $line;
            continue;
        }
        
        $fields = str_getcsv($line);
        if (isset($fields[1])) {
            $fields[1] = '';
        }
        
        $sanitizedLines[] = '"' . implode('","', array_map(function($field) {
            return str_replace('"', '""', $field);
        }, $fields)) . '"';
    }
    
    return implode("\n", $sanitizedLines);
}

function getStatistics() {
    if (!file_exists(CSV_FILE)) {
        sendResponse(false, 'CSV file not found');
    }
    
    $users = parseCSV();
    $total = count($users);
    $completed = 0;
    $redeemed = 0;
    $inProgress = 0;
    $totalBadges = 0;
    $totalGames = 0;
    $maxBadges = 0;
    $maxGames = 0;
    $highBadgeUsers = 0;
    $usersWithGames = 0;
    
    foreach ($users as $user) {
        if ($user['allCompleted']) $completed++;
        if ($user['accessCodeRedeemed']) $redeemed++;
        if (!$user['allCompleted'] && ($user['badgesCount'] > 0 || $user['gamesCount'] > 0)) {
            $inProgress++;
        }
        $totalBadges += $user['badgesCount'];
        $totalGames += $user['gamesCount'];
        if ($user['badgesCount'] > $maxBadges) $maxBadges = $user['badgesCount'];
        if ($user['gamesCount'] > $maxGames) $maxGames = $user['gamesCount'];
        if ($user['badgesCount'] >= 15) $highBadgeUsers++;
        if ($user['gamesCount'] > 0) $usersWithGames++;
    }
    
    $stats = [
        'total' => $total,
        'completed' => $completed,
        'completedPercent' => $total > 0 ? round(($completed / $total) * 100, 1) : 0,
        'redeemed' => $redeemed,
        'redeemedPercent' => $total > 0 ? round(($redeemed / $total) * 100, 1) : 0,
        'inProgress' => $inProgress,
        'inProgressPercent' => $total > 0 ? round(($inProgress / $total) * 100, 1) : 0,
        'badges' => [
            'total' => $totalBadges,
            'average' => $total > 0 ? round($totalBadges / $total, 1) : 0,
            'max' => $maxBadges,
            'highUsers' => $highBadgeUsers
        ],
        'games' => [
            'total' => $totalGames,
            'average' => $total > 0 ? round($totalGames / $total, 1) : 0,
            'max' => $maxGames,
            'usersWithGames' => $usersWithGames
        ]
    ];
    
    sendResponse(true, 'Statistics retrieved', $stats);
}

function getData() {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    
    if (empty($authHeader) || !validateAuthToken($authHeader)) {
        sendResponse(false, 'Unauthorized access');
    }
    
    if (!file_exists(CSV_FILE)) {
        sendResponse(false, 'CSV file not found');
    }
    
    $content = file_get_contents(CSV_FILE);
    
    sendResponse(true, 'Data retrieved', [
        'content' => $content,
        'size' => strlen($content),
        'modified' => filemtime(CSV_FILE)
    ]);
}

function validateAuthToken($token) {
    $expectedToken = 'Bearer ' . hash('sha256', 'gdg@admin2025' . date('Y-m-d'));
    return $token === $expectedToken;
}

function parseCSV() {
    $lines = file(CSV_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $users = [];
    
    for ($i = 1; $i < count($lines); $i++) {
        $values = str_getcsv($lines[$i]);
        if (count($values) < 9) continue;
        $users[] = [
            'allCompleted' => isset($values[5]) && trim($values[5]) === 'Yes',
            'accessCodeRedeemed' => isset($values[4]) && trim($values[4]) === 'Yes',
            'badgesCount' => isset($values[6]) ? intval($values[6]) : 0,
            'gamesCount' => isset($values[8]) ? intval($values[8]) : 0
        ];
    }
    
    return $users;
}
?>
