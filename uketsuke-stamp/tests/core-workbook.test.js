"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { XLSX, loadFixture, makeWorkbook, m, deptSheetAoa } = require("./helpers");

test("parseWorkbook: fixture から 30 シート 308 名を読み、警告は無い", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  assert.equal(r.sheets.length, 30);
  assert.equal(r.people.length, 308);
  assert.deepEqual(r.warnings, []);
  const plans = { yes: 0, no: 0, unknown: 0 };
  r.people.forEach((p) => plans[p.plan]++);
  assert.deepEqual(plans, { yes: 102, no: 30, unknown: 176 });
  // 「計」の小計行を名簿に入れていない
  assert.ok(!r.people.some((p) => p.name === "計"));
  assert.equal(r.event.title, "第48回改善事例発表会出欠表");
  assert.equal(r.event.dateText, "2026年10月1日（木）　13:30　開始");
  assert.equal(r.event.venue, "スクエア荏原　イベントホール");
});

test("parseWorkbook: sheetMeta に見出し行・列・名簿行範囲が入る", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  const s = r.sheets.find((x) => x.sheetName === "02 試験部02");
  assert.deepEqual(
    { sheetName: s.sheetName, deptOrder: s.deptOrder, dept: s.dept, headerRow: s.headerRow, nameCol: s.nameCol, titleCol: s.titleCol, planCol: s.planCol, dayCol: s.dayCol, firstRow: s.firstRow },
    { sheetName: "02 試験部02", deptOrder: 2, dept: "試験部02", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: 6 }
  );
  assert.ok(s.lastRow >= 6 && s.lastRow <= 27, "lastRow=" + s.lastRow); // 末尾の「計」行(28)は含まない
  assert.ok(s.lastRow >= s.firstRow);
  const osaka = r.sheets.find((x) => x.sheetName === "３０ 試験部30");
  assert.equal(osaka.deptOrder, 30);
  // 5 行目は全幅結合の小見出しなので名簿は 6 行目から
  assert.equal(osaka.firstRow, 6);
});

test("parseWorkbook: person は元の行番号・部署順・氏名・役職・予定を持つ", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  const p = r.people.find((x) => x.sheetName === "02 試験部02" && x.row === 6);
  assert.equal(p.deptOrder, 2);
  assert.equal(p.dept, "試験部02");
  assert.match(p.name, /^試験　\d{3}$/);
  assert.ok(["yes", "no", "unknown"].includes(p.plan));
  assert.equal(typeof p.title, "string");
  assert.equal(p.id, undefined);
});

test("parseWorkbook: 全幅結合の小見出し・注意書き行と「計」の小計行を読み飛ばす", () => {
  const d = deptSheetAoa([{ name: "山田　太郎", title: "課長", plan: "〇" }, { name: "佐藤　花子", plan: "×" }]);
  // 5 行目(index 4)に全幅結合の小見出しを挟み、末尾に小計行と注意書き行を足す
  d.aoa.splice(4, 0, ["大阪支店・名古屋支店・仙台支店"]);
  d.aoa.push(["計", "（", 2, null, "名", "）", null, null, null, null, 1, null, null, 0]);
  d.aoa.push(["9月14日までに提出お願いします。"]);
  const wb = makeWorkbook([{ name: "０１ 試験部", aoa: d.aoa, merges: [m("A5:AK5"), m("A9:AK9")] }]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.people.map((p) => [p.row, p.name, p.title, p.plan]), [[6, "山田　太郎", "課長", "yes"], [7, "佐藤　花子", "", "no"]]);
  assert.equal(r.sheets[0].firstRow, 6);
  assert.equal(r.sheets[0].lastRow, 7);
});

test("parseWorkbook: 列順が違うシート・見出しが 6 行目のシートも読める", () => {
  const swapped = deptSheetAoa([{ name: "田中　一郎", title: "主任", plan: "〇" }], { order: ["title", "name", "plan", "day"] });
  const shifted = deptSheetAoa([{ name: "鈴木　二郎", plan: "" }], { extraRows: 2 });
  const wb = makeWorkbook([
    { name: "01 甲部", aoa: swapped.aoa },
    { name: "02 乙部", aoa: shifted.aoa },
  ]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.people.map((p) => [p.sheetName, p.row, p.name, p.title, p.plan]), [
    ["01 甲部", 5, "田中　一郎", "主任", "yes"],
    ["02 乙部", 7, "鈴木　二郎", "", "unknown"],
  ]);
  assert.equal(r.sheets[0].nameCol, "G");
  assert.equal(r.sheets[0].titleCol, "A");
  assert.equal(r.sheets[1].headerRow, 6);
});

test("parseWorkbook: 見出しの無い部署シートは警告して読み飛ばし、対象外シートは無視する", () => {
  const ok = deptSheetAoa([{ name: "高橋　三郎" }]);
  const wb = makeWorkbook([
    { name: "原本", aoa: [["古いテンプレ"]] },
    { name: "01 甲部", aoa: ok.aoa },
    { name: "02 乙部", aoa: [["見出しが無いシート"], ["山田"]] },
  ]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.equal(r.people.length, 1);
  assert.equal(r.sheets.length, 1);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /02 乙部/);
  assert.match(r.warnings[0], /見出し行/);
});

test("parseWorkbook: 長すぎる氏名・数値の氏名は警告して読み飛ばす", () => {
  const d = deptSheetAoa([{ name: "あ".repeat(21) }, { name: "正常　太郎" }]);
  d.aoa.push([12345]);
  const wb = makeWorkbook([{ name: "01 甲部", aoa: d.aoa }]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.people.map((p) => p.name), ["正常　太郎"]);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /5 行/);
  assert.match(r.warnings[1], /7 行/);
});

test("parseWorkbook: 部署シートが無ければ例外", () => {
  const wb = makeWorkbook([{ name: "原本", aoa: [["x"]] }]);
  assert.throws(() => Core.parseWorkbook(wb, XLSX), /部署シート/);
});

test("parseWorkbook + sortPeople/buildExportSheets: 先頭番号が同じシートが複数あっても部署ごとに固まる(sheetIndex)", () => {
  const a = deptSheetAoa([{ name: "甲　太郎", plan: "〇" }, { name: "甲　次郎", plan: "×" }]);
  const b = deptSheetAoa([{ name: "乙　太郎", plan: "〇" }, { name: "乙　次郎", plan: "×" }]);
  const wb = makeWorkbook([
    { name: "05 甲部", aoa: a.aoa },
    { name: "05 乙部", aoa: b.aoa },
  ]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.ok(r.people.every((p) => typeof p.sheetIndex === "number"), "people に sheetIndex が無い");
  assert.ok(r.sheets.every((s) => typeof s.sheetIndex === "number"), "sheets に sheetIndex が無い");

  const sorted = Core.sortPeople(r.people);
  assert.deepEqual(sorted.map((p) => [p.sheetName, p.row]), [
    ["05 甲部", 5], ["05 甲部", 6], ["05 乙部", 5], ["05 乙部", 6],
  ]);

  const exportSheets = Core.buildExportSheets({ people: r.people, sheets: r.sheets }, [], { title: "", dateText: "", venue: "" });
  assert.deepEqual(exportSheets.slice(0, 2).map((s) => s.name), ["05 甲部", "05 乙部"]);
});
