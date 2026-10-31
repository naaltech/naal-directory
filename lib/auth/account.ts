// Yöneticinin kendi hesabı: e-posta ile şifre sıfırlama ve e-posta adresi değiştirme.

import type { DB } from "../db.ts";
import { sendAccountMail } from "../mailer.ts";
import { audit, findAdminByEmail, findAdminById, normalizeEmail, setAdminPassword, type AdminUser } from "./admins.ts";
import { passwordProblem } from "./password.ts";
import { createToken, deleteTokens, findToken, tokenRecentlyCreated } from "./tokens.ts";

/** Yönetici adresi bu alan adlarından biri olabilir; öğrenci alan adı bilerek yok */
export const ADMIN_EMAIL_DOMAINS = ["nevzatayazal.k12.tr", "naal.org.tr"];

const RESET_MINUTES = 60;
const EMAIL_CHANGE_MINUTES = 24 * 60;
/** Aynı hesaba bu kadar dakikada bir sıfırlama e-postası gider */
const RESET_THROTTLE_MINUTES = 5;

const appUrl = () => (process.env.APP_URL ?? "https://dir.naal.org.tr").replace(/\/$/, "");

/** Hesap yoksa, pasifse ya da az önce istendiyse null döner; dışarıya aynı yanıt verilir, hesap var mı anlaşılmaz. */
export function requestPasswordReset(db: DB, email: string): { user: AdminUser; token: string } | null {
  const user = findAdminByEmail(db, email);
  if (!user?.is_active || tokenRecentlyCreated(db, user.id, "password_reset", RESET_THROTTLE_MINUTES)) return null;
  audit(db, user.id, "admin.password_reset_requested", user.id);
  return { user, token: createToken(db, user.id, "password_reset", RESET_MINUTES) };
}

export async function sendPasswordResetMail(user: AdminUser, token: string): Promise<void> {
  await sendAccountMail(user.email, {
    subject: "NAAL Dizin şifre sıfırlama",
    text: [
      `Merhaba ${user.name},`,
      "",
      "Şifrenizi sıfırlamak için bu bağlantıyı açın. Bağlantı 1 saat geçerlidir ve bir kez kullanılır:",
      `${appUrl()}/login/yeni-sifre?t=${token}`,
      "",
      "Bu isteği siz yapmadıysanız bu e-postayı yok sayın; şifreniz değişmez.",
    ].join("\n"),
  });
}

/** Geçersiz şifrede anahtar harcanmaz, kişi yeniden deneyebilir. Açık oturumlar kapanır, iki adımlı doğrulama açık kalır. */
export async function resetPassword(db: DB, token: string, password: string): Promise<void> {
  const found = findToken(db, token, "password_reset");
  const user = found && findAdminById(db, found.user_id);
  if (!user?.is_active) throw new Error("Bağlantı geçersiz ya da süresi dolmuş. Yeni bağlantı isteyin.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await setAdminPassword(db, user.email, password, user.id);
  deleteTokens(db, user.id, "password_reset");
}

/** Yeni adresi denetler; şifre ve tek kullanımlık kod istenmeden önce çağrılır, yazım hatası kod harcatmaz. */
export function checkNewEmail(db: DB, id: number, newEmail: string): { user: AdminUser; email: string } {
  const user = findAdminById(db, id);
  if (!user) throw new Error("Hesap bulunamadı");
  const email = normalizeEmail(newEmail);
  const [local, domain, ...rest] = email.split("@");
  if (!local || rest.length || !ADMIN_EMAIL_DOMAINS.includes(domain ?? "") || /\s/.test(local)) {
    throw new Error(`Adres ${ADMIN_EMAIL_DOMAINS.map((d) => `@${d}`).join(" ya da ")} ile bitmeli`);
  }
  if (email === user.email) throw new Error("Bu zaten hesabınızın adresi");
  if (findAdminByEmail(db, email)) throw new Error(`${email} başka bir yöneticide kayıtlı`);
  return { user, email };
}

/** Adres, yeni adrese giden bağlantı açılınca değişir; yazım hatası hesabı kilitlemez. */
export function requestEmailChange(db: DB, id: number, newEmail: string): { user: AdminUser; email: string; token: string } {
  const { user, email } = checkNewEmail(db, id, newEmail);
  audit(db, id, "admin.email_change_requested", id, { to: email });
  return { user, email, token: createToken(db, id, "email_change", EMAIL_CHANGE_MINUTES, email) };
}

export async function sendEmailChangeMail(user: AdminUser, email: string, token: string): Promise<void> {
  await sendAccountMail(email, {
    subject: "NAAL Dizin e-posta adresi onayı",
    text: [
      `Merhaba ${user.name},`,
      "",
      `Dizin hesabınızın adresi ${user.email} iken ${email} olacak.`,
      "Onaylamak için bu bağlantıyı açın. Bağlantı 24 saat geçerlidir:",
      `${appUrl()}/login/eposta-onay?t=${token}`,
      "",
      "Bu isteği siz yapmadıysanız bu e-postayı yok sayın; adres değişmez.",
    ].join("\n"),
  });
}

/** Adresi değiştirir. Panel yetkisi adrese bağlı olduğu için bir sonraki eşitlemede yeni adrese geçer. */
export function confirmEmailChange(db: DB, token: string): { oldEmail: string; user: AdminUser } {
  const found = findToken(db, token, "email_change");
  const user = found && findAdminById(db, found.user_id);
  if (!found?.new_email || !user?.is_active) throw new Error("Bağlantı geçersiz ya da süresi dolmuş. Hesap sayfasından yeniden isteyin.");
  if (findAdminByEmail(db, found.new_email)) throw new Error(`${found.new_email} başka bir yöneticide kayıtlı`);
  db.transaction(() => {
    db.prepare("UPDATE admin_users SET email = ? WHERE id = ?").run(found.new_email, user.id);
    deleteTokens(db, user.id, "email_change");
    deleteTokens(db, user.id, "password_reset");
    audit(db, user.id, "admin.email_change", user.id, { from: user.email, to: found.new_email });
  })();
  return { oldEmail: user.email, user: findAdminById(db, user.id)! };
}

/** Eski adrese haber verilir: hesap başkasının elindeyse sahibi görür. */
export async function sendEmailChangedNotice(oldEmail: string, user: AdminUser): Promise<void> {
  await sendAccountMail(oldEmail, {
    subject: "NAAL Dizin e-posta adresiniz değişti",
    text: [
      `Merhaba ${user.name},`,
      "",
      `Dizin hesabınızın adresi ${user.email} oldu. Bu değişikliği siz yapmadıysanız hemen bir süper yöneticiye başvurun.`,
    ].join("\n"),
  });
}
