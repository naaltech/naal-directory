"use server";

// Yönetici hesapları: sadece süper yönetici. Panelden sadece Yönetici ve Görüntüleyici hesapları açılır ve
// değiştirilir; süper yönetici hesapları devretme ile (ya da sunucuda komut satırından) değişir. Böylece bir süper
// yönetici diğerini düşüremez. Şifreler sunucuda üretilir ve bir kez gösterilir.
// Sayfayı istemci yeniler (revalidatePath yok): yenileme tabloyu baştan kurduğu için, tek seferlik şifre penceresi
// açıkken yenilenirse şifre kaybolur.

import {
  checkPassword,
  createAdmin,
  findAdminById,
  removeAdmin,
  setAdminActive,
  setAdminPassword,
  setAdminRole,
  transferSuperAdmin,
  type AdminUser,
} from "@/lib/auth/admins.ts";
import { generatePassword } from "@/lib/auth/password.ts";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";

export type AdminActionResult = { ok: true; password?: string } | { ok: false; error: string };

const SUB_ROLES = ["ADMIN", "VIEWER"] as const;
type SubRole = (typeof SUB_ROLES)[number];
const isSubRole = (v: unknown): v is SubRole => SUB_ROLES.includes(v as SubRole);

async function run(fn: () => Promise<string | void> | string | void): Promise<AdminActionResult> {
  try {
    const password = (await fn()) ?? undefined;
    return { ok: true, password };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Panelden değiştirilebilecek hesap: kendisi değil, süper yönetici değil */
function subAdmin(id: number, meId: number): AdminUser {
  const target = findAdminById(getDb(), id);
  if (!target) throw new Error("Yönetici bulunamadı");
  if (target.id === meId) throw new Error("Kendi hesabınızı buradan değiştiremezsiniz");
  if (target.role === "SUPER_ADMIN") throw new Error("Süper yönetici hesapları panelden değiştirilemez");
  return target;
}

export async function createAdminAction(input: { email: string; name: string; role: string }): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(async () => {
    if (!isSubRole(input.role)) throw new Error("Rol Yönetici ya da Görüntüleyici olmalı");
    const password = generatePassword();
    await createAdmin(getDb(), { email: input.email, name: input.name, role: input.role, password }, me.id);
    return password;
  });
}

export async function setAdminRoleAction(id: number, role: string): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(() => {
    if (!isSubRole(role)) throw new Error("Rol Yönetici ya da Görüntüleyici olmalı");
    setAdminRole(getDb(), subAdmin(id, me.id).email, role, me.id);
  });
}

export async function setAdminActiveAction(id: number, active: boolean): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(() => setAdminActive(getDb(), subAdmin(id, me.id).email, active, me.id));
}

export async function resetAdminPasswordAction(id: number): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(async () => {
    const password = generatePassword();
    await setAdminPassword(getDb(), subAdmin(id, me.id).email, password, me.id);
    return password;
  });
}

export async function removeAdminAction(id: number): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(() => removeAdmin(getDb(), subAdmin(id, me.id).email, me.id));
}

export async function transferSuperAdminAction(toId: number, myPassword: string): Promise<AdminActionResult> {
  const me = await requireUser("SUPER_ADMIN");
  return run(async () => {
    const db = getDb();
    if (!(await checkPassword(db, me.id, myPassword))) throw new Error("Şifreniz hatalı");
    transferSuperAdmin(db, me.id, toId);
  });
}
