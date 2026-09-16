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
    wb.SheetNames.forEach(function (sheetName) {
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
      return (a.deptOrder - b.deptOrder) || (a.row - b.row);
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
    assignIds: assignIds
  };
});
