// Şifre özetleme: Node'un yerleşik scrypt'i, ek bağımlılık yok.
// Saklama biçimi: scrypt$N$r$p$tuz(base64)$özet(base64)

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`;
  if (!/[a-zçğıöşü]/i.test(pw) || !/\d/.test(pw)) return "Şifre harf ve rakam içermeli";
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFC"), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(pw.normalize("NFC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected);
}

/** Okunaklı rastgele şifre (karışan 0/O, 1/l/I harfleri yok) */
export function generatePassword(length = 16): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // en az bir rakam garantisi
  return /\d/.test(out) ? out : out.slice(1) + "7";
}
