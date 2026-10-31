import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { healthChecks, markWeeklySent, notifyProblems, overallLevel, weeklyDue, weeklySummary, type Check } from "../lib/alerts.ts";
import type { Mail } from "../lib/mailer.ts";
import { writeSetting } from "../lib/settings.ts";
import { HEARTBEAT_KEY, pauseAuto } from "../lib/sync/auto.ts";
import { enqueue } from "../lib/sync/queue.ts";
import { RECONCILE_KEY } from "../lib/reconcile.ts";
import { schoolYearFor, yearName } from "../lib/years.ts";
import { addClass, addStudent, enroll, testDb, yearId } from "./helpers.ts";

const HOUR = 3_600_000;

function backupDir(t: { after(fn: () => void): void }, ageHours = 1) {
  const dir = mkdtempSync(join(tmpdir(), "naal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "app-20261031-0230.db");
  writeFileSync(file, "");
  const when = new Date(Date.now() - ageHours * HOUR);
  utimesSync(file, when, when);
  return dir;
}

const level = (checks: Check[], key: string) => checks.find((c) => c.key === key)?.level;

test("her şey yolundaysa sağlık iyi görünür", (t) => {
  const db = testDb();
  writeSetting(db, HEARTBEAT_KEY, Date.now());
  const year = yearId(db, yearName(schoolYearFor(new Date())));
  const classId = addClass(db, year, 9, "A");
  enroll(db, addStudent(db, { classId }), year, classId);
  const checks = healthChecks(db, Date.now(), backupDir(t));
  assert.equal(overallLevel(checks), "ok");
});

test("worker sinyali kesilirse sorun sayılır", (t) => {
  const db = testDb();
  const dir = backupDir(t);
  assert.equal(level(healthChecks(db, Date.now(), dir), "worker"), "warn", "hiç çalışmadı");
  writeSetting(db, HEARTBEAT_KEY, Date.now() - HOUR);
  assert.equal(level(healthChecks(db, Date.now(), dir), "worker"), "fail");
});

test("eski ya da eksik yedek sorun sayılır", (t) => {
  const db = testDb();
  assert.equal(level(healthChecks(db, Date.now(), backupDir(t, 30)), "backup"), "fail");
  assert.equal(level(healthChecks(db, Date.now(), join(tmpdir(), "naal-yok")), "backup"), "fail");
});

test("durdurulmuş otomatik mod ve onay bekleyen silme bildirilir", (t) => {
  const db = testDb();
  pauseAuto(db, "test");
  enqueue(db, "DELETE_USER", "student", 1, { email: "a" });
  const checks = healthChecks(db, Date.now(), backupDir(t));
  assert.equal(level(checks, "paused"), "fail");
  assert.equal(level(checks, "held"), "warn");
  assert.match(checks.find((c) => c.key === "held")?.message ?? "", /1 silme/);
});

test("uzun süre bekleyen iş uyarı verir", (t) => {
  const db = testDb();
  const id = enqueue(db, "UPDATE_USER", "student", 1, { email: "a" });
  db.prepare("UPDATE sync_jobs SET run_after = '2020-01-01 00:00:00' WHERE id = ?").run(id);
  assert.equal(level(healthChecks(db, Date.now(), backupDir(t)), "queue"), "warn");
});

test("gece kontrolündeki fark ve eskimiş rapor uyarı verir", (t) => {
  const db = testDb();
  const dir = backupDir(t);
  writeSetting(db, RECONCILE_KEY, { at: Date.now() - 30 * HOUR, total: 2, counts: {}, items: [] });
  const checks = healthChecks(db, Date.now(), dir);
  assert.equal(level(checks, "reconcile"), "warn");
  assert.equal(level(checks, "reconcileAge"), "warn");
});

test("aynı sorun günde bir kez bildirilir, düzelince sıfırlanır", async () => {
  const db = testDb();
  const mails: Mail[] = [];
  const send = async (m: Mail) => void mails.push(m);
  const problem: Check[] = [{ key: "failed", level: "warn", message: "3 başarısız iş var." }];
  const now = Date.now();

  assert.equal(await notifyProblems(db, problem, send, now), 1);
  assert.equal(await notifyProblems(db, problem, send, now + HOUR), 0);
  assert.equal(await notifyProblems(db, problem, send, now + 25 * HOUR), 1);
  assert.equal(await notifyProblems(db, [], send, now + 26 * HOUR), 0);
  assert.equal(await notifyProblems(db, problem, send, now + 27 * HOUR), 1);
  assert.equal(mails.length, 3);
});

test("e-posta gönderilemezse sorun bir sonraki kontrolde yeniden denenir", async () => {
  const db = testDb();
  const problem: Check[] = [{ key: "failed", level: "warn", message: "x" }];
  await assert.rejects(notifyProblems(db, problem, async () => { throw new Error("yok"); }));
  assert.equal(await notifyProblems(db, problem, async () => {}), 1);
});

test("haftalık özet Pazartesi sabahı bir kez gider", () => {
  const db = testDb();
  const monday = new Date(2026, 10, 2, 9);
  assert.equal(weeklyDue(db, new Date(2026, 10, 2, 7)), false);
  assert.equal(weeklyDue(db, new Date(2026, 10, 3, 9)), false);
  assert.equal(weeklyDue(db, monday), true);
  markWeeklySent(db, monday);
  assert.equal(weeklyDue(db, new Date(2026, 10, 2, 10)), false);
  assert.equal(weeklyDue(db, new Date(2026, 10, 9, 9)), true);
});

test("e-postaya kişisel veri yazılmaz", (t) => {
  const db = testDb();
  const email = "ayse.yilmaz@ogr.nevzatayazal.k12.tr";
  const id = enqueue(db, "SUSPEND_USER", "student", 1, { email });
  db.prepare("UPDATE sync_jobs SET status = 'FAILED', last_error = ? WHERE id = ?").run(`${email} bulunamadı`, id);
  const mail = weeklySummary(db, healthChecks(db, Date.now(), backupDir(t)));
  assert.ok(!`${mail.subject}${mail.text}`.includes("ayse"));
  assert.match(mail.text, /1 iş başarısız/);
});
