import type { Metadata } from "next";
import { InlineNotification } from "@carbon/react";
import { findToken } from "@/lib/auth/tokens.ts";
import { getDb } from "@/lib/db.ts";
import { AuthCard } from "../auth-card.tsx";
import { NewPasswordForm } from "./new-password-form.tsx";

// Bağlantıdaki anahtar başka siteye gitmesin
export const metadata: Metadata = { title: "Yeni şifre", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const valid = Boolean(findToken(getDb(), t, "password_reset"));

  return (
    <AuthCard title="Yeni şifre" description="Hesabınız için yeni bir şifre belirleyin. Açık oturumlarınız kapanır.">
      {valid ? (
        <NewPasswordForm token={t!} />
      ) : (
        <InlineNotification
          kind="error"
          title="Bağlantı geçersiz"
          subtitle="Bağlantının süresi dolmuş ya da kullanılmış. Şifremi unuttum sayfasından yenisini isteyin."
          hideCloseButton
          lowContrast
        />
      )}
    </AuthCard>
  );
}
