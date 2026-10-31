import assert from "node:assert/strict";
import { test } from "node:test";
import { healthChecks } from "../lib/alerts.ts";
import type { DB } from "../lib/db.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";
import { planAutoRun } from "../lib/sync/auto.ts";
import { enqueue } from "../lib/sync/queue.ts";
import {
  autoConfirmProblems,
  autoMarkLeavers,
  CLEANUP_KEY,
  dailyTick,
  listConfirmedMail,
  overdueList,
  purgeInitialPasswords,
} from "../lib/year-cycle.ts";
import { setCurrentYear } from "../lib/years.ts";
import { addClass, addStudent, enroll, pastDate, testDb, yearId } from "./helpers.ts";

function listFor(db: DB, name: string, grades: number[]) {
  const year = yearId(db, name);
  const classes = grades.map((g) => addClass(db, year, g, "A"));
  for (const c of classes) enroll(db, addStudent(db, { classId: c }), year, c);
  return { year, classes };
}

function batch(db: DB, rows: { status: string; kind: string }[], summary: object = {}) {
  const id = Number(
    db
      .prepare("INSERT INTO import_batches (file_name, kind, status, summary) VALUES ('a.pdf', 'students', 'PARSED', ?)")
      .run(JSON.stringify({ year: { source: "report" }, google: { checked: true }, issues: [], sections: [], ...summary })).lastInsertRowid,
  );
  rows.forEach((r, i) =>
    db
      .prepare("INSERT INTO import_rows (batch_id, row_number, raw, parsed, status) VALUES (?, ?, '{}', ?, ?)")
      .run(id, i + 1, JSON.stringify({ match: { kind: r.kind } }), r.status),
  );
  return id;
}

const matched = (n: number) => Array.from({ length: n }, () => ({ status: "VALID", kind: "matched" }));
const fresh = (n: number) => Array.from({ length: n }, () => ({ status: "VALID", kind: "new" }));

test("hatırlatma: 15 Eylülden önce susar, sonra listeyi ister, liste gelince biter", () => {
  const db = testDb();
  listFor(db, "2026-2027", [9]);
  assert.equal(overdueList(db, new Date(2027, 8, 14)), null);
  assert.equal(overdueList(db, new Date(2027, 8, 15)), "2027-2028");
  assert.equal(overdueList(db, new Date(2028, 0, 10)), "2027-2028");
  listFor(db, "2027-2028", [10]);
  assert.equal(overdueList(db, new Date(2027, 9, 1)), null);
});

test("hatırlatma: sağlık kontrolünde görünür", () => {
  const db = testDb();
  listFor(db, "2026-2027", [9]);
  assert.equal(healthChecks(db, new Date(2027, 9, 1).getTime()).find((c) => c.key === "yearList")?.level, "warn");
  assert.equal(healthChecks(db, new Date(2027, 0, 1).getTime()).find((c) => c.key === "yearList")?.level, "ok");
});

test("otomatik onay: temiz liste geçer", () => {
  const db = testDb();
  listFor(db, "2026-2027", [9]);
  assert.deepEqual(autoConfirmProblems(db, batch(db, [...matched(8), ...fresh(2)])), []);
});

test("otomatik onay: ilk liste, elle yıl, Google kontrolsüz, okuma uyarısı, hatalı satır bekletilir", () => {
  const empty = testDb();
  assert.match(autoConfirmProblems(empty, batch(empty, matched(5)))[0], /ilk liste/);

  const db = testDb();
  listFor(db, "2026-2027", [9]);
  assert.match(autoConfirmProblems(db, batch(db, matched(5), { year: { source: "manual" } }))[0], /elle seçildi/);
  assert.match(autoConfirmProblems(db, batch(db, matched(5), { google: { checked: false } }))[0], /Google/);
  assert.match(autoConfirmProblems(db, batch(db, matched(5), { issues: [{ level: "warning", message: "x" }] }))[0], /uyarı/);
  assert.match(autoConfirmProblems(db, batch(db, [...matched(5), { status: "INVALID", kind: "conflict" }]))[0], /1 satır/);
});

test("otomatik onay: yeni öğrenci oranı yüksekse yanlış liste sayılır", () => {
  const db = testDb();
  listFor(db, "2026-2027", [9]);
  assert.match(autoConfirmProblems(db, batch(db, [...matched(5), ...fresh(5)]))[0], /%50/);
});

test("otomatik onay: ayarla kapatılır, onaylanmış liste atlanır", () => {
  const db = testDb();
  listFor(db, "2026-2027", [9]);
  const id = batch(db, matched(5));
  db.prepare("UPDATE import_batches SET status = 'CONFIRMED' WHERE id = ?").run(id);
  assert.equal(autoConfirmProblems(db, id).length, 1);
  writeSetting(db, "import.autoConfirm", 0);
  assert.match(autoConfirmProblems(db, batch(db, matched(5)))[0], /kapalı/);
});

function newYear(db: DB, opts: { grades: number[]; graduates?: number; transfers?: number }) {
  const y1 = yearId(db, "2025-2026");
  const twelve = addClass(db, y1, 12, "A");
  const ten = addClass(db, y1, 10, "A");
  const add = (classId: number) => {
    const s = addStudent(db, { classId });
    enroll(db, s, y1, classId);
    return s;
  };
  const graduates = Array.from({ length: opts.graduates ?? 0 }, () => add(twelve));
  const transfers = Array.from({ length: opts.transfers ?? 0 }, () => add(ten));
  const { year } = listFor(db, "2026-2027", opts.grades);
  setCurrentYear(db, year);
  return { graduates, transfers };
}

const exit = (db: DB, id: number) => db.prepare("SELECT exit_reason FROM students WHERE id = ?").pluck().get(id);

test("ayrılanlar: mezun ve nakil işaretlenir, işlem kaydı sistem adına yazılır", () => {
  const db = testDb();
  const { graduates, transfers } = newYear(db, { grades: [9, 10, 11, 12], graduates: 2, transfers: 1 });
  assert.deepEqual(autoMarkLeavers(db), { marked: 3, held: 0 });
  assert.equal(exit(db, graduates[0]), "GRADUATED");
  assert.equal(exit(db, transfers[0]), "TRANSFERRED");
  assert.equal(db.prepare("SELECT user_id FROM audit_logs WHERE action = 'student.leave'").pluck().get(), null);
});

test("ayrılanlar: listede 12. sınıf yoksa liste eksik sayılır, kimse işaretlenmez", () => {
  const db = testDb();
  const { graduates } = newYear(db, { grades: [9, 11], graduates: 2, transfers: 1 });
  assert.deepEqual(autoMarkLeavers(db), { marked: 0, held: 3 });
  assert.equal(exit(db, graduates[0]), null);
});

test("ayrılanlar: nakil sınırı aşılırsa mezunlar işaretlenir, nakiller onay bekler", () => {
  const db = testDb();
  writeSetting(db, "leavers.autoMaxTransfer", 1);
  const { graduates, transfers } = newYear(db, { grades: [9, 10, 11, 12], graduates: 1, transfers: 2 });
  assert.deepEqual(autoMarkLeavers(db), { marked: 1, held: 2 });
  assert.equal(exit(db, graduates[0]), "GRADUATED");
  assert.equal(exit(db, transfers[0]), null);
  assert.equal(healthChecks(db).find((c) => c.key === "leavers")?.level, "warn");
});

test("ayrılanlar: ayarla kapatılır", () => {
  const db = testDb();
  writeSetting(db, "leavers.autoMark", 0);
  newYear(db, { grades: [9, 10, 11, 12], graduates: 1 });
  assert.deepEqual(autoMarkLeavers(db), { marked: 0, held: 0 });
});

test("şifre: yazıldığı an tutulur, tekrar yazılınca yenilenir", () => {
  const db = testDb();
  const s = addStudent(db, { password: "enc" });
  const at = () => db.prepare("SELECT password_set_at FROM students WHERE id = ?").pluck().get(s);
  assert.ok(at());
  db.prepare("UPDATE students SET password_set_at = ? WHERE id = ?").run(pastDate, s);
  db.prepare("UPDATE students SET initial_password_enc = 'enc' WHERE id = ?").run(s);
  assert.equal(at(), pastDate);
  db.prepare("UPDATE students SET initial_password_enc = 'yeni' WHERE id = ?").run(s);
  assert.notEqual(at(), pastDate);
});

test("şifre: süresi dolan silinir; yeni, açılmamış ve kuyrukta bekleyen kalır", () => {
  const db = testDb();
  const old = (over: object = {}) => {
    const id = addStudent(db, { password: "enc", ...over });
    db.prepare("UPDATE students SET password_set_at = ? WHERE id = ?").run(pastDate, id);
    return id;
  };
  const expired = old();
  const unopened = old({ googleId: null, status: "PENDING" });
  const resetting = old();
  enqueue(db, "UPDATE_USER", "student", resetting, { email: "a@x.tr", resetPassword: true });
  const moved = old();
  enqueue(db, "UPDATE_USER", "student", moved, { email: "b@x.tr", orgUnitPath: "/x" });
  const recent = addStudent(db, { password: "enc" });

  assert.equal(purgeInitialPasswords(db), 2);
  const has = (id: number) => db.prepare("SELECT initial_password_enc FROM students WHERE id = ?").pluck().get(id) !== null;
  assert.deepEqual([expired, moved].map(has), [false, false]);
  assert.deepEqual([unopened, resetting, recent].map(has), [true, true, true]);
});

test("şifre: öğretmende de silinir", () => {
  const db = testDb();
  const domain = db.prepare("SELECT id FROM domains WHERE kind = 'TEACHER'").pluck().get();
  db.prepare(
    `INSERT INTO teachers (first_name, last_name, domain_id, email, status, google_user_id, initial_password_enc)
     VALUES ('A', 'B', ?, 'a@nevzatayazal.k12.tr', 'ACTIVE', 'g', 'enc')`,
  ).run(domain);
  db.prepare("UPDATE teachers SET password_set_at = ?").run(pastDate);
  assert.equal(purgeInitialPasswords(db), 1);
});

test("gece işi: 03:00'ten önce çalışmaz, günde bir kez çalışır", async () => {
  const db = testDb();
  assert.equal(await dailyTick(db, { now: new Date(2026, 9, 31, 2, 59) }), null);
  assert.ok(await dailyTick(db, { now: new Date(2026, 9, 31, 3, 0) }));
  assert.equal(await dailyTick(db, { now: new Date(2026, 9, 31, 23, 0) }), null);
  assert.ok(await dailyTick(db, { now: new Date(2026, 10, 1, 3, 0) }));
});

test("gece işi: vadesi gelen askıyı kuyruğa alır", async () => {
  const db = testDb();
  addStudent(db, { exitReason: "GRADUATED", suspendAt: pastDate });
  const run = await dailyTick(db, { now: new Date(2026, 9, 31, 3, 0) });
  assert.equal(run?.retention, 1);
  assert.equal(db.prepare("SELECT count(*) FROM sync_jobs WHERE action = 'SUSPEND_USER'").pluck().get(), 1);
});

test("gece işi: tarama sonucu saklanır, tarama hatası diğer işleri bozmaz", async () => {
  const db = testDb();
  await dailyTick(db, { now: new Date(2026, 9, 31, 3, 0), scan: async () => ({ ous: 2, groups: 1 }) });
  assert.equal(readSetting<{ ous: number }>(db, CLEANUP_KEY)?.ous, 2);
  assert.equal(healthChecks(db).find((c) => c.key === "cleanup")?.level, "warn");
  const run = await dailyTick(db, {
    now: new Date(2026, 10, 1, 3, 0),
    scan: async () => {
      throw new Error("Google kapalı");
    },
  });
  assert.ok(run);
});

test("kuyruk: onaylanmış listenin işleri sınıra sayılmaz, listeden gelmeyen yığın bekler", () => {
  const db = testDb();
  writeSetting(db, "sync.autoMaxJobs", 2);
  const id = batch(db, []);
  for (let i = 0; i < 5; i++) enqueue(db, "ADD_MEMBER", "group", 1, { i }, id);
  assert.equal(planAutoRun(db).held.bulk, 0);
  assert.equal(planAutoRun(db).ready, 5);
  for (let i = 0; i < 3; i++) enqueue(db, "ADD_MEMBER", "group", 1, { i });
  assert.equal(planAutoRun(db).held.bulk, 8);
});

test("liste e-postası kişisel veri içermez", () => {
  const mail = listConfirmedMail({ created: 3, updated: 5, year: "2027-2028" }, { marked: 2, held: 1 });
  assert.match(mail.subject, /2027-2028/);
  assert.match(mail.text, /3 yeni öğrenci, 5 güncelleme/);
  assert.match(mail.text, /1 öğrenci onay bekliyor/);
});
