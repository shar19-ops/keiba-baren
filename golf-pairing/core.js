/* ゴルフ組合せ core: ブラウザ / Node 両対応の純粋関数 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GolfCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 文字列 ----------
  function toHalfWidth(s) {
    return String(s).replace(/[０-９．－]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
  }

  function trimAll(s) {
    return String(s == null ? "" : s).replace(/^[\s　]+|[\s　]+$/g, "");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  // ---------- 参加者の取り込み ----------
  // HC の文字列 → { hc: number|null, ok }。空欄は ok のまま null。
  function parseHc(v) {
    var s = trimAll(toHalfWidth(v == null ? "" : v));
    if (s === "") return { hc: null, ok: true };
    if (/^-?\d+(\.\d+)?$/.test(s)) return { hc: parseFloat(s), ok: true };
    return { hc: null, ok: false };
  }

  var NAME_HEADER = /^(氏名|名前|お名前|参加者|参加者名|name)$/i;
  var HC_HEADER = /(hc|ハンデ|ハンディ|handicap)/i;

  function isHeader(name, hcRaw) {
    if (NAME_HEADER.test(name.replace(/[\s　]/g, ""))) return true;
    var h = trimAll(hcRaw);
    return h !== "" && !parseHc(h).ok && HC_HEADER.test(h);
  }

  // Excel からコピーしたタブ区切り（無ければカンマ区切り）のテキストを読む。
  // 1列目 = 氏名、2列目 = HC。1行目が見出しなら飛ばす。
  function parsePasted(text) {
    var players = [], errors = [], seen = {}, first = true;
    var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    lines.forEach(function (line, i) {
      if (!trimAll(line)) return;
      var cols = line.indexOf("\t") >= 0 ? line.split("\t") : line.split(/[,，]/);
      var name = trimAll(cols[0]);
      var hcRaw = cols.length > 1 ? cols[1] : "";
      var wasFirst = first;
      first = false;
      if (wasFirst && isHeader(name, hcRaw)) return;
      var row = i + 1;
      if (!name) { errors.push(row + "行目: 氏名が空のため飛ばしました"); return; }
      var hc = parseHc(hcRaw);
      if (!hc.ok) errors.push(row + "行目: HC「" + trimAll(hcRaw) + "」を数値として読めないため空欄にしました");
      var key = name.replace(/[\s　]/g, "");
      if (seen[key]) errors.push(row + "行目: 「" + name + "」が重複しています");
      seen[key] = true;
      players.push({ name: name, hc: hc.hc });
    });
    return { players: players, errors: errors };
  }

  return {
    toHalfWidth: toHalfWidth,
    escapeHtml: escapeHtml,
    parseHc: parseHc,
    parsePasted: parsePasted,
  };
});
