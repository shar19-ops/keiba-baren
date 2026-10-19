/* ゴルフ組合せ: 画面ロジック（状態・描画・保存） */
(function () {
  "use strict";
  var Core = window.GolfCore;
  var KEY = "golf-pairing-v1";
  var esc = Core.escapeHtml;

  function $(id) { return document.getElementById(id); }

  // ---------- 状態 ----------
  function defaultState() {
    return {
      version: 1,
      players: [],
      settings: { mode: "balanced", startTime: "08:00", interval: 7, course: "OUT", avoidRepeats: true },
      groups: [],
      assigned: false, // 一度でも自動割振りしたか（以降は人数が変わっても空き枠を自動で補充する）
      history: [], // 過去の大会の組合せ [{ date, label, groups: [[氏名, ...], ...] }]（④履歴）
      invitation: {
        title: "", subtitle: "", date: "", meetTime: "", venue: "", tel: "", fax: "",
        fee: "", organizer: "", notes: "", showHc: true,
        showTicket: false, ticketNote: "新HDにて", ticketType: "連勝複式", ticketRule: "4口以上投票お願いします。", ticketCount: 6,
        showQr: false, qrImage: "", qrCaption: "馬券投票アプリ",
      },
    };
  }

  function fromSaved(obj) {
    var d = defaultState();
    var inv = Object.assign(d.invitation, obj.invitation || {});
    if (!Core.isImageDataUrl(inv.qrImage)) inv.qrImage = ""; // 読み込んだファイル由来の値は画像だけ許す
    return {
      version: 1,
      players: obj.players,
      settings: Object.assign(d.settings, obj.settings || {}),
      groups: Array.isArray(obj.groups) ? obj.groups : [],
      assigned: !!obj.assigned,
      history: Array.isArray(obj.history) ? obj.history : [],
      invitation: inv,
    };
  }

  // 初めて開いたとき（保存データが無いとき）に入れておくダミーデータ。
  // 架空の名前・会場。①参加者の「全員削除」や案内状の入力欄の書き換えで消せる。
  var SAMPLE_PLAYERS = [
    ["山田 太郎", 12], ["鈴木 一郎", 18], ["佐藤 花子", 24], ["田中 次郎", 8],
    ["高橋 健太", 30], ["伊藤 誠", 15], ["渡辺 大輔", 20], ["中村 翔", null],
    ["小林 直樹", 26], ["加藤 浩二", 10], ["吉田 拓也", 22], ["山本 剛", 28],
    ["松本 隆", 16], ["井上 学", 14],
  ];

  function sampleState() {
    var s = defaultState();
    s.players = SAMPLE_PLAYERS.map(function (x, i) { return { id: "sample" + (i + 1), name: x[0], hc: x[1] }; });
    s.settings.startTime = "08:00";
    s.settings.course = "split";
    // 各組の先頭は幹事が指定した想定。残りは起動時に自動割振り（syncGroups）で埋まる。
    s.groups = ["sample1", "sample2", "sample3", "sample4"].map(function (id) {
      return { leaderId: id, memberIds: [id], locked: [] };
    });
    s.assigned = true;
    Object.assign(s.invitation, {
      title: "第1回 サンプルゴルフコンペ　組合せ表",
      subtitle: "1/4回",
      date: "2026-11-14",
      meetTime: "7:30",
      venue: "サンプルカントリークラブ",
      tel: "000-0000-0000",
      fax: "000-0000-0001",
      fee: "3,000円（当日徴収）",
      organizer: "総務部 山田",
      notes: "※これはダミーデータです。①参加者の「全員削除」と、この画面の入力欄を書き換えてお使いください。\nプレー費は各自精算となります。雨天決行です。",
    });
    return s;
  }

  var storageOk = true;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (!Core.validateImport(obj)) return fromSaved(obj);
      }
    } catch (e) {
      storageOk = false;
    }
    return sampleState();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    $("storage-warn").hidden = storageOk;
  }

  var state = load();
  var selected = null; // 入れ替え元 { g: 組の番号（未割当は -1）, id }
  var idSeq = 0;

  function newId() { return "p" + Date.now().toString(36) + (idSeq++).toString(36); }

  function playerById(id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }

  // OUT・IN に分けるときは、各コースの最後の組が3人組になる
  function isSplit() { return state.settings.course === "split"; }

  function sizes() { return Core.groupSizes(state.players.length, isSplit()); }

  // 参加者・先頭・コースが変わったあと、組の形を人数に合わせ、割振り済みなら空き枠を埋める
  function syncGroups() {
    state.groups = state.assigned
      ? Core.assign(state.players, state.groups, state.settings.mode, Math.random, true, isSplit())
      : Core.normalizeGroups(state.groups, state.players, true, isSplit());
    if (selected && !playerById(selected.id)) selected = null;
  }

  function commit() {
    syncGroups();
    save();
    render();
  }

  function times() {
    var s = state.settings;
    return Core.startTimes(state.groups.length, s.startTime, s.interval, s.course);
  }

  function hcText(hc) { return typeof hc === "number" ? String(hc) : "—"; }

  // 重複を避ける対象の回（新しい順に最大3回。案内状の開催日と同じ日付の回＝今回は除く）
  function rounds() { return Core.recentRounds(state.history, state.invitation.date); }

  // 自動割振りに渡す重み（「なるべく避ける」を外しているときは null）
  function weights() { return state.settings.avoidRepeats ? Core.pairWeights(rounds()) : null; }

  var AGO = ["前回", "2回前", "3回前"];

  // ---------- 描画 ----------
  function render() {
    renderPlayers();
    renderPairing();
    renderInvitation();
    renderHistory();
  }

  function sizesText(n) {
    if (!n) return "参加者がまだいません";
    var s = sizes();
    if (isSplit() && s.length > 1) {
      var half = Math.ceil(s.length / 2);
      return n + "人 → " + s.length + "組（OUT " + s.slice(0, half).join("・") + "人 ／ IN " + s.slice(half).join("・") + "人）";
    }
    return n + "人 → " + s.length + "組（" + s.join("・") + "人）";
  }

  function renderPlayers() {
    var n = state.players.length;
    $("player-summary").innerHTML = esc(sizesText(n)) +
      (n === 5 ? ' <span class="warn">5人のため 3人と2人の組になります</span>' : "");
    $("player-rows").innerHTML = state.players.map(function (p, i) {
      return '<tr data-id="' + esc(p.id) + '"><td>' + (i + 1) + "</td>" +
        '<td><input class="name" data-field="name" value="' + esc(p.name) + '"></td>' +
        '<td><input class="hc" data-field="hc" inputmode="decimal" value="' + (typeof p.hc === "number" ? p.hc : "") + '"></td>' +
        '<td><button class="danger del" title="削除">削除</button></td></tr>';
    }).join("");
    $("clear-players").disabled = n === 0;
  }

  function renderPairing() {
    var s = state.settings;
    document.querySelectorAll('input[name="mode"]').forEach(function (r) { r.checked = r.value === s.mode; });
    $("start-time").value = s.startTime;
    $("interval").value = s.interval;
    $("course").value = s.course;
    $("avoid-repeats").checked = !!s.avoidRepeats;
    $("auto-assign").disabled = state.players.length === 0;

    var n = state.players.length;
    $("pair-msg").innerHTML = n === 0
      ? '<span class="warn">先に①参加者で一覧を取り込んでください</span>'
      : esc(sizesText(n)) + (n === 5 ? ' <span class="warn">2人の組ができます</span>' : "");

    // 過去に同じ組だった2人
    var rs = rounds();
    var info = Core.repeatInfo(state.groups, state.players, rs);
    var total = info.counts.reduce(function (a, b) { return a + b; }, 0);
    $("repeat-msg").innerHTML = !state.history.length
      ? "履歴がまだありません（大会が決まったら③案内状か④履歴で「履歴に保存」すると、次回から同じ組を避けます）"
      : !rs.length
      ? "避ける対象の履歴がありません（④履歴で「使う」にチェックした回が対象です。③案内状の開催日と同じ日付の回は、今回の大会とみなします）"
      : "直近" + rs.length + "回と同じ組だった2人：" +
        (total === 0 ? "なし" : info.counts.map(function (c, k) {
          return AGO[k] + " " + c + "組";
        }).join("・") + '<span class="hint">（🔁 にマウスを乗せると相手が出ます）</span>');

    function repeatMark(id) {
      var list = info.byMember[id];
      if (!list) return "";
      var title = list.map(function (x) { return AGO[x.ago - 1] + "も同じ組：" + x.name; }).join("\n");
      return '<span class="rep" title="' + esc(title) + '">🔁</span>';
    }

    // 先頭に選ばれている人 → 組番号
    var leaderOf = {};
    state.groups.forEach(function (g, i) { if (g.leaderId) leaderOf[g.leaderId] = i; });

    var t = times();
    $("groups").innerHTML = state.groups.map(function (g, gi) {
      var size = sizes()[gi];
      var st = Core.groupStats(g.memberIds, state.players);
      var opts = '<option value="">（自動で決める）</option>' + state.players.filter(function (p) {
        return !(p.id in leaderOf) || leaderOf[p.id] === gi;
      }).map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (p.id === g.leaderId ? " selected" : "") + ">" +
          esc(p.name) + (typeof p.hc === "number" ? "（" + p.hc + "）" : "") + "</option>";
      }).join("");

      var items = g.memberIds.map(function (id) {
        var p = playerById(id);
        if (!p) return "";
        if (id === g.leaderId) {
          return '<li class="lead" title="先頭（上のプルダウンで変更）">👑 <span class="nm">' + esc(p.name) +
            "</span>" + repeatMark(id) + '<span class="hcv">' + hcText(p.hc) + "</span></li>";
        }
        var pinned = g.locked.indexOf(id) >= 0;
        var sel = selected && selected.id === id;
        return '<li class="member' + (sel ? " selected" : "") + '" data-g="' + gi + '" data-id="' + esc(id) + '">' +
          '<span class="nm">' + esc(p.name) + "</span>" + repeatMark(id) + '<span class="hcv">' + hcText(p.hc) + "</span>" +
          '<button class="pin' + (pinned ? " on" : "") + '" title="' + (pinned ? "固定を外す" : "固定する（自動割振りで動かさない）") + '">📌</button></li>';
      }).join("");
      for (var k = g.memberIds.length; k < size; k++) {
        items += '<li class="empty" data-g="' + gi + '">（空き）</li>';
      }

      var tm = t[gi] || { time: "", course: "" };
      return '<div class="group-card">' +
        '<div class="group-head"><b>' + (gi + 1) + '組</b><span class="group-time">' + esc(tm.time) + " " + esc(tm.course) + "</span></div>" +
        '<div class="group-stats">HC計 ' + (st.hcTotal == null ? "—" : st.hcTotal) + " ／ 平均 " + (st.hcAvg == null ? "—" : st.hcAvg) + "</div>" +
        '<label class="leader-pick">先頭 <select class="leader" data-g="' + gi + '">' + opts + "</select></label>" +
        '<ol class="members">' + items + "</ol></div>";
    }).join("");

    // 未割当
    var placed = {};
    state.groups.forEach(function (g) { g.memberIds.forEach(function (id) { placed[id] = true; }); });
    var rest = state.players.filter(function (p) { return !placed[p.id]; });
    var box = $("unassigned");
    box.hidden = rest.length === 0;
    box.innerHTML = '<div class="hint" style="margin-bottom:6px">未割当 ' + rest.length + "人（「自動割振り」で割り振るか、クリックしてから組の空き・メンバーをクリック）</div>" +
      '<div class="chips">' + rest.map(function (p) {
        return '<span class="chip' + (selected && selected.id === p.id ? " selected" : "") + '" data-g="-1" data-id="' + esc(p.id) + '">' +
          esc(p.name) + " " + hcText(p.hc) + "</span>";
      }).join("") + "</div>";
  }

  function sections() { return Core.courseSections(state.groups, state.players, times()); }

  // 氏名をセル幅いっぱいに均等割付する（1文字ずつ span、姓名の間は空の span で広めに空ける）
  function nameHtml(name) {
    var chars = Core.nameChars(name);
    if (chars.length <= 1) return '<div class="jf-nm single">' + esc(name) + "</div>";
    return '<div class="jf-nm">' + chars.map(function (ch) {
      return "<span>" + (ch == null ? "" : esc(ch)) + "</span>";
    }).join("") + "</div>";
  }

  function sectionHtml(sec, si) {
    var v = state.invitation;
    var showRowTime = sec.rows.length > 1 && Number(state.settings.interval) > 0;
    var h = '<div class="jf-sec-head"><span>' + esc(sec.course) + "スタート　" + esc(sec.time) + "</span>" +
      (si === 0 ? "<span>（敬称略）</span>" : "") + "</div>" +
      '<table class="jf-table"><tr><th class="no">組</th>';
    for (var c = 0; c < 4; c++) h += "<th>" + (sec.frameStart + c) + "　枠</th>";
    h += "</tr>";
    sec.rows.forEach(function (r) {
      h += '<tr><td class="no">' + r.no + (showRowTime && r.time ? "<small>" + esc(r.time) + "</small>" : "") + "</td>";
      r.cells.forEach(function (x) {
        h += "<td>" + (x ? (v.showHc ? '<div class="jf-hc">' + esc(Core.hcLabel(x.hc)) + "</div>" : "") + nameHtml(x.name) : "") + "</td>";
      });
      h += "</tr>";
    });
    return h + "</table>";
  }

  function ticketHtml() {
    var v = state.invitation;
    var n = Math.max(1, Math.min(12, parseInt(v.ticketCount, 10) || 6));
    var bets = "";
    for (var i = 0; i < n; i++) bets += '<span class="jf-bet"><i></i><b></b><i></i></span>';
    return '<div class="jf-ticket"><div class="jf-cut"><span>キリトリ　線</span></div>' +
      '<div class="jf-ticket-head"><span>（トトカルチョ投票券）' + esc(v.ticketNote) + "</span>" +
      '<span class="r">' + esc(v.ticketType) + "<br>" + esc(v.ticketRule) + "</span></div>" +
      '<div class="jf-bets">' + bets + "</div>" +
      '<div class="jf-sign"><span>氏　名</span></div></div>';
  }

  // 表の下: 左に会費・幹事・連絡事項、右に QR コード
  function footHtml(extra) {
    var v = state.invitation;
    var qr = v.showQr && Core.isImageDataUrl(v.qrImage)
      ? '<div class="jf-qr"><img src="' + esc(v.qrImage) + '" alt="QR コード">' + esc(v.qrCaption) + "</div>"
      : "";
    if (!extra.length && !qr) return "";
    return '<div class="jf-foot">' +
      (extra.length ? '<div class="jf-extra">' + extra.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") + "</div>" : "") +
      qr + "</div>";
  }

  // 参考の書式（雄J会 組合せ表）に合わせた案内状
  function invitationBody() {
    var v = state.invitation;
    var secs = sections();
    var date = Core.formatDateJa(v.date).replace("(", "（").replace(")", "）");
    var contact = [v.tel ? "TEL:" + esc(v.tel) : "", v.fax ? "FAX:" + esc(v.fax) : ""].filter(Boolean).join("<br>");
    var extra = [v.fee ? "会費：" + v.fee : "", v.organizer ? "幹事：" + v.organizer : ""].filter(Boolean);

    return '<div class="jf">' +
      '<h1 class="jf-title">' + esc(v.title || "ゴルフコンペ　組合せ表") + "</h1>" +
      '<div class="jf-sub"><span class="jf-round">' + esc(v.subtitle) + '</span><span class="jf-date">' + esc(date) + "</span></div>" +
      '<div class="jf-venue">' + (v.meetTime ? '<span class="jf-meet">集合' + esc(v.meetTime) + "</span>" : "") +
      '<span class="jf-course">' + esc(v.venue) + "</span></div>" +
      '<div class="jf-contact">' + contact + "</div>" +
      (v.notes ? '<div class="jf-notes">' + esc(v.notes) + "</div>" : "") + // 連絡事項は TEL・FAX と組合せ表の間
      (secs.length ? secs.map(sectionHtml).join("") : '<p class="empty-note">（②組合せで割り振ると、ここに表が入ります）</p>') +
      footHtml(extra) +
      (v.showTicket ? ticketHtml() : "") +
      "</div>";
  }

  function renderInvitation() {
    document.querySelectorAll("[data-inv]").forEach(function (input) {
      var k = input.getAttribute("data-inv");
      if (document.activeElement !== input) input.value = state.invitation[k] || "";
    });
    $("show-hc").checked = !!state.invitation.showHc;
    $("show-ticket").checked = !!state.invitation.showTicket;
    $("show-qr").checked = !!state.invitation.showQr;
    var hasQr = Core.isImageDataUrl(state.invitation.qrImage);
    $("qr-thumb").hidden = !hasQr;
    if (hasQr) $("qr-thumb").src = state.invitation.qrImage;
    else $("qr-thumb").removeAttribute("src");
    $("qr-clear").disabled = !hasQr;
    if (document.activeElement !== $("ticket-count")) $("ticket-count").value = state.invitation.ticketCount;
    $("inv-preview").innerHTML = invitationBody();
  }

  // ---------- タブ ----------
  function showTab(name) {
    var btn = document.querySelector('nav button[data-tab="' + name + '"]');
    if (!btn) return;
    document.querySelectorAll("nav button").forEach(function (b) { b.classList.toggle("active", b === btn); });
    document.querySelectorAll("section.tab").forEach(function (s) { s.classList.toggle("active", s.id === "tab-" + name); });
  }

  document.querySelectorAll("nav button").forEach(function (btn) {
    btn.addEventListener("click", function () { showTab(btn.getAttribute("data-tab")); });
  });

  // index.html#pairing / #invitation のように URL で開くタブを指定できる（取説からのリンク用）
  showTab(location.hash.replace("#", ""));

  // ---------- ① 参加者 ----------
  function showImportResult(count, errors) {
    var html = count ? '<p class="msg ok">' + count + "人を取り込みました。</p>" : '<p class="msg">取り込める行がありませんでした。</p>';
    if (errors.length) {
      html += '<div class="errors">確認してください：<ul>' + errors.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>";
    }
    $("import-msg").innerHTML = html;
  }

  function importPasted(replace) {
    var r = Core.parsePasted($("paste").value);
    if (!r.players.length) { showImportResult(0, r.errors); return; }
    if (replace && state.players.length &&
        !window.confirm("今の参加者 " + state.players.length + "人と組合せを消して、置き換えますか？")) return;
    var added = r.players.map(function (p) { return { id: newId(), name: p.name, hc: p.hc }; });
    if (replace) {
      state.players = added;
      state.groups = [];
      state.assigned = false;
      selected = null;
    } else {
      // 既にいる人と同じ氏名は知らせる（取り込みはする）
      var existing = {};
      state.players.forEach(function (p) { existing[p.name.replace(/[\s　]/g, "")] = true; });
      added.forEach(function (p) {
        if (existing[p.name.replace(/[\s　]/g, "")]) r.errors.push("「" + p.name + "」は既に一覧にいます");
      });
      state.players = state.players.concat(added);
    }
    $("paste").value = "";
    showImportResult(added.length, r.errors);
    commit();
  }

  $("import-replace").addEventListener("click", function () { importPasted(true); });
  $("import-append").addEventListener("click", function () { importPasted(false); });

  $("player-rows").addEventListener("change", function (e) {
    var tr = e.target.closest("tr");
    var p = tr && playerById(tr.getAttribute("data-id"));
    if (!p) return;
    var field = e.target.getAttribute("data-field");
    if (field === "name") {
      var name = e.target.value.replace(/^[\s　]+|[\s　]+$/g, "");
      if (name) p.name = name;
    } else if (field === "hc") {
      var hc = Core.parseHc(e.target.value);
      if (hc.ok) p.hc = hc.hc;
      else window.alert("HC は数値で入力してください（空欄も可）");
    }
    commit();
  });

  $("player-rows").addEventListener("click", function (e) {
    if (!e.target.classList.contains("del")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    state.players = state.players.filter(function (p) { return p.id !== id; });
    commit();
  });

  function addPlayer() {
    var name = $("new-name").value.replace(/^[\s　]+|[\s　]+$/g, "");
    if (!name) { $("new-name").focus(); return; }
    var hc = Core.parseHc($("new-hc").value);
    if (!hc.ok) { window.alert("HC は数値で入力してください（空欄も可）"); return; }
    state.players.push({ id: newId(), name: name, hc: hc.hc });
    $("new-name").value = "";
    $("new-hc").value = "";
    $("new-name").focus();
    commit();
  }
  $("add-player").addEventListener("click", addPlayer);
  $("new-hc").addEventListener("keydown", function (e) { if (e.key === "Enter") addPlayer(); });
  $("new-name").addEventListener("keydown", function (e) { if (e.key === "Enter") addPlayer(); });

  $("clear-players").addEventListener("click", function () {
    if (!window.confirm("参加者 " + state.players.length + "人と組合せをすべて削除しますか？")) return;
    state.players = [];
    state.groups = [];
    state.assigned = false;
    selected = null;
    commit();
  });

  // ---------- ② 組合せ ----------
  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", function () { state.settings.mode = r.value; save(); });
  });
  $("start-time").addEventListener("change", function (e) { state.settings.startTime = e.target.value; save(); render(); });
  $("interval").addEventListener("change", function (e) {
    var v = parseInt(e.target.value, 10);
    state.settings.interval = isNaN(v) || v < 0 ? 0 : v;
    save();
    render();
  });
  // コースを変えると組の人数の並びも変わるので、組を作り直す
  $("course").addEventListener("change", function (e) { state.settings.course = e.target.value; selected = null; commit(); });

  $("avoid-repeats").addEventListener("change", function (e) { state.settings.avoidRepeats = e.target.checked; save(); });

  $("auto-assign").addEventListener("click", function () {
    state.groups = Core.assign(state.players, state.groups, state.settings.mode, Math.random, false, isSplit(), weights());
    state.assigned = true;
    selected = null;
    save();
    render();
  });

  $("clear-groups").addEventListener("click", function () {
    if (!window.confirm("先頭の指定・固定も含めて、組合せをすべてクリアしますか？")) return;
    state.groups = [];
    state.assigned = false;
    selected = null;
    commit();
  });

  $("groups").addEventListener("change", function (e) {
    if (!e.target.classList.contains("leader")) return;
    var gi = parseInt(e.target.getAttribute("data-g"), 10);
    var id = e.target.value || null;
    if (id) {
      // 他の組にいる場合はそこから外す（空いた枠は syncGroups で補充）
      state.groups.forEach(function (g, i) {
        if (i === gi) return;
        if (g.leaderId === id) g.leaderId = null;
        g.memberIds = g.memberIds.filter(function (x) { return x !== id; });
        g.locked = g.locked.filter(function (x) { return x !== id; });
      });
    }
    state.groups[gi].leaderId = id;
    selected = null;
    commit();
  });

  function removeFrom(gi, id) {
    if (gi < 0) return;
    var g = state.groups[gi];
    g.memberIds = g.memberIds.filter(function (x) { return x !== id; });
    g.locked = g.locked.filter(function (x) { return x !== id; });
  }

  function addPinned(gi, id) {
    if (gi < 0 || id == null) return;
    state.groups[gi].memberIds.push(id);
    state.groups[gi].locked.push(id);
  }

  // a と b を入れ替える。b.id が null なら a を b.g の空き枠へ移すだけ。
  function swap(a, b) {
    removeFrom(a.g, a.id);
    if (b.id != null) removeFrom(b.g, b.id);
    addPinned(b.g, a.id);
    addPinned(a.g, b.id);
    state.groups = Core.normalizeGroups(state.groups, state.players, true, isSplit());
    selected = null;
    save();
    render();
  }

  function onPick(g, id) {
    if (!selected) {
      if (id == null) return; // 空き枠を先にクリックしても何もしない
      selected = { g: g, id: id };
    } else if (selected.id === id) {
      selected = null;
    } else if (selected.g === g) {
      selected = id == null ? null : { g: g, id: id };
    } else {
      swap(selected, { g: g, id: id });
      return;
    }
    render();
  }

  $("groups").addEventListener("click", function (e) {
    var li = e.target.closest("li");
    if (!li || li.classList.contains("lead")) return;
    var gi = parseInt(li.getAttribute("data-g"), 10);
    if (e.target.classList.contains("pin")) {
      var id = li.getAttribute("data-id");
      var g = state.groups[gi];
      var at = g.locked.indexOf(id);
      if (at >= 0) g.locked.splice(at, 1);
      else g.locked.push(id);
      save();
      render();
      return;
    }
    onPick(gi, li.classList.contains("empty") ? null : li.getAttribute("data-id"));
  });

  $("unassigned").addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (chip) onPick(-1, chip.getAttribute("data-id"));
  });

  // ---------- ③ 案内状 ----------
  document.querySelectorAll("[data-inv]").forEach(function (input) {
    input.addEventListener("input", function () {
      var k = input.getAttribute("data-inv");
      state.invitation[k] = input.value;
      save();
      $("inv-preview").innerHTML = invitationBody();
      // 開催日で「今回」とみなす履歴が変わる
      if (k === "date" || k === "title") { renderPairing(); renderHistory(); }
    });
  });

  $("show-hc").addEventListener("change", function (e) {
    state.invitation.showHc = e.target.checked;
    save();
    renderInvitation();
  });

  $("show-ticket").addEventListener("change", function (e) {
    state.invitation.showTicket = e.target.checked;
    save();
    renderInvitation();
  });

  $("ticket-count").addEventListener("input", function (e) {
    var n = parseInt(e.target.value, 10);
    if (n >= 1 && n <= 12) {
      state.invitation.ticketCount = n;
      save();
      $("inv-preview").innerHTML = invitationBody();
    }
  });

  // ---------- QR コード画像 ----------
  var QR_MAX_BYTES = 1024 * 1024; // localStorage を圧迫しないよう 1MB まで

  function qrMsg(text) { $("qr-msg").textContent = text; }

  function setQrFile(file) {
    if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      qrMsg("PNG・JPEG・GIF・WebP の画像を選んでください。");
      return;
    }
    if (file.size > QR_MAX_BYTES) {
      qrMsg("画像が大きすぎます（1MB まで）。QR コード部分だけを切り抜いた画像にしてください。");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      if (!Core.isImageDataUrl(reader.result)) { qrMsg("画像として読み込めませんでした。"); return; }
      state.invitation.qrImage = reader.result;
      state.invitation.showQr = true;
      save();
      renderInvitation();
      qrMsg("QR コードを取り込みました。");
    };
    reader.readAsDataURL(file);
  }

  $("show-qr").addEventListener("change", function (e) {
    state.invitation.showQr = e.target.checked;
    save();
    renderInvitation();
  });

  $("qr-pick").addEventListener("click", function () { $("qr-file").click(); });

  $("qr-file").addEventListener("change", function (e) {
    setQrFile(e.target.files[0]);
    e.target.value = "";
  });

  $("qr-clear").addEventListener("click", function () {
    state.invitation.qrImage = "";
    state.invitation.showQr = false;
    save();
    renderInvitation();
    qrMsg("画像を外しました。");
  });

  // 案内状タブを開いているときに Ctrl+V で画像を貼り付けられるようにする
  document.addEventListener("paste", function (e) {
    if (!$("tab-invitation").classList.contains("active")) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
        e.preventDefault();
        setQrFile(items[i].getAsFile());
        return;
      }
    }
  });

  $("print").addEventListener("click", function () { window.print(); });

  function copyMsg(text) { $("copy-msg").textContent = text; }

  $("copy-table").addEventListener("click", function () {
    var secs = sections(), withHc = !!state.invitation.showHc;
    var html = Core.tableHtml(secs, withHc), tsv = Core.tableTsv(secs, withHc);
    $("copy-fallback").hidden = true;

    function done() { copyMsg("コピーしました。Word や Excel に貼り付けてください。"); }

    // 選択してコピーする昔ながらの方法（file:// で Clipboard API が使えない場合）
    function legacy() {
      var div = document.createElement("div");
      div.innerHTML = html;
      div.style.position = "fixed";
      div.style.left = "-9999px";
      document.body.appendChild(div);
      var range = document.createRange();
      range.selectNodeContents(div);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      sel.removeAllRanges();
      div.remove();
      if (ok) { done(); return; }
      var box = $("copy-fallback");
      box.value = tsv;
      box.hidden = false;
      box.select();
      copyMsg("自動でコピーできませんでした。下の枠を選んで Ctrl+C でコピーしてください。");
    }

    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new window.ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([tsv], { type: "text/plain" }),
      })]).then(done, legacy);
    } else {
      legacy();
    }
  });

  // ---------- ④ 履歴 ----------
  function renderHistory() {
    var v = state.invitation;
    $("hist-target").textContent = v.date
      ? Core.formatDateJa(v.date) + "　" + (v.title || "（表題なし）")
      : "（③案内状で開催日を入れてください）";
    $("hist-save").disabled = !v.date;

    var rs = rounds();
    var list = state.history.map(function (h, i) { return { h: h, i: i }; }).sort(function (a, b) {
      if (a.h.date !== b.h.date) return a.h.date < b.h.date ? 1 : -1;
      return b.i - a.i;
    });
    $("hist-empty").hidden = list.length > 0;
    $("hist-table").hidden = list.length === 0;
    $("hist-rows").innerHTML = list.map(function (x) {
      var h = x.h, k = rs.indexOf(h), on = h.use !== false;
      var use = k >= 0 ? AGO[k] + "として避ける"
        : !on ? "使わない"
        : h.date === v.date ? "今回の大会（対象外）" : "対象外（4回以上前）";
      var people = h.groups.reduce(function (s, g) { return s + g.length; }, 0);
      var detail = h.groups.map(function (g, gi) {
        return "<li>" + (gi + 1) + "組：" + g.map(esc).join("・") + "</li>";
      }).join("");
      return "<tr" + (on ? "" : ' class="off"') + '><td><input type="checkbox" class="hist-use" data-i="' + x.i + '"' +
        (on ? " checked" : "") + ' title="チェックを外すと、この回は同じ組を避ける対象に使いません"></td>' +
        "<td>" + esc(Core.formatDateJa(h.date)) + "</td><td>" + esc(h.label) + "</td>" +
        "<td>" + h.groups.length + "組・" + people + "人</td><td>" + esc(use) + "</td>" +
        '<td><details><summary>組合せ</summary><ul class="hist-groups">' + detail + "</ul></details></td>" +
        '<td><button class="danger hist-del" data-i="' + x.i + '">削除</button></td></tr>';
    }).join("");
  }

  // 今の組合せを、案内状の開催日・表題で履歴に入れる（同じ日付の回があれば置き換える）
  function saveHistory() {
    var v = state.invitation;
    if (!v.date) { window.alert("③案内状で開催日を入れてください。"); return; }
    var entry = Core.historyEntry(state.groups, state.players, v.date, v.title);
    var placed = entry.groups.reduce(function (s, g) { return s + g.length; }, 0);
    if (!placed) { window.alert("②組合せで組を作ってから保存してください。"); return; }
    if (placed < state.players.length &&
        !window.confirm("未割当の人が " + (state.players.length - placed) + "人います。このまま保存しますか？")) return;
    var at = -1;
    state.history.forEach(function (h, i) { if (h.date === v.date) at = i; });
    if (at >= 0) {
      if (!window.confirm(Core.formatDateJa(v.date) + " の履歴は保存済みです。今の組合せで置き換えますか？")) return;
      entry.use = state.history[at].use !== false; // 使う・使わないの選択は引き継ぐ
      state.history[at] = entry;
    } else {
      state.history.push(entry);
    }
    save();
    render();
    window.alert("履歴に保存しました（" + Core.formatDateJa(v.date) + "）。次回の割振りでは、この組合せをなるべく避けます。");
  }

  $("hist-save").addEventListener("click", saveHistory);
  $("inv-hist-save").addEventListener("click", saveHistory);

  $("hist-rows").addEventListener("change", function (e) {
    if (!e.target.classList.contains("hist-use")) return;
    var h = state.history[parseInt(e.target.getAttribute("data-i"), 10)];
    if (!h) return;
    h.use = e.target.checked;
    save();
    render();
  });

  $("hist-rows").addEventListener("click", function (e) {
    if (!e.target.classList.contains("hist-del")) return;
    var i = parseInt(e.target.getAttribute("data-i"), 10);
    var h = state.history[i];
    if (!h || !window.confirm(Core.formatDateJa(h.date) + "「" + h.label + "」の履歴を削除しますか？")) return;
    state.history.splice(i, 1);
    save();
    render();
  });

  // ---------- JSON 書き出し / 読み込み ----------
  $("export-json").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    var d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = "golf-pairing-" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $("import-json-btn").addEventListener("click", function () { $("import-json").click(); });

  $("import-json").addEventListener("change", function (e) {
    var file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); } catch (err) { window.alert("JSON として読めませんでした。"); return; }
      var problem = Core.validateImport(obj);
      if (problem) { window.alert("読み込めません: " + problem); return; }
      if (!window.confirm("今のデータを、このファイル（参加者 " + obj.players.length + "人）で置き換えますか？")) return;
      state = fromSaved(obj);
      selected = null;
      commit();
    };
    reader.readAsText(file, "utf-8");
  });

  // ---------- 起動 ----------
  syncGroups();
  if (storageOk) save(); // ダミーデータの割振り結果も保存し、開き直しても同じ組合せにする
  $("storage-warn").hidden = storageOk;
  render();
})();
