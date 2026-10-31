import type { Metadata } from "next";
import { turnstileSiteKey } from "@/lib/auth/turnstile.ts";
import { AuthCard } from "../auth-card.tsx";
import { ForgotForm } from "./forgot-form.tsx";

export const metadata: Metadata = { title: "Şifremi unuttum" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Şifremi unuttum" description="Yönetici e-posta adresinizi girin, şifre sıfırlama bağlantısı gönderelim.">
      <ForgotForm turnstileSiteKey={turnstileSiteKey()} />
    </AuthCard>
  );
}
