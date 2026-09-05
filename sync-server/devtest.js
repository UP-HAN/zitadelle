/* 로컬 시험 서버 — 배포 전에 브라우저에서 확인해 보기 위한 용도입니다.
 * index.html 을 띄우고 api/data 요청을 동기화 서버로 넘겨줍니다.
 * 실제 서버에서는 이 파일을 쓰지 않습니다. (nginx 가 같은 역할을 합니다)
 *
 *   node sync-server/devtest.js
 *   → http://localhost:8080 접속
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SYNC_PORT = Number(process.env.ZITA_PORT || 3199);
const PORT = 8080;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    const opts = {
      host: '127.0.0.1', port: SYNC_PORT,
      path: url.pathname.replace(/^\/api/, '') + url.search,
      method: req.method, headers: req.headers,
    };
    const p = http.request(opts, r => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    p.on('error', e => { res.writeHead(502); res.end('sync server 연결 실패: ' + e.message); });
    req.pipe(p);
    return;
  }

  const file = path.join(ROOT, 'index.html');
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); res.end('index.html 없음'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log('시험 서버: http://localhost:' + PORT + '  (동기화는 127.0.0.1:' + SYNC_PORT + ' 로 전달)');
});
