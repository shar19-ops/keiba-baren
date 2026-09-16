"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { XLSX } = require("./helpers");

function person(id, deptOrder, dept, row, name, plan, title) {
  return { id, deptOrder, dept, sheetName: String(deptOrder).padStart(2, "0") + " " + dept, row, name, title: title || "", plan };
}
const roster = {
  people: [
    person("p1", 1, "甲部", 6, "甲一", "yes", "課長"),
    person("p2", 1, "甲部", 8, "甲二", "yes"), // 7 行目は小見出しで空く
    person("p3", 2, "乙部", 6, "乙一", "no"),
  ],
  sheets: [
    { sheetName: "01 甲部", deptOrder: 1, dept: "甲部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: 6, lastRow: 8 },
    { sheetName: "02 乙部", deptOrder: 2, dept: "乙部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: null, firstRow: 6, lastRow: 6 },
    { sheetName: "03 丙部", deptOrder: 3, dept: "丙部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: null, lastRow: null },
  ],
};
const t1 = "2026-10-01T04:05:06.000Z";
const t2 = "2026-10-01T04:06:07.000Z";
const checkins = [
  { pid: "p3", t: t2, dev: "受付2", kind: "manual" },
  { pid: "p1", t: t1, dev: "受付1", kind: "qr" },
  { pid: "w-1", t: t2, dev: "受付1", kind: "walkin", name: "飛入　花子", dept: "外部" },
];
const event = { title: "第48回改善事例発表会出欠表", dateText: "2026年10月1日（木）　13:30　開始", venue: "スクエア荏原　イベントホール" };

test("buildCsv: BOM・ヘッダ・受付順・クォート", () => {
  const csv = Core.buildCsv(roster, checkins);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"氏名","部署","役職","出欠席予定","受付時刻","受付端末","種別","判定"');
  assert.equal(lines[1], '"甲一","甲部","課長","〇","' + Core.formatStamp(t1) + '","受付1","QR",""');
  assert.equal(lines[2], '"乙一","乙部","","×","' + Core.formatStamp(t2) + '","受付2","名簿","予定外出席"');
  assert.equal(lines[3], '"飛入　花子","外部","","","' + Core.formatStamp(t2) + '","受付1","飛び入り","名簿外"');
  assert.equal(lines[4], "");
  assert.equal(lines.length, 5);
});

test("buildCsv: ダブルクォートを含む値はエスケープする", () => {
  const r = { people: [person("q", 1, "甲部", 6, 'A"B', "yes")], sheets: [] };
  const csv = Core.buildCsv(r, [{ pid: "q", t: t1, dev: "受付1", kind: "qr" }]);
  assert.ok(csv.includes('"A""B"'));
});

test("buildExportSheets: 部署シートは元の行番号に揃い、名簿外・集計シートが付く", () => {
  const sheets = Core.buildExportSheets(roster, checkins, event);
  assert.deepEqual(sheets.map((s) => s.name), ["01 甲部", "02 乙部", "03 丙部", "名簿外", "集計"]);

  const kou = sheets[0].rows;
  assert.deepEqual(kou[0], ["第48回改善事例発表会出欠表"]);
  assert.deepEqual(kou[1], ["2026年10月1日（木）　13:30　開始"]);
  assert.deepEqual(kou[2], ["スクエア荏原　イベントホール"]);
  assert.deepEqual(kou[3], ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定", "", "→ 元ファイルの N6:N8 に貼り付け"]);
  assert.deepEqual(kou[4], []); // 5 行目(小見出し)は空
  assert.deepEqual(kou[5], ["甲一", "課長", "〇", "〇", Core.formatStamp(t1), "受付1", ""]);
  assert.deepEqual(kou[6], []); // 7 行目は名簿行でない
  assert.deepEqual(kou[7], ["甲二", "", "〇", "", "", "", "未受付"]);
  assert.equal(kou.length, 8);

  const otsu = sheets[1].rows;
  assert.deepEqual(otsu[3].slice(0, 7), ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定"]);
  assert.equal(otsu[3][8], "→ 元ファイルの当日出欠席欄に貼り付け"); // dayCol 不明
  assert.deepEqual(otsu[5], ["乙一", "", "×", "〇", Core.formatStamp(t2), "受付2", "予定外出席"]);

  const hei = sheets[2].rows;
  assert.equal(hei.length, 4); // 見出しまで
  assert.equal(hei[3][8], "→ 元ファイルの当日出欠席欄に貼り付け");

  assert.deepEqual(sheets[3].rows, [
    ["氏名", "所属", "受付時刻", "受付端末", "種別"],
    ["飛入　花子", "外部", Core.formatStamp(t2), "受付1", "飛び入り"],
  ]);
  assert.deepEqual(sheets[4].rows, [
    ["部署", "予定〇", "受付済", "未受付", "予定外"],
    ["甲部", 2, 1, 1, 0],
    ["乙部", 0, 1, 0, 1],
    ["名簿外", "", 1, "", 1],
    ["合計", 2, 3, 1, 2],
  ]);
});

test("toWorkbook: SheetJS のブックになり xlsx に書ける", () => {
  const wb = Core.toWorkbook(XLSX, Core.buildExportSheets(roster, checkins, event));
  assert.deepEqual(wb.SheetNames, ["01 甲部", "02 乙部", "03 丙部", "名簿外", "集計"]);
  assert.equal(wb.Sheets["01 甲部"].D6.v, "〇");
  assert.equal(wb.Sheets["01 甲部"].A8.v, "甲二");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  assert.ok(buf.length > 1000);
  const back = XLSX.read(buf, { type: "buffer" });
  assert.equal(back.Sheets["集計"].B5.v, 2);
});

test("exportFilename: 記号を落として日時を付ける", () => {
  const d = new Date(2026, 9, 1, 14, 5);
  assert.equal(Core.exportFilename("当日出欠", "第48回 改善事例発表会/出欠表", d, "xlsx"), "当日出欠_第48回改善事例発表会出欠表_20261001_1405.xlsx");
  assert.equal(Core.exportFilename("受付一覧", "", d, "csv"), "受付一覧_20261001_1405.csv");
});
