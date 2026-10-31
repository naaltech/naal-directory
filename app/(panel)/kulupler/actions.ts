"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server.ts";
import {
  addMembers,
  assignAdvisor,
  assignOfficer,
  closeClub,
  ClubError,
  createClub,
  endAdvisor,
  endOfficer,
  removeMember,
  searchActiveStudents,
  suggestAlias,
  reapplyClubSettings,
  updateClub,
  type OfficerTitle,
} from "@/lib/clubs.ts";
import { getDb } from "@/lib/db.ts";
import { googleTakenOrNull } from "@/lib/google/taken.ts";

export interface ActionResult {
  error?: string;
  id?: number;
}

async function run(fn: () => Promise<ActionResult | void> | ActionResult | void, paths: string[]): Promise<ActionResult> {
  try {
    const res = (await fn()) ?? {};
    paths.forEach((p) => revalidatePath(p));
    return res;
  } catch (e) {
    if (e instanceof ClubError) return { error: e.message };
    throw e;
  }
}

export async function createClubAction(input: { code: string; name: string; description?: string; isEvent?: boolean }): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  return run(() => ({ id: createClub(getDb(), input, user.id, taken) }), ["/kulupler"]);
}

export async function searchStudentsAction(q: string) {
  await requireUser("ADMIN");
  return searchActiveStudents(getDb(), q).map((s) => ({
    id: s.id,
    label: `${s.first_name} ${s.last_name}${s.class_name ? ` · ${s.class_name}` : ""} · ${s.school_no}`,
  }));
}

export async function addMemberAction(clubId: number, studentId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => void addMembers(getDb(), clubId, [studentId], user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function removeMemberAction(clubId: number, studentId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => removeMember(getDb(), clubId, studentId, user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function suggestAliasAction(studentId: number): Promise<{ local?: string; error?: string }> {
  await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  try {
    return { local: await suggestAlias(getDb(), studentId, taken) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function assignOfficerAction(input: {
  clubId: number;
  studentId: number;
  title: OfficerTitle;
  aliasLocal: string;
}): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  // Önbelleği atla: adres az önce başka birine verilmiş olabilir
  const { taken } = await googleTakenOrNull();
  return run(() => ({ id: assignOfficer(getDb(), input, user.id, taken) }), [`/kulupler/${input.clubId}`, "/kulupler"]);
}

export async function endOfficerAction(clubId: number, officerId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => endOfficer(getDb(), officerId, user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function updateClubAction(clubId: number, input: { name: string; description?: string; isEvent: boolean }): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => updateClub(getDb(), clubId, input, user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function closeClubAction(clubId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => closeClub(getDb(), clubId, user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function reapplyClubSettingsAction(clubId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => reapplyClubSettings(getDb(), clubId, user.id), [`/kulupler/${clubId}`]);
}

export async function assignAdvisorAction(clubId: number, teacherId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => ({ id: assignAdvisor(getDb(), clubId, teacherId, user.id) }), [`/kulupler/${clubId}`, "/kulupler"]);
}

export async function endAdvisorAction(clubId: number, advisorId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => endAdvisor(getDb(), advisorId, user.id), [`/kulupler/${clubId}`, "/kulupler"]);
}
