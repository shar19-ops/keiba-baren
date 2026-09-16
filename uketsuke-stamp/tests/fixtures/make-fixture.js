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
const DEPT_RE = /^[0-9０-９]+[\s　]+/;
const TITLES = ["部長", "課長", "副長", "主任", "", "", ""];
const KEEP_COLS = 16; // A..P。Q 以降(欠席理由・備考)は捨てる
const LABEL_RE = /^(計|小計|合計|総計|人数|出席者数|欠席者数)$/;

function norm(v) { return String(v == null ? "" : v).replace(/[\s　]/g, ""); }

const wb = XLSX.readFile(src);
const dst = XLSX.utils.book_new();
const realNames = new Set();
const realDeptNames = [];
let seq = 0;
let deptSeq = 0;

wb.SheetNames.forEach(function (name) {
  const ws = wb.Sheets[name];
  if (!DEPT_RE.test(name)) {
    // 対象外シート(原本・出欠合計表など)は名前だけ残し中身は捨てる
    XLSX.utils.book_append_sheet(dst, XLSX.utils.aoa_to_sheet([[name + "(ダミー)"]]), name);
    return;
  }
  deptSeq++;
  realDeptNames.push(name);
  realNames.add(name.trim()); // 部署タブ名(担当者の姓を含む場合がある)も漏洩チェック対象にする
  const mm = /^([0-9０-９]+)([\s　]+)/.exec(name);
  const newName = mm[1] + mm[2] + "試験部" + String(deptSeq).padStart(2, "0");
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
  XLSX.utils.book_append_sheet(dst, nws, newName);
});

XLSX.writeFile(dst, out);

// 検査: 実名・実部署タブ名が生成物に残っていないこと
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
const leakedSheetNames = check.SheetNames.filter(function (n) { return realDeptNames.indexOf(n) !== -1; });
if (leakedSheetNames.length) {
  console.error("部署タブ名が匿名化されていません: " + leakedSheetNames.length + " 件。生成物を削除してください");
  process.exit(2);
}
console.log("生成: " + out);
console.log("部署シート人数: " + seq);
