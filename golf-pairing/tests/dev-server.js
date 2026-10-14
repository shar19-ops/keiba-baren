"use strict";
// 動作確認用の簡易サーバー（node tests/dev-server.js [port]）。本番では使わない。
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const port = Number(process.argv[2]) || 8766;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png" };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log("http://localhost:" + port));
