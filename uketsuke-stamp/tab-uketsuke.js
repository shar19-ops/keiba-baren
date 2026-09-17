/* 受付タブ: パスフレーズ入口・カメラ・名簿検索・飛び入り・端末履歴 */
App.tabs.uketsuke = (function () {
  "use strict";
  var Core = window.UketsukeCore;
  var $ = function (id) { return document.getElementById(id); };

  var video, canvas, ctx, stream = null, scanning = false;
  var lastHit = { id: null, t: 0 };
  var peopleById = {};

  function init() {
    video = $("video");
    canvas = $("canvas");
    ctx = canvas.getContext("2d", { willReadFrequently: true });

    $("gateBtn").addEventListener("click", enterPass);
    $("gatePass").addEventListener("keydown", function (e) { if (e.key === "Enter") enterPass(); });

    var dev = $("deviceLabel");
    dev.value = App.storageGet(App.KEYS.device) || "";
    dev.addEventListener("input", function () { App.storageSet(App.KEYS.device, dev.value); App.emit(); });

    $("scanToggleBtn").addEventListener("click", function () { if (scanning) stopScanning(); else if (!starting) startScanning(); });
    $("searchInput").addEventListener("input", renderSearch);
    $("walkinAddBtn").addEventListener("click", addWalkin);
    $("forgetKeyBtn").addEventListener("click", function () {
      if (!confirm("この端末からパスフレーズを削除します。次回は再入力が必要です。")) return;
      stopScanning();
      App.forgetKey();
    });
  }

  function deviceName() {
    return $("deviceLabel").value.trim() || "受付";
  }

  // ---------- 表示 ----------
  function render(state) {
    var gate = $("gateCard"), main = $("uketsukeMain"), msg = $("gateMsg"), form = $("gateForm");
    var ready = state.roster && state.keyStatus === "ok" && state.store;
    gate.hidden = !!ready;
    main.hidden = !ready;
    if (!ready) {
      stopScanning();
      form.hidden = true;
      if (!state.runtimeReady || !state.eventLoaded) msg.textContent = "読み込み中…";
      else if (!state.db) msg.textContent = "共有DBに接続できません。claude.ai にサインインし、この Artifact を共有された状態で開いてください。";
      else if (!state.event || !state.rosterDoc) msg.textContent = "幹事が名簿を登録するまでお待ちください。";
      else if (state.keyStatus === "checking") msg.textContent = "パスフレーズを確認中…";
      else {
        msg.textContent = "幹事から伝えられたパスフレーズを入力してください。";
        form.hidden = false;
        $("gateErr").hidden = state.keyStatus !== "bad";
      }
      return;
    }

    peopleById = {};
    state.roster.people.forEach(function (p) { peopleById[p.id] = p; });

    var s = Core.summarize(state.roster, App.checkins());
    $("cntChecked").textContent = String(s.total.checked);
    $("cntPlan").textContent = String(s.total.planYes);

    var badge = $("pendingBadge");
    var pending = state.store.pendingCount;
    badge.hidden = pending === 0;
    badge.textContent = "未送信 " + pending + " 件";

    renderSearch();
    renderMyHistory();
  }

  // ---------- パスフレーズ ----------
  async function enterPass() {
    var pass = $("gatePass").value;
    if (!pass) { App.toast("パスフレーズを入力してください"); return; }
    var ok = await App.applyKey(pass);
    if (ok) $("gatePass").value = "";
  }

  // ---------- 受付処理(共通) ----------
  function recordCheckin(pid, kind, extra) {
    var state = App.state;
    var data = Object.assign({ t: new Date().toISOString(), dev: deviceName(), kind: kind, v: (state.rosterDoc && state.rosterDoc.version) || 0 }, extra || {});
    state.store.checkIn(pid, data);
  }

  function describeExisting(rec) {
    return Core.formatClock(rec.t) + " " + (rec.dev || "") + " で受付済み";
  }

  // ---------- スタンプ演出 ----------
  function flashStamp(mode, who) {
    var flash = $("stampFlash");
    $("stampKanji").textContent = mode === "dup" ? "済" : mode === "unknown" ? "?" : "受付";
    $("stampWho").textContent = who || "";
    flash.classList.toggle("dup", mode === "dup");
    flash.classList.toggle("unknown", mode === "unknown");
    flash.classList.remove("show");
    void flash.offsetWidth;
    flash.classList.add("show");
  }

  // ---------- カメラ ----------
  function stopScanning() {
    scanning = false;
    $("scanToggleBtn").textContent = "スキャン開始";
    $("idleMsg").style.display = "flex";
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
  }

  var starting = false;
  async function startScanning() {
    if (scanning || starting) return;
    starting = true;
    var s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      starting = false;
      App.toast("カメラを起動できませんでした。ブラウザの権限設定をご確認ください。");
      return;
    }
    starting = false;
    if ($("uketsukeMain").hidden || scanning) {
      // 待っている間に画面が閉じた / 既に別のストリームが動いている: 今取得した分は捨てる
      s.getTracks().forEach(function (t) { t.stop(); });
      return;
    }
    stream = s;
    video.srcObject = stream;
    await video.play();
    scanning = true;
    $("scanToggleBtn").textContent = "スキャン停止";
    $("idleMsg").style.display = "none";
    requestAnimationFrame(tick);
  }

  function tick() {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = null;
      try { code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" }); } catch (e) {}
      if (code && code.data) handleDecoded(code.data);
    }
    requestAnimationFrame(tick);
  }

  function handleDecoded(text) {
    var now = Date.now();
    text = String(text).trim();
    if (lastHit.id === text && now - lastHit.t < 2500) return;
    lastHit = { id: text, t: now };
    if (text.indexOf("RS2:") !== 0) {
      flashStamp("unknown", "対応外のQR");
      App.toast("このアプリのQRではありません");
      return;
    }
    var pid = text.slice(4);
    var p = peopleById[pid];
    if (!p) {
      flashStamp("unknown", "名簿にありません");
      App.toast("名簿にないQRです。名簿から検索してください");
      return;
    }
    var existing = App.state.store.get(pid);
    if (existing) {
      flashStamp("dup", p.name + String.fromCharCode(10) + describeExisting(existing));
      return;
    }
    recordCheckin(pid, "qr");
    flashStamp("ok", p.name + "　" + p.dept);
  }

  // ---------- 名簿検索 ----------
  function renderSearch() {
    var state = App.state;
    var list = $("searchResults");
    var hint = $("searchHint");
    App.clear(list);
    if (!state.roster) return;
    var q = $("searchInput").value.trim();
    if (!q) { hint.textContent = "氏名の一部か部署名を入力すると候補が出ます(" + state.roster.people.length + " 名)"; return; }
    var hits = Core.searchPeople(state.roster.people, q);
    hint.textContent = hits.length > 30 ? "候補が多すぎます(" + hits.length + " 名)。もう少し絞ってください" : hits.length === 0 ? "該当する人がいません" : "";
    hits.slice(0, 30).forEach(function (p) {
      var rec = state.store.get(p.id);
      var li = App.el("li", { class: rec ? "done" : "" }, [
        App.el("span", { class: "ci-name", text: p.name }),
        App.el("span", { class: "ci-dept", text: p.dept + (p.title ? "・" + p.title : "") }),
        App.el("span", { class: "ci-meta" }, [
          App.el("span", { class: "pill " + (p.plan === "yes" ? "yes" : ""), text: "予定" + (Core.formatPlan(p.plan) || "未") }),
          rec ? App.el("span", { class: "pill done", text: "受付済 " + Core.formatClock(rec.t) }) : null
        ])
      ]);
      if (!rec) {
        li.addEventListener("click", function () {
          if (App.state.store.get(p.id)) { App.toast(p.name + " は受付済みです"); return; }
          if (!confirm(p.name + "(" + p.dept + ")を受付しますか?")) return;
          recordCheckin(p.id, "manual");
          flashStamp("ok", p.name + "　" + p.dept);
          $("searchInput").value = "";
          App.emit();
        });
      }
      list.appendChild(li);
    });
  }

  // ---------- 飛び入り ----------
  async function addWalkin() {
    var state = App.state;
    var name = $("walkinName").value.trim();
    var dept = $("walkinDept").value.trim();
    if (!name) { App.toast("氏名を入力してください"); return; }
    if (!state.key) return;
    var pid = Core.walkinId();
    var enc = await Core.encryptJson(state.key, { name: name, dept: dept });
    state.walkinNames[pid] = { name: name, dept: dept };
    recordCheckin(pid, "walkin", { enc: enc });
    flashStamp("ok", name + (dept ? "　" + dept : ""));
    $("walkinName").value = "";
    $("walkinDept").value = "";
    App.emit();
  }

  // ---------- この端末の履歴 ----------
  function renderMyHistory() {
    var list = $("myHistory");
    var empty = $("myHistoryEmpty");
    App.clear(list);
    var dev = deviceName();
    var rows = Core.buildRows(App.state.roster, App.checkins()).filter(function (r) { return r.dev === dev; }).reverse().slice(0, 20);
    empty.hidden = rows.length > 0;
    rows.forEach(function (r) {
      var li = App.el("li", {}, [
        App.el("span", { class: "ci-name", text: r.name }),
        App.el("span", { class: "ci-dept", text: r.dept }),
        App.el("span", { class: "ci-meta", text: Core.formatTime(r.t) + " " + (Core.KIND_LABEL[r.kind] || r.kind) }),
        App.el("button", { class: "ci-undo", text: "取消", onClick: function () {
          if (!confirm(r.name + " の受付を取り消しますか?")) return;
          App.state.store.cancel(r.pid);
        } })
      ]);
      list.appendChild(li);
    });
  }

  function hide() {
    stopScanning();
  }

  // _decode はブラウザでの手動確認用(QR 文字列を直接流し込む)
  return { init: init, render: render, hide: hide, _decode: handleDecoded };
})();
