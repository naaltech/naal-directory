// Tek kullanımlık anahtarlar. Veritabanında yalnızca özet durur; veritabanı ele geçirilse bile bağlantı üretilemez.

import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db.ts";
import { sqlDate } from "../db.ts";

export type TokenPurpose = "password_reset" | "email_change" | "two_factor";

export interface AdminToken {
  user_id: number;
  new_email: string | null;
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Aynı amaçla açık kalan önceki anahtar geçersiz olur */
export function createToken(db: DB, userId: number, purpose: TokenPurpose, minutes: number, newEmail: string | null = null): string {
  const token = randomBytes(32).toString("base64url");
  db.transaction(() => {
    db.prepare("DELETE FROM admin_tokens WHERE expires_at < datetime('now')").run();
    db.prepare("DELETE FROM admin_tokens WHERE user_id = ? AND purpose = ?").run(userId, purpose);
    db.prepare("INSERT INTO admin_tokens (id, user_id, purpose, new_email, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      digest(token),
      userId,
      purpose,
      newEmail,
      sqlDate(new Date(Date.now() + minutes * 60_000)),
    );
  })();
  return token;
}

/** Anahtarı tüketmeden okur: e-posta tarayıcıları bağlantıları açar, işlem ancak sayfadaki düğmeyle yapılır. */
export function findToken(db: DB, token: string | undefined, purpose: TokenPurpose): AdminToken | undefined {
  if (!token) return undefined;
  return db
    .prepare("SELECT user_id, new_email FROM admin_tokens WHERE id = ? AND purpose = ? AND expires_at > datetime('now')")
    .get(digest(token), purpose) as AdminToken | undefined;
}

export function deleteTokens(db: DB, userId: number, purpose: TokenPurpose) {
  db.prepare("DELETE FROM admin_tokens WHERE user_id = ? AND purpose = ?").run(userId, purpose);
}

/** Son `minutes` dakikada bu amaçla anahtar üretilmiş mi (e-posta yağmurunu önler) */
export function tokenRecentlyCreated(db: DB, userId: number, purpose: TokenPurpose, minutes: number): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM admin_tokens WHERE user_id = ? AND purpose = ? AND created_at > datetime('now', ?)")
      .get(userId, purpose, `-${minutes} minutes`),
  );
}
