"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { ConfirmError, confirmImportBatch } from "@/lib/import/confirm.ts";
import { googleTakenOrNull } from "@/lib/google/taken.ts";
import {
  buildStudentPreview,
  deleteImportBatch,
  holdImportBatch,
  resolveConflict,
  saveImportBatch,
  updateRowEmail,
  type ImportSummary,
  type PreviewRow,
} from "@/lib/import/students.ts";
import { sendMail } from "@/lib/mailer.ts";
import { parseRoster } from "@/lib/roster/index.ts";
import { autoConfirmProblems, autoMarkLeavers, listConfirmedMail } from "@/lib/year-cycle.ts";
import { listYearProblem, schoolYearFor, yearName } from "@/lib/years.ts";

const MAX_BYTES = 20 * 1024 * 1024;

export interface UploadState {
  error?: string;
}

/** Liste onayı: ayrılanlar işaretlenir ve yöneticiye özet gider. E-posta sorunu onayı geri almaz. */
async function finishConfirm(batchId: number, userId: number) {
  const db = getDb();
  const result = confirmImportBatch(db, batchId, userId);
  const leavers = autoMarkLeavers(db);
  await sendMail(listConfirmedMail(result, leavers)).catch((e) => console.error(`Liste e-postası: ${(e as Error).message}`));
}

export async function uploadRosterAction(_prev: UploadState, form: FormData): Promise<UploadState> {
  const user = await requireUser("ADMIN");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Bir dosya seçin." };
  if (file.size > MAX_BYTES) return { error: "Dosya 20 MB'tan büyük olamaz." };

  let batchId: number;
  try {
    // Dosyanın kendisi saklanmaz (kişisel veri); sadece çözümlenmiş satırlar kaydedilir
    const bytes = new Uint8Array(await file.arrayBuffer());
    const roster = await parseRoster({ name: file.name, bytes });
    if (roster.sections.length === 0) return { error: "Dosyada şube bulunamadı. Doğru rapor mu?" };

    // Eğitim yılı: elle seçildiyse o, yoksa rapor tarihinden
    const db = getDb();
    const detected = roster.reportDate ? schoolYearFor(roster.reportDate) : undefined;
    const picked = Number(form.get("year")) || undefined;
    const start = picked ?? detected;
    if (!start) return { error: "Listede rapor tarihi bulunamadı. Listenin eğitim yılını seçip tekrar yükleyin." };
    const problem = listYearProblem(db, start);
    if (problem) return { error: problem };

    const google = await googleTakenOrNull();
    const { rows, sections } = await buildStudentPreview(db, roster, google.taken, start);
    const summary: ImportSummary = {
      schoolName: roster.schoolName,
      reportDate: roster.reportDate?.toISOString(),
      year: { start, name: yearName(start), source: picked ? "manual" : "report", detected },
      sections,
      issues: roster.issues,
      google: { checked: Boolean(google.taken), error: google.error, takenCount: google.taken?.size },
    };
    batchId = saveImportBatch(db, { fileName: file.name, parserId: roster.parserId, userId: user.id, roster, rows, summary });
    const problems = autoConfirmProblems(db, batchId);
    if (problems.length) holdImportBatch(db, batchId, problems);
    else await finishConfirm(batchId, user.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/ice-aktar");
  redirect(`/ice-aktar/${batchId}`);
}

export interface EmailEditResult {
  ok: boolean;
  email?: string;
  error?: string;
}

export async function updateEmailAction(batchId: number, rowId: number, local: string): Promise<EmailEditResult> {
  const user = await requireUser("ADMIN");
  const google = await googleTakenOrNull();
  const result = updateRowEmail(getDb(), { batchId, rowId, local, userId: user.id, googleTaken: google.taken });
  if (result.ok) revalidatePath(`/ice-aktar/${batchId}`);
  return result;
}

export async function deleteBatchAction(batchId: number) {
  const user = await requireUser("ADMIN");
  deleteImportBatch(getDb(), batchId, user.id);
  revalidatePath("/ice-aktar");
  redirect("/ice-aktar");
}

export async function confirmBatchAction(batchId: number): Promise<{ error?: string }> {
  const user = await requireUser("ADMIN");
  try {
    await finishConfirm(batchId, user.id);
  } catch (e) {
    if (e instanceof ConfirmError) return { error: e.message };
    throw e;
  }
  revalidatePath("/ice-aktar");
  revalidatePath(`/ice-aktar/${batchId}`);
  revalidatePath("/");
  return {};
}

export async function resolveConflictAction(
  batchId: number,
  rowId: number,
  choice: "same" | "new",
): Promise<{ row?: PreviewRow; error?: string }> {
  const user = await requireUser("ADMIN");
  if (choice !== "same" && choice !== "new") return { error: "Geçersiz seçim." };
  const google = choice === "new" ? await googleTakenOrNull() : { taken: null };
  const res = await resolveConflict(getDb(), { batchId, rowId, choice, userId: user.id, googleTaken: google.taken });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/ice-aktar/${batchId}`);
  return { row: res.row };
}
