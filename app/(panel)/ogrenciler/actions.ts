"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { changeEmail, EmailChangeError } from "@/lib/email-change.ts";
import { googleTakenOrNull } from "@/lib/google/taken.ts";
import { PasswordResetError, resetPassword } from "@/lib/password-reset.ts";
import { LeaverError, markLeavers, undoLeave, type ExitReason } from "@/lib/leavers.ts";
import { revealInitialPassword } from "@/lib/students.ts";

export async function revealPasswordAction(studentId: number): Promise<{ password?: string; error?: string }> {
  const user = await requireUser("ADMIN");
  const password = revealInitialPassword(getDb(), studentId, user.id);
  return password ? { password } : { error: "Bu öğrenci için kayıtlı ilk şifre yok." };
}

function revalidateStudents(ids: number[]) {
  revalidatePath("/ogrenciler");
  revalidatePath("/ogrenciler/ayrilanlar");
  revalidatePath("/");
  for (const id of ids) revalidatePath(`/ogrenciler/${id}`);
}

export async function markLeaversAction(
  items: { studentId: number; reason: ExitReason }[],
): Promise<{ count?: number; error?: string }> {
  const user = await requireUser("ADMIN");
  try {
    const count = markLeavers(getDb(), items, user.id);
    revalidateStudents(items.map((i) => i.studentId));
    return { count };
  } catch (e) {
    if (e instanceof LeaverError) return { error: e.message };
    throw e;
  }
}

export async function changeStudentEmailAction(studentId: number, local: string): Promise<{ email?: string; error?: string }> {
  const user = await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  try {
    const email = changeEmail(getDb(), { type: "student", id: studentId, local }, user.id, taken);
    revalidateStudents([studentId]);
    return { email };
  } catch (e) {
    if (e instanceof EmailChangeError) return { error: e.message };
    throw e;
  }
}

// Sayfa yenilemesi istemcide, şifre penceresi kapanınca yapılır (yenileme pencereyi kapatmasın diye)
export async function resetStudentPasswordAction(studentId: number): Promise<{ password?: string; error?: string }> {
  const user = await requireUser("ADMIN");
  try {
    return { password: resetPassword(getDb(), { type: "student", id: studentId }, user.id) };
  } catch (e) {
    if (e instanceof PasswordResetError) return { error: e.message };
    throw e;
  }
}

export async function undoLeaveAction(studentId: number): Promise<{ error?: string }> {
  const user = await requireUser("ADMIN");
  try {
    undoLeave(getDb(), studentId, user.id);
    revalidateStudents([studentId]);
    return {};
  } catch (e) {
    if (e instanceof LeaverError) return { error: e.message };
    throw e;
  }
}
