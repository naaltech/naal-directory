"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/server.ts";
import { CleanupError, enqueueCleanup } from "@/lib/cleanup.ts";
import { getDb } from "@/lib/db.ts";

export async function enqueueCleanupAction(input: { ous: string[]; groupIds: number[] }): Promise<{ count?: number; error?: string }> {
  const user = await requireUser("ADMIN");
  try {
    const count = enqueueCleanup(getDb(), input, user.id);
    revalidatePath("/temizlik");
    revalidatePath("/senkronizasyon");
    return { count };
  } catch (e) {
    if (e instanceof CleanupError) return { error: e.message };
    throw e;
  }
}
