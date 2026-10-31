import assert from "node:assert/strict";
import { test } from "node:test";
import { findColumns, splitByColumns, toLines } from "../lib/roster/layout.ts";
import type { ParsedRoster, RosterSection, RosterStudent } from "../lib/roster/types.ts";
import { validateRoster } from "../lib/roster/validate.ts";
import { listYearProblem, schoolYearFor, shiftYears } from "../lib/years.ts";
import { addClass, addStudent, enroll, testDb, yearId } from "./helpers.ts";

const person = (rowNo: number, schoolNo: string, over: Partial<RosterStudent> = {}): RosterStudent => ({
  rowNo,
  schoolNo,
  firstName: "Ayşe",
  lastName: "Yılmaz",
  gender: "F",
  ...over,
});

const section = (over: Partial<RosterSection> = {}): RosterSection => ({
  grade: 9,
  section: "A",
  source: "sayfa 1",
  students: [person(1, "1"), person(2, "2")],
  ...over,
});

const roster = (...sections: RosterSection[]): ParsedRoster => ({ parserId: "test", sections, issues: [] });
const errors = (r: ParsedRoster) => validateRoster(r).filter((i) => i.level === "error");

test("temiz liste sorun çıkarmaz", () => {
  assert.deepEqual(validateRoster(roster(section({ expected: { total: 2, female: 2, male: 0 } }))), []);
});

test("boş dosya hatadır", () => {
  assert.equal(errors(roster()).length, 1);
});

test("eksik okunan şube hatadır", () => {
  assert.match(errors(roster(section({ expected: { total: 3 } })))[0].message, /Toplam 3/);
});

test("aynı şube ve aynı numara iki kez olamaz", () => {
  assert.equal(errors(roster(section(), section({ source: "sayfa 2" }))).length, 3);
  assert.equal(errors(roster(section(), section({ section: "B", students: [person(1, "3")] }))).length, 0);
});

test("boş isim hatadır, atlayan sıra uyarıdır", () => {
  assert.equal(errors(roster(section({ students: [person(1, "1", { lastName: "" })] }))).length, 1);
  const issues = validateRoster(roster(section({ students: [person(2, "1")] })));
  assert.deepEqual(issues.map((i) => i.level), ["warning"]);
});

test("PDF parçaları satırlara ve sütunlara ayrılır", () => {
  const item = (str: string, x: number, y: number) => ({ page: 1, str, x, y, width: str.length * 5 });
  const lines = toLines([item("No", 10, 700), item("Adı", 100, 700.5), item("12", 10, 680), item("Ayşe", 100, 680)]);
  assert.equal(lines.length, 2);
  const cols = findColumns(lines[0], { no: "No", name: "Adı" });
  assert.ok(cols);
  assert.deepEqual(splitByColumns(lines[1], cols), { no: "12", name: "Ayşe" });
  assert.equal(findColumns(lines[0], { no: "Numara" }), null);
});

test("eğitim yılı Eylül'de başlar", () => {
  assert.equal(schoolYearFor(new Date(2026, 7, 31)), 2025);
  assert.equal(schoolYearFor(new Date(2026, 8, 1)), 2026);
  assert.equal(shiftYears("2026-09-07", 2), "2028-09-07");
});

test("eski ya da başlamamış yılın listesi reddedilir", () => {
  const db = testDb();
  const year = yearId(db, "2025-2026");
  enroll(db, addStudent(db), year, addClass(db, year, 9, "A"));
  const now = new Date(2026, 9, 1);
  assert.equal(listYearProblem(db, 2026, now), null);
  assert.equal(listYearProblem(db, 2025, now), null, "aynı yıl tekrar yüklenebilir");
  assert.match(listYearProblem(db, 2024, now) ?? "", /eski/);
  assert.match(listYearProblem(db, 2027, now) ?? "", /başlamadı/);
  assert.match(listYearProblem(db, 1999, now) ?? "", /Geçersiz/);
});
