// Sürekli çalışan işçi (pm2: naal-worker). Dakikada bir kuyruğa bakar, yönetim paneliyle eşitlenir, sistem
// sağlığını kontrol eder ve gece işlerini çalıştırır.
//
// .env'de SYNC_AUTO=1 yoksa Google'a hiçbir şey göndermez ve gece işleri çalışmaz; canlılık sinyali, uyarılar ve
// (Supabase ayarlıysa) panel köprüsü çalışır.
// Silme işleri ve sınırları aşan iş yığınları her durumda yönetici onayı bekler (lib/sync/auto.ts).

import { loadEnv } from "./env.ts";
import { healthChecks, markWeeklySent, notifyProblems, weeklyDue, weeklySummary } from "../lib/alerts.ts";
import { scanCleanup } from "../lib/cleanup.ts";
import { migrate, openDb } from "../lib/db.ts";
import { isGoogleConfigured } from "../lib/google/api.ts";
import { personalMailerFromEnv, sendMail } from "../lib/mailer.ts";
import { panelApiFromEnv } from "../lib/panel/api.ts";
import { syncPanel } from "../lib/panel/sync.ts";
import { autoTick } from "../lib/sync/auto.ts";
import { liveGoogle } from "../lib/sync/google.ts";
import { dailyTick } from "../lib/year-cycle.ts";

loadEnv();

const TICK_MS = 60_000;
const ALERT_EVERY_TICKS = 5;

const live = process.env.SYNC_AUTO === "1";
if (live && !isGoogleConfigured()) throw new Error("SYNC_AUTO=1 ama Google ayarları eksik (.env).");

const db = openDb();
migrate(db);
const panel = panelApiFromEnv();
const certificateMailer = personalMailerFromEnv();

async function nightlyScan() {
  const { ous, groups } = await scanCleanup(db);
  return { ous: ous.filter((o) => !o.blocked).length, groups: groups.filter((g) => !g.blocked).length };
}

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}

console.log(`Worker başladı (${live ? "otomatik" : "yalnızca izleme"}).`);

async function checkHealth() {
  const checks = healthChecks(db);
  await notifyProblems(db, checks, sendMail);
  if (weeklyDue(db)) {
    await sendMail(weeklySummary(db, checks));
    markWeeklySent(db);
  }
}

for (let tick = 0; !stopping; tick++) {
  try {
    const result = await autoTick(db, liveGoogle, { live });
    if (result.state === "ran") {
      const { done, failed, retry } = result.report.states;
      console.log(`Kuyruk: ${done} tamam, ${failed} başarısız, ${retry} tekrar denenecek.`);
    }
    if (panel) await syncPanel(db, panel, Date.now(), certificateMailer);
    if (live) {
      const nightly = await dailyTick(db, { scan: nightlyScan });
      if (nightly) console.log(`Gece işleri: ${JSON.stringify(nightly)}`);
    }
    if (tick % ALERT_EVERY_TICKS === 0) await checkHealth();
  } catch (e) {
    console.error(`Worker hatası: ${(e as Error).message}`);
  }
  if (!stopping) {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, TICK_MS);
      wake = () => {
        clearTimeout(timer);
        done();
      };
    });
  }
}

db.close();
console.log("Worker durdu.");
