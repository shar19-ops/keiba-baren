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
  // split（OUT・IN に分ける）なら、前半 = OUT・後半 = IN（startTimes と同じ分け方）の
  // それぞれで最後の組を3人組にする。3人組が奇数なら余りの1組は IN 側に回す。
  function groupSizes(n, split) {
    if (n <= 0) return [];
    if (n <= 4) return [n];
    if (n === 5) return [3, 2];
    var g = Math.ceil(n / 4), threes = 4 * g - n;
    if (!split) return courseSizes(g, threes);
    var outCount = Math.ceil(g / 2), inCount = g - outCount;
    var inThrees = Math.min(Math.ceil(threes / 2), inCount);
    return courseSizes(outCount, threes - inThrees).concat(courseSizes(inCount, inThrees));
  }

  // count 組のうち末尾 threes 組を3人、残りを4人にした並び
  function courseSizes(count, threes) {
    var sizes = [];
    for (var i = 0; i < count; i++) sizes.push(i < count - threes ? 4 : 3);
    return sizes;
  }

  // 参加者の人数に合わせて組を作り直す。残す優先順は 先頭 → 固定 → (keepMembers なら) 既存メンバー。
  // 居なくなった人・重複・定員オーバーは外れる（外れた人は未割当になる）。
  function normalizeGroups(groups, players, keepMembers, split) {
    var sizes = groupSizes(players.length, split);
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
  // split: OUT・IN に分けるときの組の人数（groupSizes 参照）を使う
  function assign(players, groups, mode, rng, keepMembers, split) {
    rng = rng || Math.random;
    var sizes = groupSizes(players.length, split);
    var out = normalizeGroups(groups, players, keepMembers, split);
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

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function formatMinutes(min) {
    min = ((min % 1440) + 1440) % 1440;
    return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60);
  }

  // 各組のスタート時刻とコース。course = "OUT" | "IN" | "split"（前半 OUT・後半 IN を同時刻から）
  function startTimes(count, startTime, interval, course) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(startTime || ""));
    var base = m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    var step = Number(interval) || 0;
    var half = Math.ceil(count / 2), out = [];
    for (var i = 0; i < count; i++) {
      var idx = i, c = course === "IN" ? "IN" : "OUT";
      if (course === "split" && i >= half) { idx = i - half; c = "IN"; }
      out.push({ time: base == null ? "" : formatMinutes(base + idx * step), course: c });
    }
    return out;
  }

  var WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  // "2026-11-03" → "2026年11月3日(火)"。読めない文字列はそのまま返す。
  function formatDateJa(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    var y = +m[1], mo = +m[2], d = +m[3];
    var wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    return y + "年" + mo + "月" + d + "日(" + WEEKDAYS[wd] + ")";
  }

  // 組合せ表の行。names は最大4人（groupSizes が4を超えないため）。
  function tableRows(groups, players, times, withHc) {
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    return groups.map(function (g, i) {
      var t = (times && times[i]) || { time: "", course: "" };
      return {
        no: i + 1,
        time: t.time,
        course: t.course,
        names: g.memberIds.map(function (id) {
          var p = byId[id];
          if (!p) return "";
          return withHc && typeof p.hc === "number" ? p.name + "（" + p.hc + "）" : p.name;
        }),
      };
    });
  }

  var NAME_COLS = 4;

  // Excel に貼る用（タブ区切り）
  function tableTsv(rows) {
    var lines = [["組", "スタート", "コース", "氏名", "", "", ""].join("\t")];
    rows.forEach(function (r) {
      var cells = [r.no + "組", r.time, r.course];
      for (var c = 0; c < NAME_COLS; c++) cells.push(r.names[c] || "");
      lines.push(cells.join("\t"));
    });
    return lines.join("\n");
  }

  // Word に貼る用。貼り付け先で崩れないよう style はインラインで持たせる。
  function tableHtml(rows) {
    var cell = 'style="border:1px solid #000;padding:4px 8px;white-space:nowrap;"';
    var head = 'style="border:1px solid #000;padding:4px 8px;background:#eee;white-space:nowrap;"';
    var h = '<table style="border-collapse:collapse;font-size:11pt;">' +
      "<thead><tr><th " + head + ">組</th><th " + head + ">スタート</th><th " + head + ">コース</th>" +
      "<th " + head + ' colspan="' + NAME_COLS + '">氏名</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += "<tr><td " + cell + ">" + r.no + "組</td><td " + cell + ">" + escapeHtml(r.time) +
        "</td><td " + cell + ">" + escapeHtml(r.course) + "</td>";
      for (var c = 0; c < NAME_COLS; c++) h += "<td " + cell + ">" + escapeHtml(r.names[c] || "") + "</td>";
      h += "</tr>";
    });
    return h + "</tbody></table>";
  }

  // ---------- JSON 読み込みの検証 ----------
  // 問題なければ null、だめなら理由の文字列
  function validateImport(obj) {
    if (!obj || typeof obj !== "object") return "JSON の形式が正しくありません";
    if (obj.version !== 1) return "対応していないバージョンのファイルです";
    if (!Array.isArray(obj.players)) return "参加者（players）が見つかりません";
    for (var i = 0; i < obj.players.length; i++) {
      var p = obj.players[i];
      if (!p || typeof p.id !== "string" || typeof p.name !== "string" ||
          !(p.hc === null || typeof p.hc === "number")) {
        return (i + 1) + "人目のデータが正しくありません";
      }
    }
    if (obj.groups != null && !Array.isArray(obj.groups)) return "組（groups）の形式が正しくありません";
    return null;
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
    startTimes: startTimes,
    formatDateJa: formatDateJa,
    tableRows: tableRows,
    tableTsv: tableTsv,
    tableHtml: tableHtml,
    validateImport: validateImport,
  };
});
