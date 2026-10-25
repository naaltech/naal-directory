// Google kullanıcılarını toplu siler.
//
// VARSAYILAN OLARAK HİÇBİR ŞEY SİLMEZ: sadece silinecekleri listeler (deneme modu).
// Gerçekten silmek için --yes verin; betik ayrıca ekranda onay metni yazmanızı ister.
//
// Örnekler:
//   node scripts/google-delete-users.mjs                         # deneme: herkes (korunanlar hariç)
//   node scripts/google-delete-users.mjs --ou /Student           # deneme: sadece /Student ve altı
//   node scripts/google-delete-users.mjs --ou /Student --yes     # /Student'ı gerçekten sil
//   node scripts/google-delete-users.mjs --keep a@x.com,b@x.com  # ek korunacak hesaplar
//
// Korunan hesaplar: erdem@nevzatayazal.k12.tr ve .env'deki GOOGLE_ADMIN_IMPERSONATE
// (betik o hesap adına çalışıyor; silinirse işlem yarıda kalır ve sistem bağlantısı kopar).
//
// Silinen hesaplar Admin Console'dan 20 gün içinde geri getirilebilir, sonra kalıcıdır.
// Her çalıştırmada önce tüm hesapların yedeği exports/ klasörüne yazılır.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { env, getApi } from "./google-auth.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const execute = flag("--yes");
const ouFilter = option("--ou");
const keep = new Set(
  ["erdem@nevzatayazal.k12.tr", env.GOOGLE_ADMIN_IMPERSONATE, ...(option("--keep")?.split(",") ?? [])]
    .filter(Boolean)
    .map((e) => e.trim().toLowerCase()),
);

const api = await getApi();

// ── Tüm kullanıcıları oku ──
const users = [];
let pageToken;
do {
  const page = await api(
    `users?customer=my_customer&maxResults=500&fields=nextPageToken,users(id,primaryEmail,name/fullName,orgUnitPath,isAdmin,lastLoginTime)` +
      (pageToken ? `&pageToken=${pageToken}` : ""),
  );
  users.push(...(page.users ?? []));
  pageToken = page.nextPageToken;
} while (pageToken);

const inOu = (u) => !ouFilter || u.orgUnitPath === ouFilter || u.orgUnitPath.startsWith(ouFilter + "/");
const targets = users.filter((u) => inOu(u) && !keep.has(u.primaryEmail.toLowerCase()));
const kept = users.filter((u) => keep.has(u.primaryEmail.toLowerCase()));

// ── Yedek ──
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync("exports", { recursive: true });
const csvRow = (r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
writeFileSync(
  `exports/backup-before-delete-${stamp}.csv`,
  "﻿" + [csvRow(["email", "ad", "ou", "superAdmin", "sonGiris"]),
    ...users.map((u) => csvRow([u.primaryEmail, u.name?.fullName, u.orgUnitPath, u.isAdmin, u.lastLoginTime]))].join("\n"),
);

// ── Özet ──
const byOu = targets.reduce((m, u) => ((m[u.orgUnitPath] = (m[u.orgUnitPath] ?? 0) + 1), m), {});
console.log(`Toplam hesap: ${users.length}`);
console.log(`Filtre: ${ouFilter ?? "(tüm OU'lar)"}`);
console.log(`\nKORUNACAK (${kept.length}):`);
for (const u of kept) console.log(`  ✓ ${u.primaryEmail}`);
for (const e of keep) if (!users.some((u) => u.primaryEmail.toLowerCase() === e)) console.log(`  ? ${e} (Google'da bulunamadı)`);
console.log(`\nSİLİNECEK (${targets.length}):`);
for (const [ou, n] of Object.entries(byOu).sort()) console.log(`  ${ou.padEnd(24)} ${n}`);
const admins = targets.filter((u) => u.isAdmin);
if (admins.length) {
  console.log(`\n⚠ Silinecek süper adminler (${admins.length}):`);
  for (const u of admins) console.log(`  ${u.primaryEmail}`);
}
console.log(`\nYedek: exports/backup-before-delete-${stamp}.csv`);

if (!execute) {
  console.log("\nDENEME MODU: hiçbir şey silinmedi. Silmek için komutun sonuna --yes ekleyin.");
  process.exit(0);
}
if (targets.length === 0) {
  console.log("\nSilinecek hesap yok.");
  process.exit(0);
}

// ── Onay ──
const expected = `SIL ${targets.length}`;
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`\n${targets.length} hesap SİLİNECEK. Onaylamak için tam olarak "${expected}" yazın: `);
rl.close();
if (answer.trim() !== expected) {
  console.log("Onay metni eşleşmedi, iptal edildi. Hiçbir şey silinmedi.");
  process.exit(1);
}

// ── Silme ──
const log = `exports/deleted-${stamp}.csv`;
writeFileSync(log, "﻿" + csvRow(["email", "sonuc", "hata"]) + "\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function deleteWithRetry(u) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await api(`users/${u.id}`, { method: "DELETE" });
      return null;
    } catch (e) {
      const msg = String(e.message);
      const retryable = /\b(429|500|503)\b|rate|quota|backend/i.test(msg);
      if (!retryable || attempt === 5) return msg;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

let ok = 0, failed = 0;
const CONCURRENCY = 5;
const queue = [...targets];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const u = queue.shift();
      const err = await deleteWithRetry(u);
      if (err) failed++;
      else ok++;
      appendFileSync(log, csvRow([u.primaryEmail, err ? "HATA" : "silindi", err]) + "\n");
      process.stdout.write(`\r  silindi: ${ok}  hata: ${failed}  kalan: ${queue.length}   `);
      await sleep(100); // Google kotasını zorlamamak için
    }
  }),
);

console.log(`\n\nBitti. Silinen: ${ok}, hata: ${failed}`);
console.log(`Ayrıntı: ${log}`);
if (failed) console.log("Hatalı olanlar için betiği tekrar çalıştırabilirsiniz; silinenler listede çıkmaz.");
