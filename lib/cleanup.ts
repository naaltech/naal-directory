// Boşalan şube OU'ları ve kullanılmayan sınıf grupları.
//
// Sınıflar her yıl değişir: geçen yıl 9-F vardı, bu yıl yoksa /Ogrenciler/9/9-F OU'su ve 9f@ grubu boş kalır.
// Tarama Google'ı sadece okur (OU, kullanıcı ve grup listeleri). Aday sayılması için:
// - OU: /Ogrenciler/{sınıf}/{şube} biçiminde (sınıf seviyesi OU'ları her yıl gerektiği için silinmez), bu yılın
//   hiçbir şubesi ve silinmemiş hiçbir hesap kullanmıyor, Google'da kendisinde ve altında kullanıcı ya da OU yok.
// - Grup: sınıf grubu, bu yılın hiçbir şubesine bağlı değil, veritabanında ve Google'da üyesi yok.
// Seçilenler kuyruğa alınır; işçi silmeden hemen önce aynı kontrolleri tekrar yapar.

import type { DB } from "./db.ts";
import { directory, isGoogleConfigured, listAll } from "./google/api.ts";
import { logAction } from "./audit.ts";
import { DELETABLE_OU, groupDeletable, ouInUse } from "./sync/handlers.ts";
import { enqueue } from "./sync/queue.ts";

export interface OuCandidate {
  path: string;
  /** Neden silinemez; boşsa aday */
  blocked?: string;
}

export interface GroupCandidate {
  id: number;
  email: string;
  name: string;
  blocked?: string;
}

export interface CleanupScan {
  ous: OuCandidate[];
  groups: GroupCandidate[];
  scannedAt: string;
}

export class CleanupError extends Error {}

const queuedDelete = (db: DB, action: string, entityId: string) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sync_jobs WHERE action = ? AND entity_id = ? AND status IN ('QUEUED', 'RUNNING')")
      .get(action, entityId),
  );

export async function scanCleanup(db: DB): Promise<CleanupScan> {
  if (!isGoogleConfigured()) throw new CleanupError("Google ayarları eksik (.env); tarama yapılamaz.");
  const [ouRes, users, groups] = await Promise.all([
    directory<{ organizationUnits?: { orgUnitPath: string }[] }>("customer/my_customer/orgunits?type=all"),
    listAll<{ orgUnitPath: string }>("users?customer=my_customer&fields=nextPageToken,users(orgUnitPath)", "users"),
    listAll<{ email: string; directMembersCount?: string }>(
      "groups?customer=my_customer&fields=nextPageToken,groups(email,directMembersCount)",
      "groups",
    ),
  ]);
  const allOus = (ouRes.organizationUnits ?? []).map((o) => o.orgUnitPath);
  const usersUnder = (path: string) => users.filter((u) => u.orgUnitPath === path || u.orgUnitPath.startsWith(`${path}/`)).length;

  const ous: OuCandidate[] = [];
  for (const path of allOus.filter((p) => DELETABLE_OU.test(p))) {
    let blocked: string | undefined;
    if (ouInUse(db, path)) blocked = "Bu yılın bir şubesi ya da kayıtlı bir hesap kullanıyor";
    else if (usersUnder(path)) blocked = `Google'da ${usersUnder(path)} kullanıcı var`;
    else if (allOus.some((p) => p.startsWith(`${path}/`))) blocked = "Altında başka OU var";
    else if (queuedDelete(db, "DELETE_ORG_UNIT", path)) blocked = "Silme işi zaten kuyrukta";
    ous.push({ path, blocked });
  }

  const googleMembers = new Map(groups.map((g) => [g.email.toLowerCase(), Number(g.directMembersCount ?? 0)]));
  const classGroups = db
    .prepare("SELECT id, email, name FROM groups WHERE kind = 'CLASS' AND status <> 'DELETED' ORDER BY email")
    .all() as { id: number; email: string; name: string }[];
  const groupRows: GroupCandidate[] = [];
  for (const g of classGroups) {
    const why = groupDeletable(db, g.id);
    if (why?.includes("bu yılın")) continue; // kullanımdaki gruplar listelenmez
    const members = googleMembers.get(g.email.toLowerCase());
    let blocked = why ?? undefined;
    if (!blocked && members) blocked = `Google'da ${members} üye var`;
    if (!blocked && queuedDelete(db, "DELETE_GROUP", String(g.id))) blocked = "Silme işi zaten kuyrukta";
    groupRows.push({ ...g, blocked });
  }
  return { ous: ous.sort((a, b) => a.path.localeCompare(b.path)), groups: groupRows, scannedAt: new Date().toISOString() };
}

/** Seçilen OU ve grupları kuyruğa alır; veritabanı kontrolleri burada da yapılır */
export function enqueueCleanup(db: DB, input: { ous: string[]; groupIds: number[] }, userId: number) {
  return db.transaction(() => {
    const ous = [...new Set(input.ous)];
    for (const path of ous) {
      if (!DELETABLE_OU.test(path)) throw new CleanupError(`${path} silinebilecek bir OU değil.`);
      if (ouInUse(db, path)) throw new CleanupError(`${path} kullanılıyor.`);
    }
    for (const id of input.groupIds) {
      const why = groupDeletable(db, id);
      if (why) throw new CleanupError(`Grup #${id}: ${why}`);
    }
    let n = 0;
    // Gruplar önce, OU'lar en sonda (işçi de OU silmeyi önündeki işler bitene kadar bekletir)
    for (const id of [...new Set(input.groupIds)]) {
      if (queuedDelete(db, "DELETE_GROUP", String(id))) continue;
      const email = db.prepare("SELECT email FROM groups WHERE id = ?").pluck().get(id) as string;
      enqueue(db, "DELETE_GROUP", "group", id, { email });
      n++;
    }
    for (const path of ous) {
      if (queuedDelete(db, "DELETE_ORG_UNIT", path)) continue;
      enqueue(db, "DELETE_ORG_UNIT", "org_unit", path, { path });
      n++;
    }
    if (n) logAction(db, userId, "cleanup.enqueue", "org_unit", null, { ous, groupIds: input.groupIds });
    return n;
  })();
}
