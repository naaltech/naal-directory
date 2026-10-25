// Öğrenci ve öğretmenin e-posta adresini değiştirme (alan adı aynı kalır, sadece @ öncesi değişir).
//
// - Hesap Google'da henüz açılmadıysa: bekleyen işlerdeki adres yenisiyle değiştirilir, hesap yeni adresle açılır.
// - Hesap açıksa: Google'da yeniden adlandırma işi kuyruğa girer. Google eski adresi takma ad olarak tutar; eski
//   adrese gelen e-postalar ulaşmaya devam eder, eski adresle giriş de çalışır. Grup üyelikleri hesaba bağlı
//   olduğu için kendiliğinden yeni adrese geçer.
// - Bekleyen ya da başarısız işi olan açık hesabın adresi değiştirilmez (yarım kalmış bir işin eski adresle
//   gitmesini önlemek için): önce senkronizasyon çalıştırılır.

import { logAction } from "./audit.ts";
import type { DB } from "./db.ts";
import { RESERVED_LOCAL_PARTS } from "./email.ts";
import { dbEmailTaken } from "./import/students.ts";
import { enqueue } from "./sync/queue.ts";

const LOCAL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class EmailChangeError extends Error {}

export type PersonType = "student" | "teacher";
const TABLE: Record<PersonType, "students" | "teachers"> = { student: "students", teacher: "teachers" };

/** Bu adresi içeren, henüz bitmemiş işler (adres işin hangi alanında olursa olsun) */
const PENDING_SQL = `
  FROM sync_jobs WHERE status IN ('QUEUED', 'RUNNING', 'FAILED')
    AND ((entity_type = @type AND entity_id = @id)
      OR json_extract(payload, '$.email') = @email COLLATE NOCASE
      OR json_extract(payload, '$.memberEmail') = @email COLLATE NOCASE)`;

export function changeEmail(
  db: DB,
  input: { type: PersonType; id: number; local: string },
  userId: number,
  googleTaken: Set<string> | null,
): string {
  const local = input.local.trim().toLowerCase().split("@")[0];
  if (!LOCAL_RE.test(local) || local.length > 64) {
    throw new EmailChangeError("Sadece a-z, 0-9 ve arada nokta, tire, alt çizgi kullanılabilir.");
  }
  if (RESERVED_LOCAL_PARTS.has(local)) throw new EmailChangeError(`"${local}" ayrılmış bir adres.`);
  const table = TABLE[input.type];

  return db.transaction(() => {
    const p = db.prepare(`SELECT id, email, status, google_user_id FROM ${table} WHERE id = ?`).get(input.id) as
      | { id: number; email: string; status: string; google_user_id: string | null }
      | undefined;
    if (!p) throw new EmailChangeError("Kayıt bulunamadı.");
    if (p.status === "DELETED" || p.status === "ARCHIVED") throw new EmailChangeError("Hesap silinmiş ya da arşivde.");
    const oldEmail = p.email.toLowerCase();
    const domain = oldEmail.split("@")[1];
    const newEmail = `${local}@${domain}`;
    if (newEmail === oldEmail) throw new EmailChangeError("Yeni adres eskisiyle aynı.");
    if (dbEmailTaken(db)(newEmail)) throw new EmailChangeError(`${newEmail} başka bir kayıtta kullanılıyor.`);
    if (googleTaken?.has(newEmail)) throw new EmailChangeError(`${newEmail} Google'da kullanılıyor (başka bir hesap ya da takma ad).`);

    const params = { type: input.type, id: String(p.id), email: oldEmail };
    if (db.prepare(`SELECT 1 ${PENDING_SQL} AND status = 'RUNNING'`).get(params)) {
      throw new EmailChangeError("Bu hesabın bir işi şu an Google'a gönderiliyor; bitince tekrar deneyin.");
    }

    if (p.google_user_id) {
      if (db.prepare(`SELECT 1 ${PENDING_SQL}`).get(params)) {
        throw new EmailChangeError(
          "Bu hesabın Google'a gönderilmemiş ya da başarısız işleri var. Önce senkronizasyonu çalıştırın veya başarısız işleri düzeltin.",
        );
      }
      enqueue(db, "UPDATE_USER", input.type, p.id, { email: oldEmail, newEmail });
    } else {
      // Hesap henüz yok: bekleyen işlerde eski adres yenisiyle değişir
      for (const key of ["email", "memberEmail"]) {
        db.prepare(
          `UPDATE sync_jobs SET payload = json_set(payload, '$.${key}', @newEmail)
           WHERE status IN ('QUEUED', 'FAILED') AND json_extract(payload, '$.${key}') = @email COLLATE NOCASE`,
        ).run({ email: oldEmail, newEmail });
      }
    }

    db.prepare(`UPDATE ${table} SET email = ?, updated_at = datetime('now') WHERE id = ?`).run(newEmail, p.id);
    db.prepare(`UPDATE group_members SET member_email = ? WHERE ${input.type}_id = ?`).run(newEmail, p.id);
    logAction(db, userId, `${input.type}.email_change`, input.type, p.id, { from: oldEmail, to: newEmail });
    return newEmail;
  })();
}
