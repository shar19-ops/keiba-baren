"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

function person(id, deptOrder, dept, row, name, plan, title) {
  return { id, deptOrder, dept, sheetName: String(deptOrder).padStart(2, "0") + " " + dept, row, name, title: title || "", plan };
}
const roster = {
  people: [
    person("p1", 1, "甲部", 6, "甲一", "yes"),
    person("p2", 1, "甲部", 7, "甲二", "yes"),
    person("p3", 1, "甲部", 8, "甲三", "no"),
    person("p4", 2, "乙部", 6, "乙一", "unknown"),
    person("p5", 2, "乙部", 7, "乙　二", "yes", "課長"),
  ],
  sheets: [],
};
const checkins = [
  { pid: "p2", t: "2026-10-01T04:10:00.000Z", dev: "受付1", kind: "qr" },
  { pid: "p3", t: "2026-10-01T04:05:00.000Z", dev: "受付2", kind: "manual" },
  { pid: "w-abc", t: "2026-10-01T04:20:00.000Z", dev: "受付1", kind: "walkin", name: "飛入　花子", dept: "外部" },
  { pid: "gone", t: "2026-10-01T04:30:00.000Z", dev: "受付3", kind: "qr" },
];

test("judge", () => {
  assert.equal(Core.judge("yes", true, true), "");
  assert.equal(Core.judge("yes", false, true), "未受付");
  assert.equal(Core.judge("no", true, true), "予定外出席");
  assert.equal(Core.judge("unknown", true, true), "予定外出席");
  assert.equal(Core.judge("no", false, true), "");
  assert.equal(Core.judge("unknown", false, true), "");
  assert.equal(Core.judge("yes", true, false), "名簿外");
});

test("buildRows: 受付した人だけを時刻順に、氏名を引いて返す", () => {
  const rows = Core.buildRows(roster, checkins);
  assert.deepEqual(rows.map((r) => [r.pid, r.name, r.dept, r.title, r.plan, r.dev, r.kind, r.judge, r.listed]), [
    ["p3", "甲三", "甲部", "", "no", "受付2", "manual", "予定外出席", true],
    ["p2", "甲二", "甲部", "", "yes", "受付1", "qr", "", true],
    ["w-abc", "飛入　花子", "外部", "", "unknown", "受付1", "walkin", "名簿外", false],
    ["gone", "(名簿外 gone)", "", "", "unknown", "受付3", "qr", "名簿外", false],
  ]);
});

test("summarize: 合計・部署別・名簿外", () => {
  const s = Core.summarize(roster, checkins);
  assert.deepEqual(s.total, { planYes: 3, checked: 4, missing: 2, unexpected: 3 });
  assert.deepEqual(s.byDept.map((d) => [d.dept, d.planYes, d.checked, d.missing, d.unexpected, d.missingPeople.map((p) => p.name)]), [
    ["甲部", 2, 2, 1, 1, ["甲一"]],
    ["乙部", 1, 0, 1, 0, ["乙　二"]],
  ]);
  assert.deepEqual(s.unlisted.map((c) => [c.pid, c.name, c.dept]), [["w-abc", "飛入　花子", "外部"], ["gone", "(名簿外 gone)", ""]]);
});

test("summarize: 受付が無くても動く", () => {
  const s = Core.summarize(roster, []);
  assert.deepEqual(s.total, { planYes: 3, checked: 0, missing: 3, unexpected: 0 });
  assert.deepEqual(s.unlisted, []);
});

test("searchPeople: 氏名(空白無視)・部署の部分一致、空なら全員", () => {
  assert.deepEqual(Core.searchPeople(roster.people, "乙二").map((p) => p.id), ["p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "乙 二").map((p) => p.id), ["p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "甲部").map((p) => p.id), ["p1", "p2", "p3"]);
  assert.deepEqual(Core.searchPeople(roster.people, "").map((p) => p.id), ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "該当なし"), []);
});

test("rosterDiff: id で追加・削除・変更を数える", () => {
  const before = [person("a", 1, "x", 6, "A", "yes"), person("b", 1, "x", 7, "B", "no", "課長"), person("c", 1, "x", 8, "C", "yes")];
  const after = [person("a", 1, "x", 6, "A", "yes"), person("b", 1, "x", 7, "B", "yes", "課長"), person("d", 1, "x", 9, "D", "yes")];
  assert.deepEqual(Core.rosterDiff(before, after), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(Core.rosterDiff([], after), { added: 3, removed: 0, changed: 0 });
});

test("walkinId: w- で始まり毎回違う", () => {
  const a = Core.walkinId();
  assert.match(a, /^w-[a-z0-9]+$/);
  assert.notEqual(a, Core.walkinId());
});

test("format*: ローカル時刻で固定書式", () => {
  const iso = "2026-10-01T04:05:06.000Z";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  assert.equal(Core.formatClock(iso), pad(d.getHours()) + ":" + pad(d.getMinutes()));
  assert.equal(Core.formatTime(iso), pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
  assert.equal(Core.formatStamp(iso), d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
  assert.equal(Core.formatClock(""), "");
});

test("KIND_LABEL", () => {
  assert.deepEqual(Core.KIND_LABEL, { qr: "QR", manual: "名簿", walkin: "飛び入り" });
});
