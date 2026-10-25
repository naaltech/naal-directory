// Kulüpler: kulupkodu@naal.org.tr grubu, üyeler ve yönetim kadrosu.
// Kadroya ayrı hesap açılmaz: öğrencinin kendi hesabına isim@naal.org.tr takma adı eklenir,
// hesap /Kulupler OU'suna taşınır. Görev bitince takma ad kalkar, hesap şube OU'suna döner.

import { logAction } from "./audit.ts";
import type { DB } from "./db.ts";
import { asciiFold, pickEmail, RESERVED_LOCAL_PARTS } from "./email.ts";
import { dbEmailTaken } from "./import/students.ts";
import { enqueue } from "./sync/queue.ts";

export const CLUB_OU = "/Kulupler";
const LOCAL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
export const OFFICER_TITLE_KEYS = ["PRESIDENT", "VICE_PRESIDENT", "SECRETARY", "TREASURER", "BOARD_MEMBER"] as const;
export type OfficerTitle = (typeof OFFICER_TITLE_KEYS)[number];

export class ClubError extends Error {}

export function clubDomain(db: DB) {
  return db.prepare("SELECT id, name FROM domains WHERE kind = 'CLUB'").get() as { id: number; name: string };
}

function checkLocal(local: string) {
  if (!LOCAL_RE.test(local) || local.length > 64) {
    throw new ClubError("Sadece a-z, 0-9 ve arada nokta, tire, alt çizgi kullanılabilir (en fazla 64 karakter).");
  }
  if (RESERVED_LOCAL_PARTS.has(local)) throw new ClubError(`"${local}" ayrılmış bir adres.`);
}

function checkFree(db: DB, email: string, googleTaken: Set<string> | null) {
  if (dbEmailTaken(db)(email)) throw new ClubError(`${email} veritabanında başka bir kayıtta kullanılıyor.`);
  if (googleTaken?.has(email.toLowerCase())) throw new ClubError(`${email} Google'da kullanılıyor.`);
}

// ───── Kulüpler ─────

export interface ClubRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: number;
  email: string | null;
  group_status: string | null;
  members: number;
  officers: number;
  /** Aktif danışmanların adları, virgülle */
  advisors: string | null;
}

export function listClubs(db: DB): ClubRow[] {
  return db
    .prepare(
      `SELECT k.id, k.code, k.name, k.description, k.is_active, g.email, g.status AS group_status,
              (SELECT count(*) FROM club_members m WHERE m.club_id = k.id) AS members,
              (SELECT count(*) FROM club_officers o WHERE o.club_id = k.id AND o.ended_at IS NULL) AS officers,
              (SELECT group_concat(t.first_name || ' ' || t.last_name, ', ') FROM club_advisors a
                 JOIN teachers t ON t.id = a.teacher_id WHERE a.club_id = k.id AND a.ended_at IS NULL) AS advisors
       FROM clubs k LEFT JOIN groups g ON g.id = k.group_id
       ORDER BY k.is_active DESC, k.name`,
    )
    .all() as ClubRow[];
}

export function getClub(db: DB, id: number) {
  const club = db
    .prepare(
      `SELECT k.id, k.code, k.name, k.description, k.is_active, k.group_id, g.email, g.status AS group_status
       FROM clubs k LEFT JOIN groups g ON g.id = k.group_id WHERE k.id = ?`,
    )
    .get(id) as
    | {
        id: number;
        code: string;
        name: string;
        description: string | null;
        is_active: number;
        group_id: number | null;
        email: string | null;
        group_status: string | null;
      }
    | undefined;
  if (!club) return null;
  const officers = db
    .prepare(
      `SELECT o.id, o.title, o.alias_email, o.status, o.started_at, s.id AS student_id, s.first_name, s.last_name,
              s.email AS student_email, c.name AS class_name
       FROM club_officers o JOIN students s ON s.id = o.student_id LEFT JOIN class_sections c ON c.id = s.class_id
       WHERE o.club_id = ? AND o.ended_at IS NULL
       ORDER BY CASE o.title WHEN 'PRESIDENT' THEN 0 WHEN 'VICE_PRESIDENT' THEN 1 WHEN 'SECRETARY' THEN 2
                WHEN 'TREASURER' THEN 3 ELSE 4 END, s.last_name`,
    )
    .all(id) as {
    id: number;
    title: OfficerTitle;
    alias_email: string;
    status: string;
    started_at: string;
    student_id: number;
    first_name: string;
    last_name: string;
    student_email: string;
    class_name: string | null;
  }[];
  const pastOfficers = db
    .prepare(
      `SELECT o.id, o.title, o.alias_email, o.started_at, o.ended_at, s.id AS student_id, s.first_name, s.last_name
       FROM club_officers o JOIN students s ON s.id = o.student_id
       WHERE o.club_id = ? AND o.ended_at IS NOT NULL ORDER BY o.ended_at DESC LIMIT 50`,
    )
    .all(id) as {
    id: number;
    title: OfficerTitle;
    alias_email: string;
    started_at: string;
    ended_at: string;
    student_id: number;
    first_name: string;
    last_name: string;
  }[];
  const members = db
    .prepare(
      `SELECT s.id, s.first_name, s.last_name, s.email, s.status, c.name AS class_name, m.joined_at,
              gm.status AS member_status
       FROM club_members m JOIN students s ON s.id = m.student_id
       LEFT JOIN class_sections c ON c.id = s.class_id
       LEFT JOIN group_members gm ON gm.group_id = ? AND gm.student_id = s.id
       WHERE m.club_id = ? ORDER BY c.grade, c.section, s.last_name`,
    )
    .all(club.group_id, id) as {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    status: string;
    class_name: string | null;
    joined_at: string;
    member_status: string | null;
  }[];
  const advisors = db
    .prepare(
      `SELECT a.id, a.started_at, a.ended_at, t.id AS teacher_id, t.first_name, t.last_name, t.email, t.branch,
              gm.status AS member_status
       FROM club_advisors a JOIN teachers t ON t.id = a.teacher_id
       LEFT JOIN group_members gm ON gm.group_id = ? AND gm.teacher_id = t.id
       WHERE a.club_id = ? ORDER BY a.ended_at IS NOT NULL, a.ended_at DESC, t.first_name`,
    )
    .all(club.group_id, id) as {
    id: number;
    started_at: string;
    ended_at: string | null;
    teacher_id: number;
    first_name: string;
    last_name: string;
    email: string;
    branch: string | null;
    member_status: string | null;
  }[];
  return { club, officers, pastOfficers, members, advisors };
}

export function createClub(
  db: DB,
  input: { code: string; name: string; description?: string },
  userId: number,
  googleTaken: Set<string> | null,
): number {
  const code = input.code.trim().toLowerCase();
  const name = input.name.trim().replace(/\s+/g, " ");
  checkLocal(code);
  if (name.length < 2) throw new ClubError("Kulüp adı gerekli.");
  const domain = clubDomain(db);
  const email = `${code}@${domain.name}`;

  return db.transaction(() => {
    const existing = db.prepare("SELECT name, is_active FROM clubs WHERE code = ?").get(code) as { name: string; is_active: number } | undefined;
    if (existing) {
      throw new ClubError(
        existing.is_active
          ? `"${code}" kodlu kulüp zaten var.`
          : `"${code}" kodu kapatılmış ${existing.name} kulübüne ait; başka bir kod seçin.`,
      );
    }
    checkFree(db, email, googleTaken);
    const description = input.description?.trim() || `${name} kulübü`;
    const groupId = Number(
      db
        .prepare("INSERT INTO groups (kind, domain_id, email, name, description) VALUES ('CLUB', ?, ?, ?, ?)")
        .run(domain.id, email, name, description).lastInsertRowid,
    );
    const yearId = db.prepare("SELECT id FROM academic_years WHERE is_current = 1").pluck().get() ?? null;
    const clubId = Number(
      db
        .prepare("INSERT INTO clubs (code, name, description, academic_year_id, group_id) VALUES (?, ?, ?, ?, ?)")
        .run(code, name, description, yearId, groupId).lastInsertRowid,
    );
    enqueue(db, "CREATE_GROUP", "group", groupId, { email, name, description });
    logAction(db, userId, "club.create", "club", clubId, { code, name });
    return clubId;
  })();
}

// ───── Üyeler ─────

function activeStudent(db: DB, studentId: number) {
  const s = db
    .prepare(
      `SELECT s.id, s.email, s.first_name, s.last_name, s.org_unit_path, s.exit_reason, s.status, c.org_unit_path AS class_ou
       FROM students s LEFT JOIN class_sections c ON c.id = s.class_id WHERE s.id = ?`,
    )
    .get(studentId) as
    | {
        id: number;
        email: string;
        first_name: string;
        last_name: string;
        org_unit_path: string;
        exit_reason: string | null;
        status: string;
        class_ou: string | null;
      }
    | undefined;
  if (!s) throw new ClubError("Öğrenci bulunamadı.");
  if (s.exit_reason || s.status === "DELETED" || s.status === "SUSPENDED") {
    throw new ClubError(`${s.first_name} ${s.last_name} okulda değil.`);
  }
  return s;
}

function clubGroup(db: DB, clubId: number) {
  const g = db
    .prepare("SELECT g.id, g.email FROM clubs k JOIN groups g ON g.id = k.group_id WHERE k.id = ?")
    .get(clubId) as { id: number; email: string } | undefined;
  if (!g) throw new ClubError("Kulübün grubu yok.");
  return g;
}

/** Üye ekler; zaten üyeyse bir şey yapmaz. Eklenen sayısını döndürür. */
export function addMembers(db: DB, clubId: number, studentIds: number[], userId: number): number {
  return db.transaction(() => {
    const g = clubGroup(db, clubId);
    let added = 0;
    for (const sid of studentIds) {
      const s = activeStudent(db, sid);
      const r = db.prepare("INSERT OR IGNORE INTO club_members (club_id, student_id) VALUES (?, ?)").run(clubId, sid);
      if (!r.changes) continue;
      if (db.prepare("INSERT OR IGNORE INTO group_members (group_id, student_id, member_email) VALUES (?, ?, ?)").run(g.id, sid, s.email).changes) {
        enqueue(db, "ADD_MEMBER", "group", g.id, { groupEmail: g.email, memberEmail: s.email, role: "MEMBER" });
      }
      added++;
    }
    if (added) logAction(db, userId, "club.members_add", "club", clubId, { studentIds });
    return added;
  })();
}

export function removeMember(db: DB, clubId: number, studentId: number, userId: number) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM club_officers WHERE club_id = ? AND student_id = ? AND ended_at IS NULL").get(clubId, studentId)) {
      throw new ClubError("Öğrencinin bu kulüpte aktif görevi var; önce görevi sonlandırın.");
    }
    const g = clubGroup(db, clubId);
    db.prepare("DELETE FROM club_members WHERE club_id = ? AND student_id = ?").run(clubId, studentId);
    const email = db.prepare("SELECT email FROM students WHERE id = ?").pluck().get(studentId) as string;
    if (db.prepare("DELETE FROM group_members WHERE group_id = ? AND student_id = ?").run(g.id, studentId).changes) {
      enqueue(db, "REMOVE_MEMBER", "group", g.id, { groupEmail: g.email, memberEmail: email });
    }
    logAction(db, userId, "club.member_remove", "club", clubId, { studentId });
  })();
}

// ───── Yönetim kadrosu ─────

/** isim@naal.org.tr önerisi: ad, çakışmada ikinci isim, sonra ad.soyad */
export async function suggestAlias(db: DB, studentId: number, googleTaken: Set<string> | null): Promise<string> {
  const s = db.prepare("SELECT first_name, last_name FROM students WHERE id = ?").get(studentId) as
    | { first_name: string; last_name: string }
    | undefined;
  if (!s) throw new ClubError("Öğrenci bulunamadı.");
  const taken = dbEmailTaken(db);
  const email = await pickEmail(
    { firstName: s.first_name, lastName: s.last_name },
    clubDomain(db).name,
    async (e) => taken(e) || Boolean(googleTaken?.has(e.toLowerCase())),
    { strategy: "firstName" },
  );
  return email.split("@")[0];
}

export function assignOfficer(
  db: DB,
  input: { clubId: number; studentId: number; title: OfficerTitle; aliasLocal: string },
  userId: number,
  googleTaken: Set<string> | null,
): number {
  const local = input.aliasLocal.trim().toLowerCase().split("@")[0];
  checkLocal(local);
  if (!OFFICER_TITLE_KEYS.includes(input.title)) throw new ClubError("Geçersiz görev.");
  const domain = clubDomain(db);
  const alias = `${local}@${domain.name}`;

  return db.transaction(() => {
    const s = activeStudent(db, input.studentId);
    if (db.prepare("SELECT 1 FROM club_officers WHERE club_id = ? AND student_id = ? AND ended_at IS NULL").get(input.clubId, s.id)) {
      throw new ClubError("Öğrencinin bu kulüpte zaten görevi var.");
    }
    checkFree(db, alias, googleTaken);

    // Görevli kulübün üyesi de olur
    addMembers(db, input.clubId, [s.id], userId);
    const wasOfficer = db.prepare("SELECT 1 FROM club_officers WHERE student_id = ? AND ended_at IS NULL").get(s.id);
    const id = Number(
      db
        .prepare("INSERT INTO club_officers (club_id, domain_id, student_id, title, alias_email) VALUES (?, ?, ?, ?, ?)")
        .run(input.clubId, domain.id, s.id, input.title, alias).lastInsertRowid,
    );
    enqueue(db, "ADD_ALIAS", "student", s.id, { email: s.email, alias });
    if (!wasOfficer && s.org_unit_path !== CLUB_OU) {
      db.prepare("UPDATE students SET org_unit_path = ? WHERE id = ?").run(CLUB_OU, s.id);
      enqueue(db, "UPDATE_USER", "student", s.id, { email: s.email, orgUnitPath: CLUB_OU });
    }
    logAction(db, userId, "club.officer_assign", "club", input.clubId, { studentId: s.id, title: input.title, alias });
    return id;
  })();
}

/** Görevi sonlandırır: takma ad kalkar; başka görevi yoksa hesap şube OU'suna döner */
export function endOfficer(db: DB, officerId: number, userId: number) {
  db.transaction(() => {
    const o = db
      .prepare(
        `SELECT o.id, o.club_id, o.alias_email, s.id AS student_id, s.email, s.org_unit_path, c.org_unit_path AS class_ou
         FROM club_officers o JOIN students s ON s.id = o.student_id LEFT JOIN class_sections c ON c.id = s.class_id
         WHERE o.id = ? AND o.ended_at IS NULL`,
      )
      .get(officerId) as
      | { id: number; club_id: number; alias_email: string; student_id: number; email: string; org_unit_path: string; class_ou: string | null }
      | undefined;
    if (!o) throw new ClubError("Aktif görev bulunamadı.");
    endOfficerRow(db, o);
    logAction(db, userId, "club.officer_end", "club", o.club_id, { studentId: o.student_id, alias: o.alias_email });
  })();
}

/** Mezuniyet/nakilde de kullanılır; OU'yu sadece hesap hâlâ /Kulupler'deyse geri alır */
export function endOfficerRow(
  db: DB,
  o: { id: number; alias_email: string; student_id: number; email: string; org_unit_path: string; class_ou: string | null },
  opts: { restoreOu?: boolean } = {},
) {
  db.prepare("UPDATE club_officers SET ended_at = datetime('now'), status = 'ARCHIVED' WHERE id = ?").run(o.id);
  enqueue(db, "REMOVE_ALIAS", "student", o.student_id, { email: o.email, alias: o.alias_email });
  const stillOfficer = db.prepare("SELECT 1 FROM club_officers WHERE student_id = ? AND ended_at IS NULL").get(o.student_id);
  if ((opts.restoreOu ?? true) && !stillOfficer && o.org_unit_path === CLUB_OU) {
    const ou = o.class_ou ?? "/Ogrenciler";
    db.prepare("UPDATE students SET org_unit_path = ? WHERE id = ?").run(ou, o.student_id);
    enqueue(db, "UPDATE_USER", "student", o.student_id, { email: o.email, orgUnitPath: ou });
  }
}

// ───── Danışman öğretmenler ─────

/** Danışman olabilecek öğretmenler: okulda olan (ayrılmamış, silinmemiş), bu kulüpte zaten danışman olmayan */
export function advisorCandidates(db: DB, clubId: number) {
  return db
    .prepare(
      `SELECT t.id, t.first_name, t.last_name, t.email, t.branch FROM teachers t
       WHERE t.left_at IS NULL AND t.status NOT IN ('DELETED', 'ARCHIVED', 'SUSPENDED')
         AND NOT EXISTS (SELECT 1 FROM club_advisors a WHERE a.club_id = ? AND a.teacher_id = t.id AND a.ended_at IS NULL)
       ORDER BY t.first_name, t.last_name`,
    )
    .all(clubId) as { id: number; first_name: string; last_name: string; email: string; branch: string | null }[];
}

/** Danışman ekler: öğretmen kulüp grubuna Yönetici (MANAGER) olarak eklenir */
export function assignAdvisor(db: DB, clubId: number, teacherId: number, userId: number): number {
  return db.transaction(() => {
    const k = db.prepare("SELECT is_active FROM clubs WHERE id = ?").get(clubId) as { is_active: number } | undefined;
    if (!k) throw new ClubError("Kulüp bulunamadı.");
    if (!k.is_active) throw new ClubError("Kapatılmış kulübe danışman atanamaz.");
    const t = db.prepare("SELECT id, email, first_name, last_name, left_at, status FROM teachers WHERE id = ?").get(teacherId) as
      | { id: number; email: string; first_name: string; last_name: string; left_at: string | null; status: string }
      | undefined;
    if (!t) throw new ClubError("Öğretmen bulunamadı.");
    if (t.left_at || ["DELETED", "ARCHIVED", "SUSPENDED"].includes(t.status)) {
      throw new ClubError(`${t.first_name} ${t.last_name} okulda değil.`);
    }
    if (db.prepare("SELECT 1 FROM club_advisors WHERE club_id = ? AND teacher_id = ? AND ended_at IS NULL").get(clubId, teacherId)) {
      throw new ClubError(`${t.first_name} ${t.last_name} bu kulübün zaten danışmanı.`);
    }
    const g = clubGroup(db, clubId);
    const id = Number(db.prepare("INSERT INTO club_advisors (club_id, teacher_id) VALUES (?, ?)").run(clubId, teacherId).lastInsertRowid);
    const member = db
      .prepare("INSERT OR IGNORE INTO group_members (group_id, role, teacher_id, member_email) VALUES (?, 'MANAGER', ?, ?)")
      .run(g.id, teacherId, t.email);
    if (member.changes) enqueue(db, "ADD_MEMBER", "group", g.id, { groupEmail: g.email, memberEmail: t.email, role: "MANAGER" });
    logAction(db, userId, "club.advisor_assign", "club", clubId, { teacherId });
    return id;
  })();
}

/** Danışmanlığı bitirir: öğretmen kulüp grubundan çıkarılır */
export function endAdvisor(db: DB, advisorId: number, userId: number) {
  db.transaction(() => {
    const a = db
      .prepare(
        `SELECT a.id, a.club_id, a.teacher_id, t.email FROM club_advisors a JOIN teachers t ON t.id = a.teacher_id
         WHERE a.id = ? AND a.ended_at IS NULL`,
      )
      .get(advisorId) as { id: number; club_id: number; teacher_id: number; email: string } | undefined;
    if (!a) throw new ClubError("Aktif danışmanlık bulunamadı.");
    db.prepare("UPDATE club_advisors SET ended_at = datetime('now') WHERE id = ?").run(a.id);
    const g = db
      .prepare("SELECT g.id, g.email FROM clubs k JOIN groups g ON g.id = k.group_id WHERE k.id = ?")
      .get(a.club_id) as { id: number; email: string } | undefined;
    if (g && db.prepare("DELETE FROM group_members WHERE group_id = ? AND teacher_id = ?").run(g.id, a.teacher_id).changes) {
      enqueue(db, "REMOVE_MEMBER", "group", g.id, { groupEmail: g.email, memberEmail: a.email });
    }
    logAction(db, userId, "club.advisor_end", "club", a.club_id, { teacherId: a.teacher_id });
  })();
}

/** Kulübe eklemek için öğrenci arama (en fazla 20) */
export function searchActiveStudents(db: DB, q: string) {
  const t = q.trim();
  if (t.length < 2) return [];
  return db
    .prepare(
      `SELECT s.id, s.first_name, s.last_name, s.school_no, c.name AS class_name
       FROM students s LEFT JOIN class_sections c ON c.id = s.class_id
       WHERE s.exit_reason IS NULL AND s.status NOT IN ('DELETED', 'SUSPENDED')
         AND (s.school_no = @t OR (s.first_name || ' ' || s.last_name) LIKE @like OR s.email LIKE @fold)
       ORDER BY s.last_name, s.first_name LIMIT 20`,
    )
    .all({ t, like: `%${t}%`, fold: `%${asciiFold(t).replace(/\s+/g, ".")}%` }) as { id: number; first_name: string; last_name: string; school_no: string; class_name: string | null }[];
}

// ───── Kulüp düzenleme ve kapatma ─────

/** Ad ve açıklama değişir; grup adresi (kod) değişmez */
export function updateClub(db: DB, clubId: number, input: { name: string; description?: string }, userId: number) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ClubError("Kulüp adı gerekli.");
  db.transaction(() => {
    const k = db
      .prepare("SELECT k.id, k.is_active, g.id AS group_id, g.email FROM clubs k JOIN groups g ON g.id = k.group_id WHERE k.id = ?")
      .get(clubId) as { id: number; is_active: number; group_id: number; email: string } | undefined;
    if (!k) throw new ClubError("Kulüp bulunamadı.");
    if (!k.is_active) throw new ClubError("Kapatılmış kulüp düzenlenemez.");
    const description = input.description?.trim() || `${name} kulübü`;
    db.prepare("UPDATE clubs SET name = ?, description = ? WHERE id = ?").run(name, description, clubId);
    db.prepare("UPDATE groups SET name = ?, description = ? WHERE id = ?").run(name, description, k.group_id);
    enqueue(db, "UPDATE_GROUP", "group", k.group_id, { email: k.email, name, description });
    logAction(db, userId, "club.update", "club", clubId, { name });
  })();
}

/**
 * Kulübü kapatır: görevler biter (takma adlar kalkar, hesaplar şube OU'suna döner), üyelikler silinir ve
 * kulüp grubu Google'dan silinir. Grup Google'da hiç açılmadıysa bekleyen işleri iptal edilir.
 * Kulüp kaydı geçmiş için kalır; aynı kod yeniden kullanılamaz.
 */
export function closeClub(db: DB, clubId: number, userId: number) {
  db.transaction(() => {
    const k = db
      .prepare(
        `SELECT k.id, k.code, k.is_active, g.id AS group_id, g.email, g.google_group_id
         FROM clubs k LEFT JOIN groups g ON g.id = k.group_id WHERE k.id = ?`,
      )
      .get(clubId) as
      | { id: number; code: string; is_active: number; group_id: number | null; email: string | null; google_group_id: string | null }
      | undefined;
    if (!k) throw new ClubError("Kulüp bulunamadı.");
    if (!k.is_active) throw new ClubError("Kulüp zaten kapatılmış.");

    const roles = db
      .prepare(
        `SELECT o.id, o.alias_email, s.id AS student_id, s.email, s.org_unit_path, c.org_unit_path AS class_ou
         FROM club_officers o JOIN students s ON s.id = o.student_id LEFT JOIN class_sections c ON c.id = s.class_id
         WHERE o.club_id = ? AND o.ended_at IS NULL`,
      )
      .all(clubId) as Parameters<typeof endOfficerRow>[1][];
    for (const r of roles) endOfficerRow(db, r);
    // Danışmanlıklar biter; grup üyelikleri aşağıda grupla birlikte gider
    db.prepare("UPDATE club_advisors SET ended_at = datetime('now') WHERE club_id = ? AND ended_at IS NULL").run(clubId);

    db.prepare("DELETE FROM club_members WHERE club_id = ?").run(clubId);
    db.prepare("UPDATE clubs SET is_active = 0 WHERE id = ?").run(clubId);

    if (k.group_id && k.email) {
      if (k.google_group_id) {
        // Üyelikler grupla birlikte gider; ayrıca çıkarma işi gerekmez
        db.prepare("DELETE FROM group_members WHERE group_id = ?").run(k.group_id);
        enqueue(db, "DELETE_GROUP", "group", k.group_id, { email: k.email });
      } else {
        const running = db
          .prepare("SELECT 1 FROM sync_jobs WHERE entity_type = 'group' AND entity_id = ? AND status = 'RUNNING'")
          .get(String(k.group_id));
        if (running) throw new ClubError("Kulüp grubu şu anda Google'da oluşturuluyor; senkronizasyon bitince tekrar deneyin.");
        db.prepare(
          `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Kulüp kapatıldı'
           WHERE entity_type = 'group' AND entity_id = ? AND status IN ('QUEUED', 'FAILED')`,
        ).run(String(k.group_id));
        db.prepare(
          `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Kulüp kapatıldı'
           WHERE status IN ('QUEUED', 'FAILED') AND json_extract(payload, '$.groupEmail') = ?`,
        ).run(k.email);
        db.prepare("DELETE FROM group_members WHERE group_id = ?").run(k.group_id);
        db.prepare("UPDATE groups SET status = 'DELETED' WHERE id = ?").run(k.group_id);
      }
    }
    logAction(db, userId, "club.close", "club", clubId, { code: k.code, officersEnded: roles.length });
  })();
}

/** Kulüp grubunun dış e-posta ayarlarını yeniden uygular (Google'da elle değiştirildiyse) */
export function reapplyClubSettings(db: DB, clubId: number, userId: number) {
  const k = db
    .prepare("SELECT k.is_active, k.name, k.description, g.id AS group_id, g.email FROM clubs k JOIN groups g ON g.id = k.group_id WHERE k.id = ?")
    .get(clubId) as { is_active: number; name: string; description: string | null; group_id: number; email: string } | undefined;
  if (!k || !k.is_active) throw new ClubError("Açık kulüp bulunamadı.");
  enqueue(db, "UPDATE_GROUP", "group", k.group_id, { email: k.email, name: k.name, description: k.description ?? "" });
  logAction(db, userId, "club.settings_reapply", "club", clubId);
}
