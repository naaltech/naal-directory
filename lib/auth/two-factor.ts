// İki adımlı doğrulama: kurulum, girişin ikinci adımı ve kurtarma kodları.
// Hatalı kodlar şifre denemeleriyle aynı sayaca yazılır: 6 haneli kod sınırsız denenemesin.

import { createHash, randomBytes } from "node:crypto";
import type { DB } from "../db.ts";
import { sqlDate } from "../db.ts";
import { decryptSecret, encryptSecret } from "../secret-box.ts";
import { audit, findAdminByEmail, findAdminById, finishLogin, recordFailure, type LoginResult } from "./admins.ts";
import { verifyPassword } from "./password.ts";
import { deleteOtherSessions } from "./sessions.ts";
import { deleteTokens, findToken } from "./tokens.ts";
import { generateTotpSecret, matchTotpStep } from "./totp.ts";

const RECOVERY_CODES = 10;

interface Totp {
  password_hash: string;
  totp_secret: string | null;
  totp_enabled_at: string | null;
  totp_last_step: number | null;
  locked_until: string | null;
  failed_logins: number;
}

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
const cleanCode = (code: string) => code.replace(/[\s-]/g, "").toLowerCase();

function totpRow(db: DB, id: number): Totp | undefined {
  return db
    .prepare("SELECT password_hash, totp_secret, totp_enabled_at, totp_last_step, locked_until, failed_logins FROM admin_users WHERE id = ?")
    .get(id) as Totp | undefined;
}

/** Uygulama kodunu ya da kurtarma kodunu doğrular; ikisi de tek kullanımlıktır. */
function spendSecondFactor(db: DB, id: number, row: Totp, code: string): boolean {
  const clean = cleanCode(code);
  if (/^\d{6}$/.test(clean)) {
    if (!row.totp_secret) return false;
    const step = matchTotpStep(decryptSecret(row.totp_secret), clean, row.totp_last_step);
    if (step == null) return false;
    db.prepare("UPDATE admin_users SET totp_last_step = ? WHERE id = ?").run(step, id);
    return true;
  }
  const used = db.prepare("DELETE FROM admin_recovery_codes WHERE user_id = ? AND code_hash = ?").run(id, hashCode(clean));
  if (!used.changes) return false;
  audit(db, id, "admin.recovery_code_used", id);
  return true;
}

/** Girişin ikinci adımı. Anahtar yalnızca başarılı girişte ya da hesap kilitlenince silinir. */
export function verifyTwoFactor(db: DB, challenge: string | undefined, code: string): LoginResult {
  const token = findToken(db, challenge, "two_factor");
  const user = token && findAdminById(db, token.user_id);
  const row = user && totpRow(db, user.id);
  if (!user || !row) return { ok: false, reason: "expired" };
  if (!user.is_active) return { ok: false, reason: "disabled" };
  if (user.locked_until && user.locked_until > sqlDate(new Date())) return { ok: false, reason: "locked", lockedUntil: user.locked_until };

  if (!spendSecondFactor(db, user.id, row, code)) {
    const lock = recordFailure(db, user.id, user.failed_logins);
    if (!lock) return { ok: false, reason: "invalid" };
    deleteTokens(db, user.id, "two_factor");
    return { ok: false, reason: "locked", lockedUntil: lock };
  }
  deleteTokens(db, user.id, "two_factor");
  return { ok: true, user: finishLogin(db, user) };
}

/** Oturum açık olsa da kritik işlemden önce şifre ve varsa ikinci adım yeniden istenir. Bir oturum kaptırılırsa hesap ele geçirilemesin. */
export async function confirmIdentity(db: DB, id: number, password: string, code = ""): Promise<void> {
  const row = totpRow(db, id);
  if (!row) throw new Error("Hesap bulunamadı");
  if (row.locked_until && row.locked_until > sqlDate(new Date())) throw new Error("Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.");
  const needsCode = Boolean(row.totp_enabled_at);
  const ok = (await verifyPassword(password, row.password_hash)) && (!needsCode || spendSecondFactor(db, id, row, code));
  if (!ok) {
    recordFailure(db, id, row.failed_logins);
    throw new Error(needsCode ? "Şifre veya doğrulama kodu hatalı" : "Şifre hatalı");
  }
  db.prepare("UPDATE admin_users SET failed_logins = 0 WHERE id = ?").run(id);
}

/** Kurulumu başlatır; kod doğrulanana kadar girişi etkilemez. Yeniden başlatılırsa eski anahtar geçersiz olur. */
export function beginTotpSetup(db: DB, id: number): string {
  if (totpRow(db, id)?.totp_enabled_at) throw new Error("İki adımlı doğrulama zaten açık");
  const secret = generateTotpSecret();
  db.prepare("UPDATE admin_users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?").run(encryptSecret(secret), id);
  return secret;
}

/** Uygulamadaki kodla kurulumu bitirir. Öteki oturumlar kapanır, kurtarma kodları bir kez döner. */
export function confirmTotpSetup(db: DB, id: number, code: string, keepSession?: string): string[] {
  const row = totpRow(db, id);
  if (!row?.totp_secret) throw new Error("Önce kurulumu başlatın");
  if (row.totp_enabled_at) throw new Error("İki adımlı doğrulama zaten açık");
  const step = matchTotpStep(decryptSecret(row.totp_secret), cleanCode(code), null);
  if (step == null) throw new Error("Kod hatalı. Telefonun saatinin doğru olduğundan emin olun.");
  return db.transaction(() => {
    db.prepare("UPDATE admin_users SET totp_enabled_at = datetime('now'), totp_last_step = ? WHERE id = ?").run(step, id);
    deleteOtherSessions(db, id, keepSession);
    audit(db, id, "admin.2fa_enable", id);
    return replaceRecoveryCodes(db, id);
  })();
}

export function regenerateRecoveryCodes(db: DB, id: number): string[] {
  return db.transaction(() => {
    audit(db, id, "admin.2fa_codes", id);
    return replaceRecoveryCodes(db, id);
  })();
}

function replaceRecoveryCodes(db: DB, id: number): string[] {
  const codes = Array.from({ length: RECOVERY_CODES }, () =>
    randomBytes(8).toString("hex").replace(/(.{4})(?=.)/g, "$1-"),
  );
  db.prepare("DELETE FROM admin_recovery_codes WHERE user_id = ?").run(id);
  const insert = db.prepare("INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (?, ?)");
  for (const code of codes) insert.run(id, hashCode(cleanCode(code)));
  return codes;
}

export function recoveryCodesLeft(db: DB, id: number): number {
  return db.prepare("SELECT count(*) FROM admin_recovery_codes WHERE user_id = ?").pluck().get(id) as number;
}

/** İki adımlı doğrulamayı kapatır. Kendisi kapatırken şifre ve kod ister; telefonu kaybolana yönetici ya da komut satırı kapatır. */
export function disableTotp(db: DB, email: string, actorId: number | null = null): void {
  const user = findAdminByEmail(db, email);
  if (!user) throw new Error(`${email} bulunamadı`);
  db.transaction(() => {
    db.prepare("UPDATE admin_users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?").run(user.id);
    db.prepare("DELETE FROM admin_recovery_codes WHERE user_id = ?").run(user.id);
    deleteTokens(db, user.id, "two_factor");
    audit(db, actorId, "admin.2fa_disable", user.id, { email: user.email, via: actorId ? "panel" : "cli" });
  })();
}
