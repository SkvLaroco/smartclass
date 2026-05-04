<?php
/**
 * api/auth.php — SmartClass Authentication API
 *
 * POST { action, username, password }        ← role auto-detected from DB
 *   action=login   → login (role NOT required from client — fetched from DB)
 *   action=logout  → { token }
 *   action=verify  → { token }
 */

require_once __DIR__ . '/config.php';

// Auto-create essential tables if they don't exist yet (prevents login crashes on fresh DB)
try {
    $pdo = getDB();
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token VARCHAR(64) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        role VARCHAR(20) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_token (token),
        INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS login_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100),
        role VARCHAR(20),
        success TINYINT(1) DEFAULT 0,
        ip_address VARCHAR(45),
        user_agent VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (Exception $e) { /* non-fatal — tables may already exist */ }

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? $_GET['action'] ?? '';

// Purge expired sessions
try { getDB()->exec("DELETE FROM login_sessions WHERE expires_at < NOW()"); } catch (Exception $e) {}

// ─────────────────────────────────────────────────────────────────────────────
//  LOGIN  (role is auto-detected from DB — client does not choose it)
// ─────────────────────────────────────────────────────────────────────────────
if ($action === 'login') {
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if (!$username || !$password) {
        jsonResponse(['ok' => false, 'error' => 'Username and password are required.'], 400);
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare(
        'SELECT id, username, password, role, full_name, avatar,
                student_sid, section_id, is_active
         FROM users WHERE username = ? LIMIT 1'
    );
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    // Password check: supports bcrypt hash OR plain-text (auto-upgrades to bcrypt on login)
    $passwordOk = false;
    if ($user && $user['is_active']) {
        $stored = $user['password'];
        if (strlen($stored) >= 60 && $stored[0] === '$') {
            $passwordOk = password_verify($password, $stored);
        } else {
            $passwordOk = ($password === $stored);
            if ($passwordOk) {
                $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
                $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
                    ->execute([$hash, $user['id']]);
            }
        }
        if ($passwordOk && strlen($stored) >= 60 && $stored[0] === '$') {
            if (password_needs_rehash($stored, PASSWORD_BCRYPT, ['cost' => 12])) {
                $pdo->prepare('UPDATE users SET password = ? WHERE id = ?')
                    ->execute([password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]), $user['id']]);
            }
        }
    }

    if (!$passwordOk) {
        try { _auditLog($username, 'unknown', false); } catch (Exception $e) {}
        jsonResponse(['ok' => false, 'error' => 'Invalid username or password.'], 401);
    }

    $token   = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', time() + SESSION_LIFETIME_HOURS * 3600);

    $pdo->prepare(
        'INSERT INTO login_sessions (token, user_id, role, expires_at) VALUES (?,?,?,?)'
    )->execute([$token, $user['id'], $user['role'], $expires]);

    try { _auditLog($username, $user['role'], true); } catch (Exception $e) {}

    jsonResponse([
        'ok'         => true,
        'token'      => $token,
        'expires_at' => $expires,
        'user'       => [
            'id'          => $user['id'],
            'username'    => $user['username'],
            'role'        => $user['role'],
            'name'        => $user['full_name'],
            'avatar'      => $user['avatar'],
            'student_sid' => $user['student_sid'],
            'section_id'  => $user['section_id'],
        ],
    ]);
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
if ($action === 'logout') {
    $token = $body['token'] ?? '';
    if ($token) {
        getDB()->prepare('DELETE FROM login_sessions WHERE token = ?')->execute([$token]);
    }
    jsonResponse(['ok' => true]);
}

// ── VERIFY ────────────────────────────────────────────────────────────────────
if ($action === 'verify') {
    $token = $body['token'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
    if (!$token) jsonResponse(['ok' => false, 'error' => 'No token.'], 401);

    $stmt = getDB()->prepare(
        'SELECT ls.role, u.id, u.username, u.full_name, u.avatar,
                u.student_sid, u.section_id, u.is_active
         FROM login_sessions ls
         JOIN users u ON u.id = ls.user_id
         WHERE ls.token = ? AND ls.expires_at > NOW() LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row || !$row['is_active']) jsonResponse(['ok' => false, 'error' => 'Session expired.'], 401);

    jsonResponse([
        'ok'   => true,
        'user' => [
            'id'          => $row['id'],
            'username'    => $row['username'],
            'role'        => $row['role'],
            'name'        => $row['full_name'],
            'avatar'      => $row['avatar'],
            'student_sid' => $row['student_sid'],
            'section_id'  => $row['section_id'],
        ],
    ]);
}

jsonResponse(['ok' => false, 'error' => 'Unknown action.'], 400);

function _auditLog(string $username, string $role, bool $success): void {
    try {
        getDB()->prepare(
            'INSERT INTO login_log (username, role, success, ip_address, user_agent) VALUES (?,?,?,?,?)'
        )->execute([
            $username, $role, $success ? 1 : 0,
            $_SERVER['REMOTE_ADDR'] ?? null,
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
        ]);
    } catch (Exception $e) {}
}
