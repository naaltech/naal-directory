import type { Metadata } from "next";
import { CodeSnippet, Tile } from "@carbon/react";
import { PageHeader } from "@/components/page-header.tsx";
import { listAdmins } from "@/lib/auth/admins.ts";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb, sqlDate } from "@/lib/db.ts";
import { AdminsTable } from "./admins-table.tsx";

export const metadata: Metadata = { title: "Yöneticiler" };

export default async function AdminsPage() {
  const me = await requireUser("ADMIN");
  const admins = listAdmins(getDb());
  const isSuper = me.role === "SUPER_ADMIN";

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Yöneticiler"
        description={
          isSuper
            ? "Yönetici ve görüntüleyici hesaplarını buradan ekleyip yönetebilir, süper yöneticiliği devredebilirsiniz."
            : "Yönetici hesaplarını sadece süper yönetici ekler ve değiştirir."
        }
      />

      <AdminsTable admins={admins} meId={me.id} isSuper={isSuper} now={sqlDate(new Date())} />

      <Tile className="mt-8">
        <h2 className="mb-2 text-lg">Roller</h2>
        <p className="mb-4 text-sm text-secondary">
          Süper yönetici: her şey ve yönetici hesapları · Yönetici: öğrenci, öğretmen, kulüp, içe aktarma ve
          senkronizasyon · Görüntüleyici: sadece okuma. Süper yönetici hesapları panelden değiştirilemez; süper
          yöneticilik devredilir. Son aktif süper yönetici silinemez veya pasifleştirilemez.
        </p>
        {isSuper && (
          <>
            <p className="mb-2 text-sm text-secondary">
              Panele erişim kalmadığında (ör. tek süper yöneticinin şifresi unutuldu) sunucuda komut satırından:
            </p>
            <CodeSnippet type="multi" feedback="Kopyalandı">
              {["npm run admin -- list", "npm run admin -- passwd <e-posta>", "npm run admin -- role <e-posta> SUPER_ADMIN"].join(
                "\n",
              )}
            </CodeSnippet>
          </>
        )}
      </Tile>
    </div>
  );
}
