import type { Metadata } from "next";
import { InlineNotification } from "@carbon/react";
import { findAdminById } from "@/lib/auth/admins.ts";
import { findToken } from "@/lib/auth/tokens.ts";
import { getDb } from "@/lib/db.ts";
import { AuthCard } from "../auth-card.tsx";
import { ConfirmEmailForm } from "./confirm-email-form.tsx";

// Bağlantıdaki anahtar başka siteye gitmesin
export const metadata: Metadata = { title: "E-posta onayı", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const db = getDb();
  const token = findToken(db, t, "email_change");
  const user = token && findAdminById(db, token.user_id);

  return (
    <AuthCard title="E-posta onayı" description="Yönetici hesabınızın adresi değişecek.">
      {user && token.new_email ? (
        <ConfirmEmailForm token={t!} from={user.email} to={token.new_email} />
      ) : (
        <InlineNotification
          kind="error"
          title="Bağlantı geçersiz"
          subtitle="Bağlantının süresi dolmuş ya da kullanılmış. Hesap sayfasından yeniden isteyin."
          hideCloseButton
          lowContrast
        />
      )}
    </AuthCard>
  );
}
