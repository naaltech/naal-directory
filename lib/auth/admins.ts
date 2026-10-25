// Panel yöneticileri: oluşturma, listeleme, giriş doğrulama.
// Hesaplar sadece CLI ile oluşturulur (scripts/admin.ts); panelde kayıt ekranı yoktur.

import type { DB } from "../db.ts";
import { sqlDate } from "../db.ts";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";

export const ROLES = ["SUPER_ADMIN", "ADMIN", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Süper yönetici",
  ADMIN: "Yönetici",
  VIEWER: "Görüntüleyici",
};

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: 0 | 1;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

const COLUMNS = "id, email, name, role, is_active, failed_logins, locked_until, last_login_at, created_at";

/** Bu kadar hatalı denemeden sonra hesap LOCK_MINUTES dakika kilitlenir */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function listAdmins(db: DB): AdminUser[] {
  return db.prepare(`SELECT ${COLUMNS} FROM admin_users ORDER BY created_at, id`).all() as AdminUser[];
}

export function findAdminByEmail(db: DB, email: string): AdminUser | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM admin_users WHERE email = ?`).get(normalizeEmail(email)) as AdminUser | undefined;
}

export function findAdminById(db: DB, id: number): AdminUser | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM admin_users WHERE id = ?`).get(id) as AdminUser | undefined;
}

export async function createAdmin(
  db: DB,
  input: { email: string; name: string; role: Role; password: string },
  actorId: number | null = null,
): Promise<AdminUser> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Geçersiz e-posta: ${input.email}`);
  if (!input.name.trim()) throw new Error("Ad boş olamaz");
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  if (findAdminByEmail(db, email)) throw new Error(`${email} zaten kayıtlı`);

  const hash = await hashPassword(input.password);
  const { lastInsertRowid } = db
    .prepare("INSERT INTO admin_users (email, name, role, password_hash) VALUES (?, ?, ?, ?)")
    .run(email, input.name.trim(), input.role, hash);
  audit(db, actorId, "admin.create", Number(lastInsertRowid), { email, role: input.role, via: via(actorId) });
  return findAdminById(db, Number(lastInsertRowid))!;
}

export async function setAdminPassword(db: DB, email: string, password: string, actorId: number | null = null): Promise<void> {
  const user = mustFind(db, email);
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare("UPDATE admin_users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").run(hash, user.id);
    // Şifre değişince açık oturumlar kapanır
    db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(user.id);
  })();
  audit(db, actorId, "admin.password", user.id, { email: user.email, via: via(actorId) });
}

export function setAdminActive(db: DB, email: string, active: boolean, actorId: number | null = null): void {
  const user = mustFind(db, email);
  if (!active) assertNotLastSuperAdmin(db, user);
  db.transaction(() => {
    db.prepare("UPDATE admin_users SET is_active = ?, failed_logins = 0, locked_until = NULL WHERE id = ?").run(active ? 1 : 0, user.id);
    if (!active) db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(user.id);
  })();
  audit(db, actorId, active ? "admin.enable" : "admin.disable", user.id, { email: user.email, via: via(actorId) });
}

export function setAdminRole(db: DB, email: string, role: Role, actorId: number | null = null): void {
  const user = mustFind(db, email);
  if (role !== "SUPER_ADMIN") assertNotLastSuperAdmin(db, user);
  db.prepare("UPDATE admin_users SET role = ? WHERE id = ?").run(role, user.id);
  audit(db, actorId, "admin.role", user.id, { email: user.email, from: user.role, to: role, via: via(actorId) });
}

export function removeAdmin(db: DB, email: string, actorId: number | null = null): void {
  const user = mustFind(db, email);
  assertNotLastSuperAdmin(db, user);
  db.prepare("DELETE FROM admin_users WHERE id = ?").run(user.id);
  audit(db, actorId, "admin.remove", user.id, { email: user.email, via: via(actorId) });
}

/** Oturum açmış yöneticinin şifresini yeniden doğrular (kritik işlemlerden önce) */
export async function checkPassword(db: DB, id: number, password: string): Promise<boolean> {
  const hash = db.prepare("SELECT password_hash FROM admin_users WHERE id = ?").pluck().get(id) as string | undefined;
  return Boolean(hash) && (await verifyPassword(password, hash!));
}

/**
 * Süper yöneticiliği devreder: hedef süper yönetici olur, devreden yönetici olur. Tek işlemde yapılır, araya
 * süper yöneticisiz bir an girmez. Hedef aktif olmalı ve kilitli olmamalı (devralan giriş yapabilmeli).
 */
export function transferSuperAdmin(db: DB, fromId: number, toId: number): void {
  db.transaction(() => {
    const from = findAdminById(db, fromId);
    const to = findAdminById(db, toId);
    if (!from || from.role !== "SUPER_ADMIN" || !from.is_active) throw new Error("Sadece aktif bir süper yönetici devredebilir");
    if (!to || to.id === from.id) throw new Error("Devralacak yönetici bulunamadı");
    if (!to.is_active) throw new Error(`${to.email} pasif; önce etkinleştirin`);
    if (to.role === "SUPER_ADMIN") throw new Error(`${to.email} zaten süper yönetici`);
    if (to.locked_until && to.locked_until > sqlDate(new Date())) throw new Error(`${to.email} şu an kilitli; kilit açılınca tekrar deneyin`);
    db.prepare("UPDATE admin_users SET role = 'SUPER_ADMIN' WHERE id = ?").run(to.id);
    db.prepare("UPDATE admin_users SET role = 'ADMIN' WHERE id = ?").run(from.id);
    audit(db, from.id, "admin.transfer", to.id, { from: from.email, to: to.email, previousRole: to.role, via: "panel" });
  })();
}

export type LoginResult =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "invalid" | "locked" | "disabled"; lockedUntil?: string };

/** Şifreyi doğrular, hatalı denemeleri sayar ve gerekirse hesabı geçici kilitler. */
export async function verifyLogin(db: DB, email: string, password: string): Promise<LoginResult> {
  const row = db
    .prepare(`SELECT ${COLUMNS}, password_hash FROM admin_users WHERE email = ?`)
    .get(normalizeEmail(email)) as (AdminUser & { password_hash: string }) | undefined;

  if (!row) {
    // Kullanıcı yokken de aynı sürede yanıt vermek için sahte doğrulama
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, reason: "invalid" };
  }
  const now = sqlDate(new Date());
  if (row.locked_until && row.locked_until > now) return { ok: false, reason: "locked", lockedUntil: row.locked_until };

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    const failed = row.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? sqlDate(new Date(Date.now() + LOCK_MINUTES * 60_000)) : null;
    db.prepare("UPDATE admin_users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(lock ? 0 : failed, lock, row.id);
    audit(db, row.id, "admin.login_failed", row.id, { locked: Boolean(lock) });
    return lock ? { ok: false, reason: "locked", lockedUntil: lock } : { ok: false, reason: "invalid" };
  }
  if (!row.is_active) return { ok: false, reason: "disabled" };

  db.prepare("UPDATE admin_users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").run(row.id);
  audit(db, row.id, "admin.login", row.id);
  const user: AdminUser & { password_hash?: string } = { ...row };
  delete user.password_hash;
  return { ok: true, user };
}

// Hiçbir şifreyle eşleşmeyen sahte özet (aynı scrypt maliyetiyle)
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

const via = (actorId: number | null) => (actorId ? "panel" : "cli");

function mustFind(db: DB, email: string): AdminUser {
  const user = findAdminByEmail(db, email);
  if (!user) throw new Error(`${normalizeEmail(email)} bulunamadı`);
  return user;
}

function assertNotLastSuperAdmin(db: DB, user: AdminUser) {
  if (user.role !== "SUPER_ADMIN" || !user.is_active) return;
  const others = db
    .prepare("SELECT count(*) FROM admin_users WHERE role = 'SUPER_ADMIN' AND is_active = 1 AND id <> ?")
    .pluck()
    .get(user.id) as number;
  if (others === 0) throw new Error("Son aktif süper yönetici kaldırılamaz, pasifleştirilemez veya rolü düşürülemez");
}

export function audit(db: DB, userId: number | null, action: string, entityId?: number, details?: unknown) {
  db.prepare("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, 'admin_user', ?, ?)").run(
    userId,
    action,
    entityId == null ? null : String(entityId),
    details === undefined ? null : JSON.stringify(details),
  );
}
