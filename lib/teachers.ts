// Öğretmen hesapları: ad.soyad@nevzatayazal.k12.tr, /Ogretmenler OU'su, ogretmenler@ grubu.
//
// Öğretmenler panelden tek tek ya da yapıştırılan bir listeyle eklenir (e-Okul'da öğretmen listesi
// biçimi sabit değil). Adres çakışmasında öğrencilerdeki kural geçerli: ikinci isim, sonra sayı eki.
// Ayrılan öğretmen (tayin, emeklilik) /Ogretmenler/Ayrilanlar'a taşınır, gruplardan çıkar;
// ayardaki sürelere göre askıya alınır ve silinir (retention.ts).

import { logAction } from "./audit.ts";
import { generatePassword } from "./auth/password.ts";
import { sqlDate, type DB } from "./db.ts";
import { asciiFold, pickEmail, RESERVED_LOCAL_PARTS, toTitleCaseTr } from "./email.ts";
import { dbEmailTaken } from "./import/students.ts";
import { retentionDates, setting } from "./leavers.ts";
import { decryptSecret, encryptSecret } from "./secret-box.ts";
import { enqueue } from "./sync/queue.ts";

export const TEACHER_OU = "/Ogretmenler";
export const TEACHER_LEFT_OU = "/Ogretmenler/Ayrilanlar";
const TEACHERS_GROUP_LOCAL = "ogretmenler";
const PASSWORD_LENGTH = 12;
const LOCAL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_BATCH = 300;

export class TeacherError extends Error {}

export function teacherDomain(db: DB) {
  return db.prepare("SELECT id, name FROM domains WHERE kind = 'TEACHER'").get() as { id: number; name: string };
}

export function teacherRetentionDays(db: DB) {
  return {
    suspend: setting(db, "retention.teacher.suspendDays", 90),
    remove: setting(db, "retention.teacher.deleteDays", 365),
  };
}

// ───── Liste ─────

export interface TeacherRow {
  id: number;
  first_name: string;
  last_name: string;
  branch: string | null;
  email: string;
  status: string;
  left_at: string | null;
}

export function listTeachers(db: DB, f: { q?: string; left?: boolean }): TeacherRow[] {
  const where = ["status <> 'DELETED'", f.left ? "left_at IS NOT NULL" : "left_at IS NULL"];
  const params: Record<string, string> = {};
  if (f.q?.trim()) {
    const q = f.q.trim();
    where.push("(lower(email) LIKE @fold OR (first_name || ' ' || last_name) LIKE @name OR branch LIKE @name)");
    params.fold = `%${asciiFold(q).replace(/\s+/g, ".")}%`;
    params.name = `%${q}%`;
  }
  return db
    .prepare(
      `SELECT id, first_name, last_name, branch, email, status, left_at FROM teachers
       WHERE ${where.join(" AND ")} ORDER BY last_name, first_name`,
    )
    .all(params) as TeacherRow[];
}

export function getTeacher(db: DB, id: number) {
  const t = db
    .prepare(
      `SELECT id, first_name, last_name, branch, email, status, org_unit_path, google_user_id, left_at, suspend_at,
              delete_at, suspended_at, initial_password_enc IS NOT NULL AS has_password, last_synced_at, created_at
       FROM teachers WHERE id = ?`,
    )
    .get(id) as
    | (TeacherRow & {
        org_unit_path: string;
        google_user_id: string | null;
        suspend_at: string | null;
        delete_at: string | null;
        suspended_at: string | null;
        has_password: number;
        last_synced_at: string | null;
        created_at: string;
      })
    | undefined;
  if (!t) return null;
  const groups = db
    .prepare(
      `SELECT g.id, g.email, g.name, m.status FROM group_members m JOIN groups g ON g.id = m.group_id
       WHERE m.teacher_id = ? ORDER BY g.email`,
    )
    .all(id) as { id: number; email: string; name: string; status: string }[];
  const clubs = db
    .prepare(
      `SELECT k.id, k.name, a.started_at FROM club_advisors a JOIN clubs k ON k.id = a.club_id
       WHERE a.teacher_id = ? AND a.ended_at IS NULL ORDER BY k.name`,
    )
    .all(id) as { id: number; name: string; started_at: string }[];
  return { teacher: t, groups, clubs };
}

// ───── Ekleme ─────

export interface TeacherDraft {
  line: number;
  firstName: string;
  lastName: string;
  branch?: string;
  email: string | null;
  /** Aynı isimde kayıtlı öğretmen ya da okunamayan satır */
  warning?: string;
  error?: string;
}

/**
 * Yapıştırılan liste: her satır "Ad Soyad" ya da "Ad Soyad; Branş" (noktalı virgül, sekme ya da virgül).
 * Son kelime soyadı sayılır; birden fazla soyadı varsa satır sonradan düzeltilebilir.
 */
export function parseTeacherLines(text: string): { line: number; firstName: string; lastName: string; branch?: string; error?: string }[] {
  const out: ReturnType<typeof parseTeacherLines> = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const [namePart, branchPart] = line.split(/\t|;|,/).map((x) => x.trim());
    const words = (namePart ?? "").split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      out.push({ line: i + 1, firstName: namePart ?? "", lastName: "", error: "Ad ve soyad gerekli" });
      return;
    }
    out.push({
      line: i + 1,
      firstName: toTitleCaseTr(words.slice(0, -1).join(" ")),
      lastName: toTitleCaseTr(words.at(-1)!),
      branch: branchPart ? toTitleCaseTr(branchPart) : undefined,
    });
  });
  return out;
}

/** Satırlar için adres önerir; veritabanına yazmaz */
export async function draftTeachers(db: DB, text: string, googleTaken: Set<string> | null): Promise<TeacherDraft[]> {
  const parsed = parseTeacherLines(text);
  if (parsed.length > MAX_BATCH) throw new TeacherError(`Bir seferde en fazla ${MAX_BATCH} öğretmen eklenebilir.`);
  const domain = teacherDomain(db).name;
  const taken = dbEmailTaken(db);
  const reserved = new Set<string>();
  const sameName = db.prepare(
    "SELECT email FROM teachers WHERE status <> 'DELETED' AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)",
  ).pluck();
  const out: TeacherDraft[] = [];
  for (const p of parsed) {
    if (p.error) {
      out.push({ ...p, email: null });
      continue;
    }
    const existing = sameName.get(p.firstName, p.lastName) as string | undefined;
    let email: string | null = null;
    let error: string | undefined;
    try {
      email = await pickEmail({ firstName: p.firstName, lastName: p.lastName }, domain, async (e) => taken(e) || Boolean(googleTaken?.has(e)), {
        reservedInBatch: reserved,
      });
    } catch (e) {
      error = (e as Error).message;
    }
    out.push({ ...p, email, error, warning: existing ? `Aynı isimde kayıtlı öğretmen var (${existing})` : undefined });
  }
  return out;
}

function checkTeacherEmail(db: DB, email: string, googleTaken: Set<string> | null, inBatch: Set<string>) {
  const domain = teacherDomain(db).name;
  const [local, host] = email.toLowerCase().split("@");
  if (host !== domain) throw new TeacherError(`${email}: adres @${domain} ile bitmeli.`);
  if (!LOCAL_RE.test(local) || local.length > 64) throw new TeacherError(`${email}: geçersiz kullanıcı adı.`);
  if (RESERVED_LOCAL_PARTS.has(local)) throw new TeacherError(`${email}: ayrılmış bir adres.`);
  if (inBatch.has(email.toLowerCase())) throw new TeacherError(`${email} listede iki kez var.`);
  if (dbEmailTaken(db)(email)) throw new TeacherError(`${email} sistemde başka bir kayıtta kullanılıyor.`);
  if (googleTaken?.has(email.toLowerCase())) throw new TeacherError(`${email} Google'da zaten var.`);
  inBatch.add(email.toLowerCase());
}

/** Öğretmenler grubu (ogretmenler@...); yoksa açılır */
function teachersGroup(db: DB): { id: number; email: string } {
  const g = db.prepare("SELECT id, email, status FROM groups WHERE kind = 'TEACHERS' ORDER BY id LIMIT 1").get() as
    | { id: number; email: string; status: string }
    | undefined;
  if (g && g.status !== "DELETED") return g;
  const d = teacherDomain(db);
  const email = `${TEACHERS_GROUP_LOCAL}@${d.name}`;
  const payload = { email, name: "Öğretmenler", description: "Okulun bütün öğretmenleri" };
  if (g) {
    db.prepare("UPDATE groups SET status = 'PENDING', google_group_id = NULL WHERE id = ?").run(g.id);
    enqueue(db, "CREATE_GROUP", "group", g.id, payload);
    return g;
  }
  const id = Number(
    db
      .prepare("INSERT INTO groups (kind, domain_id, email, name, description) VALUES ('TEACHERS', ?, ?, ?, ?)")
      .run(d.id, email, payload.name, payload.description).lastInsertRowid,
  );
  enqueue(db, "CREATE_GROUP", "group", id, payload);
  return { id, email };
}

/** OU daha önce oluşturulmadıysa ya da kuyrukta değilse oluşturma işi ekler */
function ensureOrgUnit(db: DB, path: string) {
  const known = db
    .prepare("SELECT 1 FROM sync_jobs WHERE action = 'CREATE_ORG_UNIT' AND entity_id = ? AND status IN ('QUEUED', 'RUNNING', 'DONE')")
    .get(path);
  if (known) return;
  const i = path.lastIndexOf("/");
  enqueue(db, "CREATE_ORG_UNIT", "org_unit", path, { name: path.slice(i + 1), parentOrgUnitPath: path.slice(0, i) || "/" });
}

export function createTeachers(
  db: DB,
  rows: { firstName: string; lastName: string; branch?: string; email: string }[],
  userId: number,
  googleTaken: Set<string> | null,
): number[] {
  if (!rows.length) throw new TeacherError("Eklenecek öğretmen yok.");
  if (rows.length > MAX_BATCH) throw new TeacherError(`Bir seferde en fazla ${MAX_BATCH} öğretmen eklenebilir.`);
  return db.transaction(() => {
    const domain = teacherDomain(db);
    const inBatch = new Set<string>();
    ensureOrgUnit(db, TEACHER_OU);
    const group = teachersGroup(db);
    const insert = db.prepare(
      `INSERT INTO teachers (first_name, last_name, branch, domain_id, email, org_unit_path, initial_password_enc)
       VALUES (@firstName, @lastName, @branch, @domainId, @email, @ou, @password)`,
    );
    const ids: number[] = [];
    for (const r of rows) {
      const firstName = toTitleCaseTr(r.firstName.trim().replace(/\s+/g, " "));
      const lastName = toTitleCaseTr(r.lastName.trim().replace(/\s+/g, " "));
      if (!firstName || !lastName) throw new TeacherError("Ad ve soyad gerekli.");
      const email = r.email.trim().toLowerCase();
      checkTeacherEmail(db, email, googleTaken, inBatch);
      const id = Number(
        insert.run({
          firstName,
          lastName,
          branch: r.branch?.trim() || null,
          domainId: domain.id,
          email,
          ou: TEACHER_OU,
          password: encryptSecret(generatePassword(PASSWORD_LENGTH)),
        }).lastInsertRowid,
      );
      enqueue(db, "CREATE_USER", "teacher", id, { email, firstName, lastName, orgUnitPath: TEACHER_OU, changePasswordAtNextLogin: true });
      db.prepare("INSERT OR IGNORE INTO group_members (group_id, teacher_id, member_email) VALUES (?, ?, ?)").run(group.id, id, email);
      enqueue(db, "ADD_MEMBER", "group", group.id, { groupEmail: group.email, memberEmail: email, role: "MEMBER" });
      ids.push(id);
    }
    logAction(db, userId, "teacher.create", "teacher", null, { count: ids.length, ids });
    return ids;
  })();
}

// ───── Düzenleme ─────

export function updateTeacher(db: DB, id: number, input: { firstName: string; lastName: string; branch?: string }, userId: number) {
  const firstName = toTitleCaseTr(input.firstName.trim().replace(/\s+/g, " "));
  const lastName = toTitleCaseTr(input.lastName.trim().replace(/\s+/g, " "));
  if (!firstName || !lastName) throw new TeacherError("Ad ve soyad gerekli.");
  db.transaction(() => {
    const t = db.prepare("SELECT id, email, first_name, last_name, status FROM teachers WHERE id = ?").get(id) as
      | { id: number; email: string; first_name: string; last_name: string; status: string }
      | undefined;
    if (!t || t.status === "DELETED") throw new TeacherError("Öğretmen bulunamadı.");
    db.prepare("UPDATE teachers SET first_name = ?, last_name = ?, branch = ? WHERE id = ?").run(
      firstName,
      lastName,
      input.branch?.trim() || null,
      id,
    );
    // Adres değişmez; Google'daki görünen ad güncellenir
    if (firstName !== t.first_name || lastName !== t.last_name) {
      enqueue(db, "UPDATE_USER", "teacher", id, { email: t.email, firstName, lastName });
    }
    logAction(db, userId, "teacher.update", "teacher", id, { firstName, lastName });
  })();
}

// ───── Ayrılış ─────

export function markTeacherLeft(db: DB, id: number, userId: number, now = new Date()) {
  db.transaction(() => {
    const t = db.prepare("SELECT id, email, org_unit_path, left_at, status, google_user_id FROM teachers WHERE id = ?").get(id) as
      | { id: number; email: string; org_unit_path: string; left_at: string | null; status: string; google_user_id: string | null }
      | undefined;
    if (!t || t.status === "DELETED") throw new TeacherError("Öğretmen bulunamadı.");
    if (t.left_at) throw new TeacherError("Öğretmen zaten ayrılmış olarak işaretli.");

    // Kulüp görevleri (danışman takma adı) biter
    const roles = db.prepare("SELECT id, alias_email FROM club_officers WHERE teacher_id = ? AND ended_at IS NULL").all(id) as {
      id: number;
      alias_email: string;
    }[];
    for (const r of roles) {
      db.prepare("UPDATE club_officers SET ended_at = datetime('now'), status = 'ARCHIVED' WHERE id = ?").run(r.id);
      enqueue(db, "REMOVE_ALIAS", "teacher", id, { email: t.email, alias: r.alias_email });
    }
    // Kulüp danışmanlıkları biter; kulüp gruplarındaki yöneticilik aşağıdaki üyeliklerle birlikte kalkar
    db.prepare("UPDATE club_advisors SET ended_at = datetime('now') WHERE teacher_id = ? AND ended_at IS NULL").run(id);
    const memberships = db
      .prepare("SELECT m.id, g.id AS group_id, g.email AS group_email FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.teacher_id = ?")
      .all(id) as { id: number; group_id: number; group_email: string }[];
    for (const m of memberships) {
      db.prepare("DELETE FROM group_members WHERE id = ?").run(m.id);
      enqueue(db, "REMOVE_MEMBER", "group", m.group_id, { groupEmail: m.group_email, memberEmail: t.email });
    }

    const dates = retentionDates(now, teacherRetentionDays(db), now);
    db.prepare("UPDATE teachers SET left_at = ?, suspend_at = ?, delete_at = ?, org_unit_path = ? WHERE id = ?").run(
      sqlDate(now),
      sqlDate(dates.suspend),
      sqlDate(dates.remove),
      TEACHER_LEFT_OU,
      id,
    );
    if (t.google_user_id) {
      ensureOrgUnit(db, TEACHER_LEFT_OU);
      enqueue(db, "UPDATE_USER", "teacher", id, { email: t.email, orgUnitPath: TEACHER_LEFT_OU });
    }
    if (!t.google_user_id) {
      // Hesap hiç açılmadı: açma dahil bekleyen işler iptal, kayıt arşiv
      db.prepare(
        `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Öğretmen ayrıldı'
         WHERE status IN ('QUEUED', 'FAILED')
           AND ((entity_type = 'teacher' AND entity_id = @id)
             OR json_extract(payload, '$.email') = @email OR json_extract(payload, '$.memberEmail') = @email)`,
      ).run({ id: String(id), email: t.email });
      db.prepare("UPDATE teachers SET status = 'ARCHIVED' WHERE id = ?").run(id);
    }
    logAction(db, userId, "teacher.leave", "teacher", id);
  })();
}

/** Yanlış işaretlemeyi geri alır (hesap askıya alınmadıysa) */
export function undoTeacherLeft(db: DB, id: number, userId: number) {
  db.transaction(() => {
    const t = db.prepare("SELECT id, email, left_at, suspended_at, status, google_user_id FROM teachers WHERE id = ?").get(id) as
      | { id: number; email: string; left_at: string | null; suspended_at: string | null; status: string; google_user_id: string | null }
      | undefined;
    if (!t?.left_at) throw new TeacherError("Öğretmen ayrılmış olarak işaretli değil.");
    if (t.suspended_at || t.status === "SUSPENDED" || t.status === "DELETED") {
      throw new TeacherError("Hesap askıya alınmış; geri almak için önce Google'da askıyı kaldırın.");
    }
    db.prepare(
      `UPDATE sync_jobs SET status = 'CANCELLED' WHERE entity_type = 'teacher' AND entity_id = ?
       AND action IN ('SUSPEND_USER', 'DELETE_USER') AND status = 'QUEUED'`,
    ).run(String(id));
    const reopen = !t.google_user_id && t.status === "ARCHIVED";
    db.prepare(
      "UPDATE teachers SET left_at = NULL, suspend_at = NULL, delete_at = NULL, org_unit_path = ?, status = ? WHERE id = ?",
    ).run(TEACHER_OU, reopen ? "PENDING" : t.status, id);
    const group = teachersGroup(db);
    if (reopen) {
      const n = db.prepare("SELECT first_name, last_name FROM teachers WHERE id = ?").get(id) as { first_name: string; last_name: string };
      ensureOrgUnit(db, TEACHER_OU);
      enqueue(db, "CREATE_USER", "teacher", id, {
        email: t.email,
        firstName: n.first_name,
        lastName: n.last_name,
        orgUnitPath: TEACHER_OU,
        changePasswordAtNextLogin: true,
      });
    } else {
      enqueue(db, "UPDATE_USER", "teacher", id, { email: t.email, orgUnitPath: TEACHER_OU });
    }
    db.prepare("INSERT OR IGNORE INTO group_members (group_id, teacher_id, member_email) VALUES (?, ?, ?)").run(group.id, id, t.email);
    enqueue(db, "ADD_MEMBER", "group", group.id, { groupEmail: group.email, memberEmail: t.email, role: "MEMBER" });
    logAction(db, userId, "teacher.leave_undo", "teacher", id);
  })();
}

/** Okuldaki öğretmenlerin ilk şifreleri, toplu çıktı için. Her açılış kayda geçer. */
export function teacherPasswordSlips(db: DB, userId: number) {
  const rows = db
    .prepare(
      `SELECT id, first_name, last_name, branch, email, status, initial_password_enc FROM teachers
       WHERE left_at IS NULL AND status NOT IN ('SUSPENDED', 'ARCHIVED', 'DELETED') AND initial_password_enc IS NOT NULL
       ORDER BY last_name, first_name`,
    )
    .all() as {
    id: number;
    first_name: string;
    last_name: string;
    branch: string | null;
    email: string;
    status: string;
    initial_password_enc: string;
  }[];
  logAction(db, userId, "teacher.password_slips", "teacher", null, { count: rows.length });
  return rows.map(({ initial_password_enc, ...r }) => ({ ...r, password: decryptSecret(initial_password_enc) }));
}

export function revealTeacherPassword(db: DB, id: number, userId: number): string | null {
  const enc = db.prepare("SELECT initial_password_enc FROM teachers WHERE id = ?").pluck().get(id) as string | null | undefined;
  if (!enc) return null;
  logAction(db, userId, "teacher.password_view", "teacher", id);
  return decryptSecret(enc);
}
