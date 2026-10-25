// SQLite bağlantısı (better-sqlite3) ve migration çalıştırıcı.
// Migration'lar db/migrations/NNN_ad.sql; her biri bir kez, sırayla, tek transaction içinde uygulanır.

import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type DB = Database.Database;

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

function dbPath(): string {
  return resolve(process.cwd(), process.env.DATABASE_PATH ?? "./data/app.db");
}

export function openDb(path = dbPath()): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Uygulanmamış migration'ları uygular, uygulananların adlarını döndürür. */
export function migrate(db: DB): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").pluck().all() as string[]);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    })();
    applied.push(file);
  }
  return applied;
}

// Next.js geliştirme modunda modüller yeniden yüklendiği için bağlantı global'de tutulur
const g = globalThis as unknown as { __db?: DB };

/** Uygulamanın paylaşılan bağlantısı; ilk çağrıda bekleyen migration'ları uygular. */
export function getDb(): DB {
  if (!g.__db) {
    const db = openDb();
    migrate(db);
    g.__db = db;
  }
  return g.__db;
}

/** SQLite'ın datetime('now') biçimi: 'YYYY-MM-DD HH:MM:SS' (UTC) */
export function sqlDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
