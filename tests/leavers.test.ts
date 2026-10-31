import assert from "node:assert/strict";
import { test } from "node:test";
import { assignOfficer } from "../lib/clubs.ts";
import { leaverCandidates, LeaverError, markLeavers, retentionDates, undoLeave } from "../lib/leavers.ts";
import { addAdmin, addClass, addClub, addStudent, enroll, testDb, yearId } from "./helpers.ts";

const DAY = 864e5;
const jobs = (db: ReturnType<typeof testDb>) =>
  (db.prepare("SELECT action FROM sync_jobs WHERE status = 'QUEUED' ORDER BY id").pluck().all() as string[]);

test("askı ve silme tarihleri ayrılış tarihinden hesaplanır", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  const left = new Date("2026-12-01T00:00:00Z");
  const { suspend, remove } = retentionDates(left, { suspend: 90, remove: 365 }, now);
  assert.equal(suspend.getTime(), left.getTime() + 90 * DAY);
  assert.equal(remove.getTime(), left.getTime() + 365 * DAY);
});

test("yıllar sonra işaretlenen için yanlışı fark edecek süre kalır", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  const { suspend, remove } = retentionDates(new Date("2020-06-01T00:00:00Z"), { suspend: 90, remove: 365 }, now);
  assert.equal(suspend.getTime(), now.getTime());
  assert.equal(remove.getTime(), now.getTime() + 90 * DAY);
});

function school() {
  const db = testDb();
  const last = yearId(db, "2025-2026");
  const current = yearId(db, "2026-2027");
  return { db, last, current };
}

test("liste yüklenmeden kimse aday olmaz", () => {
  const { db, last } = school();
  enroll(db, addStudent(db), last, addClass(db, last, 12, "A"));
  const r = leaverCandidates(db);
  assert.equal(r.listLoaded, false);
  assert.equal(r.rows.length, 0);
});

test("12. sınıftan listede olmayan mezun, diğeri nakil önerilir", () => {
  const { db, last, current } = school();
  const senior = addStudent(db);
  enroll(db, senior, last, addClass(db, last, 12, "A"));
  const junior = addStudent(db);
  enroll(db, junior, last, addClass(db, last, 10, "A"));
  enroll(db, addStudent(db), current, addClass(db, current, 11, "A"));

  const rows = leaverCandidates(db).rows;
  assert.deepEqual(
    rows.map((r) => [r.id, r.suggested]).sort(),
    [
      [junior, "TRANSFERRED"],
      [senior, "GRADUATED"],
    ].sort(),
  );
});

test("eksik listede yüklenmemiş sınıflar aday yapılmaz", () => {
  const { db, last, current } = school();
  enroll(db, addStudent(db), last, addClass(db, last, 10, "A"));
  enroll(db, addStudent(db), current, addClass(db, current, 9, "A"));
  const r = leaverCandidates(db);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.held, [{ grade: 11, count: 1 }]);
});

test("ayrılan öğrenci gruplardan çıkar, görevi biter, tarihleri yazılır", () => {
  const { db } = school();
  const userId = addAdmin(db);
  const { clubId } = addClub(db, "robotik");
  const id = addStudent(db, { email: "a@ogr.nevzatayazal.k12.tr", orgUnitPath: "/Ogrenciler/12/12-A" });
  assignOfficer(db, { clubId, studentId: id, title: "PRESIDENT", aliasLocal: "ayse" }, userId, null);
  db.prepare("DELETE FROM sync_jobs").run();

  assert.equal(markLeavers(db, [{ studentId: id, reason: "GRADUATED" }], userId), 1);

  const s = db.prepare("SELECT exit_reason, org_unit_path, suspend_at, delete_at FROM students WHERE id = ?").get(id) as Record<string, string>;
  assert.equal(s.exit_reason, "GRADUATED");
  assert.equal(s.org_unit_path, "/Mezunlar");
  assert.ok(s.suspend_at && s.delete_at);
  assert.equal(db.prepare("SELECT count(*) FROM club_members WHERE student_id = ?").pluck().get(id), 0);
  assert.equal(db.prepare("SELECT count(*) FROM club_officers WHERE student_id = ? AND ended_at IS NULL").pluck().get(id), 0);
  assert.deepEqual(jobs(db), ["REMOVE_ALIAS", "REMOVE_MEMBER", "UPDATE_USER"]);
});

test("Google hesabı açılmamış öğrencinin bekleyen işleri iptal olur", () => {
  const { db } = school();
  const email = "b@ogr.nevzatayazal.k12.tr";
  const id = addStudent(db, { email, googleId: null, status: "PENDING" });
  db.prepare("INSERT INTO sync_jobs (action, entity_type, entity_id, payload) VALUES ('CREATE_USER', 'student', ?, ?)").run(
    String(id),
    JSON.stringify({ email }),
  );
  markLeavers(db, [{ studentId: id, reason: "TRANSFERRED" }], addAdmin(db));
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "ARCHIVED");
  assert.deepEqual(jobs(db), []);
});

test("geçersiz neden reddedilir, ayrılmış öğrenci tekrar işlenmez", () => {
  const { db } = school();
  const userId = addAdmin(db);
  const id = addStudent(db);
  assert.throws(() => markLeavers(db, [{ studentId: id, reason: "X" as "GRADUATED" }], userId), LeaverError);
  assert.equal(markLeavers(db, [{ studentId: id, reason: "GRADUATED" }], userId), 1);
  assert.equal(markLeavers(db, [{ studentId: id, reason: "GRADUATED" }], userId), 0);
});

test("yanlış işaretleme geri alınır ve kuyruktaki askı iptal olur", () => {
  const { db } = school();
  const userId = addAdmin(db);
  const id = addStudent(db);
  markLeavers(db, [{ studentId: id, reason: "TRANSFERRED" }], userId);
  db.prepare("INSERT INTO sync_jobs (action, entity_type, entity_id, payload) VALUES ('SUSPEND_USER', 'student', ?, '{}')").run(String(id));

  undoLeave(db, id, userId);

  const s = db.prepare("SELECT exit_reason, suspend_at, delete_at FROM students WHERE id = ?").get(id);
  assert.deepEqual({ ...(s as object) }, { exit_reason: null, suspend_at: null, delete_at: null });
  assert.ok(!jobs(db).includes("SUSPEND_USER"));
});

test("askıya alınmış hesap geri alınamaz", () => {
  const { db } = school();
  const userId = addAdmin(db);
  const id = addStudent(db, { exitReason: "GRADUATED", status: "SUSPENDED" });
  assert.throws(() => undoLeave(db, id, userId), LeaverError);
});
