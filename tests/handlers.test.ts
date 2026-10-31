// Geri alınamaz işlerin güvenlik kontrolleri: yanlış hesap ya da grup hiçbir koşulda silinmemeli.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { GoogleApiError } from "../lib/google/api.ts";
import { encryptSecret } from "../lib/secret-box.ts";
import { enqueue } from "../lib/sync/queue.ts";
import { DELETABLE_OU, groupDeletable, ouInUse } from "../lib/sync/handlers.ts";
import { runQueue } from "../lib/sync/worker.ts";
import { addAdmin, addClass, addClub, addGroup, addStudent, fakeGoogle, futureDate, job, pastDate, testDb, yearId } from "./helpers.ts";

const email = "mezun@ogr.nevzatayazal.k12.tr";
const leaver = { email, exitReason: "GRADUATED", suspendAt: pastDate, deleteAt: pastDate, status: "SUSPENDED", password: "sifreli" };

async function deleteUser(db: ReturnType<typeof testDb>, id: number, target = email) {
  const jobId = enqueue(db, "DELETE_USER", "student", id, { email: target });
  const google = fakeGoogle();
  await runQueue(db, { google });
  return { google, job: job(db, jobId) };
}

test("süresi dolmuş mezun silinir, ilk şifresi temizlenir", async () => {
  const db = testDb();
  const id = addStudent(db, leaver);
  const { google, job: j } = await deleteUser(db, id);
  assert.equal(j.status, "DONE");
  assert.equal(google.sent[0].method, "DELETE");
  const row = db.prepare("SELECT status, initial_password_enc FROM students WHERE id = ?").get(id);
  assert.deepEqual({ ...(row as object) }, { status: "DELETED", initial_password_enc: null });
});

test("Google'da zaten yoksa kayıt yine silinmiş sayılır", async () => {
  const db = testDb();
  const id = addStudent(db, leaver);
  enqueue(db, "DELETE_USER", "student", id, { email });
  const google = fakeGoogle({
    onSend: () => {
      throw new GoogleApiError(404, "users", "yok");
    },
  });
  await runQueue(db, { google });
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "DELETED");
});

const refused: [string, object, string?][] = [
  ["okuldaki öğrenci", { email, status: "ACTIVE" }],
  ["silme tarihi gelmemiş mezun", { ...leaver, deleteAt: futureDate }],
  ["başka adres için açılmış iş", leaver, "baska@ogr.nevzatayazal.k12.tr"],
  ["öğrenci alan adı dışındaki hesap", { ...leaver, email: "ogretmen@nevzatayazal.k12.tr" }, "ogretmen@nevzatayazal.k12.tr"],
];

for (const [name, over, target] of refused) {
  test(`silinmez: ${name}`, async () => {
    const db = testDb();
    const id = addStudent(db, over);
    const { google, job: j } = await deleteUser(db, id, target);
    assert.equal(j.status, "FAILED");
    assert.equal(google.sent.length, 0);
    assert.notEqual(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "DELETED");
  });
}

test("silinmez: panel yöneticisinin hesabı", async () => {
  const db = testDb();
  addAdmin(db, email);
  const { google, job: j } = await deleteUser(db, addStudent(db, leaver));
  assert.equal(j.status, "FAILED");
  assert.equal(google.sent.length, 0);
});

test("silinmez: Google işlerini yapan yönetici hesabı", async (t) => {
  process.env.GOOGLE_ADMIN_IMPERSONATE = email;
  t.after(() => delete process.env.GOOGLE_ADMIN_IMPERSONATE);
  const db = testDb();
  const { google, job: j } = await deleteUser(db, addStudent(db, leaver));
  assert.equal(j.status, "FAILED");
  assert.equal(google.sent.length, 0);
});

test("yalnızca şube OU'ları silinebilir", () => {
  assert.ok(DELETABLE_OU.test("/Ogrenciler/9/9-A"));
  for (const ou of ["/Ogrenciler", "/Ogrenciler/9", "/Mezunlar", "/Kulupler", "/Ogrenciler/9/9-A/alt"]) {
    assert.equal(DELETABLE_OU.test(ou), false, ou);
  }
});

test("üst OU silme işi Google'a gitmez", async () => {
  const db = testDb();
  const path = "/Ogrenciler/9";
  const jobId = enqueue(db, "DELETE_ORG_UNIT", "org_unit", path, { path });
  const google = fakeGoogle();
  await runQueue(db, { google });
  assert.equal(job(db, jobId).status, "FAILED");
  assert.equal(google.sent.length, 0);
});

test("kullanılan OU korunur", () => {
  const db = testDb();
  addStudent(db, { orgUnitPath: "/Ogrenciler/10/10-B" });
  addClass(db, yearId(db, "2026-2027"), 9, "A");
  assert.equal(ouInUse(db, "/Ogrenciler/10/10-B"), true);
  assert.equal(ouInUse(db, "/Ogrenciler/9/9-A"), true);
  assert.equal(ouInUse(db, "/Ogrenciler/11/11-C"), false);
});

test("Google'da kullanıcısı olan OU silinmez", async () => {
  const db = testDb();
  const path = "/Ogrenciler/9/9-Z";
  const jobId = enqueue(db, "DELETE_ORG_UNIT", "org_unit", path, { path });
  const google = fakeGoogle({ onGet: (p) => (p.startsWith("users?") ? { users: [{}] } : {}) });
  await runQueue(db, { google });
  assert.equal(job(db, jobId).status, "FAILED");
  assert.equal(google.sent.length, 0);
});

test("açık kulübün grubu silinmez", () => {
  const db = testDb();
  assert.equal(groupDeletable(db, addClub(db, "acik").groupId), "Kulüp hâlâ açık.");
  assert.equal(groupDeletable(db, addClub(db, "kapali", 0).groupId), null);
});

test("kullanılan ya da üyesi olan sınıf grubu silinmez", () => {
  const db = testDb();
  const used = addGroup(db, "CLASS", "9a@ogr.nevzatayazal.k12.tr");
  addClass(db, yearId(db, "2026-2027"), 9, "A", used);
  assert.notEqual(groupDeletable(db, used), null);

  const withMember = addGroup(db, "CLASS", "9b@ogr.nevzatayazal.k12.tr");
  db.prepare("INSERT INTO group_members (group_id, member_email) VALUES (?, 'a@x.tr')").run(withMember);
  assert.notEqual(groupDeletable(db, withMember), null);

  assert.equal(groupDeletable(db, addGroup(db, "CLASS", "9c@ogr.nevzatayazal.k12.tr")), null);
});

test("açık kulüp grubunu silme işi reddedilir", async () => {
  const db = testDb();
  const { groupId } = addClub(db, "robotik");
  const jobId = enqueue(db, "DELETE_GROUP", "group", groupId, { email: "robotik@naal.org.tr" });
  const google = fakeGoogle();
  await runQueue(db, { google });
  assert.equal(job(db, jobId).status, "FAILED");
  assert.equal(google.sent.length, 0);
});

function conflictingCreate(t: { after(fn: () => void): void }, owner: object) {
  process.env.PASSWORD_ENC_KEY = randomBytes(32).toString("base64");
  t.after(() => delete process.env.PASSWORD_ENC_KEY);
  const db = testDb();
  const newEmail = "ayse.kaya@ogr.nevzatayazal.k12.tr";
  const id = addStudent(db, { email: newEmail, firstName: "Ayşe", lastName: "Kaya", googleId: null, status: "PENDING", password: encryptSecret("gizli") });
  const jobId = enqueue(db, "CREATE_USER", "student", id, { email: newEmail, firstName: "Ayşe", lastName: "Kaya", orgUnitPath: "/Ogrenciler" });
  const google = fakeGoogle({
    onSend: () => {
      throw new GoogleApiError(409, "users", "var");
    },
    onGet: () => ({ id: "g-1", primaryEmail: newEmail, ...owner }),
  });
  return { db, id, jobId, google };
}

test("yarım kalan hesap açma aynı kişiye aitse tamamlanır", async (t) => {
  const { db, id, jobId, google } = conflictingCreate(t, { name: { givenName: "Ayşe", familyName: "Kaya" } });
  await runQueue(db, { google });
  assert.equal(job(db, jobId).status, "DONE");
  assert.equal(db.prepare("SELECT google_user_id FROM students WHERE id = ?").pluck().get(id), "g-1");
});

test("adres başkasına aitse hesap ele geçirilmez", async (t) => {
  const { db, id, jobId, google } = conflictingCreate(t, { name: { givenName: "Başka", familyName: "Kişi" } });
  await runQueue(db, { google });
  assert.equal(job(db, jobId).status, "FAILED");
  assert.equal(db.prepare("SELECT status FROM students WHERE id = ?").pluck().get(id), "ERROR");
});
