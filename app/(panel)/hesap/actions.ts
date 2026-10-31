"use server";

// Yöneticinin kendi hesabı. Her işlem şifreyi, iki adımlı doğrulama açıksa kodu da yeniden ister.
// Çerez burada yenilenmez: çerez değişince sayfa baştan kurulur, ekrandaki kurtarma kodları kaybolur.

import QRCode from "qrcode";
import { checkNewEmail, requestEmailChange, sendEmailChangeMail } from "@/lib/auth/account.ts";
import { setAdminPassword } from "@/lib/auth/admins.ts";
import { currentSessionToken, requireUser } from "@/lib/auth/server.ts";
import { totpUri } from "@/lib/auth/totp.ts";
import { beginTotpSetup, confirmIdentity, confirmTotpSetup, disableTotp, regenerateRecoveryCodes } from "@/lib/auth/two-factor.ts";
import { getDb } from "@/lib/db.ts";

export type AccountResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T> | T): Promise<AccountResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function changeEmailAction(input: { email: string; password: string; code: string }): Promise<AccountResult<string>> {
  const me = await requireUser();
  return run(async () => {
    const db = getDb();
    checkNewEmail(db, me.id, input.email);
    await confirmIdentity(db, me.id, input.password, input.code);
    const { user, email, token } = requestEmailChange(db, me.id, input.email);
    await sendEmailChangeMail(user, email, token);
    return email;
  });
}

export async function changePasswordAction(input: { current: string; next: string; code: string }): Promise<AccountResult> {
  const me = await requireUser();
  return run(async () => {
    const db = getDb();
    await confirmIdentity(db, me.id, input.current, input.code);
    await setAdminPassword(db, me.email, input.next, me.id, await currentSessionToken());
    return undefined;
  });
}

export async function startTotpAction(password: string): Promise<AccountResult<{ secret: string; qr: string }>> {
  const me = await requireUser();
  return run(async () => {
    const db = getDb();
    await confirmIdentity(db, me.id, password);
    const secret = beginTotpSetup(db, me.id);
    return { secret, qr: await QRCode.toString(totpUri(secret, me.email), { type: "svg", margin: 2 }) };
  });
}

export async function confirmTotpAction(code: string): Promise<AccountResult<string[]>> {
  const me = await requireUser();
  return run(async () => confirmTotpSetup(getDb(), me.id, code, await currentSessionToken()));
}

export async function disableTotpAction(password: string, code: string): Promise<AccountResult> {
  const me = await requireUser();
  return run(async () => {
    const db = getDb();
    await confirmIdentity(db, me.id, password, code);
    disableTotp(db, me.email, me.id);
    return undefined;
  });
}

export async function regenerateCodesAction(password: string, code: string): Promise<AccountResult<string[]>> {
  const me = await requireUser();
  return run(async () => {
    const db = getDb();
    await confirmIdentity(db, me.id, password, code);
    return regenerateRecoveryCodes(db, me.id);
  });
}
