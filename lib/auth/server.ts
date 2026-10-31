// Next.js tarafı: çerezden oturum okuma, sayfa koruması, giriş/çıkış işlemleri.
import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db.ts";
import type { AdminUser, Role } from "./admins.ts";
import { createSession, deleteSession, getSessionUser, SESSION_COOKIE } from "./sessions.ts";

const RANK: Record<Role, number> = { VIEWER: 0, ADMIN: 1, SUPER_ADMIN: 2 };

export async function getCurrentUser(): Promise<AdminUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(getDb(), token);
}

/** Giriş yapılmamışsa /login'e, rol yetmiyorsa ana sayfaya yönlendirir. */
export async function requireUser(minRole: Role = "VIEWER"): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (RANK[user.role] < RANK[minRole]) redirect("/?yetki=yok");
  return user;
}

/** İstemci IP'si (proxy başlıklarından) */
export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? undefined;
}

export async function startSession(userId: number) {
  const h = await headers();
  const { token, expires } = createSession(getDb(), userId, {
    ip: await clientIp(),
    userAgent: h.get("user-agent") ?? undefined,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

/** Bu cihazın çerezi: kendi hesabını değiştiren yöneticinin oturumu kapanmasın */
export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function endSession() {
  const jar = await cookies();
  deleteSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}
