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
      settings: { mode: "balanced", startTime: "08:00", interval: 7, course: "OUT", showHc: false },
      groups: [],
      assigned: false, // 一度でも自動割振りしたか（以降は人数が変わっても空き枠を自動で補充する）
      invitation: { title: "", date: "", venue: "", address: "", meetTime: "", fee: "", notes: "", organizer: "" },
    };
  }

  function fromSaved(obj) {
    var d = defaultState();
    return {
      version: 1,
      players: obj.players,
      settings: Object.assign(d.settings, obj.settings || {}),
      groups: Array.isArray(obj.groups) ? obj.groups : [],
      assigned: !!obj.assigned,
      invitation: Object.assign(d.invitation, obj.invitation || {}),
    };
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
    return defaultState();
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

  // 参加者や先頭が変わったあと、組の形を人数に合わせ、割振り済みなら空き枠を埋める
  function syncGroups() {
    state.groups = state.assigned
      ? Core.assign(state.players, state.groups, state.settings.mode, Math.random, true)
      : Core.normalizeGroups(state.groups, state.players, true);
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

  // ---------- 描画 ----------
  function render() {
    renderPlayers();
    renderPairing();
    renderInvitation();
  }

  function sizesText(n) {
    var sizes = Core.groupSizes(n);
    if (!n) return "参加者がまだいません";
    var t = n + "人 → " + sizes.length + "組（" + sizes.join("・") + "人）";
    return t;
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
    $("auto-assign").disabled = state.players.length === 0;

    var n = state.players.length;
    $("pair-msg").innerHTML = n === 0
      ? '<span class="warn">先に①参加者で一覧を取り込んでください</span>'
      : esc(sizesText(n)) + (n === 5 ? ' <span class="warn">2人の組ができます</span>' : "");

    // 先頭に選ばれている人 → 組番号
    var leaderOf = {};
    state.groups.forEach(function (g, i) { if (g.leaderId) leaderOf[g.leaderId] = i; });

    var t = times();
    $("groups").innerHTML = state.groups.map(function (g, gi) {
      var size = Core.groupSizes(n)[gi];
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
            '</span><span class="hcv">' + hcText(p.hc) + "</span></li>";
        }
        var pinned = g.locked.indexOf(id) >= 0;
        var sel = selected && selected.id === id;
        return '<li class="member' + (sel ? " selected" : "") + '" data-g="' + gi + '" data-id="' + esc(id) + '">' +
          '<span class="nm">' + esc(p.name) + '</span><span class="hcv">' + hcText(p.hc) + "</span>" +
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

  function invitationBody() {
    var v = state.invitation;
    var rows = Core.tableRows(state.groups, state.players, times(), state.settings.showHc);
    var info = [];
    var when = [Core.formatDateJa(v.date), v.meetTime ? "集合 " + v.meetTime : ""].filter(Boolean).join("　");
    if (when) info.push(["日時", esc(when)]);
    if (v.venue || v.address) info.push(["会場", esc(v.venue) + (v.address ? "<br>" + esc(v.address) : "")]);
    if (v.fee) info.push(["会費", esc(v.fee)]);
    var hasMembers = state.groups.some(function (g) { return g.memberIds.length; });

    return "<h2>" + esc(v.title || "ゴルフコンペのご案内") + "</h2>" +
      '<p class="inv-lead">下記のとおり開催いたします。皆様のご参加をお待ちしております。</p>' +
      (info.length ? '<table class="inv-info">' + info.map(function (r) {
        return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>";
      }).join("") + "</table>" : "") +
      "<h3>組合せ</h3>" +
      (hasMembers ? Core.tableHtml(rows) : '<p class="empty-note">（②組合せで割り振ると、ここに表が入ります）</p>') +
      (v.notes ? '<div class="inv-notes">' + esc(v.notes) + "</div>" : "") +
      (v.organizer ? '<p class="inv-org">幹事：' + esc(v.organizer) + "</p>" : "");
  }

  function renderInvitation() {
    document.querySelectorAll("[data-inv]").forEach(function (input) {
      var k = input.getAttribute("data-inv");
      if (document.activeElement !== input) input.value = state.invitation[k] || "";
    });
    $("show-hc").checked = !!state.settings.showHc;
    $("inv-preview").innerHTML = invitationBody();
  }

  // ---------- タブ ----------
  document.querySelectorAll("nav button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var name = btn.getAttribute("data-tab");
      document.querySelectorAll("nav button").forEach(function (b) { b.classList.toggle("active", b === btn); });
      document.querySelectorAll("section.tab").forEach(function (s) { s.classList.toggle("active", s.id === "tab-" + name); });
    });
  });

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
  $("course").addEventListener("change", function (e) { state.settings.course = e.target.value; save(); render(); });

  $("auto-assign").addEventListener("click", function () {
    state.groups = Core.assign(state.players, state.groups, state.settings.mode, Math.random, false);
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
    state.groups = Core.normalizeGroups(state.groups, state.players, true);
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
      state.invitation[input.getAttribute("data-inv")] = input.value;
      save();
      $("inv-preview").innerHTML = invitationBody();
    });
  });

  $("show-hc").addEventListener("change", function (e) {
    state.settings.showHc = e.target.checked;
    save();
    renderInvitation();
  });

  $("print").addEventListener("click", function () { window.print(); });

  function copyMsg(text) { $("copy-msg").textContent = text; }

  $("copy-table").addEventListener("click", function () {
    var rows = Core.tableRows(state.groups, state.players, times(), state.settings.showHc);
    var html = Core.tableHtml(rows), tsv = Core.tableTsv(rows);
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
  $("storage-warn").hidden = storageOk;
  render();
})();
