import { PanelShell } from "@/components/panel-shell.tsx";
import { ROLE_LABELS } from "@/lib/auth/admins.ts";
import { requireUser } from "@/lib/auth/server.ts";

// Oturum ve veritabanı okunduğu için her istekte yeniden üretilir
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <PanelShell
      user={{
        name: user.name,
        email: user.email,
        roleLabel: ROLE_LABELS[user.role],
        canManageAdmins: user.role !== "VIEWER",
      }}
    >
      {children}
    </PanelShell>
  );
}
