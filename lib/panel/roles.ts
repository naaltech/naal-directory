// Yönetim panelinin (admin.naal.org.tr) yetkileri. Elle tutulan bir liste yoktur: roller her seferinde kişinin
// okuldaki durumundan hesaplanır, bu yüzden göreve gelen hemen yetki alır, görevi biten ya da okuldan ayrılan
// hemen kaybeder (bkz. sync.ts).
//
// - Süper yönetici: dizinin aktif SUPER_ADMIN ve ADMIN hesapları (okul alan adlarından biriyle).
// - Kulüp yönetimi: açık kulübün başkanı, başkan yardımcısı ve danışman öğretmeni.
// - Dergi editörü: yalnızca bilim kulübünde, club_editors'taki kişi.

import type { DB } from "../db.ts";

export type PanelRoleName = "super" | "club" | "editor";

export interface PanelRole {
  email: string;
  club_code: string;
  role: PanelRoleName;
  name: string;
}

export const MAGAZINE_CLUB = "bilim";
const LEAD_TITLES = ["PRESIDENT", "VICE_PRESIDENT"];

export const roleKey = (r: Pick<PanelRole, "email" | "club_code" | "role">) => `${r.email}|${r.club_code}|${r.role}`;

export function desiredRoles(db: DB): PanelRole[] {
  const titles = LEAD_TITLES.map((t) => `'${t}'`).join(", ");
  const rows = db
    .prepare(
      `SELECT a.email, '' AS club_code, 'super' AS role, a.name
       FROM admin_users a
       WHERE a.role IN ('SUPER_ADMIN', 'ADMIN') AND a.is_active = 1
         AND EXISTS (SELECT 1 FROM domains d WHERE lower(a.email) LIKE '%@' || d.name)
       UNION ALL
       SELECT s.email, k.code, 'club', s.first_name || ' ' || s.last_name
       FROM club_officers o JOIN clubs k ON k.id = o.club_id JOIN students s ON s.id = o.student_id
       WHERE o.ended_at IS NULL AND o.title IN (${titles}) AND k.is_active = 1
         AND s.exit_reason IS NULL AND s.status = 'ACTIVE'
       UNION ALL
       SELECT t.email, k.code, 'club', t.first_name || ' ' || t.last_name
       FROM club_advisors a JOIN clubs k ON k.id = a.club_id JOIN teachers t ON t.id = a.teacher_id
       WHERE a.ended_at IS NULL AND k.is_active = 1 AND t.left_at IS NULL AND t.status = 'ACTIVE'
       UNION ALL
       SELECT s.email, k.code, 'editor', s.first_name || ' ' || s.last_name
       FROM club_editors e JOIN clubs k ON k.id = e.club_id JOIN students s ON s.email = e.email
       WHERE k.is_active = 1 AND s.exit_reason IS NULL AND s.status = 'ACTIVE'
       UNION ALL
       SELECT t.email, k.code, 'editor', t.first_name || ' ' || t.last_name
       FROM club_editors e JOIN clubs k ON k.id = e.club_id JOIN teachers t ON t.email = e.email
       WHERE k.is_active = 1 AND t.left_at IS NULL AND t.status = 'ACTIVE'`,
    )
    .all() as PanelRole[];
  const byKey = new Map<string, PanelRole>();
  for (const row of rows) {
    const r = { ...row, email: row.email.toLowerCase() };
    byKey.set(roleKey(r), r);
  }
  return [...byKey.values()];
}

/** Açık olup panelde yönetecek kimsesi kalmayan kulüpler (görevlisi mezun olmuş, danışmanı ayrılmış) */
export function clubsWithoutLead(db: DB, roles = desiredRoles(db)): string[] {
  const led = new Set(roles.filter((r) => r.role === "club").map((r) => r.club_code));
  return (db.prepare("SELECT code FROM clubs WHERE is_active = 1 ORDER BY code").pluck().all() as string[]).filter((c) => !led.has(c));
}

export function canManage(roles: PanelRole[], email: string, clubCode: string) {
  return roles.some((r) => r.email === email && (r.role === "super" || (r.role === "club" && r.club_code === clubCode)));
}

export interface SchoolPerson {
  type: "student" | "teacher";
  id: number;
  email: string;
  name: string;
}

/** Okulda olan kişiyi birincil adresiyle ya da kulüp görevlisi takma adıyla bulur */
export function findSchoolPerson(db: DB, address: string): SchoolPerson | null {
  const email = address.trim().toLowerCase();
  const student = db
    .prepare(
      `SELECT s.id, s.email, s.first_name || ' ' || s.last_name AS name FROM students s
       WHERE s.exit_reason IS NULL AND s.status = 'ACTIVE'
         AND (s.email = @email OR EXISTS (
           SELECT 1 FROM club_officers o WHERE o.student_id = s.id AND o.alias_email = @email AND o.ended_at IS NULL))`,
    )
    .get({ email }) as Omit<SchoolPerson, "type"> | undefined;
  if (student) return { type: "student", ...student };
  const teacher = db
    .prepare("SELECT id, email, first_name || ' ' || last_name AS name FROM teachers WHERE email = ? AND left_at IS NULL AND status = 'ACTIVE'")
    .get(email) as Omit<SchoolPerson, "type"> | undefined;
  return teacher ? { type: "teacher", ...teacher } : null;
}
