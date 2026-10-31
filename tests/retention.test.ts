import assert from "node:assert/strict";
import { test } from "node:test";
import { dueRetention, enqueueRetention, upcomingRetention } from "../lib/retention.ts";
import { enqueue } from "../lib/sync/queue.ts";
import { addStudent, futureDate, pastDate, testDb } from "./helpers.ts";

const leaver = { exitReason: "GRADUATED", suspendAt: pastDate, deleteAt: futureDate };

test("vadesi gelen hesap askıya alınır, gelmeyen beklenir", () => {
  const db = testDb();
  const due = addStudent(db, leaver);
  addStudent(db, { ...leaver, suspendAt: futureDate });
  addStudent(db, { suspendAt: pastDate }); // okulda: exit_reason yok
  addStudent(db, { ...leaver, googleId: null }); // Google hesabı hiç açılmamış
  const plan = dueRetention(db);
  assert.deepEqual(plan.suspend.map((s) => s.id), [due]);
  assert.equal(plan.remove.length, 0);
});

test("silme vadesi gelen ve askıdaki hesap silinir", () => {
  const db = testDb();
  const id = addStudent(db, { ...leaver, deleteAt: pastDate, status: "SUSPENDED" });
  const plan = dueRetention(db);
  assert.equal(plan.suspend.length, 0);
  assert.deepEqual(plan.remove.map((s) => s.id), [id]);
});

test("kuyrukta işi olan hesap tekrar eklenmez", () => {
  const db = testDb();
  addStudent(db, leaver);
  assert.equal(enqueueRetention(db, dueRetention(db)), 1);
  assert.equal(dueRetention(db).suspend.length, 0);
});

for (const status of ["RUNNING", "FAILED"]) {
  test(`${status} durumundaki iş gece işinde yinelenmez`, () => {
    const db = testDb();
    const id = addStudent(db, leaver);
    const jobId = enqueue(db, "SUSPEND_USER", "student", id, { email: "x" });
    db.prepare("UPDATE sync_jobs SET status = ? WHERE id = ?").run(status, jobId);
    assert.equal(dueRetention(db).suspend.length, 0);
  });
}

test("bitmiş ya da iptal edilmiş iş hesabı yeniden aday yapabilir", () => {
  const db = testDb();
  const id = addStudent(db, leaver);
  const jobId = enqueue(db, "SUSPEND_USER", "student", id, { email: "x" });
  db.prepare("UPDATE sync_jobs SET status = 'CANCELLED' WHERE id = ?").run(jobId);
  assert.equal(dueRetention(db).suspend.length, 1);
});

test("yaklaşan vadeler sayılır", () => {
  const db = testDb();
  addStudent(db, { ...leaver, suspendAt: pastDate });
  addStudent(db, { ...leaver, suspendAt: futureDate });
  assert.deepEqual(upcomingRetention(db), { windowDays: 14, suspend: 1, remove: 0 });
});
