// Google senkronizasyon kuyruğunu işler.
//
//   npm run sync                         deneme: Google'ı okur, ne yapılacağını gösterir, hiçbir şey değiştirmez
//   npm run sync -- --offline            deneme, Google'a hiç bağlanmadan (her şey yokmuş gibi)
//   npm run sync -- --yes                gerçekten çalıştırır
//   npm run sync -- --yes --limit 20     sadece ilk 20 iş (önce küçük bir parti denemek için)
//   npm run sync -- --action CREATE_ORG_UNIT,CREATE_GROUP
//   npm run sync -- --batch 3            sadece bir listenin işleri
//   npm run sync -- status               kuyruk durumu
//   npm run sync -- retry [id ...]       başarısız işleri yeniden kuyruğa al
//
// Gerçek çalıştırmada her iş tek tek yapılır ve sonucu kuyruğa yazılır; yarıda kesilirse
// tekrar çalıştırmak güvenlidir (zaten yapılmış işler "zaten var" olarak geçer).

import { loadEnv } from "./env.ts";
import { migrate, openDb } from "../lib/db.ts";
import { isGoogleConfigured } from "../lib/google/api.ts";
import { outcomeLabel } from "../lib/labels.ts";
import { DryRunGoogle, liveGoogle } from "../lib/sync/google.ts";
import { LockedError, queueCounts, retryFailed, runQueue, type RunReport } from "../lib/sync/worker.ts";

loadEnv();

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (["--limit", "--action", "--batch"].includes(a)) flags.set(a, argv[++i] ?? "");
  else if (a.startsWith("--")) flags.set(a, true);
  else positional.push(a);
}
const [command] = positional;

const db = openDb();
migrate(db);

function printReport(r: RunReport) {
  const verb = (action: string, o: string) => outcomeLabel(action, o, r.dryRun);
  console.log(`\n${r.total} iş ${r.dryRun ? "incelendi (DENEME, hiçbir şey değişmedi)" : "işlendi"}`);
  for (const [key, n] of Object.entries(r.outcomes).sort()) {
    const [action, outcome] = key.split(":");
    console.log(`  ${action.padEnd(16)} ${String(n).padStart(5)}  ${verb(action, outcome)}`);
  }
  const s = r.states;
  console.log(`  başarılı ${s.done} · başarısız ${s.failed} · tekrar denenecek ${s.retry} · bekleyen bağımlılık ${s.deferred}`);
  if (r.failures.length) {
    console.log(`\n${r.dryRun ? "Başarısız olacak" : "Başarısız"} işler (ilk 20):`);
    for (const f of r.failures.slice(0, 20)) console.log(`  #${f.id} ${f.action} ${f.entity}: ${f.error}`);
  }
}

try {
  if (command === "status") {
    const rows = queueCounts(db);
    if (!rows.length) console.log("Kuyruk boş.");
    for (const r of rows) console.log(`${r.action.padEnd(16)} ${r.status.padEnd(9)} ${r.n}`);
  } else if (command === "retry") {
    const ids = positional.slice(1).map(Number).filter(Number.isInteger);
    console.log(`${retryFailed(db, ids)} iş yeniden kuyruğa alındı.`);
  } else if (command) {
    console.error(`Bilinmeyen komut: ${command}`);
    process.exitCode = 1;
  } else {
    const live = flags.has("--yes");
    const offline = flags.has("--offline");
    if (live && offline) throw new Error("--yes ile --offline birlikte kullanılamaz.");
    if (!offline && !isGoogleConfigured()) throw new Error("Google ayarları eksik (.env). Bağlanmadan denemek için --offline.");

    const google = live ? liveGoogle : offline ? DryRunGoogle.offline() : await DryRunGoogle.snapshot();
    const limit = flags.has("--limit") ? Number(flags.get("--limit")) : undefined;
    const actions = typeof flags.get("--action") === "string" ? String(flags.get("--action")).split(",") : undefined;
    const batchId = flags.has("--batch") ? Number(flags.get("--batch")) : undefined;

    let n = 0;
    const report = await runQueue(db, {
      google,
      limit,
      actions,
      batchId,
      onJob: (job, res) => {
        n++;
        if (live && (res.state !== "done" || n % 50 === 0)) {
          console.log(`#${job.id} ${job.action} ${res.state}${res.error ? `: ${res.error}` : ""}`);
        }
      },
    });
    if (google instanceof DryRunGoogle && google.requests.length) {
      console.log("Örnek istekler (şifreler gizli):");
      for (const req of google.requests.slice(0, 8)) console.log(`  ${req.method} ${req.path} ${JSON.stringify(req.body ?? {})}`);
    }
    printReport(report);
    if (!live && report.total) console.log("\nGerçekten çalıştırmak için: npm run sync -- --yes  (önce --limit ile küçük bir parti önerilir)");
  }
} catch (e) {
  console.error(e instanceof LockedError ? e.message : `Hata: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
