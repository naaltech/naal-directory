"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { googleTakenOrNull } from "@/lib/google/taken.ts";
import {
  addGroupAlias,
  addGroupTeachers,
  closeTeacherGroup,
  createTeacherGroup,
  GroupError,
  groupPagePath,
  removeGroupAlias,
  removeGroupMember,
  setGroupMemberRole,
  updateTeacherGroup,
  type MemberRole,
} from "@/lib/groups.ts";

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
    if (e instanceof GroupError) return { error: e.message };
    throw e;
  }
}

export async function createGroupAction(input: {
  name: string;
  local: string;
  domain: string;
  description?: string;
  allowExternal: boolean;
}): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  return run(() => ({ id: createTeacherGroup(getDb(), input, user.id, taken) }), ["/gruplar"]);
}

export async function updateGroupAction(
  groupId: number,
  input: { name: string; description?: string; allowExternal: boolean },
): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => updateTeacherGroup(getDb(), groupId, input, user.id), [`/gruplar/${groupId}`, "/gruplar"]);
}

export async function closeGroupAction(groupId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => closeTeacherGroup(getDb(), groupId, user.id), [`/gruplar/${groupId}`, "/gruplar"]);
}

export async function addGroupTeacherAction(groupId: number, teacherId: number, role: MemberRole): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => void addGroupTeachers(getDb(), groupId, [teacherId], role, user.id), [`/gruplar/${groupId}`, "/gruplar"]);
}

export async function removeGroupMemberAction(groupId: number, memberId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => removeGroupMember(getDb(), groupId, memberId, user.id), [`/gruplar/${groupId}`, "/gruplar"]);
}

export async function setGroupMemberRoleAction(groupId: number, memberId: number, role: MemberRole): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  return run(() => setGroupMemberRole(getDb(), groupId, memberId, role, user.id), [`/gruplar/${groupId}`]);
}

// Alt adresler: kulüp sayfasında da kullanılır
export async function addGroupAliasAction(groupId: number, local: string, domain: string): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  const { taken } = await googleTakenOrNull();
  const db = getDb();
  return run(
    () => ({ id: addGroupAlias(db, { groupId, local, domain }, user.id, taken) }),
    [groupPagePath(db, groupId), "/gruplar", "/kulupler"],
  );
}

export async function removeGroupAliasAction(groupId: number, aliasId: number): Promise<ActionResult> {
  const user = await requireUser("ADMIN");
  const db = getDb();
  return run(() => removeGroupAlias(db, aliasId, user.id), [groupPagePath(db, groupId), "/gruplar", "/kulupler"]);
}
