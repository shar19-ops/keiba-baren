"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { seededRng, makePlayers } = require("./helpers");

const names = (players, ids) => ids.map((id) => players.find((p) => p.id === id).name);
const entry = (date, groups) => ({ date, label: date, groups });

// 前回の組合せ（氏名の配列）を作る
function pastFrom(players, idGroups) {
  return idGroups.map((ids) => names(players, ids));
}

function repeatTotal(groups, players, rounds) {
  return Core.repeatInfo(groups, players, rounds).counts.reduce((a, b) => a + b, 0);
}

test("nameKey: 空白と全角・半角の違いを無視する", () => {
  assert.equal(Core.nameKey("山田　太郎"), Core.nameKey("山田 太郎"));
  assert.equal(Core.nameKey("ＡＢＣ"), Core.nameKey("ABC"));
});

test("recentRounds: 日付の新しい順に3回まで、今回と同じ日付は除く", () => {
  const h = [
    entry("2026-04-01", []), entry("2026-06-01", []), entry("2026-05-01", []),
    entry("2026-07-01", []), entry("2026-08-01", []),
  ];
  assert.deepEqual(Core.recentRounds(h, "2026-08-01").map((x) => x.date), ["2026-07-01", "2026-06-01", "2026-05-01"]);
  assert.deepEqual(Core.recentRounds(h, "").map((x) => x.date), ["2026-08-01", "2026-07-01", "2026-06-01"]);
  assert.deepEqual(Core.recentRounds(undefined, ""), []);
});

test("recentRounds: 同じ日付なら後から保存した方を新しいとみなす", () => {
  const a = entry("2026-05-01", []), b = entry("2026-05-01", []);
  a.label = "先"; b.label = "後";
  assert.deepEqual(Core.recentRounds([a, b], "").map((x) => x.label), ["後", "先"]);
});

test("pairWeights: 前回3・2回前2・3回前1、同じ2人が何回もいれば足す", () => {
  const rounds = [
    entry("2026-03-01", [["A", "B", "C"]]),
    entry("2026-02-01", [["A", "B"]]),
    entry("2026-01-01", [["A", "D"]]),
  ];
  const w = Core.pairWeights(rounds);
  const key = (x, y) => Object.keys(w).find((k) => k.split("\u0001").sort().join() === [x, y].sort().join());
  assert.equal(w[key("A", "B")], 5);
  assert.equal(w[key("A", "C")], 3);
  assert.equal(w[key("A", "D")], 1);
});

test("repeatInfo: 今の組で前に同じ組だった相手と、回ごとのペア数", () => {
  const players = makePlayers([1, 2, 3, 4]);
  const rounds = [entry("2026-02-01", [["選手0", "選手1"]]), entry("2026-01-01", [["選手 0", "選手2"]])];
  const info = Core.repeatInfo([{ memberIds: ["p0", "p1", "p2", "p3"] }], players, rounds);
  assert.deepEqual(info.counts, [1, 1]);
  assert.deepEqual(info.byMember.p0, [{ name: "選手1", ago: 1 }, { name: "選手2", ago: 2 }]);
  assert.equal(info.byMember.p3, undefined);
});

test("historyEntry: 組を氏名の配列にする（空の組は入れない）", () => {
  const players = makePlayers([1, 2, 3]);
  const h = Core.historyEntry([{ memberIds: ["p2", "p0"] }, { memberIds: [] }, { memberIds: ["p1", "gone"] }], players, "2026-10-01", "第1回");
  assert.deepEqual(h, { date: "2026-10-01", label: "第1回", groups: [["選手2", "選手0"], ["選手1"]] });
});

// 16人・4組で、前回の4組から1人ずつ取れば重複ゼロにできる
const players16 = makePlayers([2, 30, 15, 8, 22, 11, 27, 5, 18, 13, 25, 9, 20, 16, 3, 28]);
const prev16 = pastFrom(players16, [
  ["p0", "p1", "p2", "p3"], ["p4", "p5", "p6", "p7"], ["p8", "p9", "p10", "p11"], ["p12", "p13", "p14", "p15"],
]);

for (const mode of ["balanced", "random", "hcOrder"]) {
  test(`assign(${mode}) + 履歴: 避けられるときは前回と同じ組が出ない`, () => {
    const rounds = [entry("2026-09-01", prev16)];
    const w = Core.pairWeights(rounds);
    for (let seed = 1; seed <= 5; seed++) {
      const g = Core.assign(players16, [], mode, seededRng(seed), false, false, w);
      assert.deepEqual(g.map((x) => x.memberIds.length), [4, 4, 4, 4]);
      assert.deepEqual(g.flatMap((x) => x.memberIds).sort(), players16.map((p) => p.id).sort());
      assert.equal(repeatTotal(g, players16, rounds), 0, `seed=${seed}`);
    }
  });

  test(`assign(${mode}) + 履歴: 先頭と固定メンバーは動かない`, () => {
    const w = Core.pairWeights([entry("2026-09-01", prev16)]);
    const prev = [
      { leaderId: "p0", memberIds: [], locked: [] },
      { leaderId: "p4", memberIds: [], locked: ["p1"] },
    ];
    for (let seed = 1; seed <= 3; seed++) {
      const g = Core.assign(players16, prev, mode, seededRng(seed), false, false, w);
      assert.equal(g[0].memberIds[0], "p0");
      assert.deepEqual(g[1].memberIds.slice(0, 2), ["p4", "p1"]);
      assert.deepEqual(g[1].locked, ["p1"]);
    }
  });
}

test("assign + 履歴: 重複ゼロの中で HC もそろえる（HC均等）", () => {
  const w = Core.pairWeights([entry("2026-09-01", prev16)]);
  for (let seed = 1; seed <= 5; seed++) {
    const g = Core.assign(players16, [], "balanced", seededRng(seed), false, false, w);
    const avgs = g.map((x) => Core.groupStats(x.memberIds, players16).hcAvg);
    assert.ok(Math.max(...avgs) - Math.min(...avgs) <= 3, avgs.join(","));
  }
});

test("assign + 履歴: 避けきれないときは古い回の重複を残し、前回の重複を避ける", () => {
  // 8人・2組。前回の組が2つとも4人なので、どう分けても同じ組だった2人が残る
  const players = makePlayers([10, 10, 10, 10, 10, 10, 10, 10]);
  const last = pastFrom(players, [["p0", "p1", "p2", "p3"], ["p4", "p5", "p6", "p7"]]);
  const older = pastFrom(players, [["p0", "p4", "p1", "p5"], ["p2", "p6", "p3", "p7"]]);
  const rounds = [entry("2026-09-01", last), entry("2026-08-01", older)];
  const w = Core.pairWeights(rounds);
  for (let seed = 1; seed <= 5; seed++) {
    const g = Core.assign(players, [], "random", seededRng(seed), false, false, w);
    const info = Core.repeatInfo(g, players, rounds);
    // 前回の重複は最少の4ペア（各組 2人+2人）。2回前とも重なるより前回だけの方が軽い
    assert.equal(info.counts[0], 4, `seed=${seed}`);
  }
});

test("assign: 履歴が無ければ今までと同じ結果", () => {
  const players = makePlayers([10, 20, null, 5, 30, 15, 8, null, 25, 12, 18]);
  for (const mode of ["balanced", "random", "hcOrder"]) {
    assert.deepEqual(
      Core.assign(players, [], mode, seededRng(3), false, false, {}),
      Core.assign(players, [], mode, seededRng(3), false, false),
    );
  }
});

test("validateImport: 履歴の形式を確かめる", () => {
  const base = { version: 1, players: [] };
  assert.equal(Core.validateImport({ ...base, history: [entry("2026-01-01", [["A", "B"]])] }), null);
  assert.equal(Core.validateImport(base), null);
  assert.match(Core.validateImport({ ...base, history: [{ date: "x", groups: [[1]] }] }), /履歴/);
  assert.match(Core.validateImport({ ...base, history: "x" }), /履歴/);
});
