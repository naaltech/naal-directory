// e-Okul "Sınıf Listesi" raporu (rapor kodu OOG01001R020), PDF.
// Her sayfa bir şube:
//   AL - 9. Sınıf / A Şubesi (ALANI YOK) Sınıf Listesi
//   Sınıf Öğretmeni: ...            Sınıf Başkanı: ...
//   Sınıf Müdür Yrd: ...            Sınıf Başkan Yrd: ...
//   S.No | Öğrenci No | Adı | Soyadı | Cinsiyeti | Pansiyon Durum
//   ...
//   Kız Öğrenci Sayısı: 18  Erkek Öğrenci Sayısı: 13  Toplam Öğrenci Sayısı: 31
// Sınıf 40+ kişiyse liste sonraki sayfaya taşabilir; başlıksız sayfa önceki şubeye eklenir.
// Rapor biçimi değişirse bu dosya güncellenir ya da yanına yeni bir çözümleyici yazılır.

import { findColumns, splitByColumns, toLines, type Line } from "../layout.ts";
import { extractPdfText, isPdf } from "../pdf-text.ts";
import type { Gender, ParsedRoster, RosterFile, RosterIssue, RosterParser, RosterSection } from "../types.ts";

const REPORT_CODE = "OOG01001R020";

const SECTION_RE = /(\d+|Hazırlık)\.?\s*Sınıf\s*\/\s*([A-ZÇĞİÖŞÜ0-9]+?)\s*Şubesi\s*(?:\(([^)]*)\))?/iu;
const ADVISOR_RE = /Sınıf Öğretmeni\s*:\s*(.*?)\s*Sınıf Başkanı\s*:\s*(.*)$/u;
const DEPUTY_RE = /Sınıf Müdür Yrd\s*:\s*(.*?)\s*Sınıf Başkan Yrd\s*:\s*(.*)$/u;
const TOTALS_RE = /Kız Öğrenci Sayısı\s*:\s*(\d+).*?Erkek Öğrenci Sayısı\s*:\s*(\d+).*?Toplam Öğrenci Sayısı\s*:\s*(\d+)/su;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;

const COLUMNS = {
  rowNo: "S.No",
  schoolNo: "Öğrenci No",
  firstName: "Adı",
  lastName: "Soyadı",
  gender: "Cinsiyeti",
} as const;

const clean = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() || undefined;

function parseGender(s: string): Gender | undefined {
  const v = s.toLocaleLowerCase("tr-TR");
  if (v.startsWith("kız") || v.startsWith("kiz")) return "F";
  if (v.startsWith("erkek")) return "M";
  return undefined;
}

function parsePage(lines: Line[], pageNo: number, issues: RosterIssue[]) {
  const source = `sayfa ${pageNo}`;
  const all = lines.map((l) => l.text).join("\n");

  const sec = lines.map((l) => l.text.match(SECTION_RE)).find(Boolean);
  const adv = lines.map((l) => l.text.match(ADVISOR_RE)).find(Boolean);
  const dep = lines.map((l) => l.text.match(DEPUTY_RE)).find(Boolean);
  const tot = all.match(TOTALS_RE);

  const headerIdx = lines.findIndex((l) => findColumns(l, COLUMNS));
  const students: RosterSection["students"] = [];
  if (headerIdx >= 0) {
    const cols = findColumns(lines[headerIdx], COLUMNS)!;
    for (const line of lines.slice(headerIdx + 1)) {
      if (TOTALS_RE.test(line.text) || /Öğrenci Sayısı/u.test(line.text)) break;
      const row = splitByColumns(line, cols);
      if (!/^\d+$/.test(row.rowNo)) continue;
      if (!/^\d+$/.test(row.schoolNo)) {
        issues.push({ level: "error", source, message: `Sıra ${row.rowNo}: okul numarası okunamadı ("${row.schoolNo}")` });
        continue;
      }
      students.push({
        rowNo: Number(row.rowNo),
        schoolNo: row.schoolNo,
        firstName: clean(row.firstName) ?? "",
        lastName: clean(row.lastName) ?? "",
        gender: parseGender(row.gender),
      });
    }
  }

  return {
    source,
    section: sec
      ? {
          grade: /hazırlık/iu.test(sec[1]) ? 0 : Number(sec[1]),
          section: sec[2].toLocaleUpperCase("tr-TR"),
          field: clean(sec[3]),
        }
      : undefined,
    advisorName: clean(adv?.[1]),
    presidentName: clean(adv?.[2]),
    deputyPrincipalName: clean(dep?.[1]),
    vicePresidentName: clean(dep?.[2]),
    expected: tot ? { female: Number(tot[1]), male: Number(tot[2]), total: Number(tot[3]) } : undefined,
    students,
    hasTable: headerIdx >= 0,
  };
}

export const eokulSinifListesiPdf: RosterParser = {
  id: "eokul-oog01001r020-pdf",
  label: "e-Okul Sınıf Listesi (OOG01001R020, PDF)",

  async detect(file: RosterFile) {
    if (!isPdf(file.bytes)) return 0;
    const pages = await extractPdfText(file.bytes);
    const first = toLines(pages[0] ?? []).map((l) => l.text).join("\n");
    if (first.includes(REPORT_CODE)) return 1;
    if (SECTION_RE.test(first) && /Öğrenci No/u.test(first)) return 0.6;
    return 0;
  },

  async parse(file: RosterFile): Promise<ParsedRoster> {
    const pages = await extractPdfText(file.bytes);
    const issues: RosterIssue[] = [];
    const sections: RosterSection[] = [];
    let schoolName: string | undefined;
    let reportDate: Date | undefined;

    pages.forEach((items, i) => {
      const lines = toLines(items);
      const page = parsePage(lines, i + 1, issues);

      if (!schoolName) schoolName = clean(lines.find((l) => /Müdürlüğü$/u.test(l.text))?.text);
      if (!reportDate) {
        const d = lines.map((l) => l.text.match(DATE_RE)).find(Boolean);
        if (d) reportDate = new Date(Number(d[3]), Number(d[2]) - 1, Number(d[1]));
      }

      if (page.section) {
        sections.push({
          ...page.section,
          advisorName: page.advisorName,
          presidentName: page.presidentName,
          vicePresidentName: page.vicePresidentName,
          deputyPrincipalName: page.deputyPrincipalName,
          students: page.students,
          expected: page.expected,
          source: page.source,
        });
      } else if (page.hasTable && sections.length) {
        // Önceki şubenin devam sayfası
        const prev = sections.at(-1)!;
        prev.students.push(...page.students);
        prev.expected = page.expected ?? prev.expected;
        prev.source += `, ${page.source}`;
      } else if (page.students.length || page.hasTable) {
        issues.push({ level: "error", source: page.source, message: "Şube başlığı bulunamadı, sayfa atlandı" });
      }
    });

    return { parserId: this.id, schoolName, reportDate, sections, issues };
  },
};
