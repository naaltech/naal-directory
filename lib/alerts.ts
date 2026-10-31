// Sistem sağlığı ve yöneticiye giden uyarılar. E-postalara yalnızca sayılar yazılır, öğrenci bilgisi yazılmaz;
// ayrıntı panelin Senkronizasyon sayfasındadır.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DB } from "./db.ts";
import type { Mail } from "./mailer.ts";
import { RECONCILE_KEY, type ReconcileReport } from "./reconcile.ts";
import { leaverCandidates } from "./leavers.ts";
import { clubsWithoutLead } from "./panel/roles.ts";
import { panelReport } from "./panel/sync.ts";
import { upcomingRetention } from "./retention.ts";
import { readSetting, writeSetting } from "./settings.ts";
import { autoPause, HEARTBEAT_KEY, planAutoRun } from "./sync/auto.ts";
import { CLEANUP_KEY, overdueList, type CleanupReport } from "./year-cycle.ts";

export type Level = "ok" | "warn" | "fail";

export interface Check {
  key: string;
  level: Level;
  message: string;
}

const HOUR = 3_600_000;
const WORKER_STALE_MS = HOUR / 6;
const QUEUE_STALE_MS = 2 * HOUR;
const BACKUP_STALE_MS = 26 * HOUR;
const RECONCILE_STALE_MS = 26 * HOUR;
const PANEL_STALE_MS = HOUR / 4;
const COOLDOWN_MS = 24 * HOUR;
const ALERT_STATE_KEY = "alert.state";
const WEEKLY_KEY = "alert.weekly";

function latestBackup(dir: string): number | null {
  try {
    const times = readdirSync(dir)
      .filter((name) => /^app-\d{8}-\d{4}\.db$/.test(name))
      .map((name) => statSync(join(dir, name)).mtimeMs);
    return times.length ? Math.max(...times) : null;
  } catch {
    return null;
  }
}

const utc = (sql: string) => new Date(`${sql.replace(" ", "T")}Z`).getTime();

export function healthChecks(db: DB, now = Date.now(), backupDir = resolve("backups")): Check[] {
  const checks: Check[] = [];
  const add = (key: string, level: Level, ok: string, problem: string) => checks.push({ key, level, message: level === "ok" ? ok : problem });

  const beat = readSetting<number>(db, HEARTBEAT_KEY);
  add("worker", beat === undefined ? "warn" : now - beat > WORKER_STALE_MS ? "fail" : "ok", "Worker çalışıyor.", beat === undefined ? "Worker hiç çalışmadı." : "Worker durmuş görünüyor.");

  const pause = autoPause(db);
  add("paused", pause ? "fail" : "ok", "Otomatik çalıştırma açık.", `Otomatik çalıştırma durduruldu: ${pause?.reason}`);

  const failed = db.prepare("SELECT count(*) FROM sync_jobs WHERE status = 'FAILED'").pluck().get() as number;
  add("failed", failed ? "warn" : "ok", "Başarısız iş yok.", `${failed} başarısız iş var.`);

  const held = planAutoRun(db).held;
  const waiting = held.destructive + held.suspend + held.bulk;
  add("held", waiting ? "warn" : "ok", "Onay bekleyen iş yok.", `Onay bekleyen iş var: ${held.destructive} silme, ${held.suspend} askıya alma, ${held.bulk} toplu iş.`);

  const oldest = db
    .prepare(
      `SELECT min(run_after) FROM sync_jobs WHERE status = 'QUEUED' AND run_after <= datetime('now')
         AND action NOT IN ('DELETE_USER', 'DELETE_GROUP', 'DELETE_ORG_UNIT', 'SUSPEND_USER')`,
    )
    .pluck()
    .get() as string | null;
  add("queue", oldest && now - utc(oldest) > QUEUE_STALE_MS ? "warn" : "ok", "Kuyruk akıyor.", "Kuyrukta 2 saatten uzun bekleyen işler var.");

  const backup = latestBackup(backupDir);
  add("backup", backup !== null && now - backup <= BACKUP_STALE_MS ? "ok" : "fail", "Yerel yedek güncel.", backup === null ? "Yerel yedek bulunamadı." : "Son yerel yedek 26 saatten eski.");

  const reconcile = readSetting<ReconcileReport>(db, RECONCILE_KEY);
  if (reconcile) {
    add("reconcile", reconcile.total ? "warn" : "ok", "Google ile veritabanı uyuşuyor.", `Google ile veritabanı arasında ${reconcile.total} fark var.`);
    add("reconcileAge", now - reconcile.at > RECONCILE_STALE_MS ? "warn" : "ok", "Gece kontrolü güncel.", "Gece kontrolü 26 saatten uzun süredir çalışmadı.");
  }

  const panel = panelReport(db);
  if (panel) {
    const problem = panel.error
      ? "Yönetim paneline roller gönderilemedi."
      : panel.held
        ? `Dizinde süper yönetici yok; panelde ${panel.held} rol silinmedi.`
        : "Yönetim paneli köprüsü durmuş görünüyor.";
    add("panel", panel.error || panel.held ? "fail" : now - panel.at > PANEL_STALE_MS ? "warn" : "ok", "Yönetim paneli rolleri güncel.", problem);
  }

  const leadless = clubsWithoutLead(db);
  const shown = leadless.slice(0, 5).join(", ") + (leadless.length > 5 ? " ..." : "");
  add("clubs", leadless.length ? "warn" : "ok", "Her kulübün yöneticisi var.", `${leadless.length} kulübün panelde yöneticisi yok: ${shown}`);

  const year = overdueList(db, new Date(now));
  add("yearList", year ? "warn" : "ok", "Bu yılın listesi yüklü.", `${year} öğrenci listesi henüz yüklenmedi.`);

  const leavers = leaverCandidates(db).rows.length;
  add("leavers", leavers ? "warn" : "ok", "Bekleyen ayrılan adayı yok.", `${leavers} ayrılan adayı onay bekliyor.`);

  const cleanup = readSetting<CleanupReport>(db, CLEANUP_KEY);
  if (cleanup) {
    add("cleanup", cleanup.ous + cleanup.groups ? "warn" : "ok", "Silinecek boş OU ya da grup yok.", `Temizlikte ${cleanup.ous} boş OU, ${cleanup.groups} kullanılmayan grup silinebilir.`);
  }
  return checks;
}

export function overallLevel(checks: Check[]): Level {
  if (checks.some((c) => c.level === "fail")) return "fail";
  return checks.some((c) => c.level === "warn") ? "warn" : "ok";
}

/** Aynı sorun günde en fazla bir kez bildirilir; düzelip yeniden çıkan sorun hemen bildirilir */
export async function notifyProblems(db: DB, checks: Check[], send: (mail: Mail) => Promise<void>, now = Date.now()): Promise<number> {
  const sent = readSetting<Record<string, number>>(db, ALERT_STATE_KEY) ?? {};
  const problems = checks.filter((c) => c.level !== "ok");
  const due = problems.filter((c) => now - (sent[c.key] ?? 0) >= COOLDOWN_MS);
  if (due.length) {
    const top = due.find((c) => c.level === "fail") ?? due[0];
    await send({
      subject: `[NAAL Panel] ${top.level === "fail" ? "Sorun" : "Uyarı"}: ${top.message}`,
      text: `${due.map((c) => `- ${c.message}`).join("\n")}\n\nAyrıntılar panelin Senkronizasyon sayfasında.`,
    });
  }
  const next = Object.fromEntries(problems.map((c) => [c.key, due.includes(c) ? now : sent[c.key]]));
  writeSetting(db, ALERT_STATE_KEY, next);
  return due.length;
}

/** Pazartesi 08:00'den sonraki ilk kontrolde, haftada bir */
export function weeklyDue(db: DB, now = new Date()): boolean {
  if (now.getDay() !== 1 || now.getHours() < 8) return false;
  return now.getTime() - (readSetting<number>(db, WEEKLY_KEY) ?? 0) > 6 * 24 * HOUR;
}

export function markWeeklySent(db: DB, now = new Date()) {
  writeSetting(db, WEEKLY_KEY, now.getTime());
}

export function weeklySummary(db: DB, checks: Check[]): Mail {
  const jobs = (status: string) =>
    db
      .prepare("SELECT count(*) FROM sync_jobs WHERE status = ? AND updated_at >= datetime('now', '-7 days')")
      .pluck()
      .get(status) as number;
  const retention = upcomingRetention(db);
  const problems = checks.filter((c) => c.level !== "ok");
  return {
    subject: `[NAAL Panel] Haftalık özet: ${problems.length ? `${problems.length} konu bekliyor` : "her şey yolunda"}`,
    text: [
      `Son 7 gün: ${jobs("DONE")} iş tamamlandı, ${jobs("FAILED")} iş başarısız oldu.`,
      `Önümüzdeki ${retention.windowDays} gün: ${retention.suspend} hesap askıya alınacak, ${retention.remove} hesap silinecek.`,
      "",
      ...(problems.length ? problems.map((c) => `- ${c.message}`) : ["Bekleyen sorun yok."]),
    ].join("\n"),
  };
}
