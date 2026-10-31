-- Yönetim paneli (admin.naal.org.tr) köprüsü ve yıllık döngü.

-- Dergi editörleri. Yetki kişinin okul durumuna bağlıdır: kayıt kalsa da okuldan ayrılan kişinin rolü gönderilmez.
CREATE TABLE club_editors (
  id         INTEGER PRIMARY KEY,
  club_id    INTEGER NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  email      TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (club_id, email)
);

-- İlk şifrenin yazıldığı an: süresi dolan şifreler gece işinde silinir. Mevcut şifreler bugünden sayılır.
ALTER TABLE students ADD COLUMN password_set_at TEXT;
ALTER TABLE teachers ADD COLUMN password_set_at TEXT;
UPDATE students SET password_set_at = datetime('now') WHERE initial_password_enc IS NOT NULL;
UPDATE teachers SET password_set_at = datetime('now') WHERE initial_password_enc IS NOT NULL;

CREATE TRIGGER students_password_insert AFTER INSERT ON students WHEN NEW.initial_password_enc IS NOT NULL
BEGIN UPDATE students SET password_set_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER students_password_update AFTER UPDATE OF initial_password_enc ON students
  WHEN NEW.initial_password_enc IS NOT NULL AND NEW.initial_password_enc IS NOT OLD.initial_password_enc
BEGIN UPDATE students SET password_set_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER teachers_password_insert AFTER INSERT ON teachers WHEN NEW.initial_password_enc IS NOT NULL
BEGIN UPDATE teachers SET password_set_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER teachers_password_update AFTER UPDATE OF initial_password_enc ON teachers
  WHEN NEW.initial_password_enc IS NOT NULL AND NEW.initial_password_enc IS NOT OLD.initial_password_enc
BEGIN UPDATE teachers SET password_set_at = datetime('now') WHERE id = NEW.id; END;
