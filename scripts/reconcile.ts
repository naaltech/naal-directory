// Google ile veritabanını karşılaştırır (sadece okur), sonucu panelin Senkronizasyon sayfasına yazar.
//
//   npm run reconcile

import { loadEnv } from "./env.ts";
import { migrate, openDb } from "../lib/db.ts";
import { isGoogleConfigured } from "../lib/google/api.ts";
import { runReconcile } from "../lib/reconcile.ts";

loadEnv();
if (!isGoogleConfigured()) throw new Error("Google ayarları eksik (.env).");

const db = openDb();
migrate(db);
const report = await runReconcile(db);
db.close();

console.log(`${report.total} fark bulundu.`);
for (const [kind, n] of Object.entries(report.counts)) if (n) console.log(`  ${kind.padEnd(16)} ${n}`);
