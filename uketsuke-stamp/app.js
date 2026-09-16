/* 受付スタンプ app: 共通状態・Artifact ランタイム接続・鍵・タブ */
window.App = (function () {
  "use strict";
  var Core = window.UketsukeCore;
  var Sync = window.UketsukeSync;

  var KEYS = { pass: "uketsuke_pass_v2", device: "uketsuke_device_v2", tab: "uketsuke_tab_v2" };

  var state = {
    runtimeReady: false,
    db: null,
    downloads: null,
    event: null,
    eventLoaded: false,
    rosterDoc: null,
    roster: null,
    key: null,
    keySalt: null,
    keyStatus: "none", // none | checking | ok | bad
    store: null,
    walkinNames: {}
  };
  var listeners = [];
  var tabs = {};
  var currentTab = null;

  // ---------- 端末内保存 ----------
  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function storageRemove(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---------- 変更通知 ----------
  function onChange(fn) { listeners.push(fn); }
  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  // ---------- 小物 ----------
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "onClick") node.addEventListener("click", v);
      else if (k === "hidden") node.hidden = !!v;
      else if (k === "disabled") node.disabled = !!v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------- 受付記録(飛び入り氏名を復号済みで返す) ----------
  function checkins() {
    if (!state.store) return [];
    return state.store.all().map(function (r) {
      if (r.kind === "walkin" && state.walkinNames[r.pid]) return Object.assign({}, r, state.walkinNames[r.pid]);
      return r;
    });
  }

  async function decryptWalkins() {
    if (!state.key || !state.store) return;
    var list = state.store.all();
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.kind !== "walkin" || !r.enc || state.walkinNames[r.pid]) continue;
      try {
        state.walkinNames[r.pid] = await Core.decryptJson(state.key, r.enc);
      } catch (e) {
        state.walkinNames[r.pid] = { name: "(復号できません)", dept: "" };
      }
    }
  }

  // ---------- 鍵と名簿 ----------
  async function loadRoster() {
    if (!state.key || !state.rosterDoc || !state.rosterDoc.blob) { state.roster = null; return; }
    try {
      state.roster = await Core.decryptJson(state.key, state.rosterDoc.blob);
    } catch (e) {
      state.roster = null;
    }
  }

  // パスフレーズを検証して鍵を持つ。成功で true
  async function applyKey(passphrase) {
    if (!state.event || !state.event.salt) return false;
    state.keyStatus = "checking";
    emit();
    var key = await Core.deriveKey(passphrase, state.event.salt);
    var ok = await Core.verifyKey(key, state.event.check);
    if (!ok) {
      state.keyStatus = "bad";
      emit();
      return false;
    }
    state.key = key;
    state.keySalt = state.event.salt;
    state.keyStatus = "ok";
    storageSet(KEYS.pass, passphrase);
    await loadRoster();
    await decryptWalkins();
    emit();
    return true;
  }

  // 幹事が初回保存で作った鍵をそのまま使う
  function adoptKey(passphrase, key, salt) {
    state.key = key;
    state.keySalt = salt;
    state.keyStatus = "ok";
    storageSet(KEYS.pass, passphrase);
  }

  function forgetKey() {
    state.key = null;
    state.keySalt = null;
    state.keyStatus = "none";
    state.roster = null;
    state.walkinNames = {};
    storageRemove(KEYS.pass);
    emit();
  }

  // イベントが変わった(作成 / 削除 / salt 変更)時に鍵を追従させる
  async function syncKeyWithEvent() {
    if (!state.event) {
      if (state.key) forgetKey();
      return;
    }
    if (state.key && state.keySalt === state.event.salt) return;
    state.key = null;
    state.keySalt = null;
    state.roster = null;
    state.keyStatus = "none";
    var saved = storageGet(KEYS.pass);
    if (saved) {
      var ok = await applyKey(saved);
      if (!ok) storageRemove(KEYS.pass);
    }
  }

  // ---------- ファイル保存 ----------
  async function saveFile(filename, data) {
    if (state.downloads) {
      try {
        await state.downloads.save({ filename: filename, data: data });
        toast("保存しました: " + filename);
        return;
      } catch (e) {
        if (e && e.code === "declined") return;
      }
    }
    try {
      var blob = data instanceof Blob ? data : new Blob([data]);
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("書き出しに失敗しました");
    }
  }

  function writeErrorMessage(e) {
    if (e && e.code === "invalid_argument") return "幹事権限(編集可の共有)が必要です";
    if (e && e.code === "quota_exceeded") return "共有DBの上限に達しました";
    return "保存に失敗しました" + (e && e.message ? ": " + e.message : "");
  }

  // ---------- タブ ----------
  function selectTab(name) {
    if (!tabs[name]) name = "uketsuke";
    if (currentTab && currentTab !== name && tabs[currentTab].hide) tabs[currentTab].hide();
    currentTab = name;
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    document.querySelectorAll(".panel").forEach(function (p) { p.classList.toggle("active", p.id === "panel-" + name); });
    storageSet(KEYS.tab, name);
    if (tabs[name].show) tabs[name].show();
  }

  function renderHead() {
    var head = document.getElementById("headEvent");
    if (state.event && state.event.title) {
      head.textContent = state.event.title + (state.event.dateText ? "　" + state.event.dateText : "");
    } else {
      head.textContent = "社内イベント出欠のその場デジタル受付";
    }
  }

  // ---------- 起動 ----------
  async function boot() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { selectTab(btn.dataset.tab); });
    });
    Object.keys(tabs).forEach(function (k) { tabs[k].init(); });
    onChange(function () {
      renderHead();
      Object.keys(tabs).forEach(function (k) { tabs[k].render(state); });
    });
    selectTab(storageGet(KEYS.tab) || "uketsuke");
    emit();

    if (!(window.claude && typeof window.claude.use === "function")) {
      state.runtimeReady = true;
      state.eventLoaded = true;
      emit();
      return;
    }
    var got = await Promise.all([window.claude.use("db"), window.claude.use("downloads")]);
    state.db = got[0];
    state.downloads = got[1];
    state.runtimeReady = true;
    if (!state.db) {
      state.eventLoaded = true;
      emit();
      return;
    }
    state.db.doc("event/current").onSnapshot(function (snap) {
      state.event = snap.exists ? snap.data() : null;
      state.eventLoaded = true;
      emit();
      syncKeyWithEvent().then(emit);
    }, function (err) {
      toast("共有DBの購読が切れました(" + err.code + ")。ページを再読み込みしてください");
    });
    state.db.doc("roster/current").onSnapshot(function (snap) {
      state.rosterDoc = snap.exists ? snap.data() : null;
      loadRoster().then(emit);
    }, function (err) {
      toast("名簿の購読が切れました(" + err.code + ")");
    });
    state.store = new Sync.SyncStore({ db: state.db, storage: window.localStorage });
    state.store.onChange(function () { decryptWalkins().then(emit); });
    state.store.start();
    emit();
  }

  return {
    state: state,
    KEYS: KEYS,
    tabs: tabs,
    onChange: onChange,
    emit: emit,
    toast: toast,
    el: el,
    clear: clear,
    checkins: checkins,
    applyKey: applyKey,
    adoptKey: adoptKey,
    forgetKey: forgetKey,
    loadRoster: loadRoster,
    saveFile: saveFile,
    writeErrorMessage: writeErrorMessage,
    selectTab: selectTab,
    boot: boot,
    storageGet: storageGet,
    storageSet: storageSet,
    storageRemove: storageRemove
  };
})();
