import assert from "node:assert/strict";
import { test } from "node:test";
import { healthChecks } from "../lib/alerts.ts";
import type { DB } from "../lib/db.ts";
import { MailLimitError, personalMailerFromEnv, type PersonalMail } from "../lib/mailer.ts";
import type { PanelApi, PanelCertificate, PanelCommand, PanelRecipient, RecipientResult } from "../lib/panel/api.ts";
import { createPanelApi } from "../lib/panel/api.ts";
import { issueCertificates } from "../lib/panel/certificates.ts";
import { clubsWithoutLead, desiredRoles, findSchoolPerson, type PanelRole } from "../lib/panel/roles.ts";
import { panelReport, syncPanel } from "../lib/panel/sync.ts";
import { addAdmin, addClub, addStudent, pastDate, testDb } from "./helpers.ts";

const SUPER = "muhammet@naal.org.tr";

function fakeApi(over: Partial<{ roles: PanelRole[]; commands: PanelCommand[]; clubs: string[]; closed: string[]; recipients: PanelRecipient[]; certs: string[]; fail: boolean }> = {}) {
  const state = {
    roles: over.roles ?? [],
    commands: over.commands ?? [],
    clubs: over.clubs ?? [],
    closed: over.closed ?? [],
    recipients: over.recipients ?? [],
    certs: [] as PanelCertificate[],
    results: [] as { id: number; result: RecipientResult }[],
    finished: [] as { id: number; error: string | null }[],
  };
  const api: PanelApi = {
    async listRoles() {
      if (over.fail) throw new Error("HTTP 500");
      return state.roles;
    },
    async saveRoles(rows) {
      state.roles = [...state.roles.filter((r) => !rows.some((n) => n.email === r.email && n.club_code === r.club_code && n.role === r.role)), ...rows];
    },
    async removeRole(row) {
      state.roles = state.roles.filter((r) => r !== row);
    },
    async listClubs() {
      return state.clubs.map((code) => ({ code, is_active: !state.closed.includes(code) }));
    },
    async addClubs(rows) {
      state.clubs.push(...rows.map((r) => r.code));
    },
    async setClubActive(code, active) {
      state.closed = active ? state.closed.filter((c) => c !== code) : [...state.closed, code];
    },
    async pendingCommands() {
      return state.commands;
    },
    async finishCommand(id, error) {
      state.finished.push({ id, error });
    },
    async pendingRecipients() {
      return state.recipients;
    },
    async certificateExists(fileId) {
      return (over.certs ?? []).includes(fileId) || state.certs.some((c) => c.file_id === fileId);
    },
    async addCertificate(row) {
      state.certs.push(row);
    },
    async finishRecipient(id, result) {
      state.results.push({ id, result });
    },
  };
  return { api, state };
}

function addSuper(db: DB, email = SUPER) {
  db.prepare("UPDATE admin_users SET role = 'SUPER_ADMIN' WHERE id = ?").run(addAdmin(db, email));
}

function addOfficer(db: DB, clubId: number, studentId: number, title = "PRESIDENT") {
  const domain = db.prepare("SELECT id FROM domains WHERE kind = 'CLUB'").pluck().get();
  return Number(
    db
      .prepare("INSERT INTO club_officers (club_id, domain_id, student_id, title, alias_email) VALUES (?, ?, ?, ?, ?)")
      .run(clubId, domain, studentId, title, `gorev${studentId}@naal.org.tr`).lastInsertRowid,
  );
}

function addTeacher(db: DB, email: string, leftAt: string | null = null) {
  const domain = db.prepare("SELECT id FROM domains WHERE kind = 'TEACHER'").pluck().get();
  return Number(
    db
      .prepare("INSERT INTO teachers (first_name, last_name, domain_id, email, status, left_at) VALUES ('Ali', 'Veli', ?, ?, 'ACTIVE', ?)")
      .run(domain, email, leftAt).lastInsertRowid,
  );
}

const roleOf = (db: DB, email: string) => desiredRoles(db).filter((r) => r.email === email);

test("rol: başkan ve yardımcısı kulübü yönetir, diğer görevler yönetmez", () => {
  const db = testDb();
  const { clubId } = addClub(db, "tech");
  const president = addStudent(db, { email: "baskan@ogr.nevzatayazal.k12.tr" });
  const vice = addStudent(db, { email: "yardimci@ogr.nevzatayazal.k12.tr" });
  const secretary = addStudent(db, { email: "sekreter@ogr.nevzatayazal.k12.tr" });
  addOfficer(db, clubId, president);
  addOfficer(db, clubId, vice, "VICE_PRESIDENT");
  addOfficer(db, clubId, secretary, "SECRETARY");
  assert.deepEqual(desiredRoles(db).map((r) => r.email).sort(), ["baskan@ogr.nevzatayazal.k12.tr", "yardimci@ogr.nevzatayazal.k12.tr"]);
});

test("rol: görevi biten, askıdaki ya da ayrılan öğrenci ve kapalı kulüp yetki almaz", () => {
  const db = testDb();
  const { clubId } = addClub(db, "tech");
  const closed = addClub(db, "eski", 0).clubId;
  const ended = addOfficer(db, clubId, addStudent(db, { email: "bitti@x.tr" }));
  db.prepare("UPDATE club_officers SET ended_at = datetime('now') WHERE id = ?").run(ended);
  addOfficer(db, clubId, addStudent(db, { email: "askida@x.tr", status: "SUSPENDED" }));
  addOfficer(db, clubId, addStudent(db, { email: "mezun@x.tr", exitReason: "GRADUATED" }));
  addOfficer(db, closed, addStudent(db, { email: "kapali@x.tr" }));
  assert.deepEqual(desiredRoles(db), []);
});

test("rol: danışman öğretmen ayrılınca yetkisi biter", () => {
  const db = testDb();
  const { clubId } = addClub(db, "tech");
  const here = addTeacher(db, "hoca@nevzatayazal.k12.tr");
  const left = addTeacher(db, "giden@nevzatayazal.k12.tr", pastDate);
  db.prepare("INSERT INTO club_advisors (club_id, teacher_id) VALUES (?, ?), (?, ?)").run(clubId, here, clubId, left);
  assert.deepEqual(desiredRoles(db).map((r) => r.email), ["hoca@nevzatayazal.k12.tr"]);
});

test("rol: süper yönetici yalnızca okul alan adından, aktif hesaptan gelir", () => {
  const db = testDb();
  addSuper(db);
  addSuper(db, "dis@gmail.com");
  addSuper(db, "pasif@naal.org.tr");
  db.prepare("UPDATE admin_users SET is_active = 0 WHERE email = 'pasif@naal.org.tr'").run();
  assert.deepEqual(desiredRoles(db).map((r) => r.email), [SUPER]);
});

test("rol: e-posta küçük harfe çevrilir, aynı kişi aynı rolü iki kez almaz", () => {
  const db = testDb();
  const { clubId } = addClub(db, "tech");
  const s = addStudent(db, { email: "Buyuk@ogr.nevzatayazal.k12.tr" });
  addOfficer(db, clubId, s);
  db.prepare("UPDATE club_officers SET alias_email = 'x@naal.org.tr' WHERE student_id = ?").run(s);
  addOfficer(db, clubId, s, "BOARD_MEMBER");
  assert.deepEqual(desiredRoles(db).map((r) => r.email), ["buyuk@ogr.nevzatayazal.k12.tr"]);
});

test("rol: görevlisi kalmayan açık kulüp bildirilir", () => {
  const db = testDb();
  addClub(db, "bos");
  addClub(db, "kapali", 0);
  addOfficer(db, addClub(db, "tech").clubId, addStudent(db));
  assert.deepEqual(clubsWithoutLead(db), ["bos"]);
});

test("kişi: takma adla bulunur, okuldan ayrılan bulunmaz", () => {
  const db = testDb();
  const { clubId } = addClub(db, "tech");
  const s = addStudent(db, { email: "ayse@ogr.nevzatayazal.k12.tr" });
  addOfficer(db, clubId, s);
  addStudent(db, { email: "mezun@ogr.nevzatayazal.k12.tr", exitReason: "GRADUATED" });
  assert.equal(findSchoolPerson(db, ` Gorev${s}@naal.org.tr `)?.email, "ayse@ogr.nevzatayazal.k12.tr");
  assert.equal(findSchoolPerson(db, "mezun@ogr.nevzatayazal.k12.tr"), null);
  assert.equal(findSchoolPerson(db, "yok@gmail.com"), null);
});

test("köprü: eksik rol eklenir, fazla rol silinir, aynı olana dokunulmaz", async () => {
  const db = testDb();
  addSuper(db);
  const { clubId } = addClub(db, "tech");
  addOfficer(db, clubId, addStudent(db, { email: "yeni@x.tr" }));
  const same: PanelRole = { email: SUPER, club_code: "", role: "super", name: "Yönetici" };
  const stale: PanelRole = { email: "eski@x.tr", club_code: "tech", role: "club", name: "Eski" };
  const { api, state } = fakeApi({ roles: [same, stale], clubs: ["tech"] });
  const report = await syncPanel(db, api);
  assert.deepEqual({ added: report.added, removed: report.removed }, { added: 1, removed: 1 });
  assert.deepEqual(state.roles.map((r) => r.email).sort(), [SUPER, "yeni@x.tr"]);
});

test("köprü: ad değişirse güncellenir, ikinci çalıştırma değişiklik yapmaz", async () => {
  const db = testDb();
  addSuper(db);
  const { api, state } = fakeApi({ roles: [{ email: SUPER, club_code: "", role: "super", name: "Eski ad" }] });
  assert.equal((await syncPanel(db, api)).added, 1);
  assert.equal(state.roles[0].name, "Yönetici");
  assert.deepEqual((await syncPanel(db, api)).added, 0);
});

test("köprü: süper yönetici yoksa hiçbir rol silinmez ve sorun bildirilir", async () => {
  const db = testDb();
  const { api, state } = fakeApi({ roles: [{ email: SUPER, club_code: "", role: "super", name: "S" }] });
  const report = await syncPanel(db, api);
  assert.equal(report.held, 1);
  assert.equal(state.roles.length, 1);
  assert.equal(healthChecks(db).find((c) => c.key === "panel")?.level, "fail");
});

test("köprü: Supabase'de olmayan açık kulüp eklenir, kapalı kulüp eklenmez", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "tech");
  addClub(db, "yeni");
  addClub(db, "kapali", 0);
  const { api, state } = fakeApi({ clubs: ["TECH"] });
  await syncPanel(db, api);
  assert.deepEqual(state.clubs, ["TECH", "yeni"]);
});

test("köprü: Yönetici de süper yönetici olur, Görüntüleyici olmaz", async () => {
  const db = testDb();
  addSuper(db);
  addAdmin(db, "yonetici@nevzatayazal.k12.tr");
  db.prepare("UPDATE admin_users SET role = 'VIEWER' WHERE id = ?").run(addAdmin(db, "izleyici@nevzatayazal.k12.tr"));
  const { api, state } = fakeApi({});
  await syncPanel(db, api);
  assert.deepEqual(state.roles.filter((r) => r.role === "super").map((r) => r.email).sort(), ["yonetici@nevzatayazal.k12.tr", SUPER].sort());
});

test("köprü: etkinlik eklenmez, sonradan işaretlenen kulüp gizlenir, işaret kalkınca geri gelir", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "hack");
  addClub(db, "yeni");
  const mark = db.prepare("UPDATE clubs SET is_event = ? WHERE code = ?");
  mark.run(1, "hack");
  const { api, state } = fakeApi({ clubs: [] });
  await syncPanel(db, api);
  assert.deepEqual(state.clubs, ["yeni"]);

  mark.run(1, "yeni");
  await syncPanel(db, api);
  assert.deepEqual(state.closed, ["yeni"]);

  mark.run(0, "yeni");
  await syncPanel(db, api);
  assert.deepEqual(state.closed, []);
});

test("köprü: Supabase hatası işçiyi durdurmaz, sağlıkta görünür", async () => {
  const db = testDb();
  const { api } = fakeApi({ fail: true });
  const report = await syncPanel(db, api);
  assert.equal(report.error, "HTTP 500");
  assert.equal(panelReport(db)?.error, "HTTP 500");
  assert.equal(healthChecks(db).find((c) => c.key === "panel")?.level, "fail");
});

const command = (over: Partial<PanelCommand>): PanelCommand => ({
  id: 1,
  kind: "add_member",
  club_code: "bilim",
  email: "ogrenci@ogr.nevzatayazal.k12.tr",
  requested_by: SUPER,
  ...over,
});

test("istek: kabul edilen öğrenci kulübe üye olur ve grup işi kuyruğa girer", async () => {
  const db = testDb();
  addSuper(db);
  const { clubId } = addClub(db, "bilim");
  const s = addStudent(db, { email: "ogrenci@ogr.nevzatayazal.k12.tr" });
  const { api, state } = fakeApi({ commands: [command({})], clubs: ["bilim"] });
  await syncPanel(db, api);
  assert.deepEqual(state.finished, [{ id: 1, error: null }]);
  assert.ok(db.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND student_id = ?").get(clubId, s));
  assert.equal(db.prepare("SELECT count(*) FROM sync_jobs WHERE action = 'ADD_MEMBER'").pluck().get(), 1);
});

test("istek: aynı üyelik isteği tekrar çalışınca ikinci iş eklenmez", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "bilim");
  addStudent(db, { email: "ogrenci@ogr.nevzatayazal.k12.tr" });
  const { api } = fakeApi({ commands: [command({ id: 1 }), command({ id: 2 })], clubs: ["bilim"] });
  await syncPanel(db, api);
  assert.equal(db.prepare("SELECT count(*) FROM sync_jobs WHERE action = 'ADD_MEMBER'").pluck().get(), 1);
});

test("istek: okulda olmayan adres ve öğretmen üye yapılmaz, neden yazılır", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "bilim");
  addTeacher(db, "hoca@nevzatayazal.k12.tr");
  const { api, state } = fakeApi({
    commands: [command({ id: 1, email: "kisisel@gmail.com" }), command({ id: 2, email: "hoca@nevzatayazal.k12.tr" })],
    clubs: ["bilim"],
  });
  await syncPanel(db, api);
  assert.match(state.finished[0].error!, /okulda kayıtlı/);
  assert.match(state.finished[1].error!, /öğrenci hesabı değil/);
});

test("istek: yetkisini kaybetmiş kişinin isteği reddedilir", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "bilim");
  addStudent(db, { email: "ogrenci@ogr.nevzatayazal.k12.tr" });
  const { api, state } = fakeApi({ commands: [command({ requested_by: "eski@x.tr" })], clubs: ["bilim"] });
  await syncPanel(db, api);
  assert.match(state.finished[0].error!, /yetkisi yok/);
  assert.equal(db.prepare("SELECT count(*) FROM club_members").pluck().get(), 0);
});

test("istek: editör aynı çalıştırmada rol alır, kaldırılınca rolü silinir", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "bilim");
  const email = "ogrenci@ogr.nevzatayazal.k12.tr";
  addStudent(db, { email });
  const grant = fakeApi({ commands: [command({ kind: "grant_editor" })], clubs: ["bilim"] });
  await syncPanel(db, grant.api);
  assert.deepEqual(roleOf(db, email).map((r) => [r.club_code, r.role]), [["bilim", "editor"]]);
  assert.ok(grant.state.roles.some((r) => r.email === email));

  const revoke = fakeApi({ roles: grant.state.roles, commands: [command({ kind: "revoke_editor" })], clubs: ["bilim"] });
  await syncPanel(db, revoke.api);
  assert.ok(!revoke.state.roles.some((r) => r.email === email));
});

test("istek: dergi editörü bilim dışında eklenmez", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "tech");
  addStudent(db, { email: "ogrenci@ogr.nevzatayazal.k12.tr" });
  const { api, state } = fakeApi({ commands: [command({ kind: "grant_editor", club_code: "tech" })], clubs: ["tech"] });
  await syncPanel(db, api);
  assert.match(state.finished[0].error!, /bilim/);
});

test("editör okuldan ayrılınca rolü gider, kayıt kalsa da", () => {
  const db = testDb();
  const { clubId } = addClub(db, "bilim");
  const email = "ogrenci@ogr.nevzatayazal.k12.tr";
  const s = addStudent(db, { email });
  db.prepare("INSERT INTO club_editors (club_id, email) VALUES (?, ?)").run(clubId, email);
  assert.equal(roleOf(db, email).length, 1);
  db.prepare("UPDATE students SET exit_reason = 'GRADUATED' WHERE id = ?").run(s);
  assert.equal(roleOf(db, email).length, 0);
});

test("REST: istekler anahtarla gider, boş kulüp kodlu rol filtrelenir, hata fırlatılır", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("[]", { status });
  }) as unknown as typeof fetch;
  const api = createPanelApi("https://x.supabase.co", "gizli", fetcher);
  await api.removeRole({ email: "a+b@x.tr", club_code: "", role: "super", name: "" });
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/panel_roles?email=eq.a%2Bb%40x.tr&club_code=eq.&role=eq.super");
  assert.equal((calls[0].init.headers as Record<string, string>).apikey, "gizli");
  await api.saveRoles([]);
  assert.equal((calls[1].init.headers as Record<string, string>).Prefer, "resolution=merge-duplicates");
  await api.finishCommand(7, "olmadı");
  assert.deepEqual(
    { ...JSON.parse(calls[2].init.body as string), finished_at: undefined },
    { status: "failed", error: "olmadı", finished_at: undefined },
  );
  status = 500;
  await assert.rejects(api.listRoles(), /HTTP 500/);
});

test("kulüp: dizinde kapanan sitede gizlenir, yeniden açılınca geri gelir", async () => {
  const db = testDb();
  addSuper(db);
  addClub(db, "acik");
  addClub(db, "eski", 0);
  const { api, state } = fakeApi({ clubs: ["acik", "eski", "yalniz-sitede"], closed: ["acik"] });
  await syncPanel(db, api);
  assert.deepEqual(state.closed.sort(), ["eski"]);
  assert.deepEqual(state.clubs, ["acik", "eski", "yalniz-sitede"]);
});

function recipient(over: Partial<PanelRecipient> = {}): PanelRecipient {
  return {
    id: 1,
    email: "ayse@ogr.nevzatayazal.k12.tr",
    file_id: "CERT-1",
    name: "",
    attempts: 0,
    club_code: "tech",
    title: "Robotik Atölyesi",
    event_date: "2026-10-20",
    issuer: "Tech Kulübü",
    requested_by: SUPER,
    ...over,
  };
}

function certSetup() {
  const db = testDb();
  addSuper(db);
  addClub(db, "tech");
  addStudent(db, { email: "ayse@ogr.nevzatayazal.k12.tr" });
  return db;
}

const noMail = async () => {};

test("sertifika: ad dizinden gelir, kulüp kaydına yazılır, e-posta Supabase'den silinir", async () => {
  const db = certSetup();
  const sent: PersonalMail[] = [];
  const { api, state } = fakeApi({ recipients: [recipient({ email: " Ayse@ogr.nevzatayazal.k12.tr " })] });
  const report = await syncPanel(db, api, Date.now(), async (m) => void sent.push(m));

  assert.equal(report.certificates, 1);
  const name = findSchoolPerson(db, "ayse@ogr.nevzatayazal.k12.tr")!.name;
  assert.deepEqual(state.certs, [
    { creator: "Tech Kulübü", head: "Robotik Atölyesi", given: name, date: "2026-10-20", file_id: "CERT-1", uploader_mail: "tech@naal.org.tr" },
  ]);
  assert.equal(sent[0].to, "ayse@ogr.nevzatayazal.k12.tr");
  assert.equal(sent[0].replyTo, "tech@naal.org.tr");
  assert.match(sent[0].text, /https:\/\/naal\.org\.tr\/certificates\/CERT-1/);
  const { status, email, name: saved } = state.results[0].result;
  assert.deepEqual({ status, email, saved }, { status: "sent", email: null, saved: name });
});

test("sertifika: okul dışı kişiye listedeki adla verilir, okuldaki kişinin adı dizinden gelir", async () => {
  const db = certSetup();
  const sent: PersonalMail[] = [];
  const { api, state } = fakeApi({
    recipients: [
      recipient({ id: 1, file_id: "CERT-1", email: " Konuk@Gmail.com ", name: " Zeynep Konuk " }),
      recipient({ id: 2, file_id: "CERT-2", email: "ayse@ogr.nevzatayazal.k12.tr", name: "Uydurma Ad" }),
    ],
  });
  await issueCertificates(db, api, async (m) => void sent.push(m), desiredRoles(db), 0);

  assert.equal(state.certs[0].given, "Zeynep Konuk");
  assert.equal(sent[0].to, "konuk@gmail.com");
  assert.match(sent[0].text, /Merhaba Zeynep Konuk,/);
  assert.equal(state.results[0].result.email, null);
  assert.equal(state.certs[1].given, findSchoolPerson(db, "ayse@ogr.nevzatayazal.k12.tr")!.name);
});

test("sertifika: adsız yabancı adres, adsız mezun, kapalı kulüp ve yetkisini kaybeden istek sertifika üretmez", async () => {
  const db = certSetup();
  addClub(db, "eski", 0);
  addStudent(db, { email: "mezun@ogr.nevzatayazal.k12.tr", exitReason: "GRADUATED" });
  const { api, state } = fakeApi({
    recipients: [
      recipient({ id: 1, email: "mezun@ogr.nevzatayazal.k12.tr" }),
      recipient({ id: 2, email: "dis@gmail.com", name: "   " }),
      recipient({ id: 3, club_code: "eski" }),
      recipient({ id: 4, requested_by: "eski@ogr.nevzatayazal.k12.tr" }),
    ],
  });
  await issueCertificates(db, api, noMail, desiredRoles(db), 0);
  assert.equal(state.certs.length, 0);
  assert.deepEqual(state.results.map((r) => r.result.status), ["failed", "failed", "failed", "failed"]);
  assert.match(state.results[3].result.error!, /yetkisi/);
});

test("sertifika: yarıda kalan iş sertifikayı ikinci kez açmaz", async () => {
  const db = certSetup();
  const { api, state } = fakeApi({ recipients: [recipient()], certs: ["CERT-1"] });
  await issueCertificates(db, api, noMail, desiredRoles(db), 0);
  assert.equal(state.certs.length, 0);
  assert.equal(state.results[0].result.status, "sent");
});

test("sertifika: e-posta hatası tekrar denenir, sonunda bildirilir", async () => {
  const db = certSetup();
  const broken = async () => {
    throw new Error("HTTP 500");
  };
  const first = fakeApi({ recipients: [recipient()] });
  await issueCertificates(db, first.api, broken, desiredRoles(db), 0);
  assert.deepEqual(first.state.results[0].result, { attempts: 1 });

  const last = fakeApi({ recipients: [recipient({ attempts: 4 })] });
  await issueCertificates(db, last.api, broken, desiredRoles(db), 0);
  assert.equal(last.state.results[0].result.status, "failed");
});

test("sertifika: gönderim sınırında kalanlar beklemede kalır", async () => {
  const db = certSetup();
  addStudent(db, { email: "ali@ogr.nevzatayazal.k12.tr" });
  const { api, state } = fakeApi({ recipients: [recipient(), recipient({ id: 2, file_id: "CERT-2", email: "ali@ogr.nevzatayazal.k12.tr" })] });
  const done = await issueCertificates(
    db,
    api,
    async () => {
      throw new MailLimitError("sınır");
    },
    desiredRoles(db),
    0,
  );
  assert.equal(done, 0);
  assert.equal(state.results.length, 0);
});

test("sertifika: gönderici ayarlı değilse satırlar beklemede kalır", async () => {
  const db = certSetup();
  const { api, state } = fakeApi({ recipients: [recipient()] });
  await syncPanel(db, api);
  assert.equal(state.results.length, 0);
});

test("api: sertifika satırı yığın bilgisiyle düzleştirilir, kulüp durumu yazılır", async () => {
  const calls: { url: string; method?: string; body?: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body as string });
    const rows = url.includes("certificate_recipients")
      ? [{ id: 7, email: "a@b.tr", name: "", file_id: "C", attempts: 0, certificate_batches: { club_code: "tech", title: "T", event_date: "2026-01-02", issuer: "I", requested_by: "r@b.tr" } }]
      : [];
    return new Response(JSON.stringify(rows));
  }) as typeof fetch;
  const api = createPanelApi("https://x.supabase.co", "key", fetcher);
  const [row] = await api.pendingRecipients();
  assert.deepEqual(row, { id: 7, email: "a@b.tr", name: "", file_id: "C", attempts: 0, club_code: "tech", title: "T", event_date: "2026-01-02", issuer: "I", requested_by: "r@b.tr" });
  await api.setClubActive("tech", false);
  assert.equal(calls[1].url, "https://x.supabase.co/rest/v1/clubs?code=eq.tech");
  assert.equal(calls[1].body, '{"is_active":false}');
});

test("e-posta: gönderici adı temizlenir, Google kotası gönderim sınırı sayılır", async () => {
  Object.assign(process.env, { SMTP_HOST: "smtp.test", SMTP_USER: "u", SMTP_PASSWORD: "p", CERT_EMAIL_FROM: "sertifika@naal.org.tr" });
  const mail = personalMailerFromEnv()!;
  delete process.env.CERT_EMAIL_FROM;
  assert.equal(personalMailerFromEnv(), null);
  process.env.CERT_EMAIL_FROM = "sertifika@naal.org.tr";
  delete process.env.SMTP_PASSWORD;
  assert.equal(personalMailerFromEnv(), null);
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.CERT_EMAIL_FROM;

  const message = { to: "a@b.tr", senderName: 'Kulüp <"x">', replyTo: "tech@naal.org.tr", subject: "s", text: "t", messageId: "certificate-C@naal.org.tr" };
  const failing = (response: string) => ({
    sendMail: async () => {
      throw Object.assign(new Error("smtp"), { response });
    },
  });
  let sent: Record<string, unknown> = {};
  await mail(message, {
    sendMail: async (options: Record<string, unknown>) => {
      sent = options;
    },
  } as never);
  assert.deepEqual(sent.from, { name: "Kulüp x", address: "sertifika@naal.org.tr" });
  assert.equal(sent.messageId, "certificate-C@naal.org.tr");
  await assert.rejects(mail(message, failing("550 5.4.5 Daily sending quota exceeded") as never), MailLimitError);
  await assert.rejects(mail(message, failing("421 4.7.0 Try again later") as never), MailLimitError);
  await assert.rejects(mail(message, failing("550 5.1.1 No such user") as never), (e) => !(e instanceof MailLimitError));
});
