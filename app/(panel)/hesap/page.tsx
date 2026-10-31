import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header.tsx";
import { ADMIN_EMAIL_DOMAINS } from "@/lib/auth/account.ts";
import { ROLE_LABELS } from "@/lib/auth/admins.ts";
import { requireUser } from "@/lib/auth/server.ts";
import { recoveryCodesLeft } from "@/lib/auth/two-factor.ts";
import { getDb } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import { EmailForm, PasswordForm, TwoFactorSection } from "./account-forms.tsx";

export const metadata: Metadata = { title: "Hesabım" };

export default async function AccountPage() {
  const me = await requireUser();
  const twoFactor = Boolean(me.totp_enabled_at);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Hesabım" description={`${me.name} · ${ROLE_LABELS[me.role]} · Son giriş: ${formatDateTime(me.last_login_at)}`} />
      <div className="flex flex-col gap-8">
        <EmailForm current={me.email} domains={ADMIN_EMAIL_DOMAINS} twoFactor={twoFactor} />
        <PasswordForm twoFactor={twoFactor} />
        <TwoFactorSection enabled={twoFactor} since={formatDateTime(me.totp_enabled_at)} codesLeft={recoveryCodesLeft(getDb(), me.id)} />
      </div>
    </div>
  );
}
