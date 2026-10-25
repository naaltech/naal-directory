// Yeni listedeki satırı mevcut öğrenciyle eşleştirme.
// Okul mezunların numarasını yeniden dağıttığı için numara tek başına yeterli değil:
// TC özeti varsa o kesin anahtardır, yoksa numara + isim + sınıf birlikte bakılır.
//
// Listeler arka arkaya yıllardan olmak zorunda değil (2023 listesinden sonra 2026 listesi):
// öğrencinin son kayıtlı olduğu yıldan bu yana geçen yıl kadar sınıf atlamış olabilir.
// Aynı yılın listesi tekrar yüklenirse sınıf seviyesi değişmemeli.

import { createHmac } from "node:crypto";
import { asciiFold } from "./email.ts";

export interface ImportedStudent {
  schoolNo: string;
  firstName: string;
  lastName: string;
  grade: number;
  nationalIdHash?: string;
}

export interface ExistingStudent {
  id: number;
  schoolNo: string;
  firstName: string;
  lastName: string;
  /** Son kayıtlı olduğu yıldaki sınıf seviyesi */
  grade: number | null;
  /** Son kayıtlı olduğu eğitim yılının başlangıç yılı (2023-2024 → 2023) */
  lastYear: number | null;
  nationalIdHash?: string | null;
  /** Mezun/nakil olarak işaretli (hesabı silinmemiş) */
  exited?: boolean;
}

export interface MatchContext {
  /** Listenin eğitim yılı (başlangıç yılı) */
  targetYear: number;
  /** Okulda görünen öğrenciler */
  active: ExistingStudent[];
  /** Mezun/nakil işaretli ama hesabı duran öğrenciler (geri dönüş) */
  exited: ExistingStudent[];
  /** Bu listedeki bütün okul numaraları */
  listNumbers: Set<string>;
}

export type MatchResult =
  | { kind: "matched"; studentId: number; warnings: string[]; returning?: boolean }
  | { kind: "new"; warnings: string[] }
  /** Otomatik karar verilemez, önizlemede kullanıcıya sorulur. */
  | { kind: "conflict"; studentId: number; reason: string };

export function hashNationalId(tc: string, key: string): string {
  return createHmac("sha256", key).update(tc.replace(/\D/g, "")).digest("hex");
}

const norm = (s: string) => asciiFold(s).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

type NameMatch = "same" | "similar" | "different";

/** "same": birebir aynı; "similar": yazım düzeltmesi/ikinci isim farkı olabilir */
export function compareNames(a: { firstName: string; lastName: string }, b: { firstName: string; lastName: string }): NameMatch {
  const fa = norm(a.firstName), la = norm(a.lastName);
  const fb = norm(b.firstName), lb = norm(b.lastName);
  if (fa === fb && la === lb) return "same";
  const firstTokenSame = fa.split(" ")[0] === fb.split(" ")[0];
  if (la === lb && (firstTokenSame || levenshtein(fa, fb) <= 2)) return "similar";
  if (fa === fb && levenshtein(la, lb) <= 2) return "similar";
  return "different";
}

/** Son listeden bu yana geçen yıl sayısı; bilinmiyorsa null */
function gapOf(s: ExistingStudent, targetYear: number): number | null {
  return s.lastYear == null ? null : targetYear - s.lastYear;
}

/** Sınıf seviyesi bu aralıkta olabilir mi: her yıl en fazla bir sınıf (tekrar mümkün) */
export function gradeFits(s: ExistingStudent, grade: number, targetYear: number): boolean {
  const gap = gapOf(s, targetYear);
  if (s.grade == null || gap == null) return true;
  if (gap < 0) return false;
  if (gap === 0) return grade === s.grade;
  return grade >= s.grade && grade <= s.grade + gap;
}

const who = (s: ExistingStudent) =>
  `${s.firstName} ${s.lastName}${s.grade != null && s.lastYear != null ? ` (${s.lastYear}-${s.lastYear + 1}, ${s.grade}. sınıf)` : ""}`;

export function matchStudent(row: ImportedStudent, ctx: MatchContext): MatchResult {
  const { targetYear, active, exited, listNumbers } = ctx;

  // 1) TC özeti varsa kesin karar
  if (row.nationalIdHash) {
    const byTc = [...active, ...exited].find((s) => s.nationalIdHash === row.nationalIdHash);
    if (byTc) {
      const warnings: string[] = [];
      if (byTc.schoolNo !== row.schoolNo) warnings.push(`Okul numarası değişmiş: ${byTc.schoolNo} → ${row.schoolNo}`);
      if (compareNames(row, byTc) !== "same") warnings.push(`İsim değişmiş: ${byTc.firstName} ${byTc.lastName} → ${row.firstName} ${row.lastName}`);
      if (byTc.exited) warnings.push("Ayrılmış olarak işaretliydi; okula geri dönüş olarak alınacak");
      return { kind: "matched", studentId: byTc.id, warnings, returning: byTc.exited || undefined };
    }
  }

  // 2) Numara + isim + sınıf
  const byNo = active.find((s) => s.schoolNo === row.schoolNo);
  const reused: string[] = [];
  if (byNo) {
    const names = compareNames(row, byNo);
    const fits = gradeFits(byNo, row.grade, targetYear);
    const gap = gapOf(byNo, targetYear);
    if (names !== "different" && fits) {
      const warnings = names === "similar" ? [`İsim farklı yazılmış: ${byNo.firstName} ${byNo.lastName} → ${row.firstName} ${row.lastName}`] : [];
      return { kind: "matched", studentId: byNo.id, warnings };
    }
    if (names !== "different") {
      return {
        kind: "conflict",
        studentId: byNo.id,
        reason: `Sınıf seviyesi uyuşmuyor: ${who(byNo)}, bu listede ${row.grade}. sınıf. Aynı öğrenci mi?`,
      };
    }
    // Farklı isim: aynı yılın listesinde bu olmaz (numara yıl içinde başkasına verilmez)
    if (gap === 0 || gap == null) {
      return {
        kind: "conflict",
        studentId: byNo.id,
        reason: `Numara ${row.schoolNo} bu yıl ${who(byNo)} öğrencisinde. Yeni öğrenci mi, isim mi değişti?`,
      };
    }
    // Önceki yıldan biri: numara mezun/nakil sonrası yeniden verilmiş
    reused.push(`Numara ${row.schoolNo} daha önce ${who(byNo)} öğrencisindeydi; yeni öğrenci olarak alındı`);
  }

  // 3) Numarası değişmiş olabilir: aynı isimde, sınıfı uyan, numarası bu listede olmayan öğrenci
  const sameName = active.filter(
    (s) => s !== byNo && !listNumbers.has(s.schoolNo) && compareNames(row, s) === "same" && gradeFits(s, row.grade, targetYear),
  );
  if (sameName.length === 1) {
    return {
      kind: "conflict",
      studentId: sameName[0].id,
      reason: `Aynı isimde öğrenci ${sameName[0].schoolNo} numarasıyla kayıtlı: ${who(sameName[0])}. Numarası mı değişti, yoksa yeni öğrenci mi?`,
    };
  }
  if (sameName.length > 1) {
    reused.push(`Aynı isimde ${sameName.length} kayıtlı öğrenci var (numaraları bu listede yok); kontrol edin`);
  }

  // 4) Okula geri dönen: ayrılmış işaretli, aynı numara ve isim
  if (!byNo) {
    const back = exited.find((s) => s.schoolNo === row.schoolNo && compareNames(row, s) !== "different");
    if (back) {
      return {
        kind: "matched",
        studentId: back.id,
        returning: true,
        warnings: [`${who(back)} ayrılmış olarak işaretliydi; okula geri dönüş olarak alınacak`],
      };
    }
  }

  return { kind: "new", warnings: reused };
}
