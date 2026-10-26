// Öğretmen grupları (idareciler@, rehberlik@, zümreler ...) ve grupların alt adresleri.
//
// Öğretmen grubu groups tablosunda kind = 'CUSTOM' olarak durur; üyeleri okuldaki öğretmenlerdir (üye ya da
// yönetici). Grup adresi ve alt adresler öğretmen (nevzatayazal.k12.tr) ya da kulüp (naal.org.tr) alan adında
// olabilir; ikisi aynı Workspace hesabında olduğu için Google bir gruba iki alan adından da takma ad verir.
// Alt adresler kulüp gruplarına ve ogretmenler@ grubuna da eklenebilir.

import { logAction } from "./audit.ts";
import type { DB } from "./db.ts";
import { dbEmailTaken } from "./import/students.ts";
import { enqueue } from "./sync/queue.ts";

const LOCAL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
// Grup adresini yönetici bilerek seçtiği için öğrenci/öğretmen önerilerindeki ayrılmış adlar (mudur, rehberlik ...)
// burada serbest; sadece sistem adresleri verilmez.
const SYSTEM_LOCAL_PARTS = new Set(["admin", "administrator", "postmaster", "abuse", "noreply", "no-reply", "hostmaster", "webmaster"]);
export const MEMBER_ROLES = ["MEMBER", "MANAGER"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export class GroupError extends Error {}

/** Grup ve alt adres için kullanılabilen alan adları: öğretmen ve kulüp alan adı */
export function groupDomains(db: DB) {
  return db
    .prepare("SELECT id, name, kind FROM domains WHERE kind IN ('TEACHER', 'CLUB') ORDER BY kind DESC")
    .all() as { id: number; name: string; kind: "TEACHER" | "CLUB" }[];
}

/** "yerel" ya da "yerel@alanadi" → doğrulanmış tam adres ve alan adı kaydı */
function parseAddress(db: DB, local: string, domainName: string) {
  const l = local.trim().toLowerCase().split("@")[0];
  if (!LOCAL_RE.test(l) || l.length > 64) {
    throw new GroupError("Sadece a-z, 0-9 ve arada nokta, tire, alt çizgi kullanılabilir (en fazla 64 karakter).");
  }
  if (SYSTEM_LOCAL_PARTS.has(l)) throw new GroupError(`"${l}" sistem adresi; kullanılamaz.`);
  const domain = groupDomains(db).find((d) => d.name === domainName.trim().toLowerCase());
  if (!domain) throw new GroupError(`${domainName} alan adı grup adresi için kullanılamaz.`);
  return { email: `${l}@${domain.name}`, domain };
}

function checkFree(db: DB, email: string, googleTaken: Set<string> | null) {
  if (dbEmailTaken(db)(email)) throw new GroupError(`${email} veritabanında başka bir kayıtta kullanılıyor.`);
  if (googleTaken?.has(email.toLowerCase())) throw new GroupError(`${email} Google'da kullanılıyor.`);
}

// ───── Öğretmen grupları ─────

export interface TeacherGroupRow {
  id: number;
  kind: "TEACHERS" | "CUSTOM";
  email: string;
  name: string;
  description: string | null;
  status: string;
  allow_external: number;
  members: number;
  managers: number;
  /** Aktif alt adresler, virgülle */
  aliases: string | null;
}

/** ogretmenler@ grubu ve panelden açılan öğretmen grupları; silinmişler sonda */
export function listTeacherGroups(db: DB): TeacherGroupRow[] {
  return db
    .prepare(
      `SELECT g.id, g.kind, g.email, g.name, g.description, g.status, g.allow_external,
              (SELECT count(*) FROM group_members m WHERE m.group_id = g.id) AS members,
              (SELECT count(*) FROM group_members m WHERE m.group_id = g.id AND m.role = 'MANAGER') AS managers,
              (SELECT group_concat(a.alias_email, ', ') FROM group_aliases a WHERE a.group_id = g.id AND a.removed_at IS NULL) AS aliases
       FROM groups g WHERE g.kind IN ('TEACHERS', 'CUSTOM')
       ORDER BY g.status IN ('ARCHIVED', 'DELETED'), g.kind = 'CUSTOM', g.name`,
    )
    .all() as TeacherGroupRow[];
}

export function getTeacherGroup(db: DB, id: number) {
  const group = db
    .prepare(
      `SELECT id, kind, email, name, description, status, allow_external, google_group_id, created_at
       FROM groups WHERE id = ? AND kind IN ('TEACHERS', 'CUSTOM')`,
    )
    .get(id) as
    | {
        id: number;
        kind: "TEACHERS" | "CUSTOM";
        email: string;
        name: string;
        description: string | null;
        status: string;
        allow_external: number;
        google_group_id: string | null;
        created_at: string;
      }
    | undefined;
  if (!group) return null;
  const members = db
    .prepare(
      `SELECT m.id, m.role, m.status, t.id AS teacher_id, t.first_name, t.last_name, t.email, t.branch
       FROM group_members m JOIN teachers t ON t.id = m.teacher_id
       WHERE m.group_id = ? ORDER BY m.role = 'MEMBER', t.first_name, t.last_name`,
    )
    .all(id) as {
    id: number;
    role: string;
    status: string;
    teacher_id: number;
    first_name: string;
    last_name: string;
    email: string;
    branch: string | null;
  }[];
  return { group, members };
}

/** Grup açık mı (kapatılmamış, silinmemiş) */
function openCustomGroup(db: DB, groupId: number) {
  const g = db.prepare("SELECT id, kind, email, name, description, status, allow_external, google_group_id FROM groups WHERE id = ?").get(groupId) as
    | {
        id: number;
        kind: string;
        email: string;
        name: string;
        description: string | null;
        status: string;
        allow_external: number;
        google_group_id: string | null;
      }
    | undefined;
  if (!g || g.kind !== "CUSTOM") throw new GroupError("Öğretmen grubu bulunamadı.");
  if (g.status === "ARCHIVED" || g.status === "DELETED") throw new GroupError("Grup kapatılmış.");
  return g;
}

export function createTeacherGroup(
  db: DB,
  input: { name: string; local: string; domain: string; description?: string; allowExternal: boolean },
  userId: number,
  googleTaken: Set<string> | null,
): number {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new GroupError("Grup adı gerekli.");
  const { email, domain } = parseAddress(db, input.local, input.domain);
  return db.transaction(() => {
    checkFree(db, email, googleTaken);
    const description = input.description?.trim() || name;
    const id = Number(
      db
        .prepare("INSERT INTO groups (kind, domain_id, email, name, description, allow_external) VALUES ('CUSTOM', ?, ?, ?, ?, ?)")
        .run(domain.id, email, name, description, input.allowExternal ? 1 : 0).lastInsertRowid,
    );
    enqueue(db, "CREATE_GROUP", "group", id, { email, name, description });
    logAction(db, userId, "group.create", "group", id, { email, name });
    return id;
  })();
}

/** Ad, açıklama ve dış e-posta izni değişir; grup adresi değişmez (gerekirse alt adres eklenir) */
export function updateTeacherGroup(
  db: DB,
  groupId: number,
  input: { name: string; description?: string; allowExternal: boolean },
  userId: number,
) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new GroupError("Grup adı gerekli.");
  db.transaction(() => {
    const g = openCustomGroup(db, groupId);
    const description = input.description?.trim() || name;
    db.prepare("UPDATE groups SET name = ?, description = ?, allow_external = ? WHERE id = ?").run(
      name,
      description,
      input.allowExternal ? 1 : 0,
      groupId,
    );
    enqueue(db, "UPDATE_GROUP", "group", groupId, { email: g.email, name, description });
    logAction(db, userId, "group.update", "group", groupId, { name, allowExternal: input.allowExternal });
  })();
}

/**
 * Grubu kapatır: üyelikler ve alt adresler kalkar, grup Google'dan silinir (alt adresler grupla gider).
 * Grup Google'da hiç açılmadıysa bekleyen işleri iptal edilir. Kayıt geçmiş için kalır; adres tekrar kullanılamaz.
 */
export function closeTeacherGroup(db: DB, groupId: number, userId: number) {
  db.transaction(() => {
    const g = openCustomGroup(db, groupId);
    dropGroupAliases(db, groupId);
    db.prepare("DELETE FROM group_members WHERE group_id = ?").run(groupId);
    if (g.google_group_id) {
      db.prepare("UPDATE groups SET status = 'ARCHIVED' WHERE id = ?").run(groupId);
      enqueue(db, "DELETE_GROUP", "group", groupId, { email: g.email });
    } else {
      const running = db
        .prepare("SELECT 1 FROM sync_jobs WHERE entity_type = 'group' AND entity_id = ? AND status = 'RUNNING'")
        .get(String(groupId));
      if (running) throw new GroupError("Grup şu anda Google'da oluşturuluyor; senkronizasyon bitince tekrar deneyin.");
      db.prepare(
        `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Grup kapatıldı'
         WHERE status IN ('QUEUED', 'FAILED')
           AND ((entity_type = 'group' AND entity_id = @id) OR json_extract(payload, '$.groupEmail') = @email)`,
      ).run({ id: String(groupId), email: g.email });
      db.prepare("UPDATE groups SET status = 'DELETED' WHERE id = ?").run(groupId);
    }
    logAction(db, userId, "group.close", "group", groupId, { email: g.email });
  })();
}

// ───── Öğretmen grubu üyeleri ─────

/** Gruba eklenebilecek öğretmenler: okulda olan, grupta olmayan */
export function groupTeacherCandidates(db: DB, groupId: number) {
  return db
    .prepare(
      `SELECT t.id, t.first_name, t.last_name, t.email, t.branch FROM teachers t
       WHERE t.left_at IS NULL AND t.status NOT IN ('DELETED', 'ARCHIVED', 'SUSPENDED')
         AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = ? AND m.teacher_id = t.id)
       ORDER BY t.first_name, t.last_name`,
    )
    .all(groupId) as { id: number; first_name: string; last_name: string; email: string; branch: string | null }[];
}

export function addGroupTeachers(db: DB, groupId: number, teacherIds: number[], role: MemberRole, userId: number): number {
  if (!MEMBER_ROLES.includes(role)) throw new GroupError("Geçersiz rol.");
  return db.transaction(() => {
    const g = openCustomGroup(db, groupId);
    let added = 0;
    for (const tid of teacherIds) {
      const t = db.prepare("SELECT id, email, first_name, last_name, left_at, status FROM teachers WHERE id = ?").get(tid) as
        | { id: number; email: string; first_name: string; last_name: string; left_at: string | null; status: string }
        | undefined;
      if (!t) throw new GroupError("Öğretmen bulunamadı.");
      if (t.left_at || ["DELETED", "ARCHIVED", "SUSPENDED"].includes(t.status)) {
        throw new GroupError(`${t.first_name} ${t.last_name} okulda değil.`);
      }
      const r = db
        .prepare("INSERT OR IGNORE INTO group_members (group_id, role, teacher_id, member_email) VALUES (?, ?, ?, ?)")
        .run(groupId, role, t.id, t.email);
      if (!r.changes) continue;
      enqueue(db, "ADD_MEMBER", "group", groupId, { groupEmail: g.email, memberEmail: t.email, role });
      added++;
    }
    if (added) logAction(db, userId, "group.members_add", "group", groupId, { teacherIds, role });
    return added;
  })();
}

export function removeGroupMember(db: DB, groupId: number, memberId: number, userId: number) {
  db.transaction(() => {
    const g = openCustomGroup(db, groupId);
    const m = db.prepare("SELECT id, member_email, teacher_id FROM group_members WHERE id = ? AND group_id = ?").get(memberId, groupId) as
      | { id: number; member_email: string; teacher_id: number | null }
      | undefined;
    if (!m) throw new GroupError("Üye bulunamadı.");
    db.prepare("DELETE FROM group_members WHERE id = ?").run(m.id);
    enqueue(db, "REMOVE_MEMBER", "group", groupId, { groupEmail: g.email, memberEmail: m.member_email });
    logAction(db, userId, "group.member_remove", "group", groupId, { teacherId: m.teacher_id });
  })();
}

/** Yanlış eklenen rolü düzeltmek için: çıkarıp yeni rolle ekler (Google'da üyelik rolü de değişir) */
export function setGroupMemberRole(db: DB, groupId: number, memberId: number, role: MemberRole, userId: number) {
  if (!MEMBER_ROLES.includes(role)) throw new GroupError("Geçersiz rol.");
  db.transaction(() => {
    const g = openCustomGroup(db, groupId);
    const m = db.prepare("SELECT id, role, member_email FROM group_members WHERE id = ? AND group_id = ?").get(memberId, groupId) as
      | { id: number; role: string; member_email: string }
      | undefined;
    if (!m) throw new GroupError("Üye bulunamadı.");
    if (m.role === role) return;
    db.prepare("UPDATE group_members SET role = ?, status = 'PENDING' WHERE id = ?").run(role, m.id);
    enqueue(db, "REMOVE_MEMBER", "group", groupId, { groupEmail: g.email, memberEmail: m.member_email });
    enqueue(db, "ADD_MEMBER", "group", groupId, { groupEmail: g.email, memberEmail: m.member_email, role });
    logAction(db, userId, "group.member_role", "group", groupId, { memberId, role });
  })();
}

/** Öğretmen grubu ekleme listesi için arama metni */
export function teacherLabel(t: { first_name: string; last_name: string; branch: string | null }) {
  return `${t.first_name} ${t.last_name}${t.branch ? ` · ${t.branch}` : ""}`;
}

// ───── Alt adresler (grup takma adları) ─────

export interface GroupAlias {
  id: number;
  alias_email: string;
  status: string;
  created_at: string;
}

export function listGroupAliases(db: DB, groupId: number): GroupAlias[] {
  return db
    .prepare("SELECT id, alias_email, status, created_at FROM group_aliases WHERE group_id = ? AND removed_at IS NULL ORDER BY alias_email")
    .all(groupId) as GroupAlias[];
}

/** Alt adres eklenebilecek grup: kulüp, öğretmenler ya da öğretmen grubu; kapatılmamış */
function aliasableGroup(db: DB, groupId: number) {
  const g = db
    .prepare(
      `SELECT g.id, g.kind, g.email, g.status, k.id AS club_id, k.is_active
       FROM groups g LEFT JOIN clubs k ON k.group_id = g.id WHERE g.id = ?`,
    )
    .get(groupId) as { id: number; kind: string; email: string; status: string; club_id: number | null; is_active: number | null } | undefined;
  if (!g || !["CLUB", "TEACHERS", "CUSTOM"].includes(g.kind)) throw new GroupError("Grup bulunamadı.");
  if (g.status === "ARCHIVED" || g.status === "DELETED" || g.is_active === 0) throw new GroupError("Grup kapatılmış.");
  return g;
}

/** Grubun panel sayfası (yeniden çizim için) */
export function groupPagePath(db: DB, groupId: number) {
  const clubId = db.prepare("SELECT id FROM clubs WHERE group_id = ?").pluck().get(groupId) as number | undefined;
  return clubId ? `/kulupler/${clubId}` : `/gruplar/${groupId}`;
}

export function addGroupAlias(
  db: DB,
  input: { groupId: number; local: string; domain: string },
  userId: number,
  googleTaken: Set<string> | null,
): number {
  const { email, domain } = parseAddress(db, input.local, input.domain);
  return db.transaction(() => {
    const g = aliasableGroup(db, input.groupId);
    if (email === g.email.toLowerCase()) throw new GroupError("Bu adres grubun kendi adresi.");
    checkFree(db, email, googleTaken);
    const id = Number(
      db
        .prepare("INSERT INTO group_aliases (group_id, domain_id, alias_email) VALUES (?, ?, ?)")
        .run(g.id, domain.id, email).lastInsertRowid,
    );
    enqueue(db, "ADD_ALIAS", "group", g.id, { groupEmail: g.email, alias: email });
    logAction(db, userId, "group.alias_add", "group", g.id, { alias: email });
    return id;
  })();
}

export function removeGroupAlias(db: DB, aliasId: number, userId: number) {
  db.transaction(() => {
    const a = db
      .prepare(
        `SELECT a.id, a.alias_email, a.status, g.id AS group_id, g.email AS group_email FROM group_aliases a
         JOIN groups g ON g.id = a.group_id WHERE a.id = ? AND a.removed_at IS NULL`,
      )
      .get(aliasId) as { id: number; alias_email: string; status: string; group_id: number; group_email: string } | undefined;
    if (!a) throw new GroupError("Alt adres bulunamadı.");
    db.prepare("UPDATE group_aliases SET removed_at = datetime('now'), status = 'DELETED' WHERE id = ?").run(a.id);
    // Henüz eklenmediyse ekleme işi iptal edilir; eklendiyse (ya da ekleniyorsa) kaldırma işi kuyruğa girer
    const cancelled = db
      .prepare(
        `UPDATE sync_jobs SET status = 'CANCELLED', last_error = 'Alt adres kaldırıldı'
         WHERE action = 'ADD_ALIAS' AND entity_type = 'group' AND entity_id = ? AND status IN ('QUEUED', 'FAILED')
           AND json_extract(payload, '$.alias') = ?`,
      )
      .run(String(a.group_id), a.alias_email).changes;
    if (!cancelled || a.status === "ACTIVE") {
      enqueue(db, "REMOVE_ALIAS", "group", a.group_id, { groupEmail: a.group_email, alias: a.alias_email });
    }
    logAction(db, userId, "group.alias_remove", "group", a.group_id, { alias: a.alias_email });
  })();
}

/** Grup kapatılırken: grup silindiğinde alt adresler de Google'dan gider, sadece kayıt kapanır */
export function dropGroupAliases(db: DB, groupId: number) {
  db.prepare("UPDATE group_aliases SET removed_at = datetime('now'), status = 'DELETED' WHERE group_id = ? AND removed_at IS NULL").run(groupId);
}
