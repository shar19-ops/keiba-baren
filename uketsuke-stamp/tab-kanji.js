/* 幹事タブ: イベント設定・名簿取込・QR発行・書き出し・リセット */
App.tabs.kanji = (function () {
  "use strict";
  var Core = window.UketsukeCore;
  var $ = function (id) { return document.getElementById(id); };
  var parsed = null; // 直近に取り込んだ parseWorkbook の結果
  var saving = false;
  var NL = String.fromCharCode(10);

  function init() {
    ["evTitle", "evDate", "evVenue"].forEach(function (id) {
      $(id).addEventListener("input", function () { $(id).dataset.dirty = "1"; });
    });
    $("xlsxFile").addEventListener("change", onFileChosen);
    $("saveRosterBtn").addEventListener("click", saveRoster);
    $("kanjiUnlockBtn").addEventListener("click", unlock);
    $("kanjiPass").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
    $("genQrBtn").addEventListener("click", generateQr);
    $("printBtn").addEventListener("click", printQrCards);
    $("exportCsvBtn").addEventListener("click", exportCsv);
    $("exportXlsxBtn").addEventListener("click", exportXlsx);
    $("resetBtn").addEventListener("click", resetEvent);
  }

  // ---------- 表示 ----------
  function render(state) {
    var hasEvent = !!state.event;
    $("passSetup").hidden = hasEvent;
    $("passStatus").hidden = !hasEvent;
    $("kanjiUnlock").hidden = !(hasEvent && state.keyStatus !== "ok");
    var msg = $("kanjiUnlockMsg");
    msg.hidden = state.keyStatus !== "bad" && state.keyStatus !== "checking";
    msg.textContent = state.keyStatus === "checking" ? "確認中…" : "パスフレーズが違います";
    msg.classList.toggle("bad", state.keyStatus === "bad");

    // イベント欄: 入力中でなければ共有DBの値を反映
    if (hasEvent) {
      ["evTitle", "evDate", "evVenue"].forEach(function (id, i) {
        var field = $(id);
        var v = [state.event.title, state.event.dateText, state.event.venue][i] || "";
        if (document.activeElement !== field && !field.dataset.dirty) field.value = v;
      });
    }

    var info = $("rosterInfo");
    if (!state.db) info.textContent = "共有DBに接続できません";
    else if (!state.rosterDoc) info.textContent = "共有DBの名簿: 未登録";
    else if (state.roster) info.textContent = "共有DBの名簿: " + state.roster.people.length + " 名(版 " + state.rosterDoc.version + ")";
    else info.textContent = "共有DBの名簿: " + state.rosterDoc.count + " 名(版 " + state.rosterDoc.version + ")。パスフレーズを入力すると内容を扱えます";

    var canSave = !!parsed && !!state.db && !saving && (hasEvent ? state.keyStatus === "ok" : true);
    $("saveRosterBtn").disabled = !canSave;
    var hasRoster = !!state.roster;
    $("genQrBtn").disabled = !hasRoster;
    $("exportCsvBtn").disabled = !hasRoster;
    $("exportXlsxBtn").disabled = !hasRoster;
    $("resetBtn").disabled = !state.db || !hasEvent;
  }

  // ---------- パスフレーズ確認(別 PC の幹事用) ----------
  async function unlock() {
    var pass = $("kanjiPass").value;
    if (!pass) { App.toast("パスフレーズを入力してください"); return; }
    var ok = await App.applyKey(pass);
    if (ok) { $("kanjiPass").value = ""; App.toast("パスフレーズを確認しました"); }
  }

  // ---------- Excel 取込 ----------
  async function onFileChosen() {
    var file = $("xlsxFile").files[0];
    if (!file) return;
    var buf;
    try {
      buf = await file.arrayBuffer();
      var wb = XLSX.read(buf, { type: "array" });
      parsed = Core.parseWorkbook(wb, XLSX);
    } catch (e) {
      parsed = null;
      $("importPreview").hidden = true;
      App.toast(e && e.message ? e.message : "Excel を読み込めませんでした");
      App.emit();
      return;
    }
    ["evTitle", "evDate", "evVenue"].forEach(function (id, i) {
      var f = $(id);
      var v = [parsed.event.title, parsed.event.dateText, parsed.event.venue][i];
      if (v && !f.value) { f.value = v; f.dataset.dirty = "1"; }
    });
    renderPreview();
    App.emit();
  }

  function renderPreview() {
    var table = $("previewTable");
    App.clear(table);
    var head = App.el("tr", {}, ["シート", "人数", "〇", "×", "未回答"].map(function (t) { return App.el("th", { text: t }); }));
    table.appendChild(head);
    var total = { n: 0, yes: 0, no: 0, unknown: 0 };
    parsed.sheets.forEach(function (s) {
      var c = { n: 0, yes: 0, no: 0, unknown: 0 };
      parsed.people.forEach(function (p) { if (p.sheetName === s.sheetName) { c.n++; c[p.plan]++; } });
      Object.keys(c).forEach(function (k) { total[k] += c[k]; });
      table.appendChild(App.el("tr", {}, [s.sheetName, c.n, c.yes, c.no, c.unknown].map(function (v) { return App.el("td", { text: String(v) }); })));
    });
    table.appendChild(App.el("tr", { class: "total" }, ["合計", total.n, total.yes, total.no, total.unknown].map(function (v) { return App.el("td", { text: String(v) }); })));
    var warn = $("previewWarnings");
    App.clear(warn);
    parsed.warnings.forEach(function (w) { warn.appendChild(App.el("li", { text: w })); });
    $("importPreview").hidden = false;
  }

  // ---------- 名簿保存 ----------
  async function saveRoster() {
    if (saving) return;
    try {
      saving = true;
      await doSaveRoster();
    } finally {
      saving = false;
      App.emit();
    }
  }

  async function doSaveRoster() {
    var state = App.state;
    if (!parsed || !state.db) return;
    var title = $("evTitle").value.trim();
    var dateText = $("evDate").value.trim();
    var venue = $("evVenue").value.trim();
    if (!title) { App.toast("イベント名を入力してください"); return; }

    var key, salt, check, passphrase = null;
    if (!state.event) {
      var p1 = $("passNew").value, p2 = $("passNew2").value;
      if (p1.length < 4) { App.toast("パスフレーズは 4 文字以上にしてください"); return; }
      if (p1 !== p2) { App.toast("パスフレーズ(確認)が一致しません"); return; }
      passphrase = p1;
      salt = Core.randomSaltB64();
      App.emit();
      key = await Core.deriveKey(p1, salt);
      check = await Core.makeCheck(key);
    } else {
      if (state.keyStatus !== "ok") { App.toast("先にパスフレーズを入力してください"); return; }
      key = state.key;
      salt = state.event.salt;
      check = state.event.check;
      App.emit();
    }

    var people = await Core.assignIds(key, parsed.people);
    if (state.roster) {
      var d = Core.rosterDiff(state.roster.people, people);
      if (!(await App.ask({ title: "名簿を上書き", message: "追加 " + d.added + " 名 / 削除 " + d.removed + " 名 / 変更 " + d.changed + " 名" + NL + "受付記録はそのまま残ります。", okLabel: "上書きする" }))) {
        return;
      }
    }
    var blob = await Core.encryptJson(key, { people: people, sheets: parsed.sheets });
    var version = ((state.rosterDoc && state.rosterDoc.version) || 0) + 1;
    var now = new Date().toISOString();
    try {
      await state.db.doc("roster/current").set({ version: version, count: people.length, updatedAt: now, blob: blob });
      await state.db.doc("event/current").set({
        title: title, dateText: dateText, venue: venue,
        salt: salt, check: check, rosterVersion: version,
        createdAt: state.event ? (state.event.createdAt || now) : now,
        updatedAt: now
      });
    } catch (e) {
      App.toast(App.writeErrorMessage(e));
      return;
    }
    if (passphrase !== null) {
      App.adoptKey(passphrase, key, salt);
      $("passNew").value = "";
      $("passNew2").value = "";
    }
    ["evTitle", "evDate", "evVenue"].forEach(function (id) { delete $(id).dataset.dirty; });
    await App.loadRoster();
    App.toast("名簿を保存しました(" + people.length + " 名)");
  }

  // ---------- QR 発行 ----------
  function generateQr() {
    var roster = App.state.roster;
    if (!roster) return;
    var target = document.querySelector("input[name=qrTarget]:checked").value;
    var people = Core.sortPeople(roster.people).filter(function (p) { return target === "all" || p.plan === "yes"; });
    var grid = $("qrGrid");
    App.clear(grid);
    people.forEach(function (p) {
      var box = App.el("div", { class: "qr-box" });
      var tag = App.el("div", { class: "qr-tag" }, [
        box,
        App.el("div", { class: "tag-name", text: p.name }),
        App.el("div", { class: "tag-dept", text: p.dept + (p.title ? "　" + p.title : "") })
      ]);
      grid.appendChild(tag);
      try {
        new QRCode(box, { text: "RS2:" + p.id, width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M });
      } catch (e) {
        box.textContent = "QR生成エラー";
      }
    });
    $("printBtn").hidden = people.length === 0;
    $("printHint").hidden = people.length === 0;
    App.toast(people.length + " 件のQRコードを生成しました");
  }

  // ---------- QR カードの印刷用 HTML ----------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function qrDataUrl(box) {
    var canvas = box.querySelector("canvas");
    if (canvas) {
      try { return canvas.toDataURL("image/png"); } catch (e) { /* fall through */ }
    }
    var img = box.querySelector("img");
    return img ? img.src : "";
  }

  function buildPrintHtml() {
    var tags = Array.prototype.slice.call($("qrGrid").querySelectorAll(".qr-tag"));
    var cards = tags.map(function (tag) {
      return {
        src: qrDataUrl(tag.querySelector(".qr-box")),
        name: tag.querySelector(".tag-name").textContent,
        dept: tag.querySelector(".tag-dept").textContent
      };
    });
    var title = eventInfo().title || "受付スタンプ";
    var body = cards.map(function (c) {
      return '<div class="card">' +
        '<img src="' + escapeHtml(c.src) + '" alt="QR">' +
        '<div class="name">' + escapeHtml(c.name) + '</div>' +
        '<div class="dept">' + escapeHtml(c.dept) + '</div>' +
        '</div>';
    }).join(NL);
    return [
      "<!DOCTYPE html>",
      '<html lang="ja">',
      "<head>",
      '<meta charset="UTF-8">',
      "<title>" + escapeHtml(title) + " QRカード</title>",
      "<style>",
      "@page { margin: 10mm; }",
      'body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; margin: 0; padding: 10mm; background: #ffffff; color: #202A3B; }',
      ".grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }",
      ".card { border: 1px dashed #DEDBD1; border-radius: 6px; padding: 10px; text-align: center; break-inside: avoid; }",
      ".card img { width: 120px; height: 120px; }",
      ".card .name { font-size: 14px; font-weight: 700; margin-top: 6px; color: #202A3B; }",
      ".card .dept { font-size: 11px; color: #626B7C; margin-top: 2px; }",
      "</style>",
      "</head>",
      "<body>",
      '<div class="grid">' + body + "</div>",
      "</body>",
      "</html>"
    ].join(NL);
  }

  async function printQrCards() {
    if (!App.state.downloads) { window.print(); return; }
    var html = buildPrintHtml();
    await App.saveFile(Core.exportFilename("QRカード", eventInfo().title, new Date(), "html"), html);
  }

  // ---------- 書き出し ----------
  function eventInfo() {
    var ev = App.state.event || {};
    return { title: ev.title || "", dateText: ev.dateText || "", venue: ev.venue || "" };
  }

  async function exportCsv() {
    var roster = App.state.roster;
    if (!roster) return;
    var csv = Core.buildCsv(roster, App.checkins());
    await App.saveFile(Core.exportFilename("受付一覧", eventInfo().title, new Date(), "csv"), csv);
  }

  async function exportXlsx() {
    var roster = App.state.roster;
    if (!roster) return;
    var sheets = Core.buildExportSheets(roster, App.checkins(), eventInfo());
    var wb = Core.toWorkbook(XLSX, sheets);
    var bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    await App.saveFile(Core.exportFilename("当日出欠", eventInfo().title, new Date(), "xlsx"), new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  // ---------- リセット ----------
  async function resetEvent() {
    var state = App.state;
    if (!state.db) return;
    if (!(await App.ask({ title: "新しいイベントを開始", message: "イベント設定・名簿・全端末の受付記録を共有DBから削除します。先に書き出しを済ませてください。", okLabel: "すべて削除", danger: true, requireText: "削除" }))) return;
    $("resetBtn").disabled = true;
    try {
      var snap = await state.db.collection("checkins").get();
      for (var i = 0; i < snap.docs.length; i++) {
        await state.db.collection("checkins").doc(snap.docs[i].id).delete();
      }
      await state.db.doc("roster/current").delete();
      await state.db.doc("event/current").delete();
    } catch (e) {
      App.toast(App.writeErrorMessage(e));
      App.emit();
      return;
    }
    parsed = null;
    $("xlsxFile").value = "";
    $("importPreview").hidden = true;
    App.clear($("qrGrid"));
    $("printBtn").hidden = true;
    ["evTitle", "evDate", "evVenue"].forEach(function (id) { $(id).value = ""; delete $(id).dataset.dirty; });
    App.forgetKey();
    App.toast("新しいイベントを開始しました");
  }

  return { init: init, render: render };
})();
