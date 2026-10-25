// Mezun/nakil öğrenci ve ayrılan öğretmen hesaplarından askı ya da silme vadesi gelenleri kuyruğa alır.
//
//   npm run retention            deneme: kimlerin askıya alınacağını / silineceğini listeler
//   npm run retention -- --yes   kuyruğa alır (sonra: npm run sync -- --yes)
//
// Günlük zamanlanmış görev için: npm run retention -- --yes && npm run sync -- --yes

import { loadEnv } from "./env.ts";
import { migrate, openDb } from "../lib/db.ts";
import { dueRetention, enqueueRetention } from "../lib/retention.ts";

loadEnv();
const db = openDb();
migrate(db);

const plan = dueRetention(db);
const live = process.argv.includes("--yes");
const fmt = (d: string) => d.slice(0, 10);

console.log(`Askıya alınacak: ${plan.suspend.length}`);
for (const s of plan.suspend) console.log(`  ${s.email}  (${s.reason}, vade ${fmt(s.due)})`);
console.log(`Silinecek: ${plan.remove.length}`);
for (const s of plan.remove) console.log(`  ${s.email}  (${s.reason}, vade ${fmt(s.due)})`);

if (!live) {
  if (plan.suspend.length + plan.remove.length) console.log("\nDENEME: hiçbir şey kuyruğa alınmadı. Almak için: npm run retention -- --yes");
} else {
  const n = enqueueRetention(db, plan);
  console.log(`\n${n} iş kuyruğa alındı. Google'a göndermek için: npm run sync -- --yes`);
}
db.close();
