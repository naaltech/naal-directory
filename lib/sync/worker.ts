// sync_jobs kuyruğunu işleyen işçi. İşler id sırasıyla tek tek çalışır (OU → grup → kullanıcı → üyelik).
//
// - Geçici hata (429, 5xx, ağ): iş artan beklemeyle yeniden kuyruğa girer, en fazla MAX_ATTEMPTS deneme.
// - Kalıcı hata (diğer 4xx, çakışma): iş FAILED olur, ilgili kayıt ERROR'a çekilir.
// - Bir işin önce bitmesi gereken işi (aynı adresin CREATE_USER/CREATE_GROUP'u, OU'su) bekliyorsa
//   iş ertelenir; o iş başarısızsa bu da başarısız sayılır.
// - Aynı anda tek işçi çalışır (settings'te kilit). Deneme modunda veritabanına hiçbir şey yazılmaz.

import type { DB } from "../db.ts";
import { GoogleApiError } from "../google/api.ts";
import type { Google } from "./google.ts";
import { markEntityError, PermanentError, RetryLaterError, runHandler, type Job, type Outcome } from "./handlers.ts";

export const MAX_ATTEMPTS = 5;
const LOCK_KEY = "sync.lock";
const LOCK_TTL_MIN = 15;
const STALE_RUNNING_MIN = 15;

export interface RunOptions {
  google: Google;
  limit?: number;
  actions?: string[];
  batchId?: number;
  /** İşler seçildikten sonra, toplam sayıyla bir kez çağrılır */
  onStart?: (total: number) => void;
  /** true dönerse sıradaki işe geçilmez (çalışan iş yarıda kesilmez) */
  shouldStop?: () => boolean;
  onJob?:(job: Job, result: { outcome?: Outcome; error?: string; state: JobState }) => void;
}

export type JobState = "done" | "failed" | "retry" | "deferred";

export interface RunReport {
  dryRun: boolean;
  total: number;
  states: Record<JobState, number>;
  outcomes: Record<string, number>; // "CREATE_USER:created" → 12
  failures: { id: number; action: string; entity: string; error: string }[];
}

export class LockedError extends Error {}

function acquireLock(db: DB) {
  db.transaction(() => {
    const held = db.prepare("SELECT value FROM settings WHERE key = ?").pluck().get(LOCK_KEY) as string | undefined;
    if (held) {
      const { at, pid } = JSON.parse(held) as { at: number; pid: number };
      if (Date.now() - at < LOCK_TTL_MIN * 60_000) {
        throw new LockedError(`Başka bir senkronizasyon çalışıyor (pid ${pid}). Bitmesini bekleyin.`);
      }
    }
    refreshLock(db);
  })();
}

function refreshLock(db: DB) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(LOCK_KEY, JSON.stringify({ pid: process.pid, at: Date.now() }));
}

function releaseLock(db: DB) {
  db.prepare("DELETE FROM settings WHERE key = ? AND json_extract(value, '$.pid') = ?").run(LOCK_KEY, process.pid);
}

/** Bu işten önce bitmesi gereken, henüz bitmemiş en eski iş */
function blocker(db: DB, job: Job): { id: number; status: string } | undefined {
  // Boş OU silme en sona kalır: önündeki herhangi bir iş (hesap taşıma olabilir) bitmeden çalışmaz.
  // Başarısız işler beklenmez; işleyici zaten OU'nun Google'da boş olduğunu kontrol eder.
  if (job.action === "DELETE_ORG_UNIT") {
    return db
      .prepare("SELECT id, status FROM sync_jobs WHERE status IN ('QUEUED', 'RUNNING') AND id < ? ORDER BY id LIMIT 1")
      .get(job.id) as { id: number; status: string } | undefined;
  }
  const p = JSON.parse(job.payload) as Record<string, string>;
  const emails = [p.memberEmail, job.action === "UPDATE_USER" || job.action === "ADD_ALIAS" || job.action === "SUSPEND_USER" ? p.email : undefined]
    .filter(Boolean) as string[];
  // Grup işleri (ad değiştirme, silme) grubun oluşturulmasını bekler
  const groupEmail = p.groupEmail ?? (job.action === "UPDATE_GROUP" || job.action === "DELETE_GROUP" ? p.email : undefined);
  const ou = p.orgUnitPath ?? (job.action === "CREATE_ORG_UNIT" ? p.parentOrgUnitPath : undefined);

  const pending = "status IN ('QUEUED', 'RUNNING', 'FAILED') AND id < @id";
  const q = (sql: string, params: object) =>
    db.prepare(`SELECT id, status FROM sync_jobs WHERE ${pending} AND ${sql} ORDER BY id LIMIT 1`).get({ id: job.id, ...params }) as
      | { id: number; status: string }
      | undefined;

  for (const email of emails) {
    const b = q("action = 'CREATE_USER' AND json_extract(payload, '$.email') = @email", { email });
    if (b) return b;
  }
  if (groupEmail) {
    const b = q("action = 'CREATE_GROUP' AND json_extract(payload, '$.email') = @email", { email: groupEmail });
    if (b) return b;
  }
  if (ou) {
    const b = q("action = 'CREATE_ORG_UNIT' AND entity_id = @ou", { ou });
    if (b) return b;
  }
  return undefined;
}

function isTransient(e: unknown) {
  if (e instanceof RetryLaterError) return true;
  if (e instanceof GoogleApiError) return e.transient;
  return e instanceof TypeError; // fetch ağ hatası
}

export async function runQueue(db: DB, opts: RunOptions): Promise<RunReport> {
  const { google } = opts;
  const dryRun = google.dryRun;
  const report: RunReport = {
    dryRun,
    total: 0,
    states: { done: 0, failed: 0, retry: 0, deferred: 0 },
    outcomes: {},
    failures: [],
  };

  if (!dryRun) {
    acquireLock(db);
    // Çökmüş bir çalıştırmadan RUNNING'de kalan işler
    db.prepare(
      `UPDATE sync_jobs SET status = 'QUEUED'
       WHERE status = 'RUNNING' AND updated_at < datetime('now', '-${STALE_RUNNING_MIN} minutes')`,
    ).run();
  }

  try {
    const where = ["status = 'QUEUED'"];
    const params: Record<string, unknown> = {};
    if (!dryRun) where.push("run_after <= datetime('now')");
    if (opts.batchId) {
      where.push("import_batch_id = @batchId");
      params.batchId = opts.batchId;
    }
    if (opts.actions?.length) {
      where.push(`action IN (${opts.actions.map((_, i) => `@a${i}`).join(", ")})`);
      opts.actions.forEach((a, i) => (params[`a${i}`] = a));
    }
    const jobs = db
      .prepare(
        `SELECT id, action, entity_type, entity_id, payload, attempts, import_batch_id FROM sync_jobs
         WHERE ${where.join(" AND ")} ORDER BY id ${opts.limit ? "LIMIT @limit" : ""}`,
      )
      .all(opts.limit ? { ...params, limit: opts.limit } : params) as Job[];

    const setStatus = db.prepare(
      `UPDATE sync_jobs SET status = @status, attempts = @attempts, last_error = @error,
         run_after = COALESCE(@runAfter, run_after) WHERE id = @id`,
    );
    const touchedBatches = new Set<number>();
    opts.onStart?.(jobs.length);

    for (const job of jobs) {
      if (opts.shouldStop?.()) break;
      report.total++;
      if (job.import_batch_id) touchedBatches.add(job.import_batch_id);
      const finish = (state: JobState, extra: { outcome?: Outcome; error?: string } = {}) => {
        report.states[state]++;
        if (extra.outcome) report.outcomes[`${job.action}:${extra.outcome}`] = (report.outcomes[`${job.action}:${extra.outcome}`] ?? 0) + 1;
        if (state === "failed") report.failures.push({ id: job.id, action: job.action, entity: job.entity_id, error: extra.error ?? "" });
        opts.onJob?.(job, { ...extra, state });
      };

      // Deneme modunda işler sırayla taklit edildiği için bağımlılık kontrolüne gerek yok
      if (!dryRun) {
        const b = blocker(db, job);
        if (b?.status === "FAILED") {
          const error = `Önce yapılması gereken iş #${b.id} başarısız oldu.`;
          setStatus.run({ id: job.id, status: "FAILED", attempts: job.attempts, error, runAfter: null });
          markEntityError(db, job);
          finish("failed", { error });
          continue;
        }
        if (b) {
          finish("deferred");
          continue;
        }
        refreshLock(db);
        setStatus.run({ id: job.id, status: "RUNNING", attempts: job.attempts + 1, error: null, runAfter: null });
      }

      try {
        const outcome = await runHandler(job, { db, google, apply: (fn) => (dryRun ? undefined : fn()) });
        if (!dryRun) setStatus.run({ id: job.id, status: "DONE", attempts: job.attempts + 1, error: null, runAfter: null });
        finish("done", { outcome });
      } catch (e) {
        const error = (e as Error).message;
        const attempts = job.attempts + 1;
        const retry = !(e instanceof PermanentError) && isTransient(e) && attempts < MAX_ATTEMPTS;
        if (dryRun) {
          finish(retry ? "retry" : "failed", { error });
        } else if (retry) {
          const delayMin = 2 ** attempts; // 2, 4, 8, 16 dakika
          setStatus.run({
            id: job.id,
            status: "QUEUED",
            attempts,
            error,
            runAfter: new Date(Date.now() + delayMin * 60_000).toISOString().replace("T", " ").slice(0, 19),
          });
          finish("retry", { error });
          // Kota aşımında biraz yavaşla
          if (e instanceof GoogleApiError && e.status === 429) await new Promise((r) => setTimeout(r, 5000));
        } else {
          setStatus.run({ id: job.id, status: "FAILED", attempts, error, runAfter: null });
          markEntityError(db, job);
          finish("failed", { error });
        }
      }
    }

    if (!dryRun) {
      // Liste işleri bitince içe aktarma tamamlanmış sayılır (hatalı işler kuyruk ekranında görünür)
      const update = db.prepare(
        `UPDATE import_batches SET status = CASE
           WHEN EXISTS (SELECT 1 FROM sync_jobs WHERE import_batch_id = @id AND status IN ('QUEUED', 'RUNNING')) THEN 'PROCESSING'
           ELSE 'COMPLETED' END
         WHERE id = @id AND status IN ('CONFIRMED', 'PROCESSING')`,
      );
      for (const id of touchedBatches) update.run({ id });
    }
  } finally {
    if (!dryRun) releaseLock(db);
  }
  return report;
}

/** Başarısız işleri yeniden kuyruğa alır */
export function retryFailed(db: DB, ids?: number[]): number {
  const sql = `UPDATE sync_jobs SET status = 'QUEUED', attempts = 0, last_error = NULL, run_after = datetime('now')
               WHERE status = 'FAILED'`;
  if (!ids?.length) return db.prepare(sql).run().changes;
  return db.prepare(`${sql} AND id IN (${ids.map(() => "?").join(", ")})`).run(...ids).changes;
}

export function queueCounts(db: DB) {
  return db
    .prepare("SELECT action, status, count(*) AS n FROM sync_jobs GROUP BY action, status ORDER BY action, status")
    .all() as { action: string; status: string; n: number }[];
}
