// Eğitim yılları. Güncel yıl elle değiştirilmez: onaylanan son listenin yılıdır.
//
// Listenin yılı rapor tarihinden bulunur (Eylül ve sonrası o yılın, öncesi bir önceki yılın
// eğitim yılı); tarih yoksa ya da yanlışsa yükleyen elle seçer. Kurallar:
// - Sistemdeki son listeden ESKİ bir yılın listesi alınmaz (öğrencileri geçmiş şubelerine taşırdı).
// - Aynı yılın listesi tekrar yüklenebilir (düzeltme, yıl içi şube değişikliği).
// - Aradaki yıllar atlanabilir (2023 → 2026); eşleştirme ve mezun tahmini aradaki farkı hesaba katar.

import type { DB } from "./db.ts";

/** Eylül (ay 8) ve sonrası yeni eğitim yılı */
const YEAR_START_MONTH = 8;

export interface YearRef {
  id: number;
  name: string;
  start: number; // 2026-2027 → 2026
  starts_at: string;
  ends_at: string;
}

export const yearName = (start: number) => `${start}-${start + 1}`;
export const yearStartOf = (name: string) => Number(name.slice(0, 4));

/** Tarihin düştüğü eğitim yılının başlangıç yılı */
export function schoolYearFor(d: Date): number {
  return d.getMonth() >= YEAR_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
}

const toRef = (r: Omit<YearRef, "start"> | undefined): YearRef | undefined => (r ? { ...r, start: yearStartOf(r.name) } : undefined);

export function currentYearRef(db: DB): YearRef | undefined {
  return toRef(db.prepare("SELECT id, name, starts_at, ends_at FROM academic_years WHERE is_current = 1").get() as never);
}

export function yearByStart(db: DB, start: number): YearRef | undefined {
  return toRef(db.prepare("SELECT id, name, starts_at, ends_at FROM academic_years WHERE name = ?").get(yearName(start)) as never);
}

/** Onaylanmış listesi olan en son yıl */
export function latestListYear(db: DB): YearRef | undefined {
  return toRef(
    db
      .prepare(
        `SELECT y.id, y.name, y.starts_at, y.ends_at FROM academic_years y
         WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.academic_year_id = y.id)
         ORDER BY y.starts_at DESC LIMIT 1`,
      )
      .get() as never,
  );
}

export function ensureYear(db: DB, start: number): YearRef {
  const found = yearByStart(db, start);
  if (found) return found;
  db.prepare("INSERT INTO academic_years (name, starts_at, ends_at, is_current) VALUES (?, ?, ?, 0)").run(
    yearName(start),
    `${start}-09-01`,
    `${start + 1}-06-30`,
  );
  return yearByStart(db, start)!;
}

export function setCurrentYear(db: DB, id: number) {
  db.transaction(() => {
    db.prepare("UPDATE academic_years SET is_current = 0 WHERE is_current = 1 AND id <> ?").run(id);
    db.prepare("UPDATE academic_years SET is_current = 1 WHERE id = ?").run(id);
  })();
}

/** Bu yılın listesi yüklenebilir mi; değilse nedenini döndürür */
export function listYearProblem(db: DB, start: number, now = new Date()): string | null {
  if (!Number.isInteger(start) || start < 2000 || start > 2100) return "Geçersiz eğitim yılı.";
  if (start > schoolYearFor(now)) return `${yearName(start)} henüz başlamadı; liste tarihini kontrol edin.`;
  const latest = latestListYear(db);
  if (latest && start < latest.start) {
    return `Sistemde ${latest.name} listesi var. Daha eski bir yılın (${yearName(start)}) listesi yüklenemez; öğrenciler geçmiş şubelerine taşınırdı.`;
  }
  return null;
}

/** Seçilebilecek yıllar: son listenin yılından bu yıla kadar (liste yoksa son 6 yıl) */
export function selectableYears(db: DB, now = new Date()): number[] {
  const last = schoolYearFor(now);
  const first = latestListYear(db)?.start ?? last - 5;
  const out: number[] = [];
  for (let y = last; y >= Math.min(first, last); y--) out.push(y);
  return out;
}

/** 'YYYY-MM-DD' tarihini n yıl kaydırır */
export function shiftYears(date: string, n: number): string {
  return `${Number(date.slice(0, 4)) + n}${date.slice(4)}`;
}
