// Okuldan ayrılanlar.
//
// Yeni yılın listesi onaylanınca, okulda görünüp bu yılın listesinde olmayan öğrenciler "ayrılan adayı"
// olur. Listeler arka arkaya yıllardan olmayabilir: son kayıtlı sınıfı + aradan geçen yıl 12'yi aşıyorsa
// mezun, aşmıyorsa nakil önerilir. Aynı yılın listesi tekrar yüklendiyse, o listedeki şubelerde önceden
// kayıtlı olup listede olmayanlar da aday olur.
//
// Yönetici onaylayınca öğrenci sınıf ve kulüp gruplarından çıkar, kulüp görevleri biter, hesap /Mezunlar
// ya da /Nakil OU'suna taşınır ve askı/silme tarihleri yazılır (gece işi retention.ts kuyruğa alır).
// Tarihler gerçek ayrılış tahminine göre hesaplanır (mezuniyet yılının sonu), ama yıllar sonra
// işaretlenen biri için askı en erken bugün, silme en erken askı süresi kadar sonra olur:
// yanlış işaretlemeyi fark etmek için her zaman zaman kalır.
// Yıl içinde nakil giden tek öğrenci de aynı yoldan işaretlenir.

import { logAction } from "./audit.ts";
import { endOfficerRow } from "./clubs.ts";
import { sqlDate, type DB } from "./db.ts";
import { enqueue } from "./sync/queue.ts";
import { currentYearRef, shiftYears, yearStartOf } from "./years.ts";

export type ExitReason = "GRADUATED" | "TRANSFERRED";
export const EXIT_OU: Record<ExitReason, string> = { GRADUATED: "/Mezunlar", TRANSFERRED: "/Nakil" };
const LAST_GRADE = 12;

export class LeaverError extends Error {}

export function setting(db: DB, key: string, fallback: number): number {
  const v = db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(key) as string | undefined;
  const n = v ? Number(JSON.parse(v)) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function retentionDays(db: DB, reason: ExitReason) {
  const k = reason === "GRADUATED" ? "graduated" : "transferred";
  return {
    suspend: setting(db, `retention.${k}.suspendDays`, 90),
    remove: setting(db, `retention.${k}.deleteDays`, 365),
  };
}

const DAY = 864e5;

/**
 * Ayrılış tarihi tahmininden askı ve silme tarihleri.
 * Askı en erken şimdi, silme en erken şimdiden askı süresi kadar sonra.
 */
export function retentionDates(left: Date, days: { suspend: number; remove: number }, now = new Date()) {
  const suspend = new Date(Math.max(left.getTime() + days.suspend * DAY, now.getTime()));
  const remove = new Date(Math.max(left.getTime() + days.remove * DAY, now.getTime() + days.suspend * DAY));
  return { suspend, remove };
}

// ───── Son kayıt ─────

interface LastEnrollment {
  student_id: number;
  year_id: number;
  year_name: string;
  starts_at: string;
  ends_at: string;
  grade: number;
  class_name: string;
  batch_id: number | null;
}

const LAST_ENROLLMENT = `
  SELECT e.student_id, y.id AS year_id, y.name AS year_name, y.starts_at, y.ends_at, c.grade, c.name AS class_name,
         e.import_batch_id AS batch_id,
         row_number() OVER (PARTITION BY e.student_id ORDER BY y.starts_at DESC) AS rn
  FROM enrollments e JOIN academic_years y ON y.id = e.academic_year_id JOIN class_sections c ON c.id = e.class_id`;

function lastEnrollment(db: DB, studentId: number): LastEnrollment | undefined {
  return db.prepare(`SELECT * FROM (${LAST_ENROLLMENT}) WHERE rn = 1 AND student_id = ?`).get(studentId) as LastEnrollment | undefined;
}

/** Geçen yıl sayısına göre beklenen sınıf; 12'yi aşıyorsa mezun olmuş olmalı */
function expectedGrade(last: { grade: number; year_name: string }, currentStart: number) {
  return last.grade + (currentStart - yearStartOf(last.year_name));
}

/** Gerçek ayrılış tarihi tahmini (ileri bir tarih çıkarsa şimdi) */
function estimatedLeaveDate(last: LastEnrollment | undefined, reason: ExitReason, currentYearId: number | undefined, now = new Date()): Date {
  if (!last || last.year_id === currentYearId) return now; // bu yıl kayıtlıydı: yıl içinde ayrıldı
  const d =
    reason === "GRADUATED"
      ? shiftYears(last.ends_at, Math.max(0, LAST_GRADE - last.grade)) // mezuniyet yılının sonu
      : shiftYears(last.starts_at, 1); // bir sonraki yılın başında gelmedi
  const t = new Date(`${d}T12:00:00Z`);
  return t.getTime() > now.getTime() ? now : t;
}

// ───── Ayrılan adayları ─────

export interface LeaverCandidate {
  id: number;
  first_name: string;
  last_name: string;
  school_no: string;
  email: string;
  last_class: string;
  last_grade: number;
  last_year: string;
  /** "missing": bu yılın hiçbir listesinde yok; "dropped": bu yıl kayıtlıydı, şubesinin yeni listesinde yok */
  kind: "missing" | "dropped";
  expected_grade: number;
  suggested: ExitReason;
}

export interface LeaverCandidates {
  yearName: string | null;
  listLoaded: boolean;
  rows: LeaverCandidate[];
  /** Beklenen sınıf seviyesinin bu yıl hiç şubesi yüklenmediği için aday sayılmayanlar (liste eksik olabilir) */
  held: { grade: number; count: number }[];
  /** Bu yılın listesinde şubesi olan sınıf seviyeleri */
  grades: number[];
}

/**
 * Okulda görünen ama güncel yılın listesinde olmayan öğrenciler.
 * Güncel yıla hiç liste yüklenmediyse boş döner (herkes aday olurdu). Beklenen sınıfın bu yıl hiç şubesi
 * yoksa (örneğin sadece 9. sınıf listesi yüklendiyse) o öğrenciler aday sayılmaz, "held" olarak sayılır.
 */
export function leaverCandidates(db: DB): LeaverCandidates {
  const year = currentYearRef(db);
  if (!year) return { yearName: null, listLoaded: false, rows: [], held: [], grades: [] };
  const listLoaded = Boolean(db.prepare("SELECT 1 FROM enrollments WHERE academic_year_id = ? LIMIT 1").get(year.id));
  if (!listLoaded) return { yearName: year.name, listLoaded, rows: [], held: [], grades: [] };

  const gradesThisYear = new Set(
    db
      .prepare(
        `SELECT DISTINCT c.grade FROM class_sections c
         WHERE c.academic_year_id = ? AND EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id)`,
      )
      .pluck()
      .all(year.id) as number[],
  );
  // Bu yıl onaylanmış listelerde her şubeyi son kapsayan liste
  const coveredBy = new Map(
    (
      db
        .prepare(
          `SELECT json_extract(j.value, '$.key') AS section, max(b.id) AS batch_id
           FROM import_batches b, json_each(b.summary, '$.sections') j
           WHERE b.academic_year_id = ? AND b.kind = 'students' AND b.status NOT IN ('PARSED', 'UPLOADED', 'FAILED')
           GROUP BY section`,
        )
        .all(year.id) as { section: string; batch_id: number }[]
    ).map((r) => [r.section, r.batch_id]),
  );

  const students = db
    .prepare(
      `SELECT s.id, s.first_name, s.last_name, s.school_no, s.email, le.year_id, le.year_name, le.grade, le.class_name, le.batch_id
       FROM students s JOIN (${LAST_ENROLLMENT}) le ON le.student_id = s.id AND le.rn = 1
       WHERE s.exit_reason IS NULL AND s.status <> 'DELETED'
       ORDER BY le.grade DESC, le.class_name, s.last_name, s.first_name`,
    )
    .all() as {
    id: number;
    first_name: string;
    last_name: string;
    school_no: string;
    email: string;
    year_id: number;
    year_name: string;
    grade: number;
    class_name: string;
    batch_id: number | null;
  }[];

  const rows: LeaverCandidate[] = [];
  const held = new Map<number, number>();
  for (const s of students) {
    const base = {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      school_no: s.school_no,
      email: s.email,
      last_class: s.class_name,
      last_grade: s.grade,
      last_year: s.year_name,
    };
    if (s.year_id === year.id) {
      const later = coveredBy.get(s.class_name);
      if (later && later > (s.batch_id ?? 0)) {
        rows.push({ ...base, kind: "dropped", expected_grade: s.grade, suggested: "TRANSFERRED" });
      }
      continue;
    }
    const expected = expectedGrade(s, year.start);
    if (expected > LAST_GRADE) {
      rows.push({ ...base, kind: "missing", expected_grade: expected, suggested: "GRADUATED" });
    } else if (gradesThisYear.has(expected) || gradesThisYear.has(s.grade)) {
      rows.push({ ...base, kind: "missing", expected_grade: expected, suggested: "TRANSFERRED" });
    } else {
      held.set(expected, (held.get(expected) ?? 0) + 1);
    }
  }
  return {
    yearName: year.name,
    listLoaded,
    rows,
    held: [...held].map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade - b.grade),
    grades: [...gradesThisYear],
  };
}

// ───── Ayrılış ─────

export function markLeavers(db: DB, items: { studentId: number; reason: ExitReason }[], userId: number | null, now = new Date()): number {
  return db.transaction(() => {
    const currentYearId = currentYearRef(db)?.id;
    let n = 0;
    for (const { studentId, reason } of items) {
      if (reason !== "GRADUATED" && reason !== "TRANSFERRED") throw new LeaverError("Geçersiz ayrılış nedeni.");
      const s = db
        .prepare("SELECT id, email, org_unit_path, exit_reason, status, google_user_id FROM students WHERE id = ?")
        .get(studentId) as
        | { id: number; email: string; org_unit_path: string; exit_reason: string | null; status: string; google_user_id: string | null }
        | undefined;
      if (!s || s.exit_reason || s.status === "DELETED") continue;

      const days = retentionDays(db, reason);
      const left = estimatedLeaveDate(lastEnrollment(db, s.id), reason, currentYearId, now);
      const dates = retentionDates(left, days, now);
      const dateCol = reason === "GRADUATED" ? "graduated_at" : "left_at";
      const ou = EXIT_OU[reason];

      // Kulüp görevleri biter (takma ad kalkar); OU aşağıda zaten ayrılış OU'suna taşınır
      const roles = db
        .prepare(
          `SELECT o.id, o.alias_email, o.student_id, s.email, s.org_unit_path, NULL AS class_ou
           FROM club_officers o JOIN students s ON s.id = o.student_id WHERE o.student_id = ? AND o.ended_at IS NULL`,
        )
        .all(s.id) as Parameters<typeof endOfficerRow>[1][];
      for (const r of roles) endOfficerRow(db, r, { restoreOu: false });

      // Sınıf ve kulüp gruplarından çıkar
      const memberships = db
        .prepare(
          `SELECT m.id, g.id AS group_id, g.email AS group_email FROM group_members m JOIN groups g ON g.id = m.group_id
           WHERE m.student_id = ? AND g.kind IN ('CLASS', 'CLUB')`,
        )
        .all(s.id) as { id: number; group_id: number; group_email: string }[];
      for (const m of memberships) {
        db.prepare("DELETE FROM group_members WHERE id = ?").run(m.id);
        enqueue(db, "REMOVE_MEMBER", "group", m.group_id, { groupEmail: m.group_email, memberEmail: s.email });
      }
      db.prepare("DELETE FROM club_members WHERE student_id = ?").run(s.id);

      db.prepare(
        `UPDATE students SET exit_reason = @reason, ${dateCol} = @left, class_id = NULL, org_unit_path = @ou,
           suspend_at = @suspend, delete_at = @remove
         WHERE id = @id`,
      ).run({ id: s.id, reason, ou, left: sqlDate(left), suspend: sqlDate(dates.suspend), remove: sqlDate(dates.remove) });
      if (s.org_unit_path !== ou) enqueue(db, "UPDATE_USER", "student", s.id, { email: s.email, orgUnitPath: ou });

      // Google hesabı hiç açılmadıysa: açma dahil bu öğrencinin bekleyen bütün işleri iptal, hesap arşiv
      if (!s.google_user_id) {
        db.prepare(
          `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Öğrenci ayrıldı'
           WHERE status IN ('QUEUED', 'FAILED')
             AND ((entity_type = 'student' AND entity_id = @id)
               OR json_extract(payload, '$.email') = @email OR json_extract(payload, '$.memberEmail') = @email)`,
        ).run({ id: String(s.id), email: s.email });
        db.prepare("UPDATE students SET status = 'ARCHIVED' WHERE id = ?").run(s.id);
      }
      n++;
    }
    if (n) logAction(db, userId, "student.leave", "student", null, { items });
    return n;
  })();
}

/**
 * Yanlışlıkla işaretlenen öğrenciyi geri alır (hesap henüz askıya alınmadıysa).
 * Şubesi bir sonraki liste yüklemesinde belirlenir; o zamana kadar /Ogrenciler'de durur.
 */
export function undoLeave(db: DB, studentId: number, userId: number) {
  db.transaction(() => {
    const s = db
      .prepare("SELECT id, email, exit_reason, suspended_at, status FROM students WHERE id = ?")
      .get(studentId) as { id: number; email: string; exit_reason: string | null; suspended_at: string | null; status: string } | undefined;
    if (!s?.exit_reason) throw new LeaverError("Öğrenci ayrılmış olarak işaretli değil.");
    if (s.suspended_at || s.status === "SUSPENDED" || s.status === "DELETED") {
      throw new LeaverError("Hesap askıya alınmış; geri almak için önce Google'da askıyı kaldırın.");
    }
    // Henüz çalışmamış askı/silme işleri iptal
    db.prepare(
      `UPDATE sync_jobs SET status = 'CANCELLED' WHERE entity_type = 'student' AND entity_id = ?
       AND action IN ('SUSPEND_USER', 'DELETE_USER') AND status = 'QUEUED'`,
    ).run(String(s.id));
    db.prepare(
      `UPDATE students SET exit_reason = NULL, graduated_at = NULL, left_at = NULL, suspend_at = NULL, delete_at = NULL,
         org_unit_path = '/Ogrenciler' WHERE id = ?`,
    ).run(s.id);
    enqueue(db, "UPDATE_USER", "student", s.id, { email: s.email, orgUnitPath: "/Ogrenciler" });
    logAction(db, userId, "student.leave_undo", "student", s.id);
  })();
}
