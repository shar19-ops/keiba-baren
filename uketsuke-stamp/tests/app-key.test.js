"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryStorage } = require("./helpers");

// app.js はブラウザの window / document / localStorage を前提にしているので、
// DOM 無しで読み込めるよう最小限のシムを用意する。
globalThis.window = globalThis;
globalThis.document = {
  getElementById: () => ({ classList: { add() {}, remove() {}, toggle() {} }, textContent: "" }),
  querySelectorAll: () => [],
};
globalThis.localStorage = new MemoryStorage();

// core.js / sync.js は Node では module.exports 側の分岐を通るので、
// window.UketsukeCore / window.UketsukeSync には自動では乗らない。app.js が
// それらを読む前に、ここで明示的に window へ載せておく。
globalThis.window.UketsukeCore = require("../core.js");
globalThis.window.UketsukeSync = require("../sync.js");
require("../app.js");

const App = globalThis.window.App;
const Core = globalThis.window.UketsukeCore;

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

test("applyKey: 検証中にイベントが差し替わっても正しいパスフレーズを消さず、新イベントへやり直す", async () => {
  const salt1 = Core.randomSaltB64();
  const key1 = await Core.deriveKey("a", salt1);
  const check1 = await Core.makeCheck(key1);

  const salt2 = Core.randomSaltB64();
  const key2 = await Core.deriveKey("a", salt2);
  const check2 = await Core.makeCheck(key2);

  App.storageSet(App.KEYS.pass, "a");
  App.state.event = { salt: salt1, check: check1 };

  const p = App.applyKey("a");
  // deriveKey/verifyKey の await をまたいで、検証中にイベントが差し替わる(同じパスフレーズで有効な新イベント)
  App.state.event = { salt: salt2, check: check2 };

  const result = await p;
  assert.equal(result, false);
  assert.equal(App.storageGet(App.KEYS.pass), "a"); // 正しいパスフレーズを誤って消していない

  // discard 分岐が内部で起動する syncKeyWithEvent のやり直しを待つ
  await delay(300);

  assert.equal(App.state.keyStatus, "ok");
  assert.equal(App.state.keySalt, salt2);
  assert.equal(App.storageGet(App.KEYS.pass), "a");
});

test("loadRoster: 復号が終わる前に forgetKey が呼ばれたら、後から届く結果で平文を復活させない", async () => {
  const salt = Core.randomSaltB64();
  const key = await Core.deriveKey("pw", salt);
  const blob = await Core.encryptJson(key, { people: [], sheets: [] });

  App.state.key = key;
  App.state.rosterDoc = { blob: blob };

  const p = App.loadRoster();
  App.forgetKey(); // 復号中に鍵を忘れる(明示的なロック)

  await p;
  assert.equal(App.state.roster, null);
});
