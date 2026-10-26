// Her sync_jobs eyleminin Google karşılığı. İşleyiciler tekrar çalıştırılabilir olmalı:
// iş yarıda kesilip yeniden denendiğinde "zaten var" yanıtı başarı sayılır (sahibi doğrulanarak).

import type { DB } from "../db.ts";
import { GoogleApiError } from "../google/api.ts";
import { decryptSecret } from "../secret-box.ts";
import { enc, orgUnitUrl, type Google } from "./google.ts";

export type Outcome = "created" | "exists" | "updated" | "removed" | "absent";

export interface Job {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: string;
  attempts: number;
  import_batch_id: number | null;
}

export interface Ctx {
  db: DB;
  google: Google;
  /** Veritabanı güncellemesi; deneme modunda çalıştırılmaz */
  apply(fn: () => void): void;
}

/** Tekrar denemekle düzelmeyecek hata: iş doğrudan FAILED olur */
export class PermanentError extends Error {}

const is = (e: unknown, ...status: number[]) => e instanceof GoogleApiError && status.includes(e.status);

/**
 * Kulüp grupları kurum dışından e-posta alabilmeli (yarışma, kurum yazışmaları). Okulun elle düzelttiği
 * tech@naal.org.tr grubunun ayarları örnek alındı. Kurum genelinde "Groups for Business" ayarı da dışarıdan
 * e-postaya izin vermeli; o ayar API ile değiştirilemez, Yönetici konsolundan yapılır.
 */
export const CLUB_GROUP_SETTINGS: Record<string, string> = {
  whoCanPostMessage: "ANYONE_CAN_POST",
  messageModerationLevel: "MODERATE_NONE",
  spamModerationLevel: "MODERATE",
  allowExternalMembers: "false",
  whoCanJoin: "INVITED_CAN_JOIN",
  whoCanViewGroup: "ALL_IN_DOMAIN_CAN_VIEW",
  whoCanViewMembership: "ALL_IN_DOMAIN_CAN_VIEW",
  whoCanContactOwner: "ANYONE_CAN_CONTACT",
  isArchived: "true",
  includeInGlobalAddressList: "true",
  allowWebPosting: "true",
  primaryLanguage: "tr",
};

/** Öğretmen grubu dışarıdan e-posta almıyorsa: okul içinden herkes yazabilir */
export const INTERNAL_GROUP_SETTINGS: Record<string, string> = {
  ...CLUB_GROUP_SETTINGS,
  whoCanPostMessage: "ALL_IN_DOMAIN_CAN_POST",
};

/**
 * Kulüp grubuna ve öğretmen grubuna (kind = CUSTOM) e-posta ayarlarını uygular ve geri okuyup doğrular.
 * Öğretmen grubunda dış e-posta, panelde grubun "dışarıdan e-posta alsın" seçeneğine bağlı.
 */
async function applyClubSettings(db: DB, google: Google, groupId: number, email: string) {
  const g = db.prepare("SELECT kind, allow_external FROM groups WHERE id = ?").get(groupId) as
    | { kind: string; allow_external: number }
    | undefined;
  if (g?.kind !== "CLUB" && g?.kind !== "CUSTOM") return;
  const want = g.kind === "CLUB" || g.allow_external ? CLUB_GROUP_SETTINGS : INTERNAL_GROUP_SETTINGS;
  const got = await google.patchGroupSettings(email, want);
  const wrong = ["whoCanPostMessage", "messageModerationLevel"].filter((k) => got[k] !== want[k]);
  if (wrong.length) {
    throw new PermanentError(
      `${email} ayarları uygulanamadı (${wrong.map((k) => `${k}=${got[k]}`).join(", ")}). Yönetici konsolunda Groups for Business > dışarıdan e-posta iznini kontrol edin.`,
    );
  }
}

/** Hesap işinin kaydı: öğrenci ya da öğretmen */
type Person = "students" | "teachers";
export function personTable(entityType: string): Person {
  if (entityType === "student") return "students";
  if (entityType === "teacher") return "teachers";
  throw new PermanentError(`Bilinmeyen hesap türü: ${entityType}`);
}

/** Silinmesine izin verilen OU'lar: sadece şube OU'ları (/Ogrenciler/9/9-A); sınıf seviyesi ve üst OU'lar asla */
export const DELETABLE_OU = /^\/Ogrenciler\/\d{1,2}\/\d{1,2}-[^/]+$/;

/** Bu OU (ya da altı) veritabanında kullanılıyor mu: güncel yılın şubesi ya da silinmemiş bir hesap */
export function ouInUse(db: DB, path: string): boolean {
  const under = `${path}/%`;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM class_sections c JOIN academic_years y ON y.id = c.academic_year_id
         WHERE y.is_current = 1 AND (c.org_unit_path = @p OR c.org_unit_path LIKE @u)
         UNION ALL SELECT 1 FROM students WHERE status <> 'DELETED' AND (org_unit_path = @p OR org_unit_path LIKE @u)
         UNION ALL SELECT 1 FROM teachers WHERE status <> 'DELETED' AND (org_unit_path = @p OR org_unit_path LIKE @u)
         LIMIT 1`,
      )
      .get({ p: path, u: under }),
  );
}

/** Grup silinebilir mi: kapatılmış kulüp, kapatılmış öğretmen grubu ya da güncel yılda kullanılmayan, üyesiz sınıf grubu */
export function groupDeletable(db: DB, groupId: number): string | null {
  const g = db.prepare("SELECT id, kind, status FROM groups WHERE id = ?").get(groupId) as
    | { id: number; kind: string; status: string }
    | undefined;
  if (!g) return "Grup kaydı yok.";
  if (g.kind === "CLUB") {
    const active = db.prepare("SELECT is_active FROM clubs WHERE group_id = ?").pluck().get(groupId);
    if (active !== 0) return "Kulüp hâlâ açık.";
    return null;
  }
  if (g.kind === "CUSTOM") {
    if (g.status !== "ARCHIVED") return "Öğretmen grubu panelde kapatılmamış.";
    return null;
  }
  if (g.kind === "CLASS") {
    const used = db
      .prepare(
        `SELECT 1 FROM class_sections c JOIN academic_years y ON y.id = c.academic_year_id
         WHERE c.group_id = ? AND y.is_current = 1`,
      )
      .get(groupId);
    if (used) return "Sınıf grubu bu yılın bir şubesinde kullanılıyor.";
    if (db.prepare("SELECT 1 FROM group_members WHERE group_id = ?").get(groupId)) return "Grubun hâlâ üyesi var.";
    return null;
  }
  return "Bu tür grup panelden silinmez.";
}

type Handler = (p: any, job: Job, ctx: Ctx) => Promise<Outcome>; // eslint-disable-line @typescript-eslint/no-explicit-any

const handlers: Record<string, Handler> = {
  async CREATE_ORG_UNIT(p: { name: string; parentOrgUnitPath: string }, job, { google }) {
    try {
      await google.get(orgUnitUrl(job.entity_id));
      return "exists";
    } catch (e) {
      if (!is(e, 400, 404)) throw e;
    }
    await google.send({ method: "POST", path: "customer/my_customer/orgunits", body: p });
    return "created";
  },

  async CREATE_GROUP(p: { email: string; name: string; description?: string }, job, { google, db, apply }) {
    let id: string;
    let outcome: Outcome = "created";
    try {
      ({ id } = await google.send<{ id: string }>({ method: "POST", path: "groups", body: p }));
    } catch (e) {
      if (!is(e, 409)) throw e;
      // Adres bir kullanıcıya aitse groups/{adres} 404 döner; o zaman çakışmadır
      try {
        ({ id } = await google.get<{ id: string }>(`groups/${enc(p.email)}`));
      } catch (e2) {
        if (is(e2, 404)) throw new PermanentError(`${p.email} Google'da bir kullanıcı ya da takma ad olarak kullanılıyor.`);
        throw e2;
      }
      outcome = "exists";
    }
    // Ayar başarısız olursa iş tekrar dener; grup oluşturma "zaten var" olarak geçer
    await applyClubSettings(db, google, Number(job.entity_id), p.email);
    apply(() =>
      db.prepare(
        "UPDATE groups SET google_group_id = ?, status = 'ACTIVE', last_synced_at = datetime('now') WHERE id = ?",
      ).run(id, Number(job.entity_id)),
    );
    return outcome;
  },

  async CREATE_USER(
    p: { email: string; firstName: string; lastName: string; orgUnitPath: string; changePasswordAtNextLogin?: boolean },
    job,
    { google, db, apply },
  ) {
    const table = personTable(job.entity_type);
    const st = db
      .prepare(`SELECT status, initial_password_enc FROM ${table} WHERE id = ?`)
      .get(Number(job.entity_id)) as { status: string; initial_password_enc: string | null } | undefined;
    if (!st || st.status === "DELETED") throw new PermanentError("Hesap kaydı yok ya da silinmiş.");
    if (!st.initial_password_enc) throw new PermanentError("İlk şifre kayıtlı değil.");

    const name = { givenName: p.firstName, familyName: p.lastName };
    let id: string;
    let outcome: Outcome = "created";
    try {
      ({ id } = await google.send<{ id: string }>({
        method: "POST",
        path: "users",
        body: {
          primaryEmail: p.email,
          name,
          password: decryptSecret(st.initial_password_enc),
          changePasswordAtNextLogin: p.changePasswordAtNextLogin ?? true,
          orgUnitPath: p.orgUnitPath,
        },
      }));
    } catch (e) {
      if (!is(e, 409)) throw e;
      // Önceki deneme hesabı açıp kaydedemeden kesilmiş olabilir: aynı ad ve birincil adresse bizimdir
      const u = await google
        .get<{ id: string; primaryEmail: string; name: { givenName: string; familyName: string } }>(`users/${enc(p.email)}`)
        .catch((e2) => {
          if (is(e2, 404)) return null;
          throw e2;
        });
      const ours =
        u &&
        u.primaryEmail.toLowerCase() === p.email.toLowerCase() &&
        u.name.givenName === name.givenName &&
        u.name.familyName === name.familyName;
      if (!ours) throw new PermanentError(`${p.email} Google'da başka bir hesap, grup ya da takma ad tarafından kullanılıyor.`);
      id = u.id;
      outcome = "exists";
    }
    apply(() =>
      db.prepare(
        `UPDATE ${table} SET google_user_id = ?, status = 'ACTIVE', last_synced_at = datetime('now') WHERE id = ?`,
      ).run(id, Number(job.entity_id)),
    );
    return outcome;
  },

  async UPDATE_USER(
    p: {
      email: string;
      newEmail?: string;
      orgUnitPath?: string;
      firstName?: string;
      lastName?: string;
      suspended?: boolean;
      resetPassword?: boolean;
    },
    job,
    { google, db, apply },
  ) {
    const table = personTable(job.entity_type);
    const id = Number(job.entity_id);
    const body: Record<string, unknown> = {};
    if (p.orgUnitPath) body.orgUnitPath = p.orgUnitPath;
    if (p.suspended === false) body.suspended = false; // okula geri dönen
    // Adres değişikliği: Google eski adresi takma ad olarak tutar. Tekrar çalışırsa eski adres takma ad olarak
    // aynı hesaba çıktığı için istek yine aynı hesaba gider.
    if (p.newEmail) body.primaryEmail = p.newEmail;
    if (p.resetPassword) {
      // Şifre kuyrukta durmaz; sıfırlamada kaydedilen son şifre gönderilir
      const enc = db.prepare(`SELECT initial_password_enc FROM ${table} WHERE id = ?`).pluck().get(id) as string | null | undefined;
      if (!enc) throw new PermanentError("Kayıtlı şifre yok.");
      body.password = decryptSecret(enc);
      body.changePasswordAtNextLogin = true;
    }
    if (p.firstName || p.lastName) {
      // Google ad nesnesini bütün ister; değişmeyen kısım güncel kayıttan alınır
      const st = db.prepare(`SELECT first_name, last_name FROM ${table} WHERE id = ?`).get(id) as
        | { first_name: string; last_name: string }
        | undefined;
      body.name = { givenName: p.firstName ?? st?.first_name, familyName: p.lastName ?? st?.last_name };
    }
    try {
      await google.send({ method: "PUT", path: `users/${enc(p.email)}`, body });
    } catch (e) {
      if (p.newEmail && is(e, 409)) throw new PermanentError(`${p.newEmail} Google'da başka bir hesap ya da takma ad olarak kullanılıyor.`);
      throw e;
    }
    apply(() => {
      db.prepare(`UPDATE ${table} SET last_synced_at = datetime('now') WHERE id = ?`).run(id);
      if (p.suspended === false) {
        db.prepare(`UPDATE ${table} SET status = 'ACTIVE', suspended_at = NULL WHERE id = ? AND status = 'SUSPENDED'`).run(id);
      }
    });
    return "updated";
  },

  async SUSPEND_USER(p: { email: string }, job, { google, db, apply }) {
    const table = personTable(job.entity_type);
    await google.send({ method: "PUT", path: `users/${enc(p.email)}`, body: { suspended: true } });
    apply(() =>
      db.prepare(
        `UPDATE ${table} SET status = 'SUSPENDED', suspended_at = datetime('now'), last_synced_at = datetime('now') WHERE email = ?`,
      ).run(p.email),
    );
    return "updated";
  },

  // Geri alınamaz: kayıt tekrar kontrol edilir, sadece süresi dolmuş mezun/nakil öğrenci ya da ayrılan öğretmen silinir
  async DELETE_USER(p: { email: string }, job, { google, db, apply }) {
    const table = personTable(job.entity_type);
    const exitCol = table === "students" ? "exit_reason" : "left_at";
    const st = db
      .prepare(`SELECT email, ${exitCol} AS exited, delete_at <= datetime('now') AS due, status FROM ${table} WHERE id = ?`)
      .get(Number(job.entity_id)) as { email: string; exited: string | null; due: number; status: string } | undefined;
    const domain = db
      .prepare("SELECT name FROM domains WHERE kind = ?")
      .pluck()
      .get(table === "students" ? "STUDENT" : "TEACHER") as string;
    if (!st || st.email.toLowerCase() !== p.email.toLowerCase()) throw new PermanentError("Silinecek hesap kaydı eşleşmiyor.");
    if (!st.exited || !st.due) throw new PermanentError("Hesap ayrılmış olarak işaretli değil ya da silme tarihi gelmedi.");
    if (!p.email.toLowerCase().endsWith(`@${domain}`)) throw new PermanentError(`Sadece ${domain} alan adındaki hesaplar silinir.`);
    if (p.email.toLowerCase() === process.env.GOOGLE_ADMIN_IMPERSONATE?.toLowerCase()) throw new PermanentError("Yönetici hesabı silinemez.");
    if (db.prepare("SELECT 1 FROM admin_users WHERE email = ?").get(p.email)) throw new PermanentError("Panel yöneticisinin hesabı silinemez.");

    let outcome: Outcome = "removed";
    try {
      await google.send({ method: "DELETE", path: `users/${enc(p.email)}` });
    } catch (e) {
      if (!is(e, 404)) throw e;
      outcome = "absent";
    }
    apply(() =>
      db.prepare(
        `UPDATE ${table} SET status = 'DELETED', deleted_at = datetime('now'), initial_password_enc = NULL, last_synced_at = datetime('now') WHERE id = ?`,
      ).run(Number(job.entity_id)),
    );
    return outcome;
  },

  // Grubun adresi değişmez; ad, açıklama ve (kulüpte) dış e-posta ayarları yeniden uygulanır
  async UPDATE_GROUP(p: { email: string; name: string; description?: string }, job, { google, db, apply }) {
    await google.send({ method: "PUT", path: `groups/${enc(p.email)}`, body: { name: p.name, description: p.description ?? "" } });
    await applyClubSettings(db, google, Number(job.entity_id), p.email);
    apply(() => db.prepare("UPDATE groups SET last_synced_at = datetime('now') WHERE id = ?").run(Number(job.entity_id)));
    return "updated";
  },

  // Geri alınamaz: kayıt tekrar kontrol edilir (kapatılmış kulüp/öğretmen grubu ya da kullanılmayan, üyesiz sınıf grubu)
  async DELETE_GROUP(p: { email: string }, job, { google, db, apply }) {
    const g = db.prepare("SELECT email FROM groups WHERE id = ?").get(Number(job.entity_id)) as { email: string } | undefined;
    if (!g || g.email.toLowerCase() !== p.email.toLowerCase()) throw new PermanentError("Silinecek grup kaydı eşleşmiyor.");
    const why = groupDeletable(db, Number(job.entity_id));
    if (why) throw new PermanentError(`Grup silinmedi: ${why}`);
    let outcome: Outcome = "removed";
    try {
      await google.send({ method: "DELETE", path: `groups/${enc(p.email)}` });
    } catch (e) {
      if (!is(e, 404)) throw e;
      outcome = "absent";
    }
    apply(() => {
      db.prepare("DELETE FROM group_members WHERE group_id = ?").run(Number(job.entity_id));
      db.prepare(
        "UPDATE groups SET status = 'DELETED', google_group_id = NULL, last_synced_at = datetime('now') WHERE id = ?",
      ).run(Number(job.entity_id));
    });
    return outcome;
  },

  // Sadece boş şube OU'su: veritabanında kullanılmıyor, Google'da alt OU'su ve kullanıcısı yok
  async DELETE_ORG_UNIT(p: { path: string }, job, { google, db }) {
    const path = job.entity_id;
    if (p.path !== path || !DELETABLE_OU.test(path)) throw new PermanentError(`${path} silinebilecek bir OU değil.`);
    if (ouInUse(db, path)) throw new PermanentError(`${path} veritabanında kullanılıyor (güncel şube ya da hesap).`);
    try {
      await google.get(orgUnitUrl(path));
    } catch (e) {
      if (is(e, 400, 404)) return "absent";
      throw e;
    }
    const children = await google.get<{ organizationUnits?: unknown[] }>(
      `customer/my_customer/orgunits?orgUnitPath=${enc(path)}&type=children`,
    );
    if (children.organizationUnits?.length) throw new PermanentError(`${path} altında başka OU var.`);
    const users = await google.get<{ users?: unknown[] }>(
      `users?customer=my_customer&maxResults=1&query=${enc(`orgUnitPath='${path}'`)}`,
    );
    if (users.users?.length) throw new PermanentError(`${path} içinde Google'da kullanıcı var.`);
    try {
      await google.send({ method: "DELETE", path: orgUnitUrl(path) });
    } catch (e) {
      if (is(e, 404)) return "absent";
      throw e;
    }
    return "removed";
  },

  async ADD_MEMBER(p: { groupEmail: string; memberEmail: string; role?: string }, job, { google, db, apply }) {
    let outcome: Outcome = "created";
    try {
      await google.send({
        method: "POST",
        path: `groups/${enc(p.groupEmail)}/members`,
        body: { email: p.memberEmail, role: p.role ?? "MEMBER" },
      });
    } catch (e) {
      if (!is(e, 409)) throw e;
      outcome = "exists";
    }
    apply(() =>
      db.prepare(
        `UPDATE group_members SET status = 'ACTIVE'
         WHERE member_email = ? AND group_id = (SELECT id FROM groups WHERE email = ?)`,
      ).run(p.memberEmail, p.groupEmail),
    );
    return outcome;
  },

  async REMOVE_MEMBER(p: { groupEmail: string; memberEmail: string }, job, { google }) {
    try {
      await google.send({ method: "DELETE", path: `groups/${enc(p.groupEmail)}/members/${enc(p.memberEmail)}` });
      return "removed";
    } catch (e) {
      if (is(e, 404)) return "absent";
      throw e;
    }
  },

  // Takma ad: öğrenci/öğretmen hesabına (kulüp görevlisi) ya da gruba (alt adres)
  async ADD_ALIAS(p: { email?: string; groupEmail?: string; alias: string }, job, { google, db, apply }) {
    if (job.entity_type === "group") {
      let outcome: Outcome = "created";
      try {
        await google.send({ method: "POST", path: `groups/${enc(p.groupEmail!)}/aliases`, body: { alias: p.alias } });
      } catch (e) {
        if (!is(e, 409)) throw e;
        // groups/{takma ad} sahibi grubu döndürür; kullanıcıya aitse 404
        const owner = await google.get<{ email: string }>(`groups/${enc(p.alias)}`).catch(() => null);
        if (owner?.email.toLowerCase() !== p.groupEmail!.toLowerCase()) {
          throw new PermanentError(`${p.alias} Google'da başka bir hesap ya da grup tarafından kullanılıyor.`);
        }
        outcome = "exists";
      }
      apply(() =>
        db.prepare("UPDATE group_aliases SET status = 'ACTIVE' WHERE alias_email = ? AND removed_at IS NULL").run(p.alias),
      );
      return outcome;
    }
    let outcome: Outcome = "created";
    try {
      await google.send({ method: "POST", path: `users/${enc(p.email!)}/aliases`, body: { alias: p.alias } });
    } catch (e) {
      if (!is(e, 409)) throw e;
      const owner = await google.get<{ primaryEmail: string }>(`users/${enc(p.alias)}`).catch(() => null);
      if (owner?.primaryEmail.toLowerCase() !== p.email!.toLowerCase()) {
        throw new PermanentError(`${p.alias} Google'da başka bir hesap ya da grup tarafından kullanılıyor.`);
      }
      outcome = "exists";
    }
    apply(() =>
      db.prepare("UPDATE club_officers SET status = 'ACTIVE' WHERE alias_email = ? AND ended_at IS NULL").run(p.alias),
    );
    return outcome;
  },

  async REMOVE_ALIAS(p: { email?: string; groupEmail?: string; alias: string }, job, { google }) {
    const owner = job.entity_type === "group" ? `groups/${enc(p.groupEmail!)}` : `users/${enc(p.email!)}`;
    try {
      await google.send({ method: "DELETE", path: `${owner}/aliases/${enc(p.alias)}` });
      return "removed";
    } catch (e) {
      if (is(e, 404)) return "absent";
      throw e;
    }
  },
};

export function isSupported(action: string) {
  return action in handlers;
}

export async function runHandler(job: Job, ctx: Ctx): Promise<Outcome> {
  const h = handlers[job.action];
  if (!h) throw new PermanentError(`${job.action} işçide henüz desteklenmiyor.`);
  return h(JSON.parse(job.payload), job, ctx);
}

/** Kalıcı hatada kaydı ERROR yapar ki panelde görünsün */
export function markEntityError(db: DB, job: Job) {
  if (job.action === "CREATE_USER" && (job.entity_type === "student" || job.entity_type === "teacher")) {
    db.prepare(`UPDATE ${personTable(job.entity_type)} SET status = 'ERROR' WHERE id = ?`).run(Number(job.entity_id));
  }
  if (job.action === "CREATE_GROUP") db.prepare("UPDATE groups SET status = 'ERROR' WHERE id = ?").run(Number(job.entity_id));
  if (job.action === "ADD_ALIAS" && job.entity_type === "group") {
    const p = JSON.parse(job.payload) as { alias: string };
    db.prepare("UPDATE group_aliases SET status = 'ERROR' WHERE alias_email = ? AND removed_at IS NULL").run(p.alias);
  }
  if (job.action === "ADD_MEMBER") {
    const p = JSON.parse(job.payload) as { groupEmail: string; memberEmail: string };
    db.prepare(
      "UPDATE group_members SET status = 'ERROR' WHERE member_email = ? AND group_id = (SELECT id FROM groups WHERE email = ?)",
    ).run(p.memberEmail, p.groupEmail);
  }
}
