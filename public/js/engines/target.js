/* =========================================================================
 * engine: target — archery (recurve / compound), 10m air rifle,
 * 25m rapid-fire pistol, skeet.
 * Turn-based solo: humans shoot in turns (banner "P2 차례"), CPU results are
 * simulated from ent.skill and revealed progressively on a live leaderboard.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI;
  const BLANK = OG.blankInput ? OG.blankInput() : { l: false, r: false, u: false, d: false, a: false };

  /* ------------------------------------------------------------------ *
   * small helpers
   * ------------------------------------------------------------------ */
  const pcol = e => (e && e.human) ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.lightgrey;
  function clipCircle(g, cx, cy, r) {
    const c = g.ctx; c.beginPath(); c.arc(Math.round(cx), Math.round(cy), r, 0, PI * 2); c.clip();
  }
  // fill everything between radius r0 and r1 (pixel spans); r1 large = mask outside
  function ringMask(g, cx, cy, r0, r1, col, x0, x1, y0, y1) {
    x0 = x0 == null ? 0 : x0; x1 = x1 == null ? 480 : x1; y0 = y0 == null ? 0 : y0; y1 = y1 == null ? 270 : y1;
    cx = Math.round(cx); cy = Math.round(cy);
    for (let y = Math.max(y0, cy - r1); y < Math.min(y1, cy + r1 + 1); y++) {
      const dy = y - cy;
      const ho = r1 * r1 - dy * dy; if (ho < 0) continue;
      const wo = Math.round(Math.sqrt(ho));
      const hi = r0 * r0 - dy * dy;
      const L = Math.max(x0, cx - wo), Rr = Math.min(x1, cx + wo);
      if (hi <= 0) { if (Rr > L) g.rect(L, y, Rr - L, 1, col); continue; }
      const wi = Math.round(Math.sqrt(hi));
      if (cx - wi > L) g.rect(L, y, cx - wi - L, 1, col);
      if (Rr > cx + wi) g.rect(cx + wi, y, Rr - cx - wi, 1, col);
    }
  }
  function maskOutside(g, cx, cy, r, col) {
    cx = Math.round(cx); cy = Math.round(cy);
    for (let y = 0; y < 270; y++) {
      const dy = y - cy;
      if (Math.abs(dy) >= r) { g.rect(0, y, 480, 1, col); continue; }
      const hw = Math.round(Math.sqrt(r * r - dy * dy));
      if (cx - hw > 0) g.rect(0, y, cx - hw, 1, col);
      if (cx + hw < 480) g.rect(cx + hw, y, 480 - cx - hw, 1, col);
    }
  }
  const sum = arr => arr.reduce((p, v) => p + v, 0);

  /* ================================================================== *
   * ARCHERY
   * ================================================================== */
  const RING_COL = [null, '#f2f0e8', '#f2f0e8', '#2b2b35', '#2b2b35', '#33a3e6', '#33a3e6', '#e8423c', '#e8423c', '#fde14a', '#fde14a'];
  function archScore(comp, r) { // 11 = X (counts 10)
    if (comp) {
      if (r < 0.025) return 11; if (r < 0.05) return 10; if (r < 0.2) return 9;
      if (r < 0.6) return 10 - Math.floor(r / 0.1); return 0;
    }
    if (r < 0.05) return 11; if (r < 0.1) return 10;
    if (r < 1) return 10 - Math.floor(r / 0.1); return 0;
  }
  const archVal = v => v === 11 ? 10 : v;
  const archLbl = v => v === 11 ? 'X' : v === 0 ? 'M' : String(v);
  function archSway(a, comp) {
    const h = a.hold, k = comp ? 0.6 : 1;
    let A = h < 1.1 ? M.lerp(0.17, 0.045, h / 1.1) : h < 3.4 ? 0.045 : 0.045 + 0.05 * Math.pow(h - 3.4, 1.5);
    A *= k;
    const t = h;
    return [A * (Math.sin(t * 2.3 + a.p1) * 0.65 + Math.sin(t * 4.3 + a.p2) * 0.35),
      A * (Math.sin(t * 1.9 + a.p3) * 0.6 + Math.sin(t * 3.7 + a.p4) * 0.4)];
  }
  const ARCH_LIMIT = 24;

  function drawFace(g, cx, cy, z, comp) {
    const minR = comp ? 5 : 1;
    for (let k = minR; k <= 10; k++) g.circle(cx, cy, (11 - k) * 0.1 * z, RING_COL[k]);
    if (z < 30) return;
    for (let k = minR + 1; k <= 10; k++) {
      const lc = (k === 4 || k === 5) ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.35)';
      g.circleO(cx, cy, (11 - k) * 0.1 * z, lc);
    }
    g.circleO(cx, cy, 0.05 * z, 'rgba(0,0,0,0.45)');
    if (comp) g.circleO(cx, cy, 0.025 * z, 'rgba(0,0,0,0.35)');
    g.rect(cx - 1, cy, 3, 1, 'rgba(0,0,0,0.5)'); g.rect(cx, cy - 1, 1, 3, 'rgba(0,0,0,0.5)');
  }
  // arrow seen from behind (stuck in the boss)
  function drawStuckArrow(g, x, y, sz, col) {
    const L = Math.max(2, Math.round(sz));
    g.px(x + 1, y + 1, 'rgba(0,0,0,0.35)');
    g.line(x, y, x, y - L, col); g.line(x, y, x - L, y + Math.round(L * 0.6), col); g.line(x, y, x + L, y + Math.round(L * 0.6), col);
    g.px(x, y, '#ffffff');
  }

  // generic scene drawer, target units → screen: X(u) = cx + (u - vx) * z
  function drawRange(g, s, cx, cy, z, vx, vy, tt) {
    const comp = s.comp;
    const X = u => cx + (u - vx) * z, Y = v => cy + (v - vy) * z;
    const B = comp ? 0.78 : 1.22;               // boss half-size
    const gap = comp ? 2.05 : 3.0;              // distance between bosses
    // sky
    g.grad(0, 0, 480, 270, '#5aa8e6', '#bfe4f6', 9);
    // far hills
    const hz = Y(B * 0.25);
    for (let x = 0; x < 480; x += 2) {
      const u = (x - cx) / z + vx;
      const hh = (Math.sin(u * 1.1 + 1) * 0.5 + Math.sin(u * 2.7) * 0.25 + 1) * 0.28 * z;
      g.rect(x, hz - hh, 2, hh + 2, '#8db4a8');
    }
    // stands with crowd behind the shooting line
    const st0 = Y(-B * 0.15), st1 = Y(B * 0.62);
    if (st1 > st0 + 4) {
      g.rect(0, st0 - 4, 480, 4, '#2f3550');
      g.crowd(0, st0, 480, st1 - st0, tt, { seed: 5, density: 0.8, step: Math.max(4, Math.round(z / 24)), ox: Math.round(vx * z) });
      g.rect(0, st1, 480, 3, '#262b44');
    }
    // tree belt
    const tz = Y(B * 0.62);
    for (let x = -10; x < 490; x += 9) {
      const u = Math.floor((x + vx * z) / 9);
      const hh = (6 + OG.hash(u, 3, 1) * 8) * z / 80;
      g.circle(x - M.wrap(vx * z, 9), tz - hh * 0.3, hh * 0.8, OG.hash(u, 5, 2) > 0.5 ? '#2f6b45' : '#3e8948');
    }
    // grass
    const gy = Y(B * 0.7);
    g.rect(0, gy, 480, 270 - gy + 1, '#5bab4c');
    for (let i = 0; i < 8; i++) {
      const y0 = Y(B * 0.7 + i * 0.22 * (1 + i * 0.25));
      if (i % 2 === 0) g.rect(0, y0, 480, Math.max(1, 0.12 * z), '#64b655');
    }
    // bosses
    for (let n = -2; n <= 2; n++) {
      const bu = n * gap;
      const x0 = X(bu - B), x1 = X(bu + B);
      if (x1 < -5 || x0 > 485) continue;
      // legs
      g.line(X(bu - B * 0.7), Y(B * 0.9), X(bu - B * 0.95), Y(B * 1.45), '#7a5236', Math.max(1, Math.round(z / 30)));
      g.line(X(bu + B * 0.7), Y(B * 0.9), X(bu + B * 0.95), Y(B * 1.45), '#7a5236', Math.max(1, Math.round(z / 30)));
      g.ellipse(X(bu), Y(B * 1.47), B * z * 1.05, 0.05 * z, 'rgba(0,0,0,0.22)');
      // boss body
      g.rect(x0, Y(-B), x1 - x0, B * 2 * z, '#d9b56c');
      g.rect(x0, Y(-B), x1 - x0, Math.max(1, 0.04 * z), '#ecd08c');
      g.rect(x1 - Math.max(1, 0.05 * z), Y(-B), Math.max(1, 0.05 * z), B * 2 * z, '#b8924e');
      // straw texture
      if (z > 40) {
        for (let k = 0; k < 26; k++) {
          const hu = bu - B + OG.hash(k, n + 9, 1) * B * 2, hv = -B + OG.hash(k, n + 9, 2) * B * 2;
          g.rect(X(hu), Y(hv), Math.max(2, 0.08 * z), 1, '#c7a25d');
        }
      }
      // paper + face
      if (!comp) g.rect(X(bu - 1.05), Y(-1.05), 2.1 * z, 2.1 * z, '#f4f2ea');
      else { g.rect(X(bu - 0.66), Y(-0.66), 1.32 * z, 1.32 * z, '#f4f2ea'); }
      drawFace(g, X(bu), Y(0), z, comp);
      // neighbours' arrows (cosmetic)
      if (n !== 0) {
        for (let k = 0; k < 3; k++) {
          const rr = OG.hash(k, n, 77) * (comp ? 0.25 : 0.4), an = OG.hash(k, n, 78) * PI * 2;
          drawStuckArrow(g, X(bu + Math.cos(an) * rr), Y(Math.sin(an) * rr), 0.045 * z, ['#feae34', '#2ce8f5', '#ffffff'][k]);
        }
      }
      // number plate + wind flag pole
      const plY = Y(-B - 0.17);
      g.rect(X(bu - 0.16), plY, 0.32 * z, 0.15 * z, '#ffffff');
      g.rectO(X(bu - 0.16), plY, 0.32 * z, 0.15 * z, '#262b44');
      if (z > 50) g.text(String(7 + n), X(bu), plY + 0.02 * z, '#262b44', { size: z > 110 ? 'm' : 'xs', align: 'center' });
      const poleX = X(bu + B * 0.85), poleTop = Y(-B - 0.55);
      g.rect(poleX, poleTop, Math.max(1, z / 60), Y(-B) - poleTop, '#ccd2dc');
      const w = s.a ? s.a.wind : s.wind;
      const len = (0.12 + Math.abs(w) * 0.07) * z, dir = w >= 0 ? 1 : -1;
      const fh = 0.11 * z;
      for (let i = 0; i < len; i++) {
        const wav = Math.sin(tt * 9 + i * 0.4) * (i / len) * fh * 0.25 * (0.3 + Math.abs(w) / 4);
        const hgt = fh * (1 - i / len * 0.75);
        g.rect(poleX + dir * i, poleTop + wav + (fh - hgt) / 2, 1, hgt, (i % 6 < 3) ? '#fee761' : '#f77622');
      }
    }
  }

  function drawBow(g, J, draw, comp, sc, nock) {
    const hx = J.hdL[0], hy = J.hdL[1];
    const L = 12 * sc, bend = (1.5 + draw * 2.5) * sc;
    const col = comp ? '#3a4466' : '#262b44';
    const tipT = [hx - bend, hy - L], tipB = [hx - bend, hy + L];
    const midT = [hx + sc * 0.5, hy - L * 0.55], midB = [hx + sc * 0.5, hy + L * 0.55];
    g.line(hx, hy - 3 * sc, midT[0], midT[1], col, sc); g.line(midT[0], midT[1], tipT[0], tipT[1], comp ? col : '#5a6988', sc);
    g.line(hx, hy + 3 * sc, midB[0], midB[1], col, sc); g.line(midB[0], midB[1], tipB[0], tipB[1], comp ? col : '#5a6988', sc);
    g.rect(hx - sc, hy - 3 * sc, 2 * sc, 6 * sc, comp ? '#e43b44' : '#feae34');
    if (comp) { g.circle(tipT[0], tipT[1], 1.5 * sc, '#8b9bb4'); g.circle(tipB[0], tipB[1], 1.5 * sc, '#8b9bb4'); }
    else { g.line(hx + sc, hy, hx + 7 * sc, hy + 1, '#8b9bb4', 1); } // stabiliser
    const sx = draw > 0.04 ? J.hdR[0] : tipT[0], sy = draw > 0.04 ? J.hdR[1] : hy;
    if (draw > 0.04) { g.line(tipT[0], tipT[1], sx, sy, '#e8e8e8', 1); g.line(sx, sy, tipB[0], tipB[1], '#e8e8e8', 1); }
    else g.line(tipT[0], tipT[1], tipB[0], tipB[1], '#e8e8e8', 1);
    if (nock && draw > 0.04) {
      g.line(sx, sy, hx + 5 * sc, hy, '#c0cbdc', 1);
      g.px(hx + 5 * sc, hy, '#ffffff');
      g.px(sx, sy - 1, '#e43b44'); g.px(sx - 1, sy, '#e43b44');
    }
  }

  const ARCH = {
    attempts: H => H <= 2 ? { n: 6, per: 3 } : H <= 4 ? { n: 4, per: 2 } : { n: 3, per: 3 },
    chunkName: (s, from) => (Math.floor(from / s.per) + 1) + '엔드',
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.05);
      const sig = Math.exp(-0.73 - 2.02 * q) * (s.comp ? 0.42 : 1);
      const out = [];
      for (let i = 0; i < s.n; i++) out.push(archScore(s.comp, Math.hypot(R.gauss() * sig, R.gauss() * sig)));
      return out;
    },
    total: arr => sum(arr.map(archVal)),
    fmtTot: v => String(v),
    result(s, arr) {
      const tot = sum(arr.map(archVal)), xs = arr.filter(v => v === 11).length, tens = arr.filter(v => v >= 10).length;
      return { score: tot + tens * 0.01 + xs * 0.0001, text: tot + '점 (X' + xs + ')' };
    },
    newTurn(s) { s.arr = []; },
    start(s, R) {
      s.wind = M.clamp(s.wind * 0.5 + R.gauss() * 1.5, -4.2, 4.2);
      s.a = {
        ph: 'ready', pt: 0, clk: 0, draw: 0, hold: 0, auto: 0,
        ax: R.gauss() * 0.22, ay: 0.2 + R.f() * 0.3, vx: 0, vy: 0,
        p1: R.f() * 6.28, p2: R.f() * 6.28, p3: R.f() * 6.28, p4: R.f() * 6.28,
        wind: M.round(s.wind, 1), sx: 0, sy: 1.8, hx: 0, hy: 0, val: 0, fin: 0
      };
    },
    update(s, a, inp, dt, R) {
      a.pt += dt; a.clk += dt;
      const k = s.comp ? 0.6 : 1;
      if (a.ph === 'ready') {
        if (a.clk > 5) a.auto = 1;
        a.draw = Math.max(0, a.draw - dt * 2.5);
        if (inp.a || a.auto) { a.ph = 'draw'; a.pt = 0; OG.sfx(s, 'charge'); }
        if (a.clk > ARCH_LIMIT) { a.hx = 9; a.hy = 9; a.val = 0; a.ph = 'hit'; a.pt = 0; a.tout = 1; OG.sfx(s, 'buzzer'); }
      } else if (a.ph === 'draw') {
        if (inp.a || a.auto) {
          a.draw += dt / 0.8;
          if (a.draw >= 1) { a.draw = 1; a.ph = 'hold'; a.pt = 0; a.hold = 0; OG.sfx(s, 'click'); }
        } else { a.ph = 'ready'; a.pt = 0; }
      } else if (a.ph === 'hold') {
        a.hold += dt;
        const acc = 1.3;
        if (inp.l) a.vx -= acc * dt; if (inp.r) a.vx += acc * dt;
        if (inp.u) a.vy -= acc * dt; if (inp.d) a.vy += acc * dt;
        const sq = Math.sqrt(dt);
        a.vx += -2.4 * a.vx * dt + R.gauss() * 0.3 * k * sq;
        a.vy += -2.4 * a.vy * dt + R.gauss() * 0.3 * k * sq;
        a.ax = M.clamp(a.ax + a.vx * dt, -1.5, 1.5);
        a.ay = M.clamp(a.ay + a.vy * dt, -1.5, 1.5);
        const rel = a.auto ? (inp.ap || inp.ar) : !inp.a;
        if (rel || a.hold > 7 || a.clk > ARCH_LIMIT) {
          const spd = Math.hypot(a.vx, a.vy);
          const e = 0.02 * k + spd * 0.05;
          a.hx = a.sx + a.wind * (s.comp ? 0.03 : 0.045) + R.gauss() * e;
          a.hy = a.sy + R.gauss() * e + 0.01;
          a.ph = 'fly'; a.pt = 0; a.draw = 0;
          OG.sfx(s, 'arrow');
        }
      } else if (a.ph === 'fly') {
        if (a.pt >= 0.85) {
          a.val = archScore(s.comp, Math.hypot(a.hx, a.hy));
          a.ph = 'hit'; a.pt = 0;
          if (a.val > 0) s.arr.push([M.round(a.hx, 3), M.round(a.hy, 3)]);
          OG.sfx(s, a.val ? 'target' : 'miss');
          if (a.val >= 10) { OG.sfx(s, 'perfect'); OG.sfx(s, 'cheer'); } else if (a.val === 9) OG.sfx(s, 'good');
        }
      } else if (a.ph === 'hit') {
        if (a.pt >= 1.6) a.fin = 1;
      }
      if (a.ph === 'ready' || a.ph === 'draw' || a.ph === 'hold') {
        const sw = archSway(a, s.comp);
        const low = Math.pow(1 - a.draw, 2) * 1.9;
        a.sx = M.round(a.ax + sw[0], 4); a.sy = M.round(a.ay + sw[1] + low, 4);
      }
    },
    view(s) {
      const a = s.a, z0 = s.comp ? 128 : 82;
      let k = 0;
      if (a && a.ph === 'fly') k = M.ease(Math.min(1, a.pt / 0.85));
      else if (a && a.ph === 'hit' && !a.tout) k = a.pt < 1.05 ? 1 : 1 - M.ease(Math.min(1, (a.pt - 1.05) / 0.5));
      const hx = a ? M.clamp(a.hx, -1.3, 1.3) : 0, hy = a ? M.clamp(a.hy, -1.3, 1.3) : 0;
      return { z: z0 * (1 + 0.9 * k), vx: hx * k * 0.92, vy: hy * k * 0.92, k };
    },
    draw(g, s) {
      const a = s.a, V = ARCH.view(s);
      const CX = 236, CY = 128;
      const tt = s.t;
      drawRange(g, s, CX, CY, V.z, V.vx, V.vy, tt);
      const X = u => CX + (u - V.vx) * V.z, Y = v => CY + (v - V.vy) * V.z;
      const cur = s.ents[s.cur];
      const col = cur ? pcol(cur) : PAL.yellow;
      // arrows of this end
      (s.arr || []).forEach(p => drawStuckArrow(g, Math.round(X(p[0])), Math.round(Y(p[1])), 0.05 * V.z, col));
      // flying arrow
      if (a && a.ph === 'fly') {
        const p = Math.min(1, a.pt / 0.85);
        const d = M.lerp(1, 26, p);
        const ex = X(a.hx), ey = Y(a.hy);
        const sx0 = 250, sy0 = 300;
        const ax = ex + (sx0 - ex) / d + Math.sin(p * 26) * 6 / d, ay = ey + (sy0 - ey) / d;
        const sz = 22 / d;
        // shaft towards target
        g.line(ax, ay, ax + (ex - ax) * 0.15, ay + (ey - ay) * 0.15, '#c0cbdc', Math.max(1, Math.round(sz / 5)));
        drawStuckArrow(g, Math.round(ax), Math.round(ay), sz, col);
      }
      // sight overlay
      if (a && (a.ph === 'ready' || a.ph === 'draw' || a.ph === 'hold')) {
        const sx = Math.round(X(a.sx)), sy = Math.round(Y(a.sy));
        if (!s.comp) {
          // arrow (seen along the shaft) + blurred string
          g.line(sx - 10, 272, sx - 4, sy + 30, '#8b9bb4', 3); g.line(sx - 4, sy + 34, sx - 3, sy + 30, '#feae34', 2);
          g.alpha(0.3); g.rect(sx - 15, 0, 3, 270, '#f4f4f4'); g.alpha(1);
          g.rect(sx + 7, sy - 1, 64, 3, '#2b2b35'); g.rect(sx + 7, sy - 1, 64, 1, '#5a6988');
          g.rect(sx + 70, sy - 6, 14, 13, '#2b2b35');
          g.circleO(sx, sy, 6, '#181425'); g.circleO(sx, sy, 5, '#ffffff'); g.circleO(sx, sy, 4, '#181425');
          g.rect(sx + 1, sy, 6, 1, '#181425');
          g.rect(sx - 1, sy - 1, 2, 2, '#63ff4d');
        } else {
          // peep sight: dark ring around the scope housing, magnified lens
          maskOutside(g, sx, sy, 66, 'rgba(12,10,18,0.93)');
          g.circleO(sx, sy, 66, 'rgba(0,0,0,0.6)');
          g.save(); clipCircle(g, sx, sy, 17);
          drawRange(g, s, sx, sy, V.z * 2.3, a.sx, a.sy, tt);
          g.restore();
          ringMask(g, sx, sy, 17, 22, '#26402f');
          g.circleO(sx, sy, 22, '#132018'); g.circleO(sx, sy, 17, '#5f8a6a');
          g.rect(sx - 4, sy + 23, 9, 3, '#132018'); g.rect(sx - 3, sy + 24, 7, 1, '#9fe08f'); g.px(sx + Math.round(M.clamp(a.vx * 8, -3, 3)), sy + 24, '#ffffff');
          g.rect(sx - 1, sy - 1, 2, 2, '#ff3b3b'); g.px(sx, sy, '#ffd0d0');
          g.rect(sx + 22, sy - 1, 50, 3, '#1b1820');
        }
      }
      // score popup
      if (a && a.ph === 'hit' && a.pt < 1.5) {
        const v = a.val;
        const txt = a.tout ? '시간 초과' : v === 11 ? 'X!' : v === 10 ? '10점!' : v === 0 ? '미스' : v + '점';
        const c = v >= 10 ? PAL.yellow : v >= 9 ? '#fde14a' : v >= 7 ? PAL.rose : v >= 5 ? PAL.cyan : PAL.lightgrey;
        const bob = Math.max(0, 1 - a.pt * 6) * 10;
        g.text(txt, CX, 86 - bob, c, { size: v >= 10 ? 'xxl' : 'xl', align: 'center', outline: PAL.black });
        if (v === 11) g.text('PERFECT', CX, 120, PAL.white, { size: 's', align: 'center', outline: PAL.black });
      }
      // ---- HUD ----
      // wind
      const w = a ? a.wind : s.wind;
      g.panel(6, 6, 96, 32, { title: '바람' });
      const wl = Math.round(Math.abs(w) * 7) + 2, wx = 30, wy = 24, dir = w >= 0 ? 1 : -1;
      g.rect(wx - (dir > 0 ? 0 : wl), wy - 1, wl, 3, PAL.cyan);
      g.poly([wx + dir * (wl + 4), wy + 0.5, wx + dir * wl, wy - 4, wx + dir * wl, wy + 5], PAL.cyan);
      g.text(Math.abs(w).toFixed(1) + 'm/s', 98, 19, PAL.white, { size: 's', align: 'right' });
      // clock + distance
      if (a && cur) {
        const rem = Math.max(0, ARCH_LIMIT - a.clk);
        g.text((s.comp ? '50m' : '70m') + ' · 남은 ' + Math.ceil(rem) + '초', 8, 42, rem < 8 ? PAL.red : PAL.white, { size: 's', outline: PAL.black });
      }
      // arrows of this turn
      if (cur && s.ph !== 'final') {
        const p = s.plan[s.ti];
        const done = s.sc[s.cur].slice(p[1]);
        if (a && a.ph === 'hit') done.push(a.val);
        const n = p[2];
        const bx = CX - n * 11;
        g.panel(bx - 4, 236, n * 22 + 8, 28, { title: OG.entLabel(cur) + ' ' + ARCH.chunkName(s, p[1]) });
        for (let i = 0; i < n; i++) {
          const v = done[i];
          const c = v == null ? PAL.slate : v >= 9 ? '#fde14a' : v >= 7 ? '#e8423c' : v >= 5 ? '#33a3e6' : v >= 3 ? '#2b2b35' : '#f2f0e8';
          g.rect(bx + i * 22, 243, 18, 15, c);
          g.rectO(bx + i * 22, 243, 18, 15, PAL.black);
          if (v != null) g.text(archLbl(v), bx + i * 22 + 9, 245, (v >= 3 && v <= 4) ? PAL.white : PAL.black, { size: 'm', align: 'center' });
        }
      }
      // archer inset
      ARCH.inset(g, s);
      // hint
      if (a && cur && s.ph === 'play') {
        const hint = a.ph === 'ready' ? '{A} 꾹 눌러 활 당기기' : a.ph === 'draw' ? '{A} 계속 누르기…' : a.ph === 'hold' ? (a.auto ? '{L}{R}{U}{D} 조준 · {A} 발사' : '{L}{R}{U}{D} 조준 · {A} 떼면 발사') : '';
        if (hint) g.rich(hint, 290, 223, PAL.white, { align: 'center', shadow: true });
      }
    },
    inset(g, s) {
      const a = s.a, cur = s.ents[s.cur];
      if (!cur) return;
      const x = 4, y = 186, w = 104, h = 80;
      g.panel(x, y, w, h);
      g.save(); g.clip(x + 1, y + 1, w - 2, h - 2);
      g.grad(x, y, w, h - 18, '#7cc4f0', '#cfeaf7', 4);
      g.rect(x, y + h - 20, w, 20, '#5bab4c');
      g.rect(x, y + h - 20, w, 2, '#7ac268');
      g.rect(x + 74, y + h - 38, 18, 18, '#d9b56c'); g.circle(x + 83, y + h - 29, 6, '#fde14a'); g.circle(x + 83, y + h - 29, 3, '#e8423c');
      if (cur) {
        const look = OG.lookOf(cur);
        look.sleeves = false;
        const dr = a ? a.draw : 0;
        let pose = OG.Pose.bow(dr);
        if (!a || a.ph === 'ready') pose = OG.Pose.mix(OG.Pose.stand(), OG.Pose.bow(0), 0.6 + (a ? a.draw * 0.4 : 0));
        if (a && (a.ph === 'fly' || a.ph === 'hit')) { pose = OG.Pose.bow(0); pose.eR = 0.1; pose.aR = 0.9; }
        const sway = a && a.ph === 'hold' ? Math.sin(a.hold * 7) * Math.min(1, a.hold / 6) : 0;
        pose.t = (pose.t || 0) + sway * 0.03;
        const J = g.figure(x + 36, y + h - 12, pose, look, { facing: 1, scale: 2 });
        drawBow(g, J, dr, s.comp, 2, a && (a.ph === 'ready' || a.ph === 'draw' || a.ph === 'hold'));
        g.text(OG.entLabel(cur), x + 36, y + 4, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
        g.flag(cur.country, x + 5, y + 5, 12, 8);
        // stamina/hold bar
        if (a && a.ph === 'hold') {
          const f = 1 - Math.min(1, a.hold / 7);
          g.bar(x + 50, y + 5, 48, 5, f, f > 0.5 ? PAL.green : f > 0.25 ? PAL.gold : PAL.red);
          g.text('체력', x + 74, y + 11, PAL.black, { size: 'xs', align: 'center' });
        }
      }
      g.restore();
    }
  };

  /* ================================================================== *
   * 10m AIR RIFLE
   * ================================================================== */
  const SC = { x: 160, y: 132, r: 120 }, RZ = 10;     // scope, px per scoring unit (2.5mm)
  const rifleScore = u => u >= 10.9 ? 0 : Math.min(10.9, Math.floor((11 - u) * 10 + 1e-6) / 10);
  const RIFLE_LIMIT = 12;
  function drawRifleCard(g, cx, cy, z, mini) {
    const hs = mini ? 10.6 : 30;
    g.rect(cx - hs * z, cy - hs * z, hs * 2 * z, hs * 2 * z, '#f3efe2');
    if (!mini) g.rectO(cx - hs * z, cy - hs * z, hs * 2 * z, hs * 2 * z, '#bdb39a');
    for (let k = 1; k <= 3; k++) g.circleO(cx, cy, (10.1 - k) * z, '#2b2b35');
    g.circle(cx, cy, 6.1 * z, '#1b1a20');
    for (let k = 5; k <= 9; k++) g.circleO(cx, cy, (10.1 - k) * z, mini ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)');
    g.circle(cx, cy, Math.max(0.6, 0.12 * z), '#ffffff');
    if (!mini && z >= 8) {
      for (let k = 1; k <= 8; k++) {
        const r = (10.6 - k) * z, c = k <= 3 ? '#2b2b35' : '#c0cbdc';
        g.text(String(k), cx - r, cy - 4, c, { size: 'xs', align: 'center' });
        g.text(String(k), cx + r, cy - 4, c, { size: 'xs', align: 'center' });
        g.text(String(k), cx, cy - r - 4, c, { size: 'xs', align: 'center' });
      }
    }
  }
  function drawRifle(g, J, sc) {
    const ax = J.hdR[0], ay = J.hdR[1];
    const dx = J.hdL[0] - ax, dy = J.hdL[1] - ay, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    g.line(ax - ux * 5 * sc, ay - uy * 5 * sc + 2 * sc, ax + ux * 6 * sc, ay + uy * 6 * sc, '#8a4b2c', 2 * sc);
    g.line(ax + ux * 6 * sc, ay + uy * 6 * sc - sc, ax + ux * 17 * sc, ay + uy * 17 * sc - sc, '#3a4466', sc);
    g.rect(ax + ux * 2 * sc - sc, ay + uy * 2 * sc - 3 * sc, 2 * sc, 2 * sc, '#5a6988');
  }
  const RIFLE = {
    attempts: H => H <= 2 ? { n: 10, per: 5 } : H <= 4 ? { n: 6, per: 3 } : { n: 4, per: 2 },
    chunkName: (s, from) => '시리즈 ' + (Math.floor(from / s.per) + 1),
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.05);
      const sig = Math.exp(-0.82 - 2.27 * (q - 0.86));
      const out = [];
      for (let i = 0; i < s.n; i++) out.push(rifleScore(Math.hypot(R.gauss() * sig, R.gauss() * sig)));
      return out;
    },
    total: arr => M.round(sum(arr), 1),
    fmtTot: v => v.toFixed(1),
    result(s, arr) { const t = M.round(sum(arr), 1); return { score: t, text: t.toFixed(1) + '점' }; },
    newTurn(s) { s.holes = []; s.o2 = 1; },
    start(s, R) {
      s.a = {
        ph: 'aim', pt: 0, clk: 0, ox: M.clamp(R.gauss() * 1.8, -4, 4), ny: M.clamp(R.gauss() * 0.7, -1.5, 1.5), vx: 0, vy: 0,
        bph: R.f() * 6.28, by: 0, hold: 0, holding: 0, o2: s.o2 == null ? 1 : s.o2,
        p1: R.f() * 6.28, p2: R.f() * 6.28, p3: R.f() * 6.28, p4: R.f() * 6.28,
        sx: 0, sy: 0, kick: 0, hx: 0, hy: 0, val: 0, fin: 0
      };
    },
    update(s, a, inp, dt, R) {
      a.pt += dt; a.clk += dt;
      a.kick = Math.max(0, a.kick - dt * 2.2);
      if (a.ph === 'aim') {
        // breathing
        const wantHold = inp.u && a.o2 > 0.04;
        if (wantHold) {
          if (!a.holding) { a.holding = 1; a.hold = 0; OG.sfx(s, 'tick'); }
          a.hold += dt; a.o2 = Math.max(0, a.o2 - dt / 6);
          a.by += 0.1 * dt * Math.sin(a.p3 + a.hold);
        } else {
          if (a.holding) { a.holding = 0; }
          a.o2 = Math.min(1, a.o2 + dt / 2.8);
          a.bph += dt * PI * 2 / 3.6;
          const tgt = 2.6 * Math.sin(a.bph);
          a.by += (tgt - a.by) * Math.min(1, 5 * dt);
        }
        // horizontal drift + control
        const sq = Math.sqrt(dt);
        if (inp.l) a.vx -= 5 * dt; if (inp.r) a.vx += 5 * dt;
        a.vx += -2 * a.vx * dt + R.gauss() * 0.85 * sq;
        a.ox = M.clamp(a.ox + a.vx * dt, -7, 7);
        a.vy += -1.5 * a.vy * dt + R.gauss() * 0.25 * sq;
        a.ny = M.clamp(a.ny + a.vy * dt, -2.5, 2.5);
        // tremor
        const h = a.hold;
        let T = a.holding ? (h < 0.7 ? M.lerp(0.5, 0.16, h / 0.7) : h < 3.8 ? 0.16 : 0.16 + (h - 3.8) * 0.65) : 0.5;
        T += (1 - a.o2) * 0.35;
        const tt = a.clk;
        a.sx = M.round(a.ox + T * (Math.sin(tt * 6.1 + a.p1) * 0.6 + Math.sin(tt * 10.3 + a.p2) * 0.4), 4);
        a.sy = M.round(a.by + a.ny + T * (Math.sin(tt * 5.3 + a.p3) * 0.6 + Math.sin(tt * 11.7 + a.p4) * 0.4), 4);
        if (inp.ap || a.clk > RIFLE_LIMIT) {
          a.hx = M.round(a.sx + R.gauss() * 0.1, 3); a.hy = M.round(a.sy + R.gauss() * 0.1, 3);
          a.val = rifleScore(Math.hypot(a.hx, a.hy));
          s.holes.push([a.hx, a.hy]);
          a.kick = 1; a.ph = 'shot'; a.pt = 0; a.holding = 0;
          s.o2 = Math.min(1, a.o2 + 0.25);
          OG.sfx(s, 'shot');
          if (a.val >= 10.5) { OG.sfx(s, 'perfect'); OG.sfx(s, 'cheer'); } else if (a.val >= 10) OG.sfx(s, 'good');
        }
      } else if (a.ph === 'shot') {
        if (a.pt >= 1.5) a.fin = 1;
      }
    },
    draw(g, s) {
      const a = s.a, cur = s.ents[s.cur];
      g.clear('#0e0c16');
      // range hall (outside the scope)
      for (let i = 0; i < 12; i++) g.rect(i * 44 + 10, 0, 2, 270, 'rgba(255,255,255,0.025)');
      const sx = a ? a.sx : 0, sy = a ? a.sy : 2.4, kick = a ? a.kick : 0;
      const tcx = SC.x - sx * RZ, tcy = SC.y - sy * RZ + kick * kick * 22;
      g.save(); clipCircle(g, SC.x, SC.y, SC.r);
      g.rect(SC.x - SC.r, SC.y - SC.r, SC.r * 2, SC.r * 2, '#323a36');
      for (let i = -4; i < 6; i++) g.rect(tcx + i * 60 - 30, SC.y - SC.r, 1, SC.r * 2, '#3c4540');
      drawRifleCard(g, tcx, tcy, RZ, false);
      (s.holes || []).forEach((p, i) => {
        const hx = tcx + p[0] * RZ, hy = tcy + p[1] * RZ;
        const inBlack = Math.hypot(p[0], p[1]) < 6.1;
        g.circle(hx, hy, 0.9 * RZ, inBlack ? '#5a5a60' : '#3a3a40');
        g.circle(hx, hy, 0.9 * RZ - 2, inBlack ? '#2a2a2e' : '#7b776a');
        if (i === s.holes.length - 1 && a && a.ph === 'shot') g.circleO(hx, hy, 0.9 * RZ + 1, PAL.yellow);
      });
      // front sight aperture tunnel
      ringMask(g, SC.x, SC.y, 82, SC.r + 2, 'rgba(8,8,12,0.7)');
      ringMask(g, SC.x, SC.y, 72, 81, '#0b0b0e');
      g.circleO(SC.x, SC.y, 72, 'rgba(255,255,255,0.18)');
      ringMask(g, SC.x, SC.y, SC.r - 10, SC.r + 2, 'rgba(0,0,0,0.45)');
      g.restore();
      g.circleO(SC.x, SC.y, SC.r, '#4a4f60'); g.circleO(SC.x, SC.y, SC.r + 1, '#262b44');
      // breath meter
      if (a) {
        const bx = 290, by0 = 150;
        g.text('숨', bx + 4, by0 - 12, PAL.lightgrey, { size: 'xs', align: 'center' });
        g.vbar(bx, by0, 9, 90, a.o2, a.o2 > 0.5 ? PAL.cyan : a.o2 > 0.2 ? PAL.gold : PAL.red);
        if (a.holding) g.text('숨 참는 중', SC.x, 6, a.hold > 3.8 ? PAL.red : PAL.cyan, { size: 's', align: 'center', outline: PAL.black });
      }
      // shooter portrait
      if (cur) {
        const look = OG.lookOf(cur); look.sleeves = true; look.shirt = '#e8e2d0'; look.pants = '#e8e2d0'; look.tights = true;
        const pose = OG.Pose.aim(); pose.t = -0.12 - kick * 0.1; pose.aR = 1.15; pose.eR = 1.85;
        g.text(OG.entLabel(cur), 30, 206, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
        const J = g.figure(30, 266, pose, look, { facing: 1, scale: 2 });
        drawRifle(g, J, 2);
        g.flag(cur.country, 6, 186, 18, 12);
      }
      // monitor
      RIFLE.monitor(g, s, 304, 8, 170, 122);
      if (a && cur && s.ph === 'play' && a.ph === 'aim') g.rich('{U} 꾹: 숨 참기  {L}{R} 보정  {A} 격발', SC.x + 6, 258, PAL.white, { align: 'center', shadow: true });
      if (a && a.ph === 'shot' && a.pt < 1.4) {
        const v = a.val;
        const c = v >= 10.5 ? PAL.yellow : v >= 10 ? PAL.green : v >= 9 ? PAL.white : PAL.grey;
        g.text(v.toFixed(1), SC.x, 22 - Math.max(0, 1 - a.pt * 6) * 8, c, { size: 'xxl', align: 'center', outline: PAL.black });
        if (v >= 10.5) g.text(v >= 10.8 ? '퍼펙트!' : '굿 샷!', SC.x, 54, PAL.white, { size: 'm', align: 'center', outline: PAL.black });
      }
      if (a && cur && a.ph === 'aim') {
        const rem = Math.max(0, RIFLE_LIMIT - a.clk);
        if (rem < 6) g.text(Math.ceil(rem) + '초', 268, 20, PAL.red, { size: 'm', align: 'center', outline: PAL.black });
      }
    },
    monitor(g, s, x, y, w, h) {
      const a = s.a, cur = s.ents[s.cur];
      g.panel(x, y, w, h, { title: '전자 표적', bg: 'rgba(18,30,58,0.95)', border: PAL.blue, titleColor: PAL.white });
      const mx = x + 48, my = y + 56, z = 4.4;
      drawRifleCard(g, mx, my, z, true);
      const holes = s.holes || [];
      holes.forEach((p, i) => {
        const last = i === holes.length - 1;
        g.rect(mx + p[0] * z - 1, my + p[1] * z - 1, 3, 3, last ? PAL.red : PAL.gold);
        if (last) g.rectO(mx + p[0] * z - 2, my + p[1] * z - 2, 5, 5, '#ffffff');
      });
      if (!cur) return;
      const arr = s.sc[s.cur];
      const p = s.plan[s.ti] || [0, 0, 0];
      const ser = arr.slice(p[1]);
      const last = a && a.ph === 'shot' ? a.val : ser.length ? ser[ser.length - 1] : null;
      g.text(last == null ? '--.-' : last.toFixed(1), x + w - 8, y + 10, last == null ? PAL.grey : last >= 10.5 ? PAL.yellow : last >= 10 ? PAL.green : PAL.white, { size: 'xl', align: 'right' });
      for (let i = 0; i < p[2]; i++) {
        const v = (a && a.ph === 'shot' && i === ser.length) ? a.val : ser[i];
        const cx = x + 100 + (i % 3) * 23, cy = y + 42 + Math.floor(i / 3) * 12;
        g.rect(cx - 1, cy - 1, 22, 11, '#0d1830');
        g.text(v == null ? '·' : v.toFixed(1), cx + 10, cy, v == null ? PAL.darkgrey : v >= 10 ? PAL.green : PAL.lightgrey, { size: 'xs', align: 'center' });
      }
      const tot = M.round(sum(arr) + (a && a.ph === 'shot' && !a.fin ? a.val : 0), 1);
      g.text('합계', x + 100, y + 72, PAL.grey, { size: 'xs' });
      g.text(tot.toFixed(1), x + w - 8, y + 70, PAL.white, { size: 'l', align: 'right' });
      g.text((arr.length + (a && a.ph === 'shot' ? 1 : 0)) + '/' + s.n + '발', x + w - 8, y + 90, PAL.lightgrey, { size: 'xs', align: 'right' });
      g.text(RIFLE.chunkName(s, p[1]), x + 100, y + 90, PAL.cyan, { size: 'xs' });
      g.text('10m 공기소총', x + 8, y + h - 12, PAL.grey, { size: 'xs' });
    }
  };

  /* ================================================================== *
   * 25m RAPID FIRE PISTOL
   * ================================================================== */
  const PTX = [80, 160, 240, 320, 400], PTY = 120;
  const pistolScore = r => r < 5 ? 10 : r < 25 ? 10 - Math.ceil((r - 5) / 4) : 0;
  const pistolSecs = s => s.n >= 3 ? [8, 6, 4] : s.n === 2 ? [8, 6] : [6];
  const secMul = sec => sec >= 8 ? 1 : sec >= 6 ? 1.15 : 1.45;
  function drawPistolTarget(g, x, y, turn, val, hit) {
    const w = Math.max(2, Math.round(26 * turn));
    g.rect(x - w, y - 32, w * 2, 64, '#e9e3cf');
    g.rect(x - w, y + 32, w * 2, 2, '#8a7f66');
    if (turn < 0.5) return;
    g.circle(x, y, 25, '#1d1b22');
    for (let r = 21; r >= 5; r -= 4) g.circleO(x, y, r, 'rgba(255,255,255,0.55)');
    g.rect(x - 1, y, 3, 1, 'rgba(255,255,255,0.6)'); g.rect(x, y - 1, 1, 3, 'rgba(255,255,255,0.6)');
  }
  const PISTOL = {
    attempts: H => H <= 2 ? { n: 3, per: 1 } : H <= 4 ? { n: 2, per: 1 } : { n: 1, per: 1 },
    chunkName: (s, from) => '시리즈 ' + (from + 1) + ' · ' + pistolSecs(s)[from] + '초',
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.05);
      const sig = Math.exp(1.459 - 1.507 * (q - 0.86));
      const secs = pistolSecs(s), out = [];
      for (let i = 0; i < s.n; i++) {
        let t = 0;
        for (let k = 0; k < 5; k++) t += pistolScore(Math.hypot(R.gauss(), R.gauss()) * sig * secMul(secs[i]));
        out.push(t);
      }
      return out;
    },
    total: arr => sum(arr),
    fmtTot: v => String(v),
    result(s, arr) { const t = sum(arr); return { score: t, text: t + '점' }; },
    newTurn() { },
    start(s, R) {
      const si = s.sc[s.cur].length;
      s.a = {
        ph: 'ready', pt: 0, secs: pistolSecs(s)[si] || 6, si, tg: 0, px: 120, py: 300, vx: 0, vy: 0,
        ex: R.gauss() * 8, ey: R.gauss() * 8 + 6, rec: 0, ammo: 5, sc5: [-1, -1, -1, -1, -1], holes: [], lastShot: -9,
        p1: R.f() * 6.28, p2: R.f() * 6.28, wasted: 0, val: 0, fin: 0, trem: 1.3
      };
    },
    update(s, a, inp, dt, R) {
      a.pt += dt;
      if (a.ph === 'ready') {
        if (a.pt >= 1.8) { a.ph = 'live'; a.pt = 0; OG.sfx(s, 'beep'); }
        return;
      }
      if (a.ph === 'live') {
        if (inp.rp && a.tg < 4) { a.tg++; a.ex = R.gauss() * 6; a.ey = R.gauss() * 6 + 2; OG.sfx(s, 'whoosh'); }
        if (inp.lp && a.tg > 0) { a.tg--; a.ex = R.gauss() * 6; a.ey = R.gauss() * 6 + 2; OG.sfx(s, 'whoosh'); }
        const decay = Math.exp(-dt / 0.33);
        a.ex *= decay; a.ey *= decay;
        a.rec = Math.max(0, a.rec - dt / 0.3);
        const gx = PTX[a.tg] + a.ex, gy = PTY + a.ey;
        const K = 520, C = 2 * Math.sqrt(K);
        a.vx += ((gx - a.px) * K - a.vx * C) * dt; a.vy += ((gy - a.py) * K - a.vy * C) * dt;
        a.px += a.vx * dt; a.py += a.vy * dt;
        const ft = s.t;
        const tx = a.px + a.trem * (Math.sin(ft * 7 + a.p1) * 0.6 + Math.sin(ft * 12.5 + a.p2) * 0.4) + a.rec * 3;
        const ty = a.py + a.trem * (Math.sin(ft * 6.2 + a.p2) * 0.6 + Math.sin(ft * 13.1 + a.p1) * 0.4) - a.rec * a.rec * 30;
        a.ax = M.round(tx, 2); a.ay = M.round(ty, 2);
        if (inp.ap && a.ammo > 0) {
          const ix = tx + R.gauss() * 0.8, iy = ty + R.gauss() * 0.8;
          let ti = -1, best = 99;
          PTX.forEach((x, i) => { const d = Math.abs(ix - x); if (d < best) { best = d; ti = i; } });
          let v = 0;
          if (best < 26 && Math.abs(iy - PTY) < 32) {
            v = pistolScore(Math.hypot(ix - PTX[ti], iy - PTY));
            a.holes.push([M.round(ix, 1), M.round(iy, 1)]);
            if (a.sc5[ti] < 0) a.sc5[ti] = v; else { a.wasted++; v = -1; }
          } else { a.wasted++; v = -1; }
          a.ammo--; a.rec = 1; a.lastShot = s.t;
          a.lastV = v;
          OG.sfx(s, 'shot');
        }
        if (a.ammo <= 0 && s.t - a.lastShot > 0.45) { a.ph = 'end'; a.pt = 0; OG.sfx(s, 'ding'); }
        if (a.pt >= a.secs) { a.ph = 'end'; a.pt = 0; OG.sfx(s, 'buzzer'); }
        if (a.ph === 'end') {
          a.val = a.sc5.reduce((p, v) => p + Math.max(0, v), 0);
          if (a.val >= 48) OG.sfx(s, 'cheer');
        }
        return;
      }
      if (a.ph === 'end') { a.py += 160 * dt; if (a.pt >= 2.2) a.fin = 1; }
    },
    draw(g, s) {
      const a = s.a, cur = s.ents[s.cur];
      // ceiling / roof
      g.rect(0, 0, 480, 34, '#2a2530');
      for (let i = 0; i < 6; i++) { g.rect(i * 86 + 20, 4, 50, 4, '#fff6d5'); g.rect(i * 86 + 22, 8, 46, 2, 'rgba(255,246,213,0.25)'); }
      g.rect(0, 30, 480, 4, '#191520');
      // back wall (berm + wooden baffles)
      g.grad(0, 34, 480, 120, '#7d8b62', '#5f6e48', 6);
      for (let i = 0; i < 30; i++) g.rect(OG.hash(i, 1, 3) * 470, 40 + OG.hash(i, 2, 3) * 100, 6, 1, '#6b7a53');
      g.rect(0, 70, 480, 6, '#4a3a2a'); g.rect(0, 70, 480, 1, '#6a5640');
      // floor
      g.rect(0, 154, 480, 116, '#9a9284');
      for (let i = 0; i < 9; i++) { const y = 154 + i * i * 1.6; g.rect(0, y, 480, 1, 'rgba(0,0,0,0.08)'); }
      for (let i = -6; i <= 6; i++) g.line(240 + i * 40, 154, 240 + i * 150, 270, 'rgba(255,255,255,0.18)');
      g.rect(0, 152, 480, 3, '#5f5848');
      // side baffles
      g.poly([0, 34, 46, 50, 46, 154, 0, 200], '#4b4036'); g.poly([480, 34, 434, 50, 434, 154, 480, 200], '#4b4036');
      g.poly([0, 34, 12, 38, 12, 188, 0, 200], '#3a3029'); g.poly([480, 34, 468, 38, 468, 188, 480, 200], '#3a3029');
      // target frame
      g.rect(36, 84, 408, 4, '#3a4466'); g.rect(36, 154, 408, 3, '#3a4466');
      const live = a && a.ph === 'live';
      let turn = 1;
      if (!a || a.ph === 'ready') turn = a ? (a.pt > 1.5 ? (a.pt - 1.5) / 0.3 : 0) : 0;
      PTX.forEach((x, i) => {
        // lamp
        const on = live;
        g.rect(x - 6, 74, 12, 8, '#181425');
        g.circle(x, 78, 3, on ? '#63ff4d' : '#ff3b3b');
        g.alpha(0.25); g.circle(x, 78, 6, on ? '#63ff4d' : '#ff3b3b'); g.alpha(1);
        g.rect(x - 1, 88, 2, 4, '#3a4466');
        drawPistolTarget(g, x, PTY, M.clamp(turn, 0, 1));
        g.text(String(i + 1), x, 158, '#ffffff', { size: 'xs', align: 'center' });
        if (a && a.sc5[i] >= 0 && (a.ph === 'end' || live)) {
          const v = a.sc5[i];
          g.text(String(v), x, 90, v >= 9 ? PAL.yellow : PAL.white, { size: 'm', align: 'center', outline: PAL.black });
        }
      });
      if (a && turn >= 0.5) a.holes.forEach(p => { g.circle(p[0], p[1], 1.5, '#f4f0e0'); g.px(p[0], p[1], '#8a8270'); });
      // pistol overlay
      if (a && cur) PISTOL.gun(g, s, a, cur);
      // HUD
      if (a && cur) {
        g.panel(150, 6, 180, 28, { title: PISTOL.chunkName(s, a.si) });
        const rem = a.ph === 'live' ? Math.max(0, a.secs - a.pt) : a.ph === 'ready' ? a.secs : 0;
        g.bar(158, 14, 122, 9, rem / a.secs, rem / a.secs > 0.4 ? PAL.green : rem / a.secs > 0.2 ? PAL.gold : PAL.red);
        g.text(rem.toFixed(1) + 's', 322, 13, PAL.white, { size: 's', align: 'right' });
        for (let i = 0; i < 5; i++) {
          const bx = 160 + i * 9, by = 25;
          g.rect(bx, by, 5, 6, i < a.ammo ? '#feae34' : '#3a4466');
          if (i < a.ammo) g.rect(bx + 1, by - 1, 3, 1, '#b86f50');
        }
        const run = a.sc5.reduce((p, v) => p + Math.max(0, v), 0);
        g.text('합계 ' + (sum(s.sc[s.cur]) + run), 322, 23, PAL.yellow, { size: 'xs', align: 'right' });
        if (a.ph === 'ready') g.banner(a.pt < 1.2 ? '준비…' : '!', 168, PAL.orange, { size: 'xl' });
        if (a.ph === 'end' && a.pt < 2) {
          g.text('시리즈 ' + a.val + '점', 240, 176, a.val >= 48 ? PAL.yellow : PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
          if (a.wasted) g.text('낭비된 탄 ' + a.wasted, 240, 202, PAL.rose, { size: 's', align: 'center', outline: PAL.black });
        }
        if (s.ph === 'play' && a.ph === 'live') g.rich('{L}{R} 표적 이동  {A} 격발 (표적당 1발)', 240, 258, PAL.white, { align: 'center', shadow: true });
      }
    },
    gun(g, s, a, cur) {
      const x = Math.round(a.ax != null && a.ph !== 'ready' ? a.ax : a.px), y = Math.round(a.ph === 'live' || a.ph === 'end' ? (a.ay != null ? a.ay : a.py) : 300 - Math.min(1, a.pt / 1.8) * 60);
      const look = OG.lookOf(cur);
      const sk = look.skin, skD = OG.shade(sk, -0.22), skL = OG.shade(sk, 0.15);
      // forearm + sleeve (perspective, towards the bottom-right)
      g.poly([x - 11, y + 60, x + 13, y + 60, x + 74, 292, x + 14, 292], sk);
      g.poly([x + 9, y + 60, x + 13, y + 60, x + 74, 292, x + 62, 292], skD);
      const yS = Math.min(262, y + 112), kS = (yS - (y + 60)) / (292 - (y + 60));
      const lx0 = M.lerp(x - 11, x + 14, kS) - 3, rx0 = M.lerp(x + 13, x + 74, kS) + 3;
      g.poly([lx0, yS, rx0, yS, x + 92, 292, x + 4, 292], look.shirt);
      g.line(lx0, yS, rx0, yS, OG.shade(look.shirt, 0.3), 2);
      // hand around the grip (seen from behind)
      g.poly([x - 15, y + 28, x + 15, y + 28, x + 18, y + 50, x + 12, y + 64, x - 12, y + 64, x - 17, y + 48], sk);
      g.poly([x + 12, y + 30, x + 15, y + 28, x + 18, y + 50, x + 12, y + 64, x + 8, y + 62], skD);
      g.line(x - 16, y + 44, x - 7, y + 30, skL, 2);
      for (let k = 0; k < 3; k++) g.rect(x + 16, y + 36 + k * 7, 3, 4, skD);
      // slide rear face + frame
      g.rect(x - 13, y + 10, 26, 19, '#2b2b33');
      g.rect(x - 13, y + 10, 26, 2, '#4a4a58');
      for (let k = -9; k <= 9; k += 3) g.rect(x + k, y + 14, 1, 12, '#3a3a46');
      g.rect(x - 1, y + 20, 3, 3, '#5a5a66');
      g.rect(x - 12, y + 28, 24, 4, '#1c1c22');
      // rear sight blade with notch + front post
      g.rect(x - 16, y + 3, 13, 8, '#0e0d12'); g.rect(x + 4, y + 3, 13, 8, '#0e0d12');
      g.rect(x - 16, y + 9, 33, 3, '#0e0d12');
      g.rect(x - 1, y, 3, 9, '#000000');
      // muzzle flash
      const since = s.t - a.lastShot;
      if (since >= 0 && since < 0.07) {
        g.circle(x, y - 6, 8, '#fff6a8'); g.circle(x, y - 6, 4, '#ffffff');
        g.line(x - 14, y - 6, x + 14, y - 6, '#feae34', 2); g.line(x, y - 18, x, y + 2, '#feae34', 2);
      }
      if (since >= 0 && since < 0.5) {
        const k = since / 0.5;
        g.rect(x + 18 + k * 60, y + 10 - k * 40 + k * k * 90, 3, 2, '#e8c34a');
      }
    }
  };

  /* ================================================================== *
   * SKEET
   * ================================================================== */
  const SKEET_ST = [
    { n: 1, hx: 30, hs: 1.5, lx: 430, ls: 0.7,
      H: [60, 66, 500, 150, 18, 2.5, 1.5, 0.6], L: [425, 172, -40, 60, 40, 2.3, 0.6, 1.6] },
    { n: 3, hx: 58, hs: 1.1, lx: 420, ls: 0.85,
      H: [82, 84, 510, 120, 40, 2.4, 1.2, 0.8], L: [412, 170, -30, 92, 60, 2.2, 0.75, 1.3] },
    { n: 4, hx: 36, hs: 0.95, lx: 446, ls: 0.95,
      H: [56, 92, 520, 128, 46, 2.2, 1.0, 1.0], L: [436, 168, -40, 112, 72, 2.1, 0.9, 1.1] },
    { n: 6, hx: 70, hs: 0.75, lx: 440, ls: 1.35,
      H: [84, 108, 520, 40, 30, 2.3, 0.75, 1.5], L: [430, 160, -20, 132, 26, 2.4, 1.4, 0.75] }
  ];
  const SKEET_GRP = [['H'], ['L'], ['H', 'L']];
  const SKEET_GNAME = ['하이 하우스', '로우 하우스', '더블'];
  function clayPos(st, house, t, vr) {
    const P = SKEET_ST[st][house === 'H' ? 'H' : 'L'];
    const u = M.clamp(t / P[5], 0, 1.05), ue = u * (1.25 - 0.25 * u);
    const x = P[0] + (P[2] + vr * 14 - P[0]) * ue;
    const y = P[1] + (P[3] + vr * 10 - P[1]) * ue - P[4] * 4 * ue * (1 - ue);
    return [x, y, P[6] + (P[7] - P[6]) * ue];
  }
  const SKEET = {
    attempts: H => H <= 2 ? { n: 4, per: 1 } : H <= 4 ? { n: 2, per: 1 } : { n: 1, per: 1 },
    chunkName: (s, from) => '스테이션 ' + SKEET_ST[SKEET.stOf(s, from)].n,
    stOf: (s, i) => s.n >= 4 ? i : s.n === 2 ? [1, 3][i] : 2,
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.05);
      const p = M.clamp(0.3 + 0.72 * q, 0.05, 0.975);
      const out = [];
      for (let i = 0; i < s.n; i++) { let h = 0; for (let k = 0; k < 4; k++) if (R.chance(k >= 2 ? p * 0.95 : p)) h++; out.push(h); }
      return out;
    },
    total: arr => sum(arr),
    fmtTot: v => String(v),
    result(s, arr) { const t = sum(arr); return { score: t, text: t + '/' + (s.n * 4) }; },
    newTurn() { },
    start(s, R) {
      const si = s.sc[s.cur].length;
      s.a = {
        st: SKEET.stOf(s, si), si, grp: 0, ph: 'wait', pt: 0, rx: 240, ry: 196, vx: 0, vy: 0,
        clays: [], shells: 0, shots: [], bursts: [], res: [], dl: 0, val: 0, fin: 0, msg: '', msgT: -9
      };
    },
    update(s, a, inp, dt, R) {
      a.pt += dt;
      // reticle movement
      const tvx = ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * 330, tvy = ((inp.d ? 1 : 0) - (inp.u ? 1 : 0)) * 330;
      a.vx = M.approach(a.vx, tvx, 2400 * dt); a.vy = M.approach(a.vy, tvy, 2400 * dt);
      a.rx = M.clamp(a.rx + a.vx * dt, 6, 474); a.ry = M.clamp(a.ry + a.vy * dt, 10, 250);
      if (a.ph === 'wait') {
        if (inp.ap || a.pt > 3.2) { a.ph = 'call'; a.pt = 0; a.dl = R.range(0.2, 0.75); OG.sfx(s, 'beep'); }
      } else if (a.ph === 'call') {
        if (a.pt >= a.dl) {
          a.ph = 'fly'; a.pt = 0;
          a.clays = SKEET_GRP[a.grp].map(h => ({ h, t: 0, on: 1, hit: 0, vr: M.round(R.range(-1, 1), 2), x: 0, y: 0 }));
          a.shells = a.clays.length;
          OG.sfx(s, 'whoosh');
        }
      } else if (a.ph === 'fly') {
        a.clays.forEach(c => {
          if (!c.on) return;
          c.t += dt;
          const p = clayPos(a.st, c.h, c.t, c.vr);
          c.x = M.round(p[0], 1); c.y = M.round(p[1], 1);
          if (c.t > SKEET_ST[a.st][c.h].slice(5, 6)[0] * 1.02 || c.x < -20 || c.x > 500 || c.y > 280) { c.on = 0; }
        });
        if (inp.ap && a.shells > 0) {
          a.shells--;
          a.shots.push({ x: M.round(a.rx, 1), y: M.round(a.ry, 1), t0: M.round(s.t, 3), d: 0.05, done: 0 });
          OG.sfx(s, 'shot');
        }
        a.shots.forEach(sh => {
          if (sh.done) return;
          sh.d -= dt;
          if (sh.d <= 0) {
            sh.done = 1;
            a.clays.forEach(c => {
              if (!c.on) return;
              const rad = 9 + 3 * clayPos(a.st, c.h, c.t, c.vr)[2];
              if (Math.hypot(c.x - sh.x, c.y - sh.y) < rad) {
                c.on = 0; c.hit = 1;
                a.bursts.push({ x: c.x, y: c.y, t0: M.round(s.t, 3), s: M.round(clayPos(a.st, c.h, c.t, c.vr)[2], 2) });
                OG.sfx(s, 'crash'); a.msg = '명중!'; a.msgT = s.t;
              }
            });
          }
        });
        const pending = a.shots.some(sh => !sh.done);
        if (!pending && a.clays.every(c => !c.on)) {
          const hits = a.clays.filter(c => c.hit).length;
          a.clays.forEach(c => a.res.push(c.hit));
          if (hits < a.clays.length) { a.msg = hits ? '1/2 명중' : '실패'; a.msgT = s.t; OG.sfx(s, hits ? 'good' : 'miss'); }
          else if (a.clays.length === 2) { a.msg = '더블 명중!'; a.msgT = s.t; OG.sfx(s, 'cheer'); }
          a.ph = 'post'; a.pt = 0;
        }
      } else if (a.ph === 'post') {
        if (a.pt >= 1.0) {
          a.shots = a.shots.filter(sh => s.t - sh.t0 < 1);
          a.bursts = a.bursts.filter(b => s.t - b.t0 < 1.5);
          a.grp++;
          if (a.grp >= SKEET_GRP.length) { a.val = sum(a.res); a.fin = 1; }
          else { a.ph = 'wait'; a.pt = 0; a.clays = []; }
        }
      }
    },
    draw(g, s) {
      const a = s.a, cur = s.ents[s.cur];
      const st = SKEET_ST[a ? a.st : 2];
      const tt = s.t;
      // sky
      g.grad(0, 0, 480, 150, '#4b9be0', '#bfe6fa', 10);
      g.circle(400, 34, 10, '#fff8d0'); g.alpha(0.25); g.circle(400, 34, 16, '#fff8d0'); g.alpha(1);
      g.clouds(tt, 18, 3);
      g.mountains(96, 34, '#9bb8cf', 2.3, 0);
      g.mountains(116, 24, '#7a9eb2', 5.1, 40);
      g.trees(150, '#2f6b45', 3, 0, 11);
      g.trees(154, '#265c42', 7, 5, 9);
      // field
      g.rect(0, 152, 480, 118, '#5fae4e');
      for (let i = 0; i < 7; i++) { const y = 152 + i * i * 2.4; g.rect(0, y, 480, Math.max(1, i * 1.6), i % 2 ? '#68b957' : '#58a447'); }
      // semicircle walkway & stations
      for (let i = 0; i <= 40; i++) {
        const an = PI + i / 40 * PI;
        const x = 240 + Math.cos(an) * 230, y = 210 + Math.sin(an) * 34;
        g.rect(x - 3, y, 7, 2, '#d8d0bc');
      }
      g.rect(236, 168, 2, 10, '#ffffff'); g.rect(234, 166, 6, 3, '#e43b44'); // centre stake
      // high house
      const hs = st.hs, hx = st.hx, hb = 172;
      const hw = 34 * hs, hh = 92 * hs;
      g.rect(hx - hw / 2, hb - hh, hw, hh, '#e8e4d8');
      g.rect(hx + hw / 2 - 3 * hs, hb - hh, 3 * hs, hh, '#c8c0aa');
      g.poly([hx - hw / 2 - 4 * hs, hb - hh, hx + hw / 2 + 4 * hs, hb - hh, hx, hb - hh - 14 * hs], '#3e8948');
      g.rect(hx + hw / 2 - 12 * hs, hb - hh + 14 * hs, 12 * hs, 9 * hs, '#181425');
      g.text('H', hx - 4 * hs, hb - hh * 0.55, '#3a4466', { size: hs > 1.2 ? 'l' : 'm', align: 'center' });
      g.rect(hx - 6 * hs, hb - 22 * hs, 10 * hs, 22 * hs, '#8a5a3a');
      // low house
      const ls = st.ls, lx = st.lx, lb = 180;
      const lw = 40 * ls, lh = 26 * ls;
      g.rect(lx - lw / 2, lb - lh, lw, lh, '#e8e4d8');
      g.rect(lx - lw / 2, lb - lh, 3 * ls, lh, '#c8c0aa');
      g.rect(lx - lw / 2 - 2 * ls, lb - lh - 5 * ls, lw + 4 * ls, 5 * ls, '#3e8948');
      g.rect(lx - lw / 2 + 2 * ls, lb - lh + 6 * ls, 10 * ls, 7 * ls, '#181425');
      g.text('L', lx + 6 * ls, lb - lh + 6 * ls, '#3a4466', { size: 'm', align: 'center' });
      // station pad (foreground)
      g.poly([180, 270, 300, 270, 280, 246, 200, 246], '#c9c1ad');
      g.text(String(st.n), 240, 252, '#5a6988', { size: 'm', align: 'center' });
      if (a) {
        // clays
        a.clays.forEach(c => {
          if (!c.on) return;
          const sz = clayPos(a.st, c.h, c.t, c.vr)[2];
          const rx = Math.max(1.5, 3.2 * sz), ry = Math.max(1, 1.3 * sz);
          g.ellipse(c.x, c.y, rx, ry, '#f77622');
          g.rect(c.x - rx, c.y, rx * 2 + 1, 1, '#be4a2f');
          g.px(c.x - 1, c.y - 1, '#ffd08a');
        });
        // shot pattern
        a.shots.forEach(sh => {
          const k = (tt - sh.t0) / 0.25;
          if (k < 0 || k > 1) return;
          g.alpha(0.5 * (1 - k)); g.circleO(sh.x, sh.y, 4 + k * 12, '#ffffff'); g.alpha(1);
          for (let i = 0; i < 12; i++) {
            const an = OG.hash(i, Math.round(sh.t0 * 100), 1) * PI * 2, rr = OG.hash(i, Math.round(sh.t0 * 100), 2) * 12 * Math.min(1, k * 3);
            g.px(sh.x + Math.cos(an) * rr, sh.y + Math.sin(an) * rr, '#2b2b35');
          }
        });
        // bursts
        a.bursts.forEach(b => {
          const k = tt - b.t0;
          if (k < 0 || k > 1.4) return;
          const n0 = Math.round(b.t0 * 37);
          g.alpha(Math.max(0, 0.7 - k * 0.6));
          g.circle(b.x + k * 6, b.y + k * 4, 3 + k * 12 * b.s, '#c9864a');
          g.circle(b.x - 3 + k * 4, b.y + 2 + k * 3, 2 + k * 9 * b.s, '#8a5a3a');
          g.alpha(1);
          for (let i = 0; i < 14; i++) {
            const an = OG.hash(i, n0, 3) * PI * 2, sp = (30 + OG.hash(i, n0, 4) * 70) * b.s;
            const fx = b.x + Math.cos(an) * sp * k, fy = b.y + Math.sin(an) * sp * k + 90 * k * k;
            g.rect(fx, fy, OG.hash(i, n0, 5) > 0.5 ? 2 : 1, 1, i % 3 ? '#f77622' : '#181425');
          }
        });
        // reticle + barrel
        const rx = Math.round(a.rx), ry = Math.round(a.ry);
        SKEET.gun(g, s, a, cur, rx, ry);
        g.circleO(rx, ry, 12, 'rgba(255,255,255,0.75)');
        g.circleO(rx, ry, 13, 'rgba(0,0,0,0.35)');
        g.rect(rx - 1, ry - 1, 3, 3, '#ff3b3b');
        g.rect(rx - 18, ry, 5, 1, '#ffffff'); g.rect(rx + 14, ry, 5, 1, '#ffffff');
        g.rect(rx, ry - 18, 1, 5, '#ffffff'); g.rect(rx, ry + 14, 1, 5, '#ffffff');
        // "Pull!"
        if (a.ph === 'call') g.text('풀!', 210, 200, PAL.white, { size: 'l', align: 'center', outline: PAL.black });
        if (tt - a.msgT < 1.1 && a.msg) g.text(a.msg, 240, 70, a.msg.indexOf('명중') >= 0 ? PAL.yellow : PAL.lightgrey, { size: 'xl', align: 'center', outline: PAL.black });
      }
      // HUD
      if (a && cur) {
        const PY = 222;
        g.panel(6, PY, 146, 42, { title: '스테이션 ' + st.n });
        g.text(SKEET_GNAME[Math.min(a.grp, 2)], 14, PY + 8, PAL.yellow, { size: 's' });
        for (let i = 0; i < 2; i++) {
          const has = i < (a.ph === 'fly' ? a.shells : (a.ph === 'wait' || a.ph === 'call') ? SKEET_GRP[Math.min(a.grp, 2)].length : 0);
          g.rect(120 + i * 12, PY + 7, 8, 12, has ? '#e43b44' : '#3a4466'); g.rect(120 + i * 12, PY + 16, 8, 3, has ? '#feae34' : '#262b44');
        }
        // per-clay result row
        const prev = s.sc[s.cur];
        const tot = s.n * 4;
        const doneList = [];
        prev.forEach(v => { for (let k = 0; k < 4; k++) doneList.push(k < v ? 1 : 0); });
        a.res.forEach(v => doneList.push(v ? 1 : 0));
        for (let i = 0; i < tot; i++) {
          const x = 14 + i * 8, y = PY + 26;
          const v = doneList[i];
          if (v == null) g.ellipse(x, y + 2, 3, 1.5, '#5a6988');
          else if (v) g.ellipse(x, y + 2, 3, 1.5, '#f77622');
          else { g.line(x - 2, y, x + 2, y + 4, PAL.red); g.line(x + 2, y, x - 2, y + 4, PAL.red); }
        }
        if (s.ph === 'play') {
          const hint = a.ph === 'wait' ? '{A} 콜 (풀!) · {L}{R}{U}{D} 총 겨누기' : '{L}{R}{U}{D} 조준 · {A} 발사';
          g.rich(hint, 316, 258, PAL.white, { align: 'center', shadow: true });
        }
      }
    },
    gun(g, s, a, cur, rx, ry) {
      // over/under shotgun from the shoulder (bottom) towards the reticle
      const bx0 = rx + 1, by0 = ry + 17;
      const bx1 = 250 + rx * 0.45, by1 = 292;
      const dx = bx1 - bx0, dy = by1 - by0, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const P = (k, w) => [bx0 + dx * k + nx * w, by0 + dy * k + ny * w];
      const quad = (k0, w0, k1, w1, c) => { const a0 = P(k0, w0), a1 = P(k0, -w0), b1 = P(k1, -w1), b0 = P(k1, w1); g.poly([a0[0], a0[1], a1[0], a1[1], b1[0], b1[1], b0[0], b0[1]], c); };
      const wAt = k => 3 + k * 19;
      quad(0, wAt(0), 1, wAt(1), '#1a181e');
      quad(0, wAt(0) * 0.35, 1, wAt(1) * 0.35, '#2e2c36');
      // fore-end (wood) and leading hand
      quad(0.42, wAt(0.42) * 1.25, 0.72, wAt(0.72) * 1.25, '#7a3f22');
      quad(0.42, wAt(0.42) * 0.5, 0.72, wAt(0.72) * 0.5, '#94512c');
      const look = OG.lookOf(cur);
      const hp = P(0.55, -wAt(0.55) * 1.1);
      g.circle(hp[0], hp[1], 6 + 0.55 * 6, look.skin);
      g.circle(hp[0] + 2, hp[1] + 3, 4 + 0.55 * 4, OG.shade(look.skin, -0.18));
      const sl = P(0.95, -wAt(0.95) * 1.6);
      g.line(hp[0], hp[1] + 4, sl[0] - 20, 300, look.shirt, 14);
      // rib + bead
      g.line(bx0, by0 - 1, bx1, by1 - 3, '#5a5a66', 1);
      g.rect(bx0 - 1, by0 - 2, 2, 2, '#ffffff');
      const last = a.shots.length ? a.shots[a.shots.length - 1] : null;
      if (last && s.t - last.t0 < 0.07) {
        g.circle(bx0, by0 - 5, 9, '#fff3a0'); g.circle(bx0, by0 - 5, 4, '#ffffff');
      } else if (last && s.t - last.t0 < 0.5) {
        const k = (s.t - last.t0) / 0.5;
        g.alpha(0.4 * (1 - k)); g.circle(bx0 + k * 6, by0 - 6 - k * 10, 3 + k * 8, '#e8e8e8'); g.alpha(1);
      }
    }
  };

  const KINDS = { arch: ARCH, rifle: RIFLE, pistol: PISTOL, skeet: SKEET };

  /* ================================================================== *
   * generic turn system
   * ================================================================== */
  function revealed(s) {
    if (s.ph === 'final' || s.done) return s.n;
    if (!s.hum.length) return Math.floor(s.n * s.prog + 1e-9);
    return Math.floor(s.n * s.hd / Math.max(1, s.htot) + 1e-9);
  }
  function nextTurn(s, R) {
    const K = KINDS[s.kind];
    s.ti++;
    s.a = null;
    if (!s.hum.length) { s.ph = 'cpu'; s.pt = 0; return; }
    if (s.ti >= s.plan.length) { s.ph = 'final'; s.pt = 0; s.cur = -1; OG.sfx(s, 'cheer'); return; }
    const p = s.plan[s.ti];
    s.cur = p[0]; s.k = 0; s.pt = 0; s.ph = 'ban';
    const e = s.ents[s.cur];
    const chunk = K.chunkName(s, p[1]);
    s.ban = s.hum.length > 1
      ? { txt: e.tag + ' 차례', sub: e.name + ' · ' + chunk, col: pcol(e), code: e.country, t0: M.round(s.t, 3) }
      : { txt: chunk, sub: e.tag + ' ' + e.name, col: pcol(e), code: e.country, t0: M.round(s.t, 3) };
    K.newTurn(s, R);
    K.start(s, R);
    OG.sfx(s, 'ding');
  }
  function finish(s) {
    const K = KINDS[s.kind];
    const rows = s.ents.map((e, i) => {
      const arr = e.human ? s.sc[i] : s.cpu[i];
      const r = K.result(s, arr);
      return { idx: e.idx, score: r.score, text: r.text };
    });
    s.results = OG.sortResults(rows, false);
    s.done = true;
  }
  function drawBoard(g, s, x, y, w) {
    const K = KINDS[s.kind];
    const nr = revealed(s);
    const rows = s.ents.map((e, i) => {
      const arr = e.human ? s.sc[i] : s.cpu[i].slice(0, nr);
      return { e, i, tot: K.total(arr), n: arr.length };
    });
    rows.sort((p, q) => (q.tot - p.tot) || (p.i - q.i));
    const h = 12 + rows.length * 10;
    g.panel(x, y, w, h, { title: s.ph === 'final' ? '최종 순위' : '실시간 순위' });
    rows.forEach((r, j) => {
      const yy = y + 7 + j * 10;
      if (r.i === s.cur) g.rect(x + 2, yy - 1, w - 4, 10, OG.shade(pcol(r.e), -0.55));
      g.text(String(j + 1), x + 8, yy, j === 0 ? PAL.medalGold : j === 1 ? PAL.medalSilver : j === 2 ? PAL.medalBronze : PAL.grey, { size: 'xs', align: 'center' });
      g.flag(r.e.country, x + 15, yy + 1, 11, 7);
      g.text(OG.entLabel(r.e), x + 30, yy, OG.entColor(r.e), { size: 'xs' });
      g.text(K.fmtTot(r.tot), x + w - 6, yy, PAL.white, { size: 'xs', align: 'right' });
      // progress pips
      const pw = Math.max(10, Math.min(36, w - 92));
      g.rect(x + 54, yy + 3, pw, 2, '#262b44');
      g.rect(x + 54, yy + 3, Math.round(pw * r.n / s.n), 2, r.e.human ? pcol(r.e) : PAL.grey);
    });
  }
  function drawBanner(g, s) {
    const b = s.ban;
    if (!b) return;
    const d = s.t - b.t0;
    if (d < 0 || d > 1.9) return;
    const k = d < 0.2 ? d / 0.2 : d > 1.6 ? Math.max(0, 1 - (d - 1.6) / 0.3) : 1;
    const h = Math.round(50 * k), y = 112;
    g.alpha(0.9); g.rect(0, y - h / 2, 480, h, '#181425'); g.alpha(1);
    g.rect(0, y - h / 2, 480, 2, b.col); g.rect(0, y + h / 2 - 2, 480, 2, b.col);
    if (k > 0.7) {
      const tw = g.textW(b.txt, 'xl');
      const x0 = 240 - (tw + 40) / 2;
      g.flag(b.code, x0, y - 16, 30, 20, { wave: s.t });
      g.text(b.txt, x0 + 40, y - 17, b.col, { size: 'xl', outline: PAL.black });
      g.text(b.sub, 240, y + 9, PAL.white, { size: 's', align: 'center' });
    }
  }

  OG.defineEngine('target', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) {
      const cfg = ev.cfg || {};
      const K = KINDS[cfg.kind] || ARCH;
      const hum = [];
      ents.forEach((e, i) => { if (e.human) hum.push(i); });
      const at = K.attempts(hum.length);
      const s = {
        evId: ev.id, kind: KINDS[cfg.kind] ? cfg.kind : 'arch', comp: cfg.comp ? 1 : 0,
        t: -3, ph: 'cd', pt: 0,
        ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name || e.country, tag: e.tag || '', skill: e.skill, look: e.look | 0 })),
        hum, n: at.n, per: at.per, plan: [], ti: -1, cur: -1, k: 0,
        sc: ents.map(() => []), cpu: ents.map(() => null), hd: 0, htot: hum.length * at.n, prog: 0,
        ban: null, a: null, wind: M.round(R.range(-2, 2), 2), arr: [], holes: [], o2: 1,
        done: false, results: null
      };
      for (let f = 0; f < at.n; f += at.per) hum.forEach(h => s.plan.push([h, f, Math.min(at.per, at.n - f)]));
      ents.forEach((e, i) => { if (!e.human) s.cpu[i] = K.cpu(s, e, R); });
      return s;
    },
    update(s, inputs, dt, R) {
      if (s.done) return;
      const K = KINDS[s.kind];
      s.t += dt; s.pt += dt;
      if (s.ph === 'cd') { if (s.t >= 0) nextTurn(s, R); }
      else if (s.ph === 'ban') { if (s.pt >= 1.7) { s.ph = 'play'; s.pt = 0; } }
      else if (s.ph === 'play') {
        const e = s.ents[s.cur];
        const inp = (e && e.human && inputs && inputs[e.pid]) || BLANK;
        K.update(s, s.a, inp, dt, R);
        if (s.a.fin) {
          s.sc[s.cur].push(s.a.val); s.hd++; s.k++;
          if (s.k >= s.plan[s.ti][2]) nextTurn(s, R);
          else { K.start(s, R); }
        }
      } else if (s.ph === 'cpu') {
        s.prog = Math.min(1, s.pt / 6);
        if (s.pt > 6.5) { s.ph = 'final'; s.pt = 0; OG.sfx(s, 'cheer'); }
      } else if (s.ph === 'final') {
        if (s.pt > 2.4) finish(s);
      }
    },
    draw(g, s) {
      const K = KINDS[s.kind];
      K.draw(g, s);
      if (s.kind === 'arch') drawBoard(g, s, 368, 8, 108);
      else if (s.kind === 'rifle') drawBoard(g, s, 304, 138, 170);
      else if (s.kind === 'pistol') drawBoard(g, s, 372, 168, 104);
      else drawBoard(g, s, 368, 8, 108);
      drawBanner(g, s);
      if (s.ph === 'cd') g.countdown(-s.t);
      if (s.ph === 'cpu') g.banner('CPU 경기 진행 중…', 110, PAL.white, { size: 'l' });
      if (s.ph === 'final') g.banner('경기 종료', 100, PAL.yellow);
    }
  });

  OG.defineEvents([
    { id: 'archery_recurve', name: '양궁 리커브', en: 'Archery Recurve', sport: 'archery', icon: '🏹', tags: ['summer', 'asian'], engine: 'target',
      cfg: { kind: 'arch', comp: 0 },
      help: ['{A} 꾹 누르면 활시위 당기기, 떼면 발사', '{L}{R}{U}{D} 흔들림 잡고 조준 · 바람 방향 반대로 보정', '오래 버티면 팔이 떨려요!'] },
    { id: 'archery_compound', name: '양궁 컴파운드', en: 'Archery Compound', sport: 'archery', icon: '🏹', tags: ['summer', 'asian'], engine: 'target',
      cfg: { kind: 'arch', comp: 1 },
      help: ['{A} 꾹 누르면 당기기, 떼면 발사 (50m)', '{L}{R}{U}{D} 조준 · 피프 사이트 + 스코프', '10점 링이 작아요 — 정밀하게!'] },
    { id: 'shoot_rifle', name: '10m 공기소총', en: '10m Air Rifle', sport: 'shooting', icon: '🎯', tags: ['summer', 'asian'], engine: 'target',
      cfg: { kind: 'rifle' },
      help: ['{U} 꾹: 숨 참기 (흔들림 감소, 오래 참으면 떨림)', '{L}{R} 좌우 보정 · 숨 쉬면 조준이 위아래로', '{A} 격발 — 10.9점 만점'] },
    { id: 'shoot_pistol', name: '25m 속사권총', en: '25m Rapid Fire Pistol', sport: 'shooting', icon: '🔫', tags: ['summer', 'asian'], engine: 'target',
      cfg: { kind: 'pistol' },
      help: ['초록불: 제한시간 안에 표적 5개에 1발씩', '{L}{R} 다음 표적으로 이동 · {A} 격발', '이동·반동 직후엔 조준이 흔들려요'] },
    { id: 'shoot_skeet', name: '클레이 사격 스키트', en: 'Skeet', sport: 'shooting', icon: '🥏', tags: ['summer', 'asian'], engine: 'target',
      cfg: { kind: 'skeet' },
      help: ['{A} 콜! 하이/로우 하우스에서 클레이 발사', '{L}{R}{U}{D} 조준 · {A} 발사 (살짝 앞을 노려라)', '더블은 2발로 2개!'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
