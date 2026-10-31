import assert from "node:assert/strict";
import { test } from "node:test";
import { asciiFold, emailCandidates, pickEmail, RESERVED_LOCAL_PARTS, slug, toTitleCaseTr } from "../lib/email.ts";

const first = (it: Generator<string>, n: number) => Array.from({ length: n }, () => it.next().value);

test("Türkçe karakterler sadeleşir", () => {
  assert.equal(asciiFold("ŞÜKRÜ ÇAĞLAR"), "sukru caglar");
  assert.equal(asciiFold("IŞIK"), "isik");
  assert.equal(slug("Gül-Şah"), "gulsah");
});

test("başlık harfi Türkçe İ ve ı kuralına uyar", () => {
  assert.equal(toTitleCaseTr("AHMET EMRE"), "Ahmet Emre");
  assert.equal(toTitleCaseTr("ayşe-nur"), "Ayşe-Nur");
  assert.equal(toTitleCaseTr("IŞIL"), "Işıl");
});

test("adres adayları ad.soyad, ikinci isim, sonra sayı sırasında gelir", () => {
  const it = emailCandidates({ firstName: "Ahmet Emre", lastName: "Yılmaz" });
  assert.deepEqual(first(it, 4), ["ahmet.yilmaz", "ahmetemre.yilmaz", "ahmet.emre.yilmaz", "ahmet.yilmaz2"]);
});

test("çift soyad birleşik yazılır", () => {
  assert.equal(emailCandidates({ firstName: "Ali", lastName: "Yılmaz Kaya" }).next().value, "ali.yilmazkaya");
});

test("kulüp görevlisi önce adını alır", () => {
  const it = emailCandidates({ firstName: "Ahmet", lastName: "Yılmaz" }, "firstName");
  assert.deepEqual(first(it, 3), ["ahmet", "ahmet.yilmaz", "ahmet.yilmaz2"]);
});

test("adres 64 karakteri geçmez", () => {
  const local = emailCandidates({ firstName: "a".repeat(70), lastName: "b" }).next().value as string;
  assert.ok(local.length <= 64);
});

test("boş ad reddedilir", () => {
  assert.throws(() => emailCandidates({ firstName: "", lastName: "Yılmaz" }).next());
});

test("pickEmail dolu, ayrılmış ve aynı listedeki adresleri atlar", async () => {
  const reservedInBatch = new Set(["ali.kaya2@x.tr"]);
  const email = await pickEmail(
    { firstName: "Ali", lastName: "Kaya" },
    "x.tr",
    async (e) => e === "ali.kaya@x.tr",
    { reservedInBatch },
  );
  assert.equal(email, "ali.kaya3@x.tr");
  assert.ok(reservedInBatch.has("ali.kaya3@x.tr"));

  const club = await pickEmail({ firstName: "Admin", lastName: "Kaya" }, "x.tr", async () => false, { strategy: "firstName" });
  assert.ok(RESERVED_LOCAL_PARTS.has("admin"));
  assert.equal(club, "admin.kaya@x.tr");
});
