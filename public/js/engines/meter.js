/* =========================================================================
 * engine: meter — 파워/타이밍 미터 종목 (turn-based solo)
 *   kinds: lift  역도 인상 / 용상 (front view)
 *          golf  골프 파4 한 홀 (top-down, 3-click swing meter, putting)
 *          curl  컬링 드로우 챌린지 (top-down, power meter + sweeping)
 *          bask  농구 3점슛 콘테스트 (side view, jump-release timing)
 * Humans take turns (banner "P2 차례"); CPU results are simulated from
 * ent.skill and revealed round by round on a live leaderboard.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI, TAU = PI * 2;
  const BLANK = OG.blankInput();
  const IDLE = 8.5;                       // s without input → attempt auto-fails
  const r1 = v => Math.round(v * 10) / 10;
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
  // 0..1 from mashing: ~10 alternating presses/s → 1
  function runSpd(a, i, dt, k, c) {
    const n = mash(a, i);
    a.spd = r3(M.clamp(a.spd + n * (k || 0.14) - a.spd * (c || 1.4) * dt, 0, 1));
    return n;
  }
  function idleTick(a, i, dt) {
    if (active(i)) a.idle = 0; else a.idle = r3(a.idle + dt);
    return a.idle > IDLE;
  }

  /* ------------------------------------------------------- framework -- */
  const KD = {};
  const cfgOf = s => OG.EVENT_MAP[s.evId].cfg;
  const pcol = e => e.h ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.lightgrey;
  const lab = e => e.h ? e.tag : e.c;
  const lookE = e => OG.lookOf({ country: e.c, look: e.lk });
  const attemptsFor = nh => nh <= 2 ? 3 : nh <= 4 ? 2 : 1;
  const better = (s, x, y) => s.lb ? x < y : x > y;

  function pop(s, txt, c, x, y, sz, dur) {
    s.pops.push({ s: txt, c: c || PAL.yellow, x: Math.round(x == null ? 240 : x), y: Math.round(y == null ? 64 : y), z: sz || 'l', t: 0, d: dur || 1.1 });
    if (s.pops.length > 5) s.pops.shift();
  }
  // particle in world coords. g = gravity, y up (side views) / 0 for top-down
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
      evId: ev.id, kind: cfg.kind, mode: K.mode || 'best', lb: !!ev.lowerBetter, t: -3, done: false,
      ph: 'cd', pt: 0, nh, hum,
      E: ents.map(e => ({ c: e.country, h: !!e.human, pid: e.human ? e.pid : -1, tag: e.tag || '', lk: e.look | 0 })),
      rounds: K.rounds ? K.rounds(nh) : attemptsFor(nh), rnd: 0, q: hum.slice(), qi: 0, cur: nh ? hum[0] : -1,
      P: ents.map(() => ({ v: [], best: -1, tot: 0 })),
      pre: ents.map(() => null),
      pops: [], parts: [], a: null, last: null, rec: false
    };
    if (K.setup) K.setup(s, R);
    ents.forEach((e, i) => { if (!e.human) s.pre[i] = K.cpu(s, e, R); });
    if (nh) s.a = K.start(s, R);
    return s;
  }
  function hasRes(s, i) { return s.P[i].v.some(v => v != null); }
  function recalc(s, i) {
    const P = s.P[i];
    if (s.mode === 'sum') { P.tot = r3(P.v.reduce((t, v) => t + Math.max(0, v || 0), 0)); P.best = P.tot; return; }
    P.best = P.v.reduce((b, v) => (v != null && v > b ? v : b), -1);
  }
  function revealRound(s, r) {
    s.E.forEach((e, i) => { if (!e.h && s.pre[i] && r < s.pre[i].length) { s.P[i].v[r] = s.pre[i][r]; recalc(s, i); } });
  }
  function startQueue(s) { s.q = s.hum.slice(); s.qi = 0; }
  function beginTurn(s, R) {
    s.cur = s.q[s.qi];
    s.ph = 'ban'; s.pt = 0;
    s.parts = []; s.pops = [];
    s.a = KD[s.kind].start(s, R);
  }
  function beginEvent(s, R) {
    if (!s.nh) {
      for (let r = 0; r < s.rounds; r++) revealRound(s, r);
      s.ph = 'end'; s.pt = 0; return;
    }
    revealRound(s, 0);
    startQueue(s);
    beginTurn(s, R);
  }
  function finish(s) { s.ph = 'end'; s.pt = 0; }
  function advance(s, R) {
    s.qi++;
    if (s.qi < s.q.length) return beginTurn(s, R);
    s.rnd++;
    if (s.rnd < s.rounds) { revealRound(s, s.rnd); startQueue(s); return beginTurn(s, R); }
    finish(s);
  }
  // best value among other entrants with a valid result (null if none)
  function leaderVal(s, exclude) {
    let b = null;
    s.P.forEach((P, i) => {
      if (i === exclude || !hasRes(s, i)) return;
      if (s.mode !== 'sum' && P.best < 0) return;
      if (b == null || better(s, P.best, b)) b = P.best;
    });
    return b;
  }
  function toPost(s) {
    const a = s.a, res = a.res, P = s.P[s.cur], K = KD[s.kind], c = cfgOf(s);
    const prevBest = P.best, had = hasRes(s, s.cur), lead = leaderVal(s, s.cur);
    P.v[s.rnd] = res.v; recalc(s, s.cur);
    if (K.after) K.after(s, res);
    const L = { txt: res.txt, sub: res.sub || '', c: res.bad ? PAL.red : PAL.yellow, tag: res.tag || '' };
    const lastRound = s.rnd === s.rounds - 1;
    if (!res.bad && c.wr && s.mode === 'best' && res.v > c.wr) { L.tag = '세계신기록!'; OG.sfx(s, 'record'); s.rec = true; }
    else if (!res.bad && (lead == null || better(s, P.best, lead)) && (s.mode === 'sum' ? lastRound || s.rounds === 1 : !had || better(s, P.best, prevBest))) { L.tag = L.tag || '선두!'; OG.sfx(s, 'cheer'); }
    else if (!res.bad && s.mode === 'best' && had && prevBest > 0 && P.best > prevBest) { L.tag = L.tag || '개인 최고!'; OG.sfx(s, 'good'); }
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
      if (s.mode === 'sum') { has = hasRes(s, i); sc = P.tot; txt = has ? K.fmt(P.tot) : '-'; }
      else { has = P.best >= 0; sc = P.best; txt = has ? K.fmt(P.best) : (P.v.length ? 'NM' : '-'); }
      return { i, has, sc, txt };
    });
    rows.sort((x, y) => (y.has - x.has) || (s.lb ? x.sc - y.sc : y.sc - x.sc) || (x.i - y.i));
    return rows;
  }
  function results(s) {
    const K = KD[s.kind];
    const rows = s.E.map((e, idx) => {
      const P = s.P[idx];
      if (s.mode === 'sum') return { idx, score: r3(P.tot), text: K.fmt(P.tot) };
      if (P.best < 0) return { idx, score: 0, text: 'NM', dnf: true };
      return { idx, score: P.best, text: K.fmt(P.best) };
    });
    return OG.sortResults(rows, s.lb);
  }

  function tick(s, inputs, dt, R) {
    if (s.done) return;
    const prevT = s.t;
    s.t = r3(s.t + dt); s.pt = r3(s.pt + dt);
    fxTick(s, dt);
    const K = KD[s.kind];
    const e = s.cur >= 0 ? s.E[s.cur] : null;
    const i = (e && e.h && inputs && inputs[e.pid]) || BLANK;
    if (K.tick) K.tick(s, dt);
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
        if (K.post) K.post(s, dt, R);
        if (s.pt > 2.6 || (s.pt > 0.9 && i.ap)) advance(s, R);
        break;
      case 'end':
        if (K.post) K.post(s, dt, R);
        if (s.pt > 1.8) { s.results = results(s); s.done = true; }
        break;
    }
  }

  /* -------------------------------------------------------------- HUD -- */
  function attemptLabel(s) {
    const K = KD[s.kind];
    if (K.label) return K.label(s);
    return (s.rounds > 1 ? (s.rnd + 1) + '/' + s.rounds : '1/1') + '차 시기';
  }
  function hudTop(g, s) {
    const ev = OG.EVENT_MAP[s.evId];
    g.rect(0, 0, 480, 15, 'rgba(24,20,37,0.92)');
    g.rect(0, 15, 480, 1, 'rgba(0,0,0,0.35)');
    g.text(ev.name, 5, 3, PAL.gold, { size: 's' });
    if (s.cur >= 0 && s.ph !== 'cd' && s.ph !== 'end') {
      const e = s.E[s.cur];
      const nameW = g.textW(ev.name, 's');
      const x = Math.max(96, 14 + nameW);
      g.flag(e.c, x, 4, 12, 8);
      g.text(e.tag, x + 16, 3, pcol(e), { size: 's' });
      g.text(OG.countryName(e.c), x + 18 + g.textW(e.tag, 's'), 3, PAL.white, { size: 's', maxW: 64 });
      g.text(attemptLabel(s), x + 100, 3, PAL.lightgrey, { size: 's', maxW: 120 });
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
    g.panel(x, y, 146, h, { title: '순위' });
    st.forEach((r, k) => {
      const e = s.E[r.i], yy = y + 8 + k * 10;
      if (r.i === hl) g.rect(x + 2, yy - 1, 142, 10, 'rgba(254,231,97,0.18)');
      g.text(r.has ? String(k + 1) : '-', x + 10, yy, r.has && k < 3 ? [PAL.medalGold, PAL.medalSilver, PAL.medalBronze][k] : PAL.grey, { size: 'xs', align: 'center' });
      g.flag(e.c, x + 17, yy, 12, 8);
      g.text(lab(e), x + 33, yy, e.h ? pcol(e) : PAL.lightgrey, { size: 'xs' });
      g.text(r.txt, x + 140, yy, PAL.white, { size: 'xs', align: 'right' });
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
      g.text(attemptLabel(s), ox + 306, 118, PAL.yellow, { size: 's', align: 'right', maxW: 120 });
      board(g, s, 328, 24, s.cur);
      if (s.pt > 0.45 && Math.floor(s.pt * 3) % 2 === 0) g.rich('{A} 시작', 160, 146, PAL.white, { align: 'center' });
    } else if (s.ph === 'post' && s.last) {
      const L = s.last;
      const sc = Math.min(1, s.pt / 0.2);
      g.rect(0, 30, 320, 46 + (L.tag ? 14 : 0), 'rgba(24,20,37,0.6)');
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
  // generic meter widgets
  function vMeter(g, x, y, w, h, frac, zlo, zhi, label) {
    g.rect(x - 1, y - 1, w + 2, h + 2, PAL.black);
    g.rect(x, y, w, h, PAL.navy);
    const Y = f => y + h - Math.round(h * M.clamp(f, 0, 1));
    if (zhi > zlo) {
      g.rect(x, Y(zhi), w, Y(zlo) - Y(zhi), 'rgba(99,199,77,0.55)');
      g.rect(x, Y(zhi), w, 1, PAL.green); g.rect(x, Y(zlo), w, 1, PAL.green);
    }
    const my = Y(frac);
    g.rect(x - 3, my - 1, w + 6, 3, PAL.black);
    g.rect(x - 2, my, w + 4, 1, frac >= zlo && frac <= zhi ? PAL.yellow : PAL.white);
    if (label) g.text(label, x + w / 2, y + h + 3, PAL.lightgrey, { size: 'xs', align: 'center' });
  }

  /* ============================================================ LIFT === */
  // plate set (kg): colour, height px, thickness px
  const PLATES = [[25, '#e43b44', 48, 7], [20, '#1f6fd6', 48, 6], [15, '#fee761', 48, 5], [10, '#63c74d', 48, 4], [5, '#f4f4f4', 34, 3],
    [2.5, '#e43b44', 24, 3], [2, '#1f6fd6', 22, 2], [1.5, '#fee761', 20, 2], [1, '#63c74d', 18, 2], [0.5, '#f4f4f4', 16, 2]];
  function plateSide(w) {
    let side = Math.max(0, (w - 25) / 2);
    const out = [];
    for (const p of PLATES) { while (side >= p[0] - 1e-6 && out.length < 12) { out.push(p); side -= p[0]; } }
    return out;
  }
  const LIFT_FY = 214;
  KD.lift = {
    mode: 'best',
    fmt: v => Math.round(v) + 'kg',
    label(s) { const c = cfgOf(s); return c.short + ' ' + (s.rnd + 1) + '/' + s.rounds + '차 시기'; },
    setup(s) { s.W = s.E.map(e => e.h ? { nw: cfgOf(s).open, mw: cfgOf(s).open - 20 } : null); },
    cpu(s, e, R) {
      const c = OG.EVENT_MAP[s.evId].cfg;
      const q = OG.cpuQuality({ skill: e.skill }, R, 0.08);
      const cap = c.cpuA + c.cpuB * q;
      let w = Math.round(cap - 6 - R.f() * 4);
      const out = [];
      for (let r = 0; r < s.rounds; r++) {
        const ok = cap + R.gauss() * 2.6 >= w;
        out.push(ok ? w : -1);
        if (ok) w += R.int(2, 4) + (r === 0 ? 1 : 0);
      }
      return out;
    },
    after(s, res) {
      const W = s.W[s.cur];
      if (!W) return;
      if (res.v > 0) { W.mw = res.v + 1; W.nw = res.v + (cfgOf(s).cj ? 4 : 3); }
      else { W.mw = s.a.w; W.nw = s.a.w; }
    },
    start(s, R) {
      const W = s.W[s.cur] || { nw: 150, mw: 100 };
      return { ph: 'pick', w: W.nw, mw: W.mw, t: 0, pt: 0, idle: 0, ml: '', spd: 0, h: 0, hmax: 0, q: 0, b: 0, bv: 0, gst: 0,
        jm: 0, ok: false, why: '', lights: [0, 0, 0], fin: false, res: null, by: 0, bvy: 0, drp: false };
    },
    upd(s, i, dt, R) { liftUpd(s, i, dt, R); },
    post(s, dt) { liftAnim(s, dt); },
    draw(g, s) { drawLift(g, s); }
  };
  function liftReq(s, w) { const c = cfgOf(s); return (w - c.base) / (c.cap - c.base); }
  function liftGo(a, ph) { a.ph = ph; a.pt = 0; }
  function liftDrop(s) {
    const a = s.a, P = liftPose(s);
    a.by = P.bar - (LIFT_FY - 25); a.bvy = 0; a.drp = true;
  }
  function liftFail(s, why) {
    const a = s.a;
    liftDrop(s);
    a.ok = false; a.why = why; liftGo(a, 'drop');
    OG.sfx(s, 'crash');
    pop(s, why, PAL.red, 160, 70, 'b');
  }
  function liftUpd(s, i, dt, R) {
    const a = s.a, c = cfgOf(s);
    a.t = r3(a.t + dt); a.pt = r3(a.pt + dt);
    const req = liftReq(s, a.w);
    switch (a.ph) {
      case 'pick': {
        if (i.up) { a.w = Math.min(c.cap + 15, a.w + 1); OG.sfx(s, 'tick'); a.pt = Math.min(a.pt, 2.5); }
        if (i.dp) { a.w = Math.max(a.mw, a.w - 1); OG.sfx(s, 'tick'); a.pt = Math.min(a.pt, 2.5); }
        if ((i.ap && a.pt > 0.15) || a.pt > 4) { liftGo(a, 'setup'); a.idle = 0; OG.sfx(s, 'confirm'); }
        break;
      }
      case 'setup': {
        if (idleTick(a, i, dt) || a.pt > 12) return liftFail(s, '시간 초과');
        const n = runSpd(a, i, dt);
        if (n > 0) { liftGo(a, 'pull'); OG.sfx(s, 'power'); }
        break;
      }
      case 'pull': {
        if (idleTick(a, i, dt)) return liftFail(s, '시간 초과');
        runSpd(a, i, dt);
        const sur = liftPow(a.spd) - req;
        const rate = sur >= 0 ? 0.12 + 1.15 * sur : -0.3 + 0.6 * sur;
        a.h = r3(M.clamp(a.h + rate * dt, 0, 1.2));
        a.hmax = Math.max(a.hmax, a.h);
        const zc = 0.8, zw = liftZone(req);
        if (i.ap) {
          const d = Math.abs(a.h - zc);
          if (d <= zw / 2) {
            a.q = r2(1 - d / (zw / 2));
            liftGo(a, 'catch'); OG.sfx(s, 'whoosh');
            if (a.q > 0.75) { pop(s, 'PERFECT!', PAL.yellow, 160, 60, 'l'); OG.sfx(s, 'perfect'); }
            else if (a.q > 0.35) pop(s, 'GOOD', PAL.green, 160, 60, 'l');
            else pop(s, 'OK', PAL.white, 160, 60, 'b');
            a.b = r3((R.f() < 0.5 ? -1 : 1) * (0.12 + (1 - a.q) * 0.45)); a.bv = 0;
          } else return liftFail(s, a.h < zc ? '너무 일찍!' : '너무 늦게!');
        } else if (a.h >= 1.15) return liftFail(s, '타이밍 놓침');
        else if (a.pt > 7.5) return liftFail(s, '들지 못함');
        break;
      }
      case 'catch':
        if (a.pt > 0.32) liftGo(a, 'rise');
        break;
      case 'rise': case 'bal2': {
        if (liftBal(s, i, dt, R, req)) return;
        const dur = a.ph === 'rise' ? 1.7 : 1.4;
        if (a.pt > dur) {
          if (c.cj && a.ph === 'rise') { liftGo(a, 'jerk'); a.jm = 0; OG.sfx(s, 'charge'); }
          else { liftGo(a, 'hold'); }
        }
        break;
      }
      case 'jerk': {
        if (idleTick(a, i, dt)) return liftFail(s, '시간 초과');
        a.jm = r3(a.jm + dt);
        const m = jerkMeter(a.jm);
        const zw = jerkZone(req);
        if (i.ap) {
          if (m >= 1 - zw) {
            const q = r2((m - (1 - zw)) / zw);
            a.q = q; liftGo(a, 'jdrive'); OG.sfx(s, 'whoosh');
            if (q > 0.7) { pop(s, 'PERFECT!', PAL.yellow, 160, 60, 'l'); OG.sfx(s, 'perfect'); } else pop(s, 'GOOD', PAL.green, 160, 60, 'l');
            a.b = r3((R.f() < 0.5 ? -1 : 1) * (0.12 + (1 - q) * 0.4)); a.bv = 0;
          } else return liftFail(s, '저크 실패');
        } else if (a.jm > 4.8) return liftFail(s, '저크 실패');
        break;
      }
      case 'jdrive':
        if (a.pt > 0.28) liftGo(a, 'bal2');
        break;
      case 'hold':
        if (a.pt > 0.7) {
          liftGo(a, 'lights'); a.ok = true;
          const red = a.q < 0.25 && R.f() < 0.5 ? R.i(3) : -1;
          a.lights = [0, 1, 2].map(k => k === red ? 2 : 1);
          OG.sfx(s, 'buzzer');
        }
        break;
      case 'drop':
        liftAnim(s, dt);
        if (a.pt > 1.0) { liftGo(a, 'lights'); a.lights = [2, 2, 2]; OG.sfx(s, 'buzzer'); }
        break;
      case 'lights':
        if (a.ok && a.pt > 0.9 && !a.drp) { liftDrop(s); OG.sfx(s, 'land'); }
        liftAnim(s, dt);
        if (a.pt > 0.25 && a.pt - dt <= 0.25 && a.ok) { OG.sfx(s, 'cheer'); pop(s, 'GOOD LIFT!', PAL.white, 160, 52, 'xl', 1.6); }
        if (a.pt > 1.5) {
          a.fin = true;
          a.res = a.ok ? { v: a.w, txt: a.w + 'kg', sub: 'GOOD LIFT · 심판 ' + a.lights.filter(x => x === 1).length + '/3', bad: false }
            : { v: -1, txt: '실패', sub: a.w + 'kg · ' + a.why, bad: true };
        }
        break;
    }
  }
  const liftPow = v => 0.15 + 0.85 * v;
  const liftZone = req => M.clamp(0.26 - 0.15 * req, 0.08, 0.24);
  const jerkZone = req => M.clamp(0.2 - 0.1 * req, 0.07, 0.18);
  // dip&drive meter: 0..1 ping-pong, period 1.3 s
  const jerkMeter = t => 0.5 - 0.5 * Math.cos(t * TAU / 1.3);
  // balance needle; returns true if the bar was lost
  function liftBal(s, i, dt, R, req) {
    const a = s.a;
    a.gst = r3(a.gst + dt);
    let push = 0;
    if (i.l) push -= 2.6; if (i.r) push += 2.6;
    if (i.lp) a.bv -= 0.28; if (i.rp) a.bv += 0.28;
    const inst = 1.6 + 1.8 * M.clamp(req, 0, 1.1);
    a.bv = r3((a.bv + (a.b * inst + push + R.gauss() * (0.6 + 0.9 * req)) * dt) * (1 - 1.6 * dt));
    a.b = r3(a.b + a.bv * dt);
    if (Math.abs(a.b) >= 1) { liftFail(s, '균형 잃음'); return true; }
    return false;
  }
  // bar falling after a fail / bar drop after the lights
  function liftAnim(s, dt) {
    const a = s.a;
    if (!a || !a.drp) return;
    if (a.by >= 0 && a.bvy === 0) return;
    a.bvy = r2(a.bvy + 900 * dt);
    a.by = r2(a.by + a.bvy * dt);
    if (a.by >= 0) {
      a.by = 0;
      if (a.bvy > 140) { a.bvy = r2(-a.bvy * 0.3); OG.sfx(s, 'land'); for (let k = 0; k < 6; k++) part(s, (k - 2.5) * 0.9, 0.2, (k - 2.5) * 0.8, 1 + (k % 3) * 0.6, '#f4f0e6', 0.6, 9.8, 1); }
      else a.bvy = 0;
    }
  }
  // pose model for the front lifter (all px). returns {d, lean, heel, bar, arms, grip, sway}
  function liftPose(s) {
    const a = s.a, c = cfgOf(s);
    const grip = c.cj ? 19 : 31;
    const P = { d: 0, lean: 0, heel: 0, bar: 0, arms: 'down', grip, sway: 0, tilt: 0, dropped: false };
    const floorBar = LIFT_FY - 25;
    const body = (d, lean, heel) => { P.d = d; P.lean = lean; P.heel = heel; };
    if (!a) { body(0, 0, 0); P.bar = floorBar; P.dropped = true; return P; }
    const ph = a.ph;
    if (a.drp) {
      P.dropped = true; P.bar = Math.round(floorBar + a.by);
      if (a.ok) { body(0, 0, 0); P.arms = 'cheer'; } else { body(0.12, 0.2, 0); P.arms = 'sad'; }
      return P;
    }
    if (ph === 'pick' || ph === 'setup') { body(0.82, 1, 0); P.bar = floorBar; return P; }
    if (ph === 'pull') {
      const h = a.h;
      body(M.lerp(0.82, 0, M.clamp(h / 0.55, 0, 1)), M.lerp(1, 0, M.clamp(h / 0.5, 0, 1)), h > 0.55 ? Math.min(6, (h - 0.55) * 22) : 0);
      P.bar = Math.round(h < 0.55 ? M.lerp(floorBar, LIFT_FY - 54, M.ease(h / 0.55)) : M.lerp(LIFT_FY - 54, LIFT_FY - 84, M.clamp((h - 0.55) / 0.55, 0, 1)));
      return P;
    }
    const shY = d => LIFT_FY - (46 - 24 * d) - (32 - 0) + 0;
    const overhead = d => shY(d) - 35;
    const rack = d => shY(d) + 3;
    if (ph === 'catch') {
      const k = M.clamp(a.pt / 0.32, 0, 1);
      body(M.lerp(0.1, 1, k), 0.1, 0);
      P.arms = c.cj ? 'rack' : 'up';
      P.bar = c.cj ? Math.round(M.lerp(LIFT_FY - 70, rack(P.d), M.easeOut(k))) : Math.round(M.lerp(LIFT_FY - 70, overhead(P.d), M.easeOut(k)));
      P.sway = Math.round(a.b * 4); P.tilt = Math.round(a.b * 10);
      return P;
    }
    if (ph === 'rise') {
      const k = M.ease(M.clamp(a.pt / 1.5, 0, 1));
      body(M.lerp(1, 0, k), 0.1 * (1 - k), 0);
      P.arms = c.cj ? 'rack' : 'up';
      P.bar = c.cj ? rack(P.d) : overhead(P.d);
      P.sway = Math.round(a.b * 4); P.tilt = Math.round(a.b * 10);
      return P;
    }
    if (ph === 'jerk') {
      const m = jerkMeter(a.jm);
      body(0.28 * m, 0, 0); P.arms = 'rack'; P.bar = rack(P.d);
      return P;
    }
    if (ph === 'jdrive') {
      const k = M.clamp(a.pt / 0.28, 0, 1);
      body(M.lerp(0.28, 0.38, k), 0, 0); P.arms = k > 0.4 ? 'up' : 'rack'; P.split = k;
      P.bar = Math.round(M.lerp(rack(0.28), overhead(P.d), M.easeOut(k)));
      return P;
    }
    if (ph === 'bal2') {
      const k = M.ease(M.clamp(a.pt / 1.2, 0, 1));
      body(M.lerp(0.38, 0, k), 0, 0); P.arms = 'up'; P.split = 1 - k; P.bar = overhead(P.d);
      P.sway = Math.round(a.b * 4); P.tilt = Math.round(a.b * 10);
      return P;
    }
    body(0, 0, 0); P.arms = 'up'; P.bar = overhead(0);
    return P;
  }
  function drawBar(g, cx, y, w, tilt, bend) {
    const L = 108, sl = 66;
    const yAt = x => y + Math.round(tilt * (x / L)) + Math.round(bend * Math.pow(Math.abs(x) / L, 2));
    // shaft
    for (let x = -L; x <= L; x += 2) { const yy = yAt(x); g.rect(cx + x, yy - 1, 2, 3, Math.abs(x) > sl - 4 ? '#c0cbdc' : '#9aa5b8'); g.rect(cx + x, yy - 1, 2, 1, '#e8eef6'); }
    // knurl marks
    for (const x of [-30, 30]) g.rect(cx + x, yAt(x) - 1, 1, 3, '#6b778f');
    const plates = plateSide(w);
    [-1, 1].forEach(sd => {
      let px = sl;
      // inner collar (sleeve stop)
      g.rect(cx + sd * (sl - 3) - (sd < 0 ? 3 : 0), yAt(sd * sl) - 6, 3, 12, '#8b9bb4');
      for (const p of plates) {
        const th = p[3], hh = p[2];
        const x0 = sd > 0 ? cx + px : cx - px - th;
        const yy = yAt(sd * (px + th / 2));
        g.rect(x0, yy - hh / 2 + 1, th, hh - 2, OG.shade(p[1], -0.35));
        g.rect(x0 + 1, yy - hh / 2, th - 2, hh, OG.shade(p[1], -0.35));
        g.rect(x0 + (sd > 0 ? 0 : 1), yy - hh / 2 + 2, th - 1, hh - 4, p[1]);
        g.rect(x0 + (sd > 0 ? 0 : 1), yy - hh / 2 + 3, 1, hh - 6, OG.shade(p[1], 0.35));
        if (hh > 40) g.rect(x0 + (sd > 0 ? 0 : 1), yy - 3, th - 1, 6, OG.shade(p[1], -0.15));
        px += th;
      }
      // collar
      const x0 = sd > 0 ? cx + px : cx - px - 4;
      const yy = yAt(sd * (px + 2));
      g.rect(x0, yy - 5, 4, 10, '#5a6988'); g.rect(x0 + 1, yy - 5, 2, 10, '#c0cbdc');
    });
  }
  // custom symmetric front-view lifter
  function frontLifter(g, cx, fy, P, look, t) {
    const skin = look.skin, suit = look.shirt, suit2 = OG.shade(look.shirt, -0.3), shoe = '#262b44';
    const d = P.d, heel = P.heel, sw = P.sway || 0;
    const split = P.split || 0;
    const hipY = Math.round(fy - (46 - 24 * d) - heel - split * 4);
    const shY = Math.round(hipY - (32 - 11 * P.lean));
    const hx = cx + sw;
    // legs
    [-1, 1].forEach(sd => {
      const fx = cx + sd * (13 + d * 3) + (split ? sd * split * 2 : 0);
      const fyy = fy - (split && sd < 0 ? Math.round(split * 3) : 0);
      const kx = cx + sd * (12 + 10 * d) + sw * 0.5, ky = Math.round(fy - 22 + 7 * d - heel * 0.6 - split * (sd < 0 ? 6 : 0));
      const hpx = hx + sd * 7;
      g.line(hpx, hipY, kx, ky, skin, 6);
      g.line(hpx, hipY, M.lerp(hpx, kx, 0.35), M.lerp(hipY, ky, 0.35), suit, 7);
      g.rect(kx - 3, ky - 3, 6, 6, '#3a4466'); // knee sleeve
      g.line(kx, ky, fx, fyy - 3 - heel, skin, 5);
      g.rect(fx - 4 + (sd > 0 ? 1 : -1), fyy - 4 - heel, 8, 4, shoe);
      g.rect(fx - 4 + (sd > 0 ? 1 : -1), fyy - 1, 8, 1, '#c0cbdc');
    });
    // torso (singlet)
    const tw = 15, ww = 10;
    g.poly([hx - tw, shY, hx + tw, shY, hx + ww + 1, hipY - 6, hx + 11, hipY + 4, hx - 11, hipY + 4, hx - ww - 1, hipY - 6], suit);
    g.poly([hx - 7, shY, hx + 7, shY, hx, shY + 7], skin);
    g.rect(hx - tw + 2, shY, 4, 3, skin); g.rect(hx + tw - 6, shY, 4, 3, skin);
    g.rect(hx - 1, shY + 8, 2, hipY - shY - 14, suit2);
    g.rect(hx - 11, hipY - 9, 22, 5, '#3e2731'); g.rect(hx - 3, hipY - 9, 6, 5, '#c0cbdc'); // belt
    // head
    const headY = shY - 10 + Math.round(5 * P.lean);
    g.rect(hx - 2, shY - 5, 5, 5, skin);
    g.circle(hx, headY, 6.5, skin);
    for (let yy = -7; yy <= -1; yy++) { const ww2 = Math.round(Math.sqrt(Math.max(0, 42 - yy * yy))); g.rect(hx - ww2, headY + yy, ww2 * 2 + 1, 1, look.hair); }
    g.rect(hx - 3, headY + 1, 2, 2, '#181425'); g.rect(hx + 2, headY + 1, 2, 2, '#181425');
    if (P.arms === 'up' || P.arms === 'cheer') g.rect(hx - 2, headY + 4, 5, 1, '#8d3b3b');
    // arms
    const shL = [hx - tw + 1, shY + 2], shR = [hx + tw - 1, shY + 2];
    const arm = (sh, sd) => {
      let hd, el;
      if (P.arms === 'rack') { hd = [hx + sd * 16, P.bar - 1]; el = [hx + sd * 21, shY + 13]; }
      else if (P.arms === 'cheer') { hd = [hx + sd * 26, shY - 30 + Math.round(Math.sin(t * 8 + sd) * 2)]; el = [hx + sd * 24, shY - 12]; }
      else if (P.arms === 'sad') { hd = [hx + sd * 12, hipY + 2]; el = [hx + sd * 16, shY + 14]; }
      else {
        hd = [cx + sd * P.grip, P.bar];
        const mx = (sh[0] + hd[0]) / 2, my = (sh[1] + hd[1]) / 2;
        const up = hd[1] < sh[1];
        el = [mx + sd * (up ? 3 : 4), my + (up ? 0 : (hd[1] < hipY ? -4 : 0))];
      }
      g.line(sh[0], sh[1], el[0], el[1], skin, 5);
      g.line(el[0], el[1], hd[0], hd[1], skin, 4);
      g.circle(hd[0], hd[1], 2.5, OG.shade(skin, -0.1));
    };
    arm(shL, -1); arm(shR, 1);
    g.rect(shL[0] - 2, shY - 1, 5, 4, suit); g.rect(shR[0] - 2, shY - 1, 5, 4, suit);
    return { hipY, shY, headY };
  }
  function judgeLights(g, x, y, L, t) {
    g.rect(x - 2, y - 2, 52, 20, '#0d0b14');
    g.rect(x - 2, y - 2, 52, 1, '#3a4466');
    for (let k = 0; k < 3; k++) {
      const v = L[k], cx = x + 8 + k * 16, cy = y + 8;
      g.circle(cx, cy, 6, '#262b44');
      if (v) {
        const c = v === 1 ? '#ffffff' : PAL.red;
        g.alpha(0.35); g.circle(cx, cy, 9, c); g.alpha(1);
        g.circle(cx, cy, 5, c); g.px(cx - 2, cy - 2, v === 1 ? '#ffffff' : '#ffb0b0');
      } else g.circle(cx, cy, 5, '#3a4466');
    }
  }
  function drawLift(g, s) {
    const a = s.a, c = cfgOf(s), t = g.t;
    const FY = LIFT_FY, CX = 222;
    // arena
    g.rect(0, 0, 480, 270, '#0f0d1a');
    g.grad(0, 16, 480, 60, '#1b1830', '#0f0d1a', 4);
    // crowd tiers in the dark
    g.crowd(0, 40, 480, 70, t, { seed: 21, density: 0.75, bg: '#14111f', colors: ['#3a4466', '#262b44', '#5a6988', '#3e2731', '#2b3150', '#68386c', '#124e89', '#733e39'], excite: a && (a.ph === 'lights' && a.ok) ? 0.6 : 0.05 });
    g.rect(0, 108, 480, 4, '#2b2440');
    // big LED screen
    g.rect(150, 18, 180, 30, '#05040a'); g.rect(151, 19, 178, 28, '#141a33');
    if (s.cur >= 0) {
      const e = s.E[s.cur];
      g.flag(e.c, 158, 25, 24, 16);
      g.text(e.tag + ' ' + OG.countryName(e.c), 188, 23, pcol(e), { size: 's', maxW: 90 });
      g.text(c.short + ' ' + (s.rnd + 1) + '차 시기', 188, 34, PAL.lightgrey, { size: 'xs' });
      if (a) g.text(a.w + ' kg', 322, 25, PAL.yellow, { size: 'l', align: 'right' });
    }
    // back curtain + spot cones
    g.rect(0, 112, 480, 90, '#1a1528');
    for (let x = 0; x < 480; x += 12) g.rect(x, 112, 6, 90, '#1e1830');
    g.text('WEIGHTLIFTING · DOT GAMES 2026', 240, 120, '#3d3459', { size: 's', align: 'center' });
    g.alpha(0.09);
    g.poly([CX - 30, 16, CX + 30, 16, CX + 120, FY + 10, CX - 120, FY + 10], '#fff6c8');
    g.alpha(0.06);
    g.poly([CX - 12, 16, CX + 12, 16, CX + 70, FY + 10, CX - 70, FY + 10], '#ffffff');
    g.alpha(1);
    // platform (perspective)
    g.rect(0, 202, 480, 68, '#16121f');
    g.poly([CX - 150, 200, CX + 150, 200, CX + 170, 226, CX - 170, 226], '#6b4a2e');
    g.poly([CX - 92, 200, CX + 92, 200, CX + 104, 226, CX - 104, 226], '#c08a52');
    for (let k = 0; k < 6; k++) { const y = 203 + k * 4; const w0 = 92 + (y - 200) * 0.46; g.rect(CX - w0, y, w0 * 2, 1, '#a8743f'); }
    g.rect(CX - 170, 226, 340, 8, '#3d2a1a'); g.rect(CX - 170, 226, 340, 1, '#8a6038');
    // spotlight pool
    g.alpha(0.12); g.ellipse(CX, FY + 2, 70, 9, '#fff6c8'); g.alpha(1);
    // judges' table & lights
    g.rect(404, 168, 66, 60, '#262b44'); g.rect(404, 168, 66, 3, '#5a6988');
    g.text('JUDGES', 437, 214, '#5a6988', { size: 'xs', align: 'center' });
    judgeLights(g, 413, 180, a ? a.lights : [0, 0, 0], t);
    // attempt clock
    g.rect(20, 160, 64, 30, '#05040a'); g.rect(21, 161, 62, 28, '#140d0d');
    const clk = a && (a.ph === 'setup' || a.ph === 'pull' || a.ph === 'jerk') ? Math.max(0, 60 - Math.floor(a.t)) : 60;
    g.text(clk >= 60 ? '1:00' : '0:' + (clk < 10 ? '0' : '') + clk, 52, 166, clk <= 10 ? PAL.red : '#ff5a3c', { size: 'l', align: 'center' });
    g.text('ATTEMPT', 52, 192, '#5a6988', { size: 'xs', align: 'center' });
    if (!a) return;
    // lifter + bar
    const e = s.E[s.cur], look = lookE(e);
    const P = liftPose(s);
    g.shadow(CX, FY + 1, 26);
    const barBehind = P.arms === 'down' && P.d > 0.5;
    const bend = P.arms === 'up' ? Math.min(5, Math.round(a.w / 45)) : P.dropped ? 0 : 2;
    if (barBehind) drawBar(g, CX, P.bar, a.w, P.tilt, bend);
    const J = frontLifter(g, CX, FY, P, look, t);
    if (!barBehind) drawBar(g, CX, P.bar, a.w, P.tilt, bend);
    if (P.arms === 'down' && !P.dropped) { // hands over the bar
      g.circle(CX - P.grip, P.bar, 2.5, OG.shade(look.skin, -0.1)); g.circle(CX + P.grip, P.bar, 2.5, OG.shade(look.skin, -0.1));
    }
    g.text(e.tag, CX, Math.min(J.headY - 20, P.arms === 'up' ? P.bar - 34 : 999), pcol(e), { size: 'xs', align: 'center', outline: PAL.black });
    // chalk dust
    drawParts(g, s, (x, y) => [CX + Math.round(x * 20), FY - Math.round(y * 20)]);
    // phase UI
    if (s.ph === 'play' || s.ph === 'ban') {
      const req = liftReq(s, a.w);
      if (a.ph === 'pick' && s.ph === 'play') {
        g.panel(140, 66, 200, 70, { title: '다음 시기 무게' });
        g.text(a.w + ' kg', 240, 78, PAL.yellow, { size: 'xl', align: 'center', outline: PAL.black });
        const diff = req < 0.55 ? ['쉬움', PAL.green] : req < 0.8 ? ['보통', PAL.yellow] : req < 0.97 ? ['어려움', PAL.orange] : ['한계', PAL.red];
        g.text('난이도 ' + diff[0], 240, 105, diff[1], { size: 's', align: 'center' });
        g.rich('{U}{D} 무게  {A} 확정', 240, 119, PAL.white, { align: 'center' });
      }
      if (a.ph === 'setup' || a.ph === 'pull') {
        vMeter(g, 356, 76, 12, 112, a.h / 1.15, (0.8 - liftZone(req) / 2) / 1.15, (0.8 + liftZone(req) / 2) / 1.15, 'PULL');
        g.vbar(376, 128, 7, 60, a.ph === 'pull' ? liftPow(a.spd) : 0, liftPow(a.spd) >= req ? PAL.green : PAL.orange);
        g.rect(374, 187 - Math.round(58 * M.clamp(req, 0, 1)), 11, 1, PAL.white);
        g.text('힘', 380, 191, PAL.lightgrey, { size: 'xs', align: 'center' });
      }
      if (a.ph === 'jerk') vMeter(g, 356, 76, 12, 112, jerkMeter(a.jm), 1 - jerkZone(req), 1, 'DRIVE');
      if (a.ph === 'rise' || a.ph === 'bal2' || a.ph === 'catch' || a.ph === 'jdrive') {
        const bx = 152, bw = 140, by = 238;
        g.rect(bx - 1, by - 1, bw + 2, 8, PAL.black);
        g.rect(bx, by, bw, 6, '#a22633');
        g.rect(bx + bw * 0.2, by, bw * 0.6, 6, '#be7a2f');
        g.rect(bx + bw * 0.38, by, bw * 0.24, 6, PAL.green);
        const nx = bx + bw / 2 + Math.round(M.clamp(a.b, -1, 1) * bw / 2);
        g.poly([nx - 3, by - 4, nx + 3, by - 4, nx, by + 1], PAL.white); g.rect(nx, by, 1, 6, PAL.white);
        g.text('균형', bx - 6, by - 1, PAL.lightgrey, { size: 'xs', align: 'right' });
      }
      if (s.ph === 'play') {
        if (a.ph === 'setup') hint(g, '{L}{R} 번갈아 연타로 당기기!');
        else if (a.ph === 'pull') hint(g, liftPow(a.spd) < req ? '더 빨리 {L}{R} 연타!' : '바가 초록 구간에 오면 {A}!');
        else if (a.ph === 'rise' || a.ph === 'bal2') hint(g, '{L}{R} 로 균형 잡기!', 254);
        else if (a.ph === 'jerk') hint(g, '눌렀다 밀어올릴 때 — 초록 구간에서 {A}!');
      }
    }
  }

  /* ============================================================ GOLF === */
  const HOLE = {
    par: 4, tee: [6, 0],
    green: [350, 15, 17, 12.5],                 // cx, cy, rx, ry (m)
    fw: [[24, 0], [110, -7], [210, 2], [292, 12], [336, 15]], fwW: 16,
    bunk: [[234, 20, 10, 6], [331, 30, 8, 4.5], [369, 3, 5, 8], [160, -21, 7, 5], [348, -2, 6, 3.2]],
    pond: [[120, 30, 24, 11]]
  };
  const CLUBS = [['DR', '드라이버', 255], ['3W', '3번 우드', 228], ['5I', '5번 아이언', 190], ['7I', '7번 아이언', 165], ['9I', '9번 아이언', 138], ['PW', '피칭 웨지', 115], ['SW', '샌드 웨지', 88]];
  const LIE_KO = { tee: '티', fair: '페어웨이', rough: '러프', sand: '벙커', water: '해저드', green: '그린', fringe: '프린지', trees: '숲' };
  const LIE_F = { tee: 1, fair: 1, rough: 0.82, sand: 0.6, water: 1, green: 1, fringe: 0.95, trees: 0.45 };
  const ell = (x, y, e, pad) => { const dx = (x - e[0]) / (e[2] + (pad || 0)), dy = (y - e[1]) / (e[3] + (pad || 0)); return dx * dx + dy * dy <= 1; };
  function fwDist(x, y) {
    let best = 1e9;
    const P = HOLE.fw;
    for (let k = 0; k < P.length - 1; k++) {
      const ax = P[k][0], ay = P[k][1], bx = P[k + 1][0], by = P[k + 1][1];
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const u = M.clamp(((x - ax) * vx + (y - ay) * vy) / L2, 0, 1);
      const d = Math.hypot(x - ax - vx * u, y - ay - vy * u);
      if (d < best) best = d;
    }
    return best;
  }
  function centerY(x) {
    const P = HOLE.fw;
    if (x <= P[0][0]) return P[0][1];
    for (let k = 0; k < P.length - 1; k++) if (x <= P[k + 1][0]) return M.lerp(P[k][1], P[k + 1][1], (x - P[k][0]) / (P[k + 1][0] - P[k][0]));
    return P[P.length - 1][1];
  }
  function lieAt(x, y) {
    for (const p of HOLE.pond) if (ell(x, y, p)) return 'water';
    for (const b of HOLE.bunk) if (ell(x, y, b)) return 'sand';
    if (ell(x, y, HOLE.green)) return 'green';
    if (ell(x, y, HOLE.green, 2.6)) return 'fringe';
    if (x >= 0 && x <= 13 && Math.abs(y) <= 5) return 'tee';
    const fd = fwDist(x, y);
    if (fd <= HOLE.fwW * (x < 60 ? 0.85 : 1)) return 'fair';
    if (Math.abs(y - centerY(x)) > 46 || x < -14 || x > 392) return 'trees';
    return 'rough';
  }
  // map (overview) & green views
  const MAP = { ox: 24, oy: 146, k: 1.2 };
  const GV = { k: 8.5, ox: 240, oy: 138 };
  const mapS = (x, y) => [MAP.ox + x * MAP.k, MAP.oy + y * MAP.k];
  const grnS = (x, y) => [GV.ox + (x - HOLE.green[0]) * GV.k, GV.oy + (y - HOLE.green[1]) * GV.k];
  const LIE_COL = {
    rough: ['#3f8a45', '#38803f', '#469250'], fair: ['#62bb57', '#57ad4d', '#5db552'], green: ['#74d36c', '#6cc964', '#70ce68'],
    fringe: ['#5ec457', '#58bb51', '#5ec457'], tee: ['#6fca66', '#68c05f', '#6fca66'], sand: ['#ecd8a8', '#e2ca94', '#f2e2ba'],
    water: ['#2a8fd6', '#2482c8', '#3a9fe0'], trees: ['#2d6b3a', '#285f34', '#31743f']
  };
  const GCACHE = {};
  function golfBitmap(view) {
    if (GCACHE[view]) return GCACHE[view];
    const W = 480, H = 270;
    const cv = OG.makeCanvas(W, H), ctx = cv.getContext('2d');
    const gg = new OG.Gfx(ctx);
    const inv = view === 'map' ? (sx, sy) => [(sx - MAP.ox) / MAP.k, (sy - MAP.oy) / MAP.k] : (sx, sy) => [HOLE.green[0] + (sx - GV.ox) / GV.k, HOLE.green[1] + (sy - GV.oy) / GV.k];
    const lie = [];
    for (let y = 0; y < H; y++) { const row = []; for (let x = 0; x < W; x++) { const w = inv(x + 0.5, y + 0.5); row.push(lieAt(w[0], w[1])); } lie.push(row); }
    const stripe = view === 'map' ? 7 : 1.6;
    for (let y = 0; y < H; y++) {
      let runC = null, runX = 0;
      for (let x = 0; x <= W; x++) {
        let c = null;
        if (x < W) {
          const L = lie[y][x], w = inv(x + 0.5, y + 0.5), cols = LIE_COL[L];
          let k = 0;
          if (L === 'fair' || L === 'green' || L === 'tee') k = Math.floor((w[0] + w[1] * 0.25) / stripe) % 2 ? 1 : 0;
          else { const hh = OG.hash(x, y, 77); k = hh < 0.16 ? 1 : hh > 0.9 ? 2 : 0; }
          c = cols[k];
          // edges
          const nb = (dx, dy) => { const yy = y + dy, xx = x + dx; return yy >= 0 && yy < H && xx >= 0 && xx < W ? lie[yy][xx] : L; };
          if ((L === 'sand' || L === 'water' || L === 'green') && (nb(0, -1) !== L || nb(-1, 0) !== L)) c = L === 'sand' ? '#c9a66b' : L === 'water' ? '#1b5f9e' : '#5cb855';
          if (L === 'water' && OG.hash(x >> 2, y, 5) < 0.04) c = '#8fd0ff';
        }
        if (c !== runC) { if (runC) { ctx.fillStyle = runC; ctx.fillRect(runX, y, x - runX, 1); } runC = c; runX = x; }
      }
    }
    // trees (canopies)
    const tk = view === 'map' ? 1 : 0;
    if (tk) {
      for (let i = 0; i < 260; i++) {
        const wx = -16 + OG.hash(i, 1, 31) * 412, side = OG.hash(i, 2, 31) < 0.5 ? -1 : 1;
        const wy = centerY(wx) + side * (48 + OG.hash(i, 3, 31) * 50);
        const p = mapS(wx, wy), r = 3 + Math.floor(OG.hash(i, 4, 31) * 4);
        if (p[1] < 14 || p[1] > 262) continue;
        gg.circle(p[0] + 2, p[1] + 2, r, 'rgba(0,0,0,0.25)');
        gg.circle(p[0], p[1], r, OG.hash(i, 5, 31) < 0.5 ? '#1f5a2c' : '#265c42');
        gg.circle(p[0] - 1, p[1] - 1, r - 2, OG.hash(i, 6, 31) < 0.5 ? '#2f7a3c' : '#3e8948');
        gg.px(p[0] - 2, p[1] - 2, '#63c74d');
      }
      // tee markers & yardage
      const t1 = mapS(4, -4), t2 = mapS(4, 4);
      gg.rect(t1[0], t1[1], 2, 2, '#ffffff'); gg.rect(t2[0], t2[1], 2, 2, '#ffffff');
      for (const d of [100, 150, 200]) { const x = HOLE.green[0] - d; const p = mapS(x, centerY(x)); gg.circle(p[0], p[1], 1.5, d === 150 ? '#ffffff' : d === 100 ? '#e43b44' : '#0099db'); }
    } else {
      // putting view: fringe ring dots
      for (let i = 0; i < 120; i++) { const a = i / 120 * TAU; const g2 = HOLE.green; const p = grnS(g2[0] + Math.cos(a) * (g2[2] + 1.3), g2[1] + Math.sin(a) * (g2[3] + 1.3)); gg.px(p[0], p[1], '#4fae49'); }
    }
    GCACHE[view] = cv;
    return cv;
  }
  function clubFor(lie, dist) {
    let k = CLUBS.length - 1;
    for (let j = CLUBS.length - 1; j >= 0; j--) { k = j; if (CLUBS[j][2] * LIE_F[lie] >= dist * 0.96) break; }
    if (lie !== 'tee' && k === 0) k = 1;
    if (lie === 'sand') k = Math.max(k, dist > 120 ? 3 : 6);
    if (lie === 'trees') k = Math.max(k, 3);
    return k;
  }
  const scoreName = d => d <= -3 ? '알바트로스' : d === -2 ? '이글' : d === -1 ? '버디' : d === 0 ? '파' : d === 1 ? '보기' : d === 2 ? '더블 보기' : d === 3 ? '트리플 보기' : '+' + d;
  const golfDiff = d => d === 0 ? 'E' : (d > 0 ? '+' : '') + d;
  KD.golf = {
    mode: 'sum',
    rounds: () => 1,
    fmt: v => { const n = Math.floor(v + 1e-6); return n + '타 (' + golfDiff(n - HOLE.par) + ')'; },
    label(s) { const a = s.a; return '파4 · 360m' + (a && s.ph === 'play' ? ' · ' + strokeNo(a) + '타째' : ''); },
    setup(s, R) {
      const g = HOLE.green;
      s.pin = [r2(g[0] + R.range(-0.45, 0.45) * g[2]), r2(g[1] + R.range(-0.4, 0.4) * g[3])];
      s.wind = { a: r3(R.range(0, TAU)), v: r1(R.range(0.5, 6)) };
      const sa = R.range(0, TAU), sm = R.range(0.12, 0.3);
      s.slope = [r3(Math.cos(sa) * sm), r3(Math.sin(sa) * sm)];
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality({ skill: e.skill }, R, 0.1);
      const n = M.clamp(Math.round(4 + (0.76 - q) * 1.7 + R.gauss() * 0.52), 2, 8);
      const prox = r1(Math.min(60, (n <= 3 ? 0.8 + (1 - q) * 6 : 2.5 + (1 - q) * 12) + Math.abs(R.gauss()) * 2.5));
      return [r3(n + prox / 1000)];
    },
    start(s, R) {
      const a = { ph: 'aim', n: 0, bx: HOLE.tee[0], by: HOLE.tee[1], lie: 'tee', aim: 0, club: 0, mk: 0.1, pw: 0, err: 0,
        t: 0, pt: 0, idle: 0, fl: null, rl: null, pv: null, prox: -1, holed: false, pick: false, fin: false, res: null, hist: [], putt: false, lip: 0 };
      s.a = a;
      golfNewStroke(s);
      return a;
    },
    upd(s, i, dt, R) { golfUpd(s, i, dt, R); },
    post(s, dt) {},
    draw(g, s) { drawGolf(g, s); }
  };
  const aiming = a => a.ph === 'aim' || a.ph === 'paim' || a.ph === 'sw1' || a.ph === 'sw2' || a.ph === 'ppow';
  const strokeNo = a => Math.min(8, a.holed ? a.n : a.n + (aiming(a) ? 1 : 0)) || 1;
  const pinDist = (s, x, y) => Math.hypot(s.pin[0] - x, s.pin[1] - y);
  function golfNewStroke(s) {
    const a = s.a;
    if (!a) return;
    const d = pinDist(s, a.bx, a.by);
    a.aim = r3(Math.atan2(s.pin[1] - a.by, s.pin[0] - a.bx));
    a.putt = a.lie === 'green' || (a.lie === 'fringe' && d < 16);
    a.club = a.putt ? -1 : clubFor(a.lie, d);
    a.ph = a.putt ? 'paim' : 'aim'; a.pt = 0; a.mk = a.putt ? 0 : 0.1; a.pw = 0; a.err = 0; a.idle = 0; a.fl = null; a.rl = null; a.pv = null;
  }
  const PUTT_A = 1.15;
  // predicted putt path (same physics as the update) → list of [x,y]
  function puttPath(s, x, y, aim, p, maxT) {
    const v0 = puttV(p);
    let vx = Math.cos(aim) * v0, vy = Math.sin(aim) * v0;
    const pts = [];
    const h = 1 / 30;
    for (let t = 0; t < (maxT || 6); t += h) {
      const sp = Math.hypot(vx, vy);
      if (sp < 0.04) break;
      const L = lieAt(x, y);
      const fr = (L === 'green' ? PUTT_A : L === 'fringe' ? 2.6 : 4.5);
      const ax = -vx / sp * fr + (L === 'green' ? s.slope[0] : 0), ay = -vy / sp * fr + (L === 'green' ? s.slope[1] : 0);
      x += vx * h; y += vy * h;
      const nvx = vx + ax * h, nvy = vy + ay * h;
      if (nvx * vx + nvy * vy < 0 && Math.hypot(nvx, nvy) < 0.3) break;
      vx = nvx; vy = nvy;
      pts.push([x, y]);
    }
    return pts;
  }
  const puttV = p => 0.5 + 6.6 * Math.pow(M.clamp(p, 0, 1), 1.25);
  const puttDist = p => { const v = puttV(p); return v * v / (2 * PUTT_A); };
  function golfUpd(s, i, dt, R) {
    const a = s.a;
    a.t = r3(a.t + dt); a.pt = r3(a.pt + dt);
    const club = a.club >= 0 ? CLUBS[a.club] : null;
    switch (a.ph) {
      case 'aim': case 'paim': {
        if (idleTick(a, i, dt)) { a.pick = true; return golfEnd(s, '시간 초과 · 픽업'); }
        const rate = a.putt ? 0.35 : 0.5;
        if (i.l) a.aim = r3(a.aim - rate * dt);
        if (i.r) a.aim = r3(a.aim + rate * dt);
        if (!a.putt && i.up) { a.club = Math.max(a.lie === 'tee' ? 0 : 1, a.club - 1); OG.sfx(s, 'select'); }
        if (!a.putt && i.dp) { a.club = Math.min(CLUBS.length - 1, a.club + 1); OG.sfx(s, 'select'); }
        if ((i.ap && a.pt > 0.2) || a.pt > 15) { a.ph = a.putt ? 'ppow' : 'sw1'; a.pt = 0; a.mk = a.putt ? 0 : 0.1; OG.sfx(s, 'click'); }
        break;
      }
      case 'sw1':
        a.mk = r3(a.mk + 1.1 * dt);
        if (i.ap || a.mk >= 1) { a.pw = r3(M.clamp((a.mk - 0.1) / 0.8, 0.05, 1.125)); a.ph = 'sw2'; a.pt = 0; OG.sfx(s, 'click'); }
        break;
      case 'sw2':
        a.mk = r3(a.mk - 1.35 * dt);
        if (i.ap || a.mk <= -0.05) {
          a.err = r3(i.ap ? a.mk - 0.1 : -0.15);
          golfShoot(s, R);
        }
        break;
      case 'ppow':
        if (idleTick(a, i, dt)) { a.pick = true; return golfEnd(s, '시간 초과 · 픽업'); }
        a.mk = r3(M.pingpong(a.pt, 1.1));
        if ((i.ap && a.pt > 0.05) || a.pt > 10) {
          a.pw = a.mk;
          const v = puttV(a.pw) * (1 + R.gauss() * 0.015), ang = a.aim + R.gauss() * 0.006;
          a.pv = { vx: r3(Math.cos(ang) * v), vy: r3(Math.sin(ang) * v) };
          a.n++; a.ph = 'putt'; a.pt = 0; OG.sfx(s, 'hit');
          a.hist.push([r1(a.bx), r1(a.by)]);
        }
        break;
      case 'fly': {
        const f = a.fl;
        f.u = r3(Math.min(1, f.u + dt / f.T));
        if (f.u >= 1) golfLand(s, R);
        break;
      }
      case 'roll': {
        const r = a.rl;
        r.u = r3(Math.min(1, r.u + dt / r.T));
        const k = 1 - (1 - r.u) * (1 - r.u);
        const x = r.x0 + (r.x1 - r.x0) * k, y = r.y0 + (r.y1 - r.y0) * k;
        const L = lieAt(x, y);
        if (L === 'water' || L === 'sand' || r.u >= 1) { a.bx = r2(x); a.by = r2(y); golfRest(s, L); }
        else if (pinDist(s, x, y) < 0.12 && r.u > 0.6) { a.bx = s.pin[0]; a.by = s.pin[1]; golfHoled(s); }
        break;
      }
      case 'putt': {
        const v = a.pv;
        for (let k = 0; k < 4; k++) {
          const h = dt / 4;
          const sp = Math.hypot(v.vx, v.vy);
          if (sp < 0.04) break;
          const L = lieAt(a.bx, a.by);
          const fr = (L === 'green' ? PUTT_A : L === 'fringe' ? 2.6 : 4.5);
          const ax = -v.vx / sp * fr + (L === 'green' ? s.slope[0] : 0), ay = -v.vy / sp * fr + (L === 'green' ? s.slope[1] : 0);
          const nx = a.bx + v.vx * h, ny = a.by + v.vy * h;
          // hole capture along the segment
          const px = s.pin[0] - a.bx, py = s.pin[1] - a.by, sx = nx - a.bx, sy = ny - a.by, sl = sx * sx + sy * sy || 1e-9;
          const u = M.clamp((px * sx + py * sy) / sl, 0, 1);
          const dd = Math.hypot(a.bx + sx * u - s.pin[0], a.by + sy * u - s.pin[1]);
          if (dd < 0.062) {
            if (sp < 1.55) { a.bx = s.pin[0]; a.by = s.pin[1]; return golfHoled(s); }
            if (!a.lip) { a.lip = 1; v.vx *= 0.7; v.vy *= 0.7; const t2 = v.vx; v.vx = v.vx * 0.97 - v.vy * 0.24; v.vy = v.vy * 0.97 + t2 * 0.24; OG.sfx(s, 'bounce'); pop(s, '립 아웃!', PAL.orange, 160, 70, 'b'); }
          }
          a.bx = nx; a.by = ny;
          const nvx = v.vx + ax * h, nvy = v.vy + ay * h;
          if (nvx * v.vx + nvy * v.vy < 0 && Math.hypot(nvx, nvy) < 0.3) { v.vx = 0; v.vy = 0; break; }
          v.vx = nvx; v.vy = nvy;
        }
        v.vx = r3(v.vx); v.vy = r3(v.vy); a.bx = r3(a.bx); a.by = r3(a.by);
        if (Math.hypot(v.vx, v.vy) < 0.04 || a.pt > 9) { a.lip = 0; golfRest(s, lieAt(a.bx, a.by)); }
        break;
      }
      case 'rest':
        if (a.pt > 1.0) {
          if (a.n >= 8) { a.pick = true; return golfEnd(s, '8타 제한 · 픽업'); }
          golfNewStroke(s);
        }
        break;
      case 'holed':
        if (a.pt > 1.8) golfEnd(s, '');
        break;
    }
  }
  function golfShoot(s, R) {
    const a = s.a, club = CLUBS[a.club];
    const lf = LIE_F[a.lie];
    let err = a.err;
    if (a.pw > 1) err += R.gauss() * 0.02 * (a.pw - 1) * 8;
    const dir = a.aim + err * 0.55;
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const along = s.wind.v * Math.cos(s.wind.a - dir), cross = s.wind.v * Math.sin(s.wind.a - dir);
    const C = Math.max(4, club[2] * Math.min(a.pw, 1.125) * lf * (1 + along * 0.011) * (a.lie === 'trees' ? 1 : 1));
    const T = 1.0 + C / 130;
    const loft = 0.1 + a.club * 0.03;
    a.fl = { x0: a.bx, y0: a.by, dx: r3(dx), dy: r3(dy), C: r2(C), cl: r2(err * C * 0.45), wl: r2(cross * T * 1.1), H: r2(C * loft), T: r2(T), u: 0 };
    a.n++; a.ph = 'fly'; a.pt = 0;
    a.hist.push([r1(a.bx), r1(a.by)]);
    OG.sfx(s, 'swing'); OG.sfx(s, 'hit');
    const ae = Math.abs(a.err);
    if (ae < 0.012) pop(s, 'PERFECT!', PAL.yellow, 160, 60, 'l');
    else if (ae > 0.06) pop(s, a.err > 0 ? '슬라이스!' : '훅!', PAL.orange, 160, 60, 'b');
  }
  function flightPos(f, u) {
    const lat = f.cl * u * u + f.wl * u;
    return [f.x0 + f.dx * f.C * u - f.dy * lat, f.y0 + f.dy * f.C * u + f.dx * lat, 4 * f.H * u * (1 - u)];
  }
  function golfLand(s, R) {
    const a = s.a, f = a.fl;
    const p = flightPos(f, 1), q = flightPos(f, 0.98);
    const L = lieAt(p[0], p[1]);
    a.bx = r2(p[0]); a.by = r2(p[1]);
    if (L === 'water') return golfRest(s, L);
    OG.sfx(s, L === 'sand' ? 'snow' : 'bounce');
    const rf = { fair: 0.1, tee: 0.1, rough: 0.025, green: 0.05, fringe: 0.06, sand: 0, trees: 0.01 }[L] * (a.club <= 1 ? 1 : 0.6);
    const rd = f.C * rf;
    const dl = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
    const ux = (p[0] - q[0]) / dl, uy = (p[1] - q[1]) / dl;
    if (rd < 0.3) return golfRest(s, L);
    a.rl = { x0: a.bx, y0: a.by, x1: r2(a.bx + ux * rd), y1: r2(a.by + uy * rd), T: r2(0.5 + rd / 25), u: 0 };
    a.ph = 'roll'; a.pt = 0;
  }
  function golfRest(s, L) {
    const a = s.a;
    a.ph = 'rest'; a.pt = 0;
    if (L === 'water') {
      OG.sfx(s, 'splash');
      for (let k = 0; k < 10; k++) part(s, a.bx, a.by, Math.cos(k) * 6, Math.sin(k * 1.7) * 6, k % 2 ? '#ffffff' : '#8fd0ff', 0.6, 0, 1);
      pop(s, '워터 해저드! +1벌타', PAL.cyan, 160, 70, 'b');
      a.n++;
      // drop: back along the line from the previous ball until dry
      const h = a.hist[a.hist.length - 1] || [HOLE.tee[0], HOLE.tee[1]];
      let x = a.bx, y = a.by, guard = 0;
      while (lieAt(x, y) === 'water' && guard++ < 200) { x += (h[0] - x) * 0.05; y += (h[1] - y) * 0.05; }
      x += (h[0] - x) * 0.04; y += (h[1] - y) * 0.04;
      a.bx = r2(x); a.by = r2(y); L = lieAt(x, y);
    } else if (L === 'sand') { pop(s, '벙커!', PAL.sand, 160, 70, 'b'); for (let k = 0; k < 8; k++) part(s, a.bx, a.by, Math.cos(k * 0.8) * 5, Math.sin(k * 0.8) * 5, '#ead4aa', 0.5, 0, 1); }
    else if (L === 'green' && a.prox < 0) { pop(s, '그린 온!', PAL.green, 160, 70, 'b'); OG.sfx(s, 'good'); }
    else if (L === 'trees') pop(s, '숲!', PAL.orange, 160, 70, 'b');
    if ((L === 'green' || L === 'fringe') && a.prox < 0) a.prox = r1(pinDist(s, a.bx, a.by));
    a.lie = L;
    if (a.putt && L === 'green' && pinDist(s, a.bx, a.by) < 0.9 && a.n < 8) pop(s, '탭인 거리', PAL.white, 160, 84, 's');
  }
  function golfHoled(s) {
    const a = s.a;
    a.holed = true; a.ph = 'holed'; a.pt = 0;
    if (a.prox < 0) a.prox = 0;
    const d = a.n - HOLE.par;
    OG.sfx(s, d <= -1 ? 'cheer' : 'ding');
    pop(s, a.n === 1 ? '홀인원!!' : scoreName(d) + '!', d < 0 ? PAL.yellow : d === 0 ? PAL.green : PAL.white, 160, 60, 'xl', 1.7);
  }
  function golfEnd(s, why) {
    const a = s.a;
    a.fin = true;
    const n = a.pick ? 8 : a.n;
    const d = n - HOLE.par;
    a.res = { v: r3(n + Math.min(99, a.prox < 0 ? 99 : a.prox) / 1000), txt: n + '타 (' + golfDiff(d) + ')', sub: why || (d < 0 && a.prox >= 0 ? '어프로치 ' + a.prox.toFixed(1) + 'm' : scoreName(d)), bad: a.pick || d >= 2,
      tag: !a.pick && d < 0 ? scoreName(d) + '!' : '' };
  }
  function drawGolfer(g, x, y, k, look, club, putt) {
    // k: -1 top of backswing .. 0 impact .. 1 finish
    const P = putt ? { t: 0.75, aL: 0.25 + k * 0.45, aR: 0.2 + k * 0.45, eL: 0.1, eR: 0.1, lL: 0.25, lR: -0.1, kL: 0.35, kR: 0.35 } : OG.Pose.swing(k);
    const J = g.figure(x, y, P, look, { facing: 1, scale: 2 });
    const hd = J.hdR, el = J.elR;
    let ang = Math.atan2(hd[1] - el[1], hd[0] - el[0]);
    const len = putt ? 20 : 26;
    if (!putt) ang += k < 0 ? -1.2 * Math.min(1, -k * 1.4) : k > 0.2 ? -0.9 * Math.min(1, (k - 0.2) * 2) : 0;
    const ex = hd[0] + Math.cos(ang) * len, ey = hd[1] + Math.sin(ang) * len;
    g.line(hd[0], hd[1], ex, ey, '#c0cbdc', 1);
    g.rect(ex - 1, ey - 1, 4, 2, putt ? '#8b9bb4' : '#5a6988');
    return J;
  }
  function drawGolf(g, s) {
    const a = s.a, t = g.t;
    const green = a && (a.putt && (a.ph === 'paim' || a.ph === 'ppow' || a.ph === 'putt' || a.ph === 'rest' || a.ph === 'holed' || a.fin) && a.club < 0);
    const view = green ? 'green' : 'map';
    g.clear('#2d6b3a');
    g.image(golfBitmap(view), 0, 0);
    const S = view === 'map' ? mapS : grnS;
    const K = view === 'map' ? MAP.k : GV.k;
    // pin & flag
    const pp = S(s.pin[0], s.pin[1]);
    if (view === 'green') { g.ellipse(pp[0], pp[1] + 1, 3.5, 2.5, '#3e8948'); g.ellipse(pp[0], pp[1], 3, 2, '#181425'); } else g.rect(pp[0] - 1, pp[1], 2, 1, '#181425');
    const fh = view === 'map' ? 12 : 30;
    g.line(pp[0] + 1, pp[1] + 2, pp[0] + 6, pp[1] + 4, 'rgba(0,0,0,0.25)', 1);
    g.rect(pp[0], pp[1] - fh, 1, fh, '#f4f4f4');
    const wv = Math.round(Math.sin(t * 6) * 1.5);
    g.poly([pp[0] + 1, pp[1] - fh, pp[0] + 1 + (view === 'map' ? 7 : 12), pp[1] - fh + 3 + wv, pp[0] + 1, pp[1] - fh + (view === 'map' ? 5 : 8)], PAL.red);
    if (view === 'green') {
      // slope arrows (drifting downhill)
      const sa = Math.atan2(s.slope[1], s.slope[0]), sm = Math.hypot(s.slope[0], s.slope[1]);
      const cx0 = Math.cos(sa), sy0 = Math.sin(sa);
      for (let gx = -3; gx <= 3; gx++) for (let gy = -2; gy <= 2; gy++) {
        const wx = HOLE.green[0] + gx * 5 + (gy % 2) * 2.5, wy = HOLE.green[1] + gy * 5;
        if (!ell(wx, wy, HOLE.green, -1.5)) continue;
        const ph = M.wrap(t * (0.5 + sm) + OG.hash(gx + 9, gy + 9, 3), 1);
        const c = grnS(wx + cx0 * (ph - 0.5) * 2.4, wy + sy0 * (ph - 0.5) * 2.4);
        g.alpha(0.5 * Math.sin(ph * PI));
        g.line(c[0] - cx0 * 4, c[1] - sy0 * 4, c[0] + cx0 * 3, c[1] + sy0 * 3, '#ffffff');
        g.line(c[0] + cx0 * 3, c[1] + sy0 * 3, c[0] + cx0 * 3 - (cx0 * 2 - sy0 * 2), c[1] + sy0 * 3 - (sy0 * 2 + cx0 * 2), '#ffffff');
        g.line(c[0] + cx0 * 3, c[1] + sy0 * 3, c[0] + cx0 * 3 - (cx0 * 2 + sy0 * 2), c[1] + sy0 * 3 - (sy0 * 2 - cx0 * 2), '#ffffff');
      }
      g.alpha(1);
      g.panel(428, 76, 48, 34, {});
      g.text('경사', 450, 79, PAL.lightgrey, { size: 'xs', align: 'center' });
      const lx = 452, ly = 96; g.line(lx - cx0 * 8, ly - sy0 * 8, lx + cx0 * 6, ly + sy0 * 6, PAL.yellow, 2);
      g.poly([lx + cx0 * 10, ly + sy0 * 10, lx + cx0 * 4 - sy0 * 4, ly + sy0 * 4 + cx0 * 4, lx + cx0 * 4 + sy0 * 4, ly + sy0 * 4 - cx0 * 4], PAL.yellow);
    }
    if (!a) return;
    const e = s.E[s.cur], look = lookE(e), col = pcol(e);
    // previous ball positions (shot history) on the map
    if (view === 'map') {
      for (let k = 0; k < a.hist.length; k++) { const h = a.hist[k], p = S(h[0], h[1]); g.rect(p[0] - 1, p[1] - 1, 3, 3, 'rgba(0,0,0,0.3)'); g.px(p[0], p[1], col); }
    }
    // aim line
    if (a.putt && (a.ph === 'paim' || a.ph === 'ppow')) {
      const dist = pinDist(s, a.bx, a.by);
      const pp2 = a.ph === 'ppow' ? a.mk : Math.pow(M.clamp((Math.sqrt(2 * PUTT_A * dist) - 0.5) / 6.6, 0, 1), 0.8);
      const path = puttPath(s, a.bx, a.by, a.aim, pp2, 6);
      const show = Math.max(3, Math.floor(path.length * 0.55));
      for (let k = 2; k < show; k += 3) { const p = S(path[k][0], path[k][1]); g.alpha(1 - k / show * 0.8); g.rect(p[0], p[1], 2, 2, '#ffffff'); }
      g.alpha(1);
      const end = path.length ? path[path.length - 1] : [a.bx, a.by];
      if (a.ph === 'ppow') { const p = S(end[0], end[1]); g.circleO(p[0], p[1], 3, 'rgba(254,231,97,0.6)'); }
    } else if (a.ph === 'aim' || a.ph === 'sw1' || a.ph === 'sw2') {
      const b = S(a.bx, a.by);
      const len = a.putt ? Math.max(1.5, a.ph === 'ppow' ? puttDist(a.mk) : Math.min(18, pinDist(s, a.bx, a.by))) : CLUBS[a.club][2] * LIE_F[a.lie] * (a.ph === 'sw1' || a.ph === 'sw2' ? Math.max(0.05, a.ph === 'sw1' ? (a.mk - 0.1) / 0.8 : a.pw) : 1);
      const n = Math.max(4, Math.round(len * K / 5));
      for (let k = 1; k <= n; k++) {
        if (k % 2) continue;
        const d = len * k / n, p = S(a.bx + Math.cos(a.aim) * d, a.by + Math.sin(a.aim) * d);
        g.rect(p[0], p[1], 2, 2, '#ffffff');
      }
      const tp = S(a.bx + Math.cos(a.aim) * len, a.by + Math.sin(a.aim) * len);
      g.circleO(tp[0], tp[1], a.putt ? 4 : 5, PAL.yellow);
      g.px(tp[0], tp[1], PAL.yellow);
    }
    // flight trail + ball
    let bx = a.bx, by = a.by, bz = 0;
    if (a.ph === 'fly') {
      const f = a.fl;
      for (let k = 0; k <= 24; k++) {
        const u = f.u * k / 24, p = flightPos(f, u), sp = S(p[0], p[1]);
        g.alpha(0.5); g.px(sp[0], sp[1] - p[2] * K * 0.55, '#ffffff'); g.alpha(1);
      }
      const p = flightPos(f, f.u); bx = p[0]; by = p[1]; bz = p[2];
    } else if (a.ph === 'roll') {
      const r = a.rl, k = 1 - (1 - r.u) * (1 - r.u);
      bx = r.x0 + (r.x1 - r.x0) * k; by = r.y0 + (r.y1 - r.y0) * k;
    }
    const bs = S(bx, by);
    if (!(a.ph === 'holed' || a.holed)) {
      const br = view === 'green' ? 2 : 1;
      g.ellipse(bs[0] + 1, bs[1] + 1, br + 0.5, br * 0.6 + 0.4, 'rgba(0,0,0,0.35)');
      const lift = Math.round(bz * K * 0.55);
      if (lie(a) !== 'water' || a.ph === 'fly') { g.circle(bs[0], bs[1] - lift, br + (bz > 8 ? 1 : 0), '#ffffff'); if (view === 'green') g.px(bs[0] - 1, bs[1] - 1 - lift, '#c0cbdc'); }
      if (a.ph === 'aim' || a.ph === 'paim' || a.ph === 'sw1' || a.ph === 'sw2' || a.ph === 'ppow') {
        // player marker
        const m = view === 'green' ? [bs[0] - 6, bs[1] + 3] : [bs[0] - 3, bs[1] + 2];
        g.rect(m[0], m[1] - (view === 'green' ? 6 : 3), view === 'green' ? 4 : 2, view === 'green' ? 6 : 3, col);
        g.text(e.tag, bs[0], bs[1] - (view === 'green' ? 18 : 12), col, { size: 'xs', align: 'center', outline: PAL.black });
      }
    }
    drawParts(g, s, (x, y) => S(x, y));
    // ---- HUD panels
    // info
    const d = pinDist(s, a.ph === 'fly' || a.ph === 'roll' ? bx : a.bx, a.ph === 'fly' || a.ph === 'roll' ? by : a.by);
    g.panel(4, 20, 132, 44, {});
    g.text(strokeNo(a) + '타째', 10, 24, PAL.yellow, { size: 'b' });
    g.text('파 4', 128, 25, PAL.lightgrey, { size: 's', align: 'right' });
    g.text('홀까지 ' + (d < 10 ? d.toFixed(1) : Math.round(d)) + 'm', 10, 39, PAL.white, { size: 's' });
    g.text('라이: ' + LIE_KO[a.lie], 10, 51, a.lie === 'sand' || a.lie === 'water' || a.lie === 'trees' ? PAL.orange : PAL.lightgrey, { size: 'xs' });
    if (a.club >= 0 && !a.putt) g.text(CLUBS[a.club][1], 128, 51, PAL.cyan, { size: 'xs', align: 'right' });
    else if (a.putt) g.text('퍼터', 128, 51, PAL.cyan, { size: 'xs', align: 'right' });
    // wind
    const wx = 458, wy = 52;
    g.panel(428, 20, 48, 50, {});
    g.text('바람', wx - 2, 23, PAL.lightgrey, { size: 'xs', align: 'center' });
    const wa = s.wind.a;
    g.line(wx - Math.cos(wa) * 9, wy - Math.sin(wa) * 9, wx + Math.cos(wa) * 9, wy + Math.sin(wa) * 9, PAL.cyan, 2);
    g.poly([wx + Math.cos(wa) * 12, wy + Math.sin(wa) * 12, wx + Math.cos(wa + 2.5) * 6, wy + Math.sin(wa + 2.5) * 6, wx + Math.cos(wa - 2.5) * 6, wy + Math.sin(wa - 2.5) * 6], PAL.cyan);
    g.text(s.wind.v.toFixed(1) + 'm/s', wx - 2, 60, PAL.white, { size: 'xs', align: 'center' });
    // golfer inset
    g.panel(4, 186, 74, 64, {});
    let k = -0.05;
    if (a.ph === 'sw1') k = -Math.min(1, (a.mk - 0.1) / 0.8);
    else if (a.ph === 'sw2') k = -Math.max(0, Math.min(1, a.pw)) * M.clamp((a.mk + 0.05) / Math.max(0.1, 0.1 + 0.8 * a.pw), 0, 1);
    else if (a.ph === 'fly' || a.ph === 'roll' || a.ph === 'rest' || a.ph === 'holed') k = Math.min(1, 0.4 + a.pt * 2);
    else if (a.ph === 'ppow') k = -a.mk * 0.8;
    else if (a.ph === 'putt') k = Math.min(0.6, a.pt * 3);
    g.save(); g.clip(5, 187, 72, 62);
    g.rect(5, 232, 72, 17, a.lie === 'sand' ? '#e2ca94' : '#5db552');
    drawGolfer(g, 34, 236, k, look, null, a.putt);
    if (a.ph === 'aim' || a.ph === 'sw1' || a.ph === 'sw2' || a.ph === 'paim' || a.ph === 'ppow') g.circle(48, 234, 1.5, '#ffffff');
    g.restore();
    // swing meter
    if (s.ph === 'play' && (a.ph === 'aim' || a.ph === 'sw1' || a.ph === 'sw2')) {
      const mx = 120, mw = 240, my = 232;
      g.rect(mx - 2, my - 2, mw + 4, 14, PAL.black);
      g.grad(mx, my, mw, 10, '#2b3150', '#262b44', 2);
      g.rect(mx + mw * 0.9, my, mw * 0.1, 10, '#a22633');
      for (let q = 0.1; q <= 0.91; q += 0.2) g.rect(mx + mw * q, my + 7, 1, 3, PAL.grey);
      g.rect(mx + mw * 0.1 - 2, my - 1, 5, 12, '#ffffff'); g.rect(mx + mw * 0.1, my - 3, 1, 16, PAL.green);
      if (a.ph === 'sw2' || a.ph === 'sw1') {
        const fx = a.ph === 'sw2' ? 0.1 + 0.8 * a.pw : a.mk;
        g.rect(mx + 1, my + 1, Math.max(0, mw * fx - 2), 8, a.ph === 'sw2' ? 'rgba(254,174,52,0.65)' : 'rgba(254,231,97,0.5)');
        g.rect(mx + mw * M.clamp(a.mk, 0, 1) - 1, my - 3, 3, 16, PAL.white);
      }
      g.text('100%', mx + mw * 0.9, my + 12, PAL.lightgrey, { size: 'xs', align: 'center' });
      hint(g, a.ph === 'aim' ? '{L}{R} 조준  {U}{D} 클럽  {A} 스윙 시작' : a.ph === 'sw1' ? '{A} 파워 결정!' : '흰 선에서 {A} — 정확도!', 252);
    }
    if (s.ph === 'play' && (a.ph === 'paim' || a.ph === 'ppow')) {
      const mx = 140, mw = 200, my = 232;
      g.rect(mx - 2, my - 2, mw + 4, 14, PAL.black);
      g.rect(mx, my, mw, 10, '#262b44');
      g.rect(mx + 1, my + 1, Math.round((mw - 2) * a.mk), 8, PAL.gold);
      for (const dm of [1, 3, 6, 10, 15, 20]) {
        const v = Math.sqrt(2 * PUTT_A * dm), p = Math.pow(M.clamp((v - 0.5) / 6.6, 0, 1), 1 / 1.25);
        g.rect(mx + mw * p, my + 6, 1, 4, PAL.white);
        g.text(dm + '', mx + mw * p, my - 10, PAL.lightgrey, { size: 'xs', align: 'center' });
      }
      hint(g, a.ph === 'paim' ? '{L}{R} 조준  {A} 퍼팅 시작' : '{A} 세기 결정!  (' + puttDist(a.mk).toFixed(1) + 'm)', 252);
    }
  }
  const lie = a => a.lie;

  /* ============================================================ CURL === */
  const CU = { tee: 28.35, hog: 21.95, back: 30.18, nhog: 0, ntee: -6.4, nback: -8.23, hack: -10.06, x0: -11, x1: 32, hw: 2.375, rel: -1.0, sr: 0.145, k: 30 };
  const RINGS = [[1.83, '#1f6fd6', 1], [1.22, '#f4f8ff', 2], [0.61, '#e43b44', 3], [0.15, '#f4f8ff', 5]];
  const curlPts = d => d - CU.sr <= 0.15 ? 5 : d - CU.sr <= 0.61 ? 3 : d - CU.sr <= 1.22 ? 2 : d - CU.sr <= 1.83 ? 1 : 0;
  const curlV = d => { const p = curlPts(d); return p ? r3(p + (1.975 - Math.min(d, 1.975)) * 0.04) : 0; };
  const curlV0 = p => 8.6 + 2.6 * p;
  const CURL_A = 1.9;
  let ICE = null;
  function iceBitmap() {
    if (ICE) return ICE;
    const W = Math.round((CU.x1 - CU.x0) * CU.k), H = Math.round(CU.hw * 2 * CU.k) + 2;
    const cv = OG.makeCanvas(W, H), ctx = cv.getContext('2d'), gg = new OG.Gfx(ctx);
    gg.W = W; gg.H = H;
    const X = x => Math.round((x - CU.x0) * CU.k), Y = y => Math.round(H / 2 + y * CU.k);
    gg.rect(0, 0, W, H, '#e6f3fd');
    for (let y = 0; y < H; y += 2) gg.rect(0, y, W, 1, y % 4 ? '#e9f5fe' : '#e3f0fb');
    // houses
    for (const hx of [CU.ntee, CU.tee]) for (const r of RINGS) { gg.circle(X(hx), Y(0), r[0] * CU.k, OG.mix(r[1], '#e6f3fd', 0.12)); }
    // lines
    const vline = (x, c, w) => gg.rect(X(x) - Math.floor(w / 2), 0, w, H, c);
    vline(CU.nhog, '#c9404e', 4); vline(CU.hog, '#c9404e', 4);
    vline(CU.ntee, '#3a4466', 1); vline(CU.tee, '#3a4466', 1);
    vline(CU.nback, '#3a4466', 1); vline(CU.back, '#3a4466', 1);
    gg.rect(X(CU.x0 + 1.2), Y(0), W - X(CU.x0 + 1.2) - X(CU.x0 + 1.2) + X(CU.x0), 1, '#3a4466');
    // hack
    gg.rect(X(CU.hack) - 3, Y(-0.12) - 2, 6, 4, '#262b44'); gg.rect(X(CU.hack) - 3, Y(0.12) - 2, 6, 4, '#262b44');
    // centre-ice logo
    gg.alpha(0.13); gg.text('DOT GAMES 2026', X(11), Y(0) - 12, '#0099db', { size: 'xl', align: 'center' }); gg.alpha(1);
    // pebble
    gg.alpha(0.5);
    for (let i = 0; i < W * H / 70; i++) { const x = Math.floor(OG.hash(i, 1, 41) * W), y = Math.floor(OG.hash(i, 2, 41) * H); gg.px(x, y, OG.hash(i, 3, 41) < 0.6 ? '#ffffff' : '#c9def0'); }
    gg.alpha(1);
    ICE = cv;
    return cv;
  }
  KD.curl = {
    mode: 'sum',
    fmt: v => Math.floor(v + 1e-6) + '점',
    label(s) { return '스톤 ' + (s.rnd + 1) + '/' + s.rounds; },
    setup(s) { s.ST = s.E.map(() => []); },
    cpu(s, e, R) {
      const out = [];
      for (let r = 0; r < s.rounds; r++) {
        const q = OG.cpuQuality({ skill: e.skill }, R, 0.1);
        if (R.chance(0.06 + 0.22 * (1 - q))) { out.push(0); continue; }
        const d = Math.abs(R.gauss()) * (0.3 + 1.35 * (1 - q)) + Math.abs(R.gauss()) * 0.08;
        out.push(curlV(d));
      }
      return out;
    },
    start(s, R) {
      return { ph: 'aim', t: 0, pt: 0, idle: 0, ml: '', spd: 0, by: 0.9, cw: -1, mk: 0, p: 0, x: CU.hack + 0.6, y: 0, vx: 0, vy: 0, rot: 0,
        cx: CU.tee - 2.5, d: -1, v: 0, why: '', fin: false, res: null, sw: 0, st: 0 };
    },
    upd(s, i, dt, R) { curlUpd(s, i, dt, R); },
    draw(g, s) { drawCurl(g, s); }
  };
  function curlUpd(s, i, dt, R) {
    const a = s.a;
    a.t = r3(a.t + dt); a.pt = r3(a.pt + dt);
    let tx = a.cx;
    switch (a.ph) {
      case 'aim':
        if (idleTick(a, i, dt)) return curlEnd(s, '시간 초과');
        if (i.l) a.by = r3(Math.max(-1.9, a.by - 1.3 * dt));
        if (i.r) a.by = r3(Math.min(1.9, a.by + 1.3 * dt));
        if (i.up || i.dp) { a.cw = -a.cw; OG.sfx(s, 'select'); }
        if ((i.ap && a.pt > 0.2) || a.pt > 12) { a.ph = 'pow'; a.pt = 0; a.cx = CU.hack + 5; OG.sfx(s, 'click'); }
        tx = CU.tee - 2.5;
        break;
      case 'pow':
        if (idleTick(a, i, dt)) return curlEnd(s, '시간 초과');
        a.mk = r3(M.pingpong(a.pt, 1.0));
        if ((i.ap && a.pt > 0.05) || a.pt > 10) { a.p = a.mk; a.ph = 'slide'; a.pt = 0; OG.sfx(s, 'whoosh'); }
        tx = CU.hack + 5;
        break;
      case 'slide': {
        const k = M.clamp(a.pt / 0.9, 0, 1);
        a.x = r3(M.lerp(CU.hack + 0.6, CU.rel, M.easeOut(k)));
        tx = a.x + 5;
        if (k >= 1) {
          const v0 = curlV0(a.p), th = Math.atan2(a.by, CU.tee - CU.rel);
          a.vx = r3(Math.cos(th) * v0); a.vy = r3(Math.sin(th) * v0); a.ph = 'run'; a.pt = 0; a.y = 0; a.x = CU.rel;
          OG.sfx(s, 'ice');
        }
        break;
      }
      case 'run': {
        runSpd(a, i, dt, 0.13, 1.6);
        a.sw = a.spd;
        if (a.spd > 0.25) { a.st = r3(a.st + dt * (2 + a.spd * 6)); if (Math.floor(a.st) !== Math.floor(a.st - dt * (2 + a.spd * 6))) OG.sfx(s, 'stroke'); }
        const sp = Math.hypot(a.vx, a.vy);
        if (sp < 0.03) { a.vx = 0; a.vy = 0; return curlStop(s); }
        const dec = CURL_A * (1 - 0.12 * a.sw), ac = a.cw * 0.4 * (1 - 0.45 * a.sw) / (0.6 + sp * 0.35);
        const nvx = a.vx + (-a.vx / sp * dec - a.vy / sp * ac) * dt, nvy = a.vy + (-a.vy / sp * dec + a.vx / sp * ac) * dt;
        if (nvx * a.vx + nvy * a.vy <= 0) { a.vx = 0; a.vy = 0; return curlStop(s); }
        a.vx = r3(nvx); a.vy = r3(nvy);
        a.x = r3(a.x + a.vx * dt); a.y = r3(a.y + a.vy * dt);
        a.rot = r3(a.rot + a.cw * dt * (1.2 + sp * 0.2));
        if (Math.abs(a.y) > CU.hw - CU.sr) { a.y = r3(M.clamp(a.y, -CU.hw + CU.sr, CU.hw - CU.sr)); a.vx = 0; a.vy = 0; a.why = '사이드 아웃'; return curlStop(s); }
        if (a.x > CU.back + CU.sr + 0.4) { a.vx = 0; a.vy = 0; a.why = '백라인 아웃'; return curlStop(s); }
        // ice spray when sweeping
        if (a.sw > 0.3 && OG.hash(Math.floor(a.t * 60), 3, 1) < a.sw * 0.6) part(s, a.x + 0.35, (OG.hash(Math.floor(a.t * 60), 5, 2) - 0.5) * 0.4, 0.5 + a.vx * 0.6, (OG.hash(Math.floor(a.t * 60), 7, 3) - 0.5) * 1.5, '#ffffff', 0.35, 0, 1);
        tx = Math.min(a.x + 3.5, CU.tee - 1);
        break;
      }
      case 'stop':
        tx = Math.max(Math.min(a.x, CU.tee + 1), CU.tee - 2.5);
        if (a.pt > 1.6) curlEnd(s, '');
        break;
    }
    a.cx = r3(a.cx + (tx - a.cx) * Math.min(1, dt * (a.ph === 'run' ? 6 : 3)));
  }
  function curlStop(s) {
    const a = s.a;
    a.ph = 'stop'; a.pt = 0;
    const d = Math.hypot(a.x - CU.tee, a.y);
    if (!a.why && a.x < CU.hog) a.why = '호그라인 미달';
    a.d = r2(d);
    a.v = a.why ? 0 : curlV(d);
    const pts = Math.floor(a.v + 1e-6);
    if (pts >= 5) { pop(s, '버튼! +5', PAL.yellow, 160, 60, 'xl', 1.5); OG.sfx(s, 'cheer'); }
    else if (pts > 0) { pop(s, '+' + pts + '점', pts >= 3 ? PAL.green : PAL.white, 160, 60, 'xl', 1.4); OG.sfx(s, 'ding'); }
    else { pop(s, a.why || '하우스 밖', PAL.red, 160, 60, 'l', 1.4); OG.sfx(s, 'miss'); }
    if (!a.why) s.ST[s.cur].push([r2(a.x), r2(a.y), r2(a.rot)]);
  }
  function curlEnd(s, why) {
    const a = s.a;
    a.fin = true;
    const pts = Math.floor(a.v + 1e-6);
    a.res = { v: a.v, txt: pts + '점', sub: why || a.why || (a.d >= 0 ? '버튼까지 ' + a.d.toFixed(2) + 'm' : ''), bad: pts === 0 };
  }
  function stoneDraw(g, x, y, rot, handle, alpha) {
    if (alpha != null) g.alpha(alpha);
    g.ellipse(x + 1, y + 2, 5, 4, 'rgba(24,20,37,0.22)');
    g.circle(x, y, 4.6, '#5a6988');
    g.circle(x, y, 3.6, '#8b9bb4');
    g.px(x - 2, y - 2, '#c0cbdc'); g.px(x + 1, y - 3, '#c0cbdc'); g.px(x + 2, y + 1, '#6b778f');
    const c = Math.cos(rot), sn = Math.sin(rot);
    g.line(x - c * 2.5, y - sn * 2.5, x + c * 2.5, y + sn * 2.5, handle, 2);
    g.alpha(1);
  }
  function topPerson(g, x, y, ang, look, broomTo, t, sweep) {
    const c = Math.cos(ang), sn = Math.sin(ang);
    g.ellipse(x + 2, y + 3, 7, 5, 'rgba(24,20,37,0.18)');
    // legs behind
    g.line(x, y, x - c * 6 - sn * 2, y - sn * 6 + c * 2, look.pants, 2);
    g.rect(x - c * 7 - sn * 2 - 1, y - sn * 7 + c * 2 - 1, 3, 3, '#181425');
    // shoulders (perpendicular to facing)
    for (let k = -5; k <= 5; k++) g.rect(Math.round(x - sn * k) - 1, Math.round(y + c * k) - 1, 3, 3, OG.shade(look.shirt, -0.15));
    g.circle(x, y, 3.5, look.shirt);
    if (broomTo) {
      const bx = broomTo[0] + (sweep ? Math.sin(t * (10 + sweep * 16)) * 3 * (0.3 + sweep) * -sn : 0);
      const byy = broomTo[1] + (sweep ? Math.sin(t * (10 + sweep * 16)) * 3 * (0.3 + sweep) * c : 0);
      g.line(x + c * 2, y + sn * 2, bx, byy, '#c0cbdc', 1);
      g.line(x + c * 2 + sn * 3, y + sn * 2 - c * 3, M.lerp(x, bx, 0.6), M.lerp(y, byy, 0.6), look.skin, 1);
      g.rect(bx - 2, byy - 2, 4, 4, '#262b44'); g.rect(bx - 1, byy - 1, 2, 2, '#e43b44');
    }
    g.circle(x + c * 0.5, y + sn * 0.5, 2.6, look.hair);
    g.px(x + c * 2.5, y + sn * 2.5, look.skin);
  }
  function drawCurl(g, s) {
    const a = s.a, t = g.t, K = CU.k;
    const cx = a ? a.cx : CU.tee - 2.5;
    const SY = 151;
    const X = x => Math.round(240 + (x - cx) * K), Y = y => Math.round(SY + y * K);
    // arena backdrop
    g.rect(0, 0, 480, 270, '#1b2238');
    g.crowd(0, 16, 480, 40, t, { ox: cx * K * 0.25, seed: 33, density: 0.8, bg: '#232a45', excite: a && a.ph === 'stop' && a.v >= 3 ? 0.6 : 0.05 });
    g.rect(0, 56, 480, 4, '#5a6988');
    // LED ribbon
    g.rect(0, 60, 480, 12, '#0d0b14');
    for (let k = 0; k < 6; k++) { const xx = M.wrap(k * 96 - Math.floor(cx * K * 0.6), 576) - 96; g.rect(xx + 1, 61, 94, 10, k % 2 ? '#124e89' : '#68386c'); g.text(k % 2 ? 'CURLING' : 'DOT GAMES', xx + 48, 62, '#ffffff', { size: 'xs', align: 'center' }); }
    // side boards
    g.rect(0, 72, 480, 6, '#3a4466'); g.rect(0, 78, 480, 2, '#c0cbdc');
    g.rect(0, Y(CU.hw), 480, 3, '#c0cbdc'); g.rect(0, Y(CU.hw) + 3, 480, 9, '#3a4466');
    g.rect(0, Y(CU.hw) + 12, 480, 270, '#1b2238');
    // ice
    g.rect(0, Y(-CU.hw), 480, Y(CU.hw) - Y(-CU.hw), '#e6f3fd');
    g.image(iceBitmap(), X(CU.x0), Y(-CU.hw) - 1);
    // ends of sheet
    const endW = (x0, w) => { g.rect(x0, Y(-CU.hw), w, Y(CU.hw) - Y(-CU.hw), '#2b3150'); for (let yy = Y(-CU.hw) + 4; yy < Y(CU.hw); yy += 8) g.rect(x0, yy, w, 1, '#3a4466'); };
    if (X(CU.x1) < 480) { endW(X(CU.x1) + 4, 480); g.rect(X(CU.x1), Y(-CU.hw), 4, Y(CU.hw) - Y(-CU.hw), '#c0cbdc'); }
    if (X(CU.x0) > 0) { endW(0, X(CU.x0) - 4); g.rect(X(CU.x0) - 4, Y(-CU.hw), 4, Y(CU.hw) - Y(-CU.hw), '#c0cbdc'); }
    if (!a) return;
    const e = s.E[s.cur], look = lookE(e), col = pcol(e);
    // previous stones of this player (ghosts)
    const st = s.ST[s.cur] || [];
    st.forEach(p => stoneDraw(g, X(p[0]), Y(p[1]), p[2], col, 0.45));
    // skip with broom target
    const skx = CU.tee + 0.9, sky = a.by;
    if (a.ph === 'aim' || a.ph === 'pow' || a.ph === 'slide') {
      topPerson(g, X(skx + 0.55), Y(sky), PI, look, [X(CU.tee + 0.05), Y(sky)], t, 0);
      g.circleO(X(CU.tee), Y(sky), 5, PAL.yellow);
      // expected curl arrow
      const ay = Y(sky), ax = X(CU.tee) - 30;
      g.line(ax - 22, ay, ax - 4, ay + a.cw * 8, PAL.yellow);
      g.poly([ax - 4, ay + a.cw * 8, ax - 9, ay + a.cw * 8 - a.cw * 1, ax - 5, ay + a.cw * 3], PAL.yellow);
    }
    // stone + people
    if (a.ph === 'aim' || a.ph === 'pow' || a.ph === 'slide') {
      const sx = X(a.x + 0.35);
      stoneDraw(g, sx, Y(0), a.rot, col);
      topPerson(g, X(a.x - 0.25), Y(0.15), 0, look, [sx - 4, Y(0) - 1], t, 0);
      if (a.ph === 'slide') { for (let k = 1; k < 4; k++) g.rect(X(a.x - 0.25) - k * 6, Y(0.15), 3, 1, 'rgba(255,255,255,0.6)'); }
    } else {
      // thrower left behind at the hog line
      topPerson(g, X(CU.rel - 0.5), Y(0.2), 0, look, null, t, 0);
      const sx = X(a.x), sy = Y(a.y);
      if (a.ph === 'run') {
        const sp = Math.hypot(a.vx, a.vy) || 1, ux = a.vx / sp, uy = a.vy / sp;
        // sweepers ahead of the stone
        [-1, 1].forEach(sd => {
          const px = a.x + ux * 0.75 - uy * sd * 0.62, py = a.y + uy * 0.75 + ux * sd * 0.62;
          topPerson(g, X(px), Y(py), Math.atan2(-ux * sd * 0 - uy * 0 + sd * 0, 1) + (sd > 0 ? -PI / 2 : PI / 2), look, [X(a.x + ux * 0.42 - uy * sd * 0.08), Y(a.y + uy * 0.42 + ux * sd * 0.08)], t + sd, a.sw);
        });
      }
      stoneDraw(g, sx, sy, a.rot, col);
      if (a.ph === 'stop' && !a.why) {
        // measuring line to the button
        g.line(sx, sy, X(CU.tee), Y(0), PAL.yellow, 1);
        g.text(a.d.toFixed(2) + 'm', (sx + X(CU.tee)) / 2, Math.min(sy, Y(0)) - 14, PAL.yellow, { size: 's', align: 'center', outline: PAL.black });
      }
    }
    drawParts(g, s, (x, y) => [X(x), Y(y)]);
    // ---- mini-map
    const mx0 = 20, mw = 440, my = 232, mh = 15;
    const mX = x => Math.round(mx0 + (x - CU.x0) / (CU.x1 - CU.x0) * mw), mY = y => Math.round(my + mh / 2 + y / CU.hw * (mh / 2));
    g.rect(mx0 - 2, my - 2, mw + 4, mh + 4, '#0d0b14');
    g.rect(mx0, my, mw, mh, '#e6f3fd');
    for (const hx of [CU.ntee, CU.tee]) { g.rect(mX(hx) - 4, my + 1, 8, mh - 2, '#1f6fd6'); g.rect(mX(hx) - 2, my + 3, 4, mh - 6, '#e43b44'); }
    g.rect(mX(CU.nhog), my, 1, mh, '#c9404e'); g.rect(mX(CU.hog), my, 1, mh, '#c9404e');
    // view window
    g.rectO(mX(cx - 8), my - 1, Math.round(16 / (CU.x1 - CU.x0) * mw), mh + 2, PAL.yellow);
    st.forEach(p => g.rect(mX(p[0]) - 1, mY(p[1]) - 1, 2, 2, '#5a6988'));
    g.rect(mX(a.ph === 'run' || a.ph === 'stop' ? a.x : a.x + 0.35) - 1, mY(a.ph === 'run' || a.ph === 'stop' ? a.y : 0) - 1, 3, 3, col);
    if (a.ph === 'aim' || a.ph === 'pow') g.rect(mX(CU.tee), mY(a.by), 1, 1, '#181425');
    // ---- phase UI
    if (s.ph === 'play' || s.ph === 'ban') {
      g.panel(4, 84, 74, 44, {});
      g.text('회전', 10, 88, PAL.lightgrey, { size: 'xs' });
      g.text(a.cw > 0 ? '인턴 ↷' : '아웃턴 ↶', 10, 98, PAL.cyan, { size: 's' });
      g.text('목표 ' + (a.by >= 0 ? '+' : '') + a.by.toFixed(1) + 'm', 10, 112, PAL.white, { size: 'xs' });
      if (a.ph === 'pow') {
        const bx = 150, bw = 200, byy = 96;
        g.rect(bx - 2, byy - 2, bw + 4, 14, PAL.black);
        g.rect(bx, byy, bw, 10, '#262b44');
        // house-weight band (no sweeping)
        const pFor = D => (Math.sqrt(2 * CURL_A * D) - 8.6) / 2.6;
        const p0 = M.clamp(pFor(CU.tee - 1.83 - CU.rel), 0, 1), p1 = M.clamp(pFor(CU.tee + 1.83 - CU.rel), 0, 1);
        g.rect(bx + bw * p0, byy, bw * (p1 - p0), 10, 'rgba(31,111,214,0.55)');
        g.rect(bx + bw * pFor(CU.tee - CU.rel), byy - 2, 1, 14, '#e43b44');
        g.rect(bx + 1, byy + 2, Math.round((bw - 2) * a.mk), 6, PAL.gold);
        g.rect(bx + bw * a.mk - 1, byy - 3, 3, 16, PAL.white);
        g.text('약', bx - 6, byy + 1, PAL.lightgrey, { size: 'xs', align: 'right' });
        g.text('강', bx + bw + 6, byy + 1, PAL.lightgrey, { size: 'xs' });
        g.text('하우스', bx + bw * (p0 + p1) / 2, byy - 12, '#8fd0ff', { size: 'xs', align: 'center', outline: PAL.black });
      }
      if (a.ph === 'run') {
        g.panel(4, 134, 74, 30, {});
        g.text('스위핑', 10, 138, PAL.lightgrey, { size: 'xs' });
        g.bar(10, 150, 62, 7, a.sw, a.sw > 0.7 ? PAL.green : a.sw > 0.3 ? PAL.yellow : PAL.grey, PAL.navy);
      }
      if (s.ph === 'play') {
        if (a.ph === 'aim') hint(g, '{L}{R} 목표  {U}{D} 회전  {A} 결정');
        else if (a.ph === 'pow') hint(g, '{A} 투구 세기 결정!');
        else if (a.ph === 'run') hint(g, '{L}{R} 연타: 스위핑 (더 멀리, 덜 휨)');
      }
    }
  }

  /* ============================================================ BASK === */
  const BK = { floor: 228, rimX: 404, rimY: 116, rimR: 9, board: 424, JT: 0.62 };
  const BK_POS = [184, 168, 156, 168, 184];
  const bkRacks = nh => nh >= 5 ? 3 : 5;
  const bkClock = nh => nh >= 5 ? 26 : 40;
  const bkMeter = jt => Math.max(0, Math.sin(PI * M.clamp(jt / BK.JT, 0, 1)));
  KD.bask = {
    mode: 'sum',
    rounds: () => 1,
    fmt: v => Math.round(v) + '점',
    label(s) { return bkRacks(s.nh) + '랙 · ' + bkClock(s.nh) + '초'; },
    cpu(s, e, R) {
      const q = OG.cpuQuality({ skill: e.skill }, R, 0.08);
      const p = 0.38 + 0.47 * q;
      let sc = 0;
      for (let r = 0; r < bkRacks(s.nh); r++) for (let b = 0; b < 5; b++) if (R.f() < p) sc += b === 4 ? 2 : 1;
      return [sc];
    },
    start(s, R) {
      return { ph: 'pick', t: 0, pt: 0, idle: 0, clock: bkClock(s.nh), rack: 0, ball: 0, jt: 0, sc: 0, x: BK_POS[0], mx: BK_POS[0],
        balls: [], marks: [], net: -9, fin: false, res: null, buzz: false, streak: 0 };
    },
    upd(s, i, dt, R) { baskUpd(s, i, dt, R); },
    post(s, dt) { baskBalls(s, dt); },
    draw(g, s) { drawBask(g, s); }
  };
  function baskUpd(s, i, dt, R) {
    const a = s.a, nr = bkRacks(s.nh);
    a.t = r3(a.t + dt); a.pt = r3(a.pt + dt);
    if (!a.buzz) {
      a.clock = r3(Math.max(0, a.clock - dt));
      if (a.clock <= 0) { a.buzz = true; OG.sfx(s, 'buzzer'); if (a.ph !== 'jump') { a.ph = 'over'; a.pt = 0; } }
    }
    baskBalls(s, dt);
    switch (a.ph) {
      case 'pick':
        if (a.pt > 0.26) { a.ph = 'hold'; a.pt = 0; }
        break;
      case 'hold':
        if (idleTick(a, i, dt)) { a.ph = 'over'; a.pt = 0; pop(s, '시간 초과', PAL.red, 160, 70, 'b'); break; }
        if (i.ap) { a.ph = 'jump'; a.jt = 0; a.pt = 0; }
        break;
      case 'jump': {
        a.jt = r3(a.jt + dt);
        if (!i.a || a.jt >= BK.JT) baskShoot(s, R, a.jt >= BK.JT ? 0.15 : bkMeter(a.jt));
        break;
      }
      case 'land':
        if (a.pt > 0.14) {
          if (a.buzz) { a.ph = 'over'; a.pt = 0; break; }
          a.ball++;
          if (a.ball >= 5) {
            a.rack++; a.ball = 0;
            if (a.rack >= nr) { a.ph = 'over'; a.pt = 0; break; }
            a.ph = 'move'; a.pt = 0; a.mx = a.x;
          } else { a.ph = 'pick'; a.pt = 0; }
        }
        break;
      case 'move': {
        const k = M.clamp(a.pt / 0.55, 0, 1);
        a.x = r2(M.lerp(a.mx, BK_POS[a.rack % 5], M.ease(k)));
        if (k >= 1) { a.ph = 'pick'; a.pt = 0; }
        break;
      }
      case 'over':
        if (!a.balls.length && a.pt > 0.8) {
          a.fin = true;
          const tot = nr * 30 / 5;
          a.res = { v: a.sc, txt: a.sc + '점', sub: a.marks.filter(m => m > 0).length + '/' + a.marks.length + ' 성공 · 만점 ' + tot, bad: false };
        }
        break;
    }
  }
  function baskShoot(s, R, m) {
    const a = s.a;
    const money = a.ball === 4;
    const pts = money ? 2 : 1;
    let kind;
    const r = R.f();
    if (m >= 0.98) kind = r < 0.9 ? 'swish' : 'rimin';
    else if (m >= 0.9) kind = r < 0.28 ? 'swish' : r < 0.66 ? 'rimin' : 'rimout';
    else if (m >= 0.7) kind = r < 0.2 ? 'rimin' : r < 0.35 ? 'board' : r < 0.75 ? 'rimout' : 'brick';
    else kind = r < 0.06 ? 'board' : a.jt < BK.JT * 0.5 ? 'air' : 'brick';
    const make = kind === 'swish' || kind === 'rimin' || kind === 'board';
    const hx = a.x + 8, hy = BK.floor - 52 - Math.round(bkMeter(a.jt) * 16);
    a.balls.push({ x0: hx, y0: hy, u: 0, T: r2(0.78 + (BK.rimX - hx) / 900), k: kind, m: money ? 1 : 0, p: make ? pts : 0, ph: 0, x: hx, y: hy, vx: 0, vy: 0, l: 0 });
    a.marks.push(make ? pts : 0);
    a.ph = 'land'; a.pt = 0;
    OG.sfx(s, 'throw');
    if (m >= 0.98) pop(s, 'PERFECT!', PAL.yellow, 160, 64, 'l', 0.8);
    else if (m >= 0.9) pop(s, 'GOOD', PAL.green, 160, 64, 'b', 0.7);
    else if (m < 0.7) pop(s, a.jt < BK.JT * 0.5 ? '너무 빨라!' : '늦었다!', PAL.orange, 160, 64, 'b', 0.7);
  }
  // flying balls
  function baskBalls(s, dt) {
    const a = s.a;
    if (!a || !a.balls) return;
    for (let k = a.balls.length - 1; k >= 0; k--) {
      const b = a.balls[k];
      b.l = r3(b.l + dt);
      if (b.ph === 0) {
        b.u = r3(Math.min(1, b.u + dt / b.T));
        const tg = bkTarget(b);
        b.x = r2(M.lerp(b.x0, tg[0], b.u)); b.y = r2(M.lerp(b.y0, tg[1], b.u) - 72 * 4 * b.u * (1 - b.u));
        if (b.u >= 1) {
          b.ph = 1;
          if (b.k === 'swish') { b.vx = 6; b.vy = 70; a.net = r2(s.t); OG.sfx(s, 'net'); }
          else if (b.k === 'rimin') { b.vx = 24; b.vy = -95; OG.sfx(s, 'bounce'); }
          else if (b.k === 'board') { b.vx = -30; b.vy = 10; OG.sfx(s, 'hit'); }
          else if (b.k === 'rimout') { b.vx = -95; b.vy = -120; OG.sfx(s, 'bounce'); }
          else if (b.k === 'brick') { b.vx = 40; b.vy = -140; OG.sfx(s, 'bounce'); }
          else { b.vx = 30; b.vy = 40; }
        }
      } else {
        const inn = b.k === 'swish' || b.k === 'rimin' || b.k === 'board';
        b.vy = r2(b.vy + 520 * dt);
        if (inn && b.ph === 1) { // steer into the basket
          b.x = r2(b.x + (BK.rimX - b.x) * Math.min(1, dt * 7) + b.vx * dt * 0.2);
          b.y = r2(b.y + b.vy * dt);
          if (b.vy > 0 && b.y > BK.rimY + 6) {
            b.ph = 2; a.sc += b.p; a.net = r2(s.t); OG.sfx(s, b.m ? 'coin' : 'net');
            a.streak++;
            pop(s, b.m ? '+2 머니볼!' : (b.k === 'swish' ? '스위시! +1' : '+1'), b.m ? PAL.hotpink : PAL.white, 300, 80, b.m ? 'l' : 'b', 0.8);
            b.vy = 60;
          }
        } else {
          b.x = r2(b.x + b.vx * dt); b.y = r2(b.y + b.vy * dt);
          if (b.y > BK.floor - 4) { b.y = BK.floor - 4; if (b.vy > 60) { b.vy = r2(-b.vy * 0.55); b.vx = r2(b.vx * 0.8); if (b.ph !== 2) OG.sfx(s, 'bounce'); } else b.vy = 0; }
          if (b.ph === 1 && !inn && b.y > BK.rimY + 10 && !b.missed) { b.missed = 1; a.streak = 0; }
        }
        if (b.l > b.T + 1.6 || b.x < -10 || b.x > 490) a.balls.splice(k, 1);
      }
    }
  }
  function bkTarget(b) {
    switch (b.k) {
      case 'swish': return [BK.rimX, BK.rimY - 1];
      case 'rimin': case 'rimout': return [BK.rimX - BK.rimR + 1, BK.rimY - 3];
      case 'brick': return [BK.rimX + BK.rimR - 1, BK.rimY - 3];
      case 'board': return [BK.board - 4, BK.rimY - 18];
      default: return [BK.rimX - 22, BK.rimY + 16];
    }
  }
  function ballDraw(g, x, y, money, t) {
    g.circle(x, y, 4, money ? '#f4f4f4' : '#e8762b');
    if (money) { g.rect(x - 4, y - 1, 9, 2, '#e43b44'); g.rect(x - 1, y - 4, 2, 9, '#1f6fd6'); }
    else { g.line(x - 3, y - 2, x + 3, y + 2, '#7a3a14'); g.rect(x - 4, y, 9, 1, '#7a3a14'); g.px(x - 2, y - 2, '#ffb070'); }
  }
  function drawHoop(g, s, net) {
    const t = g.t;
    // stanchion
    g.rect(452, 96, 6, BK.floor - 96, '#3a4466'); g.rect(452, 96, 2, BK.floor - 96, '#5a6988');
    g.poly([440, BK.floor, 470, BK.floor, 466, BK.floor - 26, 444, BK.floor - 26], '#262b44');
    g.rect(442, BK.floor - 24, 26, 10, '#124e89'); g.text('DOT', 455, BK.floor - 23, '#fff', { size: 'xs', align: 'center' });
    g.line(454, 100, 432, 106, '#3a4466', 3);
    // backboard (3/4)
    g.poly([BK.board - 2, 76, BK.board + 12, 70, BK.board + 12, 116, BK.board - 2, 124], 'rgba(220,235,255,0.75)');
    g.line(BK.board - 2, 76, BK.board + 12, 70, '#ffffff'); g.line(BK.board - 2, 124, BK.board + 12, 116, '#ffffff');
    g.line(BK.board - 2, 76, BK.board - 2, 124, '#ffffff'); g.line(BK.board + 12, 70, BK.board + 12, 116, '#c0cbdc');
    g.poly([BK.board + 1, 100, BK.board + 8, 97, BK.board + 8, 112, BK.board + 1, 116], 'rgba(0,0,0,0)');
    g.line(BK.board + 1, 100, BK.board + 8, 97, '#e43b44'); g.line(BK.board + 1, 100, BK.board + 1, 116, '#e43b44'); g.line(BK.board + 8, 97, BK.board + 8, 112, '#e43b44');
    // net (behind/below rim)
    const wig = net > 0 ? Math.max(0, 1 - (s.t - net) * 2.5) : 0;
    const sway = Math.round(Math.sin(t * 40) * 2 * wig);
    for (let k = -4; k <= 4; k++) {
      const x0 = BK.rimX + k * 2.1, x1 = BK.rimX + k * 1.2 + sway;
      g.line(x0, BK.rimY + 1, x1, BK.rimY + 16 + Math.round(wig * 3), '#f4f4f4');
    }
    for (let j = 1; j <= 3; j++) { const yy = BK.rimY + j * 4 + Math.round(wig * j); const w = BK.rimR - j * 1.4; g.line(BK.rimX - w + sway * j / 3, yy, BK.rimX + w + sway * j / 3, yy, 'rgba(244,244,244,0.7)'); }
    // rim
    g.line(BK.rimX + BK.rimR, BK.rimY, BK.board - 2, BK.rimY + 2, '#c0571a', 2);
    g.ellipse(BK.rimX, BK.rimY, BK.rimR + 1, 3, '#e8762b');
    g.ellipse(BK.rimX, BK.rimY, BK.rimR - 1, 2, 'rgba(0,0,0,0)');
    g.line(BK.rimX - BK.rimR, BK.rimY, BK.rimX + BK.rimR, BK.rimY, '#ff9a4a');
  }
  function drawBask(g, s) {
    const a = s.a, t = g.t, FL = BK.floor;
    // arena
    g.rect(0, 0, 480, 270, '#14182e');
    g.crowd(0, 30, 480, 92, t, { seed: 51, density: 0.86, bg: '#1d2340', excite: a && a.streak >= 2 ? 0.7 : a && a.balls.length ? 0.25 : 0.05 });
    // jumbotron
    g.rect(160, 18, 160, 40, '#05040a'); g.rect(162, 20, 156, 36, '#101528');
    if (a) {
      const clk = Math.ceil(a.clock);
      g.text('0:' + (clk < 10 ? '0' : '') + clk, 200, 24, clk <= 5 ? PAL.red : '#ff5a3c', { size: 'xl', align: 'center' });
      g.text(String(a.sc), 282, 24, PAL.yellow, { size: 'xl', align: 'center' });
      g.text('TIME', 200, 48, '#5a6988', { size: 'xs', align: 'center' }); g.text('SCORE', 282, 48, '#5a6988', { size: 'xs', align: 'center' });
    }
    // court-side boards
    g.rect(0, 122, 480, 14, '#0d0b14');
    for (let k = 0; k < 5; k++) { g.rect(k * 96 + 1, 123, 94, 12, k % 2 ? '#a22633' : '#124e89'); g.text(k % 2 ? '3-POINT CONTEST' : 'DOT GAMES 2026', k * 96 + 48, 125, '#fff', { size: 'xs', align: 'center' }); }
    // floor (perspective wood)
    g.rect(0, 136, 480, 134, '#c98a4b');
    for (let y = 136, k = 0; y < 270; k++) { const h = 3 + Math.floor(k / 3); g.rect(0, y, 480, 1, '#b97a3e'); y += h; }
    for (let k = -8; k < 20; k++) { const x0 = k * 34; g.line(x0, 136, 240 + (x0 - 240) * 1.9, 270, 'rgba(150,95,45,0.22)'); }
    g.alpha(0.18); g.ellipse(300, 196, 210, 40, '#fff6c8'); g.alpha(1);
    // paint (key) & lines
    g.poly([352, 150, 480, 150, 480, 238, 330, 238], '#a22633');
    g.line(352, 150, 330, 238, '#f4f4f4'); g.line(330, 238, 480, 238, '#f4f4f4'); g.line(352, 150, 480, 150, '#f4f4f4');
    // 3-pt arc on the floor (perspective ellipse around the basket)
    for (let k = 0; k <= 90; k++) {
      const ang = PI / 2 + PI * k / 90;
      g.rect(Math.round(412 + Math.cos(ang) * 252), Math.round(224 + Math.sin(ang) * 44), 2, 1, '#f4f4f4');
    }
    drawHoop(g, s, a ? a.net : -9);
    if (!a) return;
    const e = s.E[s.cur], look = lookE(e), col = pcol(e);
    // racks
    const nr = bkRacks(s.nh);
    const rackX = a.x - 34;
    g.rect(rackX - 2, FL - 22, 26, 3, '#8b9bb4'); g.rect(rackX - 2, FL - 10, 26, 3, '#8b9bb4');
    g.rect(rackX - 2, FL - 22, 2, 22, '#5a6988'); g.rect(rackX + 22, FL - 22, 2, 22, '#5a6988');
    const left = a.ph === 'move' ? 5 : 5 - a.ball - (a.ph === 'hold' || a.ph === 'jump' ? 1 : 0);
    for (let k = 0; k < 5; k++) {
      if (k >= 5 - left || a.rack >= nr) continue;
      const bx = rackX + 3 + (k % 3) * 8, by = FL - 26 + (k >= 3 ? 12 : 0);
      ballDraw(g, bx + (k >= 3 ? 4 : 0), by, k === 4, t);
    }
    // shooter
    let pose = OG.Pose.stand(), lift = 0, ballAt = null;
    const P = OG.Pose;
    if (a.ph === 'pick') { const k = Math.sin(PI * M.clamp(a.pt / 0.26, 0, 1)); pose = P.mix(P.stand(), { t: 0.9, aL: 1.0, aR: 1.1, eL: 0.2, eR: 0.2, lL: 0.6, lR: 0.4, kL: 0.9, kR: 0.8 }, k); }
    else if (a.ph === 'hold') pose = { t: 0.1, aL: 1.6, aR: 1.9, eL: 1.4, eR: 1.6, lL: 0.3, lR: 0.15, kL: 0.5, kR: 0.4 };
    else if (a.ph === 'jump') { const m = bkMeter(a.jt); lift = Math.round(m * 16); pose = P.mix({ t: 0.1, aL: 1.6, aR: 1.9, eL: 1.4, eR: 1.6, lL: 0.3, lR: 0.15, kL: 0.5, kR: 0.4 }, { t: -0.05, aL: 2.5, aR: 2.75, eL: 1.3, eR: 1.5, lL: 0.15, lR: -0.05, kL: 0.3, kR: 0.2 }, Math.min(1, a.jt / 0.2)); }
    else if (a.ph === 'land') pose = { t: 0, aL: 2.4, aR: 2.6, eL: 0.2, eR: 0.1, lL: 0.2, lR: -0.1, kL: 0.4, kR: 0.3 };
    else if (a.ph === 'move') pose = P.run(a.pt * 2.4 % 1, 0.6);
    else if (a.ph === 'over') pose = a.sc >= 15 ? P.celebrate(t) : P.stand();
    g.shadow(a.x, FL + 1, 8);
    const J = g.figure(a.x, FL - lift, pose, Object.assign(look, { sleeves: false }), { facing: 1, scale: 2 });
    if (a.ph === 'hold' || a.ph === 'jump') ballAt = [Math.round((J.hdL[0] + J.hdR[0]) / 2) + 2, Math.round((J.hdL[1] + J.hdR[1]) / 2) - 3];
    else if (a.ph === 'pick' && a.pt > 0.13) ballAt = [J.hdR[0] + 1, J.hdR[1]];
    if (ballAt) ballDraw(g, ballAt[0], ballAt[1], a.ball === 4, t);
    g.text(e.tag, a.x, J.head[1] - 18, col, { size: 'xs', align: 'center', outline: PAL.black });
    // flying balls
    for (const b of a.balls) {
      if (b.ph === 2 && b.y < BK.rimY + 16) { // inside the net: draw behind net lines
        ballDraw(g, b.x, b.y, b.m, t); drawHoop(g, s, a.net);
      } else ballDraw(g, b.x, b.y, b.m, t);
      if (b.ph === 0) { g.ellipse(b.x, FL - 1, 3, 1, 'rgba(0,0,0,0.2)'); }
    }
    // rack tracker
    for (let r = 0; r < nr; r++) {
      const x0 = 12 + r * 46, y0 = 20;
      g.rect(x0 - 2, y0 - 2, 44, 12, r === a.rack && a.ph !== 'over' ? 'rgba(254,231,97,0.25)' : 'rgba(24,20,37,0.6)');
      for (let b = 0; b < 5; b++) {
        const idx = r * 5 + b, mk = a.marks[idx];
        const cx = x0 + 3 + b * 8, cy = y0 + 4;
        if (mk == null) g.circleO(cx, cy, 3, '#5a6988');
        else if (mk > 0) g.circle(cx, cy, 3, b === 4 ? PAL.hotpink : '#e8762b');
        else { g.line(cx - 2, cy - 2, cx + 2, cy + 2, PAL.grey); g.line(cx - 2, cy + 2, cx + 2, cy - 2, PAL.grey); }
      }
    }
    // jump meter
    if (s.ph === 'play' && (a.ph === 'hold' || a.ph === 'jump' || a.ph === 'pick')) {
      const m = a.ph === 'jump' ? bkMeter(a.jt) : 0;
      vMeter(g, a.x + 22, 140, 8, 60, m, 0.9, 1, '');
      g.rect(a.x + 22, 140 + Math.round(60 * 0.04), 8, 1, PAL.yellow);
      hint(g, a.ph === 'jump' ? '꼭대기(초록)에서 {A} 떼기!' : '{A} 누르고 점프 → 꼭대기에서 떼기');
    }
    if (s.ph === 'play' && a.ph === 'over' && a.buzz) g.banner('TIME UP!', 92, PAL.red);
  }

  /* =========================================================== ENGINE === */
  OG.defineEngine('meter', {
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
    { id: 'snatch', name: '역도 인상', en: 'Weightlifting Snatch', sport: 'weightlifting', icon: '🏋️', tags: SUMMER, engine: 'meter',
      cfg: { kind: 'lift', short: '인상', open: 160, base: 110, cap: 190, cpuA: 150, cpuB: 32 },
      help: ['{U}{D} 무게 선택, {A} 확정', '{L}{R} 번갈아 연타: 바 당기기 → 초록 구간에서 {A}', '{L}{R}: 머리 위 균형 유지'] },
    { id: 'cleanjerk', name: '역도 용상', en: 'Weightlifting Clean & Jerk', sport: 'weightlifting', icon: '🏋️', tags: SUMMER, engine: 'meter',
      cfg: { kind: 'lift', cj: true, short: '용상', open: 195, base: 135, cap: 230, cpuA: 185, cpuB: 38 },
      help: ['{U}{D} 무게 선택, {L}{R} 연타로 클린 → 초록 구간에서 {A}', '저크: 미터가 초록 구간일 때 {A}', '{L}{R}: 균형 유지'] },
    { id: 'golf', name: '골프', en: 'Golf', sport: 'golf', icon: '⛳', tags: SUMMER, engine: 'meter', lowerBetter: true,
      cfg: { kind: 'golf' },
      help: ['{L}{R} 조준, {U}{D} 클럽 변경', '{A} 3번: 스윙 시작 → 파워 → 흰 선에서 정확도', '그린: {L}{R} 조준, {A} 두 번으로 퍼팅 세기'] },
    { id: 'curling', name: '컬링', en: 'Curling', sport: 'curling', icon: '🥌', tags: ['winter'], engine: 'meter',
      cfg: { kind: 'curl' },
      help: ['{L}{R} 목표 지점, {U}{D} 회전 방향, {A} 결정', '{A}: 움직이는 게이지에서 투구 세기', '{L}{R} 연타: 스위핑 — 더 멀리, 덜 휘게'] },
    { id: 'basket3pt', name: '농구 3점슛 콘테스트', en: '3-Point Contest', sport: 'basketball', icon: '🏀', tags: SUMMER, engine: 'meter',
      cfg: { kind: 'bask' },
      help: ['{A} 누르고 있으면 점프, 꼭대기에서 떼면 슛!', '랙마다 마지막 공은 머니볼 (2점)', '제한 시간 안에 최대한 많이 넣기'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
