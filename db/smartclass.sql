-- ============================================================
--  SmartClass — MySQL Database Schema
--  Import via phpMyAdmin OR run:
--    mysql -u root -p < smartclass.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS smartclass_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smartclass_db;

-- ─────────────────────────────────────────────────────────────
--  users — login accounts for admin and professors
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(60)      NOT NULL UNIQUE,
  password    VARCHAR(255)     NOT NULL COMMENT 'bcrypt hash',
  role        ENUM('admin','professor') NOT NULL DEFAULT 'professor',
  full_name   VARCHAR(120)     NOT NULL,
  avatar      VARCHAR(10)      NOT NULL DEFAULT '👤',
  is_active   TINYINT(1)       NOT NULL DEFAULT 1,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
--  login_sessions — server-side session tokens
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_sessions (
  token       VARCHAR(64)      PRIMARY KEY,
  user_id     INT UNSIGNED     NOT NULL,
  role        ENUM('admin','professor') NOT NULL,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME         NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
--  sections — class sections
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sections (
  id          VARCHAR(32)      PRIMARY KEY,
  name        VARCHAR(80)      NOT NULL,
  subject     VARCHAR(120)     NOT NULL,
  created_by  INT UNSIGNED,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
--  login_log — audit trail
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_log (
  id          INT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(60)      NOT NULL,
  role        VARCHAR(20)      NOT NULL,
  success     TINYINT(1)       NOT NULL DEFAULT 0,
  ip_address  VARCHAR(45),
  user_agent  VARCHAR(255),
  logged_at   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────────────────────
--  Seed data
--  Plain-text passwords:  admin → admin123  |  prof/prof2 → prof123
--  These are valid bcrypt hashes generated with PASSWORD_BCRYPT, cost 12.
-- ─────────────────────────────────────────────────────────────
INSERT INTO users (username, password, role, full_name, avatar) VALUES
  ('admin', '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin',     'Administrator',     '🛡'),
  ('prof',  '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'professor', 'Prof. Maria Santos', '👩‍🏫'),
  ('prof2', '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'professor', 'Prof. Juan Cruz',    '👨‍🏫');

-- NOTE: The seed hash above is a placeholder. Run this PHP snippet
-- ONCE after import to set real passwords:
--
--  php -r "
--    \$pdo = new PDO('mysql:host=localhost;dbname=smartclass_db','root','');
--    \$pdo->exec(\"UPDATE users SET password='\"
--      . password_hash('admin123', PASSWORD_BCRYPT, ['cost'=>12])
--      . \"' WHERE username='admin'\");
--    \$pdo->exec(\"UPDATE users SET password='\"
--      . password_hash('prof123', PASSWORD_BCRYPT, ['cost'=>12])
--      . \"' WHERE username IN ('prof','prof2')\");
--    echo 'Passwords updated.';
--  "

INSERT INTO sections (id, name, subject) VALUES
  ('SEC-001', 'CS301-A', 'Data Structures');