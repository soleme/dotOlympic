/* =========================================================================
 * engine: field — 육상 도약/투척 + 스키점프 (turn-based solo)
 *   kinds: jump   멀리뛰기 / 세단뛰기
 *          height 높이뛰기 / 장대높이뛰기
 *          jav    창던지기
 *          shot   포환던지기
 *          spin   원반던지기 / 해머던지기 (top-down)
 *          ski    스키점프
 * Humans take turns (banner "P2 차례"); CPU results are simulated from
 * ent.skill and revealed round by round on a live leaderboard.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI, TAU = PI * 2;
  const BLANK = OG.blankInput();
  const IDLE = 8.5;                       // s without input → attempt auto-fails
  const r2 = v => Math.round(v * 100) / 100;
  const r3 = v => Math.round(v * 1000) / 1000;
  const DEG = PI / 180;

  /* ------------------------------------------------------------ input -- */
  const cnt = (i, b) => i[b + 'c'] || (i[b + 'p'] ? 1 : 0);
  const active = i => !!(i.l || i.r || i.u || i.d || i.a || i.lp || i.rp || i.up || i.dp || i.ap);
  // alternating ◀▶ presses → valid strokes (same key twice counts little)
  function mash(a, i) {
    let L = cnt(i, 'l'), Rr = cnt(i, 'r'), n = 0, guard = 0;
    while ((L > 0 || Rr > 0) && guard++ < 12) {
      if (a.ml !== 'l' && L > 0) { L--; n++; a.ml = 'l'; }
      else if (a.ml !== 'r' && Rr > 0) { Rr--; n++; a.ml = 'r'; }
      else { n += 0.2 * (L + Rr); break; }
    }
    return n;
  }
  // speed 0..1 from mashing: ~10 alternating presses/s → full speed
  function runSpd(a, i, dt, k, c) {
    const n = mash(a, i);
    a.spd = M.clamp(a.spd + n * (k || 0.14) - a.spd * (c || 1.4) * dt, 0, 1);
    return n;
  }
  // speed → performance factor (full mash = 1, 7.5 presses/s ≈ 0.84)
  const sf = v => 0.62 + 0.38 * Math.pow(M.clamp(v, 0, 1), 1.5);
  function idleTick(a, i, dt) {
    if (active(i)) a.idle = 0; else a.idle += dt;
    return a.idle > IDLE;
  }

  /* ------------------------------------------------------- framework -- */
  const KD = {};
  const cfgOf = s => OG.EVENT_MAP[s.evId].cfg;
  const pcol = e => e.h ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.lightgrey;
  const lab = e => e.h ? e.tag : e.c;
  const lookE = e => OG.lookOf({ country: e.c, look: e.lk });
  const attemptsFor = nh => nh <= 2 ? 3 : nh <= 4 ? 2 : 1;

  function pop(s, txt, c, x, y, sz, dur) {
    y = y == null ? 64 : y;
    for (const p of s.pops) if (p.t < 0.7 && Math.abs(p.y - y) < 12 && Math.abs(p.x - (x == null ? 240 : x)) < 120) y = p.y + 14;
    s.pops.push({ s: txt, c: c || PAL.yellow, x: Math.round(x == null ? 240 : x), y: Math.round(y == null ? 64 : y), z: sz || 'l', t: 0, d: dur || 1.1 });
    if (s.pops.length > 5) s.pops.shift();
  }
  // particle in world coords (m). g = gravity (m/s²), y up for side views
  function part(s, x, y, vx, vy, c, life, gr, sz) {
    if (s.parts.length > 64) s.parts.shift();
    s.parts.push({ x: r3(x), y: r3(y), vx: r2(vx), vy: r2(vy), c, l: r2(life), g: gr == null ? 9.8 : gr, z: sz || 1 });
  }
  function fxTick(s, dt) {
    for (let k = s.parts.length - 1; k >= 0; k--) {
      const p = s.parts[k];
      p.x = r3(p.x + p.vx * dt); p.y = r3(p.y + p.vy * dt);
      p.vy = r2(p.vy - p.g * dt); p.l = r2(p.l - dt);
      if (p.g > 0 && p.y < 0) { p.y = 0; p.vy = 0; p.vx = r2(p.vx * 0.6); }
      if (p.l <= 0) s.parts.splice(k, 1);
    }
    for (let k = s.pops.length - 1; k >= 0; k--) { s.pops[k].t = r2(s.pops[k].t + dt); if (s.pops[k].t > s.pops[k].d) s.pops.splice(k, 1); }
  }
  function drawParts(g, s, w2s) {
    for (const p of s.parts) {
      const q = w2s(p.x, p.y);
      g.alpha(M.clamp(p.l * 2, 0, 1));
      g.rect(q[0], q[1], p.z, p.z, p.c);
    }
    g.alpha(1);
  }

  function initState(ev, ents, opts, R) {
    const cfg = ev.cfg, K = KD[cfg.kind];
    const hum = ents.filter(e => e.human).map(e => e.idx);
    const nh = hum.length;
    const s = {
      evId: ev.id, kind: cfg.kind, mode: K.mode || 'best', t: -3, done: false,
      ph: 'cd', pt: 0, nh, hum,
      E: ents.map(e => ({ c: e.country, h: !!e.human, pid: e.human ? e.pid : -1, tag: e.tag || '', lk: e.look | 0 })),
      rounds: K.rounds ? K.rounds(nh, cfg) : attemptsFor(nh), rnd: 0, q: hum.slice(), qi: 0, cur: nh ? hum[0] : -1,
      P: ents.map(() => ({ v: [], best: -1, tot: 0 })),
      pre: ents.map(() => null),
      pops: [], parts: [], a: null, last: null, rec: false
    };
    if (s.mode === 'height') {
      s.H = K.heights(nh, cfg); s.hi = 0;
      s.P.forEach(p => { p.mk = []; p.miss = 0; p.tm = 0; p.out = false; });
    }
    ents.forEach((e, i) => { if (!e.human) s.pre[i] = K.cpu(s, e, R); });
    if (nh) s.a = K.start(s, R);
    return s;
  }

  function recalc(s, i) {
    const P = s.P[i];
    if (s.mode === 'sum') { P.tot = r2(P.v.reduce((t, v) => t + Math.max(0, v || 0), 0)); P.best = P.tot; return; }
    P.best = P.v.reduce((b, v) => (v != null && v > b ? v : b), -1);
  }
  function revealRound(s, r) {
    s.E.forEach((e, i) => { if (!e.h && s.pre[i] && r < s.pre[i].length) { s.P[i].v[r] = s.pre[i][r]; recalc(s, i); } });
  }
  function applyMark(s, i, hi, ch) {
    const P = s.P[i];
    P.mk[hi] = (P.mk[hi] || '') + ch;
    if (ch === 'O') { P.best = s.H[hi]; P.miss = 0; }
    else { P.miss++; P.tm++; if (P.miss >= 3) P.out = true; }
  }
  function revealHeight(s, hi) {
    s.E.forEach((e, i) => {
      if (e.h || !s.pre[i]) return;
      const m = s.pre[i][hi] || '';
      if (s.P[i].mk[hi] != null) return;
      if (!m) { s.P[i].mk[hi] = ''; return; }
      for (const ch of m) applyMark(s, i, hi, ch);
    });
  }
  function startQueue(s) {
    if (s.mode === 'height') {
      const hi = s.hi;
      s.q = s.hum.filter(i => { const P = s.P[i], m = P.mk[hi] || ''; return !P.out && m.indexOf('O') < 0 && m.length < 3; });
    } else s.q = s.hum.slice();
    s.qi = 0;
  }
  function beginTurn(s, R) {
    s.cur = s.q[s.qi];
    s.ph = 'ban'; s.pt = 0;
    s.parts = []; s.pops = [];
    s.a = KD[s.kind].start(s, R);
  }
  function beginEvent(s, R) {
    if (!s.nh) {
      if (s.mode === 'height') { for (let h = 0; h < s.H.length; h++) revealHeight(s, h); s.hi = s.H.length - 1; }
      else for (let r = 0; r < s.rounds; r++) revealRound(s, r);
      s.ph = 'end'; s.pt = 0; return;
    }
    if (s.mode === 'height') revealHeight(s, 0); else revealRound(s, 0);
    startQueue(s);
    beginTurn(s, R);
  }
  function finish(s) { s.ph = 'end'; s.pt = 0; }
  function advance(s, R) {
    s.qi++;
    if (s.qi < s.q.length) return beginTurn(s, R);
    if (s.mode === 'height') {
      startQueue(s);
      if (s.q.length) return beginTurn(s, R);
      while (s.hi < s.H.length - 1 && s.hum.some(i => !s.P[i].out)) {
        s.hi++;
        revealHeight(s, s.hi);
        startQueue(s);
        if (s.q.length) return beginTurn(s, R);
      }
      for (let h = s.hi + 1; h < s.H.length; h++) revealHeight(s, h);
      return finish(s);
    }
    s.rnd++;
    if (s.rnd < s.rounds) { revealRound(s, s.rnd); startQueue(s); return beginTurn(s, R); }
    finish(s);
  }
  function leaderVal(s, exclude) {
    let b = -1;
    s.P.forEach((P, i) => { if (i !== exclude && P.best > b) b = P.best; });
    return b;
  }
  function toPost(s) {
    const a = s.a, res = a.res, P = s.P[s.cur], K = KD[s.kind], c = cfgOf(s);
    const prevBest = P.best, lead = leaderVal(s, s.cur);
    if (s.mode === 'height') applyMark(s, s.cur, s.hi, res.v > 0 ? 'O' : 'X');
    else { P.v[s.rnd] = res.v; recalc(s, s.cur); }
    const L = { txt: res.txt, sub: res.sub || '', c: res.bad ? PAL.red : PAL.yellow, tag: '' };
    const val = s.mode === 'sum' ? res.v : (res.v > 0 ? (s.mode === 'height' ? s.H[s.hi] : res.v) : -1);
    if (res.tag) { L.tag = res.tag; OG.sfx(s, 'record'); }
    else if (val > 0 && c.wr && val > c.wr) { L.tag = '세계신기록!'; OG.sfx(s, 'record'); s.rec = true; }
    else if (!res.bad && P.best > lead && P.best > prevBest) { L.tag = '선두!'; OG.sfx(s, 'cheer'); }
    else if (!res.bad && s.mode !== 'height' && s.mode !== 'sum' && P.best > prevBest && prevBest > 0) { L.tag = '개인 최고!'; OG.sfx(s, 'good'); }
    else if (res.bad) OG.sfx(s, 'fail');
    else OG.sfx(s, 'crowd');
    s.last = L;
    s.ph = 'post'; s.pt = 0;
  }
  function standings(s) {
    const K = KD[s.kind];
    const rows = s.E.map((e, i) => {
      const P = s.P[i];
      let has, sc, txt;
      if (s.mode === 'height') {
        has = P.best > 0; sc = has ? P.best * 1000 - P.tm : -1;
        txt = has ? P.best.toFixed(2) : (P.mk.some(m => m) ? 'NM' : '-');
      } else if (s.mode === 'sum') {
        has = P.v.some(v => v != null); sc = P.tot; txt = has ? K.fmt(P.tot) : '-';
      } else {
        has = P.best >= 0; sc = P.best; txt = has ? K.fmt(P.best) : (P.v.length ? 'NM' : '-');
      }
      return { i, has, sc, txt, out: s.mode === 'height' && P.out };
    });
    rows.sort((x, y) => (y.has - x.has) || (y.sc - x.sc) || (x.i - y.i));
    return rows;
  }
  function results(s) {
    const K = KD[s.kind];
    const rows = s.E.map((e, idx) => {
      const P = s.P[idx];
      if (s.mode === 'height') {
        if (P.best <= 0) return { idx, score: 0, text: 'NM', dnf: true };
        return { idx, score: Math.round(P.best * 1000) - P.tm, text: P.best.toFixed(2) + 'm' };
      }
      if (s.mode === 'sum') return { idx, score: r2(P.tot), text: K.fmt(P.tot) };
      if (P.best < 0) return { idx, score: 0, text: 'NM', dnf: true };
      return { idx, score: P.best, text: K.fmt(P.best) };
    });
    return OG.sortResults(rows, false);
  }

  function tick(s, inputs, dt, R) {
    if (s.done) return;
    const prevT = s.t;
    s.t += dt; s.pt += dt;
    fxTick(s, dt);
    const K = KD[s.kind];
    const e = s.cur >= 0 ? s.E[s.cur] : null;
    const i = (e && e.h && inputs && inputs[e.pid]) || BLANK;
    switch (s.ph) {
      case 'cd':
        if ((prevT < -2 && s.t >= -2) || (prevT < -1 && s.t >= -1)) OG.sfx(s, 'beep');
        if (s.t >= 0) { OG.sfx(s, 'go'); beginEvent(s, R); }
        break;
      case 'ban':
        if (s.pt > 1.8 || (s.pt > 0.45 && i.ap)) { s.ph = 'play'; s.pt = 0; OG.sfx(s, 'whistle'); }
        break;
      case 'play':
        K.upd(s, i, dt, R);
        if (s.a.fin) toPost(s);
        break;
      case 'post':
        if (K.post) K.post(s, dt);
        if (s.pt > 2.6 || (s.pt > 0.9 && i.ap)) advance(s, R);
        break;
      case 'end':
        if (K.post) K.post(s, dt);
        if (s.pt > 1.8) { s.results = results(s); s.done = true; }
        break;
    }
  }

  /* -------------------------------------------------------------- HUD -- */
  function attemptLabel(s) {
    if (s.mode === 'height') {
      const P = s.P[s.cur], m = (P && P.mk[s.hi]) || '';
      return s.H[s.hi].toFixed(2) + 'm · ' + (m.length + 1) + '차 시기';
    }
    return (s.rounds > 1 ? (s.rnd + 1) + '/' + s.rounds : '1/1') + (KD[s.kind].roundWord || '차 시기');
  }
  function hudTop(g, s) {
    const ev = OG.EVENT_MAP[s.evId];
    g.rect(0, 0, 480, 15, 'rgba(24,20,37,0.92)');
    g.rect(0, 15, 480, 1, 'rgba(0,0,0,0.35)');
    g.text(ev.icon ? ev.name : ev.name, 5, 3, PAL.gold, { size: 's' });
    if (s.cur >= 0 && s.ph !== 'cd' && s.ph !== 'end') {
      const e = s.E[s.cur];
      const nameW = g.textW(ev.name, 's');
      let x = Math.max(110, 14 + nameW);
      g.flag(e.c, x, 4, 12, 8);
      g.text(e.tag, x + 16, 3, pcol(e), { size: 's' });
      g.text(OG.countryName(e.c), x + 18 + g.textW(e.tag, 's'), 3, PAL.white, { size: 's', maxW: 70 });
      g.text(attemptLabel(s), x + 100, 3, PAL.lightgrey, { size: 's' });
    }
    const st = standings(s);
    if (st.length && st[0].has) {
      const e = s.E[st[0].i];
      const tx = '1위 ' + lab(e) + ' ' + st[0].txt;
      const w = g.textW(tx, 's');
      g.flag(e.c, 474 - w - 16, 4, 12, 8);
      g.text(tx, 475, 3, PAL.white, { size: 's', align: 'right' });
    }
  }
  function board(g, s, x, y, hl) {
    const st = standings(s);
    const n = st.length, h = 15 + n * 10;
    g.panel(x, y, 146, h, { title: s.mode === 'height' ? '순위 · ' + s.H[s.hi].toFixed(2) + 'm' : '순위' });
    st.forEach((r, k) => {
      const e = s.E[r.i], yy = y + 8 + k * 10;
      if (r.i === hl) g.rect(x + 2, yy - 1, 142, 10, 'rgba(254,231,97,0.18)');
      g.text(r.has ? String(k + 1) : '-', x + 10, yy, r.has && k < 3 ? [PAL.medalGold, PAL.medalSilver, PAL.medalBronze][k] : PAL.grey, { size: 'xs', align: 'center' });
      g.flag(e.c, x + 17, yy, 12, 8);
      g.text(lab(e), x + 33, yy, e.h ? pcol(e) : PAL.lightgrey, { size: 'xs' });
      if (s.mode === 'height') {
        const m = e.h || s.P[r.i].mk[s.hi] != null ? (s.P[r.i].mk[s.hi] || '') : '';
        g.text(m, x + 70, yy, r.out ? PAL.red : PAL.grey, { size: 'xs' });
      }
      g.text(r.txt, x + 140, yy, r.out ? PAL.grey : PAL.white, { size: 'xs', align: 'right' });
    });
  }
  function hint(g, str, y) {
    const w = Math.max(120, Math.round(g.textW(str.replace(/\{[A-Z]\}/g, 'XX'), 's')) + 24);
    g.rect(240 - w / 2, (y || 252) - 3, w, 15, 'rgba(24,20,37,0.72)');
    g.rich(str, 240, y || 252, PAL.white, { align: 'center' });
  }
  function drawPops(g, s) {
    for (const p of s.pops) {
      const k = p.t / p.d;
      const yy = p.y - Math.round(k * 10);
      if (k > 0.75) g.alpha((1 - k) * 4);
      g.text(p.s, p.x, yy, p.c, { size: p.z, align: 'center', outline: PAL.black });
      g.alpha(1);
    }
  }
  function overlay(g, s) {
    drawPops(g, s);
    hudTop(g, s);
    if (s.ph === 'cd') {
      board(g, s, 328, 24, -1);
      g.text(OG.EVENT_MAP[s.evId].name, 160, 52, PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
      g.countdown(-s.t);
    } else if (s.ph === 'ban') {
      const e = s.E[s.cur], col = pcol(e);
      const k = M.easeOut(Math.min(1, s.pt / 0.3));
      const ox = Math.round((1 - k) * -320);
      g.rect(ox, 84, 318, 54, 'rgba(24,20,37,0.82)');
      g.rect(ox, 84, 318, 2, col); g.rect(ox, 136, 318, 2, col);
      g.flag(e.c, ox + 14, 97, 36, 24, { wave: g.t });
      g.text(e.tag + ' 차례', ox + 60, 88, col, { size: 'xl', outline: PAL.black });
      g.text(OG.countryName(e.c), ox + 62, 116, PAL.white, { size: 'm', maxW: 120 });
      g.text(attemptLabel(s), ox + 300, 118, PAL.yellow, { size: 's', align: 'right' });
      board(g, s, 328, 24, s.cur);
      if (s.pt > 0.45 && Math.floor(s.pt * 3) % 2 === 0) g.rich('{A} 시작', 160, 146, PAL.white, { align: 'center' });
    } else if (s.ph === 'post' && s.last) {
      const L = s.last;
      const sc = Math.min(1, s.pt / 0.2);
      g.rect(0, 30, 320, 46 + (L.tag ? 14 : 0), 'rgba(24,20,37,0.55)');
      g.text(L.txt, 160, 34 + Math.round((1 - sc) * 8), L.c, { size: 'xl', align: 'center', outline: PAL.black });
      if (L.sub) g.text(L.sub, 160, 61, PAL.white, { size: 's', align: 'center', outline: PAL.black });
      if (L.tag && Math.floor(s.pt * 4) % 2 === 0) g.text(L.tag, 160, 73, L.tag === '세계신기록!' ? PAL.hotpink : PAL.green, { size: 'b', align: 'center', outline: PAL.black });
      if (L.tag === '세계신기록!') g.confetti(g.t, 60);
      board(g, s, 328, 24, s.cur);
    } else if (s.ph === 'end') {
      board(g, s, 328, 24, -1);
      g.banner('경기 종료', 100, PAL.white);
    }
  }

  /* ========================================================= SCENERY === */
  const BOARD_TXT = ['DOT GAMES 2026', 'AICHI-NAGOYA', 'PIXEL SPORTS', 'FAIR PLAY', '8-BIT POWER', 'GO FOR GOLD'];
  const BOARD_COL = ['#124e89', '#a22633', '#265c42', '#68386c', '#be4a2f', '#193c3e'];
  function adBoards(g, y, h, ox) {
    const seg = 104;
    ox = Math.floor(ox);
    const sh = M.wrap(ox, seg), base = Math.floor((ox - sh) / seg);
    g.rect(0, y, 480, h, PAL.black);
    for (let k = 0; k < 7; k++) {
      const wi = base + k, sx = k * seg - sh;
      const c = BOARD_COL[M.wrap(wi, BOARD_COL.length)];
      g.rect(sx + 1, y + 1, seg - 2, h - 2, c);
      g.rect(sx + 1, y + 1, seg - 2, 1, OG.shade(c, 0.25));
      g.text(BOARD_TXT[M.wrap(wi * 5 + 1, BOARD_TXT.length)], sx + seg / 2, y + Math.round((h - 8) / 2), '#fff', { size: 'xs', align: 'center' });
    }
  }
  function lightTower(g, x, y) {
    g.rect(x - 1, y, 2, 40, '#3a4466');
    g.rect(x - 9, y - 8, 18, 9, '#262b44');
    for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) g.rect(x - 8 + k * 4, y - 7 + j * 4, 3, 3, '#fff6c8');
  }
  const CROWD_DARK = ['#a22633', '#be7a2a', '#1f6d9e', '#9aa3b5', '#3e8948', '#7a3a66', '#b0541c', '#8b95a8', '#1f9fae', '#b8a24a'];
  // side-view stadium: everything behind the competition ground. campx = camera in px
  function sideStadium(g, campx, o) {
    o = o || {};
    const t = g.t;
    g.grad(0, 0, 480, 40, o.sky1 || '#3f8fe0', o.sky2 || '#a8dcff', 6);
    g.clouds(t, 6, 3, 'rgba(255,255,255,0.75)', 4);
    const tw = 260, tsh = M.wrap(Math.floor(campx * 0.1), tw);
    for (let k = 0; k < 3; k++) lightTower(g, k * tw - tsh + 60, 4);
    // roof canopy
    g.rect(0, 20, 480, 9, '#1e2238');
    g.rect(0, 29, 480, 2, '#4a5274');
    for (let k = 0; k < 14; k++) g.rect(M.wrap(k * 40 - Math.floor(campx * 0.16), 560) - 40, 20, 2, 9, '#323a5c');
    // upper tier (in the roof's shade)
    g.crowd(0, 31, 480, 36, t, { ox: campx * 0.18, seed: 3, excite: (o.excite || 0) * 0.6, bg: '#1d2136', density: 0.78, colors: CROWD_DARK });
    aisles(g, 31, 36, campx * 0.18, 150, '#2a3050');
    // video screen
    const vx = M.wrap(Math.floor(330 - campx * 0.18), 760) - 140;
    if (vx > -90 && vx < 490) videoScreen(g, vx, 33, o.screen);
    g.rect(0, 67, 480, 3, '#8b9bb4'); g.rect(0, 70, 480, 2, '#3a4466');
    // lower tier
    g.crowd(0, 72, 480, 42, t, { ox: campx * 0.3, seed: 7, excite: o.excite || 0, bg: '#2f3657' });
    aisles(g, 72, 42, campx * 0.3, 120, '#4a5274');
    g.rect(0, 113, 480, 2, '#c0cbdc');
    adBoards(g, 115, 11, campx * 0.5);
    // track around the infield
    const ty = 126;
    g.rect(0, ty, 480, 14, PAL.track);
    g.rect(0, ty + 4, 480, 1, 'rgba(242,232,216,0.55)'); g.rect(0, ty + 9, 480, 1, 'rgba(242,232,216,0.55)');
    g.rect(0, ty + 13, 480, 1, PAL.trackline);
    // grass infield with mowing bands (parallax .75)
    const gy0 = ty + 14, gh = (o.groundTop || 196) - gy0;
    g.rect(0, gy0, 480, gh, PAL.grass);
    const bw = 48, bsh = M.wrap(Math.floor(campx * 0.75), bw * 2);
    for (let x = -bsh; x < 480; x += bw * 2) g.rect(x, gy0, bw, gh, '#58ac52');
  }
  function aisles(g, y, h, ox, spacing, c) {
    const sh = M.wrap(Math.floor(ox), spacing);
    for (let x = -sh + spacing / 2; x < 490; x += spacing) {
      g.rect(x - 3, y, 7, h, c);
      for (let yy = y + 2; yy < y + h; yy += 4) g.rect(x - 3, yy, 7, 1, 'rgba(0,0,0,0.25)');
    }
  }
  function videoScreen(g, x, y, sc) {
    g.rect(x - 2, y - 2, 84, 32, '#0d0f1c');
    g.rect(x, y, 80, 28, '#101a33');
    for (let yy = y; yy < y + 28; yy += 2) g.rect(x, yy, 80, 1, 'rgba(255,255,255,0.03)');
    g.rect(x + 18, y + 30, 3, 6, '#3a4466'); g.rect(x + 60, y + 30, 3, 6, '#3a4466');
    if (sc && sc.c) {
      g.flag(sc.c, x + 4, y + 4, 18, 12, { border: false });
      g.text(sc.t1 || '', x + 26, y + 4, sc.col || PAL.white, { size: 'xs', maxW: 52 });
      g.text(sc.t2 || '', x + 40, y + 17, PAL.yellow, { size: 'xs', align: 'center', maxW: 76 });
    } else {
      g.text('DOT GAMES', x + 40, y + 6, PAL.gold, { size: 'xs', align: 'center' });
      g.text('2026', x + 40, y + 16, PAL.white, { size: 'xs', align: 'center' });
    }
  }
  // what the stadium screen shows for the current athlete
  function screenInfo(s) {
    if (s.cur < 0) return null;
    const e = s.E[s.cur], P = s.P[s.cur];
    let t2;
    if (s.ph === 'post' && s.last) t2 = s.last.txt;
    else if (s.mode === 'height') t2 = s.H[s.hi].toFixed(2) + 'm';
    else t2 = P.best > 0 ? 'BEST ' + KD[s.kind].fmt(P.best) : OG.EVENT_MAP[s.evId].en.toUpperCase();
    return { c: e.c, t1: e.tag + ' ' + e.c, t2, col: pcol(e) };
  }
  /* --------------------------------------------------------- gauges -- */
  // launch-direction arc gauge (drawn at the athlete): zone lo..hi highlighted
  function angleGauge(g, cx, cy, r, ang, lo, hi, maxA, f) {
    f = f || 1;
    const P = (d, rr) => [cx + f * Math.cos(d * DEG) * rr, cy - Math.sin(d * DEG) * rr];
    g.alpha(0.55);
    for (let d = 0; d <= maxA; d += 2) { const p0 = P(d, r - 7), p1 = P(d, r); g.line(p0[0], p0[1], p1[0], p1[1], PAL.black, 2); }
    g.alpha(1);
    for (let d = 0; d <= maxA; d += 1) {
      const ok = d >= lo && d <= hi;
      const p0 = P(d, ok ? r - 6 : r - 3), p1 = P(d, r - 1);
      g.line(p0[0], p0[1], p1[0], p1[1], ok ? PAL.green : d % 10 === 0 ? PAL.white : 'rgba(255,255,255,0.45)', 1);
    }
    const a = M.clamp(ang, 0, maxA);
    const p0 = P(a, 6), p1 = P(a, r + 5);
    g.line(p0[0], p0[1], p1[0], p1[1], PAL.black, 3);
    g.line(p0[0], p0[1], p1[0], p1[1], ang >= lo && ang <= hi ? PAL.green : PAL.yellow, 1);
    const pt = P(a, r + 12);
    g.text(Math.round(ang) + '°', pt[0], pt[1] - 5, ang >= lo && ang <= hi ? PAL.green : PAL.yellow, { size: 'b', align: 'center', outline: PAL.black });
  }
  function speedBar(g, x, y, w, v, label) {
    g.text(label || '속도', x, y - 1, PAL.lightgrey, { size: 'xs' });
    const lw = 26;
    g.bar(x + lw, y, w - lw, 7, v, v > 0.9 ? PAL.green : v > 0.6 ? PAL.yellow : PAL.orange, PAL.navy);
  }

  /* ================================================== side-view kit === */
  // official with flag (white = valid, red = foul)
  function official(g, x, gy, flag, t) {
    g.figure(x, gy, flag ? OG.Pose.armsUp() : OG.Pose.stand(), { shirt: '#f2e8d8', pants: '#262b44', skin: PAL.skin2, hair: PAL.black, cap: '#f2e8d8' }, { facing: -1, scale: 1 });
    if (flag) {
      const fx = x + 2, fy = gy - 31;
      g.line(fx, fy, fx, fy + 10, PAL.lightgrey);
      const c = flag === 'red' ? PAL.red : '#ffffff';
      const wv = Math.round(Math.sin(t * 10));
      g.rect(fx + 1, fy, 7, 5 + wv, c); g.rect(fx + 1, fy, 7, 1, OG.shade(c, -0.2));
    }
  }
  function nameTag(g, s, x, y) {
    const e = s.E[s.cur];
    if (!e) return;
    g.text(e.tag, x, y, pcol(e), { size: 'xs', align: 'center', outline: PAL.black });
  }
  // distance marker post on the near side
  function distPost(g, x, y, txt, c) {
    g.rect(x, y, 1, 10, PAL.white);
    g.rect(x - 9, y - 9, 19, 9, c || PAL.navy);
    g.text(txt, x + 1, y - 9, PAL.white, { size: 'xs', align: 'center' });
  }
  // leader line on the ground (TV graphic)
  function leaderLine(g, s, X, y0, y1) {
    const st = standings(s);
    if (!st.length || !st[0].has) return;
    const best = s.P[st[0].i].best;
    if (best <= 0) return;
    const x = X(best);
    if (x < -20 || x > 500) return;
    const e = s.E[st[0].i];
    g.alpha(0.75); g.rect(x, y0, 2, y1 - y0, PAL.cyan); g.alpha(1);
    g.flag(e.c, x - 5, y0 - 10, 12, 8);
  }

  /* ================================================================ JUMP === */
  const VRUN = 10.6;
  const SAND = '#e8cf95', SAND2 = '#d4b574', SAND3 = '#c49e5e';
  KD.jump = {
    roundWord: '차 시기',
    fmt: v => v.toFixed(2) + 'm',
    cpu(s, e, R) {
      const c = OG.EVENT_MAP[s.evId].cfg, out = [];
      for (let r = 0; r < s.rounds; r++) {
        const q = OG.cpuQuality({ skill: e.skill }, R, 0.1);
        if (R.chance(0.07 + (1 - q) * 0.2)) out.push(-1);
        else out.push(r2(c.cpuA + c.cpuB * q + R.gauss() * c.cpuB * 0.03));
      }
      return out;
    },
    start(s, R) {
      const c = cfgOf(s);
      return { ph: 'ready', x: -c.run, fy: 0, spd: 0, ml: '', st: 0, t: 0, idle: 0, cam: -c.run - 6, ang: 0, at: 0, tx: 0,
        foul: false, seg: -1, q: [], pr: false, fl: null, lt: 0, ct: 0, mark: null, dist: -1, fin: false, res: null,
        wind: r2(R.range(-0.6, 1.9)) };
    },
    upd(s, i, dt, R) {
      const a = s.a, c = cfgOf(s), tri = c.tri;
      a.t += dt;
      if ((a.ph === 'ready' || a.ph === 'run') && idleTick(a, i, dt)) return jumpFinish(s, true, '시간 초과');
      if (a.ph === 'ready') {
        const n = mash(a, i);
        if (n > 0) { a.ph = 'run'; a.spd = 0.12; }
      } else if (a.ph === 'run') {
        runSpd(a, i, dt);
        const v = a.spd * VRUN, d = v * dt;
        const s0 = Math.floor(a.st * 2);
        a.x += d; a.st += d / 2.2;
        if (Math.floor(a.st * 2) !== s0) OG.sfx(s, 'step');
        if (i.ap) {
          a.tx = a.x; a.foul = a.x > 0;
          if (tri) { tjSeg(s, 0); OG.sfx(s, 'jump'); }
          else { a.ph = 'ang'; a.ang = 0; a.at = 0; }
          if (a.x <= 0 && a.x > -0.12) pop(s, '굿 발구름!', PAL.green, 160, 70, 'b');
        } else if (a.x > 0.5) { // ran through without jumping
          a.foul = true; a.tx = a.x; a.ph = 'stumble'; a.lt = 0; OG.sfx(s, 'fail');
          pop(s, '발구름 실패!', PAL.red, 160, 70, 'b');
        }
      } else if (a.ph === 'ang') {
        a.at += dt;
        if (i.a && a.ang < 60) a.ang = Math.min(60, a.ang + 48 * dt);
        if (!i.a || a.ang >= 60 || a.at > 1.6) {
          const aq = M.clamp(1 - Math.pow((a.ang - 22.5) / 24, 2), 0.25, 1);
          const D = c.dmax * sf(a.spd) * aq + a.wind * 0.02;
          a.fl = { x0: a.tx, x1: r3(a.tx + D), h: r3(Math.max(0.15, D * Math.tan(Math.max(4, a.ang) * DEG) / 4)), T: r3(0.45 + D * 0.068), t: 0, k: 2 };
          a.ph = 'air'; OG.sfx(s, 'jump');
          if (Math.abs(a.ang - 22.5) <= 2.5) pop(s, 'PERFECT!', PAL.yellow, 160, 52, 'l');
          else if (a.ang >= 17 && a.ang <= 28) pop(s, 'GOOD', PAL.green, 160, 52, 'l');
        }
      } else if (a.ph === 'air') {
        const f = a.fl;
        f.t = r3(f.t + dt);
        if (tri && f.k < 2 && i.ap && !a.pr) {
          const err = f.t - f.T;
          a.pr = true;
          if (err < -0.17) { a.q[f.k] = 0; pop(s, 'EARLY', PAL.orange, 160, 70, 'b'); }
          else {
            a.q[f.k] = r2(M.clamp(1 - Math.abs(err) / 0.17, 0, 1));
            tjPop(s, a.q[f.k]);
            if (err >= 0) { OG.sfx(s, 'step'); tjSeg(s, f.k + 1); OG.sfx(s, 'jump'); return; }
          }
        }
        if (f.t >= f.T) {
          a.x = f.x1; a.fy = 0;
          if (tri && f.k < 2) {
            OG.sfx(s, 'step');
            dust(s, a.x, 3, PAL.track);
            if (a.pr) { tjSeg(s, f.k + 1); OG.sfx(s, 'jump'); }
            else { a.ph = 'contact'; a.ct = 0; }
          } else jumpLand(s);
        }
      } else if (a.ph === 'contact') {
        a.ct += dt;
        const k = a.fl.k;
        if (i.ap) {
          a.q[k] = r2(M.clamp(1 - a.ct / 0.17, 0, 1)); tjPop(s, a.q[k]);
          tjSeg(s, k + 1); OG.sfx(s, 'jump');
        } else if (a.ct > 0.17) {
          a.q[k] = -1; pop(s, 'MISS', PAL.red, 160, 70, 'b');
          tjSeg(s, k + 1); OG.sfx(s, 'jump');
        }
      } else if (a.ph === 'stumble') {
        a.lt += dt;
        a.x += Math.max(0, a.spd * VRUN * (1 - a.lt * 1.4)) * dt;
        if (a.lt > 1.6) jumpFinish(s, true, '파울');
      } else if (a.ph === 'land') {
        a.lt += dt;
        if (a.lt < 0.25) a.x += (0.35 - a.lt) * 1.2 * dt;
        if (a.lt > 1.9) jumpFinish(s, a.foul || a.dist < 0, a.foul ? '파울' : (a.dist < 0 ? '모래판 미달' : ''));
      }
      // camera
      const cx = a.ph === 'land' ? Math.max(a.mark - 11, a.x - 9) : a.x - 6.5;
      a.cam = r3(a.cam + (cx - a.cam) * Math.min(1, dt * (a.ph === 'air' || a.ph === 'land' ? 4 : 8)));
    },
    post(s, dt) {},
    draw(g, s) { drawJump(g, s); }
  };
  function tjPop(s, q) {
    if (q >= 0.8) { pop(s, 'PERFECT!', PAL.yellow, 160, 66, 'l'); OG.sfx(s, 'perfect'); }
    else if (q >= 0.45) pop(s, 'GOOD', PAL.green, 160, 66, 'l');
    else pop(s, 'LATE', PAL.orange, 160, 66, 'b');
  }
  function tjSeg(s, k) {
    const a = s.a;
    const S = sf(a.spd);
    const f = q => q == null ? 0.88 : q < 0 ? 0.62 : 0.88 + 0.12 * q;
    let L;
    if (k === 0) L = 6.6 * S; else if (k === 1) L = 5.45 * S * f(a.q[0]); else L = 6.35 * S * f(a.q[0]) * f(a.q[1]);
    L = Math.max(0.8, L);
    const x0 = k === 0 ? a.tx : a.fl.x1;
    a.fl = { x0: r3(x0), x1: r3(x0 + L), h: r3([0.62, 0.48, 1.25][k] * (0.5 + 0.5 * S)), T: r3([0.6, 0.5, 0.86][k] * (0.6 + 0.4 * S)), t: 0, k };
    a.ph = 'air'; a.pr = false; a.seg = k;
  }
  function dust(s, x, n, c) {
    for (let k = 0; k < n; k++) part(s, x + (OG.hash(k, x * 100 | 0, 3) - 0.5) * 0.4, 0.05, (OG.hash(k, 7, x * 10 | 0) - 0.3) * 2, 0.6 + OG.hash(k, 9, 1) * 1.2, c, 0.5, 6);
  }
  function jumpLand(s) {
    const a = s.a, c = cfgOf(s);
    a.ph = 'land'; a.lt = 0; a.mark = a.fl.x1;
    a.dist = a.mark < c.pit0 ? -1 : Math.floor(a.mark * 100) / 100;
    OG.sfx(s, 'land');
    for (let k = 0; k < 16; k++) {
      const h1 = OG.hash(k, a.mark * 100 | 0, 5), h2 = OG.hash(k, 3, a.mark * 10 | 0);
      part(s, a.mark + (h1 - 0.5) * 0.5, 0.05, (h1 - 0.35) * 3.2, 1.2 + h2 * 2.6, h2 > 0.5 ? SAND : SAND2, 0.9 + h2 * 0.4, 9.8, h2 > 0.7 ? 2 : 1);
    }
  }
  function jumpFinish(s, bad, why) {
    const a = s.a;
    a.fin = true;
    if (bad) a.res = { v: -1, txt: '파울', sub: why && why !== '파울' ? why : '', bad: true };
    else a.res = { v: a.dist, txt: a.dist.toFixed(2) + 'm', sub: '풍속 ' + (a.wind >= 0 ? '+' : '') + a.wind.toFixed(1) + 'm/s', bad: false };
  }
  function jumpPose(s) {
    const a = s.a, c = cfgOf(s);
    const P = OG.Pose;
    if (a.ph === 'ready') return { pose: P.stand(), fy: 0 };
    if (a.ph === 'run') return { pose: P.run(a.st % 1, 0.4 + 0.6 * a.spd), fy: 0 };
    if (a.ph === 'stumble') return { pose: a.lt < 0.5 ? P.run((a.st + a.lt * 2) % 1, 0.8) : P.sad(), fy: 0 };
    if (a.ph === 'ang') {
      const k = M.clamp(a.ang / 40, 0, 1);
      return { pose: P.mix(P.run(0.25, 1), { t: 0.05, aL: 2.2, aR: -0.6, eL: 0.6, eR: 0.9, lL: 1.4, lR: -0.15, kL: 1.4, kR: 0.1 }, 0.4 + 0.6 * k), fy: 0.05 + k * 0.12 };
    }
    if (a.ph === 'contact') return { pose: P.run(0.4, 1), fy: 0 };
    if (a.ph === 'air') {
      const f = a.fl, u = M.clamp(f.t / f.T, 0, 1);
      const fy = 4 * f.h * u * (1 - u);
      if (f.k < 2) {
        const lead = f.k === 1 ? 1 : 0; // alternate lead leg
        const bound = { t: 0.2, aL: lead ? 1.3 : -0.9, aR: lead ? -0.9 : 1.3, eL: 0.5, eR: 0.5, lL: lead ? -0.5 : 1.15, lR: lead ? 1.15 : -0.5, kL: lead ? 0.9 : 1.3, kR: lead ? 1.3 : 0.9 };
        const land = { t: 0.15, aL: 0.6, aR: -0.4, eL: 0.6, eR: 0.6, lL: 0.5, lR: -0.2, kL: 0.3, kR: 0.6 };
        return { pose: P.mix(bound, land, Math.max(0, (u - 0.7) / 0.3)), fy };
      }
      // hitch-kick sail → landing reach
      if (u < 0.2) return { pose: P.mix({ t: 0.05, aL: 2.2, aR: -0.6, eL: 0.6, eR: 0.9, lL: 1.4, lR: -0.15, kL: 1.4, kR: 0.1 }, P.jump(), u / 0.2), fy };
      if (u < 0.68) { const ph = (u - 0.2) / 0.48; return { pose: P.mix(P.run(ph * 1.5 % 1, 0.9), { t: -0.1, aL: 2.8, aR: 2.6, eL: 0.2, eR: 0.2, lL: 0.6, lR: 0.2, kL: 1.4, kR: 1.0 }, 0.35), fy }; }
      const k = (u - 0.68) / 0.32;
      return { pose: P.mix({ t: -0.1, aL: 2.8, aR: 2.6, eL: 0.2, eR: 0.2, lL: 0.6, lR: 0.2, kL: 1.4, kR: 1.0 }, { t: 0.75, aL: 1.7, aR: 1.5, eL: 0.1, eR: 0.1, lL: 1.55, lR: 1.45, kL: 0.15, kR: 0.15 }, k), fy };
    }
    if (a.ph === 'land') {
      if (a.dist < 0 && !a.foul && a.mark < c.pit0) return { pose: a.lt < 0.4 ? P.sit() : P.sad(), fy: 0 };
      if (a.lt < 0.9) return { pose: P.mix({ t: 0.75, aL: 1.7, aR: 1.5, eL: 0.1, eR: 0.1, lL: 1.55, lR: 1.45, kL: 0.15, kR: 0.15 }, P.sit(), Math.min(1, a.lt / 0.25)), fy: 0, sit: true };
      return { pose: a.foul ? P.sad() : P.celebrate(a.lt * 1.5), fy: 0 };
    }
    return { pose: P.stand(), fy: 0 };
  }
  function drawJump(g, s) {
    const a = s.a, c = cfgOf(s), PPM = 24;
    const cam = a ? a.cam : -c.run - 6;
    const X = wx => Math.round((wx - cam) * PPM);
    const GY = 212;
    const excite = a && (a.ph === 'air' || a.ph === 'land') ? 0.5 : 0.08;
    sideStadium(g, cam * PPM, { excite, groundTop: 198, screen: screenInfo(s) });
    // runway band
    g.rect(0, 198, 480, 26, '#4fa04a');
    g.rect(0, 201, 480, 21, PAL.track);
    g.rect(0, 201, 480, 1, PAL.trackline); g.rect(0, 221, 480, 1, PAL.trackline);
    // runway marks every 1 m (texture) + start markers
    for (let m = Math.floor(cam) - 1; m < cam + 21; m++) {
      if (m >= c.pit0 - 0.5) continue;
      const x = X(m);
      g.rect(x, 211, 1, 1, 'rgba(0,0,0,0.12)');
      if (m % 5 === 0 && m < 0) g.rect(x, 222, 1, 2, PAL.trackline);
    }
    // board
    const bx = X(-0.2);
    g.rect(bx, 202, Math.round(0.2 * PPM), 19, '#f4f0e6');
    g.rect(bx + Math.round(0.2 * PPM), 202, 3, 19, '#9fd8a0'); // plasticine indicator
    // sand pit
    const p0 = X(c.pit0), p1 = X(c.pit0 + 9);
    g.rect(p0 - 2, 199, p1 - p0 + 4, 25, '#f2e8d8');
    g.rect(p0, 200, p1 - p0, 23, SAND);
    for (let k = 0; k < 9; k++) { const yy = 202 + k * 2.4; g.rect(p0 + 2, Math.round(yy), p1 - p0 - 4, 1, k % 2 ? SAND2 : 'rgba(255,255,255,0.18)'); }
    // near grass + distance posts
    g.rect(0, 224, 480, 46, '#4b9a46');
    for (let x = -M.wrap(Math.floor(cam * PPM), 60); x < 480; x += 60) g.rect(x, 224, 30, 46, '#53a44d');
    g.rect(0, 224, 480, 1, '#3e8948');
    const dmin = c.tri ? 12 : 5, dmax = c.tri ? 19 : 10;
    for (let d = dmin; d <= dmax; d++) {
      const x = X(d);
      if (x < -10 || x > 490) continue;
      g.rect(x, 222, 1, 3, PAL.white);
      distPost(g, x, 236, d + 'm', d % 2 ? PAL.navy : PAL.darkblue);
    }
    // leader line in the pit
    leaderLine(g, s, X, 200, 223);
    // official near the board
    if (a) {
      const flag = a.fin || (a.ph === 'land' && a.lt > 0.5) || (a.ph === 'stumble' && a.lt > 0.4) ? (a.foul || (a.dist < 0) ? 'red' : 'white') : null;
      official(g, X(-1.2), 197, flag, g.t);
    }
    if (!a) return;
    // landing mark + tape
    if (a.mark != null) {
      const mx = X(a.mark);
      g.rect(mx - 2, 210, 5, 3, SAND3); g.rect(mx - 1, 209, 3, 1, SAND2);
      if (a.lt > 0.5 && !a.foul && a.dist > 0) {
        const k = M.clamp((a.lt - 0.5) / 0.5, 0, 1);
        const x0 = X(0), x1 = Math.round(M.lerp(x0, mx, k));
        g.rect(x0, 216, x1 - x0, 1, PAL.yellow);
        g.rect(x1, 214, 1, 5, PAL.yellow);
        if (k >= 1) { g.rect(mx, 150, 1, 58, 'rgba(254,231,97,0.7)'); g.text(a.dist.toFixed(2) + 'm', mx, 138, PAL.yellow, { size: 'b', align: 'center', outline: PAL.black }); }
      }
    }
    // triple-jump landing ring
    if (c.tri && a.ph === 'air' && a.fl.k < 2 && !a.pr) {
      const f = a.fl, rem = f.T - f.t;
      const rr = Math.max(3, Math.round(3 + rem * 40));
      const lx = X(f.x1);
      const inWin = Math.abs(rem) < 0.17;
      g.ellipse(lx, GY, rr + 1, Math.max(2, (rr + 1) * 0.35), 'rgba(0,0,0,0.25)');
      g.circleO(lx, GY - 1, rr, inWin ? PAL.green : PAL.white);
      g.rect(lx - 2, GY - 1, 5, 2, inWin ? PAL.green : PAL.yellow);
    } else if (c.tri && a.ph === 'contact') {
      const lx = X(a.x);
      g.circleO(lx, GY - 1, 4, PAL.green);
    }
    // athlete
    const ap = jumpPose(s);
    const ax = X(a.x === undefined ? 0 : (a.ph === 'air' ? M.lerp(a.fl.x0, a.fl.x1, M.clamp(a.fl.t / a.fl.T, 0, 1)) : a.x));
    const ay = GY - Math.round(ap.fy * PPM);
    g.shadow(ax, GY + 1, 8);
    const e = s.E[s.cur];
    const look = lookE(e);
    let J;
    if (ap.sit) J = g.figure(ax, GY + 2, ap.pose, look, { facing: 1, scale: 2 });
    else J = g.figure(ax, ay, ap.pose, look, { facing: 1, scale: 2 });
    // bib
    g.rect(Math.round((J.hip[0] + J.neck[0]) / 2) - 1, Math.round((J.hip[1] + J.neck[1]) / 2) - 2, 3, 3, '#f4f0e6');
    nameTag(g, s, ax, Math.min(J.head[1], ay - 40) - 14);
    drawParts(g, s, (x, y) => [X(x), GY - Math.round(y * PPM)]);
    if (!c.tri && (a.ph === 'ang' || (a.ph === 'air' && a.fl.t < 0.35))) angleGauge(g, X(a.tx) + 4, GY - 2, 44, a.ang, 20, 25, 60);
    // HUD bottom
    if (s.ph === 'play' || s.ph === 'ban') {
      g.rect(0, 248, 480, 22, 'rgba(24,20,37,0.6)');
      speedBar(g, 8, 256, 110, a.spd);
      g.text('풍속 ' + (a.wind >= 0 ? '+' : '') + a.wind.toFixed(1), 472, 256, PAL.lightgrey, { size: 'xs', align: 'right' });
      
      if (s.ph === 'play') {
        if (a.ph === 'ready') hint(g, '{L}{R} 번갈아 연타로 도움닫기!');
        else if (a.ph === 'run') hint(g, a.x < -8 ? '{L}{R} 연타!  발구름판에서 {A}' : '발구름판 직전에 {A}!');
        else if (a.ph === 'ang') hint(g, '{A} 누르고 있다가 20~25°에서 떼기!');
        else if (c.tri && (a.ph === 'air' || a.ph === 'contact') && a.fl.k < 2) hint(g, '착지하는 순간 {A}! (' + (a.fl.k === 0 ? '스텝' : '점프') + ')');
      }
    }
  }

  /* ============================================================== HEIGHT === */
  const MAT = '#2f74d0', MAT2 = '#1f4f98', MAT3 = '#6aa6f0';
  // piecewise smooth path through keyframes [[u,x,y],...]
  function keyPath(keys, u) {
    if (u <= keys[0][0]) return [keys[0][1], keys[0][2]];
    for (let k = 1; k < keys.length; k++) {
      if (u <= keys[k][0]) {
        const A = keys[k - 1], B = keys[k];
        const t = (u - A[0]) / (B[0] - A[0]);
        const e = t * t * (3 - 2 * t);
        return [M.lerp(A[1], B[1], t), M.lerp(A[2], B[2], e)];
      }
    }
    const L = keys[keys.length - 1];
    return [L[1], L[2]];
  }
  KD.height = {
    mode: 'height',
    fmt: v => v.toFixed(2) + 'm',
    heights(nh, c) { return c.hs[nh <= 2 ? 0 : nh <= 4 ? 1 : 2].slice(); },
    cpu(s, e, R) {
      const c = OG.EVENT_MAP[s.evId].cfg;
      const cap = c.capA + c.capB * OG.cpuQuality({ skill: e.skill }, R, 0.08);
      const out = [];
      let miss = 0, gone = false;
      for (const h of s.H) {
        if (gone) { out.push(''); continue; }
        let m = '';
        while (m.length < 3) {
          if (cap + R.gauss() * c.noise >= h) { m += 'O'; miss = 0; break; }
          m += 'X'; miss++;
          if (miss >= 3) { gone = true; break; }
        }
        out.push(m);
      }
      return out;
    },
    start(s, R) {
      const c = cfgOf(s);
      return { ph: 'ready', x: -c.run, spd: 0, ml: '', st: 0, t: 0, idle: 0, cam: -c.run - 7, tx: 0, tq: 0,
        ft: 0, T: 1.15, hb: 0, apv: 0, tgt: 0, aq: -1, rel: -1, tc: 0, clr: -1, hc: 0, bar: s.H[s.hi],
        knock: false, by: 0, bvy: 0, bx: 0, lt: 0, fin: false, res: null, push: -1, pq: 0, ot: 0, hp: 0 };
    },
    upd(s, i, dt, R) {
      const a = s.a, c = cfgOf(s);
      a.t += dt;
      if ((a.ph === 'ready' || a.ph === 'run') && idleTick(a, i, dt)) return hFinish(s, false, '시간 초과');
      if (a.ph === 'ready') {
        if (mash(a, i) > 0) { a.ph = 'run'; a.spd = 0.12; }
      } else if (a.ph === 'run') {
        runSpd(a, i, dt);
        const v = a.spd * c.vmax, d = v * dt;
        const s0 = Math.floor(a.st * 2);
        a.x += d; a.st += d / (c.pv ? 2.1 : 1.9);
        if (Math.floor(a.st * 2) !== s0) OG.sfx(s, 'step');
        if (i.ap) {
          a.tx = r3(a.x);
          a.tq = r2(M.clamp(1 - Math.pow(Math.abs(a.x - c.mark) / (c.pv ? 1.3 : 0.9), 1.5), 0, 1));
          if (a.tq > 0.85) pop(s, c.pv ? 'PERFECT 플랜트!' : 'PERFECT 발구름!', PAL.yellow, 160, 60, 'l');
          else if (a.tq > 0.5) pop(s, 'GOOD', PAL.green, 160, 60, 'l');
          else pop(s, a.x < c.mark ? '너무 빨라!' : '너무 늦어!', PAL.orange, 160, 60, 'b');
          OG.sfx(s, 'jump');
          a.ft = 0;
          if (c.pv) {
            const E = (0.35 + 0.65 * Math.pow(a.spd, 1.5)) * (0.6 + 0.4 * a.tq);
            a.hp = r3(4.30 + 1.50 * E);
            a.ph = 'vault'; a.T = 1.0;
          } else {
            a.hb = r3(1.70 + 0.62 * (0.35 + 0.65 * Math.pow(a.spd, 1.5)) * (0.55 + 0.45 * a.tq));
            a.ph = 'air'; a.T = 1.15;
            a.tc = r3(a.T * (0 - a.tx) / (1.6 - a.tx));
            a.apv = a.tgt = r3(M.clamp(a.hb + 0.06, a.bar - 0.3, a.bar + 0.3));
          }
        } else if (a.x > c.balk) {
          a.ph = 'balk'; a.lt = 0; a.clr = 0; OG.sfx(s, 'fail');
          pop(s, '도약 실패!', PAL.red, 160, 60, 'b');
          if (!c.pv) { a.knock = true; a.bvy = 0.3; }
        }
      } else if (a.ph === 'air') {               // high jump flight
        a.ft += dt;
        if (a.aq < 0 && (!i.a || a.ft > a.tc + 0.3)) {
          a.rel = r3(a.ft);
          a.aq = r2(M.clamp(1 - Math.abs(a.rel - (a.tc + 0.06)) / 0.22, 0, 1));
          a.hc = r3(a.hb + 0.13 * a.aq);
          a.clr = a.hc >= a.bar ? 1 : 0;
          a.tgt = r3(a.clr ? Math.max(a.bar + 0.06, Math.min(a.hc, a.bar + 0.22)) : Math.min(a.bar - 0.05, a.hc));
          if (a.aq > 0.8) pop(s, 'PERFECT 아치!', PAL.yellow, 160, 76, 'l');
          else if (a.aq > 0.45) pop(s, 'GOOD 킥', PAL.green, 160, 76, 'b');
          else pop(s, a.rel < a.tc ? '킥이 빨라!' : '킥이 늦어!', PAL.orange, 160, 76, 'b');
          OG.sfx(s, 'whoosh');
        }
        a.apv = r3(a.apv + (a.tgt - a.apv) * Math.min(1, dt * 12));
        const hx = a.tx + (1.6 - a.tx) * (a.ft / a.T);
        if (a.clr === 0 && !a.knock && hx >= -0.1) { a.knock = true; a.bvy = 0.4; OG.sfx(s, 'hit'); }
        if (a.ft >= a.T) { a.ph = 'land'; a.lt = 0; OG.sfx(s, 'land'); if (a.clr < 0) a.clr = 0; }
      } else if (a.ph === 'vault') {             // pole vault: rise on the pole
        a.ft += dt;
        if (a.push < 0 && (i.ap && a.ft > 0.4 || a.ft > a.T + 0.3)) {
          a.push = r3(a.ft);
          const pq = i.ap ? M.clamp(1 - Math.pow(Math.abs(a.ft - a.T) / 0.28, 1.5), 0, 1) : 0;
          a.pq = r2(pq);
          a.hc = r3(a.hp + 0.5 * pq);
          a.clr = a.hc >= a.bar ? 1 : 0;
          a.apv = r3(a.clr ? Math.max(a.bar + 0.08, Math.min(a.hc, a.bar + 0.3)) : Math.min(a.bar - 0.04, a.hc));
          a.ph = 'over'; a.ot = 0;
          if (pq > 0.8) pop(s, 'PERFECT 푸시!', PAL.yellow, 160, 60, 'l');
          else if (pq > 0.4) pop(s, 'GOOD', PAL.green, 160, 60, 'l');
          else pop(s, i.ap ? (a.ft < a.T ? '푸시가 빨라!' : '푸시가 늦어!') : '푸시 실패', PAL.orange, 160, 60, 'b');
          OG.sfx(s, 'whoosh');
        }
      } else if (a.ph === 'over') {
        a.ot += dt;
        const p = pvOverPath(a, a.ot / 1.0);
        if (a.clr === 0 && !a.knock && p[0] >= c.barX - 0.3) { a.knock = true; a.bvy = 0.5; OG.sfx(s, 'hit'); }
        if (a.ot >= 1.0) { a.ph = 'land'; a.lt = 0; OG.sfx(s, 'land'); }
      } else if (a.ph === 'land' || a.ph === 'balk') {
        a.lt += dt;
        if (a.lt > (a.ph === 'balk' ? 1.4 : 1.7)) hFinish(s, a.clr === 1, a.ph === 'balk' ? '도약 실패' : '');
      }
      if (a.knock) { // bar falls onto the mat
        const top = a.bar - (c.pv ? 0.8 : 0.7) - 0.02;
        if (a.by < top) { a.bvy += 9.8 * dt; a.by = r3(Math.min(top, a.by + a.bvy * dt)); a.bx = r3(a.bx + 0.6 * dt); if (a.by >= top) OG.sfx(s, 'bounce'); }
      }
      // camera
      const cx = a.ph === 'ready' || a.ph === 'run' ? Math.min(a.x - 8, c.camJ) : c.camJ;
      a.cam = r3(a.cam + (cx - a.cam) * Math.min(1, dt * 5));
    },
    draw(g, s) { drawHeight(g, s); }
  };
  function pvOverPath(a, u) {
    const top = [-0.2, a.hp - 0.35];
    return keyPath([[0, top[0], top[1]], [0.35, 0.5, a.apv], [1, 2.2, 1.05]], M.clamp(u, 0, 1));
  }
  function pvRisePath(a, u) {
    return keyPath([[0, a.tx, 1.05], [0.35, a.tx + 1.7, 1.25], [0.72, -0.9, a.hp - 1.25], [1, -0.2, a.hp - 0.35]], M.clamp(u, 0, 1));
  }
  function hFinish(s, ok, why) {
    const a = s.a;
    a.fin = true;
    a.res = ok ? { v: 1, txt: 'O 성공!', sub: a.bar.toFixed(2) + 'm 클리어', bad: false }
      : { v: 0, txt: 'X 실패', sub: why || a.bar.toFixed(2) + 'm', bad: true };
  }
  // athlete hip position (world m), pose, facing, rot
  function heightBody(s) {
    const a = s.a, c = cfgOf(s), P = OG.Pose;
    if (a.ph === 'ready') return { x: a.x, y: 0, pose: P.stand(), f: 1, feet: true };
    if (a.ph === 'run') {
      const pose = P.run(a.st % 1, 0.4 + 0.6 * a.spd);
      if (c.pv) { pose.aL = 1.1; pose.eL = 0.6; pose.aR = 0.2; pose.eR = 1.7; }
      return { x: a.x, y: 0, pose, f: 1, feet: true };
    }
    if (a.ph === 'balk') return { x: a.x + Math.min(0.6, a.lt), y: 0, pose: a.lt < 0.3 ? P.run(0.3, 0.5) : P.sad(), f: 1, feet: true };
    if (a.ph === 'air' || (a.ph === 'land' && !c.pv)) {
      const u = a.ph === 'air' ? M.clamp(a.ft / a.T, 0, 1) : 1;
      const ua = M.clamp((0.12 - a.tx) / (1.6 - a.tx), 0.2, 0.8);
      const x = a.tx + (1.6 - a.tx) * u;
      let y;
      if (u < ua) y = 1.0 + (a.apv - 1.0) * Math.sin(u / ua * PI / 2);
      else y = a.apv - (a.apv - 0.95) * (1 - Math.cos((u - ua) / (1 - ua) * PI / 2));
      if (a.ph === 'land') {
        if (a.lt < 0.5) return { x: 1.6, y: 0.95, pose: { t: 0.6, aL: 2.4, aR: 2.2, eL: 0.3, eR: 0.3, lL: 1.5, lR: 1.4, kL: 0.3, kR: 0.4 }, f: -1, rot: -2.2 };
        return { x: 1.7, y: 0.7, pose: a.clr === 1 ? P.celebrate(a.lt * 1.5) : P.sad(), f: 1, feet: true };
      }
      if (u < 0.1) return { x, y, pose: { t: -0.1, aL: 2.6, aR: 2.2, eL: 0.4, eR: 0.4, lL: 1.4, lR: -0.1, kL: 1.6, kR: 0.1 }, f: 1, rot: 0 };
      const rot = u < ua ? -1.57 * (u - 0.1) / (ua - 0.1) : -1.57 - 0.75 * (u - ua) / (1 - ua);
      const arch = { t: -0.55, aL: 0.5, aR: 0.25, eL: 0.3, eR: 0.3, lL: -0.5, lR: -0.4, kL: 1.7, kR: 1.5 };
      const kick = { t: 0.55, aL: 0.6, aR: 0.4, eL: 0.3, eR: 0.3, lL: 1.35, lR: 1.25, kL: 0.15, kR: 0.25 };
      const k = a.aq < 0 ? 0 : M.clamp((a.ft - a.rel) / 0.15, 0, 1);
      return { x, y, pose: P.mix(arch, kick, k), f: -1, rot };
    }
    // pole vault
    if (a.ph === 'vault') {
      const u = a.ft / a.T;
      const p = pvRisePath(a, u);
      const uu = M.clamp(u, 0, 1);
      let rot, pose;
      if (uu < 0.35) { const k = uu / 0.35; rot = -0.6 * k; pose = { t: 0, aL: 2.9, aR: 2.75, eL: 0.1, eR: 0.15, lL: 0.2 + 0.8 * k, lR: -0.2 + 0.9 * k, kL: 0.4, kR: 0.6 }; }
      else if (uu < 0.72) { const k = (uu - 0.35) / 0.37; rot = -0.6 - 1.9 * k; pose = { t: 0, aL: 2.9, aR: 2.8, eL: 0.1, eR: 0.1, lL: 1.0 + 0.7 * k, lR: 0.7 + 0.9 * k, kL: 0.6 + 0.8 * k, kR: 0.6 + 0.8 * k }; }
      else { const k = (uu - 0.72) / 0.28; rot = -2.5 - 0.6 * k; pose = { t: 0, aL: 2.95, aR: 2.9, eL: 0.05, eR: 0.05, lL: 1.7 - 1.5 * k, lR: 1.6 - 1.45 * k, kL: 1.4 * (1 - k), kR: 1.4 * (1 - k) + 0.05 }; }
      return { x: p[0], y: p[1], pose, f: 1, rot };
    }
    if (a.ph === 'over' || (a.ph === 'land' && c.pv)) {
      if (a.ph === 'land') {
        if (a.lt < 0.6) return { x: 2.3, y: 1.0, pose: { t: 0.5, aL: 2.4, aR: 2.2, eL: 0.3, eR: 0.3, lL: 1.4, lR: 1.3, kL: 0.4, kR: 0.5 }, f: 1, rot: -1.45 };
        return { x: 2.4, y: 0.8, pose: a.clr === 1 ? P.celebrate(a.lt * 1.5) : P.sad(), f: 1, feet: true };
      }
      const u = M.clamp(a.ot / 1.0, 0, 1);
      const p = pvOverPath(a, u);
      const rot = -3.1 + 1.7 * M.ease(u);
      const pose = P.mix({ t: 0.2, aL: 3.0, aR: 2.9, eL: 0, eR: 0, lL: 0.4, lR: 0.3, kL: 0.1, kR: 0.1 }, { t: 0.6, aL: 2.2, aR: 2.0, eL: 0.3, eR: 0.3, lL: 1.3, lR: 1.2, kL: 0.4, kR: 0.5 }, u);
      return { x: p[0], y: p[1], pose, f: 1, rot };
    }
    return { x: a.x, y: 0, pose: P.stand(), f: 1, feet: true };
  }
  function drawMat(g, X, Y, x0, x1, mh, dz, GY, dx) {
    const fy = Y(mh) + dz, by = Y(mh) - dz;
    g.poly([X(x1) - dx, fy, X(x1) + dx, by, X(x1) + dx, GY - dz, X(x1) - dx, GY + dz], MAT2);           // right face
    g.rect(X(x0) - dx, fy, X(x1) - X(x0), GY + dz - fy, MAT);                                            // front face
    g.rect(X(x0) - dx, fy, X(x1) - X(x0), 2, MAT3);
    g.poly([X(x0) - dx, fy, X(x1) - dx, fy, X(x1) + dx, by, X(x0) + dx, by], MAT3);                      // top
    g.poly([X(x0) - dx + 3, fy - 2, X(x1) - dx - 3, fy - 2, X(x1) + dx - 5, by + 3, X(x0) + dx + 1, by + 3], '#7fb4f5');
    g.text('DOT 2026', (X(x0) + X(x1)) / 2 - dx, fy + Math.max(2, (GY + dz - fy) / 2 - 5), '#ffffff', { size: 'xs', align: 'center' });
    g.rect(X(x0) - dx, GY + dz - 1, X(x1) - X(x0), 1, MAT2);
  }
  function standard(g, x, ybase, ytop) {
    g.rect(x - 2, ybase - 1, 5, 2, PAL.darkgrey);
    g.rect(x - 1, ytop - 6, 2, ybase - ytop + 6, '#d8dee8');
    g.rect(x, ytop - 6, 1, ybase - ytop + 6, PAL.grey);
    for (let y = ybase - 6; y > ytop; y -= 6) g.px(x - 1, y, PAL.slate);
    g.rect(x - 2, ytop, 5, 2, PAL.red);
    g.rect(x - 3, ybase - 1, 7, 2, PAL.slate);
  }
  function drawBar(g, x0, y0, x1, y1) {
    const n = 8;
    for (let k = 0; k < n; k++) {
      const ax = M.lerp(x0, x1, k / n), ay = M.lerp(y0, y1, k / n), bx = M.lerp(x0, x1, (k + 1) / n), by = M.lerp(y0, y1, (k + 1) / n);
      g.line(ax, ay, bx, by, k % 2 ? PAL.white : PAL.yellow, 2);
    }
  }
  function drawHeight(g, s) {
    const a = s.a, c = cfgOf(s), pv = !!c.pv;
    const PPM = pv ? 20 : 24, GY = pv ? 228 : 212;
    const cam = a ? a.cam : -c.run - 7;
    const X = wx => Math.round((wx - cam) * PPM);
    const Y = h => GY - Math.round(h * PPM);
    const excite = a && (a.ph === 'air' || a.ph === 'vault' || a.ph === 'over') ? 0.4 : (a && a.ph === 'land' && a.clr === 1 ? 0.8 : 0.08);
    sideStadium(g, cam * PPM, { excite, groundTop: GY - 16, screen: screenInfo(s) });
    // ground: apron / runway
    if (pv) {
      g.rect(0, GY - 16, 480, 30, '#4fa04a');
      g.rect(0, GY - 11, 480, 21, PAL.track);
      g.rect(0, GY - 11, 480, 1, PAL.trackline); g.rect(0, GY + 9, 480, 1, PAL.trackline);
      // box
      g.poly([X(-0.9), GY - 2, X(0), GY - 2, X(0), GY + 3, X(-0.6), GY + 1], '#7a7f8a');
      g.rect(X(0) - 1, GY - 3, 2, 6, '#3a4466');
      // plant mark
      g.rect(X(c.mark) - 1, GY + 10, 3, 3, PAL.white); g.rect(X(c.mark), GY + 13, 1, 3, PAL.white);
    } else {
      g.rect(0, GY - 16, 480, 34, PAL.track);
      for (let m = Math.floor(cam); m < cam + 21; m++) g.px(X(m), GY + 4, 'rgba(0,0,0,0.15)');
      g.rect(0, GY - 16, 480, 1, '#a94a33');
      const mx = X(c.mark);
      g.line(mx - 3, GY + 1, mx + 3, GY + 5, PAL.white); g.line(mx + 3, GY + 1, mx - 3, GY + 5, PAL.white);
    }
    g.rect(0, GY + (pv ? 14 : 18), 480, 270 - GY, '#4b9a46');
    for (let x = -M.wrap(Math.floor(cam * PPM), 60); x < 480; x += 60) g.rect(x, GY + (pv ? 14 : 18), 30, 60, '#53a44d');
    const barX = pv ? c.barX : 0, bar = a ? a.bar : s.H[s.hi];
    const mx0 = pv ? 0.5 : 0.25, mx1 = pv ? 5.6 : 4.2, mh = pv ? 0.8 : 0.7, dz = 8, dzx = 20;
    // back standard
    const sxB = X(barX) + dzx, sxF = X(barX) - dzx;
    standard(g, sxB, GY - dz, Y(bar) - dz + 1);
    drawMat(g, X, Y, mx0, mx1, mh, dz, GY, dzx);
    if (pv) { // front pads around the box
      g.poly([X(-0.3) - dzx, Y(0.6) + dz, X(0.5) - dzx, Y(0.6) + dz, X(0.5) - dzx, GY + dz, X(-0.3) - dzx, GY + dz], MAT2);
    }
    // bar (possibly falling)
    const by = a ? a.by : 0, bxo = a ? Math.round(a.bx * PPM) : 0;
    drawBar(g, sxF + bxo, Y(bar - by) + dz, sxB + bxo, Y(bar - by) - dz);
    // athlete
    if (a) {
      const B = heightBody(s);
      const e = s.E[s.cur], look = lookE(e);
      const zoff = !pv && (a.ph === 'ready' || a.ph === 'run') && a.x < -5 ? Math.round(Math.pow((-5 - a.x) / 11, 1.5) * 22) : 0;
      const sx = X(B.x), sy = Y(B.y) + zoff;
      const onGround = a.ph === 'ready' || a.ph === 'run' || a.ph === 'balk';
      if (onGround) g.shadow(sx, GY + 1 + zoff, 8);
      else g.shadow(sx, B.x > mx0 && B.x < mx1 ? Y(mh) + 1 : GY + 1, 6);
      let J;
      if (B.feet) J = g.figure(sx, sy, B.pose, look, { facing: B.f, scale: 2 });
      else J = g.figure(sx, sy, B.pose, look, { facing: B.f, scale: 2, anchor: 'hip', rot: B.rot });
      if (!B.rot) g.rect(Math.round((J.hip[0] + J.neck[0]) / 2) - 1, Math.round((J.hip[1] + J.neck[1]) / 2) - 2, 3, 3, '#f4f0e6');
      if (pv) drawPole(g, s, J, X, Y, GY);
      if (onGround) nameTag(g, s, sx, J.head[1] - 16);
    }
    // front standard
    standard(g, sxF, GY + dz, Y(bar) + dz + 1);
    g.text(bar.toFixed(2) + 'm', sxF - 6, Y(bar) + dz - 4, PAL.white, { size: 'xs', align: 'right', outline: PAL.black });
    drawParts(g, s, (x, y) => [X(x), Y(y)]);
    if (a && (s.ph === 'play' || s.ph === 'ban')) {
      g.rect(0, 250, 480, 20, 'rgba(24,20,37,0.6)');
      speedBar(g, 8, 257, 110, a.spd);
      const P = s.P[s.cur], m = (P && P.mk[s.hi]) || '';
      g.text('바 ' + bar.toFixed(2) + 'm  ' + m.split('').join(' '), 472, 256, PAL.white, { size: 's', align: 'right' });
      if (s.ph === 'play') {
        if (a.ph === 'ready') hint(g, '{L}{R} 번갈아 연타로 도움닫기!', 236);
        else if (a.ph === 'run') hint(g, pv ? '{L}{R} 연타!  마크에서 {A} 장대 꽂기' : '{L}{R} 연타!  X 마크에서 {A} 발구름', 236);
        else if (a.ph === 'air' && a.aq < 0) hint(g, '{A} 누르고 버티기 → 엉덩이가 바를 넘으면 떼기!', 236);
        else if (a.ph === 'vault' && a.push < 0) hint(g, '장대가 수직이 될 때 {A} 푸시!', 236);
      }
    }
  }
  function drawPole(g, s, J, X, Y, GY) {
    const a = s.a, c = cfgOf(s);
    const L = 5.0 * 20;
    if (a.ph === 'ready' || a.ph === 'run' || a.ph === 'balk') {
      const k = M.clamp((a.x + 30) / 24, 0, 1);
      const ang = (55 - 43 * k) * DEG;
      const hx = J.hdR[0], hy = J.hdR[1];
      const ex = hx + Math.cos(ang) * L * 0.92, ey = hy - Math.sin(ang) * L * 0.92;
      const bx = hx - Math.cos(ang) * L * 0.08, by = hy + Math.sin(ang) * L * 0.08;
      g.line(bx, by, ex, ey, '#d9d2c0', 2); g.line(bx, by, ex, ey, '#f2ead6', 1);
      g.rect(ex - 1, ey - 1, 3, 3, PAL.darkgrey);
      return;
    }
    const tip = [X(0), GY - 1];
    if (a.ph === 'vault') {
      const u = M.clamp(a.ft / a.T, 0, 1);
      const top = J.hdR;
      const dx = top[0] - tip[0], dy = top[1] - tip[1], len = Math.hypot(dx, dy) || 1;
      const bend = Math.sin(PI * Math.min(1, u * 1.15)) * 0.42 * L * 0.5;
      const cx = (tip[0] + top[0]) / 2 + (-dy / len) * -bend, cy = (tip[1] + top[1]) / 2 + (dx / len) * -bend;
      let px = tip[0], py = tip[1];
      for (let k = 1; k <= 14; k++) {
        const t = k / 14, it = 1 - t;
        const qx = it * it * tip[0] + 2 * it * t * cx + t * t * top[0], qy = it * it * tip[1] + 2 * it * t * cy + t * t * top[1];
        g.line(px, py, qx, qy, '#d9d2c0', 2);
        px = qx; py = qy;
      }
      return;
    }
    // released pole falling back toward the runway
    const tt = a.ph === 'over' ? a.ot : 1.0 + (a.lt || 0);
    const ang = (88 - Math.min(70, tt * tt * 70)) * DEG;
    g.line(tip[0], tip[1], tip[0] - Math.cos(ang) * L, tip[1] - Math.sin(ang) * L, '#d9d2c0', 2);
  }

  /* ===================================================== JAVELIN / SHOT === */
  const DIRT = '#8a6a43', DIRT2 = '#6b4f30';
  // ballistic flight that lands exactly at x0 + D (y up, release height y0)
  function makeFlight(x0, y0, v0, angDeg, D) {
    const a = Math.max(3, angDeg) * DEG;
    const vx = v0 * Math.cos(a), vy = v0 * Math.sin(a);
    const T = Math.max(0.4, D / vx);
    const gr = 2 * (y0 + vy * T) / (T * T);
    return { x0: r3(x0), y0: r3(y0), vx: r3(vx), vy: r3(vy), g: r3(gr), T: r3(T), t: 0 };
  }
  const flPos = (f, t) => [f.x0 + f.vx * t, f.y0 + f.vy * t - 0.5 * f.g * t * t];
  function throwCpu(s, e, R) {
    const c = OG.EVENT_MAP[s.evId].cfg, out = [];
    for (let r = 0; r < s.rounds; r++) {
      const q = OG.cpuQuality({ skill: e.skill }, R, 0.1);
      if (R.chance(0.06 + (1 - q) * 0.18)) out.push(-1);
      else out.push(r2(c.cpuA + c.cpuB * q + R.gauss() * c.cpuB * 0.03));
    }
    return out;
  }
  function throwFinish(s, bad, why) {
    const a = s.a;
    a.fin = true;
    if (bad) a.res = { v: -1, txt: '파울', sub: why || '', bad: true };
    else a.res = { v: a.dist, txt: a.dist.toFixed(2) + 'm', sub: '각도 ' + Math.round(a.ang) + '°', bad: false };
  }
  function throwLand(s, x, n, c1, c2) {
    for (let k = 0; k < n; k++) {
      const h1 = OG.hash(k, x * 10 | 0, 11), h2 = OG.hash(k, 5, x * 7 | 0);
      part(s, x + (h1 - 0.5) * 0.6, 0.05, (h1 - 0.4) * 3, 1 + h2 * 2.4, h2 > 0.5 ? c1 : c2, 0.8 + h2 * 0.4, 9.8, h2 > 0.75 ? 2 : 1);
    }
  }
  KD.jav = {
    fmt: v => v.toFixed(2) + 'm',
    cpu: throwCpu,
    start(s, R) {
      const c = cfgOf(s);
      return { ph: 'ready', x: -c.run, spd: 0, ml: '', st: 0, t: 0, idle: 0, cam: -c.run - 6, ang: 0, ht: 0, sp0: 0,
        fl: null, jx: 0, jy: 0, ja: 0, lt: 0, foul: false, dist: -1, mark: null, fin: false, res: null };
    },
    upd(s, i, dt, R) {
      const a = s.a, c = cfgOf(s);
      a.t += dt;
      if ((a.ph === 'ready' || a.ph === 'run') && idleTick(a, i, dt)) return throwFinish(s, true, '시간 초과');
      if (a.ph === 'ready') {
        if (mash(a, i) > 0) { a.ph = 'run'; a.spd = 0.12; }
      } else if (a.ph === 'run') {
        runSpd(a, i, dt);
        const v = a.spd * c.vmax, d = v * dt, s0 = Math.floor(a.st * 2);
        a.x += d; a.st += d / 2.0;
        if (Math.floor(a.st * 2) !== s0) OG.sfx(s, 'step');
        if (i.ap) { a.ph = 'draw'; a.ht = 0; a.ang = 5; a.sp0 = a.spd; OG.sfx(s, 'charge'); }
        else if (a.x > -0.3) { a.foul = true; a.ph = 'stumble'; a.lt = 0; OG.sfx(s, 'fail'); pop(s, '라인 침범!', PAL.red, 160, 60, 'b'); }
      } else if (a.ph === 'draw') {
        a.ht += dt;
        const v = a.sp0 * c.vmax * (1 - 0.6 * Math.min(1, a.ht / 0.7));
        a.x += v * dt; a.st += v * dt / 1.6;
        if (i.a && a.ang < 70) a.ang = Math.min(70, a.ang + 44 * dt);
        if (a.x > -0.2) { a.foul = true; a.ph = 'stumble'; a.lt = 0; OG.sfx(s, 'fail'); pop(s, '라인 침범!', PAL.red, 160, 60, 'b'); }
        else if (!i.a || a.ang >= 70 || a.ht > 2.2) {
          const aq = M.clamp(1 - Math.pow((a.ang - c.ideal) / 28, 2), 0.3, 1);
          const D = c.dmax * sf(a.sp0) * aq;
          a.fl = makeFlight(a.x + 0.3, 2.0, 28, a.ang, D);
          a.foul = a.x + 1.15 > 0;
          a.ph = 'fly'; a.lt = 0; OG.sfx(s, 'throw');
          if (Math.abs(a.ang - c.ideal) <= 3) pop(s, 'PERFECT!', PAL.yellow, 160, 56, 'l');
          else if (Math.abs(a.ang - c.ideal) <= 8) pop(s, 'GOOD', PAL.green, 160, 56, 'l');
        }
      } else if (a.ph === 'fly') {
        const f = a.fl;
        a.lt += dt;
        if (a.lt < 0.5) a.x += Math.max(0, 2.4 - a.lt * 5) * dt;
        f.t = r3(Math.min(f.T, f.t + dt));
        const p = flPos(f, f.t);
        a.jx = r3(p[0]); a.jy = r3(Math.max(0, p[1]));
        a.ja = r3(Math.atan2(f.vy - f.g * f.t, f.vx));
        if (f.t >= f.T) {
          a.ph = 'land'; a.lt = 0; a.mark = a.jx; a.ja = r3(Math.min(-0.45, a.ja));
          a.dist = Math.floor(a.jx * 100) / 100;
          OG.sfx(s, 'land'); throwLand(s, a.jx, 12, DIRT, PAL.grass2);
        }
      } else if (a.ph === 'stumble') {
        a.lt += dt;
        a.x += Math.max(0, a.spd * c.vmax * (1 - a.lt * 1.6)) * dt;
        if (a.lt > 1.5) throwFinish(s, true, '라인 침범');
      } else if (a.ph === 'land') {
        a.lt += dt;
        if (a.lt > 1.9) throwFinish(s, a.foul, a.foul ? '라인 침범' : '');
      }
      const tx = a.ph === 'fly' || a.ph === 'land' ? a.jx - 10 : a.x - 6.5;
      a.cam = r3(a.cam + (tx - a.cam) * Math.min(1, dt * (a.ph === 'fly' ? 7 : 5)));
      camVert(s, dt);
    },
    draw(g, s) { drawThrowField(g, s); }
  };
  KD.shot = {
    fmt: v => v.toFixed(2) + 'm',
    cpu: throwCpu,
    start(s, R) {
      return { ph: 'ready', x: -0.8, pw: 0, ml: '', t: 0, idle: 0, cam: -6.2, ang: 0, ht: 0, gl: 0, pw0: 0, rk: 0,
        fl: null, jx: 0, jy: 0, lt: 0, foul: false, dist: -1, mark: null, fin: false, res: null };
    },
    upd(s, i, dt, R) {
      const a = s.a, c = cfgOf(s);
      a.t += dt;
      if ((a.ph === 'ready' || a.ph === 'power') && idleTick(a, i, dt)) return throwFinish(s, true, '시간 초과');
      if (a.ph === 'ready' || a.ph === 'power') {
        const n = mash(a, i);
        if (n > 0) { a.ph = 'power'; a.rk = r2(Math.min(1, a.rk + 0.5)); }
        a.pw = r3(M.clamp(a.pw + n * 0.088 - a.pw * 0.8 * dt, 0, 1));
        a.rk = r3(Math.max(0, a.rk - dt * 3));
        if (a.ph === 'power' && i.ap) { a.ph = 'glide'; a.gl = 0; a.pw0 = a.pw; OG.sfx(s, 'whoosh'); }
      } else if (a.ph === 'glide') {
        a.gl = r3(Math.min(1, a.gl + dt / 0.3));
        a.x = r3(M.lerp(-0.8, 0.35, M.easeOut(a.gl)));
        if (i.a && a.ang < 75) a.ang = Math.min(75, a.ang + 50 * dt);
        if (a.gl >= 1) { a.ph = 'ang'; a.ht = 0; }
      } else if (a.ph === 'ang') {
        a.ht += dt;
        if (i.a && a.ang < 75) a.ang = Math.min(75, a.ang + 50 * dt);
        if (a.ht > 1.6) { a.foul = true; a.ph = 'stumble'; a.lt = 0; OG.sfx(s, 'fail'); pop(s, '서클 이탈!', PAL.red, 160, 60, 'b'); }
        else if (!i.a || a.ang >= 75) {
          const aq = M.clamp(1 - Math.pow((a.ang - c.ideal) / 30, 2), 0.3, 1);
          const D = c.dmax * sf(a.pw0) * aq;
          a.fl = makeFlight(a.x + 0.4, 2.15, 13.5, a.ang, D - 0.4 - a.x + 1.07);
          a.ph = 'fly'; a.lt = 0; OG.sfx(s, 'throw');
          if (Math.abs(a.ang - c.ideal) <= 3) pop(s, 'PERFECT!', PAL.yellow, 160, 56, 'l');
          else if (Math.abs(a.ang - c.ideal) <= 8) pop(s, 'GOOD', PAL.green, 160, 56, 'l');
        }
      } else if (a.ph === 'fly') {
        const f = a.fl;
        a.lt += dt;
        f.t = r3(Math.min(f.T, f.t + dt));
        const p = flPos(f, f.t);
        a.jx = r3(p[0]); a.jy = r3(Math.max(0, p[1]));
        if (f.t >= f.T) {
          a.ph = 'land'; a.lt = 0; a.mark = a.jx;
          a.dist = Math.floor((a.jx - 1.07) * 100) / 100;
          OG.sfx(s, 'land'); throwLand(s, a.jx, 14, DIRT, PAL.grass2);
        }
      } else if (a.ph === 'stumble') {
        a.lt += dt; a.x = r3(Math.min(1.5, a.x + dt * 0.8));
        if (a.lt > 1.4) throwFinish(s, true, '서클 이탈');
      } else if (a.ph === 'land') {
        a.lt += dt;
        if (a.lt > 1.9) throwFinish(s, false);
      }
      const tx = a.ph === 'fly' || a.ph === 'land' ? Math.max(-6.2, a.jx - 9) : -6.2;
      a.cam = r3(a.cam + (tx - a.cam) * Math.min(1, dt * 6));
      camVert(s, dt);
    },
    draw(g, s) { drawThrowField(g, s); }
  };
  // javelin through grip point (x,y); grip = fraction from the tail
  const throwPPM = s => s.kind === 'jav' ? 24 : 26;
  const throwHpx = (s, h) => { const P = throwPPM(s); return h < 2 ? h * P : 2 * P + (h - 2) * P * (s.kind === 'jav' ? 0.36 : 0.55); };
  function camVert(s, dt) {
    const a = s.a;
    const tgt = a.ph === 'fly' ? Math.max(0, throwHpx(s, a.jy) - 120) : 0;
    a.cy = r2((a.cy || 0) + (tgt - (a.cy || 0)) * Math.min(1, dt * 4));
  }
  function drawJavelin(g, x, y, ang, len, grip) {
    grip = grip == null ? 0.45 : grip;
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    const x0 = x - dx * len * grip, y0 = y - dy * len * grip, x1 = x + dx * len * (1 - grip), y1 = y + dy * len * (1 - grip);
    g.line(x0, y0, x1, y1, 'rgba(24,20,37,0.7)', 3);
    g.line(x0, y0, x1, y1, '#f2eee2', 1);
    g.line(x1 - dx * 5, y1 - dy * 5, x1, y1, PAL.lightgrey, 1);
    g.line(x - dx * 2, y - dy * 2, x + dx * 3, y + dy * 3, PAL.red, 1);
  }
  function drawThrowField(g, s) {
    const a = s.a, c = cfgOf(s), jav = s.kind === 'jav';
    const PPM = jav ? 24 : 26, GY = 212;
    const cam = a ? a.cam : (jav ? -c.run - 6 : -6.2);
    const X = wx => Math.round((wx - cam) * PPM);
    // vertical scale compressed above 2 m so high flights stay on screen
    const Y = h => GY - Math.round(throwHpx(s, h));
    const excite = a && (a.ph === 'fly' || a.ph === 'land') ? 0.5 : 0.08;
    const cy = a ? Math.round(a.cy || 0) : 0;
    if (cy > 0) { g.grad(0, 0, 480, cy + 10, '#2f7fd6', '#3f8fe0', 4); g.clouds(g.t * 0.5, 4, 2, 'rgba(255,255,255,0.6)', 3); }
    g.save(); g.translate(0, cy);
    sideStadium(g, cam * PPM, { excite, groundTop: 198, screen: screenInfo(s) });
    const lineX = jav ? 0 : 1.07;
    // ground band: runway (javelin) / circle (shot) then the grass sector
    g.rect(0, 198, 480, 26, '#4fa04a');
    const sx0 = X(lineX);
    if (jav) {
      const re = Math.min(480, sx0);
      if (re > 0) {
        g.rect(0, 201, re, 21, PAL.track);
        g.rect(0, 201, re, 1, PAL.trackline); g.rect(0, 221, re, 1, PAL.trackline);
        for (let m = Math.ceil(cam); m < Math.min(0, cam + 21); m++) if (m % 5 === 0) g.rect(X(m), 222, 1, 2, PAL.trackline);
      }
    }
    // sector grass with mowing stripes every 5 m
    const gs = Math.max(0, sx0);
    if (gs < 480) {
      g.rect(gs, 199, 480 - gs, 25, '#58ac52');
      for (let m = Math.floor(Math.max(lineX, cam) / 5) * 5; m < cam + 22; m += 5) {
        if (m < lineX || Math.floor(m / 5) % 2) continue;
        const x0 = Math.max(gs, X(m)), x1 = X(m + 5);
        if (x1 > x0) g.rect(x0, 199, x1 - x0, 25, '#4fa04a');
      }
      // distance lines + numbers
      const step = jav ? 10 : 1;
      for (let d = Math.ceil(Math.max(cam - lineX, 0) / step) * step; d < cam + 22 - lineX; d += step) {
        if (d <= 0) continue;
        const x = X(lineX + d);
        g.rect(x, 200, 1, 23, 'rgba(255,255,255,0.75)');
        if (jav || d % 2 === 0) distPost(g, x, 236, String(d), jav ? (d % 20 ? PAL.navy : PAL.darkblue) : (d % 4 ? PAL.navy : PAL.darkblue));
      }
    }
    if (jav) {
      // foul arc
      g.rect(sx0 - 1, 200, 4, 23, PAL.white);
      g.rect(sx0 + 3, 200, 1, 23, 'rgba(0,0,0,0.2)');
    } else {
      // throwing circle (concrete) + stop board
      g.rect(X(-1.07), 203, X(1.07) - X(-1.07), 17, '#8e96a8');
      g.rect(X(-1.07), 203, X(1.07) - X(-1.07), 1, '#b8c0d0');
      g.rect(X(-1.07) - 2, 202, 2, 19, PAL.white); g.rect(X(1.07), 202, 2, 19, PAL.white);
      g.rect(X(1.07), 199, 5, 23, '#f4f0e6'); g.rect(X(1.07), 199, 5, 2, '#c0cbdc');
    }
    // near grass
    g.rect(0, 224, 480, 46, '#4b9a46');
    for (let x = -M.wrap(Math.floor(cam * PPM), 60); x < 480; x += 60) g.rect(x, 224, 30, 46, '#53a44d');
    g.rect(0, 224, 480, 1, '#3e8948');
    leaderLine(g, s, wx => X(wx + lineX), 199, 223);
    if (a) {
      const flag = (a.ph === 'land' && a.lt > 0.4) || (a.ph === 'stumble' && a.lt > 0.4) || a.fin ? (a.foul ? 'red' : 'white') : null;
      official(g, X(lineX + (jav ? 1.5 : 2.0)), 197, flag, g.t);
    }
    if (!a) { g.restore(); return; }
    // landing mark
    if (a.mark != null) {
      const mx = X(a.mark);
      g.rect(mx - 2, 211, 5, 2, DIRT2);
      if (a.lt > 0.4 && !a.foul) {
        g.rect(mx, 190, 1, 21, PAL.yellow);
        g.text(a.dist.toFixed(2) + 'm', mx, 178, PAL.yellow, { size: 'b', align: 'center', outline: PAL.black });
      }
    }
    // athlete
    const e = s.E[s.cur], look = lookE(e), P = OG.Pose;
    let pose, f = 1;
    const ax = X(a.x);
    if (jav) {
      if (a.ph === 'ready') pose = P.stand();
      else if (a.ph === 'run') pose = P.run(a.st % 1, 0.4 + 0.6 * a.spd);
      else if (a.ph === 'draw') { pose = P.mix(P.run(a.st % 1, 0.6), P.throw(0), 0.75); pose.aR = -2.0; pose.eR = 0.1; }
      else if (a.ph === 'fly' || a.ph === 'land') pose = a.lt < 0.15 ? P.throw(a.lt / 0.15) : (a.lt < 0.9 ? P.throw(1) : (a.foul ? P.sad() : P.celebrate(a.lt)));
      else pose = a.lt < 0.5 ? P.run(a.st % 1, 0.6) : P.sad();
      if (a.ph === 'run' || a.ph === 'ready') { pose.aR = 2.3; pose.eR = 1.9; }
    } else {
      f = a.ph === 'ready' || a.ph === 'power' || (a.ph === 'glide' && a.gl < 0.6) ? -1 : 1;
      if (a.ph === 'ready') pose = { t: 0.15, aL: 1.6, aR: 2.6, eL: 0.4, eR: 2.6, lL: 0.25, lR: -0.2, kL: 0.2, kR: 0.1 };
      else if (a.ph === 'power') { const k = 0.6 + 0.4 * Math.sin(a.t * 14) * a.rk; pose = { t: 0.9 + 0.3 * k, aL: 1.2, aR: 2.6, eL: 0.3, eR: 2.6, lL: 1.0 + 0.4 * k, lR: 0.2, kL: 1.4 + 0.6 * k, kR: 0.5 }; }
      else if (a.ph === 'glide') pose = { t: 0.8 * (1 - a.gl), aL: 1.4, aR: 2.6, eL: 0.3, eR: 2.6, lL: 0.9, lR: -0.4, kL: 1.2, kR: 0.4 };
      else if (a.ph === 'ang') pose = { t: -0.15, aL: 1.6, aR: 2.4, eL: 0.4, eR: 2.5, lL: 0.5, lR: -0.45, kL: 0.8, kR: 0.2 };
      else if (a.ph === 'fly' || a.ph === 'land') pose = a.lt < 0.12 ? P.mix({ t: -0.15, aL: 1.6, aR: 2.4, eL: 0.4, eR: 2.5, lL: 0.5, lR: -0.45, kL: 0.8, kR: 0.2 }, { t: 0.3, aL: -0.4, aR: 2.3, eL: 0.2, eR: 0, lL: 0.3, lR: -0.6, kL: 0.2, kR: 0.4 }, a.lt / 0.12) : (a.lt < 1.0 ? { t: 0.3, aL: -0.4, aR: 2.3, eL: 0.2, eR: 0, lL: 0.3, lR: -0.6, kL: 0.2, kR: 0.4 } : P.celebrate(a.lt));
      else pose = P.sad();
    }
    g.shadow(ax, GY + 1, 8);
    const J = g.figure(ax, GY, pose, look, { facing: f, scale: 2 });
    g.rect(Math.round((J.hip[0] + J.neck[0]) / 2) - 1, Math.round((J.hip[1] + J.neck[1]) / 2) - 2, 3, 3, '#f4f0e6');
    nameTag(g, s, ax, J.head[1] - 16);
    // implement (+ dotted trail while flying)
    if ((a.ph === 'fly' || a.ph === 'land') && a.fl) {
      const f = a.fl, tEnd = a.ph === 'fly' ? f.t : f.T;
      let lp = null;
      for (let t = Math.max(0, tEnd - 0.6); t <= tEnd; t += 0.04) {
        const p = flPos(f, t), q = [X(p[0]), Y(Math.max(0, p[1]))];
        if (lp) { g.alpha(0.15 + 0.6 * (1 - (tEnd - t) / 0.6)); g.line(lp[0], lp[1], q[0], q[1], PAL.white, 1); g.alpha(1); }
        lp = q;
      }
    }
    if (jav) {
      if (a.ph === 'ready' || a.ph === 'run' || a.ph === 'stumble') drawJavelin(g, J.hdR[0], J.hdR[1], 0.2, 44, 0.4);
      else if (a.ph === 'draw') drawJavelin(g, J.hdR[0], J.hdR[1], a.ang * DEG, 44, 0.22);
      else if (a.ph === 'fly' || a.ph === 'land') {
        const f = a.fl, jx = X(a.jx), jy = Y(a.jy);
        if (a.ph === 'fly') {
          const p2 = flPos(f, Math.min(f.T, f.t + 0.06)), p1 = flPos(f, Math.max(0, f.t - 0.06));
          const va = Math.atan2(Y(Math.max(0, p1[1])) - Y(Math.max(0, p2[1])), X(p2[0]) - X(p1[0]));
          g.ellipse(jx, GY + 1, 8, 1, 'rgba(0,0,0,0.25)');
          drawJavelin(g, jx, jy, va, 44, 0.45);
        } else drawJavelin(g, jx, jy, Math.max(0.5, -a.ja), 44, 0.88);
      }
    } else {
      const shotC = '#4a4f5c';
      let sxp, syp;
      if (a.ph === 'fly' || a.ph === 'land') { sxp = X(a.jx); syp = Y(a.jy) - 2; g.ellipse(sxp, GY + 1, 3, 1, 'rgba(0,0,0,0.3)'); }
      else { sxp = Math.round(J.hdR[0]); syp = Math.round(J.hdR[1]) - 1; }
      if (a.ph !== 'stumble' || a.lt < 0.2) {
        g.circle(sxp, syp, 4, PAL.black); g.circle(sxp, syp, 3, shotC); g.px(sxp - 1, syp - 1, '#c0cbdc'); g.px(sxp, syp - 2, '#9aa3b5');
      }
    }
    drawParts(g, s, (x, y) => [X(x), Y(y)]);
    if (a.ph === 'draw' || a.ph === 'ang' || a.ph === 'glide') angleGauge(g, ax + 10, GY - 22, 42, a.ang, c.ideal - 3, c.ideal + 3, jav ? 70 : 75);
    g.restore();
    if (s.ph === 'play' || s.ph === 'ban') {
      g.rect(0, 248, 480, 22, 'rgba(24,20,37,0.6)');
      if (jav) speedBar(g, 8, 256, 110, a.ph === 'draw' ? a.sp0 : a.spd);
      else speedBar(g, 8, 256, 110, a.ph === 'ready' || a.ph === 'power' ? a.pw : a.pw0, '파워');
      if (s.ph === 'play') {
        if (jav) {
          if (a.ph === 'ready') hint(g, '{L}{R} 번갈아 연타로 도움닫기!');
          else if (a.ph === 'run') hint(g, '{L}{R} 연타!  라인 전에 {A} 누르기 시작');
          else if (a.ph === 'draw') hint(g, '{A} 누른 채 각도 올리기 → ' + c.ideal + '°에서 떼기!');
        } else {
          if (a.ph === 'ready' || a.ph === 'power') hint(g, '{L}{R} 연타로 파워 → {A} 글라이드');
          else hint(g, '{A} 누른 채 각도 올리기 → ' + c.ideal + '°에서 떼기!');
        }
      }
    }
  }

  /* ====================================================== DISCUS / HAMMER === */
  const SECT = 17.46 * DEG;           // half sector angle
  const ZONE = 29 * DEG;              // release window half-width (maps into the sector)
  KD.spin = {
    fmt: v => v.toFixed(2) + 'm',
    cpu: throwCpu,
    start(s, R) {
      return { ph: 'ready', psi: PI / 2, w: 0, rot: 0, ax: 0, ay: 0.75, ml: '', t: 0, idle: 0, wait: 0,
        cx: 0, cy: -0.3, z: 34, bt: [], bk: -1, fl: null, ix: 0, iy: 0, ih: 0, lt: 0, foul: false, cage: false, dist: -1,
        mark: null, fin: false, res: null };
    },
    upd(s, i, dt, R) {
      const a = s.a, c = cfgOf(s), ham = !!c.ham;
      a.t += dt;
      if ((a.ph === 'ready' || a.ph === 'spin') && idleTick(a, i, dt)) return throwFinish(s, true, '시간 초과');
      if (a.ph === 'ready') {
        a.wait += dt;
        if (ham) {
          if (cnt(i, 'l') + cnt(i, 'r') + cnt(i, 'a') > 0 || a.wait > 2.5) { a.ph = 'spin'; a.w = 0.7; OG.sfx(s, 'swing'); }
        } else if (mash(a, i) > 0) { a.ph = 'spin'; a.w = 0.25; }
      } else if (a.ph === 'spin') {
        if (ham) hammerBeats(s, i, dt);
        else {
          const n = mash(a, i);
          a.w = r3(M.clamp(a.w + n * 0.143 - a.w * 1.1 * dt, 0, 1.45));
        }
        const dpsi = a.w * TAU * dt;
        const prevRev = Math.floor(a.rot / TAU);
        a.psi = r3(M.wrap(a.psi - dpsi + PI, TAU) - PI);
        a.rot = r3(a.rot + dpsi);
        if (Math.floor(a.rot / TAU) !== prevRev) OG.sfx(s, 'swing');
        a.ay = r3(0.75 - 1.25 * Math.min(1, a.rot / (3 * PI)) * (ham ? 0.5 : 1));
        const armed = !ham || a.bt.length >= 6;
        if (i.ap && armed && a.rot > PI) release(s, R);
        else if (a.rot > (ham ? PI / 2 + 10 * PI : 9 * PI)) {
          a.foul = true; a.ph = 'stumble'; a.lt = 0; OG.sfx(s, 'fail'); pop(s, '균형 상실!', PAL.red, 240, 60, 'b');
        }
      } else if (a.ph === 'fly') {
        const f = a.fl;
        f.t = r3(Math.min(f.T, f.t + dt));
        const u = f.t / f.T;
        a.ix = r3(M.lerp(f.x0, f.x1, u)); a.iy = r3(M.lerp(f.y0, f.y1, u));
        a.ih = r3(4 * f.h * u * (1 - u) + (1 - u) * 1.6);
        a.lt += dt;
        if (f.t >= f.T) {
          a.ph = 'land'; a.lt = 0; a.mark = [a.ix, a.iy]; a.ih = 0;
          if (a.cage) OG.sfx(s, 'net');
          else {
            OG.sfx(s, 'land');
            for (let k = 0; k < 12; k++) {
              const h1 = OG.hash(k, a.ix * 10 | 0, 21), h2 = OG.hash(k, 9, a.iy * 10 | 0);
              part(s, a.ix, a.iy, (h1 - 0.5) * 7, (h2 - 0.5) * 7, h2 > 0.5 ? DIRT : PAL.grass2, 0.7 + h1 * 0.4, 0, h1 > 0.7 ? 2 : 1);
            }
          }
        }
      } else if (a.ph === 'land') {
        a.lt += dt;
        if (!ham && !a.cage && a.lt < 0.4) { const f = a.fl, d = Math.hypot(f.x1 - f.x0, f.y1 - f.y0) || 1; a.ix = r3(a.ix + (f.x1 - f.x0) / d * 2.5 * dt * (1 - a.lt / 0.4)); a.iy = r3(a.iy + (f.y1 - f.y0) / d * 2.5 * dt * (1 - a.lt / 0.4)); }
        if (a.lt > 2.0) throwFinish(s, a.foul, a.cage ? '그물에 맞음' : a.foul ? '섹터 밖' : '');
      } else if (a.ph === 'stumble') {
        a.lt += dt;
        a.w = r3(Math.max(0, a.w - dt * 1.5));
        a.psi = r3(M.wrap(a.psi - a.w * TAU * dt + PI, TAU) - PI);
        if (a.lt > 1.5) throwFinish(s, true, '균형 상실');
      }
      // camera
      let tz = 34, tcx = 0, tcy = -0.3;
      if ((a.ph === 'fly' || a.ph === 'land') && a.fl) {
        const f = a.fl, k = M.clamp((a.ph === 'fly' ? f.t : f.T) / 0.9, 0, 1);
        const zFar = 205 / (f.d + 14);
        tz = 34 * Math.pow(zFar / 34, M.ease(k));
        tcx = M.lerp(0, a.ix * 0.5, k); tcy = M.lerp(-0.3, Math.min(-0.3, -f.d * 0.47), k);
        if (a.cage) { tz = 34; tcx = 0; tcy = -0.3; }
      }
      const kk = Math.min(1, dt * 6);
      a.z = r3(a.z + (tz - a.z) * kk); a.cx = r3(a.cx + (tcx - a.cx) * kk); a.cy = r3(a.cy + (tcy - a.cy) * kk);
    },
    draw(g, s) { drawSpin(g, s); }
  };
  // hammer rhythm: ▶ when the hammer passes the right side, ◀ on the left side
  function hammerBeats(s, i, dt) {
    const a = s.a;
    const beatAt = k => PI / 2 + k * PI;
    // auto-miss beats that went by
    while (a.bt.length < 12 && a.rot > beatAt(a.bt.length) + 0.18 * TAU * Math.max(0.5, a.w)) {
      a.bt.push(0); a.w = r3(Math.max(0.45, a.w - 0.05)); pop(s, 'MISS', PAL.red, 240, 80, 'b');
    }
    const press = (key) => {
      const k = a.bt.length;
      const err = (a.rot - beatAt(k)) / (TAU * Math.max(0.3, a.w));
      if (err < -0.2) return; // too early for the next beat – ignore
      const want = k % 2 === 0 ? 'r' : 'l';
      let q = 0;
      if (key === want) q = Math.abs(err) < 0.06 ? 2 : Math.abs(err) < 0.14 ? 1 : 0;
      a.bt.push(q);
      if (q === 2) { a.w = r3(Math.min(1.65, a.w + 0.15)); pop(s, 'PERFECT', PAL.yellow, 240, 80, 'b'); OG.sfx(s, 'perfect'); }
      else if (q === 1) { a.w = r3(Math.min(1.65, a.w + 0.09)); pop(s, 'GOOD', PAL.green, 240, 80, 'b'); OG.sfx(s, 'good'); }
      else { a.w = r3(Math.max(0.45, a.w - 0.04)); pop(s, 'MISS', PAL.red, 240, 80, 'b'); }
      if (a.bt.length === 6) { pop(s, '릴리스!', PAL.cyan, 240, 96, 'l', 1.5); OG.sfx(s, 'ding'); }
    };
    if (a.bt.length < 12) {
      if (cnt(i, 'l')) press('l');
      else if (cnt(i, 'r')) press('r');
    }
  }
  function implRadius(s) { return cfgOf(s).ham ? 1.85 : 0.85; }
  function release(s, R) {
    const a = s.a, c = cfgOf(s), ham = !!c.ham;
    const dev = M.angDiff(0, a.psi);
    const rr = implRadius(s);
    const x0 = a.ax + Math.cos(a.psi) * rr, y0 = a.ay + Math.sin(a.psi) * rr;
    const wn = ham ? M.clamp((a.w - 0.6) / 0.95, 0, 1) : M.clamp(a.w / 1.3, 0, 1);
    const th = -PI / 2 + 0.6 * dev;
    let D = c.dmax * sf(wn);
    a.cage = Math.abs(dev) > 70 * DEG;
    a.foul = Math.abs(0.6 * dev) > SECT;
    if (a.cage) D = 2.6;
    const rc = c.rc;
    a.fl = { x0: r3(x0), y0: r3(y0), x1: r3(Math.cos(th) * (D + (a.cage ? 0 : rc))), y1: r3(Math.sin(th) * (D + (a.cage ? 0 : rc))), d: r2(D), h: r2(a.cage ? 0.3 : D * (ham ? 0.2 : 0.16)), T: r3(a.cage ? 0.35 : (ham ? 0.8 : 0.9) + D * (ham ? 0.031 : 0.034)), t: 0 };
    if (a.cage) { a.fl.x1 = r3(a.ax + Math.cos(a.psi - PI / 2) * 3.2); a.fl.y1 = r3(a.ay + Math.sin(a.psi - PI / 2) * 3.2); }
    a.dist = Math.floor(D * 100) / 100;
    a.ix = a.fl.x0; a.iy = a.fl.y0; a.ih = 1.6;
    a.ph = 'fly'; a.lt = 0;
    OG.sfx(s, 'throw');
    if (a.cage) pop(s, '그물!', PAL.red, 240, 60, 'b');
    else if (a.foul) pop(s, '섹터 밖!', PAL.red, 240, 60, 'b');
    else if (Math.abs(dev) < 8 * DEG) pop(s, 'PERFECT!', PAL.yellow, 240, 60, 'l');
    else pop(s, 'GOOD', PAL.green, 240, 60, 'l');
  }
  // top-down thrower. face = chest direction (screen angle), psi = implement angle
  function topThrower(g, sx, sy, z0, face, psi, look, ham, step) {
    const z = z0 * 1.3;
    const P = (ang, r) => [sx + Math.cos(ang) * r * z, sy + Math.sin(ang) * r * z];
    const th = Math.max(2, Math.round(z0 * 0.09));
    g.ellipse(sx + Math.round(z * 0.08), sy + Math.round(z * 0.1), Math.max(2, z * 0.3), Math.max(2, z * 0.24), 'rgba(0,0,0,0.25)');
    // feet
    const st = Math.sin(step) * 0.12;
    const fl = P(face - PI / 2, 0.15), fr = P(face + PI / 2, 0.15);
    const fo = (p, k) => [p[0] + Math.cos(face) * k * z, p[1] + Math.sin(face) * k * z];
    const f1 = fo(fl, st), f2 = fo(fr, -st);
    g.circle(f1[0], f1[1], Math.max(1, z * 0.07), PAL.black); g.circle(f2[0], f2[1], Math.max(1, z * 0.07), PAL.black);
    // arms
    const shL = P(face - PI / 2, 0.22), shR = P(face + PI / 2, 0.22);
    let hand;
    if (ham) {
      hand = [sx + Math.cos(psi) * 0.7 * z0, sy + Math.sin(psi) * 0.7 * z0];
      g.line(shL[0], shL[1], hand[0], hand[1], look.skin, th); g.line(shR[0], shR[1], hand[0], hand[1], look.skin, th);
    } else {
      hand = [sx + Math.cos(psi) * 0.85 * z0, sy + Math.sin(psi) * 0.85 * z0];
      const el = P(face - PI / 2 + 0.9, 0.36);
      g.line(shL[0], shL[1], el[0], el[1], look.skin, th);
      g.line(shR[0], shR[1], hand[0], hand[1], look.skin, th);
    }
    // shoulders / torso
    g.line(shL[0], shL[1], shR[0], shR[1], look.shirt, Math.max(3, Math.round(z * 0.2)));
    const bk = P(face + PI, 0.06);
    g.circle(bk[0], bk[1], Math.max(1, z * 0.1), OG.shade(look.shirt, -0.2));
    // head
    g.circle(sx, sy, Math.max(1.5, z * 0.12), look.hair);
    const nose = P(face, 0.1);
    g.px(nose[0], nose[1], look.skin);
    return hand;
  }
  function drawSpin(g, s) {
    const a = s.a, c = cfgOf(s), ham = !!c.ham;
    const z = a ? a.z : 34, cx = a ? a.cx : 0, cy = a ? a.cy : -0.3;
    const SX = wx => Math.round(240 + (wx - cx) * z), SY = wy => Math.round(142 + (wy - cy) * z);
    const W2S = (x, y) => [SX(x), SY(y)];
    // grass + mowing stripes (5 m bands)
    g.clear('#4c9b47');
    const yTop = cy - 142 / z, yBot = cy + 140 / z;
    for (let b = Math.floor(yTop / 5); b <= Math.ceil(yBot / 5); b++) {
      if (b % 2) continue;
      const y0 = SY(b * 5), y1 = SY(b * 5 + 5);
      g.rect(SX(-36.5), y0, SX(36.5) - SX(-36.5), y1 - y0, '#56a750');
    }
    // stadium: stands, oval track (straights + far bend), infield
    const BEND = -84;
    const oval = R => {
      const pts = [SX(R), SY(60), SX(R), SY(BEND)];
      for (let j = 1; j < 24; j++) { const an = -j / 24 * PI; pts.push(SX(Math.cos(an) * R), SY(BEND + Math.sin(an) * R)); }
      pts.push(SX(-R), SY(BEND), SX(-R), SY(60));
      return pts;
    };
    if (SX(46.5) < 480 || SY(BEND - 46.5) > 0) {
      g.rect(0, 0, 480, 270, '#2b3150');
      // seat rows + spectators (muted)
      const rowH = Math.max(2, Math.round(z * 0.9));
      const oy = M.wrap(SY(0), rowH);
      for (let yy = oy; yy < 270; yy += rowH) g.rect(0, yy, 480, 1, '#363e62');
      const step = Math.max(2, Math.round(z * 0.7));
      for (let yy = oy + 1; yy < 270; yy += rowH) for (let xx = M.wrap(SX(0), step); xx < 480; xx += step) {
        const hsh = OG.hash(Math.round((xx - SX(0)) / step), Math.round((yy - SY(0)) / rowH), 5);
        if (hsh < 0.55) g.px(xx, yy, CROWD_DARK[Math.floor(hsh * 18.1) % CROWD_DARK.length]);
      }
      g.poly(oval(47.5), '#c0cbdc');
      g.poly(oval(46.5), PAL.track);
      for (let k = 1; k < 8; k++) {
        const lx = 36.5 + k * 1.25;
        g.rect(SX(lx), SY(BEND), 1, 270, 'rgba(242,232,216,0.45)'); g.rect(SX(-lx), SY(BEND), 1, 270, 'rgba(242,232,216,0.45)');
      }
      g.poly(oval(36.5), '#4c9b47');
      for (let b = Math.floor(yTop / 5); b <= Math.ceil(yBot / 5); b++) {
        if (b % 2 || b * 5 < BEND) continue;
        const y0 = SY(b * 5), y1 = SY(b * 5 + 5);
        g.rect(SX(-36.5), y0, SX(36.5) - SX(-36.5), y1 - y0, '#56a750');
      }
    }
    const rc = c.rc;
    // sector lines
    const sl = (sgn) => {
      const an = -PI / 2 + sgn * SECT;
      g.line(SX(Math.cos(an) * rc), SY(Math.sin(an) * rc), SX(Math.cos(an) * 100), SY(Math.sin(an) * 100), PAL.white, z > 8 ? 2 : 1);
    };
    sl(1); sl(-1);
    // distance arcs
    for (let d = 20; d <= 90; d += 10) {
      const rr = d + rc;
      let lp = null;
      for (let j = 0; j <= 14; j++) {
        const an = -PI / 2 - SECT + j / 14 * 2 * SECT;
        const p = [SX(Math.cos(an) * rr), SY(Math.sin(an) * rr)];
        if (lp) g.line(lp[0], lp[1], p[0], p[1], 'rgba(255,255,255,0.7)', 1);
        lp = p;
      }
      if (z < 8) g.text(String(d), lp[0] + 3, lp[1] - 4, PAL.white, { size: 'xs', outline: 'rgba(0,0,0,0.5)' });
    }
    // leader arc
    const st = standings(s);
    if (st.length && st[0].has && s.P[st[0].i].best > 0) {
      const rr = s.P[st[0].i].best + rc;
      let lp = null;
      for (let j = 0; j <= 14; j++) {
        const an = -PI / 2 - SECT * 1.15 + j / 14 * 2.3 * SECT;
        const p = [SX(Math.cos(an) * rr), SY(Math.sin(an) * rr)];
        if (lp) g.line(lp[0], lp[1], p[0], p[1], PAL.cyan, 1);
        lp = p;
      }
      g.flag(s.E[st[0].i].c, lp[0] + 3, lp[1] - 4, 12, 8);
    }
    // circle + concrete pad
    g.circle(SX(0), SY(0), rc * z + Math.max(1, z * 0.6), '#6f7686');
    g.circle(SX(0), SY(0), rc * z + 1, PAL.white);
    g.circle(SX(0), SY(0), rc * z - 1, '#9aa1ad');
    g.line(SX(-rc - 0.75), SY(0), SX(-rc), SY(0), PAL.white, 1); g.line(SX(rc), SY(0), SX(rc + 0.75), SY(0), PAL.white, 1);
    // landing mark
    if (a && a.mark && !a.cage) { g.rect(SX(a.mark[0]) - 1, SY(a.mark[1]) - 1, 3, 2, DIRT2); }
    // cage back half (behind the thrower)
    const cageR = ham ? 3.9 : 3.4, open = ham ? 24 * DEG : 33 * DEG;
    const cagePosts = [];
    const n = 12;
    for (let k = 0; k <= n; k++) { const an = -PI / 2 + open + k / n * (TAU - 2 * open); cagePosts.push([SX(Math.cos(an) * cageR), SY(Math.sin(an) * cageR)]); }
    for (let k = 0; k < n; k++) {
      const p = cagePosts[k], q = cagePosts[k + 1];
      g.line(p[0], p[1], q[0], q[1], 'rgba(220,228,240,0.28)', Math.max(1, Math.round(z * 0.1)));
      g.line(p[0], p[1], q[0], q[1], 'rgba(24,20,37,0.45)', 1);
    }
    if (a) {
      // release zone on the implement orbit
      const e = s.E[s.cur], look = lookE(e);
      const rr = implRadius(s);
      const AX = SX(a.ax), AY = SY(a.ay);
      const armed = a.ph === 'spin' && (!ham || a.bt.length >= 6);
      if (a.ph === 'ready' || a.ph === 'spin') {
        for (let j = -12; j <= 12; j++) {
          const an = j * 15 * DEG;
          g.px(AX + Math.cos(an) * rr * z, AY + Math.sin(an) * rr * z, 'rgba(255,255,255,0.3)');
        }
        const zc = armed ? (Math.floor(g.t * 6) % 2 ? PAL.green : '#a6f08f') : 'rgba(99,199,77,0.45)';
        for (let d = -ZONE; d <= ZONE; d += 1.5 * DEG) {
          const p = [AX + Math.cos(d) * rr * z, AY + Math.sin(d) * rr * z];
          g.rect(p[0] - 1, p[1] - 1, 3, 3, zc);
        }
        if (armed) { const p = [AX + Math.cos(ZONE) * (rr * z + 10), AY + Math.sin(ZONE) * (rr * z + 10)]; g.keycap(Math.round(p[0]), Math.round(p[1]), 'A'); }
        if (ham && a.ph === 'spin' && a.bt.length < 12) { // beat cue: next side
          const k = a.bt.length, want = k % 2 === 0 ? 'R' : 'L';
          const side = want === 'R' ? 0 : PI;
          const until = (PI / 2 + k * PI - a.rot) / (TAU * Math.max(0.3, a.w));
          const px = AX + Math.cos(side) * (rr + 0.55) * z, py = AY + Math.sin(side) * (rr + 0.55) * z;
          const near = Math.abs(until) < 0.15;
          g.circleO(px, py, Math.max(5, 5 + until * 30), near ? PAL.yellow : 'rgba(255,255,255,0.6)');
          g.keycap(Math.round(px - 5), Math.round(py - 5), want);
        }
      }
      // thrower + implement
      const face = ham ? a.psi + 0.25 : a.psi - PI / 2 - 0.35;
      if (a.ph === 'fly' || a.ph === 'land') {
        topThrower(g, AX, AY, z, -PI / 2, -PI / 2 + 0.6, look, ham, 0);
      } else {
        const hand = topThrower(g, AX, AY, z, face, a.psi, look, ham, a.rot * 2);
        if (ham) {
          const bx = AX + Math.cos(a.psi) * rr * z, by = AY + Math.sin(a.psi) * rr * z;
          g.line(hand[0], hand[1], bx, by, '#c0cbdc', 1);
          // motion blur trail of the ball
          for (let k = 1; k <= 4; k++) { const an = a.psi + k * 0.12 * Math.min(1.5, a.w); g.alpha(0.35 - k * 0.07); g.circle(AX + Math.cos(an) * rr * z, AY + Math.sin(an) * rr * z, Math.max(1.5, z * 0.11), PAL.lightgrey); }
          g.alpha(1);
          g.circle(bx, by, Math.max(1.5, z * 0.11), PAL.black); g.circle(bx, by, Math.max(1, z * 0.09), '#5a6075');
        } else {
          g.circle(hand[0], hand[1], Math.max(1.5, z * 0.11), PAL.black); g.circle(hand[0], hand[1], Math.max(1, z * 0.09), '#e8e2d0');
        }
      }
      nameTag(g, s, AX, AY - Math.max(14, z * 0.9));
      // implement in flight (with height) + shadow
      if (a.ph === 'fly' || a.ph === 'land') {
        const ix = SX(a.ix), iy = SY(a.iy), hp = Math.round(a.ih * Math.max(1.5, z * 0.5));
        g.ellipse(ix, iy, 2, 1, 'rgba(0,0,0,0.35)');
        if (a.ph === 'fly') {
          const f = a.fl;
          let lp = null;
          for (let t = Math.max(0, f.t - 0.5); t <= f.t; t += 0.05) {
            const u = t / f.T, x = SX(M.lerp(f.x0, f.x1, u)), y = SY(M.lerp(f.y0, f.y1, u)) - Math.round((4 * f.h * u * (1 - u) + (1 - u) * 1.6) * Math.max(1.5, z * 0.5));
            if (lp) { g.alpha(0.5 * (1 - (f.t - t) / 0.5)); g.line(lp[0], lp[1], x, y, PAL.white, 1); g.alpha(1); }
            lp = [x, y];
          }
        }
        if (ham) {
          const wob = Math.sin(g.t * 20) * 3;
          g.line(ix, iy - hp, ix + 4 + wob, iy - hp + 6, '#c0cbdc', 1);
          g.circle(ix, iy - hp, 3, PAL.black); g.circle(ix, iy - hp, 2, '#5a6075');
        } else {
          const sp = Math.floor(g.t * 16) % 2;
          g.ellipse(ix, iy - hp, 3, sp ? 2 : 1.5, PAL.black); g.ellipse(ix, iy - hp, 2, 1, '#e8e2d0');
        }
        if (a.ph === 'land' && a.lt > 0.4 && !a.foul) {
          g.text(a.dist.toFixed(2) + 'm', ix, iy - 22, PAL.yellow, { size: 'b', align: 'center', outline: PAL.black });
        }
        if (a.ph === 'land' && a.foul && a.lt > 0.4) g.text('파울', ix, iy - 22, PAL.red, { size: 'b', align: 'center', outline: PAL.black });
      }
    }
    // cage front posts (over everything)
    for (const p of cagePosts) { const w = Math.max(2, Math.round(z * 0.1)); g.rect(p[0] - (w >> 1), p[1] - (w >> 1), w, w, '#262b44'); }
    drawParts(g, s, (x, y) => [SX(x), SY(y)]);
    if (a && (s.ph === 'play' || s.ph === 'ban')) {
      g.rect(0, 248, 480, 22, 'rgba(24,20,37,0.65)');
      const wn = ham ? M.clamp((a.w - 0.6) / 0.95, 0, 1) : M.clamp(a.w / 1.3, 0, 1);
      speedBar(g, 8, 256, 110, wn, '회전');
      g.text((a.rot / TAU).toFixed(1) + '회전', 124, 255, PAL.lightgrey, { size: 'xs' });
      if (ham) {
        for (let k = 0; k < 6; k++) {
          const q = a.bt[k];
          g.rect(400 + k * 12, 255, 9, 9, q == null ? PAL.slate : q === 2 ? PAL.yellow : q === 1 ? PAL.green : PAL.red);
        }
      }
      if (s.ph === 'play') {
        if (ham) {
          if (a.ph === 'ready') hint(g, '해머가 오른쪽일 때 {R}, 왼쪽일 때 {L}');
          else if (a.ph === 'spin') hint(g, a.bt.length < 6 ? '리듬에 맞춰 {R} / {L}  (' + a.bt.length + '/6)' : '초록 구간에서 {A} 릴리스!');
        } else {
          if (a.ph === 'ready') hint(g, '{L}{R} 번갈아 연타로 회전 시작!');
          else if (a.ph === 'spin') hint(g, '{L}{R} 연타로 가속 → 원반이 초록 구간일 때 {A}!');
        }
      }
    }
  }

  /* ============================================================ SKI JUMP === */
  // Large hill (HS140, K125). x: horizontal m from the table edge, y: height m (up).
  const SKI = (function () {
    const sm = v => v * v * (3 - 2 * v);
    const inAng = x => x > -7 ? 11 : x > -32 ? 35 + (11 - 35) * sm((x + 32) / 25) : 35;
    const landAng = x => 5 + 31.5 * sm(M.clamp(x / 38, 0, 1)) - 36.5 * sm(M.clamp((x - 108) / 60, 0, 1));
    const IN = [], LAND = [];
    let y = 0;
    for (let x = 0; x >= -72; x -= 0.5) { IN.push(y); y += Math.tan(inAng(x - 0.25) * DEG) * 0.5; }
    y = -2.8; let sl = 0;
    for (let x = 0; x <= 260; x += 0.5) { LAND.push([y, sl]); const a = landAng(x + 0.25) * DEG; y -= Math.tan(a) * 0.5; sl += 0.5 / Math.cos(a); }
    const inY = x => { const f = M.clamp(-x / 0.5, 0, IN.length - 1.001), i = Math.floor(f); return M.lerp(IN[i], IN[i + 1], f - i); };
    const hill = x => { if (x < 0) return -2.8 + (-x) * 0.3; const f = M.clamp(x / 0.5, 0, LAND.length - 1.001), i = Math.floor(f); return M.lerp(LAND[i][0], LAND[i + 1][0], f - i); };
    const sdist = x => { const f = M.clamp(x / 0.5, 0, LAND.length - 1.001), i = Math.floor(f); return M.lerp(LAND[i][1], LAND[i + 1][1], f - i); };
    const xAt = d => { for (let i = 1; i < LAND.length; i++) if (LAND[i][1] >= d) return (i - 1) * 0.5 + 0.5 * (d - LAND[i - 1][1]) / (LAND[i][1] - LAND[i - 1][1]); return 260; };
    return { inAng, landAng, inY, hill, sdist, xAt, X0: -66, K: 125, HS: 140 };
  })();
  const SKI_PPM = 5;
  function skiPts(dist, judges) {
    const sorted = judges.slice().sort((p, q) => p - q);
    const style = sorted[1] + sorted[2] + sorted[3];
    return { dpts: r2(Math.max(0, 60 + 1.8 * (dist - SKI.K))), style: r2(style) };
  }
  function skiJudges(base, R) {
    const out = [];
    for (let k = 0; k < 5; k++) out.push(Math.round(M.clamp(base + R.gauss() * 0.45, 8, 20) * 2) / 2);
    return out;
  }
  KD.ski = {
    mode: 'sum', roundWord: '라운드',
    rounds: nh => nh <= 4 ? 2 : 1,
    fmt: v => v.toFixed(1) + '점',
    cpu(s, e, R) {
      const out = [];
      for (let r = 0; r < s.rounds; r++) {
        const q = OG.cpuQuality({ skill: e.skill }, R, 0.1);
        const fall = R.chance(0.025 + (1 - q) * 0.03);
        const dist = Math.floor((108 + 34 * q + R.gauss() * 3.2) * 2) / 2;
        const J = skiJudges(fall ? 9.5 : 16.0 + 3.0 * q, R);
        const p = skiPts(dist, J);
        out.push(r2(p.dpts + p.style));
      }
      return out;
    },
    start(s, R) {
      const x = SKI.X0;
      return { ph: 'gate', x, y: r3(SKI.inY(x)), v: 0, vx: 0, vy: 0, t: 0, idle: 0, gt: 0, tuck: false, jq: -1, jt: false,
        b: 0, gust: 0, gtg: 0, gtt: 0, bs: 0, bn: 0, tel: 0, hand: false, crash: false, lt: 0, dist: 0, judges: null, dpts: 0, sty: 0, pts: 0,
        cx: r3(x + 20), cy: r3(SKI.inY(x) - 14), fin: false, res: null, wind: r2(R.range(0.3, 1.0)), rot: 0 };
    },
    upd(s, i, dt, R) {
      const a = s.a;
      a.t += dt;
      if (a.ph === 'gate') {
        a.gt += dt;
        if (idleTick(a, i, dt)) return skiFinish(s, R, true);
        if (i.ap || i.dp || a.gt > 4.5) { a.ph = 'inrun'; OG.sfx(s, 'whoosh'); a.idle = 0; }
      } else if (a.ph === 'inrun') {
        a.tuck = !!i.d;
        const th = SKI.inAng(a.x) * DEG;
        const kd = a.tuck ? 0.0006 : 0.0026;
        a.v = r3(a.v + (9.81 * Math.sin(th) - 0.035 * 9.81 * Math.cos(th) - kd * a.v * a.v) * dt);
        a.x = r3(a.x + a.v * Math.cos(th) * dt); a.y = r3(SKI.inY(a.x));
        if (i.ap && a.x > -12 && a.jq < 0) {
          a.jq = r2(M.clamp(1 - Math.pow(Math.abs(a.x) / 4.5, 1.2), 0, 1));
          skiJumpPop(s, a.jq, a.x);
        }
        if (a.x >= 0) {
          const v0 = a.v, a0 = -11 * DEG;
          a.vx = r3(v0 * Math.cos(a0)); a.vy = r3(v0 * Math.sin(a0) + 2.2 * Math.max(0, a.jq));
          a.ph = 'fly'; a.lt = 0; a.jt = a.jq >= 0; OG.sfx(s, 'jump');
        }
      } else if (a.ph === 'fly') {
        a.lt += dt;
        if (!a.jt && i.ap && a.x < 3) { // late pop
          const jq = r2(M.clamp(1 - Math.pow(a.x / 4.5, 1.2), 0, 1));
          a.jq = jq; a.jt = true; a.vy = r3(a.vy + 2.2 * jq); skiJumpPop(s, jq, a.x);
        } else if (!a.jt && a.x >= 3) { a.jt = true; a.jq = 0; pop(s, '점프 실패!', PAL.red, 240, 60, 'b'); }
        // wind gusts + balance
        a.gtt -= dt;
        if (a.gtt <= 0) { a.gtt = r2(R.range(0.45, 1.0)); a.gtg = r2(R.gauss() * 0.9 * (0.6 + a.wind)); }
        a.gust = r3(a.gust + (a.gtg - a.gust) * Math.min(1, dt * 3));
        if (!a.crash) {
          let ctl = 0;
          if (i.l) ctl -= 2.1; if (i.r) ctl += 2.1;
          a.b = r3(M.clamp(a.b + (a.gust * 0.85 + a.b * 0.7 + ctl) * dt, -1, 1));
          if (Math.abs(a.b) >= 1) { a.crash = true; OG.sfx(s, 'crash'); pop(s, '균형 상실!', PAL.red, 240, 60, 'l'); }
          a.bs = r3(a.bs + Math.abs(a.b) * dt); a.bn = r3(a.bn + dt);
        }
        const open = Math.min(1, a.lt / 0.5);
        let lm = a.crash ? 0.25 : (1 - 0.5 * Math.pow(Math.min(1, Math.abs(a.b)), 1.5)) * (0.7 + 0.3 * open);
        if (a.tel === -1) lm *= 0.85;
        a.vx = r3(a.vx - 0.0009 * a.vx * a.vx * (a.crash ? 3 : 1) * dt);
        a.vy = r3(a.vy + (-9.81 + 0.0095 * a.vx * a.vx * lm) * dt);
        a.x = r3(a.x + a.vx * dt); a.y = r3(a.y + a.vy * dt);
        const h = a.y - SKI.hill(a.x);
        if (i.ap && a.jt && a.tel === 0 && a.lt > 1.0 && !a.crash) {
          if (h < 3.5) { a.tel = 1; pop(s, '텔레마크!', PAL.yellow, 240, 76, 'l'); OG.sfx(s, 'good'); }
          else { a.tel = -1; pop(s, '착지 준비가 빨라!', PAL.orange, 240, 76, 'b'); }
        }
        if (h <= 0) {
          a.y = r3(SKI.hill(a.x)); a.ph = 'land'; a.lt = 0;
          a.dist = Math.floor(SKI.sdist(a.x) * 2) / 2;
          a.hand = !a.crash && Math.abs(a.b) > 0.75;
          a.v = r3(Math.hypot(a.vx, a.vy) * 0.85);
          OG.sfx(s, a.crash ? 'crash' : 'land');
          for (let k = 0; k < 18; k++) {
            const h1 = OG.hash(k, a.x * 10 | 0, 31), h2 = OG.hash(k, 4, a.x * 3 | 0);
            part(s, a.x + (h1 - 0.5) * 2, a.y + 0.2, 4 + h1 * 10, 2 + h2 * 6, h2 > 0.4 ? '#ffffff' : '#d5e2f2', 0.8 + h2 * 0.5, 9.8, h1 > 0.6 ? 2 : 1);
          }
          const ff = a.bn > 0 ? 1 - Math.min(1, a.bs / a.bn * 2) : 0.5;
          let base = 15.4 + 2.6 * ff + (a.tel === 1 ? 1.9 : a.tel === -1 ? 0.5 : 0) - (a.hand ? 3 : 0);
          if (a.jq < 0.2) base -= 0.5;
          if (a.crash) base = 9;
          a.judges = skiJudges(base, R);
          const p = skiPts(a.dist, a.judges);
          a.dpts = p.dpts; a.sty = p.style; a.pts = r2(p.dpts + p.style);
        }
      } else if (a.ph === 'land') {
        a.lt += dt;
        const th = Math.atan2(SKI.hill(a.x) - SKI.hill(a.x + 0.5), 0.5);
        const decel = a.crash ? 9 : (a.x > 175 ? 6 : 0.8);
        a.v = r3(Math.max(0, a.v + (9.81 * Math.sin(th) * 0.6 - decel) * dt));
        a.x = r3(a.x + a.v * Math.cos(th) * dt); a.y = r3(SKI.hill(a.x));
        if (a.crash) { a.rot = r2(a.rot + dt * a.v * 0.6); if (OG.hash(Math.floor(a.lt * 20), 3, 7) < 0.4) part(s, a.x, a.y + 0.3, -2 + a.v * 0.3, 2, '#ffffff', 0.5, 9.8, 1); }
        if (a.lt > 3.4) skiFinish(s, R, false);
      }
      // camera (world centre)
      let tx = a.x + 16, ty = a.y - 12;
      if (a.ph === 'gate') { tx = a.x + 22; ty = a.y - 16; }
      if (a.ph === 'land') { tx = a.x + 6; ty = a.y + 4; }
      const k = Math.min(1, dt * (a.ph === 'fly' ? 5 : 4));
      a.cx = r3(a.cx + (tx - a.cx) * k); a.cy = r3(a.cy + (ty - a.cy) * k);
    },
    draw(g, s) { drawSki(g, s); }
  };
  function skiJumpPop(s, jq, x) {
    if (jq > 0.85) { pop(s, 'PERFECT 점프!', PAL.yellow, 240, 60, 'l'); OG.sfx(s, 'perfect'); }
    else if (jq > 0.5) pop(s, 'GOOD 점프', PAL.green, 240, 60, 'l');
    else pop(s, x < 0 ? '점프가 빨라!' : '점프가 늦어!', PAL.orange, 240, 60, 'b');
  }
  function skiFinish(s, R, idle) {
    const a = s.a;
    a.fin = true;
    if (idle) { a.res = { v: 0, txt: '실격', sub: '출발하지 않음', bad: true }; return; }
    a.res = { v: a.pts, txt: a.dist.toFixed(1) + 'm', sub: a.pts.toFixed(1) + '점 (거리 ' + a.dpts.toFixed(1) + ' + 자세 ' + a.sty.toFixed(1) + ')', bad: a.crash };
    if (a.dist > 146 && !a.crash) a.res.tag = '힐 레코드!';
  }
  // leg vector from hip to foot (local: +x forward, +y down) for a pose at scale s
  function legVec(p, sc) {
    const l = p.lR || 0, k = p.kR || 0;
    return [(Math.sin(l) * 5.5 + Math.sin(l - k) * 5.5) * sc, (Math.cos(l) * 5.5 + Math.cos(l - k) * 5.5) * sc];
  }
  function drawSkis(g, fx, fy, ang, len, spread) {
    for (let k = 0; k < 2; k++) {
      const an = ang + (k ? spread : -spread);
      const dx = Math.cos(an), dy = Math.sin(an);
      const x0 = fx - dx * len * 0.35, y0 = fy - dy * len * 0.35, x1 = fx + dx * len * 0.65, y1 = fy + dy * len * 0.65;
      g.line(x0, y0, x1, y1, k ? '#e43b44' : '#a22633', 1);
      g.px(x1 + Math.cos(an - 0.6), y1 + Math.sin(an - 0.6), k ? '#e43b44' : '#a22633');
    }
  }
  function drawSki(g, s) {
    const a = s.a;
    const P = SKI_PPM;
    const cx = a ? a.cx : SKI.X0 + 20, cy = a ? a.cy : SKI.inY(SKI.X0) - 14;
    const SX = x => Math.round(220 + (x - cx) * P), SY = y => Math.round(135 - (y - cy) * P);
    // sky + mountains (parallax)
    g.grad(0, 0, 480, 270, '#4f8fd8', '#d6ecff', 9);
    g.circle(400 - cx * 0.05, 40, 10, '#fff6c8');
    g.clouds(g.t, 18, 2, 'rgba(255,255,255,0.8)', 5);
    const my = 92 + (cy - 20) * 0.6;
    g.mountains(Math.round(my), 70, '#9fb8d8', 3, cx * P * 0.06, '#f4f8ff');
    g.mountains(Math.round(my + 40), 60, '#7d97bd', 7, cx * P * 0.12, '#e8f0fb');
    g.trees(Math.round(my + 98), '#2f5c4a', 4, cx * P * 0.25, 9);
    g.rect(0, Math.round(my + 98), 480, 270, '#e3ecf7');
    g.trees(Math.round(my + 120), '#264d3f', 9, cx * P * 0.4, 12);
    // terrain + landing hill (column fill)
    const ground = x => SKI.hill(x);
    for (let sx = 0; sx < 480; sx++) {
      const wx = cx + (sx - 220) / P;
      const yy = SY(ground(wx));
      if (yy < 270) {
        g.rect(sx, yy, 1, 270 - yy, '#f4f8fe');
        g.rect(sx, yy + 26, 1, 270 - yy, '#e9f0f9');
        g.px(sx, yy, '#a9c0de');
        if (wx >= 0 && wx < 200) { g.px(sx, yy + 3, '#dce7f4'); g.px(sx, yy + 8, '#e3ecf7'); g.px(sx, yy + 14, '#e8eff9'); }
      }
    }
    // distance markers along the landing hill
    for (let d = 50; d <= 150; d += 5) {
      const x = SKI.xAt(d), sx = SX(x), sy = SY(SKI.hill(x));
      if (sx < -20 || sx > 500) continue;
      const big = d % 10 === 0;
      const col = d === SKI.K ? PAL.red : d === SKI.HS ? '#3e8948' : '#2a4d7a';
      g.rect(sx, sy, 1, big ? 6 : 3, col);
      if (d === SKI.K || d === SKI.HS) { g.rect(sx - 1, sy - 1, 3, 2, col); }
      if (big) {
        g.rect(sx - 8, sy + 8, 17, 8, d === SKI.K ? PAL.red : d === SKI.HS ? '#3e8948' : '#262b44');
        g.text(String(d), sx + 1, sy + 8, PAL.white, { size: 'xs', align: 'center' });
      }
      g.rect(sx - 3, sy + 2, 2, 2, '#2f6b3f'); // fir branch marker
    }
    // K label
    { const x = SKI.xAt(SKI.K); g.text('K', SX(x) + 4, SY(SKI.hill(x)) - 12, PAL.red, { size: 's', outline: PAL.white }); }
    // leader "to beat" line
    const st = standings(s);
    if (s.mode === 'sum' && st.length && st[0].has && a && s.rnd >= 0) {
      const lead = s.P[st[0].i];
      const need = s.rnd === 0 ? lead.tot : lead.tot - (s.P[s.cur] ? s.P[s.cur].tot : 0);
      // points needed this jump → distance assuming 54 style points
      const dNeed = SKI.K + (need - 54 - 60) / 1.8;
      if (dNeed > 60 && dNeed < 160 && s.cur !== st[0].i) {
        const x = SKI.xAt(dNeed), sx = SX(x), sy = SY(SKI.hill(x));
        g.alpha(0.8); g.line(sx - 6, sy - 10, sx + 6, sy + 6, '#3cff6a', 2); g.alpha(1);
        g.flag(s.E[st[0].i].c, sx + 4, sy - 18, 12, 8);
      }
    }
    // judges' tower beside the K point
    { const x = SKI.xAt(118) - 4, sx = SX(x), sy = SY(SKI.hill(x)) - 2;
      g.rect(sx - 26, sy - 36, 22, 36, '#3a4466'); g.rect(sx - 28, sy - 40, 26, 5, '#262b44');
      for (let k = 0; k < 5; k++) { g.rect(sx - 24 + k * 4, sy - 31, 3, 6, '#9fd8ff'); g.px(sx - 23 + k * 4, sy - 28, PAL.skin2); }
      g.text('JUDGES', sx - 15, sy - 22, PAL.white, { size: 'xs', align: 'center', maxW: 20 }); }
    // in-run structure: scaffold + deck + gate
    const xs0 = SKI.X0 - 4;
    for (let x = Math.ceil(xs0 / 6) * 6; x <= 0; x += 6) {
      const sx = SX(x), top = SY(SKI.inY(x)), bot = SY(ground(x));
      if (sx < -10 || sx > 490) continue;
      g.rect(sx, top, 2, bot - top, '#4a5274');
      if (x + 6 <= 0) g.line(sx, top + 2, SX(x + 6), SY(ground(x + 6)) - 2, '#5a6988', 1);
    }
    let lp = null;
    for (let x = xs0; x <= 0.01; x += 1) {
      const p = [SX(x), SY(SKI.inY(Math.min(0, x)))];
      if (lp) { g.line(lp[0], lp[1] + 2, p[0], p[1] + 2, '#3a4466', 3); g.line(lp[0], lp[1], p[0], p[1], '#ffffff', 2); g.line(lp[0], lp[1] - 1, p[0], p[1] - 1, '#9fd8ff', 1); }
      lp = p;
    }
    { const sx = SX(0), sy = SY(0); g.rect(sx - 1, sy, 3, 4, PAL.red); }   // table edge
    { const sx = SX(SKI.X0 - 2), sy = SY(SKI.inY(SKI.X0)); g.rect(sx - 10, sy - 18, 14, 14, '#68386c'); g.rect(sx - 12, sy - 20, 18, 3, '#3e2731'); g.rect(sx + 3, sy - 6, 6, 1, PAL.yellow); }
    // crowd at the outrun
    { const x0 = 172, sx0 = SX(x0), sy0 = SY(SKI.hill(x0 + 20));
      if (sx0 < 480) {
        g.crowd(sx0, sy0 - 22, 480 - sx0 + 40, 18, g.t, { seed: 5, excite: a && a.ph === 'land' ? 0.7 : 0.2, bg: '#c9d6e6' });
        g.rect(sx0, sy0 - 4, 480, 2, '#e43b44');
      } }
    if (!a) return;
    // jumper
    const e = s.E[s.cur], look = Object.assign(lookE(e), { suit: lookE(e).shirt, cap: lookE(e).pants });
    const Po = OG.Pose;
    const jx = SX(a.x), jy = SY(a.y);
    let pose, rot = 0, skiAng = 0, spread = 0;
    if (a.ph === 'gate') { pose = Po.sit(); pose.aL = 1.2; pose.aR = 1.2; rot = 0.35; skiAng = 35 * DEG; }
    else if (a.ph === 'inrun') { const th = SKI.inAng(a.x) * DEG; pose = a.tuck ? Po.tuckSki() : { t: 0.6, aL: 0.4, aR: 0.5, eL: 0.6, eR: 0.6, lL: 0.6, lR: 0.5, kL: 0.9, kR: 0.8 }; rot = th; skiAng = th; }
    else if (a.ph === 'fly') {
      const k = Math.min(1, a.lt / 0.4);
      const va = Math.atan2(-a.vy, a.vx);
      const h = a.y - SKI.hill(a.x);
      const land = a.tel === 1 && h < 3.5 ? Math.min(1, (3.5 - h) / 2) : 0;
      if (a.crash) { pose = { t: -0.4, aL: 2.4, aR: 1.0, eL: 0.6, eR: 0.9, lL: 0.9, lR: -0.5, kL: 0.8, kR: 0.4 }; rot = a.lt * 6; skiAng = a.lt * 4; }
      else {
        const flyP = { t: 0.1, aL: -0.25, aR: -0.2, eL: 0, eR: 0, lL: 0.05, lR: 0, kL: 0.05, kR: 0 };
        pose = Po.mix(Po.mix({ t: 0.5, aL: -0.3, aR: -0.3, eL: 0, eR: 0, lL: 0.4, lR: 0.4, kL: 0.4, kR: 0.4 }, flyP, k), { t: 0.2, aL: 1.4, aR: 1.8, eL: 0.2, eR: 0.2, lL: 0.7, lR: -0.4, kL: 0.8, kR: 1.4 }, land);
        rot = va + (PI / 2 - 0.45) * k * (1 - land) + a.b * 0.45;
        skiAng = va - 0.55 * k * (1 - land) - a.b * 0.25;
        spread = 0.05 * k * (1 - land);
      }
    } else { // land / outrun
      const th = Math.atan2(SKI.hill(a.x) - SKI.hill(a.x + 0.5), 0.5);
      if (a.crash) { pose = Po.fallen(); rot = a.rot; skiAng = th + a.rot * 0.5; }
      else {
        pose = a.lt < 0.6 ? (a.tel === 1 ? { t: 0.2, aL: 1.4, aR: 1.8, eL: 0.2, eR: 0.2, lL: 0.7, lR: -0.4, kL: 0.8, kR: 1.4 } : Po.crouch()) : (a.lt > 2.2 && a.v < 1 ? Po.celebrate(a.lt) : { t: 0.3, aL: 0.6, aR: 0.6, eL: 0.4, eR: 0.4, lL: 0.3, lR: 0.2, kL: 0.5, kR: 0.5 });
        rot = th * 0.6; skiAng = th;
      }
    }
    // place hip so the feet sit on (jx,jy)
    const lv = legVec(pose, 1);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const hx = jx - (lv[0] * cr - lv[1] * sr), hy = jy - (lv[0] * sr + lv[1] * cr);
    if (a.ph === 'fly') { const gy = SY(SKI.hill(a.x)); g.ellipse(jx, gy, 5, 1, 'rgba(40,60,90,0.25)'); }
    const J = g.figure(hx, hy, pose, look, { facing: 1, scale: 1, anchor: 'hip', rot });
    drawSkis(g, J.ftR[0], J.ftR[1], skiAng, 18, spread);
    if (a.ph === 'gate' || a.ph === 'inrun') nameTag(g, s, jx, Math.min(J.head[1], jy) - 14);
    drawParts(g, s, (x, y) => [SX(x), SY(y)]);
    g.snowfall(g.t, 40, 'rgba(255,255,255,0.8)');
    // HUD
    if (s.ph === 'play' || s.ph === 'ban') {
      g.rect(0, 248, 480, 22, 'rgba(24,20,37,0.65)');
      g.text(Math.round(a.ph === 'fly' ? Math.hypot(a.vx, a.vy) * 3.6 : a.v * 3.6) + ' km/h', 8, 255, PAL.white, { size: 's' });
      // wind
      const wv = a.ph === 'fly' ? a.gust : a.wind;
      g.text('바람 ' + (wv >= 0 ? '+' : '') + wv.toFixed(1), 472, 255, Math.abs(wv) > 0.8 ? PAL.orange : PAL.lightgrey, { size: 's', align: 'right' });
      if (a.ph === 'fly' && !a.crash) {
        // balance meter
        const bx = 240, by = 236;
        g.rect(bx - 62, by - 2, 124, 9, 'rgba(24,20,37,0.85)');
        g.rect(bx - 60, by, 120, 5, PAL.red); g.rect(bx - 42, by, 84, 5, PAL.yellow); g.rect(bx - 20, by, 40, 5, PAL.green);
        const nx = Math.round(bx + a.b * 60);
        g.poly([nx - 4, by - 7, nx + 4, by - 7, nx, by - 1], PAL.white);
        g.rect(nx - 1, by - 2, 3, 9, PAL.white); g.rect(nx, by - 1, 1, 7, PAL.black);
        g.text('균형', bx - 66, by - 2, PAL.white, { size: 'xs', align: 'right' });
      }
      if (s.ph === 'play') {
        if (a.ph === 'gate') hint(g, '{A} 출발  (자동 출발 ' + Math.max(0, Math.ceil(4.5 - a.gt)) + ')');
        else if (a.ph === 'inrun') hint(g, a.x < -14 ? '{D} 누른 채 웅크리기 = 가속!' : '도약대 끝에서 {A} 점프!');
        else if (a.ph === 'fly' && !a.crash) hint(g, a.y - SKI.hill(a.x) < 5 && a.lt > 1.2 && a.tel === 0 && a.jt ? '지금 {A} 텔레마크 착지!' : '{L}{R} 균형 유지 (V자 자세)');
      }
    }
    // judges panel
    if (a.judges && (a.ph === 'land' && a.lt > 1.0 || s.ph === 'post')) {
      const sorted = a.judges.slice().sort((p, q) => p - q);
      const lo = a.judges.indexOf(sorted[0]), hi = a.judges.lastIndexOf(sorted[4]);
      const x0 = 120, y0 = 196;
      g.panel(x0, y0, 240, 44, { title: '심판 점수' });
      for (let k = 0; k < 5; k++) {
        const out = k === lo || k === hi;
        const bx = x0 + 8 + k * 46;
        g.rect(bx, y0 + 9, 40, 16, out ? PAL.slate : PAL.navy);
        g.text(a.judges[k].toFixed(1), bx + 20, y0 + 11, out ? PAL.grey : PAL.white, { size: 'm', align: 'center' });
        if (out) g.rect(bx + 4, y0 + 17, 32, 1, PAL.grey);
      }
      g.text('거리 ' + a.dpts.toFixed(1) + ' + 자세 ' + a.sty.toFixed(1) + ' = ' + a.pts.toFixed(1) + '점', x0 + 120, y0 + 29, PAL.yellow, { size: 's', align: 'center' });
    }
    if (a.ph === 'land' && a.lt > 0.3) g.text(a.dist.toFixed(1) + 'm', 240, 52, a.crash ? PAL.red : PAL.yellow, { size: 'xl', align: 'center', outline: PAL.black });
  }

  /* =========================================================== ENGINE === */
  OG.defineEngine('field', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) { return initState(ev, ents, opts, R); },
    update(s, inputs, dt, R) { tick(s, inputs, dt, R); },
    draw(g, s) {
      const K = KD[s.kind];
      K.draw(g, s);
      overlay(g, s);
    }
  });

  const SUMMER = ['summer', 'asian'];
  OG.defineEvents([
    { id: 'longjump', name: '멀리뛰기', en: 'Long Jump', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'jump', run: 34, pit0: 1.0, dmax: 8.95, cpuA: 6.45, cpuB: 2.2, wr: 8.95 },
      help: ['{L}{R} 번갈아 연타: 도움닫기', '발구름판 직전 {A}: 발구름 (넘으면 파울)', '{A} 누르고 있다 떼기: 각도 (20~25°가 최적)'] },
    { id: 'triplejump', name: '세단뛰기', en: 'Triple Jump', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'jump', tri: true, run: 32, pit0: 11, cpuA: 14.1, cpuB: 3.5, wr: 18.29 },
      help: ['{L}{R} 번갈아 연타: 도움닫기', '발구름판 직전 {A}: 홉', '착지 순간마다 {A}: 스텝 → 점프 (링이 초록일 때)'] },
    { id: 'highjump', name: '높이뛰기', en: 'High Jump', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'height', run: 16, vmax: 7.6, mark: -1.05, balk: -0.25, camJ: -9.5, capA: 1.98, capB: 0.42, noise: 0.03, wr: 2.45,
        hs: [[2.15, 2.20, 2.25, 2.29, 2.33, 2.37], [2.18, 2.25, 2.31, 2.36], [2.20, 2.29, 2.35]] },
      help: ['{L}{R} 번갈아 연타: 도움닫기', 'X 마크에서 {A}: 발구름 (누른 채 유지 = 아치)', '엉덩이가 바를 넘을 때 {A} 떼기: 다리 킥'] },
    { id: 'polevault', name: '장대높이뛰기', en: 'Pole Vault', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'height', pv: true, run: 36, vmax: 9.5, mark: -4.0, balk: -2.4, barX: 0.6, camJ: -11.5, capA: 5.12, capB: 0.95, noise: 0.07, wr: 6.26,
        hs: [[5.50, 5.65, 5.75, 5.85, 5.95, 6.05], [5.55, 5.72, 5.87, 6.00], [5.60, 5.80, 5.97]] },
      help: ['{L}{R} 번갈아 연타: 도움닫기', '마크에서 {A}: 장대 꽂기 (박스 타이밍)', '장대가 수직일 때 {A}: 푸시 오프'] },
    { id: 'javelin', name: '창던지기', en: 'Javelin Throw', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'jav', run: 30, vmax: 8.4, dmax: 97, ideal: 35, cpuA: 70, cpuB: 22, wr: 98.48 },
      help: ['{L}{R} 번갈아 연타: 도움닫기', '라인 전에 {A} 누르기 시작 (넘으면 파울)', '{A} 누른 채 각도 올리고 35°에서 떼기'] },
    { id: 'shotput', name: '포환던지기', en: 'Shot Put', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'shot', dmax: 23.4, ideal: 40, cpuA: 17.6, cpuB: 4.5, wr: 23.56 },
      help: ['{L}{R} 번갈아 연타: 파워 모으기', '{A}: 글라이드 시작 (누른 채 각도 올리기)', '40° 근처에서 {A} 떼기: 투척'] },
    { id: 'discus', name: '원반던지기', en: 'Discus Throw', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'spin', rc: 1.25, dmax: 74, cpuA: 58, cpuB: 13, wr: 74.35 },
      help: ['{L}{R} 번갈아 연타: 회전 가속', '원반이 초록 구간을 지날 때 {A}: 릴리스', '섹터 밖으로 날아가면 파울'] },
    { id: 'hammer', name: '해머던지기', en: 'Hammer Throw', sport: 'athletics', icon: '🏃', tags: SUMMER, engine: 'field',
      cfg: { kind: 'spin', ham: true, rc: 1.0675, dmax: 86, cpuA: 70, cpuB: 12, wr: 86.74 },
      help: ['해머가 오른쪽일 때 {R}, 왼쪽일 때 {L} (리듬 3회전)', '타이밍이 좋을수록 가속', '초록 구간에서 {A}: 릴리스'] },
    { id: 'skijump', name: '스키점프 라지힐', en: 'Ski Jumping Large Hill', sport: 'ski_jumping', icon: '🎿', tags: ['winter'], engine: 'field',
      cfg: { kind: 'ski' },
      help: ['{D} 누른 채 웅크리기: 인런 가속', '도약대 끝에서 {A}: 점프 / 비행 중 {L}{R}: 균형', '착지 직전 {A}: 텔레마크 (자세 점수 UP)'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
