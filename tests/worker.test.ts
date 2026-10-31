import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleApiError } from "../lib/google/api.ts";
import { cliLockHeld } from "../lib/sync/runner.ts";
import { enqueue } from "../lib/sync/queue.ts";
import { activeLock, LockedError, MAX_ATTEMPTS, retryFailed, runQueue } from "../lib/sync/worker.ts";
import { addStudent, fakeGoogle, futureDate, job, testDb } from "./helpers.ts";

const fail = (status: number) => () => {
  throw new GoogleApiError(status, "test", "hata");
};

function lockAt(db: ReturnType<typeof testDb>, at: number) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync.lock', ?)").run(JSON.stringify({ pid: 1, at }));
}

test("iş tamamlanır, kayıt güncellenir ve kilit bırakılır", async () => {
  const db = testDb();
  const email = "a@ogr.nevzatayazal.k12.tr";
  const id = addStudent(db, { email });
  const jobId = enqueue(db, "SUSPEND_USER", "student", id, { email });
  const google = fakeGoogle();

  const report = await runQueue(db, { google });

  assert.equal(report.states.done, 1);
  assert.equal(google.sent.length, 1);
  assert.equal(job(db, jobId).status, "DONE");
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "SUSPENDED");
  assert.equal(activeLock(db), null);
});

test("geçici hata beklemeyle yeniden kuyruğa girer", async () => {
  const db = testDb();
  const jobId = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });

  const report = await runQueue(db, { google: fakeGoogle({ onSend: fail(503) }) });

  const j = job(db, jobId);
  assert.equal(report.states.retry, 1);
  assert.equal(j.status, "QUEUED");
  assert.equal(j.attempts, 1);
  assert.ok(new Date(`${j.run_after}Z`).getTime() > Date.now());
});

test("bekleme süresi dolmamış iş çalışmaz", async () => {
  const db = testDb();
  const jobId = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  db.prepare("UPDATE sync_jobs SET run_after = ? WHERE id = ?").run(futureDate, jobId);
  const google = fakeGoogle();
  await runQueue(db, { google });
  assert.equal(google.sent.length, 0);
});

test("deneme hakkı bitince iş başarısız olur", async () => {
  const db = testDb();
  const jobId = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  db.prepare("UPDATE sync_jobs SET attempts = ? WHERE id = ?").run(MAX_ATTEMPTS - 1, jobId);
  await runQueue(db, { google: fakeGoogle({ onSend: fail(503) }) });
  assert.equal(job(db, jobId).status, "FAILED");
});

test("kalıcı hata yeniden denenmez", async () => {
  const db = testDb();
  const jobId = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  await runQueue(db, { google: fakeGoogle({ onSend: fail(400) }) });
  const j = job(db, jobId);
  assert.equal(j.status, "FAILED");
  assert.equal(j.attempts, 1);
});

test("önceki iş başarısızsa bağlı iş de başarısız olur ve Google'a gidilmez", async () => {
  const db = testDb();
  const memberEmail = "a@ogr.nevzatayazal.k12.tr";
  const create = enqueue(db, "CREATE_USER", "student", addStudent(db), { email: memberEmail });
  db.prepare("UPDATE sync_jobs SET status = 'FAILED' WHERE id = ?").run(create);
  const member = enqueue(db, "ADD_MEMBER", "group", 1, { groupEmail: "9a@x.tr", memberEmail });
  const google = fakeGoogle();

  await runQueue(db, { google });

  assert.equal(job(db, member).status, "FAILED");
  assert.equal(google.sent.length, 0);
});

test("önceki iş bitmediyse bağlı iş ertelenir", async () => {
  const db = testDb();
  const memberEmail = "a@ogr.nevzatayazal.k12.tr";
  const create = enqueue(db, "CREATE_USER", "student", addStudent(db), { email: memberEmail });
  db.prepare("UPDATE sync_jobs SET run_after = ? WHERE id = ?").run(futureDate, create);
  const member = enqueue(db, "ADD_MEMBER", "group", 1, { groupEmail: "9a@x.tr", memberEmail });

  const report = await runQueue(db, { google: fakeGoogle() });

  assert.equal(report.states.deferred, 1);
  assert.equal(job(db, member).status, "QUEUED");
});

test("OU silme önündeki bütün işleri bekler", async () => {
  const db = testDb();
  const earlier = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  db.prepare("UPDATE sync_jobs SET run_after = ? WHERE id = ?").run(futureDate, earlier);
  const path = "/Ogrenciler/9/9-Z";
  const del = enqueue(db, "DELETE_ORG_UNIT", "org_unit", path, { path });
  await runQueue(db, { google: fakeGoogle() });
  assert.equal(job(db, del).status, "QUEUED");
});

test("limit verilen sayıda işi çalıştırır", async () => {
  const db = testDb();
  for (let i = 0; i < 3; i++) enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  const report = await runQueue(db, { google: fakeGoogle(), limit: 2 });
  assert.equal(report.total, 2);
});

test("durdurma isteği sıradaki işe geçirmez", async () => {
  const db = testDb();
  for (let i = 0; i < 3; i++) enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  let calls = 0;
  const report = await runQueue(db, { google: fakeGoogle(), shouldStop: () => ++calls > 1 });
  assert.equal(report.total, 1);
});

test("deneme modunda veritabanı değişmez", async () => {
  const db = testDb();
  const id = addStudent(db);
  const jobId = enqueue(db, "SUSPEND_USER", "student", id, { email: "a" });
  await runQueue(db, { google: { ...fakeGoogle(), dryRun: true } });
  assert.equal(job(db, jobId).status, "QUEUED");
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "ACTIVE");
});

test("güncel kilit varken ikinci işçi çalışmaz", async () => {
  const db = testDb();
  lockAt(db, Date.now());
  await assert.rejects(runQueue(db, { google: fakeGoogle() }), LockedError);
  assert.equal(cliLockHeld(db), true);
});

test("çöken süreçten kalan eski kilit paneli ve işçiyi engellemez", async () => {
  const db = testDb();
  lockAt(db, Date.now() - 16 * 60_000);
  assert.equal(cliLockHeld(db), false, "panel eski kilidi tutulmuş saymamalı");
  await runQueue(db, { google: fakeGoogle() });
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'sync.lock'").get(), undefined);
});

test("çökmüş çalıştırmadan RUNNING kalan iş yeniden çalışır", async () => {
  const db = testDb();
  const jobId = enqueue(db, "SUSPEND_USER", "student", addStudent(db), { email: "a" });
  db.prepare("UPDATE sync_jobs SET status = 'RUNNING', updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(jobId);
  await runQueue(db, { google: fakeGoogle() });
  assert.equal(job(db, jobId).status, "DONE");
});

test("başarısız işler yeniden kuyruğa alınır", () => {
  const db = testDb();
  const a = enqueue(db, "SUSPEND_USER", "student", 1, { email: "a" });
  const b = enqueue(db, "SUSPEND_USER", "student", 2, { email: "b" });
  db.prepare("UPDATE sync_jobs SET status = 'FAILED', attempts = 5").run();
  assert.equal(retryFailed(db, [a]), 1);
  assert.equal(job(db, a).status, "QUEUED");
  assert.equal(job(db, a).attempts, 0);
  assert.equal(job(db, b).status, "FAILED");
});
