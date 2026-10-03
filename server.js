#!/usr/bin/env node
/* 도트 올림픽 2026 — static file server + WebSocket room relay.
 *   npm start            → http://localhost:3000
 *   PORT=8080 npm start
 * The host browser runs the game; this server only relays messages:
 *   client inputs → host,  host state snapshots → every client in the room.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

function lanAddrs() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => {
    if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + PORT);
  }));
  return out;
}

/* rooms: code -> { host: ws, clients: Map<cid, ws> } */
const rooms = new Map();
let nextCid = 1;
function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(typeof o === 'string' ? o : JSON.stringify(o)); };

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 512 }, maxPayload: 4 * 1024 * 1024 });
wss.on('connection', ws => {
  ws.role = null; ws.room = null; ws.cid = nextCid++;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'ping') { send(ws, { t: 'pong', ts: m.ts }); return; }
    if (m.t === 'host' && !ws.room) {
      const c = code();
      rooms.set(c, { host: ws, clients: new Map() });
      ws.role = 'host'; ws.room = c;
      send(ws, { t: 'hosted', room: c, addrs: lanAddrs() });
      console.log(`[room ${c}] created`);
      return;
    }
    if (m.t === 'join' && !ws.room) {
      const r = rooms.get(String(m.room || '').toUpperCase());
      if (!r) { send(ws, { t: 'error', msg: '방을 찾을 수 없습니다' }); return; }
      if (r.clients.size >= 12) { send(ws, { t: 'error', msg: '방이 가득 찼습니다' }); return; }
      ws.role = 'client'; ws.room = m.room.toUpperCase();
      r.clients.set(ws.cid, ws);
      send(ws, { t: 'joined', room: ws.room, cid: ws.cid });
      send(r.host, { t: 'peer-join', cid: ws.cid });
      console.log(`[room ${ws.room}] client ${ws.cid} joined (${r.clients.size})`);
      return;
    }
    const r = ws.room && rooms.get(ws.room);
    if (!r) return;
    if (ws.role === 'host' && m.t === 'snap') {
      const s = JSON.stringify(m);
      r.clients.forEach(c => send(c, s));
    } else if (ws.role === 'client' && m.t === 'in') {
      send(r.host, { t: 'in', cid: ws.cid, d: m.d });
    }
  });
  ws.on('close', () => {
    const r = ws.room && rooms.get(ws.room);
    if (!r) return;
    if (ws.role === 'host') {
      r.clients.forEach(c => send(c, { t: 'host-left' }));
      rooms.delete(ws.room);
      console.log(`[room ${ws.room}] closed`);
    } else {
      r.clients.delete(ws.cid);
      send(r.host, { t: 'peer-leave', cid: ws.cid });
    }
  });
});
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) { ws.terminate(); return; } ws.isAlive = false; ws.ping(); });
}, 15000);

server.listen(PORT, () => {
  console.log('\n  🏅 도트 올림픽 2026 서버 실행 중');
  console.log('  ▶ 이 컴퓨터:   http://localhost:' + PORT);
  lanAddrs().forEach(a => console.log('  ▶ 같은 네트워크: ' + a));
  console.log('');
});
