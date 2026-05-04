<?php
/**
 * api/users.php — SmartClass User Management API
 * Requires a valid admin token for all write operations.
 *
 * Endpoints (POST JSON):
 *   action=list             → list all users (admin only)
 *   action=add              → { token, username, password, role, full_name }
 *   action=update_password  → { token, user_id, new_password }
 *   action=deactivate       → { token, user_id }
 *   action=activate         → { token, user_id }
 *   action=delete           → { token, user_id }
 */

require_once __DIR__ . '/config.php';

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? $_GET['action'] ?? '';
$token  = $body['token'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

// ── Auth gate ─────────────────────────────────────────────────────────────────
function requireAdmin(string $token): array {
    if (!$token) jsonResponse(['ok' => false, 'error' => 'Not authenticated.'], 401);

    $stmt = getDB()->prepare(
        'SELECT ls.role, u.id, u.username, u.full_name, u.is_active
         FROM login_sessions ls
         JOIN users u ON u.id = ls.user_id
         WHERE ls.token = ? AND ls.expires_at > NOW()
         LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row || !$row['is_active']) {
        jsonResponse(['ok' => false, 'error' => 'Token invalid or expired.'], 401);
    }
    if ($row['role'] !== 'admin') {
        jsonResponse(['ok' => false, 'error' => 'Admin role required.'], 403);
    }
    return $row;
}

// ── LIST ──────────────────────────────────────────────────────────────────────
if ($action === 'list') {
    requireAdmin($token);
    $stmt = getDB()->query(
        'SELECT id, username, role, full_name, avatar, is_active, created_at
         FROM users ORDER BY role ASC, full_name ASC'
    );
    jsonResponse(['ok' => true, 'users' => $stmt->fetchAll()]);
}

// ── ADD ───────────────────────────────────────────────────────────────────────
if ($action === 'add') {
    requireAdmin($token);

    $username  = trim($body['username'] ?? '');
    $password  = $body['password'] ?? '';
    $role      = $body['role'] ?? 'professor';
    $full_name = trim($body['full_name'] ?? '');
    $avatar    = $body['avatar'] ?? ($role === 'admin' ? '🛡' : '👩‍🏫');

    if (!$username || !$password || !$full_name) {
        jsonResponse(['ok' => false, 'error' => 'username, password, and full_name are required.'], 400);
    }
    if (!in_array($role, ['admin', 'professor'], true)) {
        jsonResponse(['ok' => false, 'error' => 'Role must be admin or professor.'], 400);
    }
    if (strlen($password) < 6) {
        jsonResponse(['ok' => false, 'error' => 'Password must be at least 6 characters.'], 400);
    }

    $pdo  = getDB();
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    try {
        $pdo->prepare(
            'INSERT INTO users (username, password, role, full_name, avatar) VALUES (?,?,?,?,?)'
        )->execute([$username, $hash, $role, $full_name, $avatar]);
        jsonResponse(['ok' => true, 'message' => 'User ' . $username . ' created.', 'id' => $pdo->lastInsertId()]);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) {
            jsonResponse(['ok' => false, 'error' => 'Username already exists.'], 409);
        }
        throw $e;
    }
}

// ── UPDATE PASSWORD ───────────────────────────────────────────────────────────
if ($action === 'update_password') {
    requireAdmin($token);
    $uid  = (int)($body['user_id'] ?? 0);
    $pass = $body['new_password'] ?? '';
    if (!$uid || strlen($pass) < 6) {
        jsonResponse(['ok' => false, 'error' => 'user_id and new_password (min 6 chars) required.'], 400);
    }
    $hash = password_hash($pass, PASSWORD_BCRYPT, ['cost' => 12]);
    getDB()->prepare('UPDATE users SET password = ? WHERE id = ?')->execute([$hash, $uid]);
    jsonResponse(['ok' => true, 'message' => 'Password updated.']);
}

// ── DEACTIVATE / ACTIVATE ─────────────────────────────────────────────────────
if ($action === 'deactivate' || $action === 'activate') {
    $admin = requireAdmin($token);
    $uid   = (int)($body['user_id'] ?? 0);
    if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id required.'], 400);
    if ($uid === (int)$admin['id']) {
        jsonResponse(['ok' => false, 'error' => 'You cannot deactivate your own account.'], 400);
    }
    $flag = ($action === 'activate') ? 1 : 0;
    getDB()->prepare('UPDATE users SET is_active = ? WHERE id = ?')->execute([$flag, $uid]);
    jsonResponse(['ok' => true, 'message' => 'User ' . $action . 'd.']);
}

// ── DELETE ────────────────────────────────────────────────────────────────────
if ($action === 'delete') {
    $admin = requireAdmin($token);
    $uid   = (int)($body['user_id'] ?? 0);
    if (!$uid) jsonResponse(['ok' => false, 'error' => 'user_id required.'], 400);
    if ($uid === (int)$admin['id']) {
        jsonResponse(['ok' => false, 'error' => 'You cannot delete your own account.'], 400);
    }
    getDB()->prepare('DELETE FROM users WHERE id = ?')->execute([$uid]);
    jsonResponse(['ok' => true, 'message' => 'User deleted.']);
}

jsonResponse(['ok' => false, 'error' => 'Unknown action.'], 400);