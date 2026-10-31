"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/lib/audit.ts";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { pauseAuto, resumeAuto } from "@/lib/sync/auto.ts";
import { getRun, requestStop, RunError, startRun, type RunMode, type SyncRun } from "@/lib/sync/runner.ts";
import { retryFailed } from "@/lib/sync/worker.ts";

export async function setAutoAction(enabled: boolean): Promise<void> {
  const user = await requireUser("ADMIN");
  const db = getDb();
  if (enabled) resumeAuto(db);
  else pauseAuto(db, `${user.name} durdurdu.`);
  logAction(db, user.id, enabled ? "sync.auto_resume" : "sync.auto_pause", "sync_run");
  revalidatePath("/senkronizasyon");
}

export async function retryFailedAction(): Promise<number> {
  const user = await requireUser("ADMIN");
  const db = getDb();
  const n = retryFailed(db);
  db.prepare(
    "INSERT INTO audit_logs (user_id, action, entity_type, details) VALUES (?, 'sync.retry', 'sync_job', ?)",
  ).run(user.id, JSON.stringify({ count: n }));
  revalidatePath("/senkronizasyon");
  revalidatePath("/");
  return n;
}

export async function startRunAction(mode: RunMode, limit?: number): Promise<{ run?: SyncRun; error?: string }> {
  const user = await requireUser("ADMIN");
  if (mode !== "DRY" && mode !== "LIVE") return { error: "Geçersiz çalıştırma türü." };
  const db = getDb();
  try {
    const id = startRun(db, { mode, limit, userId: user.id });
    return { run: getRun(db, id) };
  } catch (e) {
    if (e instanceof RunError) return { error: e.message };
    throw e;
  }
}

export async function runStatusAction(id: number): Promise<SyncRun | null> {
  await requireUser();
  return getRun(getDb(), id) ?? null;
}

export async function stopRunAction(id: number): Promise<void> {
  const user = await requireUser("ADMIN");
  const db = getDb();
  if (requestStop(db, id)) logAction(db, user.id, "sync.stop", "sync_run", id);
}
