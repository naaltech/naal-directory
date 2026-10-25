import type { Metadata } from "next";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from "@carbon/react";
import { PageHeader } from "@/components/page-header.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { listImportBatches } from "@/lib/import/students.ts";
import { PARSERS } from "@/lib/roster/index.ts";
import { formatDateTime } from "@/lib/format.ts";
import { BATCH_STATUS } from "@/lib/import/labels.ts";
import { latestListYear, selectableYears } from "@/lib/years.ts";
import { UploadForm } from "./upload-form.tsx";

export const metadata: Metadata = { title: "Liste içe aktar" };

export default async function ImportPage() {
  const user = await requireUser();
  const db = getDb();
  const batches = listImportBatches(db);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Liste içe aktar"
        description="e-Okul sınıf listesini yükleyin. Şubeler, öğrenciler ve önerilen e-posta adresleri onaydan önce önizlemede gösterilir."
      />

      {user.role === "VIEWER" ? (
        <Tile className="mb-8">
          <p className="text-sm text-secondary">Görüntüleyici rolüyle liste yüklenemez.</p>
        </Tile>
      ) : (
        <Tile className="mb-8">
          <UploadForm formats={PARSERS.map((p) => p.label)} years={selectableYears(db)} latest={latestListYear(db)?.name} />
        </Tile>
      )}

      <TableContainer title="Önceki yüklemeler" description={batches.length ? undefined : "Henüz liste yüklenmedi."}>
        {batches.length > 0 && (
          <Table aria-label="Önceki yüklemeler">
            <TableHead>
              <TableRow>
                <TableHeader>Dosya</TableHeader>
                <TableHeader>Eğitim yılı</TableHeader>
                <TableHeader>Satır</TableHeader>
                <TableHeader>Sorunlu</TableHeader>
                <TableHeader>Durum</TableHeader>
                <TableHeader>Yükleyen</TableHeader>
                <TableHeader>Tarih</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {batches.map((b) => {
                const s = BATCH_STATUS[b.status] ?? { label: b.status, type: "gray" as const };
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/ice-aktar/${b.id}`} className="text-interactive hover:underline">
                        {b.file_name}
                      </Link>
                    </TableCell>
                    <TableCell>{b.academic_year ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{b.total_rows.toLocaleString("tr-TR")}</TableCell>
                    <TableCell className="tabular-nums">{b.error_rows.toLocaleString("tr-TR")}</TableCell>
                    <TableCell>
                      <Tag type={s.type} size="sm">
                        {s.label}
                      </Tag>
                    </TableCell>
                    <TableCell>{b.created_by_name ?? "—"}</TableCell>
                    <TableCell>{formatDateTime(b.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableContainer>
    </div>
  );
}
