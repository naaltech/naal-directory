// Kuyruğun insan beklemeden çalışması ve sigortası (scripts/worker.ts her dakika çağırır).
//
// - Silme işleri otomatik çalışmaz: panelde ya da komut satırında bir yöneticinin başlatması gerekir.
// - Askıya alma geri alınabilir; mezunların toplu askısı dahil makul sayıda otomatik yapılır, çoksa onay bekler.
// - Onaylanmış bir listenin işleri sınıra sayılmaz; bu kontrol listeden önce yapıldı (year-cycle.ts). Listeden
//   gelmeyen, beklenmedik büyüklükte iş yığını otomatik çalışmaz, onay bekler.
// - Bir çalıştırmada çok iş başarısız olursa çalıştırma durur ve otomatik mod yönetici açana kadar kapanır.
//
// Sınırlar settings tablosunda: sync.autoMaxJobs, sync.autoMaxSuspend, sync.autoMaxFailures.

import type { DB } from "../db.ts";
import { setting } from "../leavers.ts";
import { readSetting, removeSetting, writeSetting } from "../settings.ts";
import type { Google } from "./google.ts";
import { LockedError, runQueue, type RunReport } from "./worker.ts";

const NEVER_AUTO = ["DELETE_USER", "DELETE_GROUP", "DELETE_ORG_UNIT"];
const SAFE_ACTIONS = [
  "CREATE_ORG_UNIT", "CREATE_GROUP", "UPDATE_GROUP", "CREATE_USER", "UPDATE_USER",
  "ADD_MEMBER", "REMOVE_MEMBER", "ADD_ALIAS", "REMOVE_ALIAS",
];
const PAUSE_KEY = "sync.paused";
export const HEARTBEAT_KEY = "sync.heartbeat";
const HEARTBEAT_EVERY_MS = 60_000;

export interface AutoPlan {
  /** Otomatik çalışacak eylemler; boşsa çalıştırma yapılmaz */
  actions: string[];
  ready: number;
  held: { destructive: number; suspend: number; bulk: number };
}

export function planAutoRun(db: DB): AutoPlan {
  const rows = db
    .prepare(
      `SELECT action, count(*) AS n, count(import_batch_id) AS listed FROM sync_jobs
       WHERE status = 'QUEUED' AND run_after <= datetime('now') GROUP BY action`,
    )
    .all() as { action: string; n: number; listed: number }[];
  const count = (actions: string[]) => rows.filter((r) => actions.includes(r.action)).reduce((a, r) => a + r.n, 0);
  const listed = rows.filter((r) => SAFE_ACTIONS.includes(r.action)).reduce((a, r) => a + r.listed, 0);

  const safe = count(SAFE_ACTIONS);
  const suspend = count(["SUSPEND_USER"]);
  const bulk = safe - listed > setting(db, "sync.autoMaxJobs", 300);
  const suspendHeld = bulk || suspend > setting(db, "sync.autoMaxSuspend", 300);

  const actions = bulk ? [] : [...SAFE_ACTIONS, ...(suspendHeld ? [] : ["SUSPEND_USER"])];
  const ready = bulk ? 0 : safe + (suspendHeld ? 0 : suspend);
  return {
    actions: ready ? actions : [],
    ready,
    held: { destructive: count(NEVER_AUTO), suspend: suspendHeld ? suspend : 0, bulk: bulk ? safe : 0 },
  };
}

export interface AutoPause {
  reason: string;
  at: number;
}

export const autoPause = (db: DB) => readSetting<AutoPause>(db, PAUSE_KEY) ?? null;
export const pauseAuto = (db: DB, reason: string) => writeSetting(db, PAUSE_KEY, { reason, at: Date.now() });
export const resumeAuto = (db: DB) => removeSetting(db, PAUSE_KEY);

export type TickResult =
  | { state: "disabled" | "paused" | "idle" | "locked" }
  | { state: "ran"; report: RunReport };

/** `live` kapalıyken yalnızca canlılık sinyali yazılır, Google'a hiçbir şey gönderilmez */
export async function autoTick(db: DB, google: Google, opts: { live: boolean }): Promise<TickResult> {
  writeSetting(db, HEARTBEAT_KEY, Date.now());
  if (!opts.live) return { state: "disabled" };
  if (autoPause(db)) return { state: "paused" };
  const plan = planAutoRun(db);
  if (!plan.actions.length) return { state: "idle" };

  const maxFailures = setting(db, "sync.autoMaxFailures", 10);
  let failed = 0;
  let beat = Date.now();
  try {
    const report = await runQueue(db, {
      google,
      actions: plan.actions,
      shouldStop: () => failed >= maxFailures,
      onJob: (_job, result) => {
        if (result.state === "failed") failed++;
        if (Date.now() - beat >= HEARTBEAT_EVERY_MS) {
          beat = Date.now();
          writeSetting(db, HEARTBEAT_KEY, beat);
        }
      },
    });
    if (failed >= maxFailures) pauseAuto(db, `Bir çalıştırmada ${failed} iş başarısız oldu.`);
    return { state: "ran", report };
  } catch (e) {
    if (e instanceof LockedError) return { state: "locked" };
    throw e;
  }
}
