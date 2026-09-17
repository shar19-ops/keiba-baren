"use strict";
const path = require("path");
const XLSX = require("xlsx");

const FIXTURE = path.join(__dirname, "fixtures", "sample-出欠表.xlsx");

function loadFixture() {
  return XLSX.readFile(FIXTURE);
}

// aoa: 2次元配列(null は空セル)。merges: [{s:{r,c}, e:{r,c}}]
function makeSheet(aoa, merges) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges && merges.length) ws["!merges"] = merges;
  return ws;
}

function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(function (s) {
    XLSX.utils.book_append_sheet(wb, makeSheet(s.aoa, s.merges), s.name);
  });
  return wb;
}

// 結合範囲を短く書くためのヘルパ: m("A5:AK5") → {s:{r:4,c:0}, e:{r:4,c:36}}
function m(range) {
  return XLSX.utils.decode_range(range);
}

// 実ファイルと同じ形の部署シートを合成する。people: [{name, title, plan}]
// opts.extraRows: 見出し行の前に挟む追加行数(見出し行を下にずらすテスト用)
// opts.order: 見出しの並び ["name","title","plan","day"] を入れ替えるテスト用
function deptSheetAoa(people, opts) {
  opts = opts || {};
  const order = opts.order || ["name", "title", "plan", "day"];
  const labels = { name: "氏　名", title: "役職", plan: "出欠席\r\n予定", day: "当日\r\n出欠席" };
  const cols = { name: 0, title: 6, plan: 10, day: 13 }; // A, G, K, N
  const aoa = [];
  aoa.push(["第48回改善事例発表会出欠表"]);
  aoa.push(["2026年10月1日（木）　13:30　開始"]);
  aoa.push(["スクエア荏原　イベントホール"]);
  for (let i = 0; i < (opts.extraRows || 0); i++) aoa.push([null]);
  const header = [];
  order.forEach(function (key, i) {
    header[Object.values(cols)[i]] = labels[key];
  });
  aoa.push(header);
  const colOf = {};
  order.forEach(function (key, i) { colOf[key] = Object.values(cols)[i]; });
  people.forEach(function (p) {
    const row = [];
    row[colOf.name] = p.name;
    row[colOf.title] = p.title || null;
    row[colOf.plan] = p.plan || null;
    aoa.push(row);
  });
  return { aoa: aoa, colOf: colOf, headerIndex: 3 + (opts.extraRows || 0) };
}

// Artifact db の checkins コレクションだけを真似た偽 DB。
// failNext を n にすると次の n 回の書込が code:"unavailable" で失敗する。
class FakeDb {
  constructor() {
    this.data = new Map();
    this.listeners = new Set();
    this.failNext = 0;
    this.failCode = "unavailable";
    this.writes = 0;
  }
  _maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      const e = new Error(this.failCode);
      e.code = this.failCode;
      throw e;
    }
  }
  _snap() {
    const docs = Array.from(this.data.entries()).map(([id, d]) => ({ id, exists: true, data: () => d }));
    return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [] };
  }
  _notify() {
    this.listeners.forEach((l) => l.next(this._snap()));
  }
  collection(path) {
    if (path !== "checkins") throw new Error("FakeDb は checkins だけ対応: " + path);
    const self = this;
    return {
      doc(id) {
        return {
          id,
          async set(data) { self._maybeFail(); self.writes++; self.data.set(id, JSON.parse(JSON.stringify(data))); self._notify(); },
          async delete() { self._maybeFail(); self.writes++; self.data.delete(id); self._notify(); },
        };
      },
      onSnapshot(next, error) {
        const l = { next, error };
        self.listeners.add(l);
        Promise.resolve().then(() => { if (self.listeners.has(l)) next(self._snap()); });
        return () => self.listeners.delete(l);
      },
      async get() { return self._snap(); },
    };
  }
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

module.exports = { XLSX, FIXTURE, loadFixture, makeSheet, makeWorkbook, m, deptSheetAoa, FakeDb, MemoryStorage };
