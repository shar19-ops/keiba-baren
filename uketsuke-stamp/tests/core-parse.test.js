"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

test("parseSheetName: 半角/全角の番号と部署名を分ける", () => {
  assert.deepEqual(Core.parseSheetName("02 総務部"), { deptOrder: 2, dept: "総務部" });
  assert.deepEqual(Core.parseSheetName("３０ 大阪支店他"), { deptOrder: 30, dept: "大阪支店他" });
  assert.deepEqual(Core.parseSheetName("12　第一工事本部"), { deptOrder: 12, dept: "第一工事本部" });
  assert.equal(Core.parseSheetName("原本"), null);
  assert.equal(Core.parseSheetName("出欠合計表"), null);
  assert.equal(Core.parseSheetName("Sheet2"), null);
});

test("normalizeLabel: 空白・全角空白・改行を除く", () => {
  assert.equal(Core.normalizeLabel("氏　名"), "氏名");
  assert.equal(Core.normalizeLabel("出欠席\r\n予定"), "出欠席予定");
  assert.equal(Core.normalizeLabel(" 当日\n出欠席 "), "当日出欠席");
  assert.equal(Core.normalizeLabel(null), "");
  assert.equal(Core.normalizeLabel(12), "12");
});

test("normalizePlan / formatPlan", () => {
  ["〇", "○", "◯", "o", "O", " 〇 "].forEach((v) => assert.equal(Core.normalizePlan(v), "yes", v));
  ["×", "x", "X", "✕"].forEach((v) => assert.equal(Core.normalizePlan(v), "no", v));
  ["", null, undefined, "未定", 1].forEach((v) => assert.equal(Core.normalizePlan(v), "unknown", String(v)));
  assert.equal(Core.formatPlan("yes"), "〇");
  assert.equal(Core.formatPlan("no"), "×");
  assert.equal(Core.formatPlan("unknown"), "");
});

test("colLetter", () => {
  assert.equal(Core.colLetter(0), "A");
  assert.equal(Core.colLetter(6), "G");
  assert.equal(Core.colLetter(13), "N");
  assert.equal(Core.colLetter(26), "AA");
  assert.equal(Core.colLetter(36), "AK");
});

test("findHeader: 見出しラベルから列を特定する", () => {
  const rows = [
    ["タイトル"],
    ["日時"],
    ["会場"],
    ["氏　名", null, null, null, null, null, "役職", null, null, null, "出欠席\r\n予定", null, null, "当日\r\n出欠席", null, null, "欠席理由"],
    ["山田"],
  ];
  assert.deepEqual(Core.findHeader(rows), { headerRow: 3, nameCol: 0, titleCol: 6, planCol: 10, dayCol: 13 });
});

test("findHeader: 列順が違っても、見出しが 6 行目でも、当日欄が無くても特定できる", () => {
  const rows = [[], [], [], [], [], ["役職", "出欠席予定", "氏名"]];
  assert.deepEqual(Core.findHeader(rows), { headerRow: 5, nameCol: 2, titleCol: 0, planCol: 1, dayCol: null });
});

test("findHeader: 3 ラベルが揃う行が無ければ null", () => {
  assert.equal(Core.findHeader([["氏名", "役職"], ["出欠席予定"]]), null);
  assert.equal(Core.findHeader([]), null);
  // 11 行目以降は見ない
  const late = []; for (let i = 0; i < 10; i++) late.push([]);
  late.push(["氏名", "役職", "出欠席予定"]);
  assert.equal(Core.findHeader(late), null);
});
