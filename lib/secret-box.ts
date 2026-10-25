// Veritabanında geri okunması gereken sırlar (öğrencilerin ilk şifresi) için AES-256-GCM.
// Anahtar .env'deki PASSWORD_ENC_KEY: 32 baytın base64 hali (openssl rand -base64 32).
// Biçim: v1:<iv>:<tag>:<şifreli metin>, hepsi base64.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.PASSWORD_ENC_KEY;
  const k = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new Error("PASSWORD_ENC_KEY 32 baytlık base64 bir anahtar olmalı.");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(box: string): string {
  const [v, iv, tag, ct] = box.split(":");
  if (v !== "v1" || !ct) throw new Error("Tanınmayan şifreli veri biçimi.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
