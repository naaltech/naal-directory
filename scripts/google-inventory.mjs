// Google'daki tüm kullanıcı ve grupların dökümü: sadece okur.
// Çıktı: exports/users-<tarih>.csv, exports/groups-<tarih>.csv
// Kullanım: node scripts/google-inventory.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { getApi } from "./google-auth.mjs";

const api = await getApi();

async function listAll(path, key) {
  const out = [];
  let pageToken;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await api(`${path}${sep}maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`);
    out.push(...(page[key] ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

const users = await listAll(
  "users?customer=my_customer&fields=nextPageToken,users(primaryEmail,name/fullName,orgUnitPath,isAdmin,isDelegatedAdmin,suspended,creationTime,lastLoginTime)",
  "users",
);
const groups = await listAll("groups?customer=my_customer&fields=nextPageToken,groups(email,name,directMembersCount)", "groups");

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
const stamp = new Date().toISOString().slice(0, 10);
mkdirSync("exports", { recursive: true });
writeFileSync(
  `exports/users-${stamp}.csv`,
  "﻿" + csv([
    ["email", "ad", "ou", "superAdmin", "delegeAdmin", "askida", "olusturma", "sonGiris"],
    ...users.map((u) => [u.primaryEmail, u.name?.fullName, u.orgUnitPath, u.isAdmin, u.isDelegatedAdmin, u.suspended, u.creationTime, u.lastLoginTime]),
  ]),
);
writeFileSync(
  `exports/groups-${stamp}.csv`,
  "﻿" + csv([["email", "ad", "uyeSayisi"], ...groups.map((g) => [g.email, g.name, g.directMembersCount])]),
);

const count = (arr, f) => Object.entries(arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort();
console.log(`Toplam kullanıcı: ${users.length}`);
console.log("\nOU'ya göre:");
for (const [k, v] of count(users, (u) => u.orgUnitPath)) console.log(`  ${k.padEnd(24)} ${v}`);
console.log("\nAlan adına göre:");
for (const [k, v] of count(users, (u) => u.primaryEmail.split("@")[1])) console.log(`  ${k.padEnd(28)} ${v}`);
const recent = users.filter((u) => u.lastLoginTime && Date.now() - Date.parse(u.lastLoginTime) < 30 * 864e5).length;
console.log(`\nSon 30 günde giriş yapan: ${recent}`);
console.log(`Askıdaki: ${users.filter((u) => u.suspended).length}`);
console.log("\nAdminler:");
for (const u of users.filter((u) => u.isAdmin || u.isDelegatedAdmin)) {
  console.log(`  ${u.primaryEmail}  ${u.isAdmin ? "süper admin" : "delege admin"}`);
}
console.log(`\nToplam grup: ${groups.length}`);
console.log(`\nDökümler: exports/users-${stamp}.csv, exports/groups-${stamp}.csv`);
