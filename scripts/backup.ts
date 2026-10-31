// Veritabanının tutarlı bir kopyasını alır (panel çalışırken de güvenli; WAL dahil).
//
//   npm run backup                    ./backups/app-YYYYMMDD-HHMM.db, 30 günden eski yedekler silinir
//   npm run backup -- --dir /yedek --keep 60
//
// Yedekte öğrenci bilgileri ve şifrelenmiş ilk şifreler var: klasör sadece sahibine açık (700) oluşturulur.
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEnv } from "./env.ts";
import { openDb } from "../lib/db.ts";

loadEnv();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dir = resolve(arg("--dir") ?? "backups");
const keepDays = Number(arg("--keep") ?? 30);
if (!Number.isFinite(keepDays) || keepDays < 1) throw new Error("--keep en az 1 gün olmalı");

mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const file = join(dir, `app-${stamp}.db`);

const db = openDb();
await db.backup(file);
db.close();
chmodSync(file, 0o600);

// Bozuk yedek sessizce saklanmasın, sunucu dışına da gönderilmesin
const copy = openDb(file);
const integrity = copy.pragma("integrity_check", { simple: true });
copy.close();
if (integrity !== "ok") {
  unlinkSync(file);
  throw new Error(`Yedek bozuk, silindi: ${integrity}`);
}
console.log(`Yedek: ${file}`);

const cutoff = Date.now() - keepDays * 86_400_000;
for (const name of readdirSync(dir)) {
  if (!/^app-\d{8}-\d{4}\.db$/.test(name)) continue;
  const path = join(dir, name);
  if (statSync(path).mtimeMs < cutoff) {
    unlinkSync(path);
    console.log(`Silindi (eski): ${name}`);
  }
}
