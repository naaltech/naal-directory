"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  confirmEmailChange,
  requestPasswordReset,
  resetPassword,
  sendEmailChangedNotice,
  sendPasswordResetMail,
} from "@/lib/auth/account.ts";
import { verifyLogin, type LoginResult } from "@/lib/auth/admins.ts";
import { TWO_FACTOR_COOKIE } from "@/lib/auth/cookie.ts";
import { clientIp, startSession } from "@/lib/auth/server.ts";
import { verifyTurnstile } from "@/lib/auth/turnstile.ts";
import { verifyTwoFactor } from "@/lib/auth/two-factor.ts";
import { getDb } from "@/lib/db.ts";

export interface LoginState {
  error?: string;
  email?: string;
}

export interface AccountLinkState {
  error?: string;
  done?: boolean;
}

/** Sadece site içi yollara yönlendir (açık yönlendirme açığını önler) */
function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

function failureMessage(result: Exclude<LoginResult, { ok: true }>): string {
  switch (result.reason) {
    case "locked":
      return "Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi.";
    case "disabled":
      return "Bu hesap pasif. Bir süper yöneticiye başvurun.";
    case "expired":
      return "Süre doldu. Baştan giriş yapın.";
    default:
      return "E-posta veya şifre hatalı.";
  }
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { email, error: "E-posta ve şifre gerekli." };

  // Şifreden önce: bot hatalı deneme sayacını artırıp hesabı kilitleyemesin
  const human = await verifyTurnstile(String(form.get("cf-turnstile-response") ?? ""), await clientIp());
  if (!human.ok) return { email, error: human.error };

  const result = await verifyLogin(getDb(), email, password);
  const next = safeNext(form.get("next"));
  if (!result.ok) {
    if (result.reason !== "two_factor") return { email, error: failureMessage(result) };
    (await cookies()).set(TWO_FACTOR_COOKIE, result.challenge, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/login",
      maxAge: 5 * 60,
    });
    redirect(`/login/dogrulama?next=${encodeURIComponent(next)}`);
  }

  await startSession(result.user.id);
  redirect(next);
}

export async function twoFactorAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const code = String(form.get("code") ?? "");
  if (!code.trim()) return { error: "Kodu girin." };

  const jar = await cookies();
  const result = verifyTwoFactor(getDb(), jar.get(TWO_FACTOR_COOKIE)?.value, code);
  if (!result.ok) {
    if (result.reason === "invalid") return { error: "Kod hatalı." };
    return { error: result.reason === "two_factor" ? "Baştan giriş yapın." : failureMessage(result) };
  }

  jar.delete({ name: TWO_FACTOR_COOKIE, path: "/login" });
  await startSession(result.user.id);
  redirect(safeNext(form.get("next")));
}

export async function forgotPasswordAction(_prev: AccountLinkState, form: FormData): Promise<AccountLinkState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "E-posta adresinizi girin." };
  const human = await verifyTurnstile(String(form.get("cf-turnstile-response") ?? ""), await clientIp());
  if (!human.ok) return { error: human.error };

  const request = requestPasswordReset(getDb(), email);
  // Beklenmez: yanıt süresi hesabın var olup olmadığını ele vermesin
  if (request) sendPasswordResetMail(request.user, request.token).catch((e) => console.error("Şifre sıfırlama e-postası gitmedi:", e));
  return { done: true };
}

export async function newPasswordAction(_prev: AccountLinkState, form: FormData): Promise<AccountLinkState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("repeat") ?? "")) return { error: "Şifreler eşleşmedi." };
  try {
    await resetPassword(getDb(), String(form.get("token") ?? ""), password);
    return { done: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function confirmEmailAction(_prev: AccountLinkState, form: FormData): Promise<AccountLinkState> {
  try {
    const { oldEmail, user } = confirmEmailChange(getDb(), String(form.get("token") ?? ""));
    sendEmailChangedNotice(oldEmail, user).catch((e) => console.error("Adres değişikliği bildirimi gitmedi:", e));
    return { done: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
