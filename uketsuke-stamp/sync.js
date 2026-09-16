/* 受付スタンプ sync: 共有DB(checkins)の購読と端末内キュー。ブラウザ / Node 両対応 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UketsukeSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PENDING_KEY = "uketsuke_pending_v2";
  var COLLECTION = "checkins";

  function SyncStore(opts) {
    this.db = opts.db;
    this.storage = opts.storage || null;
    this.retryMs = opts.retryMs || 5000;
    this.setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    this.clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
    this.records = {};
    this.pending = this._loadPending();
    this.listeners = [];
    this.unsub = null;
    this.timer = null;
    this.flushing = false;
    this.ready = false;
    this.error = null;
    this.flushPromise = null;
  }

  Object.defineProperty(SyncStore.prototype, "pendingCount", {
    get: function () { return this.pending.length; }
  });

  SyncStore.prototype.start = function () {
    var self = this;
    this.unsub = this.db.collection(COLLECTION).onSnapshot(function (snap) {
      var next = {};
      snap.docs.forEach(function (d) { next[d.id] = Object.assign({ pid: d.id }, d.data()); });
      self.records = next;
      self.ready = true;
      self.error = null;
      self._emit();
    }, function (err) {
      self.error = err;
      self._emit();
    });
    if (this.pending.length) this.flush();
  };

  SyncStore.prototype.stop = function () {
    if (this.unsub) this.unsub();
    this.unsub = null;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
  };

  SyncStore.prototype.onChange = function (fn) {
    var self = this;
    this.listeners.push(fn);
    return function () { self.listeners = self.listeners.filter(function (f) { return f !== fn; }); };
  };

  SyncStore.prototype._pendingFor = function (pid) {
    for (var i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].id === pid) return this.pending[i];
    }
    return null;
  };

  SyncStore.prototype.get = function (pid) {
    var op = this._pendingFor(pid);
    if (op) return op.op === "set" ? Object.assign({ pid: pid }, op.data) : null;
    return this.records[pid] || null;
  };

  SyncStore.prototype.has = function (pid) {
    return !!this.get(pid);
  };

  SyncStore.prototype.all = function () {
    var merged = Object.assign({}, this.records);
    this.pending.forEach(function (op) {
      if (op.op === "set") merged[op.id] = Object.assign({ pid: op.id }, op.data);
      else delete merged[op.id];
    });
    return Object.keys(merged).map(function (k) { return merged[k]; });
  };

  SyncStore.prototype.checkIn = function (pid, data) {
    this._enqueue({ op: "set", id: pid, data: data });
    return this.flush();
  };

  SyncStore.prototype.cancel = function (pid) {
    this._enqueue({ op: "delete", id: pid });
    return this.flush();
  };

  SyncStore.prototype._enqueue = function (op) {
    this.pending = this.pending.filter(function (p) { return p.id !== op.id; });
    this.pending.push(op);
    this._savePending();
    this._emit();
  };

  SyncStore.prototype.flush = function () {
    if (this.flushing) return this.flushPromise;
    var self = this;
    this.flushPromise = this._flushLoop().then(function () { self.flushPromise = null; });
    return this.flushPromise;
  };

  SyncStore.prototype._flushLoop = async function () {
    this.flushing = true;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    var self = this;
    try {
      while (this.pending.length) {
        var op = this.pending[0];
        var ref = this.db.collection(COLLECTION).doc(op.id);
        try {
          if (op.op === "set") await ref.set(op.data); else await ref.delete();
        } catch (e) {
          this.timer = this.setTimer(function () { self.timer = null; self.flush(); }, this.retryMs);
          this._emit();
          return;
        }
        this.pending = this.pending.filter(function (p) { return p !== op; });
        this._savePending();
        this._emit();
      }
    } finally {
      this.flushing = false;
    }
  };

  SyncStore.prototype._loadPending = function () {
    if (!this.storage) return [];
    try {
      var list = JSON.parse(this.storage.getItem(PENDING_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  };

  SyncStore.prototype._savePending = function () {
    if (!this.storage) return;
    try { this.storage.setItem(PENDING_KEY, JSON.stringify(this.pending)); } catch (e) {}
  };

  SyncStore.prototype._emit = function () {
    var self = this;
    this.listeners.slice().forEach(function (fn) {
      try { fn(self); } catch (e) {}
    });
  };

  return { SyncStore: SyncStore, PENDING_KEY: PENDING_KEY };
});
