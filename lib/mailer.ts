// E-postalar (SMTP). Yöneticiye giden sistem e-postaları ayar yoksa sürecin günlüğüne yazılır; kişiye giden
// e-postalar için ayar yoksa gönderici oluşturulmaz.

import nodemailer, { type Transporter } from "nodemailer";

export interface Mail {
  subject: string;
  text: string;
}

export interface PersonalMail extends Mail {
  to: string;
  senderName: string;
  replyTo: string;
  /** Aynı iş yeniden gönderilirse aynı kimlikle gider; Gmail aynı kimlikli iletiyi ikinci kez göstermez */
  messageId: string;
}

/** Günlük ya da saniyelik gönderim sınırı: e-postanın kendisinde sorun yoktur, sonra tekrar denenir. */
export class MailLimitError extends Error {}

/** Google'ın sınır yanıtları: 421/454 4.7.0 "sonra deneyin", 550 5.4.5 günlük kota. */
const LIMIT_RESPONSE = /\b(4\.7\.0|5\.4\.5)\b/;

function smtpFromEnv() {
  const { SMTP_HOST: host, SMTP_PORT: port = "465", SMTP_USER: user, SMTP_PASSWORD: pass } = process.env;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: port === "465",
    // Google EHLO'da alan adı ister.
    name: "naal.org.tr",
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
  });
}

export async function sendMail(mail: Mail): Promise<void> {
  const { ALERT_EMAIL_TO: to, ALERT_EMAIL_FROM: from } = process.env;
  const smtp = smtpFromEnv();
  if (!smtp || !to || !from) {
    console.warn(`E-posta ayarlı değil. ${mail.subject}\n${mail.text}`);
    return;
  }
  try {
    await smtp.sendMail({ from, to, subject: mail.subject, text: mail.text });
  } finally {
    smtp.close();
  }
}

/** Yöneticinin kendi hesabıyla ilgili e-postalar. Geliştirmede ayar yoksa içerik günlüğe yazılır. */
export async function sendAccountMail(to: string, mail: Mail): Promise<void> {
  const from = process.env.ALERT_EMAIL_FROM;
  const smtp = smtpFromEnv();
  if (!smtp || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("E-posta gönderimi ayarlı değil");
    console.warn(`E-posta ayarlı değil. ${to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  try {
    await smtp.sendMail({ from, to, subject: mail.subject, text: mail.text });
  } finally {
    smtp.close();
  }
}

/** Sertifika e-postalarının göndericisi; adres tanımlı değilse null döner ve sertifikalar bekler. */
export function personalMailerFromEnv() {
  const from = process.env.CERT_EMAIL_FROM;
  const smtp = from ? smtpFromEnv() : null;
  if (!from || !smtp) return null;
  return async (mail: PersonalMail, transport: Pick<Transporter, "sendMail"> = smtp) => {
    try {
      await transport.sendMail({
        from: { name: mail.senderName.replace(/[<>"\r\n]/g, ""), address: from },
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
      });
    } catch (e) {
      const { response } = e as { response?: string };
      if (response && LIMIT_RESPONSE.test(response)) throw new MailLimitError("SMTP gönderim sınırı");
      throw e;
    }
  };
}
