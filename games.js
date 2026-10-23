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

module.exports = { GAMES: G, rankAward };
