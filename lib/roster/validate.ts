// Çözümleyiciden bağımsız doğrulama: her biçim için aynı kurallar çalışır.

import type { ParsedRoster, RosterIssue } from "./types.ts";

export function validateRoster(roster: ParsedRoster): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const seenSections = new Map<string, string>();
  const seenNo = new Map<string, string>();

  for (const sec of roster.sections) {
    const name = `${sec.grade}-${sec.section}`;
    const source = `${name} (${sec.source})`;

    if (seenSections.has(name)) {
      issues.push({ level: "error", source, message: `${name} şubesi iki kez var (ilki: ${seenSections.get(name)})` });
    }
    seenSections.set(name, sec.source);

    const { expected } = sec;
    const female = sec.students.filter((s) => s.gender === "F").length;
    const male = sec.students.filter((s) => s.gender === "M").length;
    if (expected?.total != null && expected.total !== sec.students.length) {
      issues.push({ level: "error", source, message: `Toplam ${expected.total} yazıyor, ${sec.students.length} öğrenci okundu` });
    }
    if (expected?.female != null && expected.female !== female) {
      issues.push({ level: "warning", source, message: `Kız sayısı ${expected.female} yazıyor, ${female} okundu` });
    }
    if (expected?.male != null && expected.male !== male) {
      issues.push({ level: "warning", source, message: `Erkek sayısı ${expected.male} yazıyor, ${male} okundu` });
    }

    sec.students.forEach((s, i) => {
      if (s.rowNo !== i + 1) {
        issues.push({ level: "warning", source, message: `Sıra numarası atlıyor: ${i + 1} beklenirken ${s.rowNo}` });
      }
      if (!s.firstName || !s.lastName) {
        issues.push({ level: "error", source, message: `No ${s.schoolNo}: ad veya soyad boş` });
      }
      if (!s.gender) issues.push({ level: "warning", source, message: `No ${s.schoolNo}: cinsiyet okunamadı` });
      const prev = seenNo.get(s.schoolNo);
      if (prev) issues.push({ level: "error", source, message: `Okul no ${s.schoolNo} iki kez geçiyor (ilki: ${prev})` });
      seenNo.set(s.schoolNo, name);
    });
  }

  if (roster.sections.length === 0) issues.push({ level: "error", message: "Dosyada hiç şube bulunamadı" });
  return issues;
}
