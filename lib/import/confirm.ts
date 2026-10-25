// Önizlemesi onaylanan listeyi veritabanına yazar ve Google işlerini sync_jobs kuyruğuna ekler.
// Google'a burada hiçbir istek atılmaz; kuyruğu senkronizasyon işçisi sırayla (id sırasıyla) işler:
// önce OU'lar, sonra gruplar, sonra kullanıcılar, en son grup üyelikleri.

import { generatePassword } from "../auth/password.ts";
import type { DB } from "../db.ts";
import { encryptSecret } from "../secret-box.ts";
import { ensureYear, listYearProblem, setCurrentYear } from "../years.ts";
import { confirmSeq, dbEmailTaken, type ImportSummary, type PreviewRow } from "./students.ts";

export interface ConfirmResult {
  created: number;
  updated: number;
  skipped: number; // önizlemede hatalı/çakışmalı olduğu için alınmayan satırlar
  failed: number; // onay anındaki kontrollerde reddedilen satırlar
  sections: number;
  jobs: number;
  returned?: number; // ayrılmış işaretliyken listede yeniden görünenler
  year?: string;
}

const CLUB_OU = "/Kulupler";
const STUDENT_PASSWORD_LENGTH = 10;

export class ConfirmError extends Error {}

export function confirmImportBatch(db: DB, batchId: number, userId: number): ConfirmResult {
  return db.transaction(() => {
    const batch = db
      .prepare("SELECT id, kind, status, academic_year_id, summary FROM import_batches WHERE id = ?")
      .get(batchId) as
      | { id: number; kind: string; status: string; academic_year_id: number | null; summary: string }
      | undefined;
    if (!batch) throw new ConfirmError("Önizleme bulunamadı.");
    if (batch.kind !== "students") throw new ConfirmError("Bu önizleme öğrenci listesi değil.");
    if (batch.status !== "PARSED") throw new ConfirmError("Bu liste zaten onaylanmış ya da işlenmiş.");
    // Önizleme, hazırlandığı andaki öğrenci kayıtlarına göre eşleşti. Arada başka liste onaylandıysa
    // "yeni" görünen öğrenci artık kayıtlı olabilir; tekrar yüklemek gerekir.
    const summary = JSON.parse(batch.summary) as ImportSummary;
    if (!summary.year) throw new ConfirmError("Bu önizlemede eğitim yılı yok. Listeyi tekrar yükleyin.");
    const problem = listYearProblem(db, summary.year.start);
    if (problem) throw new ConfirmError(problem);
    // Listenin yılı güncel yıl olur (aradaki yıllar atlanmış olabilir)
    const year = ensureYear(db, summary.year.start);
    const yearId = year.id;
    setCurrentYear(db, yearId);
    db.prepare("UPDATE import_batches SET academic_year_id = ? WHERE id = ?").run(yearId, batchId);
    const seq = confirmSeq(db);
    if ((summary.basisSeq ?? 0) !== seq) {
      throw new ConfirmError("Bu önizlemeden sonra başka bir liste onaylandı. Listeyi tekrar yükleyip yeni önizlemeyi onaylayın.");
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('import.confirmSeq', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(JSON.stringify(seq + 1));
    const domainId = db.prepare("SELECT id FROM domains WHERE kind = 'STUDENT'").pluck().get() as number;
    const isTaken = dbEmailTaken(db);

    // ───── Kuyruk ─────
    let jobs = 0;
    const enqueue = db.prepare(
      `INSERT INTO sync_jobs (action, entity_type, entity_id, payload, import_batch_id) VALUES (?, ?, ?, ?, ?)`,
    );
    const job = (action: string, entityType: string, entityId: string | number, payload: object) => {
      enqueue.run(action, entityType, String(entityId), JSON.stringify(payload), batchId);
      jobs++;
    };

    // ───── Şubeler, OU'lar, sınıf grupları ─────
    // Listenin kullandığı her OU için oluşturma işi eklenir (işçi önce var mı diye bakar). Eski yıllardan
    // bilinen OU'lar da boş OU temizliğinde silinmiş olabilir; kuyrukta bekleyen varsa tekrar eklenmez.
    const ouQueued = db
      .prepare("SELECT 1 FROM sync_jobs WHERE action = 'CREATE_ORG_UNIT' AND entity_id = ? AND status IN ('QUEUED', 'RUNNING')")
      .pluck();
    const cancelOuDelete = db.prepare(
      `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'OU yeni listede kullanılıyor'
       WHERE action = 'DELETE_ORG_UNIT' AND status IN ('QUEUED', 'FAILED') AND (entity_id = @p OR @p LIKE entity_id || '/%')`,
    );
    const seenOus = new Set<string>();
    const ensureOu = (path: string, name: string, parent: string) => {
      if (seenOus.has(path)) return;
      seenOus.add(path);
      cancelOuDelete.run({ p: path });
      if (!ouQueued.get(path)) job("CREATE_ORG_UNIT", "org_unit", path, { name, parentOrgUnitPath: parent });
    };
    const findGroup = db.prepare("SELECT id, status FROM groups WHERE email = ?");
    const cancelGroupDelete = db.prepare(
      `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Grup yeni listede kullanılıyor'
       WHERE action = 'DELETE_GROUP' AND entity_id = ? AND status IN ('QUEUED', 'FAILED')`,
    );
    const revive = db.prepare("UPDATE groups SET status = 'PENDING', google_group_id = NULL WHERE id = ?");
    const insertGroup = db.prepare(
      "INSERT INTO groups (kind, domain_id, email, name, description) VALUES ('CLASS', ?, ?, ?, ?)",
    );
    const findSection = db
      .prepare("SELECT id FROM class_sections WHERE academic_year_id = ? AND grade = ? AND section = ?")
      .pluck();
    const insertSection = db.prepare(
      `INSERT INTO class_sections (academic_year_id, grade, section, name, field, org_unit_path, group_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateSection = db.prepare(
      "UPDATE class_sections SET field = ?, org_unit_path = ?, group_id = ? WHERE id = ?",
    );

    const sections = new Map<string, { id: number; orgUnitPath: string; groupId: number; groupEmail: string }>();
    for (const s of summary.sections) {
      ensureOu(`/Ogrenciler/${s.grade}`, String(s.grade), "/Ogrenciler");
      ensureOu(s.orgUnitPath, s.key, `/Ogrenciler/${s.grade}`);

      // Grup adresi yıllar boyunca aynı kalır (9a@...); varsa yeniden kullanılır.
      // Temizlikte silindiyse (ya da silinmek üzereyse) yeniden açılır.
      const groupPayload = { email: s.groupEmail, name: `${s.key} Sınıfı`, description: `${s.key} şubesi öğrencileri` };
      const g = findGroup.get(s.groupEmail) as { id: number; status: string } | undefined;
      let groupId: number;
      if (!g) {
        groupId = Number(insertGroup.run(domainId, s.groupEmail, groupPayload.name, groupPayload.description).lastInsertRowid);
        job("CREATE_GROUP", "group", groupId, groupPayload);
      } else {
        groupId = g.id;
        cancelGroupDelete.run(String(g.id));
        if (g.status === "DELETED") {
          revive.run(g.id);
          job("CREATE_GROUP", "group", g.id, groupPayload);
        }
      }

      let sectionId = findSection.get(yearId, s.grade, s.section) as number | undefined;
      if (sectionId) updateSection.run(s.field ?? null, s.orgUnitPath, groupId, sectionId);
      else sectionId = Number(insertSection.run(yearId, s.grade, s.section, s.key, s.field ?? null, s.orgUnitPath, groupId).lastInsertRowid);

      sections.set(s.key, { id: sectionId, orgUnitPath: s.orgUnitPath, groupId, groupEmail: s.groupEmail });
    }

    // ───── Öğrenciler ─────
    const rows = (
      db.prepare("SELECT id, parsed, status FROM import_rows WHERE batch_id = ? ORDER BY row_number").all(batchId) as {
        id: number;
        parsed: string;
        status: string;
      }[]
    ).map((r) => ({ rowId: r.id, status: r.status, row: JSON.parse(r.parsed) as PreviewRow }));

    const setRow = db.prepare("UPDATE import_rows SET status = ?, message = ? WHERE id = ?");
    const enrolledNo = db
      .prepare("SELECT student_id FROM enrollments WHERE academic_year_id = ? AND school_no = ?")
      .pluck();
    const insertStudent = db.prepare(
      `INSERT INTO students (school_no, first_name, last_name, gender, class_id, domain_id, email, org_unit_path, initial_password_enc)
       VALUES (@schoolNo, @firstName, @lastName, @gender, @classId, @domainId, @email, @orgUnitPath, @password)`,
    );
    const getStudent = db.prepare(
      `SELECT id, first_name, last_name, email, org_unit_path, class_id, status, exit_reason, suspended_at,
              google_user_id, initial_password_enc
       FROM students WHERE id = ?`,
    );
    // Okula geri dönen öğrenci: ayrılış bilgileri silinir, bekleyen askı/silme işleri iptal edilir
    const clearExit = db.prepare(
      `UPDATE students SET exit_reason = NULL, graduated_at = NULL, left_at = NULL, suspend_at = NULL, delete_at = NULL,
         suspended_at = NULL, status = @status, initial_password_enc = COALESCE(initial_password_enc, @password)
       WHERE id = @id`,
    );
    const cancelRetention = db.prepare(
      `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Öğrenci okula geri döndü'
       WHERE entity_type = 'student' AND entity_id = ? AND action IN ('SUSPEND_USER', 'DELETE_USER') AND status IN ('QUEUED', 'FAILED')`,
    );
    const seenStudents = new Set<number>();
    const updateStudent = db.prepare(
      `UPDATE students SET school_no = @schoolNo, first_name = @firstName, last_name = @lastName,
         gender = COALESCE(@gender, gender), class_id = @classId, org_unit_path = @orgUnitPath WHERE id = @id`,
    );
    const isOfficer = db
      .prepare("SELECT 1 FROM club_officers WHERE student_id = ? AND ended_at IS NULL LIMIT 1")
      .pluck();
    const upsertEnrollment = db.prepare(
      `INSERT INTO enrollments (student_id, academic_year_id, class_id, school_no, import_batch_id)
       VALUES (@studentId, @yearId, @classId, @schoolNo, @batchId)
       ON CONFLICT (student_id, academic_year_id)
       DO UPDATE SET class_id = excluded.class_id, school_no = excluded.school_no, import_batch_id = excluded.import_batch_id`,
    );
    const addMember = db.prepare(
      `INSERT OR IGNORE INTO group_members (group_id, student_id, member_email) VALUES (?, ?, ?)`,
    );
    const removeMember = db.prepare("DELETE FROM group_members WHERE group_id = ? AND member_email = ?");
    const sectionGroup = db
      .prepare("SELECT c.group_id AS groupId, g.email AS groupEmail FROM class_sections c JOIN groups g ON g.id = c.group_id WHERE c.id = ?");

    const result: ConfirmResult = { created: 0, updated: 0, skipped: 0, failed: 0, sections: sections.size, jobs: 0, returned: 0, year: year.name };

    for (const { rowId, status, row } of rows) {
      if (status !== "VALID" || !row.email) {
        result.skipped++;
        setRow.run("SKIPPED", row.errors.join("; ") || "Önizlemede geçersiz", rowId);
        continue;
      }
      const sec = sections.get(row.sectionKey)!;
      const fail = (message: string) => {
        result.failed++;
        setRow.run("FAILED", message, rowId);
      };

      if (row.match.kind === "new") {
        if (isTaken(row.email)) {
          fail(`${row.email} önizlemeden sonra başka bir kayda verildi.`);
          continue;
        }
        if (enrolledNo.get(yearId, row.schoolNo) !== undefined) {
          fail(`Okul no ${row.schoolNo} bu yıl başka bir öğrenciye kayıtlı.`);
          continue;
        }
        const password = generatePassword(STUDENT_PASSWORD_LENGTH);
        const studentId = Number(
          insertStudent.run({
            schoolNo: row.schoolNo,
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender ?? null,
            classId: sec.id,
            domainId,
            email: row.email,
            orgUnitPath: sec.orgUnitPath,
            password: encryptSecret(password),
          }).lastInsertRowid,
        );
        upsertEnrollment.run({ studentId, yearId, classId: sec.id, schoolNo: row.schoolNo, batchId });
        // Şifre kuyruğa yazılmaz; işçi students.initial_password_enc'ten okur
        job("CREATE_USER", "student", studentId, {
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          orgUnitPath: sec.orgUnitPath,
          changePasswordAtNextLogin: true,
        });
        addMember.run(sec.groupId, studentId, row.email);
        job("ADD_MEMBER", "group", sec.groupId, { groupEmail: sec.groupEmail, memberEmail: row.email, role: "MEMBER" });
        setRow.run("CREATED", null, rowId);
        result.created++;
        continue;
      }

      // Mevcut öğrenci: şube, numara ve ad güncellenir; e-posta değişmez
      const st = getStudent.get(row.match.kind === "matched" ? row.match.studentId : -1) as
        | {
            id: number;
            first_name: string;
            last_name: string;
            email: string;
            org_unit_path: string;
            class_id: number | null;
            status: string;
            exit_reason: string | null;
            suspended_at: string | null;
            google_user_id: string | null;
            initial_password_enc: string | null;
          }
        | undefined;
      if (!st || st.status === "DELETED") {
        fail("Eşleşen öğrenci kaydı artık yok.");
        continue;
      }
      if (seenStudents.has(st.id)) {
        fail("Bu öğrenci listede başka bir satırla da eşleşti.");
        continue;
      }
      seenStudents.add(st.id);
      if (st.exit_reason && !(row.match.kind === "matched" && row.match.returning)) {
        fail("Öğrenci önizlemeden sonra ayrılmış olarak işaretlendi. Listeyi tekrar yükleyin.");
        continue;
      }
      const holder = enrolledNo.get(yearId, row.schoolNo) as number | undefined;
      if (holder !== undefined && holder !== st.id) {
        fail(`Okul no ${row.schoolNo} bu yıl başka bir öğrenciye kayıtlı.`);
        continue;
      }

      // Geri dönüş: hesap açılmadan arşivlendiyse yeniden açılır, askıdaysa askı kalkar
      let reopen = false;
      if (st.exit_reason) {
        reopen = !st.google_user_id;
        clearExit.run({
          id: st.id,
          status: reopen ? "PENDING" : st.status === "SUSPENDED" ? "ACTIVE" : st.status,
          password: st.initial_password_enc ? null : encryptSecret(generatePassword(STUDENT_PASSWORD_LENGTH)),
        });
        cancelRetention.run(String(st.id));
        if (st.google_user_id && (st.suspended_at || st.status === "SUSPENDED")) {
          job("UPDATE_USER", "student", st.id, { email: st.email, suspended: false });
        }
        result.returned = (result.returned ?? 0) + 1;
      }

      // Kulüp görevlileri /Kulupler'de kalır
      const orgUnitPath = isOfficer.get(st.id) ? CLUB_OU : sec.orgUnitPath;
      const oldGroup = st.class_id ? (sectionGroup.get(st.class_id) as { groupId: number; groupEmail: string } | undefined) : undefined;
      updateStudent.run({
        id: st.id,
        schoolNo: row.schoolNo,
        firstName: row.firstName,
        lastName: row.lastName,
        gender: row.gender ?? null,
        classId: sec.id,
        orgUnitPath,
      });
      upsertEnrollment.run({ studentId: st.id, yearId, classId: sec.id, schoolNo: row.schoolNo, batchId });

      if (reopen) {
        job("CREATE_USER", "student", st.id, {
          email: st.email,
          firstName: row.firstName,
          lastName: row.lastName,
          orgUnitPath,
          changePasswordAtNextLogin: true,
        });
      } else {
        const changes: Record<string, string> = {};
        if (orgUnitPath !== st.org_unit_path) changes.orgUnitPath = orgUnitPath;
        if (row.firstName !== st.first_name) changes.firstName = row.firstName;
        if (row.lastName !== st.last_name) changes.lastName = row.lastName;
        if (Object.keys(changes).length) job("UPDATE_USER", "student", st.id, { email: st.email, ...changes });
      }

      if (oldGroup && oldGroup.groupId !== sec.groupId) {
        if (removeMember.run(oldGroup.groupId, st.email).changes) {
          job("REMOVE_MEMBER", "group", oldGroup.groupId, { groupEmail: oldGroup.groupEmail, memberEmail: st.email });
        }
      }
      if (addMember.run(sec.groupId, st.id, st.email).changes) {
        job("ADD_MEMBER", "group", sec.groupId, { groupEmail: sec.groupEmail, memberEmail: st.email, role: "MEMBER" });
      }
      setRow.run("UPDATED", null, rowId);
      result.updated++;
    }

    result.jobs = jobs;
    db.prepare(
      `UPDATE import_batches SET status = 'CONFIRMED', finished_at = datetime('now'),
         valid_rows = ?, error_rows = ?, summary = json_set(summary, '$.result', json(?))
       WHERE id = ?`,
    ).run(result.created + result.updated, result.skipped + result.failed, JSON.stringify(result), batchId);
    db.prepare(
      "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, 'import.confirm', 'import_batch', ?, ?)",
    ).run(userId, String(batchId), JSON.stringify(result));
    return result;
  })();
}
