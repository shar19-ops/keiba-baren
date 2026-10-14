# ゴルフ組合せ（golf-pairing）設計

社内ゴルフコンペ用に、参加者一覧から組合せを自動作成し、案内状として印刷・転記できるブラウザアプリ。ネットワーク不要・ローカル完結。

## 構成

`golf-pairing/` フォルダ（uketsuke-stamp と同じ流儀）

| ファイル | 役割 |
|---|---|
| `index.html` | 画面とスタイル。ダブルクリック（file://）で開ける。classic `<script src>` のみ使用 |
| `core.js` | 純粋関数（UMD: ブラウザでは `window.GolfCore`、Node では `module.exports`）。DOM に触らない |
| `app.js` | 画面ロジック・状態管理・localStorage 保存 |
| `tests/*.test.js` | `node --test` で core.js をテスト |
| `package.json` | `npm test` のみ。外部依存なし |
| `README.md` | 使い方 |

外部ライブラリ・外部通信なし。

## データモデル

```js
state = {
  version: 1,
  players: [{ id, name, hc /* number|null */ }],
  settings: { mode: "balanced"|"random"|"hcOrder", startTime: "07:30", interval: 7, course: "OUT"|"IN"|"split" },
  groups: [{ leaderId /* string|null, 幹事指定 */, memberIds: [id...], locked: [id...] /* 手動で固定したメンバー */ }],
  invitation: { title, date, venue, address, meetTime, fee, notes, organizer }
}
```

localStorage キー `golf-pairing-v1` に自動保存。JSON 書き出し／読み込みでバックアップ・移行。

## core.js の関数

- `parsePasted(text)` → `{ players, errors }`
  - 行をタブ（なければカンマ）で分割。1列目＝氏名、2列目＝HC。
  - 1行目の2列目が数値でなく「HC」「ハンデ」等を含む、または1列目が「氏名」「名前」なら見出しとして飛ばす。
  - 全角数字・全角小数点を半角に。HC 空欄・非数値は `null`（非数値は errors に行番号付きで記録）。空行は無視。氏名の前後空白はトリム。
  - 重複氏名は errors に警告（取り込みはする）。
- `groupSizes(n, split)` → 例 `[4,4,3,3]`。split（コース分割）のときは前半 OUT（`ceil(組数/2)` 組）・後半 IN のそれぞれで3人組を末尾に置く。3人組の数 t のうち IN 側に `min(ceil(t/2), IN組数)`、残りを OUT 側（14人 → `[4,3,4,3]`）。`normalizeGroups`・`assign` も末尾引数 `split` を受け取る。split でないときは規則: 組数 `g = ceil(n/4)`、3人組の数 `t = 4g - n`、4人組を先に・3人組を末尾に並べる。例外: `n=0` → `[]`、`n<=4` → `[n]`、`n=5` → `[3,2]`（UI で2人組の警告）。
- `assign(players, groups, sizes, mode, rng)` → 新しい `groups`
  - 各組の `leaderId` と `locked` は動かさない。残りの人を空き枠に振り分ける。
  - `random`: シャッフルして順に詰める。
  - `hcOrder`: HC 昇順（null は最後）に並べ、組番号順に詰める。固定メンバーはそのまま。
  - `balanced`: HC null は参加者 HC の平均で代用。HC 降順に並べ、各人を「空き枠があり、現 HC 合計が最小」の組へ（同点は rng で選ぶ）。rng で同 HC の順序を崩し、再シャッフルで別案が出るようにする。
  - `rng` は注入可能（テストで固定シード）。
- `startTimes(count, startTime, interval, course)` → `[{ time: "07:30", course: "OUT" }...]`。`split` は組を前半 OUT / 後半 IN に分け、それぞれ startTime から interval 刻み。
- `groupStats(group, players)` → `{ hcTotal, hcAvg }`（null は除外）。
- `tableTsv(groups, players, times)` → Excel 向け TSV。`tableHtml(...)` → Word 向け HTML 表（クリップボードに text/html と text/plain の両方を載せる）。

## 画面（タブ3つ）

1. **参加者**: 貼り付けエリア＋「取り込み」（置き換え／追加を選択）。一覧表で氏名・HC 編集、行削除、1人追加。人数と組数（例「14人 → 4組: 4,4,3,3」）を表示。
2. **組合せ**: 割振り方式ラジオ、開始時刻・間隔・OUT/IN/分割。組ごとのカード：組番号・時刻・コース、先頭メンバーのプルダウン（未指定可、同じ人は他組で選べない）、メンバー一覧（HC 表示、組合計／平均）。「自動割振り」「再シャッフル」（指定・固定を残して再計算）「全クリア」。メンバーをクリック→別の組のメンバーをクリックで入れ替え。各メンバーに📌固定トグル。参加者の増減で組数が変わったら、存在しない人や溢れた組は解除。
3. **案内状**: 入力欄（大会名、日付、ゴルフ場、住所、集合時刻、会費、連絡事項、幹事）。下にプレビュー（A4 縦想定、本文＋組合せ表）。「印刷 / PDF 保存」（`window.print`、印刷時はタブ等を隠し案内状のみ）、「表をコピー（Word/Excel 用）」。

ヘッダ: 「JSON 書き出し」「JSON 読み込み」。

## エラー処理

- 取り込みエラーは一覧の上に行番号付きで表示（止めない）。
- 参加者0人では組合せ不可のメッセージ。2人組が生じる人数（5人）は警告。
- localStorage 失敗（プライベートモード等）は try/catch し、画面上部に「保存できません、JSON 書き出しを使ってください」。
- JSON 読み込みは `version` と必須キーを検証し、不正なら既存データを変えずにエラー表示。
- クリップボード API 不可時は TSV をテキストエリアに表示して手動コピー。

## テスト（core.js）

parsePasted（タブ/カンマ、見出し判定、全角、HC 空欄・非数値、空行）、groupSizes（1〜20人）、assign（先頭・固定が不変、全員が1回ずつ入る、各組サイズ一致、balanced で合計差が小さい、hcOrder の並び、固定シードで決定的）、startTimes（通常・split）、tableTsv。

## 対象外

同じ部署を分ける等の制約、Excel ファイル直接読込、スコア集計、オンライン共有。
