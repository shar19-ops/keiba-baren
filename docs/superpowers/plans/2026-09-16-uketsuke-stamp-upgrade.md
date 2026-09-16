# 受付スタンプ グレードアップ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 社内イベント出欠管理 Artifact「受付スタンプ」を、Excel 名簿の直接取込・5 台の受付端末のリアルタイム集約・暗号化名簿・元の出欠表に貼り戻せる Excel 書き出しに対応させる。

**Architecture:** 純粋ロジック(`core.js`: Excel 解析 / ID / 暗号化 / 集計 / 書き出しデータ)と共有DB同期(`sync.js`: 端末内キュー・再送・購読)を Node.js でテストできる独立ファイルにし、画面(`index.html` + `app.js` + タブごとの `tab-*.js`)はそれらを呼ぶだけにする。共有の置き場は Artifact の `db` 機能。氏名・部署・役職はパスフレーズ由来の鍵で AES-GCM 暗号化してから保存し、共有DBには参加者ID・時刻・端末名しか平文で載せない。

**Tech Stack:** 素の HTML/CSS/JS(ES2017、バンドラ無し)、SheetJS `xlsx` 0.18.5、`qrcodejs` 1.0.0、`jsQR` 1.4.0(いずれも cdnjs)、WebCrypto(PBKDF2 / AES-GCM / HMAC-SHA256)、Artifact runtime contract 0.2.51(`db`, `downloads`)、テストは Node.js 24 の `node:test`。

仕様書: `docs/superpowers/specs/2026-09-16-uketsuke-stamp-upgrade-design.md`

## Global Constraints

- ソースは `uketsuke-stamp/` 配下。Artifact 本体は `index.html`、補助ファイルは `core.js` / `sync.js` / `app.js` / `tab-kanji.js` / `tab-uketsuke.js` / `tab-status.js`
- 外部スクリプトは cdnjs のみ、バージョン固定: `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`、`https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js`、`https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js`
- `core.js` と `sync.js` はブラウザ(`window.UketsukeCore` / `window.UketsukeSync`)と Node(`module.exports`)の両対応。DOM・`window.claude` に依存しない
- 共有DBの宣言: `capabilities: { db: { rules: [ { path: "", read: "interact", write: "admin" }, { path: "checkins", read: "interact", write: "interact" } ] }, downloads: true }`
- 共有DBに平文で載せてよいのは: 参加者ID、受付時刻、端末名、種別、イベント名/日時/会場、salt、check、version 系のみ。氏名・部署・役職は必ず `encryptJson` を通す
- 参加者ID: `HMAC-SHA256(鍵, dept + "\u001f" + name + "\u001f" + n)` の先頭 16 hex。QR の中身は `RS2:<ID>`
- 鍵導出: PBKDF2-SHA256、200,000 回、salt 16 byte、512 bit を導出し前半 32 byte を AES-GCM 鍵、後半 32 byte を HMAC 鍵にする
- 暗号文の保存形式: `base64(iv 12byte) + "." + base64(ciphertext)`
- 判定文字列は `""` / `"未受付"` / `"予定外出席"` / `"名簿外"` の 4 つだけ
- 種別ラベル: `qr`→`QR`、`manual`→`名簿`、`walkin`→`飛び入り`
- CSV: ヘッダ `氏名,部署,役職,出欠席予定,受付時刻,受付端末,種別,判定`、BOM 付き UTF-8、CRLF、全フィールドをダブルクォート
- Excel 書き出しのシート: 部署シート(元と同じ名前・順序)+ `名簿外` + `集計`
- ファイル名: `受付一覧_<イベント名>_<yyyyMMdd_HHmm>.csv` / `当日出欠_<イベント名>_<yyyyMMdd_HHmm>.xlsx`
- localStorage キー: `uketsuke_pass_v2`(パスフレーズ)、`uketsuke_device_v2`(端末名)、`uketsuke_tab_v2`(最後に開いたタブ)、`uketsuke_pending_v2`(未送信キュー)
- 実名を含むファイルをリポジトリに入れない。テスト用 Excel は `tests/fixtures/make-fixture.js` で氏名をダミー化して生成したものだけを使う
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける
- テスト実行コマンド: `cd uketsuke-stamp && npm test`(= `node --test "tests/**/*.test.js"`)

## ファイル構成

| ファイル | 責務 |
|---|---|
| `uketsuke-stamp/package.json` | devDependency `xlsx`、`npm test` / `npm run make-fixture` |
| `uketsuke-stamp/tests/fixtures/make-fixture.js` | 実ファイルから氏名をダミー化したテスト用 Excel を生成(1 回だけ実行) |
| `uketsuke-stamp/tests/fixtures/sample-出欠表.xlsx` | 生成物。30 部署シート、全角番号、小見出し行、小計行、注意書き行を含む |
| `uketsuke-stamp/tests/helpers.js` | fixture 読込、合成シート作成、偽 DB |
| `uketsuke-stamp/core.js` | 純粋関数(Excel 解析、ID、暗号化、集計、CSV / Excel データ、書式) |
| `uketsuke-stamp/sync.js` | `SyncStore`(共有DB 購読、端末内キュー、再送) |
| `uketsuke-stamp/index.html` | 画面のマークアップとスタイル、スクリプト読込 |
| `uketsuke-stamp/app.js` | 共通状態(`window.App`): ランタイム接続、鍵、名簿復号、トースト、タブ切替、ファイル保存 |
| `uketsuke-stamp/tab-kanji.js` | 幹事タブ: イベント設定、Excel 取込、名簿保存、QR 発行、書き出し、リセット |
| `uketsuke-stamp/tab-uketsuke.js` | 受付タブ: パスフレーズ入口、端末名、カメラ、名簿検索、飛び入り、端末履歴 |
| `uketsuke-stamp/tab-status.js` | 状況タブ: サマリー、部署別、全端末履歴 |
| `uketsuke-stamp/README.md` | 運用手順・引き継ぎ手順・再公開手順 |

## 共通の型(全タスクで同じ名前を使う)

```js
// person(名簿 1 名)
{ id: "a1b2c3d4e5f60718", deptOrder: 2, dept: "総務部", sheetName: "02 総務部", row: 7, name: "山田　太郎", title: "課長", plan: "yes" | "no" | "unknown" }

// sheetMeta(部署シート 1 枚)。列は A1 形式の列文字、行は 1 始まり
{ sheetName: "02 総務部", deptOrder: 2, dept: "総務部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N" | null, firstRow: 5 | null, lastRow: 16 | null }

// roster(復号後の名簿ブロック)
{ people: [person, ...], sheets: [sheetMeta, ...] }

// checkin(共有DB の checkins/<pid> の中身 + 復号後の飛び入り氏名)
{ pid: "a1b2c3d4e5b60718", t: "2026-10-01T04:05:06.000Z", dev: "受付1", kind: "qr" | "manual" | "walkin", v: 1, enc?: "<暗号文>", name?: "飛入　花子", dept?: "外部" }

// event(共有DB の event/current)
{ title, dateText, venue, salt, check, rosterVersion, createdAt, updatedAt }

// key(deriveKey の戻り値)
{ aes: CryptoKey, hmac: CryptoKey }
```

---

### Task 1: プロジェクト雛形とテスト用 Excel の生成

**Files:**
- Create: `uketsuke-stamp/package.json`
- Create: `uketsuke-stamp/tests/fixtures/make-fixture.js`
- Create: `uketsuke-stamp/tests/fixtures/sample-出欠表.xlsx`(生成物)
- Create: `uketsuke-stamp/tests/helpers.js`
- Create: `uketsuke-stamp/tests/fixture.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `helpers.loadFixture()` → SheetJS workbook、`helpers.makeSheet(aoa, merges)` → SheetJS worksheet、`helpers.makeWorkbook([{name, aoa, merges}])` → workbook

- [ ] **Step 1: package.json と .gitignore**

`uketsuke-stamp/package.json`:

```json
{
  "name": "uketsuke-stamp",
  "version": "2.0.0",
  "private": true,
  "description": "社内イベント出欠管理「受付スタンプ」",
  "scripts": {
    "test": "node --test \"tests/**/*.test.js\"",
    "make-fixture": "node tests/fixtures/make-fixture.js"
  },
  "devDependencies": {
    "xlsx": "0.18.5"
  }
}
```

`.gitignore`(リポジトリ直下)に追記:

```
uketsuke-stamp/node_modules/
```

実行:

```bash
cd uketsuke-stamp && npm install --no-audit --no-fund
```

Expected: `added 1 package` 程度の出力、`uketsuke-stamp/node_modules/xlsx` が存在する。

- [ ] **Step 2: テストヘルパ**

`uketsuke-stamp/tests/helpers.js`:

```js
"use strict";
const path = require("path");
const XLSX = require("xlsx");

const FIXTURE = path.join(__dirname, "fixtures", "sample-出欠表.xlsx");

function loadFixture() {
  return XLSX.readFile(FIXTURE);
}

// aoa: 2次元配列(null は空セル)。merges: [{s:{r,c}, e:{r,c}}]
function makeSheet(aoa, merges) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges && merges.length) ws["!merges"] = merges;
  return ws;
}

function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(function (s) {
    XLSX.utils.book_append_sheet(wb, makeSheet(s.aoa, s.merges), s.name);
  });
  return wb;
}

// 結合範囲を短く書くためのヘルパ: m("A5:AK5") → {s:{r:4,c:0}, e:{r:4,c:36}}
function m(range) {
  return XLSX.utils.decode_range(range);
}

// 実ファイルと同じ形の部署シートを合成する。people: [{name, title, plan}]
// opts.extraRows: 見出し行の前に挟む追加行数(見出し行を下にずらすテスト用)
// opts.order: 見出しの並び ["name","title","plan","day"] を入れ替えるテスト用
function deptSheetAoa(people, opts) {
  opts = opts || {};
  const order = opts.order || ["name", "title", "plan", "day"];
  const labels = { name: "氏　名", title: "役職", plan: "出欠席\r\n予定", day: "当日\r\n出欠席" };
  const cols = { name: 0, title: 6, plan: 10, day: 13 }; // A, G, K, N
  const aoa = [];
  aoa.push(["第48回改善事例発表会出欠表"]);
  aoa.push(["2026年10月1日（木）　13:30　開始"]);
  aoa.push(["スクエア荏原　イベントホール"]);
  for (let i = 0; i < (opts.extraRows || 0); i++) aoa.push([null]);
  const header = [];
  order.forEach(function (key, i) {
    header[Object.values(cols)[i]] = labels[key];
  });
  aoa.push(header);
  const colOf = {};
  order.forEach(function (key, i) { colOf[key] = Object.values(cols)[i]; });
  people.forEach(function (p) {
    const row = [];
    row[colOf.name] = p.name;
    row[colOf.title] = p.title || null;
    row[colOf.plan] = p.plan || null;
    aoa.push(row);
  });
  return { aoa: aoa, colOf: colOf, headerIndex: 3 + (opts.extraRows || 0) };
}

module.exports = { XLSX, FIXTURE, loadFixture, makeSheet, makeWorkbook, m, deptSheetAoa };
```

- [ ] **Step 3: fixture 生成スクリプト**

`uketsuke-stamp/tests/fixtures/make-fixture.js`:

```js
"use strict";
// 実際の出欠表(環境変数 XLSX_PATH)から、レイアウトだけを残して
// 氏名・役職・出欠予定をダミー化したテスト用ファイルを生成する。
// 生成後、実ファイルの氏名が 1 つも含まれていないことを検査する。
const path = require("path");
const XLSX = require("xlsx");

const src = process.env.XLSX_PATH;
if (!src) {
  console.error("XLSX_PATH に実ファイルのパスを設定してください");
  process.exit(1);
}
const out = path.join(__dirname, "sample-出欠表.xlsx");
const DEPT_RE = /^[0-9０-９]+[\s\u3000]+/;
const TITLES = ["部長", "課長", "副長", "主任", "", "", ""];
const KEEP_COLS = 16; // A..P。Q 以降(欠席理由・備考)は捨てる
const LABEL_RE = /^(計|小計|合計|総計|人数|出席者数|欠席者数)$/;

function norm(v) { return String(v == null ? "" : v).replace(/[\s\u3000]/g, ""); }

const wb = XLSX.readFile(src);
const dst = XLSX.utils.book_new();
const realNames = new Set();
let seq = 0;

wb.SheetNames.forEach(function (name) {
  const ws = wb.Sheets[name];
  if (!DEPT_RE.test(name)) {
    // 対象外シート(原本・出欠合計表など)は名前だけ残し中身は捨てる
    XLSX.utils.book_append_sheet(dst, XLSX.utils.aoa_to_sheet([[name + "(ダミー)"]]), name);
    return;
  }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const merges = ws["!merges"] || [];
  let headerIdx = rows.findIndex(function (r) { return norm(r[0]).indexOf("氏名") === 0; });
  if (headerIdx < 0) headerIdx = 3;
  const aoa = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r].slice(0, KEEP_COLS);
    while (row.length < KEEP_COLS) row.push("");
    if (r > headerIdx) {
      const fullWidth = merges.some(function (mg) { return mg.s.r === r && mg.s.c === 0 && mg.e.c >= 6; });
      const a = row[0];
      const isLabel = typeof a === "string" && LABEL_RE.test(norm(a));
      if (isLabel) { aoa.push(row.map(function (v) { return v === "" ? null : v; })); continue; } // 「計（ 8 名）」の小計行はそのまま
      if (typeof a === "string" && a !== "") {
        realNames.add(a.trim());
        if (fullWidth) {
          row[0] = "全幅結合行(ダミー)";
        } else {
          seq++;
          row[0] = "試験　" + String(seq).padStart(3, "0");
          row[6] = TITLES[seq % TITLES.length];
          row[10] = seq % 3 === 0 ? "〇" : seq % 7 === 0 ? "×" : "";
          row[13] = "";
        }
      }
      // 上記以外の列にある文字列は全部つぶす(数値はそのまま)
      for (let c = 0; c < KEEP_COLS; c++) {
        if (c === 0 || c === 6 || c === 10 || c === 13) continue;
        if (typeof row[c] === "string" && row[c] !== "") row[c] = "x";
      }
    }
    aoa.push(row.map(function (v) { return v === "" ? null : v; }));
  }
  const nws = XLSX.utils.aoa_to_sheet(aoa);
  nws["!merges"] = merges
    .filter(function (mg) { return mg.s.c < KEEP_COLS; })
    .map(function (mg) { return { s: mg.s, e: { r: mg.e.r, c: Math.min(mg.e.c, KEEP_COLS - 1) } }; });
  XLSX.utils.book_append_sheet(dst, nws, name);
});

XLSX.writeFile(dst, out);

// 検査: 実名が生成物に残っていないこと
const check = XLSX.readFile(out);
let leaked = 0;
check.SheetNames.forEach(function (name) {
  const rows = XLSX.utils.sheet_to_json(check.Sheets[name], { header: 1, defval: "" });
  rows.forEach(function (r) {
    r.forEach(function (v) {
      if (typeof v === "string" && realNames.has(v.trim())) leaked++;
    });
  });
});
if (leaked) {
  console.error("実名が " + leaked + " 件残っています。生成物を削除してください");
  process.exit(2);
}
console.log("生成: " + out);
console.log("部署シート人数: " + seq);
```

実行(Git Bash):

```bash
cd uketsuke-stamp && XLSX_PATH='Z:/000 個人フォルダ/099 長静/第48回改善事例発表会 出欠表.xlsm' node tests/fixtures/make-fixture.js
```

Expected:

```
生成: ...\tests\fixtures\sample-出欠表.xlsx
部署シート人数: 308
```

(各シートの 5 行目は部署名の全幅結合小見出し、末尾の「計（ n 名）」行は小計なので人数に含まれない)

人数が 308 でなければ、Task 3 のテスト期待値をこの出力に合わせる(〇 = floor(n/3)、× = floor(n/7) − floor(n/21)、未回答 = 残り)。

- [ ] **Step 4: fixture の煙テストを書く**

`uketsuke-stamp/tests/fixture.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFixture } = require("./helpers");

test("fixture: 部署シートが 30 枚あり、対象外シートも残っている", () => {
  const wb = loadFixture();
  const dept = wb.SheetNames.filter((n) => /^[0-9０-９]+[\s\u3000]+/.test(n));
  assert.equal(dept.length, 30);
  assert.ok(wb.SheetNames.includes("原本"));
  assert.ok(wb.SheetNames.includes("出欠合計表"));
  assert.ok(wb.SheetNames.includes("３０ 大阪支店他"));
});

test("fixture: 見出し行が 4 行目にあり、実名の代わりにダミー名が入っている", () => {
  const wb = loadFixture();
  const ws = wb.Sheets["02 総務部"];
  assert.equal(String(ws.A4.v).replace(/[\s\u3000]/g, ""), "氏名");
  assert.equal(String(ws.G4.v).replace(/[\s\u3000]/g, ""), "役職");
  assert.equal(String(ws.K4.v).replace(/[\s\u3000]/g, ""), "出欠席予定");
  assert.equal(String(ws.N4.v).replace(/[\s\u3000]/g, ""), "当日出欠席");
  assert.equal(String(ws.A5.v), "全幅結合行(ダミー)");
  assert.match(String(ws.A6.v), /^試験　\d{3}$/);
  assert.equal(String(ws.A28.v), "計");
});
```

- [ ] **Step 5: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 2`、`# fail 0`。

- [ ] **Step 6: コミット**

```bash
git add .gitignore uketsuke-stamp/package.json uketsuke-stamp/package-lock.json uketsuke-stamp/tests/helpers.js uketsuke-stamp/tests/fixtures/make-fixture.js "uketsuke-stamp/tests/fixtures/sample-出欠表.xlsx" uketsuke-stamp/tests/fixture.test.js
git commit -m "uketsuke-stamp: add project scaffold and anonymized Excel fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: core.js — シート名・見出し・出欠記号の解析

**Files:**
- Create: `uketsuke-stamp/core.js`
- Create: `uketsuke-stamp/tests/core-parse.test.js`

**Interfaces:**
- Produces: `toHalfWidthDigits(s)`, `parseSheetName(name)` → `{deptOrder, dept}|null`, `normalizeLabel(v)`, `normalizePlan(v)` → `"yes"|"no"|"unknown"`, `formatPlan(plan)` → `"〇"|"×"|""`, `colLetter(idx)`, `findHeader(rows)` → `{headerRow, nameCol, titleCol, planCol, dayCol}|null`(全て 0 始まり)

- [ ] **Step 1: 失敗するテストを書く**

`uketsuke-stamp/tests/core-parse.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

test("parseSheetName: 半角/全角の番号と部署名を分ける", () => {
  assert.deepEqual(Core.parseSheetName("02 総務部"), { deptOrder: 2, dept: "総務部" });
  assert.deepEqual(Core.parseSheetName("３０ 大阪支店他"), { deptOrder: 30, dept: "大阪支店他" });
  assert.deepEqual(Core.parseSheetName("12　第一工事本部"), { deptOrder: 12, dept: "第一工事本部" });
  assert.equal(Core.parseSheetName("原本"), null);
  assert.equal(Core.parseSheetName("出欠合計表"), null);
  assert.equal(Core.parseSheetName("Sheet2"), null);
});

test("normalizeLabel: 空白・全角空白・改行を除く", () => {
  assert.equal(Core.normalizeLabel("氏　名"), "氏名");
  assert.equal(Core.normalizeLabel("出欠席\r\n予定"), "出欠席予定");
  assert.equal(Core.normalizeLabel(" 当日\n出欠席 "), "当日出欠席");
  assert.equal(Core.normalizeLabel(null), "");
  assert.equal(Core.normalizeLabel(12), "12");
});

test("normalizePlan / formatPlan", () => {
  ["〇", "○", "◯", "o", "O", " 〇 "].forEach((v) => assert.equal(Core.normalizePlan(v), "yes", v));
  ["×", "x", "X", "✕"].forEach((v) => assert.equal(Core.normalizePlan(v), "no", v));
  ["", null, undefined, "未定", 1].forEach((v) => assert.equal(Core.normalizePlan(v), "unknown", String(v)));
  assert.equal(Core.formatPlan("yes"), "〇");
  assert.equal(Core.formatPlan("no"), "×");
  assert.equal(Core.formatPlan("unknown"), "");
});

test("colLetter", () => {
  assert.equal(Core.colLetter(0), "A");
  assert.equal(Core.colLetter(6), "G");
  assert.equal(Core.colLetter(13), "N");
  assert.equal(Core.colLetter(26), "AA");
  assert.equal(Core.colLetter(36), "AK");
});

test("findHeader: 見出しラベルから列を特定する", () => {
  const rows = [
    ["タイトル"],
    ["日時"],
    ["会場"],
    ["氏　名", null, null, null, null, null, "役職", null, null, null, "出欠席\r\n予定", null, null, "当日\r\n出欠席", null, null, "欠席理由"],
    ["山田"],
  ];
  assert.deepEqual(Core.findHeader(rows), { headerRow: 3, nameCol: 0, titleCol: 6, planCol: 10, dayCol: 13 });
});

test("findHeader: 列順が違っても、見出しが 6 行目でも、当日欄が無くても特定できる", () => {
  const rows = [[], [], [], [], [], ["役職", "出欠席予定", "氏名"]];
  assert.deepEqual(Core.findHeader(rows), { headerRow: 5, nameCol: 2, titleCol: 0, planCol: 1, dayCol: null });
});

test("findHeader: 3 ラベルが揃う行が無ければ null", () => {
  assert.equal(Core.findHeader([["氏名", "役職"], ["出欠席予定"]]), null);
  assert.equal(Core.findHeader([]), null);
  // 11 行目以降は見ない
  const late = []; for (let i = 0; i < 10; i++) late.push([]);
  late.push(["氏名", "役職", "出欠席予定"]);
  assert.equal(Core.findHeader(late), null);
});
```

- [ ] **Step 2: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Cannot find module '../core'` で FAIL。

- [ ] **Step 3: core.js を作る(このタスク分)**

`uketsuke-stamp/core.js`:

```js
/* 受付スタンプ core: ブラウザ / Node 両対応の純粋関数 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UketsukeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 文字列・シート名 ----------
  function toHalfWidthDigits(s) {
    return String(s).replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  }

  function parseSheetName(name) {
    var m = /^([0-9０-９]+)[\s\u3000]+(.+)$/.exec(String(name));
    if (!m) return null;
    return { deptOrder: parseInt(toHalfWidthDigits(m[1]), 10), dept: m[2].trim() };
  }

  function normalizeLabel(v) {
    return String(v == null ? "" : v).replace(/[\s\u3000]/g, "");
  }

  function normalizePlan(v) {
    var s = normalizeLabel(v);
    if (/^[〇○◯oO]$/.test(s)) return "yes";
    if (/^[×xX✕]$/.test(s)) return "no";
    return "unknown";
  }

  function formatPlan(plan) {
    return plan === "yes" ? "〇" : plan === "no" ? "×" : "";
  }

  function colLetter(idx) {
    var s = "";
    idx = idx + 1;
    while (idx > 0) {
      var r = (idx - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      idx = Math.floor((idx - 1) / 26);
    }
    return s;
  }

  // ---------- 見出し行 ----------
  var LABELS = { name: "氏名", title: "役職", plan: "出欠席予定", day: "当日出欠席" };

  function findHeader(rows) {
    var limit = Math.min(rows.length, 10);
    for (var r = 0; r < limit; r++) {
      var row = rows[r] || [];
      var cols = {};
      for (var c = 0; c < row.length; c++) {
        var label = normalizeLabel(row[c]);
        if (!label) continue;
        Object.keys(LABELS).forEach(function (key) {
          if (cols[key] === undefined && label.indexOf(LABELS[key]) === 0) cols[key] = c;
        });
      }
      if (cols.name !== undefined && cols.title !== undefined && cols.plan !== undefined) {
        return { headerRow: r, nameCol: cols.name, titleCol: cols.title, planCol: cols.plan, dayCol: cols.day === undefined ? null : cols.day };
      }
    }
    return null;
  }

  return {
    toHalfWidthDigits: toHalfWidthDigits,
    parseSheetName: parseSheetName,
    normalizeLabel: normalizeLabel,
    normalizePlan: normalizePlan,
    formatPlan: formatPlan,
    colLetter: colLetter,
    findHeader: findHeader
  };
});
```

- [ ] **Step 4: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 9`、`# fail 0`。

- [ ] **Step 5: コミット**

```bash
git add uketsuke-stamp/core.js uketsuke-stamp/tests/core-parse.test.js
git commit -m "uketsuke-stamp: parse sheet names, header labels and attendance marks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: core.js — Excel ブック全体の解析(parseWorkbook)

**Files:**
- Modify: `uketsuke-stamp/core.js`
- Create: `uketsuke-stamp/tests/core-workbook.test.js`

**Interfaces:**
- Consumes: Task 2 の `parseSheetName`, `findHeader`, `normalizePlan`, `colLetter`
- Produces: `parseWorkbook(wb, XLSX)` → `{ event: {title, dateText, venue}, sheets: [sheetMeta], people: [person(id 無し)], warnings: [string] }`。部署シートが 0 枚なら `Error("部署シート(番号+部署名)が見つかりません")` を投げる

- [ ] **Step 1: 失敗するテストを書く**

`uketsuke-stamp/tests/core-workbook.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { XLSX, loadFixture, makeWorkbook, m, deptSheetAoa } = require("./helpers");

test("parseWorkbook: fixture から 30 シート 308 名を読み、警告は無い", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  assert.equal(r.sheets.length, 30);
  assert.equal(r.people.length, 308);
  assert.deepEqual(r.warnings, []);
  const plans = { yes: 0, no: 0, unknown: 0 };
  r.people.forEach((p) => plans[p.plan]++);
  assert.deepEqual(plans, { yes: 102, no: 30, unknown: 176 });
  // 「計」の小計行を名簿に入れていない
  assert.ok(!r.people.some((p) => p.name === "計"));
  assert.equal(r.event.title, "第48回改善事例発表会出欠表");
  assert.equal(r.event.dateText, "2026年10月1日（木）　13:30　開始");
  assert.equal(r.event.venue, "スクエア荏原　イベントホール");
});

test("parseWorkbook: sheetMeta に見出し行・列・名簿行範囲が入る", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  const s = r.sheets.find((x) => x.sheetName === "02 総務部");
  assert.deepEqual(
    { sheetName: s.sheetName, deptOrder: s.deptOrder, dept: s.dept, headerRow: s.headerRow, nameCol: s.nameCol, titleCol: s.titleCol, planCol: s.planCol, dayCol: s.dayCol, firstRow: s.firstRow },
    { sheetName: "02 総務部", deptOrder: 2, dept: "総務部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: 6 }
  );
  assert.ok(s.lastRow >= 6 && s.lastRow <= 27, "lastRow=" + s.lastRow); // 末尾の「計」行(28)は含まない
  assert.ok(s.lastRow >= s.firstRow);
  const osaka = r.sheets.find((x) => x.sheetName === "３０ 大阪支店他");
  assert.equal(osaka.deptOrder, 30);
  // 5 行目は全幅結合の小見出しなので名簿は 6 行目から
  assert.equal(osaka.firstRow, 6);
});

test("parseWorkbook: person は元の行番号・部署順・氏名・役職・予定を持つ", () => {
  const r = Core.parseWorkbook(loadFixture(), XLSX);
  const p = r.people.find((x) => x.sheetName === "02 総務部" && x.row === 6);
  assert.equal(p.deptOrder, 2);
  assert.equal(p.dept, "総務部");
  assert.match(p.name, /^試験　\d{3}$/);
  assert.ok(["yes", "no", "unknown"].includes(p.plan));
  assert.equal(typeof p.title, "string");
  assert.equal(p.id, undefined);
});

test("parseWorkbook: 全幅結合の小見出し・注意書き行と「計」の小計行を読み飛ばす", () => {
  const d = deptSheetAoa([{ name: "山田　太郎", title: "課長", plan: "〇" }, { name: "佐藤　花子", plan: "×" }]);
  // 5 行目(index 4)に全幅結合の小見出しを挟み、末尾に小計行と注意書き行を足す
  d.aoa.splice(4, 0, ["大阪支店・名古屋支店・仙台支店"]);
  d.aoa.push(["計", "（", 2, null, "名", "）", null, null, null, null, 1, null, null, 0]);
  d.aoa.push(["9月14日までに提出お願いします。"]);
  const wb = makeWorkbook([{ name: "０１ 試験部", aoa: d.aoa, merges: [m("A5:AK5"), m("A9:AK9")] }]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.people.map((p) => [p.row, p.name, p.title, p.plan]), [[6, "山田　太郎", "課長", "yes"], [7, "佐藤　花子", "", "no"]]);
  assert.equal(r.sheets[0].firstRow, 6);
  assert.equal(r.sheets[0].lastRow, 7);
});

test("parseWorkbook: 列順が違うシート・見出しが 6 行目のシートも読める", () => {
  const swapped = deptSheetAoa([{ name: "田中　一郎", title: "主任", plan: "〇" }], { order: ["title", "name", "plan", "day"] });
  const shifted = deptSheetAoa([{ name: "鈴木　二郎", plan: "" }], { extraRows: 2 });
  const wb = makeWorkbook([
    { name: "01 甲部", aoa: swapped.aoa },
    { name: "02 乙部", aoa: shifted.aoa },
  ]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.people.map((p) => [p.sheetName, p.row, p.name, p.title, p.plan]), [
    ["01 甲部", 5, "田中　一郎", "主任", "yes"],
    ["02 乙部", 7, "鈴木　二郎", "", "unknown"],
  ]);
  assert.equal(r.sheets[0].nameCol, "G");
  assert.equal(r.sheets[0].titleCol, "A");
  assert.equal(r.sheets[1].headerRow, 6);
});

test("parseWorkbook: 見出しの無い部署シートは警告して読み飛ばし、対象外シートは無視する", () => {
  const ok = deptSheetAoa([{ name: "高橋　三郎" }]);
  const wb = makeWorkbook([
    { name: "原本", aoa: [["古いテンプレ"]] },
    { name: "01 甲部", aoa: ok.aoa },
    { name: "02 乙部", aoa: [["見出しが無いシート"], ["山田"]] },
  ]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.equal(r.people.length, 1);
  assert.equal(r.sheets.length, 1);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /02 乙部/);
  assert.match(r.warnings[0], /見出し行/);
});

test("parseWorkbook: 長すぎる氏名・数値の氏名は警告して読み飛ばす", () => {
  const d = deptSheetAoa([{ name: "あ".repeat(21) }, { name: "正常　太郎" }]);
  d.aoa.push([12345]);
  const wb = makeWorkbook([{ name: "01 甲部", aoa: d.aoa }]);
  const r = Core.parseWorkbook(wb, XLSX);
  assert.deepEqual(r.people.map((p) => p.name), ["正常　太郎"]);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /5 行/);
  assert.match(r.warnings[1], /7 行/);
});

test("parseWorkbook: 部署シートが無ければ例外", () => {
  const wb = makeWorkbook([{ name: "原本", aoa: [["x"]] }]);
  assert.throws(() => Core.parseWorkbook(wb, XLSX), /部署シート/);
});
```

- [ ] **Step 2: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Core.parseWorkbook is not a function` で FAIL(8 件)。

- [ ] **Step 3: parseWorkbook を実装**

`uketsuke-stamp/core.js` の `// ---------- 見出し行 ----------` ブロックの後(`return {` の前)に追加:

```js
  // ---------- ブック全体 ----------
  function cellText(v) {
    return String(v == null ? "" : v).trim();
  }

  var SUBTOTAL_RE = /^(計|小計|合計|総計|人数|出席者数|欠席者数)$/;

  function mergeAt(merges, r, c) {
    for (var i = 0; i < merges.length; i++) {
      var mg = merges[i];
      if (mg.s.r <= r && r <= mg.e.r && mg.s.c <= c && c <= mg.e.c) return mg;
    }
    return null;
  }

  function parseWorkbook(wb, XLSX) {
    var result = { event: { title: "", dateText: "", venue: "" }, sheets: [], people: [], warnings: [] };
    var eventTaken = false;
    wb.SheetNames.forEach(function (sheetName) {
      var parsed = parseSheetName(sheetName);
      if (!parsed) return;
      var ws = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
      var header = findHeader(rows);
      if (!header) {
        result.warnings.push("シート「" + sheetName + "」: 見出し行(氏名・役職・出欠席予定)が見つからないため読み飛ばしました");
        return;
      }
      if (!eventTaken) {
        eventTaken = true;
        var above = [];
        for (var a = 0; a < header.headerRow; a++) above.push(cellText((rows[a] || [])[0]));
        result.event.title = above[0] || "";
        result.event.dateText = above[1] || "";
        result.event.venue = above[2] || "";
      }
      var merges = ws["!merges"] || [];
      var otherCols = [header.titleCol, header.planCol];
      var firstRow = null, lastRow = null;
      for (var r = header.headerRow + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var raw = row[header.nameCol];
        if (raw === "" || raw === undefined || raw === null) continue;
        var mg = mergeAt(merges, r, header.nameCol);
        if (mg && otherCols.some(function (c) { return mg.s.c <= c && c <= mg.e.c; })) continue; // 全幅結合: 小見出し / 注意書き
        if (typeof raw !== "string") {
          result.warnings.push("シート「" + sheetName + "」" + (r + 1) + " 行: 氏名が文字列でないため読み飛ばしました");
          continue;
        }
        var name = raw.trim();
        if (!name) continue;
        if (SUBTOTAL_RE.test(normalizeLabel(name))) continue; // 「計（ n 名）」などの小計行
        if (name.length > 20) {
          result.warnings.push("シート「" + sheetName + "」" + (r + 1) + " 行: 氏名が長すぎるため読み飛ばしました");
          continue;
        }
        result.people.push({
          deptOrder: parsed.deptOrder,
          dept: parsed.dept,
          sheetName: sheetName,
          row: r + 1,
          name: name,
          title: cellText(row[header.titleCol]),
          plan: normalizePlan(row[header.planCol])
        });
        if (firstRow === null) firstRow = r + 1;
        lastRow = r + 1;
      }
      result.sheets.push({
        sheetName: sheetName,
        deptOrder: parsed.deptOrder,
        dept: parsed.dept,
        headerRow: header.headerRow + 1,
        nameCol: colLetter(header.nameCol),
        titleCol: colLetter(header.titleCol),
        planCol: colLetter(header.planCol),
        dayCol: header.dayCol === null ? null : colLetter(header.dayCol),
        firstRow: firstRow,
        lastRow: lastRow
      });
    });
    if (!result.sheets.length) throw new Error("部署シート(番号+部署名)が見つかりません");
    return result;
  }
```

`return { ... }` に `parseWorkbook: parseWorkbook` を追加する。

- [ ] **Step 4: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 17`、`# fail 0`。fixture の人数・〇×の数が合わない場合は Task 1 Step 3 の生成出力 n に合わせて期待値を直す(〇 = floor(n/3)、× = floor(n/7) − floor(n/21)、未回答 = 残り。生成ロジックは変えない)。

- [ ] **Step 5: コミット**

```bash
git add uketsuke-stamp/core.js uketsuke-stamp/tests/core-workbook.test.js
git commit -m "uketsuke-stamp: parse department sheets into roster entries

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: core.js — 鍵導出・暗号化・参加者 ID

**Files:**
- Modify: `uketsuke-stamp/core.js`
- Create: `uketsuke-stamp/tests/core-crypto.test.js`

**Interfaces:**
- Consumes: Task 2 の `normalizeLabel`(なし)。`globalThis.crypto.subtle`、`btoa` / `atob`、`TextEncoder`
- Produces(すべて Promise を返す非同期関数、`randomSaltB64` と `sortPeople` 以外):
  - `randomSaltB64()` → base64 文字列(16 byte)
  - `deriveKey(passphrase, saltB64)` → `{aes, hmac}`
  - `encryptJson(key, value)` → `"<b64 iv>.<b64 ct>"`
  - `decryptJson(key, str)` → 元の値(失敗時は例外)
  - `makeCheck(key)` → `encryptJson(key, "uketsuke-ok")`
  - `verifyKey(key, check)` → boolean
  - `personId(key, dept, name, n)` → 16 hex 文字
  - `assignIds(key, people)` → `id` 付きの person 配列(部署順・行順)
  - `sortPeople(people)` → deptOrder, row の順に並べた新しい配列

- [ ] **Step 1: 失敗するテストを書く**

`uketsuke-stamp/tests/core-crypto.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

test("randomSaltB64: 16 byte の base64 で毎回違う", () => {
  const a = Core.randomSaltB64();
  const b = Core.randomSaltB64();
  assert.equal(Buffer.from(a, "base64").length, 16);
  assert.notEqual(a, b);
});

test("encryptJson/decryptJson: 往復できて、毎回違う暗号文になる", async () => {
  const salt = Core.randomSaltB64();
  const key = await Core.deriveKey("ひみつ123", salt);
  const value = { people: [{ name: "山田　太郎", dept: "総務部" }], n: 1 };
  const c1 = await Core.encryptJson(key, value);
  const c2 = await Core.encryptJson(key, value);
  assert.match(c1, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.notEqual(c1, c2);
  assert.deepEqual(await Core.decryptJson(key, c1), value);
  assert.ok(!c1.includes("山田"));
});

test("verifyKey: 正しいパスフレーズなら true、違えば false", async () => {
  const salt = Core.randomSaltB64();
  const key = await Core.deriveKey("正しい", salt);
  const check = await Core.makeCheck(key);
  assert.equal(await Core.verifyKey(key, check), true);
  const wrong = await Core.deriveKey("間違い", salt);
  assert.equal(await Core.verifyKey(wrong, check), false);
  assert.equal(await Core.verifyKey(key, "garbage"), false);
});

test("personId: 同じ入力なら同じ ID、鍵・部署・氏名・連番のどれかが違えば別 ID", async () => {
  const salt = Core.randomSaltB64();
  const k1 = await Core.deriveKey("A", salt);
  const k2 = await Core.deriveKey("B", salt);
  const id = await Core.personId(k1, "総務部", "山田　太郎", 0);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(await Core.personId(k1, "総務部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k2, "総務部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k1, "経理部", "山田　太郎", 0), id);
  assert.notEqual(await Core.personId(k1, "総務部", "山田　次郎", 0), id);
  assert.notEqual(await Core.personId(k1, "総務部", "山田　太郎", 1), id);
});

test("sortPeople: 部署順→行順に並ぶ", () => {
  const people = [
    { deptOrder: 2, row: 6, name: "b" },
    { deptOrder: 1, row: 9, name: "a2" },
    { deptOrder: 1, row: 6, name: "a1" },
  ];
  assert.deepEqual(Core.sortPeople(people).map((p) => p.name), ["a1", "a2", "b"]);
  assert.equal(people[0].name, "b"); // 元の配列は変えない
});

test("assignIds: 同姓同名は同一部署内で行順に連番、再実行しても同じ ID", async () => {
  const key = await Core.deriveKey("pass", Core.randomSaltB64());
  const people = [
    { deptOrder: 1, dept: "甲部", sheetName: "01 甲部", row: 8, name: "山田　太郎", title: "", plan: "yes" },
    { deptOrder: 1, dept: "甲部", sheetName: "01 甲部", row: 6, name: "山田　太郎", title: "", plan: "no" },
    { deptOrder: 2, dept: "乙部", sheetName: "02 乙部", row: 6, name: "山田　太郎", title: "", plan: "yes" },
  ];
  const a = await Core.assignIds(key, people);
  assert.deepEqual(a.map((p) => [p.dept, p.row]), [["甲部", 6], ["甲部", 8], ["乙部", 6]]);
  assert.equal(a[0].id, await Core.personId(key, "甲部", "山田　太郎", 0));
  assert.equal(a[1].id, await Core.personId(key, "甲部", "山田　太郎", 1));
  assert.equal(a[2].id, await Core.personId(key, "乙部", "山田　太郎", 0));
  assert.equal(new Set(a.map((p) => p.id)).size, 3);
  const again = await Core.assignIds(key, people);
  assert.deepEqual(again.map((p) => p.id), a.map((p) => p.id));
  assert.equal(people[0].id, undefined); // 入力は変えない
});
```

- [ ] **Step 2: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Core.randomSaltB64 is not a function` 等で 6 件 FAIL。

- [ ] **Step 3: 実装**

`uketsuke-stamp/core.js` の `parseWorkbook` の後に追加:

```js
  // ---------- バイト列ユーティリティ ----------
  var subtle = (typeof crypto !== "undefined" && crypto.subtle) ? crypto.subtle : null;
  var textEncoder = new TextEncoder();
  var textDecoder = new TextDecoder();

  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }

  // ---------- 鍵・暗号化 ----------
  var PBKDF2_ITER = 200000;
  var CHECK_PLAIN = "uketsuke-ok";

  function randomSaltB64() {
    return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  }

  async function deriveKey(passphrase, saltB64) {
    var base = await subtle.importKey("raw", textEncoder.encode(String(passphrase)), "PBKDF2", false, ["deriveBits"]);
    var bits = new Uint8Array(await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64ToBytes(saltB64), iterations: PBKDF2_ITER }, base, 512));
    var aes = await subtle.importKey("raw", bits.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    var hmac = await subtle.importKey("raw", bits.slice(32, 64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { aes: aes, hmac: hmac };
  }

  async function encryptJson(key, value) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await subtle.encrypt({ name: "AES-GCM", iv: iv }, key.aes, textEncoder.encode(JSON.stringify(value)));
    return bytesToB64(iv) + "." + bytesToB64(new Uint8Array(ct));
  }

  async function decryptJson(key, str) {
    var parts = String(str).split(".");
    if (parts.length !== 2) throw new Error("暗号文の形式が不正です");
    var pt = await subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(parts[0]) }, key.aes, b64ToBytes(parts[1]));
    return JSON.parse(textDecoder.decode(pt));
  }

  function makeCheck(key) {
    return encryptJson(key, CHECK_PLAIN);
  }

  async function verifyKey(key, check) {
    try {
      return (await decryptJson(key, check)) === CHECK_PLAIN;
    } catch (e) {
      return false;
    }
  }

  async function personId(key, dept, name, n) {
    var msg = textEncoder.encode(dept + "" + name + "" + n);
    var sig = await subtle.sign("HMAC", key.hmac, msg);
    return bytesToHex(new Uint8Array(sig)).slice(0, 16);
  }

  function sortPeople(people) {
    return people.slice().sort(function (a, b) {
      return (a.deptOrder - b.deptOrder) || (a.row - b.row);
    });
  }

  async function assignIds(key, people) {
    var seen = {};
    var out = [];
    var sorted = sortPeople(people);
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var k = p.dept + "" + p.name;
      var n = seen[k] || 0;
      seen[k] = n + 1;
      out.push(Object.assign({}, p, { id: await personId(key, p.dept, p.name, n) }));
    }
    return out;
  }
```

`return { ... }` に以下を追加:

```js
    randomSaltB64: randomSaltB64,
    deriveKey: deriveKey,
    encryptJson: encryptJson,
    decryptJson: decryptJson,
    makeCheck: makeCheck,
    verifyKey: verifyKey,
    personId: personId,
    sortPeople: sortPeople,
    assignIds: assignIds,
```

- [ ] **Step 4: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 23`、`# fail 0`。

- [ ] **Step 5: コミット**

```bash
git add uketsuke-stamp/core.js uketsuke-stamp/tests/core-crypto.test.js
git commit -m "uketsuke-stamp: key derivation, AES-GCM roster encryption and HMAC person ids

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: core.js — 判定・集計・検索・差分・書式

**Files:**
- Modify: `uketsuke-stamp/core.js`
- Create: `uketsuke-stamp/tests/core-stats.test.js`

**Interfaces:**
- Consumes: Task 4 の `sortPeople`
- Produces:
  - `KIND_LABEL` = `{ qr: "QR", manual: "名簿", walkin: "飛び入り" }`
  - `judge(plan, checked, listed)` → `""` / `"未受付"` / `"予定外出席"` / `"名簿外"`
  - `buildRows(roster, checkins)` → 受付した人の行 `[{pid, name, dept, title, plan, t, dev, kind, judge, listed}]` を受付時刻昇順
  - `summarize(roster, checkins)` → `{ total: {planYes, checked, missing, unexpected}, byDept: [{deptOrder, dept, sheetName, planYes, checked, missing, unexpected, missingPeople: [person]}], unlisted: [checkin] }`
  - `searchPeople(people, query)` → 氏名(空白無視)または部署に部分一致する person を部署順・行順で
  - `rosterDiff(oldPeople, newPeople)` → `{added, removed, changed}`(件数)
  - `walkinId()` → `"w-"` で始まる文字列
  - `formatClock(iso)` → `"HH:MM"`、`formatTime(iso)` → `"HH:MM:SS"`、`formatStamp(iso)` → `"YYYY/MM/DD HH:MM:SS"`(いずれもローカル時刻)

- [ ] **Step 1: 失敗するテストを書く**

`uketsuke-stamp/tests/core-stats.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");

function person(id, deptOrder, dept, row, name, plan, title) {
  return { id, deptOrder, dept, sheetName: String(deptOrder).padStart(2, "0") + " " + dept, row, name, title: title || "", plan };
}
const roster = {
  people: [
    person("p1", 1, "甲部", 6, "甲一", "yes"),
    person("p2", 1, "甲部", 7, "甲二", "yes"),
    person("p3", 1, "甲部", 8, "甲三", "no"),
    person("p4", 2, "乙部", 6, "乙一", "unknown"),
    person("p5", 2, "乙部", 7, "乙　二", "yes", "課長"),
  ],
  sheets: [],
};
const checkins = [
  { pid: "p2", t: "2026-10-01T04:10:00.000Z", dev: "受付1", kind: "qr" },
  { pid: "p3", t: "2026-10-01T04:05:00.000Z", dev: "受付2", kind: "manual" },
  { pid: "w-abc", t: "2026-10-01T04:20:00.000Z", dev: "受付1", kind: "walkin", name: "飛入　花子", dept: "外部" },
  { pid: "gone", t: "2026-10-01T04:30:00.000Z", dev: "受付3", kind: "qr" },
];

test("judge", () => {
  assert.equal(Core.judge("yes", true, true), "");
  assert.equal(Core.judge("yes", false, true), "未受付");
  assert.equal(Core.judge("no", true, true), "予定外出席");
  assert.equal(Core.judge("unknown", true, true), "予定外出席");
  assert.equal(Core.judge("no", false, true), "");
  assert.equal(Core.judge("unknown", false, true), "");
  assert.equal(Core.judge("yes", true, false), "名簿外");
});

test("buildRows: 受付した人だけを時刻順に、氏名を引いて返す", () => {
  const rows = Core.buildRows(roster, checkins);
  assert.deepEqual(rows.map((r) => [r.pid, r.name, r.dept, r.title, r.plan, r.dev, r.kind, r.judge, r.listed]), [
    ["p3", "甲三", "甲部", "", "no", "受付2", "manual", "予定外出席", true],
    ["p2", "甲二", "甲部", "", "yes", "受付1", "qr", "", true],
    ["w-abc", "飛入　花子", "外部", "", "unknown", "受付1", "walkin", "名簿外", false],
    ["gone", "(名簿外 gone)", "", "", "unknown", "受付3", "qr", "名簿外", false],
  ]);
});

test("summarize: 合計・部署別・名簿外", () => {
  const s = Core.summarize(roster, checkins);
  assert.deepEqual(s.total, { planYes: 3, checked: 4, missing: 2, unexpected: 3 });
  assert.deepEqual(s.byDept.map((d) => [d.dept, d.planYes, d.checked, d.missing, d.unexpected, d.missingPeople.map((p) => p.name)]), [
    ["甲部", 2, 2, 1, 1, ["甲一"]],
    ["乙部", 1, 0, 1, 0, ["乙　二"]],
  ]);
  assert.deepEqual(s.unlisted.map((c) => [c.pid, c.name, c.dept]), [["w-abc", "飛入　花子", "外部"], ["gone", "(名簿外 gone)", ""]]);
});

test("summarize: 受付が無くても動く", () => {
  const s = Core.summarize(roster, []);
  assert.deepEqual(s.total, { planYes: 3, checked: 0, missing: 3, unexpected: 0 });
  assert.deepEqual(s.unlisted, []);
});

test("searchPeople: 氏名(空白無視)・部署の部分一致、空なら全員", () => {
  assert.deepEqual(Core.searchPeople(roster.people, "乙二").map((p) => p.id), ["p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "乙 二").map((p) => p.id), ["p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "甲部").map((p) => p.id), ["p1", "p2", "p3"]);
  assert.deepEqual(Core.searchPeople(roster.people, "").map((p) => p.id), ["p1", "p2", "p3", "p4", "p5"]);
  assert.deepEqual(Core.searchPeople(roster.people, "該当なし"), []);
});

test("rosterDiff: id で追加・削除・変更を数える", () => {
  const before = [person("a", 1, "x", 6, "A", "yes"), person("b", 1, "x", 7, "B", "no", "課長"), person("c", 1, "x", 8, "C", "yes")];
  const after = [person("a", 1, "x", 6, "A", "yes"), person("b", 1, "x", 7, "B", "yes", "課長"), person("d", 1, "x", 9, "D", "yes")];
  assert.deepEqual(Core.rosterDiff(before, after), { added: 1, removed: 1, changed: 1 });
  assert.deepEqual(Core.rosterDiff([], after), { added: 3, removed: 0, changed: 0 });
});

test("walkinId: w- で始まり毎回違う", () => {
  const a = Core.walkinId();
  assert.match(a, /^w-[a-z0-9]+$/);
  assert.notEqual(a, Core.walkinId());
});

test("format*: ローカル時刻で固定書式", () => {
  const iso = "2026-10-01T04:05:06.000Z";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  assert.equal(Core.formatClock(iso), pad(d.getHours()) + ":" + pad(d.getMinutes()));
  assert.equal(Core.formatTime(iso), pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
  assert.equal(Core.formatStamp(iso), d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()));
  assert.equal(Core.formatClock(""), "");
});

test("KIND_LABEL", () => {
  assert.deepEqual(Core.KIND_LABEL, { qr: "QR", manual: "名簿", walkin: "飛び入り" });
});
```

- [ ] **Step 2: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Core.judge is not a function` 等で FAIL。

- [ ] **Step 3: 実装**

`uketsuke-stamp/core.js` の `assignIds` の後に追加:

```js
  // ---------- 判定・集計 ----------
  var KIND_LABEL = { qr: "QR", manual: "名簿", walkin: "飛び入り" };

  function judge(plan, checked, listed) {
    if (!listed) return "名簿外";
    if (plan === "yes") return checked ? "" : "未受付";
    return checked ? "予定外出席" : "";
  }

  function indexById(people) {
    var map = {};
    (people || []).forEach(function (p) { map[p.id] = p; });
    return map;
  }

  function unlistedName(c) {
    return c.name || ("(名簿外 " + c.pid + ")");
  }

  function buildRows(roster, checkins) {
    var byId = indexById(roster.people);
    return (checkins || []).slice().sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); }).map(function (c) {
      var p = byId[c.pid];
      if (p) {
        return { pid: c.pid, name: p.name, dept: p.dept, title: p.title, plan: p.plan, t: c.t, dev: c.dev || "", kind: c.kind, judge: judge(p.plan, true, true), listed: true };
      }
      return { pid: c.pid, name: unlistedName(c), dept: c.dept || "", title: "", plan: "unknown", t: c.t, dev: c.dev || "", kind: c.kind, judge: "名簿外", listed: false };
    });
  }

  function summarize(roster, checkins) {
    var people = sortPeople(roster.people || []);
    var checked = {};
    (checkins || []).forEach(function (c) { checked[c.pid] = c; });
    var known = {};
    var total = { planYes: 0, checked: 0, missing: 0, unexpected: 0 };
    var depts = [];
    var deptIndex = {};
    people.forEach(function (p) {
      known[p.id] = true;
      var d = deptIndex[p.sheetName];
      if (!d) {
        d = { deptOrder: p.deptOrder, dept: p.dept, sheetName: p.sheetName, planYes: 0, checked: 0, missing: 0, unexpected: 0, missingPeople: [] };
        deptIndex[p.sheetName] = d;
        depts.push(d);
      }
      var isChecked = !!checked[p.id];
      var j = judge(p.plan, isChecked, true);
      if (p.plan === "yes") { d.planYes++; total.planYes++; }
      if (isChecked) { d.checked++; total.checked++; }
      if (j === "未受付") { d.missing++; total.missing++; d.missingPeople.push(p); }
      if (j === "予定外出席") { d.unexpected++; total.unexpected++; }
    });
    var unlisted = (checkins || []).filter(function (c) { return !known[c.pid]; })
      .sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); })
      .map(function (c) { return Object.assign({}, c, { name: unlistedName(c), dept: c.dept || "" }); });
    total.checked += unlisted.length;
    total.unexpected += unlisted.length;
    return { total: total, byDept: depts, unlisted: unlisted };
  }

  function searchPeople(people, query) {
    var q = normalizeLabel(query);
    var hits = (people || []).filter(function (p) {
      if (!q) return true;
      return normalizeLabel(p.name).indexOf(q) >= 0 || normalizeLabel(p.dept).indexOf(q) >= 0;
    });
    return sortPeople(hits);
  }

  function rosterDiff(oldPeople, newPeople) {
    var before = indexById(oldPeople);
    var after = indexById(newPeople);
    var diff = { added: 0, removed: 0, changed: 0 };
    Object.keys(after).forEach(function (id) {
      if (!before[id]) { diff.added++; return; }
      var a = before[id], b = after[id];
      if (a.plan !== b.plan || a.title !== b.title || a.row !== b.row) diff.changed++;
    });
    Object.keys(before).forEach(function (id) { if (!after[id]) diff.removed++; });
    return diff;
  }

  function walkinId() {
    return "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 書式 ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function formatClock(iso) {
    var d = toDate(iso);
    return d ? pad2(d.getHours()) + ":" + pad2(d.getMinutes()) : "";
  }
  function formatTime(iso) {
    var d = toDate(iso);
    return d ? formatClock(iso) + ":" + pad2(d.getSeconds()) : "";
  }
  function formatStamp(iso) {
    var d = toDate(iso);
    return d ? d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + formatTime(iso) : "";
  }
```

`return { ... }` に追加:

```js
    KIND_LABEL: KIND_LABEL,
    judge: judge,
    buildRows: buildRows,
    summarize: summarize,
    searchPeople: searchPeople,
    rosterDiff: rosterDiff,
    walkinId: walkinId,
    formatClock: formatClock,
    formatTime: formatTime,
    formatStamp: formatStamp,
```

- [ ] **Step 4: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 32`、`# fail 0`。

- [ ] **Step 5: コミット**

```bash
git add uketsuke-stamp/core.js uketsuke-stamp/tests/core-stats.test.js
git commit -m "uketsuke-stamp: attendance judgement, per-department summary, search and diff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: core.js — CSV と Excel 書き出しデータ

**Files:**
- Modify: `uketsuke-stamp/core.js`
- Create: `uketsuke-stamp/tests/core-export.test.js`

**Interfaces:**
- Consumes: Task 5 の `buildRows`, `summarize`, `formatPlan`, `formatStamp`, `KIND_LABEL`; Task 4 の `sortPeople`
- Produces:
  - `buildCsv(roster, checkins)` → 文字列
  - `buildExportSheets(roster, checkins, event)` → `[{ name, rows }]`(rows は 2 次元配列、行番号 = 元ファイルの行番号 − 1)
  - `toWorkbook(XLSX, sheets)` → SheetJS workbook
  - `exportFilename(prefix, title, date, ext)` → 文字列

- [ ] **Step 1: 失敗するテストを書く**

`uketsuke-stamp/tests/core-export.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core");
const { XLSX } = require("./helpers");

function person(id, deptOrder, dept, row, name, plan, title) {
  return { id, deptOrder, dept, sheetName: String(deptOrder).padStart(2, "0") + " " + dept, row, name, title: title || "", plan };
}
const roster = {
  people: [
    person("p1", 1, "甲部", 6, "甲一", "yes", "課長"),
    person("p2", 1, "甲部", 8, "甲二", "yes"), // 7 行目は小見出しで空く
    person("p3", 2, "乙部", 6, "乙一", "no"),
  ],
  sheets: [
    { sheetName: "01 甲部", deptOrder: 1, dept: "甲部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: 6, lastRow: 8 },
    { sheetName: "02 乙部", deptOrder: 2, dept: "乙部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: null, firstRow: 6, lastRow: 6 },
    { sheetName: "03 丙部", deptOrder: 3, dept: "丙部", headerRow: 4, nameCol: "A", titleCol: "G", planCol: "K", dayCol: "N", firstRow: null, lastRow: null },
  ],
};
const t1 = "2026-10-01T04:05:06.000Z";
const t2 = "2026-10-01T04:06:07.000Z";
const checkins = [
  { pid: "p3", t: t2, dev: "受付2", kind: "manual" },
  { pid: "p1", t: t1, dev: "受付1", kind: "qr" },
  { pid: "w-1", t: t2, dev: "受付1", kind: "walkin", name: "飛入　花子", dept: "外部" },
];
const event = { title: "第48回改善事例発表会出欠表", dateText: "2026年10月1日（木）　13:30　開始", venue: "スクエア荏原　イベントホール" };

test("buildCsv: BOM・ヘッダ・受付順・クォート", () => {
  const csv = Core.buildCsv(roster, checkins);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"氏名","部署","役職","出欠席予定","受付時刻","受付端末","種別","判定"');
  assert.equal(lines[1], '"甲一","甲部","課長","〇","' + Core.formatStamp(t1) + '","受付1","QR",""');
  assert.equal(lines[2], '"乙一","乙部","","×","' + Core.formatStamp(t2) + '","受付2","名簿","予定外出席"');
  assert.equal(lines[3], '"飛入　花子","外部","","","' + Core.formatStamp(t2) + '","受付1","飛び入り","名簿外"');
  assert.equal(lines[4], "");
  assert.equal(lines.length, 5);
});

test("buildCsv: ダブルクォートを含む値はエスケープする", () => {
  const r = { people: [person("q", 1, "甲部", 6, 'A"B', "yes")], sheets: [] };
  const csv = Core.buildCsv(r, [{ pid: "q", t: t1, dev: "受付1", kind: "qr" }]);
  assert.ok(csv.includes('"A""B"'));
});

test("buildExportSheets: 部署シートは元の行番号に揃い、名簿外・集計シートが付く", () => {
  const sheets = Core.buildExportSheets(roster, checkins, event);
  assert.deepEqual(sheets.map((s) => s.name), ["01 甲部", "02 乙部", "03 丙部", "名簿外", "集計"]);

  const kou = sheets[0].rows;
  assert.deepEqual(kou[0], ["第48回改善事例発表会出欠表"]);
  assert.deepEqual(kou[1], ["2026年10月1日（木）　13:30　開始"]);
  assert.deepEqual(kou[2], ["スクエア荏原　イベントホール"]);
  assert.deepEqual(kou[3], ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定", "", "→ 元ファイルの N6:N8 に貼り付け"]);
  assert.deepEqual(kou[4], []); // 5 行目(小見出し)は空
  assert.deepEqual(kou[5], ["甲一", "課長", "〇", "〇", Core.formatStamp(t1), "受付1", ""]);
  assert.deepEqual(kou[6], []); // 7 行目は名簿行でない
  assert.deepEqual(kou[7], ["甲二", "", "〇", "", "", "", "未受付"]);
  assert.equal(kou.length, 8);

  const otsu = sheets[1].rows;
  assert.deepEqual(otsu[3].slice(0, 7), ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定"]);
  assert.equal(otsu[3][8], "→ 元ファイルの当日出欠席欄に貼り付け"); // dayCol 不明
  assert.deepEqual(otsu[5], ["乙一", "", "×", "〇", Core.formatStamp(t2), "受付2", "予定外出席"]);

  const hei = sheets[2].rows;
  assert.equal(hei.length, 4); // 見出しまで
  assert.equal(hei[3][8], "→ 元ファイルの当日出欠席欄に貼り付け");

  assert.deepEqual(sheets[3].rows, [
    ["氏名", "所属", "受付時刻", "受付端末", "種別"],
    ["飛入　花子", "外部", Core.formatStamp(t2), "受付1", "飛び入り"],
  ]);
  assert.deepEqual(sheets[4].rows, [
    ["部署", "予定〇", "受付済", "未受付", "予定外"],
    ["甲部", 2, 1, 1, 0],
    ["乙部", 0, 1, 0, 1],
    ["名簿外", "", 1, "", 1],
    ["合計", 2, 3, 1, 2],
  ]);
});

test("toWorkbook: SheetJS のブックになり xlsx に書ける", () => {
  const wb = Core.toWorkbook(XLSX, Core.buildExportSheets(roster, checkins, event));
  assert.deepEqual(wb.SheetNames, ["01 甲部", "02 乙部", "03 丙部", "名簿外", "集計"]);
  assert.equal(wb.Sheets["01 甲部"].D6.v, "〇");
  assert.equal(wb.Sheets["01 甲部"].A8.v, "甲二");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  assert.ok(buf.length > 1000);
  const back = XLSX.read(buf, { type: "buffer" });
  assert.equal(back.Sheets["集計"].B5.v, 2);
});

test("exportFilename: 記号を落として日時を付ける", () => {
  const d = new Date(2026, 9, 1, 14, 5);
  assert.equal(Core.exportFilename("当日出欠", "第48回 改善事例発表会/出欠表", d, "xlsx"), "当日出欠_第48回改善事例発表会出欠表_20261001_1405.xlsx");
  assert.equal(Core.exportFilename("受付一覧", "", d, "csv"), "受付一覧_20261001_1405.csv");
});
```

- [ ] **Step 2: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Core.buildCsv is not a function` 等で FAIL。

- [ ] **Step 3: 実装**

`uketsuke-stamp/core.js` の `formatStamp` の後に追加:

```js
  // ---------- 書き出し ----------
  function csvEscape(v) {
    return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  }

  function buildCsv(roster, checkins) {
    var header = ["氏名", "部署", "役職", "出欠席予定", "受付時刻", "受付端末", "種別", "判定"];
    var lines = [header.map(csvEscape).join(",")];
    buildRows(roster, checkins).forEach(function (r) {
      lines.push([r.name, r.dept, r.title, formatPlan(r.plan), formatStamp(r.t), r.dev, KIND_LABEL[r.kind] || r.kind, r.judge].map(csvEscape).join(","));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  var EXPORT_HEADER = ["氏名", "役職", "出欠席予定", "当日出欠席", "受付時刻", "受付端末", "判定"];

  function pasteHint(sheet) {
    if (sheet.dayCol && sheet.firstRow && sheet.lastRow) {
      return "→ 元ファイルの " + sheet.dayCol + sheet.firstRow + ":" + sheet.dayCol + sheet.lastRow + " に貼り付け";
    }
    return "→ 元ファイルの当日出欠席欄に貼り付け";
  }

  function buildExportSheets(roster, checkins, event) {
    var checked = {};
    (checkins || []).forEach(function (c) { checked[c.pid] = c; });
    var sheets = (roster.sheets || []).slice().sort(function (a, b) { return a.deptOrder - b.deptOrder; });
    var people = sortPeople(roster.people || []);
    var out = [];

    sheets.forEach(function (sheet) {
      var rows = [];
      var above = [event.title || "", event.dateText || "", event.venue || ""];
      for (var r = 0; r < sheet.headerRow - 1; r++) rows.push(above[r] ? [above[r]] : []);
      rows.push(EXPORT_HEADER.concat(["", pasteHint(sheet)]));
      people.filter(function (p) { return p.sheetName === sheet.sheetName; }).forEach(function (p) {
        while (rows.length < p.row - 1) rows.push([]);
        var c = checked[p.id];
        rows[p.row - 1] = [p.name, p.title, formatPlan(p.plan), c ? "〇" : "", c ? formatStamp(c.t) : "", c ? (c.dev || "") : "", judge(p.plan, !!c, true)];
      });
      out.push({ name: sheet.sheetName, rows: rows });
    });

    var summary = summarize(roster, checkins);
    var unlisted = [["氏名", "所属", "受付時刻", "受付端末", "種別"]];
    summary.unlisted.forEach(function (c) {
      unlisted.push([c.name, c.dept, formatStamp(c.t), c.dev || "", KIND_LABEL[c.kind] || c.kind]);
    });
    out.push({ name: "名簿外", rows: unlisted });

    var agg = [["部署", "予定〇", "受付済", "未受付", "予定外"]];
    summary.byDept.forEach(function (d) { agg.push([d.dept, d.planYes, d.checked, d.missing, d.unexpected]); });
    if (summary.unlisted.length) agg.push(["名簿外", "", summary.unlisted.length, "", summary.unlisted.length]);
    agg.push(["合計", summary.total.planYes, summary.total.checked, summary.total.missing, summary.total.unexpected]);
    out.push({ name: "集計", rows: agg });
    return out;
  }

  function toWorkbook(XLSX, sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (s) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
    });
    return wb;
  }

  function exportFilename(prefix, title, date, ext) {
    var safe = String(title || "").replace(/[^\w぀-ヿ一-鿿０-ｚ]/g, "");
    var stamp = date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "_" + pad2(date.getHours()) + pad2(date.getMinutes());
    return prefix + (safe ? "_" + safe : "") + "_" + stamp + "." + ext;
  }
```

`return { ... }` に追加:

```js
    buildCsv: buildCsv,
    buildExportSheets: buildExportSheets,
    toWorkbook: toWorkbook,
    exportFilename: exportFilename
```

- [ ] **Step 4: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 37`、`# fail 0`。

- [ ] **Step 5: コミット**

```bash
git add uketsuke-stamp/core.js uketsuke-stamp/tests/core-export.test.js
git commit -m "uketsuke-stamp: CSV and paste-back Excel export data

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: sync.js — 共有DB同期(購読・端末内キュー・再送)

**Files:**
- Create: `uketsuke-stamp/sync.js`
- Modify: `uketsuke-stamp/tests/helpers.js`(偽 DB を追加)
- Create: `uketsuke-stamp/tests/sync.test.js`

**Interfaces:**
- Consumes: Artifact `db` の `collection("checkins")` → `{ doc(id) → {set(data), delete()}, onSnapshot(next, error) → unsubscribe, get() }`
- Produces: `window.UketsukeSync` / `module.exports` = `{ SyncStore, PENDING_KEY }`
  - `new SyncStore({ db, storage, retryMs, setTimer, clearTimer })`
  - `start()` / `stop()` / `onChange(fn) → unsubscribe`
  - `checkIn(pid, data)` / `cancel(pid)` → Promise(flush 完了。失敗しても reject しない)
  - `get(pid)` → checkin | null、`has(pid)`、`all()` → checkin[](購読結果 + 未送信分を合成)
  - `pendingCount`、`ready`(最初の購読結果を受け取ったか)、`error`(購読の終端エラー)

- [ ] **Step 1: 偽 DB をヘルパに追加**

`uketsuke-stamp/tests/helpers.js` の `module.exports` の前に追加し、exports に `FakeDb` を加える:

```js
// Artifact db の checkins コレクションだけを真似た偽 DB。
// failNext を n にすると次の n 回の書込が code:"unavailable" で失敗する。
class FakeDb {
  constructor() {
    this.data = new Map();
    this.listeners = new Set();
    this.failNext = 0;
    this.writes = 0;
  }
  _maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      const e = new Error("unavailable");
      e.code = "unavailable";
      throw e;
    }
  }
  _snap() {
    const docs = Array.from(this.data.entries()).map(([id, d]) => ({ id, exists: true, data: () => d }));
    return { docs, size: docs.length, empty: docs.length === 0, docChanges: () => [] };
  }
  _notify() {
    this.listeners.forEach((l) => l.next(this._snap()));
  }
  collection(path) {
    if (path !== "checkins") throw new Error("FakeDb は checkins だけ対応: " + path);
    const self = this;
    return {
      doc(id) {
        return {
          id,
          async set(data) { self._maybeFail(); self.writes++; self.data.set(id, JSON.parse(JSON.stringify(data))); self._notify(); },
          async delete() { self._maybeFail(); self.writes++; self.data.delete(id); self._notify(); },
        };
      },
      onSnapshot(next, error) {
        const l = { next, error };
        self.listeners.add(l);
        Promise.resolve().then(() => { if (self.listeners.has(l)) next(self._snap()); });
        return () => self.listeners.delete(l);
      },
      async get() { return self._snap(); },
    };
  }
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
```

`module.exports = { XLSX, FIXTURE, loadFixture, makeSheet, makeWorkbook, m, deptSheetAoa, FakeDb, MemoryStorage };`

- [ ] **Step 2: 失敗するテストを書く**

`uketsuke-stamp/tests/sync.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SyncStore, PENDING_KEY } = require("../sync");
const { FakeDb, MemoryStorage } = require("./helpers");

const tick = () => new Promise((r) => setImmediate(r));

// 再送タイマーを手動で発火させるためのタイマー差し替え
function manualTimer() {
  const timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    fire: () => { const t = timers.shift(); if (t) t.fn(); },
    count: () => timers.length,
  };
}

function makeStore(db, opts) {
  const timer = manualTimer();
  const storage = (opts && opts.storage) || new MemoryStorage();
  const store = new SyncStore(Object.assign({ db, storage, retryMs: 5000, setTimer: timer.setTimer, clearTimer: timer.clearTimer }, opts));
  return { store, timer, storage };
}

test("start: 購読結果が records に入り、ready になる", async () => {
  const db = new FakeDb();
  db.data.set("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  const { store } = makeStore(db);
  let changes = 0;
  store.onChange(() => changes++);
  assert.equal(store.ready, false);
  store.start();
  await tick();
  assert.equal(store.ready, true);
  assert.ok(changes >= 1);
  assert.deepEqual(store.get("p1"), { pid: "p1", t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(store.has("p1"), true);
  assert.equal(store.has("p2"), false);
  store.stop();
});

test("checkIn: 書込が成功するとキューが空になり、他端末の購読にも届く", async () => {
  const db = new FakeDb();
  const a = makeStore(db);
  const b = makeStore(db);
  a.store.start(); b.store.start();
  await tick();
  await a.store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(a.store.pendingCount, 0);
  assert.equal(db.data.get("p1").dev, "受付1");
  await tick();
  assert.equal(b.store.has("p1"), true);
  assert.equal(b.store.get("p1").dev, "受付1");
  a.store.stop(); b.store.stop();
});

test("2 台が同じ ID を書いても 1 件になる", async () => {
  const db = new FakeDb();
  const a = makeStore(db);
  const b = makeStore(db);
  a.store.start(); b.store.start();
  await tick();
  await Promise.all([
    a.store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" }),
    b.store.checkIn("p1", { t: "2026-10-01T04:00:01.000Z", dev: "受付2", kind: "qr" }),
  ]);
  await tick();
  assert.equal(db.data.size, 1);
  assert.equal(a.store.all().length, 1);
  assert.equal(b.store.all().length, 1);
  a.store.stop(); b.store.stop();
});

test("書込失敗: キューに残り、has() は true、再送タイマーで復帰後に送られる", async () => {
  const db = new FakeDb();
  const { store, timer, storage } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 1;
  await store.checkIn("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  assert.equal(store.pendingCount, 1);
  assert.equal(store.has("p1"), true); // 画面上は受付済み扱い
  assert.equal(db.data.size, 0);
  assert.equal(timer.count(), 1);
  // 端末内に永続化されている
  assert.equal(JSON.parse(storage.getItem(PENDING_KEY)).length, 1);
  // 復帰
  timer.fire();
  await tick(); await tick();
  assert.equal(store.pendingCount, 0);
  assert.equal(db.data.size, 1);
  assert.equal(JSON.parse(storage.getItem(PENDING_KEY)).length, 0);
  store.stop();
});

test("再起動: 端末内に残った未送信分を start 時に送る", async () => {
  const db = new FakeDb();
  const storage = new MemoryStorage();
  storage.setItem(PENDING_KEY, JSON.stringify([{ op: "set", id: "p9", data: { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" } }]));
  const { store } = makeStore(db, { storage });
  assert.equal(store.pendingCount, 1);
  store.start();
  await tick(); await tick();
  assert.equal(store.pendingCount, 0);
  assert.equal(db.data.has("p9"), true);
  store.stop();
});

test("cancel: 削除され、未確定の間も get() は null", async () => {
  const db = new FakeDb();
  db.data.set("p1", { t: "2026-10-01T04:00:00.000Z", dev: "受付1", kind: "qr" });
  const { store } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 1;
  await store.cancel("p1");
  assert.equal(store.get("p1"), null);
  assert.equal(store.all().length, 0);
  assert.equal(db.data.has("p1"), true); // まだサーバには残っている
  store.stop();
});

test("同じ ID への操作はキュー内で最後の 1 件にまとまる", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  store.start();
  await tick();
  db.failNext = 5;
  await store.checkIn("p1", { t: "a", dev: "受付1", kind: "qr" });
  await store.cancel("p1");
  await store.checkIn("p1", { t: "b", dev: "受付1", kind: "manual" });
  assert.equal(store.pendingCount, 1);
  assert.equal(store.get("p1").kind, "manual");
  store.stop();
});

test("購読エラーは error に入り onChange が呼ばれる", async () => {
  const db = new FakeDb();
  const { store } = makeStore(db);
  let notified = 0;
  store.onChange(() => notified++);
  store.start();
  await tick();
  const l = Array.from(db.listeners)[0];
  l.error({ code: "revoked", message: "gone" });
  assert.equal(store.error.code, "revoked");
  assert.ok(notified >= 2);
  store.stop();
});
```

- [ ] **Step 3: 失敗を確認**

```bash
cd uketsuke-stamp && npm test
```

Expected: `Cannot find module '../sync'` で FAIL。

- [ ] **Step 4: sync.js を実装**

`uketsuke-stamp/sync.js`:

```js
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

  SyncStore.prototype.flush = async function () {
    if (this.flushing) return;
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
        this.pending.shift();
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
```

- [ ] **Step 5: テスト実行**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 45`、`# fail 0`。

- [ ] **Step 6: コミット**

```bash
git add uketsuke-stamp/sync.js uketsuke-stamp/tests/sync.test.js uketsuke-stamp/tests/helpers.js
git commit -m "uketsuke-stamp: SyncStore with local pending queue and retry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: index.html と app.js(共通状態・ランタイム接続)と開発用シム

**Files:**
- Create: `uketsuke-stamp/index.html`
- Create: `uketsuke-stamp/app.js`
- Create: `uketsuke-stamp/tests/dev-shim.js`(ブラウザ用の偽 `window.claude`。localStorage に保存し、別タブにも反映)
- Create: `uketsuke-stamp/tests/dev.html`(シム + 本番ファイルを読み込むローカル確認用ページ)

**Interfaces:**
- Consumes: `window.UketsukeCore`(Task 2〜6)、`window.UketsukeSync`(Task 7)、`window.claude.use("db" | "downloads")`
- Produces: `window.App` =
  - `state`: `{ runtimeReady, db, downloads, event, eventLoaded, rosterDoc, roster, key, keySalt, keyStatus: "none"|"checking"|"ok"|"bad", store, walkinNames }`
  - `tabs`: 各タブが `App.tabs.<name> = { init(), render(state), hide?() }` を登録する
  - `onChange(fn)`, `emit()`, `toast(msg)`, `el(tag, attrs, children)`(attrs: `class` / `text` / `onClick` / `hidden` / `disabled` / その他は属性。children の null は無視)、`clear(node)`(子要素を全部消す)
  - `checkins()` → 飛び入りの氏名を復号済みで合成した checkin 配列
  - `applyKey(passphrase)` → Promise<boolean>、`forgetKey()`、`adoptKey(passphrase, key, salt)`
  - `saveFile(filename, data)` → Promise
  - `writeErrorMessage(err)` → 文字列
  - `selectTab(name)`, `boot()`
  - `storageGet(k)`, `storageSet(k, v)`, `storageRemove(k)`, `KEYS`
- 画面 ID(タブ側が参照する): タブ本体 `#panel-kanji` / `#panel-uketsuke` / `#panel-status`、ヘッダの `#headEvent`、`#toast`。各タブ内の ID は Task 9〜11 の HTML に書いてある

- [ ] **Step 1: index.html を書く**

Artifact は公開時に `<!doctype html><html><head>…</head><body>` で包まれるので、`<title>` と `<style>` から書き始める(doctype / html / head / body タグは書かない)。

`uketsuke-stamp/index.html`:

```html
<title>受付スタンプ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js"></script>
<style>
  :root {
    --bg: #F6F5F1; --surface: #FFFFFF; --ink: #202A3B; --ink-soft: #626B7C; --ink-faint: #9298A6;
    --accent: #B8392F; --accent-ink: #7A241D; --accent-soft: #F4DEDA; --border: #DEDBD1;
    --success: #3C6E52; --success-soft: #DCEBE1; --warn: #A66A00; --warn-soft: #F7EBD0;
    --radius-s: 6px; --radius-m: 10px;
    --font: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #14181F; --surface: #1D2330; --ink: #EDEFF3; --ink-soft: #A7AEBC; --ink-faint: #6E7686;
      --accent: #E0776C; --accent-ink: #F3B4AC; --accent-soft: #3A2523; --border: #303645;
      --success: #6FBE93; --success-soft: #1E3329; --warn: #E0B25A; --warn-soft: #3A2F18;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14181F; --surface: #1D2330; --ink: #EDEFF3; --ink-soft: #A7AEBC; --ink-faint: #6E7686;
    --accent: #E0776C; --accent-ink: #F3B4AC; --accent-soft: #3A2523; --border: #303645;
    --success: #6FBE93; --success-soft: #1E3329; --warn: #E0B25A; --warn-soft: #3A2F18;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: var(--font); font-size: 14px; -webkit-tap-highlight-color: transparent; }
  body { min-height: 100vh; padding-bottom: 48px; }
  a { color: inherit; }
  [hidden] { display: none !important; }

  header.app-head { padding: 18px 16px 12px; border-bottom: 1px solid var(--border); background: var(--surface); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand .stamp-mark { width: 34px; height: 34px; border: 2.5px solid var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--accent); font-weight: 800; font-size: 13px; flex-shrink: 0; transform: rotate(-8deg); }
  h1 { font-size: 19px; font-weight: 700; margin: 0; letter-spacing: 0.01em; }
  .brand-sub { font-size: 12px; color: var(--ink-faint); margin: 4px 0 0 44px; min-height: 1.4em; }

  nav.tabs { display: flex; max-width: 680px; margin: 14px auto 0; padding: 0 16px; gap: 8px; }
  .tab-btn { flex: 1; padding: 11px 6px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft); border-radius: 999px; font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer; }
  .tab-btn.active { background: var(--ink); border-color: var(--ink); color: var(--surface); }

  main { max-width: 680px; margin: 16px auto 0; padding: 0 16px; }
  .panel { display: none; }
  .panel.active { display: block; }

  section.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-m); padding: 16px; margin-bottom: 14px; }
  section.card.danger { border-color: var(--accent); }
  section.card h2 { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
  .card-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 12px; }
  .hint { font-size: 11.5px; color: var(--ink-faint); margin-top: 6px; line-height: 1.5; }
  .note { font-size: 13px; color: var(--ink-soft); line-height: 1.6; }

  label.field { display: block; font-size: 12px; color: var(--ink-soft); margin-bottom: 10px; }
  label.field input { margin-top: 4px; }
  input[type=text], input[type=password], input[type=search] { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-s); padding: 10px 12px; font-family: var(--font); font-size: 14px; color: var(--ink); background: var(--bg); }
  input[type=file] { font-family: var(--font); font-size: 13px; max-width: 100%; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .field-row { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .field-row input { flex: 1; min-width: 120px; }
  .radio-row { display: flex; gap: 16px; margin: 8px 0 4px; font-size: 13px; }

  button.btn { font-family: var(--font); font-size: 14px; font-weight: 600; border-radius: var(--radius-s); padding: 11px 18px; border: 1px solid var(--ink); background: var(--ink); color: var(--surface); cursor: pointer; }
  button.btn:active { opacity: 0.75; }
  button.btn.primary { background: var(--accent); border-color: var(--accent); }
  button.btn.ghost { background: transparent; color: var(--ink); }
  button.btn.small { padding: 7px 12px; font-size: 12.5px; }
  button.btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

  table.simple { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  table.simple th, table.simple td { padding: 6px 6px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
  table.simple th:first-child, table.simple td:first-child { text-align: left; white-space: normal; }
  table.simple th { color: var(--ink-soft); font-weight: 600; }
  table.simple tr.total td { font-weight: 700; }
  table.simple tr.clickable { cursor: pointer; }
  table.simple tr.detail td { text-align: left; white-space: normal; color: var(--ink-soft); font-size: 12px; background: var(--bg); }
  .table-wrap { overflow-x: auto; }
  ul.warnings { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--warn); }

  .qr-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 16px; }
  .qr-tag { border: 1px dashed var(--border); border-radius: var(--radius-s); padding: 10px; text-align: center; break-inside: avoid; }
  .qr-tag .qr-box { display: flex; justify-content: center; margin-bottom: 6px; }
  .qr-tag .tag-name { font-size: 14px; font-weight: 700; }
  .qr-tag .tag-dept { font-size: 11px; color: var(--ink-soft); margin-top: 1px; }

  .scan-frame { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 380px; background: #0B0E13; border-radius: var(--radius-m); overflow: hidden; }
  .scan-frame video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .scan-frame .corners::before, .scan-frame .corners::after { content: ""; position: absolute; width: 34px; height: 34px; border: 3px solid rgba(255,255,255,0.85); }
  .scan-frame .corner-tl { top: 22px; left: 22px; border-right: none; border-bottom: none; }
  .scan-frame .corner-br { bottom: 22px; right: 22px; border-left: none; border-top: none; }
  .scan-frame .idle-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #C7CCD6; font-size: 13px; text-align: center; padding: 20px; }
  .stamp-flash { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; opacity: 0; }
  .stamp-flash.show { animation: stampIn 1100ms ease forwards; }
  @keyframes stampIn {
    0% { opacity: 0; transform: scale(1.8) rotate(-18deg); }
    15% { opacity: 1; transform: scale(1) rotate(-10deg); }
    75% { opacity: 1; transform: scale(1) rotate(-10deg); }
    100% { opacity: 0; transform: scale(1) rotate(-10deg); }
  }
  .stamp-flash .ring { border: 5px solid var(--accent); color: var(--accent); border-radius: 50%; width: 140px; height: 140px; display: flex; align-items: center; justify-content: center; flex-direction: column; background: rgba(11,14,19,0.6); }
  .stamp-flash .ring .kanji { font-size: 26px; font-weight: 800; letter-spacing: 0.15em; }
  .stamp-flash .ring .who { font-size: 12px; margin-top: 4px; color: #F1D9D6; max-width: 110px; text-align: center; line-height: 1.3; white-space: pre-line; }
  .stamp-flash.dup .ring { border-color: #B9BEC8; color: #B9BEC8; }
  .stamp-flash.unknown .ring { border-color: #E0B25A; color: #E0B25A; }

  .counter-strip { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 6px; }
  .counter-strip .count-num { font-size: 28px; font-weight: 800; }
  .counter-strip .count-label { font-size: 12px; color: var(--ink-soft); }
  .badge { font-size: 11.5px; padding: 3px 10px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-weight: 600; }
  .badge.ok { background: var(--success-soft); color: var(--success); }

  ul.checkin-list, ul.people-list { list-style: none; margin: 0; padding: 0; }
  ul.checkin-list li, ul.people-list li { display: flex; align-items: center; gap: 8px; padding: 10px 2px; border-bottom: 1px solid var(--border); font-size: 13.5px; }
  ul.checkin-list li:last-child, ul.people-list li:last-child { border-bottom: none; }
  .ci-name { font-weight: 600; }
  .ci-dept { color: var(--ink-soft); font-size: 12px; }
  .ci-meta { color: var(--ink-faint); font-size: 12px; margin-left: auto; text-align: right; white-space: nowrap; }
  .ci-undo { background: none; border: none; color: var(--ink-faint); font-size: 12px; cursor: pointer; text-decoration: underline; font-family: var(--font); }
  ul.people-list li { cursor: pointer; }
  ul.people-list li.done { opacity: 0.55; cursor: default; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg); color: var(--ink-soft); border: 1px solid var(--border); }
  .pill.yes { background: var(--success-soft); color: var(--success); border-color: transparent; }
  .pill.done { background: var(--accent-soft); color: var(--accent-ink); border-color: transparent; }
  .empty-note { color: var(--ink-faint); font-size: 12.5px; padding: 14px 2px; }

  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .tile { background: var(--bg); border-radius: var(--radius-s); padding: 10px 8px; text-align: center; }
  .tile .num { font-size: 22px; font-weight: 800; }
  .tile .lbl { font-size: 11px; color: var(--ink-soft); }
  .tile.accent .num { color: var(--accent); }
  @media (max-width: 420px) { .tiles { grid-template-columns: repeat(2, 1fr); } }

  .gate { text-align: center; padding: 10px 0; }
  .gate p { margin: 0 0 12px; color: var(--ink-soft); }
  .gate .field-row { justify-content: center; }
  .status-line { font-size: 12.5px; color: var(--ink-soft); margin-top: 8px; }
  .status-line.bad { color: var(--accent); }

  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(12px); background: var(--ink); color: var(--surface); padding: 10px 18px; border-radius: 999px; font-size: 13px; opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s; z-index: 50; max-width: 86%; text-align: center; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media print {
    header.app-head, nav.tabs, .no-print { display: none !important; }
    body { background: #fff; }
    main { max-width: none; margin: 0; padding: 0; }
    .panel { display: none !important; }
    #panel-kanji { display: block !important; }
    #panel-kanji section.card { display: none; border: none; padding: 0; }
    #panel-kanji section.card.qr-card { display: block; }
    #panel-kanji section.card.qr-card > :not(.qr-grid) { display: none; }
    .qr-grid { grid-template-columns: repeat(3, 1fr); }
  }
</style>

<header class="app-head">
  <div class="brand">
    <div class="stamp-mark">印</div>
    <h1>受付スタンプ</h1>
  </div>
  <p class="brand-sub" id="headEvent">社内イベント出欠のその場デジタル受付</p>
</header>

<nav class="tabs no-print">
  <button class="tab-btn" data-tab="kanji">幹事</button>
  <button class="tab-btn" data-tab="uketsuke">受付</button>
  <button class="tab-btn" data-tab="status">状況</button>
</nav>

<main>
  <!-- ===== 幹事タブ(Task 9 で中身を追加) ===== -->
  <div class="panel" id="panel-kanji"></div>

  <!-- ===== 受付タブ(Task 10 で中身を追加) ===== -->
  <div class="panel" id="panel-uketsuke"></div>

  <!-- ===== 状況タブ(Task 11 で中身を追加) ===== -->
  <div class="panel" id="panel-status"></div>
</main>

<div class="toast" id="toast"></div>

<script src="core.js"></script>
<script src="sync.js"></script>
<script src="app.js"></script>
<script src="tab-kanji.js"></script>
<script src="tab-uketsuke.js"></script>
<script src="tab-status.js"></script>
<script>App.boot();</script>
```

- [ ] **Step 2: app.js を書く**

`uketsuke-stamp/app.js`:

```js
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
```

- [ ] **Step 3: 開発用シム(偽 window.claude)と dev.html**

公開前にブラウザで全フローを確認するため、`db` と `downloads` を localStorage で真似るシムを置く。同じブラウザの別タブにも `storage` イベントで反映されるので「受付 2 台」を再現できる。

`uketsuke-stamp/tests/dev-shim.js`:

```js
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
```

`uketsuke-stamp/tests/dev.html`(`index.html` の中身をそのまま使い、先頭でシムを読み込む):

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="../">
<script src="tests/dev-shim.js"></script>
<script>
  // index.html を読み込んで body に流し込む(script は順に実行し直す)
  fetch("index.html").then(function (r) { return r.text(); }).then(function (html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    Array.prototype.slice.call(doc.head.childNodes).forEach(function (n) { if (n.tagName !== "SCRIPT") document.head.appendChild(document.importNode(n, true)); });
    var scripts = [];
    Array.prototype.slice.call(doc.querySelectorAll("script")).forEach(function (s) { scripts.push({ src: s.getAttribute("src"), text: s.textContent }); s.remove(); });
    Array.prototype.slice.call(doc.body.childNodes).forEach(function (n) { document.body.appendChild(document.importNode(n, true)); });
    (function runNext(i) {
      if (i >= scripts.length) return;
      var s = document.createElement("script");
      if (scripts[i].src) { s.src = scripts[i].src; s.onload = function () { runNext(i + 1); }; }
      else { s.textContent = scripts[i].text; }
      document.body.appendChild(s);
      if (!scripts[i].src) runNext(i + 1);
    })(0);
  });
</script>
</head>
<body></body>
</html>
```

`fetch` を使うので `file://` では動かない。確認時は `uketsuke-stamp/` を静的サーバで開く。`.claude/launch.json` に次を追加する:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "uketsuke-dev",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["--yes", "serve@14", "-l", "8765", "uketsuke-stamp"],
      "port": 8765
    }
  ]
}
```

(既に `.claude/launch.json` がある場合は `configurations` に追加する)

- [ ] **Step 4: ブラウザで骨組みを確認**

`preview_start`(name: `uketsuke-dev`)で起動し `http://localhost:8765/tests/dev.html` を開く。

Expected:
- ヘッダ「受付スタンプ」と 3 つのタブが表示され、タブをクリックすると `.panel.active` が切り替わる(中身はまだ空)
- コンソールにエラーが無い(`App.state.runtimeReady === true`、`App.state.db` がシムのオブジェクト)
- `localStorage.getItem("uketsuke_tab_v2")` に最後に押したタブ名が入る

- [ ] **Step 5: 自動テストが壊れていないことを確認してコミット**

```bash
cd uketsuke-stamp && npm test
```

Expected: `# pass 45`、`# fail 0`。

```bash
git add uketsuke-stamp/index.html uketsuke-stamp/app.js uketsuke-stamp/tests/dev-shim.js uketsuke-stamp/tests/dev.html .claude/launch.json
git commit -m "uketsuke-stamp: page shell, shared app state and dev shim for local runs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 幹事タブ(tab-kanji.js)

**Files:**
- Modify: `uketsuke-stamp/index.html`(`#panel-kanji` の中身)
- Create: `uketsuke-stamp/tab-kanji.js`

**Interfaces:**
- Consumes: `App`(Task 8)、`UketsukeCore.parseWorkbook / randomSaltB64 / deriveKey / makeCheck / assignIds / encryptJson / rosterDiff / sortPeople / buildCsv / buildExportSheets / toWorkbook / exportFilename`、`XLSX`(cdnjs)、`QRCode`(cdnjs)
- Produces: `App.tabs.kanji = { init(), render(state) }`

- [ ] **Step 1: index.html の `#panel-kanji` を埋める**

`<div class="panel" id="panel-kanji"></div>` を次に置き換える:

```html
  <div class="panel" id="panel-kanji">
    <section class="card">
      <h2>1. イベント設定</h2>
      <p class="card-desc">Excel を取り込むと自動で入ります。必要なら書き換えてから保存してください。</p>
      <label class="field">イベント名<input type="text" id="evTitle"></label>
      <label class="field">日時<input type="text" id="evDate"></label>
      <label class="field">会場<input type="text" id="evVenue"></label>
      <div id="passSetup">
        <label class="field">パスフレーズ(4文字以上。受付端末で入力します)<input type="password" id="passNew" autocomplete="new-password"></label>
        <label class="field">パスフレーズ(確認)<input type="password" id="passNew2" autocomplete="new-password"></label>
        <p class="hint">名簿はこのパスフレーズで暗号化して共有DBに保存します。後から変更はできません(変えると印刷済みQRが無効になるため)。変えたい場合は「新しいイベントを開始」してください。</p>
      </div>
      <p class="status-line" id="passStatus" hidden>パスフレーズ: 設定済み</p>
      <div id="kanjiUnlock" hidden>
        <p class="note">この端末にはパスフレーズが保存されていません。名簿の再取込・QR発行・書き出しにはパスフレーズが必要です。</p>
        <div class="field-row">
          <input type="password" id="kanjiPass" placeholder="パスフレーズ" autocomplete="current-password">
          <button class="btn small" id="kanjiUnlockBtn">確認</button>
        </div>
        <p class="status-line bad" id="kanjiUnlockMsg" hidden></p>
      </div>
    </section>

    <section class="card">
      <h2>2. 名簿を取り込む</h2>
      <p class="card-desc">部署ごとにシートが分かれた出欠表(.xlsx / .xlsm)を選んでください。ファイルの中身はこの端末内で解析され、氏名は暗号化してから共有DBに保存されます。</p>
      <input type="file" id="xlsxFile" accept=".xlsx,.xlsm,.xls">
      <div id="importPreview" hidden>
        <div class="table-wrap"><table class="simple" id="previewTable"></table></div>
        <ul class="warnings" id="previewWarnings"></ul>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="saveRosterBtn" disabled>名簿を共有DBに保存</button>
      </div>
      <p class="hint" id="rosterInfo">共有DBの名簿: 未登録</p>
    </section>

    <section class="card qr-card">
      <h2>3. QRコードを発行</h2>
      <p class="card-desc">QRには参加者IDだけを埋め込みます(氏名は入りません)。切り取って名札などに添付してください。</p>
      <div class="radio-row">
        <label><input type="radio" name="qrTarget" value="yes" checked> 予定〇の人のみ</label>
        <label><input type="radio" name="qrTarget" value="all"> 全員</label>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="genQrBtn">QRを生成</button>
        <button class="btn" id="printBtn" hidden>印刷する</button>
      </div>
      <div class="qr-grid" id="qrGrid"></div>
    </section>

    <section class="card">
      <h2>4. 書き出し</h2>
      <p class="card-desc">全端末分の受付記録をまとめて書き出します。Excel は元の出欠表と同じシート構成で、「当日出欠席」列をそのまま貼り付けられます。</p>
      <div class="btn-row">
        <button class="btn" id="exportCsvBtn">CSV(受付一覧)</button>
        <button class="btn" id="exportXlsxBtn">Excel(当日出欠)</button>
      </div>
    </section>

    <section class="card danger">
      <h2>新しいイベントを開始</h2>
      <p class="card-desc">イベント設定・名簿・全端末の受付記録を共有DBから削除します。先に書き出しを済ませてください。</p>
      <div class="btn-row">
        <button class="btn ghost" id="resetBtn">すべて削除して新しいイベントを開始</button>
      </div>
    </section>
  </div>
```

- [ ] **Step 2: tab-kanji.js を書く**

`uketsuke-stamp/tab-kanji.js`:

```js
/* 幹事タブ: イベント設定・名簿取込・QR発行・書き出し・リセット */
App.tabs.kanji = (function () {
  "use strict";
  var Core = window.UketsukeCore;
  var $ = function (id) { return document.getElementById(id); };
  var parsed = null; // 直近に取り込んだ parseWorkbook の結果
  var saving = false;

  function init() {
    ["evTitle", "evDate", "evVenue"].forEach(function (id) {
      $(id).addEventListener("input", function () { $(id).dataset.dirty = "1"; });
    });
    $("xlsxFile").addEventListener("change", onFileChosen);
    $("saveRosterBtn").addEventListener("click", saveRoster);
    $("kanjiUnlockBtn").addEventListener("click", unlock);
    $("kanjiPass").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
    $("genQrBtn").addEventListener("click", generateQr);
    $("printBtn").addEventListener("click", function () { window.print(); });
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
      if (!confirm("共有DBの名簿を上書きします。\n追加 " + d.added + " 名 / 削除 " + d.removed + " 名 / 変更 " + d.changed + " 名\n受付記録はそのまま残ります。よろしいですか?")) {
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
    App.toast(people.length + " 件のQRコードを生成しました");
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
    var typed = prompt("イベント設定・名簿・全端末の受付記録を共有DBから削除します。\n続行するには「削除」と入力してください。");
    if (typed !== "削除") return;
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
```

- [ ] **Step 3: ブラウザで確認(dev.html)**

`http://localhost:8765/tests/dev.html` を開き、幹事タブで:

1. `tests/fixtures/sample-出欠表.xlsx` を選ぶ → プレビュー表に 30 行 + 合計 308 / 102 / 30 / 176、警告なし。イベント名・日時・会場が自動入力される
2. パスフレーズ `test1234` を 2 回入力 → 「名簿を共有DBに保存」→ トースト「名簿を保存しました(308 名)」。`rosterInfo` が「共有DBの名簿: 308 名(版 1)」になる。`passSetup` が消え `passStatus` が出る
3. 「QRを生成」(予定〇のみ)→ 102 枚のカードが並ぶ。「全員」に切り替えて生成 → 308 枚
4. 「CSV」→ ヘッダのみの CSV がダウンロードされる(受付 0 件)。「Excel」→ 32 シート(30 部署 + 名簿外 + 集計)の xlsx がダウンロードされる
5. 同じファイルをもう一度選んで保存 → 「追加 0 / 削除 0 / 変更 0」の確認ダイアログ → 版 2 になる
6. 別タブで dev.html を開く → `kanjiUnlock` が出ない(localStorage にパスフレーズが保存されているため)。コンソールで `localStorage.removeItem("uketsuke_pass_v2")` してから再読込 → `kanjiUnlock` が出る → 間違ったパスフレーズで「パスフレーズが違います」、正しいもので消える
7. 「すべて削除して新しいイベントを開始」→ `削除` と入力 → 初期状態に戻る

- [ ] **Step 4: コミット**

```bash
cd uketsuke-stamp && npm test
git add uketsuke-stamp/index.html uketsuke-stamp/tab-kanji.js
git commit -m "uketsuke-stamp: organizer tab (Excel import, encrypted roster, QR, export, reset)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 受付タブ(tab-uketsuke.js)

**Files:**
- Modify: `uketsuke-stamp/index.html`(`#panel-uketsuke` の中身)
- Create: `uketsuke-stamp/tab-uketsuke.js`

**Interfaces:**
- Consumes: `App`(Task 8)、`App.state.store`(`SyncStore`: `has / get / checkIn / cancel / all / pendingCount / ready`)、`UketsukeCore.summarize / searchPeople / buildRows / walkinId / encryptJson / formatPlan / formatClock / formatTime / KIND_LABEL`、`jsQR`(cdnjs)
- Produces: `App.tabs.uketsuke = { init(), render(state), hide() }`(`hide()` はタブを離れた時にカメラを止める)

- [ ] **Step 1: index.html の `#panel-uketsuke` を埋める**

`<div class="panel" id="panel-uketsuke"></div>` を次に置き換える:

```html
  <div class="panel" id="panel-uketsuke">
    <section class="card gate" id="gateCard">
      <p id="gateMsg">読み込み中…</p>
      <div id="gateForm" hidden>
        <div class="field-row">
          <input type="password" id="gatePass" placeholder="パスフレーズ" autocomplete="current-password">
          <button class="btn primary small" id="gateBtn">入力</button>
        </div>
        <p class="status-line bad" id="gateErr" hidden>パスフレーズが違います</p>
      </div>
    </section>

    <div id="uketsukeMain" hidden>
      <section class="card">
        <div class="counter-strip">
          <div>
            <span class="count-num" id="cntChecked">0</span>
            <span class="count-label"> 名受付 / 予定〇 <span id="cntPlan">0</span> 名</span>
          </div>
          <span class="badge" id="pendingBadge" hidden>未送信 0 件</span>
        </div>
        <label class="field">端末名(集計時の区別用)<input type="text" id="deviceLabel" placeholder="例: 受付1"></label>

        <div class="scan-frame" id="scanFrame">
          <video id="video" playsinline muted></video>
          <div class="corners corner-tl"></div>
          <div class="corners corner-br"></div>
          <div class="idle-msg" id="idleMsg">「スキャン開始」を押してカメラを起動してください</div>
          <div class="stamp-flash" id="stampFlash">
            <div class="ring">
              <div class="kanji" id="stampKanji">受付</div>
              <div class="who" id="stampWho"></div>
            </div>
          </div>
        </div>
        <canvas id="canvas" hidden></canvas>
        <div class="btn-row">
          <button class="btn primary" id="scanToggleBtn">スキャン開始</button>
        </div>
      </section>

      <section class="card">
        <h2>名簿から受付</h2>
        <p class="card-desc">QRが読めない・持っていない人はここで検索してタップしてください。</p>
        <input type="search" id="searchInput" placeholder="氏名の一部 または 部署名">
        <ul class="people-list" id="searchResults"></ul>
        <p class="hint" id="searchHint"></p>
      </section>

      <section class="card">
        <h2>飛び入り(名簿にない人)</h2>
        <div class="field-row">
          <input type="text" id="walkinName" placeholder="氏名">
          <input type="text" id="walkinDept" placeholder="所属(任意)">
          <button class="btn small" id="walkinAddBtn">追加</button>
        </div>
        <p class="hint">氏名・所属は暗号化して保存されます。</p>
      </section>

      <section class="card">
        <h2>この端末の受付履歴</h2>
        <ul class="checkin-list" id="myHistory"></ul>
        <div class="empty-note" id="myHistoryEmpty">まだ受付記録がありません。</div>
        <div class="btn-row">
          <button class="btn ghost small" id="forgetKeyBtn">この端末からパスフレーズを忘れる</button>
        </div>
      </section>
    </div>
  </div>
```

- [ ] **Step 2: tab-uketsuke.js を書く**

`uketsuke-stamp/tab-uketsuke.js`:

```js
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

    $("scanToggleBtn").addEventListener("click", function () { if (scanning) stopScanning(); else startScanning(); });
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

  async function startScanning() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      App.toast("カメラを起動できませんでした。ブラウザの権限設定をご確認ください。");
      return;
    }
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
      flashStamp("dup", p.name + "\n" + describeExisting(existing));
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
```

- [ ] **Step 3: ブラウザで確認(dev.html、2 タブで受付 2 台を再現)**

前提: Task 9 の手順で名簿(fixture)を保存済み、パスフレーズ `test1234`。

1. タブ A で受付タブを開く → 保存済みパスフレーズで自動解錠され、カウンター「0 名受付 / 予定〇 102 名」が出る。端末名に `受付1` を入力
2. コンソールで `localStorage.removeItem("uketsuke_pass_v2")` → 新しいタブ B で dev.html を開き受付タブへ → パスフレーズ入力欄が出る。`wrong` → 「パスフレーズが違います」、`test1234` → 受付画面。端末名 `受付2`
3. タブ A: 検索欄に `試験　001` → 候補 1 件(予定〇/×/未のピルが出る)→ タップ → 確認 → スタンプ演出、履歴に 1 件、カウンター 1。タブ B のカウンターも 1 になる
4. タブ B: 同じ人を検索 → `done` 表示(受付済 HH:MM)でタップしても反応しない
5. タブ B: 飛び入り「飛入　花子」「外部」を追加 → タブ B の履歴に 1 件、タブ A のカウンターは 2。タブ A でも(状況タブ後述)氏名が復号されて見える
6. タブ A: 履歴の「取消」→ カウンターが両タブとも 1 に戻る
7. QR 読取のロジックはコンソールから確認する: `App.tabs.uketsuke._decode("RS2:" + App.state.roster.people[5].id)` → 「受付」スタンプと氏名、カウンター +1。同じ呼び出しをもう一度(2.5 秒以上あけて)→ 「済」+「HH:MM 受付1 で受付済み」。`App.tabs.uketsuke._decode("RS2:zzzz")` → 「?」+ トースト「名簿にないQRです」。`App.tabs.uketsuke._decode("hello")` → 「対応外のQR」
8. カメラ: `preview` のブラウザでは起動できない場合がある。「スキャン開始」を押してトースト「カメラを起動できませんでした…」が出ればエラー処理は動いている

- [ ] **Step 4: コミット**

```bash
cd uketsuke-stamp && npm test
git add uketsuke-stamp/index.html uketsuke-stamp/tab-uketsuke.js
git commit -m "uketsuke-stamp: reception tab (passphrase gate, scanner, roster search, walk-ins)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 状況タブ(tab-status.js)

**Files:**
- Modify: `uketsuke-stamp/index.html`(`#panel-status` の中身)
- Create: `uketsuke-stamp/tab-status.js`

**Interfaces:**
- Consumes: `App`(Task 8)、`UketsukeCore.summarize / buildRows / formatTime / KIND_LABEL`
- Produces: `App.tabs.status = { init(), render(state) }`

- [ ] **Step 1: index.html の `#panel-status` を埋める**

`<div class="panel" id="panel-status"></div>` を次に置き換える:

```html
  <div class="panel" id="panel-status">
    <section class="card gate" id="statusGate">
      <p id="statusGateMsg">読み込み中…</p>
    </section>

    <div id="statusMain" hidden>
      <section class="card">
        <div class="tiles">
          <div class="tile accent"><div class="num" id="tChecked">0</div><div class="lbl">受付済</div></div>
          <div class="tile"><div class="num" id="tPlan">0</div><div class="lbl">予定〇</div></div>
          <div class="tile"><div class="num" id="tMissing">0</div><div class="lbl">未受付</div></div>
          <div class="tile"><div class="num" id="tUnexpected">0</div><div class="lbl">予定外出席</div></div>
        </div>
        <p class="hint" id="statusUpdated"></p>
      </section>

      <section class="card">
        <h2>部署別</h2>
        <p class="card-desc">行をタップすると未受付の人が表示されます。</p>
        <div class="table-wrap"><table class="simple" id="deptTable"></table></div>
      </section>

      <section class="card">
        <h2>受付履歴(全端末)</h2>
        <ul class="checkin-list" id="allHistory"></ul>
        <div class="empty-note" id="allHistoryEmpty">まだ受付記録がありません。</div>
      </section>
    </div>
  </div>
```

- [ ] **Step 2: tab-status.js を書く**

`uketsuke-stamp/tab-status.js`:

```js
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
```

- [ ] **Step 3: ブラウザで確認(dev.html)**

1. 受付を数件行った状態で状況タブ → タイル(受付済 / 予定〇 / 未受付 / 予定外出席)が受付タブのカウンターと整合する。`予定外出席` には「予定 × / 未回答で受付した人 + 飛び入り」が入る
2. 部署別の行をタップ → 未受付者の氏名が展開される。もう一度タップで閉じる
3. 別タブで受付すると、操作していないタブの状況も数秒以内に更新される
4. 履歴の「取消」→ タイルと部署別が減る
5. 幹事タブで Excel 書き出し → 「集計」シートの数字が状況タブのタイルと一致する

- [ ] **Step 4: コミット**

```bash
cd uketsuke-stamp && npm test
git add uketsuke-stamp/index.html uketsuke-stamp/tab-status.js
git commit -m "uketsuke-stamp: live status tab (summary, per-department, history)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: README・Artifact への公開・公開後の確認

**Files:**
- Create: `uketsuke-stamp/README.md`
- Publish: `uketsuke-stamp/index.html` + 補助 6 ファイル → 既存 Artifact `https://claude.ai/artifact/TyjKsZTTPJA9mtbhiD7Piy`

**Interfaces:**
- Consumes: Task 8〜11 の全ファイル
- Produces: 公開済み Artifact(URL は現行のまま)

- [ ] **Step 1: README.md を書く**

`uketsuke-stamp/README.md`:

```markdown
# 受付スタンプ(社内イベント出欠管理)

社内イベントの受付を、印刷した QR コードとスマホのカメラで行うアプリです。
claude.ai の Artifact として公開し、受付端末は URL を開くだけで使えます。

- 公開 URL: https://claude.ai/artifact/TyjKsZTTPJA9mtbhiD7Piy
- 設計書: `docs/superpowers/specs/2026-09-16-uketsuke-stamp-upgrade-design.md`

## しくみ(個人情報の扱い)

- 名簿(氏名・部署・役職)は幹事の PC 内で Excel から読み取り、**イベント用パスフレーズで暗号化してから**共有DB(Artifact の db 機能)に保存します
- 共有DBに平文で入るのは「参加者ID(ハッシュ)・受付時刻・端末名・イベント名/日時/会場」だけです
- QR コードには参加者IDだけを入れます(氏名は入りません)
- 共有DBは同じ claude.ai 組織にサインインした人しかアクセスできません

## 権限

| 共有設定 | できること |
|---|---|
| 編集可(幹事) | 名簿取込・QR発行・書き出し・新しいイベントの開始 + 受付 |
| 閲覧可(受付担当) | 受付(スキャン・名簿検索・飛び入り・取消)・状況の閲覧 |

## 毎回のイベントで行うこと

1. **幹事**: 幹事タブ「新しいイベントを開始」で前回分を消去(消す前に CSV / Excel を書き出して保管)
2. **幹事**: 出欠表 Excel を選び、パスフレーズを決めて「名簿を共有DBに保存」
   - 部署ごとにシートが分かれ、見出し行に「氏名」「役職」「出欠席予定」がある形式なら列の位置は問いません
   - 集計途中でも取り込めます。確定後に同じ操作で再取込すると名簿だけ更新されます(印刷済み QR はそのまま使えます)
3. **幹事**: 「QRを生成」(予定〇のみ)→「印刷する」→ 切り取って名札などに添付
4. **受付担当**: 各端末で URL を開き、受付タブでパスフレーズと端末名(受付1〜)を入力
5. **当日**: 受付タブ「スキャン開始」で QR を読む。読めない人は「名簿から受付」で検索、名簿にない人は「飛び入り」
   - 電波が弱くても受付は続けられます(「未送信 n 件」は復帰後に自動送信)
   - 状況タブで全端末の合計・部署別・未受付者が見えます
6. **終了後**: 幹事タブ「Excel(当日出欠)」を書き出し、各部署シートの「当日出欠席」列(D 列)を元の出欠表の当日出欠席欄に貼り付け。「CSV(受付一覧)」は受付順の一覧です

## 幹事が変わるとき

### 担当者が変わる(Artifact の所有者は同じ)

- 所有者が新しい幹事にこの Artifact を「編集可」で共有するだけです
- パスフレーズはイベントごとに新しく決めるので、前任者から引き継ぐ必要はありません(イベント途中の交代時のみ口頭で伝える)
- 別の PC で開いた場合は幹事タブでパスフレーズを入力すれば続きから操作できます

### Artifact の所有者が変わる(異動・退職など)

Artifact の所有権は移せないため、後任者が自分の Artifact として再公開します。

1. このリポジトリを取得し、Claude Code で `uketsuke-stamp/` のあるディレクトリを開く
2. Claude Code に次のように依頼する:

   > `uketsuke-stamp/index.html` を Artifact として公開してください。補助ファイルは `core.js` `sync.js` `app.js` `tab-kanji.js` `tab-uketsuke.js` `tab-status.js`(root は `uketsuke-stamp`)。capabilities は `{ "db": { "rules": [ { "path": "", "read": "interact", "write": "admin" }, { "path": "checkins", "read": "interact", "write": "interact" } ] }, "downloads": true }`、favicon は 🈁 で。

3. 新しい URL をこの README に書き、受付担当に共有し直す
4. 旧 Artifact は旧所有者が削除する(データはイベントごとに消す前提なので移行は不要)

## 開発

```bash
cd uketsuke-stamp
npm install
npm test                      # 自動テスト
npx --yes serve@14 -l 8765 .  # http://localhost:8765/tests/dev.html でローカル確認(偽の共有DB)
```

- `core.js`: Excel 解析・ID・暗号化・集計・書き出し(純粋関数)
- `sync.js`: 共有DBの購読と端末内キュー
- `app.js` / `tab-*.js` / `index.html`: 画面
- `tests/fixtures/sample-出欠表.xlsx`: 実名を含まないテスト用 Excel(`npm run make-fixture` で実ファイルから再生成。`XLSX_PATH` に実ファイルのパスを設定)
```

- [ ] **Step 2: 公開前チェック**

```bash
cd uketsuke-stamp && npm test
grep -n "doctype\|<html\|<head\|<body" index.html
```

Expected: テスト全件 PASS。`grep` は何も出力しない(Artifact は公開時に骨組みで包まれるため、これらのタグを含めない)。

- [ ] **Step 3: 既存 Artifact を読んでから公開する**

Artifact ツールで `action: "read"`, `url: "https://claude.ai/artifact/TyjKsZTTPJA9mtbhiD7Piy"` を実行(公開前に必ず読む。読まずに公開すると拒否される)。

続けて `action: "publish"` を次の引数で実行:

- `file_path`: `uketsuke-stamp/index.html`
- `url`: `https://claude.ai/artifact/TyjKsZTTPJA9mtbhiD7Piy`
- `root`: `uketsuke-stamp`
- `files`: `{ "core.js": "core.js", "sync.js": "sync.js", "app.js": "app.js", "tab-kanji.js": "tab-kanji.js", "tab-uketsuke.js": "tab-uketsuke.js", "tab-status.js": "tab-status.js" }`
- `capabilities`: `{ "db": { "rules": [ { "path": "", "read": "interact", "write": "admin" }, { "path": "checkins", "read": "interact", "write": "interact" } ] }, "downloads": true }`
- `description`: `Excel名簿を暗号化して共有し、複数端末のQR受付をリアルタイム集約する社内イベント出欠管理`
- `label`: `v2 multi-device`

favicon は既存(🈁)を引き継ぐので渡さない。

Expected: 公開成功。結果に URL と `capabilities` の反映が表示される。`invalid capabilities` 等で拒否されたらルールの JSON を見直す。

- [ ] **Step 4: 公開ページで確認(ブラウザ)**

`navigate` で公開 URL を開き、次を確認する:

1. 3 タブが表示され、受付タブは「幹事が名簿を登録するまでお待ちください。」(共有DBが空のため)
2. 幹事タブで `tests/fixtures/sample-出欠表.xlsx` を取り込み、パスフレーズを設定して保存 → 「名簿を保存しました(308 名)」
3. 受付タブ → 自動解錠、カウンター「0 名受付 / 予定〇 102 名」
4. 「名簿から受付」で 2 名受付、飛び入り 1 名 → 状況タブで受付済 3 / 予定外出席が期待どおり
5. 幹事タブで CSV / Excel を書き出し → ダウンロード確認ダイアログが出て保存できる
6. Artifact ツール `action: "read_db"`, `db_op: "get"`, `collection: "roster"`, `doc_id: "current"` で共有DBの中身を見て、`blob` が暗号文(氏名を含まない)であること、`action: "read_db"`, `db_op: "list"`, `collection: "checkins"` で受付記録に氏名が無いこと(飛び入りは `enc` のみ)を確認する
7. 幹事タブ「新しいイベントを開始」でテストデータを消す(本番の名簿はユーザーが自分で取り込む)

- [ ] **Step 5: 実機確認をユーザーに依頼(チェックリスト)**

以下は Claude Code からは実行できないので、ユーザーに依頼して結果を聞く:

- [ ] スマホで公開 URL を開き、claude.ai にサインインした状態で受付タブが表示される
- [ ] 「スキャン開始」でカメラが起動し、印刷(または画面表示)した QR を読むと「受付」スタンプが出る
- [ ] 同じ QR をもう一度読むと「済」になる
- [ ] 2 台目のスマホで同じ人を読むと「済」+「HH:MM 受付1 で受付済み」になる
- [ ] 機内モードにして受付 → 「未送信 1 件」→ 機内モード解除で消える
- [ ] 受付担当のアカウント(閲覧可)で幹事タブ「名簿を共有DBに保存」を押すと「幹事権限(編集可の共有)が必要です」と出る

- [ ] **Step 6: コミット**

```bash
git add uketsuke-stamp/README.md
git commit -m "uketsuke-stamp: README with operations and handover guide

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 実装後の確認事項(仕様との対応)

| 仕様の節 | 実装タスク |
|---|---|
| §3 Excel 構造・見出し検出・名簿行判定 | Task 2, 3 |
| §4 参加者 ID と暗号化 | Task 4 |
| §5 共有DBのデータモデル・権限 | Task 8(購読)、Task 9(保存・削除)、Task 12(capabilities) |
| §6 同期とオフライン耐性 | Task 7, 10 |
| §7 画面構成(幹事 / 受付 / 状況) | Task 8, 9, 10, 11 |
| §8 書き出し(CSV / Excel) | Task 6, 9 |
| §9 ファイル構成・外部ライブラリ | Task 1, 8 |
| §10 エラー処理 | Task 8(`writeErrorMessage`)、9、10 |
| §11 テスト | Task 1〜7(自動)、9〜12(手動) |
| §13 引き継ぎ・README | Task 12 |
