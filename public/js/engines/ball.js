/* =========================================================================
 * engines: shootout (duel) — football PK, hockey / ice hockey / lacrosse
 *          shootouts, handball 7m, water polo penalty
 *          batting (solo)   — baseball / softball home run derby, cricket T20,
 *          rugby conversion kicks, flag football passing
 * Both use a small "3D-lite" perspective camera so every venue can be drawn
 * from behind the athlete.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI;
  const BLANK = OG.blankInput ? OG.blankInput() : { l: false, r: false, u: false, d: false, a: false };

  /* ================================================================== *
   * shared helpers
   * ================================================================== */
  const pcol = e => (e && e.human) ? OG.PCOLORS[e.pid % OG.PCOLORS.length] : PAL.lightgrey;
  const sum = arr => arr.reduce((p, v) => p + v, 0);
  // camera: {x,y,z,F,H}; looks towards -z, horizon at screen y = H
  // optional c.yaw: 0 = looking towards -z, + turns towards +x
  function depth(c, x, z) { return c.yaw ? (x - c.x) * Math.sin(c.yaw) - (z - c.z) * Math.cos(c.yaw) : c.z - z; }
  function P(c, x, y, z) {
    if (c.yaw) {
      const dx = x - c.x, dz = z - c.z, sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
      const d = Math.max(0.25, dx * sn - dz * cs), lat = dx * cs + dz * sn, s = c.F / d;
      return [240 + lat * s, c.H + (c.y - y) * s, s];
    }
    const dz = Math.max(0.25, c.z - z), s = c.F / dz;
    return [240 + (x - c.x) * s, c.H + (c.y - y) * s, s];
  }
  function clipSeg(c, a, b) {
    const n = 0.5;
    const d0 = depth(c, a[0], a[2]), d1 = depth(c, b[0], b[2]);
    if (d0 < n && d1 < n) return null;
    if (d0 < n) { const t = (n - d0) / (d1 - d0); a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    else if (d1 < n) { const t = (n - d1) / (d0 - d1); b = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t]; }
    return [a, b];
  }
  function L3(g, c, x0, y0, z0, x1, y1, z1, col, th) {
    const sg = clipSeg(c, [x0, y0, z0], [x1, y1, z1]);
    if (!sg) return;
    const a = P(c, sg[0][0], sg[0][1], sg[0][2]), b = P(c, sg[1][0], sg[1][1], sg[1][2]);
    if (Math.abs(a[0]) > 4000 || Math.abs(b[0]) > 4000 || Math.abs(a[1]) > 4000 || Math.abs(b[1]) > 4000) return;
    g.line(a[0], a[1], b[0], b[1], col, th || 1);
  }
  function Q3(g, c, pts, col) {
    const arr = [];
    for (const p of pts) { const q = P(c, p[0], p[1], c.yaw ? p[2] : Math.min(p[2], c.z - 0.5)); arr.push(q[0], q[1]); }
    g.poly(arr, col);
  }
  // polyline on the ground (y=0) given points [[x,z],...]
  function G3(g, c, pts, col, th, closed) {
    for (let i = 0; i < pts.length - 1 + (closed ? 1 : 0); i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      L3(g, c, a[0], 0, a[1], b[0], 0, b[1], col, th);
    }
  }
  function arcPts(cx, cz, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return out;
  }
  // horizontal ground bands (stripes) between z0 (near) and z1 (far)
  function bands(g, c, zFar, zNear, step, c1, c2, yTopClip) {
    let i = 0;
    for (let z = zFar; z < zNear; z += step, i++) {
      const y0 = P(c, 0, 0, z)[1], y1 = P(c, 0, 0, Math.min(zNear, z + step))[1];
      const ya = Math.max(yTopClip || 0, y0), yb = Math.min(270, y1);
      if (yb > ya) g.rect(0, ya, 480, yb - ya + 1, i % 2 ? c1 : c2);
    }
  }
  function stand(g, c, z, x0, x1, h, t, opt) { // crowd wall
    const a = P(c, x0, h, z), b = P(c, x1, 0, z);
    const top = Math.max(-10, a[1]), bot = Math.min(280, b[1]);
    if (bot <= top) return;
    g.crowd(Math.max(0, a[0]), top, Math.min(480, b[0]) - Math.max(0, a[0]), bot - top, t, opt || {});
  }

  /* ---------------- front / back view athlete ---------------- */
  // local joints (metres, hip origin, y up) after body rotation
  function figJ(o) {
    const rot = o.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const R = (px, py) => [px * cr + py * sr, -px * sr + py * cr];
    const cro = o.crouch || 0, sp = o.legs == null ? 0.1 : o.legs, sp2 = o.legs2 == null ? sp : o.legs2;
    const lg = 0.92 - cro * 0.22;
    const fL = [-Math.sin(sp) * lg, -Math.cos(sp) * lg], fR = [Math.sin(sp2) * lg, -Math.cos(sp2) * lg];
    const kL = [fL[0] * 0.5 - cro * 0.13, fL[1] * 0.5], kR = [fR[0] * 0.5 + cro * 0.13, fR[1] * 0.5];
    const w = o.bulky ? 0.25 : 0.2;
    const shL = [-w, 0.5], shR = [w, 0.5], neck = [0, 0.56], head = [0, 0.72];
    const lA = o.lA == null ? 0.25 : o.lA, rA = o.rA == null ? 0.25 : o.rA;
    const lE = o.lE || 0, rE = o.rE || 0;
    const eL = [shL[0] - Math.sin(lA) * 0.3, shL[1] - Math.cos(lA) * 0.3], eR = [shR[0] + Math.sin(rA) * 0.3, shR[1] - Math.cos(rA) * 0.3];
    const hL = [eL[0] - Math.sin(lA + lE) * 0.3, eL[1] - Math.cos(lA + lE) * 0.3], hR = [eR[0] + Math.sin(rA + rE) * 0.3, eR[1] - Math.cos(rA + rE) * 0.3];
    const J = { fL, fR, kL, kR, shL, shR, neck, head, eL, eR, hL, hR, hipL: [-0.1, 0], hipR: [0.1, 0], hip: [0, 0] };
    for (const key in J) J[key] = R(J[key][0], J[key][1]);
    J.hipY = 0.95 - cro * 0.3;
    return J;
  }
  // x,y = screen point of the feet (when upright, no lift); k = px per metre
  // look: {shirt,pants,skin,hair,sock,shoe,glove,helmet,cap,pads,num}
  function ffig(g, x, y, k, look, o) {
    o = o || {};
    const J = figJ(o);
    const lift = o.lift || 0;
    const hx = x, hy = y - (J.hipY + lift) * k;
    const S = p => [hx + p[0] * k, hy - p[1] * k];
    const tl = Math.max(2, Math.round((look.pads ? 0.24 : 0.13) * k)), ta = Math.max(2, Math.round(0.11 * k));
    const ln = (a, b, col, th) => { const A = S(a), B = S(b); g.line(A[0], A[1], B[0], B[1], col, th); };
    const pants = look.pants || PAL.navy, shirt = look.shirt || PAL.red, skin = look.skin || PAL.skin2;
    const sock = look.sock || shirt, shoe = look.shoe || PAL.black;
    const legs = () => {
      [['hipL', 'kL', 'fL'], ['hipR', 'kR', 'fR']].forEach(L => {
        if (look.pads) { ln(J[L[0]], J[L[1]], pants, tl); ln(J[L[1]], J[L[2]], look.pads, tl); }
        else { ln(J[L[0]], J[L[1]], look.tights ? pants : skin, tl); ln(J[L[1]], J[L[2]], sock, tl); }
        const F = S(J[L[2]]);
        g.rect(F[0] - tl / 2 - 1, F[1] - Math.max(1, k * 0.05), tl + 2, Math.max(2, k * 0.08), shoe);
        if (look.blade) g.rect(F[0] - tl / 2 - 2, F[1] + Math.max(1, k * 0.03), tl + 4, 1, '#d0d8e0');
      });
      // shorts
      const a = S([-0.19, 0.02]), b = S([0.19, 0.02]), c2 = S([0.21, -0.22]), d2 = S([-0.21, -0.22]);
      if (!o.rot) g.poly([a[0], a[1], b[0], b[1], c2[0], c2[1], d2[0], d2[1]], pants);
      else { ln([-0.1, 0], [-0.12, -0.2], pants, tl + 2); ln([0.1, 0], [0.12, -0.2], pants, tl + 2); }
    };
    const torso = () => {
      const a = S(J.shL), b = S(J.shR), c2 = S(J.hipR), d2 = S(J.hipL);
      const wx = Math.max(1, k * 0.06);
      g.poly([a[0] - (o.rot ? 0 : wx), a[1], b[0] + (o.rot ? 0 : wx), b[1], c2[0] + wx, c2[1], d2[0] - wx, d2[1]], shirt);
      ln(J.neck, J.hip, shirt, Math.max(3, Math.round(0.36 * k)));
      if (look.num && k > 26 && o.back && !o.rot) {
        const n = S([0, 0.28]);
        g.text(String(look.num), n[0], n[1] - 4, look.numC || '#ffffff', { size: k > 60 ? 'm' : 'xs', align: 'center' });
      }
    };
    const arms = () => {
      [['shL', 'eL', 'hL'], ['shR', 'eR', 'hR']].forEach(A => {
        ln(J[A[0]], J[A[1]], look.sleeves ? shirt : (look.armC || skin), ta);
        ln(J[A[1]], J[A[2]], look.sleeves ? (look.glove ? shirt : skin) : (look.armC || skin), ta);
        if (o.sleeveTop !== false) ln(J[A[0]], [J[A[0]][0] * 0.6 + J[A[1]][0] * 0.4, J[A[0]][1] * 0.6 + J[A[1]][1] * 0.4], shirt, ta + 1);
        const H = S(J[A[2]]);
        g.circle(H[0], H[1], Math.max(1, (look.glove ? 0.09 : 0.06) * k), look.glove || skin);
      });
    };
    const head = () => {
      const H = S(J.head), r = Math.max(2, 0.13 * k);
      if (look.helmet) {
        g.circle(H[0], H[1], r + 1, look.helmet);
        if (!o.back) { g.rect(H[0] - r * 0.6, H[1] - r * 0.1, r * 1.2, r * 0.9, skin); for (let i = -1; i <= 1; i++) g.rect(H[0] + i * r * 0.4, H[1] - r * 0.1, 1, r * 0.9, look.cage || '#d0d0d0'); g.rect(H[0] - r * 0.7, H[1] + r * 0.2, r * 1.4, 1, look.cage || '#d0d0d0'); }
        return;
      }
      g.circle(H[0], H[1], r, skin);
      const hair = look.cap || look.hair || PAL.black;
      if (o.back) g.circle(H[0], H[1] - 1, r, hair);
      else {
        g.rect(H[0] - r, H[1] - r, r * 2 + 1, r * 0.8, hair);
        g.circle(H[0], H[1] - r * 0.35, r * 0.95, hair);
        g.rect(H[0] - r * 0.7, H[1] - r * 0.2, r * 1.4 + 1, r * 1.1, skin);
        if (k > 22) { g.px(H[0] - r * 0.35, H[1] + r * 0.1, PAL.black); g.px(H[0] + r * 0.35, H[1] + r * 0.1, PAL.black); }
      }
      if (look.cap && look.capEars) { g.rect(H[0] - r - 1, H[1], 2, r * 0.6, look.cap); g.rect(H[0] + r - 1, H[1], 2, r * 0.6, look.cap); }
    };
    if (!o.noLegs) legs();
    torso(); head(); if (!o.noArms) arms();
    const out = {};
    for (const key in J) if (Array.isArray(J[key])) out[key] = S(J[key]);
    out.k = k;
    return out;
  }
  const keeperKits = ['#feae34', '#63c74d', '#2ce8f5', '#b55088', '#fee761', '#f77622'];
  function keeperKit(e, avoid) {
    let i = (e.look >> 2) % keeperKits.length;
    for (let n = 0; n < keeperKits.length && avoid && OG.mix(keeperKits[i], avoid, 0) === avoid; n++) i = (i + 1) % keeperKits.length;
    return keeperKits[i];
  }

  /* ================================================================== *
   * SHOOTOUT (duel)
   * ================================================================== */
  const SO = {
    pk: { fam: 'spot', gw: 7.32, gh: 2.44, dist: 11, dep: 2.0, br: 0.11, camX: 0, camY: 2.9, camB: 12.5, F: 560, HZ: 56, aimT: 5, base: 0, pg: 0.74, ballC: '#ffffff' },
    hand: { fam: 'spot', gw: 3, gh: 2, dist: 7, dep: 0.9, br: 0.095, camX: 1.0, camY: 2.6, camB: 10, F: 560, HZ: 58, aimT: 3.5, base: 0, pg: 0.76, ballC: '#fee761' },
    polo: { fam: 'spot', gw: 3, gh: 0.9, dist: 5, dep: 0.7, br: 0.11, camX: 0.9, camY: 1.7, camB: 8.5, F: 580, HZ: 96, aimT: 4, base: -1.05, pg: 0.7, ballC: '#fee761' },
    hockey: { fam: 'run', gw: 3.66, gh: 2.14, z0: 22.9, time: 8, br: 0.04, vmax: 6.6, acc: 15, dep: 1.2, pg: 0.6, W: 13, ballC: '#ffffff', spd: 22 },
    ice: { fam: 'run', gw: 1.83, gh: 1.22, z0: 22, time: 11, br: 0.05, vmax: 9.5, acc: 6.5, dep: 1.1, pg: 0.36, W: 12, ballC: '#181425', spd: 26 },
    lax: { fam: 'run', gw: 1.83, gh: 1.83, z0: 14, time: 8, br: 0.04, vmax: 6.4, acc: 13, dep: 2.1, pg: 0.58, W: 12, ballC: '#ffffff', spd: 28, crease: 2.74 }
  };
  const SO_NAMES = { pk: ['키커', '골키퍼'], hand: ['슈터', '골키퍼'], polo: ['슈터', '골키퍼'], hockey: ['공격수', '골키퍼'], ice: ['공격수', '골리'], lax: ['공격수', '골리'] };
  const REG = 5;

  function inpOf(inputs, e) { return (e && e.human && inputs && inputs[e.pid]) || null; }
  function soCam(s) {
    const C = SO[s.sty], k = s.k;
    if (C.fam === 'spot') return { x: C.camX, y: C.camY, z: C.dist + C.camB, F: C.F, H: C.HZ };
    const px = k ? k.cx : 0, pz = k ? k.cz : C.z0;
    const back = s.sty === 'lax' ? 10 : 11.5;
    return { x: px, y: 4.2, z: pz + back, F: 470, H: 60 };
  }

  // keeper pose → ffig options + world anchor
  function gkPose(s, k) {
    const C = SO[s.sty];
    const t = s.t;
    const sty = s.sty;
    let o = { crouch: 0.3, lA: 0.85, rA: 0.85, lE: 0.3, rE: 0.3, legs: 0.2 }, off = 0, lift = 0;
    if (sty === 'polo') o = { crouch: 0, lA: 1.2, rA: 1.2, lE: 0.4, rE: 0.4, legs: 0.1 };
    if (sty === 'ice') o = { crouch: 0.55, lA: 0.7, rA: 0.75, lE: 0.5, rE: 0.4, legs: 0.42 };
    if (sty === 'hockey') o = { crouch: 0.45, lA: 0.7, rA: 0.6, lE: 0.4, rE: 0.4, legs: 0.3 };
    if (sty === 'lax') o = { crouch: 0.2, lA: 1.0, rA: 0.7, lE: 1.0, rE: 1.2, legs: 0.22 };
    if (k.gm === 0 || k.gt0 < 0) return { o, off, lift };
    const DT = { pk: 0.34, hand: 0.2, polo: 0.26, hockey: 0.3, ice: 0.22, lax: 0.25 }[sty];
    const e = M.clamp((t - k.gt0 - 0.04) / DT, 0, 1);
    const fall = M.clamp((t - k.gt0 - DT - 0.35) / 0.3, 0, 1);
    const d = k.gd, h = k.gh;
    if (k.gm === 1) {
      if (sty === 'pk' || sty === 'hockey') {
        const rr = [1.4, 1.2, 0.95][h];
        o = { crouch: 0, rot: d * e * rr, lA: PI - 0.2, rA: PI - 0.2, legs: 0.18, legs2: 0.3 };
        off = d * e * [1.35, 1.05, 0.8][h] * (sty === 'hockey' ? 0.9 : 1);
        lift = e * (1 - e * 0.25) * [0.15, 0.55, 0.9][h] * (1 - fall) + (sty === 'hockey' ? 0 : 0);
        if (sty === 'hockey') { o.rA = 1.2; o.lA = PI - 0.3; }
      } else if (sty === 'hand') {
        o = { crouch: 0, rot: d * e * 0.35, lA: d < 0 ? 1.4 + h * 0.5 : 1.2, rA: d > 0 ? 1.4 + h * 0.5 : 1.2, legs: d < 0 ? 0.25 + e * 0.6 : 0.2, legs2: d > 0 ? 0.25 + e * 0.6 : 0.2 };
        off = d * e * 0.45; lift = e * 0.18 * h;
      } else if (sty === 'polo') {
        o = { crouch: 0, rot: d * e * 0.85, lA: PI - 0.25, rA: PI - 0.25, legs: 0.1 };
        off = d * e * 0.75; lift = e * [0.35, 0.6, 0.8][h] * (1 - fall * 0.7);
      } else if (sty === 'ice') {
        o = { crouch: 0.75, rot: d * e * 0.25, lA: d < 0 ? 1.6 : 0.7, rA: d > 0 ? 1.6 : 0.7, legs: d < 0 ? 1.35 : 1.1, legs2: d > 0 ? 1.35 : 1.1 };
        off = d * e * 0.6; lift = -e * 0.12;
      } else { // lax
        o = { crouch: 0.3, rot: d * e * 0.3, lA: d < 0 ? 2.2 : 1.0, rA: d > 0 ? 2.2 : 1.0, legs: 0.35 };
        off = d * e * 0.55;
      }
    } else if (k.gm === 2) { // jump / up
      o = { crouch: 0, lA: PI - 0.2, rA: PI - 0.2, legs: 0.12 };
      lift = Math.sin(e * PI / 2) * (sty === 'polo' ? 0.7 : 0.45) * (1 - fall);
    } else if (k.gm === 3) { // butterfly / spread
      if (sty === 'ice' || sty === 'hockey') { o = { crouch: 0.8, lA: 1.2, rA: 1.25, lE: 0.3, rE: 0.3, legs: 1.45, legs2: 1.45 }; lift = -0.15 * e; }
      else { o = { crouch: 0.1, lA: 1.9, rA: 1.9, legs: 0.55 }; lift = 0.1 * e; }
    }
    return { o, off, lift };
  }
  // keeper blocks a point (bx,by) in world metres at its plane?
  function gkBlocks(s, k, bx, by, br) {
    const C = SO[s.sty];
    const gp = gkPose(s, k);
    const J = figJ(gp.o);
    const base = C.base;
    const hx = k.gx + gp.off, hy = base + J.hipY + gp.lift;
    const W = p => [hx + p[0], hy + p[1]];
    const pads = s.sty === 'ice' || s.sty === 'hockey';
    const segs = [
      [J.hip, J.fL, pads ? 0.24 : 0.12], [J.hip, J.fR, pads ? 0.24 : 0.12], [J.hip, J.neck, s.sty === 'ice' ? 0.3 : 0.22],
      [J.shL, J.hL, 0.1], [J.shR, J.hR, 0.1], [J.head, J.head, 0.15], [J.hL, J.hL, pads ? 0.2 : 0.13], [J.hR, J.hR, pads ? 0.17 : 0.13]
    ];
    if (s.sty === 'lax') segs.push([J.hR, [J.hR[0] + 0.1, J.hR[1] + 0.6], 0.2]);
    if (s.sty === 'polo') segs.forEach(sg => { if (sg[0] === J.hip) sg[2] += 0.05; });
    for (const sg of segs) {
      const a = W(sg[0]), b = W(sg[1]);
      const abx = b[0] - a[0], aby = b[1] - a[1], L2 = abx * abx + aby * aby;
      const tt = L2 > 0 ? M.clamp(((bx - a[0]) * abx + (by - a[1]) * aby) / L2, 0, 1) : 0;
      const d = Math.hypot(bx - (a[0] + abx * tt), by - (a[1] + aby * tt));
      if (d < sg[2] + br) return true;
    }
    // under-water/below-ice parts never block above surface; polo keeper body under water ignored
    return false;
  }

  function newKick(s, R) {
    const C = SO[s.sty];
    s.shI = s.half === 0 ? s.first : 1 - s.first;
    s.kpI = 1 - s.shI;
    const sh = s.ents[s.shI], kp = s.ents[s.kpI];
    const qs = OG.cpuQuality(sh, R, 0.1), qk = OG.cpuQuality(kp, R, 0.1);
    const k = {
      ph: 'ready', pt: 0, res: '', resT: -1, gx: 0, gz: C.fam === 'spot' ? 0.25 : 0.5, gd: 0, gm: 0, gh: 1, gt0: -1,
      bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0, kickT: -1, tx: 0, ty: 0, ta: 0, hitT: -1, hx: 0, hy: 0,
      qs: M.round(qs, 3), qk: M.round(qk, 3), kAt: -1, kD: 0, kH: 1, kM: 1
    };
    if (C.fam === 'spot') {
      Object.assign(k, { ax: 0, ay: 0.45, pw: 0, fk: 0, fkT: -9, auto: 0, show: 1, sx: -2.2, sz: C.dist + 2.6 });
      k.bx = 0; k.by = C.br; k.bz = C.dist;
      if (!sh.human) {
        const corner = R.chance(0.35 + 0.4 * qs);
        k.cax = M.round(R.sign() * (corner ? R.range(0.62, 0.9) : R.range(0.15, 0.7)), 3);
        k.cay = M.round(corner ? (R.chance(0.5) ? R.range(0.1, 0.3) : R.range(0.55, 0.85)) : R.range(0.1, 0.75), 3);
        k.cpw = M.round(M.clamp(0.68 + 0.18 * qs + R.gauss() * 0.09, 0.45, 1.12), 3);
        k.cdl = M.round(R.range(0.7, 1.9), 3);
        k.cfk = (s.sty !== 'pk' && R.chance(0.45)) ? M.round(R.range(0.3, k.cdl - 0.1), 3) : -1;
      }
      if (!kp.human) {
        k.kEarly = R.chance(0.16) ? M.round(R.range(0.25, 0.45), 3) : -1;
        k.kRead = R.chance((s.sty === 'pk' ? 0.22 : 0.32) + 0.33 * qk) ? 1 : 0;
      }
    } else {
      Object.assign(k, { px: R.range(-1.5, 1.5), pz: C.z0, vx: 0, vz: 0, bo: 0, dk: 0, bph: 0, has: 1, clk: 0, chg: 0, chgOn: 0,
        gvx: 0, gvz: 0, cd: 0, cx: 0, cz: C.z0, stealT: -1 });
      k.px = M.round(k.px, 2); k.cx = k.px * 0.55;
      if (!sh.human) {
        k.cw = M.round(R.range(-2.5, 2.5), 2); k.cwT = 0;
        k.csd = M.round((s.sty === 'hockey' ? R.range(6.5, 11) : s.sty === 'ice' ? R.range(4, 8) : R.range(6.5, 10)) * (1.1 - qs * 0.2), 2);
        k.cdk = R.chance(0.3 + 0.3 * qs) ? 1 : 0;
      }
    }
    s.k = k;
  }

  function endKick(s, R, scored) {
    s.hist[s.shI].push(scored ? 1 : 0);
    if (scored) s.sc[s.shI]++;
    s.half = 1 - s.half;
    if (s.half === 0) s.rnd++;
    const w = decided(s);
    if (w >= 0) { s.win = w; s.ph = 'final'; s.pt = 0; OG.sfx(s, 'whistle'); OG.sfx(s, 'cheer'); return; }
    const cap = SO[s.sty].fam === 'spot' ? REG + 5 : REG + 3;
    if (s.rnd >= cap && s.half === 0) { // still tied → draw lots
      s.win = R.f() < 0.5 ? 0 : 1; s.lots = 1; s.ph = 'final'; s.pt = 0; OG.sfx(s, 'whistle'); return;
    }
    newKick(s, R);
  }
  function decided(s) {
    const a = s.first, b = 1 - a;
    const na = s.hist[a].length, nb = s.hist[b].length;
    if (na <= REG && nb <= REG) {
      const ra = REG - na, rb = REG - nb;
      if (s.sc[a] > s.sc[b] + rb) return a;
      if (s.sc[b] > s.sc[a] + ra) return b;
      if (na === REG && nb === REG && s.sc[a] !== s.sc[b]) return s.sc[a] > s.sc[b] ? a : b;
      return -1;
    }
    if (na === nb && s.sc[a] !== s.sc[b]) return s.sc[a] > s.sc[b] ? a : b;
    return -1;
  }

  /* -------------------- spot family (pk / hand / polo) -------------------- */
  function gkCommit(s, k, d, h, mode) {
    if (k.gm) return;
    k.gm = mode; k.gd = d; k.gh = h; k.gt0 = M.round(s.t, 3);
    OG.sfx(s, s.sty === 'polo' ? 'splash' : 'whoosh');
  }
  function spotKick(s, R, sh) {
    const C = SO[s.sty], k = s.k;
    const human = sh.human;
    let ax = k.ax, ay = k.ay, pw = k.pw, sig, spd;
    if (!human) { ax = k.cax; ay = k.cay; }
    if (s.sty === 'pk') {
      if (!human) pw = k.cpw;
      sig = human ? 0.05 + 0.35 * Math.max(0, pw - 0.88) : 0.06 + 0.22 * (1 - k.qs);
      spd = M.lerp(13, 31, M.clamp(pw, 0, 1.05));
      ay += Math.max(0, pw - 0.97) * 3.2;
    } else {
      sig = human ? 0.05 : 0.05 + 0.2 * (1 - k.qs);
      spd = s.sty === 'hand' ? 24 : 18;
      if (!human) spd += k.qs * 3;
      pw = 0.8;
    }
    const tx = (ax + R.gauss() * sig) * C.gw / 2;
    const ty = Math.max(C.br * 0.8, (ay + R.gauss() * sig * 0.8) * C.gh);
    k.tx = M.round(tx, 3); k.ty = M.round(ty, 3); k.pw = M.round(pw, 3);
    const d = Math.hypot(C.dist, tx, ty);
    k.ta = M.round(d / spd, 3); k.kickT = M.round(s.t, 3); k.ph = 'fly'; k.pt = 0;
    if (s.sty === 'hand') { k.bx = -0.3; k.by = 2.5; k.bz = C.dist + 0.1; }
    else if (s.sty === 'polo') { k.bx = -0.35; k.by = 1.0; k.bz = C.dist + 0.3; }
    k.sx0 = M.round(k.bx, 3); k.sy0 = M.round(k.by, 3); k.sz0 = M.round(k.bz, 3);
    OG.sfx(s, s.sty === 'pk' ? 'kick' : 'throw');
    // CPU keeper reaction
    const kp = s.ents[s.kpI];
    if (!kp.human && !k.gm) {
      const side = Math.abs(tx) < C.gw * 0.12 ? 0 : M.sign(tx);
      const hh = ty < C.gh * 0.33 ? 0 : ty < C.gh * 0.7 ? 1 : 2;
      let dd, mm;
      if (k.kRead) { dd = side; mm = side === 0 ? (hh === 2 ? 2 : 0) : 1; }
      else { const r = R.f(); dd = r < 0.43 ? -1 : r < 0.86 ? 1 : 0; mm = dd ? 1 : (R.chance(0.5) ? 2 : 0); }
      k.kAt = M.round(s.t + (s.sty === 'pk' ? 0.1 - 0.05 * k.qk : 0.06 - 0.04 * k.qk), 3);
      k.kD = dd; k.kH = k.kRead ? hh : R.i(3); k.kM = mm;
    }
  }
  function spotUpdate(s, inputs, dt, R) {
    const C = SO[s.sty], k = s.k;
    const sh = s.ents[s.shI], kp = s.ents[s.kpI];
    const si = inpOf(inputs, sh), ki = inpOf(inputs, kp);
    k.pt += dt;
    // keeper (human) – may commit any time after "ready"
    if (ki && k.ph !== 'ready' && k.ph !== 'res' && !k.gm) {
      if (ki.lp || ki.rp) gkCommit(s, k, ki.lp ? -1 : 1, ki.u ? 2 : ki.d ? 0 : 1, 1);
      else if (ki.up) gkCommit(s, k, 0, 2, 2);
      else if (ki.dp && s.sty === 'hand') gkCommit(s, k, 0, 1, 3);
    }
    // keeper (CPU)
    if (!kp.human && !k.gm) {
      if (k.ph === 'run' && k.kEarly >= 0 && k.pt >= k.kEarly) {
        const r = R.f(); gkCommit(s, k, r < 0.5 ? -1 : 1, R.i(3), 1);
      }
      if (k.kAt > 0 && s.t >= k.kAt) { if (k.kM === 0) k.gm = -1; else gkCommit(s, k, k.kD, k.kH, k.kM); }
      // fake bites (handball / water polo)
      if (k.fkT > 0 && s.t - k.fkT > 0.12 && s.t - k.fkT < 0.2 && !k.bit) {
        k.bit = 1;
        if (R.chance(0.42 - 0.3 * k.qk)) gkCommit(s, k, R.sign(), R.i(3), 1);
      }
    }
    if (k.gm === -1) k.gm = 0;
    if (k.ph === 'ready') {
      k.sx = -2.2; k.sz = C.dist + 2.6;
      if (k.pt >= 1.2) { k.ph = 'aim'; k.pt = 0; OG.sfx(s, 'whistle'); }
    } else if (k.ph === 'aim') {
      if (si) {
        const sp = 1.25 * dt;
        if (si.l) k.ax -= sp; if (si.r) k.ax += sp; if (si.u) k.ay += sp * 0.8; if (si.d && s.sty === 'pk') k.ay -= sp * 0.8;
        k.ax = M.clamp(k.ax, -1.25, 1.25); k.ay = M.clamp(k.ay, 0, 1.3);
        if (si.dp && s.sty !== 'pk' && k.fk < 2 && s.t - k.fkT > 0.45) { k.fk++; k.fkT = M.round(s.t, 3); k.bit = 0; OG.sfx(s, 'swing'); }
        if (si.ap || k.pt > C.aimT) { k.auto = si.ap ? 0 : 1; k.ph = 'run'; k.pt = 0; if (kp.human) k.show = 0; }
      } else {
        k.ax = M.approach(k.ax, k.cax, 0.9 * dt); k.ay = M.approach(k.ay, k.cay, 0.7 * dt);
        if (k.cfk > 0 && k.pt >= k.cfk && !k.fk) { k.fk = 1; k.fkT = M.round(s.t, 3); k.bit = 0; OG.sfx(s, 'swing'); }
        if (k.pt >= k.cdl) { k.ph = 'run'; k.pt = 0; if (kp.human) k.show = 0; }
      }
      if (kp.human && !sh.human) k.show = 0;
    } else if (k.ph === 'run') {
      if (s.sty === 'pk') {
        const u = Math.min(1, k.pt / 0.55);
        k.sx = M.lerp(-2.2, -0.55, u); k.sz = M.lerp(C.dist + 2.6, C.dist + 0.35, u);
        k.pw = Math.min(1.25, k.pt * 1.3);
        if (si) {
          const sp = 0.6 * dt;
          if (si.l) k.ax -= sp; if (si.r) k.ax += sp; if (si.u) k.ay += sp; if (si.d) k.ay -= sp;
          k.ax = M.clamp(k.ax, -1.25, 1.25); k.ay = M.clamp(k.ay, 0, 1.3);
          if ((si.ap && k.pt > 0.12 && !k.auto) || (k.auto && k.pw >= 0.8) || k.pw >= 1.25) spotKick(s, R, sh);
        } else if (k.pw >= k.cpw || k.pw >= 1.25) spotKick(s, R, sh);
      } else {
        const dur = s.sty === 'hand' ? 0.5 : 0.38;
        if (si) {
          const sp = 0.7 * dt;
          if (si.l) k.ax -= sp; if (si.r) k.ax += sp; if (si.u) k.ay += sp;
          k.ax = M.clamp(k.ax, -1.25, 1.25); k.ay = M.clamp(k.ay, 0, 1.3);
        }
        if (k.pt >= dur) spotKick(s, R, sh);
      }
    } else if (k.ph === 'fly') {
      const u = (s.t - k.kickT) / k.ta;
      const uu = Math.min(1, u);
      const arc = s.sty === 'pk' ? 0.35 * (1.1 - Math.min(1, k.pw)) : s.sty === 'polo' ? 0.25 : 0.15;
      k.bx = M.round(M.lerp(k.sx0, k.tx, uu), 3);
      k.by = M.round(M.lerp(k.sy0, k.ty, uu) + arc * 4 * uu * (1 - uu), 3);
      k.bz = M.round(M.lerp(k.sz0, 0, uu), 3);
      if (u >= 1) spotResolve(s, R);
    } else if (k.ph === 'res') {
      ballPhys(s, k, dt);
      if (k.pt >= 2.1) endKick(s, R, k.res === 'goal');
    }
  }
  function spotResolve(s, R) {
    const C = SO[s.sty], k = s.k;
    const ax = Math.abs(k.tx), hw = C.gw / 2;
    k.ph = 'res'; k.pt = 0; k.resT = M.round(s.t, 3);
    const spd = Math.hypot(C.dist, k.tx, k.ty) / k.ta;
    const inFrame = ax < hw - C.br && k.ty < C.gh - C.br;
    const post = !inFrame && ax < hw + C.br * 1.5 && k.ty < C.gh + C.br * 1.5 && (ax > hw - C.br * 1.5 || k.ty > C.gh - C.br * 1.5);
    if (gkBlocks(s, k, k.tx, k.ty, C.br) && ax < hw + 0.5 && k.ty < C.gh + 0.4) {
      k.res = 'save';
      k.vx = M.round((k.tx - k.gx) * 2 + R.range(-3, 3), 2); k.vy = M.round(R.range(1, 4), 2); k.vz = M.round(spd * R.range(0.15, 0.3), 2);
      OG.sfx(s, 'block'); OG.sfx(s, 'crowd');
    } else if (post) {
      k.res = 'post';
      k.vx = M.round(-M.sign(k.tx) * R.range(1, 4), 2); k.vy = M.round(R.range(0, 3), 2); k.vz = M.round(spd * 0.35, 2);
      OG.sfx(s, 'bell'); OG.sfx(s, 'crowd');
    } else if (inFrame) {
      k.res = 'goal'; k.hx = k.tx; k.hy = k.ty;
      k.vx = M.round(k.tx * 0.3, 2); k.vy = 0; k.vz = M.round(-spd * 0.5, 2);
      OG.sfx(s, 'net'); OG.sfx(s, 'cheer');
    } else {
      k.res = 'miss';
      k.vx = M.round(k.tx / C.dist * spd, 2); k.vy = M.round(k.ty / C.dist * spd * 0.5, 2); k.vz = M.round(-spd * 0.8, 2);
      OG.sfx(s, 'miss'); OG.sfx(s, 'crowd');
    }
  }
  function ballPhys(s, k, dt) {
    const C = SO[s.sty];
    k.vy -= 9.8 * dt;
    k.bx += k.vx * dt; k.by += k.vy * dt; k.bz += k.vz * dt;
    if (k.res === 'goal' && k.bz < -C.dep * 0.85) { k.bz = -C.dep * 0.85; k.vz = 0; k.vx *= 0.5; }
    const floor = s.sty === 'polo' ? 0.05 : C.br;
    if (k.by < floor) { k.by = floor; k.vy = Math.abs(k.vy) * (s.sty === 'polo' ? 0.1 : 0.45); k.vx *= 0.8; k.vz *= 0.8; }
    k.bx = M.round(k.bx, 3); k.by = M.round(k.by, 3); k.bz = M.round(k.bz, 3);
    k.vx = M.round(k.vx, 3); k.vy = M.round(k.vy, 3); k.vz = M.round(k.vz, 3);
  }

  /* -------------------- run family (hockey / ice / lax) -------------------- */
  function runShoot(s, R, sh, si) {
    const C = SO[s.sty], k = s.k;
    const human = sh.human;
    const bx = k.px + k.bo, bz = k.pz - 0.55;
    const dist = Math.hypot(bx, bz);
    // aim side: explicit (held) or the bigger gap left by the keeper
    const kxAt = bz > 0.3 ? k.gx * 1 : 0;
    const gapL = (kxAt - (-C.gw / 2)), gapR = (C.gw / 2 - kxAt);
    let side = gapL > gapR ? -1 : 1, hi = 0.35;
    if (s.sty === 'ice' && R.chance(0.15)) side = -side;
    if (human && si) {
      if (s.sty !== 'ice') { if (si.l) side = -1; else if (si.r) side = 1; }
      hi = si.u ? 0.8 : (si.d && s.sty === 'lax') ? 0.08 : (s.sty === 'hockey' ? 0.12 : 0.35);
    } else {
      hi = R.chance(0.5) ? R.range(0.08, 0.3) : R.range(0.5, 0.85);
      if (s.sty === 'hockey' && R.chance(0.6)) hi = 0.1;
    }
    let tx = side * (C.gw / 2 - 0.22), ty = hi * C.gh;
    let sig = (s.sty === 'hockey' ? 0.13 : s.sty === 'ice' ? 0.1 : 0.09) + dist * 0.017 + Math.hypot(k.vx, k.vz) * 0.012;
    if (s.sty === 'lax') sig += Math.abs(k.chg - 0.7) * 0.5;
    if (!human) sig *= 1.45 - k.qs * 0.75;
    tx += R.gauss() * sig; ty = Math.max(C.br, ty + R.gauss() * sig * 0.7);
    let spd = C.spd * (s.sty === 'lax' ? M.clamp(0.55 + k.chg * 0.6, 0.6, 1.15) : 1);
    if (s.sty === 'hockey' && hi > 0.5) spd *= 0.75;
    const dx = tx - bx, dy = ty - 0.1, dz = -bz, L = Math.hypot(dx, dy, dz);
    k.bx = M.round(bx, 3); k.by = s.sty === 'lax' ? 1.7 : C.br; k.bz = M.round(bz, 3);
    k.vx = M.round(dx / L * spd, 3); k.vy = M.round((ty - k.by) / L * spd + (s.sty === 'lax' && hi < 0.15 ? -6 : 0), 3); k.vz = M.round(dz / L * spd, 3);
    k.tx = M.round(tx, 3); k.ty = M.round(ty, 3);
    k.has = 0; k.ph = 'shot'; k.pt = 0; k.kickT = M.round(s.t, 3);
    k.crossed = 0;
    OG.sfx(s, s.sty === 'lax' ? 'throw' : 'hit');
    // CPU keeper reaction plan
    const kp = s.ents[s.kpI];
    if (!kp.human) {
      const read = R.chance(0.35 + 0.4 * k.qk);
      k.kAt = M.round(s.t + 0.16 - 0.1 * k.qk, 3);
      k.kD = read ? M.sign(tx - k.gx) : R.sign(); k.kH = ty > C.gh * 0.55 ? 2 : 1;
      k.kM = (s.sty === 'ice' && (!read || ty < C.gh * 0.45)) ? 3 : 1;
      if (read && Math.abs(tx - k.gx) < 0.3) k.kM = s.sty === 'ice' ? 3 : 2;
    } else {
      k.kAt = M.round(s.t + 0.3, 3); k.kD = M.sign(tx - k.gx); k.kH = 1; k.kM = 0; // slow auto reaction only if the keeper did nothing
    }
  }
  function runUpdate(s, inputs, dt, R) {
    const C = SO[s.sty], k = s.k;
    const sh = s.ents[s.shI], kp = s.ents[s.kpI];
    const si = inpOf(inputs, sh), ki = inpOf(inputs, kp);
    k.pt += dt;
    if (k.ph === 'ready') {
      if (k.pt >= 1.2) { k.ph = 'play'; k.pt = 0; OG.sfx(s, 'whistle'); }
      return;
    }
    // ---- keeper movement ----
    if (k.ph === 'play' || k.ph === 'shot') {
      if (ki) {
        const sp = s.sty === 'ice' ? 4.5 : 4;
        const tvx = ((ki.r ? 1 : 0) - (ki.l ? 1 : 0)) * sp, tvz = ((ki.u ? 1 : 0) - (ki.d ? 1 : 0)) * sp * 0.8;
        if (!k.gm) { k.gvx = M.approach(k.gvx, tvx, 30 * dt); k.gvz = M.approach(k.gvz, tvz, 30 * dt); }
        else { k.gvx *= 0.9; k.gvz *= 0.9; }
        if (ki.ap && !k.gm && k.cd <= 0) {
          const d = ki.l ? -1 : ki.r ? 1 : 0;
          gkCommit(s, k, d, ki.u ? 2 : 1, d ? 1 : 3);
          k.cd = 1.4;
        }
      } else if (k.ph === 'play') {
        // CPU keeper: stay on the line ball→goal centre
        const bx = k.px + k.bo, bz = Math.max(0.5, k.pz - 0.55);
        const out = M.clamp(0.6 + bz * (s.sty === 'ice' ? 0.07 : 0.11), 0.5, s.sty === 'ice' ? 1.6 : 3.2);
        const tz = Math.min(out, bz - 0.8);
        const tx = bx * tz / bz;
        const sp = (s.sty === 'ice' ? 4.2 : 3.8) * (0.75 + 0.35 * k.qk);
        if (!k.gm) {
          k.gvx = M.approach(k.gvx, M.clamp((tx - k.gx) * 6, -sp, sp), 25 * dt);
          k.gvz = M.approach(k.gvz, M.clamp((tz - k.gz) * 4, -sp, sp), 20 * dt);
        } else { k.gvx *= 0.9; k.gvz *= 0.9; }
        // challenge (poke / slide) when the attacker is close
        const dd = Math.hypot(bx - k.gx, bz - k.gz);
        if (!k.gm && k.cd <= 0 && dd < 2.4 && R.chance(dt * (1.2 + 1.5 * k.qk))) {
          gkCommit(s, k, M.sign(bx - k.gx), 1, s.sty === 'ice' ? 3 : 1); k.cd = 1.6;
        }
      }
      k.gx = M.clamp(k.gx + k.gvx * dt, -C.gw / 2 - 1.2, C.gw / 2 + 1.2);
      k.gz = M.clamp(k.gz + k.gvz * dt, 0.3, s.sty === 'lax' ? C.crease - 0.3 : 5);
      k.cd = Math.max(0, k.cd - dt);
      if (k.gm && s.t - k.gt0 > 1.1 && k.ph === 'play') { k.gm = 0; k.gt0 = -1; }
      k.gx = M.round(k.gx, 3); k.gz = M.round(k.gz, 3); k.gvx = M.round(k.gvx, 3); k.gvz = M.round(k.gvz, 3);
    }
    if (k.ph === 'play') {
      k.clk += dt;
      // ---- attacker ----
      let ix = 0, iz = 0, shoot = false;
      if (si) {
        ix = (si.r ? 1 : 0) - (si.l ? 1 : 0);
        iz = (si.u ? 1 : 0) - (si.d ? 0.6 : 0);
        if (s.sty === 'lax') {
          if (si.a) { k.chgOn = 1; k.chg = Math.min(1.3, k.chg + dt * 1.6); }
          else if (k.chgOn) shoot = true;
        } else if (si.ap) shoot = true;
        if (s.sty === 'ice') { if (si.lp) k.dk = -0.75; if (si.rp) k.dk = 0.75; }
      } else {
        // CPU attacker
        k.cwT -= dt;
        if (k.cwT <= 0) { k.cw = M.round(R.range(-2.6, 2.6), 2); k.cwT = R.range(0.8, 1.5); if (s.sty === 'ice') k.dk = R.chance(0.5) ? 0.7 : -0.7; }
        let wx = k.cw;
        const dist = Math.hypot(k.px, k.pz);
        if (k.cdk && dist < 7 && Math.abs(k.gx - k.px) < 1) wx = k.px + (k.px > k.gx ? 3 : -3);
        ix = M.clamp((wx - k.px) * 0.8, -1, 1); iz = 1;
        if (s.sty === 'ice' && dist < 6 && R.chance(dt * 3)) k.dk = -M.sign(k.gx - k.px || 1) * 0.75;
        if (s.sty === 'lax') { if (dist < k.csd + 1.5) { k.chgOn = 1; k.chg = Math.min(1.2, k.chg + dt * 1.6); } }
        if (dist < k.csd && (s.sty !== 'lax' || k.chg > 0.6)) shoot = true;
        if (k.clk > C.time - 0.6) shoot = true;
        if (k.pz < 3 && Math.abs(k.px) < 2.5) shoot = true;
      }
      if (si && k.clk > C.time - 0.05 && s.sty !== 'ice') shoot = shoot || false;
      const vmax = C.vmax * (k.chgOn && s.sty === 'lax' ? 0.7 : 1);
      if (s.sty === 'ice') {
        k.vz = M.approach(k.vz, -(iz > 0 ? vmax : iz < 0 ? 3 : 5.5), C.acc * dt);
        k.vx = M.approach(k.vx, ix * 4.5, 5 * dt);
        k.bo = M.approach(k.bo, k.dk, 6 * dt);
        if (Math.abs(k.bo - k.dk) < 0.01) k.dk *= 0.9;
      } else {
        const sp = Math.hypot(ix, iz) || 1;
        const tvx = ix / sp * vmax * (ix || iz ? 1 : 0), tvz = -iz / sp * vmax;
        k.vx = M.approach(k.vx, tvx, C.acc * dt); k.vz = M.approach(k.vz, tvz, C.acc * dt);
        k.bph += dt * (Math.hypot(k.vx, k.vz) * 0.9 + 2);
        k.bo = s.sty === 'hockey' ? Math.sin(k.bph * 2.2) * 0.32 : 0;
      }
      k.px = M.round(M.clamp(k.px + k.vx * dt, -C.W, C.W), 3);
      k.pz = M.round(k.pz + k.vz * dt, 3);
      k.vx = M.round(k.vx, 3); k.vz = M.round(k.vz, 3); k.bo = M.round(k.bo, 3); k.bph = M.round(k.bph, 3);
      k.cx = M.round(M.lerp(k.cx, k.px * 0.55, Math.min(1, dt * 3)), 3); k.cz = M.round(M.lerp(k.cz, Math.max(k.pz, 3.5), Math.min(1, dt * 4)), 3);
      // steal by keeper
      const bx = k.px + k.bo, bz = k.pz - 0.55;
      const reach = k.gm ? (s.sty === 'ice' ? 1.3 : 1.2) : 0.75;
      const gp = k.gm ? gkPose(s, k).off : 0;
      if (Math.hypot(bx - (k.gx + gp), bz - k.gz) < reach && (s.sty !== 'lax' || k.gm)) {
        k.ph = 'res'; k.pt = 0; k.res = 'save'; k.resT = M.round(s.t, 3); k.has = 0; k.stealT = M.round(s.t, 3);
        k.bx = M.round(bx, 3); k.by = C.br; k.bz = M.round(bz, 3); k.vx = M.round(R.range(-4, 4), 2); k.vy = 1; k.vz = 3;
        OG.sfx(s, 'block'); OG.sfx(s, 'crowd'); return;
      }
      if (s.sty === 'lax' && Math.hypot(k.px, k.pz) < C.crease) {
        k.ph = 'res'; k.pt = 0; k.res = 'crease'; k.resT = M.round(s.t, 3); k.has = 1; OG.sfx(s, 'whistle'); return;
      }
      if (shoot && k.pz > 0.8) { runShoot(s, R, sh, si); return; }
      if (k.clk >= C.time || k.pz < 0.2 || Math.abs(k.px) > C.W - 0.1) {
        k.ph = 'res'; k.pt = 0; k.res = 'time'; k.resT = M.round(s.t, 3); OG.sfx(s, 'buzzer'); return;
      }
    } else if (k.ph === 'shot') {
      if (!k.gm && k.kAt > 0 && s.t >= k.kAt && k.kM) gkCommit(s, k, k.kD, k.kH, k.kM);
      if (!k.gm && k.kAt > 0 && s.t >= k.kAt && !k.kM && kp.human) { gkCommit(s, k, k.kD, 1, 1); k.gt0 += 0.05; }
      const pz = k.bz;
      k.vy -= (s.sty === 'lax' ? 6 : 3) * dt;
      k.bx += k.vx * dt; k.by += k.vy * dt; k.bz += k.vz * dt;
      if (k.by < C.br) { k.by = C.br; k.vy = Math.abs(k.vy) * 0.6; OG.sfx(s, 'bounce'); }
      // crossing the keeper plane
      if (!k.crossed && pz >= k.gz && k.bz < k.gz) {
        k.crossed = 1;
        if (gkBlocks(s, k, k.bx - (k.gz > 0 ? 0 : 0), k.by, C.br)) {
          k.ph = 'res'; k.pt = 0; k.res = 'save'; k.resT = M.round(s.t, 3);
          k.vx = M.round(R.range(-5, 5), 2); k.vy = M.round(R.range(1, 4), 2); k.vz = M.round(Math.abs(k.vz) * 0.3, 2);
          OG.sfx(s, 'block'); OG.sfx(s, 'crowd');
        }
      }
      if (k.ph === 'shot' && k.bz <= 0) {
        const hw = C.gw / 2, ax = Math.abs(k.bx);
        k.ph = 'res'; k.pt = 0; k.resT = M.round(s.t, 3);
        if (ax < hw - C.br && k.by < C.gh - C.br) { k.res = 'goal'; k.hx = k.bx; k.hy = k.by; k.vz *= 0.4; k.vx *= 0.3; OG.sfx(s, 'net'); OG.sfx(s, 'cheer'); }
        else if (ax < hw + C.br * 2 && k.by < C.gh + C.br * 2) { k.res = 'post'; k.vz = Math.abs(k.vz) * 0.3; k.vx = -k.vx * 0.5; OG.sfx(s, 'bell'); OG.sfx(s, 'crowd'); }
        else { k.res = 'miss'; OG.sfx(s, 'miss'); OG.sfx(s, 'crowd'); }
      }
      if (k.ph === 'shot' && s.t - k.kickT > 2) { k.ph = 'res'; k.pt = 0; k.res = 'miss'; k.resT = M.round(s.t, 3); }
      k.bx = M.round(k.bx, 3); k.by = M.round(k.by, 3); k.bz = M.round(k.bz, 3); k.vy = M.round(k.vy, 3);
    } else if (k.ph === 'res') {
      if (!k.has) ballPhys(s, k, dt);
      if (k.pt >= 2.1) endKick(s, R, k.res === 'goal');
    }
  }

  /* -------------------- shootout drawing -------------------- */
  function drawGoal(g, c, s, front) {
    const C = SO[s.sty], k = s.k;
    const hw = C.gw / 2, gh = C.gh, dep = C.dep, base = 0;
    const frame = s.sty === 'ice' ? '#e43b44' : s.sty === 'lax' ? '#f77622' : '#ffffff';
    const netC = 'rgba(255,255,255,0.55)', netF = 'rgba(255,255,255,0.10)';
    const rip = (k && k.res === 'goal') ? Math.max(0, 1 - (s.t - k.resT) / 1.2) : 0;
    const bulge = (x, y) => rip ? 0.45 * rip * Math.exp(-((x - k.hx) * (x - k.hx) + (y - k.hy) * (y - k.hy)) / 0.35) * (0.7 + 0.3 * Math.sin((s.t - k.resT) * 25)) : 0;
    if (!front) {
      const pyr = s.sty === 'lax';
      // net back planes
      if (pyr) {
        Q3(g, c, [[-hw, 0, 0], [hw, 0, 0], [0, 0, -dep]], netF);
        Q3(g, c, [[-hw, gh, 0], [-hw, 0, 0], [0, 0, -dep]], netF);
        Q3(g, c, [[hw, gh, 0], [hw, 0, 0], [0, 0, -dep]], netF);
        for (let i = 0; i <= 8; i++) {
          const x = -hw + i * C.gw / 8;
          L3(g, c, x, gh * (1 - Math.abs(x) / hw * 0) * (i === 0 || i === 8 ? 1 : 1), 0, 0, 0, -dep, netC);
        }
        for (let i = 1; i <= 5; i++) { const t = i / 6; L3(g, c, -hw * (1 - t), gh * (1 - t), -dep * t, hw * (1 - t), gh * (1 - t), -dep * t, netC); }
      } else {
        const topB = s.sty === 'pk' ? gh * 0.95 : gh * 0.9;
        Q3(g, c, [[-hw, 0, -dep], [hw, 0, -dep], [hw, topB, -dep], [-hw, topB, -dep]], netF);
        Q3(g, c, [[-hw, gh, 0], [hw, gh, 0], [hw, topB, -dep], [-hw, topB, -dep]], netF);
        Q3(g, c, [[-hw, 0, 0], [-hw, gh, 0], [-hw, topB, -dep], [-hw, 0, -dep]], netF);
        Q3(g, c, [[hw, 0, 0], [hw, gh, 0], [hw, topB, -dep], [hw, 0, -dep]], netF);
        const nx = Math.max(6, Math.round(C.gw / 0.25)), ny = Math.max(4, Math.round(topB / 0.22));
        for (let i = 0; i <= nx; i++) {
          const x = -hw + i * C.gw / nx;
          let py = null;
          for (let j = 0; j <= 6; j++) {
            const y = topB * j / 6;
            const z = -dep - bulge(x, y);
            const p = P(c, x, y, z);
            if (py) g.line(py[0], py[1], p[0], p[1], netC);
            py = p;
          }
          L3(g, c, x, gh, 0, x, topB, -dep, netC);
        }
        for (let j = 0; j <= ny; j++) {
          const y = topB * j / ny;
          let px = null;
          for (let i = 0; i <= 10; i++) {
            const x = -hw + i * C.gw / 10;
            const p = P(c, x, y, -dep - bulge(x, y));
            if (px) g.line(px[0], px[1], p[0], p[1], netC);
            px = p;
          }
          L3(g, c, -hw, y * gh / topB, 0, -hw, y, -dep, netC); L3(g, c, hw, y * gh / topB, 0, hw, y, -dep, netC);
        }
        if (s.sty === 'hockey') { // backboard + sideboards
          Q3(g, c, [[-hw, 0, -dep], [hw, 0, -dep], [hw, 0.46, -dep], [-hw, 0.46, -dep]], '#5a3a2a');
          Q3(g, c, [[-hw, 0, 0], [-hw, 0.46, 0], [-hw, 0.46, -dep], [-hw, 0, -dep]], '#6b4632');
          Q3(g, c, [[hw, 0, 0], [hw, 0.46, 0], [hw, 0.46, -dep], [hw, 0, -dep]], '#6b4632');
        }
        if (s.sty === 'ice') {
          L3(g, c, -hw, 0, 0, -hw * 0.9, 0, -dep, frame, 2); L3(g, c, hw, 0, 0, hw * 0.9, 0, -dep, frame, 2); L3(g, c, -hw * 0.9, 0, -dep, hw * 0.9, 0, -dep, frame, 2);
        }
      }
      return;
    }
    // posts + bar
    const a = P(c, -hw, base, 0), b = P(c, hw, gh, 0);
    const th = Math.max(2, Math.round(0.11 * a[2]));
    const postC = s.sty === 'hand' ? '#e43b44' : frame;
    if (s.sty === 'hand') {
      const seg = 6;
      for (let i = 0; i < seg; i++) {
        const c1 = i % 2 ? '#ffffff' : '#e43b44';
        const y0 = gh * i / seg, y1 = gh * (i + 1) / seg;
        L3(g, c, -hw, y0, 0, -hw, y1, 0, c1, th); L3(g, c, hw, y0, 0, hw, y1, 0, c1, th);
      }
      for (let i = 0; i < 10; i++) { const x0 = -hw + C.gw * i / 10, x1 = -hw + C.gw * (i + 1) / 10; L3(g, c, x0, gh, 0, x1, gh, 0, i % 2 ? '#ffffff' : '#e43b44', th); }
    } else {
      L3(g, c, -hw, 0, 0, -hw, gh, 0, postC, th); L3(g, c, hw, 0, 0, hw, gh, 0, postC, th); L3(g, c, -hw, gh, 0, hw, gh, 0, postC, th);
      L3(g, c, -hw + 0.03, 0.02, 0, -hw + 0.03, gh - 0.03, 0, 'rgba(0,0,0,0.18)', 1);
    }
    if (s.sty === 'pk' || s.sty === 'polo') { L3(g, c, -hw, gh, 0, -hw, gh * 0.95, -0.3, postC, 1); L3(g, c, hw, gh, 0, hw, gh * 0.95, -0.3, postC, 1); }
    if (s.sty === 'polo') { // floating frame
      L3(g, c, -hw - 0.3, 0.02, 0, hw + 0.3, 0.02, 0, '#e8e8e8', th);
    }
  }
  function drawBall(g, c, s, x, y, z, col) {
    const C = SO[s.sty];
    const p = P(c, x, y, z);
    if (p[1] < -20 || p[1] > 300) return;
    // shadow
    if (s.sty !== 'polo' || y > 0.12) {
      const sh = P(c, x, s.sty === 'polo' ? 0 : 0, z);
      const r0 = Math.max(1, C.br * sh[2]);
      g.ellipse(sh[0], sh[1], r0 * 1.2, Math.max(1, r0 * 0.4), s.sty === 'polo' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)');
    }
    const r = Math.max(1.2, C.br * p[2]);
    if (s.sty === 'ice') { g.ellipse(p[0], p[1], r * 1.4, Math.max(1, r * 0.6), col); return; }
    g.circle(p[0], p[1], r, col);
    if (r > 3) {
      if (s.sty === 'pk') { g.px(p[0] - r * 0.3, p[1] - r * 0.2, '#181425'); g.px(p[0] + r * 0.4, p[1] + r * 0.3, '#181425'); g.rect(p[0] - 1, p[1] - 1, 2, 2, '#181425'); }
      if (s.sty === 'polo' || s.sty === 'hand') { g.line(p[0] - r, p[1], p[0] + r, p[1], s.sty === 'polo' ? '#0099db' : '#e43b44'); }
      g.px(p[0] - r * 0.5, p[1] - r * 0.5, '#ffffff');
    }
  }
  function soEnv(g, c, s) {
    const sty = s.sty, t = s.t;
    const k = s.k;
    const exc = k && k.res === 'goal' ? Math.max(0.15, 1 - (s.t - k.resT) / 2.5) : 0.08;
    if (sty === 'pk') {
      g.grad(0, 0, 480, 120, '#3d6fb3', '#9fd0f0', 6);
      stand(g, c, -34, -90, 90, 15, t, { excite: exc * 0.6, seed: 4, bg: '#2b3352' });
      const t2 = P(c, 0, 15, -34)[1];
      g.rect(0, 0, 480, Math.max(0, t2), '#20263f');
      for (let i = 0; i < 8; i++) { g.rect(20 + i * 62, Math.max(2, t2 - 7), 30, 3, '#fff6d5'); g.alpha(0.2); g.rect(14 + i * 62, Math.max(5, t2 - 4), 42, 5, '#fff6d5'); g.alpha(1); }
      const tier = P(c, 0, 6.5, -20)[1];
      g.rect(0, tier - 3, 480, 4, '#4a5378');
      stand(g, c, -20, -70, 70, 6.5, t, { excite: exc, seed: 3 });
      const ab0 = P(c, -40, 1.0, -5), ab1 = P(c, 40, 0, -5);
      g.rect(0, ab1[1] - 4, 480, 6, '#3a7a3a');
      g.adBoards(0, ab0[1], 480, Math.max(4, ab1[1] - ab0[1]), t, ['DOT GAMES 2026', 'PIXEL CUP', 'AICHI-NAGOYA', 'GOAL!']);
      g.rect(0, ab1[1], 480, 270 - ab1[1], '#4c9a45');
      bands(g, c, -5, c.z, 3, '#55a74c', '#4c9a45', ab1[1]);
      const W = 'rgba(255,255,255,0.85)';
      L3(g, c, -40, 0, 0, 40, 0, 0, W, 2);
      G3(g, c, [[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]], W, 2);
      G3(g, c, [[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]], W, 2);
      G3(g, c, arcPts(0, 11, 9.15, 0.93, PI - 0.93, 14), W, 2);
      const sp = P(c, 0, 0, 11); g.ellipse(sp[0], sp[1], 3, 1, '#ffffff');
    } else if (sty === 'hand') {
      g.rect(0, 0, 480, 270, '#1a1d2e');
      for (let i = 0; i < 7; i++) { g.rect(10 + i * 70, 4, 40, 3, '#fff6d5'); g.alpha(0.15); g.rect(i * 70, 7, 60, 6, '#fff6d5'); g.alpha(1); }
      stand(g, c, -9, -30, 30, 9, t, { excite: exc, seed: 8, bg: '#2a2f48' });
      const ab0 = P(c, -22, 0.8, -4), ab1 = P(c, 22, 0, -4);
      g.adBoards(0, ab0[1], 480, Math.max(4, ab1[1] - ab0[1]), t, ['HANDBALL', 'DOT GAMES', '7M THROW', 'AICHI-NAGOYA']);
      g.rect(0, ab1[1], 480, 270 - ab1[1], '#2367b0');
      bands(g, c, -4, c.z, 2, '#2367b0', '#2a6fb8', ab1[1]);
      // goal area (6 m) lighter
      const gpts = [[-1.5 - 6, 0]].concat(arcPts(-1.5, 0, 6, PI, PI / 2, 8)).concat(arcPts(1.5, 0, 6, PI / 2, 0, 8)).concat([[7.5, 0]]);
      const poly = []; gpts.forEach(p => { const q = P(c, p[0], 0, p[1]); poly.push(q[0], q[1]); });
      g.poly(poly, '#4f97d8');
      G3(g, c, gpts.slice(1, -1), '#ffffff', 2);
      L3(g, c, -12, 0, 0, 12, 0, 0, '#ffffff', 2);
      const p9 = arcPts(-1.5, 0, 9, PI, PI / 2, 10).concat(arcPts(1.5, 0, 9, PI / 2, 0, 10));
      for (let i = 0; i < p9.length - 1; i += 2) G3(g, c, [p9[i], p9[i + 1]], '#ffffff', 1);
      L3(g, c, -0.5, 0, 7, 0.5, 0, 7, '#ffffff', 2);
      L3(g, c, -0.08, 0, 4, 0.08, 0, 4, '#ffffff', 1);
    } else if (sty === 'polo') {
      g.grad(0, 0, 480, 80, '#4a90d0', '#a6d8f4', 5);
      stand(g, c, -14, -30, 30, 8, t, { excite: exc, seed: 11 });
      const deck0 = P(c, 0, 0.6, -6), deck1 = P(c, 0, 0, -6);
      g.rect(0, deck0[1] - 3, 480, deck1[1] - deck0[1] + 4, '#d8d0bc');
      g.adBoards(0, deck0[1] - 10, 480, 7, t, ['WATER POLO', 'DOT GAMES', 'PENALTY 5M', 'SPLASH!']);
      const wy = deck1[1];
      g.rect(0, wy, 480, 270 - wy, '#1f7fd0');
      bands(g, c, -6, c.z, 1.5, '#2389da', '#1f7fd0', wy);
      for (let i = 0; i < 70; i++) {
        const wz = -5 + OG.hash(i, 1, 4) * (c.z - 6), wx = (OG.hash(i, 2, 4) - 0.5) * 30;
        const p = P(c, wx + Math.sin(t * 1.5 + i) * 0.3, 0, wz);
        g.rect(p[0], p[1], Math.max(2, p[2] * 0.4), 1, 'rgba(255,255,255,0.35)');
      }
      // lane ropes with floats (red 2m, yellow 5m)
      [-7, 7].forEach(x => {
        for (let z = -4; z < c.z - 1; z += 0.5) {
          const p = P(c, x, 0.05, z), col = z < 2 ? '#e43b44' : z < 5 ? '#fee761' : '#ffffff';
          g.rect(p[0] - p[2] * 0.12, p[1] - p[2] * 0.08, Math.max(1, p[2] * 0.24), Math.max(1, p[2] * 0.12), col);
        }
      });
    } else if (sty === 'hockey') {
      g.grad(0, 0, 480, 80, '#4d86c9', '#aee0f7', 5);
      stand(g, c, -16, -40, 40, 6, t, { excite: exc, seed: 21 });
      const e0 = P(c, 0, 0, -8);
      g.rect(0, e0[1] - 2, 480, 4, '#3a4466');
      g.rect(0, e0[1], 480, 270 - e0[1], '#2f8f4a');
      Q3(g, c, [[-27.4, 0, 0], [27.4, 0, 0], [27.4, 0, 60], [-27.4, 0, 60]], '#2a62b6');
      bands(g, c, 0, Math.min(60, c.z), 4, '#2d68bf', '#2a62b6', P(c, 0, 0, 0)[1]);
      const W = '#ffffff';
      L3(g, c, -27.4, 0, 0, 27.4, 0, 0, W, 2);
      L3(g, c, -27.4, 0, 22.9, 27.4, 0, 22.9, W, 2);
      const D = [[-1.83 - 14.63, 0]].concat(arcPts(-1.83, 0, 14.63, PI, PI / 2, 10)).concat(arcPts(1.83, 0, 14.63, PI / 2, 0, 10)).concat([[1.83 + 14.63, 0]]);
      G3(g, c, D, W, 2);
      const D5 = arcPts(-1.83, 0, 19.63, PI, PI / 2, 12).concat(arcPts(1.83, 0, 19.63, PI / 2, 0, 12));
      for (let i = 0; i < D5.length - 1; i += 2) G3(g, c, [D5[i], D5[i + 1]], W, 1);
      L3(g, c, -27.4, 0, 0, -27.4, 0, 60, W, 2); L3(g, c, 27.4, 0, 0, 27.4, 0, 60, W, 2);
      const sp = P(c, 0, 0, 6.475); g.rect(sp[0] - 1, sp[1], 3, 1, W);
    } else if (sty === 'ice') {
      g.rect(0, 0, 480, 270, '#1b1d30');
      stand(g, c, -9, -30, 30, 12, t, { excite: exc, seed: 31, bg: '#262a40' });
      // end boards + glass
      const b0 = P(c, 0, 1.07, -3.4), b1 = P(c, 0, 0, -3.4), gl = P(c, 0, 2.6, -3.4);
      g.alpha(0.22); g.rect(0, gl[1], 480, b0[1] - gl[1], '#bfe8ff'); g.alpha(1);
      for (let i = -6; i <= 6; i++) { const p = P(c, i * 2.4, 0, -3.4); g.rect(p[0], gl[1], 1, b0[1] - gl[1], 'rgba(255,255,255,0.3)'); }
      g.rect(0, b0[1], 480, b1[1] - b0[1], '#f0f0f0');
      g.adBoards(0, b0[1] + 1, 480, Math.max(3, (b1[1] - b0[1]) * 0.55), t, ['ICE HOCKEY', 'DOT GAMES', 'WINTER 8-BIT', 'SLAP SHOT']);
      g.rect(0, b1[1] - Math.max(1, (b1[1] - b0[1]) * 0.2), 480, Math.max(1, (b1[1] - b0[1]) * 0.2), '#feae34');
      g.rect(0, b1[1], 480, 270 - b1[1], '#e6f2fa');
      bands(g, c, -3.4, c.z, 3, '#eaf5fc', '#e1eff8', b1[1]);
      // side boards (perspective walls)
      [-13, 13].forEach(x => {
        Q3(g, c, [[x, 0, -3.4], [x, 1.07, -3.4], [x, 1.07, c.z - 1], [x, 0, c.z - 1]], '#f4f4f4');
        Q3(g, c, [[x, 1.07, -3.4], [x, 2.6, -3.4], [x, 2.6, c.z - 1], [x, 1.07, c.z - 1]], 'rgba(191,232,255,0.18)');
        L3(g, c, x, 0.2, -3.4, x, 0.2, c.z - 1, '#feae34', 2);
      });
      L3(g, c, -13, 0, 0, 13, 0, 0, '#e43b44', 2);
      Q3(g, c, [[-12.9, 0, 17.4], [12.9, 0, 17.4], [12.9, 0, 17.7], [-12.9, 0, 17.7]], '#2a62d6');
      Q3(g, c, [[-12.9, 0, 17.8], [12.9, 0, 17.8], [12.9, 0, 18.1], [-12.9, 0, 18.1]], '#2a62d6');
      const cr = [[-1.22, 0]].concat(arcPts(0, 0, 1.83, PI, 0, 10).map(p => [p[0], -p[1] * -1])).concat([[1.22, 0]]);
      const crp = []; arcPts(0, 0, 1.83, 0, PI, 12).forEach(p => { const q = P(c, p[0], 0, p[1]); crp.push(q[0], q[1]); });
      g.poly(crp, '#7fc4f0');
      G3(g, c, arcPts(0, 0, 1.83, 0, PI, 12), '#e43b44', 1);
      [-6.7, 6.7].forEach(x => { G3(g, c, arcPts(x, 6.1, 4.57, 0, PI * 2, 24), '#e43b44', 1); const p = P(c, x, 0, 6.1); g.ellipse(p[0], p[1], Math.max(1, p[2] * 0.3), Math.max(1, p[2] * 0.1), '#e43b44'); });
      for (let i = 0; i < 18; i++) { const p = P(c, (OG.hash(i, 3, 3) - 0.5) * 24, 0, OG.hash(i, 4, 3) * 25); g.rect(p[0], p[1], Math.max(2, p[2] * 0.8), 1, 'rgba(160,190,210,0.35)'); }
    } else { // lax
      g.grad(0, 0, 480, 90, '#0f1430', '#2b3a6a', 6);
      for (let i = 0; i < 30; i++) g.px(OG.hash(i, 1, 9) * 480, OG.hash(i, 2, 9) * 40, '#ffffff');
      [-30, 30].forEach(x => { const p = P(c, x, 22, -22), q = P(c, x, 0, -22); g.rect(p[0] - 1, p[1], 2, q[1] - p[1], '#5a6988'); g.rect(p[0] - 8, p[1] - 6, 16, 6, '#fff6d5'); g.alpha(0.18); g.circle(p[0], p[1] - 3, 22, '#fff6d5'); g.alpha(1); });
      stand(g, c, -18, -40, 40, 7, t, { excite: exc, seed: 41, bg: '#262b44' });
      const e0 = P(c, 0, 0, -12);
      g.rect(0, e0[1], 480, 270 - e0[1], '#3d8f45');
      bands(g, c, -12, c.z, 3, '#459c4c', '#3d8f45', e0[1]);
      const W = 'rgba(255,255,255,0.9)';
      L3(g, c, -27, 0, -11, 27, 0, -11, W, 2);
      L3(g, c, -27, 0, 18, 27, 0, 18, W, 2);
      const cp = []; arcPts(0, 0, 2.74, 0, PI * 2, 20).forEach(p => { const q = P(c, p[0], 0, p[1]); cp.push(q[0], q[1]); });
      g.poly(cp, '#4aa354');
      G3(g, c, arcPts(0, 0, 2.74, 0, PI * 2, 20), W, 2, true);
      L3(g, c, -C_LAX_GW / 2, 0, 0, C_LAX_GW / 2, 0, 0, W, 1);
    }
  }
  const C_LAX_GW = 1.83;

  function shooterLook(e, sty) {
    const L = OG.lookOf(e);
    const look = { shirt: L.shirt, pants: L.pants, skin: L.skin, hair: L.hair, num: 2 + (e.look % 9), sock: L.shirt };
    if (sty === 'hockey') { look.sock = L.pants; look.shoe = '#ffffff'; }
    if (sty === 'ice') { look.helmet = L.pants; look.pants = L.pants; look.sleeves = true; look.glove = '#3a3a3a'; look.sock = L.shirt; look.blade = 1; look.tights = true; look.shoe = '#181425'; look.bulky = 1; }
    if (sty === 'lax') { look.helmet = L.shirt; look.glove = L.pants; look.sleeves = false; }
    if (sty === 'polo') { look.cap = L.shirt; look.capEars = 1; look.num = 0; }
    if (sty === 'pk') look.shoe = '#f4f4f4';
    if (sty === 'hand') { look.shoe = '#ffffff'; look.sock = '#ffffff'; }
    return look;
  }
  function keeperLook(e, sty, other) {
    const L = OG.lookOf(e);
    const kc = keeperKit(e);
    const look = { shirt: kc, pants: OG.shade(kc, -0.4), skin: L.skin, hair: L.hair, sleeves: true, sock: kc, glove: '#f4f4f4' };
    if (sty === 'polo') { look.cap = '#e43b44'; look.capEars = 1; look.shirt = L.skin; look.pants = L.skin; look.sleeves = false; look.glove = null; look.armC = L.skin; }
    if (sty === 'hand') { look.glove = null; look.shoe = '#ffffff'; }
    if (sty === 'hockey') { look.helmet = OG.shade(kc, -0.2); look.pads = '#f0f0f0'; look.glove = '#e8e8e8'; look.bulky = 1; look.cage = '#3a3a3a'; look.shoe = '#e8e8e8'; }
    if (sty === 'ice') { look.helmet = '#f4f4f4'; look.pads = '#f4f4f4'; look.glove = '#f0f0f0'; look.bulky = 1; look.cage = '#181425'; look.shirt = L.shirt; look.pants = L.pants; look.shoe = '#181425'; look.blade = 1; }
    if (sty === 'lax') { look.helmet = '#f4f4f4'; look.cage = '#3a3a3a'; look.glove = L.pants; }
    return look;
  }
  function drawKeeper(g, c, s) {
    const C = SO[s.sty], k = s.k, kp = s.ents[s.kpI];
    const gp = gkPose(s, k);
    const z = C.fam === 'spot' ? k.gz : k.gz;
    const p = P(c, k.gx + gp.off, C.base + gp.lift, z);
    const look = keeperLook(kp, s.sty);
    const J = ffig(g, p[0], p[1], p[2], look, gp.o);
    // sticks
    if (s.sty === 'hockey' || s.sty === 'ice') {
      const h = J.hR, kk = p[2];
      const fz = P(c, k.gx + gp.off + 0.35, 0, z);
      g.line(h[0], h[1], fz[0], fz[1] - 1, '#3a2a1a', Math.max(1, Math.round(kk * 0.05)));
      g.line(fz[0] - kk * 0.25, fz[1], fz[0] + kk * 0.05, fz[1], s.sty === 'ice' ? '#3a2a1a' : '#e8e8e8', Math.max(2, Math.round(kk * 0.1)));
      if (s.sty === 'ice') { g.rect(J.hL[0] - kk * 0.15, J.hL[1] - kk * 0.15, kk * 0.3, kk * 0.28, '#e43b44'); g.rect(J.hR[0] - kk * 0.1, J.hR[1] - kk * 0.18, kk * 0.2, kk * 0.32, '#f0f0f0'); }
    }
    if (s.sty === 'lax') {
      const h = J.hR, kk = p[2];
      g.line(h[0], h[1] + kk * 0.3, h[0] + kk * 0.1, h[1] - kk * 0.7, '#c0cbdc', Math.max(1, Math.round(kk * 0.04)));
      g.ellipse(h[0] + kk * 0.1, h[1] - kk * 0.85, kk * 0.22, kk * 0.2, 'rgba(255,255,255,0.75)');
      g.ellipse(h[0] + kk * 0.1, h[1] - kk * 0.85, kk * 0.15, kk * 0.13, 'rgba(60,60,60,0.5)');
    }
    // water line for polo
    if (s.sty === 'polo') {
      const w = P(c, k.gx + gp.off, 0, z);
      g.alpha(0.8); g.rect(w[0] - w[2] * 0.7, w[1], w[2] * 1.4, w[2] * 1.3, '#1f7fd0'); g.alpha(1);
      g.rect(w[0] - w[2] * 0.6, w[1], w[2] * 1.2, 1, 'rgba(255,255,255,0.7)');
      if (k.gm && s.t - k.gt0 < 0.6) splash(g, w[0], w[1], w[2], s.t - k.gt0, k.gt0);
    }
    g.text(OG.entLabel(kp), J.head[0], J.head[1] - p[2] * 0.42 - 9, pcol(kp), { size: 'xs', align: 'center', outline: PAL.black });
  }
  function splash(g, x, y, k, dt, seed) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const an = -PI * (0.1 + 0.8 * OG.hash(i, Math.round(seed * 100), 1)), sp = (1.5 + OG.hash(i, Math.round(seed * 100), 2) * 2.5) * k * 0.35;
      const px = x + Math.cos(an) * sp * dt * 3, py = y + Math.sin(an) * sp * dt * 3 + 160 * dt * dt * 3;
      if (py <= y + 2) g.rect(px, py, 2, 2, i % 2 ? '#ffffff' : '#bfe6ff');
    }
  }
  function drawShooter(g, c, s) {
    const C = SO[s.sty], k = s.k, sh = s.ents[s.shI];
    const look = shooterLook(sh, s.sty);
    const lab = (J, kk) => g.text(OG.entLabel(sh), J.head[0], J.head[1] - kk * 0.3 - 10, pcol(sh), { size: 'xs', align: 'center', outline: PAL.black });
    if (C.fam === 'spot') {
      if (s.sty === 'pk') {
        const p = P(c, k.sx, 0, k.sz);
        let o = { back: 1, lA: 0.35, rA: 0.35, legs: 0.08 };
        if (k.ph === 'run') { const ph = k.pt * 9; o = { back: 1, lA: 0.6 + Math.sin(ph) * 0.4, rA: 0.6 - Math.sin(ph) * 0.4, legs: 0.15 + Math.sin(ph) * 0.12, legs2: 0.15 - Math.sin(ph) * 0.12 }; }
        if (k.ph === 'fly' || k.ph === 'res') { const e = Math.min(1, (s.t - k.kickT) / 0.25); o = { back: 1, lA: 1.2, rA: 0.9, legs: 0.15, legs2: 0.1 + e * 0.9, rot: -0.15 * e }; }
        if (k.res === 'goal' && k.pt > 0.5) o = { back: 1, lA: 2.7, rA: 2.7, legs: 0.15 };
        const J = ffig(g, p[0], p[1], p[2], look, o);
        lab(J, p[2]);
      } else if (s.sty === 'hand') {
        let lift = 0, rA = 2.6, rE = 0.8, lA = 0.6;
        if (k.ph === 'run') { const u = k.pt / 0.5; lift = Math.sin(Math.min(1, u) * PI / 2) * 0.7; rA = 2.8; rE = 1.4 - u * 0.4; lA = 1.2; }
        if (k.ph === 'fly' || k.ph === 'res') { const u = Math.min(1, (s.t - k.kickT) / 0.6); lift = 0.7 * (1 - u * u); rA = 1.5; rE = 0; lA = 0.8; }
        const fake = s.t - k.fkT;
        if (fake >= 0 && fake < 0.35) { rA = 2.3 - Math.sin(fake / 0.35 * PI) * 0.9; rE = 0.6 + Math.sin(fake / 0.35 * PI) * 0.4; }
        const z = C.dist + 0.5 - (k.ph === 'run' ? Math.min(1, k.pt / 0.5) * 0.4 : (k.ph === 'fly' || k.ph === 'res') ? 0.4 : 0);
        const p = P(c, -0.55, 0, z);
        const J = ffig(g, p[0], p[1], p[2], look, { back: 1, lift, lA, rA, rE, legs: lift > 0.1 ? 0.25 : 0.12, legs2: lift > 0.1 ? 0.05 : 0.12 });
        if (k.ph === 'aim' || k.ph === 'run' || k.ph === 'ready') { const bp = J.hR; g.circle(bp[0], bp[1] - p[2] * 0.08, Math.max(2, C.br * p[2]), C.ballC); g.px(bp[0] - 1, bp[1] - p[2] * 0.1, '#ffffff'); }
        lab(J, p[2]);
      } else { // polo
        let lift = 0, rA = 2.5, rE = 0.6;
        if (k.ph === 'run') { const u = k.pt / 0.38; lift = Math.sin(Math.min(1, u) * PI / 2) * 0.35; rA = 2.9; rE = 1.3; }
        if (k.ph === 'fly' || k.ph === 'res') { const u = Math.min(1, (s.t - k.kickT) / 0.6); lift = 0.35 * (1 - u); rA = 1.6; rE = 0; }
        const fake = s.t - k.fkT;
        if (fake >= 0 && fake < 0.35) { rA = 2.2 - Math.sin(fake / 0.35 * PI) * 0.8; }
        const p = P(c, -0.6, -1.0 + lift, C.dist + 0.4);
        const J = ffig(g, p[0], p[1], p[2], look, { back: 1, lA: 1.3, rA, rE, legs: 0.2 });
        if (k.ph === 'aim' || k.ph === 'run' || k.ph === 'ready') { const bp = J.hR; g.circle(bp[0], bp[1] - p[2] * 0.08, Math.max(2, C.br * p[2]), C.ballC); g.line(bp[0] - 3, bp[1] - p[2] * 0.08, bp[0] + 3, bp[1] - p[2] * 0.08, '#0099db'); }
        const w = P(c, -0.6, 0, C.dist + 0.4);
        g.alpha(0.85); g.rect(w[0] - w[2] * 0.6, w[1], w[2] * 1.2, 270 - w[1], '#1f7fd0'); g.alpha(1);
        g.rect(w[0] - w[2] * 0.55, w[1], w[2] * 1.1, 1, 'rgba(255,255,255,0.8)');
        for (let i = 0; i < 6; i++) g.rect(w[0] - w[2] * 0.6 + OG.hash(i, Math.floor(s.t * 6), 1) * w[2] * 1.2, w[1] + 1 + OG.hash(i, 3, 2) * 3, 3, 1, 'rgba(255,255,255,0.6)');
        lab(J, p[2]);
      }
      return;
    }
    // run family
    const p = P(c, k.px, 0, k.pz);
    const spd = Math.hypot(k.vx, k.vz);
    const ph = s.t * (s.sty === 'ice' ? 4 : 9);
    let o;
    if (s.sty === 'ice') o = { back: 1, crouch: 0.35, lA: 0.6, rA: 0.9 + k.bo * 0.4, lE: 0.6, rE: 0.4, legs: 0.2 + Math.max(0, Math.sin(ph)) * 0.35, legs2: 0.2 + Math.max(0, -Math.sin(ph)) * 0.35, rot: -k.vx * 0.03 };
    else if (s.sty === 'hockey') o = { back: 1, crouch: 0.35, lA: 0.7, rA: 0.5, lE: 0.4, rE: 0.3, legs: 0.12 + (spd > 0.5 ? Math.sin(ph) * 0.18 : 0), legs2: 0.12 - (spd > 0.5 ? Math.sin(ph) * 0.18 : 0), rot: -k.vx * 0.02 };
    else o = { back: 1, crouch: 0.1, lA: 0.7, rA: 2.4 + (k.chgOn ? 0.5 : Math.sin(s.t * 7) * 0.25), rE: 0.6, legs: 0.12 + (spd > 0.5 ? Math.sin(ph) * 0.2 : 0), legs2: 0.12 - (spd > 0.5 ? Math.sin(ph) * 0.2 : 0) };
    if (k.ph === 'shot' || (k.ph === 'res' && !k.has)) {
      const e = Math.min(1, (s.t - k.kickT) / 0.2);
      if (s.sty === 'lax') { o.rA = 2.9 - e * 1.6; o.rE = 0.2; }
      else { o.lA = 0.9 + e * 0.8; o.rA = 0.6 + e * 0.9; }
    }
    if (k.res === 'goal' && k.pt > 0.4) { o = { back: 1, lA: 2.6, rA: 2.8, legs: 0.15 }; }
    const J = ffig(g, p[0], p[1], p[2], look, o);
    const kk = p[2];
    if (s.sty === 'hockey' || s.sty === 'ice') {
      const bpt = P(c, k.px + k.bo + (s.sty === 'ice' ? 0 : 0.05), 0, k.pz - 0.55);
      const hx = (J.hL[0] + J.hR[0]) / 2, hy = (J.hL[1] + J.hR[1]) / 2;
      const tip = (k.has || k.ph === 'play') ? bpt : P(c, k.px + 0.6, 0.2, k.pz - 0.4);
      g.line(hx, hy, tip[0], tip[1] - 1, s.sty === 'ice' ? '#3a2a1a' : '#8a5a3a', Math.max(1, Math.round(kk * 0.05)));
      g.line(tip[0] - kk * 0.12, tip[1], tip[0] + kk * 0.1, tip[1] - kk * 0.03, s.sty === 'ice' ? '#181425' : '#e8e8e8', Math.max(2, Math.round(kk * 0.07)));
      if (s.sty === 'ice' && spd > 4 && Math.abs(k.vx) > 1.5) { for (let i = 0; i < 6; i++) g.rect(J.fL[0] + OG.hash(i, Math.floor(s.t * 20), 1) * 16 - 8, J.fL[1] - OG.hash(i, 2, Math.floor(s.t * 20)) * 6, 2, 1, '#ffffff'); }
    } else {
      const h = J.hR;
      const head = [h[0] + kk * 0.15, h[1] - kk * 0.55];
      g.line(J.hL[0], J.hL[1], head[0], head[1], '#c0cbdc', Math.max(1, Math.round(kk * 0.04)));
      g.ellipse(head[0], head[1] - kk * 0.08, kk * 0.09, kk * 0.13, 'rgba(255,255,255,0.85)');
      if (k.has && k.ph !== 'shot') g.circle(head[0], head[1] - kk * 0.08, Math.max(1.5, kk * 0.04), '#ffffff');
    }
    lab(J, kk);
  }
  function soHUD(g, s) {
    const e0 = s.ents[0], e1 = s.ents[1];
    g.panel(110, 4, 260, 36);
    const sc0 = s.sc[0], sc1 = s.sc[1];
    g.flag(e0.country, 118, 9, 18, 12); g.flag(e1.country, 344, 9, 18, 12);
    g.text(OG.entLabel(e0), 140, 9, pcol(e0), { size: 's' });
    g.text(OG.entLabel(e1), 340, 9, pcol(e1), { size: 's', align: 'right' });
    g.text(sc0 + ' : ' + sc1, 240, 7, PAL.white, { size: 'l', align: 'center' });
    const dots = (h, x0, dir) => {
      const n = Math.max(REG, h.length);
      for (let i = 0; i < n; i++) {
        const x = x0 + dir * i * 9, y = 29;
        const v = h[i];
        if (v == null) g.circleO(x, y, 3, PAL.darkgrey);
        else if (v) g.circle(x, y, 3, PAL.green);
        else { g.circle(x, y, 3, '#5a2030'); g.line(x - 2, y - 2, x + 2, y + 2, PAL.red); g.line(x + 2, y - 2, x - 2, y + 2, PAL.red); }
      }
    };
    dots(s.hist[0], 122, 1); dots(s.hist[1], 358, -1);
    const rn = s.rnd + 1;
    g.text(s.ph === 'final' ? '경기 종료' : rn > REG ? '서든데스 ' + (rn - REG) : '라운드 ' + rn + '/' + REG, 240, 25, rn > REG ? PAL.orange : PAL.lightgrey, { size: 'xs', align: 'center' });
  }
  function soDraw(g, s) {
    const C = SO[s.sty], k = s.k;
    const c = soCam(s);
    soEnv(g, c, s);
    if (k) {
      if (k.bz < 0 && !k.has) drawBall(g, c, s, k.bx, k.by, k.bz, C.ballC);
      drawGoal(g, c, s, false);
      drawGoal(g, c, s, true);
      // objects sorted by depth (far first)
      const objs = [];
      objs.push({ z: k.gz, f: () => drawKeeper(g, c, s) });
      if (C.fam === 'spot') objs.push({ z: (s.sty === 'pk' ? k.sz : C.dist + 0.45), f: () => drawShooter(g, c, s) });
      else objs.push({ z: k.pz, f: () => drawShooter(g, c, s) });
      const ballVisible = C.fam === 'spot' ? !(s.sty !== 'pk' && (k.ph === 'aim' || k.ph === 'run' || k.ph === 'ready')) : true;
      if (ballVisible && k.bz >= 0) {
        let bx = k.bx, by = k.by, bz = k.bz;
        if (C.fam === 'run' && k.has) { bx = k.px + k.bo; by = C.br; bz = k.pz - 0.55; if (s.sty === 'lax') bz = -99; }
        if (bz > -50) objs.push({ z: bz + 0.01, f: () => drawBall(g, c, s, bx, by, bz, C.ballC) });
      }
      objs.sort((a, b) => a.z - b.z);
      objs.forEach(o => o.f());
      // aim reticle (spot family)
      const sh = s.ents[s.shI];
      if (C.fam === 'spot' && k.show && (k.ph === 'aim' || k.ph === 'run') && (sh.human || !s.ents[s.kpI].human)) {
        const ax = (sh.human ? k.ax : k.ax) * C.gw / 2, ay = (sh.human ? k.ay : k.ay) * C.gh;
        const p = P(c, ax, ay, 0);
        const col = pcol(sh);
        const r = 6 + Math.sin(s.t * 8) * 1;
        g.circleO(p[0], p[1], r, col); g.circleO(p[0], p[1], r + 1, PAL.black);
        g.rect(p[0] - r - 4, p[1], 4, 1, col); g.rect(p[0] + r + 1, p[1], 4, 1, col); g.rect(p[0], p[1] - r - 4, 1, 4, col); g.rect(p[0], p[1] + r + 1, 1, 4, col);
      }
      // run family: aim hint marker
      if (C.fam === 'run' && k.ph === 'play' && sh.human) {
        const gp = P(c, 0, C.gh + 0.35, 0);
        g.text('▼', gp[0], gp[1] - 8, PAL.yellow, { size: 'xs', align: 'center' });
      }
      // power meter (pk)
      if (s.sty === 'pk' && (k.ph === 'run' || k.ph === 'aim') && sh.human) {
        const x = 70, y = 150, h = 80;
        g.panel(x - 6, y - 14, 24, h + 22, {});
        g.text('파워', x + 6, y - 11, PAL.white, { size: 'xs', align: 'center' });
        g.rect(x, y, 12, h, PAL.black);
        g.rect(x + 1, y + 1, 10, h * (0.2 / 1.25), '#a22633');
        g.rect(x + 1, y + 1 + h * (0.2 / 1.25), 10, h * (0.25 / 1.25), '#3e8948');
        const f = Math.min(1.25, k.pw) / 1.25;
        g.rect(x + 3, y + h - 1 - (h - 2) * f, 6, (h - 2) * f, f > 0.78 ? PAL.red : f > 0.56 ? PAL.green : PAL.yellow);
      }
      // shot clock (run)
      if (C.fam === 'run' && (k.ph === 'play' || k.ph === 'ready')) {
        const rem = Math.max(0, C.time - (k.clk || 0));
        g.text(rem.toFixed(1), 240, 44, rem < 3 ? PAL.red : PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
      }
      // lax charge
      if (s.sty === 'lax' && k.ph === 'play' && k.chgOn) g.bar(200, 242, 80, 7, k.chg / 1.3, Math.abs(k.chg - 0.75) < 0.2 ? PAL.green : PAL.gold);
      // role labels + hints
      const kp = s.ents[s.kpI];
      const nm = SO_NAMES[s.sty];
      if (k.ph === 'ready') {
        g.panel(140, 196, 200, 40, { bg: 'rgba(24,20,37,0.92)' });
        g.text(OG.entLabel(sh) + ' ' + nm[0], 236, 202, pcol(sh), { size: 'm', align: 'right' });
        g.text('vs', 245, 204, PAL.grey, { size: 's', align: 'center' });
        g.text(OG.entLabel(kp) + ' ' + nm[1], 254, 202, pcol(kp), { size: 'm' });
        g.text(s.rnd >= REG ? '서든데스!' : (s.rnd + 1) + '번째 ' + nm[0], 240, 220, PAL.yellow, { size: 's', align: 'center' });
      }
      let hy = 258;
      if (sh.human && (k.ph === 'aim' || k.ph === 'run' || k.ph === 'play')) {
        const hint = { pk: k.ph === 'aim' ? '{L}{R}{U}{D} 조준 · {A} 도움닫기' : '{A} 파워 결정 (빨강=하늘로 슛!)', hand: '{L}{R}{U} 조준 · {D} 페이크 · {A} 점프슛', polo: '{L}{R}{U} 조준 · {D} 페이크 · {A} 슛',
          hockey: '{L}{R}{U}{D} 드리블 · {A} 슛 ({U}띄우기)', ice: '{U} 가속 · {L}{R} 데크 · {A} 슛', lax: '{L}{R}{U}{D} 이동 · {A} 꾹→떼면 슛' }[s.sty];
        g.text(OG.entLabel(sh), 6, hy - 11, pcol(sh), { size: 'xs', outline: PAL.black });
        g.rich(hint, 6, hy, PAL.white, { shadow: true });
      }
      if (kp.human && k.ph !== 'res' && k.ph !== 'ready') {
        const hint = C.fam === 'spot' ? '{L}{R} 다이빙 ({U}높게 {D}낮게) · {U} 점프' : '{L}{R}{U}{D} 위치 · {A} 몸 날리기';
        g.text(OG.entLabel(kp), 474, hy - 11, pcol(kp), { size: 'xs', align: 'right', outline: PAL.black });
        g.rich(hint, 474, hy, PAL.white, { align: 'right', shadow: true });
      }
      // result text
      if (k.ph === 'res') {
        const d = s.t - k.resT;
        const T = { goal: ['GOAL!', '골!', PAL.yellow], save: ['SAVE!', s.sty === 'ice' || s.sty === 'lax' ? '골리 선방!' : '골키퍼 선방!', PAL.cyan], post: ['골대!', '아까워요', PAL.orange], miss: ['MISS!', '빗나감', PAL.lightgrey], time: ['시간 초과', '슛을 못 했어요', PAL.lightgrey], crease: ['크리스 침범', '골 무효', PAL.rose] }[k.res] || ['', '', PAL.white];
        const sc = d < 0.15 ? 'xxl' : 'xxl';
        const bob = Math.max(0, 1 - d * 5) * 14;
        g.text(T[0], 240, 150 - bob, T[2], { size: sc, align: 'center', outline: PAL.black });
        g.text(T[1], 240, 184, PAL.white, { size: 'm', align: 'center', outline: PAL.black });
        if (k.res === 'goal') g.confetti(d * 1.5 + 3, 60);
      }
    }
    soHUD(g, s);
    if (s.t < 0) g.countdown(-s.t);
    if (s.ph === 'final') {
      const w = s.ents[s.win];
      g.panel(120, 150, 240, 46, { bg: 'rgba(24,20,37,0.92)', border: PAL.yellow });
      g.flag(w.country, 134, 162, 30, 20, { wave: s.t });
      g.text(OG.entLabel(w) + ' 승리!', 176, 158, pcol(w), { size: 'l' });
      g.text(s.sc[s.win] + ' : ' + s.sc[1 - s.win] + (s.lots ? ' (추첨)' : ''), 176, 178, PAL.white, { size: 's' });
    }
  }

  OG.defineEngine('shootout', {
    type: 'duel',
    init(ev, ents, opts, R) {
      const sty = (ev.cfg && SO[ev.cfg.sty]) ? ev.cfg.sty : 'pk';
      const s = {
        evId: ev.id, sty, t: -3, ph: 'play', pt: 0,
        ents: ents.slice(0, 2).map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name || e.country, tag: e.tag || '', skill: e.skill, look: e.look | 0 })),
        first: R.i(2), half: 0, rnd: 0, sc: [0, 0], hist: [[], []], k: null, win: -1, lots: 0, shI: 0, kpI: 1,
        done: false, results: null
      };
      newKick(s, R);
      return s;
    },
    update(s, inputs, dt, R) {
      if (s.done) return;
      s.t += dt;
      if (s.t < 0) return;
      if (s.ph === 'final') {
        s.pt += dt;
        if (s.pt > 2.4) {
          const w = s.win, l = 1 - w;
          const tx = s.sc[w] + ' : ' + s.sc[l] + (s.lots ? ' (추첨)' : '');
          s.results = [{ idx: s.ents[w].idx, text: tx, score: s.sc[w] }, { idx: s.ents[l].idx, text: s.sc[l] + ' : ' + s.sc[w], score: s.sc[l] }];
          s.done = true;
        }
        return;
      }
      if (SO[s.sty].fam === 'spot') spotUpdate(s, inputs, dt, R); else runUpdate(s, inputs, dt, R);
    },
    draw(g, s) { soDraw(g, s); },
    cpuMatch(ev, a, b, R) {
      const sty = (ev.cfg && SO[ev.cfg.sty]) ? ev.cfg.sty : 'pk';
      const base = SO[sty].pg;
      const pr = (sh, kp) => M.clamp(base + 0.28 * (sh.skill - kp.skill), 0.15, 0.95);
      const sc = [0, 0], n = [0, 0], E = [a, b];
      let fin = false;
      for (let r = 0; r < 30 && !fin; r++) {
        for (let i = 0; i < 2; i++) {
          if (R.f() < pr(E[i], E[1 - i])) sc[i]++;
          n[i]++;
          if (r < REG && (sc[0] > sc[1] + (REG - n[1]) || sc[1] > sc[0] + (REG - n[0]))) { fin = true; break; }
        }
        if (r >= REG - 1 && sc[0] !== sc[1]) fin = true;
      }
      if (sc[0] === sc[1]) sc[R.f() < 0.5 ? 0 : 1]++;
      const w = sc[0] > sc[1] ? 0 : 1;
      return { winner: w, text: sc[w] + ' : ' + sc[1 - w] };
    }
  });

  OG.defineEvents([
    { id: 'football_pk', name: '축구 승부차기', en: 'Football Penalty Shootout', sport: 'football', icon: '⚽', tags: ['summer', 'asian'], engine: 'shootout',
      cfg: { sty: 'pk' },
      help: ['키커: {L}{R}{U}{D} 조준 → {A} 도움닫기 → {A} 파워 (너무 세면 크로스바 위로!)', '골키퍼: {L}{R} 다이빙 ({U}높게 {D}낮게) · {U} 제자리 점프', '5번씩 차고 동점이면 서든데스'] },
    { id: 'hockey_so', name: '하키 슛아웃', en: 'Hockey Shootout', sport: 'hockey', icon: '🏑', tags: ['summer', 'asian'], engine: 'shootout',
      cfg: { sty: 'hockey' },
      help: ['8초 안에! {L}{R}{U}{D} 드리블 · {A} 슛 ({L}{R} 누르며 코너, {U} 띄우기)', '골키퍼: {L}{R}{U}{D} 위치 잡기 · {A} 몸 날리기', '키퍼를 제치면 빈 골대!'] },
    { id: 'icehockey_so', name: '아이스하키 슛아웃', en: 'Ice Hockey Shootout', sport: 'ice_hockey', icon: '🏒', tags: ['winter'], engine: 'shootout',
      cfg: { sty: 'ice' },
      help: ['{U} 가속 (빙판 위 미끄러짐) · {L}{R} 데크로 골리 속이기', '{A} 슛 — 골리 빈 쪽으로 ({U} 누르면 높게)', '골리: {L}{R}{U}{D} 이동 · {A} 버터플라이'] },
    { id: 'handball_7m', name: '핸드볼 7m 던지기', en: 'Handball 7m Throw', sport: 'handball', icon: '🤾', tags: ['summer', 'asian'], engine: 'shootout',
      cfg: { sty: 'hand' },
      help: ['{L}{R}{U} 조준 · {D} 페이크로 골키퍼 속이기 · {A} 점프슛', '골키퍼: {L}{R} 막기 ({U}높게 {D}낮게) · {U} 점프 · {D} 대자 막기', '3.5초 안에 던져야 해요'] },
    { id: 'waterpolo_pen', name: '수구 페널티', en: 'Water Polo Penalty', sport: 'water_polo', icon: '🤽', tags: ['summer', 'asian'], engine: 'shootout',
      cfg: { sty: 'polo' },
      help: ['{L}{R}{U} 조준 · {D} 페이크 · {A} 슛 (물 위로 솟구쳐!)', '골키퍼: {L}{R} 몸 날리기 ({U}높게) · {U} 솟구치기', '수면 가까이 낮은 슛은 막기 어려워요'] },
    { id: 'lacrosse_so', name: '라크로스 슛아웃', en: 'Lacrosse Shootout', sport: 'lacrosse', icon: '🥍', tags: ['summer'], engine: 'shootout',
      cfg: { sty: 'lax' },
      help: ['LA 2028 신종목! {L}{R}{U}{D} 크레이들하며 돌파', '{A} 꾹 눌러 와인드업 → 떼면 슛 ({U}높게 {D}바운드)', '크리스(원) 안에 들어가면 무효!'] }
  ]);

  /* ================================================================== *
   * BATTING (solo, turn-based): baseball / softball HR derby, cricket,
   * rugby conversions, flag football passing
   * ================================================================== */
  const BT = {};
  function btProg(s) {
    if (s.ph === 'final' || s.done) return 1;
    if (!s.hum.length) return s.prog;
    const K = BT[s.kind];
    const cur = (s.ph === 'play' || s.ph === 'ban') && s.cur >= 0 ? K.frac(s, s.rec[s.cur]) : 0;
    return Math.min(1, (Math.max(0, s.ti) + cur) / s.hum.length);
  }
  function btNextTurn(s, R) {
    const K = BT[s.kind];
    s.ti++;
    s.a = null;
    if (!s.hum.length) { s.ph = 'cpu'; s.pt = 0; return; }
    if (s.ti >= s.hum.length) { s.ph = 'final'; s.pt = 0; s.cur = -1; OG.sfx(s, 'cheer'); return; }
    s.cur = s.hum[s.ti]; s.ph = 'ban'; s.pt = 0;
    const e = s.ents[s.cur];
    s.ban = { txt: s.hum.length > 1 ? e.tag + ' 차례' : K.title, sub: e.name + ' · ' + K.sub(s), col: pcol(e), code: e.country, t0: M.round(s.t, 3) };
    K.start(s, R);
    OG.sfx(s, 'ding');
  }
  function btBoard(g, s, x, y, w) {
    const K = BT[s.kind];
    const f = btProg(s);
    const rows = s.ents.map((e, i) => {
      if (e.human) return { e, i, v: K.val(s.rec[i]), n: K.frac(s, s.rec[i]) };
      const c = s.cpu[i];
      return { e, i, v: c.pr[Math.min(10, Math.floor(f * 10 + 1e-9))], n: f };
    });
    rows.sort((p, q) => (q.v - p.v) || (p.i - q.i));
    g.panel(x, y, w, 12 + rows.length * 10, { title: s.ph === 'final' ? '최종 순위' : '실시간 순위' });
    rows.forEach((r, j) => {
      const yy = y + 7 + j * 10;
      if (r.i === s.cur) g.rect(x + 2, yy - 1, w - 4, 10, OG.shade(pcol(r.e), -0.55));
      g.text(String(j + 1), x + 8, yy, j === 0 ? PAL.medalGold : j === 1 ? PAL.medalSilver : j === 2 ? PAL.medalBronze : PAL.grey, { size: 'xs', align: 'center' });
      g.flag(r.e.country, x + 15, yy + 1, 11, 7);
      g.text(OG.entLabel(r.e), x + 30, yy, OG.entColor(r.e), { size: 'xs' });
      g.text(K.fmt(r.v), x + w - 5, yy, PAL.white, { size: 'xs', align: 'right' });
      const pw = Math.max(8, w - 90);
      g.rect(x + 54, yy + 3, pw, 2, '#262b44');
      g.rect(x + 54, yy + 3, Math.round(pw * Math.min(1, r.n)), 2, r.e.human ? pcol(r.e) : PAL.grey);
    });
  }
  function btBanner(g, s) {
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
  function bigMsg(g, s, a, y) {
    if (!a || !a.msg || s.t - a.msgT > 1.8 || s.t < a.msgT) return;
    const d = s.t - a.msgT, bob = Math.max(0, 1 - d * 6) * 12;
    g.text(a.msg, 240, y - bob, a.msgC || PAL.yellow, { size: 'xxl', align: 'center', outline: PAL.black });
    if (a.msg2) g.text(a.msg2, 240, y + 34, PAL.white, { size: 'm', align: 'center', outline: PAL.black });
  }
  function setMsg(s, a, m, m2, c) { a.msg = m; a.msg2 = m2 || ''; a.msgC = c || PAL.yellow; a.msgT = M.round(s.t, 3); }
  function fireworks(g, t0, t, n) {
    const d = t - t0;
    if (d < 0 || d > 2.4) return;
    const cols = ['#fee761', '#e43b44', '#2ce8f5', '#63c74d', '#ff0044', '#feae34'];
    for (let b = 0; b < (n || 4); b++) {
      const bd = d - b * 0.35;
      if (bd < 0 || bd > 1.2) continue;
      const cx = 80 + OG.hash(b, Math.round(t0 * 10), 1) * 320, cy = 30 + OG.hash(b, Math.round(t0 * 10), 2) * 60;
      for (let i = 0; i < 16; i++) {
        const an = i / 16 * PI * 2, r = bd * 50;
        g.rect(cx + Math.cos(an) * r, cy + Math.sin(an) * r + bd * bd * 20, 2, 2, cols[(b + i) % cols.length]);
      }
    }
  }

  /* ----------------------------- baseball / softball ----------------------------- */
  const BBC = {
    base: { dist: 18.44, fl: 100, fc: 122, Dmax: 152, br: 0.037, ball: '#ffffff', seam: '#e43b44', zy: 0.8, zh: 0.3, relY: 1.9 },
    soft: { dist: 13.11, fl: 67, fc: 70, Dmax: 90, br: 0.049, ball: '#fee761', seam: '#e43b44', zy: 0.75, zh: 0.28, relY: 0.7 }
  };
  const bbC = s => s.soft ? BBC.soft : BBC.base;
  const fenceAt = (C, phi) => C.fl + (C.fc - C.fl) * Math.max(0, Math.cos(phi * 2));
  const BB_PITCH = {
    base: [['직구', 0.45, 0.6, 0.68, 0, 0], ['체인지업', 0.2, 0.8, 0.88, 0, -0.15], ['커브', 0.2, 0.76, 0.84, 0, -0.5], ['슬라이더', 0.15, 0.68, 0.76, 0.4, -0.12]],
    soft: [['라이즈볼', 0.3, 0.56, 0.62, 0, 0.3], ['드롭볼', 0.3, 0.58, 0.64, 0, -0.4], ['체인지업', 0.2, 0.68, 0.75, 0, -0.12], ['직구', 0.2, 0.52, 0.58, 0, 0]]
  };
  function bbBallPos(s, a, u) {
    const C = bbC(s);
    const rel = [0.45, C.relY, -C.dist + 1.2];
    const end = [a.zx * 0.26, C.zy + a.zy * C.zh, 0];
    if (u <= 1) {
      const u3 = u * u * u;
      return [M.lerp(rel[0], end[0] - a.bkx, u) + a.bkx * u3, M.lerp(rel[1], end[1] - a.bky, u) + a.bky * u3 + (s.soft ? 0.25 : 0.12) * Math.sin(u * PI), M.lerp(rel[2], 0, u)];
    }
    return [end[0] + (end[0] - rel[0]) / C.dist * (u - 1) * C.dist, end[1] - (u - 1) * 0.8, (u - 1) * C.dist];
  }
  BT.bat = {
    title: '홈런 더비', sub: s => s.N + '아웃 · 최대 ' + s.cap + '구',
    att(s, H) { s.N = H <= 2 ? 7 : H <= 4 ? 4 : 3; s.cap = H <= 2 ? 14 : H <= 4 ? 9 : 6; },
    rec: () => ({ hr: 0, outs: 0, n: 0, lg: 0 }),
    cpu(s, e, R) {
      const C = bbC(s);
      const q = OG.cpuQuality(e, R, 0.06);
      const p = 0.12 + 0.5 * Math.pow(q, 1.6);
      let outs = 0, n = 0, hr = 0, lg = 0;
      const seq = [];
      while (outs < s.N && n < s.cap) {
        n++;
        if (R.chance(0.14)) { seq.push(hr); continue; }
        if (R.chance(p)) { hr++; lg = Math.max(lg, Math.round(fenceAt(C, R.range(-0.6, 0.6)) + R.range(1, 6 + 32 * q))); } else outs++;
        seq.push(hr);
      }
      const pr = []; for (let i = 0; i <= 10; i++) pr.push(i === 0 ? 0 : seq[Math.min(seq.length - 1, Math.floor(i / 10 * seq.length) - (i === 10 ? 1 : 0))] || 0);
      pr[10] = hr;
      return { sc: hr + lg / 1000, tx: hr + '개 (최장 ' + lg + 'm)', pr };
    },
    over: (s, r) => r.outs >= s.N || r.n >= s.cap,
    frac: (s, r) => Math.min(1, Math.max(r.outs / s.N, r.n / s.cap)),
    val: r => r.hr,
    fmt: v => v + '개',
    result: (s, r) => ({ score: r.hr + r.lg / 1000, text: r.hr + '개 (최장 ' + r.lg + 'm)' }),
    start(s, R) {
      const list = BB_PITCH[s.soft ? 'soft' : 'base'];
      let r = R.f(), pt = list[0];
      for (const p of list) { if (r < p[1]) { pt = p; break; } r -= p[1]; }
      const T = R.range(pt[2], pt[3]);
      const side = R.sign();
      s.a = {
        ph: 'wind', pt: 0, typ: pt[0], T: M.round(T, 3), kmh: Math.round(bbC(s).dist / T * 3.6 * (s.soft ? 1.05 : 1.25)),
        zx: M.round(M.clamp(R.gauss() * 0.5, -1.45, 1.45), 3), zy: M.round(M.clamp(R.gauss() * 0.5, -1.45, 1.45), 3),
        bkx: M.round(pt[4] * side, 3), bky: pt[5], cx: s.a ? s.a.cx : 0, cy: s.a ? s.a.cy : 0, t0: -1, sw: -1, hitT: -1,
        res: '', e: 0, q: 0, phi: 0, th: 0, D: 0, Tf: 1, fin: 0, msg: '', msg2: '', msgC: PAL.yellow, msgT: -9, hrT: -9
      };
    },
    update(s, a, inp, dt, R) {
      const C = bbC(s), rec = s.rec[s.cur];
      a.pt += dt;
      if (a.ph !== 'fly' && a.ph !== 'post') {
        a.cx = M.round(M.clamp(a.cx + ((inp.r ? 1 : 0) - (inp.l ? 1 : 0)) * 2.4 * dt, -1.3, 1.3), 3);
        a.cy = M.round(M.clamp(a.cy + ((inp.u ? 1 : 0) - (inp.d ? 1 : 0)) * 2.4 * dt, -1.3, 1.3), 3);
      }
      const done = (msg, msg2, c, out) => { setMsg(s, a, msg, msg2, c); a.ph = 'post'; a.pt = 0; rec.n++; if (out) rec.outs++; };
      if (a.ph === 'wind') {
        if (a.pt >= 1.15) { a.ph = 'pitch'; a.pt = 0; a.t0 = M.round(s.t, 3); OG.sfx(s, 'throw'); }
      } else if (a.ph === 'pitch') {
        const u = (s.t - a.t0) / a.T;
        if (inp.ap && a.sw < 0 && u > 0.08) {
          a.sw = M.round(s.t, 3); OG.sfx(s, 'swing');
          const tc = a.sw + 0.1, ta = a.t0 + a.T, e = tc - ta;
          const dx = a.cx - a.zx, dy = a.cy - a.zy, d = Math.hypot(dx * 0.9, dy);
          if (Math.abs(e) <= 0.12 && d <= 0.62) {
            const q = M.clamp(1 - Math.pow(Math.abs(e) / 0.12, 2) * 0.55 - Math.pow(d / 0.62, 2) * 0.62, 0, 1);
            a.q = M.round(q, 3); a.e = M.round(e, 3);
            a.phi = M.round(M.clamp(-e / 0.12, -1.3, 1.3) * 0.82 + R.gauss() * 0.05, 3);
            a.th = M.round(M.clamp(26 - dy * 75 + R.gauss() * 4, -15, 75), 2);
            let D = C.Dmax * Math.pow(q, 0.8) * Math.max(0.12, Math.cos((a.th - 28) * PI / 180 * 1.9)) * R.range(0.95, 1.05);
            if (a.th < 8) D = Math.min(D, C.Dmax * 0.4);
            a.D = Math.round(D);
            a.res = 'hit'; a.hitT = M.round(Math.max(tc, ta), 3);
          } else a.res = 'whiff';
        }
        if (a.res === 'hit' && s.t >= a.hitT) { a.ph = 'crack'; a.pt = 0; OG.sfx(s, 'hit'); if (a.q > 0.7) OG.sfx(s, 'crowd'); }
        else if (u >= 1.25) {
          if (a.sw < 0) {
            const inZ = Math.abs(a.zx) <= 1 && Math.abs(a.zy) <= 1;
            if (inZ) { done('스트라이크', '루킹 → 아웃', PAL.rose, 1); OG.sfx(s, 'fail'); } else { done('볼', '잘 골랐어요', PAL.lightgrey, 0); OG.sfx(s, 'tick'); }
          } else { done('헛스윙!', '아웃', PAL.rose, 1); OG.sfx(s, 'miss'); }
        }
      } else if (a.ph === 'crack') {
        if (a.pt >= 0.45) { a.ph = 'fly'; a.pt = 0; a.Tf = M.round(1.1 + a.D / 60, 3); }
      } else if (a.ph === 'fly') {
        if (a.pt >= a.Tf) {
          const foul = Math.abs(a.phi) > PI / 4;
          if (foul) { done('파울', a.D + 'm · 아웃', PAL.lightgrey, 1); OG.sfx(s, 'fail'); }
          else if (a.D > fenceAt(C, a.phi)) {
            rec.hr++; rec.lg = Math.max(rec.lg, a.D); a.hrT = M.round(s.t, 3);
            done('HOME RUN!', a.D + 'm 홈런!', PAL.yellow, 0); OG.sfx(s, 'cheer'); OG.sfx(s, 'perfect');
          } else {
            done(a.th < 8 ? '땅볼' : a.th > 45 ? '팝플라이' : '플라이', a.D + 'm · 아웃', PAL.lightgrey, 1); OG.sfx(s, 'crowd');
          }
        }
      } else if (a.ph === 'post') {
        if (a.pt >= 1.5) a.fin = 1;
      }
    },
    draw(g, s) {
      const a = s.a;
      if (a && (a.ph === 'fly' || (a.ph === 'post' && a.D > 0 && a.res === 'hit'))) BT.bat.drawField(g, s, a);
      else BT.bat.drawBat(g, s, a);
      BT.bat.hud(g, s, a);
    },
    drawBat(g, s, a) {
      const C = bbC(s), soft = s.soft;
      const c = { x: 0.3, y: 1.45, z: 6.5, F: 600, H: 112 };
      // sky + far stands
      g.grad(0, 0, 480, 110, soft ? '#f2a65e' : '#4f95da', soft ? '#ffd9a0' : '#a8dcf6', 6);
      const wallB = P(c, 0, 0, -C.fc), wallT = P(c, 0, 3, -C.fc);
      const stT = P(c, 0, 26, -C.fc - 20);
      g.crowd(0, Math.max(0, stT[1]), 480, wallT[1] - Math.max(0, stT[1]), s.t, { seed: soft ? 7 : 2, density: 0.85, excite: a && a.hrT > 0 && s.t - a.hrT < 2 ? 0.8 : 0.1 });
      g.rect(0, wallT[1], 480, wallB[1] - wallT[1] + 1, soft ? '#2a5a3a' : '#1f4f33');
      // scoreboard
      const sbY = Math.max(4, stT[1] + 4);
      g.rect(196, sbY, 90, 24, '#181425'); g.rectO(196, sbY, 90, 24, '#5a6988');
      g.text(soft ? 'SOFTBALL' : 'HR DERBY', 241, sbY + 3, PAL.yellow, { size: 'xs', align: 'center' });
      g.text('DOT GAMES', 241, sbY + 13, PAL.cyan, { size: 'xs', align: 'center' });
      // grass with stripes
      g.rect(0, wallB[1], 480, 270 - wallB[1], soft ? '#4a9a45' : '#4fa04a');
      bands(g, c, -C.fc, 6, 8, '#57aa50', '#4c9a46', wallB[1]);
      // infield dirt
      const dirt = soft ? '#c98a55' : '#c4864e';
      const md = -C.dist;
      const arc = arcPts(0, md, soft ? 18 : 29, -0.2, -PI + 0.2, 16);
      const poly = [];
      [[2.5, 1.2]].concat(arc).concat([[-2.5, 1.2]]).forEach(p => { const q = P(c, p[0], 0, Math.min(p[1], 5)); poly.push(q[0], q[1]); });
      g.poly(poly, dirt);
      if (!soft) {
        const inner = [[0, -2], [17, -19.4], [0, -36.8], [-17, -19.4]];
        const pp = []; inner.forEach(p => { const q = P(c, p[0], 0, p[1]); pp.push(q[0], q[1]); });
        g.poly(pp, '#55a74c');
      }
      const mp = P(c, 0, 0, md), mr = (soft ? 2.4 : 2.7) * mp[2];
      g.ellipse(mp[0], mp[1], mr, mr * 0.18, OG.shade(dirt, 0.1));
      // bases + foul lines
      const bd = soft ? 18.29 : 27.43, bh = bd / Math.SQRT2;
      [[bh, -bh], [0, -bh * 2], [-bh, -bh]].forEach(b => { const q = P(c, b[0], 0, b[1]); g.rect(q[0] - q[2] * 0.2, q[1] - 1, Math.max(2, q[2] * 0.4), 2, '#ffffff'); });
      L3(g, c, 0, 0, 0, 80, 0, -80, '#ffffff', 1); L3(g, c, 0, 0, 0, -80, 0, -80, '#ffffff', 1);
      // batter's boxes + plate
      G3(g, c, [[-1.3, 1], [-0.3, 1], [-0.3, -0.8], [-1.3, -0.8]], 'rgba(255,255,255,0.7)', 1, true);
      G3(g, c, [[1.3, 1], [0.3, 1], [0.3, -0.8], [1.3, -0.8]], 'rgba(255,255,255,0.7)', 1, true);
      const hp = [[-0.22, 0], [0.22, 0], [0.22, 0.2], [0, 0.42], [-0.22, 0.2]].map(p => P(c, p[0], 0, p[1]));
      g.poly([].concat(...hp.map(q => [q[0], q[1]])), '#ffffff');
      // pitcher
      const pp2 = P(c, 0, 0.25, md + 0.4);
      const pe = s.ents[(s.cur + 1) % s.ents.length] || s.ents[0];
      const pl = OG.lookOf(pe);
      const plook = { shirt: '#e8e8e8', pants: '#c0cbdc', skin: pl.skin, hair: pl.hair, sleeves: true, sock: '#262b44', helmet: null, cap: '#262b44', glove: '#8a5a3a' };
      let po = { lA: 0.5, rA: 0.4, legs: 0.12 };
      if (a && a.ph === 'wind') {
        const u = a.pt / 1.15;
        if (soft) po = { lA: 0.6, rA: u * PI * 2.2, rE: 0, legs: 0.12 + u * 0.2, legs2: 0.1 };
        else po = { lA: 1.2 + u * 0.6, lE: 1.2, rA: u < 0.6 ? 0.5 + u * 2 : 2.6 + (u - 0.6) * 2, rE: 1.2, legs: u > 0.5 ? 0.45 : 0.1, legs2: 0.1, lift: 0 };
      } else if (a && a.ph === 'pitch' && s.t - a.t0 < 0.3) po = { lA: 0.4, rA: soft ? 0.6 : 1.4, rE: 0.2, legs: 0.35, legs2: 0.1, crouch: 0.2 };
      ffig(g, pp2[0], pp2[1], pp2[2], plook, po);
      // ball
      if (a && (a.ph === 'pitch' || a.ph === 'crack')) {
        let bp;
        if (a.ph === 'pitch') bp = bbBallPos(s, a, Math.min(1.25, (s.t - a.t0) / a.T));
        else { const u = a.pt / 0.45; const end = bbBallPos(s, a, 1); bp = [end[0] + Math.sin(a.phi) * u * 30, end[1] + u * (2 + a.th * 0.15), -u * 32 * Math.cos(a.phi)]; }
        const q = P(c, bp[0], bp[1], bp[2]);
        const r = Math.max(1.6, C.br * q[2]);
        const sh = P(c, bp[0], 0, bp[2]);
        g.ellipse(sh[0], sh[1], r, Math.max(1, r * 0.3), 'rgba(0,0,0,0.25)');
        g.circle(q[0], q[1], r + 1, 'rgba(24,20,37,0.55)');
        g.circle(q[0], q[1], r, C.ball);
        if (r > 2.5) { g.px(q[0] - 1, q[1] - 1, C.seam); g.px(q[0] + 1, q[1] + 1, C.seam); }
        if (a.ph === 'crack' && a.pt < 0.15) { g.alpha(0.8); g.circle(q[0], q[1], 10 - a.pt * 40, '#ffffff'); g.alpha(1); }
      }
      // strike zone + swing cursor
      const z0 = P(c, -0.26, C.zy + C.zh, 0), z1 = P(c, 0.26, C.zy - C.zh, 0);
      g.alpha(0.5); g.rectO(z0[0], z0[1], z1[0] - z0[0], z1[1] - z0[1], '#ffffff'); g.alpha(0.18);
      for (let i = 1; i < 3; i++) { g.rect(z0[0] + (z1[0] - z0[0]) * i / 3, z0[1], 1, z1[1] - z0[1], '#ffffff'); g.rect(z0[0], z0[1] + (z1[1] - z0[1]) * i / 3, z1[0] - z0[0], 1, '#ffffff'); }
      g.alpha(1);
      const cur = s.ents[s.cur];
      if (a && cur && a.ph !== 'post') {
        const cp = P(c, a.cx * 0.26, C.zy + a.cy * C.zh, 0);
        const col = pcol(cur);
        g.ellipse(cp[0], cp[1], 9, 5, 'rgba(255,255,255,0.12)');
        g.circleO(cp[0], cp[1], 6, col); g.circleO(cp[0], cp[1], 7, PAL.black);
        g.rect(cp[0] - 1, cp[1] - 1, 2, 2, col);
      }
      // batter (big, back view, left of plate)
      if (cur) {
        const L = OG.lookOf(cur);
        const look = { shirt: L.shirt, pants: soft ? L.pants : '#e8e8e8', skin: L.skin, hair: L.hair, helmet: L.pants, sock: L.pants, shoe: '#181425', num: 1 + (cur.look % 9), numC: L.pants, tights: true };
        const bp = P(c, -0.95, 0, 0.35);
        let sw = -1; // -1 cocked … 1 follow-through
        if (a && a.sw > 0) sw = M.clamp((s.t - a.sw) / 0.16 * 2 - 1, -1, 1);
        const o = { back: 1, noArms: 1, crouch: 0.25, legs: 0.28, legs2: 0.22, rot: sw > -1 ? -0.05 * (sw + 1) : 0 };
        const J = ffig(g, bp[0], bp[1], bp[2], look, o);
        const k = bp[2];
        const ang = sw <= -1 ? -2.3 : M.lerp(-2.3, 1.9, (sw + 1) / 2); // bat angle (screen), 0 = pointing right
        const gx = J.shR[0] + k * (0.05 + 0.25 * Math.max(0, Math.sin((sw + 1) / 2 * PI))), gy = J.shR[1] + k * (0.05 + 0.15 * (sw + 1) / 2);
        g.line(J.shL[0], J.shL[1], gx, gy, look.shirt, Math.max(3, Math.round(k * 0.1)));
        g.line(J.shR[0], J.shR[1], gx, gy, look.shirt, Math.max(3, Math.round(k * 0.1)));
        g.circle(gx, gy, k * 0.06, '#f4f4f4');
        const bl = k * 0.86, bx2 = gx + Math.cos(ang) * bl, by2 = gy + Math.sin(ang) * bl * 0.6 - (sw < 0 ? bl * 0.3 : 0);
        g.line(gx, gy, bx2, by2, soft ? '#c0cbdc' : '#b86f50', Math.max(2, Math.round(k * 0.05)));
        g.line(M.lerp(gx, bx2, 0.4), M.lerp(gy, by2, 0.4), bx2, by2, soft ? '#e8e8e8' : '#d08a5c', Math.max(3, Math.round(k * 0.075)));
        g.text(OG.entLabel(cur), J.head[0], J.head[1] - k * 0.3 - 8, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
      }
      if (a && a.ph === 'pitch' && s.t - a.t0 > 0.1) g.text(a.typ + ' ' + a.kmh + 'km/h', 240, 230, PAL.white, { size: 's', align: 'center', outline: PAL.black });
    },
    drawField(g, s, a) {
      const C = bbC(s), soft = s.soft, m2 = C.fc / 122;
      const c = { x: 0, y: 48 * m2, z: 52 * m2, F: 290, H: -20 };
      const fp = phi => { const f = fenceAt(C, phi); return [Math.sin(phi) * f, -Math.cos(phi) * f]; };
      g.grad(0, 0, 480, 60, soft ? '#f2a65e' : '#4f95da', soft ? '#ffd9a0' : '#a8dcf6', 4);
      const top = P(c, 0, 0, -C.fc * 1.35)[1];
      g.crowd(0, Math.max(0, top - 30), 480, 130, s.t, { seed: 9, density: 0.9, excite: a.hrT > 0 ? 0.9 : 0.2 });
      // foul territory grass
      const fl = [], fair = [];
      for (let i = 0; i <= 24; i++) { const ph = -PI / 4 + i / 24 * PI / 2; fl.push(fp(ph)); }
      const outer = [[-C.fc * 1.2, 15], [-C.fc * 1.2, -C.fl * 0.72]].concat(fl).concat([[C.fc * 1.2, -C.fl * 0.72], [C.fc * 1.2, 15]]);
      const op = []; outer.forEach(p => { const q = P(c, p[0], 0, p[1]); op.push(q[0], q[1]); }); g.poly(op, '#3f8a3f');
      [[0, 4]].concat(fl).forEach(p => { const q = P(c, p[0], 0, p[1]); fair.push(q[0], q[1]); });
      g.poly(fair, soft ? '#55a64c' : '#57aa50');
      // stripes in the outfield
      for (let i = 0; i < 6; i++) {
        const r0 = C.fc * (0.35 + i * 0.11), r1 = r0 + C.fc * 0.055;
        const pts = []; arcPts(0, 0, r0, -PI * 0.75, -PI * 0.25, 10).concat(arcPts(0, 0, r1, -PI * 0.25, -PI * 0.75, 10)).forEach(p => { const q = P(c, p[0], 0, p[1]); pts.push(q[0], q[1]); });
        g.poly(pts, 'rgba(255,255,255,0.05)');
      }
      // warning track & wall
      const wt = []; fl.forEach(p => { const q = P(c, p[0], 0, p[1]); wt.push(q[0], q[1]); });
      fl.slice().reverse().forEach(p => { const q = P(c, p[0] * 0.95, 0, p[1] * 0.95); wt.push(q[0], q[1]); });
      g.poly(wt, '#b07a4a');
      for (let i = 0; i < fl.length - 1; i++) {
        const a0 = fl[i], a1 = fl[i + 1];
        const p0 = P(c, a0[0], 0, a0[1]), p1 = P(c, a1[0], 0, a1[1]), q0 = P(c, a0[0], 3.5, a0[1]), q1 = P(c, a1[0], 3.5, a1[1]);
        g.poly([p0[0], p0[1], p1[0], p1[1], q1[0], q1[1], q0[0], q0[1]], i % 2 ? '#1f4f33' : '#245a3a');
      }
      [[-PI / 4, C.fl], [0, C.fc], [PI / 4, C.fl]].forEach(m => { const f = fp(m[0]); const q = P(c, f[0], 1.5, f[1]); g.text(String(m[1]), q[0], q[1] - 4, '#ffffff', { size: 'xs', align: 'center' }); });
      [-1, 1].forEach(sd => { const f = fp(sd * PI / 4); const b = P(c, f[0], 0, f[1]), t = P(c, f[0], 14, f[1]); g.line(b[0], b[1], t[0], t[1], '#fee761', 2); });
      // infield
      const dirt = soft ? '#c98a55' : '#c4864e';
      const bd = soft ? 18.29 : 27.43, bh = bd / Math.SQRT2;
      const ia = []; [[0, 3]].concat(arcPts(0, -C.dist, soft ? 18 : 29, -0.15, -PI + 0.15, 12)).forEach(p => { const q = P(c, p[0], 0, p[1]); ia.push(q[0], q[1]); });
      g.poly(ia, dirt);
      if (!soft) { const ip = []; [[0, -2], [bh - 1, -bh], [0, -bh * 2 + 1], [-bh + 1, -bh]].forEach(p => { const q = P(c, p[0], 0, p[1]); ip.push(q[0], q[1]); }); g.poly(ip, '#57aa50'); }
      L3(g, c, 0, 0, 0, fp(PI / 4)[0], 0, fp(PI / 4)[1], '#ffffff', 1); L3(g, c, 0, 0, 0, fp(-PI / 4)[0], 0, fp(-PI / 4)[1], '#ffffff', 1);
      [[0, 0], [bh, -bh], [0, -bh * 2], [-bh, -bh]].forEach(b => { const q = P(c, b[0], 0, b[1]); g.rect(q[0] - 2, q[1] - 1, 4, 3, '#ffffff'); });
      const md = P(c, 0, 0, -C.dist); g.ellipse(md[0], md[1], 6, 3, OG.shade(dirt, 0.1));
      // fielders
      const fpos = [[0, -C.dist], [bh + 2, -bh + 4], [bh * 0.5, -bh * 1.6], [-bh * 0.5, -bh * 1.6], [-bh - 2, -bh + 4], [-C.fc * 0.55, -C.fc * 0.6], [0, -C.fc * 0.8], [C.fc * 0.55, -C.fc * 0.6], [0, 1.2]];
      const u = a.ph === 'post' ? 1 : Math.min(1, a.pt / a.Tf);
      const ue = 1 - Math.pow(1 - u, 1.35);
      const lx = Math.sin(a.phi) * a.D, lz = -Math.cos(a.phi) * a.D;
      fpos.forEach((f, i) => {
        const chase = i >= 5 && i <= 7 ? Math.min(1, u * 1.2) * 0.35 : 0;
        const fx = M.lerp(f[0], lx, chase), fz = M.lerp(f[1], lz, chase);
        const q = P(c, fx, 0, fz);
        g.rect(q[0] - 2, q[1], 5, 1, 'rgba(0,0,0,0.3)');
        g.rect(q[0] - 1, q[1] - 6, 3, 6, '#262b44'); g.rect(q[0] - 1, q[1] - 8, 3, 2, OG.SKINS[i % 5]); g.px(q[0] + 2, q[1] - 5, '#8a5a3a');
      });
      // ball
      const Hm = M.clamp(a.D * Math.tan(Math.max(2, a.th) * PI / 180) * 0.25, 0.5, 48);
      for (let k = 6; k >= 0; k--) {
        const uu = Math.max(0, u - k * 0.025), ee = 1 - Math.pow(1 - uu, 1.35);
        const h = a.th < 8 ? Math.abs(Math.sin(uu * PI * 4)) * 1.5 * (1 - uu) : 4 * Hm * uu * (1 - uu);
        const q = P(c, Math.sin(a.phi) * a.D * ee, h + 1, -Math.cos(a.phi) * a.D * ee);
        if (k === 0) {
          const sh = P(c, Math.sin(a.phi) * a.D * ee, 0, -Math.cos(a.phi) * a.D * ee);
          g.rect(sh[0] - 2, sh[1], 5, 1, 'rgba(0,0,0,0.4)');
          g.circle(q[0], q[1], 3.5, '#181425'); g.circle(q[0], q[1], 2.5, C.ball); g.px(q[0] + 1, q[1], C.seam); g.px(q[0] - 1, q[1] - 1, '#ffffff');
        } else { g.alpha(0.5 * (7 - k) / 7); g.rect(q[0] - 1, q[1] - 1, 3, 3, '#ffffff'); g.alpha(1); }
      }
      const shown = Math.round(a.D * ue);
      g.panel(186, 226, 108, 30, { title: '비거리' });
      g.text(shown + 'm', 240, 236, shown > fenceAt(C, a.phi) && Math.abs(a.phi) <= PI / 4 ? PAL.yellow : PAL.white, { size: 'l', align: 'center' });
      if (a.hrT > 0) fireworks(g, a.hrT, s.t, 5);
    },
    hud(g, s, a) {
      const cur = s.ents[s.cur];
      if (cur && s.ph !== 'final') {
        const r = s.rec[s.cur];
        g.panel(6, 8, 118, 50, { title: OG.entLabel(cur) + ' ' + (s.soft ? '소프트볼' : '야구') });
        g.text(r.hr + '', 34, 16, PAL.yellow, { size: 'xl', align: 'center' });
        g.text('홈런', 34, 42, PAL.lightgrey, { size: 'xs', align: 'center' });
        g.text('아웃', 60, 17, PAL.lightgrey, { size: 'xs' });
        for (let i = 0; i < s.N; i++) { const x = 60 + i * 8, y = 30; if (i < r.outs) g.circle(x + 3, y, 3, PAL.red); else g.circleO(x + 3, y, 3, PAL.darkgrey); }
        g.text('남은 공 ' + Math.max(0, s.cap - r.n), 60, 40, PAL.lightgrey, { size: 'xs' });
        if (r.lg) g.text('최장 ' + r.lg + 'm', 120, 60, PAL.white, { size: 'xs', align: 'right', outline: PAL.black });
      }
      bigMsg(g, s, a, 70);
      if (a && cur && s.ph === 'play' && (a.ph === 'wind' || a.ph === 'pitch')) g.rich('{U}{D}{L}{R} 스윙 위치 · {A} 스윙 (빠르면 당겨치기, 늦으면 밀어치기)', 240, 256, PAL.white, { align: 'center', shadow: true });
    }
  };

  /* ----------------------------- cricket ----------------------------- */
  BT.cricket = {
    title: 'T20 배팅', sub: s => s.N + '구 · 2아웃 종료',
    att(s, H) { s.N = H <= 2 ? 12 : H <= 4 ? 9 : 6; },
    rec: () => ({ runs: 0, wk: 0, n: 0, log: [] }),
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.06);
      let runs = 0, wk = 0, n = 0;
      const seq = [];
      while (n < s.N && wk < 2) {
        n++;
        if (R.chance(0.13 - 0.1 * q)) wk++;
        else {
          const r = R.f(), p6 = 0.02 + 0.2 * Math.pow(q, 1.5), p4 = 0.06 + 0.16 * Math.pow(q, 1.2);
          runs += r < p6 ? 6 : r < p6 + p4 ? 4 : r < p6 + p4 + 0.08 ? 2 : r < p6 + p4 + 0.33 ? 1 : 0;
        }
        seq.push(runs);
      }
      const pr = [0]; for (let i = 1; i <= 10; i++) pr.push(seq[Math.min(seq.length - 1, Math.ceil(i / 10 * seq.length) - 1)]);
      return { sc: runs + (3 - wk) * 0.01, tx: runs + '점 (' + wk + '아웃)', pr };
    },
    over: (s, r) => r.n >= s.N || r.wk >= 2,
    frac: (s, r) => Math.min(1, Math.max(r.n / s.N, r.wk / 2)),
    val: r => r.runs,
    fmt: v => v + '점',
    result: (s, r) => ({ score: r.runs + (3 - r.wk) * 0.01, text: r.runs + '점 (' + r.wk + '아웃)' }),
    start(s, R) {
      const line = M.round(R.pick([-0.34, -0.17, 0, 0, 0.08, 0.2, 0.34]) + R.gauss() * 0.03, 3);
      const len = M.round(R.range(2.5, 8.5), 2);
      s.a = {
        ph: 'run', pt: 0, line, len, hb: M.round(M.clamp(0.25 + len * 0.1, 0.3, 1.2), 3), T: M.round(R.range(0.62, 0.84), 3),
        t0: -1, sw: -1, dir: 0, loft: 0, res: '', q: 0, runs: 0, out: 0, psi: 0, D: 0, H: 0, Tf: 1.6, fin: 0,
        msg: '', msg2: '', msgC: PAL.yellow, msgT: -9, stT: -9, sixT: -9
      };
    },
    ballPos(a, u) { // u 0..1 bowler hand → batsman; beyond → keeper
      const rel = [0.35, 2.2, 19.4], zb = 1.3 + a.len, end = [a.line, a.hb, 1.3];
      const ub = (rel[2] - zb) / (rel[2] - end[2]);
      if (u <= ub) { const k = u / ub; return [M.lerp(rel[0], a.line * 0.8, k), M.lerp(rel[1], 0.04, k * k), M.lerp(rel[2], zb, k)]; }
      const k = (u - ub) / (1 - ub);
      const y = k <= 1 ? 0.04 + (end[1] - 0.04) * Math.sin(k * PI / 2) : end[1] - (k - 1) * 0.6;
      return [M.lerp(a.line * 0.8, end[0], k), Math.max(0.04, y), M.lerp(zb, end[2], k)];
    },
    update(s, a, inp, dt, R) {
      const rec = s.rec[s.cur];
      a.pt += dt;
      const fin = (m, m2, c, runs, out) => {
        setMsg(s, a, m, m2, c); a.ph = 'post'; a.pt = 0; rec.n++; rec.runs += runs; if (out) rec.wk++;
        rec.log.push(out ? -1 : runs); if (rec.log.length > 6) rec.log.shift();
      };
      if (a.ph === 'run') {
        if (a.pt >= 1.35) { a.ph = 'ball'; a.pt = 0; a.t0 = M.round(s.t, 3); OG.sfx(s, 'throw'); }
      } else if (a.ph === 'ball') {
        const u = (s.t - a.t0) / a.T;
        if (inp.ap && a.sw < 0 && u > 0.2) {
          a.sw = M.round(s.t, 3); a.dir = inp.l ? -1 : inp.r ? 1 : 0; a.loft = inp.u ? 1 : 0;
          OG.sfx(s, 'swing');
          const e = a.sw + 0.08 - (a.t0 + a.T);
          if (Math.abs(e) <= 0.11) {
            let mis = 0;
            if (a.line < -0.25 && a.dir > 0) mis = 0.3; if (a.line > 0.25 && a.dir < 0) mis = 0.3;
            if (a.len < 4 && a.loft === 0 && a.dir === 0) mis += 0.1;
            const q = M.clamp(1 - Math.pow(Math.abs(e) / 0.11, 2) * 0.7 - mis + R.gauss() * 0.05, 0, 1);
            a.q = M.round(q, 3); a.res = 'hit';
          } else a.res = 'miss';
        }
        if (a.res === 'hit' && u >= 1) {
          a.ph = 'crack'; a.pt = 0; OG.sfx(s, 'hit');
          const q = a.q;
          let runs = 0, out = 0;
          if (a.loft) {
            if (q > 0.72) runs = 6; else if (q > 0.55) runs = 4; else if (q > 0.4) runs = R.chance(0.5) ? 2 : 1;
            else if (R.chance(0.7)) out = 1; else runs = 1;
          } else runs = q > 0.82 ? 4 : q > 0.62 ? (R.chance(0.5) ? 2 : 3) : q > 0.38 ? 1 : 0;
          a.runs = runs; a.out = out;
          const base = a.dir === 0 ? R.range(-0.35, 0.35) : a.dir * R.range(0.7, 2.2);
          a.psi = M.round(base, 3);
          a.D = runs === 6 ? R.range(72, 92) : runs === 4 ? 70 : out ? R.range(28, 50) : runs === 0 ? R.range(12, 22) : R.range(22, 45) + runs * 4;
          a.D = M.round(a.D, 1);
          a.H = a.loft ? (runs === 6 ? 22 : 12) : 0.5;
          a.Tf = M.round(runs === 4 ? 2.1 : runs === 6 ? 2.3 : 1.7, 2);
        } else if (u >= 1.35) {
          const onStumps = Math.abs(a.line) < 0.14 && a.hb < 0.78;
          if (onStumps) { a.stT = M.round(s.t, 3); fin('OUT!', '보울드 — 스텀프가 날아갔다!', PAL.red, 0, 1); OG.sfx(s, 'crash'); OG.sfx(s, 'crowd'); }
          else { fin('도트 볼', a.sw > 0 ? '헛스윙' : '흘려보냄', PAL.lightgrey, 0, 0); OG.sfx(s, 'tick'); }
        }
      } else if (a.ph === 'crack') {
        if (a.pt >= 0.35) { a.ph = 'fly'; a.pt = 0; }
      } else if (a.ph === 'fly') {
        if (a.pt >= a.Tf) {
          if (a.out) { fin('OUT!', '캐치 아웃', PAL.red, 0, 1); OG.sfx(s, 'fail'); }
          else if (a.runs === 6) { a.sixT = M.round(s.t, 3); fin('SIX!', '로프를 넘겼다!', PAL.yellow, 6, 0); OG.sfx(s, 'cheer'); OG.sfx(s, 'perfect'); }
          else if (a.runs === 4) { fin('FOUR!', '바운더리!', PAL.cyan, 4, 0); OG.sfx(s, 'cheer'); }
          else fin(a.runs ? a.runs + '점' : '도트 볼', a.runs ? '달려라!' : '수비에 막힘', a.runs ? PAL.white : PAL.lightgrey, a.runs, 0);
        }
      } else if (a.ph === 'post') {
        if (a.pt >= 1.5) a.fin = 1;
      }
    },
    draw(g, s) {
      const a = s.a;
      if (a && (a.ph === 'fly' || (a.ph === 'post' && a.res === 'hit'))) BT.cricket.drawOval(g, s, a);
      else BT.cricket.drawPitch(g, s, a);
      BT.cricket.hud(g, s, a);
    },
    drawPitch(g, s, a) {
      const c = { x: 0, y: 2.6, z: 27, F: 560, H: 74 };
      g.grad(0, 0, 480, 70, '#5aa0e0', '#bfe4f6', 5);
      const st0 = P(c, 0, 14, -75), st1 = P(c, 0, 0, -75);
      g.crowd(0, Math.max(0, st0[1]), 480, st1[1] - Math.max(0, st0[1]), s.t, { seed: 14, density: 0.85, excite: a && a.sixT > 0 && s.t - a.sixT < 2 ? 0.9 : 0.1 });
      g.rect(0, st1[1] - 2, 480, 3, '#3a4466');
      // sight screen
      const ss0 = P(c, -7, 7, -66), ss1 = P(c, 7, 0, -66);
      g.rect(ss0[0], ss0[1], ss1[0] - ss0[0], ss1[1] - ss0[1], '#f0f0f0');
      g.rect(0, st1[1], 480, 270 - st1[1], '#4c9e45');
      bands(g, c, -75, 26, 6, '#55a94e', '#4c9e45', st1[1]);
      // rope (boundary) + 30 yard circle
      const rope = arcPts(0, 10, 66, -PI, 0, 30).filter(p => p[1] < 24);
      G3(g, c, rope, '#ffffff', 2);
      const ir = arcPts(0, 10, 27, -PI, 0, 30).filter(p => p[1] < 24);
      for (let i = 0; i < ir.length - 1; i += 2) G3(g, c, [ir[i], ir[i + 1]], 'rgba(255,255,255,0.6)', 1);
      // pitch strip
      const sp = [[-1.5, -2], [1.5, -2], [1.5, 22], [-1.5, 22]].map(p => P(c, p[0], 0, p[1]));
      g.poly([].concat(...sp.map(q => [q[0], q[1]])), '#d9c48e');
      L3(g, c, -1.4, 0, 1.22, 1.4, 0, 1.22, '#ffffff', 1); L3(g, c, -1.4, 0, 0, 1.4, 0, 0, '#ffffff', 1);
      L3(g, c, -1.4, 0, 20.12 - 1.22, 1.4, 0, 20.12 - 1.22, '#ffffff', 2); L3(g, c, -1.4, 0, 20.12, 1.4, 0, 20.12, '#ffffff', 2);
      [-1.32, 1.32].forEach(x => { L3(g, c, x, 0, -0.5, x, 0, 1.22, '#ffffff', 1); L3(g, c, x, 0, 18.9, x, 0, 21, '#ffffff', 1); });
      // keeper + slips (fielding side, navy)
      const fl = { shirt: '#262b44', pants: '#262b44', skin: PAL.skin3, hair: '#181425', sleeves: true, glove: '#f4f4f4', shoe: '#f4f4f4', sock: '#262b44' };
      [[0.1, -2.2, 1], [-1.6, -4.2, 0], [-2.8, -4.6, 0]].forEach(f => { const p = P(c, f[0], 0, f[1]); ffig(g, p[0], p[1], p[2], fl, { crouch: 0.75, lA: 0.6, rA: 0.6, lE: 0.5, rE: 0.5, legs: 0.35 }); });
      // stumps (striker)
      const stumps = (z, fly) => {
        for (let i = -1; i <= 1; i++) {
          let x0 = i * 0.11, y1 = 0.71, xo = 0, yo = 0;
          if (fly >= 0) { xo = i * fly * 1.6 + fly * 0.2; yo = Math.sin(Math.min(fly, 1) * PI) * 0.3 - fly * 0.2; }
          const b = P(c, x0, 0, z), t = P(c, x0 + xo, y1 + yo, z - fly * 1.5);
          g.line(b[0], b[1], t[0], t[1], '#f4e8c8', Math.max(1, Math.round(b[2] * 0.04)));
        }
        const bl = P(c, -0.11 + (fly >= 0 ? fly * 1.2 : 0), 0.73 + (fly >= 0 ? fly * 0.9 : 0), z - Math.max(0, fly) * 2), br = P(c, 0.11 + (fly >= 0 ? fly * 2 : 0), 0.73 + (fly >= 0 ? fly * 0.6 : 0), z - Math.max(0, fly) * 2);
        g.line(bl[0], bl[1], br[0], br[1], '#e43b44', 1);
      };
      const fly = a && a.stT > 0 ? Math.min(1.2, (s.t - a.stT) * 2) : -1;
      stumps(0, fly);
      // batsman (front view, side-on stance)
      const cur = s.ents[s.cur];
      if (cur) {
        const L = OG.lookOf(cur);
        const look = { shirt: L.shirt, pants: L.pants, skin: L.skin, hair: L.hair, helmet: L.pants, cage: '#c0cbdc', sleeves: true, glove: '#f4f4f4', pads: '#f4f4f4', sock: '#f4f4f4', shoe: '#f4f4f4' };
        const bp = P(c, -0.32, 0, 1.25);
        let sw = -1;
        if (a && a.sw > 0) sw = M.clamp((s.t - a.sw) / 0.2 * 2 - 1, -1, 1);
        const J = ffig(g, bp[0], bp[1], bp[2], look, { noArms: 1, crouch: 0.3, legs: 0.18, legs2: 0.14 });
        const k = bp[2];
        const gx = J.shR[0] + k * 0.12, gy = J.shR[1] + k * 0.25;
        g.line(J.shL[0], J.shL[1], gx, gy, look.shirt, Math.max(2, Math.round(k * 0.1)));
        g.line(J.shR[0], J.shR[1], gx, gy, look.shirt, Math.max(2, Math.round(k * 0.1)));
        let ang;
        if (sw <= -1) ang = a && a.ph === 'ball' ? -1.0 : 1.35;
        else { const d = a.dir; ang = M.lerp(-1.4, d < 0 ? -2.6 : d > 0 ? 0.4 : -0.7, (sw + 1) / 2) + (a.loft ? -0.4 * (sw + 1) / 2 : 0); }
        const bl = k * 0.85;
        const ex = gx + Math.cos(ang) * bl, ey = gy + Math.sin(ang) * bl * (sw > -1 ? 0.7 : 1);
        g.line(gx, gy, ex, ey, '#e8d4a0', Math.max(2, Math.round(k * 0.09)));
        g.circle(gx, gy, Math.max(1, k * 0.05), '#f4f4f4');
        g.text(OG.entLabel(cur), J.head[0], J.head[1] - k * 0.3 - 9, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
      }
      // ball
      if (a && (a.ph === 'ball' || a.ph === 'crack')) {
        let bp;
        if (a.ph === 'ball') bp = BT.cricket.ballPos(a, Math.min(1.35, (s.t - a.t0) / a.T));
        else { const u = a.pt / 0.35; const e = BT.cricket.ballPos(a, 1); bp = [e[0] + Math.sin(a.psi) * u * 12, e[1] + u * (a.loft ? 6 : 0.5), e[2] + Math.cos(a.psi) * u * 12]; }
        const q = P(c, bp[0], bp[1], bp[2]), sh = P(c, bp[0], 0, bp[2]);
        const r = Math.max(1.8, 0.036 * q[2]);
        g.ellipse(sh[0], sh[1], r, Math.max(1, r * 0.3), 'rgba(0,0,0,0.3)');
        g.circle(q[0], q[1], r + 1, 'rgba(24,20,37,0.6)');
        g.circle(q[0], q[1], r, '#f8f8f8');
        if (a.ph === 'ball') { const pb = P(c, a.line * 0.8, 0, 1.3 + a.len); if (s.t - a.t0 > a.T * 0.4) { g.alpha(0.5); g.ellipse(pb[0], pb[1], 2, 1, '#8a6a3a'); g.alpha(1); } }
      }
      // bowler (back view)
      if (a && (a.ph === 'run' || a.ph === 'ball')) {
        const u = a.ph === 'run' ? a.pt / 1.35 : 1;
        const z = M.lerp(31, 20.6, u);
        const p = P(c, 0.45 + (a.ph === 'ball' ? Math.min(1, (s.t - a.t0) * 2.5) * 1.6 : 0), 0, z + (a.ph === 'ball' ? Math.min(1, (s.t - a.t0) * 2.5) * 1.5 : 0));
        const ph = a.pt * 10;
        let o = { back: 1, lA: 0.5 + Math.sin(ph) * 0.4, rA: 0.5 - Math.sin(ph) * 0.4, legs: 0.12 + Math.sin(ph) * 0.15, legs2: 0.12 - Math.sin(ph) * 0.15 };
        if (u > 0.8) { const k = (u - 0.8) / 0.2; o = { back: 1, lA: 2.6 - k, rA: 0.5 + k * 2.6, legs: 0.3, legs2: 0.05 }; }
        if (a.ph === 'ball') o = { back: 1, lA: 0.6, rA: 0.4 + Math.min(1, (s.t - a.t0) * 4) * 0.4, legs: 0.3, legs2: 0.1 };
        ffig(g, p[0], p[1], p[2], { shirt: '#f4f4f4', pants: '#262b44', skin: PAL.skin2, hair: '#3e2731', sock: '#f4f4f4', shoe: '#f4f4f4' }, o);
      }
      // non-striker stumps (foreground)
      const n0 = P(c, -0.11, 0, 20.12), n1 = P(c, 0.11, 0.71, 20.12);
      for (let i = -1; i <= 1; i++) { const b = P(c, i * 0.11, 0, 20.12), t = P(c, i * 0.11, 0.71, 20.12); g.line(b[0], b[1], t[0], t[1], '#f4e8c8', 3); }
      g.line(n0[0], n1[1], n1[0], n1[1], '#e43b44', 2);
    },
    drawOval(g, s, a) {
      const CX = 240, CY = 146, RX = 214, RY = 112, k = RX / 66;
      g.rect(0, 0, 480, 270, '#2a2f48');
      g.crowd(0, 0, 480, 270, s.t, { seed: 17, density: 0.75, excite: a.sixT > 0 ? 0.9 : 0.2, bg: '#2a2f48' });
      g.ellipse(CX, CY, RX + 14, RY + 10, '#3a4466');
      g.ellipse(CX, CY, RX + 8, RY + 5, '#4c9e45');
      for (let i = 6; i > 0; i--) g.ellipse(CX, CY, RX * i / 7, RY * i / 7, i % 2 ? '#52a64b' : '#4c9e45');
      // rope
      for (let i = 0; i < 90; i++) { const an = i / 90 * PI * 2; g.rect(CX + Math.cos(an) * RX, CY + Math.sin(an) * RY, 2, 2, '#ffffff'); }
      for (let i = 0; i < 60; i += 2) { const an = i / 60 * PI * 2; g.px(CX + Math.cos(an) * RX * 0.42, CY + Math.sin(an) * RY * 0.42, 'rgba(255,255,255,0.6)'); }
      g.rect(CX - 4, CY - 22, 8, 44, '#d9c48e');
      g.rect(CX - 4, CY - 19, 8, 1, '#ffffff'); g.rect(CX - 4, CY + 18, 8, 1, '#ffffff');
      // fielders
      const F = [[-0.6, 0.45], [0.6, 0.45], [-1.3, 0.75], [1.3, 0.75], [-2.2, 0.8], [2.2, 0.8], [-2.8, 0.55], [2.8, 0.6], [PI, 0.85]];
      const u = a.ph === 'post' ? 1 : Math.min(1, a.pt / a.Tf);
      F.forEach((f, i) => {
        let fx = CX + Math.sin(f[0]) * RX * f[1], fy = CY - 18 + Math.cos(f[0]) * RY * f[1];
        g.rect(fx - 2, fy + 1, 5, 1, 'rgba(0,0,0,0.3)');
        g.rect(fx - 1, fy - 4, 3, 5, '#262b44'); g.rect(fx - 1, fy - 6, 3, 2, OG.SKINS[(i + 2) % 5]);
      });
      // ball path from the batsman's end (top of the strip) — ψ: 0 straight down the ground
      const ox = CX, oy = CY - 20;
      const dist = a.D * k * (a.runs === 4 ? 1.08 : 1);
      const ue = 1 - Math.pow(1 - u, a.loft ? 1.2 : 2);
      const dx = Math.sin(a.psi), dy = Math.cos(a.psi);
      const bx = ox + dx * dist * ue, by = oy + dy * dist * ue * RY / RX;
      const h = a.loft ? 4 * a.H * u * (1 - u) * 2.2 : 0;
      g.rect(bx - 2, by + 1, 5, 1, 'rgba(0,0,0,0.4)');
      g.circle(bx, by - h, 3.5, '#181425'); g.circle(bx, by - h, 2.5, '#ffffff');
      if (a.out && u > 0.6) { const fx = bx, fy = by; g.rect(fx - 2, fy - 7, 4, 6, '#262b44'); }
      const cur = s.ents[s.cur];
      if (cur) g.text(OG.entLabel(cur), ox, oy - 12, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
      if (a.sixT > 0) fireworks(g, a.sixT, s.t, 4);
    },
    hud(g, s, a) {
      const cur = s.ents[s.cur];
      if (cur && s.ph !== 'final') {
        const r = s.rec[s.cur];
        g.panel(6, 8, 128, 46, { title: OG.entLabel(cur) + ' T20' });
        g.text(r.runs + '/' + r.wk, 12, 15, PAL.yellow, { size: 'xl' });
        const ov = Math.floor(r.n / 6) + '.' + (r.n % 6);
        g.text(ov + ' 오버', 128, 16, PAL.lightgrey, { size: 's', align: 'right' });
        g.text((s.N - r.n) + '구 남음', 128, 28, PAL.lightgrey, { size: 'xs', align: 'right' });
        r.log.forEach((v, i) => {
          const x = 14 + i * 18, y = 41;
          g.rect(x - 1, y - 1, 16, 10, v < 0 ? PAL.darkred : v >= 6 ? '#b8860b' : v >= 4 ? PAL.darkblue : '#262b44');
          g.text(v < 0 ? 'W' : v === 0 ? '·' : String(v), x + 7, y, PAL.white, { size: 'xs', align: 'center' });
        });
      }
      bigMsg(g, s, a, 64);
      if (a && cur && s.ph === 'play' && (a.ph === 'run' || a.ph === 'ball')) g.rich('{A} 타이밍 스윙 · {L}{R} 방향 · {U} 띄워치기(6점↑ 캐치↑)', 240, 256, PAL.white, { align: 'center', shadow: true });
    }
  };

  /* ----------------------------- rugby conversions ----------------------------- */
  const RG_POS = [[0, 22], [-9, 25], [13, 28], [-18, 30], [24, 34], [-28, 38]];
  const RG_V0 = 10, RG_VK = 20, RG_EL = 0.62;
  function rgPos(s, i) { const idx = s.N >= 6 ? i : s.N === 4 ? [0, 2, 3, 5][i] : [0, 3, 5][i]; return RG_POS[idx == null ? 0 : idx]; }
  function rgNeed(D) { const cs = Math.cos(RG_EL), y = D * Math.tan(RG_EL) - 3.6; if (y <= 0) return 1; const v = Math.sqrt(9.8 * D * D / (2 * cs * cs * y)); return M.clamp((v - RG_V0) / RG_VK, 0, 1); }
  BT.rugby = {
    title: '컨버전 킥', sub: s => s.N + '번 킥',
    att(s, H) { s.N = H <= 2 ? 6 : H <= 4 ? 4 : 3; },
    rec: () => ({ pts: 0, made: 0, n: 0, log: [] }),
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.06);
      let pts = 0; const seq = [];
      for (let i = 0; i < s.N; i++) {
        const p = rgPos(s, i), diff = (p[1] - 20) / 40 + Math.abs(p[0]) / 60;
        if (R.chance(M.clamp(0.98 - diff * (1.45 - q * 1.1), 0.04, 0.98))) pts += 2;
        seq.push(pts);
      }
      const pr = [0]; for (let i = 1; i <= 10; i++) pr.push(seq[Math.min(seq.length - 1, Math.ceil(i / 10 * seq.length) - 1)]);
      return { sc: pts, tx: pts + '점 (' + (pts / 2) + '/' + s.N + ')', pr };
    },
    over: (s, r) => r.n >= s.N,
    frac: (s, r) => Math.min(1, r.n / s.N),
    val: r => r.pts,
    fmt: v => v + '점',
    result: (s, r) => ({ score: r.pts, text: r.pts + '점 (' + r.made + '/' + s.N + ')' }),
    start(s, R) {
      const rec = s.rec[s.cur];
      const p = rgPos(s, rec.n);
      s.a = {
        ph: 'aim', pt: 0, bx: p[0], bz: p[1], aim: 0, yaw: M.round(Math.atan2(-p[0], p[1]), 4), wind: M.round(M.clamp(R.gauss() * 2.4, -5, 5), 1),
        pw: 0, m0: -1, x: p[0], y: 0.15, z: p[1], vx: 0, vy: 0, vz: 0, res: '', fin: 0, kT: -1, spin: 0, crossed: 0,
        msg: '', msg2: '', msgC: PAL.yellow, msgT: -9, need: M.round(rgNeed(Math.hypot(p[0], p[1])), 3)
      };
    },
    update(s, a, inp, dt, R) {
      const rec = s.rec[s.cur];
      a.pt += dt;
      if (a.ph === 'aim' || a.ph === 'meter') {
        const sp = (a.ph === 'aim' ? 0.45 : 0.2) * dt;
        if (inp.l) a.aim -= sp; if (inp.r) a.aim += sp;
        a.aim = M.round(M.clamp(a.aim, -0.5, 0.5), 4);
      }
      if (a.ph === 'aim') {
        if (inp.ap || a.pt > 5) { a.ph = 'meter'; a.pt = 0; a.m0 = M.round(s.t, 3); OG.sfx(s, 'charge'); }
      } else if (a.ph === 'meter') {
        const f = ((s.t - a.m0) / 0.72) % 2; a.pw = M.round(f < 1 ? f : 2 - f, 3);
        if ((inp.ap && a.pt > 0.08) || a.pt > 3) { a.ph = 'run'; a.pt = 0; OG.sfx(s, 'step'); }
      } else if (a.ph === 'run') {
        if (a.pt >= 0.6) {
          const v = RG_V0 + RG_VK * a.pw;
          let dir = a.yaw + a.aim + R.gauss() * 0.012;
          if (a.pw > 0.9) dir += R.sign() * R.range(0.04, 0.1);
          const hv = v * Math.cos(RG_EL);
          a.vx = M.round(Math.sin(dir) * hv, 3); a.vz = M.round(-Math.cos(dir) * hv, 3); a.vy = M.round(v * Math.sin(RG_EL), 3);
          a.ph = 'fly'; a.pt = 0; a.kT = M.round(s.t, 3); OG.sfx(s, 'kick');
        }
      } else if (a.ph === 'fly') {
        const pz = a.z;
        a.vy -= 9.8 * dt; a.vx += a.wind * 0.45 * dt;
        a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
        a.x = M.round(a.x, 3); a.y = M.round(a.y, 3); a.z = M.round(a.z, 3); a.vx = M.round(a.vx, 3); a.vy = M.round(a.vy, 3);
        if (!a.crossed && pz > 0 && a.z <= 0) {
          a.crossed = 1;
          const ax = Math.abs(a.x);
          if (ax < 2.75 && a.y > 3.05) { a.res = 'good'; }
          else if (ax < 2.95 && ax > 2.6 && a.y > 2.5) a.res = 'post';
          else if (ax < 2.8) a.res = 'short'; else a.res = 'wide';
          if (a.res === 'post') { a.vx = -a.vx * 0.5; a.vz = -a.vz * 0.3; OG.sfx(s, 'bell'); }
        }
        if (a.y <= 0 || a.pt > 4) {
          if (!a.crossed) a.res = 'short';
          rec.n++;
          if (a.res === 'good') { rec.pts += 2; rec.made++; setMsg(s, a, '성공!', '+2점', PAL.yellow); OG.sfx(s, 'cheer'); OG.sfx(s, 'good'); }
          else setMsg(s, a, a.res === 'post' ? '골대!' : a.res === 'short' ? '짧아요!' : '빗나감', a.res === 'wide' ? (a.x > 0 ? '오른쪽으로' : '왼쪽으로') : '', a.res === 'post' ? PAL.orange : PAL.lightgrey);
          if (a.res !== 'good') OG.sfx(s, 'miss');
          rec.log.push(a.res === 'good' ? 1 : 0);
          a.y = 0; a.ph = 'post'; a.pt = 0;
        }
      } else if (a.ph === 'post') {
        if (a.pt >= 1.7) a.fin = 1;
      }
    },
    cam(a) {
      const L = Math.hypot(a.bx, a.bz) || 1;
      return { x: a.bx + a.bx / L * 10, y: 2.8, z: a.bz + a.bz / L * 10, F: 480, H: 96, yaw: a.yaw };
    },
    draw(g, s) {
      const a = s.a;
      const cur = s.ents[s.cur];
      const c = a ? BT.rugby.cam(a) : { x: 0, y: 2.8, z: 32, F: 480, H: 96, yaw: 0 };
      g.grad(0, 0, 480, 92, '#3f7fcf', '#a7d8f5', 6);
      g.clouds(s.t, 14, 2);
      // stands behind dead-ball line (+ side)
      const sb = P(c, 0, 0, -24), stp = P(c, 0, 14, -24);
      g.crowd(0, Math.max(0, stp[1]), 480, sb[1] - Math.max(0, stp[1]), s.t, { seed: 23, density: 0.85, excite: a && a.res === 'good' && a.ph === 'post' ? 0.9 : 0.1 });
      g.rect(0, sb[1] - 3, 480, 4, '#3a4466');
      g.adBoards(0, sb[1] - 1, 480, 6, s.t, ['RUGBY SEVENS', 'DOT GAMES', 'CONVERSION', 'AICHI-NAGOYA']);
      g.rect(0, sb[1] + 5, 480, 270 - sb[1] - 5, '#4a9e47');
      // mowing stripes (across the field)
      for (let z = -12; z < 60; z += 5) {
        const q = [[-40, z], [40, z], [40, z + 2.5], [-40, z + 2.5]];
        if (q.some(p => depth(c, p[0], p[1]) < 1)) continue;
        Q3(g, c, q.map(p => [p[0], 0, p[1]]), '#52a84e');
      }
      const W = 'rgba(255,255,255,0.9)';
      L3(g, c, -35, 0, 0, 35, 0, 0, W, 2); L3(g, c, -35, 0, -11, 35, 0, -11, W, 2);
      L3(g, c, -35, 0, 22, 35, 0, 22, W, 2);
      for (let x = -35; x < 35; x += 4) L3(g, c, x, 0, 40, x + 2, 0, 40, W, 1);
      L3(g, c, -35, 0, -11, -35, 0, 60, W, 2); L3(g, c, 35, 0, -11, 35, 0, 60, W, 2);
      // posts
      const pc = cur ? OG.lookOf(cur).shirt : PAL.red;
      [-2.8, 2.8].forEach(x => {
        const b = P(c, x, 0, 0), t = P(c, x, 16, 0), pd = P(c, x, 2, 0);
        const th = Math.max(2, Math.round(b[2] * 0.1));
        g.line(b[0], b[1], t[0], t[1], '#f4f4f4', th);
        g.rect(pd[0] - th * 2, pd[1], th * 4, b[1] - pd[1], pc);
        // wind pennant
        const w = a ? a.wind : 0, len = 6 + Math.abs(w) * 3, dir = w >= 0 ? 1 : -1;
        for (let i = 0; i < len; i++) g.rect(t[0] + dir * i, t[1] + Math.sin(s.t * 8 + i * 0.5) * i / len * 2, 1, 4 - i / len * 3, i % 4 < 2 ? '#fee761' : '#e43b44');
      });
      const cb0 = P(c, -2.8, 3, 0), cb1 = P(c, 2.8, 3, 0);
      g.line(cb0[0], cb0[1], cb1[0], cb1[1], '#f4f4f4', Math.max(2, Math.round(cb0[2] * 0.1)));
      if (a) {
        // aim guide
        if (a.ph === 'aim' || a.ph === 'meter') {
          const dir = a.yaw + a.aim;
          const L = Math.hypot(a.bx, a.bz);
          for (let d = 1; d < L + 6; d += 1.6) L3(g, c, a.bx + Math.sin(dir) * d, 0, a.bz - Math.cos(dir) * d, a.bx + Math.sin(dir) * (d + 0.8), 0, a.bz - Math.cos(dir) * (d + 0.8), pcol(cur), 1);
          const tx = a.bx + Math.sin(dir) * (a.bz / Math.max(0.2, Math.cos(dir)));
          const tp = P(c, tx, 3.6, 0);
          g.circleO(tp[0], tp[1], 5, PAL.black); g.circleO(tp[0], tp[1], 4, PAL.yellow); g.rect(tp[0] - 1, tp[1] - 1, 2, 2, PAL.yellow);
        }
        // kicker
        const kp = a.ph === 'run' ? Math.min(1, a.pt / 0.6) : (a.ph === 'fly' || a.ph === 'post') ? 1 : 0;
        const L = Math.hypot(a.bx, a.bz) || 1;
        const ux = a.bx / L, uz = a.bz / L, px = -uz, pz = ux;
        const kx = a.bx + ux * M.lerp(2.2, 0.5, kp) + px * M.lerp(1.8, 0.35, kp), kz = a.bz + uz * M.lerp(2.2, 0.5, kp) + pz * M.lerp(1.8, 0.35, kp);
        const kpP = P(c, kx, 0, kz);
        const L2 = OG.lookOf(cur || s.ents[0]);
        const look = { shirt: L2.shirt, pants: L2.pants, skin: L2.skin, hair: L2.hair, sock: L2.shirt, shoe: '#181425', num: 10, numC: L2.pants };
        let o = { back: 1, lA: 0.4, rA: 0.4, legs: 0.12 };
        if (a.ph === 'run') { const ph = a.pt * 12; o = { back: 1, lA: 0.6 + Math.sin(ph) * 0.4, rA: 0.6 - Math.sin(ph) * 0.4, legs: 0.15 + Math.sin(ph) * 0.15, legs2: 0.15 - Math.sin(ph) * 0.15 }; }
        if (a.ph === 'fly' || a.ph === 'post') { const e = Math.min(1, (s.t - a.kT) / 0.2); o = { back: 1, lA: 1.5, rA: 1.0, legs: 0.12, legs2: 0.15 + e * 0.6, rot: -0.12 * e }; }
        if (a.ph === 'post' && a.res === 'good') o = { back: 1, lA: 2.7, rA: 2.7, legs: 0.15 };
        const J = ffig(g, kpP[0], kpP[1], kpP[2], look, o);
        if (cur) g.text(OG.entLabel(cur), J.head[0], J.head[1] - kpP[2] * 0.3 - 9, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
        // tee + ball
        const tee = P(c, a.bx, 0, a.bz);
        g.rect(tee[0] - tee[2] * 0.08, tee[1] - tee[2] * 0.08, tee[2] * 0.16, tee[2] * 0.08, '#f77622');
        const bx = a.ph === 'fly' || a.ph === 'post' ? a.x : a.bx, by = a.ph === 'fly' || a.ph === 'post' ? a.y : 0.2, bz = a.ph === 'fly' || a.ph === 'post' ? a.z : a.bz;
        if (depth(c, bx, bz) > 0.6) {
          const bp = P(c, bx, by, bz), sh = P(c, bx, 0, bz);
          const r = Math.max(1.5, 0.15 * bp[2]);
          g.ellipse(sh[0], sh[1], r, Math.max(1, r * 0.3), 'rgba(0,0,0,0.3)');
          const spin = a.ph === 'fly' ? Math.sin((s.t - a.kT) * 18) : 0.6;
          const rx = Math.max(2, r * (0.6 + 0.4 * Math.abs(spin))), ry = Math.max(1.5, r * 0.7);
          if (a.ph === 'fly') { const pv = P(c, bx - a.vx * 0.06, by - a.vy * 0.06, bz - a.vz * 0.06); g.alpha(0.5); g.line(pv[0], pv[1], bp[0], bp[1], '#ffffff', 2); g.alpha(1); }
          g.ellipse(bp[0], bp[1], rx + 1, ry + 1, '#181425');
          g.ellipse(bp[0], bp[1], rx, ry, '#f2ece0');
          g.rect(bp[0] - r * 0.5, bp[1], r, 1, '#2a62b6');
        }
        // power meter
        if (a.ph === 'meter' || a.ph === 'aim' || (a.ph === 'run')) {
          const x = 440, y = 120, h = 100;
          g.panel(x - 8, y - 16, 30, h + 26, {});
          g.text('파워', x + 7, y - 12, PAL.white, { size: 'xs', align: 'center' });
          g.rect(x, y, 14, h, PAL.black);
          g.rect(x + 1, y + 1, 12, h * 0.07, '#a22633');
          const f = a.pw;
          g.rect(x + 2, y + h - 1 - (h - 2) * f, 10, (h - 2) * f, f > 0.93 ? PAL.red : f >= a.need ? PAL.green : PAL.gold);
          const ny = y + h - 1 - (h - 2) * a.need;
          g.rect(x - 4, ny, 22, 1, '#ffffff'); g.text('◀', x + 18, ny - 4, '#ffffff', { size: 'xs' });
        }
        // wind & distance
        g.panel(6, 62, 96, 30, { title: '바람' });
        const wl = Math.round(Math.abs(a.wind) * 6) + 2, dir = a.wind >= 0 ? 1 : -1, wx = 30, wy = 79;
        g.rect(wx - (dir > 0 ? 0 : wl), wy - 1, wl, 3, PAL.cyan);
        g.poly([wx + dir * (wl + 4), wy + 0.5, wx + dir * wl, wy - 4, wx + dir * wl, wy + 5], PAL.cyan);
        g.text(Math.abs(a.wind).toFixed(1) + 'm/s', 98, 74, PAL.white, { size: 's', align: 'right' });
        g.text('거리 ' + Math.round(Math.hypot(a.bx, a.bz)) + 'm · 각도 ' + Math.round(Math.abs(a.yaw) * 180 / PI) + '°', 8, 96, PAL.white, { size: 'xs', outline: PAL.black });
      }
      // HUD
      if (cur && s.ph !== 'final') {
        const r = s.rec[s.cur];
        g.panel(6, 8, 130, 44, { title: OG.entLabel(cur) + ' 컨버전' });
        g.text(r.pts + '점', 14, 16, PAL.yellow, { size: 'xl' });
        for (let i = 0; i < s.N; i++) {
          const v = r.log[i], x = 82 + (i % 3) * 16, y = 18 + Math.floor(i / 3) * 14;
          g.rect(x, y, 12, 10, v == null ? '#262b44' : v ? '#3e8948' : '#a22633');
          g.text(v == null ? String(i + 1) : v ? 'O' : 'X', x + 6, y + 1, PAL.white, { size: 'xs', align: 'center' });
        }
      }
      bigMsg(g, s, a, 120);
      if (a && cur && s.ph === 'play') {
        const hint = a.ph === 'aim' ? '{L}{R} 조준 (바람 고려) · {A} 파워 게이지 시작' : a.ph === 'meter' ? '{A} 파워 결정! (흰 선 이상, 빨강은 휘어요)' : '';
        if (hint) g.rich(hint, 240, 256, PAL.white, { align: 'center', shadow: true });
      }
    }
  };

  /* ----------------------------- flag football ----------------------------- */
  const FF_ROUTES = {
    slant: { pts: [[0, -4], [6, -9], [10, -13]], nm: '슬랜트' },
    out: { pts: [[0, -9], [-7, -10]], nm: '아웃' },
    go: { pts: [[0, -30]], nm: '고' },
    post: { pts: [[0, -10], [7, -25]], nm: '포스트' },
    curl: { pts: [[0, -11], [1, -9]], nm: '컬' },
    corner: { pts: [[0, -10], [-7, -24]], nm: '코너' }
  };
  const FF_START = [[-9, 0], [-3.5, 0.6], [9, 0]];
  const FF_V = 7;
  function ffRecPos(a, i, t) { // receiver position at time t after snap
    const st = FF_START[i], R0 = FF_ROUTES[a.rt[i]], side = st[0] < 0 ? 1 : -1;
    let x = st[0], z = st[1], rem = Math.max(0, t) * FF_V * (t < 0.6 ? Math.max(0.3, t / 0.6) : 1);
    let lx = 0, lz = -1;
    for (const p of R0.pts) {
      const tx = st[0] + p[0] * side, tz = st[1] + p[1];
      const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz);
      if (L < 1e-6) continue;
      lx = dx / L; lz = dz / L;
      if (rem <= L) return [x + lx * rem, z + lz * rem, lx, lz];
      rem -= L; x = tx; z = tz;
    }
    const slow = a.rt[i] === 'curl' ? 0 : 0.7;
    return [M.clamp(x + lx * rem * slow, -12, 12), Math.max(-27, z + lz * rem * slow), lx * slow, lz * slow];
  }
  BT.flag = {
    title: '플래그 풋볼', sub: s => s.N + '번 공격',
    att(s, H) { s.N = H <= 2 ? 6 : H <= 4 ? 4 : 3; },
    rec: () => ({ pts: 0, n: 0, td: 0, log: [] }),
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.06);
      let pts = 0; const seq = [];
      for (let i = 0; i < s.N; i++) {
        if (R.chance(0.1 - 0.07 * q)) { seq.push(pts); continue; }
        if (R.chance(0.42 + 0.4 * q)) pts += R.chance(0.15 + 0.3 * q) ? 6 : R.int(1, 3);
        seq.push(pts);
      }
      const pr = [0]; for (let i = 1; i <= 10; i++) pr.push(seq[Math.min(seq.length - 1, Math.ceil(i / 10 * seq.length) - 1)]);
      return { sc: pts, tx: pts + '점', pr };
    },
    over: (s, r) => r.n >= s.N,
    frac: (s, r) => Math.min(1, r.n / s.N),
    val: r => r.pts,
    fmt: v => v + '점',
    result: (s, r) => ({ score: r.pts + r.td * 0.01, text: r.pts + '점 (TD ' + r.td + ')' }),
    start(s, R) {
      const keys = R.shuffle(Object.keys(FF_ROUTES)).slice(0, 3);
      const dq = R.range(0.9, 1.02);
      s.a = {
        ph: 'set', pt: 0, rt: keys, sel: 1, pw: 0, chg: 0, snapT: -1, thT: -1, Tf: 1, tx: 0, tz: 0, tgt: 1,
        def: FF_START.map((p, i) => [M.round(p[0] + R.range(-1, 1), 2), M.round(p[1] - 5 - R.range(0, 2), 2)]), dq: M.round(dq, 3),
        rush: [0, -7], res: '', fin: 0, msg: '', msg2: '', msgC: PAL.yellow, msgT: -9, need: 0.5, tdT: -9, bx: 0, bz: 4.5, by: 1.8
      };
    },
    update(s, a, inp, dt, R) {
      const rec = s.rec[s.cur];
      a.pt += dt;
      const end = (m, m2, c, pts, td) => { setMsg(s, a, m, m2, c); a.ph = 'post'; a.pt = 0; rec.n++; rec.pts += pts; if (td) { rec.td++; a.tdT = M.round(s.t, 3); } rec.log.push(pts); };
      const t = a.snapT >= 0 ? s.t - a.snapT : 0;
      const stepDef = () => {
        a.def.forEach((d, i) => {
          const rp = ffRecPos(a, i, t - 0.3);
          const cush = Math.max(0.8, 4 - t * 1.2);
          const tx = rp[0], tz = rp[1] - cush;
          const dx = tx - d[0], dz = tz - d[1], L = Math.hypot(dx, dz);
          const v = Math.min(L * 3, FF_V * a.dq);
          if (L > 0.01) { d[0] = M.round(d[0] + dx / L * v * dt, 3); d[1] = M.round(d[1] + dz / L * v * dt, 3); }
        });
        if (t > 1) { const dx = -a.rush[0], dz = 4.5 - a.rush[1], L = Math.hypot(dx, dz); if (L > 0.3) { a.rush[0] = M.round(a.rush[0] + dx / L * 2.6 * dt, 3); a.rush[1] = M.round(a.rush[1] + dz / L * 2.6 * dt, 3); } }
      };
      if (a.ph === 'set') {
        if (a.pt >= 1.2) { a.ph = 'play'; a.pt = 0; a.snapT = M.round(s.t, 3); OG.sfx(s, 'whistle'); }
      } else if (a.ph === 'play') {
        if (inp.lp) { a.sel = (a.sel + 2) % 3; OG.sfx(s, 'click'); }
        if (inp.rp) { a.sel = (a.sel + 1) % 3; OG.sfx(s, 'click'); }
        stepDef();
        // required power for the selected receiver
        const rp0 = ffRecPos(a, a.sel, t + 0.9);
        const dist0 = Math.hypot(rp0[0], rp0[1] - 4.5);
        a.need = M.round(M.clamp((dist0 - 4) / 30, 0.05, 1), 3);
        let throwNow = false;
        if (inp.a) { a.chg = 1; a.pw = M.round(Math.min(1, a.pw + dt / 1.1), 3); }
        else if (a.chg) throwNow = true;
        if (throwNow) {
          // lead the receiver
          let tf = 0.8, p = null;
          for (let it = 0; it < 3; it++) { p = ffRecPos(a, a.sel, t + tf); tf = 0.35 + Math.hypot(p[0], p[1] - 4.5) / 20; }
          const dx = p[0], dz = p[1] - 4.5, L = Math.hypot(dx, dz) || 1;
          const err = (a.pw - a.need) * 20;
          a.tx = M.round(p[0] + dx / L * err + R.gauss() * 0.4, 3); a.tz = M.round(p[1] + dz / L * err + R.gauss() * 0.4, 3);
          a.Tf = M.round(0.35 + Math.hypot(a.tx, a.tz - 4.5) / 20, 3); a.thT = M.round(s.t, 3); a.tgt = a.sel;
          a.ph = 'air'; a.pt = 0; OG.sfx(s, 'throw');
        } else if (Math.hypot(a.rush[0], a.rush[1] - 4.5) < 0.8 || t > 6) {
          end('색!', '플래그를 뺏겼어요', PAL.rose, 0, 0); OG.sfx(s, 'fail');
        }
      } else if (a.ph === 'air') {
        stepDef();
        const u = (s.t - a.thT) / a.Tf;
        a.bx = M.round(M.lerp(0, a.tx, u), 3); a.bz = M.round(M.lerp(4.5, a.tz, u), 3); a.by = M.round(1.8 + Math.sin(Math.min(1, u) * PI) * (1.5 + a.Tf * 3) - 0.6 * u, 3);
        if (u >= 1) {
          const rp = ffRecPos(a, a.tgt, t);
          const dr = Math.hypot(rp[0] - a.tx, rp[1] - a.tz);
          let dd = 99; a.def.forEach(d => { dd = Math.min(dd, Math.hypot(d[0] - a.tx, d[1] - a.tz)); });
          if (dd < 1.1 && dd < dr) {
            if (R.chance(0.55)) { end('인터셉트!', '수비에게 뺏겼어요', PAL.red, 0, 0); OG.sfx(s, 'fail'); }
            else { end('패스 차단', '아깝다!', PAL.lightgrey, 0, 0); OG.sfx(s, 'block'); }
          } else if (dr < 2.1) {
            const depthM = -a.tz;
            if (a.tz <= -18) { end('TOUCHDOWN!', '+6점', PAL.yellow, 6, 1); OG.sfx(s, 'cheer'); OG.sfx(s, 'perfect'); }
            else { const p = Math.max(1, Math.round(depthM / 5)); end('캐치!', Math.round(depthM / 0.9144) + '야드 · +' + p + '점', PAL.green, p, 0); OG.sfx(s, 'good'); }
          } else { end('패스 실패', a.pw < a.need ? '너무 짧아요' : '너무 길어요', PAL.lightgrey, 0, 0); OG.sfx(s, 'miss'); }
        }
      } else if (a.ph === 'post') {
        if (a.pt >= 1.7) a.fin = 1;
      }
    },
    draw(g, s) {
      const a = s.a, cur = s.ents[s.cur];
      const c = { x: 0, y: 8, z: 18, F: 380, H: 48 };
      const L = OG.lookOf(cur || s.ents[0]);
      g.grad(0, 0, 480, 60, '#1b2a55', '#3b5a9a', 5);
      const sb = P(c, 0, 0, -31), stp = P(c, 0, 12, -31);
      g.crowd(0, Math.max(0, stp[1]), 480, sb[1] - Math.max(0, stp[1]), s.t, { seed: 31, density: 0.88, excite: a && a.tdT > 0 && s.t - a.tdT < 2 ? 0.9 : 0.1 });
      g.rect(0, sb[1] - 2, 480, 3, '#3a4466');
      g.rect(0, sb[1], 480, 270 - sb[1], '#3f8f40');
      // field
      Q3(g, c, [[-12.5, 0, -27.4], [12.5, 0, -27.4], [12.5, 0, 12], [-12.5, 0, 12]], '#4a9e47');
      for (let z = -18; z < 12; z += 4.57) if (Math.round((z + 18) / 4.57) % 2 === 0) Q3(g, c, [[-12.5, 0, z], [12.5, 0, z], [12.5, 0, z + 4.57], [-12.5, 0, z + 4.57]], '#52a84e');
      Q3(g, c, [[-12.5, 0, -27.4], [12.5, 0, -27.4], [12.5, 0, -18.3], [-12.5, 0, -18.3]], OG.shade(L.shirt, -0.25));
      for (let i = 0; i < 8; i++) { const x0 = -12.5 + i * 3.6; Q3(g, c, [[x0, 0, -27.4], [x0 + 1.2, 0, -27.4], [x0 + 3.6, 0, -18.3], [x0 + 2.4, 0, -18.3]], 'rgba(255,255,255,0.08)'); }
      const ez = P(c, 0, 0, -23);
      g.text('END ZONE', ez[0], ez[1] - 5, 'rgba(255,255,255,0.75)', { size: 'm', align: 'center' });
      for (let z = -18.3; z < 12; z += 4.57) L3(g, c, -12.5, 0, z, 12.5, 0, z, 'rgba(255,255,255,0.8)', 1);
      L3(g, c, -12.5, 0, -27.4, -12.5, 0, 12, '#ffffff', 2); L3(g, c, 12.5, 0, -27.4, 12.5, 0, 12, '#ffffff', 2);
      L3(g, c, -12.5, 0, -27.4, 12.5, 0, -27.4, '#ffffff', 2);
      [[-13.7, 5], [-9.1, 10], [-4.6, 15]].forEach(m => { const p = P(c, -10.5, 0, m[0]), q = P(c, 10.5, 0, m[0]); g.text(String(m[1]), p[0], p[1] - 4, 'rgba(255,255,255,0.7)', { size: 'xs', align: 'center' }); g.text(String(m[1]), q[0], q[1] - 4, 'rgba(255,255,255,0.7)', { size: 'xs', align: 'center' }); });
      L3(g, c, -12.5, 0, 0, 12.5, 0, 0, '#2ce8f5', 2);
      if (!a) return BT.flag.hud(g, s, a);
      const t = a.snapT >= 0 ? s.t - a.snapT : 0;
      const objs = [];
      const offLook = { shirt: L.shirt, pants: L.pants, skin: L.skin, hair: L.hair, sock: L.shirt, shoe: '#181425', num: 0 };
      const defLook = { shirt: '#3a4466', pants: '#c0cbdc', skin: PAL.skin3, hair: '#181425', sock: '#3a4466', shoe: '#181425' };
      const flagC = { off: '#fee761', def: '#e43b44' };
      for (let i = 0; i < 3; i++) {
        const rp = ffRecPos(a, i, a.ph === 'set' ? 0 : t);
        objs.push({ z: rp[1], f: () => {
          const p = P(c, rp[0], 0, rp[1]);
          const run = a.ph !== 'set' && (Math.abs(rp[2]) + Math.abs(rp[3]) > 0.1);
          const ph = s.t * 9 + i;
          const o = run ? { back: 1, lA: 0.6 + Math.sin(ph) * 0.5, rA: 0.6 - Math.sin(ph) * 0.5, legs: 0.15 + Math.sin(ph) * 0.2, legs2: 0.15 - Math.sin(ph) * 0.2 } : { back: 1, crouch: 0.3, lA: 0.4, rA: 0.4, legs: 0.2 };
          if (a.ph === 'post' && a.tgt === i && (a.msg === '캐치!' || a.msg === 'TOUCHDOWN!')) { o.lA = 2.6; o.rA = 2.6; }
          const J = ffig(g, p[0], p[1], p[2], offLook, o);
          g.rect(J.hipL[0] - 2, J.hipL[1], 2, Math.max(2, p[2] * 0.25), flagC.off); g.rect(J.hipR[0], J.hipR[1], 2, Math.max(2, p[2] * 0.25), flagC.off);
          if (a.ph === 'play' && a.sel === i) { g.ellipse(p[0], p[1], p[2] * 0.6, p[2] * 0.2, 'rgba(255,255,255,0.35)'); g.text('▼', J.head[0], J.head[1] - p[2] * 0.3 - 10, pcol(cur), { size: 'xs', align: 'center' }); g.text(FF_ROUTES[a.rt[i]].nm, J.head[0], J.head[1] - p[2] * 0.3 - 19, PAL.white, { size: 'xs', align: 'center', outline: PAL.black }); }
        } });
      }
      a.def.forEach((d, i) => objs.push({ z: d[1], f: () => {
        const p = P(c, d[0], 0, d[1]);
        const ph = s.t * 8 + i * 2;
        const J = ffig(g, p[0], p[1], p[2], defLook, a.ph === 'set' ? { crouch: 0.3, lA: 0.5, rA: 0.5, legs: 0.2 } : { lA: 0.6 + Math.sin(ph) * 0.4, rA: 0.6 - Math.sin(ph) * 0.4, legs: 0.15 + Math.sin(ph) * 0.15, legs2: 0.15 - Math.sin(ph) * 0.15 });
        g.rect(J.hipL[0] - 2, J.hipL[1], 2, Math.max(2, p[2] * 0.25), flagC.def); g.rect(J.hipR[0], J.hipR[1], 2, Math.max(2, p[2] * 0.25), flagC.def);
      } }));
      objs.push({ z: a.rush[1], f: () => { const p = P(c, a.rush[0], 0, a.rush[1]); const ph = s.t * 9; ffig(g, p[0], p[1], p[2], defLook, t > 1 ? { lA: 1.2 + Math.sin(ph) * 0.3, rA: 1.2 - Math.sin(ph) * 0.3, legs: 0.15 + Math.sin(ph) * 0.18, legs2: 0.15 - Math.sin(ph) * 0.18 } : { crouch: 0.4, lA: 0.3, rA: 0.3, legs: 0.25 }); } });
      // QB
      objs.push({ z: 4.5, f: () => {
        const p = P(c, 0, 0, 4.5);
        let o = { back: 1, lA: 0.8, rA: 1.0, lE: 1.0, rE: 1.2, legs: 0.18 };
        if (a.ph === 'play' && a.chg) o = { back: 1, lA: 1.3, rA: 2.7, rE: 1.2, legs: 0.25, legs2: 0.12 };
        if (a.ph === 'air' || (a.ph === 'post' && a.thT > 0)) { const e = Math.min(1, (s.t - a.thT) / 0.25); o = { back: 1, lA: 0.8, rA: 2.7 - e * 1.3, rE: 0.2, legs: 0.25, legs2: 0.1 }; }
        const J = ffig(g, p[0], p[1], p[2], Object.assign({}, offLook, { num: 7 }), o);
        g.rect(J.hipL[0] - 2, J.hipL[1], 2, Math.max(2, p[2] * 0.25), flagC.off); g.rect(J.hipR[0], J.hipR[1], 2, Math.max(2, p[2] * 0.25), flagC.off);
        if (a.ph !== 'air' && !(a.ph === 'post' && a.thT > 0)) g.ellipse(J.hR[0], J.hR[1] - 2, 3, 2, '#8a4b2c');
        if (cur) g.text(OG.entLabel(cur), J.head[0], J.head[1] - p[2] * 0.3 - 9, pcol(cur), { size: 'xs', align: 'center', outline: PAL.black });
      } });
      if (a.ph === 'air') objs.push({ z: a.bz, f: () => {
        const p = P(c, a.bx, a.by, a.bz), sh = P(c, a.bx, 0, a.bz);
        g.ellipse(sh[0], sh[1], 2, 1, 'rgba(0,0,0,0.3)');
        const rx = Math.max(3, p[2] * 0.18), ry = Math.max(2, p[2] * 0.11);
        g.ellipse(p[0], p[1], rx + 1, ry + 1, '#f4f4f4');
        g.ellipse(p[0], p[1], rx, ry, '#8a4b2c'); g.rect(p[0] - 1, p[1], 3, 1, '#ffffff');
        const tp = P(c, a.tx, 0, a.tz); g.alpha(0.5); g.circleO(tp[0], tp[1], 4, '#ffffff'); g.alpha(1);
      } });
      objs.sort((p, q) => p.z - q.z);
      objs.forEach(o => o.f());
      // power bar
      if (a.ph === 'play' && cur) {
        const x = 300, y = 236, w = 100;
        g.panel(x - 6, y - 10, w + 12, 24, { title: '패스 파워' });
        g.rect(x, y, w, 8, PAL.black);
        g.rect(x + 1, y + 1, (w - 2) * a.pw, 6, Math.abs(a.pw - a.need) < 0.08 ? PAL.green : PAL.gold);
        const nx = x + 1 + (w - 2) * a.need;
        g.rect(nx, y - 2, 1, 12, '#ffffff');
        const rem = Math.max(0, 6 - t);
        g.text('러시 ' + rem.toFixed(1) + 's', x - 12, y, rem < 2 ? PAL.red : PAL.white, { size: 'xs', align: 'right', outline: PAL.black });
      }
      if (a.ph === 'set') g.text(a.pt < 0.6 ? 'SET…' : 'HUT!', 240, 150, PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
      if (a.tdT > 0) fireworks(g, a.tdT, s.t, 4);
      BT.flag.hud(g, s, a);
    },
    hud(g, s, a) {
      const cur = s.ents[s.cur];
      if (cur && s.ph !== 'final') {
        const r = s.rec[s.cur];
        g.panel(6, 8, 124, 42, { title: OG.entLabel(cur) + ' 공격' });
        g.text(r.pts + '점', 12, 16, PAL.yellow, { size: 'xl' });
        for (let i = 0; i < s.N; i++) {
          const v = r.log[i], x = 74 + (i % 3) * 17, y = 17 + Math.floor(i / 3) * 13;
          g.rect(x, y, 14, 10, v == null ? '#262b44' : v >= 6 ? '#b8860b' : v > 0 ? '#3e8948' : '#a22633');
          g.text(v == null ? String(i + 1) : v >= 6 ? 'TD' : String(v), x + 7, y + 1, PAL.white, { size: 'xs', align: 'center' });
        }
      }
      bigMsg(g, s, a, 96);
      if (a && cur && s.ph === 'play' && a.ph === 'play') g.rich('{L}{R} 리시버 선택 · {A} 꾹→떼면 패스 (흰 선 = 적정 파워)', 6, 258, PAL.white, { shadow: true });
    }
  };

  OG.defineEngine('batting', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) {
      const cfg = ev.cfg || {};
      const kind = BT[cfg.kind] ? cfg.kind : 'bat';
      const K = BT[kind];
      const hum = [];
      ents.forEach((e, i) => { if (e.human) hum.push(i); });
      const s = {
        evId: ev.id, kind, soft: cfg.soft ? 1 : 0, t: -3, ph: 'cd', pt: 0, prog: 0,
        ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name || e.country, tag: e.tag || '', skill: e.skill, look: e.look | 0 })),
        hum, ti: -1, cur: -1, rec: ents.map(() => K.rec()), cpu: ents.map(() => null), ban: null, a: null, N: 0, cap: 0,
        done: false, results: null
      };
      K.att(s, hum.length);
      ents.forEach((e, i) => { if (!e.human) s.cpu[i] = K.cpu(s, e, R); });
      return s;
    },
    update(s, inputs, dt, R) {
      if (s.done) return;
      const K = BT[s.kind];
      s.t += dt; s.pt += dt;
      if (s.ph === 'cd') { if (s.t >= 0) btNextTurn(s, R); }
      else if (s.ph === 'ban') { if (s.pt >= 1.7) { s.ph = 'play'; s.pt = 0; } }
      else if (s.ph === 'play') {
        const e = s.ents[s.cur];
        const inp = (e && e.human && inputs && inputs[e.pid]) || BLANK;
        K.update(s, s.a, inp, dt, R);
        if (s.a.fin) { if (K.over(s, s.rec[s.cur])) btNextTurn(s, R); else K.start(s, R); }
      } else if (s.ph === 'cpu') {
        s.prog = Math.min(1, s.pt / 6);
        if (s.pt > 6.5) { s.ph = 'final'; s.pt = 0; OG.sfx(s, 'cheer'); }
      } else if (s.ph === 'final') {
        if (s.pt > 2.4) {
          const rows = s.ents.map((e, i) => {
            if (e.human) { const r = K.result(s, s.rec[i]); return { idx: e.idx, score: r.score, text: r.text }; }
            return { idx: e.idx, score: s.cpu[i].sc, text: s.cpu[i].tx };
          });
          s.results = OG.sortResults(rows, false);
          s.done = true;
        }
      }
    },
    draw(g, s) {
      const K = BT[s.kind];
      K.draw(g, s);
      btBoard(g, s, 368, 8, 108);
      btBanner(g, s);
      if (s.ph === 'cd') g.countdown(-s.t);
      if (s.ph === 'cpu') g.banner('CPU 경기 진행 중…', 110, PAL.white, { size: 'l' });
      if (s.ph === 'final') g.banner('경기 종료', 100, PAL.yellow);
    }
  });

  OG.defineEvents([
    { id: 'baseball_hr', name: '야구 홈런 더비', en: 'Baseball Home Run Derby', sport: 'baseball', icon: '⚾', tags: ['summer', 'asian'], engine: 'batting',
      cfg: { kind: 'bat', soft: 0 },
      help: ['{U}{D}{L}{R} 스윙 위치를 공 코스에 맞추고 {A} 스윙', '빠르면 당겨치기, 늦으면 밀어치기 · 너무 벗어나면 파울', '홈런이 아닌 타구·스트라이크는 아웃!'] },
    { id: 'softball_hr', name: '소프트볼 홈런 더비', en: 'Softball Home Run Derby', sport: 'softball', icon: '🥎', tags: ['summer', 'asian'], engine: 'batting',
      cfg: { kind: 'bat', soft: 1 },
      help: ['윈드밀 투구! {U}{D}{L}{R} 스윙 위치 · {A} 스윙', '라이즈볼은 떠오르고 드롭볼은 떨어져요', '펜스까지 약 67m'] },
    { id: 'cricket_t20', name: '크리켓 T20 배팅', en: 'Cricket T20 Batting', sport: 'cricket', icon: '🏏', tags: ['summer', 'asian'], engine: 'batting',
      cfg: { kind: 'cricket' },
      help: ['공이 튀어 배트에 올 때 {A} 스윙 · {L}{R} 치는 방향', '{U} 누르며 치면 띄워치기: 6점 노리기 (캐치 위험)', '스텀프 맞으면 아웃 — 2아웃이면 끝'] },
    { id: 'rugby_kick', name: '럭비 세븐스 컨버전 킥', en: 'Rugby Sevens Conversion', sport: 'rugby', icon: '🏉', tags: ['summer', 'asian'], engine: 'batting',
      cfg: { kind: 'rugby' },
      help: ['{L}{R} 조준 — 바람에 공이 밀려요', '{A} 파워 게이지 시작 → {A} 결정 (흰 선 이상)', '거리와 각도가 점점 어려워져요 · 성공 2점'] },
    { id: 'flagfootball', name: '플래그 풋볼 패스', en: 'Flag Football Passing', sport: 'flag_football', icon: '🏈', tags: ['summer'], engine: 'batting',
      cfg: { kind: 'flag' },
      help: ['LA 2028 신종목! {L}{R} 리시버 선택', '{A} 꾹 눌러 파워 → 떼면 리드 패스 (흰 선에 맞추기)', '엔드존 캐치 = 터치다운 6점 · 러셔가 오기 전에!'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
