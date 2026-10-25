// Şube sorguları

import type { DB } from "./db.ts";

export interface ClassRow {
  id: number;
  name: string;
  grade: number;
  section: string;
  field: string | null;
  org_unit_path: string;
  group_email: string | null;
  group_status: string | null;
  students: number;
  active: number;
  pending: number;
  errors: number;
}

export function currentYear(db: DB) {
  return db.prepare("SELECT id, name, starts_at, ends_at FROM academic_years WHERE is_current = 1").get() as
    | { id: number; name: string; starts_at: string; ends_at: string }
    | undefined;
}

/** Listesi onaylanmış yıllar (yeniden eskiye) */
export function listedYears(db: DB) {
  return db
    .prepare(
      `SELECT y.id, y.name, y.is_current FROM academic_years y
       WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.academic_year_id = y.id) ORDER BY y.starts_at DESC`,
    )
    .all() as { id: number; name: string; is_current: number }[];
}

/** Şubeler; öğrenci sayıları o yılın kayıtlarından (güncel yılda ayrılanlar sayılmaz) */
export function listClasses(db: DB, yearId?: number): ClassRow[] {
  const y = yearId ?? currentYear(db)?.id;
  if (!y) return [];
  return db
    .prepare(
      `SELECT c.id, c.name, c.grade, c.section, c.field, c.org_unit_path, g.email AS group_email, g.status AS group_status,
              count(s.id) AS students,
              count(CASE WHEN s.status = 'ACTIVE' THEN 1 END) AS active,
              count(CASE WHEN s.status = 'PENDING' THEN 1 END) AS pending,
              count(CASE WHEN s.status = 'ERROR' THEN 1 END) AS errors
       FROM class_sections c
       JOIN academic_years y ON y.id = c.academic_year_id
       LEFT JOIN groups g ON g.id = c.group_id
       LEFT JOIN enrollments e ON e.class_id = c.id
       LEFT JOIN students s ON s.id = e.student_id AND s.status <> 'DELETED' AND (y.is_current = 0 OR s.exit_reason IS NULL)
       WHERE c.academic_year_id = ?
       GROUP BY c.id ORDER BY c.grade, c.section`,
    )
    .all(y) as ClassRow[];
}

export function getClass(db: DB, id: number) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.grade, c.section, c.field, c.org_unit_path, y.name AS year, y.is_current,
              g.email AS group_email, g.status AS group_status
       FROM class_sections c JOIN academic_years y ON y.id = c.academic_year_id LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        name: string;
        grade: number;
        section: string;
        field: string | null;
        org_unit_path: string;
        year: string;
        is_current: number;
        group_email: string | null;
        group_status: string | null;
      }
    | undefined;
}
