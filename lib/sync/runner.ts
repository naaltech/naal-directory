// Kuyruğu panelden çalıştırma. İşçi (runQueue) panel sürecinde arka planda çalışır; ilerleme ve sonuç
// sync_runs tablosuna yazılır, sayfa bunu okuyarak takip eder. Komut satırıyla aynı kilit ve kontroller geçerlidir.
//
// Aynı anda tek çalıştırma olur. Sunucu çalıştırma sırasında yeniden başlarsa yarım kalan kayıt "kesildi" olarak
// kapatılır; RUNNING'de kalan işleri işçi bir sonraki çalıştırmada (15 dk sonra) kuyruğa geri alır.

import { logAction } from "../audit.ts";
import type { DB } from "../db.ts";
import { isGoogleConfigured } from "../google/api.ts";
import { DryRunGoogle, liveGoogle } from "./google.ts";
import { activeLock, runQueue, type RunReport } from "./worker.ts";

export type RunMode = "DRY" | "LIVE";

export interface SyncRun {
  id: number;
  mode: RunMode;
  job_limit: number | null;
  status: "RUNNING" | "DONE" | "FAILED" | "STOPPED";
  total: number | null;
  processed: number;
  stop_requested: 0 | 1;
  report: RunReport | null;
  error: string | null;
  started_by_name: string | null;
  started_at: string;
  finished_at: string | null;
}

export class RunError extends Error {}

// Bu süreçte çalışan çalıştırma (geliştirmede yeniden yüklemelerde kaybolmasın diye global)
const g = globalThis as unknown as { __syncRunId?: number | null };

function read(db: DB, where: string, ...params: unknown[]): SyncRun | undefined {
  const row = db
    .prepare(
      `SELECT r.id, r.mode, r.job_limit, r.status, r.total, r.processed, r.stop_requested, r.report, r.error,
              r.started_at, r.finished_at, a.name AS started_by_name
       FROM sync_runs r LEFT JOIN admin_users a ON a.id = r.started_by ${where}`,
    )
    .get(...params) as (Omit<SyncRun, "report"> & { report: string | null }) | undefined;
  return row && { ...row, report: row.report ? (JSON.parse(row.report) as RunReport) : null };
}

/** Bu süreçte çalışmayan ama RUNNING görünen kayıtları kapatır (sunucu yeniden başlamış) */
function closeOrphans(db: DB) {
  db.prepare(
    `UPDATE sync_runs SET status = 'FAILED', error = 'Sunucu çalıştırma sırasında yeniden başladı; çalıştırma yarıda kesildi.',
       finished_at = datetime('now'), updated_at = datetime('now')
     WHERE status = 'RUNNING' AND id IS NOT @active`,
  ).run({ active: g.__syncRunId ?? null });
}

export function latestRun(db: DB): SyncRun | undefined {
  closeOrphans(db);
  return read(db, "ORDER BY r.id DESC LIMIT 1");
}

export function getRun(db: DB, id: number): SyncRun | undefined {
  closeOrphans(db);
  return read(db, "WHERE r.id = ?", id);
}

/** Komut satırından çalışan bir senkronizasyon var mı (işçinin kilidi) */
export function cliLockHeld(db: DB): boolean {
  return activeLock(db) !== null;
}

export function startRun(db: DB, input: { mode: RunMode; limit?: number; userId: number }): number {
  if (!isGoogleConfigured()) throw new RunError("Google ayarları eksik (.env); kuyruk çalıştırılamaz.");
  const limit = input.limit === undefined ? undefined : Math.floor(input.limit);
  if (limit !== undefined && !(limit >= 1 && limit <= 100_000)) throw new RunError("İş sayısı geçersiz.");

  const id = db.transaction(() => {
    closeOrphans(db);
    if (db.prepare("SELECT 1 FROM sync_runs WHERE status = 'RUNNING'").get()) {
      throw new RunError("Zaten bir çalıştırma devam ediyor.");
    }
    if (input.mode === "LIVE" && cliLockHeld(db)) {
      throw new RunError("Komut satırından bir senkronizasyon çalışıyor. Bitmesini bekleyin.");
    }
    const { lastInsertRowid } = db
      .prepare("INSERT INTO sync_runs (mode, job_limit, started_by) VALUES (?, ?, ?)")
      .run(input.mode, limit ?? null, input.userId);
    return Number(lastInsertRowid);
  })();
  g.__syncRunId = id;
  logAction(db, input.userId, input.mode === "LIVE" ? "sync.run" : "sync.dry_run", "sync_run", id, { limit: limit ?? null });

  void execute(db, id, input.mode, limit);
  return id;
}

export function requestStop(db: DB, id: number): boolean {
  return db.prepare("UPDATE sync_runs SET stop_requested = 1 WHERE id = ? AND status = 'RUNNING'").run(id).changes > 0;
}

async function execute(db: DB, id: number, mode: RunMode, limit: number | undefined) {
  const progress = db.prepare("UPDATE sync_runs SET processed = ?, updated_at = datetime('now') WHERE id = ?");
  const stopRequested = db.prepare("SELECT stop_requested FROM sync_runs WHERE id = ?").pluck();
  let processed = 0;
  let stopped = false;
  try {
    // Deneme: Google'ın şu anki hali okunur, yazmalar bu kopya üzerinde taklit edilir
    const google = mode === "LIVE" ? liveGoogle : await DryRunGoogle.snapshot();
    const report = await runQueue(db, {
      google,
      limit,
      onStart: (total) => db.prepare("UPDATE sync_runs SET total = ? WHERE id = ?").run(total, id),
      shouldStop: () => (stopped = stopRequested.get(id) === 1),
      onJob: () => {
        processed++;
        // Deneme çok hızlı ilerler; her işte yazmak yerine arada bir
        if (mode === "LIVE" || processed % 25 === 0) progress.run(processed, id);
      },
    });
    db.prepare(
      `UPDATE sync_runs SET status = @status, processed = @processed, report = @report,
         finished_at = datetime('now'), updated_at = datetime('now') WHERE id = @id`,
    ).run({ id, status: stopped ? "STOPPED" : "DONE", processed, report: JSON.stringify(report) });
  } catch (e) {
    db.prepare(
      `UPDATE sync_runs SET status = 'FAILED', processed = ?, error = ?, finished_at = datetime('now'),
         updated_at = datetime('now') WHERE id = ?`,
    ).run(processed, (e as Error).message, id);
  } finally {
    if (g.__syncRunId === id) g.__syncRunId = null;
  }
}
