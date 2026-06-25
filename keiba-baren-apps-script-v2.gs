/**
 * 馬券投票アプリ用バックエンド v2 (Google Apps Script)
 * 複数レース対応版。旧版（keiba-baren-apps-script.gs）からの改修点：
 *   - 1スプレッドシートで複数レースを管理（Races シートを新設）
 *   - 出走馬の並べ替え（sortOrder）
 *   - レース結果・配当のExcel(.xlsx)出力をGoogleドライブの指定フォルダへ保存
 *
 * セットアップ手順:
 * 1. （新規の場合）新しいGoogleスプレッドシートを作成する（sheets.google.com → 空白）
 *    既存の旧版スプレッドシートをそのまま使う場合はこの手順は不要（後述の自動移行が走る）
 * 2. メニュー「拡張機能」→「Apps Script」を開く
 * 3. デフォルトのコード（Code.gs）を全て削除し、このファイルの内容を貼り付けて保存
 * 4. 右上の「デプロイ」→「新しいデプロイ」（既存デプロイがある場合は「デプロイを管理」→新バージョン）
 *    - 種類の選択: ウェブアプリ
 *    - 実行ユーザー: 自分
 *    - アクセスできるユーザー: 全員
 *    → デプロイ。
 *    ※ このv2はExcel出力のためGoogleドライブへのアクセス権限が新たに必要です。
 *      再デプロイ後の初回アクセス時に追加の権限承認画面が表示されるので、自分のGoogleアカウントで許可してください。
 * 5. 発行されたURL（.../exec で終わるもの）をコピーし、keiba-baren-v2.html の「設定」タブに貼り付けて保存
 *    → 参加者全員が同じURLを貼り付ければ、データが共有されます
 *
 * 既存（旧版）のスプレッドシートに対してこのコードを実行すると、初回アクセス時に
 * Horses/Votes/Meta シートを自動的に複数レース対応の形式へ移行します（1回限り・自動・既存データは保持されます）。
 *
 * Excel出力の保存先:
 *   設定タブで指定したGoogleドライブのフォルダに保存されます（未指定の場合はドライブのルート）。
 *   デプロイを「実行ユーザー: 自分」にしている場合、出力ファイルは常に「デプロイした人」のGoogleドライブに保存されます
 *   （他の幹事が操作した場合も保存先は同じです）。
 */

/* ============================================================
 * シート初期化・自動移行
 * ============================================================ */

function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var races = ss.getSheetByName('Races');
  var horses = ss.getSheetByName('Horses');
  var votes = ss.getSheetByName('Votes');
  var meta = ss.getSheetByName('Meta');

  if (horses && !hasRaceIdColumn_(horses)) {
    migrateToMultiRace_(ss);
    races = ss.getSheetByName('Races');
    horses = ss.getSheetByName('Horses');
    votes = ss.getSheetByName('Votes');
    meta = ss.getSheetByName('Meta');
  }

  if (!races) {
    races = ss.insertSheet('Races');
    races.appendRow(['id', 'name', 'betType', 'umatanPosA', 'umatanPosB', 'resultOrder', 'nextHorseId', 'createdAt']);
  }
  if (!horses) {
    horses = ss.insertSheet('Horses');
    horses.appendRow(['id', 'raceId', 'name', 'waku', 'sortOrder']);
  }
  if (!votes) {
    votes = ss.insertSheet('Votes');
    votes.appendRow(['raceId', 'name', 'combosJson', 'updatedAt']);
  }
  if (!meta) {
    meta = ss.insertSheet('Meta');
    meta.appendRow(['key', 'value']);
    meta.appendRow(['driveFolderId', '']);
    meta.appendRow(['nextRaceId', '1']);
  } else if (getMetaValue(meta, 'nextRaceId') === '') {
    setMetaValue(meta, 'nextRaceId', '1');
  }

  return { races: races, horses: horses, votes: votes, meta: meta };
}

function hasRaceIdColumn_(horsesSheet) {
  var lastCol = horsesSheet.getLastColumn();
  if (lastCol < 1) return false;
  var header = horsesSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return header.indexOf('raceId') !== -1;
}

/**
 * 旧版（単一レース）のHorses/Votes/Metaを、複数レース対応の形式へ移行する。
 * 二重チェックロッキングで、同時実行による中途半端な移行状態の露出を防ぐ。
 */
function migrateToMultiRace_(ss) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var horses = ss.getSheetByName('Horses');
    if (!horses || hasRaceIdColumn_(horses)) return; // 既に他の実行で移行済み

    var votes = ss.getSheetByName('Votes');
    var meta = ss.getSheetByName('Meta');

    // 1. 旧データを全件メモリに読み込む
    var horseRows = horses.getDataRange().getValues().slice(1)
      .filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; });
    var voteRows = votes ? votes.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }) : [];

    var oldRaceName = meta ? getMetaValue(meta, 'raceName') : '';
    var oldBetType = meta ? (getMetaValue(meta, 'betType') || 'umaren') : 'umaren';
    var oldPosA = meta ? (Number(getMetaValue(meta, 'umatanPosA')) || 1) : 1;
    var oldPosB = meta ? (Number(getMetaValue(meta, 'umatanPosB')) || 2) : 2;
    var oldResultOrder = meta ? (getMetaValue(meta, 'resultOrder') || '[]') : '[]';
    var oldNextHorseId = meta ? (Number(getMetaValue(meta, 'nextHorseId')) || 1) : 1;

    // 2. Races シートに id=1 のレースを作成
    var racesSheet = ss.getSheetByName('Races') || ss.insertSheet('Races');
    racesSheet.clear();
    racesSheet.appendRow(['id', 'name', 'betType', 'umatanPosA', 'umatanPosB', 'resultOrder', 'nextHorseId', 'createdAt']);
    racesSheet.appendRow([1, oldRaceName || 'レース1', oldBetType, oldPosA, oldPosB, oldResultOrder, oldNextHorseId, new Date().toISOString()]);

    // 3. Horses を raceId=1 付きで書き換え（既存の並び順を sortOrder として保持）
    var newHorseRows = horseRows.map(function (r, i) {
      var waku = (r[2] === '' || r[2] === null || r[2] === undefined) ? '' : r[2];
      return [r[0], 1, r[1], waku, i + 1];
    });
    horses.clear();
    horses.appendRow(['id', 'raceId', 'name', 'waku', 'sortOrder']);
    if (newHorseRows.length > 0) horses.getRange(2, 1, newHorseRows.length, 5).setValues(newHorseRows);

    // 4. Votes を raceId=1 付きで書き換え
    if (votes) {
      var newVoteRows = voteRows.map(function (r) { return [1, r[0], r[1], r[2]]; });
      votes.clear();
      votes.appendRow(['raceId', 'name', 'combosJson', 'updatedAt']);
      if (newVoteRows.length > 0) votes.getRange(2, 1, newVoteRows.length, 4).setValues(newVoteRows);
    }

    // 5. Meta はグローバル設定のみ残す
    if (!meta) meta = ss.insertSheet('Meta');
    meta.clear();
    meta.appendRow(['key', 'value']);
    meta.appendRow(['driveFolderId', '']);
    meta.appendRow(['nextRaceId', '2']);
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * Meta（グローバル設定） / Races（レース行）アクセス
 * ============================================================ */

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

// Races列: 1=id 2=name 3=betType 4=umatanPosA 5=umatanPosB 6=resultOrder 7=nextHorseId 8=createdAt
function findRaceRow_(racesSheet, raceId) {
  var data = racesSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== '' && data[i][0] !== null && data[i][0] !== undefined && Number(data[i][0]) === Number(raceId)) {
      return {
        rowIndex: i + 1, id: data[i][0], name: data[i][1], betType: data[i][2],
        umatanPosA: data[i][3], umatanPosB: data[i][4], resultOrder: data[i][5],
        nextHorseId: data[i][6], createdAt: data[i][7]
      };
    }
  }
  return null;
}

function setRaceField_(racesSheet, raceId, colIndex, value) {
  var row = findRaceRow_(racesSheet, raceId);
  if (!row) return;
  racesSheet.getRange(row.rowIndex, colIndex).setValue(value);
}

/* ============================================================
 * 状態の構築
 * ============================================================ */

function buildState(raceId) {
  var sh = ensureSheets();
  var raceRow = findRaceRow_(sh.races, raceId);
  if (!raceRow) return null;

  var horseRows = sh.horses.getDataRange().getValues().slice(1)
    .filter(function (r) {
      return r[0] !== '' && r[0] !== null && r[0] !== undefined && Number(r[1]) === Number(raceId);
    });
  horseRows.sort(function (a, b) { return (Number(a[4]) || 0) - (Number(b[4]) || 0); });
  var horses = horseRows.map(function (r) {
    var waku = (r[3] === '' || r[3] === null || r[3] === undefined) ? null : Number(r[3]);
    return { id: Number(r[0]), name: String(r[2]), waku: waku };
  });

  var voteRows = sh.votes.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[1] && Number(r[0]) === Number(raceId); });
  var votes = voteRows.map(function (r) {
    var combos = [];
    try { combos = JSON.parse(r[2] || '[]'); } catch (e) { combos = []; }
    return { name: String(r[1]), combos: combos };
  });

  var order = [];
  try { order = JSON.parse(raceRow.resultOrder || '[]'); } catch (e) { order = []; }
  if (!Array.isArray(order)) order = [];
  order = order.map(function (v) { return (v === null || v === undefined || v === '') ? null : Number(v); });

  return {
    raceId: Number(raceId),
    raceName: raceRow.name || '',
    horses: horses,
    votes: votes,
    result: { order: order },
    betType: raceRow.betType || 'umaren',
    umatanPositions: [Number(raceRow.umatanPosA) || 1, Number(raceRow.umatanPosB) || 2]
  };
}

function buildRaceList() {
  return buildRaceListFromSheets_(ensureSheets());
}

function buildRaceListFromSheets_(sh) {
  var raceData = sh.races.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; });

  var horseCounts = {}, voteCounts = {};
  sh.horses.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0] === '' || r[0] === null || r[0] === undefined) return;
    var rid = Number(r[1]);
    horseCounts[rid] = (horseCounts[rid] || 0) + 1;
  });
  sh.votes.getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[1]) return;
    var rid = Number(r[0]);
    voteCounts[rid] = (voteCounts[rid] || 0) + 1;
  });

  return raceData.map(function (r) {
    var id = Number(r[0]);
    var order = [];
    try { order = JSON.parse(r[5] || '[]'); } catch (e) { order = []; }
    var hasResult = Array.isArray(order) && order.some(function (v) { return v !== null && v !== '' && v !== undefined; });
    return {
      id: id,
      name: String(r[1] || ''),
      betType: r[2] || 'umaren',
      umatanPositions: [Number(r[3]) || 1, Number(r[4]) || 2],
      horseCount: horseCounts[id] || 0,
      voteCount: voteCounts[id] || 0,
      hasResult: hasResult
    };
  });
}

function exportAllData_(sh) {
  var raceIds = sh.races.getDataRange().getValues().slice(1)
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[0] !== undefined; })
    .map(function (r) { return Number(r[0]); });
  var races = raceIds.map(function (id) { return buildState(id); }).filter(Boolean);
  return { exportedAt: new Date().toISOString(), races: races };
}

function importAllData_(sh, races) {
  races.forEach(function (r) {
    var nextRaceId = Number(getMetaValue(sh.meta, 'nextRaceId')) || 1;
    var horses = Array.isArray(r.horses) ? r.horses : [];
    var votes = Array.isArray(r.votes) ? r.votes : [];
    var umatanPositions = (Array.isArray(r.umatanPositions) && r.umatanPositions.length === 2) ? r.umatanPositions : [1, 2];
    var resultOrder = (r.result && Array.isArray(r.result.order)) ? r.result.order : [];
    var maxHorseId = horses.reduce(function (m, h) { return Math.max(m, Number(h.id) || 0); }, 0);

    sh.races.appendRow([
      nextRaceId, String(r.raceName || '復元レース'), r.betType || 'umaren',
      Number(umatanPositions[0]) || 1, Number(umatanPositions[1]) || 2,
      JSON.stringify(resultOrder), maxHorseId + 1, new Date().toISOString()
    ]);
    setMetaValue(sh.meta, 'nextRaceId', nextRaceId + 1);

    horses.forEach(function (h, i) {
      var waku = (h.waku === null || h.waku === undefined || h.waku === '') ? '' : Number(h.waku);
      sh.horses.appendRow([Number(h.id), nextRaceId, String(h.name || ''), waku, i + 1]);
    });
    votes.forEach(function (v) {
      sh.votes.appendRow([nextRaceId, String(v.name || ''), JSON.stringify(Array.isArray(v.combos) ? v.combos : []), new Date().toISOString()]);
    });
  });
  return { races: buildRaceList() };
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 * doGet / doPost
 * ============================================================ */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'listRaces';
  if (action === 'state') {
    var raceId = e.parameter.raceId;
    var state = buildState(raceId);
    if (!state) return jsonOutput({ error: 'race_not_found' });
    return jsonOutput(state);
  }
  if (action === 'exportAll') {
    return jsonOutput(exportAllData_(ensureSheets()));
  }
  var sh = ensureSheets();
  return jsonOutput({ races: buildRaceListFromSheets_(sh), driveFolderId: getMetaValue(sh.meta, 'driveFolderId') });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    var action = body.action;
    var sh = ensureSheets();
    var raceId = body.raceId;

    if (action === 'createRace') {
      var rname = String(body.name || '').trim();
      var nextRaceId = Number(getMetaValue(sh.meta, 'nextRaceId')) || 1;
      sh.races.appendRow([nextRaceId, rname || ('レース' + nextRaceId), 'umaren', 1, 2, '[]', 1, new Date().toISOString()]);
      setMetaValue(sh.meta, 'nextRaceId', nextRaceId + 1);
      return jsonOutput({ races: buildRaceList() });
    }
    if (action === 'deleteRace') {
      deleteRaceCascade_(sh, raceId);
      return jsonOutput({ races: buildRaceList() });
    }
    if (action === 'setDriveFolder') {
      var folderId = String(body.folderId || '').trim();
      if (folderId) {
        try { DriveApp.getFolderById(folderId); } catch (err) { return jsonOutput({ error: 'invalid_folder' }); }
      }
      setMetaValue(sh.meta, 'driveFolderId', folderId);
      return jsonOutput({ ok: true, driveFolderId: folderId });
    }
    if (action === 'exportResult') {
      return jsonOutput(exportResultToExcel_(sh, raceId, body));
    }
    if (action === 'importAll') {
      return jsonOutput(importAllData_(sh, Array.isArray(body.races) ? body.races : []));
    }

    if (action === 'addHorse') {
      var hname = String(body.name || '').trim();
      if (hname) {
        var raceRow = findRaceRow_(sh.races, raceId);
        if (raceRow) {
          var nextHorseId = Number(raceRow.nextHorseId) || 1;
          var wakuVal = (body.waku === null || body.waku === undefined || body.waku === '') ? '' : Number(body.waku);
          var maxSort = getMaxSortOrder_(sh.horses, raceId);
          sh.horses.appendRow([nextHorseId, Number(raceId), hname, wakuVal, maxSort + 1]);
          setRaceField_(sh.races, raceId, 7, nextHorseId + 1);
        }
      }
    } else if (action === 'setHorseWaku') {
      var hId = Number(body.id);
      var wVal = (body.waku === null || body.waku === undefined || body.waku === '') ? '' : Number(body.waku);
      setHorseWakuRow(sh.horses, raceId, hId, wVal);
    } else if (action === 'setHorseName') {
      var hnId = Number(body.id);
      var newName = String(body.name || '').trim();
      if (newName) setHorseNameRow(sh.horses, raceId, hnId, newName);
    } else if (action === 'reorderHorses') {
      reorderHorses_(sh.horses, raceId, body.orderedIds || []);
    } else if (action === 'setBetType') {
      var bt = String(body.betType || 'umaren');
      if (['umaren', 'umatan', 'wakuren'].indexOf(bt) === -1) bt = 'umaren';
      setRaceField_(sh.races, raceId, 3, bt);
      clearRaceRows_(sh.votes, 1, raceId);
      setRaceField_(sh.races, raceId, 6, '[]');
      setRaceField_(sh.races, raceId, 4, 1);
      setRaceField_(sh.races, raceId, 5, 2);
    } else if (action === 'setUmatanPositions') {
      var pa = Number(body.posA) || 1;
      var pb = Number(body.posB) || 2;
      setRaceField_(sh.races, raceId, 4, pa);
      setRaceField_(sh.races, raceId, 5, pb);
      clearRaceRows_(sh.votes, 1, raceId);
      setRaceField_(sh.races, raceId, 6, '[]');
    } else if (action === 'removeHorse') {
      var rid = Number(body.id);
      var raceRowCur = findRaceRow_(sh.races, raceId);
      var btCur = raceRowCur ? (raceRowCur.betType || 'umaren') : 'umaren';
      removeHorseRow(sh.horses, raceId, rid);
      if (btCur !== 'wakuren') {
        stripHorseFromVotes(sh.votes, raceId, rid);
      }
      var order = [];
      try { order = JSON.parse(raceRowCur ? (raceRowCur.resultOrder || '[]') : '[]'); } catch (e) { order = []; }
      var orderChanged = false;
      for (var oi = 0; oi < order.length; oi++) {
        if (order[oi] !== null && order[oi] !== '' && Number(order[oi]) === rid) { order[oi] = null; orderChanged = true; }
      }
      if (orderChanged) setRaceField_(sh.races, raceId, 6, JSON.stringify(order));
    } else if (action === 'submitVote') {
      var vname = String(body.name || '').trim();
      var combos = body.combos || [];
      upsertVote(sh.votes, raceId, vname, combos);
    } else if (action === 'deleteVote') {
      deleteVoteRow(sh.votes, raceId, String(body.name || ''));
    } else if (action === 'setRaceName') {
      setRaceField_(sh.races, raceId, 2, String(body.raceName || ''));
    } else if (action === 'setResult') {
      var ord = Array.isArray(body.order) ? body.order.map(function (v) {
        return (v === null || v === undefined || v === '') ? null : Number(v);
      }) : [];
      setRaceField_(sh.races, raceId, 6, JSON.stringify(ord));
    } else if (action === 'reset') {
      clearRaceRows_(sh.horses, 2, raceId);
      clearRaceRows_(sh.votes, 1, raceId);
      setRaceField_(sh.races, raceId, 6, '[]');
      setRaceField_(sh.races, raceId, 7, 1);
    }

    var state = buildState(raceId);
    if (!state) return jsonOutput({ error: 'race_not_found' });
    return jsonOutput(state);
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * レース・出走馬・投票の操作ヘルパー（すべて raceId でスコープ）
 * ============================================================ */

function deleteRaceCascade_(sh, raceId) {
  clearRaceRows_(sh.horses, 2, raceId);
  clearRaceRows_(sh.votes, 1, raceId);
  var data = sh.races.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (Number(data[i][0]) === Number(raceId)) { sh.races.deleteRow(i + 1); return; }
  }
}

function clearRaceRows_(sheet, raceIdCol, raceId) {
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (Number(data[i][raceIdCol - 1]) === Number(raceId)) sheet.deleteRow(i + 1);
  }
}

function getMaxSortOrder_(horsesSheet, raceId) {
  var data = horsesSheet.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === '' || data[i][0] === null || data[i][0] === undefined) continue;
    if (Number(data[i][1]) === Number(raceId)) {
      var so = Number(data[i][4]) || 0;
      if (so > max) max = so;
    }
  }
  return max;
}

function setHorseWakuRow(sheet, raceId, id, waku) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][1]) === Number(raceId) && Number(data[i][0]) === id) {
      sheet.getRange(i + 1, 4).setValue(waku);
      return;
    }
  }
}

function setHorseNameRow(sheet, raceId, id, name) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][1]) === Number(raceId) && Number(data[i][0]) === id) {
      sheet.getRange(i + 1, 3).setValue(name);
      return;
    }
  }
}

function removeHorseRow(sheet, raceId, id) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][1]) === Number(raceId) && Number(data[i][0]) === id) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function reorderHorses_(sheet, raceId, orderedIds) {
  var data = sheet.getDataRange().getValues();
  var orderMap = {};
  orderedIds.forEach(function (id, idx) { orderMap[Number(id)] = idx + 1; });
  var updates = [];
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][1]) === Number(raceId)) {
      var hid = Number(data[i][0]);
      if (orderMap.hasOwnProperty(hid)) updates.push({ row: i + 1, value: orderMap[hid] });
    }
  }
  updates.forEach(function (u) { sheet.getRange(u.row, 5).setValue(u.value); });
}

function stripHorseFromVotes(votesSheet, raceId, id) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (Number(data[i][0]) !== Number(raceId)) continue;
    var combos = [];
    try { combos = JSON.parse(data[i][2] || '[]'); } catch (e) { combos = []; }
    var filtered = combos.filter(function (c) { return Number(c[0]) !== id && Number(c[1]) !== id; });
    if (filtered.length === 0) {
      votesSheet.deleteRow(i + 1);
    } else if (filtered.length !== combos.length) {
      votesSheet.getRange(i + 1, 3).setValue(JSON.stringify(filtered));
    }
  }
}

function upsertVote(votesSheet, raceId, name, combos) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === Number(raceId) && data[i][1] === name) {
      votesSheet.getRange(i + 1, 3, 1, 2).setValues([[JSON.stringify(combos), new Date().toISOString()]]);
      return;
    }
  }
  votesSheet.appendRow([Number(raceId), name, JSON.stringify(combos), new Date().toISOString()]);
}

function deleteVoteRow(votesSheet, raceId, name) {
  var data = votesSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (Number(data[i][0]) === Number(raceId) && data[i][1] === name) {
      votesSheet.deleteRow(i + 1);
      return;
    }
  }
}

/* ============================================================
 * Excel(.xlsx) 出力
 * ============================================================ */

function exportResultToExcel_(sh, raceId, body) {
  var raceRow = findRaceRow_(sh.races, raceId);
  if (!raceRow) return { error: 'race_not_found' };

  var raceName = raceRow.name || ('レース' + raceId);
  var betType = raceRow.betType || 'umaren';
  var betTypeLabels = { umaren: '馬連', umatan: '馬単', wakuren: '枠連' };
  var resultLabel = String(body.resultLabel || '');
  var pot = Number(body.pot) || 0;
  var totalBets = Number(body.totalBets) || 0;
  var payoutPerHit = Number(body.payoutPerHit) || 0;
  var odds = Number(body.odds) || 0;
  var rows = Array.isArray(body.rows) ? body.rows : [];

  var tempName = raceName + '_結果_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var tempSs = SpreadsheetApp.create(tempName);
  var sheet = tempSs.getSheets()[0];
  sheet.setName('結果');

  var lines = [];
  lines.push(['レース名', raceName]);
  lines.push(['投票方式', betTypeLabels[betType] || betType]);
  lines.push(['的中結果', resultLabel]);
  lines.push(['参加人数', rows.length]);
  lines.push(['総投票点数', totalBets]);
  lines.push(['総額（プール）', pot]);
  lines.push(['1点あたり配当', payoutPerHit]);
  lines.push(['配当率', odds]);
  lines.push([]);
  lines.push(['名前', '点数', '賭け金', '的中点数', '配当', '収支']);
  rows.forEach(function (r) {
    lines.push([r.name, r.comboCount, r.stake, r.hitCount, r.payout, r.net]);
  });

  sheet.getRange(1, 1, lines.length, 6).setValues(padRows_(lines, 6));
  SpreadsheetApp.flush();

  var tempId = tempSs.getId();
  var exportUrl = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx';
  var resp = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var blob = resp.getBlob().setName(tempName + '.xlsx');

  var folderIdSetting = getMetaValue(sh.meta, 'driveFolderId');
  var targetFolder;
  try {
    targetFolder = folderIdSetting ? DriveApp.getFolderById(folderIdSetting) : DriveApp.getRootFolder();
  } catch (e) {
    targetFolder = DriveApp.getRootFolder();
  }
  var savedFile = targetFolder.createFile(blob);

  DriveApp.getFileById(tempId).setTrashed(true);

  return { ok: true, fileUrl: savedFile.getUrl(), fileName: savedFile.getName() };
}

function padRows_(rows, width) {
  return rows.map(function (r) {
    var copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}
