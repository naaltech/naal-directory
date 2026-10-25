import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import { confirmSeq, getImportBatch } from "@/lib/import/students.ts";
import { latestListYear, listYearProblem } from "@/lib/years.ts";
import { Preview, type YearInfo } from "./preview.tsx";

export const metadata: Metadata = { title: "Önizleme" };

export default async function ImportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const data = getImportBatch(db, id);
  if (!data) notFound();
  const { batch, rows } = data;
  const latest = latestListYear(db);
  const listYear = batch.summary.year;
  const yearInfo: YearInfo = {
    latest: latest?.name,
    gap: latest && listYear ? listYear.start - latest.start : undefined,
    problem:
      batch.status !== "PARSED"
        ? undefined
        : listYear
          ? (listYearProblem(db, listYear.start) ?? undefined)
          : "Bu önizlemede eğitim yılı yok. Listeyi tekrar yükleyin.",
  };

  return (
    <Preview
      batch={{
        id: batch.id,
        fileName: batch.file_name,
        status: batch.status,
        createdAt: formatDateTime(batch.created_at),
        createdBy: batch.created_by_name,
        academicYear: batch.academic_year,
        summary: batch.summary,
      }}
      rows={rows}
      yearInfo={yearInfo}
      stale={batch.status === "PARSED" && (batch.summary.basisSeq ?? 0) !== confirmSeq(db)}
      canEdit={user.role !== "VIEWER" && batch.status === "PARSED"}
    />
  );
}
