-- Eğitim yılı listeden belirlenir, öğretmen hesapları, grup güncelleme/silme ve boş OU temizliği.

-- ───────────── Kuyruk: DELETE_ORG_UNIT ─────────────
-- SQLite CHECK kısıtını değiştiremediği için tablo yeniden kurulur (veriler korunur).
CREATE TABLE sync_jobs_new (
  id              INTEGER PRIMARY KEY,
  action          TEXT NOT NULL CHECK (action IN (
                    'CREATE_USER', 'UPDATE_USER', 'SUSPEND_USER', 'DELETE_USER',
                    'CREATE_GROUP', 'UPDATE_GROUP', 'DELETE_GROUP',
                    'ADD_MEMBER', 'REMOVE_MEMBER', 'ADD_ALIAS', 'REMOVE_ALIAS',
                    'CREATE_ORG_UNIT', 'DELETE_ORG_UNIT')),
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
INSERT INTO sync_jobs_new SELECT * FROM sync_jobs;
DROP TABLE sync_jobs;
ALTER TABLE sync_jobs_new RENAME TO sync_jobs;
CREATE INDEX sync_jobs_queue ON sync_jobs (status, run_after);
CREATE INDEX sync_jobs_entity ON sync_jobs (entity_type, entity_id);
CREATE INDEX sync_jobs_payload_email ON sync_jobs (json_extract(payload, '$.email'));
CREATE TRIGGER sync_jobs_touch AFTER UPDATE ON sync_jobs WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE sync_jobs SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- ───────────── Öğretmenler ─────────────
-- Ayrılan öğretmen (tayin, emeklilik): öğrencilerdeki gibi süre sonunda askı ve silme.
ALTER TABLE teachers ADD COLUMN initial_password_enc TEXT;
ALTER TABLE teachers ADD COLUMN left_at TEXT;
ALTER TABLE teachers ADD COLUMN suspend_at TEXT;
ALTER TABLE teachers ADD COLUMN delete_at TEXT;
ALTER TABLE teachers ADD COLUMN suspended_at TEXT;
ALTER TABLE teachers ADD COLUMN deleted_at TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('retention.teacher.suspendDays', '90'),
  ('retention.teacher.deleteDays',  '365');
