/* 치타델레 기록 동기화 서버
 * - 외부 라이브러리 없음 (Node 기본 모듈만 사용)
 * - 127.0.0.1 에만 바인딩. 외부에서는 nginx 를 통해서만 접근 가능
 * - 기록은 DATA_FILE 에 JSON 으로 저장
 *
 * 환경변수
 *   ZITA_KEY   접속 암호 (필수)
 *   ZITA_PORT  포트 (기본 3100)
 *   ZITA_DIR   저장 폴더 (기본 /var/lib/zitadelle)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = process.env.ZITA_KEY || '';
const PORT = Number(process.env.ZITA_PORT || 3100);
const DIR = process.env.ZITA_DIR || '/var/lib/zitadelle';
const DATA_FILE = path.join(DIR, 'data.json');
const BAK_DIR = path.join(DIR, 'backups');
const MAX_BODY = 4 * 1024 * 1024; // 4MB

if (!KEY || KEY.length < 12) {
  console.error('ZITA_KEY 가 없거나 너무 짧습니다 (12자 이상 필요). 종료합니다.');
  process.exit(1);
}

fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(BAK_DIR, { recursive: true });

const EMPTY = { sessions: [], deleted: [], settings: null, settingsAt: 0, rev: 0 };

function readStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const p = JSON.parse(raw);
    return {
      sessions: Array.isArray(p.sessions) ? p.sessions : [],
      deleted: Array.isArray(p.deleted) ? p.deleted : [],
      settings: p.settings || null,
      settingsAt: Number(p.settingsAt) || 0,
      rev: Number(p.rev) || 0,
    };
  } catch (e) {
    return Object.assign({}, EMPTY);
  }
}

/* 원자적 쓰기: 임시 파일에 쓴 뒤 이름을 바꿔서 중간에 끊겨도 파일이 깨지지 않게 함 */
function writeStore(obj) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/* 하루에 한 번 백업본을 남기고 30일치만 보관 */
function backupDaily(obj) {
  try {
    const d = new Date();
    const name = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
    const p = path.join(BAK_DIR, name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
      const files = fs.readdirSync(BAK_DIR).filter(f => f.endsWith('.json')).sort();
      while (files.length > 30) fs.unlinkSync(path.join(BAK_DIR, files.shift()));
    }
  } catch (e) { /* 백업 실패가 본 기능을 막지 않도록 무시 */ }
}

/* 기록 합치기
 * - sessions 는 id 기준으로 합집합. 같은 id 는 sec 이 큰 쪽을 남김
 * - deleted 에 있는 id 는 제외 (한쪽에서 지운 기록이 되살아나지 않게)
 * - settings 는 더 늦게 바뀐 쪽을 채택
 */
function merge(server, client) {
  const del = new Set([...(server.deleted || []), ...(client.deleted || [])].map(String));
  const map = new Map();
  for (const s of [...(server.sessions || []), ...(client.sessions || [])]) {
    if (!s || s.id == null) continue;
    const id = String(s.id);
    if (del.has(id)) continue;
    const prev = map.get(id);
    if (!prev || Number(s.sec) > Number(prev.sec)) map.set(id, s);
  }
  const sessions = [...map.values()].sort((a, b) => a.start - b.start);

  let settings = server.settings, settingsAt = server.settingsAt || 0;
  if (client.settings && (Number(client.settingsAt) || 0) >= settingsAt) {
    settings = client.settings;
    settingsAt = Number(client.settingsAt) || Date.now();
  }
  return { sessions, deleted: [...del], settings, settingsAt, rev: (server.rev || 0) + 1 };
}

/* 타이밍 공격을 피하기 위한 상수 시간 비교 */
function keyOk(given) {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(KEY).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (p === '/health') return send(res, 200, { ok: true });

  if (p !== '/data') return send(res, 404, { error: 'not found' });

  const given = req.headers['x-zita-key'] || url.searchParams.get('key') || '';
  if (!keyOk(String(given))) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET') {
    const s = readStore();
    return send(res, 200, { ok: true, rev: s.rev, sessions: s.sessions, deleted: s.deleted, settings: s.settings, settingsAt: s.settingsAt });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      let client;
      try { client = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (e) { return send(res, 400, { error: 'bad json' }); }
      const s = readStore();
      const merged = merge(s, client || {});
      try {
        writeStore(merged);
        backupDaily(merged);
      } catch (e) {
        console.error('저장 실패:', e.message);
        return send(res, 500, { error: 'write failed' });
      }
      return send(res, 200, { ok: true, rev: merged.rev, sessions: merged.sessions, deleted: merged.deleted, settings: merged.settings, settingsAt: merged.settingsAt });
    });
    return;
  }

  return send(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('치타델레 동기화 서버 시작: 127.0.0.1:' + PORT + ' / 저장 위치 ' + DATA_FILE);
});
