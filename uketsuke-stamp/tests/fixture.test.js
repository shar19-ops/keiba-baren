"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFixture } = require("./helpers");

test("fixture: 部署シートが 30 枚あり、対象外シートも残っている", () => {
  const wb = loadFixture();
  const dept = wb.SheetNames.filter((n) => /^[0-9０-９]+[\s　]+/.test(n));
  assert.equal(dept.length, 30);
  assert.ok(wb.SheetNames.includes("原本"));
  assert.ok(wb.SheetNames.includes("出欠合計表"));
  assert.ok(wb.SheetNames.includes("３０ 試験部30"));
});

test("fixture: 見出し行が 4 行目にあり、実名の代わりにダミー名が入っている", () => {
  const wb = loadFixture();
  const ws = wb.Sheets["02 試験部02"];
  assert.equal(String(ws.A4.v).replace(/[\s　]/g, ""), "氏名");
  assert.equal(String(ws.G4.v).replace(/[\s　]/g, ""), "役職");
  assert.equal(String(ws.K4.v).replace(/[\s　]/g, ""), "出欠席予定");
  assert.equal(String(ws.N4.v).replace(/[\s　]/g, ""), "当日出欠席");
  assert.equal(String(ws.A5.v), "全幅結合行(ダミー)");
  assert.match(String(ws.A6.v), /^試験　\d{3}$/);
  assert.equal(String(ws.A28.v), "計");
});
