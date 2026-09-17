/* 状況タブ: サマリー・部署別・全端末履歴(リアルタイム) */
App.tabs.status = (function () {
  "use strict";
  var Core = window.UketsukeCore;
  var $ = function (id) { return document.getElementById(id); };
  var expanded = {}; // sheetName -> true

  function init() {}

  function render(state) {
    var ready = state.roster && state.keyStatus === "ok" && state.store;
    $("statusGate").hidden = !!ready;
    $("statusMain").hidden = !ready;
    if (!ready) {
      var msg = $("statusGateMsg");
      if (!state.runtimeReady || !state.eventLoaded) msg.textContent = "読み込み中…";
      else if (!state.db) msg.textContent = "共有DBに接続できません。";
      else if (!state.event || !state.rosterDoc) msg.textContent = "幹事が名簿を登録するまでお待ちください。";
      else msg.textContent = "受付タブでパスフレーズを入力すると表示されます。";
      return;
    }
    var checkins = App.checkins();
    var s = Core.summarize(state.roster, checkins);
    $("tChecked").textContent = String(s.total.checked);
    $("tPlan").textContent = String(s.total.planYes);
    $("tMissing").textContent = String(s.total.missing);
    $("tUnexpected").textContent = String(s.total.unexpected);
    $("statusUpdated").textContent = "更新 " + Core.formatTime(new Date().toISOString()) + (state.store.pendingCount ? "(この端末に未送信 " + state.store.pendingCount + " 件)" : "");
    renderDeptTable(s);
    renderHistory(state, checkins);
  }

  function renderDeptTable(s) {
    var table = $("deptTable");
    App.clear(table);
    table.appendChild(App.el("tr", {}, ["部署", "予定〇", "受付済", "未受付", "予定外"].map(function (t) { return App.el("th", { text: t }); })));
    s.byDept.forEach(function (d) {
      var tr = App.el("tr", { class: "clickable" }, [d.dept, d.planYes, d.checked, d.missing, d.unexpected].map(function (v) { return App.el("td", { text: String(v) }); }));
      tr.addEventListener("click", function () { expanded[d.sheetName] = !expanded[d.sheetName]; App.emit(); });
      table.appendChild(tr);
      if (expanded[d.sheetName]) {
        var names = d.missingPeople.map(function (p) { return p.name; }).join("、") || "未受付の人はいません";
        var td = App.el("td", { text: "未受付: " + names });
        td.setAttribute("colspan", "5");
        table.appendChild(App.el("tr", { class: "detail" }, [td]));
      }
    });
    if (s.unlisted.length) {
      table.appendChild(App.el("tr", {}, ["名簿外", "", s.unlisted.length, "", s.unlisted.length].map(function (v) { return App.el("td", { text: String(v) }); })));
    }
    table.appendChild(App.el("tr", { class: "total" }, ["合計", s.total.planYes, s.total.checked, s.total.missing, s.total.unexpected].map(function (v) { return App.el("td", { text: String(v) }); })));
  }

  function renderHistory(state, checkins) {
    var list = $("allHistory");
    App.clear(list);
    var rows = Core.buildRows(state.roster, checkins).reverse();
    $("allHistoryEmpty").hidden = rows.length > 0;
    rows.forEach(function (r) {
      list.appendChild(App.el("li", {}, [
        App.el("span", { class: "ci-name", text: r.name }),
        App.el("span", { class: "ci-dept", text: r.dept + (r.judge ? "・" + r.judge : "") }),
        App.el("span", { class: "ci-meta", text: Core.formatTime(r.t) + " " + r.dev + " " + (Core.KIND_LABEL[r.kind] || r.kind) }),
        App.el("button", { class: "ci-undo", text: "取消", onClick: function () {
          if (!confirm(r.name + " の受付を取り消しますか?")) return;
          state.store.cancel(r.pid);
        } })
      ]));
    });
  }

  return { init: init, render: render };
})();
