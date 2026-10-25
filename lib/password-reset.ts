// Öğrenci ve öğretmen şifresini sıfırlama. Yeni şifre ilk şifrenin yerine şifreli saklanır (kuyruğa yazılmaz);
// işçi Google'a gönderirken oradan okur. Kişi ilk girişte şifresini yeniden değiştirir.
//
// - Hesap Google'da henüz açılmadıysa: hesap yeni şifreyle açılır, ayrı iş gerekmez.
// - Hesap açıksa: Google'da şifreyi değiştiren iş kuyruğa girer (bekleyen bir sıfırlama varsa yenisi eklenmez,
//   o iş en son şifreyi gönderir).

import { logAction } from "./audit.ts";
import { generatePassword } from "./auth/password.ts";
import type { DB } from "./db.ts";
import type { PersonType } from "./email-change.ts";
import { encryptSecret } from "./secret-box.ts";
import { enqueue } from "./sync/queue.ts";

export class PasswordResetError extends Error {}

const TABLE: Record<PersonType, "students" | "teachers"> = { student: "students", teacher: "teachers" };
const LENGTH: Record<PersonType, number> = { student: 10, teacher: 12 };

export function resetPassword(db: DB, input: { type: PersonType; id: number }, userId: number): string {
  const table = TABLE[input.type];
  return db.transaction(() => {
    const p = db.prepare(`SELECT id, email, status, google_user_id FROM ${table} WHERE id = ?`).get(input.id) as
      | { id: number; email: string; status: string; google_user_id: string | null }
      | undefined;
    if (!p) throw new PasswordResetError("Kayıt bulunamadı.");
    if (p.status === "DELETED" || p.status === "ARCHIVED") throw new PasswordResetError("Hesap silinmiş ya da arşivde.");
    if (p.status === "SUSPENDED") throw new PasswordResetError("Hesap askıya alınmış; şifre sıfırlanamaz.");

    const password = generatePassword(LENGTH[input.type]);
    db.prepare(`UPDATE ${table} SET initial_password_enc = ?, updated_at = datetime('now') WHERE id = ?`).run(
      encryptSecret(password),
      p.id,
    );
    if (p.google_user_id) {
      const queued = db
        .prepare(
          `SELECT 1 FROM sync_jobs WHERE action = 'UPDATE_USER' AND status IN ('QUEUED', 'FAILED')
             AND entity_type = ? AND entity_id = ? AND json_extract(payload, '$.resetPassword') = 1`,
        )
        .get(input.type, String(p.id));
      if (queued) {
        db.prepare(
          `UPDATE sync_jobs SET status = 'QUEUED', attempts = 0, last_error = NULL, run_after = datetime('now')
           WHERE action = 'UPDATE_USER' AND status = 'FAILED' AND entity_type = ? AND entity_id = ?
             AND json_extract(payload, '$.resetPassword') = 1`,
        ).run(input.type, String(p.id));
      } else {
        enqueue(db, "UPDATE_USER", input.type, p.id, { email: p.email, resetPassword: true });
      }
    }
    logAction(db, userId, `${input.type}.password_reset`, input.type, p.id);
    return password;
  })();
}
