/* =========================================================================
 * engine: net — 1-vs-1 side-view net / racket / wall games
 * (classic "Pikachu Volleyball" style). One engine, ten events (ev.cfg).
 *   ◀▶ move · ▲ jump · auto-swing when the ball is in reach
 *   ACTION pressed just before contact = power shot / SMASH (in the air = jump smash)
 *   hold toward the net while hitting = deep, away = short, ▼ = drop / lob / set
 * Coordinates: screen pixels. Feet / floor at FLOOR. Net at NX (except squash).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const W = 480, FLOOR = 228, NX = 240, DT = 1 / 60, PG = 980, LIMIT = 150, TOSS = 0.7;

  /* ------------------------------ configs ------------------------------ */
  const BASE = {
    drop: [0.12, 0.28], k: 0, rest: 0.7, fric: 0.9, trest: 0.85, tfric: 0.97, maxT: 1, table: null, walls: null, wallH: 0, sq: null,
    svc: 0, clear: 4, jump: 300, spd: 175, pmin: 12, gap: 12, serve: 'alt2', setH: 0, setX: 28, tossH: 44, racket: null
  };
  const mk = o => Object.assign({}, BASE, o);
  const RCH = (b, f, lo, hi, oh, id) => ({ b, f, lo, hi, oh, id });
  const CFG = {
    tennis: mk({ kind: 'racket', rule: 'ground', g: 430, r: 2.5, rest: 0.62, fric: 0.86, netH: 20, cL: 40, cR: 440, svc: 112,
      T: { n: 0.92, p: 0.58, s: 0.36, d: 0.66, l: 1.6 }, reach: RCH(-8, 30, 5, 66, 46, 16), spd: 160, home: 182, srvD: 200,
      target: 7, cap: 10, racket: 'tennis', ball: 'tennis', venue: 'tennis', clear: 5 }),
    soft_tennis: mk({ kind: 'racket', rule: 'ground', g: 380, r: 3, rest: 0.72, fric: 0.85, netH: 20, cL: 40, cR: 440, svc: 112,
      T: { n: 1.0, p: 0.64, s: 0.4, d: 0.72, l: 1.7 }, reach: RCH(-8, 30, 5, 66, 46, 16), spd: 160, home: 182, srvD: 200,
      target: 7, cap: 10, racket: 'soft', ball: 'soft', venue: 'clay', clear: 5 }),
    padel: mk({ kind: 'racket', rule: 'ground', g: 430, r: 2.5, rest: 0.6, fric: 0.86, netH: 19, cL: 44, cR: 436, svc: 76,
      walls: [44, 436], wallH: 92, T: { n: 0.9, p: 0.58, s: 0.36, d: 0.66, l: 1.5 }, reach: RCH(-8, 28, 5, 64, 46, 15),
      spd: 152, home: 150, srvD: 170, target: 7, cap: 10, racket: 'padel', ball: 'padel', venue: 'padel', clear: 5 }),
    table_tennis: mk({ kind: 'tt', rule: 'table', g: 620, r: 2, rest: 0.6, fric: 0.8, trest: 0.88, tfric: 0.97,
      table: { L: 148, R: 332, h: 26, curve: 0 }, drop: [0.3, 0.5], netH: 7, T: { n: 0.62, p: 0.38, s: 0.28, d: 0.72, l: 0.9 },
      reach: RCH(-6, 30, 22, 66, 999, 18), spd: 158, home: 118, srvD: 112, pmin: 14, target: 11, cap: 14,
      racket: 'tt', ball: 'tt', venue: 'tt', clear: 3, tossH: 26, jump: 220 }),
    badminton: mk({ kind: 'shuttle', rule: 'none', g: 640, k: 2.4, r: 2, rest: 0.15, fric: 0.4, netH: 40, cL: 36, cR: 444,
      T: { n: 1.15, p: 0.74, s: 0.5, d: 0.9, l: 1.4 }, reach: RCH(-8, 30, 6, 70, 46, 14), spd: 185, home: 104, srvD: 66,
      target: 15, cap: 18, serve: 'winner', racket: 'badminton', ball: 'shuttle', venue: 'badminton', clear: 6, tossH: 16, jump: 320 }),
    volleyball: mk({ kind: 'volley', rule: 'none', g: 360, r: 6, rest: 0.55, fric: 0.8, netH: 60, cL: 24, cR: 456,
      T: { n: 1.3, p: 0.9, s: 0.6, d: 1.1, l: 1.5 }, reach: RCH(-10, 26, 2, 62, 44, 10), spd: 175, home: 120, srvD: 226,
      maxT: 3, setH: 128, target: 11, cap: 14, serve: 'winner', ball: 'volley', venue: 'volley', clear: 6, jump: 330, tossH: 50 }),
    beach_volley: mk({ kind: 'volley', rule: 'none', g: 340, r: 6, rest: 0.25, fric: 0.5, netH: 56, cL: 44, cR: 436,
      T: { n: 1.3, p: 0.92, s: 0.62, d: 1.1, l: 1.5 }, reach: RCH(-10, 26, 2, 62, 44, 10), spd: 158, home: 110, srvD: 208,
      maxT: 3, setH: 124, target: 11, cap: 14, serve: 'winner', ball: 'beach', venue: 'beach', clear: 6, jump: 320, tossH: 50 }),
    sepak_takraw: mk({ kind: 'kick', rule: 'none', g: 380, r: 5, rest: 0.5, fric: 0.8, netH: 40, cL: 30, cR: 450,
      T: { n: 1.15, p: 0.8, s: 0.55, d: 1.0, l: 1.4 }, reach: RCH(-10, 28, 0, 58, 42, 12), spd: 172, home: 112, srvD: 112,
      maxT: 3, setH: 104, target: 11, cap: 14, serve: 'winner', ball: 'takraw', venue: 'takraw', clear: 6, jump: 330, tossH: 40 }),
    teqball: mk({ kind: 'teq', rule: 'table', g: 420, r: 5, rest: 0.5, fric: 0.8, trest: 0.62, tfric: 0.95,
      table: { L: 150, R: 330, h: 22, curve: 6 }, drop: [0.25, 0.45], netH: 8, T: { n: 0.85, p: 0.46, s: 0.34, d: 0.85, l: 1.1 },
      reach: RCH(-10, 30, 0, 62, 44, 16), maxT: 3, setH: 70, setX: 0, spd: 158, home: 128, srvD: 128, pmin: 14,
      target: 12, cap: 15, serve: 'winner', ball: 'teq', venue: 'teq', clear: 4, jump: 300, tossH: 30 }),
    squash: mk({ kind: 'squash', rule: 'squash', g: 520, r: 2, rest: 0.5, fric: 0.85, netH: 0,
      sq: { back: 36, front: 444, tin: 13, out: 122, svc: 48, wr: 0.92 }, T: { n: 1, p: 1, s: 1, d: 1, l: 1 },
      reach: RCH(-6, 30, 3, 66, 46, 16), spd: 200, home: 236, target: 11, cap: 14, serve: 'winner',
      racket: 'squash', ball: 'squash', venue: 'squash', tossH: 30 })
  };
  const cfgOf = s => OG.EVENT_MAP[s.evId].cfg;

  /* ------------------------------ physics ------------------------------ */
  function surfY(C, x) { // y of the playing surface at x (table top when over a table)
    const T = C.table;
    if (T && x >= T.L && x <= T.R) { const u = (x - NX) / ((T.R - T.L) / 2); return FLOOR - T.h + (T.curve || 0) * u * u; }
    return FLOOR;
  }
  const netBase = C => C.table ? FLOOR - C.table.h : FLOOR;
  const netTop = C => netBase(C) - C.netH;

  // advance a ball {x,y,vx,vy,fy} one step; returns list of events
  function stepBall(C, b, dt) {
    const px = b.x, py = b.y, r = C.r, evs = [];
    if (C.k > 0) {
      const E = Math.exp(-C.k * dt), F = (1 - E) / C.k, gk = C.g / C.k;
      b.x += b.vx * F; b.vx *= E;
      b.y += gk * dt + (b.vy - gk) * F; b.vy = gk + (b.vy - gk) * E;
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt + 0.5 * C.g * dt * dt; b.vy += C.g * dt;
    }
    // net
    if (!C.sq) {
      const sg = b.vx >= 0 ? 1 : -1, l0 = px + sg * r - NX, l1 = b.x + sg * r - NX;
      if (l0 * l1 <= 0 && l0 !== l1) {
        const k = M.clamp((NX - sg * r - px) / ((b.x - px) || 1e-6), 0, 1);
        const yc = py + (b.y - py) * k;
        if (yc + r > netTop(C) && yc - r < netBase(C)) {
          b.x = NX - sg * (r + 1); b.vx = -b.vx * 0.15; b.vy = b.vy * 0.3; evs.push('net');
        }
      }
    }
    // table
    const T = C.table;
    if (T && b.vy > 0 && b.x >= T.L - 1 && b.x <= T.R + 1) {
      const sy = surfY(C, M.clamp(b.x, T.L, T.R)), syp = surfY(C, M.clamp(px, T.L, T.R));
      if (b.y + r >= sy && py + r <= syp + 3) {
        b.y = sy - r;
        if (T.curve) {
          const half = (T.R - T.L) / 2, u = (b.x - NX) / half, sl = 2 * T.curve * u / half;
          const ln = Math.sqrt(1 + sl * sl), n0 = sl / ln, n1 = -1 / ln;
          const vn = b.vx * n0 + b.vy * n1;
          if (vn < 0) { b.vx -= (1 + C.trest) * vn * n0; b.vy -= (1 + C.trest) * vn * n1; b.vx *= C.tfric; }
        } else { b.vy = -b.vy * C.trest * (b.pow > 0 ? 0.85 : b.pow < 0 ? 0.85 : 1); b.vx *= b.pow > 0 ? 1 : b.pow < 0 ? 0.55 : C.tfric; }
        b.pow = 0;
        evs.push('table');
      }
    }
    // floor
    if (b.y + r >= FLOOR) {
      const hard = b.vy > 18;
      b.y = FLOOR - r;
      if (b.vy > 0) { b.vy = hard ? -b.vy * C.rest * (b.pow > 0 ? 0.85 : b.pow < 0 ? 0.85 : 1) : 0; b.vx *= hard ? (b.pow > 0 ? Math.max(C.fric, 0.97) : b.pow < 0 ? 0.55 : C.fric) : 0.95; }
      if (hard) { evs.push('floor'); b.pow = 0; }
    }
    // padel glass
    if (C.walls) {
      if (b.x - r < C.walls[0] && b.vx < 0 && b.y > FLOOR - C.wallH) { b.x = C.walls[0] + r; b.vx = -b.vx * 0.7; evs.push('wall'); }
      else if (b.x + r > C.walls[1] && b.vx > 0 && b.y > FLOOR - C.wallH) { b.x = C.walls[1] - r; b.vx = -b.vx * 0.7; evs.push('wall'); }
    }
    // squash walls
    if (C.sq) {
      const S = C.sq;
      if (b.x + r > S.front && b.vx > 0) { b.x = S.front - r; b.vx = -b.vx * S.wr; b.vy *= 0.85; b.fy = FLOOR - b.y; evs.push('front'); }
      else if (b.x - r < S.back && b.vx < 0) { b.x = S.back + r; b.vx = -b.vx * 0.6; evs.push('back'); }
    }
    if (b.x < -40 || b.x > W + 40 || b.y > 300) evs.push('gone');
    return evs;
  }

  // initial velocity to fly from (x0,y0) to (tx,ty) in T seconds (exact for our integrator)
  function solve(C, x0, y0, tx, ty, T) {
    if (C.k > 0) {
      const F = (1 - Math.exp(-C.k * T)) / C.k, gk = C.g / C.k;
      return [(tx - x0) / F, (ty - y0 - gk * T) / F + gk];
    }
    return [(tx - x0) / T, (ty - y0 - 0.5 * C.g * T * T) / T];
  }
  function yAtX(C, x0, y0, vx, vy, X) {
    if (Math.abs(vx) < 1e-3) return null;
    let t;
    if (C.k > 0) {
      const a = 1 - C.k * (X - x0) / vx;
      if (a <= 0.02) return null;
      t = -Math.log(a) / C.k;
      if (t < 0) return null;
      const F = (1 - Math.exp(-C.k * t)) / C.k, gk = C.g / C.k;
      return y0 + gk * t + (vy - gk) * F;
    }
    t = (X - x0) / vx;
    if (t < 0) return null;
    return y0 + vy * t + 0.5 * C.g * t * t;
  }
  // like solve, but lofts the shot until it clears the net by `clear` px
  function plan(C, x0, y0, tx, ty, T, clear) {
    let v = solve(C, x0, y0, tx, ty, T);
    if (clear < 0 || (x0 - NX) * (tx - NX) > 0) return v;
    for (let i = 0; i < 14; i++) {
      const yn = yAtX(C, x0, y0, v[0], v[1], NX);
      if (yn == null || yn + C.r + clear <= netTop(C)) break;
      T *= 1.12;
      v = solve(C, x0, y0, tx, ty, T);
    }
    return v;
  }

  /* ------------------------------ state ------------------------------ */
  function newBall() {
    return { x: NX, y: 120, vx: 0, vy: 0, rot: 0, last: 0, bounces: 0, netted: false, out: false, serve: false, touches: 0, ctl: false,
      wallOk: false, fy: 0, pow: 0, shot: 'n', ev: 0, hits: 0, tr: [], held: true };
  }
  function newPlayer(C, i) {
    return { x: homeX(C, i), h: 0, vx: 0, vh: 0, air: false, f: C.sq ? 1 : (i === 0 ? 1 : -1),
      sw: 9, sk: 'fh', wind: 9, pressT: 9, cool: 0, run: 0, cue: false, mood: 0, idle: 0,
      ai: { seen: -1, hitSeen: -1, wait: 0, tx: homeX(C, i), jt: -1, err: 0, mode: 'n', down: false, fwd: 0, pw: false } };
  }
  function homeX(C, i) { if (C.sq) return C.home; return i === 0 ? NX - C.home : NX + C.home; }
  function bounds(C, i) {
    if (C.sq) return [C.sq.back + 10, C.sq.front - 14];
    if (C.table) return i === 0 ? [C.pmin, C.table.L - 2] : [C.table.R + 2, W - C.pmin];
    return i === 0 ? [C.pmin, NX - C.gap] : [NX + C.gap, W - C.pmin];
  }
  const sideOf = x => x < NX ? 0 : 1;
  function handPos(p) { return [p.x + p.f * 7, FLOOR - p.h - 30]; }

  function pop(s, txt, x, y, c, big) {
    s.pops = s.pops.filter(q => q.s !== txt);
    s.pops.push({ s: txt, x: Math.round(x), y: Math.round(y), t: 0, c: c || PAL.yellow, big: big ? 1 : 0 });
    if (s.pops.length > 4) s.pops.shift();
  }
  function spawn(s, R, x, y, n, c, sp, up) {
    for (let i = 0; i < n; i++) {
      s.fx.push({ x: M.round(x + R.range(-3, 3), 1), y: M.round(y, 1), vx: M.round(R.range(-1, 1) * (sp || 40), 1),
        vy: M.round(-R.range(0.3, 1) * (up || 50), 1), l: M.round(R.range(0.3, 0.6), 2), c: c });
    }
    if (s.fx.length > 36) s.fx.splice(0, s.fx.length - 36);
  }
  function dustCol(C) { return C.venue === 'beach' ? '#f3e2bd' : C.venue === 'clay' ? '#d9774f' : '#e8e8f0'; }

  function setupServe(s, C, R) {
    const sv = s.server, rc = 1 - sv;
    s.phase = 'serve'; s.st = 0; s.toss = -1; s.rt = 0; s.dead = 0; s.rally = 0;
    s.P.forEach((p, i) => {
      p.h = 0; p.vh = 0; p.air = false; p.vx = 0; p.sw = 9; p.wind = 9; p.cool = 0; p.mood = 0; p.cue = false;
      p.x = homeX(C, i); p.ai.jt = -1; p.ai.tx = p.x;
    });
    const ps = s.P[sv];
    if (C.sq) { ps.x = 196; s.P[rc].x = 118; s.turn = sv; } else ps.x = sv === 0 ? NX - C.srvD : NX + C.srvD;
    const b = s.ball = newBall();
    b.last = sv;
    const hp = handPos(ps); b.x = hp[0]; b.y = hp[1];
    ps.ai.wait = R.range(0.4, 0.8);
    ps.ai.pw = R.chance(0.25 + 0.45 * s.ents[sv].skill) && s.fault === 0;
    ps.ai.down = R.chance(0.15); ps.ai.fwd = R.pick([-1, 0, 1]);
  }

  /* ------------------------------ rules ------------------------------ */
  function award(s, C, w, why, R) {
    if (s.phase !== 'rally') return;
    const l = 1 - w, b = s.ball;
    s.sc[w]++; s.fault = 0;
    s.phase = 'point'; s.pt = 0; s.lastW = w;
    const px = b.x, py = Math.min(FLOOR - 30, b.y - 14);
    if (why) pop(s, why, M.clamp(px, 60, 420), M.clamp(py, 60, 170), why === 'OUT' || why === 'NET' || why === 'TIN' || why === 'FAULT' || why === 'DOWN' || why === 'DOUBLE FAULT' ? PAL.red : PAL.yellow, why === 'ACE!');
    s.P[w].mood = 1; s.P[l].mood = -1;
    OG.sfx(s, C.kind === 'volley' || C.kind === 'kick' ? 'whistle' : 'ding');
    OG.sfx(s, 'cheer');
    s.excite = 1.6;
    if (C.serve === 'winner') s.server = w;
    else { const n = s.sc[0] + s.sc[1]; s.server = (s.first + Math.floor((n + 1) / 2)) % 2; }
    const a = s.sc[w], o = s.sc[l];
    if ((a >= C.target && a - o >= 2) || a >= C.cap || s.golden) s.winner = w;
    else if (s.clock >= LIMIT) { if (a !== o) s.winner = a > o ? w : l; else s.golden = true; }
  }
  function serveFault(s, C, R) {
    if (s.fault === 0) {
      s.fault = 1; s.phase = 'pause'; s.pt = 0;
      pop(s, 'FAULT', M.clamp(s.ball.x, 60, 420), 150, PAL.red);
      OG.sfx(s, 'miss');
      return;
    }
    award(s, C, 1 - s.ball.last, 'DOUBLE FAULT', R);
  }
  function onEvent(s, C, e, R) {
    const b = s.ball, side = sideOf(b.x), h = b.last, o = 1 - h;
    if (e === 'net') { b.netted = true; return; }
    if (C.rule === 'ground') {
      if (e === 'floor') {
        if (b.bounces === 0) {
          if (side === h) { if (b.serve) return serveFault(s, C, R); return award(s, C, o, b.netted ? 'NET' : 'FAULT', R); }
          if (b.serve && Math.abs(b.x - NX) > C.svc + 1) return serveFault(s, C, R);
          const inC = side === 0 ? b.x >= C.cL - 1 : b.x <= C.cR + 1;
          if (!inC) return award(s, C, o, 'OUT', R);
          b.bounces = 1; b.ev++; return;
        }
        return award(s, C, h, b.serve ? 'ACE!' : (b.shot === 'p' || b.shot === 's' ? 'WINNER!' : ''), R);
      }
      if (e === 'wall') { if (b.bounces === 0) return award(s, C, o, 'OUT', R); b.ev++; return; }
      if (e === 'gone') return award(s, C, b.bounces === 0 ? o : h, b.bounces === 0 ? 'OUT' : '', R);
    } else if (C.rule === 'table') {
      if (e === 'table') {
        if (side === h) return award(s, C, o, b.netted ? 'NET' : 'FAULT', R);
        if (b.bounces === 0) { b.bounces = 1; b.ev++; return; }
        return award(s, C, h, b.serve ? 'ACE!' : '', R);
      }
      if (e === 'floor' || e === 'gone') {
        if (b.bounces === 0) return award(s, C, o, b.netted ? 'NET' : 'OUT', R);
        return award(s, C, h, b.serve ? 'ACE!' : (b.shot === 'p' || b.shot === 's' ? 'WINNER!' : ''), R);
      }
    } else if (C.rule === 'none') {
      if (e === 'floor' || e === 'gone') {
        if (side === h) return award(s, C, o, b.netted ? 'NET' : (e === 'gone' ? 'OUT' : ''), R);
        if (e === 'gone' || b.x < C.cL - 1 || b.x > C.cR + 1) return award(s, C, side, 'OUT', R);
        return award(s, C, h, b.serve ? 'ACE!' : (b.pow === 2 ? 'KILL!' : 'IN'), R);
      }
    } else if (C.rule === 'squash') {
      const S = C.sq;
      if (e === 'front') {
        if (b.wallOk) { b.ev++; return; }
        if (b.fy < S.tin) return award(s, C, o, 'TIN', R);
        if (b.fy > S.out) return award(s, C, o, 'OUT', R);
        if (b.serve && b.fy < S.svc) return award(s, C, o, 'FAULT', R);
        b.wallOk = true; b.bounces = 0; b.ev++; return;
      }
      if (e === 'floor') {
        if (!b.wallOk) return award(s, C, o, 'DOWN', R);
        b.bounces++; b.ev++;
        if (b.bounces >= 2) return award(s, C, h, b.serve ? 'ACE!' : (b.shot === 'p' || b.shot === 's' ? 'WINNER!' : ''), R);
        return;
      }
      if (e === 'back') { b.ev++; return; }
      if (e === 'gone') return award(s, C, b.wallOk ? h : o, 'OUT', R);
    }
  }
  function deadBall(s, C, R) { // ball came to rest without a decisive event
    const b = s.ball, side = sideOf(b.x), h = b.last;
    if (C.sq) return award(s, C, b.wallOk ? h : 1 - h, '', R);
    return award(s, C, side === h ? 1 - h : h, '', R);
  }
  // will this fresh shot land out (so the receiver should let it go)?
  function landsOut(C, b0, h) {
    const c = { x: b0.x, y: b0.y, vx: b0.vx, vy: b0.vy, fy: 0, pow: b0.pow };
    for (let k = 0; k < 300; k++) {
      const evs = stepBall(C, c, DT);
      for (const e of evs) {
        if (e === 'net' || e === 'table') return false;
        if (e === 'gone' || e === 'wall') return true;
        if (e === 'floor') {
          if (C.table) return true;
          return sideOf(c.x) !== h && (c.x < C.cL - 1 || c.x > C.cR + 1 || (C.svc && b0.serve && Math.abs(c.x - NX) > C.svc + 1));
        }
      }
    }
    return false;
  }
  function canHit(s, C, i) {
    const b = s.ball, side = sideOf(b.x);
    if (b.held) return false;
    if (b.out && b.bounces === 0 && b.last !== i) return false;
    switch (C.rule) {
      case 'ground': return b.last !== i && side === i && !b.netted && (b.serve ? b.bounces === 1 : b.bounces <= 1);
      case 'table':
        if (b.last === i) return C.maxT > 1 && b.ctl && b.touches < C.maxT;
        return b.bounces === 1 && !b.netted;
      case 'none':
        if (side !== i || b.netted) return false;
        return b.last !== i || (b.ctl && b.touches < C.maxT);
      case 'squash': return s.turn === i && b.wallOk && b.bounces <= 1;
    }
    return false;
  }
  function inReach(C, p, b) {
    const fx = (b.x - p.x) * p.f, hy = FLOOR - b.y - p.h, Q = C.reach;
    return fx >= Q.b && fx <= Q.f && hy >= Q.lo && hy <= Q.hi;
  }

  /* ------------------------------ hitting ------------------------------ */
  function animKind(C, kind, high, air, serve) {
    if (C.kind === 'volley') return kind === 'set' ? 'set' : serve ? 'spike' : (air && high) ? 'spike' : high ? 'set' : 'bump';
    if (C.kind === 'kick' || C.kind === 'teq') return serve ? 'kick' : (air && high) ? 'bike' : high ? 'head' : 'kick';
    if (serve) return C.kind === 'racket' && C.racket !== 'padel' ? 'oh' : 'fh';
    return high ? 'oh' : 'fh';
  }
  function doHit(s, C, i, sh, R) {
    const b = s.ball, p = s.P[i], e = s.ents[i];
    const dir = C.sq ? 1 : (i === 0 ? 1 : -1);
    const hy = FLOOR - b.y - p.h, high = hy > C.reach.oh;
    const touches = (b.last === i && !b.serve && !b.held) ? b.touches + 1 : 1;
    const inPow = b.last === i || b.held ? 0 : b.shot === 's' ? 2 : b.shot === 'p' ? 1 : 0;
    let kind = 'n';
    if (sh.serve) kind = sh.power ? 'p' : (sh.down ? 'd' : 'n');
    else if (sh.down && C.maxT > 1 && touches < C.maxT) kind = 'set';
    else if (sh.down) kind = C.kind === 'racket' ? 'l' : 'd';
    else if (sh.power && C.kind === 'tt') kind = FLOOR - b.y > C.table.h + 20 ? 's' : 'p';
    else if (sh.power && high && (p.air || C.kind === 'racket' || C.kind === 'shuttle' || C.kind === 'squash')) kind = 's';
    else if (sh.power) kind = 'p';
    let err = '';
    if (!e.human && kind !== 'set') {
      let ep = (0.012 + 0.17 * Math.pow(1 - e.skill, 1.6)) * (kind === 's' ? 1.3 : 1) * (1 + s.rally * 0.06);
      if (inPow === 1) ep += 0.07 * (1.3 - e.skill);
      else if (inPow === 2) ep += ((C.kind === 'volley' || C.kind === 'kick') ? 0.32 : 0.18) * (1.25 - e.skill);
      if (sh.serve) ep = s.fault === 0 && kind === 'p' ? 0.08 + 0.12 * (1 - e.skill) : 0.02;
      if (C.sq) ep *= 0.75;
      if (C.kind === 'teq') ep *= 0.9;
      if (R.chance(ep)) err = R.chance(0.5) ? 'net' : 'out';
    } else if (e.human && inPow > 0 && !sh.power && kind !== 'set' && R.chance(inPow === 2 ? (C.kind === 'volley' || C.kind === 'kick' ? 0.14 : 0.22) : 0.07)) err = R.chance(0.6) ? 'net' : 'out';
    let vx, vy;
    if (kind === 'set') {
      const tx = C.table ? (dir > 0 ? Math.min(b.x, C.table.L) - 12 : Math.max(b.x, C.table.R) + 12) : NX - dir * C.setX;
      const up = Math.max(12, b.y - (FLOOR - C.setH));
      vy = -Math.sqrt(2 * C.g * up);
      const tUp = -vy / C.g;
      vx = M.clamp((tx - b.x) / (tUp * 1.7), -110, 110);
    } else if (C.sq) {
      const S = C.sq;
      let hg, sp;
      if (kind === 'p') { hg = 24; sp = 370; } else if (kind === 's') { hg = 19; sp = 430; }
      else if (kind === 'd') { hg = 17; sp = 190; } else if (kind === 'l') { hg = 100; sp = 250; }
      else { hg = 34 + R.f() * 18; sp = 310; }
      hg += -sh.fwd * 12 + R.range(-3, 3);
      if (sh.serve) { hg = S.svc + 14 + R.f() * 22; sp = 290; }
      const dist = Math.max(10, S.front - b.x), cur = FLOOR - b.y;
      hg = Math.min(hg, cur + dist * 0.7 + 10);
      hg = M.clamp(hg, S.tin + 3, S.out - 6);
      if (err === 'net') hg = S.tin - 5; else if (err === 'out') hg = S.out + 10;
      const tx = S.front - C.r, T = Math.max(0.12, (tx - b.x) / sp);
      [vx, vy] = solve(C, b.x, b.y, tx, FLOOR - hg, T);
    } else {
      let d, T;
      if (kind === 'p') { d = 0.8; T = C.T.p; } else if (kind === 's') { d = 0.55; T = C.T.s; }
      else if (kind === 'd') { d = (C.drop[0] + C.drop[1]) / 2; T = C.T.d; } else if (kind === 'l') { d = 0.86; T = C.T.l; }
      else { d = 0.58; T = C.T.n; }
      const weak = inPow > 0 && kind === 'n' && !sh.serve;
      d += sh.fwd * (kind === 'd' ? 0.08 : 0.2) + R.range(-0.09, 0.09) * (e.human ? 0.6 : 1.4 - e.skill * 0.6);
      if (!e.human && !sh.serve && !weak && (kind === 'n' || kind === 'p' || kind === 's')) { // smart placement
        const pk = pickShot(s, C, i, b, kind, R);
        if (pk) { d = pk.d + R.range(-0.05, 0.05) * (1.2 - e.skill); T = pk.T; kind = pk.kind; }
      }
      let half = C.table ? (C.table.R - C.table.L) / 2 : (dir > 0 ? C.cR - NX : NX - C.cL);
      if (sh.serve && C.svc) { half = C.svc; d = (kind === 'p' ? 0.84 : kind === 'd' ? 0.45 : 0.68) + sh.fwd * 0.1 + R.range(-0.08, 0.08); }
      if (weak) { d = R.range(0.3, 0.62); T *= 1.3; }
      d = M.clamp(d, 0.1, C.table ? 0.88 : 0.93);
      if (err === 'out') d = 1.06 + R.f() * 0.16;
      const tx = NX + dir * d * half, ty = (C.table && d > 1 ? FLOOR - C.table.h : surfY(C, tx)) - C.r + (d > 1 ? 0 : 2);
      T *= 0.88 + 0.24 * Math.min(1, d);
      if (err === 'net') { [vx, vy] = solve(C, b.x, b.y, NX, netTop(C) + Math.min(C.netH * 0.6, 6), T * 0.45); }
      else [vx, vy] = plan(C, b.x, b.y, tx, ty, T, C.clear);
    }
    b.vx = vx; b.vy = vy; b.last = i; b.bounces = 0; b.netted = false; b.serve = !!sh.serve; b.touches = touches;
    b.ctl = kind === 'set'; b.wallOk = false; b.pow = kind === 's' ? 2 : kind === 'p' ? 1 : kind === 'd' ? -1 : 0; b.shot = kind; b.ev++; b.hits++; b.tr = []; b.held = false;
    if (C.sq) s.turn = 1 - i;
    b.out = !C.sq && kind !== 'set' && landsOut(C, b, i);
    s.rally++;
    p.sw = 0; p.sk = animKind(C, kind, high, p.air, sh.serve); p.cool = 0.22; p.wind = 9; p.pressT = 9;
    const kickish = C.kind === 'kick' || C.kind === 'teq';
    OG.sfx(s, kickish ? 'kick' : C.kind === 'volley' ? 'punch' : 'hit');
    if (kind === 's') {
      pop(s, C.kind === 'volley' || kickish ? 'SPIKE!' : 'SMASH!', M.clamp(b.x, 70, 410), M.clamp(b.y - 26, 40, 170), PAL.orange, true);
      s.shake = 0.3; s.flash = 0.12; s.excite = Math.max(s.excite, 1);
      OG.sfx(s, 'whoosh');
      spawn(s, R, b.x, b.y, 6, PAL.yellow, 90, 80);
    } else if (kind === 'p') { OG.sfx(s, 'swing'); s.shake = Math.max(s.shake, 0.1); }
    if (sh.serve && kind === 'p' && !kickish) pop(s, 'POWER!', M.clamp(b.x, 70, 410), M.clamp(b.y - 24, 40, 170), PAL.cyan);
  }

  /* -------------------------------- AI -------------------------------- */
  // how hard is this placement for the opponent to reach? (>0 = probably unreachable)
  function shotDifficulty(s, C, i, x0, y0, d, T, pw) {
    const dir = i === 0 ? 1 : -1, half = C.table ? (C.table.R - C.table.L) / 2 : (dir > 0 ? C.cR - NX : NX - C.cL);
    const tx = NX + dir * d * half, v = plan(C, x0, y0, tx, surfY(C, tx) - C.r + 2, T * (0.88 + 0.24 * d), C.clear);
    const op = s.P[1 - i], oe = s.ents[1 - i], spd = C.spd * (oe.human ? 1 : 0.72 + 0.3 * oe.skill), Q = C.reach;
    const hiR = Q.hi + (C.kind === 'racket' || C.kind === 'tt' ? 0 : C.jump * C.jump / (2 * PG) * 0.6);
    const c = { x: x0, y: y0, vx: v[0], vy: v[1], fy: 0, pow: pw };
    let bo = 0, best = -9;
    for (let k = 1; k <= 200; k++) {
      const evs = stepBall(C, c, DT);
      let stop = false;
      for (const e of evs) {
        if (e === 'net' || e === 'gone' || (e === 'wall' && bo === 0)) return -99;
        if (C.rule === 'ground' && e === 'floor') { if (bo === 0 && (c.x < C.cL - 1 || c.x > C.cR + 1)) return -99; if (++bo >= 2) stop = true; }
        else if (C.rule === 'table') { if (e === 'table') { if (++bo >= 2) stop = true; } else if (e === 'floor') { if (bo === 0) return -99; stop = true; } }
        else if (C.rule === 'none' && e === 'floor') { if (c.x < C.cL - 1 || c.x > C.cR + 1) return -99; stop = true; }
      }
      if (stop) break;
      if (k % 3) continue;
      const ok = sideOf(c.x) === 1 - i && (C.rule === 'ground' ? bo <= 1 : C.rule === 'table' ? bo === 1 : true);
      const hg = FLOOR - c.y;
      if (!ok || hg < Q.lo + 3 || hg > hiR - 3) continue;
      best = Math.max(best, k * DT - (Math.abs(c.x - op.f * Q.id - op.x) / spd + 0.28));
      if (best > 0.3) break;
    }
    return -best;
  }
  function pickShot(s, C, i, b, kind, R) {
    const e = s.ents[i], pw = kind === 's' ? 2 : kind === 'p' ? 1 : 0, T0 = C.T[kind] || C.T.n;
    const opts = (kind === 's' ? [0.35, 0.6, 0.88] : [0.45, 0.7, 0.9]).map(d => ({ d: d, T: T0, kind: kind, sc: 0 }));
    if (kind !== 's') opts.push({ d: (C.drop[0] + C.drop[1]) / 2, T: C.T.d, kind: 'd', sc: 0 });
    let best = null;
    opts.forEach(o => {
      o.sc = shotDifficulty(s, C, i, b.x, b.y, o.d, o.T, o.kind === 'd' ? -1 : pw);
      if (o.sc > -50 && (!best || o.sc > best.sc)) best = o;
    });
    if (!best) return null;
    const sm = C.kind === 'racket' || C.kind === 'tt' || C.kind === 'teq' ? 0.85 : 0.3;
    if (R.chance((0.15 + 0.7 * e.skill) * sm)) return best;
    return R.pick(opts.filter(o => o.sc > -50));
  }
  function predict(s, C, i) {
    const b = s.ball, c = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, fy: 0, pow: b.pow }, out = [];
    let bo = b.bounces, wall = b.wallOk;
    for (let k = 1; k <= 210; k++) {
      const evs = stepBall(C, c, DT);
      let stop = false;
      for (const e of evs) {
        if (e === 'net' || e === 'gone') stop = true;
        else if (C.rule === 'ground') { if (e === 'floor' && ++bo >= 2) stop = true; }
        else if (C.rule === 'table') { if (e === 'table') { if (++bo >= 2) stop = true; } else if (e === 'floor') stop = true; }
        else if (C.rule === 'none') { if (e === 'floor') stop = true; }
        else if (C.rule === 'squash') {
          if (e === 'front') { wall = true; bo = 0; } else if (e === 'floor') { if (!wall || ++bo >= 2) stop = true; }
        }
      }
      if (stop) break;
      if (k % 2) continue;
      const side = sideOf(c.x);
      let ok = false;
      if (C.rule === 'ground') ok = b.last !== i && side === i && (b.serve ? bo === 1 : bo <= 1);
      else if (C.rule === 'table') ok = b.last === i ? (b.ctl && b.touches < C.maxT) : bo === 1;
      else if (C.rule === 'none') ok = side === i && (b.last !== i || (b.ctl && b.touches < C.maxT));
      else ok = s.turn === i && wall && bo <= 1;
      if (ok) out.push([k * DT, c.x, FLOOR - c.y, bo]);
    }
    return out;
  }
  function riseTime(C, dh) { // time for a jump to gain dh px
    const J = C.jump, disc = J * J - 2 * PG * Math.max(0, dh);
    return disc <= 0 ? J / PG : (J - Math.sqrt(disc)) / PG;
  }
  function replan(s, C, i, R) {
    const p = s.P[i], A = p.ai, b = s.ball, sk = s.ents[i].skill;
    A.seen = b.ev;
    if (A.hitSeen !== b.hits) {
      A.hitSeen = b.hits;
      if (b.last !== i || (C.sq && !b.ctl)) {
        A.wait = M.clamp(0.3 - 0.22 * sk + R.range(-0.04, 0.06), 0.05, 0.42);
        A.err = M.round(R.gauss() * (5 + 14 * (1 - sk)) * (1 + 0.5 * b.pow), 1);
        const att = R.chance(0.3 + 0.6 * sk);
        A.mode = (C.maxT > 1 && R.chance(C.kind === 'teq' ? 0.35 : 0.3 + 0.4 * sk)) ? 'set' : (att ? 'att' : 'n');
        A.pw = R.chance((0.3 + 0.45 * sk) * (C.sq ? 0.45 : C.kind === 'teq' ? 1.3 : 1)); A.down = C.maxT === 1 && R.chance(0.13); A.fwd = R.pick([-1, 0, 0, 1]);
      } else {
        A.wait = 0.02; A.err = 0; A.mode = 'spike'; A.pw = true; A.down = false; A.fwd = R.pick([0, 1]);
      }
    }
    A.jt = -1;
    const bd = bounds(C, i);
    if (C.sq ? s.turn !== i : (b.last === i && !b.ctl)) { A.tx = homeX(C, i) + (C.sq ? (i === s.ball.last ? -20 : 20) : 0); return; }
    if (b.out && b.last !== i && b.bounces === 0) { A.tx = homeX(C, i); return; }
    const cand = predict(s, C, i);
    if (!cand.length) { A.tx = homeX(C, i); return; }
    const spd = C.spd * (0.72 + 0.3 * sk), Q = C.reach, lo = Q.lo + 5, hi = Q.hi - 6, jh = C.jump * C.jump / (2 * PG);
    const reachT = (x, t) => Math.abs(x - p.x) / spd + A.wait <= t;
    let best = null, late = 1e9, fb = null;
    if ((A.mode === 'spike' || A.mode === 'att') && C.kind !== 'tt') {
      for (const c of cand) {
        if (c[2] < hi + 4 || c[2] > hi + jh - 4) continue;
        if (C.rule === 'ground' && c[3] > 0) continue;
        const x = M.clamp(c[1] - p.f * (Q.id - 6), bd[0], bd[1]);
        const rt = riseTime(C, c[2] - hi + 4);
        if (c[0] >= rt + 0.02 && reachT(x, c[0])) { best = c; A.tx = x; A.jt = c[0] - rt; A.pw = true; break; }
      }
    }
    if (!best) {
      const post = C.rule === 'ground' && cand.some(q => q[3] === 1 && q[2] >= lo && q[2] <= hi);
      const back = C.sq && cand.some(q => q[2] >= lo && q[2] <= hi && q[1] < C.sq.front - 120);
      for (const c of cand) {
        if (c[2] < lo || c[2] > hi) continue;
        if (post && c[3] === 0 && Math.abs(c[1] - NX) > 80) continue;
        if (back && c[1] >= C.sq.front - 120) continue;
        const x = M.clamp(c[1] - p.f * Q.id, bd[0], bd[1]);
        if (reachT(x, c[0])) { best = c; A.tx = x; break; }
        const lt = Math.abs(x - p.x) / spd + A.wait - c[0];
        if (lt < late) { late = lt; fb = x; }
      }
      if (!best) A.tx = fb != null ? fb : homeX(C, i);
      if (A.mode === 'spike') A.pw = false;
    }
    A.tx = M.clamp(A.tx + A.err, bd[0], bd[1]);
  }
  function aiInput(s, C, i, dt, R) {
    const o = OG.blankInput(), p = s.P[i], A = p.ai, b = s.ball;
    let tx = p.x;
    if (s.phase === 'serve') {
      if (s.server === i) {
        A.wait -= dt;
        if (s.toss < 0) { if (A.wait <= 0) o.a = o.ap = true; }
        else if (A.pw && s.toss / TOSS >= 0.45) o.a = o.ap = true;
      } else tx = homeX(C, i) + (C.sq ? -4 : 0);
    } else if (s.phase === 'rally') {
      if (A.seen !== b.ev) replan(s, C, i, R);
      if (A.wait > 0) A.wait -= dt; else tx = A.tx;
      if (A.jt > -1) { A.jt -= dt; if (A.jt <= 0) { o.u = o.up = true; A.jt = -1; } }
    }
    const d = tx - p.x;
    if (d > 2.5) o.r = true; else if (d < -2.5) o.l = true;
    return o;
  }

  /* ---------------------------- init / update ---------------------------- */
  function init(ev, ents, opts, R) {
    const C = ev.cfg;
    const s = {
      evId: ev.id, t: -3, phase: 'intro', pt: 0, clock: 0, st: 0, toss: -1, rt: 0, dead: 0, rally: 0,
      ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name, tag: e.tag || '', skill: e.skill, look: e.look })),
      sc: [0, 0], server: R.i(2), first: 0, fault: 0, turn: 0, golden: false, winner: -1, lastW: -1,
      P: [newPlayer(C, 0), newPlayer(C, 1)], ball: newBall(), fx: [], pops: [],
      shake: 0, netK: 0, wallK: 0, wallX: 0, wallY: 0, excite: 0, flash: 0, done: false
    };
    s.first = s.server;
    setupServe(s, C, R);
    s.phase = 'intro';
    return s;
  }
  function movePlayer(s, C, i, inp, dt, R) {
    const p = s.P[i], e = s.ents[i];
    const lock = (s.phase === 'serve' && s.server === i) || s.phase === 'end' || s.phase === 'intro';
    let mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    if (lock) mx = 0;
    const spd = C.spd * (e.human ? 1 : 0.72 + 0.3 * e.skill);
    p.vx = M.approach(p.vx, mx * spd, 1700 * dt);
    p.x += p.vx * dt;
    const bd = bounds(C, i);
    if (p.x < bd[0]) { p.x = bd[0]; p.vx = 0; } else if (p.x > bd[1]) { p.x = bd[1]; p.vx = 0; }
    if (Math.abs(p.vx) > 15 && !p.air) {
      const ph = p.run;
      p.run = (p.run + dt * Math.abs(p.vx) / 46) % 1;
      if ((ph < 0.5) !== (p.run < 0.5) && C.venue === 'beach') spawn(s, R, p.x, FLOOR, 1, '#f3e2bd', 20, 30);
    }
    if (inp.up && !p.air && !lock && s.phase !== 'end') {
      p.vh = C.jump; p.air = true; OG.sfx(s, 'jump');
      spawn(s, R, p.x, FLOOR, 3, dustCol(C), 40, 30);
    }
    if (p.air) {
      p.h += p.vh * dt - 0.5 * PG * dt * dt; p.vh -= PG * dt;
      if (p.h <= 0) { p.h = 0; p.air = false; p.vh = 0; spawn(s, R, p.x, FLOOR, 3, dustCol(C), 50, 25); }
    }
    if (inp.ap) { p.pressT = 0; if (p.sw > 0.25) p.wind = 0; }
    p.idle = (inp.l || inp.r || inp.u || inp.d || inp.a) ? 0 : Math.min(99, M.round(p.idle + dt, 3));
    p.pressT = Math.min(9, p.pressT + dt); p.sw = Math.min(9, p.sw + dt); p.wind = Math.min(9, p.wind + dt);
    p.cool = Math.max(0, p.cool - dt);
    p.x = M.round(p.x, 2); p.h = M.round(p.h, 2);
  }
  function cueFor(s, C, i) {
    if (!canHit(s, C, i)) return false;
    const b = s.ball, p = s.P[i], c = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, fy: 0, pow: b.pow };
    for (let k = 0; k < 16; k++) { stepBall(C, c, DT); if (inReach(C, p, c)) return true; }
    return false;
  }
  function update(s, inputs, dt, R) {
    const C = cfgOf(s), b = s.ball;
    s.t += dt;
    s.shake = Math.max(0, s.shake - dt); s.netK = Math.max(0, s.netK - dt); s.wallK = Math.max(0, s.wallK - dt);
    s.excite = Math.max(0, s.excite - dt * 0.6); s.flash = Math.max(0, s.flash - dt);
    for (let k = s.fx.length - 1; k >= 0; k--) {
      const f = s.fx[k];
      f.x = M.round(f.x + f.vx * dt, 1); f.y = M.round(f.y + f.vy * dt, 1); f.vy = M.round(f.vy + 200 * dt, 1); f.l = M.round(f.l - dt, 3);
      if (f.l <= 0) s.fx.splice(k, 1);
    }
    for (let k = s.pops.length - 1; k >= 0; k--) { s.pops[k].t = M.round(s.pops[k].t + dt, 3); if (s.pops[k].t > 1.3) s.pops.splice(k, 1); }
    if (s.t < 0) { const hp = handPos(s.P[s.server]); b.x = hp[0]; b.y = hp[1]; return; }
    if (s.phase === 'intro') { s.phase = 'serve'; OG.sfx(s, 'whistle'); }
    if (s.phase !== 'end') s.clock += dt;
    const ins = [0, 1].map(i => {
      const e = s.ents[i];
      return e.human ? (inputs[e.pid] || OG.blankInput()) : aiInput(s, C, i, dt, R);
    });
    for (let i = 0; i < 2; i++) movePlayer(s, C, i, ins[i], dt, R);

    if (s.phase === 'serve') {
      const sv = s.server, p = s.P[sv], inp = ins[sv];
      s.st += dt;
      const hp = handPos(p);
      if (s.toss < 0) {
        b.x = hp[0]; b.y = hp[1];
        if (inp.ap || (s.ents[sv].human && s.st > 3)) { s.toss = 0; OG.sfx(s, 'swing'); }
      } else {
        s.toss += dt;
        const u = s.toss / TOSS;
        b.x = hp[0] + p.f * 3; b.y = hp[1] - C.tossH * 4 * u * (1 - u) - (C.kind === 'racket' ? 18 * u : 0);
        const power = s.ents[sv].human ? (inp.ap && u >= 0.3) : (inp.ap && u >= 0.3);
        if (power || u >= 0.8) {
          const mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
          const A = p.ai, hum = s.ents[sv].human;
          s.phase = 'rally';
          b.held = false;
          doHit(s, C, sv, { serve: true, power: power, fwd: hum ? mx * p.f : A.fwd, down: hum ? !!inp.d : A.down }, R);
        }
      }
    } else {
      // ball flight
      const px = b.x, py = b.y;
      const evs = stepBall(C, b, dt);
      b.rot = M.round((b.rot + b.vx * dt * 0.09) % 6.283, 3);
      b.x = M.round(b.x, 3); b.y = M.round(b.y, 3); b.vx = M.round(b.vx, 3); b.vy = M.round(b.vy, 3);
      if (b.pow > 0 && s.phase === 'rally') { b.tr.push([Math.round(px), Math.round(py)]); if (b.tr.length > 8) b.tr.shift(); }
      else if (b.tr.length) b.tr.shift();
      for (const e of evs) {
        if (e === 'floor') { OG.sfx(s, 'bounce'); spawn(s, R, b.x, FLOOR, C.venue === 'beach' ? 6 : 3, dustCol(C), 50, 50); }
        else if (e === 'table') OG.sfx(s, 'bounce');
        else if (e === 'net') { s.netK = 0.5; OG.sfx(s, 'net'); }
        else if (e === 'wall' || e === 'front' || e === 'back') { OG.sfx(s, 'block'); s.wallK = 0.25; s.wallY = Math.round(b.y); s.wallX = Math.round(b.x); }
        if (s.phase === 'rally') onEvent(s, C, e, R);
      }
      if (s.phase === 'rally') {
        s.rt += dt;
        const order = C.sq ? [s.turn, 1 - s.turn] : [0, 1];
        for (const i of order) {
          const p = s.P[i];
          if (s.phase !== 'rally' || p.cool > 0 || !canHit(s, C, i) || !inReach(C, p, b)) continue;
          const e = s.ents[i], inp = ins[i];
          if (e.human && p.idle > 8) continue; // AFK: no auto-swing
          if (e.human) {
            const mx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
            doHit(s, C, i, { power: p.pressT <= 0.24, fwd: mx * p.f, down: !!inp.d }, R);
          } else {
            const A = p.ai;
            doHit(s, C, i, { power: A.pw, fwd: A.fwd, down: A.mode === 'set' || A.down }, R);
          }
          break;
        }
        for (let i = 0; i < 2; i++) s.P[i].cue = s.ents[i].human && s.phase === 'rally' && cueFor(s, C, i);
        const rest = b.y >= FLOOR - C.r - 0.6 && Math.abs(b.vy) < 1 && Math.abs(b.vx) < 30;
        s.dead = rest ? s.dead + dt : 0;
        if (s.phase === 'rally' && (s.dead > 0.45 || s.rt > 25)) deadBall(s, C, R);
      }
    }
    if (s.phase === 'point' || s.phase === 'pause') {
      s.pt += dt;
      if (s.pt > (s.phase === 'pause' ? 0.9 : 1.35)) {
        if (s.winner >= 0) { s.phase = 'end'; s.pt = 0; OG.sfx(s, 'whistle'); OG.sfx(s, 'cheer'); s.excite = 3; }
        else setupServe(s, C, R);
      }
    } else if (s.phase === 'end') {
      s.pt += dt;
      s.P[s.winner].mood = 2; s.P[1 - s.winner].mood = -1;
      if (s.pt > 2.4 && !s.done) {
        const w = s.winner, l = 1 - w;
        s.results = [{ idx: s.ents[w].idx, text: s.sc[w] + ' : ' + s.sc[l] }, { idx: s.ents[l].idx, text: s.sc[l] + ' : ' + s.sc[w] }];
        s.done = true;
      }
    }
  }
  function cpuMatch(ev, a, b, R) {
    const C = ev.cfg;
    const pa = 0.5 + (1 / (1 + Math.exp(-(a.skill - b.skill) * 5)) - 0.5) * 0.35;
    const sc = [0, 0];
    for (let n = 0; n < 200; n++) {
      sc[R.f() < pa ? 0 : 1]++;
      const w = sc[0] > sc[1] ? 0 : 1, x = sc[w], y = sc[1 - w];
      if ((x >= C.target && x - y >= 2) || x >= C.cap) return { winner: w, text: x + ' : ' + y };
    }
    return { winner: sc[0] >= sc[1] ? 0 : 1, text: Math.max(sc[0], sc[1]) + ' : ' + Math.min(sc[0], sc[1]) };
  }

  /* ============================== DRAWING ============================== */
  const YF = FLOOR - 13, YN = FLOOR + 15; // far / near edge of the floor band
  const PX = (x, y) => NX + (x - NX) * (1 - 0.05 * (YN - y) / (YN - YF)); // perspective squeeze
  function band(g, xa, xb, ya, yb, c) { g.poly([PX(xa, ya), ya, PX(xb, ya), ya, PX(xb, yb), yb, PX(xa, yb), yb], c); }
  function lnV(g, x, c, ya, yb) { ya = ya == null ? YF : ya; yb = yb == null ? YN : yb; g.line(PX(x, ya), ya, PX(x, yb), yb, c); }
  function lnH(g, xa, xb, y, c) { g.line(PX(xa, y), y, PX(xb, y), y, c); }
  function rotEll(g, cx, cy, ra, rb, ang, fill, rim) {
    const ca = Math.cos(ang), sa = Math.sin(ang), R0 = Math.ceil(Math.max(ra, rb)) + 1;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let y = -R0; y <= R0; y++) for (let x = -R0; x <= R0; x++) {
      const a = x * ca + y * sa, b = -x * sa + y * ca;
      if ((a * a) / (ra * ra) + (b * b) / (rb * rb) > 1) continue;
      const inner = (a * a) / ((ra - 1.1) * (ra - 1.1)) + (b * b) / ((rb - 1.1) * (rb - 1.1)) <= 1;
      const c = inner ? fill : rim;
      if (c) g.px(cx + x, cy + y, c);
    }
  }
  function stars(g, n, h) { for (let i = 0; i < n; i++) g.px(OG.hash(i, 5, 1) * 480, OG.hash(i, 6, 1) * h, OG.hash(i, 7, 1) < 0.3 ? '#fee761' : '#c0cbdc'); }
  function stands(g, x, y, w, h, t, ex, seed, bg, dim, colors) {
    g.crowd(x, y, w, h, t, { excite: ex, seed: seed, bg: bg, density: 0.72, colors: colors });
    const dm = dim == null ? 0.32 : dim;
    for (let k = 0; k < 4; k++) { g.alpha(Math.min(0.85, dm + 0.06 * (4 - k) * (h > 60 ? 1 : 0.4))); g.rect(x, y + Math.round(h * k / 4), w, Math.round(h / 4) + 1, '#0b0a18'); }
    g.alpha(1);
    const rail = OG.shade(bg, -0.4);
    for (let yy = y + 20; yy < y + h - 4; yy += 20) { g.rect(x, yy, w, 2, rail); g.rect(x, yy + 2, w, 1, 'rgba(255,255,255,0.07)'); }
    g.rect(x, y + h - 2, w, 2, rail);
  }
  function boards(g, x, y, w, h, t, texts, dim) {
    g.save(); g.clip(x, y, w, h);
    g.adBoards(x, y, w, h, t, texts);
    g.alpha(dim == null ? 0.22 : dim); g.rect(x, y, w, h, '#000000'); g.alpha(1);
    g.restore();
    g.rect(x, y + h, w, 1, 'rgba(0,0,0,0.4)');
  }
  function apron(g, c) { g.rect(0, YN, W, 270 - YN, c); g.rect(0, YN, W, 1, OG.shade(c, -0.35)); }
  function plankFloor(g, y0, y1, c) {
    g.rect(0, y0, W, y1 - y0, c);
    for (let y = y0 + 3; y < y1; y += 4) {
      g.rect(0, y, W, 1, OG.shade(c, -0.08));
      for (let k = 0; k < 8; k++) { const x = Math.floor(OG.hash(k, y, 3) * 480); g.rect(x, y - 3, 1, 3, OG.shade(c, -0.12)); }
    }
  }
  function umpChair(g, x, t, kit) {
    const y = YF;
    g.rect(x - 7, y - 40, 2, 40, '#1d2b3a'); g.rect(x + 5, y - 40, 2, 40, '#1d2b3a');
    for (let k = 0; k < 4; k++) g.rect(x - 6, y - 8 - k * 9, 12, 1, '#2d3d50');
    g.rect(x - 9, y - 42, 18, 3, '#2d3d50');
    g.rect(x - 9, y - 54, 2, 12, '#2d3d50');
    g.figure(x + 1, y - 41, OG.Pose.sit(), { shirt: kit || '#2a4a7a', pants: '#262b44', skin: PAL.skin2, hair: PAL.black }, { facing: -1, scale: 1 });
  }
  function palm(g, x, y, h, t, sd) {
    let cx = x;
    for (let k = 0; k < h; k += 2) { cx = x + Math.sin(k / h * 1.6) * (sd > 0.5 ? 10 : -10); g.rect(cx - 2, y - k, 5, 2, k % 6 < 2 ? '#7a5230' : '#946238'); }
    const tx = cx, ty = y - h;
    for (let f = 0; f < 6; f++) {
      const a = -Math.PI / 2 + (f - 2.5) * 0.55 + Math.sin(t * 1.3 + f + sd * 9) * 0.06;
      for (let s = 0; s < 22; s++) {
        const r = s, dx = Math.cos(a) * r, dy = Math.sin(a) * r + (s * s) * 0.035;
        g.rect(tx + dx - 1, ty + dy, 3, 2, s > 16 ? '#3e8948' : '#4fa04a');
      }
    }
    g.circle(tx - 2, ty + 3, 2, '#5a3a20'); g.circle(tx + 2, ty + 4, 2, '#6a4628');
  }

  const VENUE = {
    tennis(g, s, C, t, ex) {
      g.grad(0, 0, W, 60, '#3d8fd8', '#a8dcff', 6);
      g.clouds(t, 8, 3, 'rgba(255,255,255,0.85)', 4);
      g.poly([0, 44, W, 44, W, 50, 0, 50], '#1c2238');
      for (let x = 10; x < W; x += 46) g.rect(x, 36, 3, 14, '#2a3352');
      g.rect(0, 34, W, 3, '#3a4466');
      stands(g, 0, 50, W, 82, t, ex, 3, '#2c3656', 0.3);
      g.rect(0, 132, W, 4, '#141a2e');
      boards(g, 0, 136, W, 9, t, ['DOT OPEN 2026', 'AICHI-NAGOYA', 'ACE SERVE', '8-BIT TENNIS'], 0.3);
      g.rect(0, 145, W, YF - 145, '#1f5a46');
      g.rect(0, 145, W, 1, '#2f7a5f');
      g.text('DOT OPEN', 120, 160, '#2a6e56', { size: 'l', align: 'center' });
      g.text('AICHI-NAGOYA 2026', 360, 162, '#2a6e56', { size: 's', align: 'center' });
      boards(g, 0, YF - 11, W, 10, t * 0.5, ['DOT OPEN', 'AICHI-NAGOYA 2026', 'GAME SET MATCH', 'PIXEL SPORTS'], 0.35);
      umpChair(g, NX + 22, t);
      g.rect(0, YF, W, YN - YF, '#3d8b67');
      band(g, C.cL, C.cR, YF, YN, '#2f6db7');
      const L = '#f2f4f8';
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnH(g, C.cL, C.cR, YF + 4, L); lnH(g, C.cL, C.cR, YN - 4, L);
      lnV(g, C.cL, L); lnV(g, C.cR, L); lnV(g, NX - C.svc, L, YF + 4, YN - 4); lnV(g, NX + C.svc, L, YF + 4, YN - 4);
      lnH(g, NX - C.svc, NX + C.svc, FLOOR, L);
      apron(g, '#2e6e52');
    },
    clay(g, s, C, t, ex) {
      g.grad(0, 0, W, 120, '#5fb6f2', '#cdeeff', 7);
      g.clouds(t, 14, 3);
      g.mountains(70, 46, '#8fb0d0', 2, t * 0.5, '#e8f2ff');
      g.mountains(100, 34, '#6d93b5', 5, t * 0.8);
      g.trees(140, '#2f6b3a', 4, 0, 13);
      g.rect(0, 140, W, 30, '#3a7a44');
      stands(g, 8, 124, 120, 44, t, ex, 5, '#6a7a90', 0.12);
      stands(g, 352, 124, 120, 44, t, ex, 6, '#6a7a90', 0.12);
      g.rect(0, 168, W, YF - 168, '#28553a');
      for (let x = 0; x < W; x += 3) for (let y = 150; y < 168; y += 3) g.px(x + ((y / 3) % 2), y, 'rgba(200,210,220,0.45)');
      g.rect(0, 167, W, 1, '#c0cbdc');
      g.text('SOFT TENNIS  ·  AICHI-NAGOYA 2026', NX, 182, '#e8f2ff', { size: 's', align: 'center' });
      umpChair(g, NX + 22, t, '#7a2a3a');
      g.rect(0, YF, W, YN - YF, '#b75a32');
      band(g, C.cL, C.cR, YF, YN, '#cd6a3e');
      for (let k = 0; k < 90; k++) g.px(PX(OG.hash(k, 1, 4) * 480, FLOOR), YF + OG.hash(k, 2, 4) * (YN - YF), '#a84f2a');
      const L = '#fbf3ea';
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnH(g, C.cL, C.cR, YF + 4, L); lnH(g, C.cL, C.cR, YN - 4, L);
      lnV(g, C.cL, L); lnV(g, C.cR, L); lnV(g, NX - C.svc, L, YF + 4, YN - 4); lnV(g, NX + C.svc, L, YF + 4, YN - 4);
      lnH(g, NX - C.svc, NX + C.svc, FLOOR, L);
      apron(g, '#9a4a28');
    },
    padel(g, s, C, t, ex) {
      g.grad(0, 0, W, 150, '#0b0e22', '#1e2850', 7);
      stars(g, 50, 60);
      stands(g, 50, 92, 380, 58, t, ex, 4, '#1c2240', 0.42);
      [22, 458].forEach((x, k) => {
        g.rect(x - 1, 14, 3, 140, '#3a4466');
        g.rect(x - 9, 10, 19, 6, '#5a6988'); g.rect(x - 8, 11, 17, 4, '#fff6c8');
        g.alpha(0.07); g.poly([x - 8, 16, x + 9, 16, NX + (k ? 60 : -60), FLOOR, NX + (k ? 220 : -220), FLOOR], '#fff6c8'); g.alpha(1);
      });
      // far side fence: glass + mesh
      g.rect(C.walls[0], 150, C.walls[1] - C.walls[0], YF - 150, 'rgba(160,200,255,0.10)');
      for (let x = C.walls[0]; x < C.walls[1]; x += 4) g.rect(x, 128, 1, YF - 168, 'rgba(160,170,200,0.35)');
      for (let y = 130; y < YF - 40; y += 4) g.rect(C.walls[0], y, C.walls[1] - C.walls[0], 1, 'rgba(160,170,200,0.25)');
      g.rect(C.walls[0], 127, C.walls[1] - C.walls[0], 2, '#5a6988');
      g.rect(C.walls[0], YF - 40, C.walls[1] - C.walls[0], 1, '#8b9bb4');
      for (let x = C.walls[0]; x <= C.walls[1]; x += 49) g.rect(x, 127, 2, YF - 127, '#3a4466');
      boards(g, C.walls[0] + 2, YF - 12, C.walls[1] - C.walls[0] - 4, 10, t, ['PADEL · NEW IN 2026', 'AICHI-NAGOYA', 'GLASS WALL', 'DOT GAMES'], 0.35);
      g.rect(0, YF, W, YN - YF, '#173a6e');
      band(g, C.walls[0], C.walls[1], YF, YN, '#2a68b8');
      for (let k = 0; k < 120; k++) g.px(PX(C.walls[0] + OG.hash(k, 1, 8) * (C.walls[1] - C.walls[0]), FLOOR), YF + OG.hash(k, 2, 8) * (YN - YF), '#3a7ac8');
      const L = '#f2f4f8';
      lnV(g, NX - C.svc, L); lnV(g, NX + C.svc, L); lnH(g, NX - C.svc, NX + C.svc, FLOOR, L);
      apron(g, '#121a35');
      // glass back walls (seen edge-on) + mesh on top
      C.walls.forEach((wx, k) => {
        const fx = PX(wx, YF), top = C.wallH, sg = k ? 1 : -1;
        g.poly([fx, YF - top, wx, YN - top, wx + sg * 3, YN - top, wx + sg * 3, YN, wx, YN, fx, YF], 'rgba(190,232,255,0.20)');
        for (let y = 0; y < 30; y += 3) g.line(fx, YF - top - y, wx, YN - top - y, 'rgba(170,180,210,0.45)');
        g.line(fx, YF - top - 30, wx, YN - top - 30, '#5a6988');
        g.line(fx, YF - top, wx, YN - top, '#e8f6ff');
        g.rect(fx - 1, YF - top - 30, 2, top + 30, '#3a4466'); g.rect(wx - 1, YN - top - 30, 2, top + 30, '#5a6988');
        g.rect(wx + sg * 3, YN - top, 1, top, 'rgba(232,246,255,0.7)');
        g.alpha(0.25); g.line(wx + sg * 1, YN - top + 20, wx + sg * 1, YN - top + 50, '#ffffff', 2); g.alpha(1);
      });
      if (s.wallK > 0 && (s.wallX < 70 || s.wallX > 410)) { g.alpha(Math.min(1, s.wallK * 5)); g.circle(s.wallX, s.wallY, 6, '#e8f6ff'); g.alpha(1); }
    },
    tt(g, s, C, t, ex) {
      g.grad(0, 0, W, 180, '#0c0f22', '#232848', 7);
      stands(g, 0, 40, W, 96, t, ex, 7, '#1c2040', 0.5);
      g.alpha(0.07); g.poly([190, 0, 290, 0, 380, FLOOR, 100, FLOOR], '#fff8d8'); g.alpha(0.05); g.poly([215, 0, 265, 0, 330, FLOOR, 150, FLOOR], '#ffffff'); g.alpha(1);
      g.rect(0, 140, W, YF - 140, '#1a1f3a');
      for (let x = -10, k = 0; x < W; x += 52, k++) {
        g.rect(x, 186, 50, YF - 186, k % 2 ? '#1f4fa0' : '#173b7a');
        g.rect(x, 186, 50, 1, '#5a8ad8');
        g.text(k % 2 ? 'DOT TT' : 'NAGOYA', x + 25, 192, '#dfe8ff', { size: 'xs', align: 'center' });
      }
      g.rect(0, YF, W, YN - YF, '#8e2730');
      band(g, 60, 420, YF, YN, '#a2303a');
      apron(g, '#3a1a24');
    },
    badminton(g, s, C, t, ex) {
      g.grad(0, 0, W, 180, '#16283a', '#2a4a62', 7);
      for (let x = 20; x < W; x += 60) { g.rect(x, 4, 30, 4, '#fff6d0'); g.alpha(0.12); g.rect(x - 6, 8, 42, 6, '#fff6d0'); g.alpha(1); }
      stands(g, 0, 50, W, 92, t, ex, 11, '#223850', 0.38);
      [18, 72, 386, 440].forEach((x, k) => {
        const c = [PAL.red, PAL.gold, PAL.blue, PAL.green][k];
        g.rect(x, 18, 22, 30, c); g.poly([x, 48, x + 22, 48, x + 11, 56], c);
        g.text(['羽', 'DOT', '2026', 'BWF'][k], x + 11, 26, '#fff', { size: 'xs', align: 'center' });
      });
      g.rect(0, 144, W, YF - 144, '#1a2c3e');
      boards(g, 0, YF - 12, W, 11, t, ['BADMINTON', 'AICHI-NAGOYA 2026', 'SHUTTLE TIME', 'DOT GAMES'], 0.3);
      plankFloor(g, YF, YN, '#c48a50');
      band(g, C.cL, C.cR, YF + 1, YN - 1, '#2f8a5c');
      const L = '#f2f4f8';
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnH(g, C.cL, C.cR, YF + 3, L); lnH(g, C.cL, C.cR, YN - 3, L);
      lnV(g, C.cL, L); lnV(g, C.cR, L); lnV(g, C.cL + 18, L); lnV(g, C.cR - 18, L);
      lnV(g, NX - 54, L); lnV(g, NX + 54, L);
      lnH(g, C.cL, NX - 54, FLOOR, L); lnH(g, NX + 54, C.cR, FLOOR, L);
      apron(g, '#8a5a30');
    },
    beach(g, s, C, t, ex) {
      g.grad(0, 0, W, 118, '#2f95e6', '#c4ecff', 8);
      g.alpha(0.25); g.circle(408, 36, 24, '#fff7b0'); g.alpha(1);
      g.circle(408, 36, 13, '#fff7b0'); g.circle(408, 36, 10, '#fff2a0');
      g.clouds(t, 16, 4, 'rgba(255,255,255,0.9)', 4);
      g.mountains(96, 20, '#5d8fb0', 8, 0);
      g.water(0, 112, W, 36, t, '#1d86c8', 'rgba(255,255,255,0.35)');
      g.rect(0, 112, W, 1, '#8fd6ff');
      for (let x = 0; x < W; x += 6) g.rect(x + Math.round(Math.sin(t * 2 + x * 0.1) * 2), 147, 4, 2, 'rgba(255,255,255,0.75)');
      g.rect(0, 149, W, 121, '#ead4aa');
      for (let k = 0; k < 160; k++) g.px(OG.hash(k, 3, 3) * 480, 150 + OG.hash(k, 4, 3) * 118, OG.hash(k, 5, 3) < 0.5 ? '#d9bf8f' : '#f6e6c4');
      [[120, PAL.red], [360, PAL.blue], [196, PAL.gold]].forEach(([x, c], k) => {
        g.rect(x, 150, 1, 26, '#c0cbdc'); g.poly([x - 16, 154, x + 16, 154, x + 10, 148, x - 10, 148], c);
        g.rect(x - 16, 154, 32, 1, OG.shade(c, -0.3));
      });
      g.crowd(84, 166, 90, 30, t, { excite: ex, seed: 13, bg: '#d9bf8f', density: 0.7 });
      g.crowd(306, 166, 90, 30, t, { excite: ex, seed: 14, bg: '#d9bf8f', density: 0.7 });
      boards(g, 150, 198, 180, 9, t, ['BEACH VOLLEY', 'AICHI-NAGOYA', 'SUNNY 2026'], 0.15);
      palm(g, 22, 214, 92, t, 0.2); palm(g, 66, 206, 70, t, 0.8); palm(g, 452, 214, 96, t, 0.7); palm(g, 412, 204, 66, t, 0.1);
      const L = '#2a6fd0';
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnV(g, C.cL, L); lnV(g, C.cR, L);
    },
    volley(g, s, C, t, ex) {
      g.grad(0, 0, W, 170, '#10142c', '#262e55', 7);
      for (let x = 30; x < W; x += 70) { g.rect(x, 2, 26, 3, '#fff8e0'); g.alpha(0.1); g.rect(x - 8, 5, 42, 8, '#fff8e0'); g.alpha(1); }
      stands(g, 0, 22, W, 120, t, ex, 21, '#202850', 0.4);
      g.rect(0, 142, W, 4, '#0e1226');
      g.rect(0, 160, W, YF - 160, '#1b2b58');
      boards(g, 0, YF - 13, W, 12, t, ['VOLLEYBALL', 'AICHI-NAGOYA 2026', 'DOT GAMES', 'SPIKE!'], 0.25);
      g.rect(NX + 12, YF - 34, 12, 34, '#3a4466'); g.rect(NX + 10, YF - 36, 16, 3, '#5a6988');
      g.figure(NX + 18, YF - 36, OG.Pose.stand(), { shirt: '#262b44', pants: '#181425', skin: PAL.skin2, hair: PAL.black }, { facing: -1 });
      g.rect(0, YF, W, YN - YF, '#2858a8');
      band(g, C.cL, C.cR, YF, YN, '#e07b39');
      const L = '#f6f6f6', a3 = (C.cR - NX) / 3;
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnV(g, C.cL, L); lnV(g, C.cR, L);
      lnV(g, NX - a3, L); lnV(g, NX + a3, L);
      apron(g, '#1d3f7a');
    },
    takraw(g, s, C, t, ex) {
      g.grad(0, 0, W, 170, '#3a1a2a', '#6a2f36', 7);
      for (let x = 0; x < W; x += 16) { const c = [PAL.red, PAL.gold, PAL.blue][(x / 16) % 3]; g.poly([x, 10, x + 16, 10, x + 8, 20], c); }
      g.rect(0, 9, W, 1, '#c0cbdc');
      stands(g, 0, 26, W, 120, t, ex, 31, '#4a2430', 0.4);
      g.rect(0, 146, W, YF - 146, '#5a2a2a');
      for (let x = 0; x < W; x += 24) g.poly([x, 146, x + 24, 146, x + 12, 156], '#c9962f');
      boards(g, 0, YF - 12, W, 11, t, ['SEPAK TAKRAW', 'AICHI-NAGOYA 2026', 'BICYCLE KICK', 'DOT GAMES'], 0.3);
      g.rect(0, YF, W, YN - YF, '#2f9a6a');
      band(g, C.cL, C.cR, YF, YN, '#2b72c0');
      const L = '#f6f6f6';
      lnH(g, C.cL, C.cR, YF + 1, L); lnH(g, C.cL, C.cR, YN - 1, L); lnV(g, C.cL, L); lnV(g, C.cR, L);
      [NX - C.srvD, NX + C.srvD].forEach(x => { for (let a = 0; a < 6.28; a += 0.3) g.px(PX(x + Math.cos(a) * 9, FLOOR), FLOOR + Math.sin(a) * 4, L); });
      apron(g, '#226a4a');
    },
    teq(g, s, C, t, ex) {
      g.grad(0, 0, W, 190, '#0e0820', '#2a1446', 8);
      stands(g, 0, 62, W, 88, t, ex, 41, '#1a1030', 0.3, ['#5a3a8a', '#3a4a9a', '#8a3a7a', '#2c6a8a', '#c0cbdc']);
      [[50, '#ff2fd6'], [150, '#2ce8f5']].forEach(([y, c], k) => {
        const yy = k ? 156 : 54;
        g.alpha(0.18); g.rect(0, yy - 3, W, 7, c); g.alpha(1); g.rect(0, yy, W, 1, c);
      });
      g.rect(0, 158, W, YF - 158, '#1a1030');
      g.text('TEQBALL', 56, 36, '#ff7ae6', { size: 'l', align: 'center', shadow: '#5a1a5a' });
      g.text('NEW IN 2026', 424, 40, '#2ce8f5', { size: 's', align: 'center' });

      g.rect(0, YF, W, YN - YF, '#1e1a36');
      g.ellipse(NX, FLOOR, 200, 13, '#2c2650'); g.ellipse(NX, FLOOR, 150, 10, '#36305e');
      apron(g, '#140f26');
    },
    squash(g, s, C, t, ex) {
      const S = C.sq;
      g.grad(0, 0, W, 190, '#151a33', '#2c3358', 7);
      stands(g, 0, 30, W, 110, t, ex, 51, '#1f2546', 0.45);
      g.rect(0, 140, W, YF - 140, '#232a4a');
      boards(g, 0, 146, W, 10, t, ['SQUASH · LA 2028', 'AICHI-NAGOYA 2026', 'GLASS COURT', 'DOT GAMES'], 0.35);
      // far glass side wall with out line
      g.rect(S.back, 60, S.front - S.back, YF - 60, 'rgba(190,225,255,0.12)');
      for (let x = S.back; x <= S.front; x += 68) g.rect(x, 60, 1, YF - 60, 'rgba(220,240,255,0.35)');
      g.rect(S.back, 60, S.front - S.back, 1, 'rgba(220,240,255,0.5)');
      g.line(S.back, YF - 57, S.front, YF - S.out, '#d0303a');
      plankFloor(g, YF, YN, '#ddb27a');
      const L = '#c8303a', sl = S.front - 0.56 * (S.front - S.back);
      lnV(g, sl, L); lnH(g, S.back, sl, FLOOR, L);
      lnV(g, sl - 46, L, FLOOR, YN); lnV(g, sl - 46, L, YF, FLOOR);
      // back glass wall
      g.poly([S.back - 12, 100, S.back, 92, S.back, YN, S.back - 12, YN], 'rgba(200,235,255,0.28)');
      g.rect(S.back, 92, 1, YN - 92, '#e8f4ff'); g.rect(S.back - 12, 100, 1, YN - 100, '#9fc2e0');
      g.line(S.back - 12, FLOOR - 50, S.back, FLOOR - 64, L);
      // front wall
      const fx = S.front;
      g.poly([fx, 40, fx + 18, 30, fx + 18, YN - 10, fx, YN], '#e8ecf4');
      g.poly([fx, 40, fx + 18, 30, fx + 18, 34, fx, 44], '#ffffff');
      g.rect(fx, 40, 1, YN - 40, '#b8c0d0');
      const wl = (h, c, th) => g.poly([fx, FLOOR - h - th + 1, fx + 18, FLOOR - h - 6 - th + 1, fx + 18, FLOOR - h - 6 + 1, fx, FLOOR - h + 1], c);
      g.poly([fx, FLOOR - S.tin, fx + 18, FLOOR - S.tin - 6, fx + 18, YN - 10, fx, YN], '#d0303a');
      g.poly([fx, FLOOR - S.tin, fx + 18, FLOOR - S.tin - 6, fx + 18, FLOOR - S.tin - 4, fx, FLOOR - S.tin + 2], '#ff6a6a');
      wl(S.svc, L, 2); wl(S.out, L, 2);
      if (s.wallK > 0 && s.wallX > S.front - 20) { g.alpha(Math.min(1, s.wallK * 5)); g.circle(fx + 1, s.wallY, 5, '#fff7c0'); g.alpha(1); }
      apron(g, '#7a5a3a');
    }
  };

  /* ------------------------------ net / table ------------------------------ */
  function drawNet(g, s, C) {
    const hN = C.netH, meshH = C.kind === 'volley' ? 24 : C.kind === 'shuttle' ? 20 : C.kind === 'kick' ? 18 : hN;
    const sh = s.netK > 0 ? Math.sin(g.t * 55) * s.netK * 4 : 0;
    const xa = NX + 12, ya = YF + 1, xb = NX - 12, yb = YN - 1;
    const postC = C.venue === 'beach' ? '#f0f0f0' : C.kind === 'racket' ? '#24322a' : '#3a4466';
    g.rect(xa - 1, ya - hN - 3, 2, hN + 3, OG.shade(postC, -0.35));
    for (let x = xb; x <= xa; x++) {
      const k = (x - xb) / (xa - xb), bow = sh * (1 - Math.abs(k - 0.5) * 2);
      const yt = Math.round(M.lerp(yb - hN, ya - hN, k) + bow);
      for (let y = yt + 2; y < yt + meshH; y++) if ((y - yt) % 3 === 0 || x % 3 === 0) g.px(x, y, 'rgba(16,16,28,0.6)');
    }
    g.line(xb, yb - hN, xa, ya - hN, '#ffffff', 2);
    if (meshH < hN) g.line(xb, yb - hN + meshH, xa, ya - hN + meshH, 'rgba(230,230,240,0.8)', 1);
    if (C.kind === 'racket') g.line(NX, FLOOR + 1 - hN, NX, FLOOR, 'rgba(255,255,255,0.7)', 1);
    if (C.kind === 'volley') [[xb, yb], [xa, ya]].forEach(([x, y]) => { for (let k = 0; k < 22; k += 2) g.rect(x, y - hN - 22 + k, 1, 2, (k / 2) % 2 ? '#ffffff' : '#e43b44'); });
    g.rect(xb - 1, yb - hN - 4, 3, hN + 4, postC); g.rect(xb - 1, yb - hN - 4, 1, hN + 4, OG.shade(postC, 0.3));
    if (C.venue === 'beach') { g.rect(xb - 2, yb - 22, 5, 22, '#2a6fd0'); g.rect(xb - 2, yb - 22, 5, 2, '#fee761'); }
  }
  function drawTable(g, C) {
    const T = C.table, top = FLOOR - T.h;
    if (!T.curve) {
      const ya = top - 6, yb = top + 5;
      const sx = (x, y) => NX + (x - NX) * (1 - 0.03 * (yb - y) / (yb - ya));
      g.ellipse(NX, FLOOR + 3, (T.R - T.L) / 2 + 4, 7, 'rgba(0,0,0,0.3)');
      [T.L + 16, T.R - 18].forEach(x => { g.rect(sx(x, ya), ya + 2, 2, FLOOR - 6 - ya, '#101018'); });
      g.rect(NX - 40, top + 8, 80, 2, '#151520');
      g.poly([sx(T.L, ya), ya, sx(T.R, ya), ya, T.R, yb, T.L, yb], '#1d4fa8');
      g.rect(T.L, yb, T.R - T.L + 1, 3, '#143a7c'); g.rect(T.L, yb + 3, T.R - T.L + 1, 1, '#0c2552');
      g.line(sx(T.L, ya), ya, sx(T.R, ya), ya, '#f4f6fa'); g.line(T.L, yb, T.R, yb, '#f4f6fa');
      g.line(sx(T.L, ya), ya, T.L, yb, '#f4f6fa'); g.line(sx(T.R, ya), ya, T.R, yb, '#f4f6fa');
      g.line(sx(T.L, top), top, sx(T.R, top), top, 'rgba(244,246,250,0.8)');
      [T.L + 16, T.R - 18].forEach(x => g.rect(x, yb + 3, 3, FLOOR + 10 - yb - 3, '#181822'));
      const hN = C.netH;
      for (let x = NX - 3; x <= NX + 3; x++) {
        const k = (x - NX + 3) / 6, yt = Math.round(M.lerp(yb, ya, k) - hN);
        for (let y = yt + 1; y < yt + hN; y++) if ((y - yt) % 2 === 0 || x % 2 === 0) g.px(x, y, 'rgba(10,10,20,0.7)');
      }
      g.line(NX - 3, yb - hN, NX + 3, ya - hN, '#ffffff');
      g.rect(NX - 4, yb - hN - 1, 2, hN + 1, '#262b44'); g.rect(NX + 3, ya - hN - 1, 2, hN + 1, '#1a1d30');
      return;
    }
    // teqball: curved table on a pedestal
    g.ellipse(NX, FLOOR + 3, (T.R - T.L) / 2 + 6, 7, 'rgba(0,0,0,0.35)');
    g.poly([NX - 34, FLOOR + 8, NX + 34, FLOOR + 8, NX + 12, top + 6, NX - 12, top + 6], '#2a2f48');
    g.poly([NX - 34, FLOOR + 8, NX - 26, FLOOR + 8, NX - 8, top + 6, NX - 12, top + 6], '#3c4466');
    g.rect(NX - 40, FLOOR + 7, 80, 3, '#1a1d30');
    for (let x = T.L; x <= T.R; x++) {
      const y = Math.round(surfY(C, x));
      g.rect(x, y - 4, 1, 9, '#2b5fb8');
      g.rect(x, y - 4, 1, 1, '#f4f6fa'); g.rect(x, y + 4, 1, 1, '#f4f6fa');
      g.rect(x, y + 5, 1, 3, '#1a2a50');
      if (x % 2 === 0) g.px(x, y, 'rgba(244,246,250,0.7)');
    }
    g.rect(T.L, Math.round(surfY(C, T.L)) - 4, 1, 12, '#f4f6fa'); g.rect(T.R, Math.round(surfY(C, T.R)) - 4, 1, 12, '#f4f6fa');
    const hN = C.netH;
    g.alpha(0.45); g.rect(NX - 3, top - 5 - hN, 7, hN + 6, '#bfe6ff'); g.alpha(1);
    g.rect(NX - 3, top - 6 - hN, 7, 1, '#ffffff'); g.rect(NX - 3, top - 6 - hN, 1, hN + 6, '#c0cbdc'); g.rect(NX + 3, top - 6 - hN, 1, hN + 6, '#c0cbdc');
  }

  /* ------------------------------ athletes ------------------------------ */
  const SWD = 0.3;
  const READY = {
    racket: { t: 0.3, aL: 0.6, aR: 0.9, eL: 1.2, eR: 0.9, lL: 0.45, lR: -0.3, kL: 0.8, kR: 0.5 },
    volley: { t: 0.4, aL: 0.7, aR: 0.8, eL: 0.6, eR: 0.6, lL: 0.55, lR: -0.25, kL: 1.0, kR: 0.7 },
    kick: { t: 0.15, aL: 0.5, aR: 0.4, eL: 0.9, eR: 0.9, lL: 0.35, lR: -0.2, kL: 0.5, kR: 0.4 }
  };
  const group = C => C.kind === 'volley' ? 'volley' : (C.kind === 'kick' || C.kind === 'teq') ? 'kick' : 'racket';
  function swingPose(C, p, k) {
    const e = M.easeOut(M.clamp(k, 0, 1)), q = Math.sin(M.clamp(k, 0, 1) * Math.PI), air = p.air;
    switch (p.sk) {
      case 'fh':
        if (C.racket === 'tt') return { t: 0.35, aL: 0.6, aR: 0.2 + 2.0 * e, eL: 1.2, eR: 1.3 - 0.7 * e, lL: 0.5, lR: -0.3, kL: 0.8, kR: 0.5 };
        return { t: 0.3 + 0.1 * e, aL: 1.0 - 0.8 * e, aR: -0.9 + 3.1 * e, eL: 1.0, eR: 0.4, lL: 0.55, lR: -0.35, kL: 0.8, kR: 0.4 };
      case 'oh': return { t: 0.05 + 0.45 * e, aL: 2.4 - 1.7 * e, aR: 3.5 - 2.6 * e, eL: 0.3, eR: 0.3 - 0.2 * e, lL: air ? 0.9 : 0.4, lR: air ? 0.2 : -0.3, kL: air ? 1.6 : 0.5, kR: air ? 0.5 : 0.3 };
      case 'bump': return { t: 0.45, aL: 0.9 + 0.4 * e, aR: 1.0 + 0.4 * e, eL: 0, eR: 0, lL: 0.8 - 0.3 * e, lR: 0.1, kL: 1.4 - 0.6 * e, kR: 0.7 - 0.3 * e };
      case 'set': return { t: 0, aL: 2.7 + 0.2 * e, aR: 2.8 + 0.2 * e, eL: 0.7 - 0.5 * e, eR: 0.7 - 0.5 * e, lL: air ? 0.8 : 0.3, lR: air ? 0.2 : -0.1, kL: air ? 1.4 : 0.5 - 0.4 * e, kR: 0.3 };
      case 'spike': return { t: 0.1 + 0.5 * e, aL: 2.2 - 1.2 * e, aR: 3.5 - 2.5 * e, eL: 0.3, eR: 0.1, lL: 0.9, lR: 0.2, kL: 1.6, kR: 0.5 };
      case 'kick': return { t: -0.3 * e, aL: 1.2, aR: -0.5, eL: 1.0, eR: 0.8, lL: -0.1, lR: -0.4 + 2.3 * e, kL: 0.2, kR: 0.8 * (1 - e) };
      case 'head': return { t: 0.1 + 0.5 * q, h: -0.3 + 0.4 * q, aL: -0.6, aR: -0.5, eL: 0.4, eR: 0.4, lL: air ? 0.8 : 0.4, lR: air ? 0.3 : -0.2, kL: air ? 1.4 : 0.6, kR: 0.4 };
      case 'bike': return { rot: -1.7 * q, t: 0, aL: 1.7, aR: 1.3, eL: 0.4, eR: 0.4, lL: 0.4 + 0.6 * q, lR: 1.4 + 1.4 * e, kL: 1.2, kR: 0.1 };
    }
    return READY[group(C)];
  }
  function poseOf(g, s, C, i) {
    const p = s.P[i], G = group(C), t = g.t;
    if ((s.phase === 'point' || s.phase === 'end') && p.mood !== 0 && p.sw > 0.45 && !p.air) {
      return p.mood > 0 ? OG.Pose.celebrate((t * 2 + i * 0.37) % 1) : OG.Pose.sad();
    }
    if (p.sw < SWD) return swingPose(C, p, p.sw / SWD);
    if (s.phase === 'serve' && s.server === i && s.toss >= 0) {
      if (G === 'racket') return { t: 0.05, aL: 2.8, aR: C.racket === 'tennis' || C.racket === 'soft' ? 3.4 : -0.9, eL: 0.2, eR: 1.4, lL: 0.25, lR: -0.2, kL: 0.4, kR: 0.2 };
      if (G === 'volley') return { t: 0.05, aL: 2.8, aR: 3.3, eL: 0.2, eR: 1.2, lL: 0.25, lR: -0.2, kL: 0.4, kR: 0.2 };
      return { t: -0.1, aL: 1.6, aR: 0.6, eL: 0.3, eR: 0.6, lL: 0.1, lR: -0.6, kL: 0.2, kR: 0.4 };
    }
    if (p.wind < 0.3 && G === 'racket') {
      const high = FLOOR - s.ball.y - p.h > C.reach.oh;
      return high ? { t: 0.05, aL: 2.2, aR: 3.5, eL: 0.3, eR: 1.3, lL: 0.4, lR: -0.3, kL: 0.6, kR: 0.3 }
        : { t: 0.35, aL: 1.2, aR: -1.3, eL: 0.8, eR: 0.4, lL: 0.55, lR: -0.35, kL: 0.9, kR: 0.4 };
    }
    if (p.air) {
      if (G === 'volley') return OG.Pose.jump();
      if (G === 'racket') return { t: 0.1, aL: 2.2, aR: 3.0, eL: 0.4, eR: 1.0, lL: 0.9, lR: 0.2, kL: 1.6, kR: 0.5 };
      return { t: -0.1, aL: 1.6, aR: 1.4, eL: 0.4, eR: 0.4, lL: 1.0, lR: 0.3, kL: 1.4, kR: 0.6 };
    }
    if (Math.abs(p.vx) > 15) {
      const r = OG.Pose.run(p.run, 0.7);
      if (G === 'racket') { r.aR = 0.9 + Math.sin(p.run * 6.28) * 0.2; r.eR = 1.0; }
      if (G === 'volley') { r.t = 0.35; }
      return r;
    }
    const b = Object.assign({}, READY[G]), br = Math.sin(t * 4 + i) * 0.06;
    b.kL += br; b.kR += br; b.lL += br * 0.5;
    return b;
  }
  function drawRacket(g, C, J, p) {
    const a = J.elR, h = J.hdR;
    let dx = h[0] - a[0], dy = h[1] - a[1];
    const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const ang = Math.atan2(dy, dx), at = d => [h[0] + dx * d, h[1] + dy * d];
    const Rk = C.racket;
    if (Rk === 'tt') {
      const c = at(4); g.line(h[0], h[1], h[0] + dx * 2, h[1] + dy * 2, '#c89a5a', 2);
      rotEll(g, c[0], c[1], 3.8, 3.4, ang, p.f > 0 ? '#d42a2a' : '#262b44', '#5a1010'); return;
    }
    if (Rk === 'badminton' || Rk === 'squash') {
      const e = Rk === 'badminton' ? 10 : 7, c = at(e + 4), shaftEnd = at(e);
      g.line(h[0], h[1], h[0] + dx * 3, h[1] + dy * 3, '#262b44', 2);
      g.line(h[0] + dx * 3, h[1] + dy * 3, shaftEnd[0], shaftEnd[1], '#c0cbdc', 1);
      rotEll(g, c[0], c[1], Rk === 'badminton' ? 4.6 : 5, 3.6, ang, 'rgba(230,236,246,0.45)', Rk === 'badminton' ? '#2c2c40' : '#e43b44'); return;
    }
    if (Rk === 'padel') {
      const c = at(9);
      g.line(h[0], h[1], h[0] + dx * 4, h[1] + dy * 4, '#262b44', 2);
      rotEll(g, c[0], c[1], 5.6, 4.8, ang, '#eceef4', '#e43b44');
      g.px(c[0] - 1, c[1] - 1, '#8b9bb4'); g.px(c[0] + 1, c[1] + 1, '#8b9bb4'); g.px(c[0] + 1, c[1] - 2, '#8b9bb4'); return;
    }
    const c = at(10);
    g.line(h[0], h[1], h[0] + dx * 4, h[1] + dy * 4, '#262b44', 2);
    rotEll(g, c[0], c[1], 6.2, 4.4, ang, 'rgba(236,240,250,0.42)', Rk === 'soft' ? '#2ce8f5' : '#181425');
  }
  function drawPlayer(g, s, C, i) {
    const p = s.P[i], e = s.ents[i], G = group(C);
    const look = OG.lookOf(e);
    if (C.venue === 'beach') look.shoe = look.skin;
    if (G === 'racket' && (e.look & 2) && C.venue !== 'squash' && C.venue !== 'tt') look.cap = '#f2f2f2';
    if (C.venue === 'squash' || C.kind === 'volley') look.sleeves = true;
    const pose = poseOf(g, s, C, i);
    const J = g.figure(p.x, FLOOR - p.h, pose, look, { facing: p.f, scale: 2 });
    if (C.racket) drawRacket(g, C, J, p);
    if (p.sw < 0.16) { // swoosh arc
      const k1 = p.sw / SWD, k0 = Math.max(0, k1 - 0.5), leg = p.sk === 'kick' || p.sk === 'bike';
      if (G === 'racket' || p.sk === 'spike' || leg) {
        const o = leg ? J.hip : J.sh, len = leg ? 24 : (G === 'racket' ? 30 : 18);
        for (let q = 0; q <= 8; q++) {
          const P2 = swingPose(C, p, k0 + (k1 - k0) * q / 8), a = (leg ? P2.lR : P2.aR + P2.t) + (P2.rot || 0);
          g.alpha(0.15 + 0.5 * q / 8); g.rect(o[0] + Math.sin(a) * p.f * len - 1, o[1] + Math.cos(a) * len - 1, 2, 2, '#ffffff'); g.alpha(1);
        }
      }
    }
    return J;
  }

  /* -------------------------------- ball -------------------------------- */
  function patBall(g, x, y, r, rot, cols, outline) {
    const R0 = Math.ceil(r);
    for (let dy = -R0; dy <= R0; dy++) for (let dx = -R0; dx <= R0; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r + 0.3) continue;
      let c;
      if (d2 > (r - 1) * (r - 1) + 0.3) c = outline;
      else c = cols(dx, dy, rot);
      g.px(x + dx, y + dy, c);
    }
  }
  function drawBall(g, s, C) {
    const b = s.ball, x = Math.round(b.x), y = Math.round(b.y), r = C.r;
    b.tr.forEach((q, k) => {
      const a = (k + 1) / (b.tr.length + 1);
      g.alpha(a * 0.6); g.circle(q[0], q[1], Math.max(1, r * (0.4 + 0.6 * a)), b.pow === 2 ? (k % 2 ? PAL.orange : PAL.yellow) : '#ffffff'); g.alpha(1);
    });
    switch (C.ball) {
      case 'tennis': case 'padel':
        g.circle(x, y, 3, '#4a6a10'); g.circle(x, y, 2.2, '#d8f040'); g.px(x - 1, y - 1, '#f8ffd0'); g.px(x + 1, y + 1, '#a8c020'); break;
      case 'soft': g.circle(x, y, 3.2, '#8b9bb4'); g.circle(x, y, 2.4, '#ffffff'); g.px(x + 1, y + 1, '#dfe6f0'); break;
      case 'tt': g.circle(x, y, 2.2, '#c0cbdc'); g.circle(x, y, 1.4, '#ffffff'); break;
      case 'squash': g.circle(x, y, 3, '#dfe6f0'); g.circle(x, y, 2.2, '#000000'); g.circle(x, y, 1.4, '#262b44'); g.px(x - 1, y - 1, '#fee761'); g.px(x, y - 1, '#fee761'); break;
      case 'shuttle': {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        let ux = b.vx / sp, uy = b.vy / sp;
        if (b.held) { ux = 0; uy = 1; }
        const tx = x - ux * 7, ty = y - uy * 7, nx = -uy, ny = ux;
        g.poly([x - ux * 1 + nx * 1.4, y - uy * 1 + ny * 1.4, tx + nx * 3.4, ty + ny * 3.4, tx - nx * 3.4, ty - ny * 3.4, x - ux * 1 - nx * 1.4, y - uy * 1 - ny * 1.4], '#f4f6fa');
        g.line(x, y, tx, ty, '#c0cbdc');
        g.line(tx + nx * 3.4, ty + ny * 3.4, tx - nx * 3.4, ty - ny * 3.4, '#c0cbdc');
        g.circle(x, y, 1.6, '#ffffff'); g.px(x + Math.round(ux), y + Math.round(uy), '#e4a672');
        break;
      }
      case 'volley': case 'beach': {
        const cs = C.ball === 'volley' ? ['#fee761', '#1f5ad0', '#ffffff'] : ['#fee761', '#ffffff', '#2a8fd6'];
        patBall(g, x, y, r, b.rot, (dx, dy, rt) => cs[M.wrap(Math.floor(((Math.atan2(dy, dx) + rt) / 6.2832) * 6 + 0.5 * (dx * dx + dy * dy > 9 ? 1 : 0)), 3)], '#262b44');
        g.px(x - 2, y - 3, '#ffffff');
        break;
      }
      case 'takraw':
        patBall(g, x, y, r, b.rot, (dx, dy, rt) => {
          const c = Math.cos(rt), s2 = Math.sin(rt), u = Math.round(dx * c - dy * s2), v = Math.round(dx * s2 + dy * c);
          return (M.wrap(u + v, 3) === 0 || M.wrap(u - v, 3) === 0) ? '#a8641e' : '#f0b850';
        }, '#6a3a10');
        break;
      case 'teq':
        patBall(g, x, y, r, b.rot, (dx, dy, rt) => {
          const c = Math.cos(rt), s2 = Math.sin(rt), u = dx * c - dy * s2, v = dx * s2 + dy * c;
          return (u * u + v * v < 2.2 || (Math.abs(u) > 2.6 && Math.abs(v) < 1.6) || (Math.abs(v) > 2.6 && Math.abs(u) < 1.6)) ? '#181425' : '#ffffff';
        }, '#3a4466');
        break;
    }
  }

  /* -------------------------------- HUD -------------------------------- */
  const HINT = {
    racket: '{L}{R} 이동 {U} 점프  {A} 타이밍=강타/스매시  {D} 로브',
    tt: '{L}{R} 이동  {A} 타이밍=스매시  {D} 짧은 드롭',
    shuttle: '{L}{R} 이동 {U} 점프  {A} 타이밍=스매시  {D} 드롭',
    volley: '{L}{R} 이동 {U} 점프  {D} 토스  점프 중 {A}=스파이크',
    kick: '{L}{R} 이동  {D} 띄우기  {U} 점프+{A}=시저스 킥',
    teq: '{L}{R} 이동 {U} 점프  {D} 띄우기(3터치)  {A} 타이밍=파워킥',
    squash: '{L}{R} 이동  {A} 타이밍=강타  {D} 드롭샷'
  };
  function matchPoint(s, C, w) {
    const a = s.sc[w] + 1, o = s.sc[1 - w];
    return (a >= C.target && a - o >= 2) || a >= C.cap;
  }
  function hud(g, s, C) {
    const x0 = 112, w = 256, y0 = 2, h = 24;
    g.rect(x0, y0, w, h, 'rgba(14,12,28,0.9)'); g.rectO(x0, y0, w, h, '#5a6988');
    g.rect(x0 + 1, y0 + 1, w - 2, 1, '#3a4466');
    for (let i = 0; i < 2; i++) {
      const e = s.ents[i], L = i === 0;
      g.flag(e.country, L ? x0 + 5 : x0 + w - 23, y0 + 6, 18, 12);
      const nx = L ? x0 + 27 : x0 + w - 27;
      g.text(e.name, nx, y0 + 3, PAL.white, { size: 's', align: L ? 'left' : 'right', maxW: 60 });
      g.text(e.human ? e.tag : e.country, nx, y0 + 14, e.human ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.grey, { size: 'xs', align: L ? 'left' : 'right' });
      const sx = L ? NX - 33 : NX + 5, hot = s.lastW === i && s.phase === 'point';
      g.rect(sx, y0 + 3, 28, 18, hot ? '#a22633' : '#262b44');
      g.rect(sx, y0 + 3, 28, 1, hot ? '#e43b44' : '#3a4466');
      g.text(String(s.sc[i]), sx + 14, y0 + 5, hot ? PAL.yellow : PAL.white, { size: 'l', align: 'center' });
      if (s.server === i && s.phase !== 'end') { g.circle(L ? sx - 5 : sx + 32, y0 + 12, 2, PAL.yellow); g.px(L ? sx - 6 : sx + 31, y0 + 11, '#ffffff'); }
    }
    g.text(':', NX, y0 + 6, PAL.grey, { size: 'm', align: 'center' });
    const left = Math.max(0, LIMIT - s.clock), mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    g.rect(NX - 54, y0 + h, 108, 10, 'rgba(14,12,28,0.8)');
    g.text(C.target + '점 선승', NX - 50, y0 + h + 1, PAL.lightgrey, { size: 'xs' });
    g.text(mm + ':' + (ss < 10 ? '0' : '') + ss, NX + 50, y0 + h + 1, left < 20 ? PAL.red : PAL.lightgrey, { size: 'xs', align: 'right' });
    let tag = '';
    if (s.phase !== 'end' && s.winner < 0) {
      if (s.golden) tag = 'GOLDEN POINT';
      else if (matchPoint(s, C, 0) || matchPoint(s, C, 1)) tag = 'MATCH POINT';
      else if (s.fault) tag = '2nd SERVE';
    }
    if (tag && Math.floor(g.t * 3) % 3 !== 0) g.text(tag, NX, y0 + h + 12, PAL.orange, { size: 's', align: 'center', outline: PAL.black });
  }

  function draw(g, s) {
    const C = cfgOf(s), b = s.ball, t = g.t;
    const ex = s.excite > 0 ? Math.min(1, s.excite) : 0.06;
    g.save();
    if (s.shake > 0) g.translate(Math.round(Math.sin(t * 70) * s.shake * 8), Math.round(Math.cos(t * 55) * s.shake * 5));
    VENUE[C.venue](g, s, C, t, ex);
    s.P.forEach(p => g.ellipse(p.x, FLOOR + 1, Math.max(4, 9 - p.h / 10), 2, 'rgba(0,0,0,0.3)'));
    if (C.table) drawTable(g, C);
    // ball shadow
    {
      const over = C.table && b.x >= C.table.L && b.x <= C.table.R && b.y < surfY(C, b.x);
      const gy = over ? surfY(C, b.x) : FLOOR, hgt = gy - b.y;
      g.ellipse(b.x, gy + (over ? 0 : 1), Math.max(1.5, C.r + 2 - hgt / 50), 1.2, 'rgba(0,0,0,' + (hgt > 120 ? 0.15 : 0.32) + ')');
    }
    if (!C.table && !C.sq) drawNet(g, s, C);
    const order = C.sq ? [1 - s.turn, s.turn] : [0, 1];
    order.forEach(i => drawPlayer(g, s, C, i));
    drawBall(g, s, C);
    s.fx.forEach(f => { g.alpha(Math.min(1, f.l * 3)); g.rect(f.x - 1, f.y - 1, 2, 2, f.c); g.alpha(1); });
    // labels & prompts
    s.P.forEach((p, i) => {
      const e = s.ents[i], ly = FLOOR - p.h - 66;
      const col = e.human ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.lightgrey;
      const dim = C.sq && s.phase === 'rally' && s.turn !== i;
      g.alpha(dim ? 0.5 : 1);
      g.text(e.human ? e.tag : e.country, p.x, ly, col, { size: 'xs', align: 'center', outline: PAL.black });
      g.poly([p.x - 2, ly + 9, p.x + 3, ly + 9, p.x, ly + 12], col);
      g.alpha(1);
      if (e.human && s.phase === 'serve' && s.server === i) {
        const u = s.toss / TOSS, now = s.toss >= 0 && u >= 0.3 && u < 0.8;
        if ((s.toss < 0 && Math.floor(t * 3) % 2 === 0) || now) {
          const px0 = M.clamp(p.x, 26, W - 26);
          g.rect(px0 - 24, ly - 15, 48, 14, 'rgba(10,8,24,0.8)');
          g.rich(now ? '{A} 지금!' : '{A} 서브', px0, ly - 13, now ? PAL.yellow : PAL.white, { align: 'center', size: 'xs' });
        }
      }
      if (p.cue && Math.floor(t * 16) % 2 === 0) g.circleO(b.x, b.y, C.r + 4, col);
    });
    g.restore();
    if (s.flash > 0) { g.alpha(Math.min(0.4, s.flash * 3)); g.rect(0, 0, W, 270, '#ffffff'); g.alpha(1); }
    hud(g, s, C);
    s.pops.forEach(pp => {
      const a = pp.t > 0.9 ? Math.max(0, 1 - (pp.t - 0.9) / 0.4) : 1;
      g.alpha(a);
      g.text(pp.s, pp.x, pp.y - pp.t * 16, pp.c, { size: pp.big ? (pp.t < 0.08 ? 'xxl' : 'xl') : 'l', align: 'center', outline: PAL.black });
      g.alpha(1);
    });
    if (s.ents.some(e => e.human)) {
      g.rect(0, 251, W, 19, 'rgba(10,8,22,0.55)');
      g.rich(HINT[C.kind], NX, 255, PAL.lightgrey, { align: 'center', size: 'xs' });
    }
    if (s.t < 0.7) {
      const sv = s.ents[s.server];
      if (s.t < 0) {
        const msg = '서브: ' + (sv.human ? sv.tag + ' ' : '') + sv.name, mw = g.textW(msg, 'm') + 16;
        g.rect(NX - mw / 2, 142, mw, 17, 'rgba(10,8,24,0.75)');
        g.text(msg, NX, 145, PAL.white, { size: 'm', align: 'center' });
      }
      g.countdown(-s.t);
    }
    if (s.phase === 'end') {
      const w = s.winner, e = s.ents[w];
      g.confetti(t, 70);
      g.rect(0, 80, W, 62, 'rgba(10,8,24,0.62)');
      g.banner('GAME SET', 84, PAL.yellow);
      const nm = (e.human ? e.tag + ' ' : '') + e.name + ' 승리!', tw = g.textW(nm, 'l');
      g.flag(e.country, NX - tw / 2 - 16, 117, 24, 16, { wave: t });
      g.text(nm, NX + 14, 116, PAL.white, { size: 'l', align: 'center', outline: e.human ? OG.shade(OG.PCOLORS[e.pid % OG.PCOLORS.length], -0.4) : PAL.black });
    }
  }

  /* ------------------------------ register ------------------------------ */
  OG.defineEngine('net', { type: 'duel', init, update, draw, cpuMatch });

  OG.defineEvents([
    { id: 'tennis', name: '테니스', en: 'Tennis', sport: 'tennis', icon: '🎾', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.tennis,
      help: ['{L}{R} 이동 {U} 점프 · 공이 오면 자동 스윙', '맞기 직전 {A} = 강타 / 높은 공은 스매시!', '네트 쪽 방향키 = 깊게 · {D} 로브 (타이브레이크 7점)'] },
    { id: 'table_tennis', name: '탁구', en: 'Table Tennis', sport: 'table_tennis', icon: '🏓', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.table_tennis,
      help: ['{L}{R} 이동 · 테이블에 튄 공을 자동 리턴', '맞기 직전 {A} = 스매시!', '네트 쪽 방향키 = 깊게 · {D} 짧은 드롭 (11점)'] },
    { id: 'badminton', name: '배드민턴', en: 'Badminton', sport: 'badminton', icon: '🏸', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.badminton,
      help: ['{L}{R} 이동 {U} 점프 · 셔틀콕이 오면 자동 스윙', '맞기 직전 {A} = 스매시! 점프 중이면 점프 스매시', '네트 쪽 방향키 = 깊게 · {D} 드롭샷 (15점)'] },
    { id: 'beach_volley', name: '비치발리볼', en: 'Beach Volleyball', sport: 'beach_volleyball', icon: '🏐', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.beach_volley,
      help: ['{L}{R} 이동 {U} 점프 · 공에 닿으면 자동 리시브', '{D} 누른 채 받기 = 토스 (3번 터치까지)', '점프해서 {A} 타이밍 = 스파이크! (11점)'] },
    { id: 'volleyball', name: '배구', en: 'Volleyball', sport: 'volleyball', icon: '🏐', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.volleyball,
      help: ['{L}{R} 이동 {U} 점프 · 공에 닿으면 자동 리시브', '{D} 누른 채 받기 = 토스 (3번 터치까지)', '점프해서 {A} 타이밍 = 스파이크! (11점)'] },
    { id: 'sepak_takraw', name: '세팍타크로', en: 'Sepak Takraw', sport: 'sepak_takraw', icon: '⚽', tags: ['asian'], engine: 'net', cfg: CFG.sepak_takraw,
      help: ['{L}{R} 이동 · 발/머리로 자동 킥 (손 금지)', '{D} 누른 채 = 띄우기 (3번 터치까지)', '{U} 점프 + {A} = 시저스 킥 스파이크! (11점)'] },
    { id: 'soft_tennis', name: '소프트테니스', en: 'Soft Tennis', sport: 'soft_tennis', icon: '🎾', tags: ['asian'], engine: 'net', cfg: CFG.soft_tennis,
      help: ['{L}{R} 이동 {U} 점프 · 말랑한 공이 높게 튀어요', '맞기 직전 {A} = 강타 / 스매시!', '네트 쪽 방향키 = 깊게 · {D} 로브 (7점)'] },
    { id: 'padel', name: '파델', en: 'Padel', sport: 'padel', icon: '🎾', tags: ['asian'], engine: 'net', cfg: CFG.padel,
      help: ['{L}{R} 이동 {U} 점프 · 2026 신규 종목!', '바닥에 튄 뒤 유리벽에 맞고 나온 공도 OK', '맞기 직전 {A} = 강타 · {D} 로브 (7점)'] },
    { id: 'teqball', name: '테크볼', en: 'Teqball', sport: 'teqball', icon: '⚽', tags: ['asian'], engine: 'net', cfg: CFG.teqball,
      help: ['{L}{R} 이동 {U} 점프 · 곡면 테이블, 발/머리만!', '{D} 누른 채 = 볼 컨트롤 (3번 터치까지)', '맞기 직전 {A} = 파워킥! (12점, 2026 신규)'] },
    { id: 'squash', name: '스쿼시', en: 'Squash', sport: 'squash', icon: '🎾', tags: ['summer', 'asian'], engine: 'net', cfg: CFG.squash,
      help: ['{L}{R} 이동 · 번갈아 오른쪽 앞벽에 치기', '빨간 틴보다 위로! 맞기 직전 {A} = 강타', '{D} 드롭샷 · 벽 쪽 방향키 = 낮게 (11점)'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
