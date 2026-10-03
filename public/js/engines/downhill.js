/* =========================================================================
 * engine: downhill — top-down course racing (vertical scroller / free 2D)
 *   kinds:  ski    alpine DH / SL / GS, snowboard PGS (parallel lanes)
 *           moguls freestyle moguls (rhythm absorb + air tricks, scored)
 *           cross  ski cross / snowboard cross (4 racers on course, bumping)
 *           sled   bobsleigh / luge / skeleton (push start + ice channel)
 *           canoe  canoe slalom (current, eddies, up/downstream gates)
 *           mtb    mountain bike XC (pedal mash, bunny hops)
 *           kart   esports kart (neon loop, drift boost, 2 laps, free 2D)
 *           sail   dinghy fleet race (wind, no-go zone, tacking, free 2D)
 * All humans race simultaneously in split-screen views. CPU entrants are
 * either physically on course (cross, PGS rival, kart, sail) or simulated
 * from skill (time trials; the best one is shown as a "leader ghost").
 * A reference AI run at init calibrates the display-time scale so that the
 * AI line maps to a realistic elite time (e.g. 1:42.80 for a downhill).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const TAU = Math.PI * 2, SP = 32, LANE = 124, DT = 1 / 60;
  const clamp = M.clamp, lerp = M.lerp, hash = OG.hash;
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const sgn = v => v < 0 ? -1 : 1;
  const wrapA = a => M.wrap(a + Math.PI, TAU) - Math.PI;

  /* ------------------------------ input ------------------------------ */
  const BL = { l: false, r: false, u: false, d: false, a: false, lp: false, rp: false, up: false, dp: false, ap: false,
    lr: false, rr: false, ur: false, dr: false, ar: false, lc: 0, rc: 0, uc: 0, dc: 0, ac: 0 };
  const aiIn = () => Object.assign({}, BL);
  const nP = (inp, b) => { const c = inp[b + 'c']; return c != null ? c : (inp[b + 'p'] ? 1 : 0); };
  const press = (I, b) => { I[b] = true; I[b + 'p'] = true; I[b + 'c'] = 1; };
  // alternating ◀▶ mash counter (same button twice counts little)
  function mash(r, inp) {
    let n = 0;
    const lc = nP(inp, 'l'), rc = nP(inp, 'r');
    if (lc) { n += r.lm === 1 ? 0.3 * lc : 1 + 0.3 * (lc - 1); r.lm = 1; }
    if (rc) { n += r.lm === 2 ? 0.3 * rc : 1 + 0.3 * (rc - 1); r.lm = 2; }
    return n;
  }

  /* --------------------------- course maths --------------------------- */
  // Course = samples every SP px of y: cx (centre x), w (half width), sl (slope*100)
  function crs(a, f) {
    const n = a.length, i = Math.floor(f), t = f - i;
    const p0 = a[clamp(i - 1, 0, n - 1)], p1 = a[clamp(i, 0, n - 1)], p2 = a[clamp(i + 1, 0, n - 1)], p3 = a[clamp(i + 2, 0, n - 1)];
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  function lin(a, f) { const n = a.length, i = Math.floor(f), t = f - i; const p = a[clamp(i, 0, n - 1)], q = a[clamp(i + 1, 0, n - 1)]; return p + (q - p) * t; }
  const fi = (C, y) => (y - C.y0) / SP;
  const cX = (C, y) => crs(C.cx, fi(C, y));
  const cW = (C, y) => lin(C.w, fi(C, y));
  const cS = (C, y) => lin(C.sl, fi(C, y)) / 100;
  const cD = (C, y) => (cX(C, y + 8) - cX(C, y - 8)) / 16;
  function cK(C, y) { // signed curvature (1/px); >0 = bends towards +x
    const h = 32, a = cX(C, y - h), b = cX(C, y), c = cX(C, y + h);
    const d1 = (c - a) / (2 * h), d2 = (a - 2 * b + c) / (h * h);
    return d2 / Math.pow(1 + d1 * d1, 1.5);
  }
  // segments: [{len, d (dx/dy target), w, sl, e (ease)}], first segment also covers y<0
  function build(segs, y0, yEnd, ease) {
    const C = { y0, cx: [], w: [], sl: [] };
    let x = 0, d = 0, w = segs[0].w, sl = segs[0].sl, si = 0, end = segs[0].len;
    for (let y = y0; y <= yEnd + SP * 3; y += SP) {
      while (y > end && si < segs.length - 1) { si++; end += segs[si].len; }
      const S = segs[si];
      d += (S.d - d) * (S.e || ease);
      w += (S.w - w) * 0.2; sl += (S.sl - sl) * 0.25;
      C.cx.push(r1(x)); C.w.push(Math.round(w)); C.sl.push(Math.round(sl * 100));
      x += d * SP;
    }
    return C;
  }

  /* ------------------------- physics tables -------------------------- */
  // g: gravity accel at slope 1 · dr/dk: drag untucked/tucked · tr: turn rate · tv: speed where turn rate halves
  // ret: return to fall line · cv: carving speed loss · br: brake · lead: AI gate look-ahead (s) · crash: fence impact limit
  const SKI = {
    dh: { g: 250, dr: 0.0023, dk: 0.00145, tr: 2.9, tv: 290, ret: 0.5, cv: 0.2, br: 240, lead: 0.3, crash: 175, kmh: 0.34, vmax: 410 },
    gs: { g: 205, dr: 0.0034, dk: 0.0025, tr: 4.0, tv: 260, ret: 0.6, cv: 0.24, br: 240, lead: 0.28, crash: 9999, kmh: 0.3, vmax: 285 },
    sl: { g: 185, dr: 0.0045, dk: 0.0036, tr: 5.6, tv: 230, ret: 0.7, cv: 0.22, br: 240, lead: 0.24, crash: 9999, kmh: 0.26, vmax: 225 },
    pgs: { g: 205, dr: 0.0036, dk: 0.0027, tr: 3.9, tv: 260, ret: 0.6, cv: 0.24, br: 240, lead: 0.28, crash: 9999, kmh: 0.28, vmax: 275 },
    sx: { g: 215, dr: 0.003, dk: 0.0021, tr: 3.6, tv: 260, ret: 0.6, cv: 0.22, br: 240, lead: 0, crash: 9999, kmh: 0.28, vmax: 320 },
    bx: { g: 210, dr: 0.0031, dk: 0.0022, tr: 3.4, tv: 260, ret: 0.6, cv: 0.22, br: 240, lead: 0, crash: 9999, kmh: 0.27, vmax: 310 }
  };
  const SLED = {
    bob: { pl: 300, vp: 215, pk: 26, KB: 0.055, steer: 130, G: 178, dr: 0.00078, fr: 0.03, ll: 0.5, W: 24, lim: 18, kmh: 0.34 },
    luge: { pl: 170, vp: 150, pk: 22, KB: 0.058, steer: 100, G: 175, dr: 0.00076, fr: 0.03, ll: 0.55, W: 24, lim: 19, kmh: 0.35 },
    skel: { pl: 270, vp: 200, pk: 24, KB: 0.056, steer: 115, G: 170, dr: 0.00081, fr: 0.03, ll: 0.5, W: 24, lim: 19, kmh: 0.33 }
  };
  const MTB = { G: 240, roll: 0.32, dr: 0.0012, pf: 300, tr: 3.4, tv: 240, ret: 0.9, br: 330, walk: 30, kmh: 0.12 };
  const KART = { vmax: 300, acc: 1.25, tr: 2.6, bst: 1.42, kmh: 0.42 };
  const SAIL = { vb: 118, tr: 1.5, kn: 0.075 };
  const TRICK = { bf: { n: '백플립', d: 0.7, dd: 0.9 }, ck: { n: '콕 720', d: 0.8, dd: 1.0 }, sp: { n: '스프레드 이글', d: 0.42, dd: 0.62 } };

  /* ------------------------- course generators ----------------------- */
  const GEN = {
    ski(cf, R) {
      const sub = cf.sub;
      const W = { dh: 72, gs: 62, sl: 56, pgs: 46 }[sub];
      const total = { dh: 9400, gs: 6000, sl: 4400, pgs: 4600 }[sub];
      const segs = [{ len: 420, d: 0, w: W, sl: sub === 'dh' ? 1.25 : 1.1 }];
      const jumps = [], spec = [];
      let y = 420, side = R.sign();
      while (y < total - 560) {
        let len;
        if (sub === 'dh') {
          const k = R.f();
          if (k < 0.5) { len = R.int(580, 820); segs.push({ len, d: side * R.range(0.24, 0.48), w: W + R.int(-4, 10), sl: R.range(0.95, 1.15) }); side = -side; }
          else if (k < 0.78) { len = R.int(640, 780); segs.push({ len, d: R.range(-0.04, 0.04), w: W - 6, sl: R.range(1.15, 1.35) }); jumps.push(Math.round(y + len * 0.5)); }
          else { len = R.int(520, 700); segs.push({ len, d: side * R.range(0.04, 0.12), w: W + 6, sl: 0.55 }); }
        } else {
          len = R.int(520, 900); segs.push({ len, d: side * R.range(0.04, sub === 'sl' ? 0.12 : 0.18), w: W, sl: R.range(0.92, 1.12) });
          if (R.chance(0.7)) side = -side;
        }
        y += len;
      }
      segs.push({ len: total - y + 60, d: 0, w: W, sl: 1.0 });
      segs.push({ len: 1500, d: 0, w: W + 50, sl: -0.7 });
      const C = build(segs, -352, total + 1100, sub === 'dh' ? 0.11 : 0.09);
      C.len = total;
      C.gates = [];
      if (sub === 'dh') {
        for (let gy = 760; gy < total - 300; gy += R.int(430, 560)) {
          if (jumps.some(j => Math.abs(j - gy) < 230)) continue;
          const hw = cW(C, gy), off = clamp(cK(C, gy) * 9000, -1, 1) * hw * 0.3;
          C.gates.push({ y: gy, x: r1(cX(C, gy) + off), w: 60, c: 0, h: -9 });
        }
      } else {
        const sp = { gs: [205, 240], sl: [130, 150], pgs: [182, 206] }[sub];
        const A = { gs: 40, sl: 23, pgs: 26 }[sub], gw = { gs: 34, sl: 24, pgs: 30 }[sub];
        let sd = R.sign();
        for (let gy = 520; gy < total - 230; gy += R.int(sp[0], sp[1])) {
          C.gates.push({ y: gy, x: r1(cX(C, gy) + sd * (A + R.range(-5, 5))), w: gw, c: C.gates.length % 2, h: -9 });
          sd = -sd;
        }
      }
      C.f = jumps.map(j => ({ t: 'j', y: j, k: 1 }));
      jumps.forEach(j => spec.push([j - 60, j + 140]));
      spec.push([total - 320, total + 260]); spec.push([-90, 60]);
      C.spx = spec;
      C.ck = [0.25, 0.5, 0.75].map(f => Math.round(total * f));
      return C;
    },
    cross(cf, R) {
      const W = 58, total = 6300;
      const segs = [{ len: 340, d: 0, w: W, sl: 1.6 }];
      const f = [], spec = [];
      let y = 340, side = R.sign();
      const plan = ['bank', 'roll', 'bank', 'jump', 'bank', 'roll', 'bank', 'jump', 'bank', 'roll', 'bank', 'jump', 'bank', 'roll'];
      for (const p of plan) {
        if (y > total - 650) break;
        let len;
        if (p === 'bank') { len = R.int(360, 460); segs.push({ len, d: side * R.range(0.7, 0.98), w: W + 8, sl: 1.0, e: 0.24 }); side = -side; }
        else if (p === 'roll') {
          len = R.int(440, 520); segs.push({ len, d: R.range(-0.05, 0.05), w: W, sl: 1.05, e: 0.2 });
          const n = R.int(3, 5); for (let k = 0; k < n; k++) f.push({ t: 'r', y: Math.round(y + 120 + k * 68) });
        } else { len = R.int(440, 520); segs.push({ len, d: R.range(-0.04, 0.04), w: W - 4, sl: 1.15, e: 0.2 }); const jy = Math.round(y + len * 0.45); f.push({ t: 'j', y: jy, k: 0.8 }); spec.push([jy - 50, jy + 120]); }
        y += len;
      }
      segs.push({ len: total - y + 60, d: 0, w: W, sl: 1.0, e: 0.15 });
      segs.push({ len: 1500, d: 0, w: W + 40, sl: -0.7 });
      const C = build(segs, -352, total + 1100, 0.12);
      C.len = total; C.f = f; C.gates = null;
      spec.push([total - 300, total + 260]); spec.push([-90, 60]);
      C.spx = spec; C.ck = null;
      return C;
    },
    moguls(cf, R) {
      const len = 3300, W = 60;
      const C = build([{ len: len + 1500, d: 0, w: W, sl: 1 }], -352, len + 1100, 0.1);
      C.len = len;
      C.kk = [Math.round(len * 0.27), Math.round(len * 0.84)];
      C.rows = [];
      for (let y = 230; y < len - 110; y += 60) if (!C.kk.some(k => y > k - 160 && y < k + 175)) C.rows.push(y);
      C.spx = [[C.kk[0] - 40, C.kk[0] + 140], [C.kk[1] - 40, len + 260]];
      C.ck = null; C.gates = null;
      return C;
    },
    sled(cf, R) {
      const P = SLED[cf.sub], W = P.W, total = 9000;
      const segs = [{ len: P.pl + 180, d: 0, w: W, sl: 0.7 }];
      let y = P.pl + 180, side = R.sign();
      while (y < total - 700) {
        let len;
        if (R.chance(0.72)) { len = R.int(300, 520); segs.push({ len, d: side * R.range(0.5, 1.0), w: W, sl: R.range(0.85, 1.15), e: 0.15 }); side = R.chance(0.78) ? -side : side; }
        else { len = R.int(260, 420); segs.push({ len, d: R.range(-0.08, 0.08), w: W, sl: R.range(1.05, 1.3), e: 0.15 }); }
        y += len;
      }
      segs.push({ len: total - y + 60, d: 0, w: W, sl: 0.9, e: 0.12 });
      segs.push({ len: 1600, d: 0, w: W, sl: -2.4 });
      const C = build(segs, -352, total + 1300, 0.15);
      C.len = total; C.pl = P.pl;
      C.cv = [];
      let inC = false, c0 = 0, n = 0, dir = 0;
      for (let yy = C.pl; yy < total; yy += 16) {
        const k = cK(C, yy), on = Math.abs(k) > 0.0011;
        if (on && !inC) { inC = true; c0 = yy; dir = sgn(k); }
        else if (inC && (!on || sgn(k) !== dir)) { inC = false; if (yy - c0 > 64) C.cv.push([c0, yy, ++n, dir]); if (on) { inC = true; c0 = yy; dir = sgn(k); } }
      }
      C.ck = [0.25, 0.5, 0.75].map(f => Math.round(total * f));
      C.gates = null;
      return C;
    },
    canoe(cf, R) {
      const total = 4300;
      const segs = [{ len: 260, d: 0, w: 84, sl: 0.7 }];
      let y = 260, side = R.sign();
      while (y < total - 400) { const len = R.int(420, 700); segs.push({ len, d: side * R.range(0.12, 0.3), w: R.int(68, 84), sl: R.range(0.9, 1.2) }); side = -side; y += len; }
      segs.push({ len: total - y + 60, d: 0, w: 80, sl: 0.9 });
      segs.push({ len: 900, d: 0, w: 96, sl: 0.3 });
      const C = build(segs, -352, total + 700, 0.1);
      C.len = total; C.cur = 62;
      const n = 14, G = [], ed = [];
      const ups = [];
      while (ups.length < 4) { const k = R.int(2, n - 2); if (!ups.some(u => Math.abs(u - k) < 2)) ups.push(k); }
      for (let k = 0; k < n; k++) {
        const gy = Math.round(400 + k * (total - 720) / (n - 1));
        const cx = cX(C, gy), hw = cW(C, gy);
        if (ups.includes(k)) {
          const sd = R.sign(), gx = cx + sd * (hw - 25);
          G.push({ y: gy, x: r1(gx), w: 24, up: 1, n: k + 1, h: -9 });
          ed.push([r1(gx - sd * 3), gy + 14, 52]);
        } else G.push({ y: gy, x: r1(cx + R.range(-0.4, 0.4) * hw), w: 24, up: 0, n: k + 1, h: -9 });
      }
      const rk = [];
      for (let k = 0; k < 18; k++) {
        const ry = R.int(300, total - 150);
        if (G.some(g => Math.abs(g.y - ry) < 75)) continue;
        const cx = cX(C, ry), hw = cW(C, ry), rx = cx + R.range(-0.78, 0.78) * hw;
        rk.push([r1(rx), ry, R.int(5, 9)]);
        if (R.chance(0.5)) ed.push([r1(rx), ry + 22, 22]);
      }
      const rp = [];
      for (let k = 0; k < 8; k++) { const ry = R.int(250, total - 100); if (!G.some(g => Math.abs(g.y - ry) < 40)) rp.push(ry); }
      C.gates = G; C.rk = rk; C.ed = ed; C.rp = rp;
      C.ck = [0.33, 0.66].map(f => Math.round(total * f));
      C.spx = [[-120, 200], [total - 300, total + 300], [Math.round(total * 0.5) - 200, Math.round(total * 0.5) + 200]];
      return C;
    },
    mtb(cf, R) {
      const total = 6800;
      const segs = [{ len: 320, d: 0, w: 22, sl: 0.15 }];
      const ob = [], zones = [];
      let y = 320, side = R.sign();
      const plan = ['flat', 'climb', 'desc', 'flat', 'climb', 'desc', 'flat', 'climb', 'desc', 'flat', 'climb', 'desc', 'flat'];
      for (const p of plan) {
        if (y > total - 520) break;
        let len;
        if (p === 'climb') {
          len = R.int(340, 460); segs.push({ len, d: side * R.range(0.08, 0.25), w: 18, sl: -0.62, e: 0.12 }); zones.push([y, y + len, -1]);
          ob.push({ t: 'root', y: Math.round(y + len * 0.55) });
        } else if (p === 'desc') {
          len = R.int(560, 760); segs.push({ len, d: side * R.range(0.32, 0.52), w: 21, sl: 1.0, e: 0.12 }); zones.push([y, y + len, 1]);
          for (let k = 0; k < 3; k++) ob.push({ t: 'rock', y: Math.round(y + len * (0.22 + k * 0.26) + R.int(-20, 20)), x: r1(R.sign() * R.range(4, 10)), r: R.int(4, 6) });
          ob.push({ t: 'root', y: Math.round(y + len * 0.9) });
        } else {
          len = R.int(380, 520); segs.push({ len, d: side * R.range(0.08, 0.3), w: 22, sl: 0.12, e: 0.12 }); zones.push([y, y + len, 0]);
          ob.push({ t: 'root', y: Math.round(y + len * 0.3) });
          if (R.chance(0.6)) ob.push({ t: 'log', y: Math.round(y + len * 0.62) });
          else ob.push({ t: 'mud', y: Math.round(y + len * 0.55), l: R.int(50, 80) });
        }
        if (R.chance(0.6)) side = -side;
        y += len;
      }
      segs.push({ len: total - y + 60, d: 0, w: 24, sl: 0.1, e: 0.12 });
      segs.push({ len: 900, d: 0, w: 30, sl: -0.6 });
      const C = build(segs, -352, total + 700, 0.12);
      C.len = total;
      ob.sort((a, b) => a.y - b.y);
      C.ob = ob; C.zn = zones; C.gates = null;
      C.ck = [0.25, 0.5, 0.75].map(f => Math.round(total * f));
      C.spx = [[-120, 220], [total - 300, total + 260]];
      zones.forEach(z => { if (z[2] < 0) C.spx.push([z[0] + 60, z[1]]); });
      return C;
    },
    kart(cf, R) {
      const N = 12, cp = [];
      for (let i = 0; i < N; i++) { const a = (i / N) * TAU + R.range(-0.1, 0.1), rr = R.range(430, 650); cp.push(Math.cos(a) * rr * 1.35, Math.sin(a) * rr); }
      const crc = (i, t, o) => {
        const g = k => cp[2 * M.wrap(k, N) + o];
        const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
        return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
      };
      let pts = [];
      for (let i = 0; i < N; i++) for (let k = 0; k < 10; k++) pts.push([crc(i, k / 10, 0), crc(i, k / 10, 1)]);
      const n = pts.length;
      // start on the straightest part
      const ang = i => { const a = pts[M.wrap(i, n)], b = pts[M.wrap(i + 1, n)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
      let best = 0, bv = 1e9;
      for (let i = 0; i < n; i++) { let s2 = 0; for (let k = -4; k < 5; k++) s2 += Math.abs(M.angDiff(ang(i + k), ang(i + k + 1))); if (s2 < bv) { bv = s2; best = i; } }
      pts = pts.slice(best).concat(pts.slice(0, best));
      const P = [], cum = [0];
      pts.forEach(p => P.push(r1(p[0]), r1(p[1])));
      let L = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; L += Math.hypot(P[2 * j] - P[2 * i], P[2 * j + 1] - P[2 * i + 1]); cum.push(r1(L)); }
      const C = { p: P, cum, L: r1(L), hw: 36, laps: 2, gates: null };
      C.pads = [0.2, 0.47, 0.76].map((f, k) => { const q = kPoint(C, L * f, k % 2 ? 13 : -13); return [r1(q[0]), r1(q[1]), r2(q[2])]; });
      C.items = [];
      [0.33, 0.62, 0.9].forEach(f => { for (let k = -1; k <= 1; k++) { const q = kPoint(C, L * f, k * 18); C.items.push([r1(q[0]), r1(q[1])]); } });
      return C;
    },
    sail(cf, R) {
      return { m: [[R.int(-70, 70), -1050], [R.int(470, 560), R.int(-570, -470)]], fl: [-165, 165], cb: [178, 2], pin: [-176, 0],
        w0: r2(R.range(-0.08, 0.08)), wp: r2(R.f() * TAU), gates: null, len: 0 };
    }
  };

  /* kart track helpers */
  function kPoint(C, s, off) { // point at arc length s (+ lateral offset) → [x, y, tangentAngle]
    const n = C.p.length / 2;
    s = M.wrap(s, C.L);
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (C.cum[mid] <= s) lo = mid; else hi = mid - 1; }
    const i = lo, j = (i + 1) % n, segL = (C.cum[i + 1] - C.cum[i]) || 1, t = (s - C.cum[i]) / segL;
    const ax = C.p[2 * i], ay = C.p[2 * i + 1], bx = C.p[2 * j], by = C.p[2 * j + 1];
    const tx = (bx - ax) / segL, ty = (by - ay) / segL;
    return [ax + (bx - ax) * t - ty * (off || 0), ay + (by - ay) * t + tx * (off || 0), Math.atan2(ty, tx)];
  }
  function kNear(C, x, y, hint, full) {
    const n = C.p.length / 2, P = C.p;
    let best = 1e18, bi = 0, bt = 0;
    const lo = full ? 0 : -8, hi = full ? n - 1 : 8;
    for (let k = lo; k <= hi; k++) {
      const i = full ? k : M.wrap(hint + k, n), j = (i + 1) % n;
      const ax = P[2 * i], ay = P[2 * i + 1], ex = P[2 * j] - ax, ey = P[2 * j + 1] - ay, L2 = ex * ex + ey * ey || 1;
      const t = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1);
      const qx = ax + ex * t - x, qy = ay + ey * t - y, d2 = qx * qx + qy * qy;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    const j = (bi + 1) % n, ax = P[2 * bi], ay = P[2 * bi + 1], segL = (C.cum[bi + 1] - C.cum[bi]) || 1;
    const tx = (P[2 * j] - ax) / segL, ty = (P[2 * j + 1] - ay) / segL;
    const off = (x - ax) * -ty + (y - ay) * tx;
    return { i: bi, s: C.cum[bi] + bt * segL, off, tx, ty };
  }

  /* --------------------------- canoe current -------------------------- */
  function current(C, x, y) {
    const cx = cX(C, y), hw = cW(C, y), d = cD(C, y);
    const o = clamp((x - cx) / hw, -1, 1);
    let m = C.cur * (1 - 0.55 * o * o) * cS(C, y);
    for (let k = 0; k < C.ed.length; k++) {
      const e = C.ed[k], dx = x - e[0], dy = y - e[1];
      if (Math.abs(dx) > e[2] || Math.abs(dy) > e[2]) continue;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < e[2]) m = lerp(m, -C.cur * 0.45, Math.pow(1 - dd / e[2], 0.6));
    }
    if (y < 0) m *= 0.35; else if (y > C.len + 60) m *= 0.4;
    const n = 1 / Math.sqrt(1 + d * d);
    return [d * n * m, n * m];
  }

  /* ---------------------------- sailing wind -------------------------- */
  function wind(s) { return s.C.w0 + 0.17 * Math.sin(s.t * 0.11 + s.C.wp) + 0.06 * Math.sin(s.t * 0.37 + s.C.wp * 2); }
  function polar(al) {
    if (al < 0.62) return 0;
    if (al < 0.8) return (al - 0.62) / 0.18 * 0.72;
    if (al < 1.6) return 0.72 + (al - 0.8) / 0.8 * 0.28;
    if (al < 2.4) return 1 - (al - 1.6) / 0.8 * 0.08;
    return 0.92 - (al - 2.4) / (Math.PI - 2.4) * 0.12;
  }
  function sailPts(C) { return [[0, 45], C.m[0], C.m[1], [0, -12]]; }
  function sailProg(s, r) {
    const P = sailPts(s.C);
    const L = k => Math.hypot(P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]) * (k === 0 ? 1.4 : 1);
    let tot = 0; for (let k = 0; k < 3; k++) tot += L(k);
    const mk = Math.min(r.mk, 2);
    let rem = Math.hypot(P[mk + 1][0] - r.x, P[mk + 1][1] - r.y) * (mk === 0 ? 1.4 : 1);
    for (let k = mk + 1; k < 3; k++) rem += L(k);
    return clamp(1 - rem / tot, 0.01, 1);
  }

  /* ------------------------------ helpers ----------------------------- */
  function pop(s, r, txt, c) {
    if (s.cal) return;
    s.pops.push({ r: r.k, x: txt, c: c || PAL.white, t: r2(s.t) });
    if (s.pops.length > 10) s.pops.shift();
  }
  function trail(s, r, gap) {
    if (s.cal || s.fr % 4) return;
    if (gap) { if (r.tr.length && r.tr[r.tr.length - 2] !== -9999) r.tr.push(-9999, 0); }
    else r.tr.push(Math.round(r.x), Math.round(r.y));
    if (r.tr.length > 60) r.tr.splice(0, 2);
  }
  function crash(s, r, msg, dur) {
    r.cr = dur || 1.6; r.z = 0; r.vz = 0; r.crn = (r.crn || 0) + 1;
    if (r.h) { OG.sfx(s, 'crash'); pop(s, r, msg, PAL.red); }
  }
  function finishAt(s, r, py, line) {
    const fr = clamp((line - py) / ((r.y - py) || 1), 0, 1);
    r.fin = r2(s.t - DT * (1 - fr));
    r.res = r2(r.fin * (s.sc || 1) + r.pen);
    if (r.h && !s.cal) { OG.sfx(s, 'cheer'); }
  }
  function splits(s, r, py) {
    const ck = s.C.ck;
    if (!ck || !r.h || r.out || !s.gh || !s.rck || s.cal) return;
    for (let k = 0; k < ck.length; k++) {
      if (!(py < ck[k] && r.y >= ck[k]) || s.rck[k] == null) continue;
      const w = (s.gh.T / s.sc) / s.ref;
      const diff = (s.t - s.rck[k] * w) * s.sc + r.pen;
      r.sd = r2(diff); r.sdt = r2(s.t);
      pop(s, r, (diff >= 0 ? '+' : '-') + Math.abs(diff).toFixed(2), diff >= 0 ? PAL.red : PAL.green);
      OG.sfx(s, diff < 0 ? 'good' : 'beep');
    }
  }

  /* ============================== PHYSICS ============================== */
  function stepSki(s, r, inp, dt) {
    const C = s.C, P = SKI[s.sub];
    const px = r.x, py = r.y;
    r.ld = Math.max(0, r.ld - dt);
    if (r.cr > 0) {
      r.cr -= dt; r.v = Math.max(0, r.v - r.v * 2.4 * dt);
      r.x += Math.sin(r.a) * r.v * dt; r.y += Math.cos(r.a) * r.v * dt;
      if (r.cr <= 0) {
        r.cr = 0; const cx = cX(C, r.y), hw = cW(C, r.y);
        r.x = clamp(r.x, cx - hw * 0.5, cx + hw * 0.5); r.a = Math.atan(cD(C, r.y)); r.v = 50; r.z = 0; r.vz = 0;
      }
      postSki(s, r, px, py); return;
    }
    const done = r.fin >= 0 || !!r.out;
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st; r.tk = !done && inp.d ? 1 : 0;
    let drag = r.tk ? P.dk : P.dr;
    if (s.kind === 'cross') { // slipstream
      r.df = 0;
      for (const o of s.R) { if (o !== r && o.y - r.y > 8 && o.y - r.y < 46 && Math.abs(o.x - r.x) < 8) { drag *= 0.8; r.df = 1; break; } }
    }
    if (r.z > 0 || r.vz > 0) {
      r.vz -= 900 * dt; r.z += r.vz * dt; r.at = (r.at || 0) + dt;
      r.a += st * 0.35 * dt;
      r.v = Math.max(0, r.v - drag * r.v * r.v * dt);
      r.sp = 0;
      if (r.z <= 0) {
        r.z = 0; r.vz = 0;
        const ca = Math.atan(cD(C, r.y));
        if (Math.abs(r.a - ca) > 0.62 && r.fin < 0 && r.at > 0.5) crash(s, r, '착지 실패!');
        else { r.ld = 0.35; if (r.h && r.at > 0.4) { OG.sfx(s, 'land'); if (r.at > 0.6) pop(s, r, 'AIR ' + r.at.toFixed(1) + 's', PAL.cyan); } r.v *= 0.98; }
      }
    } else {
      const k = cK(C, r.y);
      const bank = s.kind === 'cross' && Math.abs(k) > 0.0009;
      const ca = Math.atan(cD(C, r.y));
      const tr = P.tr * P.tv / (P.tv + r.v) * (r.tk ? 0.55 : 1) * (bank ? 1.7 : 1);
      r.a += st * tr * dt;
      if (!st) r.a -= (r.a - (bank ? ca : 0)) * P.ret * dt;
      r.a = clamp(r.a, -1.45, 1.45);
      let acc = P.g * cS(C, r.y) * Math.cos(r.a) - drag * r.v * r.v;
      acc -= Math.abs(st) * P.cv * r.v * (bank ? 0.35 : 1);
      const brake = done || inp.u;
      if (brake) acc -= done ? 320 : P.br;
      r.v = Math.max(0, r.v + acc * dt);
      r.sp = Math.abs(st) * Math.min(1, r.v / 250) * (r.tk ? 0.6 : 1) + (brake && r.v > 40 ? 0.9 : 0);
    }
    if (!done && s.t < 1.4 && r.y < 220) { const n = nP(inp, 'a'); if (n) { r.v = Math.min(r.v + 15 * n, 175); r.pa = (r.pa || 0) + n; if (r.h) OG.sfx(s, 'snow'); } }
    r.x += Math.sin(r.a) * r.v * dt * r.pw; r.y += Math.cos(r.a) * r.v * dt * r.pw;
    postSki(s, r, px, py);
  }
  function postSki(s, r, px, py) {
    const C = s.C, P = SKI[s.sub] || SKI.gs;
    const cx = cX(C, r.y), hw = cW(C, r.y), dx = r.x - cx, lim = hw - 3;
    if (Math.abs(dx) > lim) {
      const side = sgn(dx), ca = Math.atan(cD(C, r.y));
      const into = Math.sin(r.a - ca) * side * r.v;
      r.x = cx + side * lim;
      if (into > 0 && r.cr <= 0) {
        if (into > P.crash && r.z <= 0 && r.fin < 0 && !r.out) crash(s, r, '펜스 충돌!');
        else {
          r.a = ca - side * 0.1;
          if (!r.fc) { r.v *= 0.86; if (r.h && into > 40) { OG.sfx(s, 'hit'); pop(s, r, '펜스!', PAL.orange); } }
        }
      }
      r.fc = 1;
    } else r.fc = 0;
    const F = C.f;
    while (F && r.f < F.length && F[r.f].y <= r.y) {
      const ft = F[r.f]; r.f++;
      if (r.cr > 0 || r.z > 0) continue;
      if (ft.t === 'j' && r.v > 90) { r.vz = r.v * 1.05 * ft.k; r.z = 0.1; r.at = 0; if (r.h) OG.sfx(s, 'whoosh'); }
      else if (ft.t === 'r') {
        if (r.tk) { r.v *= 1.035; if (r.h) { pop(s, r, 'PUMP!', PAL.cyan); OG.sfx(s, 'tick'); } }
        else if (r.v > 140) { r.vz = r.v * 0.3; r.z = 0.1; r.at = 0; }
      }
    }
    const G = C.gates;
    while (G && r.g < G.length && G[r.g].y <= r.y) {
      const g0 = G[r.g]; r.g++;
      if (r.out || r.fin >= 0) continue;
      const k = (g0.y - py) / ((r.y - py) || 1), gx = px + (r.x - px) * k;
      const d = Math.abs(gx - g0.x), hw2 = g0.w / 2;
      if (d <= hw2 + 2) { if (hw2 - d < 3 && !s.cal) g0.h = r2(s.t); if (r.h) OG.sfx(s, 'tick'); r.gp = (r.gp || 0) + 1; }
      else if (s.cal) r.miss = (r.miss || 0) + 1;
      else if (!s.strict) { r.pen += 5; if (r.h) { OG.sfx(s, 'miss'); pop(s, r, '기문 놓침 +5초', PAL.orange); } }
      else { r.out = 'dsq'; if (r.h) { OG.sfx(s, 'fail'); pop(s, r, 'GATE MISS! 실격', PAL.red); } }
    }
    splits(s, r, py);
    if (r.fin < 0 && !r.out && py < C.len && r.y >= C.len) { finishAt(s, r, py, C.len); if (r.h) pop(s, r, 'FINISH!', PAL.yellow); }
    trail(s, r, r.z > 0 || r.cr > 0);
  }

  /* ----------------------------- moguls ------------------------------ */
  function stepMog(s, r, inp, dt) {
    const C = s.C, py = r.y;
    const done = r.fin >= 0 || !!r.out;
    r.lk = Math.max(0, r.lk - dt); r.ab = Math.max(0, r.ab - dt); r.ld = Math.max(0, r.ld - dt);
    if (r.cr > 0) {
      r.cr -= dt; r.v = Math.max(0, r.v - r.v * 2 * dt); r.y += r.v * dt;
      if (r.cr <= 0) { r.cr = 0; r.v = 70; }
      trail(s, r, true); return;
    }
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st;
    const air = r.z > 0 || r.vz > 0;
    r.vx += (st * 80 - r.vx) * Math.min(1, 9 * dt);
    r.x = clamp(r.x + r.vx * dt * (air ? 0.3 : 1), -C.w[0] + 9, C.w[0] - 9);
    if (done) r.v = Math.max(0, r.v - 220 * dt);
    else if (!air) r.v += (172 - r.v) * 0.7 * dt;
    r.y += r.v * dt;
    r.ph += dt * r.v / 60;
    if (air) {
      r.vz -= 900 * dt; r.z += r.vz * dt;
      if (r.tn) r.tp += dt / TRICK[r.tn].d;
      if (r.z <= 0) landMog(s, r);
    }
    if (!done) {
      const nearK = C.kk.some(k => (k - r.y) / Math.max(60, r.v) > -0.05 && (k - r.y) / Math.max(60, r.v) < 0.42);
      if (inp.ap && r.kick && air && !r.tn && s.t - r.to < 0.32) startTrick(s, r, trickOf(inp));
      else if (inp.ap && nearK && !air) { r.qt = trickOf(inp); r.qe = r2(s.t + 0.5); }
      else if ((inp.up || inp.ap) && !air && r.lk <= 0) {
        r.lk = 0.24; r.ab = 0.22;
        const Y = C.rows[r.b], dtm = Y != null ? (Y - r.y) / Math.max(60, r.v) : 9;
        if (Math.abs(dtm) <= 0.19) {
          let q = Math.abs(dtm) <= 0.085 ? 1 : 0.7;
          if (Math.abs(r.x) > 15) q *= 0.7;
          q = Math.max(0, q - r.fl); r.fl = 0;
          r.tq += q; r.b++; r.bq = q;
          if (r.h) { pop(s, r, q >= 0.95 ? 'PERFECT' : q >= 0.6 ? 'GOOD' : 'OK', q >= 0.95 ? PAL.cyan : q >= 0.6 ? PAL.green : PAL.lightgrey); OG.sfx(s, q >= 0.95 ? 'perfect' : 'good'); }
        } else r.fl = 0.25;
      }
    }
    for (const k of C.kk) {
      if (py < k && r.y >= k && !air && r.cr <= 0) {
        r.vz = 360 + r.v * 0.25; r.z = 0.1; r.to = r2(s.t); r.kick = 1; r.tn = ''; r.tp = 0;
        if (r.qt && s.t <= r.qe && !done) startTrick(s, r, r.qt);
        r.qt = '';
        if (r.h) OG.sfx(s, 'whoosh');
      }
    }
    while (r.b < C.rows.length && C.rows[r.b] < r.y - 0.19 * Math.max(60, r.v)) {
      r.b++; r.bq = 0;
      if (done) continue;
      r.v *= 0.84; r.fl = 0;
      if (r.z <= 0) { r.vz = 130; r.z = 0.1; r.kick = 0; }
      if (r.h) { pop(s, r, 'BUMP!', PAL.orange); OG.sfx(s, 'land'); }
    }
    if (r.fin < 0 && !r.out && py < C.len && r.y >= C.len) {
      finishAt(s, r, py, C.len);
      const turns = (r.tq / C.rows.length) * 60, airp = r.air.reduce((a, b) => a + b, 0);
      const T = r.fin * s.sc, spd = clamp(20 - (T - s.par) / s.par * 100 * 0.9, 0, 20);
      r.sb = [r1(turns), r1(airp), r1(spd)]; r.res = r2(turns + airp + spd); r.tt = r2(T);
      if (r.h) pop(s, r, r.res.toFixed(2) + '점', PAL.yellow);
    }
    trail(s, r, air);
  }
  function trickOf(inp) { return (inp.l || inp.r) ? 'ck' : inp.d ? 'sp' : 'bf'; }
  function startTrick(s, r, tn) { r.tn = tn; r.tp = 0; if (r.h) OG.sfx(s, 'jump'); }
  function landMog(s, r) {
    r.z = 0; r.vz = 0;
    if (!r.kick) { r.ld = 0.2; return; }
    r.kick = 0;
    let pts;
    if (r.tn) {
      const T = TRICK[r.tn];
      if (r.tp < 0.92) { pts = T.dd * 2.5; crash(s, r, '착지 실패!', 0.9); }
      else { pts = T.dd * 10 * (r.tp > 1.25 ? 0.93 : 1); if (r.h) { pop(s, r, T.n + ' ' + pts.toFixed(1), PAL.yellow); OG.sfx(s, 'perfect'); } }
    } else { pts = 3.2; if (r.h) pop(s, r, '스트레이트 에어 3.2', PAL.lightgrey); }
    r.air.push(r1(pts));
    r.tn = ''; r.tp = 0; r.ld = 0.35;
    if (r.h) OG.sfx(s, 'land');
  }

  /* ------------------------------ sleds ------------------------------- */
  function uStar(P, v, k) { return clamp(-v * v * k * P.KB, -P.W * 0.62, P.W * 0.62); }
  function stepSled(s, r, inp, dt) {
    const C = s.C, P = SLED[s.sub], py = r.y;
    const done = r.fin >= 0 || !!r.out;
    r.sk = Math.max(0, r.sk - dt);
    if (r.ph === 0) {
      const n = done ? 0 : mash(r, inp);
      r.v += n * P.pk * Math.max(0, 1 - r.v / P.vp);
      r.v = Math.max(r.v - r.v * 0.2 * dt + 30 * dt, 28);
      r.y += r.v * dt * r.pw; r.x = cX(C, r.y); r.u = 0; r.uv = 0;
      r.pa += n + dt * r.v / 40;
      if (n && r.h) OG.sfx(s, 'step');
      if (s.sub !== 'luge' && inp.ap && !done) loadSled(s, r, r.y > C.pl * 0.6 ? (r.y > C.pl * 0.82 ? 'GOOD 스타트!' : '탑승!') : '너무 일찍!');
      else if (r.y >= C.pl) { if (s.sub === 'luge') loadSled(s, r, ''); else { r.v *= 0.86; loadSled(s, r, '탑승 지연!'); } }
      return;
    }
    if (r.st0 < 0 && r.y >= C.pl) { r.st0 = r2(s.t); if (r.h) pop(s, r, '스타트 ' + (r.st0 * s.sc * 1.35).toFixed(2), PAL.white); }
    const d = cD(C, r.y), sec = Math.sqrt(1 + d * d), k = cK(C, r.y);
    const us = uStar(P, r.v, k);
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st;
    r.uv += (14 * (us - r.u) - 1.5 * r.uv + st * P.steer) * dt;
    r.u += r.uv * dt;
    if (Math.abs(r.u) > P.lim) {
      const side = sgn(r.u); r.u = side * P.lim;
      if (r.uv * side > 0) {
        const imp = Math.abs(r.uv); r.uv = -r.uv * 0.3;
        if (imp > 8) {
          r.v *= 1 - Math.min(0.05, imp * 0.0012); r.sk = 0.35; r.wh = (r.wh || 0) + 1;
          if (r.h && imp > 18) { OG.sfx(s, 'hit'); pop(s, r, '쾅!', PAL.orange); } else if (r.h) OG.sfx(s, 'ice');
        }
      }
      r.v -= 30 * dt; r.sk = Math.max(r.sk, 0.1);
    }
    const off = Math.abs(r.u - us) / P.W;
    let acc = P.G * cS(C, r.y) - P.dr * r.v * r.v - P.fr * r.v - P.ll * off * r.v - (st ? 0.02 * r.v : 0);
    if (done) acc -= 260;
    r.v = Math.max(done ? 0 : 20, r.v + acc * dt);
    r.y += r.v / sec * dt * r.pw;
    r.x = cX(C, r.y) + r.u * sec;
    // curve "best line" evaluation
    const cv = C.cv[r.ci];
    if (cv && r.y >= cv[0]) {
      r.co += off * dt; r.cn += dt;
      if (r.y >= cv[1]) {
        const avg = r.co / Math.max(0.01, r.cn);
        if (r.h && !done) {
          if (avg < 0.1) { pop(s, r, 'BEST LINE', PAL.cyan); OG.sfx(s, 'good'); r.v *= 1.01; }
          else if (avg < 0.2) pop(s, r, 'GOOD LINE', PAL.green);
        }
        r.ci++; r.co = 0; r.cn = 0;
      }
    }
    splits(s, r, py);
    if (r.fin < 0 && !r.out && py < C.len && r.y >= C.len) { finishAt(s, r, py, C.len); if (r.h) pop(s, r, 'FINISH!', PAL.yellow); }
  }
  function loadSled(s, r, msg) {
    r.ph = 1; r.ldT = r2(s.t);
    if (r.h) { OG.sfx(s, 'jump'); if (msg) pop(s, r, msg, msg === '너무 일찍!' || msg === '탑승 지연!' ? PAL.orange : PAL.green); }
  }

  /* ------------------------------ canoe ------------------------------- */
  function stepCanoe(s, r, inp, dt) {
    const C = s.C, px = r.x, py = r.y;
    const done = r.fin >= 0 || !!r.out;
    r.pk = Math.max(0, r.pk - dt); r.bk = Math.max(0, (r.bk || 0) - dt);
    const cur = current(C, r.x, r.y);
    let rx = r.vx - cur[0], ry = r.vy - cur[1];
    const hx = Math.sin(r.a), hy = Math.cos(r.a);
    let f = rx * hx + ry * hy, l = rx * hy - ry * hx;
    f *= Math.exp(-0.9 * dt); l *= Math.exp(-3.2 * dt);
    let stroke = 0;
    r.st = 0;
    if (!done) {
      // 8-way directional paddling: hold a direction → boat turns that way and paddles
      const kx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0), ky = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
      const want = inp.ang != null ? inp.ang : (kx || ky) ? Math.atan2(kx, ky) : null;
      if (want != null) {
        const df = M.angDiff(r.a, want);
        r.a = wrapA(r.a + clamp(df, -3.3 * dt, 3.3 * dt));
        r.st = Math.abs(df) > 0.06 ? sgn(df) : 0;
        const al = Math.cos(df);
        if (al > 0.25 && f < 92) { f += 150 * dt * al; stroke = 0.6; }
        if (r.st) f *= Math.exp(-0.3 * dt);
      }
      const n = nP(inp, 'a');
      if (n) { f = Math.min(f + 20 * n, 135); stroke = 1; r.pk = 0.22; if (r.h) OG.sfx(s, 'stroke'); }
    } else f *= Math.exp(-1.5 * dt);
    r.ph += dt * (stroke ? 5.5 : r.st ? 3 : 0.8);
    r.sp = stroke;
    rx = f * hx + l * hy; ry = f * hy - l * hx;
    r.vx = rx + cur[0]; r.vy = ry + cur[1];
    r.x += r.vx * dt * r.pw; r.y += r.vy * dt * r.pw;
    const cx = cX(C, r.y), hw = cW(C, r.y), dx = r.x - cx;
    if (Math.abs(dx) > hw - 6) {
      const side = sgn(dx); r.x = cx + side * (hw - 6);
      if (r.vx * side > 0) { if (r.h && Math.abs(r.vx) > 40 && !r.bk) { OG.sfx(s, 'hit'); r.bk = 0.5; } r.vx = -r.vx * 0.3; }
    }
    for (const k of C.rk) {
      const ddx = r.x - k[0], ddy = r.y - k[1], m = k[2] + 6;
      if (Math.abs(ddx) > m || Math.abs(ddy) > m) continue;
      const d = Math.hypot(ddx, ddy);
      if (d < m && d > 0.01) {
        const nx = ddx / d, ny = ddy / d; r.x = k[0] + nx * m; r.y = k[1] + ny * m;
        const vn = r.vx * nx + r.vy * ny;
        if (vn < 0) { r.vx -= 1.4 * vn * nx; r.vy -= 1.4 * vn * ny; if (r.h && vn < -30 && !r.bk) { OG.sfx(s, 'hit'); pop(s, r, '쿵!', PAL.orange); r.bk = 0.5; } }
      }
    }
    // gates (in order)
    const G = C.gates;
    for (let j = r.g; j < Math.min(G.length, r.g + 2); j++) {
      const g0 = G[j];
      const cross = g0.up ? (py > g0.y && r.y <= g0.y) : (py < g0.y && r.y >= g0.y);
      if (!cross) continue;
      const k = (g0.y - py) / ((r.y - py) || 1), gx = px + (r.x - px) * k;
      const d = Math.abs(gx - g0.x), hw2 = g0.w / 2;
      if (d < hw2 + 3) {
        for (let m = r.g; m < j; m++) missGate(s, r, m);
        if (d > hw2 - 2.5) { r.pen += 2; r.gs[j] = 2; if (!s.cal) g0.h = r2(s.t); if (r.h) { pop(s, r, '+2 터치', PAL.orange); OG.sfx(s, 'hit'); } }
        else { r.gs[j] = 1; if (r.h) { pop(s, r, g0.up ? 'UP CLEAN!' : 'CLEAN', g0.up ? PAL.cyan : PAL.green); OG.sfx(s, 'ding'); } }
        r.g = j + 1; r.ua = 0;
        break;
      }
    }
    while (r.g < G.length && r.y > G[r.g].y + (G[r.g].up ? 160 : 75)) { missGate(s, r, r.g); r.g++; r.ua = 0; }
    splits(s, r, py);
    if (r.fin < 0 && !r.out && py < C.len && r.y >= C.len) {
      while (r.g < G.length) { missGate(s, r, r.g); r.g++; }
      finishAt(s, r, py, C.len); if (r.h) pop(s, r, 'FINISH!', PAL.yellow);
    }
  }
  function missGate(s, r, j) {
    if (r.gs[j]) return;
    r.gs[j] = 3; r.pen += 50;
    if (r.h) { pop(s, r, '+50 미통과!', PAL.red); OG.sfx(s, 'miss'); }
  }

  /* ------------------------------- MTB -------------------------------- */
  function stepMtb(s, r, inp, dt) {
    const C = s.C, P = MTB, px = r.x, py = r.y;
    const done = r.fin >= 0 || !!r.out;
    r.ld = Math.max(0, r.ld - dt); r.wb = Math.max(0, r.wb - dt);
    if (r.cr > 0) {
      r.cr -= dt; r.v = Math.max(0, r.v - 400 * dt);
      r.x += Math.sin(r.a) * r.v * dt; r.y += Math.cos(r.a) * r.v * dt;
      if (r.cr <= 0) { r.cr = 0; r.x = cX(C, r.y); r.a = Math.atan(cD(C, r.y)); r.v = 35; }
      return;
    }
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st;
    const air = r.z > 0 || r.vz > 0;
    if (!done) { const n = nP(inp, 'u'); if (n) r.cd = Math.min(1.25, r.cd + 0.2 * n); }
    r.cd = Math.max(0, r.cd - r.cd * 1.5 * dt);
    r.ph += (r.cd * 9 + 0.5) * dt;
    if (air) {
      r.vz -= 900 * dt; r.z += r.vz * dt;
      if (r.z <= 0) { r.z = 0; r.vz = 0; r.ld = 0.25; if (r.h) OG.sfx(s, 'land'); }
    } else {
      r.a += st * P.tr * P.tv / (P.tv + r.v) * dt;
      if (!st) r.a -= (r.a - Math.atan(cD(C, r.y)) * 0.6) * P.ret * dt;
      r.a = clamp(r.a, -1.35, 1.35);
      let acc = r.cd * P.pf * 170 / (170 + r.v) + P.G * cS(C, r.y) * Math.cos(r.a) - P.roll * r.v - P.dr * r.v * r.v - Math.abs(st) * 0.15 * r.v;
      if (done || inp.d) acc -= P.br;
      r.v = Math.max(done ? 0 : P.walk, r.v + acc * dt);
      if (!done && inp.ap && r.v > 20) { r.vz = 235; r.z = 0.1; if (r.h) OG.sfx(s, 'jump'); }
    }
    r.x += Math.sin(r.a) * r.v * dt * r.pw; r.y += Math.cos(r.a) * r.v * dt * r.pw;
    const cx = cX(C, r.y), hw = cW(C, r.y), dx = r.x - cx;
    if (Math.abs(dx) > hw - 2 && !air) {
      r.v = Math.max(P.walk, r.v - r.v * 2.6 * dt);
      r.a -= sgn(dx) * 1.4 * dt;
      if (!r.fc && r.h && r.v > 60) pop(s, r, '코스 이탈!', PAL.orange);
      r.fc = 1;
    } else r.fc = 0;
    if (Math.abs(dx) > hw + 7) r.x = cx + sgn(dx) * (hw + 7);
    // obstacles
    const O = C.ob;
    for (let j = Math.max(0, r.f - 2); j < Math.min(O.length, r.f + 3); j++) {
      const o = O[j];
      if (o.t === 'rock') {
        const ox = cX(C, o.y) + o.x, d = Math.hypot(r.x - ox, r.y - o.y);
        if (d < o.r + 3 && r.z <= 0 && !o['h' + r.k]) {
          o['h' + r.k] = 1;
          if (r.v > 175 && !done) crash(s, r, '바위 충돌!', 1.3);
          else { r.v *= 0.55; r.wb = 0.4; r.x += sgn(r.x - ox) * 3; if (r.h) { OG.sfx(s, 'hit'); pop(s, r, '덜컹!', PAL.orange); } }
        }
      } else if (o.t === 'mud') {
        if (r.y > o.y - o.l / 2 && r.y < o.y + o.l / 2 && Math.abs(dx) < hw && r.z <= 0) { r.v = Math.max(P.walk, r.v - r.v * 1.4 * dt); r.mud = 0.3; }
      } else if (py < o.y && r.y >= o.y) {
        if (r.z > 0) { if (r.h && o.t === 'log') pop(s, r, 'NICE HOP', PAL.cyan); continue; }
        if (o.t === 'root' && r.v > 90) { r.v *= 0.7; r.wb = 0.35; if (r.h) { OG.sfx(s, 'hit'); pop(s, r, '덜컹!', PAL.orange); } }
        else if (o.t === 'log') {
          if (r.v > 160 && !done) crash(s, r, '통나무 충돌!', 1.3);
          else { r.v = Math.min(r.v, 35); r.wb = 0.4; if (r.h) { OG.sfx(s, 'hit'); pop(s, r, '쿵!', PAL.orange); } }
        }
      }
    }
    while (r.f < O.length && O[r.f].y < r.y - 20) r.f++;
    r.mud = Math.max(0, (r.mud || 0) - dt);
    splits(s, r, py);
    if (r.fin < 0 && !r.out && py < C.len && r.y >= C.len) { finishAt(s, r, py, C.len); if (r.h) pop(s, r, 'FINISH!', PAL.yellow); }
  }

  /* ------------------------------- kart ------------------------------- */
  function stepKart(s, r, inp, dt) {
    const C = s.C, P = KART;
    const done = r.fin >= 0 || !!r.out;
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st;
    r.bt = Math.max(0, r.bt - dt); r.hp = Math.max(0, r.hp - dt); r.wl = Math.max(0, r.wl - dt);
    const vt = done ? 60 : P.vmax * r.sm * (r.bt > 0 ? P.bst : 1);
    if (!done && inp.d) r.v = Math.max(0, r.v - 420 * dt);
    else if (r.v < vt) r.v += (vt - r.v) * P.acc * dt * (r.bt > 0 ? 3 : 1);
    else r.v -= (r.v - vt) * 1.5 * dt;
    if (!done && !r.dr && inp.a && st !== 0 && r.v > 150) { r.dr = st; r.dc = 0; r.hp = 0.16; }
    if (r.dr) {
      if (!inp.a || done || r.v < 100) {
        if (r.dc > 1.2) { r.bt = 1.0; if (r.h) { pop(s, r, 'TURBO!', PAL.orange); OG.sfx(s, 'power'); } }
        else if (r.dc > 0.55) { r.bt = 0.55; if (r.h) { pop(s, r, 'BOOST', PAL.cyan); OG.sfx(s, 'power'); } }
        r.dr = 0; r.dc = 0;
      } else r.dc += dt * (st === r.dr ? 1.3 : 0.7);
    }
    const vk = Math.min(1, r.v / 110);
    if (r.dr) { r.a += r.dr * (1.7 + (st === r.dr ? 1.3 : st === -r.dr ? -0.8 : 0)) * vk * dt; r.v -= r.v * 0.1 * dt; }
    else r.a += st * P.tr * vk * dt;
    r.a = wrapA(r.a);
    r.vd = wrapA(r.vd + M.angDiff(r.vd, r.a) * Math.min(1, (r.dr ? 2.4 : 12) * dt));
    r.x += Math.cos(r.vd) * r.v * dt * r.pw; r.y += Math.sin(r.vd) * r.v * dt * r.pw;
    const N = kNear(C, r.x, r.y, r.si);
    r.si = N.i;
    const lim = C.hw - 5;
    if (Math.abs(N.off) > lim) {
      const nx = -N.ty, ny = N.tx, side = sgn(N.off), corr = N.off - side * lim;
      r.x -= nx * corr; r.y -= ny * corr;
      let vx = Math.cos(r.vd) * r.v, vy = Math.sin(r.vd) * r.v;
      const vn = vx * nx + vy * ny;
      if (vn * side > 0) {
        vx -= nx * vn * 1.3; vy -= ny * vn * 1.3;
        const imp = Math.abs(vn);
        r.v = Math.hypot(vx, vy) * (imp > 60 ? 0.9 : 0.98);
        r.vd = Math.atan2(vy, vx);
        r.a = wrapA(r.a + M.angDiff(r.a, r.vd) * 0.6);
        if (imp > 60 && !r.wl) { r.wl = 0.4; if (r.h) { OG.sfx(s, 'hit'); pop(s, r, '쿵!', PAL.orange); } if (r.dr) { r.dr = 0; r.dc = 0; } }
      }
    }
    for (let k = 0; k < C.pads.length; k++) {
      const p = C.pads[k];
      if (Math.abs(r.x - p[0]) < 13 && Math.abs(r.y - p[1]) < 13 && r.pd !== k) { r.pd = k; r.bt = Math.max(r.bt, 0.85); if (r.h) { pop(s, r, 'BOOST!', PAL.yellow); OG.sfx(s, 'power'); } }
    }
    if (r.pd >= 0 && Math.hypot(r.x - C.pads[r.pd][0], r.y - C.pads[r.pd][1]) > 40) r.pd = -1;
    if (!r.it) for (const b of C.items) if (Math.abs(r.x - b[0]) < 9 && Math.abs(r.y - b[1]) < 9) { r.it = 1; if (r.h) { pop(s, r, 'ITEM: 부스터', PAL.pink); OG.sfx(s, 'coin'); } break; }
    if (r.it && !done && inp.up) { r.it = 0; r.bt = Math.max(r.bt, 1.2); if (r.h) { pop(s, r, 'BOOSTER!', PAL.orange); OG.sfx(s, 'power'); } }
    const ps = N.s;
    if (r.ls > C.L * 0.7 && ps < C.L * 0.3) {
      r.lap++;
      if (r.lap >= C.laps && r.fin < 0) { r.fin = r2(s.t); r.res = r2(r.fin * s.sc); if (r.h) { pop(s, r, 'FINISH!', PAL.yellow); OG.sfx(s, 'cheer'); } }
      else if (r.lap === C.laps - 1 && r.h) { pop(s, r, 'FINAL LAP!', PAL.yellow); OG.sfx(s, 'bell'); }
    } else if (r.ls < C.L * 0.3 && ps > C.L * 0.7) r.lap--;
    r.ls = r1(ps); r.ss = r.ls;
    r.pr = r1(r.lap * C.L + ps);
  }

  /* ------------------------------ sailing ----------------------------- */
  function stepSail(s, r, inp, dt) {
    const C = s.C, P = SAIL, py = r.y;
    const done = r.fin >= 0 || !!r.out;
    const wf = wind(s);
    const rel = M.angDiff(wf, r.a), al = Math.abs(rel);
    const st = done ? 0 : (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    r.st = st;
    r.bm = Math.max(0, r.bm - dt); r.bk = Math.max(0, (r.bk || 0) - dt);
    const hike = !done && inp.a && r.sta > 0.02 && al < 2.3;
    r.hk = hike ? Math.min(1, r.hk + 4 * dt) : Math.max(0, r.hk - 4 * dt);
    if (hike) r.sta = Math.max(0, r.sta - 0.2 * dt); else r.sta = Math.min(1, r.sta + 0.13 * dt);
    const target = done ? 0 : P.vb * polar(al) * (1 + 0.16 * r.hk) * r.sm;
    r.v += (target - r.v) * (target > r.v ? 0.5 : 0.9) * dt;
    r.a += st * P.tr * (0.35 + 0.65 * Math.min(1, r.v / 45)) * dt;
    if (al < 0.55 && !st && !done) r.a += sgn(rel) * 0.45 * dt;
    r.a = wrapA(r.a);
    const side = sgn(M.angDiff(wf, r.a));
    if (r.sd && side !== r.sd) { r.bm = 0.5; if (r.h) OG.sfx(s, 'whoosh'); }
    r.sd = side;
    r.x += (Math.sin(r.a) * r.v - Math.sin(wf) * 4) * dt * r.pw;
    r.y += (-Math.cos(r.a) * r.v + Math.cos(wf) * 4) * dt * r.pw;
    r.ph += dt * (1 + r.v / 40);
    // marks & committee boat
    const obs = [[C.m[0][0], C.m[0][1], 7], [C.m[1][0], C.m[1][1], 7], [C.cb[0], C.cb[1], 13], [C.pin[0], C.pin[1], 6]];
    for (const o of obs) {
      const dx = r.x - o[0], dy = r.y - o[1], m = o[2] + 6, d = Math.hypot(dx, dy);
      if (d < m && d > 0.01) { r.x = o[0] + dx / d * m; r.y = o[1] + dy / d * m; if (!r.bk) { r.v *= 0.6; r.bk = 0.8; if (r.h) { pop(s, r, '터치!', PAL.orange); OG.sfx(s, 'hit'); } } }
    }
    if (!done && r.mk < C.m.length) {
      const m = C.m[r.mk];
      if (Math.hypot(r.x - m[0], r.y - m[1]) < 56) { r.mk++; if (r.h) { pop(s, r, r.mk === 1 ? '마크 1 통과!' : '마크 2 통과!', PAL.green); OG.sfx(s, 'ding'); } }
    }
    if (!done && r.mk >= C.m.length && py < 0 && r.y >= 0 && r.x > C.fl[0] && r.x < C.fl[1]) {
      finishAt(s, r, py, 0); if (r.h) pop(s, r, 'FINISH!', PAL.yellow);
    }
  }

  /* ------------------------------ collisions -------------------------- */
  function collide(s, rad) {
    const A = s.R, n = A.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = A[i], b = A[j];
      if (a.cr > 0 || b.cr > 0 || Math.abs((a.z || 0) - (b.z || 0)) > 8) continue;
      if (s.kind === 'ski' && a.ln !== b.ln) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= 4 * rad * rad || d2 < 0.0001) continue;
      const d = Math.sqrt(d2), o = (2 * rad - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
      if (o < 0.6) continue; // just grazing (e.g. sailing side by side): no speed loss
      a.v *= 0.99; b.v *= 0.99;
      if (s.kind === 'cross') { const back = a.y < b.y ? a : b; back.v *= 0.985; }
      if ((a.h || b.h) && o > 1.5 && s.fr - (s.bump || 0) > 20) { s.bump = s.fr; OG.sfx(s, 'bounce'); const hr = a.h ? a : b; pop(s, hr, '충돌!', PAL.orange); }
    }
  }

  /* ================================= AI ================================ */
  function aiSki(s, r) {
    const I = aiIn(), C = s.C, P = SKI[s.sub];
    if (r.fin >= 0 || r.out || r.cr > 0) return I;
    if (s.t < 1.3 && s.fr % 6 === 0) press(I, 'a');
    let tx, ty;
    const la = 46 + r.v * 0.4, Gs = C.gates;
    if (Gs && r.g < Gs.length && s.sub !== 'dh') {
      const G = Gs[r.g], N = Gs[r.g + 1], dy = G.y - r.y;
      const px = r.x + Math.tan(r.a) * Math.max(0, dy);
      if (N && dy < r.v * P.lead && Math.abs(px - G.x) < G.w * 0.3) { tx = N.x; ty = N.y; }
      else { tx = G.x; ty = G.y; }
    } else {
      ty = r.y + la; tx = cX(C, ty) + (r.lo || 0);
      if (Gs && r.g < Gs.length) { const G = Gs[r.g], dy = G.y - r.y; if (dy > 0 && dy < la * 1.5) tx = lerp(tx, G.x, 0.7); }
      if (s.kind === 'cross') {
        const hw = cW(C, r.y) * 0.55;
        for (const o of s.R) {
          if (o === r) continue;
          const dy = o.y - r.y, dx = o.x - r.x;
          if (dy > 0 && dy < 50 && Math.abs(dx) < 11) r.lo = clamp((r.lo || 0) + (dx > 0 ? -1 : 1) * 2.2, -hw, hw);
        }
      }
    }
    const want = clamp(Math.atan2(tx - r.x, Math.max(14, ty - r.y)), -1.3, 1.3), diff = want - r.a;
    const dz = 0.035 + (1 - r.q) * 0.04;
    if (diff > dz) I.r = true; else if (diff < -dz) I.l = true;
    let tuck = Math.abs(diff) < 0.1;
    if (Gs && s.sub !== 'dh' && r.g < Gs.length && Gs[r.g].y - r.y < r.v * 0.6) tuck = false;
    if (tuck) I.d = true;
    return I;
  }
  function aiMog(s, r) {
    const I = aiIn(), C = s.C;
    if (r.fin >= 0 || r.out || r.cr > 0) return I;
    if (r.x > 3) I.r = false, I.l = true; else if (r.x < -3) I.r = true;
    const Y = C.rows[r.b];
    if (Y != null && r.lk <= 0 && r.z <= 0) { const dtm = (Y - r.y) / Math.max(60, r.v); if (Math.abs(dtm) < 0.03 + (1 - r.q) * 0.1) press(I, 'u'); }
    for (const k of C.kk) { const dtm = (k - r.y) / Math.max(60, r.v); if (dtm > 0 && dtm < 0.06 && !r.qt) { press(I, 'a'); I.u = I.up = false; if (r.q > 0.6) { I.l = true; I.r = false; } } }
    return I;
  }
  function aiSled(s, r) {
    const I = aiIn(), C = s.C, P = SLED[s.sub];
    if (r.fin >= 0 || r.out) return I;
    if (r.ph === 0) {
      const per = Math.round(5 + (1 - r.q) * 3);
      if (s.fr % per === 0) press(I, Math.floor(s.fr / per) % 2 ? 'l' : 'r');
      if (r.y > C.pl * (0.84 + (1 - r.q) * 0.08)) press(I, 'a');
      return I;
    }
    const us = uStar(P, r.v, cK(C, r.y + r.v * 0.2));
    const e = us - r.u - r.uv * 0.28;
    if (e > 1.5) I.r = true; else if (e < -1.5) I.l = true;
    return I;
  }
  function aiCanoe(s, r) {
    const I = aiIn(), C = s.C;
    if (r.fin >= 0 || r.out) return I;
    const G = C.gates[r.g], cur = current(C, r.x, r.y);
    let want, power = false;
    if (G && G.up && (r.ua || r.y > G.y + 26)) {
      r.ua = 1; power = true;
      want = Math.PI - Math.asin(clamp((G.x - r.x) / 45, -0.7, 0.7));
    } else {
      let tx, ty;
      if (!G) { ty = C.len + 80; tx = cX(C, ty); }
      else if (G.up) { tx = G.x; ty = G.y + 44; }
      else if (G.y - r.y < 10) { const N = C.gates[r.g + 1]; ty = N ? N.y + (N.up ? 44 : 0) : r.y + 160; tx = N ? N.x : cX(C, ty); }
      else { tx = G.x; ty = G.y; }
      const vy = Math.max(55, cur[1] + 100 * Math.max(0.2, Math.cos(r.a)));
      const tg = Math.max(0.3, (ty - r.y) / vy);
      want = Math.asin(clamp(((tx - r.x) / tg - cur[0]) / 110, -0.95, 0.95));
      power = Math.abs(tx - r.x) > 30;
    }
    I.ang = want;
    if ((power || r.q > 0.7) && s.fr % 7 === 0) press(I, 'a');
    return I;
  }
  function aiMtb(s, r) {
    const I = aiIn(), C = s.C;
    if (r.fin >= 0 || r.out || r.cr > 0) return I;
    const per = Math.round(7 + (1 - r.q) * 4);
    if (s.fr % per === 0) press(I, 'u');
    const la = 34 + r.v * 0.35, ty = r.y + la;
    let tx = cX(C, ty);
    for (let j = Math.max(0, r.f - 1); j < Math.min(C.ob.length, r.f + 4); j++) {
      const o = C.ob[j], dy = o.y - r.y;
      if (dy < 0 || dy > r.v * 0.3 + 12 || o.t === 'mud') continue;
      if (o.t === 'rock') { const ox = cX(C, o.y) + o.x; if (Math.abs(ox - r.x) < o.r + 7 && dy < r.v * 0.14 + 5 && r.z <= 0) press(I, 'a'); }
      else if (dy < r.v * 0.13 + 4 && r.z <= 0) press(I, 'a');
    }
    const want = clamp(Math.atan2(tx - r.x, la), -1.2, 1.2), diff = want - r.a;
    if (diff > 0.04) I.r = true; else if (diff < -0.04) I.l = true;
    if (r.v > 250 && Math.abs(cK(C, r.y + r.v * 0.45)) > 0.0035) I.d = true;
    return I;
  }
  function aiKart(s, r) {
    const I = aiIn(), C = s.C;
    if (r.fin >= 0 || r.out) return I;
    const la = 55 + r.v * 0.3;
    const tp = kPoint(C, (r.ss || 0) + la, r.lo || 0);
    const want = Math.atan2(tp[1] - r.y, tp[0] - r.x), diff = M.angDiff(r.a, want);
    if (diff > 0.05) I.r = true; else if (diff < -0.05) I.l = true;
    if (Math.abs(diff) > 0.4 && r.v > 190 && r.q > 0.35) { I.a = true; if (!r.dr) I.ap = true; }
    else if (r.dr && Math.abs(diff) > 0.1) I.a = true;
    if (r.it && s.fr % 30 === 0) press(I, 'u');
    if (s.fr % 90 === 0) r.lo = r1(clamp((r.lo || 0) + (hash(r.k, s.fr, 3) - 0.5) * 12, -14, 14));
    return I;
  }
  function aiSail(s, r) {
    const I = aiIn(), C = s.C;
    if (r.fin >= 0 || r.out) return I;
    const wf = wind(s);
    let tx, ty;
    if (r.mk < C.m.length) { tx = C.m[r.mk][0] - 20; ty = C.m[r.mk][1] + (r.mk === 0 ? 10 : -8); } else { tx = 0; ty = 40; }
    const close = Math.hypot(tx - r.x, ty - r.y) < 160;
    const brg = Math.atan2(tx - r.x, -(ty - r.y)), rel = M.angDiff(wf, brg);
    let want;
    const lay = 0.8;
    if (Math.abs(rel) < lay) {
      if (!r.tkS) r.tkS = sgn(M.angDiff(wf, r.a));
      if (r.tkS * rel < (close ? -0.1 : -0.3 - (1 - r.q) * 0.2)) r.tkS = -r.tkS;
      want = wf + r.tkS * (lay + 0.05);
    } else { want = brg; r.tkS = 0; }
    const diff = M.angDiff(r.a, want);
    if (diff > 0.05) I.r = true; else if (diff < -0.05) I.l = true;
    if (r.sta > 0.45 - r.q * 0.25 && Math.abs(M.angDiff(wf, r.a)) < 2.2) I.a = true;
    return I;
  }

  const STEP = { ski: stepSki, cross: stepSki, moguls: stepMog, sled: stepSled, canoe: stepCanoe, mtb: stepMtb, kart: stepKart, sail: stepSail };
  const AI = { ski: aiSki, cross: aiSki, moguls: aiMog, sled: aiSled, canoe: aiCanoe, mtb: aiMtb, kart: aiKart, sail: aiSail };
  const COLL = { cross: 5, kart: 6.5, sail: 7.5 };
  const GHOST = { ski: 1, sled: 1, canoe: 1, mtb: 1 };

  /* ============================ SETUP / FLOW =========================== */
  function newRacer(s, i, q, h, pid) {
    const r = { k: s.R.length, i, h: h ? 1 : 0, pid: h ? pid : -1, q: r2(q), pw: 1,
      x: 0, y: 0, a: 0, v: 0, z: 0, vz: 0, cr: 0, fin: -1, out: '', res: 0, pen: 0, g: 0, f: 0,
      st: 0, tk: 0, ph: 0, sp: 0, ld: 0, fc: 0, tr: [] };
    s.R.push(r); return r;
  }
  const PLACE = {
    ski(s) { const n = s.R.length; s.R.forEach((r, k) => { r.ln = s.sub === 'pgs' ? k : 0; r.x = r1(cX(s.C, 0) + (s.sub === 'pgs' ? 0 : (k - (n - 1) / 2) * 6)); r.y = 0; }); },
    cross(s) {
      const n = s.R.length, sp = Math.min(22, 100 / Math.max(1, n));
      s.R.forEach((r, k) => { r.x = r1(cX(s.C, 0) + (k - (n - 1) / 2) * sp); r.y = 0; r.lo = r1((k - (n - 1) / 2) * 9); });
    },
    moguls(s) {
      const n = s.R.length;
      s.R.forEach((r, k) => { Object.assign(r, { x: (k - (n - 1) / 2) * 4, y: 0, vx: 0, tq: 0, b: 0, bq: 0, air: [], tn: '', tp: 0, qt: '', qe: 0, to: 0, lk: 0, ab: 0, fl: 0, kick: 0 }); });
    },
    sled(s) { s.R.forEach(r => Object.assign(r, { ph: 0, u: 0, uv: 0, y: 0, x: r1(cX(s.C, 0)), st0: -1, lm: 0, pa: 0, sk: 0, ci: 0, co: 0, cn: 0, v: 0 })); },
    canoe(s) {
      const n = s.R.length;
      s.R.forEach((r, k) => Object.assign(r, { y: -70, x: r1(cX(s.C, -70) + (k - (n - 1) / 2) * 10), a: 0, vx: 0, vy: 0, gs: s.C.gates.map(() => 0), pk: 0, ua: 0 }));
    },
    mtb(s) { const n = s.R.length; s.R.forEach((r, k) => Object.assign(r, { x: r1(cX(s.C, 0) + (k - (n - 1) / 2) * 5), y: 0, cd: 0, wb: 0, mud: 0 })); },
    kart(s) {
      const C = s.C, hum = s.R.filter(r => r.h), cpu = s.R.filter(r => !r.h);
      const order = cpu.slice(0, Math.ceil(cpu.length / 2)).concat(hum, cpu.slice(Math.ceil(cpu.length / 2)));
      order.forEach((r, k) => {
        const p = kPoint(C, C.L - 34 - Math.floor(k / 2) * 30, (k % 2 ? 13 : -13));
        Object.assign(r, { x: r1(p[0]), y: r1(p[1]), a: r2(p[2]), vd: r2(p[2]), v: 0, si: 0, ss: 0, lap: -1, ls: 0, pr: 0, dr: 0, dc: 0, bt: 0, it: 0, hp: 0, wl: 0, pd: -1, sm: 1, lo: 0 });
        const N = kNear(C, r.x, r.y, 0, true); r.si = N.i; r.ls = r1(N.s); r.ss = r.ls; r.pr = r1(N.s - C.L);
      });
    },
    sail(s) {
      const n = s.R.length, C = s.C;
      s.R.forEach((r, k) => Object.assign(r, { x: r1(n > 1 ? -150 + k * 210 / (n - 1) : -40), y: 40 + (k % 2) * 18, a: r2(C.w0 + 0.85), v: 30, sta: 1, hk: 0, sd: 0, bm: 0, mk: 0, tkS: 0, sm: 1 }));
    }
  };

  function calibrate(s, cf) {
    if (s.kind === 'moguls') {
      let v = 0, y = 0, t = 0;
      while (y < s.C.len) { v += (172 - v) * 0.7 * DT; y += v * DT; t += DT; }
      s.ref = r2(t); return;
    }
    const T = { evId: s.evId, kind: s.kind, sub: s.sub, C: s.C, t: 0, fr: 0, R: [], pops: [], cal: 1, sc: 1 };
    const r = newRacer(T, -1, 1, false, -1);
    PLACE[s.kind](T);
    const gx = [], gy = [], ck = [];
    let f = 0;
    for (; f < 60 * 170 && r.fin < 0; f++) {
      T.t = f * DT; T.fr = f;
      if (f % 12 === 0) { gx.push(r1(r.x)); gy.push(r1(r.y)); }
      const py = r.y;
      STEP[s.kind](T, r, AI[s.kind](T, r), DT);
      if (s.C.ck) s.C.ck.forEach((c, k) => { if (py < c && r.y >= c) ck[k] = r2(T.t); });
    }
    s.ref = r.fin > 0 ? r2(r.fin) : r2(T.t);
    s.calMiss = r.miss || 0; s.calPen = r.pen || 0;
    if (GHOST[s.kind] && s.sub !== 'pgs') { gx.push(r1(r.x)); gy.push(r1(r.y)); s.gs = { x: gx, y: gy }; s.rck = s.C.ck ? s.C.ck.map((c, k) => ck[k] == null ? null : ck[k]) : null; }
    if (s.C.ob) s.C.ob.forEach(o => { for (const k in o) if (k[0] === 'h' && k.length > 1) delete o[k]; });
    if (s.C.gates) s.C.gates.forEach(g => { g.h = -9; });
  }

  function simCpu(s, cf, R) {
    s.sim = s.ents.map((e, i) => {
      if (e.human || s.R.some(r => r.i === i)) return null;
      const q = OG.cpuQuality(e, R);
      if (s.kind === 'moguls') {
        if (R.chance(0.05 * (1.3 - q))) return { d: 1 };
        return { T: r2(clamp(50 + q * 36 + R.gauss() * 2.2, 30, 95)) };
      }
      if (R.chance(cf.dnf * (1.3 - q))) return { d: 1, dq: cf.kind === 'ski' ? 1 : 0 };
      let T = cf.par * (1 + (cf.ease || 0) + (1 - q) * cf.spread + Math.abs(R.gauss()) * cf.spread * 0.12);
      if (s.kind === 'canoe') T += 2 * Math.max(0, Math.round(R.gauss() * 0.9 + (1 - q) * 2)) + (R.chance(0.05 * (1.2 - q)) ? 50 : 0);
      return { T: r2(T) };
    });
    let best = null;
    s.sim.forEach((m, i) => { if (m && !m.d && (!best || m.T < best.T)) best = { i, T: m.T }; });
    s.gh = GHOST[s.kind] && s.sub !== 'pgs' && s.gs ? best : null;
  }

  function fmtRes(s, T) {
    if (s.kind !== 'sail') return OG.fmt.time(T, 2);
    const m = Math.floor(T / 60), sec = Math.floor(T - m * 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function progress(s, r) {
    if (s.kind === 'kart') return clamp((r.lap * s.C.L + r.ss) / (s.C.laps * s.C.L), 0.01, 1);
    if (s.kind === 'sail') return sailProg(s, r);
    return clamp(r.y / s.C.len, 0.01, 1);
  }
  function finalize(s) {
    const ev = OG.EVENT_MAP[s.evId], lb = ev.lowerBetter !== false, bad = lb ? 9999 : -1;
    const rows = s.ents.map((e, i) => {
      const r = s.R.find(x => x.i === i);
      if (!r) {
        const m = s.sim[i];
        if (!m || m.d) return { idx: i, score: bad, text: m && m.dq ? '실격' : 'DNF', dnf: true };
        return { idx: i, score: m.T, text: s.kind === 'moguls' ? m.T.toFixed(2) + '점' : fmtRes(s, m.T) };
      }
      if (r.fin >= 0 && !r.out) return { idx: i, score: r.res, text: s.kind === 'moguls' ? r.res.toFixed(2) + '점' : fmtRes(s, r.res) };
      if (r.out || r.h || s.kind === 'moguls') return { idx: i, score: bad, text: r.out === 'dsq' ? '실격' : 'DNF', dnf: true };
      const T = r2(Math.max(s.t, 1) / progress(s, r) * s.sc + r.pen);
      return { idx: i, score: T, text: fmtRes(s, T) };
    });
    s.results = OG.sortResults(rows, lb);
    s.done = true;
  }

  // standings of on-course racers (head-to-head kinds): array of racer indices, best first
  function standings(s) {
    return s.R.map(r => r.k).sort((a, b) => {
      const A = s.R[a], B = s.R[b];
      const fa = A.fin >= 0 ? A.fin : 1e6, fb = B.fin >= 0 ? B.fin : 1e6;
      if (fa !== fb) return fa - fb;
      if (!!A.out !== !!B.out) return A.out ? 1 : -1;
      return progress(s, B) - progress(s, A);
    });
  }
  // provisional overall rank of a finished racer among all known results
  function liveRank(s, r) {
    const lb = s.kind !== 'moguls';
    let n = 1;
    s.sim.forEach(m => { if (m && !m.d && (lb ? m.T < r.res : m.T > r.res)) n++; });
    s.R.forEach(o => { if (o !== r && o.fin >= 0 && !o.out && (lb ? o.res < r.res : o.res > r.res)) n++; });
    return n;
  }

  OG.defineEngine('downhill', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) {
      const cf = ev.cfg;
      const s = { evId: ev.id, kind: cf.kind, sub: cf.sub || '', par: cf.par, t: -3, fr: 0, done: false, fin: 0, endT: 0,
        ents, R: [], pops: [], hv: [], sim: [], gh: null, sc: 1, ref: 30, tl: 100, strict: !!(opts && opts.difficulty >= 2) };
      s.C = GEN[cf.kind](cf, R);
      const hum = ents.filter(e => e.human).sort((a, b) => a.pid - b.pid);
      hum.forEach(e => newRacer(s, e.idx, 1, true, e.pid));
      const cpus = ents.filter(e => !e.human);
      let nOn = 0;
      if (s.kind === 'cross') nOn = Math.min(cpus.length, Math.max(0, 4 - hum.length));
      else if (s.kind === 'kart' || s.kind === 'sail') nOn = cpus.length;
      else if (s.sub === 'pgs' && hum.length <= 1) nOn = Math.min(1, cpus.length);
      const pick = s.sub === 'pgs' ? cpus.slice().sort((a, b) => b.skill - a.skill) : R.shuffle(cpus.slice());
      pick.slice(0, nOn).forEach(e => {
        const q = OG.cpuQuality(e, R), r = newRacer(s, e.idx, q, false, -1);
        r.pw = r2(1 / (1 + (cf.ease || 0) + (1 - q) * cf.spread));
      });
      s.hv = s.R.filter(r => r.h).map(r => r.k);
      PLACE[s.kind](s);
      calibrate(s, cf);
      s.sc = Math.round(cf.par / s.ref * 10000) / 10000;
      s.tl = r1(clamp(s.ref * 2.4, 45, 115));
      simCpu(s, cf, R);
      return s;
    },
    update(s, inputs, dt, R) {
      const t0 = s.t;
      s.t += dt;
      s.fr++;
      if (t0 < 0 && Math.floor(t0) !== Math.floor(s.t)) OG.sfx(s, s.t >= 0 ? 'go' : 'beep');
      if (s.t < 0) return;
      for (let k = 0; k < s.R.length; k++) {
        const r = s.R[k];
        let inp;
        if (r.h) inp = (r.fin >= 0 || r.out) ? BL : ((inputs && inputs[r.pid]) || BL);
        else inp = AI[s.kind](s, r, R);
        STEP[s.kind](s, r, inp, dt, R);
      }
      if (COLL[s.kind]) collide(s, COLL[s.kind]);
      if (!s.fin) {
        if (s.t > s.tl) s.R.forEach(r => { if (r.h && r.fin < 0 && !r.out) { r.out = 'dnf'; pop(s, r, '시간 초과', PAL.red); OG.sfx(s, 'buzzer'); } });
        if (s.R.every(r => !r.h || r.fin >= 0 || r.out)) { s.fin = 1; s.endT = 0; }
      } else {
        s.endT += dt;
        if (s.endT > 2.4) finalize(s);
      }
    },
    draw(g, s) { drawAll(g, s); },
    // dev hook: AI input for any racer (used by test pages to drive human slots)
    _ai(s, k) { const r = s.R[k]; return r ? AI[s.kind](s, r) : BL; }
  });


  /* ============================== DRAWING ============================== */
  const COL = {
    snow: '#f6f9ff', cord: '#e9f0fa', snowSh: '#cad8ec', off: '#e2eaf5', offSh: '#c9d7ea', trk: '#d3dff0',
    dye: '#4f86dc', net: '#ef5a2a', net2: '#ffb347', gBlue: '#1f63d6',
    pine: '#1c4634', pine2: '#2c6649', trunk: '#5b3a2e', treeSh: 'rgba(70,100,150,0.2)',
    ice: '#d6ecfb', iceHi: '#f4fbff', bank: '#bcdaf2', bank2: '#a3c8e8', wall: '#e8f1fb', wallSh: '#56688f',
    nsnow: '#232b4a', nsnow2: '#2e3860', npine: '#141f36', npine2: '#1d2c4a',
    grass: '#4a8f3f', grass2: '#3e7d36', grass3: '#5aa04a', stone: '#9aa6b8', stoneD: '#6b7891',
    water: '#1d78c0', deep: '#16619f', foam: '#eaf8ff',
    dirt: '#8d5b3a', dirt2: '#a46e48', dirtD: '#6b4128', forest: '#29523a', forest2: '#22472f', forest3: '#356b43',
    kbg: '#0b0919', kgrid: '#191339', asph: '#221d3c', asph2: '#272146', nC: '#2ce8f5', nM: '#ff3fa4', nY: '#fee761',
    sea: '#1a63a3', sea2: '#2477bb', sea3: '#15538b', sand: '#e8d29a'
  };
  const FANC = ['#e43b44', '#feae34', '#0099db', '#ffffff', '#63c74d', '#b55088', '#f77622', '#2ce8f5', '#fee761', '#262b44', '#ff0044'];
  const helmetOf = look => look.pants === '#ffffff' ? look.shirt : look.pants;

  function views(n) {
    if (n <= 1) return [[0, 0, 480, 270]];
    if (n <= 4) { const w = Math.floor(480 / n), o = []; for (let i = 0; i < n; i++) o.push([i * w, 0, w, 270]); return o; }
    const cols = n <= 6 ? 3 : 4, w = 480 / cols, o = [];
    for (let i = 0; i < n; i++) o.push([(i % cols) * w, Math.floor(i / cols) * 135, w, 135]);
    return o;
  }
  function laneOff(s, r) { return r && r.ln ? r.ln * LANE : 0; }
  function camOf(s, r, w, h) {
    const C = s.C;
    if (s.kind === 'kart' || s.kind === 'sail') {
      if (!r) return [Math.round(-w / 2), Math.round(-h / 2 - (s.kind === 'sail' ? 300 : 0))];
      const vx = s.kind === 'kart' ? Math.cos(r.vd) * r.v : Math.sin(r.a) * r.v;
      const vy = s.kind === 'kart' ? Math.sin(r.vd) * r.v : -Math.cos(r.a) * r.v;
      const la = s.kind === 'kart' ? 0.22 : 0.55;
      const lx = clamp(vx * la, -w * 0.28, w * 0.28), ly = clamp(vy * la, -h * 0.28, h * 0.28);
      return [Math.round(r.x + lx - w / 2), Math.round(r.y + ly - h / 2)];
    }
    const y = r ? r.y : 0, lo = laneOff(s, r);
    const x = r ? lerp(r.x + lo, cX(C, y + 90) + lo, s.kind === 'sled' ? 0.55 : 0.4) : cX(C, y);
    return [Math.round(x - w / 2), Math.round(y - h * (s.kind === 'canoe' ? 0.42 : h < 200 ? 0.2 : 0.3))];
  }

  function drawAll(g, s) {
    const hv = s.hv.length ? s.hv : (s.R.length ? [0] : [-1]);
    const V = views(hv.length);
    for (let k = 0; k < V.length; k++) drawView(g, s, V[k], hv[k] >= 0 ? s.R[hv[k]] : null);
    for (const v of V) {
      if (v[0] > 0) g.rect(v[0] - 1, v[1], 2, v[3], PAL.black);
      if (v[1] > 0) g.rect(v[0], v[1] - 1, v[2], 2, PAL.black);
    }
    if (s.t < 0.7) g.countdown(-s.t);
    const ev = OG.EVENT_MAP[s.evId];
    let line = null;
    if (s.kind === 'sled') {
      const hs = s.R.filter(r => r.h), pushing = hs.some(r => r.ph === 0), lastLoad = Math.max(0, ...hs.map(r => r.ldT || 0));
      if (pushing && s.t < 12) line = s.sub === 'luge' ? ev.help[0] : ev.help[0] + '   ' + ev.help[1];
      else if (!pushing && s.t - lastLoad < 3.5 && !s.fin) line = ev.help[2];
    } else if (s.t < 4.5 && !s.fin) line = ev.help[0];
    if (line) {
      g.rect(0, 255, 480, 15, 'rgba(24,20,37,0.72)');
      g.rich(line, 240, 257, PAL.white, { align: 'center' });
    }
  }

  function drawView(g, s, v, r) {
    const vx = v[0], vy = v[1], vw = v[2], vh = v[3];
    const cam = camOf(s, r, vw, vh);
    g.save(); g.clip(vx, vy, vw, vh);
    g.save(); g.translate(vx - cam[0], vy - cam[1]);
    SCENE[s.kind](g, s, cam[0], cam[1], vw, vh, r);
    g.restore();
    if (r) {
      speedLines(g, s, r, v);
      drawPops(g, s, r, vx - cam[0], vy - cam[1]);
      hud(g, s, v, r);
    }
    g.restore();
  }

  /* ------------------------------ helpers ----------------------------- */
  function label(g, txt, x, y, c) { g.text(txt, x, y, c, { size: 'xs', align: 'center', outline: PAL.black }); }
  function entTag(s, r) { const e = s.ents[r.i]; return e ? OG.entLabel(e) : ''; }
  function entCol(s, r) { const e = s.ents[r.i]; return e ? OG.entColor(e) : PAL.white; }
  function lookOf(s, r) { const e = s.ents[r.i]; return e ? OG.lookOf(e) : { shirt: PAL.red, pants: PAL.navy, skin: PAL.skin2, hair: PAL.black }; }
  function chevron(g, x, y, c) {
    g.rect(x - 3, y, 7, 1, PAL.black); g.rect(x - 3, y - 1, 7, 1, c); g.rect(x - 2, y + 1, 5, 1, c); g.rect(x - 1, y + 2, 3, 1, c); g.px(x, y + 3, c);
  }
  function FR(x, y, fx, fy) { return (fd, sd) => [x + fx * fd - fy * sd, y + fy * fd + fx * sd]; }
  function polyF(g, F, pts, c) { const o = []; for (let i = 0; i < pts.length; i += 2) { const p = F(pts[i], pts[i + 1]); o.push(p[0], p[1]); } g.poly(o, c); }
  function lineF(g, F, a, b, c, d, col, t) { const p = F(a, b), q = F(c, d); g.line(p[0], p[1], q[0], q[1], col, t); }
  function dotF(g, F, a, b, rad, col) { const p = F(a, b); g.circle(p[0], p[1], rad, col); }
  function fan(g, x, y, q, t) {
    const c = FANC[Math.floor(q * 997) % FANC.length], j = Math.sin(t * 7 + q * 40) > 0.75 ? 1 : 0;
    g.rect(x - 1, y - 5 - j, 3, 4, c);
    g.px(x - 1, y - 1, '#2a2a3a'); g.px(x + 1, y - 1, '#2a2a3a');
    g.rect(x, y - 7 - j, 2, 2, OG.SKINS[Math.floor(q * 31) % 5]);
    g.px(x, y - 8 - j, OG.HAIRS[Math.floor(q * 13) % 6]);
    if (q < 0.18) { const fy = y - 12 - j + Math.round(Math.sin(t * 5 + q * 9)); g.rect(x + 2, fy, 1, 6, '#5a6988'); g.rect(x + 3, fy, 4, 3, FANC[Math.floor(q * 333) % FANC.length]); }
    else if (q > 0.85 && j) { g.px(x - 2, y - 8, OG.SKINS[1]); g.px(x + 3, y - 8, OG.SKINS[1]); }
  }
  function pine(g, x, y, sz, night) {
    const c1 = night ? COL.npine : COL.pine, c2 = night ? COL.npine2 : COL.pine2, sn = night ? '#7f93bb' : '#f6f9ff';
    g.ellipse(x + 4, y + 1, 6 * sz, 2, night ? 'rgba(0,0,0,0.3)' : COL.treeSh);
    g.rect(x, y - 3, 1, 3, COL.trunk);
    for (let k = 0; k < 3; k++) {
      const hw = Math.max(1.5, (6 - k * 1.7) * sz), by = y - 2 - k * 4 * sz, top = by - 6 * sz;
      g.poly([x - hw, by, x + hw + 1, by, x + 0.5, top], c1);
      g.poly([x - hw, by, x + 0.5, by, x + 0.5, top], c2);
      g.rect(x - hw + 1, by - 1, Math.max(1, Math.round(hw * 0.7)), 1, sn);
    }
  }
  function roundTree(g, x, y, rr, dark) {
    g.ellipse(x + 3, y + 3, rr, rr * 0.75, 'rgba(0,0,0,0.25)');
    g.circle(x, y, rr, dark ? '#1d4a2c' : '#2f6b37');
    g.circle(x - rr * 0.22, y - rr * 0.22, rr * 0.72, dark ? '#2a5e38' : '#3e8948');
    g.circle(x - rr * 0.4, y - rr * 0.45, rr * 0.35, dark ? '#3a7446' : '#63c74d');
  }
  function ghostPos(s) {
    if (!s.gh || !s.gs || s.t < 0) return null;
    const w = (s.gh.T / s.sc) / s.ref, f = s.t / w / 0.2, n = s.gs.x.length;
    if (f >= n - 1) return null;
    const i = Math.floor(f), t = f - i;
    const x = lerp(s.gs.x[i], s.gs.x[i + 1], t), y = lerp(s.gs.y[i], s.gs.y[i + 1], t);
    return { x, y, a: Math.atan2(s.gs.x[i + 1] - s.gs.x[i], (s.gs.y[i + 1] - s.gs.y[i]) || 0.001), v: Math.hypot(s.gs.x[i + 1] - s.gs.x[i], s.gs.y[i + 1] - s.gs.y[i]) / 0.2 / w };
  }
  function spray(g, s, r, x, y, a, amt, cols) {
    const n = Math.round(amt * 10), f = Math.floor(g.t * 30);
    for (let k = 0; k < n; k++) {
      const q = hash(r.k * 31 + k, f, 7), q2 = hash(r.k * 17 + k, f, 9);
      const back = 2 + q * 11, side = (q2 - 0.5) * 12;
      g.px(x - Math.sin(a) * back + Math.cos(a) * side, y - Math.cos(a) * back * 0.7 - q * 5, cols[k % cols.length]);
    }
  }
  function puff(g, x, y, k, col) { // k: 0..1 (1 = fresh)
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, rr = 3 + (1 - k) * 8; g.circle(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.5, Math.max(0.6, 2.2 * k), col); }
  }
  function speedLines(g, s, r, v) {
    let vm = 400;
    if (s.kind === 'ski' || s.kind === 'cross') vm = SKI[s.sub].vmax;
    else if (s.kind === 'sled') vm = 430; else if (s.kind === 'kart') vm = 320; else return;
    const k = (r.v / vm - 0.8) / 0.2;
    if (k <= 0 || r.fin >= 0 || r.z > 0) return;
    const n = Math.round(Math.min(1, k) * (v[2] / 16)), sp = 900;
    g.alpha(0.3);
    for (let i = 0; i < n; i++) {
      const x = v[0] + Math.floor(hash(i, 3, 5) * v[2]);
      const len = 4 + Math.floor(hash(i, 4, 5) * 8);
      const y = v[1] + M.wrap(hash(i, 6, 5) * 600 - g.t * sp * (0.7 + hash(i, 7, 5) * 0.6), v[3] + 40) - 20;
      if (s.kind === 'kart') { const dx = Math.cos(r.vd), dy = Math.sin(r.vd); g.line(x, y, x - dx * len, y - dy * len, '#ffffff', 1); }
      else g.rect(x, y, 1, len, '#ffffff');
    }
    g.alpha(1);
  }
  function drawPops(g, s, r, ox, oy) {
    let n = 0;
    const lo = laneOff(s, r);
    for (let i = s.pops.length - 1; i >= 0; i--) {
      const p = s.pops[i], age = s.t - p.t;
      if (p.r !== r.k || age < 0 || age > 1.2) continue;
      const x = r.x + lo + ox, y = r.y + oy - 40 - age * 14 - n * 11;
      g.alpha(age > 0.9 ? (1.2 - age) / 0.3 : 1);
      g.text(p.x, x, y, p.c, { size: 's', align: 'center', outline: PAL.black });
      g.alpha(1);
      if (++n >= 2) break;
    }
  }

  /* ------------------------------ sprites ----------------------------- */
  // oblique skier / boarder (back view), (x,y) = feet on the snow
  function skier(g, x, y, a, look, o) {
    const hz = Math.round((o.z || 0) * 0.2);
    g.ellipse(x + Math.round(hz * 0.4), y + 1, 5, 1.5, 'rgba(50,70,120,0.28)');
    if (o.cr > 0) { tumble(g, x, y, look, o); return; }
    const fx = Math.sin(a), fy = Math.cos(a), by = y - hz;
    if (o.trick) { trickSkier(g, x, by, look, o); return; }
    if (o.board) {
      g.line(x - fx * 6, by - fy * 4, x + fx * 6, by + fy * 4, '#20202a', 3);
      g.line(x - fx * 5, by - fy * 3, x + fx * 5, by + fy * 3, o.bc || PAL.yellow, 1);
    } else {
      for (const sd of [-1.5, 1.5]) {
        const ox = fy * sd, oy = -fx * sd * 0.6;
        g.line(x + ox - fx * 5, by + oy - fy * 3.5, x + ox + fx * 7, by + oy + fy * 5, o.sc || PAL.red, 1);
      }
    }
    const tk = o.tk ? 1 : 0, ab = o.ab ? 1 : 0;
    const lean = clamp((o.st || 0) * 1.6 + fx * 1.3, -2.6, 2.6);
    const low = tk ? 3 : ab ? 2 : 0;
    const hipX = x + lean * 0.4, hipY = by - 6 + low, shX = x + lean * (tk ? 0.7 : 1), shY = by - 11 + low + (tk ? 2 : 0);
    const shirt = look.suit || look.shirt, pants = look.suit || look.pants;
    if (o.board) { g.line(x - 2, by - 1, hipX - 1, hipY, pants, 1); g.line(x + 2, by - 1, hipX + 1, hipY, pants, 1); }
    else { g.line(x - 1.5, by - 1, hipX - 1, hipY, pants, 1); g.line(x + 1.5, by - 1, hipX + 1, hipY, pants, 1); }
    g.rect(hipX - 2, hipY - 1, 4, 2, pants);
    g.line(hipX, hipY - 1, shX, shY + 1, shirt, 3);
    g.rect(Math.round(shX) - 1, Math.round(shY) + 2, 3, 2, '#ffffff');
    g.px(Math.round(shX), Math.round(shY) + 2, '#3a4466');
    if (o.board) {
      g.line(shX - 2, shY + 1, shX - 6, shY + 3 - lean, shirt, 1); g.line(shX + 2, shY + 1, shX + 6, shY + 3 + lean, shirt, 1);
    } else if (tk) {
      g.rect(shX - 3, shY + 1, 1, 2, shirt); g.rect(shX + 3, shY + 1, 1, 2, shirt);
      g.line(shX - 3, shY + 2, shX - 6, shY - 3, '#8b9bb4', 1); g.line(shX + 3, shY + 2, shX + 6, shY - 3, '#8b9bb4', 1);
    } else {
      g.line(shX - 2, shY + 1, shX - 4, shY + 4, shirt, 1); g.line(shX + 2, shY + 1, shX + 4, shY + 4, shirt, 1);
      g.line(shX - 4, shY + 4, x - 6, by + 1, '#8b9bb4', 1); g.line(shX + 4, shY + 4, x + 6, by + 1, '#8b9bb4', 1);
    }
    const hc = o.helmet || helmetOf(look);
    g.circle(shX, shY - 2, 2, hc);
    g.px(Math.round(shX) - 1, Math.round(shY) - 3, '#ffffff');
    if (o.trick) trickFx(g, shX, shY, o.trick, o.tp);
  }
  function trickSkier(g, x, by, look, o) {
    const tn = o.trick, k = clamp(o.tp, 0, 1), cx = x, cy = by - 6;
    const th = tn === 'bf' ? -k * TAU : tn === 'ck' ? k * TAU * 2 : 0;
    const shirt = look.suit || look.shirt, pants = look.suit || look.pants, sc = o.sc || PAL.red;
    if (tn === 'bf') { // backflip: whole body rotates (seen from behind it squashes through the flip)
      const c = Math.cos(th), sq = c;
      const head = [cx, cy - 6 * sq], feet = [cx, cy + 6 * sq];
      g.line(feet[0] - 1.5, feet[1], cx - 1, cy + sq, pants, 1); g.line(feet[0] + 1.5, feet[1], cx + 1, cy + sq, pants, 1);
      g.line(cx, cy + sq, cx, cy - 4 * sq, shirt, 3);
      g.line(feet[0] - 1.5, feet[1] - 4, feet[0] - 1.5, feet[1] + 5, sc, 1); g.line(feet[0] + 1.5, feet[1] - 4, feet[0] + 1.5, feet[1] + 5, sc, 1);
      g.circle(head[0], head[1], 2, helmetOf(look));
    } else if (tn === 'ck') { // cork 720: skis sweep round, body leans off-axis
      const sx = Math.sin(th), sy = Math.cos(th), lean = Math.sin(th) * 2;
      for (const sd of [-1.5, 1.5]) g.line(cx + sy * sd - sx * 6, by + sx * sd * 0.6 - sy * 4, cx + sy * sd + sx * 6, by + sx * sd * 0.6 + sy * 4, sc, 1);
      g.line(cx - 1.5, by - 1, cx + lean * 0.5 - 1, cy, pants, 1); g.line(cx + 1.5, by - 1, cx + lean * 0.5 + 1, cy, pants, 1);
      g.line(cx + lean * 0.5, cy, cx + lean, cy - 5, shirt, 3);
      g.line(cx + lean - 2, cy - 4, cx + lean - 5 * sy, cy - 3 - 2 * sx, shirt, 1); g.line(cx + lean + 2, cy - 4, cx + lean + 5 * sy, cy - 3 + 2 * sx, shirt, 1);
      g.circle(cx + lean, cy - 7, 2, helmetOf(look));
    } else { // spread eagle: X shape
      const sp = Math.sin(k * Math.PI);
      g.line(cx, cy, cx - 2 - 4 * sp, by - 1, pants, 1); g.line(cx, cy, cx + 2 + 4 * sp, by - 1, pants, 1);
      g.line(cx - 3 - 4 * sp, by - 4, cx - 1 - 4 * sp, by + 3, sc, 1); g.line(cx + 3 + 4 * sp, by - 4, cx + 1 + 4 * sp, by + 3, sc, 1);
      g.line(cx, cy, cx, cy - 5, shirt, 3);
      g.line(cx, cy - 4, cx - 3 - 4 * sp, cy - 8, shirt, 1); g.line(cx, cy - 4, cx + 3 + 4 * sp, cy - 8, shirt, 1);
      g.circle(cx, cy - 7, 2, helmetOf(look));
    }
    trickFx(g, cx, cy - 6, tn, o.tp);
  }
  function trickFx(g, x, y, tn, tp) {
    const k = clamp(tp, 0, 1), c = tn === 'ck' ? PAL.cyan : tn === 'bf' ? PAL.yellow : PAL.pink;
    for (let i = 0; i < 6; i++) { const a = k * TAU * (tn === 'ck' ? 2 : 1) + i * 0.35; g.px(x + Math.cos(a) * 9, y + 2 + Math.sin(a) * 6, i < 3 ? c : '#ffffff'); }
  }
  function tumble(g, x, y, look, o) {
    const k = clamp((o.crd || 1.6) - o.cr, 0, 2), ang = k * 9;
    if (k < 0.9) puff(g, x, y - 3, 1 - k / 0.9, '#ffffff');
    const cx = x, cy = y - 3 + (k < 0.9 ? -Math.sin(k / 0.9 * Math.PI) * 4 : 0);
    const shirt = look.suit || look.shirt;
    if (k > 1.0) { // lying in the snow
      g.line(cx - 5, cy + 2, cx + 4, cy + 2, shirt, 3); g.circle(cx + 6, cy + 1, 2, helmetOf(look));
      g.line(cx - 8, cy + 5, cx + 2, cy + 7, o.sc || PAL.red, 1); g.line(cx + 4, cy - 2, cx + 10, cy + 4, o.sc || PAL.red, 1);
    } else {
      const dx = Math.cos(ang) * 4, dy = Math.sin(ang) * 4;
      g.line(cx - dx, cy - dy, cx + dx, cy + dy, shirt, 3); g.circle(cx + dx * 1.4, cy + dy * 1.4, 2, helmetOf(look));
      g.line(cx - 6 - k * 6, cy - k * 4, cx + 2 - k * 6, cy - 6 - k * 4, o.sc || PAL.red, 1);
      g.line(cx + 4 + k * 5, cy + 2, cx + 10 + k * 5, cy - 4 + k * 3, o.sc || PAL.red, 1);
    }
  }
  // top-down sleds: a = heading (0 = down the screen)
  function sledSprite(g, s, r, x, y, a, look, ghost) {
    const F = FR(x, y, Math.sin(a), Math.cos(a)), shell = look.shirt, stripe = look.pants, hc = helmetOf(look);
    const sub = s.sub;
    g.ellipse(x + 1, y + 1, 6, 3, 'rgba(40,60,100,0.18)');
    if (sub === 'bob') {
      polyF(g, F, [10, 0, 8, 3.5, -8, 4, -10, 3, -10, -3, -8, -4, 8, -3.5], OG.shade(shell, -0.35));
      polyF(g, F, [9, 0, 7, 3, -8, 3.2, -9, 0, -8, -3.2, 7, -3], shell);
      lineF(g, F, 9, 0, -9, 0, stripe, 1);
      lineF(g, F, 6, 3.6, -9, 3.8, '#cfd6e2', 1); lineF(g, F, 6, -3.6, -9, -3.8, '#cfd6e2', 1);
      if (r && r.ph === 0 && !ghost) { // crew pushing beside the sled
        const ph = r.pa || 0;
        [[-3, 6], [-7, 6], [-3, -6], [-7, -6]].forEach((c, i) => {
          const sw = Math.sin(ph * 1.7 + i * 1.6) * 1.5, sd = sgn(c[1]);
          const l1 = F(c[0] - 3 + sw, c[1] + sd), l2 = F(c[0] - 3 - sw, c[1] - sd * 0.5);
          g.px(l1[0], l1[1], stripe); g.px(l2[0], l2[1], stripe);
          lineF(g, F, c[0] - 1.5, c[1], c[0] + 1, c[1], shell, 2);
          lineF(g, F, c[0] + 1, c[1] - sd * 0.5, c[0] + 2.5, c[1] - sd * 2.2, shell, 1);
          const p = F(c[0] + 1.5, c[1]); g.circle(p[0], p[1], 1.5, hc); g.px(p[0], p[1] - 1, '#fff');
        });
      } else {
        for (let i = 0; i < 4; i++) { dotF(g, F, 5 - i * 4, 0, 1.6, hc); const p = F(5 - i * 4 + 0.6, -0.6); g.px(p[0], p[1], '#ffffff'); }
      }
      dotF(g, F, 8.5, 0, 0.8, stripe);
    } else if (sub === 'luge') {
      polyF(g, F, [7, 2.5, -6, 2.5, -6, -2.5, 7, -2.5], '#3a4466');
      lineF(g, F, 8, 2.8, -6, 2.8, '#c0cbdc', 1); lineF(g, F, 8, -2.8, -6, -2.8, '#c0cbdc', 1);
      if (r && r.ph === 0 && !ghost) { dotF(g, F, -2, 0, 2, shell); dotF(g, F, -4, 0, 1.8, hc); const sw = Math.sin((r.pa || 0) * 2) * 3; lineF(g, F, -2, 1, 2 + sw, 5, shell, 1); lineF(g, F, -2, -1, 2 + sw, -5, shell, 1); }
      else { lineF(g, F, 9, 0, -3, 0, shell, 3); lineF(g, F, 9, 1, 9, -1, '#181425', 1); dotF(g, F, -5, 0, 2, hc); const p = F(-4.5, -0.8); g.px(p[0], p[1], '#fff'); }
    } else {
      polyF(g, F, [6, 2.2, -6, 2.2, -6, -2.2, 6, -2.2], '#3a4466');
      lineF(g, F, 6, 2.4, -6, 2.4, '#c0cbdc', 1); lineF(g, F, 6, -2.4, -6, -2.4, '#c0cbdc', 1);
      if (r && r.ph === 0 && !ghost) { const sw = Math.sin((r.pa || 0) * 2.2) * 1.5; dotF(g, F, -9 + sw, 3, 2, hc); lineF(g, F, -8 + sw, 2.5, -5, 1, shell, 2); lineF(g, F, -11, 3 + sw, -13, 3 - sw, stripe, 1); }
      else { lineF(g, F, 5, 0, -9, 0, shell, 3); dotF(g, F, 7, 0, 2, hc); const p = F(7.6, -0.7); g.px(p[0], p[1], '#fff'); lineF(g, F, -9, 1, -11, 1.5, stripe, 1); lineF(g, F, -9, -1, -11, -1.5, stripe, 1); }
    }
  }
  function kayak(g, r, x, y, a, look, ghost) {
    const F = FR(x, y, Math.sin(a), Math.cos(a));
    g.ellipse(x + 2, y + 2, 7, 3, 'rgba(0,30,60,0.3)');
    polyF(g, F, [10, 0, 6, 2.6, -1, 3.4, -7, 2.4, -10, 0, -7, -2.4, -1, -3.4, 6, -2.6], look.shirt);
    lineF(g, F, 9, 0, -9, 0, OG.shade(look.shirt, 0.4), 1);
    dotF(g, F, 0, 0, 2.4, '#181425');
    dotF(g, F, 0, 0, 2, look.pants === '#ffffff' ? PAL.red : look.pants);
    dotF(g, F, 0.4, 0, 1.4, PAL.yellow);
    const ph = r ? r.ph : 0, sw = Math.sin(ph * TAU) * 3.2;
    lineF(g, F, sw, -7, -sw, 7, '#3a3a3a', 1);
    const b1 = F(sw, -7.5), b2 = F(-sw, 7.5);
    g.rect(b1[0] - 1, b1[1] - 1, 2, 2, PAL.yellow); g.rect(b2[0] - 1, b2[1] - 1, 2, 2, PAL.yellow);
    if (r && r.sp > 0.3 && !ghost) { const b = Math.sin(ph * TAU) > 0 ? b2 : b1; g.px(b[0] + 2, b[1] + 1, '#ffffff'); g.px(b[0] - 1, b[1] + 2, '#ffffff'); }
  }
  function bike(g, r, x, y, a, look, ghost) {
    const hz = Math.round((r ? r.z : 0) * 0.25);
    g.ellipse(x + 2, y + 2, 5, 8, 'rgba(0,0,0,0.3)');
    y -= hz;
    const F0 = FR(x, y, Math.sin(a), Math.cos(a)), F = (fd, sd) => F0(fd * 1.4, sd * 1.4), wob = r && r.wb > 0 ? Math.sin(r.wb * 40) * 0.8 : 0;
    lineF(g, F, 8, wob, 4, wob, '#181425', 2); lineF(g, F, -4, 0, -8, 0, '#181425', 2);
    lineF(g, F, 6, 0, -6, 0, look.shirt, 1);
    lineF(g, F, 5, -3, 5, 3, '#5a6988', 1);
    const ph = r ? r.ph : 0;
    const k1 = F(Math.sin(ph * TAU) * 1.5, 2.5), k2 = F(-Math.sin(ph * TAU) * 1.5, -2.5);
    g.px(k1[0], k1[1], look.pants); g.px(k2[0], k2[1], look.pants);
    lineF(g, F, -2, 0, 3, 0, look.shirt, 3);
    lineF(g, F, 2, 1, 5, 2.5, look.shirt, 1); lineF(g, F, 2, -1, 5, -2.5, look.shirt, 1);
    dotF(g, F, 3.5, 0, 2.4, helmetOf(look));
    const p = F(4, -0.8); g.px(p[0], p[1], '#ffffff');
  }
  function kart(g, r, x, y, a, look) {
    const F0 = FR(x, y, Math.cos(a), Math.sin(a)), F = (fd, sd) => F0(fd * 1.2, sd * 1.2);
    g.alpha(0.35); g.ellipse(x, y, 12, 10, look.shirt); g.alpha(1);
    polyF(g, F, [8, 4.5, -7, 5, -7, -5, 8, -4.5], '#14111f');
    [[5, 5], [5, -5], [-5, 5.5], [-5, -5.5]].forEach(c => { const p = F(c[0], c[1]); g.rect(p[0] - 1.5, p[1] - 1.5, 3, 3, '#0b0a12'); });
    polyF(g, F, [9, 0, 6, 3.5, -6, 4, -7, 0, -6, -4, 6, -3.5], look.shirt);
    lineF(g, F, 8, 0, -6, 0, OG.shade(look.shirt, 0.45), 1);
    dotF(g, F, -1.5, 0, 2.6, '#14111f');
    dotF(g, F, -1.5, 0, 2.1, helmetOf(look));
    const v = F(-0.3, 0); g.px(v[0], v[1], PAL.cyan);
    if (r && r.bt > 0) { for (let i = 0; i < 4; i++) { const q = F(-8 - i * 2 - hash(r.k, i, Math.floor(r.bt * 30)) * 3, (hash(i, r.k, 3) - 0.5) * 4); g.rect(q[0], q[1], 2, 2, i < 2 ? PAL.yellow : PAL.orange); } }
    if (r && r.dr) {
      const c = r.dc > 1.2 ? PAL.orange : r.dc > 0.55 ? PAL.cyan : '#c0cbdc';
      for (let i = 0; i < 3; i++) { const sd = (i % 2 ? 6 : -6); const q = F(-6 - hash(r.k, i, Math.floor(r.dc * 40)) * 4, sd); g.px(q[0], q[1], c); g.px(q[0] + 1, q[1], '#ffffff'); }
    }
  }
  function boat(g, s, r, x, y, a, look, wf) {
    const F0 = FR(x, y, Math.sin(a), -Math.cos(a)), F = (fd, sd) => F0(fd * 1.5, sd * 1.5);
    // wake
    const sp = r ? r.v / SAIL.vb : 0.6;
    if (sp > 0.15) for (let i = 1; i < 6; i++) { const w = i * 1.6 * sp + 2, b = F(-7 - i * 4, w), c = F(-7 - i * 4, -w); g.alpha(0.5 - i * 0.08); g.px(b[0], b[1], '#ffffff'); g.px(c[0], c[1], '#ffffff'); g.alpha(1); }
    polyF(g, F, [9, 0, 6, 3.4, -2, 4.2, -8, 3.6, -8, -3.6, -2, -4.2, 6, -3.4], '#f2f4f8');
    polyF(g, F, [8, 0, 5.5, 2.6, -2, 3.3, -7, 2.8, -7, -2.8, -2, -3.3, 5.5, -2.6], look.shirt);
    lineF(g, F, 8, 0, -7, 0, OG.shade(look.shirt, 0.35), 1);
    // sail on the leeward side (boom from the mast towards the stern, belly to leeward)
    const rel = M.angDiff(wf, a), al = Math.abs(rel), side = sgn(rel);
    const flap = r && r.bm > 0 ? Math.sin(r.bm * 30) * 0.5 : 0;
    const boom = clamp(al * 0.55, 0.2, 1.4) * side + flap;
    const mx = 4, L = 10.5, ex = mx - Math.cos(boom) * L, es = Math.sin(boom) * L;
    const belly = al < 0.62 ? 1.2 : 4;
    const m = F(mx, 0), e = F(ex, es), q1 = F(mx - Math.cos(boom) * L * 0.35 - Math.sin(boom) * belly * 0.2, es * 0.35 + side * belly), q2 = F(mx - Math.cos(boom) * L * 0.7, es * 0.7 + side * belly * 0.8);
    g.poly([m[0], m[1], q1[0], q1[1], q2[0], q2[1], e[0], e[1]], 'rgba(0,0,0,0.18)');
    g.poly([m[0], m[1] - 1, q1[0], q1[1] - 1, q2[0], q2[1] - 1, e[0], e[1] - 1], '#ffffff');
    g.line(m[0], m[1] - 1, q1[0], q1[1] - 1, '#9fb0c8', 1); g.line(q1[0], q1[1] - 1, q2[0], q2[1] - 1, '#9fb0c8', 1); g.line(q2[0], q2[1] - 1, e[0], e[1] - 1, '#9fb0c8', 1);
    g.line(m[0], m[1], e[0], e[1], '#3a4466', 1);
    g.circle(m[0], m[1], 1, '#262b44');
    // sailor (hikes out on the windward side)
    const hk = r ? r.hk : 0;
    dotF(g, F, -3, -side * (2 + hk * 3.5), 2, helmetOf(look));
    const sn = F(-5.5, 0); g.px(sn[0], sn[1], '#ffffff');
  }

  /* ------------------------------- scenes ----------------------------- */
  function sceneSnow(g, s, X, Y, w, h, fr) {
    const C = s.C, cross = s.kind === 'cross', mog = s.kind === 'moguls';
    const lanes = s.sub === 'pgs' ? Math.max(2, s.R.length) : 1;
    g.rect(X, Y, w, h, COL.off);
    for (let gy = Math.floor(Y / 10) - 1; gy * 10 < Y + h + 4; gy++) for (let gx = Math.floor(X / 14) - 1; gx * 14 < X + w; gx++) {
      const q = hash(gx, gy, 11);
      if (q < 0.2) { const px = gx * 14 + Math.floor(q * 400) % 14, py = gy * 10 + Math.floor(q * 700) % 10; g.rect(px, py, 4 + Math.floor(q * 300) % 5, 1, COL.offSh); g.rect(px + 1, py - 1, 3, 1, '#ffffff'); }
    }
    const y0 = Math.floor(Y / 2) * 2;
    for (let L = 0; L < lanes; L++) {
      const lo = L * LANE;
      for (let y = y0; y < Y + h; y += 2) {
        const cx = cX(C, y) + lo, hw = cW(C, y);
        g.rect(cx - hw, y, hw * 2, 2, M.wrap(y, 6) < 2 ? COL.cord : COL.snow);
        g.rect(cx - hw, y, 2, 2, COL.snowSh); g.rect(cx + hw - 2, y, 2, 2, COL.snowSh);
        if (!cross && !mog && M.wrap(y, 8) < 4) { g.rect(cx - hw + 6, y, 1, 2, COL.dye); g.rect(cx + hw - 7, y, 1, 2, COL.dye); }
        if (!mog) { const nc = cross ? COL.net2 : COL.net; g.rect(cx - hw - 4, y, 2, 2, nc); g.rect(cx + hw + 2, y, 2, 2, nc); g.px(cx - hw - 4, y, OG.shade(nc, -0.3)); g.px(cx + hw + 3, y, OG.shade(nc, -0.3)); }
        if (cross) {
          const k = cK(C, y), m = clamp(Math.abs(k) * 700, 0, 1);
          if (m > 0.15) { const side = k > 0 ? -1 : 1, bw = Math.round(hw * 0.55 * m); g.rect(side < 0 ? cx - hw + 2 : cx + hw - 2 - bw, y, bw, 2, '#dfe8f5'); g.rect(side < 0 ? cx - hw + 2 : cx + hw - 2 - Math.round(bw * 0.4), y, Math.round(bw * 0.4), 2, '#d0dcee'); }
        }
      }
      if (!mog) for (let y = Math.floor(Y / 16) * 16; y < Y + h + 8; y += 16) { const cx = cX(C, y) + lo, hw = cW(C, y); g.rect(cx - hw - 4, y - 6, 1, 7, '#3a4466'); g.rect(cx + hw + 3, y - 6, 1, 7, '#3a4466'); }
      if (s.sub === 'pgs') { // lane tint stripe
        for (let y = y0; y < Y + h; y += 2) { if (M.wrap(y, 12) < 6) continue; const cx = cX(C, y) + lo; g.rect(cx - 1, y, 2, 2, L % 2 ? 'rgba(31,99,214,0.12)' : 'rgba(228,59,68,0.12)'); }
      }
    }
    // features on the snow
    if (C.f) for (const ft of C.f) {
      if (ft.y < Y - 20 || ft.y > Y + h + 20) continue;
      const cx = cX(C, ft.y), hw = cW(C, ft.y);
      if (ft.t === 'j') {
        g.rect(cx - hw + 2, ft.y - 16, hw * 2 - 4, 14, '#edf3fb');
        g.rect(cx - hw + 2, ft.y - 4, hw * 2 - 4, 3, '#ffffff');
        g.rect(cx - hw + 2, ft.y - 1, hw * 2 - 4, 2, '#9fb6d6');
        g.rect(cx - hw + 2, ft.y + 1, hw * 2 - 4, 9, COL.snowSh);
        g.rect(cx - hw + 2, ft.y + 10, hw * 2 - 4, 6, '#dbe5f2');
        for (let x = cx - hw + 6; x < cx + hw - 4; x += 10) g.rect(x, ft.y - 3, 4, 1, PAL.red);
      } else {
        g.rect(cx - hw + 2, ft.y - 7, hw * 2 - 4, 3, '#ffffff');
        g.rect(cx - hw + 2, ft.y - 4, hw * 2 - 4, 3, '#eef4fc');
        g.rect(cx - hw + 2, ft.y, hw * 2 - 4, 5, COL.snowSh);
      }
    }
    if (mog) {
      const W = C.w[0];
      for (let y = y0; y < Y + h; y += 2) { const zx = Math.round(Math.sin(y / 30 * Math.PI) * 6); g.rect(zx - 3, y, 6, 2, 'rgba(110,140,190,0.13)'); }
      for (let k = 0; k + 1 < C.rows.length; k++) { // filler bumps between the timing rows
        const ry = (C.rows[k] + C.rows[k + 1]) / 2; if (C.rows[k + 1] - C.rows[k] > 70 || ry < Y - 10 || ry > Y + h + 10) continue;
        for (let bx = -W + 15 + (k % 2 ? 0 : 13); bx < W - 8; bx += 26) { g.ellipse(bx + 1, ry + 2, 8, 3, '#d3dfee'); g.ellipse(bx - 1, ry - 1, 5, 2, '#fbfdff'); }
      }
      for (let k = 0; k < C.rows.length; k++) {
        const ry = C.rows[k]; if (ry < Y - 10 || ry > Y + h + 10) continue;
        const off = k % 2 ? 13 : 0;
        const hot = fr && fr.b === k && fr.fin < 0;
        for (let bx = -W + 9 + off; bx < W - 6; bx += 26) {
          g.ellipse(bx + 2, ry + 3, 10, 5, '#b7c9e2');
          g.ellipse(bx, ry, 10, 5, hot ? '#d9f1ff' : '#edf3fb');
          g.ellipse(bx - 2, ry - 1, 6, 3, '#ffffff');
          g.px(bx - 4, ry - 2, '#ffffff');
        }
      }
      for (const kk of C.kk) {
        if (kk < Y - 40 || kk > Y + h + 30) continue;
        g.rect(-34, kk - 26, 68, 26, '#e9f0f9'); g.rect(-34, kk - 4, 68, 4, '#ffffff'); g.rect(-34, kk, 68, 3, '#8fa6c8'); g.rect(-34, kk + 3, 68, 10, COL.snowSh);
        for (let x = -30; x < 32; x += 8) g.rect(x, kk - 2, 4, 1, PAL.blue);
      }
    }
    // sparkles
    for (let gy = Math.floor(Y / 9); gy * 9 < Y + h; gy++) for (let gx = Math.floor(X / 9); gx * 9 < X + w; gx++) {
      const q = hash(gx, gy, 77);
      if (q < 0.035 && Math.sin(g.t * 3 + q * 400) > 0.55) g.px(gx * 9 + Math.floor(q * 900) % 9, gy * 9 + Math.floor(q * 3000) % 9, q < 0.015 ? '#bfe9ff' : '#ffffff');
    }
    // ski tracks
    for (const r of s.R) {
      const t = r.tr, lo = laneOff(s, r), bd = s.sub === 'pgs' || s.sub === 'bx';
      for (let i = 2; i + 1 < t.length; i += 2) {
        if (t[i] === -9999 || t[i - 2] === -9999) continue;
        if (t[i + 1] < Y - 4 || t[i - 1] > Y + h + 4) continue;
        if (bd) g.line(t[i - 2] + lo, t[i - 1], t[i] + lo, t[i + 1], COL.trk, 2);
        else { g.line(t[i - 2] + lo - 1, t[i - 1], t[i] + lo - 1, t[i + 1], COL.trk, 1); g.line(t[i - 2] + lo + 2, t[i - 1], t[i] + lo + 2, t[i + 1], COL.trk, 1); }
      }
    }
    // objects sorted by y
    const O = [];
    for (let cy = Math.floor((Y - 6) / 18); cy * 18 < Y + h + 34; cy++) for (let ci = Math.floor((X - 12) / 20); ci * 20 < X + w + 12; ci++) {
      const q = hash(ci, cy, 5), tx = ci * 20 + Math.floor(q * 97) % 14, ty = cy * 18 + Math.floor(q * 53) % 12;
      let dmin = 1e9;
      for (let L = 0; L < lanes; L++) { const d = Math.abs(tx - (cX(C, ty) + L * LANE)) - cW(C, ty); if (d < dmin) dmin = d; }
      if (dmin < 16 || hash(ci, cy, 6) > clamp((dmin - 12) / 50, 0.12, 0.75)) continue;
      O.push([ty, 0, tx, q]);
    }
    if (C.spx) for (const sp of C.spx) {
      const a = Math.max(sp[0], Math.floor(Y / 6) * 6 - 6), b = Math.min(sp[1], Y + h + 12);
      for (let y = a; y < b; y += 6) {
        const cx = cX(C, y), hw = cW(C, y);
        for (let L = 0; L < lanes; L++) for (const side of [-1, 1]) for (let j = 0; j < 3; j++) {
          if (lanes > 1 && ((L > 0 && side < 0) || (L < lanes - 1 && side > 0))) continue;
          const q = hash(y, j * 2 + (side > 0 ? 1 : 0), 21);
          if (q > 0.75) continue;
          O.push([y + j, 1, cx + L * LANE + side * (hw + 8 + j * 5) + Math.floor(q * 3), q]);
        }
      }
    }
    if (C.gates) for (let L = 0; L < lanes; L++) for (const G of C.gates) if (G.y > Y - 12 && G.y < Y + h + 16) O.push([G.y, 2, G, L]);
    if (cross || mog) for (let y = Math.floor(Y / 90) * 90; y < Y + h + 12; y += 90) if (y > 0 && y < C.len) for (const side of [-1, 1]) O.push([y, 3, cX(C, y) + side * (cW(C, y) + 1), side]);
    O.push([-34, 4]); O.push([C.len, 5]);
    if (mog) O.push([C.len - 140, 8]);
    for (const r of s.R) O.push([r.y, 6, r]);
    const gp = ghostPos(s);
    if (gp) O.push([gp.y, 7, gp]);
    O.sort((p, q) => p[0] - q[0]);
    const look = r => lookOf(s, r);
    for (const o of O) {
      const t = o[1];
      if (t === 0) pine(g, o[2], o[0], 0.8 + o[3] * 0.6);
      else if (t === 1) fan(g, o[2], o[0], o[3], g.t);
      else if (t === 2) drawGate(g, s, o[2], o[3], fr);
      else if (t === 3) { const x = o[2]; g.rect(x, o[0] - 9, 1, 9, '#5a6988'); g.poly([x + 1, o[0] - 9, x + 6, o[0] - 7, x + 1, o[0] - 5], (o[0] / 90) % 2 ? PAL.red : COL.gBlue); }
      else if (t === 4) { for (let L = 0; L < lanes; L++) startHut(g, s, cX(C, 0) + L * LANE, 0, cW(C, 0)); }
      else if (t === 5) { for (let L = 0; L < lanes; L++) finishArch(g, cX(C, C.len) + L * LANE, cW(C, C.len), C.len); }
      else if (t === 6) {
        const r = o[2], lo = laneOff(s, r), lk = look(r), x = Math.round(r.x + lo), y = Math.round(r.y);
        const board = s.sub === 'pgs' || s.sub === 'bx';
        if (r.ld > 0) puff(g, x, y, r.ld / 0.35, '#ffffff');
        if (r.sp > 0.15 && r.z <= 0 && r.cr <= 0) spray(g, s, r, x, y, r.a, Math.min(1.4, r.sp), ['#ffffff', '#dceaff', '#ffffff']);
        skier(g, x, y, r.a, lk, { z: r.z, cr: r.cr, crd: mog ? 0.9 : 1.6, tk: r.tk, st: r.st, board, ab: mog && r.ab > 0, sc: board ? lk.shirt : PAL.red, bc: lk.shirt, trick: r.z > 0 ? r.tn : '', tp: r.tp });
        if (mog && fr === r && r.fin < 0 && r.z <= 0 && r.b < C.rows.length) {
          const dtm = (C.rows[r.b] - r.y) / Math.max(60, r.v);
          if (dtm > -0.19 && dtm < 0.6) { const rr = 4 + Math.max(0, dtm) * 26, c = Math.abs(dtm) < 0.085 ? PAL.cyan : Math.abs(dtm) < 0.19 ? PAL.green : 'rgba(255,255,255,0.7)'; g.circleO(x, y - 6, rr, c); }
        }
        label(g, entTag(s, r), x, y - 26 - Math.round(r.z * 0.2), entCol(s, r));
        if (r.df && r.z <= 0) for (let i = 0; i < 3; i++) g.px(x - 4 + i * 4, y - 16 - M.wrap(g.t * 40 + i * 5, 10), '#a8d8ff');
      } else if (t === 7) {
        const gp2 = o[2], e = s.ents[s.gh.i], lk = OG.lookOf(e);
        g.alpha(0.42);
        skier(g, Math.round(gp2.x), Math.round(gp2.y), gp2.a, lk, { tk: 1, sc: '#ffffff' });
        g.alpha(1);
        if (!fr || Math.abs(gp2.y - fr.y) > 22 || Math.abs(gp2.x - fr.x - laneOff(s, fr)) > 26) label(g, '1위 ' + e.country, Math.round(gp2.x), Math.round(gp2.y) - 26, '#c0cbdc');
      } else if (t === 8) { // judges' tower
        const x = C.w[0] + 34, y = o[0];
        g.rect(x - 2, y - 14, 2, 14, '#5a6988'); g.rect(x + 22, y - 14, 2, 14, '#5a6988');
        g.rect(x - 4, y - 32, 30, 18, '#3a4466'); g.rect(x - 2, y - 28, 26, 7, '#9fd8ff'); g.rect(x - 6, y - 35, 34, 3, PAL.red);
        for (let i = 0; i < 5; i++) g.rect(x + i * 5, y - 26, 2, 3, '#262b44');
        g.text('JUDGES', x + 11, y - 44, '#ffffff', { size: 'xs', align: 'center', outline: PAL.black });
      }
    }
  }
  function drawGate(g, s, G, L, fr) {
    const lo = L * LANE, x0 = Math.round(G.x - G.w / 2 + lo), x1 = Math.round(G.x + G.w / 2 + lo), y = G.y;
    const col = s.sub === 'pgs' ? (L % 2 ? COL.gBlue : PAL.red) : s.sub === 'dh' ? PAL.red : (G.c ? COL.gBlue : PAL.red);
    if (s.sub === 'sl') {
      const kn = s.t >= G.h && s.t - G.h < 0.5;
      for (const px of [x0, x1]) {
        const tilt = kn ? Math.round(Math.sin((s.t - G.h) * 22) * 3 * (1 - (s.t - G.h) * 2)) : 0;
        g.px(px + 1, y, 'rgba(40,60,110,0.35)'); g.px(px + 2, y, 'rgba(40,60,110,0.2)');
        g.line(px, y, px + tilt, y - 10, col, 2);
        g.rect(px + tilt, y - 11, 2, 1, '#ffffff');
      }
    } else {
      for (const ab of [[x0 - 7, x0 - 1], [x1 + 1, x1 + 7]]) {
        const a = ab[0], b = ab[1];
        g.rect(a, y, b - a + 1, 1, 'rgba(60,80,130,0.25)');
        g.rect(a, y - 12, 1, 12, '#3a4466'); g.rect(b, y - 12, 1, 12, '#3a4466');
        const wv = Math.round(Math.sin(g.t * 4 + G.y) * 0.6);
        g.rect(a + 1, y - 11 + wv, b - a - 1, 7, col); g.rect(a + 1, y - 11 + wv, b - a - 1, 1, OG.shade(col, 0.35));
        g.rect(a + 2, y - 8 + wv, b - a - 3, 1, OG.shade(col, -0.25));
      }
    }
    if (fr && !fr.out && fr.fin < 0 && laneOff(s, fr) === lo && s.C.gates[fr.g] === G) chevron(g, Math.round((x0 + x1) / 2), y - 22 + Math.round(Math.sin(g.t * 7) * 2), OG.PCOLORS[(s.ents[fr.i] || {}).pid % 8 || 0]);
  }
  function startHut(g, s, cx, y, hw) {
    g.rect(cx - hw - 6, y - 2, hw * 2 + 12, 3, '#c0cbdc');
    g.rect(cx - 26, y - 22, 52, 18, '#7a4a32'); g.rect(cx - 26, y - 22, 52, 2, '#9c6446');
    g.poly([cx - 31, y - 22, cx + 31, y - 22, cx, y - 34], '#a22633'); g.poly([cx - 31, y - 22, cx, y - 22, cx, y - 34], '#c43a45');
    g.rect(cx - 18, y - 18, 36, 8, '#181425'); g.text('START', cx, y - 18, PAL.yellow, { size: 'xs', align: 'center' });
    for (let x = cx - hw; x < cx + hw; x += 10) { g.rect(x, y - 6, 1, 6, '#5a6988'); }
    g.rect(cx - hw, y - 6, hw * 2, 1, s.t < 0 ? PAL.red : '#5a6988');
  }
  function finishArch(g, cx, hw, y) {
    for (let x = Math.round(cx - hw); x < cx + hw; x += 4) { const odd = Math.floor((x - cx + 1000) / 4) % 2; g.rect(x, y, 4, 2, odd ? '#222034' : '#ffffff'); g.rect(x, y + 2, 4, 2, odd ? '#ffffff' : '#222034'); }
    g.rect(cx - hw - 5, y - 26, 3, 27, '#5a6988'); g.rect(cx + hw + 2, y - 26, 3, 27, '#5a6988');
    g.rect(cx - hw - 5, y - 30, hw * 2 + 10, 11, PAL.red); g.rect(cx - hw - 5, y - 30, hw * 2 + 10, 1, '#ff8a8a'); g.rect(cx - hw - 5, y - 20, hw * 2 + 10, 1, PAL.darkred);
    g.text('FINISH', cx, y - 29, '#ffffff', { size: 'xs', align: 'center' });
  }

  function sceneIce(g, s, X, Y, w, h, fr) {
    const C = s.C, P = SLED[s.sub];
    g.rect(X, Y, w, h, COL.nsnow);
    for (let gy = Math.floor(Y / 10) - 1; gy * 10 < Y + h; gy++) for (let gx = Math.floor(X / 14) - 1; gx * 14 < X + w; gx++) {
      const q = hash(gx, gy, 41); if (q < 0.18) g.rect(gx * 14 + Math.floor(q * 300) % 14, gy * 10 + Math.floor(q * 900) % 10, 3 + Math.floor(q * 40) % 4, 1, COL.nsnow2);
      else if (q > 0.985) g.px(gx * 14 + 3, gy * 10 + 4, '#8fa3c8');
    }
    const y0 = Math.floor(Y / 2) * 2;
    for (let y = y0; y < Y + h; y += 2) {
      const cx = cX(C, y), d = cD(C, y), sec = Math.sqrt(1 + d * d), Wh = P.W * sec, k = cK(C, y);
      g.rect(cx - Wh - 11, y, 11, 2, COL.wallSh); g.rect(cx + Wh, y, 11, 2, COL.wallSh);
      g.rect(cx - Wh - 7, y, 6, 2, COL.wall); g.rect(cx + Wh + 1, y, 6, 2, COL.wall);
      g.rect(cx - Wh - 1, y, 1, 2, '#8da6c9'); g.rect(cx + Wh, y, 1, 2, '#8da6c9');
      g.rect(cx - Wh, y, Wh * 2, 2, COL.ice);
      const bk = clamp(Math.abs(k) * 380, 0, 1);
      if (bk > 0.1) {
        const side = k > 0 ? -1 : 1, bw = Math.round(Wh * 0.85 * bk), bw2 = Math.round(bw * 0.45);
        g.rect(side < 0 ? cx - Wh : cx + Wh - bw, y, bw, 2, COL.bank);
        g.rect(side < 0 ? cx - Wh : cx + Wh - bw2, y, bw2, 2, COL.bank2);
        g.rect(side < 0 ? cx - Wh - 7 : cx + Wh + 1, y, 6, 2, '#ffffff');
      }
      if (hash(0, y >> 1, 3) < 0.22) g.rect(Math.round(cx - Wh + hash(1, y >> 1, 3) * (Wh * 2 - 6)), y, 6, 1, COL.iceHi);
      if (M.wrap(y, 40) < 2 && y > 0 && y < C.len) { g.rect(cx - Wh - 7, y, 6, 1, '#4f86dc'); g.rect(cx + Wh + 1, y, 6, 1, '#4f86dc'); }
    }
    // start / load markings
    for (const ly of [0, C.pl]) if (ly > Y - 4 && ly < Y + h + 4) { const cx = cX(C, ly), Wh = P.W; g.rect(cx - Wh, ly, Wh * 2, 2, ly ? PAL.red : '#2a64c8'); }
    if (C.len > Y - 10 && C.len < Y + h + 10) { const cx = cX(C, C.len); for (let x = cx - P.W; x < cx + P.W; x += 4) { const odd = Math.floor((x - cx + 1000) / 4) % 2; g.rect(x, C.len, 4, 2, odd ? '#222034' : '#fff'); g.rect(x, C.len + 2, 4, 2, odd ? '#fff' : '#222034'); } }
    // ideal line helper for the focused racer
    if (fr && fr.ph === 1 && fr.fin < 0) {
      g.alpha(0.5);
      for (let y = Math.max(y0, Math.ceil(fr.y / 6) * 6 + 12); y < Y + h; y += 6) {
        const d = cD(C, y), sec = Math.sqrt(1 + d * d), u = uStar(P, fr.v, cK(C, y));
        g.rect(Math.round(cX(C, y) + u * sec), y, 2, 2, '#2ce8f5');
      }
      g.alpha(1);
    }
    // light pools
    for (let j = Math.floor((Y - 80) / 260); j * 260 < Y + h + 80; j++) {
      const ly = j * 260; if (ly < -200) continue;
      const side = j % 2 ? 1 : -1, cx = cX(C, ly);
      g.alpha(0.055); g.ellipse(cx + side * 10, ly, 64, 36, '#ffe9a8'); g.ellipse(cx + side * 14, ly, 40, 22, '#ffe9a8'); g.ellipse(cx + side * 16, ly, 20, 11, '#ffe9a8'); g.alpha(1);
    }
    const O = [];
    for (let cy = Math.floor((Y - 6) / 18); cy * 18 < Y + h + 34; cy++) for (let ci = Math.floor((X - 12) / 20); ci * 20 < X + w + 12; ci++) {
      const q = hash(ci, cy, 15), tx = ci * 20 + Math.floor(q * 97) % 14, ty = cy * 18 + Math.floor(q * 53) % 12;
      const dd = Math.abs(tx - cX(C, ty)) - P.W * 1.4;
      if (dd < 22 || hash(ci, cy, 16) > clamp((dd - 16) / 70, 0.08, 0.5)) continue;
      O.push([ty, 0, tx, q]);
    }
    for (let j = Math.floor((Y - 40) / 260); j * 260 < Y + h + 60; j++) {
      const ly = j * 260; if (ly < -200) continue;
      const side = j % 2 ? 1 : -1, cx = cX(C, ly), d = cD(C, ly), Wh = P.W * Math.sqrt(1 + d * d);
      O.push([ly, 1, cx + side * (Wh + 20), side]);
    }
    C.cv.forEach((cv, i) => {
      if (cv[0] > Y + h + 20 || cv[0] + 120 < Y - 20) return;
      const side = -cv[3];
      O.push([cv[0], 2, cv]);
      if (i % 2 === 0) for (let y = cv[0]; y < cv[0] + 110; y += 6) for (let j = 0; j < 3; j++) {
        const d = cD(C, y), Wh = P.W * Math.sqrt(1 + d * d), q = hash(y, j, 23);
        if (q < 0.78) O.push([y + j, 3, cX(C, y) + side * (Wh + 16 + j * 5), q]);
      }
    });
    O.push([0, 4]); O.push([C.len, 5]);
    for (const r of s.R) O.push([r.y, 6, r]);
    const gp = ghostPos(s);
    if (gp) O.push([gp.y, 7, gp]);
    O.sort((p, q) => p[0] - q[0]);
    for (const o of O) {
      const t = o[1];
      if (t === 0) pine(g, o[2], o[0], 0.8 + o[3] * 0.6, true);
      else if (t === 1) {
        const x = o[2], y = o[0];
        g.rect(x, y - 30, 2, 30, '#5a6988'); g.rect(x - 4, y - 33, 10, 3, '#3a4466'); g.rect(x - 3, y - 31, 8, 1, '#fff6c0');
        g.alpha(0.25); g.circle(x + 1, y - 31, 6, '#fff6c0'); g.alpha(1);
      } else if (t === 2) {
        const cv = o[2], y = cv[0], d = cD(C, y), Wh = P.W * Math.sqrt(1 + d * d), x = cX(C, y) - cv[3] * (Wh + 4);
        g.rect(x - 8, y - 5, 16, 9, '#181425'); g.text('C' + cv[2], x, y - 5, PAL.yellow, { size: 'xs', align: 'center' });
      } else if (t === 3) fan(g, o[2], o[0], o[3], g.t);
      else if (t === 4) {
        const cx = cX(C, 0);
        g.rect(cx - 40, -40, 80, 26, '#3a4466'); g.rect(cx - 40, -40, 80, 3, '#5a6988');
        g.rect(cx - 30, -34, 60, 9, '#181425'); g.text('START', cx, -34, PAL.yellow, { size: 'xs', align: 'center' });
        for (let i = 0; i < 6; i++) g.rect(cx - 34 + i * 12, -22, 6, 4, i % 2 ? '#fee761' : '#ffd23f');
      } else if (t === 5) finishArch(g, cX(C, C.len), P.W + 6, C.len);
      else if (t === 6) {
        const r = o[2], lk = lookOf(s, r), d = cD(C, r.y);
        const head = r.ph === 1 ? Math.atan2(d, 1) : 0;
        const yaw = clamp(r.uv * 0.012, -0.25, 0.25);
        const x = Math.round(r.x), y = Math.round(r.y);
        sledSprite(g, s, r, x, y, head - yaw, lk, false);
        if (r.sk > 0) for (let i = 0; i < 5; i++) { const q = hash(r.k, i, Math.floor(g.t * 30)); g.px(x + sgn(r.u) * (6 + q * 4), y - 4 + i * 2, i % 2 ? PAL.yellow : '#ffffff'); }
        label(g, entTag(s, r), x, y - 18, entCol(s, r));
      } else if (t === 7) {
        const gp2 = o[2], e = s.ents[s.gh.i];
        g.alpha(0.4); sledSprite(g, s, null, Math.round(gp2.x), Math.round(gp2.y), gp2.a, OG.lookOf(e), true); g.alpha(1);
        if (!fr || Math.abs(gp2.y - fr.y) > 22 || Math.abs(gp2.x - fr.x - laneOff(s, fr)) > 26) label(g, '1위 ' + e.country, Math.round(gp2.x), Math.round(gp2.y) - 18, '#c0cbdc');
      }
    }
    for (let i = 0; i < Math.round(w * h / 900); i++) { // light snowfall
      const fx = X + M.wrap(hash(i, 1, 9) * w + Math.sin(g.t + i) * 6, w), fy = Y + M.wrap(hash(i, 2, 9) * h + g.t * (18 + hash(i, 3, 9) * 22), h);
      g.px(fx, fy, i % 4 ? 'rgba(255,255,255,0.7)' : '#ffffff');
    }
  }

  function sceneRiver(g, s, X, Y, w, h, fr) {
    const C = s.C;
    g.rect(X, Y, w, h, COL.grass);
    for (let gy = Math.floor(Y / 8) - 1; gy * 8 < Y + h; gy++) for (let gx = Math.floor(X / 10) - 1; gx * 10 < X + w; gx++) {
      const q = hash(gx, gy, 61);
      if (q < 0.25) g.rect(gx * 10 + Math.floor(q * 400) % 10, gy * 8 + Math.floor(q * 800) % 8, 2, 1, q < 0.12 ? COL.grass2 : COL.grass3);
      else if (q > 0.993) g.px(gx * 10 + 4, gy * 8 + 3, q > 0.997 ? PAL.yellow : '#ffffff');
    }
    const y0 = Math.floor(Y / 2) * 2;
    for (let y = y0; y < Y + h; y += 2) {
      const cx = cX(C, y), hw = cW(C, y);
      g.rect(cx - hw - 10, y, 10, 2, COL.stone); g.rect(cx + hw, y, 10, 2, COL.stone);
      g.rect(cx - hw - 10, y, 2, 2, COL.stoneD); g.rect(cx + hw + 8, y, 2, 2, COL.stoneD);
      if (M.wrap(y, 12) < 2) { g.rect(cx - hw - 10, y, 10, 1, COL.stoneD); g.rect(cx + hw, y, 10, 1, COL.stoneD); }
      g.rect(cx - hw, y, hw * 2, 2, COL.water);
      g.rect(cx - hw * 0.5, y, hw, 2, COL.deep);
      g.rect(cx - hw, y, 3, 2, '#bfe3f5'); g.rect(cx + hw - 3, y, 3, 2, '#bfe3f5');
    }
    // eddies (slack water swirl)
    for (const e of C.ed) {
      if (e[1] < Y - e[2] || e[1] > Y + h + e[2]) continue;
      g.alpha(0.18); g.circle(e[0], e[1], e[2] * 0.75, '#3a9be0'); g.alpha(1);
      for (let i = 0; i < 10; i++) { const a = -g.t * 1.6 + i * 0.6, rr = e[2] * (0.25 + (i % 3) * 0.2); g.px(e[0] + Math.cos(a) * rr, e[1] + Math.sin(a) * rr * 0.7, 'rgba(255,255,255,0.55)'); }
    }
    // flowing foam streaks
    for (let c = -5; c <= 5; c++) {
      const prof = 1 - 0.55 * (c / 5.5) * (c / 5.5), sp = C.cur * prof * 0.95, off = g.t * sp;
      const n0 = Math.floor((Y - 12 - off) / 14), n1 = Math.ceil((Y + h + 12 - off) / 14);
      for (let n = n0; n <= n1; n++) {
        const q = hash(n, c + 20, 71);
        if (q > 0.5) continue;
        const y = n * 14 + off + Math.floor(q * 20) % 7;
        const cx = cX(C, y), hw = cW(C, y), x = cx + (c / 5.5) * hw * 0.9 + (q - 0.25) * 10;
        const fw = 2 + Math.floor(q * 9) % 3;
        if (q < 0.16) { g.rect(Math.round(x), Math.round(y), fw, 1, '#ffffff'); g.px(Math.round(x) + 1, Math.round(y) + 1, 'rgba(255,255,255,0.6)'); }
        else { g.px(Math.round(x) - 1, Math.round(y) - 1, 'rgba(230,248,255,0.55)'); g.rect(Math.round(x), Math.round(y), fw, 1, 'rgba(230,248,255,0.5)'); g.px(Math.round(x) + fw, Math.round(y) - 1, 'rgba(230,248,255,0.55)'); }
      }
    }
    // rapids (standing waves)
    for (const ry of C.rp) {
      if (ry < Y - 12 || ry > Y + h + 12) continue;
      const cx = cX(C, ry), hw = cW(C, ry);
      for (let x = Math.round(cx - hw + 2); x < cx + hw - 2; x += 2) {
        const yy = ry + Math.round(Math.sin(x * 0.35 + g.t * 7) * 1.5);
        g.rect(x, yy, 2, 2, '#ffffff'); if (hash(x, ry, Math.floor(g.t * 8)) < 0.4) g.px(x, yy + 3, '#d9f2ff');
        g.px(x + 1, yy - 2 - Math.round(hash(x, 5, Math.floor(g.t * 6)) * 2), 'rgba(255,255,255,0.7)');
      }
    }
    // rocks
    for (const k of C.rk) {
      if (k[1] < Y - 14 || k[1] > Y + h + 14) continue;
      const x = k[0], y = k[1], rr = k[2];
      for (let i = 0; i < 9; i++) { const a = Math.PI + i / 8 * Math.PI + Math.sin(g.t * 5 + i) * 0.1; g.px(x + Math.cos(a) * (rr + 2), y + Math.sin(a) * (rr + 2) * 0.8, '#ffffff'); }
      g.ellipse(x + 1, y + 1, rr, rr * 0.8, '#3a4466'); g.ellipse(x, y, rr, rr * 0.8, '#8b9bb4'); g.ellipse(x - rr * 0.3, y - rr * 0.3, rr * 0.5, rr * 0.35, '#c0cbdc');
      for (let i = 0; i < 4; i++) g.px(x - 3 + i * 2, y + rr + 2 + M.wrap(g.t * 20 + i * 3, 8), 'rgba(255,255,255,0.6)');
    }
    // start pontoon & finish line
    if (Y < -60) { const cx = cX(C, -96), hw = cW(C, -96); g.rect(cx - hw - 6, -100, hw * 0.7, 10, '#9c6446'); for (let x = cx - hw - 6; x < cx - hw * 0.3; x += 5) g.rect(x, -100, 1, 10, '#733e39'); }
    if (C.len > Y - 10 && C.len < Y + h + 10) { const cx = cX(C, C.len), hw = cW(C, C.len); g.alpha(0.6); for (let x = Math.round(cx - hw); x < cx + hw; x += 4) g.rect(x, C.len, 2, 1, '#ffffff'); g.alpha(1); }
    const O = [];
    for (let cy = Math.floor((Y - 10) / 22); cy * 22 < Y + h + 20; cy++) for (let ci = Math.floor((X - 16) / 24); ci * 24 < X + w + 16; ci++) {
      const q = hash(ci, cy, 25), tx = ci * 24 + Math.floor(q * 97) % 16, ty = cy * 22 + Math.floor(q * 53) % 14;
      const dd = Math.abs(tx - cX(C, ty)) - cW(C, ty);
      if (dd < 26 || hash(ci, cy, 26) > clamp((dd - 20) / 60, 0.1, 0.65)) continue;
      O.push([ty, 0, tx, q]);
    }
    for (const sp of C.spx) {
      const a = Math.max(sp[0], Math.floor(Y / 6) * 6 - 6), b = Math.min(sp[1], Y + h + 12);
      for (let y = a; y < b; y += 6) { const cx = cX(C, y), hw = cW(C, y); for (const side of [-1, 1]) for (let j = 0; j < 2; j++) { const q = hash(y, j + (side > 0 ? 5 : 0), 27); if (q < 0.7) O.push([y + j, 1, cx + side * (hw + 14 + j * 5), q]); } }
    }
    C.gates.forEach((G, j) => { if (G.y > Y - 10 && G.y < Y + h + 30) O.push([G.y, 2, G, j]); });
    if (C.len > Y - 30 && C.len < Y + h + 40) O.push([C.len, 3]);
    for (const r of s.R) O.push([r.y, 6, r]);
    const gp = ghostPos(s);
    if (gp) O.push([gp.y, 7, gp]);
    O.sort((p, q) => p[0] - q[0]);
    for (const o of O) {
      const t = o[1];
      if (t === 0) roundTree(g, o[2], o[0], 6 + o[3] * 5, o[3] < 0.3);
      else if (t === 1) fan(g, o[2], o[0], o[3], g.t);
      else if (t === 2) canoeGate(g, s, o[2], o[3], fr);
      else if (t === 3) { const cx = cX(C, C.len), hw = cW(C, C.len); finishArch(g, cx, hw + 8, C.len); }
      else if (t === 6) {
        const r = o[2], x = Math.round(r.x), y = Math.round(r.y);
        if (r.sp > 0.3) for (let i = 0; i < 4; i++) { const q = hash(r.k, i, Math.floor(g.t * 20)); g.px(x - Math.sin(r.a) * (8 + q * 6) + (q - 0.5) * 6, y - Math.cos(r.a) * (8 + q * 6), '#ffffff'); }
        kayak(g, r, x, y, r.a, lookOf(s, r), false);
        label(g, entTag(s, r), x, y - 16, entCol(s, r));
      } else if (t === 7) {
        const gp2 = o[2], e = s.ents[s.gh.i];
        g.alpha(0.4); kayak(g, null, Math.round(gp2.x), Math.round(gp2.y), gp2.a, OG.lookOf(e), true); g.alpha(1);
        if (!fr || Math.abs(gp2.y - fr.y) > 22 || Math.abs(gp2.x - fr.x - laneOff(s, fr)) > 26) label(g, '1위 ' + e.country, Math.round(gp2.x), Math.round(gp2.y) - 16, '#c0cbdc');
      }
    }
  }
  function canoeGate(g, s, G, j, fr) {
    const C = s.C, y = G.y, cx = cX(C, y), hw = cW(C, y);
    const x0 = Math.round(G.x - G.w / 2), x1 = Math.round(G.x + G.w / 2), wy = y - 16;
    g.line(cx - hw - 10, wy - 2, cx + hw + 10, wy - 2, 'rgba(24,20,37,0.6)', 1);
    const col = G.up ? PAL.red : PAL.green;
    const st = fr && fr.gs ? fr.gs[j] : 0;
    const kn = s.t >= G.h && s.t - G.h < 0.5;
    for (const px of [x0, x1]) {
      const sw = kn ? Math.round(Math.sin((s.t - G.h) * 25) * 2) : Math.round(Math.sin(g.t * 2 + px) * 0.6);
      g.line(px, wy - 2, px + sw, wy, '#3a4466', 1);
      for (let k = 0; k < 7; k++) g.rect(px - 1 + sw, wy + k * 2, 2, 2, k % 2 ? '#ffffff' : col);
      g.px(px + sw, y, 'rgba(255,255,255,0.8)');
    }
    const mx = Math.round((x0 + x1) / 2);
    g.rect(mx - 5, wy - 9, 11, 7, st === 3 ? PAL.red : st ? '#c0cbdc' : '#ffffff');
    g.text(String(G.n), mx, wy - 9, '#181425', { size: 'xs', align: 'center' });
    if (G.up) { g.px(mx - 1, wy - 11, PAL.red); g.px(mx, wy - 12, PAL.red); g.px(mx + 1, wy - 11, PAL.red); }
    if (fr && !fr.out && fr.fin < 0 && fr.g === j) {
      const by = wy - 18 + Math.round(Math.sin(g.t * 7) * 2), c = OG.PCOLORS[(s.ents[fr.i] || {}).pid % 8 || 0];
      if (G.up) { g.text('▲', mx, by - 4, c, { size: 'xs', align: 'center', outline: PAL.black }); }
      else chevron(g, mx, by, c);
    }
  }

  function sceneTrail(g, s, X, Y, w, h, fr) {
    const C = s.C;
    g.rect(X, Y, w, h, COL.forest);
    for (let gy = Math.floor(Y / 8) - 1; gy * 8 < Y + h; gy++) for (let gx = Math.floor(X / 9) - 1; gx * 9 < X + w; gx++) {
      const q = hash(gx, gy, 81);
      if (q < 0.3) g.rect(gx * 9 + Math.floor(q * 400) % 9, gy * 8 + Math.floor(q * 800) % 8, 2, 1, q < 0.12 ? COL.forest2 : q < 0.24 ? COL.forest3 : '#7a6a3a');
      else if (q > 0.992) g.px(gx * 9 + 4, gy * 8 + 3, q > 0.996 ? '#f6757a' : '#fee761');
    }
    const y0 = Math.floor(Y / 2) * 2;
    for (let y = y0; y < Y + h; y += 2) {
      const cx = cX(C, y), hw = cW(C, y), sl = cS(C, y);
      const base = sl < -0.2 ? '#7f5133' : sl > 0.5 ? '#a06b45' : COL.dirt;
      g.rect(cx - hw - 3, y, hw * 2 + 6, 2, '#5b4a2a');
      g.rect(cx - hw, y, hw * 2, 2, base);
      g.rect(cx - hw * 0.35, y, hw * 0.7, 2, sl < -0.2 ? '#8c5b39' : COL.dirt2);
      if (sl < -0.2 && M.wrap(y, 10) < 2) g.rect(cx - hw, y, hw * 2, 1, '#6f4529');
      if (sl > 0.5 && hash(3, y >> 1, 9) < 0.3) g.rect(cx - hw + Math.floor(hash(4, y >> 1, 9) * hw * 2), y, 1, 4, '#b98256');
      if (hash(5, y >> 1, 4) < 0.2) g.px(cx - hw + Math.floor(hash(6, y >> 1, 4) * hw * 2), y, '#c0cbdc');
    }
    // tape along climbs & finish
    for (const sp of C.spx) {
      const a = Math.max(sp[0], y0), b = Math.min(sp[1], Y + h);
      for (let y = a; y < b; y += 2) { const cx = cX(C, y), hw = cW(C, y), c = M.wrap(y, 8) < 4 ? PAL.red : '#ffffff'; g.rect(cx - hw - 5, y, 1, 2, c); g.rect(cx + hw + 4, y, 1, 2, c); }
    }
    // obstacles
    for (const o of C.ob) {
      if (o.y < Y - 30 || o.y > Y + h + 30) continue;
      const cx = cX(C, o.y), hw = cW(C, o.y);
      if (o.t === 'root') { for (let x = Math.round(cx - hw - 4); x < cx + hw + 4; x++) { const yy = o.y + Math.round(Math.sin(x * 0.5) * 1.5); g.rect(x, yy, 1, 2, '#4a2c1c'); if (x % 5 === 0) g.px(x, yy - 1, '#6b4128'); } }
      else if (o.t === 'log') { g.rect(cx - hw - 6, o.y - 3, hw * 2 + 12, 6, '#733e39'); g.rect(cx - hw - 6, o.y - 3, hw * 2 + 12, 2, '#9c5a40'); g.circle(cx - hw - 6, o.y, 3, '#c28569'); g.circle(cx + hw + 6, o.y, 3, '#c28569'); g.px(cx + hw + 6, o.y, '#733e39'); }
      else if (o.t === 'rock') { const x = cx + o.x; g.ellipse(x + 1, o.y + 1, o.r + 1, o.r * 0.8, '#3a3a44'); g.ellipse(x, o.y, o.r, o.r * 0.8, '#8b9bb4'); g.ellipse(x - 1, o.y - 1, o.r * 0.5, o.r * 0.35, '#c0cbdc'); }
      else if (o.t === 'mud') { g.ellipse(cx, o.y, hw * 0.95, o.l * 0.45, '#5a3a24'); g.ellipse(cx - 1, o.y - 1, hw * 0.75, o.l * 0.34, '#6e4a2e'); g.rect(cx - 5, o.y - 6, 4, 1, '#9aa7ba'); g.rect(cx + 2, o.y + 4, 3, 1, '#9aa7ba'); g.px(cx - hw * 0.5, o.y + 2, '#3e2618'); }
    }
    if (C.len > Y - 30 && C.len < Y + h + 40) finishArch(g, cX(C, C.len), cW(C, C.len) + 4, C.len);
    if (Y < 10) { const cx = cX(C, 0), hw = cW(C, 0); g.rect(cx - hw, 0, hw * 2, 2, '#ffffff'); }
    // zone signs
    const O = [];
    for (const z of C.zn) if (z[2] && z[0] > Y - 10 && z[0] < Y + h + 30) O.push([z[0], 2, z]);
    for (const sp of C.spx) {
      const a = Math.max(sp[0], Math.floor(Y / 7) * 7 - 7), b = Math.min(sp[1], Y + h + 12);
      for (let y = a; y < b; y += 7) { const cx = cX(C, y), hw = cW(C, y); for (const side of [-1, 1]) { const q = hash(y, side + 3, 29); if (q < 0.6) O.push([y, 1, cx + side * (hw + 10 + Math.floor(q * 6)), q]); } }
    }
    for (const r of s.R) O.push([r.y, 6, r]);
    const gp = ghostPos(s);
    if (gp) O.push([gp.y, 7, gp]);
    O.sort((p, q) => p[0] - q[0]);
    for (const o of O) {
      const t = o[1];
      if (t === 1) fan(g, o[2], o[0], o[3], g.t);
      else if (t === 2) {
        const z = o[2], cx = cX(C, z[0]), hw = cW(C, z[0]), x = cx + hw + 10, y = z[0];
        g.rect(x, y - 14, 1, 14, '#5b3a2e'); g.rect(x - 9, y - 22, 20, 9, z[2] < 0 ? PAL.orange : PAL.blue);
        g.text(z[2] < 0 ? '오르막' : '내리막', x + 1, y - 22, '#ffffff', { size: 'xs', align: 'center' });
      } else if (t === 6) {
        const r = o[2], x = Math.round(r.x), y = Math.round(r.y), lk = lookOf(s, r);
        if (r.cr > 0) { puff(g, x, y, clamp(r.cr / 1.3, 0, 1), '#b98256'); g.line(x - 6, y - 2, x + 6, y + 3, lk.shirt, 3); g.circle(x + 7, y + 3, 2, helmetOf(lk)); g.line(x - 8, y + 6, x + 2, y + 8, '#181425', 2); }
        else {
          if (r.v > 200 && r.z <= 0) for (let i = 0; i < 3; i++) { const q = hash(r.k, i, Math.floor(g.t * 25)); g.px(x - Math.sin(r.a) * (9 + q * 6) + (q - 0.5) * 4, y - Math.cos(r.a) * (9 + q * 6), '#b98256'); }
          if (r.mud > 0) for (let i = 0; i < 4; i++) { const q = hash(r.k, i + 9, Math.floor(g.t * 25)); g.px(x + (q - 0.5) * 12, y - 4 - q * 6, '#4a3020'); }
          if (r.ld > 0) puff(g, x, y, r.ld / 0.25, '#b98256');
          bike(g, r, x, y, r.a, lk, false);
        }
        label(g, entTag(s, r), x, y - 18, entCol(s, r));
      } else if (t === 7) {
        const gp2 = o[2], e = s.ents[s.gh.i];
        g.alpha(0.4); bike(g, null, Math.round(gp2.x), Math.round(gp2.y), gp2.a, OG.lookOf(e), true); g.alpha(1);
        if (!fr || Math.abs(gp2.y - fr.y) > 22 || Math.abs(gp2.x - fr.x - laneOff(s, fr)) > 26) label(g, '1위 ' + e.country, Math.round(gp2.x), Math.round(gp2.y) - 18, '#c0cbdc');
      }
    }
    // canopy over everything (trees beside the trail)
    for (let cy = Math.floor((Y - 20) / 26); cy * 26 < Y + h + 24; cy++) for (let ci = Math.floor((X - 24) / 26); ci * 26 < X + w + 24; ci++) {
      const q = hash(ci, cy, 35), tx = ci * 26 + Math.floor(q * 97) % 16, ty = cy * 26 + Math.floor(q * 53) % 16;
      const dd = Math.abs(tx - cX(C, ty)) - cW(C, ty);
      if (dd < 12 || hash(ci, cy, 36) > 0.8) continue;
      roundTree(g, tx, ty, 8 + q * 7, q < 0.5);
    }
  }

  function kartGeom(C) { // per-point normals
    const n = C.p.length / 2, P = C.p, nx = [], ny = [];
    for (let i = 0; i < n; i++) {
      const a = M.wrap(i - 1, n), b = (i + 1) % n;
      const dx = P[2 * b] - P[2 * a], dy = P[2 * b + 1] - P[2 * a + 1], l = Math.hypot(dx, dy) || 1;
      nx.push(-dy / l); ny.push(dx / l);
    }
    return { n, P, nx, ny };
  }
  function sceneKart(g, s, X, Y, w, h, fr) {
    const C = s.C, K = kartGeom(C), P = K.P, n = K.n, hw = C.hw;
    g.rect(X, Y, w, h, COL.kbg);
    for (let gx = Math.floor(X / 32) * 32; gx < X + w; gx += 32) g.rect(gx, Y, 1, h, COL.kgrid);
    for (let gy = Math.floor(Y / 32) * 32; gy < Y + h; gy += 32) g.rect(X, gy, w, 1, COL.kgrid);
    // city blocks
    for (let cy = Math.floor(Y / 64) - 1; cy * 64 < Y + h + 64; cy++) for (let ci = Math.floor(X / 64) - 1; ci * 64 < X + w + 64; ci++) {
      const q = hash(ci, cy, 91); if (q > 0.55) continue;
      const bx = ci * 64 + 6, by = cy * 64 + 6, bw = 30 + Math.floor(q * 40) % 22, bh = 26 + Math.floor(q * 70) % 24;
      const N = kNear(C, bx + bw / 2, by + bh / 2, 0, true);
      if (Math.abs(N.off) < hw + 30 + Math.max(bw, bh) * 0.7) continue;
      const nc = [COL.nC, COL.nM, COL.nY, '#9d4dff'][Math.floor(q * 40) % 4];
      g.rect(bx + 4, by + 4, bw, bh, '#05040c');
      g.rect(bx, by, bw, bh, '#1a1630'); g.rectO(bx, by, bw, bh, nc);
      for (let wy = by + 4; wy < by + bh - 3; wy += 5) for (let wx = bx + 4; wx < bx + bw - 3; wx += 5) if (hash(wx, wy, 3) < 0.45) g.rect(wx, wy, 2, 2, hash(wx, wy, 4) < 0.5 ? '#fee761' : '#2a2448');
    }
    const vis = i => { const x = P[2 * i], y = P[2 * i + 1]; return x > X - 90 && x < X + w + 90 && y > Y - 90 && y < Y + h + 90; };
    const quad = (i, j, e1, e2, c) => g.poly([P[2 * i] + K.nx[i] * e1, P[2 * i + 1] + K.ny[i] * e1, P[2 * j] + K.nx[j] * e1, P[2 * j + 1] + K.ny[j] * e1, P[2 * j] + K.nx[j] * e2, P[2 * j + 1] + K.ny[j] * e2, P[2 * i] + K.nx[i] * e2, P[2 * i + 1] + K.ny[i] * e2], c);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (!vis(i) && !vis(j)) continue; quad(i, j, hw + 12, -hw - 12, '#2a1450'); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n; if (!vis(i) && !vis(j)) continue;
      const c1 = i % 2 ? COL.nC : '#ffffff', c2 = i % 2 ? COL.nM : '#ffffff';
      quad(i, j, hw + 6, hw - 1, c1); quad(i, j, -hw + 1, -hw - 6, c2);
      quad(i, j, hw, -hw, i % 2 ? COL.asph : COL.asph2);
    }
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n; if (!vis(i) || i % 2) continue;
      g.line(P[2 * i], P[2 * i + 1], lerp(P[2 * i], P[2 * j], 0.6), lerp(P[2 * i + 1], P[2 * j + 1], 0.6), '#4a4270', 1);
    }
    // start / finish checker
    {
      const tx = P[2], ty = P[3], ax = P[0], ay = P[1], l = Math.hypot(tx - ax, ty - ay) || 1, ux = (tx - ax) / l, uy = (ty - ay) / l;
      for (let k = -hw; k < hw; k += 4) for (let m = 0; m < 2; m++) {
        const px = ax - uy * k + ux * m * 4, py = ay + ux * k + uy * m * 4;
        g.rect(px - 2, py - 2, 4, 4, (Math.floor((k + 100) / 4) + m) % 2 ? '#ffffff' : '#181425');
      }
    }
    for (const p of C.pads) {
      const F = FR(p[0], p[1], Math.cos(p[2]), Math.sin(p[2]));
      polyF(g, F, [-10, -8, 10, -8, 10, 8, -10, 8], '#3a2f00');
      for (let k = 0; k < 3; k++) { const o = -6 + k * 6 + M.wrap(g.t * 18, 6) - 3, c = k === 1 ? COL.nY : PAL.orange; lineF(g, F, o - 3, -5, o + 2, 0, c, 2); lineF(g, F, o + 2, 0, o - 3, 5, c, 2); }
    }
    for (const b of C.items) {
      const bob = Math.round(Math.sin(g.t * 4 + b[0]) * 1.5), c = ['#ff3fa4', '#2ce8f5', '#fee761', '#63c74d'][Math.floor(g.t * 6 + b[0]) % 4];
      g.rect(b[0] - 4, b[1] - 4 + bob, 9, 9, '#181425'); g.rect(b[0] - 3, b[1] - 3 + bob, 7, 7, c);
      g.text('?', b[0] + 1, b[1] - 4 + bob, '#ffffff', { size: 'xs', align: 'center' });
    }
    const order = s.R.slice().sort((a, b) => a.y - b.y);
    for (const r of order) {
      const x = Math.round(r.x), y = Math.round(r.y) - (r.hp > 0 ? 2 : 0);
      kart(g, r, x, y, r.a, lookOf(s, r));
      label(g, entTag(s, r), x, y - 16, entCol(s, r));
    }
  }

  function sceneSea(g, s, X, Y, w, h, fr) {
    const C = s.C, wf = wind(s);
    g.rect(X, Y, w, h, COL.sea);
    // land (coast of Aichi) to the west
    const coast = y => -760 + Math.sin(y * 0.004) * 60 + Math.sin(y * 0.011) * 22;
    for (let y = Math.floor(Y / 2) * 2; y < Y + h; y += 2) {
      const cxl = coast(y); if (cxl < X) continue;
      g.rect(X, y, cxl - X, 2, '#4a8f3f'); g.rect(cxl - 14, y, 14, 2, COL.sand); g.rect(cxl, y, 4, 2, '#7fc4e8');
    }
    // waves & sparkles
    const bx = -Math.sin(wf) * 1, by = Math.cos(wf) * 1, off = g.t * 14;
    for (let gy = Math.floor(Y / 12) - 1; gy * 12 < Y + h + 12; gy++) for (let gx = Math.floor(X / 18) - 1; gx * 18 < X + w + 18; gx++) {
      const q = hash(gx, gy, 51);
      const x = gx * 18 + Math.floor(q * 300) % 18 + bx * off % 18, y = gy * 12 + Math.floor(q * 700) % 12 + by * off % 12;
      if (x < coast(y) + 4) continue;
      if (q < 0.42) { g.rect(x, y + 1, 6, 1, COL.sea3); g.rect(x, y, 5, 1, '#3a8ccd'); g.rect(x + 1, y - 1, 2, 1, '#5aa8e2'); }
      if (q > 0.9 && Math.sin(g.t * 4 + q * 300) > 0.6) g.px(x + 2, y - 2, '#ffffff');
    }
    // wind ripples (short dashes drifting downwind)
    g.alpha(0.12);
    for (let i = 0; i < Math.round(w * h / 6000); i++) {
      const len = 6, ox = hash(i, 1, 52), oy = hash(i, 2, 52);
      const px = X + M.wrap(ox * w + bx * g.t * 60, w), py = Y + M.wrap(oy * h + by * g.t * 60, h);
      g.line(px, py, px - bx * len, py - by * len, '#ffffff', 1);
    }
    g.alpha(1);
    // start/finish line
    if (Y < 20 && Y + h > -20) { for (let x = C.fl[0]; x < C.fl[1]; x += 8) g.rect(x, 0, 4, 1, 'rgba(255,255,255,0.65)'); }
    // pin buoy & committee boat
    const buoy = (x, y, c) => { const b = Math.round(Math.sin(g.t * 3 + x) * 1); g.circleO(x, y + 1, 7, 'rgba(255,255,255,0.35)'); g.circle(x, y + b, 5, OG.shade(c, -0.3)); g.circle(x, y - 1 + b, 4, c); g.rect(x - 4, y + b, 9, 1, '#ffffff'); g.px(x - 1, y - 3 + b, '#ffffff'); };
    buoy(C.pin[0], C.pin[1], PAL.yellow);
    {
      const x = C.cb[0], y = C.cb[1];
      g.poly([x - 16, y - 6, x + 12, y - 6, x + 18, y, x + 12, y + 6, x - 16, y + 6], '#f2f4f8');
      g.rect(x - 8, y - 4, 12, 8, '#c0cbdc'); g.rect(x - 6, y - 3, 8, 6, '#3a4466');
      g.rect(x - 14, y - 16, 1, 12, '#5a6988'); g.rect(x - 13, y - 16, 7, 5, PAL.orange); g.text('RC', x - 10, y - 26, '#ffffff', { size: 'xs', align: 'center', outline: PAL.black });
    }
    const nm = fr ? fr.mk : -1;
    C.m.forEach((m, i) => {
      if (m[0] < X - 70 || m[0] > X + w + 70 || m[1] < Y - 70 || m[1] > Y + h + 70) return;
      if (i === nm) { g.alpha(0.5); for (let k = 0; k < 40; k++) { const a = k / 40 * TAU + g.t * 0.3; if (k % 2) g.px(m[0] + Math.cos(a) * 56, m[1] + Math.sin(a) * 56, '#ffffff'); } g.alpha(1); }
      buoy(m[0], m[1], PAL.orange);
      label(g, 'M' + (i + 1), m[0], m[1] - 18, i === nm ? PAL.yellow : '#ffffff');
    });
    // no-go zone wedge for the focused boat
    if (fr && fr.fin < 0) {
      g.alpha(0.35);
      for (const sd of [-1, 1]) { const a = wf + sd * 0.62; g.line(fr.x, fr.y, fr.x + Math.sin(a) * 34, fr.y - Math.cos(a) * 34, PAL.red, 1); }
      g.alpha(1);
    }
    const order = s.R.slice().sort((a, b) => a.y - b.y);
    for (const r of order) {
      const x = Math.round(r.x), y = Math.round(r.y + Math.sin(g.t * 3 + r.k) * 0.6);
      boat(g, s, r, x, y, r.a, lookOf(s, r), wf);
      label(g, entTag(s, r), x, y - 18, entCol(s, r));
    }
  }
  const SCENE = { ski: sceneSnow, cross: sceneSnow, moguls: sceneSnow, sled: sceneIce, canoe: sceneRiver, mtb: sceneTrail, kart: sceneKart, sail: sceneSea };

  /* -------------------------------- HUD ------------------------------- */
  function hud(g, s, v, r) {
    const x = v[0], y = v[1], w = v[2], h = v[3], e = s.ents[r.i], pc = e.human ? OG.PCOLORS[e.pid % 8] : PAL.grey;
    const narrow = w < 150, kind = s.kind;
    g.rect(x + 2, y + 2, 18, 11, PAL.black); g.rect(x + 3, y + 3, 16, 9, pc);
    g.text(OG.entLabel(e), x + 11, y + 3, '#ffffff', { size: 'xs', align: 'center' });
    g.flag(e.country, x + 23, y + 4, 12, 8);
    if (!narrow) g.text(e.country, x + 38, y + 3, '#ffffff', { size: 'xs', outline: PAL.black });
    const tt = Math.max(0, s.t) * s.sc;
    let main;
    if (r.out) main = r.out === 'dsq' ? '실격' : 'DNF';
    else if (kind === 'moguls') main = r.fin >= 0 ? r.res.toFixed(2) + '점' : OG.fmt.time(tt, 2);
    else main = fmtRes(s, r.fin >= 0 ? r.res : tt + r.pen);
    g.text(main, x + w - 3, y + 2, r.out ? PAL.red : r.fin >= 0 ? PAL.yellow : '#ffffff', { size: 'b', align: 'right', outline: PAL.black });
    let sub = '';
    if (kind === 'ski' || kind === 'cross') sub = Math.round(r.v * SKI[s.sub].kmh) + ' km/h';
    else if (kind === 'sled') sub = r.ph === 0 ? (s.sub === 'luge' ? '패들!' : '푸시!') : Math.round(r.v * SLED[s.sub].kmh) + ' km/h';
    else if (kind === 'mtb') sub = Math.round(r.v * MTB.kmh) + ' km/h';
    else if (kind === 'kart') sub = Math.round(r.v * KART.kmh) + ' km/h';
    else if (kind === 'sail') sub = (r.v * SAIL.kn).toFixed(1) + ' kn';
    else if (kind === 'canoe') sub = '기문 ' + Math.min(r.g, s.C.gates.length) + '/' + s.C.gates.length + (r.pen ? '  +' + r.pen : '');
    else if (kind === 'moguls') sub = r.fin < 0 ? '턴 ' + Math.round(r.tq / Math.max(1, r.b) * 100) + '%' : '';
    if (sub) g.text(sub, x + w - 3, y + 15, kind === 'canoe' && r.pen ? PAL.orange : PAL.lightgrey, { size: 'xs', align: 'right', outline: PAL.black });
    if (r.sdt != null && s.t - r.sdt < 3 && r.fin < 0) g.text('SPLIT ' + (r.sd >= 0 ? '+' : '-') + Math.abs(r.sd).toFixed(2), x + w - 3, y + 25, r.sd >= 0 ? PAL.red : PAL.green, { size: 'xs', align: 'right', outline: PAL.black });
    // head-to-head standings
    if (kind === 'cross' || kind === 'kart' || kind === 'sail' || s.sub === 'pgs') {
      const st = standings(s), pos = st.indexOf(r.k) + 1;
      g.text(pos + '/' + s.R.length, x + 3, y + 15, pos === 1 ? PAL.yellow : '#ffffff', { size: 'l', outline: PAL.black });
      if (kind === 'kart') g.text('LAP ' + clamp(r.lap + 1, 1, s.C.laps) + '/' + s.C.laps, x + 3, y + 32, '#ffffff', { size: 'xs', outline: PAL.black });
      if (kind === 'sail') g.text(r.mk < 2 ? 'M' + (r.mk + 1) + '로' : '결승선으로', x + 3, y + 32, PAL.yellow, { size: 'xs', outline: PAL.black });
    }
    if (kind === 'kart') {
      const ix = x + w - 18, iy = y + 26;
      g.rect(ix, iy, 15, 15, PAL.black); g.rectO(ix, iy, 15, 15, r.it ? PAL.pink : '#3a4466');
      if (r.it) { g.text('B', ix + 8, iy + 3, PAL.orange, { size: 's', align: 'center' }); g.rich('{U}', ix - 13, iy + 3, '#fff'); }
      if (r.dr) g.bar(x + w / 2 - 20, y + h - 30, 40, 5, r.dc / 1.2, r.dc > 1.2 ? PAL.orange : PAL.cyan);
      if (!narrow || h > 200) minimap(g, s, r, x + 4, y + h - 52, 60, 44);
    }
    if (kind === 'sail') sailHud(g, s, r, v);
    if (kind === 'moguls' && r.fin >= 0 && r.sb) {
      const by = y + h / 2 + 6;
      g.panel(x + w / 2 - 50, by, 100, 34);
      g.text('턴 ' + r.sb[0].toFixed(1) + '  에어 ' + r.sb[1].toFixed(1), x + w / 2, by + 5, '#ffffff', { size: 'xs', align: 'center' });
      g.text('속도 ' + r.sb[2].toFixed(1) + '  (' + OG.fmt.time(r.tt, 2) + ')', x + w / 2, by + 17, PAL.lightgrey, { size: 'xs', align: 'center' });
    }
    // progress bar (scrolling courses)
    if (kind !== 'kart' && kind !== 'sail') {
      const bx = x + w - 5, b0 = y + 38, b1 = y + h - 22, L = s.C.len;
      if (b1 - b0 > 30) {
        g.rect(bx - 1, b0 - 1, 4, b1 - b0 + 2, 'rgba(24,20,37,0.55)'); g.rect(bx, b0, 2, b1 - b0, '#5a6988');
        const py = f => Math.round(b0 + clamp(f, 0, 1) * (b1 - b0));
        if (s.C.ck) for (const c of s.C.ck) g.rect(bx - 1, py(c / L), 4, 1, '#c0cbdc');
        const gp = ghostPos(s);
        if (gp) g.rect(bx - 1, py(gp.y / L) - 1, 4, 3, '#c0cbdc');
        for (const o of s.R) if (o !== r && (o.h || s.kind === 'cross' || s.sub === 'pgs')) g.rect(bx - 1, py(o.y / L), 4, 2, entCol(s, o));
        g.rect(bx - 2, py(r.y / L) - 1, 6, 3, pc);
        g.rect(bx - 1, b1, 4, 2, PAL.yellow);
      }
    }
    // finish / out banners
    if (r.fin >= 0 || r.out) {
      const cy = y + Math.round(h * 0.38);
      if (r.out) g.text(r.out === 'dsq' ? '실격' : 'DNF', x + w / 2, cy, PAL.red, { size: narrow ? 'l' : 'xl', align: 'center', outline: PAL.black });
      else {
        let rk;
        if (kind === 'cross' || kind === 'kart' || kind === 'sail') rk = standings(s).indexOf(r.k) + 1;
        else rk = liveRank(s, r);
        g.text(kind === 'moguls' ? r.res.toFixed(2) + '점' : fmtRes(s, r.res), x + w / 2, cy, PAL.yellow, { size: narrow ? 'l' : 'xl', align: 'center', outline: PAL.black });
        g.text(rk + '위', x + w / 2, cy + (narrow ? 18 : 26), rk <= 3 ? [PAL.medalGold, PAL.medalSilver, PAL.medalBronze][rk - 1] : '#ffffff', { size: narrow ? 'b' : 'l', align: 'center', outline: PAL.black });
      }
    }
  }
  function minimap(g, s, r, x, y, w, h) {
    const C = s.C, P = C.p, n = P.length / 2;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[2 * i]); x1 = Math.max(x1, P[2 * i]); y0 = Math.min(y0, P[2 * i + 1]); y1 = Math.max(y1, P[2 * i + 1]); }
    const k = Math.min((w - 6) / (x1 - x0), (h - 6) / (y1 - y0)), ox = x + w / 2 - (x0 + x1) / 2 * k, oy = y + h / 2 - (y0 + y1) / 2 * k;
    g.rect(x, y, w, h, 'rgba(11,9,25,0.7)'); g.rectO(x, y, w, h, '#3a2a6a');
    for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; g.line(ox + P[2 * i] * k, oy + P[2 * i + 1] * k, ox + P[2 * j] * k, oy + P[2 * j + 1] * k, '#7a6aaa', 1); }
    for (const o of s.R) if (o !== r) g.rect(ox + o.x * k - 1, oy + o.y * k - 1, 2, 2, entCol(s, o));
    g.rect(ox + r.x * k - 1, oy + r.y * k - 1, 3, 3, OG.PCOLORS[s.ents[r.i].pid % 8]);
  }
  function sailHud(g, s, r, v) {
    const x = v[0], y = v[1], w = v[2], h = v[3], C = s.C, wf = wind(s);
    // wind arrow
    const ax = x + w - 14, ay = y + 40;
    g.circle(ax, ay, 9, 'rgba(24,20,37,0.6)');
    const dx = -Math.sin(wf), dy = Math.cos(wf);
    g.line(ax - dx * 7, ay - dy * 7, ax + dx * 6, ay + dy * 6, '#ffffff', 2);
    g.line(ax + dx * 6, ay + dy * 6, ax + dx * 2 - dy * 3, ay + dy * 2 + dx * 3, '#ffffff', 1);
    g.line(ax + dx * 6, ay + dy * 6, ax + dx * 2 + dy * 3, ay + dy * 2 - dx * 3, '#ffffff', 1);
    g.text('바람', ax, ay + 10, PAL.cyan, { size: 'xs', align: 'center', outline: PAL.black });
    // hike stamina
    g.text('하이킹', x + 4, y + h - 21, '#ffffff', { size: 'xs', outline: PAL.black });
    g.bar(x + 4, y + h - 11, Math.min(60, w - 30), 6, r.sta, r.hk > 0 ? PAL.orange : PAL.green);
    // pointer to next target when off-screen
    if (r.fin < 0) {
      const t = r.mk < C.m.length ? C.m[r.mk] : [0, 0];
      const ddx = t[0] - r.x, ddy = t[1] - r.y, d = Math.hypot(ddx, ddy);
      if (d > Math.min(w, h) * 0.45) {
        const ux = ddx / d, uy = ddy / d, k = Math.min((w / 2 - 14) / Math.max(0.01, Math.abs(ux)), (h / 2 - 14) / Math.max(0.01, Math.abs(uy)));
        const px = clamp(x + w / 2 + ux * k, x + 12, x + w - 12), py = clamp(y + h / 2 + uy * k, y + 50, y + h - 30);
        g.circle(px, py, 6, 'rgba(24,20,37,0.7)');
        g.line(px - ux * 4, py - uy * 4, px + ux * 4, py + uy * 4, PAL.yellow, 2);
        g.text(Math.round(d / 10) + 'm', px, py + 7, PAL.yellow, { size: 'xs', align: 'center', outline: PAL.black });
      }
    }
  }

  /* ============================== EVENTS =============================== */
  const W_ = ['winter'], SA = ['summer', 'asian'];
  OG.defineEvents([
    { id: 'alpine_downhill', name: '알파인 활강', en: 'Alpine Downhill', sport: 'alpine', icon: '⛷️', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'ski', sub: 'dh', par: 102.8, spread: 0.07, ease: 0.012, dnf: 0.04 },
      help: ['{L}{R}: 회전  {D}: 턱 자세(가속)  {U}: 감속', '스타트 {A} 연타 · 점프 착지는 똑바로!', '과속으로 커브에 들어가면 펜스 충돌 · 기문 놓치면 +5초 (어려움: 실격)'] },
    { id: 'alpine_slalom', name: '알파인 회전', en: 'Alpine Slalom', sport: 'alpine', icon: '⛷️', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'ski', sub: 'sl', par: 49.6, spread: 0.08, ease: 0.015, dnf: 0.14 },
      help: ['{L}{R}: 회전 — 리듬감 있게 좌우 교대!', '빨강·파랑 기문 사이를 통과 — 놓치면 +5초 (어려움: 실격)', '{D}: 턱  {U}: 감속  스타트 {A} 연타'] },
    { id: 'alpine_gs', name: '알파인 대회전', en: 'Alpine Giant Slalom', sport: 'alpine', icon: '⛷️', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'ski', sub: 'gs', par: 68.9, spread: 0.075, ease: 0.012, dnf: 0.08 },
      help: ['{L}{R}: 카빙 턴  {D}: 턱  {U}: 감속', '다음 기문을 미리 보고 일찍 턴을 시작하세요', '기문 놓치면 +5초 (어려움: 실격) · 스타트 {A} 연타'] },
    { id: 'moguls', name: '프리스타일 모굴', en: 'Freestyle Moguls', sport: 'freestyle', icon: '🎿', tags: W_, engine: 'downhill', lowerBetter: false,
      cfg: { kind: 'moguls', par: 23.5, spread: 0.08, dnf: 0.05 },
      help: ['범프 위에서 {U} 또는 {A}: 흡수 — 타이밍이 생명!', '점프대 직전 {A}: 트릭 ({L}{R} 콕720 · 그냥 백플립 · {D} 스프레드)', '{L}{R}: 가운데 라인 유지 · 턴60 + 에어20 + 속도20점'] },
    { id: 'skicross', name: '스키크로스', en: 'Ski Cross', sport: 'freestyle', icon: '⛷️', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'cross', sub: 'sx', par: 72.4, spread: 0.06, ease: 0.01, dnf: 0.03 },
      help: ['{L}{R}: 조향  {D}: 턱 · 롤러에서 펌핑(가속)', '스타트 {A} 연타로 게이트 대시!', '4명이 동시에 레이스 — 먼저 결승선을 통과하라'] },
    { id: 'sbx', name: '스노보드 크로스', en: 'Snowboard Cross', sport: 'snowboard', icon: '🏂', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'cross', sub: 'bx', par: 64.8, spread: 0.06, ease: 0.01, dnf: 0.03 },
      help: ['{L}{R}: 조향  {D}: 웅크리기 · 롤러에서 펌핑', '스타트 {A} 연타로 게이트 대시!', '뱅크 커브를 타고 라이벌을 추월하라'] },
    { id: 'snowboard_pgs', name: '스노보드 평행대회전', en: 'Snowboard Parallel GS', sport: 'snowboard', icon: '🏂', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'ski', sub: 'pgs', par: 38.6, spread: 0.07, ease: 0.012, dnf: 0.06 },
      help: ['{L}{R}: 카빙 턴  {D}: 웅크리기(가속)', '옆 코스의 라이벌과 나란히 레이스!', '기문 놓치면 +5초 (어려움: 실격) · 스타트 {A} 연타'] },
    { id: 'bobsleigh', name: '봅슬레이', en: 'Bobsleigh', sport: 'bobsleigh', icon: '🛷', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'sled', sub: 'bob', par: 49.4, spread: 0.035, ease: 0.012, dnf: 0.01 },
      help: ['{L}{R} 번갈아 연타: 썰매 밀기', '{A}: 탑승! (빨간 선 전에)', '{L}{R}: 조향 — 커브의 이상적인 라인을 유지'] },
    { id: 'luge', name: '루지', en: 'Luge', sport: 'luge', icon: '🛷', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'sled', sub: 'luge', par: 47.8, spread: 0.03, ease: 0.012, dnf: 0.02 },
      help: ['{L}{R} 번갈아 연타: 패들 스타트', '{L}{R}: 미세 조향 — 발끝으로 살짝!', '벽에 부딪히면 감속 — 라인을 지켜라'] },
    { id: 'skeleton', name: '스켈레톤', en: 'Skeleton', sport: 'skeleton', icon: '🛷', tags: W_, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'sled', sub: 'skel', par: 50.4, spread: 0.035, ease: 0.012, dnf: 0.01 },
      help: ['{L}{R} 번갈아 연타: 전력 질주', '{A}: 머리부터 다이브!', '{L}{R}: 조향 — 벽을 피하고 라인을 유지'] },
    { id: 'canoe_slalom', name: '카누 슬라럼', en: 'Canoe Slalom', sport: 'canoe', icon: '🛶', tags: SA, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'canoe', par: 88.5, spread: 0.1, ease: 0.02, dnf: 0.02 },
      help: ['{L}{R}: 방향 전환  {U}: 패들  {A} 연타: 파워 스트로크', '초록 기문=하류로 · 빨간 기문=상류로 거슬러 통과', '폴 터치 +2초 · 미통과 +50초'] },
    { id: 'sailing', name: '요트', en: 'Sailing (Dinghy)', sport: 'sailing', icon: '⛵', tags: SA, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'sail', par: 1560, spread: 0.12, ease: 0.03, dnf: 0.03 },
      help: ['{L}{R}: 조타  {A} 누르기: 하이킹(가속)', '바람을 정면으로 받으면 멈춰요 — 지그재그로 태킹!', '마크 1 → 마크 2 → 결승선'] },
    { id: 'mtb', name: '산악자전거 크로스컨트리', en: 'MTB Cross-country', sport: 'mtb', icon: '🚵', tags: SA, engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'mtb', par: 268, spread: 0.1, ease: 0.02, dnf: 0.03 },
      help: ['{U} 연타: 페달 (오르막!)  {D}: 브레이크', '{A}: 버니홉 — 뿌리·바위·통나무 넘기', '{L}{R}: 조향 — 트레일을 벗어나지 마세요'] },
    { id: 'esports_kart', name: 'e스포츠 카트 레이싱', en: 'Esports Kart Racing', sport: 'esports', icon: '🎮', tags: ['asian'], engine: 'downhill', lowerBetter: true,
      cfg: { kind: 'kart', par: 68.5, spread: 0.11, ease: 0.04, dnf: 0 },
      help: ['{L}{R}: 조향  {D}: 브레이크 (가속은 자동)', '커브에서 {A} 누른 채 조향: 드리프트 → 놓으면 부스트!', '아이템 박스 → {U}: 부스터 · 2바퀴 레이스'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
