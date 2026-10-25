"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { googleTakenOrNull } from "@/lib/google/taken.ts";
import {
  createTeachers,
  draftTeachers,
  markTeacherLeft,
  revealTeacherPassword,
  TeacherError,
  undoTeacherLeft,
  updateTeacher,
  type TeacherDraft,
} from "@/lib/teachers.ts";

async function guard<T extends object>(fn: () => Promise<T> | T, paths: string[]): Promise<T | { error: string }> {
  try {
    const res = await fn();
    paths.forEach((p) => revalidatePath(p));
    return res;
  } catch (e) {
    if (e instanceof TeacherError) return { error: e.message };
    throw e;
  }
}

export async function draftTeachersAction(text: string): Promise<{ rows?: TeacherDraft[]; googleChecked?: boolean; error?: string }> {
  await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  return guard(async () => ({ rows: await draftTeachers(getDb(), text, taken), googleChecked: Boolean(taken) }), []);
}

export async function createTeachersAction(
  rows: { firstName: string; lastName: string; branch?: string; email: string }[],
): Promise<{ ids?: number[]; error?: string }> {
  const user = await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  return guard(() => ({ ids: createTeachers(getDb(), rows, user.id, taken) }), ["/ogretmenler", "/"]);
}

export async function updateTeacherAction(
  id: number,
  input: { firstName: string; lastName: string; branch?: string },
): Promise<{ error?: string }> {
  const user = await requireUser("ADMIN");
  return guard(() => (updateTeacher(getDb(), id, input, user.id), {}), ["/ogretmenler", `/ogretmenler/${id}`]);
}

export async function markTeacherLeftAction(id: number): Promise<{ error?: string }> {
  const user = await requireUser("ADMIN");
  return guard(() => (markTeacherLeft(getDb(), id, user.id), {}), ["/ogretmenler", `/ogretmenler/${id}`, "/"]);
}

export async function undoTeacherLeftAction(id: number): Promise<{ error?: string }> {
  const user = await requireUser("ADMIN");
  return guard(() => (undoTeacherLeft(getDb(), id, user.id), {}), ["/ogretmenler", `/ogretmenler/${id}`, "/"]);
}

export async function revealTeacherPasswordAction(id: number): Promise<{ password?: string; error?: string }> {
  const user = await requireUser("ADMIN");
  const password = revealTeacherPassword(getDb(), id, user.id);
  return password ? { password } : { error: "Bu öğretmen için kayıtlı ilk şifre yok." };
}
