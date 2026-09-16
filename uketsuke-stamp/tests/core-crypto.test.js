"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

test("randomSaltB64: 16 byte の base64 で毎回違う", () => {
  const a = Core.randomSaltB64();
  const b = Core.randomSaltB64();
  assert.equal(Buffer.from(a, "base64").length, 16);
  assert.notEqual(a, b);
});

test("encryptJson/decryptJson: 往復できて、毎回違う暗号文になる", async () => {
  const salt = Core.randomSaltB64();
  const key = await Core.deriveKey("ひみつ123", salt);
  const value = { people: [{ name: "山田　太郎", dept: "総務部" }], n: 1 };
  const c1 = await Core.encryptJson(key, value);
  const c2 = await Core.encryptJson(key, value);
  assert.match(c1, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.notEqual(c1, c2);
  assert.deepEqual(await Core.decryptJson(key, c1), value);
  assert.ok(!c1.includes("山田"));
});

test("verifyKey: 正しいパスフレーズなら true、違えば false", async () => {
  const salt = Core.randomSaltB64();
  const key = await Core.deriveKey("正しい", salt);
  const check = await Core.makeCheck(key);
  assert.equal(await Core.verifyKey(key, check), true);
  const wrong = await Core.deriveKey("間違い", salt);
  assert.equal(await Core.verifyKey(wrong, check), false);
  assert.equal(await Core.verifyKey(key, "garbage"), false);
});

test("personId: 同じ入力なら同じ ID、鍵・部署・氏名・連番のどれかが違えば別 ID", async () => {
  const salt = Core.randomSaltB64();
  const k1 = await Core.deriveKey("A", salt);
  const k2 = await Core.deriveKey("B", salt);
  const id = await Core.personId(k1, "総務部", "山田　太郎", 0);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(await Core.personId(k1, "総務部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k2, "総務部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k1, "経理部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k1, "総務部", "山田　次郎", 0), id);
  assert.notEqual(await Core.personId(k1, "総務部", "山田　太郎", 1), id);
});

test("sortPeople: 部署順→行順に並ぶ", () => {
  const people = [
    { deptOrder: 2, row: 6, name: "b" },
    { deptOrder: 1, row: 9, name: "a2" },
    { deptOrder: 1, row: 6, name: "a1" },
  ];
  assert.deepEqual(Core.sortPeople(people).map((p) => p.name), ["a1", "a2", "b"]);
  assert.equal(people[0].name, "b"); // 元の配列は変えない
});

test("assignIds: 同姓同名は同一部署内で行順に連番、再実行しても同じ ID", async () => {
  const key = await Core.deriveKey("pass", Core.randomSaltB64());
  const people = [
    { deptOrder: 1, dept: "甲部", sheetName: "01 甲部", row: 8, name: "山田　太郎", title: "", plan: "yes" },
    { deptOrder: 1, dept: "甲部", sheetName: "01 甲部", row: 6, name: "山田　太郎", title: "", plan: "no" },
    { deptOrder: 2, dept: "乙部", sheetName: "02 乙部", row: 6, name: "山田　太郎", title: "", plan: "yes" },
  ];
  const a = await Core.assignIds(key, people);
  assert.deepEqual(a.map((p) => [p.dept, p.row]), [["甲部", 6], ["甲部", 8], ["乙部", 6]]);
  assert.equal(a[0].id, await Core.personId(key, "甲部", "山田　太郎", 0));
  assert.equal(a[1].id, await Core.personId(key, "甲部", "山田　太郎", 1));
  assert.equal(a[2].id, await Core.personId(key, "乙部", "山田　太郎", 0));
  assert.equal(new Set(a.map((p) => p.id)).size, 3);
  const again = await Core.assignIds(key, people);
  assert.deepEqual(again.map((p) => p.id), a.map((p) => p.id));
  assert.equal(people[0].id, undefined); // 入力は変えない
});
