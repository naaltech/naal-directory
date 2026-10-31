import type { Metadata } from "next";
import { InlineNotification, Tile } from "@carbon/react";
import { LinkButton } from "@/components/link-button.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { scanCleanup, type CleanupScan } from "@/lib/cleanup.ts";
import { getDb } from "@/lib/db.ts";
import { leaverCandidates } from "@/lib/leavers.ts";
import { CleanupForm } from "./cleanup-form.tsx";

export const metadata: Metadata = { title: "Temizlik" };
export const dynamic = "force-dynamic";

function scanHref() {
  return `/temizlik?tara=${Date.now()}`;
}

export default async function CleanupPage({ searchParams }: { searchParams: Promise<{ tara?: string }> }) {
  const user = await requireUser();
  const { tara } = await searchParams;
  const db = getDb();
  const leavers = leaverCandidates(db).rows.length;

  let scan: CleanupScan | undefined;
  let error: string | undefined;
  if (tara) {
    try {
      scan = await scanCleanup(db);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Temizlik"
        description="Sınıflar değiştikçe boş kalan şube OU'ları ve kullanılmayan sınıf grupları. Tarama Google'ı sadece okur; silme seçilenler için kuyruktan yapılır."
        actions={<LinkButton href={scanHref()}>{scan ? "Yeniden tara" : "Google'ı tara"}</LinkButton>}
      />
      {leavers > 0 && (
        <div className="mb-6">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title={`Önce ${leavers} ayrılan adayını onaylayın`}
            subtitle="Mezun / nakil olarak işaretlenmemiş öğrenciler eski şube OU'larında durduğu için o OU'lar boş görünmez."
          />
        </div>
      )}
      {error && (
        <div className="mb-6">
          <InlineNotification kind="error" lowContrast hideCloseButton title="Taranamadı" subtitle={error} />
        </div>
      )}
      {scan ? (
        <CleanupForm key={scan.scannedAt} scan={scan} canEdit={user.role !== "VIEWER"} />
      ) : (
        !error && (
          <Tile>
            <p className="text-sm text-secondary">
              Taramada Google&apos;daki OU, kullanıcı ve grup listeleri okunur (hiçbir şey değişmez). Ardından boş olanları
              seçip silme işlerini kuyruğa alabilirsiniz. Sadece şube OU&apos;ları (/Ogrenciler/9/9-F gibi) silinebilir;
              sınıf seviyesi ve üst OU&apos;lar (/Ogrenciler, /Mezunlar, /Nakil, /Kulupler, /Ogretmenler) hiçbir zaman
              silinmez.
            </p>
          </Tile>
        )
      )}
    </div>
  );
}
