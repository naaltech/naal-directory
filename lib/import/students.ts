// Okul listesinden öğrenci içe aktarma: önizleme oluşturma, saklama, e-posta düzeltme.
// Bu aşamada Google'a ve öğrenci tablolarına hiçbir şey yazılmaz; sadece import_batches/import_rows.

import type { DB } from "../db.ts";
import { emailCandidates, pickEmail, RESERVED_LOCAL_PARTS, slug, toTitleCaseTr } from "../email.ts";
import { matchStudent, type ExistingStudent } from "../match.ts";
import { yearByStart } from "../years.ts";
import type { Gender, ParsedRoster, RosterIssue } from "../roster/types.ts";
import type { ConfirmResult } from "./confirm.ts";

export type EmailNote = "first" | "second-name" | "numbered" | "existing" | "manual";

export interface PreviewRow {
  id: number; // import_rows.id (kaydedildikten sonra)
  sectionKey: string; // "9-A"
  grade: number;
  section: string;
  rowNo: number;
  schoolNo: string;
  firstName: string;
  lastName: string;
  gender?: Gender;
  match:
    | { kind: "new"; warnings: string[] }
    | { kind: "matched"; studentId: number; existingEmail: string; warnings: string[]; returning?: boolean; manual?: boolean }
    | { kind: "conflict"; studentId: number; reason: string };
  email: string | null;
  emailNote?: EmailNote;
  errors: string[];
}

export interface SectionSummary {
  key: string;
  grade: number;
  section: string;
  field?: string;
  advisorName?: string;
  expectedTotal?: number;
  count: number;
  orgUnitPath: string;
  groupEmail: string;
  source: string;
}

export interface ListYear {
  start: number; // 2023-2024 → 2023
  name: string;
  /** "report": rapor tarihinden bulundu; "manual": yükleyen seçti */
  source: "report" | "manual";
  /** Rapor tarihinden bulunan yıl (elle farklı seçildiyse uyarı için) */
  detected?: number;
}

export interface ImportSummary {
  schoolName?: string;
  reportDate?: string;
  year?: ListYear;
  sections: SectionSummary[];
  issues: RosterIssue[];
  google: { checked: boolean; error?: string; takenCount?: number };
  result?: ConfirmResult; // onaydan sonra
  basisSeq?: number; // önizleme hazırlanırken import.confirmSeq değeri
}

export interface ImportBatch {
  id: number;
  file_name: string;
  kind: string;
  parser_id: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  created_at: string;
  created_by_name: string | null;
  academic_year: string | null;
  summary: ImportSummary;
}

export type RowStatus = "VALID" | "INVALID" | "DUPLICATE";

export function rowStatus(r: PreviewRow): RowStatus {
  if (r.errors.some((e) => e.startsWith("Okul no"))) return "DUPLICATE";
  if (r.errors.length || r.match.kind === "conflict" || !r.email) return "INVALID";
  return "VALID";
}

/** Her liste onayında bir artar; önizleme hazırlandıktan sonra başka liste onaylandı mı diye bakılır. */
export function confirmSeq(db: DB): number {
  const v = db.prepare("SELECT value FROM settings WHERE key = 'import.confirmSeq'").pluck().get() as string | undefined;
  return v ? Number(JSON.parse(v)) : 0;
}

export function studentDomain(db: DB): string {
  return db.prepare("SELECT name FROM domains WHERE kind = 'STUDENT'").pluck().get() as string;
}

export function sectionOrgUnit(grade: number, section: string) {
  return `/Ogrenciler/${grade}/${grade}-${section}`;
}

export function sectionGroupEmail(grade: number, section: string, domain: string) {
  return `${grade}${slug(section)}@${domain}`;
}

/** Veritabanında herhangi bir hesap, grup ya da aktif takma ad bu adresi kullanıyor mu */
export function dbEmailTaken(db: DB) {
  const stmt = db.prepare(`
    SELECT 1 FROM students WHERE email = @e AND status <> 'DELETED'
    UNION ALL SELECT 1 FROM teachers WHERE email = @e AND status <> 'DELETED'
    UNION ALL SELECT 1 FROM groups WHERE email = @e
    UNION ALL SELECT 1 FROM club_officers WHERE alias_email = @e AND ended_at IS NULL
    UNION ALL SELECT 1 FROM group_aliases WHERE alias_email = @e AND removed_at IS NULL
    LIMIT 1`);
  return (email: string) => stmt.get({ e: email.toLowerCase() }) !== undefined;
}

type Existing = ExistingStudent & { email: string };

/** Hesabı silinmemiş bütün öğrenciler; sınıf ve yıl son kayıtlı oldukları yıldan */
function existingStudents(db: DB): { active: Existing[]; exited: Existing[] } {
  const rows = db
    .prepare(
      `SELECT s.id, s.school_no AS schoolNo, s.first_name AS firstName, s.last_name AS lastName,
              s.national_id_hash AS nationalIdHash, s.email, s.exit_reason IS NOT NULL AS exited,
              last.grade, CAST(substr(last.year, 1, 4) AS INTEGER) AS lastYear
       FROM students s
       LEFT JOIN (
         SELECT e.student_id, c.grade, y.name AS year,
                row_number() OVER (PARTITION BY e.student_id ORDER BY y.starts_at DESC) AS rn
         FROM enrollments e JOIN class_sections c ON c.id = e.class_id JOIN academic_years y ON y.id = e.academic_year_id
       ) last ON last.student_id = s.id AND last.rn = 1
       WHERE s.status <> 'DELETED' AND s.deleted_at IS NULL`,
    )
    .all() as (Omit<Existing, "exited"> & { exited: number })[];
  const all = rows.map((r) => ({ ...r, exited: Boolean(r.exited) }));
  return { active: all.filter((r) => !r.exited), exited: all.filter((r) => r.exited) };
}

function noteFor(email: string, first: string, row: { firstName: string }): EmailNote {
  const local = email.split("@")[0];
  if (local === first) return "first";
  if (/\d$/.test(local)) return "numbered";
  return row.firstName.includes(" ") ? "second-name" : "numbered";
}

/**
 * Çözümlenmiş listeden önizleme satırları üretir.
 * `googleTaken`: Google'da kullanılan adresler (yoksa sadece veritabanına bakılır).
 */
export async function buildStudentPreview(
  db: DB,
  roster: ParsedRoster,
  googleTaken: Set<string> | null,
  targetYear: number,
): Promise<{ rows: Omit<PreviewRow, "id">[]; sections: SectionSummary[] }> {
  const domain = studentDomain(db);
  const { active, exited } = existingStudents(db);
  const byId = new Map([...active, ...exited].map((s) => [s.id, s]));
  const listNumbers = new Set(roster.sections.flatMap((sec) => sec.students.map((st) => st.schoolNo)));
  const takenInDb = dbEmailTaken(db);
  const reserved = new Set<string>();
  const seenNo = new Set<string>();
  const isTaken = async (e: string) => takenInDb(e) || Boolean(googleTaken?.has(e));

  const rows: Omit<PreviewRow, "id">[] = [];
  const sections: SectionSummary[] = [];

  for (const sec of roster.sections) {
    const key = `${sec.grade}-${sec.section}`;
    sections.push({
      key,
      grade: sec.grade,
      section: sec.section,
      field: sec.field,
      advisorName: sec.advisorName ? toTitleCaseTr(sec.advisorName) : undefined,
      expectedTotal: sec.expected?.total,
      count: sec.students.length,
      orgUnitPath: sectionOrgUnit(sec.grade, sec.section),
      groupEmail: sectionGroupEmail(sec.grade, sec.section, domain),
      source: sec.source,
    });

    for (const st of sec.students) {
      const firstName = toTitleCaseTr(st.firstName);
      const lastName = toTitleCaseTr(st.lastName);
      const errors: string[] = [];
      if (!firstName || !lastName) errors.push("Ad veya soyad boş");
      if (seenNo.has(st.schoolNo)) errors.push(`Okul no ${st.schoolNo} listede birden fazla`);
      seenNo.add(st.schoolNo);

      const m = matchStudent(
        { schoolNo: st.schoolNo, firstName, lastName, grade: sec.grade },
        { targetYear, active, exited, listNumbers },
      );
      let match: PreviewRow["match"];
      let email: string | null = null;
      let emailNote: EmailNote | undefined;

      if (m.kind === "matched") {
        const ex = byId.get(m.studentId)!;
        match = { kind: "matched", studentId: m.studentId, existingEmail: ex.email, warnings: m.warnings, returning: m.returning };
        email = ex.email;
        emailNote = "existing";
        reserved.add(ex.email.toLowerCase());
      } else if (m.kind === "conflict") {
        match = m;
      } else {
        match = { kind: "new", warnings: m.warnings };
        if (!errors.length) {
          try {
            email = await pickEmail({ firstName, lastName }, domain, isTaken, { reservedInBatch: reserved });
            const first = emailCandidates({ firstName, lastName }).next().value as string;
            emailNote = noteFor(email, first, { firstName });
          } catch (e) {
            errors.push((e as Error).message);
          }
        }
      }

      rows.push({
        sectionKey: key,
        grade: sec.grade,
        section: sec.section,
        rowNo: st.rowNo,
        schoolNo: st.schoolNo,
        firstName,
        lastName,
        gender: st.gender,
        match,
        email,
        emailNote,
        errors,
      });
    }
  }
  return { rows, sections };
}

export function saveImportBatch(
  db: DB,
  input: {
    fileName: string;
    parserId: string;
    userId: number;
    roster: ParsedRoster;
    rows: Omit<PreviewRow, "id">[];
    summary: ImportSummary;
  },
): number {
  // Yıl kaydı onayda açılır; önizleme sadece özetteki yılı taşır
  const yearId = input.summary.year ? yearByStart(db, input.summary.year.start)?.id : undefined;
  return db.transaction(() => {
    const valid = input.rows.filter((r) => rowStatus(r as PreviewRow) === "VALID").length;
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO import_batches (file_name, kind, parser_id, academic_year_id, status, total_rows, valid_rows, error_rows, created_by, summary)
         VALUES (?, 'students', ?, ?, 'PARSED', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.fileName,
        input.parserId,
        yearId ?? null,
        input.rows.length,
        valid,
        input.rows.length - valid,
        input.userId,
        JSON.stringify({ ...input.summary, basisSeq: confirmSeq(db) }),
      );
    const batchId = Number(lastInsertRowid);
    const insert = db.prepare(
      "INSERT INTO import_rows (batch_id, row_number, raw, parsed, status, message) VALUES (?, ?, ?, ?, ?, ?)",
    );
    input.rows.forEach((r, i) => {
      const raw = { sectionKey: r.sectionKey, rowNo: r.rowNo, schoolNo: r.schoolNo, firstName: r.firstName, lastName: r.lastName, gender: r.gender };
      insert.run(batchId, i + 1, JSON.stringify(raw), JSON.stringify(r), rowStatus(r as PreviewRow), r.errors.join("; ") || null);
    });
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'import.parse', 'import_batch', ?, ?)",
    ).run(input.userId, String(batchId), JSON.stringify({ file: input.fileName, rows: input.rows.length, valid }));
    return batchId;
  })();
}

export function listImportBatches(db: DB, limit = 20): Omit<ImportBatch, "summary">[] {
  return db
    .prepare(
      `SELECT b.id, b.file_name, b.kind, b.parser_id, b.status, b.total_rows, b.valid_rows, b.error_rows, b.created_at,
              u.name AS created_by_name,
              COALESCE(y.name, json_extract(b.summary, '$.year.name')) AS academic_year
       FROM import_batches b
       LEFT JOIN admin_users u ON u.id = b.created_by
       LEFT JOIN academic_years y ON y.id = b.academic_year_id
       ORDER BY b.id DESC LIMIT ?`,
    )
    .all(limit) as Omit<ImportBatch, "summary">[];
}

export function getImportBatch(db: DB, id: number): { batch: ImportBatch; rows: PreviewRow[] } | null {
  const row = db
    .prepare(
      `SELECT b.id, b.file_name, b.kind, b.parser_id, b.status, b.total_rows, b.valid_rows, b.error_rows, b.created_at,
              b.summary, u.name AS created_by_name,
              COALESCE(y.name, json_extract(b.summary, '$.year.name')) AS academic_year
       FROM import_batches b
       LEFT JOIN admin_users u ON u.id = b.created_by
       LEFT JOIN academic_years y ON y.id = b.academic_year_id
       WHERE b.id = ?`,
    )
    .get(id) as (Omit<ImportBatch, "summary"> & { summary: string | null }) | undefined;
  if (!row) return null;
  const rows = (
    db.prepare("SELECT id, parsed FROM import_rows WHERE batch_id = ? ORDER BY row_number").all(id) as {
      id: number;
      parsed: string;
    }[]
  ).map((r) => ({ ...(JSON.parse(r.parsed) as PreviewRow), id: r.id }));
  const summary: ImportSummary = row.summary
    ? JSON.parse(row.summary)
    : { sections: [], issues: [], google: { checked: false } };
  return { batch: { ...row, summary }, rows };
}

const LOCAL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Önizlemedeki bir satırın e-postasını elle değiştirir; çakışma varsa hata döndürür. */
export function updateRowEmail(
  db: DB,
  input: { batchId: number; rowId: number; local: string; userId: number; googleTaken: Set<string> | null },
): { ok: true; email: string } | { ok: false; error: string } {
  const local = input.local.trim().toLowerCase().split("@")[0];
  if (!LOCAL_RE.test(local) || local.length > 64) {
    return { ok: false, error: "Sadece a-z, 0-9 ve arada nokta, tire, alt çizgi kullanılabilir (en fazla 64 karakter)." };
  }
  if (RESERVED_LOCAL_PARTS.has(local)) return { ok: false, error: `"${local}" ayrılmış bir adres.` };

  const r = db
    .prepare("SELECT id, parsed FROM import_rows WHERE id = ? AND batch_id = ?")
    .get(input.rowId, input.batchId) as { id: number; parsed: string } | undefined;
  if (!r) return { ok: false, error: "Satır bulunamadı." };
  const status = db.prepare("SELECT status FROM import_batches WHERE id = ?").pluck().get(input.batchId);
  if (status !== "PARSED") return { ok: false, error: "Bu içe aktarma artık düzenlenemez." };

  const row = JSON.parse(r.parsed) as PreviewRow;
  if (row.match.kind !== "new") return { ok: false, error: "Sadece yeni açılacak hesapların adresi değiştirilebilir." };

  const email = `${local}@${studentDomain(db)}`;
  if (email === row.email) return { ok: true, email };
  if (dbEmailTaken(db)(email)) return { ok: false, error: `${email} sistemde başka bir kayıtta kullanılıyor.` };
  if (input.googleTaken?.has(email)) return { ok: false, error: `${email} Google'da zaten var.` };
  const inBatch = db
    .prepare("SELECT 1 FROM import_rows WHERE batch_id = ? AND id <> ? AND json_extract(parsed, '$.email') = ?")
    .get(input.batchId, input.rowId, email);
  if (inBatch) return { ok: false, error: `${email} bu listede başka bir öğrenciye önerildi.` };

  const updated: PreviewRow = { ...row, email, emailNote: "manual" };
  db.transaction(() => {
    db.prepare("UPDATE import_rows SET parsed = ?, status = ? WHERE id = ?").run(
      JSON.stringify(updated),
      rowStatus(updated),
      r.id,
    );
    recount(db, input.batchId);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'import.email_edit', 'import_row', ?, ?)",
    ).run(input.userId, String(r.id), JSON.stringify({ from: row.email, to: email }));
  })();
  return { ok: true, email };
}

function recount(db: DB, batchId: number) {
  db.prepare(
    `UPDATE import_batches SET
       valid_rows = (SELECT count(*) FROM import_rows WHERE batch_id = @id AND status = 'VALID'),
       error_rows = (SELECT count(*) FROM import_rows WHERE batch_id = @id AND status <> 'VALID')
     WHERE id = @id`,
  ).run({ id: batchId });
}

export function deleteImportBatch(db: DB, batchId: number, userId: number): boolean {
  const status = db.prepare("SELECT status FROM import_batches WHERE id = ?").pluck().get(batchId);
  if (status !== "PARSED" && status !== "FAILED") return false;
  db.transaction(() => {
    db.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, 'import.delete', 'import_batch', ?)",
    ).run(userId, String(batchId));
  })();
  return true;
}

/**
 * Önizlemede çakışan satır için yöneticinin kararı:
 * "same" = kayıtlı öğrenciyle aynı kişi (numara/isim/sınıf değişmiş), "new" = yeni öğrenci, yeni hesap.
 */
export async function resolveConflict(
  db: DB,
  input: { batchId: number; rowId: number; choice: "same" | "new"; userId: number; googleTaken: Set<string> | null },
): Promise<{ ok: true; row: PreviewRow } | { ok: false; error: string }> {
  const r = db
    .prepare("SELECT id, parsed FROM import_rows WHERE id = ? AND batch_id = ?")
    .get(input.rowId, input.batchId) as { id: number; parsed: string } | undefined;
  if (!r) return { ok: false, error: "Satır bulunamadı." };
  if (db.prepare("SELECT status FROM import_batches WHERE id = ?").pluck().get(input.batchId) !== "PARSED") {
    return { ok: false, error: "Bu içe aktarma artık düzenlenemez." };
  }
  const row = { ...(JSON.parse(r.parsed) as PreviewRow), id: r.id };
  if (row.match.kind !== "conflict") return { ok: false, error: "Bu satırda çakışma yok." };
  if (row.errors.length) return { ok: false, error: row.errors.join("; ") };
  const reason = row.match.reason;
  let updated: PreviewRow;

  if (input.choice === "same") {
    const st = db
      .prepare("SELECT id, email, exit_reason, status FROM students WHERE id = ?")
      .get(row.match.studentId) as { id: number; email: string; exit_reason: string | null; status: string } | undefined;
    if (!st || st.status === "DELETED") return { ok: false, error: "Kayıtlı öğrenci artık yok." };
    const other = db
      .prepare(
        `SELECT json_extract(parsed, '$.firstName') || ' ' || json_extract(parsed, '$.lastName') FROM import_rows
         WHERE batch_id = ? AND id <> ? AND json_extract(parsed, '$.match.kind') = 'matched'
           AND json_extract(parsed, '$.match.studentId') = ?`,
      )
      .pluck()
      .get(input.batchId, r.id, st.id) as string | undefined;
    if (other) return { ok: false, error: `Bu öğrenci listede zaten ${other} satırıyla eşleşti.` };
    updated = {
      ...row,
      match: {
        kind: "matched",
        studentId: st.id,
        existingEmail: st.email,
        manual: true,
        returning: st.exit_reason ? true : undefined,
        warnings: [`Elle eşleştirildi: ${reason}`],
      },
      email: st.email,
      emailNote: "existing",
    };
  } else {
    const takenInDb = dbEmailTaken(db);
    const inBatch = new Set(
      (
        db
          .prepare("SELECT lower(json_extract(parsed, '$.email')) FROM import_rows WHERE batch_id = ? AND id <> ? AND json_extract(parsed, '$.email') IS NOT NULL")
          .pluck()
          .all(input.batchId, r.id) as string[]
      ),
    );
    const domain = studentDomain(db);
    let email: string;
    try {
      email = await pickEmail(
        { firstName: row.firstName, lastName: row.lastName },
        domain,
        async (e) => takenInDb(e) || inBatch.has(e.toLowerCase()) || Boolean(input.googleTaken?.has(e.toLowerCase())),
      );
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const first = emailCandidates({ firstName: row.firstName, lastName: row.lastName }).next().value as string;
    updated = {
      ...row,
      match: { kind: "new", warnings: [`Elle yeni öğrenci olarak işaretlendi: ${reason}`] },
      email,
      emailNote: noteFor(email, first, row),
    };
  }

  db.transaction(() => {
    db.prepare("UPDATE import_rows SET parsed = ?, status = ?, message = NULL WHERE id = ?").run(
      JSON.stringify(updated),
      rowStatus(updated),
      r.id,
    );
    recount(db, input.batchId);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'import.conflict_resolve', 'import_row', ?, ?)",
    ).run(input.userId, String(r.id), JSON.stringify({ choice: input.choice, studentId: row.match.kind === "conflict" ? row.match.studentId : null }));
  })();
  return { ok: true, row: updated };
}

