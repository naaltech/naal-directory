import assert from "node:assert/strict";
import { test } from "node:test";
import { compareNames, gradeFits, hashNationalId, matchStudent, type ExistingStudent, type MatchContext } from "../lib/match.ts";

const student = (over: Partial<ExistingStudent> = {}): ExistingStudent => ({
  id: 1,
  schoolNo: "100",
  firstName: "Ayşe",
  lastName: "Yılmaz",
  grade: 9,
  lastYear: 2025,
  ...over,
});

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  targetYear: 2026,
  active: [],
  exited: [],
  listNumbers: new Set(),
  ...over,
});

const row = { schoolNo: "100", firstName: "Ayşe", lastName: "Yılmaz", grade: 10 };

test("isim karşılaştırması", () => {
  assert.equal(compareNames({ firstName: "AYŞE", lastName: "YILMAZ" }, { firstName: "Ayşe", lastName: "Yılmaz" }), "same");
  assert.equal(compareNames({ firstName: "Ayşe Nur", lastName: "Yılmaz" }, { firstName: "Ayşe", lastName: "Yılmaz" }), "similar");
  assert.equal(compareNames({ firstName: "Ayşe", lastName: "Yilmazz" }, { firstName: "Ayşe", lastName: "Yılmaz" }), "similar");
  assert.equal(compareNames({ firstName: "Mehmet", lastName: "Kaya" }, { firstName: "Ayşe", lastName: "Yılmaz" }), "different");
});

test("sınıf seviyesi aradan geçen yıla göre değerlendirilir", () => {
  const s = student({ grade: 9, lastYear: 2023 });
  assert.equal(gradeFits(s, 12, 2026), true);
  assert.equal(gradeFits(s, 8, 2026), false);
  assert.equal(gradeFits(student({ grade: 9, lastYear: 2026 }), 10, 2026), false, "aynı yılda sınıf değişmez");
  assert.equal(gradeFits(student(), 9, 2024), false, "geçmiş yıl");
  assert.equal(gradeFits(student({ grade: null, lastYear: null }), 11, 2026), true);
});

test("numara, isim ve sınıf uyuyorsa eşleşir", () => {
  const r = matchStudent(row, ctx({ active: [student()] }));
  assert.deepEqual(r, { kind: "matched", studentId: 1, warnings: [] });
});

test("yazım farkı uyarıyla eşleşir", () => {
  const r = matchStudent({ ...row, firstName: "Ayşe Nur" }, ctx({ active: [student()] }));
  assert.equal(r.kind, "matched");
  assert.equal(r.kind === "matched" && r.warnings.length, 1);
});

test("sınıf uymazsa kullanıcıya sorulur", () => {
  assert.equal(matchStudent({ ...row, grade: 12 }, ctx({ active: [student()] })).kind, "conflict");
});

test("aynı yılda aynı numarada farklı isim kullanıcıya sorulur", () => {
  const r = matchStudent({ ...row, firstName: "Mehmet", lastName: "Kaya", grade: 9 }, ctx({ active: [student({ lastYear: 2026 })] }));
  assert.equal(r.kind, "conflict");
});

test("önceki yıldan numara yeniden verildiyse yeni öğrencidir", () => {
  const r = matchStudent({ ...row, firstName: "Mehmet", lastName: "Kaya" }, ctx({ active: [student()] }));
  assert.equal(r.kind, "new");
  assert.equal(r.kind === "new" && r.warnings.length, 1);
});

test("aynı isim farklı numarada, eski numara listede yoksa kullanıcıya sorulur", () => {
  const r = matchStudent({ ...row, schoolNo: "200" }, ctx({ active: [student()] }));
  assert.equal(r.kind, "conflict");
});

test("eski numara listede başkasındaysa aynı isim eşleştirilmez", () => {
  const r = matchStudent({ ...row, schoolNo: "200" }, ctx({ active: [student()], listNumbers: new Set(["100"]) }));
  assert.equal(r.kind, "new");
});

test("ayrılmış öğrenci aynı numara ve isimle dönerse geri dönüş sayılır", () => {
  const r = matchStudent(row, ctx({ exited: [student({ exited: true })] }));
  assert.equal(r.kind, "matched");
  assert.equal(r.kind === "matched" && r.returning, true);
});

test("TC özeti her şeyden önce gelir", () => {
  const nationalIdHash = hashNationalId("123 456 789 01", "anahtar");
  assert.equal(nationalIdHash, hashNationalId("12345678901", "anahtar"));
  const r = matchStudent(
    { schoolNo: "999", firstName: "Başka", lastName: "İsim", grade: 3, nationalIdHash },
    ctx({ active: [student({ nationalIdHash })] }),
  );
  assert.equal(r.kind, "matched");
  assert.equal(r.kind === "matched" && r.warnings.length, 2);
});
