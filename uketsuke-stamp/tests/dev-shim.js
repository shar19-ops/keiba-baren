/* 開発用: window.claude.use("db"/"downloads") を localStorage で真似る。本番では読み込まない */
(function () {
  "use strict";
  var STORE_KEY = "uketsuke_devdb_v1";
  var listeners = []; // {kind:"doc"|"col", path, next}

  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; } }
  function save(data) { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  function docSnap(path, data) {
    var body = data[path];
    return { id: path.split("/").pop(), exists: !!body, data: function () { return body; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function colSnap(col, data) {
    var docs = Object.keys(data).filter(function (p) { return p.indexOf(col + "/") === 0 && p.split("/").length === col.split("/").length + 1; })
      .sort().map(function (p) { return docSnap(p, data); });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function notify() {
    var data = load();
    listeners.forEach(function (l) {
      try { l.next(l.kind === "doc" ? docSnap(l.path, data) : colSnap(l.path, data)); } catch (e) { console.error(e); }
    });
  }
  window.addEventListener("storage", function (ev) { if (ev.key === STORE_KEY) notify(); });

  function docRef(path) {
    return {
      id: path.split("/").pop(),
      path: path,
      get: function () { return Promise.resolve(docSnap(path, load())); },
      set: function (body) { var d = load(); d[path] = JSON.parse(JSON.stringify(body)); save(d); notify(); return Promise.resolve(); },
      update: function (body) { var d = load(); if (!d[path]) return Promise.reject({ code: "invalid_argument", message: "missing" }); Object.assign(d[path], body); save(d); notify(); return Promise.resolve(); },
      delete: function () { var d = load(); delete d[path]; save(d); notify(); return Promise.resolve(); },
      onSnapshot: function (next) {
        var l = { kind: "doc", path: path, next: next };
        listeners.push(l);
        setTimeout(function () { next(docSnap(path, load())); }, 0);
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: function (id) { return docRef(col + "/" + (id || ("d" + Date.now().toString(36)))); },
      get: function () { return Promise.resolve(colSnap(col, load())); },
      onSnapshot: function (next) {
        var l = { kind: "col", path: col, next: next };
        listeners.push(l);
        setTimeout(function () { next(colSnap(col, load())); }, 0);
        return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
      }
    };
  }
  var db = { doc: docRef, collection: colRef };
  var downloads = {
    save: function (req) {
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = req.filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return Promise.resolve({ status: "saved" });
    }
  };
  window.claude = {
    use: function (name) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(name === "db" ? db : name === "downloads" ? downloads : null); }, 30);
      });
    }
  };
  window.__devShim = { reset: function () { localStorage.removeItem(STORE_KEY); notify(); } };
})();
