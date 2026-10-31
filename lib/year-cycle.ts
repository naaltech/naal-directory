// Yıllık döngü: insanın yapacağı tek iş e-Okul listesini yüklemek. Gerisi burada.
//
// - Liste yüklenmediyse hatırlatma gider (sağlık kontrolü, alerts.ts).
// - Temiz liste kendiliğinden onaylanır; şüpheli listede neden yazılır ve yöneticinin onayı beklenir.
// - Ayrılanlar kendiliğinden işaretlenir (mezun her zaman, nakil makul sayıdaysa). Askı tarihi gelene kadar
//   panelden geri alınabilir ve listede yeniden görünen öğrenci kendiliğinden geri döner.
// - İlk şifreler süresi dolunca silinir; gerekirse panelden yeni şifre üretilir.
//
// Sınırlar settings tablosunda: import.autoConfirm, import.autoMaxNewRatio, leavers.autoMark,
// leavers.autoMaxTransfer, password.keepDays, year.reminderDay.

import type { DB } from "./db.ts";
import type { ImportSummary, PreviewRow } from "./import/students.ts";
import { leaverCandidates, markLeavers, setting } from "./leavers.ts";
import { dueRetention, enqueueRetention } from "./retention.ts";
import { readSetting, writeSetting } from "./settings.ts";
import { latestListYear, schoolYearFor, yearName } from "./years.ts";

const LAST_GRADE = 12;
const DAILY_KEY = "daily.last";
const DAILY_HOUR = 3;
export const CLEANUP_KEY = "cleanup.report";

/** Yüklenmesi geciken listenin yılı; hatırlatma zamanı gelmediyse ya da liste varsa null */
export function overdueList(db: DB, now = new Date()): string | null {
  const start = schoolYearFor(now);
  if ((latestListYear(db)?.start ?? -1) >= start) return null;
  const remindFrom = new Date(start, 8, setting(db, "year.reminderDay", 15));
  return now >= remindFrom ? yearName(start) : null;
}

/** Liste kendiliğinden onaylanabilir mi; onaylanamazsa nedenleri */
export function autoConfirmProblems(db: DB, batchId: number): string[] {
  const batch = db.prepare("SELECT status, summary FROM import_batches WHERE id = ?").get(batchId) as
    | { status: string; summary: string }
    | undefined;
  if (!batch || batch.status !== "PARSED") return ["Liste onay bekleyen durumda değil."];
  if (!setting(db, "import.autoConfirm", 1)) return ["Kendiliğinden onay ayarı kapalı."];

  const summary = JSON.parse(batch.summary) as ImportSummary;
  const rows = (db.prepare("SELECT parsed, status FROM import_rows WHERE batch_id = ?").all(batchId) as { parsed: string; status: string }[]).map(
    (r) => ({ status: r.status, row: JSON.parse(r.parsed) as PreviewRow }),
  );
  const problems: string[] = [];
  if (!latestListYear(db)) problems.push("Sistemdeki ilk liste; karşılaştırılacak önceki liste yok.");
  if (summary.year?.source !== "report") problems.push("Eğitim yılı rapordan okunmadı, elle seçildi.");
  if (!summary.google.checked) problems.push("Adresler Google'da kontrol edilemedi.");
  if (summary.issues.length) problems.push(`Dosyada ${summary.issues.length} okuma uyarısı var.`);
  const bad = rows.filter((r) => r.status !== "VALID").length;
  if (bad) problems.push(`${bad} satır hatalı ya da karar bekliyor.`);

  const fresh = rows.filter((r) => r.row.match.kind === "new").length;
  const maxRatio = setting(db, "import.autoMaxNewRatio", 40) / 100;
  if (rows.length && fresh / rows.length > maxRatio) {
    problems.push(`Satırların %${Math.round((fresh / rows.length) * 100)} kadarı yeni öğrenci; beklenenden çok.`);
  }
  return problems;
}

export interface LeaverRun {
  marked: number;
  /** Nakil sınırını aştığı ya da liste eksik olduğu için onay bekleyenler */
  held: number;
}

/**
 * Ayrılan adaylarını işaretler. Listede 12. sınıf yoksa liste eksik sayılır, kimse işaretlenmez: şubesi henüz
 * yüklenmemiş biri mezun görünebilir.
 */
export function autoMarkLeavers(db: DB, now = new Date()): LeaverRun {
  if (!setting(db, "leavers.autoMark", 1)) return { marked: 0, held: 0 };
  const { rows, grades } = leaverCandidates(db);
  if (!rows.length) return { marked: 0, held: 0 };
  if (!grades.includes(LAST_GRADE)) return { marked: 0, held: rows.length };

  const graduates = rows.filter((r) => r.suggested === "GRADUATED");
  const transfers = rows.filter((r) => r.suggested === "TRANSFERRED");
  const within = transfers.length <= setting(db, "leavers.autoMaxTransfer", 30);
  const items = (within ? rows : graduates).map((r) => ({ studentId: r.id, reason: r.suggested }));
  return { marked: markLeavers(db, items, null, now), held: within ? 0 : transfers.length };
}

/** Süresi dolan ilk şifreleri siler. Kuyrukta şifreyi bekleyen iş varsa dokunmaz. */
export function purgeInitialPasswords(db: DB, now = new Date()): number {
  const before = new Date(now.getTime() - setting(db, "password.keepDays", 60) * 864e5).toISOString().slice(0, 19).replace("T", " ");
  let purged = 0;
  for (const [table, type] of [["students", "student"], ["teachers", "teacher"]] as const) {
    purged += db
      .prepare(
        `UPDATE ${table} SET initial_password_enc = NULL
         WHERE initial_password_enc IS NOT NULL AND google_user_id IS NOT NULL AND status = 'ACTIVE' AND password_set_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM sync_jobs j
             WHERE j.entity_type = '${type}' AND j.entity_id = CAST(${table}.id AS TEXT)
               AND j.status IN ('QUEUED', 'RUNNING', 'FAILED')
               AND (j.action = 'CREATE_USER' OR json_extract(j.payload, '$.resetPassword') = 1))`,
      )
      .run(before).changes;
  }
  return purged;
}

export interface CleanupReport {
  at: number;
  ous: number;
  groups: number;
}

export interface DailyRun {
  retention: number;
  leavers: LeaverRun;
  passwords: number;
}

/**
 * Günde bir kez, gece çalışan işler. Google'ı sadece okuyan boş OU/grup taraması da burada: silmek yine
 * yöneticinin kararıdır. Tarama başarısız olursa diğer işler etkilenmez.
 */
export async function dailyTick(db: DB, opts: { now?: Date; scan?: () => Promise<Omit<CleanupReport, "at">> } = {}): Promise<DailyRun | null> {
  const now = opts.now ?? new Date();
  const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (now.getHours() < DAILY_HOUR || readSetting<string>(db, DAILY_KEY) === today) return null;
  writeSetting(db, DAILY_KEY, today);

  const leavers = autoMarkLeavers(db, now);
  const run: DailyRun = { retention: enqueueRetention(db, dueRetention(db)), leavers, passwords: purgeInitialPasswords(db, now) };
  if (opts.scan) {
    try {
      writeSetting(db, CLEANUP_KEY, { at: now.getTime(), ...(await opts.scan()) });
    } catch (e) {
      console.error(`Temizlik taraması: ${(e as Error).message}`);
    }
  }
  return run;
}

export function listConfirmedMail(result: { created: number; updated: number; year?: string }, leavers: LeaverRun) {
  return {
    subject: `[NAAL Panel] ${result.year ?? "Yeni"} listesi işlendi`,
    text: [
      `${result.created} yeni öğrenci, ${result.updated} güncelleme.`,
      `${leavers.marked} öğrenci ayrılan olarak işaretlendi${leavers.held ? `, ${leavers.held} öğrenci onay bekliyor` : ""}.`,
      "",
      "Yeni hesapların şifre listeleri, hesaplar Google'da açılınca panelin Sınıflar sayfasında hazır olur.",
    ].join("\n"),
  };
}
