import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { before, test } from "node:test";
import { confirmEmailChange, requestEmailChange, requestPasswordReset, resetPassword } from "../lib/auth/account.ts";
import { createAdmin, findAdminByEmail, setAdminActive, verifyLogin, type LoginResult } from "../lib/auth/admins.ts";
import { createSession, getSessionUser } from "../lib/auth/sessions.ts";
import { base32Encode, matchTotpStep, totpCode, totpUri } from "../lib/auth/totp.ts";
import {
  beginTotpSetup,
  confirmIdentity,
  confirmTotpSetup,
  disableTotp,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  verifyTwoFactor,
} from "../lib/auth/two-factor.ts";
import type { DB } from "../lib/db.ts";
import { testDb } from "./helpers.ts";

const PASSWORD = "eski-sifre-12345";
const EMAIL = "yonetici@nevzatayazal.k12.tr";

before(() => {
  process.env.PASSWORD_ENC_KEY = randomBytes(32).toString("base64");
});

const admin = (db: DB, email = EMAIL) => createAdmin(db, { email, name: "Ada Yönetici", role: "ADMIN", password: PASSWORD });
const currentStep = () => Math.floor(Date.now() / 30000);

/** Kurulumu bitirir; dönen kod kullanılmış sayılır, sonraki kod için bir sonraki adım gerekir */
function enable(db: DB, id: number) {
  const secret = beginTotpSetup(db, id);
  const codes = confirmTotpSetup(db, id, totpCode(secret, currentStep() - 1));
  return { secret, codes };
}

function challengeOf(result: LoginResult): string {
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "two_factor");
  return (result as { challenge: string }).challenge;
}

test("doğrulama kodu RFC 6238 örnekleriyle aynı", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(totpCode(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), "081804");
  assert.match(totpUri(secret, "a@naal.org.tr"), /^otpauth:\/\/totp\/NAAL%20Dizin%3Aa%40naal\.org\.tr\?secret=GEZ/);
});

test("doğrulama kodu: bir adım kayma kabul edilir, kullanılan kod tekrar kullanılamaz", () => {
  const secret = base32Encode(randomBytes(20));
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30000);
  assert.equal(matchTotpStep(secret, totpCode(secret, step + 1), null, now), step + 1);
  assert.equal(matchTotpStep(secret, totpCode(secret, step + 5), null, now), null);
  assert.equal(matchTotpStep(secret, totpCode(secret, step), step, now), null);
});

test("iki adımlı doğrulama kapalıyken giriş eskisi gibi", async () => {
  const db = testDb();
  await admin(db);
  const result = await verifyLogin(db, EMAIL, PASSWORD);
  assert.equal(result.ok, true);
});

test("açık hesapta şifre oturum açmaz, kod ister", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const { secret } = enable(db, id);

  const challenge = challengeOf(await verifyLogin(db, EMAIL, PASSWORD));
  assert.deepEqual(verifyTwoFactor(db, challenge, "000000").ok, false);
  assert.equal(verifyTwoFactor(db, "uydurma", totpCode(secret, currentStep())).ok, false);

  const result = verifyTwoFactor(db, challenge, totpCode(secret, currentStep()));
  assert.equal(result.ok, true);
  assert.equal(findAdminByEmail(db, EMAIL)!.failed_logins, 0);
  // Anahtar tek kullanımlık
  assert.deepEqual(verifyTwoFactor(db, challenge, totpCode(secret, currentStep() + 1)), { ok: false, reason: "expired" });
});

test("hatalı kodlar hesabı kilitler; şifreyi yeniden girmek sayacı sıfırlamaz", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const { secret } = enable(db, id);

  for (let i = 0; i < 4; i++) {
    const challenge = challengeOf(await verifyLogin(db, EMAIL, PASSWORD));
    assert.deepEqual(verifyTwoFactor(db, challenge, "000000"), { ok: false, reason: "invalid" });
  }
  const challenge = challengeOf(await verifyLogin(db, EMAIL, PASSWORD));
  const locked = verifyTwoFactor(db, challenge, "000000");
  assert.equal((locked as { reason: string }).reason, "locked");
  assert.equal(((await verifyLogin(db, EMAIL, PASSWORD)) as { reason: string }).reason, "locked");
  assert.equal(verifyTwoFactor(db, challenge, totpCode(secret, currentStep())).ok, false);
});

test("kurtarma kodu bir kez çalışır, yenilenince eskiler geçersiz olur", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const { codes } = enable(db, id);
  assert.equal(codes.length, 10);
  assert.match(codes[0], /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);

  const first = challengeOf(await verifyLogin(db, EMAIL, PASSWORD));
  assert.equal(verifyTwoFactor(db, first, ` ${codes[0].toUpperCase()} `).ok, true);
  assert.equal(recoveryCodesLeft(db, id), 9);

  const second = challengeOf(await verifyLogin(db, EMAIL, PASSWORD));
  assert.deepEqual(verifyTwoFactor(db, second, codes[0]), { ok: false, reason: "invalid" });

  regenerateRecoveryCodes(db, id);
  assert.deepEqual(verifyTwoFactor(db, second, codes[1]), { ok: false, reason: "invalid" });
});

test("kurulum doğru kod girilene kadar girişi etkilemez; kurulumda öteki oturumlar kapanır", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const secret = beginTotpSetup(db, id);
  assert.equal((await verifyLogin(db, EMAIL, PASSWORD)).ok, true);
  assert.throws(() => confirmTotpSetup(db, id, "000000"), /Kod hatalı/);

  db.prepare("INSERT INTO admin_sessions (id, user_id, expires_at) VALUES ('x', ?, '2999-01-01')").run(id);
  const keep = createSession(db, id).token;
  confirmTotpSetup(db, id, totpCode(secret, currentStep()), keep);
  assert.equal(db.prepare("SELECT count(*) FROM admin_sessions").pluck().get(), 1);
  assert.equal(getSessionUser(db, keep)?.id, id);
  assert.throws(() => beginTotpSetup(db, id), /zaten açık/);
});

test("kapatınca giriş yalnızca şifreyle olur, kurtarma kodları silinir", async () => {
  const db = testDb();
  const { id } = await admin(db);
  enable(db, id);
  disableTotp(db, EMAIL, id);
  assert.equal((await verifyLogin(db, EMAIL, PASSWORD)).ok, true);
  assert.equal(recoveryCodesLeft(db, id), 0);
});

test("kritik işlem şifre ve kod ister; hatalı denemeler kilitler", async () => {
  const db = testDb();
  const { id } = await admin(db);
  await confirmIdentity(db, id, PASSWORD);
  await assert.rejects(confirmIdentity(db, id, "yanlis"), /Şifre hatalı/);

  const { secret } = enable(db, id);
  await assert.rejects(confirmIdentity(db, id, PASSWORD), /doğrulama kodu hatalı/);
  await confirmIdentity(db, id, PASSWORD, totpCode(secret, currentStep()));

  for (let i = 0; i < 5; i++) await assert.rejects(confirmIdentity(db, id, "yanlis"));
  await assert.rejects(confirmIdentity(db, id, PASSWORD, totpCode(secret, currentStep() + 1)), /15 dakika/);
});

test("şifre sıfırlama: bağlantı bir kez çalışır, oturumlar kapanır, kilit açılır", async () => {
  const db = testDb();
  const { id } = await admin(db);
  db.prepare("INSERT INTO admin_sessions (id, user_id, expires_at) VALUES ('x', ?, '2999-01-01')").run(id);
  db.prepare("UPDATE admin_users SET locked_until = '2999-01-01 00:00:00' WHERE id = ?").run(id);

  const { token } = requestPasswordReset(db, EMAIL.toUpperCase())!;
  await assert.rejects(resetPassword(db, token, "kisa"), /en az 10/);
  await resetPassword(db, token, "yeni-sifre-12345");

  assert.equal((await verifyLogin(db, EMAIL, "yeni-sifre-12345")).ok, true);
  assert.equal(db.prepare("SELECT count(*) FROM admin_sessions").pluck().get(), 0);
  await assert.rejects(resetPassword(db, token, "baska-sifre-12345"), /geçersiz/);
});

test("şifre sıfırlama iki adımlı doğrulamayı atlatmaz", async () => {
  const db = testDb();
  const { id } = await admin(db);
  enable(db, id);
  const { token } = requestPasswordReset(db, EMAIL)!;
  await resetPassword(db, token, "yeni-sifre-12345");
  challengeOf(await verifyLogin(db, EMAIL, "yeni-sifre-12345"));
});

test("şifre sıfırlama: bilinmeyen, pasif ya da az önce istenmiş hesaba e-posta gitmez", async () => {
  const db = testDb();
  await admin(db);
  assert.equal(requestPasswordReset(db, "yok@naal.org.tr"), null);
  assert.ok(requestPasswordReset(db, EMAIL));
  assert.equal(requestPasswordReset(db, EMAIL), null);

  await admin(db, "pasif@naal.org.tr");
  await createAdmin(db, { email: "super@naal.org.tr", name: "S", role: "SUPER_ADMIN", password: PASSWORD });
  setAdminActive(db, "pasif@naal.org.tr", false);
  assert.equal(requestPasswordReset(db, "pasif@naal.org.tr"), null);
});

test("süresi dolmuş bağlantı çalışmaz", async () => {
  const db = testDb();
  await admin(db);
  const { token } = requestPasswordReset(db, EMAIL)!;
  db.prepare("UPDATE admin_tokens SET expires_at = '2020-01-01 00:00:00'").run();
  await assert.rejects(resetPassword(db, token, "yeni-sifre-12345"), /geçersiz/);
});

test("e-posta yalnızca okul alan adlarına değişebilir", async () => {
  const db = testDb();
  const { id } = await admin(db);
  await admin(db, "dolu@naal.org.tr");

  for (const bad of ["ali@gmail.com", "ali@ogr.example.com", "ali", "@naal.org.tr", "a@b@naal.org.tr", "ali veli@naal.org.tr"]) {
    assert.throws(() => requestEmailChange(db, id, bad), /ile bitmeli/, bad);
  }
  assert.throws(() => requestEmailChange(db, id, EMAIL), /zaten hesabınızın/);
  assert.throws(() => requestEmailChange(db, id, "dolu@naal.org.tr"), /başka bir yöneticide/);
  assert.equal(requestEmailChange(db, id, " Yeni@NAAL.org.tr ").email, "yeni@naal.org.tr");
  assert.equal(requestEmailChange(db, id, "ali@ogr.nevzatayazal.k12.tr").email, "ali@ogr.nevzatayazal.k12.tr");
});

test("e-posta değişikliği bağlantı açılınca olur, anahtar tek kullanımlık", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const { token } = requestEmailChange(db, id, "yeni@naal.org.tr");
  assert.equal(findAdminByEmail(db, EMAIL)?.id, id);

  const { oldEmail, user } = confirmEmailChange(db, token);
  assert.equal(oldEmail, EMAIL);
  assert.equal(user.email, "yeni@naal.org.tr");
  assert.equal((await verifyLogin(db, "yeni@naal.org.tr", PASSWORD)).ok, true);
  assert.equal(findAdminByEmail(db, EMAIL), undefined);
  assert.throws(() => confirmEmailChange(db, token), /geçersiz/);
});

test("e-posta onayı: adres bu arada başkasına verildiyse değişmez", async () => {
  const db = testDb();
  const { id } = await admin(db);
  const { token } = requestEmailChange(db, id, "yeni@naal.org.tr");
  await admin(db, "yeni@naal.org.tr");
  assert.throws(() => confirmEmailChange(db, token), /başka bir yöneticide/);
  assert.equal(findAdminByEmail(db, EMAIL)?.id, id);
});
