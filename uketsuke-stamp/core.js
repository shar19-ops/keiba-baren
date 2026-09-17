/* 受付スタンプ core: ブラウザ / Node 両対応の純粋関数 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UketsukeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 文字列・シート名 ----------
  function toHalfWidthDigits(s) {
    return String(s).replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  }

  function parseSheetName(name) {
    var m = /^([0-9０-９]+)[\s　]+(.+)$/.exec(String(name));
    if (!m) return null;
    return { deptOrder: parseInt(toHalfWidthDigits(m[1]), 10), dept: m[2].trim() };
  }

  function normalizeLabel(v) {
    return String(v == null ? "" : v).replace(/[\s　]/g, "");
  }

  function normalizePlan(v) {
    var s = normalizeLabel(v);
    if (/^[〇○◯oO]$/.test(s)) return "yes";
    if (/^[×xX✕]$/.test(s)) return "no";
    return "unknown";
  }

  function formatPlan(plan) {
    return plan === "yes" ? "〇" : plan === "no" ? "×" : "";
  }

  function colLetter(idx) {
    var s = "";
    idx = idx + 1;
    while (idx > 0) {
      var r = (idx - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  }

  // ---------- 見出し行 ----------
  var LABELS = { name: "氏名", title: "役職", plan: "出欠席予定", day: "当日出欠席" };

  function findHeader(rows) {
    var limit = Math.min(rows.length, 10);
    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var cols = {};
      for (var c = 0; c < row.length; c++) {
        var label = normalizeLabel(row[c]);
        if (!label) continue;
        Object.keys(LABELS).forEach(function (key) {
          if (cols[key] === undefined && label.indexOf(LABELS[key]) === 0) cols[key] = c;
        });
      }
      if (cols.name !== undefined && cols.title !== undefined && cols.plan !== undefined) {
        return { headerRow: r, nameCol: cols.name, titleCol: cols.title, planCol: cols.plan, dayCol: cols.day === undefined ? null : cols.day };
      }
    }
    return null;
  }

  // ---------- ブック全体 ----------
  function cellText(v) {
    return String(v == null ? "" : v).trim();
  }

  var SUBTOTAL_RE = /^(計|小計|合計|総計|人数|出席者数|欠席者数)$/;

  function mergeAt(merges, r, c) {
    for (var i = 0; i < merges.length; i++) {
      var mg = merges[i];
      if (mg.s.r <= r && r <= mg.e.r && mg.s.c <= c && c <= mg.e.c) return mg;
    }
    return null;
  }

  function parseWorkbook(wb, XLSX) {
    var result = { event: { title: "", dateText: "", venue: "" }, sheets: [], people: [], warnings: [] };
    var eventTaken = false;
    wb.SheetNames.forEach(function (sheetName, sheetIndex) {
      var parsed = parseSheetName(sheetName);
      if (!parsed) return;
      var ws = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      var header = findHeader(rows);
      if (!header) {
        result.warnings.push("シート「" + sheetName + "」: 見出し行(氏名・役職・出欠席予定)が見つからないため読み飛ばしました");
        return;
      }
      if (!eventTaken) {
        eventTaken = true;
        var above = [];
        for (var a = 0; a < header.headerRow; a++) above.push(cellText((rows[a] || [])[0]));
        result.event.title = above[0] || "";
        result.event.dateText = above[1] || "";
        result.event.venue = above[2] || "";
      }
      var merges = ws["!merges"] || [];
      var otherCols = [header.titleCol, header.planCol];
      var firstRow = null, lastRow = null;
      for (var r = header.headerRow + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var raw = row[header.nameCol];
        if (raw === "" || raw === undefined || raw === null) continue;
        var mg = mergeAt(merges, r, header.nameCol);
        if (mg && otherCols.some(function (c) { return mg.s.c <= c && c <= mg.e.c; })) continue; // 全幅結合: 小見出し / 注意書き
        if (typeof raw !== "string") {
          result.warnings.push("シート「" + sheetName + "」" + (r + 1) + " 行: 氏名が文字列でないため読み飛ばしました");
          continue;
        }
        var name = raw.trim();
        if (!name) continue;
        if (SUBTOTAL_RE.test(normalizeLabel(name))) continue; // 「計（ n 名）」などの小計行
        if (name.length > 20) {
          result.warnings.push("シート「" + sheetName + "」" + (r + 1) + " 行: 氏名が長すぎるため読み飛ばしました");
          continue;
        }
        result.people.push({
          deptOrder: parsed.deptOrder,
          dept: parsed.dept,
          sheetName: sheetName,
          sheetIndex: sheetIndex,
          row: r + 1,
          name: name,
          title: cellText(row[header.titleCol]),
          plan: normalizePlan(row[header.planCol])
        });
        if (firstRow === null) firstRow = r + 1;
        lastRow = r + 1;
      }
      result.sheets.push({
        sheetName: sheetName,
        deptOrder: parsed.deptOrder,
        dept: parsed.dept,
        sheetIndex: sheetIndex,
        headerRow: header.headerRow + 1,
        nameCol: colLetter(header.nameCol),
        titleCol: colLetter(header.titleCol),
        planCol: colLetter(header.planCol),
        dayCol: header.dayCol === null ? null : colLetter(header.dayCol),
        firstRow: firstRow,
        lastRow: lastRow
      });
    });
    if (!result.sheets.length) throw new Error("部署シート(番号+部署名)が見つかりません");
    return result;
  }

  // ---------- バイト列ユーティリティ ----------
  var subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();

  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  // ---------- 鍵・暗号化 ----------
  var PBKDF2_ITER = 200000;
  var CHECK_PLAIN = "uketsuke-ok";
  var ID_SEP = String.fromCharCode(0x1f); // U+001F unit separator (kept visible; editors strip the raw byte)

  function randomSaltB64() {
    return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  }

  async function deriveKey(passphrase, saltB64) {
    var base = await subtle.importKey("raw", textEncoder.encode(String(passphrase)), "PBKDF2", false, ["deriveBits"]);
    var bits = new Uint8Array(await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(saltB64), iterations: PBKDF2_ITER }, base, 512));
    var aes = await subtle.importKey("raw", bits.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    var hmac = await subtle.importKey("raw", bits.slice(32, 64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { aes: aes, hmac: hmac };
  }

  async function encryptJson(key, value) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await subtle.encrypt({ name: "AES-GCM", iv: iv }, key.aes, textEncoder.encode(JSON.stringify(value)));
    return bytesToB64(iv) + "." + bytesToB64(new Uint8Array(ct));
  }

  async function decryptJson(key, str) {
    var parts = String(str).split(".");
    if (parts.length !== 2) throw new Error("暗号文の形式が不正です");
    var pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(parts[0]) }, key.aes, b64ToBytes(parts[1]));
    return JSON.parse(textDecoder.decode(pt));
  }

  function makeCheck(key) {
    return encryptJson(key, CHECK_PLAIN);
  }

  async function verifyKey(key, check) {
    try {
      return (await decryptJson(key, check)) === CHECK_PLAIN;
    } catch (e) {
      return false;
    }
  }

  async function personId(key, dept, name, n) {
    var msg = textEncoder.encode(dept + ID_SEP + name + ID_SEP + n);
    var sig = await subtle.sign("HMAC", key.hmac, msg);
    return bytesToHex(new Uint8Array(sig)).slice(0, 16);
  }

  function sortPeople(people) {
    return people.slice().sort(function (a, b) {
      return (a.deptOrder - b.deptOrder) || ((a.sheetIndex || 0) - (b.sheetIndex || 0)) || (a.row - b.row);
    });
  }

  async function assignIds(key, people) {
    var seen = {};
    var out = [];
    var sorted = sortPeople(people);
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var k = p.dept + ID_SEP + p.name;
      var n = seen[k] || 0;
      seen[k] = n + 1;
      out.push(Object.assign({}, p, { id: await personId(key, p.dept, p.name, n) }));
    }
    return out;
  }

  // ---------- 判定・集計 ----------
  var KIND_LABEL = { qr: "QR", manual: "名簿", walkin: "飛び入り" };

  function judge(plan, checked, listed) {
    if (!listed) return "名簿外";
    if (plan === "yes") return checked ? "" : "未受付";
    return checked ? "予定外出席" : "";
  }

  function indexById(people) {
    var map = {};
    (people || []).forEach(function (p) { map[p.id] = p; });
    return map;
  }

  function unlistedName(c) {
    return c.name || ("(名簿外 " + c.pid + ")");
  }

  function buildRows(roster, checkins) {
    var byId = indexById(roster.people);
    return (checkins || []).slice().sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); }).map(function (c) {
      var p = byId[c.pid];
      if (p) {
        return { pid: c.pid, name: p.name, dept: p.dept, title: p.title, plan: p.plan, t: c.t, dev: c.dev || "", kind: c.kind, judge: judge(p.plan, true, true), listed: true };
      }
      return { pid: c.pid, name: unlistedName(c), dept: c.dept || "", title: "", plan: "unknown", t: c.t, dev: c.dev || "", kind: c.kind, judge: "名簿外", listed: false };
    });
  }

  function summarize(roster, checkins) {
    var people = sortPeople(roster.people || []);
    var checked = {};
    (checkins || []).forEach(function (c) { checked[c.pid] = c; });
    var known = {};
    var total = { planYes: 0, checked: 0, missing: 0, unexpected: 0 };
    var depts = [];
    var deptIndex = {};
    people.forEach(function (p) {
      known[p.id] = true;
      var d = deptIndex[p.sheetName];
      if (!d) {
        d = { deptOrder: p.deptOrder, dept: p.dept, sheetName: p.sheetName, planYes: 0, checked: 0, missing: 0, unexpected: 0, missingPeople: [] };
        deptIndex[p.sheetName] = d;
        depts.push(d);
      }
      var isChecked = !!checked[p.id];
      var j = judge(p.plan, isChecked, true);
      if (p.plan === "yes") { d.planYes++; total.planYes++; }
      if (isChecked) { d.checked++; total.checked++; }
      if (j === "未受付") { d.missing++; total.missing++; d.missingPeople.push(p); }
      if (j === "予定外出席") { d.unexpected++; total.unexpected++; }
    });
    var unlisted = (checkins || []).filter(function (c) { return !known[c.pid]; })
      .sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); })
      .map(function (c) { return Object.assign({}, c, { name: unlistedName(c), dept: c.dept || "" }); });
    total.checked += unlisted.length;
    total.unexpected += unlisted.length;
    return { total: total, byDept: depts, unlisted: unlisted };
  }

  function searchPeople(people, query) {
    var q = normalizeLabel(query);
    var hits = (people || []).filter(function (p) {
      if (!q) return true;
      return normalizeLabel(p.name).indexOf(q) >= 0 || normalizeLabel(p.dept).indexOf(q) >= 0;
    });
    return sortPeople(hits);
  }

  function rosterDiff(oldPeople, newPeople) {
    var before = indexById(oldPeople);
    var after = indexById(newPeople);
    var diff = { added: 0, removed: 0, changed: 0 };
    Object.keys(after).forEach(function (id) {
      if (!before[id]) { diff.added++; return; }
      var a = before[id], b = after[id];
      if (a.plan !== b.plan || a.title !== b.title || a.row !== b.row) diff.changed++;
    });
    Object.keys(before).forEach(function (id) { if (!after[id]) diff.removed++; });
    return diff;
  }

  function walkinId() {
    return "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 書式 ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function formatClock(iso) {
    var d = toDate(iso);
    return d ? pad2(d.getHours()) + ":" + pad2(d.getMinutes()) : "";
  }
  function formatTime(iso) {
    var d = toDate(iso);
    return d ? formatClock(iso) + ":" + pad2(d.getSeconds()) : "";
  }
  function formatStamp(iso) {
    var d = toDate(iso);
    return d ? d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + formatTime(iso) : "";
  }

  // ---------- 書き出し ----------
  function csvEscape(v) {
    return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  }

  function buildCsv(roster, checkins) {
    var header = ["氏名", "部署", "役職", "出欠席予定", "受付時刻", "受付端末", "種別", "判定"];
    var lines = [header.map(csvEscape).join(",")];
    buildRows(roster, checkins).forEach(function (r) {
      lines.push([r.name, r.dept, r.title, formatPlan(r.plan), formatStamp(r.t), r.dev, KIND_LABEL[r.kind] || r.kind, r.judge].map(csvEscape).join(","));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  var EXPORT_HEADER = ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定"];

  function pasteHint(sheet) {
    if (sheet.dayCol && sheet.firstRow && sheet.lastRow) {
      return "→ 元ファイルの " + sheet.dayCol + sheet.firstRow + ":" + sheet.dayCol + sheet.lastRow + " に貼り付け";
    }
    return "→ 元ファイルの当日出欠席欄に貼り付け";
  }

  function buildExportSheets(roster, checkins, event) {
    var checked = {};
    (checkins || []).forEach(function (c) { checked[c.pid] = c; });
    var sheets = (roster.sheets || []).slice().sort(function (a, b) {
      return (a.deptOrder - b.deptOrder) || ((a.sheetIndex || 0) - (b.sheetIndex || 0));
    });
    var people = sortPeople(roster.people || []);
    var out = [];

    sheets.forEach(function (sheet) {
      var rows = [];
      var above = [event.title || "", event.dateText || "", event.venue || ""];
      for (var r = 0; r < sheet.headerRow - 1; r++) rows.push(above[r] ? [above[r]] : []);
      rows.push(EXPORT_HEADER.concat(["", pasteHint(sheet)]));
      people.filter(function (p) { return p.sheetName === sheet.sheetName; }).forEach(function (p) {
        while (rows.length < p.row - 1) rows.push([]);
        var c = checked[p.id];
        rows[p.row - 1] = [p.name, p.title, formatPlan(p.plan), c ? "〇" : "", c ? formatStamp(c.t) : "", c ? (c.dev || "") : "", judge(p.plan, !!c, true)];
      });
      out.push({ name: sheet.sheetName, rows: rows });
    });

    var summary = summarize(roster, checkins);
    var unlisted = [["氏名", "所属", "受付時刻", "受付端末", "種別"]];
    summary.unlisted.forEach(function (c) {
      unlisted.push([c.name, c.dept, formatStamp(c.t), c.dev || "", KIND_LABEL[c.kind] || c.kind]);
    });
    out.push({ name: "名簿外", rows: unlisted });

    var agg = [["部署", "予定〇", "受付済", "未受付", "予定外"]];
    summary.byDept.forEach(function (d) { agg.push([d.dept, d.planYes, d.checked, d.missing, d.unexpected]); });
    if (summary.unlisted.length) agg.push(["名簿外", "", summary.unlisted.length, "", summary.unlisted.length]);
    agg.push(["合計", summary.total.planYes, summary.total.checked, summary.total.missing, summary.total.unexpected]);
    out.push({ name: "集計", rows: agg });
    return out;
  }

  function toWorkbook(XLSX, sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
    });
    return wb;
  }

  function exportFilename(prefix, title, date, ext) {
    var safe = String(title || "").replace(/[^\w぀-ヿ一-鿿０-ｚ]/g, "");
    var stamp = date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "_" + pad2(date.getHours()) + pad2(date.getMinutes());
    return prefix + (safe ? "_" + safe : "") + "_" + stamp + "." + ext;
  }

  return {
    toHalfWidthDigits: toHalfWidthDigits,
    parseSheetName: parseSheetName,
    normalizeLabel: normalizeLabel,
    normalizePlan: normalizePlan,
    formatPlan: formatPlan,
    colLetter: colLetter,
    findHeader: findHeader,
    parseWorkbook: parseWorkbook,
    randomSaltB64: randomSaltB64,
    deriveKey: deriveKey,
    encryptJson: encryptJson,
    decryptJson: decryptJson,
    makeCheck: makeCheck,
    verifyKey: verifyKey,
    personId: personId,
    sortPeople: sortPeople,
    assignIds: assignIds,
    KIND_LABEL: KIND_LABEL,
    judge: judge,
    buildRows: buildRows,
    summarize: summarize,
    searchPeople: searchPeople,
    rosterDiff: rosterDiff,
    walkinId: walkinId,
    formatClock: formatClock,
    formatTime: formatTime,
    formatStamp: formatStamp,
    buildCsv: buildCsv,
    buildExportSheets: buildExportSheets,
    toWorkbook: toWorkbook,
    exportFilename: exportFilename
  };
});
