// Testlerin ortak yardımcıları: bellekte veritabanı, örnek kayıtlar ve sahte Google.

import { migrate, openDb, type DB } from "../lib/db.ts";
import type { Google, GoogleRequest } from "../lib/sync/google.ts";

export function testDb(): DB {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

export function addAdmin(db: DB, email = "yonetici@nevzatayazal.k12.tr"): number {
  return Number(
    db.prepare("INSERT INTO admin_users (email, name, password_hash) VALUES (?, 'Yönetici', 'x')").run(email).lastInsertRowid,
  );
}

function domainId(db: DB, kind: "STUDENT" | "TEACHER" | "CLUB"): number {
  return db.prepare("SELECT id FROM domains WHERE kind = ?").pluck().get(kind) as number;
}

export function yearId(db: DB, name: string): number {
  const found = db.prepare("SELECT id FROM academic_years WHERE name = ?").pluck().get(name) as number | undefined;
  if (found) return found;
  const start = Number(name.slice(0, 4));
  return Number(
    db
      .prepare("INSERT INTO academic_years (name, starts_at, ends_at, is_current) VALUES (?, ?, ?, 0)")
      .run(name, `${start}-09-07`, `${start + 1}-06-25`).lastInsertRowid,
  );
}

export function addClass(db: DB, year: number, grade: number, section: string, groupId: number | null = null): number {
  const name = `${grade}-${section}`;
  return Number(
    db
      .prepare(
        "INSERT INTO class_sections (academic_year_id, grade, section, name, org_unit_path, group_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(year, grade, section, name, `/Ogrenciler/${grade}/${name}`, groupId).lastInsertRowid,
  );
}

let seq = 0;

export function addStudent(
  db: DB,
  over: Partial<{
    email: string;
    firstName: string;
    lastName: string;
    schoolNo: string;
    googleId: string | null;
    orgUnitPath: string;
    classId: number | null;
    status: string;
    exitReason: string | null;
    suspendAt: string | null;
    deleteAt: string | null;
    password: string | null;
  }> = {},
): number {
  const n = ++seq;
  return Number(
    db
      .prepare(
        `INSERT INTO students (school_no, first_name, last_name, domain_id, email, google_user_id, org_unit_path, class_id,
           status, exit_reason, suspend_at, delete_at, initial_password_enc)
         VALUES (@no, @first, @last, @domain, @email, @google, @ou, @classId, @status, @exit, @suspend, @remove, @password)`,
      )
      .run({
        no: over.schoolNo ?? String(1000 + n),
        first: over.firstName ?? "Ayşe",
        last: over.lastName ?? `Yılmaz${n}`,
        domain: domainId(db, "STUDENT"),
        email: over.email ?? `ogrenci${n}@ogr.nevzatayazal.k12.tr`,
        google: over.googleId === undefined ? `g-${n}` : over.googleId,
        ou: over.orgUnitPath ?? "/Ogrenciler",
        classId: over.classId ?? null,
        status: over.status ?? "ACTIVE",
        exit: over.exitReason ?? null,
        suspend: over.suspendAt ?? null,
        remove: over.deleteAt ?? null,
        password: over.password ?? null,
      }).lastInsertRowid,
  );
}

export function enroll(db: DB, studentId: number, year: number, classId: number, batchId: number | null = null) {
  const no = db.prepare("SELECT school_no FROM students WHERE id = ?").pluck().get(studentId) as string;
  db.prepare(
    "INSERT INTO enrollments (student_id, academic_year_id, class_id, school_no, import_batch_id) VALUES (?, ?, ?, ?, ?)",
  ).run(studentId, year, classId, no, batchId);
}

export function addGroup(db: DB, kind: string, email: string, status = "ACTIVE"): number {
  return Number(
    db
      .prepare("INSERT INTO groups (kind, domain_id, email, name, status) VALUES (?, ?, ?, ?, ?)")
      .run(kind, domainId(db, kind === "CLUB" ? "CLUB" : "STUDENT"), email, email, status).lastInsertRowid,
  );
}

export function addClub(db: DB, code: string, isActive = 1): { clubId: number; groupId: number } {
  const groupId = addGroup(db, "CLUB", `${code}@naal.org.tr`);
  const clubId = Number(
    db
      .prepare("INSERT INTO clubs (code, name, group_id, is_active) VALUES (?, ?, ?, ?)")
      .run(code, code, groupId, isActive).lastInsertRowid,
  );
  return { clubId, groupId };
}

export function job(db: DB, id: number) {
  return db.prepare("SELECT * FROM sync_jobs WHERE id = ?").get(id) as {
    status: string;
    attempts: number;
    last_error: string | null;
    run_after: string;
  };
}

export const pastDate = "2020-01-01 00:00:00";
export const futureDate = "2999-01-01 00:00:00";

/** İstekleri kaydeden sahte Google; `onSend` hata fırlatarak Google yanıtlarını taklit eder */
export function fakeGoogle(
  opts: { onSend?: (req: GoogleRequest) => unknown; onGet?: (path: string) => unknown } = {},
): Google & { sent: GoogleRequest[] } {
  const sent: GoogleRequest[] = [];
  return {
    dryRun: false,
    sent,
    async get<T>(path: string) {
      return (opts.onGet?.(path) ?? {}) as T;
    },
    async send<T>(req: GoogleRequest) {
      sent.push(req);
      return (opts.onSend?.(req) ?? {}) as T;
    },
    async patchGroupSettings(_email, settings) {
      return settings;
    },
  };
}
