"use strict";

// 再現できる乱数（mulberry32）。assign の結果をテストで固定するために使う。
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// HC の配列から参加者を作る（id: p0, p1 ... / name: 選手0, 選手1 ...）
function makePlayers(hcs) {
  return hcs.map((hc, i) => ({ id: "p" + i, name: "選手" + i, hc }));
}

module.exports = { seededRng, makePlayers };
