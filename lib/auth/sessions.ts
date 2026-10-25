// Oturum yönetimi. Çerezde 32 baytlık rastgele anahtar durur; veritabanında sadece SHA-256 özeti.
// Veritabanı ele geçirilse bile oturum anahtarları kullanılamaz.

import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db.ts";
import { sqlDate } from "../db.ts";
import type { AdminUser } from "./admins.ts";

export { SESSION_COOKIE } from "./cookie.ts";
export const SESSION_DAYS = 7;
/** Son etkinlikten bu kadar sonra oturum düşer */
const IDLE_HOURS = 12;

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: DB, userId: number, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare("INSERT INTO admin_sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    digest(token),
    userId,
    sqlDate(expires),
    meta.ip ?? null,
    meta.userAgent?.slice(0, 300) ?? null,
  );
  // Fırsat bulunca süresi geçmiş oturumları temizle
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  return { token, expires };
}

export function getSessionUser(db: DB, token: string | undefined): AdminUser | null {
  if (!token) return null;
  const id = digest(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.is_active, u.failed_logins, u.locked_until, u.last_login_at, u.created_at
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')
         AND s.last_seen_at > datetime('now', ?) AND u.is_active = 1`,
    )
    .get(id, `-${IDLE_HOURS} hours`) as AdminUser | undefined;
  if (!row) return null;
  db.prepare("UPDATE admin_sessions SET last_seen_at = datetime('now') WHERE id = ? AND last_seen_at < datetime('now', '-1 minute')").run(id);
  return row;
}

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(digest(token));
}
