import type { Metadata } from "next";
import Link from "next/link";
import { InlineNotification, Tile } from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import { PageHeader } from "@/components/page-header.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { leaverCandidates, retentionDays } from "@/lib/leavers.ts";
import { LeaversForm } from "./leavers-form.tsx";

export const metadata: Metadata = { title: "Ayrılanlar" };

export default async function LeaversPage() {
  const user = await requireUser();
  const db = getDb();
  const { yearName, listLoaded, rows, held } = leaverCandidates(db);
  const grad = retentionDays(db, "GRADUATED");
  const trans = retentionDays(db, "TRANSFERRED");

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/ogrenciler" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Öğrenciler
      </Link>
      <PageHeader
        title="Ayrılanlar"
        description={`Kayıtlı olup ${yearName ?? "güncel yılın"} listesinde olmayan öğrenciler. Son sınıfı ve aradan geçen yıla göre 12. sınıfı bitirmiş olanlar mezun, diğerleri nakil önerilir.`}
      />
      <Tile className="mb-8">
        <p className="text-sm">
          Onaylanan öğrenci sınıf ve kulüp gruplarından çıkarılır, kulüp görevleri biter ve hesabı{" "}
          <span className="font-mono">/Mezunlar</span> ya da <span className="font-mono">/Nakil</span> OU&apos;suna
          taşınır. Mezunların hesabı {grad.suspend} gün sonra askıya alınır, {grad.remove} gün sonra silinir; nakil
          gidenler için {trans.suspend} ve {trans.remove} gün.
        </p>
      </Tile>

      {held.length > 0 && (
        <div className="mb-6">
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Liste eksik olabilir"
            subtitle={`${held
              .map((h) => `${h.count} öğrenci ${h.grade}. sınıfta olmalı`)
              .join(", ")}, ama ${yearName} için bu sınıfların hiç şubesi yüklenmedi. Bu öğrenciler aday sayılmadı; o sınıfların listesi yüklenince burada görünürler.`}
          />
        </div>
      )}

      {!listLoaded ? (
        <p className="text-sm text-secondary">
          {yearName ?? "Güncel yıl"} için henüz liste onaylanmadı. Yeni yılın listesi onaylanınca, listede olmayan öğrenciler
          burada görünür.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-secondary">Ayrılan adayı yok: okuldaki bütün öğrenciler {yearName} listesinde.</p>
      ) : (
        <LeaversForm rows={rows} canEdit={user.role !== "VIEWER"} />
      )}
    </div>
  );
}
