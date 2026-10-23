// All SIGAZNU games. Each game: { id, name, icon, min, max, start(ctx), view(ctx, pid), act(ctx, pid, msg), skip?(ctx), stroke?(ctx, pid, msg) }
// view() returns { blocks: [...] } — the client renders these generic blocks (see public/index.html, renderBlock).
const C = require('./content');

const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = s => String(s || '').replace(/["'׳״`\-\s.,!?]/g, '').toLowerCase();
const cut = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// evening points by ranking: 3 / 2 / 1, ties share
function rankAward(points) {
  const vals = [...new Set(Object.values(points))].sort((a, b) => b - a);
  const out = {};
  for (const id in points) { const r = vals.indexOf(points[id]); out[id] = r < 3 && points[id] > 0 ? 3 - r : 0; }
  return out;
}
function tally(votes) {
  const c = {};
  for (const k in votes) { const v = votes[k]; if (v == null) continue; c[v] = (c[v] || 0) + 1; }
  let best = null, bn = 0, tie = false;
  for (const k in c) { if (c[k] > bn) { best = k; bn = c[k]; tie = false; } else if (c[k] === bn) tie = true; }
  return { best: tie ? null : best, counts: c };
}

/* block helpers */
const say = text => ({ t: 'say', text });
const text = (t, muted) => ({ t: 'text', text: t, muted });
const big = (t, sub) => ({ t: 'big', text: t, sub });
const h = t => ({ t: 'h', text: t });
const btns = (...items) => ({ t: 'buttons', items: items.filter(Boolean) });
const btn = (label, act, style = 'main', extra = {}) => ({ label, act, style, ...extra });
const timer = end => ({ t: 'timer', end });
const row = (ctx, id, extra = {}) => ({ id, name: ctx.name(id), color: ctx.p(id).color, off: !ctx.online(id), ...extra });
const others = (ids, pid) => ids.filter(id => id !== pid);
const hostNext = (ctx, pid, label = 'המשך ▶') => ctx.isHost(pid) ? btns(btn(label, 'next')) : text('מחכים שהמארח ימשיך…', true);

const G = {};

/* ============ המתחזה ============ */
G.imposter = {
  id: 'imposter', name: 'המתחזה', icon: '🕵️', min: 3, max: 12,
  start(ctx) {
    const cats = Object.keys(C.CATEGORY_WORDS), cat = cats[rnd(cats.length)];
    const words = shuffle(C.CATEGORY_WORDS[cat]);
    return { phase: 'clues', cat, word: words[0], options: shuffle(words.slice(0, 8)), imp: ctx.ids[rnd(ctx.ids.length)], order: shuffle(ctx.ids), turn: 0, rounds: 2, clues: [], votes: {} };
  },
  role(s, pid) {
    return pid === s.imp
      ? { t: 'secret', tone: 'imp', title: 'התפקיד שלך', text: 'אתה המתחזה!', sub: `הקטגוריה: ${s.cat}. תשתלבו ואל תיתפסו.`, hidden: true }
      : { t: 'secret', tone: 'word', title: `הקטגוריה: ${s.cat}`, text: s.word, sub: 'זו המילה הסודית', hidden: true };
  },
  view(ctx, pid) {
    const s = ctx.g.s;
    const clues = { t: 'list', items: s.clues.map(c => ({ name: ctx.name(c.id), color: ctx.p(c.id).color, text: c.text })) };
    if (s.phase === 'clues') {
      const cur = s.order[s.turn % s.order.length], round = Math.floor(s.turn / s.order.length) + 1;
      return { blocks: [say('כל אחד בתורו כותב רמז של מילה אחת. המתחזה לא יודע את המילה, אז שימו לב מי מגמגם.'), this.role(s, pid),
        h(`סבב רמזים ${round} מתוך ${s.rounds}`), clues,
        pid === cur ? { t: 'input', act: 'clue', placeholder: 'רמז של מילה אחת', button: 'שליחה', max: 20 } : text(`מחכים לרמז של ${ctx.name(cur)}…`, true)] };
    }
    if (s.phase === 'vote') {
      return { blocks: [say('מי המתחזה? כל אחד מצביע בטלפון שלו.'), this.role(s, pid), clues,
        { t: 'choices', act: 'vote', selected: s.votes[pid], items: others(s.order, pid).map(id => row(ctx, id)) },
        text(`הצביעו ${Object.keys(s.votes).length} מתוך ${s.order.length}`, true)] };
    }
    // guess
    if (pid === s.imp) return { blocks: [say('תפסו אותך! הזדמנות אחרונה: מה המילה הסודית?'),
      { t: 'choices', act: 'guess', items: s.options.map(w => ({ id: w, name: w })) }] };
    return { blocks: [big(`תפסתם את ${ctx.name(s.imp)}!`, 'עכשיו המתחזה מנסה לנחש את המילה…'), this.role(s, pid)] };
  },
  nextClue(ctx) { const s = ctx.g.s; s.turn++; if (s.turn >= s.order.length * s.rounds) s.phase = 'vote'; },
  closeVote(ctx) {
    const s = ctx.g.s, { best } = tally(s.votes);
    if (best === s.imp) { s.phase = 'guess'; return; }
    const aw = Object.fromEntries(s.order.map(id => [id, id === s.imp ? 3 : 0]));
    ctx.finish(aw, `${best ? `הצבעתם על ${ctx.name(best)}` : 'ההצבעה נגמרה בתיקו'}, והמתחזה היה בכלל ${ctx.name(s.imp)}! המילה הייתה "${s.word}". 3 נקודות למתחזה.`);
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'clues' && m.act === 'clue' && pid === s.order[s.turn % s.order.length]) {
      const t = cut(m.value, 20); if (!t) return;
      s.clues.push({ id: pid, text: t }); this.nextClue(ctx);
    } else if (s.phase === 'vote' && m.act === 'vote' && s.order.includes(m.id) && m.id !== pid) {
      s.votes[pid] = m.id;
      if (Object.keys(s.votes).length >= s.order.length) this.closeVote(ctx);
    } else if (s.phase === 'guess' && m.act === 'guess' && pid === s.imp) {
      const ok = m.id === s.word;
      const aw = Object.fromEntries(s.order.map(id => [id, ok ? (id === s.imp ? 2 : 0) : (id === s.imp ? 0 : 1)]));
      ctx.finish(aw, ok ? `${ctx.name(s.imp)} נתפס/ה אבל ניחש/ה את "${s.word}". 2 נקודות למתחזה!` : `${ctx.name(s.imp)} ניחש/ה "${m.id}", אבל המילה הייתה "${s.word}". נקודה לכל השאר!`);
    }
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'clues') { s.clues.push({ id: s.order[s.turn % s.order.length], text: '(דילג/ה)' }); this.nextClue(ctx); }
    else if (s.phase === 'vote') this.closeVote(ctx);
  },
};

/* ============ שבע בר מזל ============ */
const newDeck = () => { const d = [0]; for (let n = 1; n <= 12; n++) for (let k = 0; k < n; k++) d.push(n); return shuffle(d); };
G.seven = {
  id: 'seven', name: 'שבע בר מזל', icon: '🎰', min: 2, max: 10,
  start(ctx) {
    return { phase: 'play', round: 1, rounds: 3, deck: newDeck(), total: Object.fromEntries(ctx.ids.map(i => [i, 0])), hands: {}, st: {}, order: shuffle(ctx.ids), turn: 0, last: null, gain: {} };
  },
  sum: h => (h || []).reduce((a, b) => a + b, 0),
  view(ctx, pid) {
    const s = ctx.g.s;
    const tags = { bust: ['נשרף', 'bad'], stop: ['עצר', 'ok'], seven: ['7!', 'ok'] };
    const table = { t: 'players', items: s.order.map(id => {
      const st = s.st[id], hand = s.hands[id] || [];
      return row(ctx, id, { right: s.phase === 'roundEnd' ? s.total[id] : (st === 'bust' ? 0 : this.sum(hand)), sub: hand.join(' · ') || '—',
        tag: st ? tags[st][0] : (s.phase === 'play' && s.order[s.turn] === id ? 'בתור' : ''), tone: st ? tags[st][1] : 'turn' });
    }) };
    if (s.phase === 'roundEnd') return { blocks: [say(`סוף סבב ${s.round} מתוך ${s.rounds}! ${s.last || ''}`), h('ניקוד מצטבר'),
      { t: 'players', items: s.order.slice().sort((a, b) => s.total[b] - s.total[a]).map(id => row(ctx, id, { right: s.total[id], sub: s.st[id] === 'bust' ? 'נשרף בסבב' : `+${s.gain[id]} בסבב` })) },
      hostNext(ctx, pid, s.round < s.rounds ? 'לסבב הבא ▶' : 'לתוצאות 🏁')] };
    const cur = s.order[s.turn], hand = s.hands[pid] || [];
    const mine = pid === cur;
    return { blocks: [say(s.last || 'מושכים קלפים ואוספים נקודות. מספר כפול שורף את הסבב, 7 קלפים שונים שווים 15 בונוס.'),
      text(`סבב ${s.round} מתוך ${s.rounds} · נשארו ${s.deck.length} קלפים בחפיסה`, true),
      ...(s.order.includes(pid) ? [{ t: 'cards', items: hand.map((v, i) => ({ v, dup: s.st[pid] === 'bust' && i === hand.length - 1 })), empty: 'עוד אין לך קלפים' }] : []),
      mine ? btns(btn('🃏 משיכה', 'draw', 'main'), btn('✋ עצירה', 'stop', 'ghost', { disabled: !hand.length })) : text(`התור של ${ctx.name(cur)}`, true),
      table] };
  },
  advance(ctx) {
    const s = ctx.g.s;
    if (!s.order.some(id => !s.st[id])) return this.endRound(ctx);
    let t = s.turn; do { t = (t + 1) % s.order.length; } while (s.st[s.order[t]]);
    s.turn = t;
  },
  endRound(ctx) {
    const s = ctx.g.s;
    s.order.forEach(id => { const g = s.st[id] === 'bust' ? 0 : this.sum(s.hands[id]) + (s.st[id] === 'seven' ? 15 : 0); s.gain[id] = g; s.total[id] += g; });
    s.phase = 'roundEnd';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'roundEnd' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.total), 'שבע בר מזל נגמר! הנה מי שלקח נקודות ערב:');
      s.round++; s.hands = {}; s.st = {}; s.order.push(s.order.shift()); s.turn = 0; s.last = null; s.phase = 'play';
      return;
    }
    if (s.phase !== 'play' || pid !== s.order[s.turn]) return;
    if (m.act === 'draw') {
      if (!s.deck.length) s.deck = newDeck();
      const c = s.deck.pop(), hand = (s.hands[pid] = s.hands[pid] || []);
      const dup = hand.includes(c); hand.push(c);
      if (dup) { s.st[pid] = 'bust'; s.last = `🔥 ${ctx.name(pid)} משך/ה ${c} פעמיים ונשרף/ה!`; this.advance(ctx); }
      else if (new Set(hand).size >= 7) { s.st[pid] = 'seven'; s.order.forEach(x => { if (!s.st[x]) s.st[x] = 'stop'; }); s.last = `🎉 ${ctx.name(pid)} אסף/ה 7 קלפים שונים! +15 בונוס והסבב נגמר.`; this.endRound(ctx); }
      else { s.last = `${ctx.name(pid)} משך/ה ${c}.`; }
    } else if (m.act === 'stop' && (s.hands[pid] || []).length) {
      s.st[pid] = 'stop'; s.last = `${ctx.name(pid)} עצר/ה עם ${this.sum(s.hands[pid])} נקודות.`; this.advance(ctx);
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'play') { const id = s.order[s.turn]; s.st[id] = (s.hands[id] || []).length ? 'stop' : 'bust'; this.advance(ctx); } },
};

/* ============ פצצה מתקתקת ============ */
G.bomb = {
  id: 'bomb', name: 'פצצה מתקתקת', icon: '💣', min: 3, max: 12,
  start(ctx) {
    return { phase: 'ready', round: 1, rounds: 3, booms: Object.fromEntries(ctx.ids.map(i => [i, 0])), order: shuffle(ctx.ids), holder: 0, cats: shuffle(C.BOMB_CATS), cat: null, answers: [] };
  },
  view(ctx, pid) {
    const s = ctx.g.s, holder = s.order[s.holder];
    const scores = { t: 'players', items: s.order.map(id => row(ctx, id, { right: s.booms[id] ? '💥'.repeat(s.booms[id]) : '✔', tag: s.phase === 'live' && id === holder ? '💣' : '' })) };
    if (s.phase === 'ready') return { blocks: [say('תופיע קטגוריה והפצצה תתחיל לתקתק. אף אחד לא יודע כמה זמן נשאר. מי שמחזיק את הפצצה כותב תשובה, והיא עוברת הלאה.'),
      text(`סבב ${s.round} מתוך ${s.rounds} · ${ctx.name(holder)} מתחיל/ה`, true), { t: 'bomb' },
      ctx.isHost(pid) ? btns(btn('🔥 הדלקת הפתיל', 'arm', 'ember')) : text('מחכים שהמארח ידליק את הפתיל…', true), scores] };
    if (s.phase === 'live') {
      const list = { t: 'list', items: s.answers.slice().reverse().map(a => ({ name: ctx.name(a.id), color: ctx.p(a.id).color, text: a.text })) };
      return { blocks: [big(s.cat, 'הקטגוריה'), { t: 'bomb', live: true },
        pid === holder ? { t: 'input', act: 'answer', placeholder: 'תשובה מהר!', button: 'העברה ➜', max: 24, focus: true } : big(`הפצצה אצל ${ctx.name(holder)}`),
        list] };
    }
    return { blocks: [{ t: 'boom' }, big(`בום! אצל ${ctx.name(holder)}`), scores, hostNext(ctx, pid, s.round < s.rounds ? 'סבב הבא ▶' : 'לתוצאות 🏁')] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'ready' && m.act === 'arm' && ctx.isHost(pid)) {
      s.cat = s.cats[(s.round - 1) % s.cats.length]; s.answers = []; s.phase = 'live';
      const r = s.round;
      ctx.later(20000 + rnd(25000), () => { if (s.round !== r || s.phase !== 'live') return; s.booms[s.order[s.holder]]++; s.phase = 'boom'; });
    } else if (s.phase === 'live' && m.act === 'answer' && pid === s.order[s.holder]) {
      const t = cut(m.value, 24); if (!t) return;
      if (s.answers.some(a => norm(a.text) === norm(t))) return ctx.error(pid, 'כבר אמרו את זה! תשובה אחרת, מהר!');
      s.answers.push({ id: pid, text: t }); s.holder = (s.holder + 1) % s.order.length;
    } else if (s.phase === 'boom' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) {
        const surv = Object.fromEntries(s.order.map(id => [id, s.rounds - s.booms[id]]));
        return ctx.finish(rankAward(surv), 'הפצצה נגמרה. מי ששרד הכי הרבה סבבים לוקח נקודות:');
      }
      s.round++; s.phase = 'ready';
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'live') s.holder = (s.holder + 1) % s.order.length; },
};

/* ============ פנטומימה ============ */
G.mime = {
  id: 'mime', name: 'פנטומימה', icon: '🎭', min: 3, max: 16,
  start(ctx) { return { phase: 'ready', order: shuffle(ctx.ids), i: 0, words: shuffle(C.MIME_WORDS), w: 0, pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), turnGot: 0, end: 0 }; },
  view(ctx, pid) {
    const s = ctx.g.s, actor = s.order[s.i], me = pid === actor;
    const scores = { t: 'players', items: s.order.slice().sort((a, b) => s.pts[b] - s.pts[a]).map(id => row(ctx, id, { right: s.pts[id], tag: id === actor ? 'מציג/ה' : '' })) };
    if (s.phase === 'ready') return { blocks: [say('60 שניות להציג כמה שיותר מילים בלי לדבר. מי שמנחש נכון וגם המציג מקבלים נקודה.'),
      text(`תור ${s.i + 1} מתוך ${s.order.length}`, true),
      me ? btns(btn('▶ מוכן/ה, התחלה', 'go')) : big(`${ctx.name(actor)} מתכונן/ת`), scores] };
    if (s.phase === 'live') {
      if (me) return { blocks: [timer(s.end), { t: 'secret', tone: 'word', text: s.words[s.w % s.words.length], title: 'הציגו בלי מילים' },
        h('מי ניחש?'), { t: 'choices', act: 'hit', items: others(s.order, pid).map(id => row(ctx, id)) }, btns(btn('דילוג', 'skip', 'ghost'))] };
      return { blocks: [timer(s.end), big(`${ctx.name(actor)} מציג/ה`, 'נחשו בקול!'), text(`ניחשו ${s.turnGot} מילים בתור הזה`, true), scores] };
    }
    return { blocks: [say(`נגמר הזמן! ${ctx.name(actor)} העביר/ה ${s.turnGot} מילים.`), scores,
      (ctx.isHost(pid) || me) ? btns(btn(s.i + 1 < s.order.length ? 'לשחקן הבא ▶' : 'לתוצאות 🏁', 'next')) : text('מחכים להמשך…', true)] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, actor = s.order[s.i];
    if (s.phase === 'ready' && m.act === 'go' && pid === actor) {
      s.phase = 'live'; s.turnGot = 0; s.end = Date.now() + 60000; const i = s.i;
      ctx.later(60000, () => { if (s.i === i && s.phase === 'live') s.phase = 'done'; });
    } else if (s.phase === 'live' && pid === actor) {
      if (m.act === 'hit' && s.order.includes(m.id) && m.id !== pid) { s.pts[pid]++; s.pts[m.id]++; s.turnGot++; s.w++; }
      else if (m.act === 'skip') s.w++;
    } else if (s.phase === 'done' && m.act === 'next' && (pid === actor || ctx.isHost(pid))) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.i + 1 >= s.order.length) return ctx.finish(rankAward(s.pts), 'פנטומימה נגמרה! הנה השחקנים הכי מובנים בחדר:');
    s.i++; s.phase = 'ready';
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'ready' || s.phase === 'done') this.next(ctx); else if (s.phase === 'live') s.phase = 'done'; },
};

/* ============ shared canvas helpers ============ */
const PALETTE = ['#f2ede6', '#1b1917', '#8a847d', '#c8955a', '#8b5e3c', '#e8673a', '#d9b44a', '#6fa58c', '#6f93c9', '#b07fc0', '#d46a6a',
  '#e8c39e', '#d9774a', '#9fb3a8', '#c9a227', '#b7a6c9', '#8fb0c9', '#d48f8f', '#a3c48a', '#e0b07a', '#9a9a9a', '#c98fb0', '#7fc4b8', '#d1c25e', '#b08b6e', '#8e9fd4', '#e09a6b'];
function cleanStroke(m) {
  if (!Array.isArray(m.pts) || m.pts.length < 2 || m.pts.length > 400) return null;
  const pts = m.pts.map(Number); if (pts.some(v => !(v >= 0 && v <= 1))) return null;
  const c = PALETTE.includes(m.c) ? m.c : PALETTE[0];
  const w = Math.max(1, Math.min(40, Number(m.w) || 4));
  return { c, w, pts: pts.map(v => Math.round(v * 1000) / 1000) };
}
const maskWord = (w, shown) => [...w].map((ch, i) => ch === ' ' ? '  ' : shown.includes(i) ? ch : '_').join(' ');

/* ============ צייר ותנחש ============ */
G.draw = {
  id: 'draw', name: 'צייר ותנחש', icon: '🎨', min: 2, max: 12,
  start(ctx) {
    const s = { phase: 'pick', order: shuffle(ctx.ids), i: 0, pool: shuffle(C.DRAW_WORDS), pickFrom: [], word: '', strokes: [], canvasId: 'd0', guessed: [], pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), feed: [], end: 0, shown: [] };
    this.setup(s); return s;
  },
  setup(s) { if (s.pool.length < 3) s.pool = shuffle(C.DRAW_WORDS); s.pickFrom = s.pool.splice(0, 3); },
  view(ctx, pid) {
    const s = ctx.g.s, drawer = s.order[s.i], me = pid === drawer;
    const scores = { t: 'players', items: s.order.slice().sort((a, b) => s.pts[b] - s.pts[a]).map(id => row(ctx, id, { right: s.pts[id], tag: id === drawer ? 'מצייר/ת' : s.guessed.includes(id) ? '✔' : '', tone: s.guessed.includes(id) ? 'ok' : 'turn' })) };
    const canvas = { t: 'canvas', canvas: s.canvasId, count: s.strokes.length, canDraw: me && s.phase === 'live', tools: me && s.phase === 'live' };
    const feed = { t: 'list', items: s.feed.slice(-6).reverse().map(f => ({ name: ctx.name(f.id), color: ctx.p(f.id).color, text: f.text, tone: f.ok ? 'ok' : '' })) };
    if (s.phase === 'pick') return { blocks: [say('אחד מצייר וכולם מנחשים. ככל שמנחשים מהר יותר, מקבלים יותר נקודות. גם הצייר מקבל נקודה על כל מי שניחש.'),
      text(`תור ${s.i + 1} מתוך ${s.order.length}`, true),
      me ? { t: 'choices', act: 'pick', items: s.pickFrom.map(w => ({ id: w, name: w })) } : big(`${ctx.name(drawer)} בוחר/ת מה לצייר…`), scores] };
    if (s.phase === 'live') {
      const done = s.guessed.includes(pid);
      return { blocks: [timer(s.end), me ? { t: 'secret', tone: 'word', title: 'ציירו:', text: s.word } : big(maskWord(s.word, s.shown), `${[...s.word.replace(/ /g, '')].length} אותיות`),
        canvas, me ? text('אסור לכתוב אותיות או מספרים 😉', true) : done ? big('ניחשת! 🎉') : { t: 'input', act: 'guess', placeholder: 'מה זה?', button: 'ניחוש', max: 24, keep: true },
        feed, scores] };
    }
    return { blocks: [say(`זה היה "${s.word}"! ${s.guessed.length ? `${s.guessed.length} ניחשו נכון.` : 'אף אחד לא ניחש הפעם.'}`), canvas, scores,
      (ctx.isHost(pid) || me) ? btns(btn(s.i + 1 < s.order.length ? 'לצייר הבא ▶' : 'לתוצאות 🏁', 'next')) : text('מחכים להמשך…', true)] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, drawer = s.order[s.i];
    if (s.phase === 'pick' && m.act === 'pick' && pid === drawer && s.pickFrom.includes(m.id)) {
      s.word = m.id; s.phase = 'live'; s.strokes = []; s.canvasId = 'd' + s.i + '_' + Date.now(); s.guessed = []; s.feed = []; s.shown = [];
      s.end = Date.now() + 80000; const i = s.i;
      const letters = [...s.word].map((c, k) => c === ' ' ? -1 : k).filter(k => k >= 0);
      const hint = () => { if (s.i !== i || s.phase !== 'live') return; const left = letters.filter(k => !s.shown.includes(k)); if (left.length > 1) s.shown.push(left[rnd(left.length)]); };
      ctx.later(35000, hint); ctx.later(55000, hint);
      ctx.later(80000, () => { if (s.i === i && s.phase === 'live') s.phase = 'reveal'; });
    } else if (s.phase === 'live' && m.act === 'guess' && pid !== drawer && !s.guessed.includes(pid)) {
      const t = cut(m.value, 24); if (!t) return;
      if (norm(t) === norm(s.word)) {
        s.guessed.push(pid); s.pts[pid] += [3, 2][s.guessed.length - 1] || 1; s.pts[drawer] += 1;
        s.feed.push({ id: pid, text: 'ניחש/ה! ✔', ok: true });
        if (s.guessed.length >= s.order.length - 1) s.phase = 'reveal';
      } else s.feed.push({ id: pid, text: t });
    } else if (s.phase === 'live' && m.act === 'clear' && pid === drawer) {
      s.strokes = []; s.canvasId = 'd' + s.i + '_' + Date.now();
    } else if (s.phase === 'reveal' && m.act === 'next' && (pid === drawer || ctx.isHost(pid))) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.i + 1 >= s.order.length) return ctx.finish(rankAward(s.pts), 'הציורים נגמרו! הנה מי שלקח נקודות ערב:');
    s.i++; s.phase = 'pick'; this.setup(s); s.strokes = []; s.canvasId = 'd' + s.i;
  },
  stroke(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase !== 'live' || pid !== s.order[s.i] || m.canvas !== s.canvasId || s.strokes.length > 4000) return null;
    const st = cleanStroke(m); if (!st) return null;
    s.strokes.push(st);
    return { canvas: s.canvasId, ...st };
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'live') s.phase = 'reveal'; else this.next(ctx); },
};

/* ============ הצייר המזויף ============ */
G.forger = {
  id: 'forger', name: 'הצייר המזויף', icon: '🖌️', min: 4, max: 10,
  start(ctx) {
    const cats = Object.keys(C.CATEGORY_WORDS), cat = cats[rnd(cats.length)];
    const words = shuffle(C.CATEGORY_WORDS[cat]);
    return { phase: 'draw', cat, word: words[0], options: shuffle(words.slice(0, 8)), imp: ctx.ids[rnd(ctx.ids.length)], order: shuffle(ctx.ids), turn: 0, rounds: 2, strokes: [], canvasId: 'f' + Date.now(), drew: false, votes: {} };
  },
  view(ctx, pid) {
    const s = ctx.g.s, role = G.imposter.role(s, pid);
    if (pid === s.imp) role.text = 'אתה הצייר המזויף!';
    const canvas = { t: 'canvas', canvas: s.canvasId, count: s.strokes.length };
    if (s.phase === 'draw') {
      const cur = s.order[s.turn % s.order.length], round = Math.floor(s.turn / s.order.length) + 1;
      canvas.canDraw = pid === cur && !s.locked; canvas.oneStroke = true; canvas.color = ctx.p(pid).color;
      return { blocks: [say('כל אחד בתורו מוסיף קו אחד לציור, בלי להרים את האצבע. המזייף לא יודע מה מציירים, אז שימו לב מי מקשקש.'), role,
        text(`סבב ${round} מתוך ${s.rounds} · ${pid === cur ? 'התור שלך! קו אחד בלבד' : `${ctx.name(cur)} מצייר/ת`}`, pid !== cur), canvas,
        { t: 'players', items: s.order.map(id => row(ctx, id, { tag: id === cur ? 'בתור' : '' })) }] };
    }
    if (s.phase === 'vote') return { blocks: [say('מי הצייר המזויף? כל קו בצבע של מי שצייר אותו.'), role, canvas,
      { t: 'choices', act: 'vote', selected: s.votes[pid], items: others(s.order, pid).map(id => row(ctx, id)) },
      text(`הצביעו ${Object.keys(s.votes).length} מתוך ${s.order.length}`, true)] };
    if (pid === s.imp) return { blocks: [say('תפסו אותך! הזדמנות אחרונה: מה ציירו?'), { t: 'choices', act: 'guess', items: s.options.map(w => ({ id: w, name: w })) }] };
    return { blocks: [big(`תפסתם את ${ctx.name(s.imp)}!`, 'עכשיו המזייף מנסה לנחש מה ציירתם…'), canvas] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'draw' && m.act === 'done' && pid === s.order[s.turn % s.order.length] && s.drew) {
      s.turn++; s.drew = false; s.locked = false;
      if (s.turn >= s.order.length * s.rounds) s.phase = 'vote';
    } else if (s.phase === 'vote' && m.act === 'vote' && s.order.includes(m.id) && m.id !== pid) {
      s.votes[pid] = m.id;
      if (Object.keys(s.votes).length >= s.order.length) this.closeVote(ctx);
    } else if (s.phase === 'guess' && m.act === 'guess' && pid === s.imp) {
      const ok = m.id === s.word;
      const aw = Object.fromEntries(s.order.map(id => [id, ok ? (id === s.imp ? 2 : 0) : (id === s.imp ? 0 : 1)]));
      ctx.finish(aw, ok ? `${ctx.name(s.imp)} נתפס/ה אבל ניחש/ה את "${s.word}". 2 נקודות למזייף!` : `${ctx.name(s.imp)} ניחש/ה "${m.id}", אבל ציירתם "${s.word}". נקודה לכל השאר!`);
    }
  },
  closeVote(ctx) {
    const s = ctx.g.s, { best } = tally(s.votes);
    if (best === s.imp) { s.phase = 'guess'; return; }
    const aw = Object.fromEntries(s.order.map(id => [id, id === s.imp ? 3 : 0]));
    ctx.finish(aw, `${best ? `הצבעתם על ${ctx.name(best)}` : 'ההצבעה נגמרה בתיקו'}, והמזייף היה ${ctx.name(s.imp)}! ציירתם "${s.word}". 3 נקודות למזייף.`);
  },
  stroke(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase !== 'draw' || pid !== s.order[s.turn % s.order.length] || s.locked || m.canvas !== s.canvasId) return null;
    const st = cleanStroke(m); if (!st) return null;
    st.c = ctx.p(pid).color; st.w = 6;
    s.strokes.push(st); s.drew = true;
    if (m.last) s.locked = true;
    return { canvas: s.canvasId, ...st };
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'draw') { s.turn++; s.drew = false; s.locked = false; if (s.turn >= s.order.length * s.rounds) s.phase = 'vote'; }
    else if (s.phase === 'vote') this.closeVote(ctx);
  },
};

/* ============ הכפר בלילה ============ */
const ROLES = { killer: ['רוצח/ת', '🔪', 'בלילה בוחרים יחד קורבן. ביום מתחזים לתושבים תמימים.'], doctor: ['רופא/ה', '🩺', 'בכל לילה בוחרים מישהו להציל, גם את עצמכם.'],
  detective: ['בלש/ית', '🔎', 'בכל לילה בודקים שחקן אחד ומגלים אם הוא רוצח.'], villager: ['תושב/ת', '🏡', 'אין כוחות מיוחדים. רק שכל ישר והצבעה ביום.'] };
G.village = {
  id: 'village', name: 'הכפר בלילה', icon: '🌙', min: 5, max: 12,
  start(ctx) {
    const ids = shuffle(ctx.ids), n = ids.length, k = n >= 8 ? 2 : 1, roles = {};
    ids.forEach((id, i) => { roles[id] = i < k ? 'killer' : i === k ? 'doctor' : (i === k + 1 && n >= 6) ? 'detective' : 'villager'; });
    return { phase: 'roles', roles, alive: ctx.ids.slice(), order: ctx.ids.slice(), night: 0, kills: {}, save: null, check: null, checks: {}, votes: {}, msg: '', ready: [] };
  },
  roleBlock(s, pid, ctx) {
    const [nm, ic, d] = ROLES[s.roles[pid]];
    const mates = s.roles[pid] === 'killer' ? s.order.filter(id => id !== pid && s.roles[id] === 'killer').map(id => ctx.name(id)) : [];
    return { t: 'secret', tone: s.roles[pid] === 'killer' ? 'imp' : 'word', title: 'התפקיד שלך', text: `${ic} ${nm}`, sub: d + (mates.length ? ` השותף/ה שלך: ${mates.join(', ')}.` : ''), hidden: true };
  },
  aliveList(ctx, s) { return { t: 'players', items: s.order.map(id => row(ctx, id, { tag: s.alive.includes(id) ? '' : `מת/ה · ${ROLES[s.roles[id]][0]}`, tone: s.alive.includes(id) ? '' : 'bad' })) }; },
  view(ctx, pid) {
    const s = ctx.g.s, alive = s.alive.includes(pid), role = s.roles[pid];
    if (s.phase === 'roles') return { blocks: [say('ברוכים הבאים לכפר. כל אחד מציץ בתפקיד שלו בסתר. כשכולם מוכנים, המארח מוריד את הלילה.'), this.roleBlock(s, pid, ctx),
      ctx.isHost(pid) ? btns(btn('🌙 הלילה יורד', 'night', 'main')) : text('מחכים למארח…', true)] };
    if (!alive && s.phase !== 'over') return { blocks: [say('אתם כבר רוחות בכפר. אפשר לצפות, אבל בלי לרמוז!'), { t: 'night', on: s.phase === 'night' }, s.msg ? text(s.msg) : null, this.aliveList(ctx, s)].filter(Boolean) };
    if (s.phase === 'night') {
      const targets = (f) => s.alive.filter(f).map(id => row(ctx, id));
      let task;
      if (role === 'killer') {
        const mates = s.order.filter(id => s.roles[id] === 'killer' && id !== pid && s.alive.includes(id));
        task = [h('את מי מחסלים הלילה?'), { t: 'choices', act: 'kill', selected: s.kills[pid], items: targets(id => s.roles[id] !== 'killer') },
          ...mates.map(id => text(`${ctx.name(id)} בחר/ה: ${s.kills[id] ? ctx.name(s.kills[id]) : 'עוד לא'}`, true))];
      } else if (role === 'doctor') task = [h('את מי מצילים הלילה?'), { t: 'choices', act: 'save', selected: s.save, items: targets(() => true) }];
      else if (role === 'detective') task = [h('את מי בודקים הלילה?'), { t: 'choices', act: 'check', selected: s.check, items: targets(id => id !== pid) }];
      else task = [text('הכפר ישן. גם אתם יכולים ללחוץ פה כדי שאף אחד לא ינחש מי עושה מה 🙂', true), { t: 'choices', act: 'noop', items: shuffle(s.alive).slice(0, 3).map(id => row(ctx, id)) }];
      return { blocks: [{ t: 'night', on: true }, say('לילה בכפר. כל אחד מסתכל רק בטלפון שלו.'), this.roleBlock(s, pid, ctx), ...task] };
    }
    if (s.phase === 'day') {
      const mine = role === 'detective' && s.checks[pid] ? s.checks[pid] : [];
      return { blocks: [say(s.msg), this.roleBlock(s, pid, ctx), ...mine.map(c => text(`🔎 בדקת את ${ctx.name(c.id)}: ${c.killer ? 'רוצח/ת!' : 'לא רוצח/ת'}`)),
        h('מי יוצא מהכפר?'), { t: 'choices', act: 'vote', selected: s.votes[pid], items: [...others(s.alive, pid).map(id => row(ctx, id)), { id: 'none', name: 'אף אחד היום' }] },
        text(`הצביעו ${Object.keys(s.votes).length} מתוך ${s.alive.length}`, true), this.aliveList(ctx, s)] };
    }
    return { blocks: [say(s.msg)] };
  },
  nightDone(s) {
    const need = s.alive.filter(id => s.roles[id] !== 'villager');
    return need.every(id => s.roles[id] === 'killer' ? s.kills[id] : s.roles[id] === 'doctor' ? s.save : s.check);
  },
  resolveNight(ctx) {
    const s = ctx.g.s;
    const killerPicks = {}; s.alive.filter(id => s.roles[id] === 'killer').forEach(id => { if (s.kills[id]) killerPicks[id] = s.kills[id]; });
    const firstPick = Object.values(killerPicks)[0];
    const victim = tally(killerPicks).best || firstPick || null;
    const det = s.alive.find(id => s.roles[id] === 'detective');
    if (det && s.check) (s.checks[det] = s.checks[det] || []).push({ id: s.check, killer: s.roles[s.check] === 'killer' });
    if (victim && victim !== s.save) { s.alive = s.alive.filter(id => id !== victim); s.msg = `☀️ בוקר טוב. בלילה ${ctx.name(victim)} נרצח/ה. דברו ביניכם והצביעו.`; }
    else s.msg = victim ? '☀️ בוקר טוב. הרוצחים תקפו, אבל הרופא/ה הציל/ה את הקורבן! אף אחד לא מת.' : '☀️ בוקר טוב. לילה שקט, אף אחד לא מת.';
    s.kills = {}; s.save = null; s.check = null; s.votes = {};
    if (!this.checkWin(ctx)) s.phase = 'day';
  },
  checkWin(ctx) {
    const s = ctx.g.s, k = s.alive.filter(id => s.roles[id] === 'killer').length, o = s.alive.length - k;
    if (k && k < o) return false;
    const killersWin = k > 0;
    const reveal = s.order.filter(id => s.roles[id] === 'killer').map(id => ctx.name(id)).join(' ו');
    const aw = Object.fromEntries(s.order.map(id => [id, (s.roles[id] === 'killer') === killersWin ? 3 : 0]));
    ctx.finish(aw, killersWin ? `הרוצחים השתלטו על הכפר! ${reveal} ניצחו. 3 נקודות לכל רוצח.` : `הכפר ניצח! הרוצחים היו ${reveal}. 3 נקודות לכל תושבי הכפר.`);
    return true;
  },
  closeDay(ctx) {
    const s = ctx.g.s, { best } = tally(s.votes);
    if (best && best !== 'none') { s.alive = s.alive.filter(id => id !== best); s.msg = `הכפר הוציא את ${ctx.name(best)}, שהיה/תה ${ROLES[s.roles[best]][0]}.`; }
    else s.msg = 'הכפר לא הצליח להחליט. אף אחד לא יצא.';
    s.votes = {};
    if (!this.checkWin(ctx)) { s.phase = 'night'; s.night++; }
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, role = s.roles[pid];
    if (s.phase === 'roles' && m.act === 'night' && ctx.isHost(pid)) { s.phase = 'night'; s.night = 1; return; }
    if (!s.alive.includes(pid)) return;
    if (s.phase === 'night') {
      const ok = s.alive.includes(m.id);
      if (m.act === 'kill' && role === 'killer' && ok && s.roles[m.id] !== 'killer') s.kills[pid] = m.id;
      else if (m.act === 'save' && role === 'doctor' && ok) s.save = m.id;
      else if (m.act === 'check' && role === 'detective' && ok && m.id !== pid) s.check = m.id;
      if (this.nightDone(s)) this.resolveNight(ctx);
    } else if (s.phase === 'day' && m.act === 'vote' && (m.id === 'none' || (s.alive.includes(m.id) && m.id !== pid))) {
      s.votes[pid] = m.id;
      if (Object.keys(s.votes).length >= s.alive.length) this.closeDay(ctx);
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'roles') { s.phase = 'night'; s.night = 1; } else if (s.phase === 'night') this.resolveNight(ctx); else if (s.phase === 'day') this.closeDay(ctx); },
};

/* ============ עובדה או בדיה ============ */
G.fake = {
  id: 'fake', name: 'עובדה או בדיה', icon: '🧐', min: 3, max: 12,
  start(ctx) { return { phase: 'write', round: 1, rounds: 3, facts: shuffle(C.FACTS), fakes: {}, picks: {}, options: [], pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), order: ctx.ids.slice() }; },
  fact(s) { return s.facts[(s.round - 1) % s.facts.length]; },
  view(ctx, pid) {
    const s = ctx.g.s, [q, a] = this.fact(s);
    const scores = { t: 'players', items: s.order.slice().sort((x, y) => s.pts[y] - s.pts[x]).map(id => row(ctx, id, { right: s.pts[id], tag: s.phase === 'write' && s.fakes[id] ? '✔' : s.phase === 'pick' && s.picks[id] ? '✔' : '', tone: 'ok' })) };
    const head = [text(`שאלה ${s.round} מתוך ${s.rounds}`, true), big(q)];
    if (s.phase === 'write') return { blocks: [say('השלימו את החסר בתשובה מזויפת ומשכנעת. אחר כך כולם ינסו למצוא את האמת, וכל מי שנופל בבדיה שלכם שווה לכם נקודה.'), ...head,
      s.fakes[pid] ? text(`כתבת: "${s.fakes[pid]}". מחכים לשאר…`, true) : { t: 'input', act: 'fake', placeholder: 'תשובה מזויפת', button: 'שליחה', max: 30 }, scores] };
    if (s.phase === 'pick') return { blocks: [say('איזו תשובה אמיתית? אמת שווה 2 נקודות.'), ...head,
      { t: 'choices', act: 'pick', selected: s.picks[pid], items: s.options.map(o => ({ id: o.id, name: o.text, disabled: o.authors.includes(pid), sub: o.authors.includes(pid) ? 'התשובה שלך' : '' })) }, scores] };
    return { blocks: [say(`התשובה האמיתית: "${a}"!`), ...head,
      { t: 'list', items: s.options.map(o => ({ name: o.truth ? '✔ האמת' : o.authors.map(id => ctx.name(id)).join(', '), color: o.truth ? '#6fa58c' : ctx.p(o.authors[0]).color, text: `${o.text} · ${s.order.filter(id => s.picks[id] === o.id).map(id => ctx.name(id)).join(', ') || 'אף אחד'}` })) },
      scores, hostNext(ctx, pid, s.round < s.rounds ? 'לשאלה הבאה ▶' : 'לתוצאות 🏁')] };
  },
  buildOptions(s) {
    const [, a] = this.fact(s), opts = [{ id: 't', text: a, authors: [], truth: true }];
    for (const id in s.fakes) { const ex = opts.find(o => !o.truth && norm(o.text) === norm(s.fakes[id])); if (ex) ex.authors.push(id); else opts.push({ id: 'o' + opts.length, text: s.fakes[id], authors: [id] }); }
    s.options = shuffle(opts); s.phase = 'pick';
  },
  score(s) {
    for (const id in s.picks) { const o = s.options.find(x => x.id === s.picks[id]); if (!o) continue; if (o.truth) s.pts[id] += 2; else o.authors.forEach(a => s.pts[a]++); }
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'write' && m.act === 'fake' && !s.fakes[pid]) {
      const t = cut(m.value, 30); if (!t) return;
      if (norm(t) === norm(this.fact(s)[1])) return ctx.error(pid, 'וואו, זו בדיוק התשובה האמיתית! כתבו משהו אחר.');
      s.fakes[pid] = t;
      if (s.order.every(id => s.fakes[id])) this.buildOptions(s);
    } else if (s.phase === 'pick' && m.act === 'pick') {
      const o = s.options.find(x => x.id === m.id); if (!o || o.authors.includes(pid)) return;
      s.picks[pid] = m.id;
      if (s.order.every(id => s.picks[id])) this.score(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.pts), 'עובדה או בדיה נגמר! הנה מי שלקח נקודות ערב:');
      s.round++; s.fakes = {}; s.picks = {}; s.options = []; s.phase = 'write';
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'write') this.buildOptions(s); else if (s.phase === 'pick') this.score(s); },
};

/* ============ ספרינט מילים ============ */
const TEAMS = { A: 'האפורים', B: 'החומים' };
G.race = {
  id: 'race', name: 'ספרינט מילים', icon: '⏱️', min: 4, max: 16,
  start(ctx) {
    const ids = shuffle(ctx.ids), A = ids.filter((_, i) => i % 2 === 0), B = ids.filter((_, i) => i % 2 === 1);
    return { phase: 'ready', teams: { A, B }, team: 'A', idx: { A: 0, B: 0 }, turn: 0, turns: 6, words: shuffle(C.RACE_WORDS), w: 0, score: { A: 0, B: 0 }, turnGot: 0, end: 0 };
  },
  teamOf(s, id) { return s.teams.A.includes(id) ? 'A' : 'B'; },
  explainer(s) { const t = s.teams[s.team]; return t[s.idx[s.team] % t.length]; },
  view(ctx, pid) {
    const s = ctx.g.s, ex = this.explainer(s), me = pid === ex, mt = this.teamOf(s, pid);
    const board = { t: 'players', items: ['A', 'B'].flatMap(T => s.teams[T].map(id => row(ctx, id, { tag: TEAMS[T], tone: T === 'A' ? 'muted' : 'turn', right: id === ex ? '🎤' : '' }))) };
    const sc = big(`${TEAMS.A} ${s.score.A} : ${s.score.B} ${TEAMS.B}`, `תור ${s.turn + 1} מתוך ${s.turns}`);
    if (s.phase === 'ready') return { blocks: [say(`שתי קבוצות: ${TEAMS.A} נגד ${TEAMS.B}. בכל תור מישהו מסביר מילים לקבוצה שלו בלי להגיד אותן. 60 שניות לתור.`), sc,
      me ? btns(btn('▶ מוכן/ה, התחלה', 'go')) : text(`${ctx.name(ex)} מ${TEAMS[s.team]} מסביר/ה עכשיו${mt === s.team ? '. זו הקבוצה שלך!' : ''}`), board] };
    if (s.phase === 'live') {
      if (me) return { blocks: [timer(s.end), { t: 'secret', tone: 'word', title: 'הסבירו בלי להגיד:', text: s.words[s.w % s.words.length] },
        btns(btn('✔ ניחשו', 'hit', 'main'), btn('דילוג', 'skip', 'ghost')), text(`${s.turnGot} מילים בתור הזה`, true)] };
      return { blocks: [timer(s.end), big(mt === s.team ? 'נחשו!' : 'תקשיבו שלא יגידו את המילה 👂', `${ctx.name(ex)} מסביר/ה · ${s.turnGot} מילים`), sc] };
    }
    return { blocks: [say(`נגמר הזמן! ${TEAMS[s.team]} הרוויחו ${s.turnGot} נקודות בתור הזה.`), sc, board,
      (ctx.isHost(pid) || me) ? btns(btn(s.turn + 1 < s.turns ? 'לתור הבא ▶' : 'לתוצאות 🏁', 'next')) : text('מחכים להמשך…', true)] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, ex = this.explainer(s);
    if (s.phase === 'ready' && m.act === 'go' && pid === ex) {
      s.phase = 'live'; s.turnGot = 0; s.end = Date.now() + 60000; const t = s.turn;
      ctx.later(60000, () => { if (s.turn === t && s.phase === 'live') s.phase = 'done'; });
    } else if (s.phase === 'live' && pid === ex) {
      if (m.act === 'hit') { s.score[s.team]++; s.turnGot++; s.w++; } else if (m.act === 'skip') s.w++;
    } else if (s.phase === 'done' && m.act === 'next' && (pid === ex || ctx.isHost(pid))) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.turn + 1 >= s.turns) {
      const win = s.score.A === s.score.B ? null : s.score.A > s.score.B ? 'A' : 'B';
      const aw = Object.fromEntries([...s.teams.A, ...s.teams.B].map(id => [id, !win ? 2 : this.teamOf(s, id) === win ? 3 : 1]));
      return ctx.finish(aw, win ? `${TEAMS[win]} ניצחו ${Math.max(s.score.A, s.score.B)} מול ${Math.min(s.score.A, s.score.B)}! 3 נקודות לכל מנצח ונקודה לכל השאר.` : 'תיקו! 2 נקודות לכולם.');
    }
    s.idx[s.team]++; s.team = s.team === 'A' ? 'B' : 'A'; s.turn++; s.phase = 'ready';
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'live') s.phase = 'done'; else this.next(ctx); },
};

/* ============ בין הקצוות ============ */
G.scale = {
  id: 'scale', name: 'בין הקצוות', icon: '📏', min: 2, max: 12,
  start(ctx) { return { phase: 'clue', order: shuffle(ctx.ids), i: 0, rounds: Math.min(ctx.ids.length, 6), pairs: shuffle(C.SCALE_PAIRS), target: 5 + rnd(91), clue: '', guesses: {}, pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), last: {} }; },
  ptsFor: d => d <= 5 ? 4 : d <= 12 ? 3 : d <= 20 ? 2 : 0,
  view(ctx, pid) {
    const s = ctx.g.s, giver = s.order[s.i], me = pid === giver, [L, R] = s.pairs[s.i % s.pairs.length];
    const scores = { t: 'players', items: s.order.slice().sort((a, b) => s.pts[b] - s.pts[a]).map(id => row(ctx, id, { right: s.pts[id], tag: id === giver ? 'נותן/ת רמז' : (s.phase === 'guess' && id in s.guesses ? '✔' : ''), tone: 'ok' })) };
    if (s.phase === 'clue') return { blocks: [say('על הסקאלה יש נקודה סודית. נותן הרמז כותב מילה או ביטוי שממקמים אותה, וכולם מנסים לכוון בדיוק.'),
      text(`סבב ${s.i + 1} מתוך ${s.rounds}`, true),
      me ? { t: 'slider', left: L, right: R, target: s.target } : { t: 'slider', left: L, right: R },
      me ? { t: 'input', act: 'clue', placeholder: 'רמז שממקם את הנקודה', button: 'שליחה', max: 30 } : text(`${ctx.name(giver)} חושב/ת על רמז…`, true), scores] };
    if (s.phase === 'guess') return { blocks: [big(`"${s.clue}"`, `הרמז של ${ctx.name(giver)}`),
      me ? { t: 'slider', left: L, right: R, target: s.target } : { t: 'slider', left: L, right: R, act: 'guess', value: s.guesses[pid], done: pid in s.guesses },
      text(`כיוונו ${Object.keys(s.guesses).length} מתוך ${s.order.length - 1}`, true), scores] };
    return { blocks: [say(`הנקודה הייתה ב־${s.target}. ${ctx.name(giver)} קיבל/ה ${s.last[giver] || 0} נקודות.`), big(`"${s.clue}"`),
      { t: 'slider', left: L, right: R, target: s.target, marks: Object.entries(s.guesses).map(([id, v]) => ({ name: ctx.name(id), color: ctx.p(id).color, v })) },
      { t: 'players', items: others(s.order, giver).map(id => row(ctx, id, { right: '+' + (s.last[id] || 0), sub: id in s.guesses ? `כיוון/ה ל־${s.guesses[id]}` : 'לא כיוון/ה' })) },
      hostNext(ctx, pid, s.i + 1 < s.rounds ? 'לסבב הבא ▶' : 'לתוצאות 🏁')] };
  },
  reveal(s) {
    s.last = {}; const got = [];
    for (const id in s.guesses) { const p = this.ptsFor(Math.abs(s.guesses[id] - s.target)); s.last[id] = p; s.pts[id] += p; got.push(p); }
    const g = s.order[s.i]; s.last[g] = got.length ? Math.round(got.reduce((a, b) => a + b, 0) / got.length) : 0; s.pts[g] += s.last[g];
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, giver = s.order[s.i];
    if (s.phase === 'clue' && m.act === 'clue' && pid === giver) { const t = cut(m.value, 30); if (!t) return; s.clue = t; s.phase = 'guess'; }
    else if (s.phase === 'guess' && m.act === 'guess' && pid !== giver) {
      const v = Math.round(Number(m.value)); if (!(v >= 0 && v <= 100)) return;
      s.guesses[pid] = v;
      if (others(s.order, giver).every(id => id in s.guesses)) this.reveal(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && ctx.isHost(pid)) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.i + 1 >= s.rounds) return ctx.finish(rankAward(s.pts), 'בין הקצוות נגמר! הנה מי שלקח נקודות ערב:');
    s.i++; s.phase = 'clue'; s.clue = ''; s.guesses = {}; s.target = 5 + rnd(91);
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'clue') this.next(ctx); else if (s.phase === 'guess') this.reveal(s); },
};

/* ============ אוצר או כלוב ============ */
const HAZ = [['snake', '🐍', 'נחש'], ['spider', '🕷️', 'עכביש'], ['fire', '🔥', 'אש'], ['rock', '🪨', 'מפולת'], ['ghost', '👻', 'רוח רפאים']];
const GEMS = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17];
G.stash = {
  id: 'stash', name: 'אוצר או כלוב', icon: '💎', min: 3, max: 8,
  start(ctx) { const s = { round: 0, rounds: 3, bank: Object.fromEntries(ctx.ids.map(i => [i, 0])), order: ctx.ids.slice() }; this.newRound(s); return s; },
  newRound(s) {
    s.round++; s.deck = shuffle([...GEMS.map(v => ({ k: 'gem', v })), ...HAZ.flatMap(([h]) => [0, 1, 2].map(() => ({ k: 'haz', h })))]);
    s.path = []; s.cave = s.order.slice(); s.haul = Object.fromEntries(s.order.map(i => [i, 0])); s.dec = {}; s.phase = 'decide'; s.msg = '';
    this.reveal(s);
  },
  reveal(s) {
    const c = s.deck.pop(); s.path.push(c);
    if (c.k === 'gem') {
      const each = Math.floor(c.v / s.cave.length); c.left = c.v - each * s.cave.length;
      s.cave.forEach(id => s.haul[id] += each);
      s.msg = `💎 ${c.v} יהלומים! כל מי שבמערה מקבל ${each}${c.left ? `, ו־${c.left} נשארים על הרצפה` : ''}.`;
    } else {
      const [, ic, nm] = HAZ.find(x => x[0] === c.h);
      if (s.path.filter(x => x.k === 'haz' && x.h === c.h).length >= 2) { c.dup = true; s.msg = `${ic} ${nm} בפעם השנייה! כל מי שנשאר במערה בורח בידיים ריקות.`; s.cave.forEach(id => s.haul[id] = 0); s.cave = []; s.phase = 'roundEnd'; }
      else s.msg = `${ic} ${nm}! עוד אחד כזה וכולם בורחים.`;
    }
  },
  view(ctx, pid) {
    const s = ctx.g.s, inCave = s.cave.includes(pid);
    const path = { t: 'cards', items: s.path.map(c => ({ v: c.k === 'gem' ? `💎${c.left || ''}` : HAZ.find(x => x[0] === c.h)[1], dup: c.dup, small: true })) };
    const list = { t: 'players', items: s.order.slice().sort((a, b) => s.bank[b] - s.bank[a]).map(id => row(ctx, id, { right: s.bank[id], sub: s.cave.includes(id) ? 'במערה' : 'בחוץ', tag: s.phase === 'decide' && s.cave.includes(id) && s.dec[id] ? 'החליט/ה' : '', tone: s.cave.includes(id) ? 'turn' : 'muted' })) };
    if (s.phase === 'roundEnd') return { blocks: [say(`${s.msg} סוף מסע ${s.round} מתוך ${s.rounds}.`), path, h('אוצר בכספת'), list, hostNext(ctx, pid, s.round < s.rounds ? 'למסע הבא ▶' : 'לתוצאות 🏁')] };
    return { blocks: [say(s.msg), text(`מסע ${s.round} מתוך ${s.rounds} · ${s.cave.length} במערה`, true), path,
      inCave ? big(`השלל שלך: ${s.haul[pid]} 💎`, 'עוד לא בכספת') : text('יצאת מהמערה. השלל שלך כבר בכספת.', true),
      inCave ? (s.dec[pid] ? text(`החלטת ${s.dec[pid] === 'stay' ? 'להמשיך' : 'לצאת'}. מחכים לשאר…`, true) : btns(btn('⛏️ ממשיכים', 'stay', 'main'), btn('🏃 יוצאים עם השלל', 'leave', 'ghost'))) : null,
      h('אוצר בכספת'), list].filter(Boolean) };
  },
  resolve(s) {
    const leavers = s.cave.filter(id => s.dec[id] !== 'stay');
    if (leavers.length) {
      let floor = 0; s.path.forEach(c => { if (c.left) { const each = Math.floor(c.left / leavers.length); floor += each; c.left -= each * leavers.length; } });
      leavers.forEach(id => { s.bank[id] += s.haul[id] + floor; s.haul[id] = 0; });
      s.cave = s.cave.filter(id => !leavers.includes(id));
    }
    s.dec = {};
    const out = leavers.length ? `יצאו: ${leavers.length}. ` : '';
    if (!s.cave.length || !s.deck.length) { s.cave.forEach(id => { s.bank[id] += s.haul[id]; s.haul[id] = 0; }); s.cave = []; s.phase = 'roundEnd'; s.msg = out + 'כולם בחוץ.'; return; }
    this.reveal(s); s.msg = out + s.msg;
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'decide' && s.cave.includes(pid) && (m.act === 'stay' || m.act === 'leave') && !s.dec[pid]) {
      s.dec[pid] = m.act;
      if (s.cave.every(id => s.dec[id])) this.resolve(s);
    } else if (s.phase === 'roundEnd' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.bank), 'המסעות נגמרו! הנה מי שיצא הכי עשיר:');
      this.newRound(s);
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'decide') this.resolve(s); },
};

/* ============ מפעל הממים ============ */
const REACTS = [['fire', '🔥', 3], ['lol', '🤣', 2], ['meh', '😐', 1], ['poop', '💩', 0]];
G.meme = {
  id: 'meme', name: 'מפעל הממים', icon: '😂', min: 3, max: 14,
  start(ctx) { return { phase: 'write', round: 1, rounds: 3, prompts: shuffle(C.MEME_PROMPTS), caps: {}, votes: {}, capOrder: [], pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), last: {}, order: ctx.ids.slice() }; },
  view(ctx, pid) {
    const s = ctx.g.s, [emo, sit] = s.prompts[(s.round - 1) % s.prompts.length];
    const scene = { t: 'meme', emoji: emo, text: sit };
    const scores = { t: 'players', items: s.order.slice().sort((a, b) => s.pts[b] - s.pts[a]).map(id => row(ctx, id, { right: s.pts[id], tag: s.phase === 'write' && s.caps[id] ? '✔' : '' , tone: 'ok' })) };
    if (s.phase === 'write') return { blocks: [say('כתבו את הכיתוב הכי מצחיק לסצנה. אחר כך כולם מדרגים בלי לדעת מי כתב.'), text(`סבב ${s.round} מתוך ${s.rounds}`, true), scene,
      s.caps[pid] ? text(`כתבת: "${s.caps[pid]}". מחכים לשאר…`, true) : { t: 'input', act: 'cap', placeholder: 'הכיתוב שלך', button: 'שליחה', max: 60 }, scores] };
    if (s.phase === 'vote') return { blocks: [say('דרגו כל כיתוב: 🔥 3 נק׳, 🤣 2, 😐 1, 💩 0'), scene,
      { t: 'react', act: 'react', options: REACTS.map(([k, e]) => ({ k, e })), items: s.capOrder.map(id => ({ id, text: s.caps[id], mine: id === pid, picked: (s.votes[pid] || {})[id] })) }, scores] };
    return { blocks: [say('הנה מי כתב מה:'), scene,
      { t: 'list', items: s.capOrder.slice().sort((a, b) => s.last[b] - s.last[a]).map(id => ({ name: `${ctx.name(id)} +${s.last[id]}`, color: ctx.p(id).color, text: s.caps[id] })) },
      scores, hostNext(ctx, pid, s.round < s.rounds ? 'לסבב הבא ▶' : 'לתוצאות 🏁')] };
  },
  toVote(s) { s.capOrder = shuffle(Object.keys(s.caps)); s.votes = {}; s.phase = s.capOrder.length ? 'vote' : 'reveal'; if (!s.capOrder.length) s.last = {}; },
  allVoted(s) { return s.order.every(v => s.capOrder.every(c => c === v || (s.votes[v] || {})[c])); },
  score(s) {
    s.last = Object.fromEntries(s.capOrder.map(id => [id, 0]));
    for (const v in s.votes) for (const c in s.votes[v]) { const r = REACTS.find(x => x[0] === s.votes[v][c]); if (r && c !== v && c in s.last) s.last[c] += r[2]; }
    for (const id in s.last) s.pts[id] += s.last[id];
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'write' && m.act === 'cap' && !s.caps[pid]) {
      const t = cut(m.value, 60); if (!t) return;
      s.caps[pid] = t;
      if (s.order.every(id => s.caps[id])) this.toVote(s);
    } else if (s.phase === 'vote' && m.act === 'react' && s.capOrder.includes(m.id) && m.id !== pid && REACTS.some(r => r[0] === m.k)) {
      (s.votes[pid] = s.votes[pid] || {})[m.id] = m.k;
      if (this.allVoted(s)) this.score(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.pts), 'מפעל הממים נסגר להערב! הנה הקומיקאים:');
      s.round++; s.caps = {}; s.votes = {}; s.phase = 'write';
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'write') this.toVote(s); else if (s.phase === 'vote') this.score(s); },
};

/* ============ אתגר מהכובע ============ */
G.dare = {
  id: 'dare', name: 'אתגר מהכובע', icon: '🎩', min: 2, max: 20,
  start(ctx) {
    const order = shuffle(ctx.ids), seq = ctx.ids.length <= 5 ? [...order, ...order] : order;
    return { phase: 'show', seq, i: 0, dares: shuffle(C.DARES), d: 0, swapped: false, votes: {}, pts: Object.fromEntries(ctx.ids.map(i => [i, 0])), result: null, order };
  },
  view(ctx, pid) {
    const s = ctx.g.s, cur = s.seq[s.i], me = pid === cur, dare = s.dares[s.d % s.dares.length];
    const scores = { t: 'players', items: s.order.slice().sort((a, b) => s.pts[b] - s.pts[a]).map(id => row(ctx, id, { right: s.pts[id], tag: id === cur ? 'מבצע/ת' : (s.phase === 'vote' && s.votes[id] ? '✔' : ''), tone: 'turn' })) };
    const card = { t: 'secret', tone: 'word', title: `האתגר של ${ctx.name(cur)}`, text: dare };
    if (s.phase === 'show') return { blocks: [say('שלפתי אתגר מהכובע! מבצעים מול כולם, והחדר מצביע אם זה נחשב.'), text(`אתגר ${s.i + 1} מתוך ${s.seq.length}`, true), card,
      me ? btns(btn('✔ סיימתי, תצביעו', 'done', 'main'), s.swapped ? null : btn('🔄 אתגר אחר', 'swap', 'ghost')) : text(`${ctx.name(cur)} מבצע/ת…`, true), scores] };
    if (s.phase === 'vote') return { blocks: [card,
      me ? text('החדר מצביע…', true) : { t: 'choices', act: 'vote', selected: s.votes[pid], items: [{ id: 'yes', name: '👏 ביצע/ה, נחשב!' }, { id: 'no', name: '👎 לא נחשב' }] },
      text(`הצביעו ${Object.keys(s.votes).length} מתוך ${s.order.length - 1}`, true), scores] };
    return { blocks: [big(s.result ? `${ctx.name(cur)} +1 🎉` : `${ctx.name(cur)} לא קיבל/ה נקודה`), card, scores,
      (ctx.isHost(pid) || me) ? btns(btn(s.i + 1 < s.seq.length ? 'לאתגר הבא ▶' : 'לתוצאות 🏁', 'next')) : text('מחכים להמשך…', true)] };
  },
  close(s) {
    const yes = Object.values(s.votes).filter(v => v === 'yes').length, no = Object.values(s.votes).filter(v => v === 'no').length;
    s.result = yes > no; if (s.result) s.pts[s.seq[s.i]]++; s.phase = 'result';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, cur = s.seq[s.i];
    if (s.phase === 'show' && pid === cur) { if (m.act === 'done') { s.phase = 'vote'; s.votes = {}; } else if (m.act === 'swap' && !s.swapped) { s.swapped = true; s.d++; } }
    else if (s.phase === 'vote' && m.act === 'vote' && pid !== cur && (m.id === 'yes' || m.id === 'no')) {
      s.votes[pid] = m.id;
      if (others(s.order, cur).every(id => s.votes[id])) this.close(s);
    } else if (s.phase === 'result' && m.act === 'next' && (pid === cur || ctx.isHost(pid))) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.i + 1 >= s.seq.length) return ctx.finish(rankAward(s.pts), 'הכובע ריק! הנה האמיצים של הערב:');
    s.i++; s.d++; s.swapped = false; s.phase = 'show';
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'show') { s.phase = 'vote'; s.votes = {}; } else if (s.phase === 'vote') this.close(s); else this.next(ctx); },
};

/* ============ shared helpers for the second batch ============ */
const zero = ids => Object.fromEntries(ids.map(i => [i, 0]));
// evening points where the LOWEST score wins: 3 / 2 / 1, ties share
function rankAwardLow(scores) {
  const vals = [...new Set(Object.values(scores))].sort((a, b) => a - b);
  const out = {};
  for (const id in scores) { const r = vals.indexOf(scores[id]); out[id] = r < 3 ? 3 - r : 0; }
  return out;
}
const scoreRows = (ctx, ids, pts, extra = () => ({})) => ({ t: 'players', items: ids.slice().sort((a, b) => pts[b] - pts[a]).map(id => row(ctx, id, { right: pts[id], tone: 'ok', ...extra(id) })) });
const nextIn = (order, cur, ok) => { for (let k = 1; k <= order.length; k++) { const id = order[(order.indexOf(cur) + k) % order.length]; if (ok(id)) return id; } return null; };

/* ============ התאמת המונים ============ */
const herdKey = t => { let k = norm(t); if (k.length >= 3 && k[0] === 'ה') k = k.slice(1); return k; };
G.herd = {
  id: 'herd', name: 'התאמת המונים', icon: '🐑', min: 3, max: 16,
  start(ctx) { return { phase: 'write', round: 1, rounds: 5, qs: shuffle(C.HERD_QUESTIONS), ans: {}, groups: [], win: [], pts: zero(ctx.ids), order: ctx.ids.slice() }; },
  view(ctx, pid) {
    const s = ctx.g.s, q = s.qs[(s.round - 1) % s.qs.length];
    const scores = scoreRows(ctx, s.order, s.pts, id => ({ tag: s.phase === 'write' && s.ans[id] ? '✔' : '' }));
    if (s.phase === 'write') return { blocks: [say('תענו מה שרוב החדר יענה. כל מי שנמצא בקבוצה הכי גדולה של תשובות זהות מקבל נקודה.'), text(`שאלה ${s.round} מתוך ${s.rounds}`, true), big(q),
      s.ans[pid] ? text(`ענית: "${s.ans[pid]}". מחכים לשאר…`, true) : { t: 'input', act: 'ans', placeholder: 'התשובה שלך', button: 'שליחה', max: 24 }, scores] };
    return { blocks: [say(s.win.length ? `העדר אמר "${s.groups[0].label}"! נקודה ל${s.win.map(id => ctx.name(id)).join(', ')}.` : 'אין קבוצה אחת הכי גדולה, אז הפעם אף אחד לא מקבל נקודה.'), big(q),
      { t: 'list', items: s.groups.map((g, i) => ({ name: `${g.label} ×${g.ids.length}`, color: i === 0 && s.win.length ? '#8fb39a' : '#8a847d', text: g.ids.map(id => ctx.name(id)).join(', '), tone: i === 0 && s.win.length ? 'ok' : '' })) },
      scores, hostNext(ctx, pid, s.round < s.rounds ? 'לשאלה הבאה ▶' : 'לתוצאות 🏁')] };
  },
  reveal(s) {
    const m = {};
    for (const id in s.ans) { const k = herdKey(s.ans[id]); (m[k] = m[k] || { label: s.ans[id], ids: [] }).ids.push(id); }
    s.groups = Object.values(m).sort((a, b) => b.ids.length - a.ids.length);
    const [top, second] = s.groups;
    s.win = top && top.ids.length > 1 && !(second && second.ids.length === top.ids.length) ? top.ids : [];
    s.win.forEach(id => s.pts[id]++);
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'write' && m.act === 'ans' && !s.ans[pid]) {
      const t = cut(m.value, 24); if (!t) return;
      s.ans[pid] = t;
      if (s.order.every(id => s.ans[id])) this.reveal(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.pts), 'העדר דיבר! הנה מי שחושב הכי כמו כולם:');
      s.round++; s.ans = {}; s.phase = 'write';
    }
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'write') this.reveal(s); },
};

/* ============ צלייה חמה ============ */
G.roast = {
  id: 'roast', name: 'צלייה חמה', icon: '🔥', min: 3, max: 16,
  start(ctx) {
    const ids = shuffle(ctx.ids), n = ids.length, prompts = shuffle(C.ROAST_PROMPTS), duels = [];
    if (n <= 8) for (let i = 0; i < n; i++) duels.push({ q: prompts[i % prompts.length], a: ids[i], b: ids[(i + 1) % n] });
    else for (let i = 0; i + 1 < n; i += 2) duels.push({ q: prompts[(i / 2) % prompts.length], a: ids[i], b: ids[i + 1] });
    duels.forEach((d, i) => { d.id = 'q' + i; d.ans = {}; d.votes = {}; });
    return { phase: 'write', duels, d: 0, pts: zero(ctx.ids), order: ctx.ids.slice(), bonus: false };
  },
  mine(s, pid) { return s.duels.filter(d => d.a === pid || d.b === pid); },
  voters(s, d) { return s.order.filter(id => id !== d.a && id !== d.b); },
  view(ctx, pid) {
    const s = ctx.g.s, scores = scoreRows(ctx, s.order, s.pts);
    if (s.phase === 'write') {
      const todo = this.mine(s, pid).filter(d => !d.ans[pid]);
      return { blocks: [say('כל שאלה הולכת לשני שחקנים. כתבו את התשובה הכי מצחיקה, והחדר יצביע מי ניצח בדו־קרב.'),
        ...(todo.length ? [big(todo[0].q), { t: 'input', act: 'ans', id: todo[0].id, placeholder: 'התשובה הכי מצחיקה שלך', button: 'שליחה', max: 60 }, text(`נשארו לך ${todo.length} ${todo.length === 1 ? 'שאלה' : 'שאלות'}`, true)]
          : [text(this.mine(s, pid).length ? 'שלחת הכול! מחכים לשאר…' : 'הפעם אין לך שאלה. תצביעו בדו־קרבות!', true)]), scores] };
    }
    const d = s.duels[s.d], A = d.ans[d.a] || '(לא ענה/תה בזמן)', B = d.ans[d.b] || '(לא ענה/תה בזמן)';
    if (s.phase === 'vote') {
      const author = pid === d.a || pid === d.b;
      return { blocks: [text(`דו־קרב ${s.d + 1} מתוך ${s.duels.length}`, true), big(d.q),
        author ? { t: 'list', items: [{ name: 'א', text: A }, { name: 'ב', text: B }] } : { t: 'choices', act: 'vote', selected: d.votes[pid], items: [{ id: 'a', name: A }, { id: 'b', name: B }] },
        text(author ? 'זה הדו־קרב שלך! מחכים להצבעות…' : `הצביעו ${Object.keys(d.votes).length} מתוך ${this.voters(s, d).length}`, true)] };
    }
    const va = Object.values(d.votes).filter(v => v === 'a').length, vb = Object.values(d.votes).filter(v => v === 'b').length;
    return { blocks: [say(va === vb ? 'תיקו! שניהם מצחיקים באותה מידה.' : `${ctx.name(va > vb ? d.a : d.b)} ניצח/ה בדו־קרב${s.bonus ? ' עם צלייה מושלמת! +1 בונוס' : ''}.`), big(d.q),
      { t: 'list', items: [[d.a, A, va], [d.b, B, vb]].map(([id, t, v]) => ({ name: `${ctx.name(id)} · ${v} ${v === 1 ? 'קול' : 'קולות'}`, color: ctx.p(id).color, text: t, tone: v > (v === va ? vb : va) ? 'ok' : '' })) },
      scores, hostNext(ctx, pid, s.d + 1 < s.duels.length ? 'לדו־קרב הבא ▶' : 'לתוצאות 🏁')] };
  },
  toVote(s) { s.phase = 'vote'; s.d = 0; },
  score(s) {
    const d = s.duels[s.d], vs = Object.values(d.votes), va = vs.filter(v => v === 'a').length, vb = vs.filter(v => v === 'b').length;
    s.pts[d.a] += va; s.pts[d.b] += vb;
    const all = this.voters(s, d).length;
    s.bonus = all > 1 && (va === all || vb === all);
    if (s.bonus) s.pts[va === all ? d.a : d.b] += 1;
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'write' && m.act === 'ans') {
      const d = s.duels.find(x => x.id === m.id && (x.a === pid || x.b === pid)); if (!d || d.ans[pid]) return;
      const t = cut(m.value, 60); if (!t) return;
      d.ans[pid] = t;
      if (s.duels.every(x => x.ans[x.a] && x.ans[x.b])) this.toVote(s);
    } else if (s.phase === 'vote' && m.act === 'vote' && (m.id === 'a' || m.id === 'b')) {
      const d = s.duels[s.d]; if (pid === d.a || pid === d.b) return;
      d.votes[pid] = m.id;
      if (this.voters(s, d).every(id => d.votes[id])) this.score(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && ctx.isHost(pid)) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.d + 1 >= s.duels.length) return ctx.finish(rankAward(s.pts), 'הצלייה הסתיימה! הנה הקומיקאים של הערב:');
    s.d++; s.phase = 'vote';
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'write') this.toVote(s); else if (s.phase === 'vote') this.score(s); else this.next(ctx); },
};

/* ============ מילות קוד ============ */
const CODE_WORDS = [...new Set([...C.DRAW_WORDS, ...C.RACE_WORDS, ...Object.values(C.CATEGORY_WORDS).flat()])].filter(w => !w.includes(' '));
G.codes = {
  id: 'codes', name: 'מילות קוד', icon: '🗝️', min: 4, max: 10,
  start(ctx) {
    const ids = shuffle(ctx.ids), A = ids.filter((_, i) => i % 2 === 0), B = ids.filter((_, i) => i % 2 === 1);
    const first = Math.random() < 0.5 ? 'A' : 'B', other = first === 'A' ? 'B' : 'A';
    const keys = shuffle([...Array(9).fill(first), ...Array(8).fill(other), ...Array(7).fill('N'), 'X']);
    return { phase: 'clue', teams: { A, B }, spy: { A: A[0], B: B[0] }, team: first, tiles: shuffle(CODE_WORDS).slice(0, 25).map((w, i) => ({ id: 't' + i, w, k: keys[i], open: false })), clue: '', left: 0, last: '' };
  },
  teamOf(s, id) { return s.teams.A.includes(id) ? 'A' : 'B'; },
  remaining(s, T) { return s.tiles.filter(t => t.k === T && !t.open).length; },
  view(ctx, pid) {
    const s = ctx.g.s, T = this.teamOf(s, pid), isSpy = s.spy[T] === pid, mineTurn = T === s.team;
    const canGuess = s.phase === 'guess' && mineTurn && !isSpy;
    const grid = { t: 'grid', act: canGuess ? 'guess' : null, spy: isSpy, items: s.tiles.map(t => ({ id: t.id, text: t.w, k: isSpy || t.open ? t.k : null, open: t.open })) };
    const head = big(`${TEAMS.A} ${this.remaining(s, 'A')} · ${this.remaining(s, 'B')} ${TEAMS.B}`, `נשארו מילים לגלות · תור ${TEAMS[s.team]}`);
    const board = { t: 'players', items: ['A', 'B'].flatMap(X => s.teams[X].map(id => row(ctx, id, { tag: TEAMS[X] + (s.spy[X] === id ? ' · ראש סוכנות' : ''), tone: X === 'A' ? 'muted' : 'turn' }))) };
    const blocks = [];
    if (s.last) blocks.push(say(s.last));
    else blocks.push(say(`שתי סוכנויות: ${TEAMS.A} נגד ${TEAMS.B}. ראש הסוכנות רואה איזו מילה שייכת למי ונותן רמז של מילה אחת ומספר. אל תפגעו במלכודת 💀!`));
    blocks.push(head);
    if (s.phase === 'clue') blocks.push(isSpy && mineTurn ? { t: 'input', act: 'clue', placeholder: 'מילה ומספר, למשל: ים 2', button: 'שליחה', max: 24 } : text(`${ctx.name(s.spy[s.team])} חושב/ת על רמז ל${TEAMS[s.team]}…`, true));
    else blocks.push(big(`"${s.clue}"`, `עוד ${s.left >= 50 ? 'כמה שרוצים' : s.left} ניחושים`), ...(canGuess ? [btns(btn('✋ סיום התור', 'pass', 'ghost'))] : [text(mineTurn ? (isSpy ? 'הקבוצה שלך מנחשת. אסור לרמוז!' : '') : 'הקבוצה השנייה מנחשת…', true)]));
    blocks.push(grid, board);
    return { blocks: blocks.filter(b => b && b.text !== '') };
  },
  endTurn(s) { s.team = s.team === 'A' ? 'B' : 'A'; s.phase = 'clue'; s.clue = ''; s.left = 0; },
  win(ctx, W, why) {
    const s = ctx.g.s;
    ctx.finish(Object.fromEntries([...s.teams.A, ...s.teams.B].map(id => [id, this.teamOf(s, id) === W ? 3 : 1])), `${TEAMS[W]} ניצחו! ${why} 3 נקודות לכל מנצח ונקודה לכל השאר.`);
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, T = this.teamOf(s, pid);
    if (s.phase === 'clue' && m.act === 'clue' && s.spy[s.team] === pid) {
      const mt = cut(m.value, 24).match(/^(\S+)\s+(\d)$/);
      if (!mt) return ctx.error(pid, 'כתבו מילה אחת ואחריה מספר, למשל: ים 2');
      if (s.tiles.some(t => !t.open && norm(t.w) === norm(mt[1]))) return ctx.error(pid, 'אי אפשר לתת רמז שהוא אחת המילים על הלוח.');
      const n = Number(mt[2]); s.clue = `${mt[1]} ${n}`; s.left = n === 0 ? 99 : n + 1; s.phase = 'guess'; s.last = `${ctx.name(pid)} נתן/ה רמז: "${s.clue}".`;
    } else if (s.phase === 'guess' && T === s.team && s.spy[T] !== pid) {
      if (m.act === 'pass') { s.last = `${TEAMS[T]} סיימו את התור.`; return this.endTurn(s); }
      if (m.act !== 'guess') return;
      const tile = s.tiles.find(t => t.id === m.id && !t.open); if (!tile) return;
      tile.open = true;
      const other = T === 'A' ? 'B' : 'A';
      if (tile.k === 'X') return this.win(ctx, other, `${TEAMS[T]} עלו על המלכודת 💀 במילה "${tile.w}".`);
      if (!this.remaining(s, 'A') || !this.remaining(s, 'B')) return this.win(ctx, this.remaining(s, 'A') ? 'B' : 'A', 'כל המילים שלהם נמצאו.');
      if (tile.k === T) { s.left--; s.last = `"${tile.w}" נכון! ✔`; if (s.left <= 0) this.endTurn(s); }
      else { s.last = `"${tile.w}" ${tile.k === 'N' ? 'היא מילה ניטרלית' : `שייכת ל${TEAMS[other]}`}. התור עובר.`; this.endTurn(s); }
    }
  },
  skip(ctx) { this.endTurn(ctx.g.s); },
};

/* ============ פראייר מי לוקח ============ */
G.nothanks = {
  id: 'nothanks', name: 'פראייר מי לוקח', icon: '🪙', min: 3, max: 7,
  start(ctx) {
    const deck = shuffle(Array.from({ length: 33 }, (_, i) => i + 3)).slice(9), n = ctx.ids.length, tok = n <= 5 ? 11 : n === 6 ? 9 : 7;
    return { deck, card: deck.pop(), pot: 0, tokens: Object.fromEntries(ctx.ids.map(i => [i, tok])), cards: Object.fromEntries(ctx.ids.map(i => [i, []])), order: shuffle(ctx.ids), turn: 0, last: '' };
  },
  score(cards, tok) { const c = cards.slice().sort((a, b) => a - b); let s = 0; c.forEach((v, i) => { if (i === 0 || c[i - 1] !== v - 1) s += v; }); return s - tok; },
  runs(cards) { const c = cards.slice().sort((a, b) => a - b), out = []; c.forEach((v, i) => { if (i && c[i - 1] === v - 1) out[out.length - 1].push(v); else out.push([v]); }); return out.map(r => r.length > 1 ? `${r[0]}–${r[r.length - 1]}` : r[0]).join(' · '); },
  view(ctx, pid) {
    const s = ctx.g.s, cur = s.order[s.turn], me = pid === cur;
    return { blocks: [say(s.last || 'כל קלף שלוקחים שווה מינוס נקודות, אבל רצף נספר רק לפי הקלף הנמוך שבו. לא רוצים את הקלף? משלמים אסימון ומעבירים. הניקוד הנמוך מנצח.'),
      { t: 'cards', items: [{ v: s.card }] }, big(`🪙 ${s.pot} על הקלף`, `נשארו ${s.deck.length} קלפים בחפיסה`),
      me ? btns(btn(`✋ לוקח/ת (+${s.pot} 🪙)`, 'take', 'main'), btn('🪙 לא תודה', 'pay', 'ghost', { disabled: !s.tokens[pid] })) : text(`התור של ${ctx.name(cur)}`, true),
      ...(s.order.includes(pid) ? [text(`יש לך ${s.tokens[pid]} אסימונים (רק את/ה רואה)`, true)] : []),
      { t: 'players', items: s.order.map(id => row(ctx, id, { sub: s.cards[id].length ? this.runs(s.cards[id]) : 'אין קלפים', tag: id === cur ? 'בתור' : '', tone: 'turn' })) }] };
  },
  act(ctx, pid, m) {
    const s = ctx.g.s; if (pid !== s.order[s.turn]) return;
    if (m.act === 'take' || (m.act === 'pay' && !s.tokens[pid])) {
      s.cards[pid].push(s.card); s.tokens[pid] += s.pot; s.last = `${ctx.name(pid)} לקח/ה את ${s.card} עם ${s.pot} אסימונים, וממשיך/ה לקלף הבא.`; s.pot = 0;
      if (!s.deck.length) {
        const sc = Object.fromEntries(s.order.map(id => [id, this.score(s.cards[id], s.tokens[id])]));
        return ctx.finish(rankAwardLow(sc), 'נגמרה החפיסה! הניקוד (נמוך זה טוב): ' + s.order.slice().sort((a, b) => sc[a] - sc[b]).map(id => `${ctx.name(id)} ${sc[id]}`).join(', '));
      }
      s.card = s.deck.pop();
    } else if (m.act === 'pay') {
      s.tokens[pid]--; s.pot++; s.turn = (s.turn + 1) % s.order.length; s.last = `${ctx.name(pid)} שילם/ה אסימון ואמר/ה לא תודה.`;
    }
  },
  skip(ctx) { const s = ctx.g.s, id = s.order[s.turn]; this.act(ctx, id, { act: s.tokens[id] ? 'pay' : 'take' }); },
};

/* ============ חתולים וכלבים ============ */
const golfDeck = () => shuffle([0, 0, 13, 13, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].flatMap(v => [v, v, v, v])]);
const GOLF_POWER = { 7: 'own', 8: 'own', 9: 'other', 10: 'other', 11: 'swap', 12: 'swap' };
const GOLF_POWER_TXT = { own: 'הצצה באחד הקלפים שלך', other: 'הצצה בקלף של שחקן אחר', swap: 'החלפה עיוורת של קלף שלך בקלף של מישהו אחר' };
G.golf = {
  id: 'golf', name: 'חתולים וכלבים', icon: '🐱', min: 2, max: 6,
  start(ctx) { const s = { round: 0, rounds: 2, order: shuffle(ctx.ids), total: zero(ctx.ids) }; this.deal(s); return s; },
  deal(s) {
    s.round++; s.deck = golfDeck(); s.hands = {}; s.order.forEach(id => { s.hands[id] = [s.deck.pop(), s.deck.pop(), s.deck.pop(), s.deck.pop()]; });
    s.discard = [s.deck.pop()]; s.phase = 'peek'; s.ready = []; s.turn = (s.round - 1) % s.order.length; s.hold = null; s.from = null; s.power = null; s.pick = null;
    s.caller = null; s.flash = {}; s.last = ''; s.gain = {};
  },
  cardLabel(owner, i, ctx) { return `${ctx.name(owner)} · קלף ${i + 1}`; },
  view(ctx, pid) {
    const s = ctx.g.s, cur = s.order[s.turn], me = pid === cur, mine = s.hands[pid] || [];
    const table = { t: 'players', items: s.order.map(id => row(ctx, id, { tag: id === s.caller ? 'קרא/ה חתולים!' : id === cur && s.phase !== 'peek' && s.phase !== 'roundEnd' ? 'בתור' : '', tone: 'turn', right: s.phase === 'roundEnd' ? s.total[id] : '', sub: s.phase === 'roundEnd' ? `${s.hands[id].join(' + ')} = ${s.gain[id]}` : '' })) };
    const flash = s.flash[pid] ? [{ t: 'secret', tone: 'word', title: 'רק את/ה רואה', text: s.flash[pid] }] : [];
    if (s.phase === 'peek') {
      const ready = s.ready.includes(pid);
      return { blocks: [say('לכל אחד 4 קלפים הפוכים. מציצים עכשיו בשניים הראשונים וזוכרים! המטרה: סכום הכי נמוך. בתור מושכים קלף ומחליפים, ומי שבטוח שיש לו הכי מעט קורא "חתולים!".'),
        text(`סיבוב ${s.round} מתוך ${s.rounds}`, true),
        ready ? text('מחכים שכולם יזכרו…', true) : { t: 'hand', items: mine.map((v, i) => ({ id: String(i), v: i < 2 ? v : '?', back: i >= 2 })) },
        ready ? null : btns(btn('🧠 זכרתי', 'ready')), table].filter(Boolean) };
    }
    if (s.phase === 'roundEnd') return { blocks: [say(s.last), h('ניקוד מצטבר (נמוך זה טוב)'), table, hostNext(ctx, pid, s.round < s.rounds ? 'לסיבוב הבא ▶' : 'לתוצאות 🏁')] };
    const top = s.discard[s.discard.length - 1];
    const myHand = act => ({ t: 'hand', act, items: mine.map((v, i) => ({ id: String(i), v: '?', back: true })) });
    const blocks = [say(s.last || `התור של ${ctx.name(cur)}.`), ...flash, { t: 'cards', items: [{ v: top === undefined ? '—' : top }], empty: '' }, text(`ערימת הזריקה · נשארו ${s.deck.length} בחפיסה${s.caller ? ` · ${ctx.name(s.caller)} קרא/ה חתולים, זה הסבב האחרון!` : ''}`, true)];
    if (!me) return { blocks: [...blocks, h('הקלפים שלך'), myHand(null), table] };
    if (s.phase === 'turn') return { blocks: [...blocks, btns(btn('🂠 משיכה מהחפיסה', 'draw', 'main'), btn(`לקיחת ${top} מהזריקה`, 'take', 'tan', { disabled: top === undefined })),
      ...(s.caller ? [] : [btns(btn('🐱 חתולים! (סיום)', 'call', 'ember'))]), h('הקלפים שלך'), myHand(null), table] };
    if (s.phase === 'drawn') {
      const pw = s.from === 'deck' && GOLF_POWER[s.hold];
      return { blocks: [...blocks, { t: 'secret', tone: 'word', title: 'הקלף שמשכת', text: String(s.hold), sub: pw ? `אם תזרקו אותו: ${GOLF_POWER_TXT[pw]}` : '' },
        h('הקישו על קלף שלכם כדי להחליף'), myHand('swap'), ...(s.from === 'deck' ? [btns(btn(pw ? 'זריקה והפעלת הכוח' : 'זריקה', 'discard', 'ghost'))] : []), table] };
    }
    // power
    const others = s.order.filter(id => id !== pid).flatMap(o => s.hands[o].map((_, i) => ({ id: `${o}:${i}`, name: this.cardLabel(o, i, ctx), color: ctx.p(o).color })));
    if (s.power === 'own') return { blocks: [...blocks, h('באיזה קלף שלך להציץ?'), myHand('peekOwn'), btns(btn('ויתור', 'skipPower', 'ghost')), table] };
    if (s.power === 'other') return { blocks: [...blocks, h('באיזה קלף להציץ?'), { t: 'choices', act: 'peekOther', items: others }, btns(btn('ויתור', 'skipPower', 'ghost')), table] };
    return { blocks: [...blocks, h(s.pick == null ? 'איזה קלף שלך להחליף?' : 'עם איזה קלף להחליף?'), s.pick == null ? myHand('swapMine') : { t: 'choices', act: 'swapOther', items: others }, btns(btn('ויתור', 'skipPower', 'ghost')), table] };
  },
  endTurn(ctx) {
    const s = ctx.g.s;
    s.hold = null; s.from = null; s.power = null; s.pick = null; s.phase = 'turn';
    s.turn = (s.turn + 1) % s.order.length;
    if (s.caller && s.order[s.turn] === s.caller) return this.endRound(ctx);
  },
  endRound(ctx) {
    const s = ctx.g.s;
    s.order.forEach(id => { s.gain[id] = s.hands[id].reduce((a, b) => a + b, 0); });
    let note = '';
    if (s.caller) {
      const lowest = s.order.every(id => id === s.caller || s.gain[id] > s.gain[s.caller]);
      if (!lowest) { s.gain[s.caller] += 10; note = ` ${ctx.name(s.caller)} קרא/ה חתולים ולא היה/תה הכי נמוך/ה: +10 קנס!`; }
      else note = ` ${ctx.name(s.caller)} קרא/ה חתולים בצדק!`;
    }
    s.order.forEach(id => { s.total[id] += s.gain[id]; });
    s.last = `סוף סיבוב ${s.round}. הקלפים נחשפו.${note}`;
    s.phase = 'roundEnd'; s.flash = {};
  },
  draw(s) { if (!s.deck.length) { const top = s.discard.pop(); s.deck = shuffle(s.discard); s.discard = [top]; } return s.deck.pop(); },
  act(ctx, pid, m) {
    const s = ctx.g.s;
    if (s.phase === 'peek' && m.act === 'ready' && !s.ready.includes(pid)) { s.ready.push(pid); if (s.order.every(id => s.ready.includes(id))) s.phase = 'turn'; return; }
    if (s.phase === 'roundEnd' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAwardLow(s.total), 'חתולים וכלבים נגמר! הסכום הנמוך מנצח:');
      return this.deal(s);
    }
    if (pid !== s.order[s.turn]) return;
    delete s.flash[pid];
    const name = ctx.name(pid), idx = Number(m.id);
    if (s.phase === 'turn') {
      if (m.act === 'draw') { const c = this.draw(s); if (c === undefined) return this.endRound(ctx); s.hold = c; s.from = 'deck'; s.phase = 'drawn'; s.last = `${name} משך/ה קלף.`; }
      else if (m.act === 'take' && s.discard.length) { s.hold = s.discard.pop(); s.from = 'discard'; s.phase = 'drawn'; s.last = `${name} לקח/ה ${s.hold} מהזריקה.`; }
      else if (m.act === 'call' && !s.caller) { s.caller = pid; s.last = `${name} קרא/ה חתולים! לכל השאר נשאר תור אחד.`; this.endTurn(ctx); }
    } else if (s.phase === 'drawn') {
      if (m.act === 'swap' && idx >= 0 && idx < 4) {
        const old = s.hands[pid][idx]; s.hands[pid][idx] = s.hold; s.discard.push(old);
        s.last = `${name} החליף/ה את קלף ${idx + 1} וזרק/ה ${old}.`; this.endTurn(ctx);
      } else if (m.act === 'discard' && s.from === 'deck') {
        s.discard.push(s.hold); const pw = GOLF_POWER[s.hold];
        s.last = `${name} זרק/ה ${s.hold}.`;
        if (pw) { s.power = pw; s.phase = 'power'; s.hold = null; } else this.endTurn(ctx);
      }
    } else if (s.phase === 'power') {
      const parse = v => { const [o, i] = String(v || '').split(':'); return s.hands[o] && Number(i) >= 0 && Number(i) < 4 && o !== pid ? [o, Number(i)] : null; };
      if (m.act === 'skipPower') return this.endTurn(ctx);
      if (s.power === 'own' && m.act === 'peekOwn' && idx >= 0 && idx < 4) { s.flash[pid] = `קלף ${idx + 1} שלך: ${s.hands[pid][idx]}`; s.last = `${name} הציץ/ה באחד הקלפים שלו/ה.`; this.endTurn(ctx); }
      else if (s.power === 'other' && m.act === 'peekOther') { const t = parse(m.id); if (!t) return; s.flash[pid] = `${this.cardLabel(t[0], t[1], ctx)}: ${s.hands[t[0]][t[1]]}`; s.last = `${name} הציץ/ה בקלף של ${ctx.name(t[0])}.`; this.endTurn(ctx); }
      else if (s.power === 'swap' && m.act === 'swapMine' && idx >= 0 && idx < 4) s.pick = idx;
      else if (s.power === 'swap' && m.act === 'swapOther' && s.pick != null) {
        const t = parse(m.id); if (!t) return;
        [s.hands[pid][s.pick], s.hands[t[0]][t[1]]] = [s.hands[t[0]][t[1]], s.hands[pid][s.pick]];
        s.last = `${name} החליף/ה בעיוורון את קלף ${s.pick + 1} שלו/ה עם ${this.cardLabel(t[0], t[1], ctx)}.`; this.endTurn(ctx);
      }
    }
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'peek') { s.phase = 'turn'; return; }
    if (s.phase === 'drawn') { s.discard.push(s.hold); }
    if (s.phase !== 'roundEnd') this.endTurn(ctx);
  },
};

/* ============ ממלכת החיות ============ */
const ANIMALS = { 1: ['ינשוף', '🦉', 'בוחרים שחקן ומנחשים איזו חיה יש לו (לא ינשוף). צדקתם? הוא בחוץ.'], 2: ['עכבר', '🐭', 'מציצים ביד של שחקן אחר.'],
  3: ['דוב', '🐻', 'משווים ידיים בסתר עם שחקן אחר. הנמוך יוצא.'], 4: ['צב', '🐢', 'מוגנים מכל השחקנים עד התור הבא שלכם.'],
  5: ['קוף', '🐒', 'שחקן כלשהו (גם אתם) זורק את היד ומושך קלף חדש.'], 6: ['שועל', '🦊', 'מחליפים יד עם שחקן אחר.'],
  7: ['נחש', '🐍', 'חייבים לשחק אותו אם יש לכם ביד גם קוף או שועל.'], 8: ['אריה', '🦁', 'מי שזורק את האריה, יוצא מהסיבוב.'] };
const animal = v => `${ANIMALS[v][1]} ${ANIMALS[v][0]} (${v})`;
G.kingdom = {
  id: 'kingdom', name: 'ממלכת החיות', icon: '🦁', min: 2, max: 4,
  start(ctx) { const s = { round: 0, rounds: 3, order: shuffle(ctx.ids), tokens: zero(ctx.ids), starter: 0 }; this.deal(s); return s; },
  deal(s) {
    s.round++; s.deck = shuffle([1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8]); s.burn = s.deck.pop();
    s.hands = {}; s.order.forEach(id => { s.hands[id] = [s.deck.pop()]; });
    s.out = []; s.prot = []; s.discards = zero(s.order); s.order.forEach(id => { s.discards[id] = []; });
    s.peek = {}; s.log = []; s.pending = null; s.cur = s.order[s.starter % s.order.length]; s.starter++; s.winners = [];
    this.beginTurn(s);
  },
  beginTurn(s) { s.prot = s.prot.filter(id => id !== s.cur); s.hands[s.cur].push(s.deck.pop()); s.phase = 'play'; },
  alive(s) { return s.order.filter(id => !s.out.includes(id)); },
  targets(s, pid, self) { return this.alive(s).filter(id => (self || id !== pid) && !s.prot.includes(id)); },
  knockOut(s, id) { if (s.out.includes(id)) return; s.out.push(id); s.discards[id].push(...s.hands[id]); s.hands[id] = []; },
  view(ctx, pid) {
    const s = ctx.g.s, me = pid === s.cur, hand = s.hands[pid] || [];
    const table = { t: 'players', items: s.order.map(id => row(ctx, id, { right: '❤'.repeat(s.tokens[id]) || '0', sub: s.discards[id].map(v => ANIMALS[v][1]).join(' ') || 'עוד לא שיחק/ה',
      tag: s.out.includes(id) ? 'בחוץ' : s.prot.includes(id) ? '🐢 מוגן/ת' : id === s.cur && s.phase !== 'roundEnd' ? 'בתור' : '', tone: s.out.includes(id) ? 'bad' : 'turn' })) };
    const log = { t: 'list', items: s.log.slice(-4).reverse().map(t => ({ name: '•', text: t })) };
    const peek = s.peek[pid] ? [{ t: 'secret', tone: 'word', title: 'רק את/ה רואה', text: s.peek[pid] }] : [];
    if (s.phase === 'roundEnd') return { blocks: [say(`סוף סיבוב ${s.round} מתוך ${s.rounds}! ${s.winners.map(id => ctx.name(id)).join(' ו')} ${s.winners.length > 1 ? 'זכו' : 'זכה/תה'} בלב ❤.`),
      { t: 'list', items: s.order.map(id => ({ name: ctx.name(id), color: ctx.p(id).color, text: s.out.includes(id) ? 'יצא/ה מהסיבוב' : `החזיק/ה ${animal(s.hands[id][0])}` })) }, table,
      hostNext(ctx, pid, s.round < s.rounds ? 'לסיבוב הבא ▶' : 'לתוצאות 🏁')] };
    const blocks = [say(s.log.length ? s.log[s.log.length - 1] : 'לכל אחד חיה אחת ביד. בתור מושכים חיה שנייה ומשחקים אחת מהשתיים. מי שנשאר אחרון, או עם החיה הכי חזקה כשהחפיסה נגמרת, זוכה בלב.'),
      ...peek, text(`סיבוב ${s.round} מתוך ${s.rounds} · נשארו ${s.deck.length} קלפים`, true)];
    if (hand.length) blocks.push(h(me && s.phase === 'play' ? 'איזו חיה לשחק?' : 'היד שלך'), { t: 'hand', act: me && s.phase === 'play' ? 'play' : null, items: hand.map((v, i) => ({ id: String(i), v: ANIMALS[v][1], sub: `${ANIMALS[v][0]} ${v}` })) },
      { t: 'list', items: [...new Set(hand)].map(v => ({ name: animal(v), text: ANIMALS[v][2] })) });
    else if (s.out.includes(pid)) blocks.push(text('יצאת מהסיבוב. אפשר לצפות.', true));
    if (me && s.phase === 'target') blocks.push(h(`על מי להפעיל את ה${ANIMALS[s.pending][0]}?`), { t: 'choices', act: 'target', items: this.targets(s, pid, s.pending === 5).map(id => row(ctx, id)) });
    if (me && s.phase === 'guess') blocks.push(h(`איזו חיה יש ל${ctx.name(s.target)}?`), { t: 'choices', act: 'guess', items: [2, 3, 4, 5, 6, 7, 8].map(v => ({ id: String(v), name: animal(v) })) });
    if (!me) blocks.push(text(`התור של ${ctx.name(s.cur)}`, true));
    blocks.push(log, table);
    return { blocks };
  },
  endTurn(ctx) {
    const s = ctx.g.s, alive = this.alive(s);
    s.pending = null; s.target = null;
    if (alive.length <= 1 || !s.deck.length) {
      let best = -1;
      alive.forEach(id => { const v = s.hands[id][0] * 100 + s.discards[id].reduce((a, b) => a + b, 0); if (v > best) best = v; });
      s.winners = alive.filter(id => s.hands[id][0] * 100 + s.discards[id].reduce((a, b) => a + b, 0) === best);
      s.winners.forEach(id => s.tokens[id]++);
      s.phase = 'roundEnd'; s.peek = {};
      return;
    }
    s.cur = nextIn(s.order, s.cur, id => !s.out.includes(id));
    this.beginTurn(s);
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, name = ctx.name(pid);
    if (s.phase === 'roundEnd' && m.act === 'next' && ctx.isHost(pid)) {
      if (s.round >= s.rounds) return ctx.finish(rankAward(s.tokens), 'ממלכת החיות נסגרה להערב! הלבבות קובעים:');
      return this.deal(s);
    }
    if (pid !== s.cur) return;
    if (s.phase === 'play' && m.act === 'play') {
      const i = Number(m.id), hand = s.hands[pid]; if (!(i === 0 || i === 1) || hand[i] === undefined) return;
      const v = hand[i];
      if (v !== 7 && hand.includes(7) && (hand.includes(5) || hand.includes(6))) return ctx.error(pid, 'יש לך נחש ביחד עם קוף או שועל, אז חייבים לשחק את הנחש.');
      hand.splice(i, 1); s.discards[pid].push(v); delete s.peek[pid];
      if (v === 8) { this.knockOut(s, pid); s.log.push(`${name} שיחק/ה את האריה ויצא/ה מהסיבוב! 🦁`); return this.endTurn(ctx); }
      if (v === 4) { s.prot.push(pid); s.log.push(`${name} שיחק/ה צב ומוגן/ת עד התור הבא. 🐢`); return this.endTurn(ctx); }
      if (v === 7) { s.log.push(`${name} שיחק/ה נחש. 🐍`); return this.endTurn(ctx); }
      if (!this.targets(s, pid, v === 5).length) { s.log.push(`${name} שיחק/ה ${ANIMALS[v][0]}, אבל אין על מי להפעיל אותו.`); return this.endTurn(ctx); }
      s.pending = v; s.phase = 'target';
    } else if (s.phase === 'target' && m.act === 'target' && this.targets(s, pid, s.pending === 5).includes(m.id)) {
      const t = m.id, tn = ctx.name(t), v = s.pending;
      if (v === 1) { s.target = t; s.phase = 'guess'; return; }
      if (v === 2) { s.peek[pid] = `ל${tn} יש ${animal(s.hands[t][0])}`; s.log.push(`${name} הציץ/ה ביד של ${tn}. 🐭`); }
      if (v === 3) {
        const a = s.hands[pid][0], b = s.hands[t][0];
        s.peek[pid] = `ל${tn} יש ${animal(b)}`; s.peek[t] = `ל${name} יש ${animal(a)}`;
        if (a === b) s.log.push(`${name} ו${tn} השוו ידיים. תיקו! 🐻`);
        else { const loser = a < b ? pid : t; this.knockOut(s, loser); s.log.push(`${name} ו${tn} השוו ידיים. ${ctx.name(loser)} בחוץ! 🐻`); }
      }
      if (v === 5) {
        const dropped = s.hands[t].pop(); s.discards[t].push(dropped);
        if (dropped === 8) { s.out.push(t); s.log.push(`${tn} נאלץ/ה לזרוק את האריה ויצא/ה! 🐒`); }
        else { s.hands[t].push(s.deck.length ? s.deck.pop() : s.burn); s.log.push(`${name} גרם/ה ל${tn} לזרוק ${ANIMALS[dropped][0]} ולמשוך חדש. 🐒`); }
        delete s.peek[t];
      }
      if (v === 6) { [s.hands[pid], s.hands[t]] = [s.hands[t], s.hands[pid]]; delete s.peek[t]; s.log.push(`${name} החליף/ה ידיים עם ${tn}. 🦊`); }
      this.endTurn(ctx);
    } else if (s.phase === 'guess' && m.act === 'guess') {
      const g = Number(m.id), t = s.target; if (!(g >= 2 && g <= 8)) return;
      if (s.hands[t][0] === g) { this.knockOut(s, t); s.log.push(`${name} ניחש/ה ש${ctx.name(t)} מחזיק/ה ${ANIMALS[g][0]}, וצדק/ה! ${ctx.name(t)} בחוץ. 🦉`); }
      else s.log.push(`${name} ניחש/ה ש${ctx.name(t)} מחזיק/ה ${ANIMALS[g][0]}, וטעה/תה. 🦉`);
      this.endTurn(ctx);
    }
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'play') { const hand = s.hands[s.cur]; const i = hand[0] === 8 ? 1 : 0; s.discards[s.cur].push(hand.splice(i, 1)[0]); s.log.push(`${ctx.name(s.cur)} דילג/ה על התור.`); this.endTurn(ctx); }
    else if (s.phase === 'target' || s.phase === 'guess') this.endTurn(ctx);
  },
};

/* ============ זיקית או נחש ============ */
G.skull = {
  id: 'skull', name: 'זיקית או נחש', icon: '🦎', min: 3, max: 6,
  start(ctx) {
    const s = { order: shuffle(ctx.ids), have: {}, wins: zero(ctx.ids), round: 0, maxRounds: 10, starter: null };
    ctx.ids.forEach(id => { s.have[id] = { c: 3, s: 1 }; });
    s.starter = s.order[0]; this.newRound(s); return s;
  },
  alive(s) { return s.order.filter(id => s.have[id].c + s.have[id].s > 0); },
  newRound(s) {
    s.round++; s.stacks = {}; s.hand = {}; s.flipped = {};
    this.alive(s).forEach(id => { s.stacks[id] = []; s.hand[id] = { ...s.have[id] }; s.flipped[id] = 0; });
    s.phase = 'place'; s.cur = this.alive(s).includes(s.starter) ? s.starter : this.alive(s)[0]; s.bid = null; s.result = ''; s.chal = null;
  },
  total(s) { return Object.values(s.stacks).reduce((a, st) => a + st.length, 0); },
  view(ctx, pid) {
    const s = ctx.g.s, alive = this.alive(s), inGame = alive.includes(pid), hand = s.hand[pid], stack = s.stacks[pid] || [];
    const icon = k => k === 's' ? '🐍' : '🦎';
    const table = { t: 'players', items: s.order.map(id => row(ctx, id, { right: '⭐'.repeat(s.wins[id]) || '0',
      sub: !alive.includes(id) ? 'נשאר/ה בלי תחתיות' : `${s.stacks[id].length} מונחות${s.flipped[id] ? ` · נחשפו: ${s.stacks[id].slice(s.stacks[id].length - s.flipped[id]).map(icon).join('')}` : ''} · ${s.have[id].c + s.have[id].s} סה״כ`,
      tag: s.bid && s.bid.passed.includes(id) ? 'פס' : s.bid && s.bid.by === id ? `הימור ${s.bid.n}` : id === s.cur && s.phase === 'turn' ? 'בתור' : '', tone: 'turn' })) };
    const mine = inGame ? [h('הערימה שלך (רק את/ה רואה)'), { t: 'cards', items: stack.map(k => ({ v: icon(k), small: true })), empty: 'עוד לא הנחת' }, text(`ביד: ${'🦎'.repeat(hand.c)}${'🐍'.repeat(hand.s)}`, true)] : [];
    const placeBtns = act => btns(hand.c ? btn('הנחת 🦎', act + 'c', 'main') : null, hand.s ? btn('הנחת 🐍', act + 's', 'ember') : null);
    const blocks = [say(s.result || 'לכל אחד 3 זיקיות ונחש אחד. מניחים תחתיות הפוכות, ואז מהמרים כמה אפשר להפוך בלי לפגוש נחש. מי שמצליח פעמיים מנצח.'), text(`סבב ${s.round} · ${this.total(s)} תחתיות על השולחן`, true)];
    if (s.phase === 'place') blocks.push(inGame && !stack.length ? placeBtns('place') : text('מחכים שכולם יניחו תחתית ראשונה…', true));
    else if (s.phase === 'turn') {
      if (pid === s.cur) {
        if (hand.c + hand.s) blocks.push(h('להניח עוד תחתית'), placeBtns('add'));
        blocks.push(h('או להתחיל הימור: כמה אפשר להפוך?'), { t: 'choices', act: 'bid', items: Array.from({ length: this.total(s) }, (_, i) => ({ id: String(i + 1), name: String(i + 1) })) });
      } else blocks.push(text(`התור של ${ctx.name(s.cur)}`, true));
    } else if (s.phase === 'bid') {
      blocks.push(big(`${ctx.name(s.bid.by)} מהמר/ת על ${s.bid.n}`));
      if (pid === s.cur) blocks.push({ t: 'choices', act: 'raise', items: [...Array.from({ length: this.total(s) - s.bid.n }, (_, i) => ({ id: String(s.bid.n + i + 1), name: `להעלות ל־${s.bid.n + i + 1}` })), { id: 'pass', name: 'פס' }] });
      else blocks.push(text(`${ctx.name(s.cur)} מחליט/ה…`, true));
    } else if (s.phase === 'flip') {
      blocks.push(big(`${ctx.name(s.chal)} צריך/ה להפוך ${s.bid.n}`, `נחשפו ${s.found} עד עכשיו`));
      if (pid === s.chal) blocks.push(h('של מי להפוך את התחתית העליונה?'), { t: 'choices', act: 'flip', items: alive.filter(id => id !== pid && s.flipped[id] < s.stacks[id].length).map(id => row(ctx, id, { sub: `${s.stacks[id].length - s.flipped[id]} הפוכות` })) });
    } else if (s.phase === 'result') blocks.push(hostNext(ctx, pid, 'לסבב הבא ▶'));
    return { blocks: [...blocks, ...mine, table] };
  },
  nextTurn(s) { s.cur = nextIn(s.order, s.cur, id => this.alive(s).includes(id)); },
  startFlip(ctx) {
    const s = ctx.g.s; s.chal = s.bid.by; s.phase = 'flip'; s.found = 0;
    const own = s.stacks[s.chal]; s.flipped[s.chal] = own.length;
    if (own.includes('s')) return this.fail(ctx, s.chal, `${ctx.name(s.chal)} הפך/ה את הערימה של עצמו/ה ומצא/ה את הנחש שלו/ה! 🐍`);
    s.found = own.length;
    if (s.found >= s.bid.n) this.success(ctx);
  },
  fail(ctx, by, msg) {
    const s = ctx.g.s, hv = s.have[s.chal], pool = [...Array(hv.c).fill('c'), ...Array(hv.s).fill('s')], lost = pool[rnd(pool.length)];
    hv[lost]--;
    s.result = `${msg} ${ctx.name(s.chal)} מאבד/ת תחתית.${hv.c + hv.s ? '' : ' ונשאר/ה בלי תחתיות!'}`;
    s.starter = by; s.phase = 'result';
    if (this.alive(s).length <= 1 || s.round >= s.maxRounds) this.over(ctx);
  },
  success(ctx) {
    const s = ctx.g.s; s.wins[s.chal]++;
    s.result = `${ctx.name(s.chal)} הפך/ה ${s.bid.n} זיקיות בלי לפגוש נחש! ⭐`;
    s.starter = s.chal; s.phase = 'result';
    if (s.wins[s.chal] >= 2 || s.round >= s.maxRounds) this.over(ctx);
  },
  over(ctx) {
    const s = ctx.g.s, pts = Object.fromEntries(s.order.map(id => [id, s.wins[id] * 10 + s.have[id].c + s.have[id].s]));
    ctx.finish(rankAward(pts), `${s.result} סוף המשחק!`);
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, hand = s.hand[pid];
    const place = k => { if (!hand || !hand[k]) return false; hand[k]--; s.stacks[pid].push(k); return true; };
    if (s.phase === 'place' && (m.act === 'placec' || m.act === 'places') && hand && !s.stacks[pid].length) {
      place(m.act.slice(-1));
      if (this.alive(s).every(id => s.stacks[id].length)) s.phase = 'turn';
    } else if (s.phase === 'result' && m.act === 'next' && ctx.isHost(pid)) this.newRound(s);
    else if (pid !== s.cur && pid !== s.chal) return;
    else if (s.phase === 'turn' && pid === s.cur) {
      if ((m.act === 'addc' || m.act === 'adds') && place(m.act.slice(-1))) this.nextTurn(s);
      else if (m.act === 'bid') {
        const n = Number(m.id); if (!(n >= 1 && n <= this.total(s))) return;
        s.bid = { n, by: pid, passed: [] };
        if (n === this.total(s)) return this.startFlip(ctx);
        s.phase = 'bid'; this.nextTurn(s);
      }
    } else if (s.phase === 'bid' && pid === s.cur && m.act === 'raise') {
      if (m.id === 'pass') s.bid.passed.push(pid);
      else { const n = Number(m.id); if (!(n > s.bid.n && n <= this.total(s))) return; s.bid.n = n; s.bid.by = pid; if (n === this.total(s)) return this.startFlip(ctx); }
      const left = this.alive(s).filter(id => !s.bid.passed.includes(id));
      if (left.length <= 1) return this.startFlip(ctx);
      s.cur = nextIn(s.order, s.cur, id => left.includes(id));
    } else if (s.phase === 'flip' && pid === s.chal && m.act === 'flip') {
      const t = m.id, st = s.stacks[t]; if (!st || t === pid || s.flipped[t] >= st.length) return;
      s.flipped[t]++;
      const k = st[st.length - s.flipped[t]];
      if (k === 's') return this.fail(ctx, t, `${ctx.name(pid)} הפך/ה את הנחש של ${ctx.name(t)}! 🐍`);
      s.found++;
      if (s.found >= s.bid.n) this.success(ctx);
    }
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'place') { this.alive(s).forEach(id => { if (!s.stacks[id].length) { const k = s.hand[id].c ? 'c' : 's'; s.hand[id][k]--; s.stacks[id].push(k); } }); s.phase = 'turn'; }
    else if (s.phase === 'turn') { this.act(ctx, s.cur, { act: 'bid', id: '1' }); }
    else if (s.phase === 'bid') { this.act(ctx, s.cur, { act: 'raise', id: 'pass' }); }
    else if (s.phase === 'flip') { const t = this.alive(s).find(id => id !== s.chal && s.flipped[id] < s.stacks[id].length); if (t) this.act(ctx, s.chal, { act: 'flip', id: t }); else this.success(ctx); }
  },
};

/* ============ ארמון ============ */
const RANK = v => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[v] || String(v));
G.palace = {
  id: 'palace', name: 'ארמון', icon: '🏰', min: 2, max: 6,
  start(ctx) {
    const deck = shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap(v => [v, v, v, v])), order = shuffle(ctx.ids), p = {};
    order.forEach(id => { p[id] = { down: deck.splice(0, 3), up: deck.splice(0, 3), hand: deck.splice(0, 3) }; });
    return { deck, pile: [], p, order, cur: order[0], done: [], last: '', moves: 0 };
  },
  top(s) { return s.pile.length ? s.pile[s.pile.length - 1] : null; },
  ok(s, v) { const t = this.top(s); return t === null || v === 2 || v === 10 || v >= t; },
  source(s, id) { const p = s.p[id]; return p.hand.length ? 'hand' : p.up.length ? 'up' : p.down.length ? 'down' : null; },
  left(s, id) { const p = s.p[id]; return p.hand.length + p.up.length + p.down.length; },
  view(ctx, pid) {
    const s = ctx.g.s, me = pid === s.cur, p = s.p[pid], src = p && this.source(s, pid);
    const t = this.top(s);
    const table = { t: 'players', items: s.order.map(id => row(ctx, id, { sub: s.done.includes(id) ? `סיים/ה במקום ${s.done.indexOf(id) + 1}` : `יד ${s.p[id].hand.length} · גלויים ${s.p[id].up.map(RANK).join(' ') || '—'} · סגורים ${s.p[id].down.length}`, tag: id === s.cur ? 'בתור' : '', tone: 'turn' })) };
    const blocks = [say(s.last || 'נפטרים מכל הקלפים: קודם מהיד, אחר כך מהגלויים ובסוף מהסגורים בעיוורון. משחקים קלף שווה או גבוה מהערימה. 2 מאפס, 10 שורף את הערימה. האחרון עם קלפים מפסיד.'),
      { t: 'cards', items: t === null ? [] : [{ v: RANK(t) }], empty: 'הערימה ריקה' }, text(`בערימה ${s.pile.length} · בחפיסה ${s.deck.length}`, true)];
    if (!p) return { blocks: [...blocks, table] };
    if (s.done.includes(pid)) blocks.push(big('סיימת! 🏰'));
    const canPlay = me && (src === 'hand' || src === 'up');
    const cardsOf = arr => [...new Set(arr)].sort((a, b) => a - b);
    blocks.push(h(src === 'up' ? 'הקלפים הגלויים שלך' : 'היד שלך'), { t: 'hand', act: canPlay ? 'play' : null, items: cardsOf(src === 'up' ? p.up : p.hand).map(v => ({ id: String(v), v: RANK(v), sub: `×${(src === 'up' ? p.up : p.hand).filter(x => x === v).length}`, disabled: canPlay && !this.ok(s, v) })) });
    if (src === 'hand') blocks.push(text(`גלויים: ${p.up.map(RANK).join(' ') || '—'} · סגורים: ${p.down.length}`, true));
    if (me && src === 'down') blocks.push(h('קלף עיוור: בחרו אחד'), { t: 'hand', act: 'blind', items: p.down.map((_, i) => ({ id: String(i), v: '?', back: true })) });
    const has = canPlay && (src === 'up' ? p.up : p.hand).some(v => this.ok(s, v));
    if (me && canPlay) blocks.push(btns(btn(`לקיחת הערימה (${s.pile.length})`, 'pickup', has ? 'ghost' : 'ember', { disabled: !s.pile.length })));
    if (!me && !s.done.includes(pid)) blocks.push(text(`התור של ${ctx.name(s.cur)}`, true));
    return { blocks: [...blocks, table] };
  },
  advance(ctx, again) {
    const s = ctx.g.s;
    if (!this.left(s, s.cur) && !s.done.includes(s.cur)) s.done.push(s.cur);
    const alive = s.order.filter(id => !s.done.includes(id));
    if (alive.length <= 1 || ++s.moves > 600) {
      const rest = alive.slice().sort((a, b) => this.left(s, a) - this.left(s, b));
      const finish = [...s.done, ...rest], aw = Object.fromEntries(s.order.map(id => [id, Math.max(0, 3 - finish.indexOf(id))]));
      if (finish.length <= 3 && rest.length) aw[rest[rest.length - 1]] = 0;
      return ctx.finish(aw, `${rest.length ? `${ctx.name(rest[rest.length - 1])} נשאר/ה אחרון/ה עם קלפים. ` : ''}${s.done.length ? `${ctx.name(s.done[0])} סיים/ה ראשון/ה!` : ''}`);
    }
    if (!again || s.done.includes(s.cur)) s.cur = nextIn(s.order, s.cur, id => !s.done.includes(id));
  },
  playCards(ctx, pid, cards, from) {
    const s = ctx.g.s, v = cards[0];
    s.pile.push(...cards);
    const p = s.p[pid];
    if (from === 'hand') while (p.hand.length < 3 && s.deck.length) p.hand.push(s.deck.pop());
    const four = s.pile.length >= 4 && s.pile.slice(-4).every(x => x === v);
    const name = ctx.name(pid);
    if (v === 10 || four) { s.pile = []; s.last = `${name} שיחק/ה ${cards.map(RANK).join(' ')} ושרף/ה את הערימה! 🔥 ממשיך/ה לשחק.`; return this.advance(ctx, true); }
    s.last = `${name} שיחק/ה ${cards.map(RANK).join(' ')}.`;
    this.advance(ctx, false);
  },
  act(ctx, pid, m) {
    const s = ctx.g.s; if (pid !== s.cur) return;
    const p = s.p[pid], src = this.source(s, pid);
    if (m.act === 'play' && (src === 'hand' || src === 'up')) {
      const v = Number(m.id), arr = p[src]; if (!arr.includes(v) || !this.ok(s, v)) return;
      const cards = arr.filter(x => x === v); p[src] = arr.filter(x => x !== v);
      this.playCards(ctx, pid, cards, src);
    } else if (m.act === 'pickup' && s.pile.length && (src === 'hand' || src === 'up')) {
      p.hand.push(...s.pile); s.pile = []; s.last = `${ctx.name(pid)} לקח/ה את הערימה.`; this.advance(ctx, false);
    } else if (m.act === 'blind' && src === 'down') {
      const i = Number(m.id); if (!(i >= 0 && i < p.down.length)) return;
      const v = p.down.splice(i, 1)[0];
      if (this.ok(s, v)) this.playCards(ctx, pid, [v], 'down');
      else { p.hand.push(...s.pile, v); s.pile = []; s.last = `${ctx.name(pid)} הפך/ה ${RANK(v)} בעיוורון, לא עבר, ולקח/ה את הערימה.`; this.advance(ctx, false); }
    }
  },
  skip(ctx) {
    const s = ctx.g.s, p = s.p[s.cur], src = this.source(s, s.cur);
    if (src === 'down') return this.act(ctx, s.cur, { act: 'blind', id: '0' });
    const arr = p[src] || [], v = arr.filter(x => this.ok(s, x)).sort((a, b) => a - b)[0];
    if (v !== undefined) this.act(ctx, s.cur, { act: 'play', id: String(v) });
    else if (s.pile.length) this.act(ctx, s.cur, { act: 'pickup' });
    else this.advance(ctx, false);
  },
};

/* ============ הסינדיקט ============ */
const SYN = { 5: [2, [2, 3, 2, 3, 3]], 6: [2, [2, 3, 4, 3, 4]], 7: [3, [2, 3, 3, 4, 4]], 8: [3, [3, 4, 4, 5, 5]], 9: [3, [3, 4, 4, 5, 5]], 10: [4, [3, 4, 4, 5, 5]] };
G.syndicate = {
  id: 'syndicate', name: 'הסינדיקט', icon: '🕴️', min: 5, max: 10,
  start(ctx) {
    const n = ctx.ids.length, [k, sizes] = SYN[n];
    return { phase: 'roles', order: shuffle(ctx.ids), spies: shuffle(ctx.ids).slice(0, k), sizes, mission: 0, results: [], rejects: 0, leader: 0, team: [], votes: {}, lastVotes: null, plays: {}, msg: '' };
  },
  need(s) { return s.sizes[s.mission]; },
  twoFails(s) { return s.order.length >= 7 && s.mission === 3; },
  role(ctx, s, pid) {
    const spy = s.spies.includes(pid);
    return { t: 'secret', tone: spy ? 'imp' : 'word', title: 'התפקיד שלך', text: spy ? '🕶️ מסתנן/ת' : '🕴️ סוכן/ת', hidden: true,
      sub: spy ? `אתם מנסים להכשיל 3 משימות. המסתננים: ${s.spies.map(id => ctx.name(id)).join(', ')}.` : 'אתם מנסים להצליח ב־3 משימות. יש מסתננים ביניכם, ורק הם יכולים להכשיל משימה.' };
  },
  view(ctx, pid) {
    const s = ctx.g.s, leader = s.order[s.leader];
    const track = big(s.sizes.map((n, i) => s.results[i] === true ? '✅' : s.results[i] === false ? '❌' : i === s.mission ? `[${n}]` : n).join('  '), `משימה ${s.mission + 1} · דחיות ברצף: ${s.rejects}/5`);
    const table = { t: 'players', items: s.order.map(id => row(ctx, id, { tag: id === leader ? 'מוביל/ה' : s.team.includes(id) ? 'בצוות' : '', tone: id === leader ? 'turn' : 'ok',
      sub: s.lastVotes ? (s.lastVotes[id] === 'yes' ? 'הצביע/ה בעד' : s.lastVotes[id] === 'no' ? 'הצביע/ה נגד' : '') : '' })) };
    const role = this.role(ctx, s, pid);
    if (s.phase === 'roles') return { blocks: [say('סוכנים נגד מסתננים. בכל משימה המוביל בוחר צוות, כולם מצביעים אם לאשר, והצוות יוצא למשימה בסתר. מסתנן אחד מספיק כדי להכשיל.'), role,
      ctx.isHost(pid) ? btns(btn('▶ מתחילים', 'begin')) : text('מחכים למארח…', true)] };
    const blocks = [say(s.msg || `${ctx.name(leader)} מוביל/ה את המשימה.`), track, role];
    if (s.phase === 'propose') {
      if (pid === leader) blocks.push(h(`בחרו ${this.need(s)} לצוות`), { t: 'choices', act: 'toggle', selected: s.team, items: s.order.map(id => row(ctx, id)) },
        btns(btn(`שליחה להצבעה (${s.team.length}/${this.need(s)})`, 'propose', 'main', { disabled: s.team.length !== this.need(s) })));
      else blocks.push(text(`${ctx.name(leader)} בוחר/ת צוות של ${this.need(s)}: ${s.team.map(id => ctx.name(id)).join(', ') || '…'}`, true));
    } else if (s.phase === 'vote') {
      blocks.push(big(`הצוות: ${s.team.map(id => ctx.name(id)).join(', ')}`), { t: 'choices', act: 'vote', selected: s.votes[pid], items: [{ id: 'yes', name: '👍 מאשר/ת' }, { id: 'no', name: '👎 נגד' }] },
        text(`הצביעו ${Object.keys(s.votes).length} מתוך ${s.order.length}`, true));
    } else if (s.phase === 'mission') {
      if (s.team.includes(pid) && !s.plays[pid]) blocks.push(h('יצאת למשימה. מה עושים?'), btns(btn('✅ הצלחה', 'success', 'main'), s.spies.includes(pid) ? btn('❌ הכשלה', 'fail', 'ember') : null));
      else blocks.push(text(`הצוות במשימה… ${Object.keys(s.plays).length}/${s.team.length}`, true));
    } else if (s.phase === 'result') blocks.push(hostNext(ctx, pid, 'למשימה הבאה ▶'));
    return { blocks: [...blocks, table] };
  },
  over(ctx, spiesWin, why) {
    const s = ctx.g.s;
    ctx.finish(Object.fromEntries(s.order.map(id => [id, s.spies.includes(id) === spiesWin ? 3 : 0])), `${why} ${spiesWin ? 'המסתננים' : 'הסוכנים'} ניצחו! המסתננים היו ${s.spies.map(id => ctx.name(id)).join(', ')}.`);
  },
  closeVote(ctx) {
    const s = ctx.g.s, yes = Object.values(s.votes).filter(v => v === 'yes').length, no = Object.values(s.votes).filter(v => v === 'no').length;
    s.lastVotes = { ...s.votes }; s.votes = {};
    if (yes > no) { s.phase = 'mission'; s.plays = {}; s.rejects = 0; s.msg = `הצוות אושר ${yes} מול ${no}. יוצאים למשימה!`; return; }
    s.rejects++;
    if (s.rejects >= 5) return this.over(ctx, true, 'חמש דחיות ברצף. הסינדיקט משותק.');
    s.msg = `הצוות נדחה ${no} מול ${yes}. ההובלה עוברת הלאה.`; s.team = []; s.leader = (s.leader + 1) % s.order.length; s.phase = 'propose';
  },
  closeMission(ctx) {
    const s = ctx.g.s, fails = Object.values(s.plays).filter(v => v === 'fail').length, failed = fails >= (this.twoFails(s) ? 2 : 1);
    s.results.push(!failed);
    s.msg = failed ? `המשימה נכשלה! ${fails} ${fails === 1 ? 'קלף הכשלה' : 'קלפי הכשלה'}.` : `המשימה הצליחה!${fails ? ` (היה ${fails} קלף הכשלה, אבל צריך 2)` : ''}`;
    const ok = s.results.filter(Boolean).length, bad = s.results.length - ok;
    if (ok >= 3) return this.over(ctx, false, 'שלוש משימות הצליחו.');
    if (bad >= 3) return this.over(ctx, true, 'שלוש משימות נכשלו.');
    s.phase = 'result';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, leader = s.order[s.leader];
    if (s.phase === 'roles' && m.act === 'begin' && ctx.isHost(pid)) { s.phase = 'propose'; return; }
    if (s.phase === 'propose' && pid === leader) {
      if (m.act === 'toggle' && s.order.includes(m.id)) { if (s.team.includes(m.id)) s.team = s.team.filter(x => x !== m.id); else if (s.team.length < this.need(s)) s.team.push(m.id); }
      else if (m.act === 'propose' && s.team.length === this.need(s)) { s.phase = 'vote'; s.votes = {}; s.msg = `${ctx.name(pid)} הציע/ה צוות. מצביעים!`; }
    } else if (s.phase === 'vote' && m.act === 'vote' && (m.id === 'yes' || m.id === 'no')) {
      s.votes[pid] = m.id; if (s.order.every(id => s.votes[id])) this.closeVote(ctx);
    } else if (s.phase === 'mission' && s.team.includes(pid) && !s.plays[pid] && (m.act === 'success' || (m.act === 'fail' && s.spies.includes(pid)))) {
      s.plays[pid] = m.act; if (s.team.every(id => s.plays[id])) this.closeMission(ctx);
    } else if (s.phase === 'result' && m.act === 'next' && ctx.isHost(pid)) {
      s.mission++; s.leader = (s.leader + 1) % s.order.length; s.team = []; s.lastVotes = null; s.msg = ''; s.phase = 'propose';
    }
  },
  skip(ctx) {
    const s = ctx.g.s;
    if (s.phase === 'roles') s.phase = 'propose';
    else if (s.phase === 'propose') { s.team = shuffle(s.order).slice(0, this.need(s)); s.phase = 'vote'; s.votes = {}; }
    else if (s.phase === 'vote') { s.order.forEach(id => { if (!s.votes[id]) s.votes[id] = 'yes'; }); this.closeVote(ctx); }
    else if (s.phase === 'mission') { s.team.forEach(id => { if (!s.plays[id]) s.plays[id] = 'success'; }); this.closeMission(ctx); }
  },
};

/* ============ אולפן הצלילים ============ */
G.sounds = {
  id: 'sounds', name: 'אולפן הצלילים', icon: '🎙️', min: 3, max: 10,
  start(ctx) { return { phase: 'ready', order: shuffle(ctx.ids), i: 0, pool: shuffle(C.SOUNDS), sound: '', options: [], answers: {}, pts: zero(ctx.ids), end: 0 }; },
  view(ctx, pid) {
    const s = ctx.g.s, perf = s.order[s.i], me = pid === perf, scores = scoreRows(ctx, s.order, s.pts, id => ({ tag: id === perf ? 'מחקה' : (s.phase === 'live' && s.answers[id] ? '✔' : '') }));
    if (s.phase === 'ready') return { blocks: [say('מישהו מחקה צליל בלי מילים, וכל השאר בוחרים מהטלפון מה זה. מי שעונה נכון ומהר מקבל יותר נקודות.'), text(`תור ${s.i + 1} מתוך ${s.order.length}`, true),
      me ? btns(btn('▶ מוכן/ה, תנו צליל', 'go')) : big(`${ctx.name(perf)} מתכונן/ת`), scores] };
    if (s.phase === 'live') {
      if (me) return { blocks: [timer(s.end), { t: 'secret', tone: 'word', title: 'חקו בקול, בלי מילים:', text: s.sound }, text(`ענו ${Object.keys(s.answers).length} מתוך ${s.order.length - 1}`, true)] };
      return { blocks: [timer(s.end), big(`${ctx.name(perf)} מחקה…`, 'מה זה?'), s.answers[pid] ? text('ענית! מחכים לשאר…', true) : { t: 'choices', act: 'answer', items: s.options.map(o => ({ id: o, name: o })) }] };
    }
    const right = s.order.filter(id => s.answers[id] && s.answers[id].id === s.sound);
    return { blocks: [say(`זה היה "${s.sound}"! ${right.length ? `ניחשו נכון: ${right.map(id => ctx.name(id)).join(', ')}.` : 'אף אחד לא זיהה.'}`), scores,
      (ctx.isHost(pid) || me) ? btns(btn(s.i + 1 < s.order.length ? 'לצליל הבא ▶' : 'לתוצאות 🏁', 'next')) : text('מחכים להמשך…', true)] };
  },
  reveal(s) {
    const perf = s.order[s.i];
    const right = Object.entries(s.answers).filter(([, a]) => a.id === s.sound).sort((a, b) => a[1].t - b[1].t).map(([id]) => id);
    right.forEach((id, k) => { s.pts[id] += [3, 2][k] || 1; });
    s.pts[perf] += Math.min(3, right.length);
    s.phase = 'reveal';
  },
  act(ctx, pid, m) {
    const s = ctx.g.s, perf = s.order[s.i];
    if (s.phase === 'ready' && m.act === 'go' && pid === perf) {
      if (s.pool.length < 5) s.pool = shuffle(C.SOUNDS);
      s.sound = s.pool.pop(); s.options = shuffle([s.sound, ...shuffle(C.SOUNDS.filter(x => x !== s.sound)).slice(0, 4)]);
      s.answers = {}; s.phase = 'live'; s.end = Date.now() + 25000; const i = s.i;
      ctx.later(25000, () => { if (s.i === i && s.phase === 'live') this.reveal(s); });
    } else if (s.phase === 'live' && m.act === 'answer' && pid !== perf && !s.answers[pid] && s.options.includes(m.id)) {
      s.answers[pid] = { id: m.id, t: Date.now() };
      if (s.order.every(id => id === perf || s.answers[id])) this.reveal(s);
    } else if (s.phase === 'reveal' && m.act === 'next' && (pid === perf || ctx.isHost(pid))) this.next(ctx);
  },
  next(ctx) {
    const s = ctx.g.s;
    if (s.i + 1 >= s.order.length) return ctx.finish(rankAward(s.pts), 'האולפן נסגר! הנה האוזניים הכי חדות בחדר:');
    s.i++; s.phase = 'ready';
  },
  skip(ctx) { const s = ctx.g.s; if (s.phase === 'live') this.reveal(s); else this.next(ctx); },
};

module.exports = { GAMES: G, rankAward };
