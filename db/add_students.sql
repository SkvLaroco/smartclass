-- ============================================================
--  SmartClass — Student Portal DB Patch
--  Run this IN ADDITION to smartclass.sql (it patches the existing DB)
--  In phpMyAdmin: select smartclass_db → Import → choose this file
-- ============================================================

USE smartclass_db;

-- ── 1. Add student role & link columns to users ───────────────────────────────
ALTER TABLE users MODIFY COLUMN
  role ENUM('admin','professor','student') NOT NULL DEFAULT 'professor';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS student_sid  VARCHAR(30) NULL COMMENT 'Links to enrolled student SID',
  ADD COLUMN IF NOT EXISTS section_id   VARCHAR(32) NULL COMMENT 'Student home section';

-- ── 2. Announcements (teacher → students) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
  id          INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
  section_id  VARCHAR(32)      NULL COMMENT 'NULL = all sections',
  title       VARCHAR(200)     NOT NULL,
  body        TEXT             NOT NULL,
  priority    ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal',
  posted_by   INT UNSIGNED     NULL,
  is_active   TINYINT(1)       NOT NULL DEFAULT 1,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Student feedback (students → teacher) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS student_feedback (
  id              INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  student_user_id INT UNSIGNED   NULL,
  section_id      VARCHAR(32)    NULL,
  mood            ENUM('great','good','okay','confused','lost') NOT NULL,
  message         TEXT           NULL,
  is_anonymous    TINYINT(1)     NOT NULL DEFAULT 0,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. Lesson notes (teacher shares summaries → students) ─────────────────────
CREATE TABLE IF NOT EXISTS lesson_notes (
  id          INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  section_id  VARCHAR(32)    NULL,
  title       VARCHAR(200)   NOT NULL,
  summary     TEXT           NOT NULL,
  key_points  JSON           NULL,
  key_terms   JSON           NULL,
  word_count  INT UNSIGNED   NOT NULL DEFAULT 0,
  shared_by   INT UNSIGNED   NULL,
  created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 5. Student attendance records (synced from teacher's session end) ──────────
CREATE TABLE IF NOT EXISTS student_attendance (
  id            INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
  student_sid   VARCHAR(30)    NOT NULL,
  student_name  VARCHAR(120)   NOT NULL,
  section_id    VARCHAR(32)    NULL,
  section_name  VARCHAR(80)    NULL,
  session_date  DATE           NOT NULL,
  session_label VARCHAR(80)    NULL,
  status        ENUM('present','late','absent','pending') NOT NULL DEFAULT 'pending',
  emotion       VARCHAR(30)    NULL,
  confidence    TINYINT UNSIGNED NULL,
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sid   (student_sid),
  INDEX idx_date  (session_date),
  INDEX idx_sec   (section_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 6. Sample student accounts ─────────────────────────────────────────────────
-- Passwords stored as plain text → auto-upgraded to bcrypt on first login
-- (same mechanism as admin/professor accounts)
INSERT IGNORE INTO users (username, password, role, full_name, avatar, student_sid, section_id) VALUES
  ('student1', 'student123', 'student', 'Maria Santos',   '👩‍🎓', '2024-0001', 'SEC-001'),
  ('student2', 'student123', 'student', 'Juan Dela Cruz', '👨‍🎓', '2024-0002', 'SEC-001'),
  ('student3', 'student123', 'student', 'Ana Reyes',      '👩‍🎓', '2024-0003', 'SEC-001');

-- ── 7. Sample announcements ────────────────────────────────────────────────────
INSERT IGNORE INTO announcements (section_id, title, body, priority) VALUES
  ('SEC-001', 'Welcome to SmartClass Student Portal! 🎓',
   'Hello! This portal lets you track your attendance, download lesson notes shared by your professor, and send feedback directly. Explore each section using the tabs above.',
   'important'),
  ('SEC-001', 'Reminder: Midterm Exam Next Week',
   'Midterm examinations are scheduled for next week. Please review all lesson notes and check the announcements for room assignments. Good luck!',
   'urgent');

-- ── Quick-reference queries ────────────────────────────────────────────────────
-- List student accounts:
--   SELECT id, username, full_name, student_sid, section_id FROM users WHERE role='student';
--
-- View feedback inbox:
--   SELECT sf.*, u.full_name FROM student_feedback sf
--   LEFT JOIN users u ON u.id = sf.student_user_id
--   ORDER BY sf.created_at DESC;
--
-- View attendance for a student:
--   SELECT * FROM student_attendance WHERE student_sid = '2024-0001' ORDER BY session_date DESC;

-- ── Fix: add is_active column to lesson_notes if missing ─────────────────────
-- (Earlier versions of the table may not have this column)
ALTER TABLE lesson_notes
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;

-- ── Fix: add is_active column to announcements if missing ────────────────────
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
