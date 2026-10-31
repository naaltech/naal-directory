// Toplu sertifika: kulüp panelden etkinlik başlığını ve katılımcı adreslerini bırakır, gerisi burada olur.
//
// Ad panelden gelmez: kişi dizinde okulda kayıtlıysa sertifikaya resmi adı yazılır, değilse satır reddedilir.
// Sertifika numarası (file_id) satırla birlikte panelde üretilir; bu yüzden yarıda kesilen iş sertifikayı ikinci
// kez açmaz, e-posta da aynı ileti kimliğiyle gönderildiği için Gmail tekrarını göstermez.
//
// Gönderilen satırın e-postası Supabase'den silinir: öğrenci adresleri orada kalıcı tutulmaz.

import type { DB } from "../db.ts";
import { MailLimitError, type PersonalMail } from "../mailer.ts";
import type { PanelApi, PanelRecipient } from "./api.ts";
import { canManage, findSchoolPerson, type PanelRole } from "./roles.ts";

export type CertificateMailer = (mail: PersonalMail) => Promise<void>;

const CERTIFICATE_URL = "https://naal.org.tr/certificates/";
const CLUB_DOMAIN = "naal.org.tr";
const MAX_ATTEMPTS = 5;
/** Google art arda gönderimi kısıtlar. */
const SEND_GAP_MS = 600;

export function certificateMail(r: PanelRecipient, person: { email: string; name: string }): PersonalMail {
  const url = `${CERTIFICATE_URL}${encodeURIComponent(r.file_id)}`;
  return {
    to: person.email,
    senderName: r.issuer,
    replyTo: `${r.club_code}@${CLUB_DOMAIN}`,
    subject: `${r.title} sertifikanız`,
    text: [
      `Merhaba ${person.name},`,
      "",
      `${r.issuer} tarafından verilen "${r.title}" sertifikanız hazır.`,
      "",
      "Sertifikanızı görüntülemek ve doğrulamak için:",
      url,
      "",
      `Sertifika numarası: ${r.file_id}`,
    ].join("\n"),
    messageId: `certificate-${r.file_id}@${CLUB_DOMAIN}`,
  };
}

async function issue(db: DB, api: PanelApi, mail: CertificateMailer, r: PanelRecipient, roles: PanelRole[]) {
  const fail = (error: string) => api.finishRecipient(r.id, { status: "failed", error });

  if (!canManage(roles, r.requested_by.toLowerCase(), r.club_code)) return fail("İsteği yapan kişinin bu kulüpte yetkisi kalmamış.");
  if (!db.prepare("SELECT 1 FROM clubs WHERE code = ? AND is_active = 1").get(r.club_code)) return fail("Kulüp dizinde açık değil.");
  const person = r.email ? findSchoolPerson(db, r.email) : null;
  if (!person) return fail("Bu adres okulda kayıtlı bir hesap değil.");

  if (!(await api.certificateExists(r.file_id))) {
    await api.addCertificate({
      creator: r.issuer,
      head: r.title,
      given: person.name,
      date: r.event_date,
      file_id: r.file_id,
      uploader_mail: `${r.club_code}@${CLUB_DOMAIN}`,
    });
  }

  try {
    await mail(certificateMail(r, person));
  } catch (e) {
    if (e instanceof MailLimitError) throw e;
    const attempts = r.attempts + 1;
    console.error(`Sertifika e-postası ${r.id}: ${(e as Error).message}`);
    if (attempts < MAX_ATTEMPTS) return api.finishRecipient(r.id, { attempts });
    return api.finishRecipient(r.id, { status: "failed", attempts, name: person.name, error: "Sertifika oluştu, e-posta gönderilemedi." });
  }
  await api.finishRecipient(r.id, { status: "sent", name: person.name, email: null, error: null, sent_at: new Date().toISOString() });
}

/** Bekleyen satırları işler. Gönderim sınırına takılırsa kalanlar bir sonraki çalıştırmaya kalır. */
export async function issueCertificates(db: DB, api: PanelApi, mail: CertificateMailer, roles: PanelRole[], gapMs = SEND_GAP_MS) {
  const recipients = await api.pendingRecipients();
  let done = 0;
  for (const [index, r] of recipients.entries()) {
    if (index > 0 && gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
    try {
      await issue(db, api, mail, r, roles);
    } catch (e) {
      if (e instanceof MailLimitError) break;
      throw e;
    }
    done++;
  }
  return done;
}
