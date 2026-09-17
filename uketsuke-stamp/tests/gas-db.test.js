"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GasDb } = require("../gas-db");

// Google Apps Script バックエンドの偽実装。gas-backend.gs の doGet/doPost と同じ形の
// JSON をやり取りする(実物には繋がないので、往復の契約だけをここで検証する)。
class FakeBackend {
  constructor() {
    this.event = null;
    this.roster = null;
    this.checkins = {};
    this.failNext = 0;
    this.calls = [];
  }
  state() { return { event: this.event, roster: this.roster, checkins: this.checkins }; }
  fetch(url, init) {
    this.calls.push({ url, init });
    if (this.failNext > 0) { this.failNext--; return Promise.resolve({ ok: false, status: 500 }); }
    if (!init) { // GET
      return Promise.resolve({ ok: true, json: () => Promise.resolve(this.state()) });
    }
    const body = JSON.parse(init.body);
    if (body.action === "setDoc") {
      if (body.path === "event/current") this.event = body.data;
      if (body.path === "roster/current") this.roster = body.data;
    } else if (body.action === "deleteDoc") {
      if (body.path === "event/current") this.event = null;
      if (body.path === "roster/current") this.roster = null;
    } else if (body.action === "colSet" && body.collection === "checkins") {
      this.checkins[body.id] = body.data;
    } else if (body.action === "colDelete" && body.collection === "checkins") {
      delete this.checkins[body.id];
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(this.state()) });
  }
}

function makeDb(backend, opts) {
  return new GasDb(Object.assign({ url: "https://script.google.com/x/exec", fetch: backend.fetch.bind(backend) }, opts));
}

test("refresh: event/roster/checkins が doc・collection の購読に届く", async () => {
  const backend = new FakeBackend();
  backend.event = { title: "秋の会" };
  backend.checkins = { p1: { t: "a", dev: "受付1", kind: "qr" } };
  const db = makeDb(backend);

  let evSnap = null, colSnap = null;
  db.doc("event/current").onSnapshot((snap) => { evSnap = snap; });
  db.collection("checkins").onSnapshot((snap) => { colSnap = snap; });

  await db.refresh();
  assert.equal(evSnap.exists, true);
  assert.deepEqual(evSnap.data(), { title: "秋の会" });
  assert.equal(colSnap.docs.length, 1);
  assert.equal(colSnap.docs[0].id, "p1");
  assert.deepEqual(colSnap.docs[0].data(), { t: "a", dev: "受付1", kind: "qr" });
});

test("doc が無い時は exists:false, data():null", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  let snap = null;
  db.doc("roster/current").onSnapshot((s) => { snap = s; });
  await db.refresh();
  assert.equal(snap.exists, false);
  assert.equal(snap.data(), null);
});

test("doc().set() / delete() が反映され、購読にも届く", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  let snap = null;
  db.doc("event/current").onSnapshot((s) => { snap = s; });
  await db.refresh();

  await db.doc("event/current").set({ title: "第1回" });
  assert.equal(snap.exists, true);
  assert.equal(snap.data().title, "第1回");
  assert.equal(backend.event.title, "第1回");

  await db.doc("event/current").delete();
  assert.equal(snap.exists, false);
  assert.equal(backend.event, null);
});

test("collection().doc().set()/delete() が反映される", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  await db.collection("checkins").doc("p1").set({ t: "a", dev: "受付1", kind: "qr" });
  assert.deepEqual(backend.checkins.p1, { t: "a", dev: "受付1", kind: "qr" });
  await db.collection("checkins").doc("p1").delete();
  assert.equal(backend.checkins.p1, undefined);
});

test("collection().get() は最新状態を取り直して id 一覧を返す", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  backend.checkins = { p1: {}, p2: {} };
  const { docs } = await db.collection("checkins").get();
  assert.deepEqual(docs.map((d) => d.id).sort(), ["p1", "p2"]);
});

test("書込失敗は code:'unavailable' で reject される(sync.js の再送対象コードと一致)", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  backend.failNext = 1;
  await assert.rejects(
    () => db.doc("event/current").set({ title: "x" }),
    (e) => e.code === "unavailable"
  );
});

test("購読エラーは失敗が続く間は1回だけ通知され、復帰したら再び通知できる", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  let errors = 0;
  db.doc("event/current").onSnapshot(() => {}, () => { errors++; });

  backend.failNext = 3;
  await assert.rejects(() => db.refresh());
  await assert.rejects(() => db.refresh());
  await assert.rejects(() => db.refresh());
  assert.equal(errors, 1); // 連続失敗中はトースト等のスパムを避けるため1回だけ

  await db.refresh(); // 復帰
  backend.failNext = 1;
  await assert.rejects(() => db.refresh());
  assert.equal(errors, 2); // 復帰後にまた失敗したら再通知される
});

test("onSnapshot の解除後は通知が来ない", async () => {
  const backend = new FakeBackend();
  const db = makeDb(backend);
  let count = 0;
  const unsub = db.doc("event/current").onSnapshot(() => { count++; });
  await db.refresh();
  assert.equal(count, 1);
  unsub();
  await db.refresh();
  assert.equal(count, 1);
});

test("start/stop: 定期的に refresh が呼ばれ、stop すると止まる", async () => {
  const backend = new FakeBackend();
  const timers = [];
  const db = makeDb(backend, {
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }
  });
  let ticks = 0;
  db.doc("event/current").onSnapshot(() => { ticks++; });
  db.start();
  await db._inflight; // 初回 refresh の完了を待つ
  assert.equal(ticks, 1);
  assert.equal(timers.length, 1);
  timers[0].fn();
  await db._inflight;
  assert.equal(ticks, 2);
  db.stop();
  assert.equal(timers.length, 0);
});
