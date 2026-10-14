"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { makePlayers } = require("./helpers");

test("startTimes: 開始時刻から間隔ごと", () => {
  assert.deepEqual(Core.startTimes(3, "07:30", 7, "OUT"), [
    { time: "07:30", course: "OUT" },
    { time: "07:37", course: "OUT" },
    { time: "07:44", course: "OUT" },
  ]);
});

test("startTimes: IN 指定、1桁の時、時をまたぐ", () => {
  assert.deepEqual(Core.startTimes(2, "8:55", 8, "IN"), [
    { time: "08:55", course: "IN" },
    { time: "09:03", course: "IN" },
  ]);
});

test("startTimes: 分割は前半 OUT・後半 IN でそれぞれ同時刻から", () => {
  assert.deepEqual(Core.startTimes(5, "08:00", 7, "split").map((t) => t.time + t.course),
    ["08:00OUT", "08:07OUT", "08:14OUT", "08:00IN", "08:07IN"]);
});

test("startTimes: 開始時刻が空なら時刻は空欄", () => {
  assert.deepEqual(Core.startTimes(1, "", 7, "OUT"), [{ time: "", course: "OUT" }]);
});

test("groupStats: HC なしを除いた合計と平均（小数1桁）", () => {
  const players = makePlayers([10, null, 15, 6]);
  assert.deepEqual(Core.groupStats(["p0", "p1", "p2", "p3"], players), { hcTotal: 31, hcAvg: 10.3 });
  assert.deepEqual(Core.groupStats(["p1"], players), { hcTotal: null, hcAvg: null });
});

test("formatDateJa: 曜日付き、読めなければそのまま", () => {
  assert.equal(Core.formatDateJa("2026-11-03"), "2026年11月3日(火)");
  assert.equal(Core.formatDateJa(""), "");
  assert.equal(Core.formatDateJa("来月"), "来月");
});

// 参考の組合せ表: 分割時は OUT=1〜4枠・IN=5〜8枠、組番号は通し
const SAMPLE_HCS = [24, 30, 30, 10, 30, 30, 30, 26, 30, 20, 18, 12, 23, 30];
const SAMPLE_GROUPS = [
  { memberIds: ["p0", "p1", "p2", "p3"] },
  { memberIds: ["p4", "p5", "p6"] },
  { memberIds: ["p7", "p8", "p9", "p10"] },
  { memberIds: ["p11", "p12", "p13"] },
];

test("courseSections: 分割は OUT と IN の2つ、IN は5枠から、組番号は通し、時刻の先頭0は取る", () => {
  const players = makePlayers(SAMPLE_HCS);
  const s = Core.courseSections(SAMPLE_GROUPS, players, Core.startTimes(4, "08:14", 7, "split"));
  assert.equal(s.length, 2);
  assert.deepEqual([s[0].course, s[0].time, s[0].frameStart], ["OUT", "8:14", 1]);
  assert.deepEqual([s[1].course, s[1].time, s[1].frameStart], ["IN", "8:14", 5]);
  assert.deepEqual(s[0].rows.map((r) => [r.no, r.time]), [[1, "8:14"], [2, "8:21"]]);
  assert.deepEqual(s[1].rows.map((r) => [r.no, r.time]), [[3, "8:14"], [4, "8:21"]]);
  assert.deepEqual(s[0].rows[0].cells[0], { name: "選手0", hc: 24 });
  assert.equal(s[0].rows[1].cells.length, 4);
  assert.equal(s[0].rows[1].cells[3], null);
});

test("courseSections: 全組 OUT（または IN）なら1つにまとめ、1枠から", () => {
  const players = makePlayers(SAMPLE_HCS);
  const s = Core.courseSections(SAMPLE_GROUPS, players, Core.startTimes(4, "07:30", 7, "IN"));
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].course, s[0].time, s[0].frameStart], ["IN", "7:30", 1]);
  assert.deepEqual(s[0].rows.map((r) => r.no), [1, 2, 3, 4]);
});

test("courseSections: 組が無ければ空", () => {
  assert.deepEqual(Core.courseSections([], [], []), []);
});

test("tableTsv: コースごとに見出し・枠・HC 行・氏名行", () => {
  const players = makePlayers([24, null, 30, 10, 30, 30, 30]);
  const groups = [{ memberIds: ["p0", "p1", "p2", "p3"] }, { memberIds: ["p4", "p5", "p6"] }];
  const s = Core.courseSections(groups, players, Core.startTimes(2, "08:14", 7, "split"));
  assert.equal(Core.tableTsv(s, true), [
    "OUTスタート 8:14\t（敬称略）",
    "組\t1枠\t2枠\t3枠\t4枠",
    "1\tHC 24\tHC\tHC 30\tHC 10",
    "\t選手0\t選手1\t選手2\t選手3",
    "INスタート 8:14",
    "組\t5枠\t6枠\t7枠\t8枠",
    "2\tHC 30\tHC 30\tHC 30\t",
    "\t選手4\t選手5\t選手6\t",
  ].join("\n"));
});

test("tableTsv: HC を出さないときは氏名行だけ", () => {
  const players = makePlayers([24, 30]);
  const s = Core.courseSections([{ memberIds: ["p0", "p1"] }], players, Core.startTimes(1, "08:00", 7, "OUT"));
  assert.equal(Core.tableTsv(s, false),
    ["OUTスタート 8:00\t（敬称略）", "組\t1枠\t2枠\t3枠\t4枠", "1\t選手0\t選手1\t\t"].join("\n"));
});

test("tableHtml: コースごとの表、HC と氏名、エスケープ", () => {
  const players = [{ id: "a", name: "<b>山田</b>", hc: 12 }];
  const html = Core.tableHtml(Core.courseSections([{ memberIds: ["a"] }], players, Core.startTimes(1, "08:00", 7, "OUT")), true);
  assert.match(html, /OUTスタート 8:00/);
  assert.match(html, /1 枠/);
  assert.match(html, /HC 12<br>&lt;b&gt;山田&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test("nameChars: 氏名を1文字ずつに分け、姓名の間の空白は区切り（null）にする", () => {
  assert.deepEqual(Core.nameChars("石塚　英明"), ["石", "塚", null, "英", "明"]);
  assert.deepEqual(Core.nameChars(" 森  厚士 "), ["森", null, "厚", "士"]);
  assert.deepEqual(Core.nameChars("亀崎浩"), ["亀", "崎", "浩"]);
});

test("validateImport: 正しければ null、だめなら理由", () => {
  assert.equal(Core.validateImport({ version: 1, players: [{ id: "a", name: "山田", hc: null }], groups: [] }), null);
  assert.match(Core.validateImport(null), /形式/);
  assert.match(Core.validateImport({ version: 2, players: [] }), /バージョン/);
  assert.match(Core.validateImport({ version: 1, players: [{ id: "a", name: "山田", hc: "10" }] }), /1人目/);
  assert.match(Core.validateImport({ version: 1, players: [], groups: {} }), /groups/);
});
