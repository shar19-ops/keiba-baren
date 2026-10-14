# ゴルフ組合せ（golf-pairing）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参加者一覧（Excel 貼り付け）から組合せを自動作成し、案内状の印刷・表のコピーまでできるローカル完結のブラウザアプリ。

**Architecture:** `golf-pairing/` に `core.js`（UMD の純粋関数、Node でテスト）、`app.js`（DOM・状態・localStorage）、`index.html`（画面・CSS）。uketsuke-stamp と同じ流儀。

**Tech Stack:** 素の HTML/CSS/JS（ES5 寄り、classic script）、テストは `node --test`。外部依存なし。

## Global Constraints

- spec: `docs/superpowers/specs/2026-10-14-golf-pairing-design.md`
- file:// でダブルクリックで動くこと（ES modules・fetch・外部 CDN を使わない）
- 外部通信なし。保存は localStorage キー `golf-pairing-v1` と JSON 書き出し／読み込み
- 組の人数: `groupSizes(n)` = 4人基本・端数は末尾3人組、n=5 → [3,2]
- 画面文言は日本語

---

### Task 1: 雛形と貼り付け取り込み（parsePasted）

**Files:** Create `golf-pairing/package.json`, `golf-pairing/core.js`, `golf-pairing/tests/helpers.js`, `golf-pairing/tests/core-parse.test.js`

**Produces:** `GolfCore.parsePasted(text) → { players: [{name, hc:number|null}], errors: string[] }`, `parseHc(v) → {hc, ok}`, `toHalfWidth`, `escapeHtml`; `tests/helpers.js` の `seededRng(seed)`, `makePlayers(hcs)`（id `p0..`, name `選手0..`）

- [ ] テスト: タブ区切り／見出し行（氏名・名前・HC・ハンデ）スキップ／見出しでない1行目は残す／カンマ・全角数字／氏名のみ列／非数値 HC は null＋「N行目」エラー／空行無視・氏名なし行と重複（空白無視で比較）のエラー
- [ ] `npm test` で失敗を確認 → 実装 → 成功を確認 → commit

### Task 2: 組分け（groupSizes / normalizeGroups / assign）

**Files:** Modify `golf-pairing/core.js`; Create `golf-pairing/tests/core-groups.test.js`

**Produces:**
- `groupSizes(n) → number[]`
- `normalizeGroups(groups, players, keepMembers) → [{leaderId, memberIds, locked}]`（先頭 → 固定 → 既存メンバーの優先順、存在しない人・重複・定員超過を除外）
- `assign(players, groups, mode, rng, keepMembers)`（mode: `balanced`|`random`|`hcOrder`。keepMembers=false は先頭と固定以外を割り振り直し、true は未割当だけを空き枠へ）
- `averageHc(players)`

- [ ] テスト: groupSizes の表（0,1,3,4,5,6,7,8,9,10,11,14,16,17）と 6〜40 人の合計／3か4人；3方式それぞれ全員1回・組人数一致・先頭と固定不変；同シードで決定的・別シードで別案；balanced の平均差 ≤3；hcOrder の並び（null 最後）；keepMembers；normalizeGroups の除外と優先
- [ ] 失敗確認 → 実装 → 成功確認 → commit

### Task 3: 出力系（startTimes / groupStats / formatDateJa / tableRows / tableTsv / tableHtml / validateImport）

**Files:** Modify `golf-pairing/core.js`; Create `golf-pairing/tests/core-output.test.js`

**Produces:** `startTimes(count, "HH:MM", intervalMin, "OUT"|"IN"|"split") → [{time, course}]`；`groupStats(memberIds, players) → {hcTotal, hcAvg}`（小数1桁、HC なしは null）；`formatDateJa("2026-11-03") → "2026年11月3日(火)"`；`tableRows(groups, players, times, withHc) → [{no, time, course, names}]`；`tableTsv(rows)`；`tableHtml(rows)`（インライン style 付き、エスケープ済み）；`validateImport(obj) → string|null`

- [ ] テスト → 失敗確認 → 実装 → 成功確認 → commit

### Task 4: 画面（index.html / app.js）

**Files:** Create `golf-pairing/index.html`, `golf-pairing/app.js`

**Consumes:** Task 1〜3 のすべての GolfCore 関数

- [ ] 3タブ（参加者・組合せ・案内状）、ヘッダに JSON 書き出し／読み込み、保存失敗バナー
- [ ] 参加者: 貼り付け→置き換え／追加、エラー表示、表で氏名・HC 編集、削除、1人追加、全削除、人数と組構成の表示（5人は警告）
- [ ] 組合せ: 方式ラジオ、開始時刻・間隔・コース、組カード（時刻・コース・HC 計／平均、先頭プルダウン、メンバー、空き枠、📌固定）、未割当一覧、クリック2回で入れ替え（入れ替えた人は自動で固定）、自動割振り（再シャッフル）、全クリア。人数変更・先頭変更後は割振り済みなら `assign(..., true)` で空きを補充
- [ ] 案内状: 入力欄、HC 表示チェック、A4 プレビュー、印刷（案内状だけ印刷・ライト配色）、表コピー（ClipboardItem → execCommand → テキスト欄の順にフォールバック）
- [ ] ブラウザで file:// を開き、貼り付け→先頭指定→自動割振り→入れ替え→案内状プレビュー→リロード後の復元を確認 → commit

### Task 5: README

**Files:** Create `golf-pairing/README.md`（使い方・データの保存場所・テスト方法）

- [ ] 作成 → commit
