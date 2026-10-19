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
  // weights: pairWeights() の weights。指定すると過去に同じ組だった2人をなるべく別の組にする
  //   （同組の重みの合計を最優先で減らし、同じなら mode のそろい具合で比べる。keepMembers のときは使わない）
  function assign(players, groups, mode, rng, keepMembers, split, weights) {
    rng = rng || Math.random;
    var out = baseAssign(players, groups, mode, rng, keepMembers, split);
    if (keepMembers || !weights || !Object.keys(weights).length) return out;
    var best = improve(out, players, mode, weights, rng);
    // 最初の案を変えて何度か試す（1回目は mode どおり、2回目以降はランダムな案から）
    for (var r = 1; r < RESTARTS; r++) {
      var cand = improve(baseAssign(players, groups, "random", rng, false, split), players, mode, weights, rng);
      if (better(cand.cost, best.cost)) best = cand;
    }
    return best.groups;
  }

  var RESTARTS = 20, MAX_PASSES = 30, EPS = 1e-9;

  function better(a, b) {
    if (a.rep < b.rep - EPS) return true;
    return Math.abs(a.rep - b.rep) <= EPS && a.mode < b.mode - EPS;
  }

  // 1組の点数。rep = 過去の同組の重みの合計、mode = 割振り方式ごとのそろっていなさ（小さいほど良い）
  function groupCost(ids, byId, mode, weights, avg, nullHc) {
    var rep = 0, modeCost = 0, sum = 0;
    for (var a = 0; a < ids.length; a++) {
      var pa = byId[ids[a]];
      var ha = typeof pa.hc === "number" ? pa.hc : null;
      sum += ha == null ? avg : ha;
      for (var b = a + 1; b < ids.length; b++) {
        var pb = byId[ids[b]];
        rep += weights[pairKey(pa.name, pb.name)] || 0;
        if (mode === "hcOrder") {
          var hb = typeof pb.hc === "number" ? pb.hc : nullHc;
          modeCost += Math.abs((ha == null ? nullHc : ha) - hb);
        }
      }
    }
    if (mode === "balanced" && ids.length) modeCost += Math.pow(sum / ids.length - avg, 2);
    return { rep: rep, mode: modeCost };
  }

  // 先頭・固定以外のメンバーを組の間で入れ替え、点数が良くなる限り続ける（山登り法）
  function improve(start, players, mode, weights, rng) {
    var groups = start.map(function (g) {
      return { leaderId: g.leaderId, memberIds: g.memberIds.slice(), locked: g.locked.slice() };
    });
    var byId = {}, avg = averageHc(players), maxHc = 0;
    players.forEach(function (p) {
      byId[p.id] = p;
      if (typeof p.hc === "number" && p.hc > maxHc) maxHc = p.hc;
    });
    var nullHc = maxHc + 20; // HC順では HC なしの人を最後（いちばん下手）にまとめる
    var slots = [];
    groups.forEach(function (g, gi) {
      g.memberIds.forEach(function (id, k) {
        if (id !== g.leaderId && g.locked.indexOf(id) < 0) slots.push([gi, k]);
      });
    });
    var pairs = [];
    for (var a = 0; a < slots.length; a++) {
      for (var b = a + 1; b < slots.length; b++) if (slots[a][0] !== slots[b][0]) pairs.push([slots[a], slots[b]]);
    }
    function swapAt(x, y) {
      var gx = groups[x[0]].memberIds, gy = groups[y[0]].memberIds, t = gx[x[1]];
      gx[x[1]] = gy[y[1]];
      gy[y[1]] = t;
    }
    function gc(i) { return groupCost(groups[i].memberIds, byId, mode, weights, avg, nullHc); }
    // 組ごとの点数を覚えておき、入れ替えた2組だけ計算し直す
    var parts = groups.map(function (_, i) { return gc(i); });
    var cur = { rep: 0, mode: 0 };
    parts.forEach(function (c) { cur.rep += c.rep; cur.mode += c.mode; });
    for (var pass = 0; pass < MAX_PASSES; pass++) {
      var changed = false;
      shuffle(pairs, rng).forEach(function (pr) {
        var i = pr[0][0], j = pr[1][0];
        swapAt(pr[0], pr[1]);
        var ci = gc(i), cj = gc(j);
        var c = {
          rep: cur.rep - parts[i].rep - parts[j].rep + ci.rep + cj.rep,
          mode: cur.mode - parts[i].mode - parts[j].mode + ci.mode + cj.mode,
        };
        if (better(c, cur)) { cur = c; parts[i] = ci; parts[j] = cj; changed = true; }
        else swapAt(pr[0], pr[1]);
      });
      if (!changed) break;
    }
    return { groups: groups, cost: cur };
  }

  function baseAssign(players, groups, mode, rng, keepMembers, split) {
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

  // ---------- 過去の組合せ（履歴） ----------
  // 履歴は氏名で照合する（参加者を取り込み直すと id が変わるため）。空白と全角・半角の違いは無視する。
  function nameKey(name) {
    return String(name == null ? "" : name).normalize("NFKC").replace(/\s/g, "");
  }

  function pairKey(a, b) {
    var x = nameKey(a), y = nameKey(b);
    return x < y ? x + "\u0001" + y : y + "\u0001" + x;
  }

  var HISTORY_DEPTH = 3; // 直近3回まで。重みは 前回 3・2回前 2・3回前 1

  // 割振りで避ける対象の回（新しい順に最大3回）。excludeDate と同じ日付の回（＝今回の大会）は除く。
  function recentRounds(history, excludeDate) {
    return (history || []).map(function (h, i) { return { h: h, i: i }; })
      .filter(function (x) { return !(excludeDate && x.h.date === excludeDate); })
      .sort(function (a, b) {
        if (a.h.date !== b.h.date) return a.h.date < b.h.date ? 1 : -1;
        return b.i - a.i; // 同じ日付なら後から保存した方を新しいとみなす
      })
      .slice(0, HISTORY_DEPTH)
      .map(function (x) { return x.h; });
  }

  // 2人の組合せ → 重み（何回も同じ組なら足し合わせる）
  function pairWeights(rounds) {
    var w = {};
    rounds.forEach(function (h, k) {
      var weight = HISTORY_DEPTH - k;
      h.groups.forEach(function (names) {
        for (var a = 0; a < names.length; a++) {
          for (var b = a + 1; b < names.length; b++) {
            var key = pairKey(names[a], names[b]);
            w[key] = (w[key] || 0) + weight;
          }
        }
      });
    });
    return w;
  }

  // 今の組合せで、過去に同じ組だった相手。
  // → { byMember: { id: [{ name: 相手の氏名, ago: 何回前(1〜3) }] }, counts: [前回のペア数, 2回前, 3回前] }
  function repeatInfo(groups, players, rounds) {
    var byId = {}, ago = {}, byMember = {}, counts = rounds.map(function () { return 0; });
    players.forEach(function (p) { byId[p.id] = p; });
    rounds.forEach(function (h, k) {
      h.groups.forEach(function (names) {
        for (var a = 0; a < names.length; a++) {
          for (var b = a + 1; b < names.length; b++) {
            var key = pairKey(names[a], names[b]);
            (ago[key] = ago[key] || []).push(k + 1);
          }
        }
      });
    });
    groups.forEach(function (g) {
      var ids = g.memberIds.filter(function (id) { return byId[id]; });
      for (var a = 0; a < ids.length; a++) {
        for (var b = a + 1; b < ids.length; b++) {
          var pa = byId[ids[a]], pb = byId[ids[b]];
          (ago[pairKey(pa.name, pb.name)] || []).forEach(function (n) {
            counts[n - 1]++;
            (byMember[pa.id] = byMember[pa.id] || []).push({ name: pb.name, ago: n });
            (byMember[pb.id] = byMember[pb.id] || []).push({ name: pa.name, ago: n });
          });
        }
      }
    });
    return { byMember: byMember, counts: counts };
  }

  // 今の組合せを履歴の1件にする（氏名の配列の配列。空の組は入れない）
  function historyEntry(groups, players, date, label) {
    var byId = {};
    players.forEach(function (p) { byId[p.id] = p; });
    return {
      date: String(date || ""),
      label: String(label || ""),
      groups: groups.map(function (g) {
        return g.memberIds.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id].name; });
      }).filter(function (names) { return names.length; }),
    };
  }

  function isHistoryEntry(h) {
    return !!h && typeof h.date === "string" && typeof h.label === "string" && Array.isArray(h.groups) &&
      h.groups.every(function (g) {
        return Array.isArray(g) && g.every(function (n) { return typeof n === "string"; });
      });
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

  var FRAMES = 4; // 1組の最大人数 = 1コースあたりの枠の数（groupSizes が4を超えないため）

  // "08:14" → "8:14"
  function shortTime(t) { return String(t || "").replace(/^0(\d:)/, "$1"); }

  // 組合せ表をコースごとに分ける（参考書式: OUT=1〜4枠・IN=5〜8枠、組番号は通し）。
  // → [{ course, time: 先頭組の時刻, frameStart, rows: [{ no, time, cells: [{name, hc}|null ×4] }] }]
  function courseSections(groups, players, times) {
    var byId = {}, sections = [];
    players.forEach(function (p) { byId[p.id] = p; });
    groups.forEach(function (g, i) {
      var t = (times && times[i]) || { time: "", course: "OUT" };
      var cur = sections[sections.length - 1];
      if (!cur || cur.course !== t.course) {
        cur = { course: t.course, time: shortTime(t.time), frameStart: sections.length * FRAMES + 1, rows: [] };
        sections.push(cur);
      }
      var cells = [];
      for (var c = 0; c < FRAMES; c++) {
        var p = byId[g.memberIds[c]];
        cells.push(p ? { name: p.name, hc: p.hc } : null);
      }
      cur.rows.push({ no: i + 1, time: shortTime(t.time), cells: cells });
    });
    return sections;
  }

  function hcLabel(hc) { return typeof hc === "number" ? "HC " + hc : "HC"; }

  function sectionTitle(sec) { return sec.course + "スタート" + (sec.time ? " " + sec.time : ""); }

  function frameLabels(sec) {
    var labels = [];
    for (var c = 0; c < FRAMES; c++) labels.push(sec.frameStart + c + "枠");
    return labels;
  }

  // 氏名を1文字ずつに分ける（均等割付の表示用）。姓名の間の空白は区切り null にまとめる。
  function nameChars(name) {
    var out = [];
    String(name || "").replace(/^[\s　]+|[\s　]+$/g, "").split("").forEach(function (ch) {
      if (/[\s　]/.test(ch)) { if (out[out.length - 1] !== null) out.push(null); }
      else out.push(ch);
    });
    return out;
  }

  // Excel に貼る用（タブ区切り）。withHc なら各組を HC 行と氏名行の2行にする。
  function tableTsv(sections, withHc) {
    var lines = [];
    sections.forEach(function (sec, si) {
      lines.push(sectionTitle(sec) + (si === 0 ? "\t（敬称略）" : ""));
      lines.push(["組"].concat(frameLabels(sec)).join("\t"));
      sec.rows.forEach(function (r) {
        var names = r.cells.map(function (x) { return x ? x.name : ""; });
        if (withHc) {
          lines.push([r.no].concat(r.cells.map(function (x) { return x ? hcLabel(x.hc) : ""; })).join("\t"));
          lines.push([""].concat(names).join("\t"));
        } else {
          lines.push([r.no].concat(names).join("\t"));
        }
      });
    });
    return lines.join("\n");
  }

  // Word に貼る用。貼り付け先で崩れないよう style はインラインで持たせる。
  function tableHtml(sections, withHc) {
    var cell = 'style="border:1px solid #000;padding:2px 8px;text-align:center;white-space:nowrap;min-width:7em;"';
    var noCell = 'style="border:1px solid #000;padding:2px 8px;text-align:center;"';
    var h = "";
    sections.forEach(function (sec, si) {
      h += '<p style="margin:8px 0 2px;">' + escapeHtml(sectionTitle(sec)) + (si === 0 ? "　（敬称略）" : "") + "</p>" +
        '<table style="border-collapse:collapse;font-size:11pt;"><tr><td ' + noCell + ">組</td>";
      frameLabels(sec).forEach(function (l) { h += "<td " + cell + ">" + l.replace("枠", " 枠") + "</td>"; });
      h += "</tr>";
      sec.rows.forEach(function (r) {
        h += "<tr><td " + noCell + ">" + r.no + "</td>";
        r.cells.forEach(function (x) {
          h += "<td " + cell + ">" + (x ? (withHc ? escapeHtml(hcLabel(x.hc)) + "<br>" : "") + escapeHtml(x.name) : "") + "</td>";
        });
        h += "</tr>";
      });
      h += "</table>";
    });
    return h;
  }

  // 案内状に載せる QR コード画像。SVG はスクリプトを含められるので通さない。
  function isImageDataUrl(s) {
    return typeof s === "string" && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
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
    if (obj.history != null && !(Array.isArray(obj.history) && obj.history.every(isHistoryEntry))) {
      return "履歴（history）の形式が正しくありません";
    }
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
    nameKey: nameKey,
    recentRounds: recentRounds,
    pairWeights: pairWeights,
    repeatInfo: repeatInfo,
    historyEntry: historyEntry,
    groupStats: groupStats,
    startTimes: startTimes,
    formatDateJa: formatDateJa,
    shortTime: shortTime,
    courseSections: courseSections,
    hcLabel: hcLabel,
    nameChars: nameChars,
    tableTsv: tableTsv,
    tableHtml: tableHtml,
    isImageDataUrl: isImageDataUrl,
    validateImport: validateImport,
  };
});
