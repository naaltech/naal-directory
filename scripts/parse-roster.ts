// Okul listesini çözümleyip özet ve sorunları yazdırır. Google'a ve veritabanına dokunmaz.
// Kullanım: npm run roster:parse -- "<dosya.pdf>" [--json cikti.json]
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseRoster } from "../lib/roster/index.ts";

const [file, flag, out] = process.argv.slice(2);
if (!file) {
  console.error('Kullanım: npm run roster:parse -- "<dosya.pdf>" [--json cikti.json]');
  process.exit(1);
}

const roster = await parseRoster({ name: basename(file), bytes: new Uint8Array(readFileSync(file)) });

console.log(`Biçim: ${roster.parserId}`);
console.log(`Okul: ${roster.schoolName ?? "-"}`);
console.log(`Rapor tarihi: ${roster.reportDate?.toLocaleDateString("tr-TR") ?? "-"}`);
console.log(`\nŞube  Öğrenci  Beklenen  Kız/Erkek  Sınıf öğretmeni`);
for (const s of roster.sections) {
  const f = s.students.filter((x) => x.gender === "F").length;
  const m = s.students.filter((x) => x.gender === "M").length;
  const ok = s.expected?.total === s.students.length ? "✓" : "✗";
  console.log(
    `${`${s.grade}-${s.section}`.padEnd(6)}${String(s.students.length).padStart(7)}  ${ok} ${String(s.expected?.total ?? "?").padEnd(7)}${`${f}/${m}`.padEnd(11)}${s.advisorName ?? "-"}`,
  );
}
const total = roster.sections.reduce((n, s) => n + s.students.length, 0);
console.log(`\nToplam: ${roster.sections.length} şube, ${total} öğrenci`);

const errors = roster.issues.filter((i) => i.level === "error");
const warnings = roster.issues.filter((i) => i.level === "warning");
console.log(`Hata: ${errors.length}, uyarı: ${warnings.length}`);
for (const i of roster.issues) console.log(`  ${i.level === "error" ? "✗" : "!"} ${i.source ? `[${i.source}] ` : ""}${i.message}`);

if (flag === "--json" && out) {
  writeFileSync(out, JSON.stringify(roster, null, 2));
  console.log(`\nJSON: ${out}`);
}
