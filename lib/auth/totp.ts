// Doğrulama uygulaması kodları (RFC 6238): 30 saniyelik, 6 haneli, HMAC-SHA1. Bağımlılık yok.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD = 30;
/** Telefon saati kayık olabilir: bir önceki ve bir sonraki kod da kabul edilir */
const DRIFT = 1;

export function base32Encode(data: Buffer): string {
  let bits = "";
  for (const byte of data) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const ch of text) bits += BASE32.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  return String(mac.readUInt32BE(offset) & 0x7fffffff).slice(-6).padStart(6, "0");
}

/** Kod geçerliyse zaman adımını döner; lastStep ve öncesi reddedilir, böylece aynı kod iki kez kullanılamaz. */
export function matchTotpStep(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const current = Math.floor(now / 1000 / PERIOD);
  const given = Buffer.from(code);
  for (let step = current - DRIFT; step <= current + DRIFT; step++) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (given.length === expected.length && timingSafeEqual(given, expected)) return step;
  }
  return null;
}

export function totpUri(secret: string, email: string): string {
  const issuer = "NAAL Dizin";
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD}`;
}
