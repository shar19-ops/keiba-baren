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

  return {
    toHalfWidthDigits: toHalfWidthDigits,
    parseSheetName: parseSheetName,
    normalizeLabel: normalizeLabel,
    normalizePlan: normalizePlan,
    formatPlan: formatPlan,
    colLetter: colLetter,
    findHeader: findHeader
  };
});
