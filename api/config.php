<?php
/**
 * api/config.php — SmartClass Configuration
 * Place this file inside your XAMPP htdocs/smartclass/api/ folder.
 *
 * XAMPP default credentials:
 *   host     : localhost
 *   user     : root
 *   password : (empty string)
 *   database : smartclass_db
 */

define('DB_HOST',    'localhost');
define('DB_USER',    'root');
define('DB_PASS',    '');           // Change if you set a MySQL root password
define('DB_NAME',    'smartclass_db');
define('DB_CHARSET', 'utf8mb4');

define('SESSION_LIFETIME_HOURS', 8);
define('CORS_ORIGIN', '*');

// ═══════════════════════════════════════════════════════════════════════════════
//  OLLAMA — Local AI for Lesson Summarizer (FREE, offline, no API key needed)
// ═══════════════════════════════════════════════════════════════════════════════
//
//  QUICK SETUP (do this once):
//
//    1. Download & install Ollama:
//         https://ollama.com/download   (Windows / macOS / Linux)
//
//    2. Open a terminal and pull ONE model:
//
//         ollama pull qwen2.5     ← BEST for Tagalog→English + summarising (4.7 GB)
//         ollama pull llama3.2    ← Fast and accurate (2.0 GB)
//         ollama pull mistral     ← Excellent summariser (4.1 GB)
//         ollama pull phi3        ← Smallest / low-end PC (2.3 GB)
//
//    3. Start Ollama (keep this terminal open while using SmartClass):
//         ollama serve
//         → Listens on http://localhost:11434
//
//    4. Set OLLAMA_MODEL below to whichever model you pulled, then save.
//
// ═══════════════════════════════════════════════════════════════════════════════
define('OLLAMA_HOST',  'http://localhost:11434');   // default Ollama address
define('OLLAMA_MODEL', 'qwen2.5');                  // ← change to match whichever model you pulled

// ── PDO helper ────────────────────────────────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
    } catch (PDOException $e) {
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode([
            'ok'    => false,
            'error' => 'Database connection failed. Check XAMPP MySQL and config.php.',
            'detail'=> $e->getMessage(),
        ]);
        exit;
    }
    return $pdo;
}

// ── JSON response helper ──────────────────────────────────────────────────────
function jsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    echo json_encode($data);
    exit;
}

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: ' . CORS_ORIGIN);
    header('Access-Control-Allow-Headers: Content-Type, X-Auth-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    http_response_code(204);
    exit;
}