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

test("tableRows/tableTsv: 組・時刻・コース・氏名（4列そろえ）", () => {
  const players = makePlayers([10, null, 15, 6, 8, 9, 7]);
  const groups = [{ memberIds: ["p0", "p1", "p2", "p3"] }, { memberIds: ["p4", "p5", "p6"] }];
  const rows = Core.tableRows(groups, players, Core.startTimes(2, "08:00", 7, "OUT"), false);
  assert.equal(Core.tableTsv(rows), [
    "組\tスタート\tコース\t氏名\t\t\t",
    "1組\t08:00\tOUT\t選手0\t選手1\t選手2\t選手3",
    "2組\t08:07\tOUT\t選手4\t選手5\t選手6\t",
  ].join("\n"));
});

test("tableRows: withHc で氏名に HC を付ける（HC なしは名前のみ）", () => {
  const rows = Core.tableRows([{ memberIds: ["p0", "p1"] }], makePlayers([10, null]), [], true);
  assert.deepEqual(rows[0].names, ["選手0（10）", "選手1"]);
  assert.equal(rows[0].time, "");
});

test("tableHtml: 氏名をエスケープして表にする", () => {
  const players = [{ id: "a", name: "<b>山田</b>", hc: 1 }];
  const html = Core.tableHtml(Core.tableRows([{ memberIds: ["a"] }], players, [], false));
  assert.match(html, /^<table/);
  assert.match(html, /&lt;b&gt;山田&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test("validateImport: 正しければ null、だめなら理由", () => {
  assert.equal(Core.validateImport({ version: 1, players: [{ id: "a", name: "山田", hc: null }], groups: [] }), null);
  assert.match(Core.validateImport(null), /形式/);
  assert.match(Core.validateImport({ version: 2, players: [] }), /バージョン/);
  assert.match(Core.validateImport({ version: 1, players: [{ id: "a", name: "山田", hc: "10" }] }), /1人目/);
  assert.match(Core.validateImport({ version: 1, players: [], groups: {} }), /groups/);
});
