"use server";

import { redirect } from "next/navigation";
import { verifyLogin } from "@/lib/auth/admins.ts";
import { clientIp, startSession } from "@/lib/auth/server.ts";
import { verifyTurnstile } from "@/lib/auth/turnstile.ts";
import { getDb } from "@/lib/db.ts";

export interface LoginState {
  error?: string;
  email?: string;
}

/** Sadece site içi yollara yönlendir (açık yönlendirme açığını önler) */
function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { email, error: "E-posta ve şifre gerekli." };

  // Şifreden önce: bot hatalı deneme sayacını artırıp hesabı kilitleyemesin
  const human = await verifyTurnstile(String(form.get("cf-turnstile-response") ?? ""), await clientIp());
  if (!human.ok) return { email, error: human.error };

  const result = await verifyLogin(getDb(), email, password);
  if (!result.ok) {
    const error =
      result.reason === "locked"
        ? "Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi."
        : result.reason === "disabled"
          ? "Bu hesap pasif. Bir süper yöneticiye başvurun."
          : "E-posta veya şifre hatalı.";
    return { email, error };
  }

  await startSession(result.user.id);
  redirect(safeNext(form.get("next")));
}
