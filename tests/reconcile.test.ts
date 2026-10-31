import assert from "node:assert/strict";
import { test } from "node:test";
import { compareState, readLocalState, type GoogleState, type LocalState } from "../lib/reconcile.ts";
import { enqueue } from "../lib/sync/queue.ts";
import { addGroup, addStudent, testDb } from "./helpers.ts";

const account = (over: Partial<LocalState["accounts"][number]> = {}): LocalState["accounts"][number] => ({
  key: "student:1",
  email: "a@x.tr",
  googleId: "g1",
  orgUnitPath: "/Ogrenciler/9/9-A",
  suspended: false,
  pending: false,
  ...over,
});

const user = (over: Partial<GoogleState["users"][number]> = {}): GoogleState["users"][number] => ({
  id: "g1",
  primaryEmail: "a@x.tr",
  orgUnitPath: "/Ogrenciler/9/9-A",
  suspended: false,
  ...over,
});

const local = (accounts: LocalState["accounts"], groups: LocalState["groups"] = []): LocalState => ({
  accounts,
  groups,
  known: new Set(accounts.flatMap((a) => [a.email, a.googleId])),
});

test("uyuşan durumda fark yoktur", () => {
  const r = compareState(local([account()], [{ email: "9a@x.tr", googleId: "gg", pending: false }]), {
    users: [user()],
    groups: [{ id: "gg", email: "9a@x.tr" }],
  });
  assert.equal(r.total, 0);
});

test("Google'dan elle silinen hesap ve grup raporlanır", () => {
  const r = compareState(local([account()], [{ email: "9a@x.tr", googleId: "gg", pending: false }]), { users: [], groups: [] });
  assert.equal(r.counts.missing, 1);
  assert.equal(r.counts.groupMissing, 1);
});

test("OU ve askı farkı raporlanır", () => {
  const r = compareState(local([account()]), { users: [user({ orgUnitPath: "/Mezunlar", suspended: true })], groups: [] });
  assert.equal(r.counts.ouMismatch, 1);
  assert.equal(r.counts.suspendMismatch, 1);
});

test("kuyrukta işi olan hesap fark sayılmaz", () => {
  const r = compareState(local([account({ pending: true })]), { users: [user({ orgUnitPath: "/Mezunlar" })], groups: [] });
  assert.equal(r.total, 0);
});

test("yönetilen OU'da kaydı olmayan hesap raporlanır, diğer OU'lar karışmaz", () => {
  const r = compareState(local([]), {
    users: [
      user({ id: "x", primaryEmail: "elle@x.tr", orgUnitPath: "/Ogrenciler/9" }),
      user({ id: "y", primaryEmail: "yonetici@x.tr", orgUnitPath: "/" }),
      user({ id: "z", primaryEmail: "diger@x.tr", orgUnitPath: "/OgrencilerArsiv" }),
    ],
    groups: [],
  });
  assert.deepEqual(r.items.map((i) => i.target), ["elle@x.tr"]);
});

test("rapor en fazla 200 kayıt tutar ama hepsini sayar", () => {
  const users = Array.from({ length: 250 }, (_, i) => user({ id: `u${i}`, primaryEmail: `u${i}@x.tr` }));
  const r = compareState(local([]), { users, groups: [] });
  assert.equal(r.total, 250);
  assert.equal(r.items.length, 200);
});

test("veritabanı durumu silinmiş, açılmamış ve kuyrukta işi olan hesapları ayırır", () => {
  const db = testDb();
  const active = addStudent(db, { email: "aktif@x.tr", googleId: "g-a" });
  addStudent(db, { email: "silinmis@x.tr", googleId: "g-d", status: "DELETED" });
  addStudent(db, { email: "acilmamis@x.tr", googleId: null, status: "PENDING" });
  const queued = addStudent(db, { email: "kuyruk@x.tr", googleId: "g-q" });
  enqueue(db, "UPDATE_USER", "student", queued, { email: "kuyruk@x.tr" });
  addGroup(db, "CLASS", "9a@x.tr");

  const state = readLocalState(db);

  assert.deepEqual(state.accounts.map((a) => [a.email, a.pending]).sort(), [["aktif@x.tr", false], ["kuyruk@x.tr", true]]);
  assert.ok(state.known.has("acilmamis@x.tr"));
  assert.ok(!state.known.has("silinmis@x.tr"));
  assert.ok(active);
  assert.equal(state.groups.length, 0, "Google kimliği olmayan grup karşılaştırılmaz");
});
