-- Etkinlikler dizinde kulüp gibi yönetilir (grup, üyeler, görevliler) ama sitede kulüp olarak görünmez.
ALTER TABLE clubs ADD COLUMN is_event INTEGER NOT NULL DEFAULT 0 CHECK (is_event IN (0, 1));
UPDATE clubs SET is_event = 1 WHERE code IN ('meclis', 'hack', 'fbc');
