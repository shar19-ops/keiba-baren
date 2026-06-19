/**
 * 馬連投票アプリ用バックエンド (Google Apps Script)
 *
 * セットアップ手順:
 * 1. 新しいGoogleスプレッドシートを作成する（sheets.google.com → 空白）
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. デフォルトのコード（Code.gs）を全て削除し、このファイルの内容を貼り付けて保存
 * 4. 右上の「デプロイ」→「新しいデプロイ」
 *    - 種類の選択: ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 *    → デプロイ。初回は権限の承認が必要（自分のGoogleアカウントで許可）
 * 5. 発行されたURL（.../exec で終わるもの）をコピー
 * 6. keiba-baren.html を開き、「設定」タブの「共有設定」にそのURLを貼り付けて保存
 *    → 参加者全員が同じURLを貼り付ければ、データが共有されます
 *
 * シートは初回アクセス時に自動作成されます（Horses / Votes / Meta）。
 */

function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var horses = ss.getSheetByName('Horses');
  if (!horses) {
    horses = ss.insertSheet('Horses');
    horses.appendRow(['id', 'name', 'waku']);
  } else if (horses.getLastColumn() < 3) {
    horses.getRange(1, 3).setValue('waku');
  }
  var votes = ss.getSheetByName('Votes');
  if (!votes) {
    votes = ss.insertSheet('Votes');
    votes.appendRow(['name', 'combosJson', 'updatedAt']);
  }
  var meta = ss.getSheetByName('Meta');
  if (!meta) {
    meta = ss.insertSheet('Meta');
    meta.appendRow(['key', 'value']);
    meta.appendRow(['raceName', '']);
    meta.appendRow(['resultOrder', '[]']);
    meta.appendRow(['nextHorseId', '1']);
    meta.appendRow(['betType', 'umaren']);
    meta.appendRow(['umatanPosA', '1']);
    meta.appendRow(['umatanPosB', '2']);
  }
  return { horses: horses, votes: votes, meta: meta };
}

function getMetaValue(metaSheet, key) {
  var data = metaSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return '';
}

function setMetaValue(metaSheet, key, value) {
  var data = metaSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      metaSheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  metaSheet.appendRow([key, value]);
}

function buildState() {
  var sh = ensureSheets();

  var horseRows = sh.horses.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; });
  var horses = horseRows.map(function (r) {
    var waku = (r[2] === '' || r[2] === null || r[2] === undefined) ? null : Number(r[2]);
    return { id: Number(r[0]), name: String(r[1]), waku: waku };
  });

  var voteRows = sh.votes.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0]; });
  var votes = voteRows.map(function (r) {
    var combos = [];
    try { combos = JSON.parse(r[1] || '[]'); } catch (e) { combos = []; }
    return { name: String(r[0]), combos: combos };
  });

  var raceName = getMetaValue(sh.meta, 'raceName') || '';
  var orderRaw = getMetaValue(sh.meta, 'resultOrder');
  var order = [];
  try { order = JSON.parse(orderRaw || '[]'); } catch (e) { order = []; }
  if (!Array.isArray(order)) order = [];
  order = order.map(function (v) { return (v === null || v === undefined || v === '') ? null : Number(v); });
  var result = { order: order };
  var betType = getMetaValue(sh.meta, 'betType') || 'umaren';
  var umatanPosA = Number(getMetaValue(sh.meta, 'umatanPosA')) || 1;
  var umatanPosB = Number(getMetaValue(sh.meta, 'umatanPosB')) || 2;

  return { raceName: raceName, horses: horses, votes: votes, result: result, betType: betType, umatanPositions: [umatanPosA, umatanPosB] };
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return jsonOutput(buildState());
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    var action = body.action;
    var sh = ensureSheets();

    if (action === 'addHorse') {
      var name = String(body.name || '').trim();
      if (name) {
        var nextId = Number(getMetaValue(sh.meta, 'nextHorseId')) || 1;
        var wakuVal = (body.waku === null || body.waku === undefined || body.waku === '') ? '' : Number(body.waku);
        sh.horses.appendRow([nextId, name, wakuVal]);
        setMetaValue(sh.meta, 'nextHorseId', nextId + 1);
      }
    } else if (action === 'setHorseWaku') {
      var hId = Number(body.id);
      var wVal = (body.waku === null || body.waku === undefined || body.waku === '') ? '' : Number(body.waku);
      setHorseWakuRow(sh.horses, hId, wVal);
    } else if (action === 'setBetType') {
      var bt = String(body.betType || 'umaren');
      if (['umaren', 'umatan', 'wakuren'].indexOf(bt) === -1) bt = 'umaren';
      setMetaValue(sh.meta, 'betType', bt);
      clearSheetKeepHeader(sh.votes);
      setMetaValue(sh.meta, 'resultOrder', '[]');
      setMetaValue(sh.meta, 'umatanPosA', '1');
      setMetaValue(sh.meta, 'umatanPosB', '2');
    } else if (action === 'setUmatanPositions') {
      var pa = Number(body.posA) || 1;
      var pb = Number(body.posB) || 2;
      setMetaValue(sh.meta, 'umatanPosA', pa);
      setMetaValue(sh.meta, 'umatanPosB', pb);
      clearSheetKeepHeader(sh.votes);
      setMetaValue(sh.meta, 'resultOrder', '[]');
    } else if (action === 'removeHorse') {
      var id = Number(body.id);
      var btCur = getMetaValue(sh.meta, 'betType') || 'umaren';
      removeHorseRow(sh.horses, id);
      if (btCur !== 'wakuren') {
        stripHorseFromVotes(sh.votes, id);
      }
      var order = [];
      try { order = JSON.parse(getMetaValue(sh.meta, 'resultOrder') || '[]'); } catch (e) { order = []; }
      var orderChanged = false;
      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi] !== null && order[oi] !== '' && Number(order[oi]) === id) { order[oi] = null; orderChanged = true; }
      }
      if (orderChanged) setMetaValue(sh.meta, 'resultOrder', JSON.stringify(order));
    } else if (action === 'submitVote') {
      var vname = String(body.name || '').trim();
      var combos = body.combos || [];
      upsertVote(sh.votes, vname, combos);
    } else if (action === 'deleteVote') {
      deleteVoteRow(sh.votes, String(body.name || ''));
    } else if (action === 'setRaceName') {
      setMetaValue(sh.meta, 'raceName', String(body.raceName || ''));
    } else if (action === 'setResult') {
      var ord = Array.isArray(body.order) ? body.order.map(function (v) {
        return (v === null || v === undefined || v === '') ? null : Number(v);
      }) : [];
      setMetaValue(sh.meta, 'resultOrder', JSON.stringify(ord));
    } else if (action === 'reset') {
      clearSheetKeepHeader(sh.horses);
      clearSheetKeepHeader(sh.votes);
      setMetaValue(sh.meta, 'raceName', '');
      setMetaValue(sh.meta, 'resultOrder', '[]');
      setMetaValue(sh.meta, 'nextHorseId', '1');
      setMetaValue(sh.meta, 'betType', 'umaren');
      setMetaValue(sh.meta, 'umatanPosA', '1');
      setMetaValue(sh.meta, 'umatanPosB', '2');
    }

    return jsonOutput(buildState());
  } finally {
    lock.releaseLock();
  }
}

function setHorseWakuRow(sheet, id, waku) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === id) { sheet.getRange(i + 1, 3).setValue(waku); return; }
  }
}

function removeHorseRow(sheet, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === id) { sheet.deleteRow(i + 1); return; }
  }
}

function stripHorseFromVotes(votesSheet, id) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var combos = [];
    try { combos = JSON.parse(data[i][1] || '[]'); } catch (e) { combos = []; }
    var filtered = combos.filter(function (c) { return Number(c[0]) !== id && Number(c[1]) !== id; });
    if (filtered.length === 0) {
      votesSheet.deleteRow(i + 1);
    } else if (filtered.length !== combos.length) {
      votesSheet.getRange(i + 1, 2).setValue(JSON.stringify(filtered));
    }
  }
}

function upsertVote(votesSheet, name, combos) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      votesSheet.getRange(i + 1, 2, 1, 2).setValues([[JSON.stringify(combos), new Date().toISOString()]]);
      return;
    }
  }
  votesSheet.appendRow([name, JSON.stringify(combos), new Date().toISOString()]);
}

function deleteVoteRow(votesSheet, name) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === name) { votesSheet.deleteRow(i + 1); return; }
  }
}

function clearSheetKeepHeader(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
}
