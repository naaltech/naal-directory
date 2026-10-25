// Panel işlemlerinin Google işlerini kuyruğa eklemesi. İşçi (worker.ts) id sırasıyla işler,
// bu yüzden bağımlı işler (önce hesap, sonra takma ad) aynı sırayla eklenmeli.

import type { DB } from "../db.ts";

export type SyncAction =
  | "CREATE_USER" | "UPDATE_USER" | "SUSPEND_USER" | "DELETE_USER"
  | "CREATE_GROUP" | "UPDATE_GROUP" | "DELETE_GROUP"
  | "ADD_MEMBER" | "REMOVE_MEMBER" | "ADD_ALIAS" | "REMOVE_ALIAS" | "CREATE_ORG_UNIT" | "DELETE_ORG_UNIT";

export function enqueue(
  db: DB,
  action: SyncAction,
  entityType: string,
  entityId: string | number,
  payload: object,
  importBatchId: number | null = null,
): number {
  return Number(
    db
      .prepare("INSERT INTO sync_jobs (action, entity_type, entity_id, payload, import_batch_id) VALUES (?, ?, ?, ?, ?)")
      .run(action, entityType, String(entityId), JSON.stringify(payload), importBatchId).lastInsertRowid,
  );
}

/** Bir kayıt için henüz yapılmamış işler (kuyruğu gösterirken ve tekrarı önlerken) */
export function pendingJobs(db: DB, entityType: string, entityId: string | number) {
  return db
    .prepare(
      `SELECT id, action, status, attempts, last_error, created_at FROM sync_jobs
       WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 20`,
    )
    .all(entityType, String(entityId)) as {
    id: number;
    action: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: string;
  }[];
}
