// Ayrılan hesapların (mezun ve nakil öğrenci, ayrılan öğretmen) askıya alınması ve silinmesi.
// Tarihler ayrılışta yazılır (leavers.ts, teachers.ts); bu modül vadesi gelenleri kuyruğa alır.
// Günde bir kez çalıştırılması yeterli: npm run retention -- --yes && npm run sync -- --yes

import type { DB } from "./db.ts";
import { enqueue } from "./sync/queue.ts";

type Kind = "student" | "teacher";

export interface RetentionItem {
  id: number;
  type: Kind;
  email: string;
  reason: string; // GRADUATED, TRANSFERRED, TEACHER_LEFT
  due: string;
}

export interface RetentionPlan {
  suspend: RetentionItem[];
  remove: RetentionItem[];
}

const SOURCES: { type: Kind; table: string; exited: string; reason: string }[] = [
  { type: "student", table: "students", exited: "x.exit_reason IS NOT NULL", reason: "x.exit_reason" },
  { type: "teacher", table: "teachers", exited: "x.left_at IS NOT NULL", reason: "'TEACHER_LEFT'" },
];

/** Vadesi gelmiş ve kuyrukta bekleyen işi olmayan hesaplar */
export function dueRetention(db: DB): RetentionPlan {
  const plan: RetentionPlan = { suspend: [], remove: [] };
  for (const src of SOURCES) {
    const noPending = (action: string) =>
      `NOT EXISTS (SELECT 1 FROM sync_jobs j WHERE j.entity_type = '${src.type}' AND j.entity_id = CAST(x.id AS TEXT)
         AND j.action = '${action}' AND j.status IN ('QUEUED', 'RUNNING'))`;
    plan.suspend.push(
      ...(db
        .prepare(
          `SELECT x.id, '${src.type}' AS type, x.email, ${src.reason} AS reason, x.suspend_at AS due FROM ${src.table} x
           WHERE ${src.exited} AND x.suspended_at IS NULL AND x.status NOT IN ('DELETED', 'SUSPENDED')
             AND x.google_user_id IS NOT NULL AND x.suspend_at <= datetime('now') AND ${noPending("SUSPEND_USER")}
           ORDER BY x.suspend_at`,
        )
        .all() as RetentionItem[]),
    );
    plan.remove.push(
      ...(db
        .prepare(
          `SELECT x.id, '${src.type}' AS type, x.email, ${src.reason} AS reason, x.delete_at AS due FROM ${src.table} x
           WHERE ${src.exited} AND x.deleted_at IS NULL AND x.status <> 'DELETED'
             AND x.google_user_id IS NOT NULL AND x.delete_at <= datetime('now') AND ${noPending("DELETE_USER")}
           ORDER BY x.delete_at`,
        )
        .all() as RetentionItem[]),
    );
  }
  return plan;
}

export function enqueueRetention(db: DB, plan: RetentionPlan): number {
  return db.transaction(() => {
    for (const s of plan.suspend) enqueue(db, "SUSPEND_USER", s.type, s.id, { email: s.email });
    // Silmeden önce askı: askısı kuyruktaysa silme ondan sonra gelir (id sırası)
    for (const s of plan.remove) enqueue(db, "DELETE_USER", s.type, s.id, { email: s.email });
    return plan.suspend.length + plan.remove.length;
  })();
}

/** Önümüzdeki günlerde askıya alınacak / silinecek hesaplar (genel bakışta uyarı) */
export function upcomingRetention(db: DB) {
  const days = db.prepare("SELECT value FROM settings WHERE key = 'retention.notifyDaysBefore'").pluck().get() as string | undefined;
  const windowDays = Number(days ? JSON.parse(days) : 14) || 14;
  const window = `+${windowDays} days`;
  let suspend = 0;
  let remove = 0;
  for (const src of SOURCES) {
    suspend += db
      .prepare(
        `SELECT count(*) FROM ${src.table} x WHERE ${src.exited} AND x.suspended_at IS NULL AND x.status <> 'DELETED'
         AND x.suspend_at <= datetime('now', ?)`,
      )
      .pluck()
      .get(window) as number;
    remove += db
      .prepare(
        `SELECT count(*) FROM ${src.table} x WHERE ${src.exited} AND x.deleted_at IS NULL AND x.status <> 'DELETED'
         AND x.delete_at <= datetime('now', ?)`,
      )
      .pluck()
      .get(window) as number;
  }
  return { windowDays, suspend, remove };
}
