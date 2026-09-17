/**
 * 受付スタンプ web版 バックエンド (Google Apps Script)
 *
 * claude.ai アカウントが無い人でも使えるように、共有DBの代わりに
 * Google スプレッドシートを使う版のバックエンドです。
 *
 * セットアップ手順:
 * 1. 新しいGoogleスプレッドシートを作成する(sheets.google.com → 空白)
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. デフォルトのコード(Code.gs)を全て削除し、このファイルの内容を貼り付けて保存
 * 4. 右上の「デプロイ」→「新しいデプロイ」
 *    - 種類の選択: ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 *    → デプロイ。初回は権限の承認が必要(自分のGoogleアカウントで許可)
 * 5. 発行されたURL(.../exec で終わるもの)をコピー
 * 6. web.html を開き、幹事タブ「共有設定」にそのURLを貼り付けて「接続」
 *    → 「受付端末用のQRを作る」で出るQR(またはリンク)を受付担当のスマホで開けば、
 *      URLを手入力せずに同じスプレッドシートへ接続できます
 *
 * 注意(claude.ai 版との違い):
 * このURLを知っていれば誰でも読み書きできます(幹事だけに書込を許すような
 * アクセス制御はできません)。URLは受付担当以外に広めないでください。
 *
 * シートは初回アクセス時に自動作成されます(Meta / Checkins)。
 */

function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var meta = ss.getSheetByName('Meta');
  if (!meta) {
    meta = ss.insertSheet('Meta');
    meta.appendRow(['key', 'value']);
    meta.appendRow(['event', '']);
    meta.appendRow(['roster', '']);
  }
  var checkins = ss.getSheetByName('Checkins');
  if (!checkins) {
    checkins = ss.insertSheet('Checkins');
    checkins.appendRow(['pid', 'dataJson', 'updatedAt']);
  }
  return { meta: meta, checkins: checkins };
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

function parseJsonOrNull(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// event/current, roster/current の2つだけを Meta の key に対応させる
function pathToMetaKey(path) {
  if (path === 'event/current') return 'event';
  if (path === 'roster/current') return 'roster';
  return null;
}

function findRowByFirstCol(sheet, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(value)) return i + 1; // 1-based 行番号
  }
  return -1;
}

function buildState() {
  var sh = ensureSheets();
  var event = parseJsonOrNull(getMetaValue(sh.meta, 'event'));
  var roster = parseJsonOrNull(getMetaValue(sh.meta, 'roster'));

  var rows = sh.checkins.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; });
  var checkins = {};
  rows.forEach(function (r) {
    var data = parseJsonOrNull(r[1]);
    if (data) checkins[String(r[0])] = data;
  });

  return { event: event, roster: roster, checkins: checkins };
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// doGet/doPost は何が起きても必ず jsonOutput(...) を return すること。
// 例外を投げて関数が異常終了すると、Apps Script は自前のエラーページ(HTML)を
// 返してしまい、そこには CORS ヘッダー(Access-Control-Allow-Origin)が付かない。
// その結果、ブラウザから見ると原因不明の「Failed to fetch」になる。
function safeState(err) {
  // buildState() 自体が失敗した時の最終手段。実データが読めていないことを
  // error で示しつつ、event/roster を勝手に null にして端末側を混乱させない
  // よう、既存データの有無に関わらず「不明」を表すため空を返す。
  return { event: null, roster: null, checkins: {}, error: String(err) };
}

function doGet(e) {
  try {
    return jsonOutput(buildState());
  } catch (err) {
    return jsonOutput(safeState(err));
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(10000);
    if (!locked) {
      // ロックが取れなくても、書込みは諦めて現状だけ返す(必ずJSONで応答する)
      return jsonOutput(buildState());
    }

    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    var action = body.action;
    var sh = ensureSheets();

    if (action === 'setDoc') {
      var key = pathToMetaKey(body.path);
      if (key) setMetaValue(sh.meta, key, JSON.stringify(body.data || {}));
    } else if (action === 'deleteDoc') {
      var key2 = pathToMetaKey(body.path);
      if (key2) setMetaValue(sh.meta, key2, '');
    } else if (action === 'colSet' && body.collection === 'checkins') {
      var pid = String(body.id);
      var row = findRowByFirstCol(sh.checkins, pid);
      var json = JSON.stringify(body.data || {});
      var now = new Date().toISOString();
      if (row > 0) sh.checkins.getRange(row, 2, 1, 2).setValues([[json, now]]);
      else sh.checkins.appendRow([pid, json, now]);
    } else if (action === 'colDelete' && body.collection === 'checkins') {
      var row2 = findRowByFirstCol(sh.checkins, String(body.id));
      if (row2 > 0) sh.checkins.deleteRow(row2);
    }

    return jsonOutput(buildState());
  } catch (err) {
    // 書込み自体は失敗しても、既存データの読み出し(buildState)はできることが多い。
    // それも失敗する場合だけ safeState にフォールバックする。
    try {
      return jsonOutput(buildState());
    } catch (err2) {
      return jsonOutput(safeState(err));
    }
  } finally {
    if (locked) lock.releaseLock();
  }
}
