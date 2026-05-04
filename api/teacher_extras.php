<?php
/**
 * api/teacher_extras.php — Teacher-side extras for Student Portal
 *
 * POST { action, token, ...params }
 *
 * Actions:
 *   post_announcement  → { title, body, priority, section_id }
 *   delete_announcement→ { id }
 *   get_announcements  → list all announcements (for management)
 *   share_note         → { title, summary, key_points[], key_terms[], word_count, section_id }
 *   delete_note        → { id }
 *   get_feedback       → feedback inbox
 *   sync_attendance    → { students: [{sid, name, section_id, section_name, status, emotion, confidence}], session_date, session_label }
 */

require_once __DIR__ . '/config.php';

// Global exception handler — ensures PHP errors always return JSON, never HTML
set_exception_handler(function(Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo json_encode(['ok' => false, 'error' => 'Server error: ' . $e->getMessage()]);
    exit;
});
set_error_handler(function($errno, $errstr) {
    throw new ErrorException($errstr, $errno);
});

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? '';
$token  = $body['token']  ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';

// ── Auth: professor or admin ───────────────────────────────────────────────────
function requireTeacher(string $token): array {
    if (!$token) jsonResponse(['ok' => false, 'error' => 'Not authenticated.'], 401);
    getDB()->exec("DELETE FROM login_sessions WHERE expires_at < NOW()");
    $stmt = getDB()->prepare(
        'SELECT ls.role, u.id, u.full_name, u.is_active
         FROM login_sessions ls
         JOIN users u ON u.id = ls.user_id
         WHERE ls.token = ? AND ls.expires_at > NOW() LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();
    if (!$row || !$row['is_active']) jsonResponse(['ok' => false, 'error' => 'Session expired.'], 401);
    if (!in_array($row['role'], ['admin','professor'], true))
        jsonResponse(['ok' => false, 'error' => 'Teacher role required.'], 403);
    return $row;
}

// ── POST ANNOUNCEMENT ─────────────────────────────────────────────────────────
if ($action === 'post_announcement') {
    $user  = requireTeacher($token);
    $title = trim($body['title'] ?? '');
    $bdy   = trim($body['body']  ?? '');
    $pri   = $body['priority']   ?? 'normal';
    $sec   = $body['section_id'] ?? null;
    $valid = ['normal','important','urgent'];

    if (!$title || !$bdy)   jsonResponse(['ok' => false, 'error' => 'Title and body required.'], 400);
    if (!in_array($pri, $valid, true)) $pri = 'normal';

    getDB()->prepare(
        'INSERT INTO announcements (section_id, title, body, priority, posted_by) VALUES (?,?,?,?,?)'
    )->execute([$sec ?: null, $title, $bdy, $pri, $user['id']]);

    jsonResponse(['ok' => true, 'message' => 'Announcement posted.', 'id' => getDB()->lastInsertId()]);
}

// ── DELETE ANNOUNCEMENT ───────────────────────────────────────────────────────
if ($action === 'delete_announcement') {
    requireTeacher($token);
    $id = (int)($body['id'] ?? 0);
    if (!$id) jsonResponse(['ok' => false, 'error' => 'id required.'], 400);
    getDB()->prepare('UPDATE announcements SET is_active = 0 WHERE id = ?')->execute([$id]);
    jsonResponse(['ok' => true, 'message' => 'Announcement removed.']);
}

// ── GET ANNOUNCEMENTS (management view) ───────────────────────────────────────
if ($action === 'get_announcements') {
    requireTeacher($token);
    $stmt = getDB()->query(
        'SELECT a.id, a.section_id, a.title, a.body, a.priority, a.is_active, a.created_at,
                u.full_name as posted_by
         FROM announcements a
         LEFT JOIN users u ON u.id = a.posted_by
         WHERE a.is_active = 1
         ORDER BY a.created_at DESC LIMIT 50'
    );
    jsonResponse(['ok' => true, 'announcements' => $stmt->fetchAll()]);
}

// ── SHARE LESSON NOTE ─────────────────────────────────────────────────────────
if ($action === 'share_note') {
    $user   = requireTeacher($token);
    $title  = trim($body['title']   ?? '');
    $sum    = trim($body['summary'] ?? '');
    $kp     = $body['key_points']   ?? [];
    $kt     = $body['key_terms']    ?? [];
    $wc     = (int)($body['word_count'] ?? 0);
    $sec    = $body['section_id']   ?? null;

    if (!$title || !$sum) jsonResponse(['ok' => false, 'error' => 'Title and summary required.'], 400);

    getDB()->prepare(
        'INSERT INTO lesson_notes (section_id, title, summary, key_points, key_terms, word_count, shared_by)
         VALUES (?,?,?,?,?,?,?)'
    )->execute([$sec ?: null, $title, $sum, json_encode($kp), json_encode($kt), $wc, $user['id']]);

    jsonResponse(['ok' => true, 'message' => 'Note shared with students.', 'id' => getDB()->lastInsertId()]);
}

// ── DELETE LESSON NOTE ────────────────────────────────────────────────────────
if ($action === 'delete_note') {
    requireTeacher($token);
    $id = (int)($body['id'] ?? 0);
    if (!$id) jsonResponse(['ok' => false, 'error' => 'id required.'], 400);
    getDB()->prepare('DELETE FROM lesson_notes WHERE id = ?')->execute([$id]);
    jsonResponse(['ok' => true, 'message' => 'Note deleted.']);
}

// ── FEEDBACK INBOX ────────────────────────────────────────────────────────────
if ($action === 'get_feedback') {
    requireTeacher($token);
    $stmt = getDB()->query(
        'SELECT sf.id, sf.mood, sf.message, sf.is_anonymous, sf.section_id, sf.created_at,
                CASE WHEN sf.is_anonymous=1 THEN "Anonymous" ELSE COALESCE(u.full_name,"Unknown") END as student_name
         FROM student_feedback sf
         LEFT JOIN users u ON u.id = sf.student_user_id
         ORDER BY sf.created_at DESC LIMIT 100'
    );
    $rows   = $stmt->fetchAll();
    $moodCounts = ['great'=>0,'good'=>0,'okay'=>0,'confused'=>0,'lost'=>0];
    foreach ($rows as $r) $moodCounts[$r['mood']] = ($moodCounts[$r['mood']] ?? 0) + 1;
    jsonResponse(['ok' => true, 'feedback' => $rows, 'mood_counts' => $moodCounts]);
}

// ── SYNC ATTENDANCE (called when teacher ends session) ────────────────────────
if ($action === 'sync_attendance') {
    requireTeacher($token);
    $students = $body['students']      ?? [];
    $date     = $body['session_date']  ?? date('Y-m-d');
    $label    = $body['session_label'] ?? $date;

    if (empty($students)) jsonResponse(['ok' => false, 'error' => 'No students provided.'], 400);

    $pdo  = getDB();
    $stmt = $pdo->prepare(
        'INSERT INTO student_attendance
           (student_sid, student_name, section_id, section_name, session_date, session_label, status, emotion, confidence)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE status=VALUES(status), emotion=VALUES(emotion), confidence=VALUES(confidence)'
    );

    $count = 0;
    foreach ($students as $s) {
        $sid  = trim($s['sid']  ?? '');
        $name = trim($s['name'] ?? '');
        if (!$sid || !$name) continue;
        $stmt->execute([
            $sid, $name,
            $s['section_id']   ?? null,
            $s['section_name'] ?? null,
            $date, $label,
            $s['status']       ?? 'pending',
            $s['emotion']      ?? null,
            isset($s['confidence']) ? (int)$s['confidence'] : null,
        ]);
        $count++;
    }
    jsonResponse(['ok' => true, 'synced' => $count, 'message' => "Synced $count attendance records."]);
}

jsonResponse(['ok' => false, 'error' => 'Unknown action.'], 400);