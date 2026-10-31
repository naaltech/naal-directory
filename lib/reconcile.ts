// Gece kontrolü: Google'daki durumu veritabanıyla karşılaştırır, farkları raporlar. Hiçbir şeyi düzeltmez.
// Kuyrukta işi olan hesaplar atlanır: o fark zaten kapanmak üzeredir.

import type { DB } from "./db.ts";
import { listAll } from "./google/api.ts";
import { writeSetting } from "./settings.ts";

export const RECONCILE_KEY = "reconcile.last";
const MANAGED_OUS = ["/Ogrenciler", "/Ogretmenler", "/Mezunlar", "/Nakil", "/Kulupler"];
const MAX_ITEMS = 200;

export type FindingKind = "missing" | "ouMismatch" | "suspendMismatch" | "unmanaged" | "groupMissing";

export interface Finding {
  kind: FindingKind;
  target: string;
  detail: string;
}

export interface ReconcileReport {
  at: number;
  total: number;
  counts: Record<FindingKind, number>;
  /** En fazla 200 kayıt */
  items: Finding[];
}

export interface LocalState {
  accounts: { key: string; email: string; googleId: string; orgUnitPath: string; suspended: boolean; pending: boolean }[];
  /** Silinmiş sayılmayan bütün hesap adresleri ve Google kimlikleri */
  known: Set<string>;
  groups: { email: string; googleId: string; pending: boolean }[];
}

export interface GoogleState {
  users: { id: string; primaryEmail: string; orgUnitPath: string; suspended?: boolean }[];
  groups: { id: string; email: string }[];
}

export function readLocalState(db: DB): LocalState {
  const pending = new Set(
    db
      .prepare("SELECT DISTINCT entity_type || ':' || entity_id FROM sync_jobs WHERE status IN ('QUEUED', 'RUNNING', 'FAILED')")
      .pluck()
      .all() as string[],
  );
  const accounts: LocalState["accounts"] = [];
  const known = new Set<string>();
  for (const [type, table] of [["student", "students"], ["teacher", "teachers"]]) {
    const rows = db
      .prepare(`SELECT id, email, google_user_id, org_unit_path, status FROM ${table} WHERE status <> 'DELETED'`)
      .all() as { id: number; email: string; google_user_id: string | null; org_unit_path: string; status: string }[];
    for (const r of rows) {
      known.add(r.email.toLowerCase());
      if (r.google_user_id) known.add(r.google_user_id);
      if (!r.google_user_id || (r.status !== "ACTIVE" && r.status !== "SUSPENDED")) continue;
      const key = `${type}:${r.id}`;
      accounts.push({
        key,
        email: r.email,
        googleId: r.google_user_id,
        orgUnitPath: r.org_unit_path,
        suspended: r.status === "SUSPENDED",
        pending: pending.has(key),
      });
    }
  }
  const groups = (
    db
      .prepare("SELECT id, email, google_group_id FROM groups WHERE status = 'ACTIVE' AND google_group_id IS NOT NULL")
      .all() as { id: number; email: string; google_group_id: string }[]
  ).map((g) => ({ email: g.email, googleId: g.google_group_id, pending: pending.has(`group:${g.id}`) }));
  return { accounts, known, groups };
}

export function compareState(local: LocalState, google: GoogleState, at = Date.now()): ReconcileReport {
  const items: Finding[] = [];
  const usersById = new Map(google.users.map((u) => [u.id, u]));
  for (const a of local.accounts) {
    if (a.pending) continue;
    const u = usersById.get(a.googleId);
    if (!u) {
      items.push({ kind: "missing", target: a.email, detail: "Veritabanında var, Google'da yok" });
      continue;
    }
    if (u.orgUnitPath !== a.orgUnitPath) {
      items.push({ kind: "ouMismatch", target: a.email, detail: `Veritabanı ${a.orgUnitPath}, Google ${u.orgUnitPath}` });
    }
    if (Boolean(u.suspended) !== a.suspended) {
      items.push({ kind: "suspendMismatch", target: a.email, detail: `Veritabanı ${a.suspended ? "askıda" : "açık"}, Google ${u.suspended ? "askıda" : "açık"}` });
    }
  }
  for (const u of google.users) {
    const managed = MANAGED_OUS.some((ou) => u.orgUnitPath === ou || u.orgUnitPath.startsWith(`${ou}/`));
    if (managed && !local.known.has(u.id) && !local.known.has(u.primaryEmail.toLowerCase())) {
      items.push({ kind: "unmanaged", target: u.primaryEmail, detail: `${u.orgUnitPath} içinde, veritabanında kaydı yok` });
    }
  }
  const groupIds = new Set(google.groups.map((g) => g.id));
  for (const g of local.groups) {
    if (!g.pending && !groupIds.has(g.googleId)) {
      items.push({ kind: "groupMissing", target: g.email, detail: "Veritabanında var, Google'da yok" });
    }
  }

  const counts: Record<FindingKind, number> = { missing: 0, ouMismatch: 0, suspendMismatch: 0, unmanaged: 0, groupMissing: 0 };
  for (const item of items) counts[item.kind]++;
  return { at, total: items.length, counts, items: items.slice(0, MAX_ITEMS) };
}

export async function runReconcile(db: DB): Promise<ReconcileReport> {
  const [users, groups] = await Promise.all([
    listAll<GoogleState["users"][number]>(
      "users?customer=my_customer&fields=nextPageToken,users(id,primaryEmail,orgUnitPath,suspended)",
      "users",
    ),
    listAll<GoogleState["groups"][number]>("groups?customer=my_customer&fields=nextPageToken,groups(id,email)", "groups"),
  ]);
  const report = compareState(readLocalState(db), { users, groups });
  writeSetting(db, RECONCILE_KEY, report);
  return report;
}
