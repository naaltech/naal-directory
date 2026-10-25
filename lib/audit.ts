import type { DB } from "./db.ts";

/** Panelde yapılan her değişiklik ve kişisel veri görüntüleme (ilk şifre) buraya yazılır */
export function logAction(
  db: DB,
  userId: number | null,
  action: string,
  entityType: string,
  entityId?: string | number | null,
  details?: unknown,
) {
  db.prepare("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)").run(
    userId,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    details === undefined ? null : JSON.stringify(details),
  );
}
