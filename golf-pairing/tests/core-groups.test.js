"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { seededRng, makePlayers } = require("./helpers");

const flat = (groups) => groups.flatMap((g) => g.memberIds);

test("groupSizes: 4人基本、端数は末尾を3人組（5人だけ 3+2）", () => {
  const cases = {
    0: [], 1: [1], 3: [3], 4: [4], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3],
    10: [4, 3, 3], 11: [4, 4, 3], 14: [4, 4, 3, 3], 16: [4, 4, 4, 4], 17: [4, 4, 3, 3, 3],
  };
  for (const [n, sizes] of Object.entries(cases)) assert.deepEqual(Core.groupSizes(Number(n)), sizes, `n=${n}`);
});

test("groupSizes: 6〜40人で合計が一致し、各組は3か4人", () => {
  for (let n = 6; n <= 40; n++) {
    const s = Core.groupSizes(n);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.ok(s.every((x) => x === 3 || x === 4), `n=${n}`);
  }
});

test("normalizeGroups: 居なくなった人・重複を外し、人数に合わせて組数を変える", () => {
  const players = makePlayers([1, 2, 3, 4, 5]); // 5人 → [3,2]
  const prev = [
    { leaderId: "gone", memberIds: ["p0", "p1", "gone", "p2"], locked: ["p1"] },
    { leaderId: "p0", memberIds: ["p0", "p3"], locked: [] },
    { leaderId: "p4", memberIds: ["p4"], locked: [] },
  ];
  const g = Core.normalizeGroups(prev, players, true);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { leaderId: null, memberIds: ["p1", "p2"], locked: ["p1"] });
  assert.deepEqual(g[1], { leaderId: "p0", memberIds: ["p0", "p3"], locked: [] });
});

test("normalizeGroups: 先頭は他の組の固定より優先、定員を超えた分は外れる", () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8]); // [4,4]
  const prev = [
    { leaderId: null, memberIds: ["p0", "p1", "p2", "p3"], locked: ["p3"] },
    { leaderId: "p3", memberIds: ["p4", "p5", "p6", "p7"], locked: [] },
  ];
  const g = Core.normalizeGroups(prev, players, true);
  assert.deepEqual(g[0], { leaderId: null, memberIds: ["p0", "p1", "p2"], locked: [] });
  assert.deepEqual(g[1].memberIds, ["p3", "p4", "p5", "p6"]);
});

test("normalizeGroups: keepMembers=false なら先頭と固定だけ残す", () => {
  const players = makePlayers([1, 2, 3, 4]);
  const g = Core.normalizeGroups([{ leaderId: "p2", memberIds: ["p2", "p0", "p1", "p3"], locked: ["p1"] }], players, false);
  assert.deepEqual(g, [{ leaderId: "p2", memberIds: ["p2", "p1"], locked: ["p1"] }]);
});

for (const mode of ["balanced", "random", "hcOrder"]) {
  test(`assign(${mode}): 全員がちょうど1回ずつ、組の人数は groupSizes どおり`, () => {
    const players = makePlayers([10, 20, null, 5, 30, 15, 8, null, 25, 12, 18]);
    const groups = Core.assign(players, [], mode, seededRng(1), false);
    assert.deepEqual(groups.map((g) => g.memberIds.length), Core.groupSizes(11));
    assert.deepEqual(flat(groups).sort(), players.map((p) => p.id).sort());
  });

  test(`assign(${mode}): 先頭と固定メンバーは動かない`, () => {
    const players = makePlayers([10, 20, 30, 5, 15, 25, 8, 12]);
    const prev = [
      { leaderId: "p7", memberIds: [], locked: [] },
      { leaderId: "p0", memberIds: [], locked: ["p1"] },
    ];
    for (let seed = 1; seed <= 5; seed++) {
      const g = Core.assign(players, prev, mode, seededRng(seed), false);
      assert.equal(g[0].leaderId, "p7");
      assert.equal(g[0].memberIds[0], "p7");
      assert.equal(g[1].leaderId, "p0");
      assert.deepEqual(g[1].memberIds.slice(0, 2), ["p0", "p1"]);
      assert.deepEqual(g[1].locked, ["p1"]);
    }
  });
}

test("assign: 同じシードなら同じ結果、違うシードなら別案が出る", () => {
  const players = makePlayers([10, 10, 10, 10, 10, 10, 10, 10]);
  const a = Core.assign(players, [], "balanced", seededRng(1), false);
  const b = Core.assign(players, [], "balanced", seededRng(1), false);
  assert.deepEqual(a, b);
  const variants = new Set();
  for (let s = 1; s <= 10; s++) variants.add(JSON.stringify(Core.assign(players, [], "balanced", seededRng(s), false)));
  assert.ok(variants.size > 1);
});

test("assign(balanced): 組ごとの HC 平均の差が小さい", () => {
  const players = makePlayers([0, 5, 10, 15, 20, 25, 30, 35, 2, 9, 28, 18]);
  for (let s = 1; s <= 5; s++) {
    const g = Core.assign(players, [], "balanced", seededRng(s), false);
    const avgs = g.map((x) => Core.groupStats(x.memberIds, players).hcAvg);
    assert.ok(Math.max(...avgs) - Math.min(...avgs) <= 3, avgs.join(","));
  }
});

test("assign(hcOrder): HC の近い人が同じ組、HC なしは最後", () => {
  const players = makePlayers([30, null, 5, 20, 10, 25, 0, 15]);
  const g = Core.assign(players, [], "hcOrder", seededRng(1), false);
  assert.deepEqual(g.map((x) => x.memberIds), [["p6", "p2", "p4", "p7"], ["p3", "p5", "p0", "p1"]]);
});

test("assign(keepMembers): 今の組を崩さず、未割当の人だけ空き枠へ", () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7]); // [4,3]
  const prev = [
    { leaderId: null, memberIds: ["p0", "p1", "p2"], locked: [] },
    { leaderId: null, memberIds: ["p3", "p4", "p5"], locked: [] },
  ];
  const g = Core.assign(players, prev, "random", seededRng(1), true);
  assert.deepEqual(g[0].memberIds, ["p0", "p1", "p2", "p6"]);
  assert.deepEqual(g[1].memberIds, ["p3", "p4", "p5"]);
});

test("assign: 参加者0人なら空配列", () => {
  assert.deepEqual(Core.assign([], [], "balanced", seededRng(1), false), []);
});

test("groupSizes(split): OUT・IN それぞれ最後の組を3人に（余りの1組は IN 側）", () => {
  const cases = {
    5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4], 9: [3, 3, 3], 10: [4, 3, 3], 11: [4, 4, 3],
    13: [4, 3, 3, 3], 14: [4, 3, 4, 3], 15: [4, 4, 4, 3], 17: [4, 4, 3, 3, 3], 18: [4, 4, 3, 4, 3], 22: [4, 4, 3, 4, 4, 3],
  };
  for (const [n, sizes] of Object.entries(cases)) assert.deepEqual(Core.groupSizes(Number(n), true), sizes, `n=${n}`);
});

test("groupSizes(split): 合計は同じで、各コース内は 4人組 → 3人組 の順", () => {
  for (let n = 6; n <= 40; n++) {
    const s = Core.groupSizes(n, true);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.deepEqual(s.slice().sort(), Core.groupSizes(n).slice().sort(), `n=${n}`);
    const half = Math.ceil(s.length / 2);
    for (const part of [s.slice(0, half), s.slice(half)]) {
      assert.deepEqual(part, part.slice().sort((a, b) => b - a), `n=${n}`);
    }
  }
});

test("assign(split): 組の人数が分割用の並びになる", () => {
  const players = makePlayers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const g = Core.assign(players, [], "random", seededRng(1), false, true);
  assert.deepEqual(g.map((x) => x.memberIds.length), [4, 3, 4, 3]);
  assert.equal(Core.normalizeGroups(g, players, true, true)[1].memberIds.length, 3);
});
