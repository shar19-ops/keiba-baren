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

  // ---------- 組分け ----------
  // 4人組が基本。端数は末尾の組を3人組にする（5人だけは 3+2 しか作れない）。
  function groupSizes(n) {
    if (n <= 0) return [];
    if (n <= 4) return [n];
    if (n === 5) return [3, 2];
    var g = Math.ceil(n / 4), threes = 4 * g - n, sizes = [];
    for (var i = 0; i < g; i++) sizes.push(i < g - threes ? 4 : 3);
    return sizes;
  }

  // 参加者の人数に合わせて組を作り直す。残す優先順は 先頭 → 固定 → (keepMembers なら) 既存メンバー。
  // 居なくなった人・重複・定員オーバーは外れる（外れた人は未割当になる）。
  function normalizeGroups(groups, players, keepMembers) {
    var sizes = groupSizes(players.length);
    var exists = {}, used = {};
    players.forEach(function (p) { exists[p.id] = true; });
    function take(id) {
      if (id == null || !exists[id] || used[id]) return false;
      used[id] = true;
      return true;
    }
    var src = sizes.map(function (_, i) { return (groups && groups[i]) || {}; });
    var out = sizes.map(function (size, i) {
      var leaderId = take(src[i].leaderId) ? src[i].leaderId : null;
      return { leaderId: leaderId, memberIds: leaderId ? [leaderId] : [], locked: [] };
    });
    out.forEach(function (g, i) {
      (src[i].locked || []).forEach(function (id) {
        if (g.memberIds.length < sizes[i] && take(id)) { g.memberIds.push(id); g.locked.push(id); }
      });
    });
    if (keepMembers) {
      out.forEach(function (g, i) {
        (src[i].memberIds || []).forEach(function (id) {
          if (g.memberIds.length < sizes[i] && take(id)) g.memberIds.push(id);
        });
      });
    }
    return out;
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function averageHc(players) {
    var sum = 0, n = 0;
    players.forEach(function (p) { if (typeof p.hc === "number") { sum += p.hc; n++; } });
    return n ? sum / n : 0;
  }

  // mode: "balanced"（HC 均等）| "random" | "hcOrder"（HC の近い人同士）
  // keepMembers=false: 先頭と固定だけ残して残りを割り振り直す（自動割振り・再シャッフル）
  // keepMembers=true : 今の組は崩さず、未割当の人だけ空き枠へ入れる
  function assign(players, groups, mode, rng, keepMembers) {
    rng = rng || Math.random;
    var sizes = groupSizes(players.length);
    var out = normalizeGroups(groups, players, keepMembers);
    var byId = {}, used = {};
    players.forEach(function (p) { byId[p.id] = p; });
    out.forEach(function (g) { g.memberIds.forEach(function (id) { used[id] = true; }); });
    // 先にシャッフルしておくと、同じ HC の人の順番が毎回変わり再シャッフルで別案が出る
    var rest = shuffle(players.filter(function (p) { return !used[p.id]; }), rng);
    function free(i) { return sizes[i] - out[i].memberIds.length; }

    if (mode === "balanced") {
      var avg = averageHc(players);
      var hcOf = function (p) { return typeof p.hc === "number" ? p.hc : avg; };
      var totals = out.map(function (g) {
        return g.memberIds.reduce(function (s, id) { return s + hcOf(byId[id]); }, 0);
      });
      rest.sort(function (a, b) { return hcOf(b) - hcOf(a); });
      // HC の大きい人から、「定員あたりの HC 合計」がいちばん小さい組へ入れていく
      rest.forEach(function (p) {
        var best = [], bestScore = Infinity;
        out.forEach(function (g, i) {
          if (free(i) <= 0) return;
          var score = totals[i] / sizes[i];
          if (score < bestScore - 1e-9) { best = [i]; bestScore = score; }
          else if (Math.abs(score - bestScore) <= 1e-9) best.push(i);
        });
        var k = best[Math.floor(rng() * best.length)];
        out[k].memberIds.push(p.id);
        totals[k] += hcOf(p);
      });
      return out;
    }

    if (mode === "hcOrder") {
      rest.sort(function (a, b) {
        var ah = typeof a.hc === "number", bh = typeof b.hc === "number";
        if (ah !== bh) return ah ? -1 : 1;
        return ah ? a.hc - b.hc : 0;
      });
    }
    var gi = 0;
    rest.forEach(function (p) {
      while (free(gi) <= 0) gi++;
      out[gi].memberIds.push(p.id);
    });
    return out;
  }

  // ---------- 集計・表示 ----------
  function round1(x) { return Math.round(x * 10) / 10; }

  // HC なしの人を除いた合計と平均（小数1桁）。誰も HC が無ければ null。
  function groupStats(memberIds, players) {
    var byId = {}, sum = 0, n = 0;
    players.forEach(function (p) { byId[p.id] = p; });
    memberIds.forEach(function (id) {
      var p = byId[id];
      if (p && typeof p.hc === "number") { sum += p.hc; n++; }
    });
    return { hcTotal: n ? round1(sum) : null, hcAvg: n ? round1(sum / n) : null };
  }

  return {
    toHalfWidth: toHalfWidth,
    escapeHtml: escapeHtml,
    parseHc: parseHc,
    parsePasted: parsePasted,
    groupSizes: groupSizes,
    normalizeGroups: normalizeGroups,
    averageHc: averageHc,
    assign: assign,
    groupStats: groupStats,
  };
});
