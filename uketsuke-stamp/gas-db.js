/* 受付スタンプ GasDb: Google Apps Script(スプレッドシート)を Firestore ライクな
   doc()/collection() インターフェースで見せるアダプター。claude.ai アカウント不要版で使う。
   app.js / sync.js は state.db がこのインターフェースを満たしていれば動く前提。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UketsukeGasDb = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DOC_PATHS = ["event/current", "roster/current"];
  var COLLECTIONS = ["checkins"];

  function GasDb(opts) {
    opts = opts || {};
    this.url = opts.url;
    this.fetchImpl = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : self) : null);
    this.pollMs = opts.pollMs || 4000;
    this.setTimer = opts.setTimer || function (fn, ms) { return setInterval(fn, ms); };
    this.clearTimer = opts.clearTimer || function (t) { clearInterval(t); };
    this._docData = {}; // path -> value | null
    this._checkins = {};
    this._docListeners = {};
    this._colListeners = {};
    DOC_PATHS.forEach(function (p) { this._docData[p] = null; this._docListeners[p] = []; }, this);
    COLLECTIONS.forEach(function (c) { this._colListeners[c] = []; }, this);
    this._pollOk = null; // null: 未実施, true/false: 直近の結果
    this._timer = null;
    this._inflight = null;
    this._seq = 0;       // 送信順の通し番号(古い応答が新しい応答を追い越して上書きしないためのガード)
    this._appliedSeq = 0;
  }

  GasDb.prototype.start = function () {
    this.refresh();
    var self = this;
    if (!this._timer) this._timer = this.setTimer(function () { self.refresh(); }, this.pollMs);
  };

  GasDb.prototype.stop = function () {
    if (this._timer) { this.clearTimer(this._timer); this._timer = null; }
  };

  GasDb.prototype._applyState = function (data) {
    this._docData["event/current"] = data.event || null;
    this._docData["roster/current"] = data.roster || null;
    this._checkins = data.checkins || {};
    var self = this;
    DOC_PATHS.forEach(function (p) { self._notifyDoc(p); });
    COLLECTIONS.forEach(function (c) { self._notifyCol(c); });
  };

  // seq より新しい(大きい)応答が既に反映済みなら、この応答は無視する。
  // GET(定期更新)と POST(書込)は別々に飛ぶので、書込前に飛んだ GET が
  // 書込の応答より後に届くと、せっかく保存した内容を古い状態で上書きしてしまう。
  // 送信した順に番号を振り、より新しい送信の結果だけを採用することでこれを防ぐ。
  GasDb.prototype._maybeApply = function (seq, data) {
    if (seq <= this._appliedSeq) return;
    this._appliedSeq = seq;
    this._applyState(data);
  };

  GasDb.prototype.refresh = function () {
    if (this._inflight) return this._inflight;
    var self = this;
    if (!this.fetchImpl) return Promise.reject(new Error("fetch が使えません"));
    var seq = ++this._seq;
    var sep = this.url.indexOf("?") >= 0 ? "&" : "?";
    this._inflight = this.fetchImpl(this.url + sep + "action=state")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        self._inflight = null;
        self._pollOk = true;
        self._maybeApply(seq, data);
      })
      .catch(function (e) {
        self._inflight = null;
        var wasOk = self._pollOk;
        self._pollOk = false;
        if (wasOk !== false) self._notifyError(errorOf(e));
        throw e;
      });
    return this._inflight;
  };

  function errorOf(e) {
    var err = new Error(e && e.message ? e.message : String(e));
    err.code = "unavailable";
    return err;
  }

  GasDb.prototype._post = function (body) {
    var self = this;
    if (!this.fetchImpl) return Promise.reject(errorOf(new Error("fetch が使えません")));
    var seq = ++this._seq;
    return this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (data) {
      self._pollOk = true;
      self._maybeApply(seq, data);
    }).catch(function (e) {
      throw errorOf(e);
    });
  };

  function makeDocSnap(value) {
    return { exists: value !== null && value !== undefined, data: function () { return value; } };
  }

  GasDb.prototype._notifyDoc = function (path) {
    var value = this._docData[path];
    (this._docListeners[path] || []).slice().forEach(function (l) {
      try { l.cb(makeDocSnap(value)); } catch (e) { /* ignore */ }
    });
  };

  GasDb.prototype._notifyCol = function (name) {
    var map = name === "checkins" ? this._checkins : {};
    var docs = Object.keys(map).map(function (id) {
      return { id: id, data: function () { return map[id]; } };
    });
    (this._colListeners[name] || []).slice().forEach(function (l) {
      try { l.cb({ docs: docs }); } catch (e) { /* ignore */ }
    });
  };

  GasDb.prototype._notifyError = function (err) {
    var self = this;
    Object.keys(this._docListeners).forEach(function (p) {
      self._docListeners[p].slice().forEach(function (l) { if (l.errCb) try { l.errCb(err); } catch (e) {} });
    });
    Object.keys(this._colListeners).forEach(function (c) {
      self._colListeners[c].slice().forEach(function (l) { if (l.errCb) try { l.errCb(err); } catch (e) {} });
    });
  };

  GasDb.prototype.doc = function (path) {
    var self = this;
    return {
      onSnapshot: function (cb, errCb) {
        if (!self._docListeners[path]) throw new Error("未対応の doc パス: " + path);
        var entry = { cb: cb, errCb: errCb };
        self._docListeners[path].push(entry);
        return function () {
          self._docListeners[path] = self._docListeners[path].filter(function (e) { return e !== entry; });
        };
      },
      set: function (data) { return self._post({ action: "setDoc", path: path, data: data }); },
      delete: function () { return self._post({ action: "deleteDoc", path: path }); }
    };
  };

  GasDb.prototype.collection = function (name) {
    var self = this;
    return {
      doc: function (id) {
        return {
          set: function (data) { return self._post({ action: "colSet", collection: name, id: id, data: data }); },
          delete: function () { return self._post({ action: "colDelete", collection: name, id: id }); }
        };
      },
      onSnapshot: function (cb, errCb) {
        if (!self._colListeners[name]) throw new Error("未対応のコレクション: " + name);
        var entry = { cb: cb, errCb: errCb };
        self._colListeners[name].push(entry);
        return function () {
          self._colListeners[name] = self._colListeners[name].filter(function (e) { return e !== entry; });
        };
      },
      get: function () {
        return self.refresh().then(function () {
          var map = name === "checkins" ? self._checkins : {};
          return { docs: Object.keys(map).map(function (id) { return { id: id }; }) };
        });
      }
    };
  };

  return { GasDb: GasDb };
});
