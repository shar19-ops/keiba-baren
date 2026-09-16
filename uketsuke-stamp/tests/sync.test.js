"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SyncStore, PENDING_KEY } = require("../sync");
const { FakeDb, MemoryStorage } = require("./helpers");

const tick = () => new Promise((r) => setImmediate(r));

// 再送タイマーを手動で発火させるためのタイマー差し替え
function manualTimer() {
  const timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    fire: () => { const t = timers.shift(); if (t) t.fn(); },
    count: () => timers.length,
  };
}

function makeStore(db, opts) {
  const timer = manualTimer();
  const storage = (opts && opts.storage) || new MemoryStorage();
  const store = new SyncStore(Object.assign({ db, storage, retryMs: 5000, setTimer: timer.setTimer, clearTimer: timer.clearTimer }, opts));
  return { store, timer, storage };
}

test("start: 購読結果が records に入り、ready になる", async () => {
  const db = new FakeDb();
  db.data.set("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  const { store } = makeStore(db);
  let changes = 0;
  store.onChange(() => changes++);
  assert.equal(store.ready, false);
  store.start();
  await tick();
  assert.equal(store.ready, true);
  assert.ok(changes >= 1);
  assert.deepEqual(store.get("p1"), { pid: "p1", t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(store.has("p1"), true);
  assert.equal(store.has("p2"), false);
  store.stop();
});

test("checkIn: 書込が成功するとキューが空になり、他端末の購読にも届く", async () => {
  const db = new FakeDb();
  const a = makeStore(db);
  const b = makeStore(db);
  a.store.start(); b.store.start();
  await tick();
  await a.store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(a.store.pendingCount, 0);
  assert.equal(db.data.get("p1").dev, "受付1");
  await tick();
  assert.equal(b.store.has("p1"), true);
  assert.equal(b.store.get("p1").dev, "受付1");
  a.store.stop(); b.store.stop();
});

test("2 台が同じ ID を書いても 1 件になる", async () => {
  const db = new FakeDb();
  const a = makeStore(db);
  const b = makeStore(db);
  a.store.start(); b.store.start();
  await tick();
  await Promise.all([
    a.store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" }),
    b.store.checkIn("p1", { t: "2026-10-01T04:00:01.000Z", dev: "受付2", kind: "qr" }),
  ]);
  await tick();
  assert.equal(db.data.size, 1);
  assert.equal(a.store.all().length, 1);
  assert.equal(b.store.all().length, 1);
  a.store.stop(); b.store.stop();
});

test("書込失敗: キューに残り、has() は true、再送タイマーで復帰後に送られる", async () => {
  const db = new FakeDb();
  const { store, timer, storage } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 1;
  await store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(store.pendingCount, 1);
  assert.equal(store.has("p1"), true); // 画面上は受付済み扱い
  assert.equal(db.data.size, 0);
  assert.equal(timer.count(), 1);
  // 端末内に永続化されている
  assert.equal(JSON.parse(storage.getItem(PENDING_KEY)).length, 1);
  // 復帰
  timer.fire();
  await tick(); await tick();
  assert.equal(store.pendingCount, 0);
  assert.equal(db.data.size, 1);
  assert.equal(JSON.parse(storage.getItem(PENDING_KEY)).length, 0);
  store.stop();
});

test("再起動: 端末内に残った未送信分を start 時に送る", async () => {
  const db = new FakeDb();
  const storage = new MemoryStorage();
  storage.setItem(PENDING_KEY, JSON.stringify([{ op: "set", id: "p9", data: { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" } }]));
  const { store } = makeStore(db, { storage });
  assert.equal(store.pendingCount, 1);
  store.start();
  await tick(); await tick();
  assert.equal(store.pendingCount, 0);
  assert.equal(db.data.has("p9"), true);
  store.stop();
});

test("cancel: 削除され、未確定の間も get() は null", async () => {
  const db = new FakeDb();
  db.data.set("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  const { store } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 1;
  await store.cancel("p1");
  assert.equal(store.get("p1"), null);
  assert.equal(store.all().length, 0);
  assert.equal(db.data.has("p1"), true); // まだサーバには残っている
  store.stop();
});

test("同じ ID への操作はキュー内で最後の 1 件にまとまる", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 5;
  await store.checkIn("p1", { t: "a", dev: "受付1", kind: "qr" });
  await store.cancel("p1");
  await store.checkIn("p1", { t: "b", dev: "受付1", kind: "manual" });
  assert.equal(store.pendingCount, 1);
  assert.equal(store.get("p1").kind, "manual");
  store.stop();
});

test("購読エラーは error に入り onChange が呼ばれる", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  let notified = 0;
  store.onChange(() => notified++);
  store.start();
  await tick();
  const l = Array.from(db.listeners)[0];
  l.error({ code: "revoked", message: "gone" });
  assert.equal(store.error.code, "revoked");
  assert.ok(notified >= 2);
  store.stop();
});

test("書込中に同じ ID への取消が来ても失われない", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  store.start();
  await tick();
  const p1 = store.checkIn("p1", { t: "a", dev: "受付1", kind: "qr" }); // await しない
  const p2 = store.cancel("p1");                                          // 書込中に取消
  await Promise.all([p1, p2]);
  await tick();
  assert.equal(store.pendingCount, 0);
  assert.equal(db.data.has("p1"), false);
  assert.equal(store.get("p1"), null);
  store.stop();
});

test("購読が復帰したら error が消える", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  store.start();
  await tick();
  Array.from(db.listeners)[0].error({ code: "revoked", message: "gone" });
  assert.equal(store.error.code, "revoked");
  store.stop();
  store.start();
  await tick();
  assert.equal(store.error, null);
  store.stop();
});

test("flush 中の checkIn を await すると、その書込が終わってから解決する", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  store.start();
  await tick();
  store.checkIn("a", { t: "a", dev: "受付1", kind: "qr" }); // await しない
  await store.checkIn("b", { t: "b", dev: "受付1", kind: "qr" });
  assert.equal(db.data.has("b"), true);
  assert.equal(store.pendingCount, 0);
  store.stop();
});
