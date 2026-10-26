-- Öğretmen grupları (idareciler, rehberlik, zümreler ...) ve grup alt adresleri.
-- Öğretmen grupları groups tablosunda kind = 'CUSTOM' olarak tutulur; üyeleri öğretmenlerdir.

-- Öğretmen grubu kurum dışından e-posta alabilsin mi (kulüp gruplarında her zaman açık)
ALTER TABLE groups ADD COLUMN allow_external INTEGER NOT NULL DEFAULT 0 CHECK (allow_external IN (0, 1));

-- Grubun alt adresleri (Google'da grup takma adı). Adres nevzatayazal.k12.tr ya da naal.org.tr'de olabilir;
-- alt adrese gelen e-posta gruba düşer. Kaldırılan adres geçmiş için kalır ve sonra başka gruba verilebilir.
CREATE TABLE group_aliases (
  id          INTEGER PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  domain_id   INTEGER NOT NULL REFERENCES domains (id),
  alias_email TEXT NOT NULL COLLATE NOCASE,
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED', 'ERROR')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT
);
CREATE INDEX group_aliases_group ON group_aliases (group_id);
CREATE UNIQUE INDEX group_aliases_active ON group_aliases (alias_email) WHERE removed_at IS NULL;
