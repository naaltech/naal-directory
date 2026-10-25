// Öğrenci sorguları: panel listesi, ayrıntı sayfası, ilk şifre.

import type { DB } from "./db.ts";
import { logAction } from "./audit.ts";
import { asciiFold } from "./email.ts";
import { decryptSecret } from "./secret-box.ts";

export interface StudentListRow {
  id: number;
  school_no: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  email: string;
  status: string;
  class_name: string | null;
  class_id: number | null;
  exit_reason: string | null;
  is_officer: number;
}

export interface StudentFilter {
  q?: string;
  classId?: number;
  /** Geçmiş yıllar dahil bu şubeye kayıtlı olmuş herkes (durum süzgeci uygulanmaz) */
  enrolledIn?: number;
  status?: string; // ACTIVE, PENDING, ERROR, SUSPENDED, LEFT (mezun + nakil)
  page?: number;
  pageSize?: number;
}

export function listStudents(db: DB, f: StudentFilter): { rows: StudentListRow[]; total: number } {
  const where = ["s.status <> 'DELETED'"];
  const params: Record<string, unknown> = {};
  if (f.q?.trim()) {
    // SQLite LIKE Türkçe harflerde büyük/küçük ayırır; bu yüzden sadeleştirilmiş haliyle e-postada da aranır
    where.push(`(s.school_no = @no OR lower(s.email) LIKE @like OR (s.first_name || ' ' || s.last_name) LIKE @name)`);
    const q = f.q.trim();
    params.no = q;
    params.like = `%${asciiFold(q).replace(/\s+/g, ".")}%`;
    params.name = `%${q}%`;
  }
  if (f.classId) {
    where.push("s.class_id = @classId");
    params.classId = f.classId;
  }
  if (f.enrolledIn) {
    where.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.class_id = @enrolledIn)");
    params.enrolledIn = f.enrolledIn;
  } else if (f.status === "LEFT") where.push("s.exit_reason IS NOT NULL");
  else if (f.status) {
    where.push("s.status = @status AND s.exit_reason IS NULL");
    params.status = f.status;
  } else where.push("s.exit_reason IS NULL");

  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const sql = `FROM students s
    LEFT JOIN class_sections c ON c.id = s.class_id
    WHERE ${where.join(" AND ")}`;
  const total = db.prepare(`SELECT count(*) ${sql}`).pluck().get(params) as number;
  const rows = db
    .prepare(
      `SELECT s.id, s.school_no, s.first_name, s.last_name, s.gender, s.email, s.status, s.class_id, s.exit_reason,
              c.name AS class_name,
              EXISTS (SELECT 1 FROM club_officers o WHERE o.student_id = s.id AND o.ended_at IS NULL) AS is_officer
       ${sql}
       ORDER BY c.grade, c.section, s.last_name, s.first_name
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as StudentListRow[];
  return { rows, total };
}

export interface StudentDetail {
  id: number;
  school_no: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  email: string;
  status: string;
  org_unit_path: string;
  google_user_id: string | null;
  class_id: number | null;
  class_name: string | null;
  exit_reason: string | null;
  graduated_at: string | null;
  left_at: string | null;
  suspend_at: string | null;
  delete_at: string | null;
  suspended_at: string | null;
  has_password: number;
  last_synced_at: string | null;
  created_at: string;
}

export function getStudent(db: DB, id: number) {
  const student = db
    .prepare(
      `SELECT s.id, s.school_no, s.first_name, s.last_name, s.gender, s.email, s.status, s.org_unit_path, s.google_user_id,
              s.class_id, c.name AS class_name, s.exit_reason, s.graduated_at, s.left_at, s.suspend_at, s.delete_at,
              s.suspended_at, s.initial_password_enc IS NOT NULL AS has_password, s.last_synced_at, s.created_at
       FROM students s LEFT JOIN class_sections c ON c.id = s.class_id WHERE s.id = ?`,
    )
    .get(id) as StudentDetail | undefined;
  if (!student) return null;

  const enrollments = db
    .prepare(
      `SELECT y.name AS year, c.id AS class_id, c.name AS class_name, e.school_no
       FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id JOIN class_sections c ON c.id = e.class_id
       WHERE e.student_id = ? ORDER BY y.starts_at DESC`,
    )
    .all(id) as { year: string; class_id: number; class_name: string; school_no: string }[];
  const groups = db
    .prepare(
      `SELECT g.id, g.email, g.name, g.kind, m.role, m.status FROM group_members m JOIN groups g ON g.id = m.group_id
       WHERE m.student_id = ? ORDER BY g.kind, g.email`,
    )
    .all(id) as { id: number; email: string; name: string; kind: string; role: string; status: string }[];
  const roles = db
    .prepare(
      `SELECT o.id, o.title, o.alias_email, o.status, o.started_at, o.ended_at, k.id AS club_id, k.name AS club_name
       FROM club_officers o JOIN clubs k ON k.id = o.club_id WHERE o.student_id = ? ORDER BY o.ended_at IS NOT NULL, o.started_at DESC`,
    )
    .all(id) as {
    id: number;
    title: string;
    alias_email: string;
    status: string;
    started_at: string;
    ended_at: string | null;
    club_id: number;
    club_name: string;
  }[];
  return { student, enrollments, groups, roles };
}

/** İlk şifreyi çözer ve görüntülemeyi kayda geçirir (kişisel veri) */
export function revealInitialPassword(db: DB, studentId: number, userId: number): string | null {
  const enc = db.prepare("SELECT initial_password_enc FROM students WHERE id = ?").pluck().get(studentId) as
    | string
    | null
    | undefined;
  if (!enc) return null;
  logAction(db, userId, "student.password_view", "student", studentId);
  return decryptSecret(enc);
}

/** Şube öğrencilerinin ilk şifreleri (dağıtım listesi için); görüntüleme kayda geçer */
export function classPasswordSlips(db: DB, classId: number, userId: number) {
  const rows = db
    .prepare(
      `SELECT id, school_no, first_name, last_name, email, status, initial_password_enc FROM students
       WHERE class_id = ? AND exit_reason IS NULL AND status <> 'DELETED' ORDER BY last_name, first_name`,
    )
    .all(classId) as {
    id: number;
    school_no: string;
    first_name: string;
    last_name: string;
    email: string;
    status: string;
    initial_password_enc: string | null;
  }[];
  logAction(db, userId, "class.password_slips", "class_section", classId, { count: rows.length });
  return rows.map(({ initial_password_enc, ...r }) => ({
    ...r,
    password: initial_password_enc ? decryptSecret(initial_password_enc) : null,
  }));
}
