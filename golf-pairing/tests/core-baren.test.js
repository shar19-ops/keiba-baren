"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { makePlayers } = require("./helpers");

test("barenRace: 組の順・組の中の順で出走者にし、枠は組番号、HC はハンデ", () => {
  const players = makePlayers([12, null, 20, 8, 30]);
  const groups = [{ memberIds: ["p2", "p0"] }, { memberIds: ["p4", "p1"] }];
  const r = Core.barenRace(groups, players, "第114回雄J会 組合せ表").races[0];
  assert.equal(r.name, "第114回雄J会");
  assert.equal(r.gameStyle, "hande");
  assert.equal(r.betType, "umaren");
  assert.deepEqual(r.votes, []);
  assert.deepEqual(r.resultOrder, []);
  assert.deepEqual(r.horses, [
    { id: 1, name: "選手2", waku: 1, hande: 20, sortOrder: 1 },
    { id: 2, name: "選手0", waku: 1, hande: 12, sortOrder: 2 },
    { id: 3, name: "選手4", waku: 2, hande: 30, sortOrder: 3 },
    { id: 4, name: "選手1", waku: 2, hande: null, sortOrder: 4 },
    { id: 5, name: "選手3", waku: null, hande: 8, sortOrder: 5 }, // 未割当は枠なしで最後
  ]);
});

test("barenRace: HC が誰にも無ければ新ペリア、表題が空ならゴルフコンペ", () => {
  const players = makePlayers([null, null]);
  const r = Core.barenRace([{ memberIds: ["p0", "p1"] }], players, "").races[0];
  assert.equal(r.gameStyle, "shinperia");
  assert.equal(r.name, "ゴルフコンペ");
});

test("barenRace: 9組目以降も枠番を付ける", () => {
  const players = makePlayers(Array.from({ length: 36 }, (_, i) => i));
  const groups = Array.from({ length: 9 }, (_, g) => ({ memberIds: [0, 1, 2, 3].map((k) => "p" + (g * 4 + k)) }));
  const r = Core.barenRace(groups, players, "第1回 雄J会　組み合わせ表").races[0];
  assert.equal(r.name, "第1回 雄J会");
  assert.deepEqual([...new Set(r.horses.map((h) => h.waku))], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(r.horses.length, 36);
});
