// settings tablosundaki JSON değerleri.

import type { DB } from "./db.ts";

export function readSetting<T>(db: DB, key: string): T | undefined {
  const value = db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key) as string | undefined;
  return value === undefined ? undefined : (JSON.parse(value) as T);
}

export function writeSetting(db: DB, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(key, JSON.stringify(value));
}

export function removeSetting(db: DB, key: string) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
