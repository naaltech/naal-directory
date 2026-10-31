// Dizin ile yönetim paneli arasındaki köprü (scripts/worker.ts her dakika çağırır).
//
// Roller olay olay değil durum olarak gönderilir: her seferinde olması gereken liste hesaplanır, Supabase'deki
// listeyle karşılaştırılır ve fark yazılır. Böylece göreve atama, mezuniyet, askı ya da kulüp kapatma gibi her yol
// ayrıca bildirim yazmadan kapsanır; kesinti olursa bir sonraki çalıştırma kendiliğinden düzeltir.
//
// Süper yöneticisi olmayan liste, yanlış ya da boş veritabanı demektir: o durumda hiçbir yetki silinmez.
//
// Kulüplerin açık/kapalı durumu da aynı yolla gider: dizinde kapanan kulüp sitede gizlenir, yeniden açılınca geri gelir.
//
// Panel bu tarafa directory_commands tablosundan istek yazar. Hepsi tekrar çalıştırılabilir; istek yazan kişinin
// yetkisi burada bir kez daha kontrol edilir.

import { logAction } from "../audit.ts";
import { addMembers, ClubError } from "../clubs.ts";
import type { DB } from "../db.ts";
import { readSetting, writeSetting } from "../settings.ts";
import type { PanelApi, PanelCommand } from "./api.ts";
import { issueCertificates, type CertificateMailer } from "./certificates.ts";
import { canManage, desiredRoles, findSchoolPerson, MAGAZINE_CLUB, roleKey, type PanelRole } from "./roles.ts";

export const PANEL_REPORT_KEY = "panel.sync";

export interface PanelReport {
  at: number;
  added: number;
  removed: number;
  commands: number;
  /** İşlenen toplu sertifika satırı */
  certificates: number;
  /** Süper yönetici bulunamadığı için silinmeyen rol sayısı */
  held: number;
  error?: string;
}

class CommandError extends Error {}

function runCommand(db: DB, c: PanelCommand, roles: PanelRole[]) {
  if (!canManage(roles, c.requested_by.toLowerCase(), c.club_code)) throw new CommandError("İstek yapan kişinin bu kulüpte yetkisi yok.");
  const club = db.prepare("SELECT id FROM clubs WHERE code = ? AND is_active = 1").get(c.club_code) as { id: number } | undefined;
  if (!club) throw new CommandError("Kulüp dizinde açık değil.");

  if (c.kind === "revoke_editor") {
    if (db.prepare("DELETE FROM club_editors WHERE club_id = ? AND email = ?").run(club.id, c.email).changes) {
      logAction(db, null, "panel.editor_revoke", "club", club.id, { email: c.email, by: c.requested_by });
    }
    return;
  }
  const person = findSchoolPerson(db, c.email);
  if (!person) throw new CommandError(`${c.email} okulda kayıtlı bir hesap değil.`);
  if (c.kind === "grant_editor") {
    if (c.club_code !== MAGAZINE_CLUB) throw new CommandError("Dergi editörü yalnızca bilim kulübüne eklenir.");
    if (db.prepare("INSERT OR IGNORE INTO club_editors (club_id, email) VALUES (?, ?)").run(club.id, person.email).changes) {
      logAction(db, null, "panel.editor_grant", "club", club.id, { email: person.email, by: c.requested_by });
    }
    return;
  }
  if (person.type !== "student") throw new CommandError(`${c.email} öğrenci hesabı değil.`);
  addMembers(db, club.id, [person.id], null);
}

async function runCommands(db: DB, api: PanelApi) {
  const commands = await api.pendingCommands();
  for (const c of commands) {
    let error: string | null = null;
    try {
      runCommand(db, c, desiredRoles(db));
    } catch (e) {
      const known = e instanceof CommandError || e instanceof ClubError;
      if (!known) console.error(`Panel isteği ${c.id}: ${(e as Error).message}`);
      error = known ? e.message : "İstek işlenemedi.";
    }
    await api.finishCommand(c.id, error);
  }
  return commands.length;
}

async function pushClubs(db: DB, api: PanelApi) {
  const known = new Map((await api.listClubs()).map((c) => [c.code.toLowerCase(), c]));
  const clubs = db.prepare("SELECT code, name, is_active FROM clubs").all() as { code: string; name: string; is_active: number }[];
  const missing = clubs.filter((c) => c.is_active && !known.has(c.code.toLowerCase())).map((c) => ({ code: c.code, title: c.name }));
  if (missing.length) await api.addClubs(missing);
  for (const club of clubs) {
    const row = known.get(club.code.toLowerCase());
    if (row && row.is_active !== Boolean(club.is_active)) await api.setClubActive(row.code, Boolean(club.is_active));
  }
}

async function pushRoles(db: DB, api: PanelApi) {
  const want = desiredRoles(db);
  const have = await api.listRoles();
  const current = new Map(have.map((r) => [roleKey(r), r]));
  const wanted = new Set(want.map(roleKey));

  const save = want.filter((r) => current.get(roleKey(r))?.name !== r.name);
  if (save.length) await api.saveRoles(save);

  const stale = have.filter((r) => !wanted.has(roleKey(r)));
  if (!want.some((r) => r.role === "super")) return { added: save.length, removed: 0, held: stale.length };
  for (const r of stale) await api.removeRole(r);
  return { added: save.length, removed: stale.length, held: 0 };
}

export async function syncPanel(db: DB, api: PanelApi, now = Date.now(), mail: CertificateMailer | null = null): Promise<PanelReport> {
  const report: PanelReport = { at: now, added: 0, removed: 0, commands: 0, certificates: 0, held: 0 };
  try {
    // Önce istekler: eklenen editörün rolü aynı çalıştırmada gider
    report.commands = await runCommands(db, api);
    await pushClubs(db, api);
    Object.assign(report, await pushRoles(db, api));
    if (mail) report.certificates = await issueCertificates(db, api, mail, desiredRoles(db));
  } catch (e) {
    report.error = (e as Error).message;
    console.error(`Panel köprüsü: ${report.error}`);
  }
  writeSetting(db, PANEL_REPORT_KEY, report);
  return report;
}

export const panelReport = (db: DB) => readSetting<PanelReport>(db, PANEL_REPORT_KEY);
