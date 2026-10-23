// SIGAZNU server: serves the web client and runs game rooms over WebSocket.
// Game logic is authoritative here; every phone receives its own "view" (screen description).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { GAMES, rankAward } = require('./games');

const PORT = process.env.PORT || 3000;
// site files live in public/, but also work if they were uploaded next to server.js
const PUB_DIR = path.join(__dirname, 'public');
const PUB = fs.existsSync(path.join(PUB_DIR, 'index.html')) ? PUB_DIR : __dirname;
const ROOT_FILES = new Set(['/index.html', '/icon.svg', '/manifest.webmanifest']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const COLORS = ['#e8c39e', '#d9774a', '#9fb3a8', '#c9a227', '#b7a6c9', '#8fb0c9', '#d48f8f', '#a3c48a', '#e0b07a', '#9a9a9a', '#c98fb0', '#7fc4b8', '#d1c25e', '#b08b6e', '#8e9fd4', '#e09a6b'];
const MAX_PLAYERS = 16;

/* ---------------- static files ---------------- */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/' || !path.extname(p)) p = '/index.html'; // /ABCD share links open the app
  if (PUB === __dirname && !ROOT_FILES.has(p)) { res.writeHead(404); return res.end('not found'); } // never serve the server's own code
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------------- rooms ---------------- */
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[crypto.randomInt(LETTERS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

function makeRoom() {
  const room = { code: newCode(), hostId: null, players: [], scores: {}, gamesPlayed: 0, screen: 'lobby', game: null, award: null, timers: new Set(), touched: Date.now() };
  rooms.set(room.code, room);
  return room;
}
function addPlayer(room, name, token) {
  const used = new Set(room.players.map(p => p.color));
  const p = { id: 'p' + crypto.randomBytes(4).toString('hex'), name, token, color: COLORS.find(c => !used.has(c)) || COLORS[room.players.length % COLORS.length], ws: null };
  room.players.push(p);
  room.scores[p.id] = room.scores[p.id] || 0;
  if (!room.hostId) room.hostId = p.id;
  return p;
}
const P = (room, id) => room.players.find(p => p.id === id);
const isOn = p => p && p.ws && p.ws.readyState === 1;

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

/* context object handed to game modules */
function ctxFor(room) {
  const g = room.game;
  return {
    room,
    g,
    ids: g ? g.ids : [],
    p: id => P(room, id) || { id, name: '?', color: '#888' },
    name: id => (P(room, id) || { name: '?' }).name,
    online: id => isOn(P(room, id)),
    isHost: id => id === room.hostId,
    later(ms, fn) {
      const t = setTimeout(() => {
        room.timers.delete(t);
        if (room.game !== g) return;
        fn();
        broadcast(room);
      }, ms);
      room.timers.add(t);
    },
    error(pid, msg) { const pl = P(room, pid); if (pl) send(pl.ws, { type: 'error', msg }); },
    finish(award, note) { finishGame(room, award, note); },
    rankAward,
    relayStroke(fromId, data) { for (const pl of room.players) if (pl.id !== fromId) send(pl.ws, { type: 'stroke', ...data }); },
  };
}

function clearTimers(room) { for (const t of room.timers) clearTimeout(t); room.timers.clear(); }

function startGame(room, gameId) {
  const G = GAMES[gameId];
  const ids = room.players.filter(isOn).map(p => p.id);
  if (!G) return;
  if (ids.length < G.min || ids.length > G.max) return;
  clearTimers(room);
  room.game = { id: gameId, ids, s: null };
  room.screen = 'game';
  room.game.s = G.start(ctxFor(room));
}

function finishGame(room, award, note) {
  const g = room.game;
  clearTimers(room);
  for (const id in award) if (P(room, id)) room.scores[id] = (room.scores[id] || 0) + award[id];
  room.gamesPlayed++;
  room.award = { from: g.id, award, note };
  room.game = null;
  room.screen = 'award';
}

/* ---------------- views ---------------- */
function board(room) {
  return room.players.slice().sort((a, b) => (room.scores[b.id] || 0) - (room.scores[a.id] || 0))
    .map(p => ({ id: p.id, name: p.name, color: p.color, right: room.scores[p.id] || 0, off: !isOn(p), host: p.id === room.hostId }));
}

function viewFor(room, pid) {
  const me = P(room, pid);
  const host = pid === room.hostId;
  const base = { code: room.code, me: pid, host, hostName: (P(room, room.hostId) || {}).name, players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })) };
  const n = room.players.filter(isOn).length;

  if (room.screen === 'lobby') {
    const leader = room.gamesPlayed ? board(room)[0] : null;
    return { ...base, screen: 'lobby', title: 'חדר ' + room.code, blocks: [
      { t: 'say', text: room.gamesPlayed ? `שיחקתם ${room.gamesPlayed} ${room.gamesPlayed === 1 ? 'משחק' : 'משחקים'}. ${leader.name} בראש! מה הבא?` :
        n < 2 ? 'החדר פתוח! שלחו לחברים את הקוד או הקישור, ואני כבר אכריז עליהם.' : `${n} שחקנים בחדר. ${host ? 'בחרו משחק ונתחיל.' : 'המארח בוחר משחק.'}` },
      { t: 'code', code: room.code },
      { t: 'h', text: 'ניקוד הערב' },
      { t: 'players', items: board(room), kick: host },
      { t: 'h', text: host ? 'בחרו משחק' : 'המשחקים' },
      { t: 'games', enabled: host, n, items: Object.values(GAMES).map(G => ({ id: G.id, name: G.name, icon: G.icon, min: G.min, max: G.max })) },
      ...(host && room.gamesPlayed ? [{ t: 'buttons', items: [{ label: '🏆 סיום הערב והכתרת אלוף', act: 'endnight', style: 'ember' }] }] : []),
    ] };
  }
  if (room.screen === 'award') {
    const a = room.award, G = GAMES[a.from];
    const rows = room.players.filter(p => p.id in a.award).sort((x, y) => a.award[y.id] - a.award[x.id])
      .map(p => ({ id: p.id, name: p.name, color: p.color, right: a.award[p.id] ? '+' + a.award[p.id] : '0' }));
    return { ...base, screen: 'award', title: G.name, blocks: [
      { t: 'say', text: a.note },
      { t: 'h', text: 'נקודות ערב מהמשחק' },
      { t: 'players', items: rows },
      host ? { t: 'buttons', items: [{ label: 'לטבלה ולמשחק הבא', act: 'tolobby', style: 'main' }] } : { t: 'text', text: 'מחכים שהמארח ימשיך…', muted: true },
    ] };
  }
  if (room.screen === 'end') {
    const b = board(room), top = b[0] ? b[0].right : 0, champs = b.filter(x => x.right === top);
    return { ...base, screen: 'end', title: 'סוף הערב', blocks: [
      { t: 'crown', names: champs.map(c => c.name), sub: `${top} נקודות אחרי ${room.gamesPlayed} ${room.gamesPlayed === 1 ? 'משחק' : 'משחקים'}` },
      { t: 'players', items: b },
      host ? { t: 'buttons', items: [{ label: 'ערב חדש באותו חדר', act: 'newnight', style: 'main' }] } : { t: 'text', text: 'המארח יכול לפתוח ערב חדש באותו חדר.', muted: true },
    ] };
  }
  // in game
  const g = room.game, G = GAMES[g.id];
  const ctx = ctxFor(room);
  let v;
  if (!g.ids.includes(pid)) v = { blocks: [{ t: 'say', text: `${me.name}, המשחק כבר התחיל. תצטרפו מהמשחק הבא! בינתיים אפשר לצפות.` }, ...(G.spectate ? G.spectate(ctx) : [])] };
  else v = G.view(ctx, pid);
  return { ...base, screen: 'game', game: g.id, title: G.name, canSkip: host && !!G.skip, blocks: v.blocks };
}

function broadcast(room) {
  room.touched = Date.now();
  const now = Date.now();
  for (const p of room.players) if (isOn(p)) {
    try { send(p.ws, { type: 'view', now, view: viewFor(room, p.id) }); }
    catch (e) { console.error('view error', room.code, e); }
  }
}

/* ---------------- messages ---------------- */
function handle(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  const type = msg.type;

  if (type === 'create' || type === 'join') {
    const name = clean(msg.name, 14);
    const token = clean(msg.token, 40);
    if (!name || !token) return send(ws, { type: 'error', msg: 'צריך שם כדי להיכנס.' });
    let room;
    if (type === 'create') room = makeRoom();
    else {
      room = rooms.get(clean(msg.code, 4).toUpperCase());
      if (!room) return send(ws, { type: 'error', msg: 'לא מצאנו חדר עם הקוד הזה. בדקו שוב את 4 האותיות.', code: 'noroom' });
    }
    let p = room.players.find(x => x.token === token);
    if (!p) {
      if (room.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', msg: 'החדר מלא (16 שחקנים).' });
      if (room.players.some(x => x.name === name)) return send(ws, { type: 'error', msg: 'השם הזה כבר בחדר. נסו כינוי אחר.' });
      p = addPlayer(room, name, token);
    }
    if (p.ws && p.ws !== ws) { send(p.ws, { type: 'kicked', msg: 'התחברתם מחלון אחר.' }); try { p.ws.close(); } catch (e) {} }
    p.ws = ws; ws.room = room; ws.pid = p.id;
    send(ws, { type: 'joined', code: room.code, you: p.id });
    return broadcast(room);
  }

  const room = ws.room; if (!room) return;
  const pid = ws.pid, host = pid === room.hostId;
  if (!P(room, pid)) return;

  if (type === 'leave') {
    room.players = room.players.filter(p => p.id !== pid);
    ws.room = null;
    if (room.hostId === pid) room.hostId = (room.players.find(isOn) || room.players[0] || {}).id || null;
    if (!room.players.length) { clearTimers(room); rooms.delete(room.code); return; }
    return broadcast(room);
  }

  if (type === 'stroke') {
    const g = room.game; if (!g) return;
    const G = GAMES[g.id]; if (!G.stroke) return;
    const ctx = ctxFor(room);
    const out = G.stroke(ctx, pid, msg);
    if (out) ctx.relayStroke(pid, out);
    return;
  }
  if (type === 'sync') {
    const g = room.game; if (!g) return;
    const s = g.s;
    if (s && s.strokes) send(ws, { type: 'strokes', canvas: s.canvasId, strokes: s.strokes });
    return;
  }

  if (type !== 'act') return;
  const act = msg.act;
  // room-level actions (host)
  if (act === 'pick' && host && room.screen === 'lobby') { startGame(room, msg.id); return broadcast(room); }
  if (act === 'tolobby' && host) { clearTimers(room); room.game = null; room.screen = 'lobby'; return broadcast(room); }
  if (act === 'quit' && host && room.screen === 'game') { clearTimers(room); room.game = null; room.screen = 'lobby'; return broadcast(room); }
  if (act === 'endnight' && host && room.gamesPlayed) { room.screen = 'end'; return broadcast(room); }
  if (act === 'newnight' && host) { for (const id in room.scores) room.scores[id] = 0; room.gamesPlayed = 0; room.screen = 'lobby'; return broadcast(room); }
  if (act === 'kick' && host && msg.id !== pid && room.screen !== 'game') {
    const k = P(room, msg.id);
    if (k) { send(k.ws, { type: 'kicked', msg: 'המארח הוציא אתכם מהחדר.' }); if (k.ws) k.ws.room = null; room.players = room.players.filter(p => p !== k); delete room.scores[k.id]; }
    return broadcast(room);
  }
  if (act === 'skip' && host && room.game && GAMES[room.game.id].skip) { GAMES[room.game.id].skip(ctxFor(room)); return broadcast(room); }

  if (room.screen === 'game' && room.game && room.game.ids.includes(pid)) {
    const G = GAMES[room.game.id];
    try { G.act(ctxFor(room), pid, msg); } catch (e) { console.error('act error', room.game.id, e); }
    broadcast(room);
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    try { handle(ws, msg); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => { if (ws.room && rooms.has(ws.room.code)) broadcast(ws.room); });
});

// keepalive pings + cleanup of idle rooms
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = room.players.some(isOn);
    if ((!anyone && now - room.touched > 30 * 60e3) || now - room.touched > 8 * 3600e3) { clearTimers(room); rooms.delete(code); }
  }
}, 30e3);

server.listen(PORT, () => console.log(`SIGAZNU listening on http://localhost:${PORT}`));
