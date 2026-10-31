import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleApiError } from "../lib/google/api.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";
import { autoPause, autoTick, HEARTBEAT_KEY, pauseAuto, planAutoRun, resumeAuto } from "../lib/sync/auto.ts";
import { enqueue, type SyncAction } from "../lib/sync/queue.ts";
import { addStudent, fakeGoogle, futureDate, job, pastDate, testDb } from "./helpers.ts";

const add = (db: ReturnType<typeof testDb>, action: SyncAction, n = 1) => {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(enqueue(db, action, "student", addStudent(db), { email: `u${i}@x.tr` }));
  return ids;
};

test("silme işleri plana hiç girmez", () => {
  const db = testDb();
  add(db, "DELETE_USER", 2);
  add(db, "DELETE_GROUP");
  add(db, "DELETE_ORG_UNIT");
  const plan = planAutoRun(db);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.held.destructive, 4);
});

test("az sayıda askıya alma otomatik, çoğu onay bekler", () => {
  const db = testDb();
  writeSetting(db, "sync.autoMaxSuspend", 2);
  add(db, "SUSPEND_USER", 2);
  assert.ok(planAutoRun(db).actions.includes("SUSPEND_USER"));
  add(db, "SUSPEND_USER");
  const plan = planAutoRun(db);
  assert.equal(plan.held.suspend, 3);
  assert.ok(!plan.actions.includes("SUSPEND_USER"));
});

test("beklenmedik büyüklükteki iş yığını hiç çalışmaz", () => {
  const db = testDb();
  writeSetting(db, "sync.autoMaxJobs", 2);
  add(db, "UPDATE_USER", 3);
  add(db, "SUSPEND_USER");
  const plan = planAutoRun(db);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.held.bulk, 3);
  assert.equal(plan.held.suspend, 1);
});

test("bekleme süresi dolmamış iş sayılmaz", () => {
  const db = testDb();
  const [id] = add(db, "DELETE_USER");
  db.prepare("UPDATE sync_jobs SET run_after = ? WHERE id = ?").run(futureDate, id);
  assert.equal(planAutoRun(db).held.destructive, 0);
});

test("otomatik mod kapalıyken Google'a hiçbir şey gitmez", async () => {
  const db = testDb();
  const [id] = add(db, "SUSPEND_USER");
  const google = fakeGoogle();
  assert.deepEqual(await autoTick(db, google, { live: false }), { state: "disabled" });
  assert.equal(google.sent.length, 0);
  assert.equal(job(db, id).status, "QUEUED");
  assert.ok(readSetting<number>(db, HEARTBEAT_KEY));
});

test("güvenli iş çalışır, aynı kuyruktaki süresi dolmuş silme asla çalışmaz", async () => {
  const db = testDb();
  const email = "mezun@ogr.nevzatayazal.k12.tr";
  const leaver = addStudent(db, { email, exitReason: "GRADUATED", deleteAt: pastDate });
  const del = enqueue(db, "DELETE_USER", "student", leaver, { email });
  const [safe] = add(db, "REMOVE_ALIAS");
  const google = fakeGoogle();

  const result = await autoTick(db, google, { live: true });

  assert.equal(result.state, "ran");
  assert.equal(job(db, safe).status, "DONE");
  assert.equal(job(db, del).status, "QUEUED");
  assert.ok(google.sent.every((r) => !r.path.startsWith("users/mezun")));
});

test("yalnızca silme işi varken tüm kuyruk çalıştırılmaz", async () => {
  const db = testDb();
  const email = "mezun@ogr.nevzatayazal.k12.tr";
  const del = enqueue(db, "DELETE_USER", "student", addStudent(db, { email, exitReason: "GRADUATED", deleteAt: pastDate }), { email });
  const google = fakeGoogle();
  assert.deepEqual(await autoTick(db, google, { live: true }), { state: "idle" });
  assert.equal(google.sent.length, 0);
  assert.equal(job(db, del).status, "QUEUED");
});

test("çok hata olunca çalıştırma durur ve otomatik mod kapanır", async () => {
  const db = testDb();
  writeSetting(db, "sync.autoMaxFailures", 3);
  add(db, "UPDATE_USER", 6);
  const google = fakeGoogle({
    onSend: () => {
      throw new GoogleApiError(400, "users", "hata");
    },
  });

  await autoTick(db, google, { live: true });

  assert.equal(google.sent.length, 3);
  assert.match(autoPause(db)?.reason ?? "", /3 iş başarısız/);
  assert.deepEqual(await autoTick(db, google, { live: true }), { state: "paused" });
  assert.equal(google.sent.length, 3);

  resumeAuto(db);
  assert.equal(autoPause(db), null);
});

test("elle durdurma kuyruğu bekletir", async () => {
  const db = testDb();
  add(db, "UPDATE_USER");
  pauseAuto(db, "bakım");
  const google = fakeGoogle();
  assert.deepEqual(await autoTick(db, google, { live: true }), { state: "paused" });
  assert.equal(google.sent.length, 0);
});

test("başka çalıştırma sürerken hata vermeden bekler", async () => {
  const db = testDb();
  add(db, "UPDATE_USER");
  writeSetting(db, "sync.lock", { pid: 1, at: Date.now() });
  assert.deepEqual(await autoTick(db, fakeGoogle(), { live: true }), { state: "locked" });
});
