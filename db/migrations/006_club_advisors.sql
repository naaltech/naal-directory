-- Kulüp danışman öğretmenleri. Bir kulübün birden fazla danışmanı olabilir; görev bitince kayıt geçmiş için kalır.
-- Danışman, kulüp grubuna Yönetici (MANAGER) olarak eklenir. clubs.advisor_id kullanılmıyordu; varsa buraya taşınır.
CREATE TABLE club_advisors (
  id         INTEGER PRIMARY KEY,
  club_id    INTEGER NOT NULL REFERENCES clubs (id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES teachers (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

-- Aynı öğretmen aynı kulüpte aynı anda tek aktif danışmanlık
CREATE UNIQUE INDEX club_advisors_active ON club_advisors (club_id, teacher_id) WHERE ended_at IS NULL;
CREATE INDEX club_advisors_teacher ON club_advisors (teacher_id);

INSERT INTO club_advisors (club_id, teacher_id)
SELECT id, advisor_id FROM clubs WHERE advisor_id IS NOT NULL AND is_active = 1;
UPDATE clubs SET advisor_id = NULL;
