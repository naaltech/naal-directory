-- Nevzat Ayaz Anadolu Lisesi - Google Workspace hesap yönetimi
-- SQLite (better-sqlite3). Tarihler UTC metin: 'YYYY-MM-DD HH:MM:SS'.
-- Enum yerine CHECK kısıtları, boolean yerine 0/1, JSON alanları metin.

-- ───────────── Yapılandırma ─────────────

-- Workspace alan adları. Üçü de aynı Workspace hesabında (naal.org.tr ikincil alan adı).
CREATE TABLE domains (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,              -- ogr.nevzatayazal.k12.tr
  kind                  TEXT NOT NULL UNIQUE CHECK (kind IN ('TEACHER', 'STUDENT', 'CLUB')),
  customer_id           TEXT NOT NULL DEFAULT 'my_customer',
  admin_impersonate     TEXT NOT NULL,                     -- DWD ile taklit edilen admin
  default_org_unit_path TEXT NOT NULL DEFAULT '/',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE academic_years (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,                         -- 2026-2027
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Aynı anda tek "güncel" yıl
CREATE UNIQUE INDEX academic_years_one_current ON academic_years (is_current) WHERE is_current = 1;

-- Panelden değiştirilebilen ayarlar (değer JSON)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── Panel yöneticileri ─────────────

-- Yönetici hesapları sadece CLI ile oluşturulur: npm run admin -- create
CREATE TABLE admin_users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'VIEWER')),
  password_hash TEXT NOT NULL,                             -- scrypt$N$r$p$salt$hash
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,                                      -- çok sayıda hatalı girişte geçici kilit
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Oturumlar: çerezdeki rastgele anahtarın SHA-256 özeti saklanır, anahtarın kendisi değil
CREATE TABLE admin_sessions (
  id           TEXT PRIMARY KEY,                           -- sha256(token) hex
  user_id      INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX admin_sessions_user ON admin_sessions (user_id);
CREATE INDEX admin_sessions_expires ON admin_sessions (expires_at);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                               -- "admin.login", "student.create" ...
  entity_type TEXT,
  entity_id   TEXT,
  details     TEXT CHECK (details IS NULL OR json_valid(details)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_created ON audit_logs (created_at);

-- ───────────── Öğretmenler ─────────────

CREATE TABLE teachers (
  id             INTEGER PRIMARY KEY,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  branch         TEXT,
  phone          TEXT,
  personal_email TEXT,
  domain_id      INTEGER NOT NULL REFERENCES domains (id),
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,      -- ad.soyad@nevzatayazal.k12.tr
  google_user_id TEXT UNIQUE,
  org_unit_path  TEXT NOT NULL DEFAULT '/Ogretmenler',
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  last_synced_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX teachers_name ON teachers (last_name, first_name);

-- ───────────── Google grupları ─────────────

CREATE TABLE groups (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('CLASS', 'GRADE', 'CLUB', 'TEACHERS', 'CUSTOM')),
  domain_id       INTEGER NOT NULL REFERENCES domains (id),
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- 9a@ogr.nevzatayazal.k12.tr
  name            TEXT NOT NULL,
  description     TEXT,
  google_group_id TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── Sınıflar ─────────────

-- Grup yıllar boyunca aynı kalır (9a@...), sadece üyeleri değişir;
-- bu yüzden aynı grup birden çok yılın şubesine bağlanabilir.
CREATE TABLE class_sections (
  id               INTEGER PRIMARY KEY,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  grade            INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 12), -- hazırlık 0
  section          TEXT NOT NULL,                          -- A, B ...
  name             TEXT NOT NULL,                          -- 9-A
  field            TEXT,                                   -- ALANI YOK, SAYISAL ...
  advisor_id       INTEGER REFERENCES teachers (id) ON DELETE SET NULL,
  org_unit_path    TEXT NOT NULL,                          -- /Ogrenciler/9/9-A
  group_id         INTEGER REFERENCES groups (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (academic_year_id, grade, section)
);
CREATE INDEX class_sections_group ON class_sections (group_id);

-- ───────────── Öğrenciler ─────────────

CREATE TABLE students (
  id                   INTEGER PRIMARY KEY,
  -- Güncel okul numarası. Okul mezunların numarasını yeniden verdiği için benzersiz DEĞİL;
  -- yıl içindeki benzersizlik enrollments tablosunda.
  school_no            TEXT NOT NULL,
  national_id_hash     TEXT UNIQUE,                        -- TC'nin HMAC-SHA256 özeti, düz TC saklanmaz
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  gender               TEXT CHECK (gender IN ('F', 'M')),
  class_id             INTEGER REFERENCES class_sections (id) ON DELETE SET NULL, -- bu yılki şube
  graduated_at         TEXT,
  left_at              TEXT,                               -- nakil
  exit_reason          TEXT CHECK (exit_reason IN ('GRADUATED', 'TRANSFERRED')),
  -- Mezuniyet/nakilde settings'teki sürelere göre hesaplanır; gece işi askıya alır / siler
  suspend_at           TEXT,
  delete_at            TEXT,
  suspended_at         TEXT,
  deleted_at           TEXT,
  domain_id            INTEGER NOT NULL REFERENCES domains (id),
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE, -- ad.soyad@ogr.nevzatayazal.k12.tr
  google_user_id       TEXT UNIQUE,
  -- Normalde şube OU'su; aktif kulüp görevi varsa /Kulupler
  org_unit_path        TEXT NOT NULL DEFAULT '/Ogrenciler',
  initial_password_enc TEXT,                               -- AES-GCM ile şifreli ilk şifre
  status               TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  last_synced_at       TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX students_school_no ON students (school_no);
CREATE INDEX students_class ON students (class_id);
CREATE INDEX students_name ON students (last_name, first_name);
CREATE INDEX students_suspend_at ON students (suspend_at) WHERE suspend_at IS NOT NULL;
CREATE INDEX students_delete_at ON students (delete_at) WHERE delete_at IS NOT NULL;

-- Öğrencinin yıllara göre şube geçmişi; sınıflar karılınca eski satır silinmez
CREATE TABLE enrollments (
  id               INTEGER PRIMARY KEY,
  student_id       INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years (id),
  class_id         INTEGER NOT NULL REFERENCES class_sections (id) ON DELETE CASCADE,
  school_no        TEXT NOT NULL,                          -- o yılki okul numarası
  import_batch_id  INTEGER REFERENCES import_batches (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, academic_year_id),
  UNIQUE (academic_year_id, school_no)                     -- aynı yıl içinde numara tek kişide
);
CREATE INDEX enrollments_class ON enrollments (class_id);

-- ───────────── Kulüpler ─────────────

CREATE TABLE clubs (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE COLLATE NOCASE,    -- robotik → robotik@naal.org.tr
  name             TEXT NOT NULL,
  description      TEXT,
  academic_year_id INTEGER REFERENCES academic_years (id),
  advisor_id       INTEGER REFERENCES teachers (id) ON DELETE SET NULL,
  group_id         INTEGER UNIQUE REFERENCES groups (id) ON DELETE SET NULL,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE club_members (
  id         INTEGER PRIMARY KEY,
  club_id    INTEGER NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club_id, student_id)
);

-- Kulüp yönetim kadrosu. Ayrı hesap AÇILMAZ: öğrencinin (ya da öğretmenin) kendi hesabına
-- isim@naal.org.tr takma adı eklenir ve hesap /Kulupler OU'suna taşınır.
-- Görev bitince (ya da mezuniyet/nakilde) takma ad kaldırılır, hesap şube OU'suna döner.
CREATE TABLE club_officers (
  id          INTEGER PRIMARY KEY,
  club_id     INTEGER NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  domain_id   INTEGER NOT NULL REFERENCES domains (id),
  student_id  INTEGER REFERENCES students (id) ON DELETE CASCADE,
  teacher_id  INTEGER REFERENCES teachers (id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'BOARD_MEMBER'
              CHECK (title IN ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'BOARD_MEMBER')),
  alias_email TEXT NOT NULL COLLATE NOCASE,                -- ahmet@naal.org.tr
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((student_id IS NULL) <> (teacher_id IS NULL))     -- ya öğrenci ya öğretmen
);
CREATE INDEX club_officers_club ON club_officers (club_id);
CREATE INDEX club_officers_student ON club_officers (student_id);
-- Görevi biten kişinin adresi sonra başkasına verilebilir; aynı anda iki aktif sahip olamaz
CREATE UNIQUE INDEX club_officers_active_alias ON club_officers (alias_email) WHERE ended_at IS NULL;

-- Grup üyeliği: öğrenci, öğretmen ya da harici e-posta
CREATE TABLE group_members (
  id             INTEGER PRIMARY KEY,
  group_id       INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'MANAGER', 'OWNER')),
  student_id     INTEGER REFERENCES students (id) ON DELETE CASCADE,
  teacher_id     INTEGER REFERENCES teachers (id) ON DELETE CASCADE,
  external_email TEXT,
  member_email   TEXT NOT NULL COLLATE NOCASE,
  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, member_email)
);

-- ───────────── Liste içe aktarma ─────────────

CREATE TABLE import_batches (
  id               INTEGER PRIMARY KEY,
  file_name        TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('students', 'year_transition', 'teachers', 'clubs')),
  parser_id        TEXT,                                   -- eokul-oog01001r020-pdf ...
  academic_year_id INTEGER REFERENCES academic_years (id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'UPLOADED'
                   CHECK (status IN ('UPLOADED', 'PARSED', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED')),
  total_rows       INTEGER NOT NULL DEFAULT 0,
  valid_rows       INTEGER NOT NULL DEFAULT 0,
  error_rows       INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at      TEXT
);

CREATE TABLE import_rows (
  id         INTEGER PRIMARY KEY,
  batch_id   INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw        TEXT NOT NULL CHECK (json_valid(raw)),        -- kaynaktan okunan satır
  parsed     TEXT CHECK (parsed IS NULL OR json_valid(parsed)), -- normalize veri, e-posta önerisi
  status     TEXT NOT NULL
             CHECK (status IN ('VALID', 'INVALID', 'DUPLICATE', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED')),
  message    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX import_rows_batch ON import_rows (batch_id, status);

-- ───────────── Google senkronizasyon kuyruğu ─────────────

-- Google API çağrıları bu kuyruk üzerinden yapılır: kota, yeniden deneme, hata takibi
CREATE TABLE sync_jobs (
  id              INTEGER PRIMARY KEY,
  action          TEXT NOT NULL CHECK (action IN (
                    'CREATE_USER', 'UPDATE_USER', 'SUSPEND_USER', 'DELETE_USER',
                    'CREATE_GROUP', 'UPDATE_GROUP', 'DELETE_GROUP',
                    'ADD_MEMBER', 'REMOVE_MEMBER', 'ADD_ALIAS', 'REMOVE_ALIAS', 'CREATE_ORG_UNIT')),
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  payload         TEXT NOT NULL CHECK (json_valid(payload)),
  status          TEXT NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  import_batch_id INTEGER REFERENCES import_batches (id) ON DELETE SET NULL,
  run_after       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sync_jobs_queue ON sync_jobs (status, run_after);
CREATE INDEX sync_jobs_entity ON sync_jobs (entity_type, entity_id);

-- ───────────── updated_at tetikleyicileri ─────────────

CREATE TRIGGER domains_touch AFTER UPDATE ON domains WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE domains SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER admin_users_touch AFTER UPDATE ON admin_users WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE admin_users SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER teachers_touch AFTER UPDATE ON teachers WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE teachers SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER groups_touch AFTER UPDATE ON groups WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE groups SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER class_sections_touch AFTER UPDATE ON class_sections WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE class_sections SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER students_touch AFTER UPDATE ON students WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE students SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER clubs_touch AFTER UPDATE ON clubs WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE clubs SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER club_officers_touch AFTER UPDATE ON club_officers WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE club_officers SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER sync_jobs_touch AFTER UPDATE ON sync_jobs WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE sync_jobs SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- ───────────── Başlangıç verisi ─────────────

INSERT INTO domains (name, kind, customer_id, admin_impersonate, default_org_unit_path) VALUES
  ('nevzatayazal.k12.tr',     'TEACHER', 'C00grp4u0', 'evan@naal.org.tr', '/Ogretmenler'),
  ('ogr.nevzatayazal.k12.tr', 'STUDENT', 'C00grp4u0', 'evan@naal.org.tr', '/Ogrenciler'),
  ('naal.org.tr',             'CLUB',    'C00grp4u0', 'evan@naal.org.tr', '/Kulupler');

INSERT INTO academic_years (name, starts_at, ends_at, is_current) VALUES
  ('2026-2027', '2026-09-07', '2027-06-25', 1);

-- Hesap saklama süreleri (gün): mezun ve nakil giden için 3 ay sonra askı, 1 yıl sonra silme
INSERT INTO settings (key, value) VALUES
  ('retention.graduated.suspendDays',   '90'),
  ('retention.graduated.deleteDays',    '365'),
  ('retention.transferred.suspendDays', '90'),
  ('retention.transferred.deleteDays',  '365'),
  ('retention.notifyDaysBefore',        '14'),
  ('email.studentStrategy',             '"name"'),
  ('email.clubOfficerStrategy',         '"firstName"');
