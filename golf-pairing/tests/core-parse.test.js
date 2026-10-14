"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

test("parsePasted: タブ区切り（Excel コピー）で氏名と HC を読む", () => {
  const r = Core.parsePasted("山田　太郎\t12\n鈴木 花子\t20.5\r\n佐藤一郎\t\n");
  assert.deepEqual(r.players, [
    { name: "山田　太郎", hc: 12 },
    { name: "鈴木 花子", hc: 20.5 },
    { name: "佐藤一郎", hc: null },
  ]);
  assert.deepEqual(r.errors, []);
});

test("parsePasted: 見出し行を飛ばす", () => {
  assert.equal(Core.parsePasted("氏名\tHC\n山田\t10").players.length, 1);
  assert.equal(Core.parsePasted("名前\n山田").players.length, 1);
  assert.equal(Core.parsePasted("参加者\tハンデ\n山田\t10").players.length, 1);
  assert.equal(Core.parsePasted("Name\tHandicap\n山田\t10").players.length, 1);
});

test("parsePasted: 見出しでない1行目は残す", () => {
  assert.deepEqual(Core.parsePasted("山田\t10\n鈴木\t5").players.map((p) => p.name), ["山田", "鈴木"]);
});

test("parsePasted: カンマ区切りと全角数字", () => {
  assert.deepEqual(Core.parsePasted("山田,１２．５\n鈴木，８").players, [
    { name: "山田", hc: 12.5 },
    { name: "鈴木", hc: 8 },
  ]);
});

test("parsePasted: 氏名だけの列も読める", () => {
  assert.deepEqual(Core.parsePasted("山田\n鈴木").players, [
    { name: "山田", hc: null },
    { name: "鈴木", hc: null },
  ]);
});

test("parsePasted: 数値でない HC は空欄にして行番号付きで知らせる", () => {
  const r = Core.parsePasted("山田\t10\n鈴木\tなし");
  assert.deepEqual(r.players[1], { name: "鈴木", hc: null });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^2行目/);
});

test("parsePasted: 空行は無視、氏名なしの行と重複（空白は無視して比較）は知らせる", () => {
  const r = Core.parsePasted("山田\t10\n\n\t5\n山 田\t3");
  assert.equal(r.players.length, 2);
  assert.match(r.errors[0], /^3行目: 氏名が空/);
  assert.match(r.errors[1], /^4行目: 「山 田」が重複/);
});

test("parsePasted: 空文字・null でも落ちない", () => {
  assert.deepEqual(Core.parsePasted(""), { players: [], errors: [] });
  assert.deepEqual(Core.parsePasted(null), { players: [], errors: [] });
});
