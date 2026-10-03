/* =========================================================================
 * engine: air — aerial trick events (turn-based solo)
 *   dive10m dive3m trampoline vault aerials halfpipe bigair bmx_free
 *   skate_street surfing
 *
 * Every event "kind" is a small module in KIND{}:
 *   init(s, ent, R) → attempt state a     upd(s, a, inp, dt, R)   (sets a.fin)
 *   judge(s, a, R)  → scorecard            cpu(s, ent, R) → {sc, nm}
 *   draw(g, s, a)   hint(s, a) → rich text fmt(v) → result text
 * The engine wrapper runs the turns (humans only, 1–3 attempts each), reveals
 * simulated CPU attempts round by round, shows judges' scorecards and the
 * leaderboard, and produces the final ranking.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI, TAU = PI * 2, S = Math.sin, C = Math.cos, abs = Math.abs;
  const clamp = M.clamp, lerp = M.lerp, appr = M.approach;
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const sgn = v => (v < 0 ? -1 : 1);
  const nAng = a => M.angDiff(0, a);            // → (-PI, PI]
  const H = OG.hash;
  const KIND = {};
  const POSE = OG.Pose;

  /* ============================================================ figure ===
   * Copy of g.figure with extras:
   *   sq    : x-squish of the body frame (cos of twist / spin angle) – shows
   *           twists & spins in side view, sign flips the facing
   *   anchor: 'hip' (default) | 'feet' | 'com' (centre of mass → clean flips)
   *   mono  : one colour silhouette (motion trails)
   * Returns joints + J.P(lx, ly) local→screen for props.            */
  const SEG = { th: 5.5, sh: 5.5, to: 8, ua: 4.2, fa: 4.2, hd: 2.6 };
  function fig(g, x, y, pose, look, o) {
    o = o || {}; look = look || {};
    const f = o.f || 1, s = o.s || 2;
    let sq = o.sq == null ? 1 : o.sq;
    if (abs(sq) < 0.22) sq = sq < 0 ? -0.22 : 0.22;
    const fs = sq < 0 ? -1 : 1;
    const rot = (pose.rot || 0) + (o.rot || 0);
    const cr = C(rot), sr = S(rot);
    const tl = (lx, ly) => { lx *= sq; return [(lx * cr - ly * sr) * f * s, (lx * sr + ly * cr) * s]; };
    const dir = (an, l) => [S(an) * l, C(an) * l];
    const t = pose.t || 0;
    const nk = [S(t) * SEG.to, -C(t) * SEG.to];
    const sh = [nk[0] * 0.92, nk[1] * 0.92];
    const limb = (b, a1, l1, a2, l2) => { const d1 = dir(a1, l1), j = [b[0] + d1[0], b[1] + d1[1]], d2 = dir(a2, l2); return [j, [j[0] + d2[0], j[1] + d2[1]]]; };
    const aL = (pose.aL || 0) + t, aR = (pose.aR || 0) + t;
    const arL = limb(sh, aL, SEG.ua, aL + (pose.eL || 0), SEG.fa), arR = limb(sh, aR, SEG.ua, aR + (pose.eR || 0), SEG.fa);
    const lL = pose.lL || 0, lR = pose.lR || 0;
    const lgL = limb([0, 0], lL, SEG.th, lL - (pose.kL || 0), SEG.sh), lgR = limb([0, 0], lR, SEG.th, lR - (pose.kR || 0), SEG.sh);
    const hh = t + (pose.h || 0);
    const hd = [nk[0] + S(hh) * 3.2, nk[1] - C(hh) * 3.2];
    const loc = { neck: nk, sh: sh, head: hd, elL: arL[0], hdL: arL[1], elR: arR[0], hdR: arR[1], knL: lgL[0], ftL: lgL[1], knR: lgR[0], ftR: lgR[1] };
    let hx = x, hy = y;
    if (o.anchor === 'feet') {
      let low = -99;
      ['ftL', 'ftR', 'hdL', 'hdR', 'knL', 'knR'].forEach(k => { low = Math.max(low, tl(loc[k][0], loc[k][1])[1]); });
      low = Math.max(low, tl(hd[0], hd[1])[1] + SEG.hd * s);
      hy = y - low - 1;
    } else if (o.anchor === 'com') {
      let ax = 0, ay = 0, n = 0;
      ['neck', 'head', 'knL', 'knR', 'ftL', 'ftR', 'elR', 'hdR'].forEach(k => { const p = tl(loc[k][0], loc[k][1]); ax += p[0]; ay += p[1]; n++; });
      hx = x - ax / (n + 1); hy = y - ay / (n + 1);
    }
    const P = (lx, ly) => { const p = tl(lx, ly); return [hx + p[0], hy + p[1]]; };
    const J = { hip: [hx, hy], P: P, loc: loc, f: f, s: s, sq: sq, fe: f * fs, rot: rot };
    for (const k in loc) J[k] = P(loc[k][0], loc[k][1]);
    J.shL = J.sh; J.shR = J.sh;
    if (o.noDraw) return J;
    const mono = o.mono;
    const dk = c => (mono ? c : OG.shade(c, -0.28));
    const shirt = mono || look.suit || look.shirt || PAL.red;
    const pants = mono || look.suit || look.pants || PAL.navy;
    const skin = mono || look.skin || PAL.skin2;
    const shoe = mono || look.shoe || PAL.black;
    const sleeve = mono || (look.suit || look.sleeves ? shirt : skin);
    const legLow = mono || (look.suit || look.tights ? pants : skin);
    const thigh = mono || look.thigh || pants;
    const ua = mono || look.ua || shirt;
    const T = Math.max(1, Math.round(2 * s * (o.thin || 1))), TT = Math.max(2, Math.round(3 * s * (o.thin || 1)));
    const L = (a, b, c, th) => g.line(a[0], a[1], b[0], b[1], c, th);
    const olc = o.ol === false || s < 2 ? null : (o.ol || '#181425');
    if (olc && !mono) { // 1px dark outline
      const oc = olc, T2 = T + 2, TT2 = TT + 2;
      [[J.hip, J.knL, T2], [J.knL, J.ftL, T2], [J.sh, J.elL, T2], [J.elL, J.hdL, T2], [J.hip, J.neck, TT2], [J.hip, J.knR, T2], [J.knR, J.ftR, T2], [J.sh, J.elR, T2], [J.elR, J.hdR, T2]].forEach(q => L(q[0], q[1], oc, q[2]));
      g.circle(J.head[0], J.head[1], SEG.hd * s + 1, oc);
    }
    L(J.hip, J.knL, dk(thigh), T); L(J.knL, J.ftL, dk(legLow), T);
    if (!o.noShoe) g.rect(J.ftL[0] - s / 2, J.ftL[1] - s / 2, s + 1, s, dk(shoe));
    L(J.sh, J.elL, dk(ua), T); L(J.elL, J.hdL, dk(sleeve), T);
    L(J.hip, J.neck, shirt, TT);
    if (!mono && look.stripe) L([lerp(J.hip[0], J.neck[0], 0.35), lerp(J.hip[1], J.neck[1], 0.35)], [lerp(J.hip[0], J.neck[0], 0.55), lerp(J.hip[1], J.neck[1], 0.55)], look.stripe, TT);
    g.rect(J.hip[0] - s, J.hip[1] - s, 2 * s + 1, 2 * s, pants);
    L(J.hip, J.knR, thigh, T); L(J.knR, J.ftR, legLow, T);
    if (!o.noShoe) g.rect(J.ftR[0] - s / 2 - (J.fe < 0 ? s / 2 : 0), J.ftR[1] - s / 2, s + 1 + s / 2, s, shoe);
    const hr = SEG.hd * s;
    g.circle(J.head[0], J.head[1], hr, skin);
    if (!mono) {
      const hc = look.cap || look.hair || PAL.black;
      const upx = sr, upy = -cr, bkx = -cr * fs, bky = -sr * fs;
      const Ri = Math.round(hr);
      for (let i = -Ri; i <= Ri; i++) {
        for (let j = -Ri; j <= Ri; j++) {
          if (i * i + j * j > hr * hr + 0.5) continue;
          const du = i * upx * f + j * upy, db = i * bkx * f + j * bky;
          if (du > hr * 0.15 || (db > hr * 0.35 && du > -hr * 0.5 && !look.cap)) g.px(J.head[0] + i, J.head[1] + j, hc);
        }
      }
      if (look.visor) {
        const v = tl(1.6, 0.2);
        const vx = J.head[0] + v[0] * 0.9 / s * s, vy = J.head[1] + v[1] * 0.9 / s * s;
        g.rect(vx - s, vy - s / 2, s * 2, s, look.visor);
      }
    }
    L(J.sh, J.elR, ua, T); L(J.elR, J.hdR, sleeve, T);
    return J;
  }

  /* ============================================================ props === */
  // Board under the feet. o: {len, off, w (width for flip), col, bot, edge, flip (rad), spin (rad), wheels, skis, nose}
  function board(g, J, o) {
    const lc = J.loc;
    const mx = (lc.ftL[0] + lc.ftR[0]) / 2 + (o.dx || 0), my = Math.max(lc.ftL[1], lc.ftR[1]) + (o.off == null ? 1 : o.off);
    const L = o.len, cs = C(o.spin || 0) * L;
    if (o.skis) {
      const a1 = J.P(mx - cs * 0.85, my + 0.3), a2 = J.P(mx + cs, my + 0.3), t2 = J.P(mx + cs + 1.6 * sgn(cs), my - 0.9);
      g.line(a1[0], a1[1], a2[0], a2[1], OG.shade(o.col, -0.35), 2);
      const b1 = J.P(mx - cs * 0.85 - 1.2, my - 0.4), b2 = J.P(mx + cs - 1.2, my - 0.4), u2 = J.P(mx + cs + 0.4 * sgn(cs), my - 1.6);
      g.line(b1[0], b1[1], b2[0], b2[1], o.col, 2); g.line(b2[0], b2[1], u2[0], u2[1], o.col, 2); g.line(a2[0], a2[1], t2[0], t2[1], OG.shade(o.col, -0.35), 2);
      return;
    }
    const fl = o.flip || 0, wd = (o.w || 1.4) * S(fl);
    const p1 = J.P(mx - cs, my), p2 = J.P(mx + cs, my), q1 = J.P(mx - cs, my - wd), q2 = J.P(mx + cs, my - wd);
    const top = C(fl) >= 0;
    if (abs(wd) > 0.4) g.poly([p1[0], p1[1], p2[0], p2[1], q2[0], q2[1], q1[0], q1[1]], top ? o.col : (o.bot || o.col));
    const th = o.th || 2;
    g.line(p1[0], p1[1], p2[0], p2[1], top ? o.col : (o.bot || o.col), th);
    if (o.edge) g.line(p1[0], p1[1] + 1, p2[0], p2[1] + 1, o.edge, 1);
    if (o.nose) {
      const n1 = J.P(mx + cs + 1.3 * sgn(cs), my - 0.9), n0 = J.P(mx - cs - 1.3 * sgn(cs), my - 0.9);
      g.line(p2[0], p2[1], n1[0], n1[1], top ? o.col : (o.bot || o.col), th);
      g.line(p1[0], p1[1], n0[0], n0[1], top ? o.col : (o.bot || o.col), th);
    }
    if (o.wheels && C(fl) > 0.5) {
      const w1 = J.P(mx - cs * 0.62, my + 1.3), w2 = J.P(mx + cs * 0.62, my + 1.3);
      g.rect(w1[0] - 1, w1[1] - 1, 3, 3, o.wheels); g.rect(w2[0] - 1, w2[1] - 1, 3, 3, o.wheels);
    }
  }
  // rotated ellipse outline
  function ringE(g, cx, cy, rx, ry, rot, c, th) {
    const n = Math.max(14, Math.round((abs(rx) + ry) * 2.2)), cr = C(rot), sr = S(rot);
    th = th || 2;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, lx = C(a) * rx, ly = S(a) * ry;
      g.rect(Math.round(cx + lx * cr - ly * sr - th / 2), Math.round(cy + lx * sr + ly * cr - th / 2), th, th, c);
    }
  }

  /* ========================================================= particles === */
  const FXC = ['#ffffff', '#d5e2f2', '#9fd8ff', '#2a8fd6', '#c8a878', '#feae34', '#fee761', '#e43b44', '#2ce8f5', '#8b9bb4', '#e8f8ff', '#f77622', '#63c74d', '#b55088', '#5a6988', '#7a5a3a'];
  function fx(s, R, x, y, n, o) {
    o = o || {};
    for (let i = 0; i < n; i++) {
      if (s.fx.length >= 150) s.fx.shift();
      const an = (o.ang == null ? -PI / 2 : o.ang) + (R.f() - 0.5) * (o.spr == null ? PI : o.spr);
      const sp = (o.spd || 60) * (0.35 + R.f() * 0.85);
      const life = (o.life || 0.8) * (0.55 + R.f() * 0.6);
      const c = o.c == null ? 0 : (Array.isArray(o.c) ? o.c[R.i(o.c.length)] : o.c);
      s.fx.push([r1(x + (R.f() - 0.5) * (o.w || 0)), r1(y + (R.f() - 0.5) * (o.h || 0)), r1(C(an) * sp + (o.vx || 0)), r1(S(an) * sp + (o.vy || 0)), r2(life), r2(life), c, o.sz || 1 + R.i(2), o.gr == null ? 220 : o.gr]);
    }
  }
  function fxStep(s, dt) {
    for (let i = s.fx.length - 1; i >= 0; i--) {
      const p = s.fx[i];
      p[4] = r2(p[4] - dt);
      if (p[4] <= 0) { s.fx.splice(i, 1); continue; }
      p[3] = r1(p[3] + p[8] * dt); p[2] = r1(p[2] * (1 - 0.6 * dt));
      p[0] = r1(p[0] + p[2] * dt); p[1] = r1(p[1] + p[3] * dt);
    }
    for (let i = s.pop.length - 1; i >= 0; i--) { const q = s.pop[i]; q.t = r2(q.t + dt); if (q.t > q.d) s.pop.splice(i, 1); }
  }
  function fxDraw(g, s, cx, cy) {
    for (const p of s.fx) {
      const k = p[4] / p[5];
      const sz = p[7] > 1 && k < 0.35 ? p[7] - 1 : p[7];
      if (k < 0.25) g.alpha(0.55);
      g.rect(Math.round(p[0] - cx - sz / 2), Math.round(p[1] - cy - sz / 2), sz, sz, FXC[p[6]] || '#fff');
      if (k < 0.25) g.alpha(1);
    }
  }
  // floating feedback text (screen space by default)
  function pop(s, str, c, o) {
    o = o || {};
    if (s.pop.length > 6) s.pop.shift();
    s.pop.push({ s: str, c: c || PAL.yellow, x: o.x == null ? 240 : r1(o.x), y: o.y == null ? 62 : r1(o.y), t: 0, d: o.d || 1.5, z: o.z || 'xl', w: o.w ? 1 : 0 });
  }
  function popDraw(g, s) {
    const cam = s.cam;
    for (const q of s.pop) {
      const k = q.t / q.d;
      let x = q.x, y = q.y - k * 14;
      if (q.w) { x -= cam[0]; y -= cam[1]; }
      if (k > 0.75) g.alpha(Math.max(0, (1 - k) / 0.25));
      const jump = q.t < 0.12 ? Math.round((0.12 - q.t) * 40) : 0;
      g.text(q.s, x, y - jump, q.c, { size: q.z, align: 'center', outline: PAL.black });
      g.alpha(1);
    }
  }

  /* ========================================================= flip model ===
   * Shared by diving / trampoline / vault / aerials.
   * modes: T tuck, P pike, L layout-flip, O open (no key), X line/kick-out (ACTION)
   * P: { dir, d:'T'|'L' (▼), u:'P'|'T' (▲), w:{T,P,L,O,X} rev/s, twS twist step, twV twist rad/s,
   *      twM max twist, cw correction window, cv correction speed, tgt orientation period }   */
  function flipInit(a) {
    a.rot = 0; a.rv = 0; a.tw = 0; a.twT = 0; a.tk = 0; a.pk = 0; a.lx = 0; a.ln = 0; a.started = 0;
    a.tT = 0; a.pT = 0; a.lT = 0; a.md = 'O'; a.stT = -9; a.at = 0; a.tr = []; a.tc = 0;
  }
  function flipUpd(a, inp, dt, P) {
    a.at += dt;
    let md = 'O';
    if (inp.d) md = P.d; else if (inp.u) md = P.u;
    if (md !== 'O') a.ln = 0;
    if (inp.ap) { a.ln = 1; a.stT = a.at; }
    if (md === 'O' && a.ln) md = 'X';
    if (md === 'T' || md === 'P' || md === 'L') a.started = 1;
    a.md = md;
    const tk = md === 'T' ? 1 : 0, pk = md === 'P' ? 1 : 0, lx = md === 'X' ? 1 : 0;
    const k = Math.min(1, dt * 13);
    a.tk += (tk - a.tk) * k; a.pk += (pk - a.pk) * k; a.lx += (lx - a.lx) * k;
    let w = P.w[md] * TAU * P.dir;
    if (md === 'O' && !a.started) w = 0;
    a.rv += (w - a.rv) * Math.min(1, dt * (md === 'O' || md === 'X' ? 16 : 13));
    a.rot += a.rv * dt;
    if (md === 'X' && P.cw) { // "saving" the entry / landing
      const per = P.tgt || TAU;
      const near = Math.round(a.rot / per) * per, d = near - a.rot;
      if (abs(d) < P.cw) a.rot += clamp(d, -P.cv * dt, P.cv * dt);
    }
    if (abs(a.rv) > 2.5) { if (md === 'T') a.tT += dt; else if (md === 'P') a.pT += dt; else a.lT += dt; }
    if ((inp.lp || inp.rp) && a.twT < P.twM - 0.01) a.twT += P.twS;
    if (a.tk < 0.45) a.tw = appr(a.tw, a.twT, P.twV * dt);
  }
  function trail(a, x, y, every) {
    a.tc = (a.tc || 0) + 1;
    if (a.tc % (every || 3)) return;
    a.tr.push([r1(x), r1(y), r2(a.rot), r2(a.tw || 0), r2(a.tk || 0), r2(a.pk || 0)]);
    if (a.tr.length > 5) a.tr.shift();
  }
  const P_TWIST = { t: 0, aL: 0.5, aR: 0.4, eL: 2.3, eR: 2.4, lL: 0.04, lR: -0.04, kL: 0, kR: 0 };
  const P_OPEN = { t: 0.05, aL: 2.2, aR: 2.5, eL: 0.2, eR: 0.2, lL: 0.12, lR: -0.05, kL: 0.15, kR: 0.05 };
  const P_LINE_UP = { t: 0, aL: PI, aR: PI, eL: 0, eR: 0, lL: 0, lR: 0, kL: 0, kR: 0 };
  const P_LINE_DN = { t: 0, aL: 0.05, aR: -0.05, eL: 0, eR: 0, lL: 0.02, lR: -0.02, kL: 0, kR: 0 };
  const P_LAND = { t: 0.55, aL: 1.7, aR: 1.9, eL: 0.2, eR: 0.2, lL: 1.0, lR: 0.9, kL: 1.7, kR: 1.6 };
  const P_DOWN = { t: -0.35, aL: -0.7, aR: -0.5, eL: 0.1, eR: 0.1, lL: 1.5, lR: 1.4, kL: 0.15, kR: 0.4, h: 0.3 };
  function sitDown(g, x, gy, look, o) { return fig(g, x, gy - 4, P_DOWN, look, Object.assign({ anchor: 'hip' }, o || {})); }
  function airPose(a, open, line) {
    let p = open || P_OPEN;
    const twA = abs((a.twT || 0) - (a.tw || 0)) > 0.05 ? 1 : 0;
    if (twA) p = POSE.mix(p, P_TWIST, 0.85);
    if (a.lx > 0.02) p = POSE.mix(p, line || P_LINE_UP, Math.min(1, a.lx));
    if (a.tk > 0.02) p = POSE.mix(p, POSE.tuck(), Math.min(1, a.tk));
    if (a.pk > 0.02) p = POSE.mix(p, POSE.pike(), Math.min(1, a.pk));
    return p;
  }
  function posLetter(a) { return a.tT >= a.pT && a.tT >= 0.12 ? 'C' : a.pT >= 0.12 ? 'B' : 'A'; }
  const POSKO = { A: '펴서', B: '굽혀', C: '감싸', D: '자유' };
  const half = n => (n <= 0 ? '0' : (Math.floor(n / 2) ? Math.floor(n / 2) : '') + (n % 2 ? '½' : ''));
  // rotation trail + speed arcs
  function drawTrail(g, a, cam, look, open, o) {
    o = o || {};
    const n = a.tr.length;
    for (let i = 0; i < n; i++) {
      const tr = a.tr[i];
      const pa = { tk: tr[4], pk: tr[5], lx: 0, tw: tr[3], twT: tr[3] };
      g.alpha(0.05 + 0.035 * i);
      fig(g, tr[0] - cam[0], tr[1] - cam[1], airPose(pa, open), look, { f: o.f || 1, rot: tr[2], sq: C(tr[3]), anchor: 'com', mono: o.col || '#ffffff', noShoe: 1 });
    }
    g.alpha(1);
  }
  function spinArcs(g, x, y, rv, r, t) {
    if (abs(rv) < 5) return;
    const k = Math.min(1, (abs(rv) - 5) / 8);
    g.alpha(0.25 + 0.35 * k);
    const base = t * rv;
    for (let j = 0; j < 2; j++) {
      const a0 = base + j * PI;
      for (let i = 0; i < 9; i++) {
        const a = a0 - sgn(rv) * i * 0.13;
        g.rect(Math.round(x + C(a) * r) - 1, Math.round(y + S(a) * r) - 1, 2, 2, i < 3 ? '#ffffff' : '#c0cbdc');
      }
    }
    g.alpha(1);
  }

  /* =========================================================== judging === */
  function judges(R, base, n, spread, step, max) {
    const js = [];
    for (let i = 0; i < n; i++) js.push(r2(clamp(Math.round((base + R.gauss() * spread) / step) * step, 0, max)));
    return js;
  }
  function dropMarks(js, nd) {
    const idx = js.map((v, i) => i).sort((a, b) => js[a] - js[b] || a - b);
    const dr = js.map(() => false);
    for (let k = 0; k < nd; k++) { dr[idx[k]] = true; dr[idx[idx.length - 1 - k]] = true; }
    return dr;
  }
  const kept = (js, dr) => js.reduce((t, v, i) => t + (dr[i] ? 0 : v), 0);
  const keptAvg = (js, dr) => kept(js, dr) / Math.max(1, dr.filter(d => !d).length);
  function agg(rule, arr) {
    if (!arr.length) return null;
    if (rule === 'sum') return arr.reduce((a, b) => a + b, 0);
    if (rule === 'avg') return arr.reduce((a, b) => a + b, 0) / arr.length;
    if (rule === 'best2') { const v = arr.slice().sort((a, b) => b - a); return v[0] + (v[1] || 0); }
    return Math.max.apply(null, arr);
  }
  function listOf(s, i) { const e = s.ents[i]; return e.human ? s.sc[i] : s.cpuA[i].slice(0, s.rnd).map(x => x[0]); }
  function standings(s) {
    const rows = s.ents.map((e, i) => ({ i: i, v: agg(s.rule, listOf(s, i)), n: listOf(s, i).length }));
    rows.sort((a, b) => (b.v == null ? -1e9 : b.v) - (a.v == null ? -1e9 : a.v) || a.i - b.i);
    return rows;
  }

  /* =============================================================== HUD === */
  const lookOf = e => OG.lookOf(e);
  function curEnt(s) { return s.a ? s.ents[s.a.e] : s.ents[0]; }
  function hudTurn(g, s) {
    const e = curEnt(s);
    if (!e) return;
    const col = e.human ? OG.PCOLORS[e.pid % 8] : PAL.lightgrey;
    g.rect(4, 4, 150, 22, 'rgba(24,20,37,0.78)');
    g.rect(4, 4, 3, 22, col);
    g.flag(e.country, 11, 9, 18, 12);
    g.text(OG.entLabel(e), 34, 6, col, { size: 'b', outline: PAL.black });
    g.text(e.name, 34 + g.textW(OG.entLabel(e), 'b') + 5, 8, PAL.white, { size: 's', maxW: 70 });
    const att = Math.floor(s.ti / Math.max(1, s.nH)) + 1;
    g.text(att + '/' + s.nAtt + (s.attW || '차 시기'), 150, 16, PAL.gold, { size: 'xs', align: 'right' });
    // mini leader
    const st = standings(s).filter(r => r.v != null);
    if (st.length) {
      const L = s.ents[st[0].i], K = KIND[s.kind];
      const txt = '1위 ' + OG.entLabel(L) + ' ' + K.fmt(st[0].v);
      const w = g.textW(txt, 's') + 26;
      g.rect(476 - w, 4, w, 16, 'rgba(24,20,37,0.78)');
      g.flag(L.country, 480 - w, 7, 12, 8);
      g.text(txt, 472, 7, PAL.medalGold, { size: 's', align: 'right' });
    }
  }
  function hintBar(g, str) {
    g.rect(0, 255, 480, 15, 'rgba(24,20,37,0.82)');
    g.rich(str, 240, 257, PAL.white, { align: 'center' });
  }
  function turnBanner(g, s) {
    const e = curEnt(s);
    if (!e) return;
    const k = Math.min(1, s.pt / 0.25);
    const col = e.human ? OG.PCOLORS[e.pid % 8] : PAL.lightgrey;
    const y = 38;
    g.alpha(0.9 * k);
    g.rect(0, y, 480, 34, 'rgba(24,20,37,0.85)');
    g.rect(0, y, 480, 2, col); g.rect(0, y + 32, 480, 2, col);
    g.alpha(1);
    const x0 = 240 - 74 + (1 - k) * -60;
    g.flag(e.country, x0, y + 6, 33, 22, { wave: g.t });
    g.text((e.human ? e.tag : e.country) + ' 차례', x0 + 42, y + 4, col, { size: 'xl', outline: PAL.black });
    const att = Math.floor(s.ti / Math.max(1, s.nH)) + 1;
    g.text(e.name + ' · ' + att + '/' + s.nAtt + (s.attW || '차 시기'), 240, y + 38, PAL.white, { size: 's', align: 'center', outline: PAL.black });
  }
  function drawCard(g, s) {
    const cd = s.card;
    if (!cd) return;
    const e = s.ents[cd.who], col = e.human ? OG.PCOLORS[e.pid % 8] : PAL.lightgrey;
    const t = s.pt;
    const nj = cd.js ? cd.js.length : 0;
    const w = 372, h = 98, x = 54, y = 150;
    g.panel(x, y, w, h, { title: '심판 채점', border: col, titleColor: PAL.black });
    g.flag(e.country, x + 8, y + 9, 18, 12);
    g.text(OG.entLabel(e), x + 30, y + 9, col, { size: 'b' });
    g.text(cd.nm, x + 58, y + 10, PAL.white, { size: 's', maxW: w - 66 - (cd.note ? 70 : 0) });
    if (cd.note) g.text(cd.note, x + w - 8, y + 9, cd.bad ? PAL.red : PAL.green, { size: 'b', align: 'right', outline: PAL.black });
    // judges' cards
    const cw = 30, gap = 4, totalW = nj * (cw + gap) - gap;
    const jx = x + Math.round((w - totalW) / 2), jy = y + 27;
    for (let i = 0; i < nj; i++) {
      const show = t > 0.25 + i * 0.12;
      const cx = jx + i * (cw + gap);
      g.rect(cx + 1, jy + 1, cw, 22, PAL.black);
      if (!show) { g.rect(cx, jy, cw, 22, PAL.slate); continue; }
      const dropped = cd.dr && cd.dr[i] && t > 0.4 + nj * 0.12;
      g.rect(cx, jy, cw, 22, dropped ? PAL.darkgrey : PAL.white);
      g.rect(cx, jy, cw, 4, dropped ? PAL.grey : col);
      g.text(cd.js[i].toFixed(cd.jf == null ? 1 : cd.jf), cx + cw / 2, jy + 8, dropped ? PAL.lightgrey : PAL.black, { size: 's', align: 'center' });
      if (dropped) g.line(cx + 3, jy + 19, cx + cw - 4, jy + 6, PAL.red, 1);
    }
    const ty = y + 56;
    if (t > 0.5 + nj * 0.12) {
      let tx = x + 10;
      (cd.parts || []).forEach(p => {
        g.text(p[0], tx, ty, PAL.gold, { size: 's' });
        tx += g.textW(p[0], 's') + 3;
        g.text(p[1], tx, ty, PAL.white, { size: 's' });
        tx += g.textW(p[1], 's') + 10;
      });
      if (cd.dd) {
        g.text('난이도', tx, ty, PAL.gold, { size: 's' });
        g.text(cd.dd.toFixed(1), tx + 34, ty, PAL.white, { size: 's' });
      }
    }
    if (t > 0.9 + nj * 0.12) {
      g.text(cd.tot, x + w - 12, ty - 3, PAL.yellow, { size: 'xl', align: 'right', outline: PAL.black });
      const st = standings(s), rk = st.findIndex(r => r.i === cd.who) + 1;
      const K = KIND[s.kind];
      g.text('현재 ' + rk + '위 · ' + K.fmt(agg(s.rule, s.sc[cd.who]) || 0) + (s.rule === 'sum' ? ' (합계)' : s.rule === 'avg' ? ' (평균)' : s.rule === 'best2' ? ' (상위 2개 합)' : ' (최고)'), x + 10, y + 76, PAL.lightgrey, { size: 's' });
    }
    if (t > 1.2) g.rich('{A} 계속', x + w - 8, y + h - 13, PAL.grey, { align: 'right' });
  }
  function drawBoard(g, s, final) {
    const st = standings(s);
    const K = KIND[s.kind];
    const n = Math.min(8, st.length);
    const w = 260, h = 30 + n * 17, x = 110, y = Math.max(28, 135 - h / 2);
    g.alpha(0.25); g.rect(0, 0, 480, 270, PAL.black); g.alpha(1);
    g.panel(x, y, w, h, { title: final ? '최종 순위' : (Math.min(s.rnd, s.nAtt) + '/' + s.nAtt + (s.attW || '차 시기') + ' 후 순위'), border: PAL.gold });
    for (let k = 0; k < n; k++) {
      const r = st[k], e = s.ents[r.i];
      const ry = y + 12 + k * 17;
      const hl = s.card && s.card.who === r.i;
      const show = s.pt > 0.15 + k * 0.08;
      if (!show) continue;
      if (hl || e.human) g.rect(x + 4, ry - 2, w - 8, 16, hl ? 'rgba(254,174,52,0.22)' : 'rgba(255,255,255,0.06)');
      if (final && k < 3 && r.v != null) g.medal(x + 14, ry + 6, k + 1, 4);
      else g.text(String(k + 1), x + 14, ry + 1, PAL.lightgrey, { size: 's', align: 'center' });
      g.flag(e.country, x + 26, ry + 1, 18, 12);
      g.text(OG.entLabel(e), x + 50, ry + 1, OG.entColor(e), { size: 's' });
      g.text(e.name, x + 80, ry + 1, PAL.white, { size: 's', maxW: 92 });
      const nn = r.n;
      g.text(nn ? '×' + nn : '', x + 186, ry + 2, PAL.grey, { size: 'xs' });
      g.text(r.v == null ? '—' : K.fmt(r.v), x + w - 10, ry + 1, k === 0 && r.v != null ? PAL.medalGold : PAL.white, { size: 's', align: 'right' });
    }
    if (s.pt > 1) g.rich('{A} 계속', x + w - 6, y + h + 3, PAL.grey, { align: 'right' });
  }

  /* ================================================================ DIVING ==
   * dive10m: arm-swing gauge → ACTION at the top for height.
   * dive3m : walk + hurdle, ACTION at the bottom of the board flex.
   * Air: ▼ tuck / ▲ pike (forward somersaults), ◀▶ half twist, ACTION = line
   * ("rip"): rotation stops and small errors are saved. Enter vertical. */
  const DIVE_P = { dir: 1, d: 'T', u: 'P', w: { T: 1.95, P: 1.62, L: 0.35, O: 0.35, X: 0.03 }, twS: PI, twV: 3.4 * PI, twM: 6 * PI, cw: 0.6, cv: 1.6, tgt: PI };
  const DG = 165;
  const P_SWING = { t: 0.45, aL: -0.9, aR: -0.8, eL: 0.2, eR: 0.25, lL: 0.95, lR: 0.85, kL: 1.55, kR: 1.45 };
  const P_HURDLE = { t: 0.05, aL: 2.8, aR: 2.9, eL: 0.2, eR: 0.2, lL: 1.35, lR: 0.02, kL: 1.6, kR: 0.2 };
  function diveDD(hs, ht, pos, h) {
    if (hs <= 0 && !ht) return 1.2;
    return r1(clamp(0.5 + 0.38 * hs + 0.25 * ht + ({ C: 0, B: 0.2, A: 0.4, D: 0.1 }[pos] || 0) + (h === 3 ? -0.1 : 0), 1.2, 4.1));
  }
  function diveName(hs, ht, pos) {
    if (hs <= 0 && !ht) return '앞으로 뛰어들기 (101A)';
    const code = ht ? '51' + Math.min(hs, 9) + Math.min(ht, 9) + pos : '1' + (hs >= 10 ? '' : '0') + hs + pos;
    return '앞으로 ' + half(hs) + '회전' + (ht ? ' ' + half(ht) + '트위스트' : '') + ' ' + POSKO[pos] + ' (' + code + ')';
  }
  function diveLook(e) {
    const L = lookOf(e);
    return { shirt: L.shirt, pants: OG.shade(L.shirt, -0.25), skin: L.skin, hair: L.hair, ua: L.skin, thigh: L.skin, shoe: L.skin };
  }
  function diveLow(a) {
    const c = C(a.rot), k = 1 - 0.5 * Math.max(a.tk, a.pk * 0.7);
    return (c >= 0 ? 24 : 32) * abs(c) * k + 7 * abs(S(a.rot)) + 3;
  }
  KIND.dive = {
    init(s, e, R) {
      const ten = s.h === 10;
      const a = { e: e.idx, st: 'walk', t: 0, x: ten ? -100 : -146, y: ten ? -260 : -90, vx: 0, vy: 0, pw: 0, m: 0, bd: 0, bv: 0, hy: 0, pr: -1, early: 0,
        fin: false, finT: 2.3, err: 0, hs: 0, ht: 0, head: 1, tuckIn: 0, lineIn: 0, twLeft: 0, near: 0, rip: 0, spl: 0, eT: 0, ex: 0, pos: 'C', ex2: 0 };
      flipInit(a);
      return a;
    },
    launch(s, a, q) {
      const ten = s.h === 10;
      a.pw = q; a.st = 'air'; a.at = 0;
      a.y = (ten ? -260 : -90 + a.bd) - 26;
      a.vy = ten ? -(55 + 80 * q) : -(60 + 78 * q);
      a.vx = ten ? 20 + 30 * q : 24 + 18 * q;
      a.rv = 0.25 * TAU; a.started = 1;
      OG.sfx(s, 'jump');
      if (q > 0.85) pop(s, '최고 점프!', PAL.green, { z: 'l', y: 40 });
      else if (q < 0.35) pop(s, '약한 도약', PAL.orange, { z: 'l', y: 40 });
    },
    upd(s, a, inp, dt, R) {
      const ten = s.h === 10;
      a.t += dt;
      if (a.st === 'walk') {
        a.x += (ten ? 58 : 64) * dt;
        const goal = ten ? -14 : -60;
        if (Math.floor(a.t * 3.4) !== Math.floor((a.t - dt) * 3.4)) OG.sfx(s, 'step');
        if (a.x >= goal) { a.x = goal; a.t = 0; a.st = ten ? 'set' : 'hurdle'; if (!ten) OG.sfx(s, 'jump'); }
      } else if (a.st === 'set') {
        a.m = (1 - C(a.t * TAU / 1.2)) / 2;
        if (inp.ap && a.t > 0.2) this.launch(s, a, Math.pow(a.m, 1.4));
        else if (a.t > 4.8) this.launch(s, a, 0.18);
      } else if (a.st === 'hurdle') {
        const k = Math.min(1, a.t / 0.55);
        a.x = lerp(-60, -8, k); a.hy = -S(k * PI) * 34;
        if (inp.ap && k > 0.3) a.early = 1;
        if (k >= 1) { a.st = 'press'; a.t = 0; a.hy = 0; OG.sfx(s, 'bounce'); }
      } else if (a.st === 'press') {
        a.bd = S(Math.min(1, a.t / 0.5) * PI) * 24;
        if (inp.ap && a.pr < 0) a.pr = a.t;
        if (a.t >= 0.5) {
          const q = a.pr < 0 ? 0.1 : clamp(1 - abs(a.pr - 0.25) / 0.17, 0, 1) * (a.early ? 0.6 : 1);
          a.bd = 0; a.bv = -260;
          this.launch(s, a, Math.max(0.08, q));
          if (a.pr >= 0 && q > 0.85) pop(s, '완벽한 반동!', PAL.cyan, { z: 'l', y: 22 });
        }
      } else if (a.st === 'air') {
        flipUpd(a, inp, dt, DIVE_P);
        a.vy += DG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        trail(a, a.x, a.y);
        const top = ten ? -260 : -90;
        if (a.vy > 0 && a.y < top + 46 && a.y > top - 10 && a.x < 18) a.near = 1;
        if (a.y + diveLow(a) >= 0) this.entry(s, a, R);
      } else if (a.st === 'water') {
        a.eT += dt;
        a.vy *= Math.max(0, 1 - 3.2 * dt); a.y += a.vy * dt;
        if (R.chance(0.35)) fx(s, R, a.x + R.range(-8, 8), a.y + R.range(-14, 6), 1, { c: [0, 2, 10], spd: 12, ang: -PI / 2, spr: 0.6, gr: -60, life: 1.2, sz: 2 });
      }
      if (!ten && a.st !== 'press') { a.bv += (-a.bd * 420 - a.bv * 5) * dt; a.bd += a.bv * dt; }
    },
    entry(s, a, R) {
      const eh = abs(nAng(a.rot - PI)), ef = abs(nAng(a.rot));
      a.head = eh <= ef ? 1 : 0;
      a.err = Math.min(eh, ef);
      a.hs = Math.round(abs(a.rot) / PI);
      a.ht = Math.round(a.twT / PI);
      a.twLeft = abs(a.twT - a.tw) / PI;
      a.tuckIn = a.tk > 0.5 || a.pk > 0.55 ? 1 : 0;
      a.lineIn = a.lx > 0.5 ? 1 : 0;
      a.pos = a.ht && a.tT < 0.12 && a.pT < 0.12 ? 'A' : posLetter(a);
      a.mix = a.tT > 0.25 && a.pT > 0.25 ? 1 : 0;
      a.rip = a.err < 0.1 && a.lineIn && !a.tuckIn && a.twLeft < 0.1 ? 1 : 0;
      a.st = 'water'; a.fin = true; a.eT = 0; a.ex = a.x;
      a.vy = Math.max(a.vy, 120);
      const bad = clamp(a.err * 1.5 + (a.tuckIn ? 0.7 : 0) + (a.lineIn ? 0 : 0.25) + a.twLeft * 0.4, 0, 1);
      a.spl = a.rip ? 0.08 : 0.2 + bad * 0.8;
      const n = Math.round(4 + a.spl * 46);
      fx(s, R, a.x, -1, n, { c: [0, 2, 10, 2], spd: 50 + a.spl * 190, ang: -PI / 2, spr: 0.9 + a.spl * 1.4, gr: 300, life: 0.9 + a.spl * 0.6, w: 10 + a.spl * 14, sz: 2 });
      fx(s, R, a.x, 2, 10, { c: [0, 10], spd: 30, ang: -PI / 2, spr: 2.6, gr: 60, life: 0.6, w: 20 });
      OG.sfx(s, 'splash');
      if (a.rip) { pop(s, '립 엔트리!', PAL.cyan, { z: 'xl' }); OG.sfx(s, 'perfect'); }
      else if (a.err > 0.75 || a.tuckIn) { pop(s, a.tuckIn ? '펴지 못함!' : '배치기!', PAL.red, { z: 'xl' }); OG.sfx(s, 'crash'); }
      else if (a.err > 0.3) pop(s, '첨벙!', PAL.orange, { z: 'l' });
      else pop(s, '굿 엔트리', PAL.green, { z: 'l' });
    },
    judge(s, a, R) {
      const hs = a.hs, ht = Math.round(a.twT / PI);
      const dd = diveDD(hs, ht, a.pos, s.h);
      let b = 10;
      b -= (1 - a.pw) * 1.3;
      b -= Math.min(6.5, a.err * 7.5);
      if (a.tuckIn) b -= 3.2; else if (!a.lineIn) b -= 0.6;
      b -= a.twLeft * 2.4;
      if (a.near) b -= 1.2;
      if (a.mix) b -= 0.5;
      if (a.rip) b += 0.35;
      b = clamp(b, 0, 9.9);
      const js = judges(R, b, 7, 0.32, 0.5, 10), dr = dropMarks(js, 2);
      const sc = kept(js, dr) * dd;
      const note = a.rip ? '립 엔트리' : a.tuckIn ? '실패' : a.err > 0.6 ? '배치기' : '';
      return { sc: sc, nm: diveName(hs, ht, a.pos), js: js, dr: dr, jf: 1, dd: dd, tot: sc.toFixed(2), note: note, bad: !a.rip };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.09);
      const ten = s.h === 10;
      let hs = ten ? (q > 0.86 ? R.pick([7, 9, 7]) : q > 0.62 ? R.pick([5, 7]) : q > 0.4 ? R.pick([3, 5]) : 3) : (q > 0.72 ? R.pick([5, 7]) : q > 0.45 ? R.pick([3, 5]) : 3);
      let ht = 0, pos = hs >= 9 ? 'C' : R.pick(['B', 'C', 'B']);
      if (R.chance(0.25) && hs >= 5) { hs = 5; ht = R.pick([2, 3, 4]); pos = R.pick(['B', 'C']); }
      const dd = diveDD(hs, ht, pos, s.h);
      let avg = clamp(4.7 + q * 4.55 + R.gauss() * 0.5, 1, 9.8);
      if (R.chance(0.05 + (1 - q) * 0.08)) avg = clamp(avg - R.range(2, 4.5), 0.5, 9);
      return { sc: 3 * avg * dd, nm: diveName(hs, ht, pos) };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'walk') return '걸어 나가는 중…';
      if (a.st === 'set') return '{A} 팔 스윙 게이지가 꽉 찰 때 도약!';
      if (a.st === 'hurdle' || a.st === 'press') return '{A} 보드가 가장 깊이 휠 때!';
      if (a.st === 'air') return '{D} 감싸기 {U} 굽히기 {L}{R} 트위스트 {A} 입수 자세(수직)';
      return '';
    },
    cam(s, a) {
      if (s.h === 10) return [-232 + clamp(a.x, -40, 80) * 0.35, clamp(a.y - 142, -440, -200)];
      return [-236 + clamp(a.x, -150, 80) * 0.25, clamp(a.y - 150, -232, -212)];
    },
    draw(g, s, a) {
      const ten = s.h === 10;
      const cx = s.cam[0], cy = s.cam[1];
      const e = curEnt(s);
      drawHall(g, s, cx, cy, e);
      if (ten) drawTower(g, cx, cy); else drawBoards(g, cx, cy, a ? a.bd : 0, a);
      drawPool(g, s, cx, cy, false);
      if (!a) return;
      const look = diveLook(e);
      const X = a.x - cx, Y = a.y - cy;
      if (a.st === 'walk') {
        const fy = (ten ? -260 : -90 + boardY(a.x, a.bd)) - cy;
        fig(g, X, fy, POSE.walk(a.t * 1.7 % 1), look, { anchor: 'feet' });
      } else if (a.st === 'set') {
        const p = POSE.mix(POSE.mix(POSE.stand(), P_LINE_UP, 0.25), P_SWING, a.m);
        fig(g, X, -260 - cy, p, look, { anchor: 'feet' });
        // swing gauge
        const gx = X - 34, gy = -260 - cy - 64;
        g.rect(gx - 1, gy - 1, 9, 52, PAL.black); g.rect(gx, gy, 7, 50, PAL.slate);
        g.rect(gx, gy, 7, 8, '#3e8948');
        const h = Math.round(a.m * 50);
        g.rect(gx + 1, gy + 50 - h, 5, h, a.m > 0.86 ? PAL.green : a.m > 0.6 ? PAL.yellow : PAL.orange);
        g.text('파워', gx + 3, gy - 10, PAL.white, { size: 'xs', align: 'center', outline: PAL.black });
      } else if (a.st === 'hurdle' || a.st === 'press') {
        const by = -90 + boardY(a.x, a.bd);
        const p = a.st === 'hurdle' ? POSE.mix(POSE.walk(0.3), P_HURDLE, S(Math.min(1, a.t / 0.55) * PI)) : POSE.mix(POSE.stand(), P_SWING, S(Math.min(1, a.t / 0.5) * PI) * 0.9);
        fig(g, X, by + a.hy - cy, p, look, { anchor: 'feet' });
        if (a.st === 'press' || a.t > 0.25) {
          const gx = X + 22, gy = by - cy - 70, k = a.st === 'press' ? a.bd / 24 : 0;
          g.rect(gx - 1, gy - 1, 9, 52, PAL.black); g.rect(gx, gy, 7, 50, PAL.slate);
          g.rect(gx, gy + 40, 7, 10, '#3e8948');
          const hh = Math.round(k * 50);
          g.rect(gx + 1, gy, 5, hh, k > 0.85 ? PAL.green : PAL.cyan);
          g.text('반동', gx + 3, gy - 10, PAL.white, { size: 'xs', align: 'center', outline: PAL.black });
        }
      } else {
        if (a.st === 'air') { drawTrail(g, a, s.cam, look, P_OPEN); spinArcs(g, X, Y, a.rv, 30, g.t); }
        const line = a.head || C(a.rot) < 0 ? P_LINE_UP : P_LINE_DN;
        const lineK = Math.max(a.lx, a.st === 'water' ? 1 : 0);
        const p = airPose({ tk: a.tk, pk: a.pk, lx: lineK, tw: a.tw, twT: a.twT }, P_OPEN, a.st === 'water' ? (a.head ? P_LINE_UP : P_LINE_DN) : line);
        fig(g, X, Y, p, look, { rot: a.rot, sq: C(a.tw), anchor: 'com' });
        if (a.st === 'air') diveHud(g, s, a);
      }
      drawPool(g, s, cx, cy, true);
      if (a.st === 'water') splashCol(g, a, cx, cy);
      fxDraw(g, s, cx, cy);
    }
  };
  function boardY(x, bd) { // springboard top (relative to -90) at world x
    if (x < -70) return 0;
    const u = clamp((x + 70) / 70, 0, 1);
    return bd * u * u;
  }
  function diveHud(g, s, a) {
    // rotation dial
    const x = 436, y = 196;
    g.circle(x, y, 21, 'rgba(24,20,37,0.75)');
    g.circleO(x, y, 20, PAL.grey);
    g.rect(x - 3, y - 21, 7, 4, PAL.green); g.rect(x - 3, y + 18, 7, 4, PAL.green);
    const hx = S(a.rot), hy = -C(a.rot);
    g.line(x, y, x + hx * 16, y + hy * 16, PAL.yellow, 2);
    g.line(x, y, x - hx * 10, y - hy * 10, PAL.lightgrey, 1);
    g.circle(x + hx * 16, y + hy * 16, 2.5, PAL.skin1);
    g.text(half(Math.floor(abs(a.rot) / PI + 0.0001)) + '회전', x, y + 26, PAL.white, { size: 's', align: 'center', outline: PAL.black });
    if (a.twT > 0) g.text(half(Math.round(a.tw / PI)) + '/' + half(Math.round(a.twT / PI)) + ' 트위스트', x, y + 38, PAL.cyan, { size: 'xs', align: 'center', outline: PAL.black });
    // distance to water
    const ten = s.h === 10, top = ten ? 286 : 116;
    const k = clamp(-(a.y + diveLow(a)) / top, 0, 1);
    g.rect(4, 40, 6, 120, PAL.black); g.rect(5, 41, 4, 118, PAL.darkblue);
    g.rect(5, 41 + Math.round((1 - k) * 114), 4, 4, k < 0.22 ? PAL.red : PAL.white);
    g.text('수면', 8, 162, PAL.cyan, { size: 'xs', outline: PAL.black });
  }
  function splashCol(g, a, cx, cy) {
    const t = a.eT, k = a.spl;
    if (t > 1.6) return;
    const x = Math.round(a.ex - cx), y = -cy;
    const rise = Math.min(1, t / 0.32), fall = Math.max(0, (t - 0.32) / 1.1);
    const hgt = (8 + k * 80) * rise * (1 - fall);
    const jets = 3 + Math.round(k * 5), sp = 2 + k * 4;
    g.alpha(Math.max(0.2, 0.92 - fall * 0.6));
    for (let j = 0; j < jets; j++) {
      const off = (j - (jets - 1) / 2) * sp;
      const hh = hgt * (0.5 + 0.5 * H(j, 7, 3)) * (1 - abs(off) / (jets * sp) * 0.8);
      const w = 1.5 + k * 3;
      g.poly([x + off - w, y, x + off * 1.4 - 1, y - hh, x + off * 1.4 + 1, y - hh, x + off + w, y], j % 2 ? '#e8f8ff' : '#bfe8ff');
      g.circle(x + off * 1.4, y - hh, 1 + k * 1.5, '#ffffff');
    }
    g.alpha(1);
    const rr = 5 + t * 36 * (0.35 + k);
    g.alpha(Math.max(0, 0.85 - t * 0.6)); ringE(g, x, y + 1, rr, 2, 0, '#e8f8ff', 1); g.alpha(1);
  }
  /* ---------------------------------------------------------- aquatics hall */
  function drawHall(g, s, cx, cy, e) {
    const py = Math.round(-cy * 0.45), px = Math.round(-cx * 0.3);
    g.grad(0, 0, 480, 270, '#0d1128', '#1b2650', 10);
    // roof truss + lights
    const ry = py - 236;
    if (ry > -40) {
      g.rect(0, ry, 480, 3, '#2e3a63'); g.rect(0, ry + 18, 480, 3, '#2e3a63');
      for (let i = -1; i < 26; i++) { const x = i * 22 + M.wrap(px, 22); g.line(x, ry + 2, x + 11, ry + 19, '#2e3a63', 1); g.line(x + 11, ry + 19, x + 22, ry + 2, '#2e3a63', 1); }
      for (let i = 0; i < 6; i++) {
        const lx = 30 + i * 84 + M.wrap(px, 84);
        g.alpha(0.08); g.poly([lx - 6, ry + 24, lx + 6, ry + 24, lx + 46, ry + 200, lx - 46, ry + 200], '#fff6d8'); g.alpha(1);
        g.rect(lx - 7, ry + 21, 14, 4, '#fff6d8'); g.rect(lx - 9, ry + 20, 18, 1, '#5a6988');
      }
    }
    // big video screen
    const sy = py - 160, sx = 318 + Math.round(px * 0.5);
    if (sy > -80 && sy < 270) {
      g.rect(sx - 3, sy - 3, 126, 66, '#05060c'); g.rect(sx, sy, 120, 60, '#121836');
      g.rect(sx, sy, 120, 11, PAL.darkblue);
      g.text(s.h === 10 ? 'DIVING · 10M PLATFORM' : 'DIVING · 3M SPRINGBOARD', sx + 60, sy + 2, PAL.white, { size: 'xs', align: 'center', maxW: 114 });
      if (e) {
        g.flag(e.country, sx + 6, sy + 16, 27, 18);
        g.text(OG.entLabel(e), sx + 40, sy + 15, OG.entColor(e), { size: 'b' });
        g.text(e.name, sx + 40, sy + 29, PAL.lightgrey, { size: 'xs', maxW: 76 });
        const st = standings(s), rk = st.findIndex(r => r.i === e.idx);
        g.text('순위 ' + (rk + 1) + ' · 합계 ' + KIND.dive.fmt(agg(s.rule, s.sc[e.idx]) || 0), sx + 6, sy + 46, PAL.gold, { size: 'xs' });
      }
      g.rect(sx + 58, sy + 63, 4, 40, '#262b44');
    }
    // banner
    const by = py - 80;
    if (by > -20 && by < 270) {
      g.rect(0, by, 480, 14, '#0e3a6a'); g.rect(0, by + 13, 480, 1, '#2a8fd6');
      for (let i = -1; i < 5; i++) {
        const bx = i * 130 + M.wrap(px, 130);
        g.text((i + Math.floor(px / 130)) % 2 ? 'AICHI-NAGOYA 2026' : 'DOT GAMES 2026', bx + 65, by + 3, (i + Math.floor(px / 130)) % 2 ? PAL.gold : PAL.white, { size: 'xs', align: 'center' });
      }
    }
    // stands
    const st0 = py - 66;
    if (st0 < 270) {
      g.crowd(0, st0, 480, 124, g.t, { ox: -px, seed: 3, excite: s.ph === 'card' ? 0.55 : 0.08, bg: '#222a52', step: 5 });
      g.alpha(0.32); g.rect(0, st0, 480, 124, '#0d1128'); g.alpha(1);
      for (let r = 0; r < 124; r += 20) { g.rect(0, st0 + r + 18, 480, 2, '#3a4466'); }
      for (let x = M.wrap(px, 120) - 120; x < 480; x += 120) { g.rect(x, st0, 6, 124, '#2b3358'); for (let r = 0; r < 124; r += 5) g.rect(x + 1, st0 + r, 4, 1, '#3a4466'); }
      const ly = st0 + 124;
      g.adBoards(0, ly, 480, 10, g.t * 0.5, ['DOT GAMES 2026', 'AQUATICS', 'AICHI-NAGOYA', 'SPLASH!']);
      // tiled back wall with bunting
      g.rect(0, ly + 10, 480, 300, '#b8d4ea');
      for (let y = ly + 14; y < 290; y += 8) g.rect(0, y, 480, 1, '#a6c3dc');
      for (let x = M.wrap(px, 8); x < 480; x += 8) g.rect(x, ly + 10, 1, 300, '#a6c3dc');
      g.rect(0, ly + 26, 480, 3, '#2a8fd6');
      const fl = s.ents;
      const n = fl.length;
      for (let i = 0; i < 14; i++) {
        const fx0 = M.wrap(i * 40 + px, 560) - 40, fy = ly + 34 + Math.round(S(i * 1.7) * 1);
        g.line(fx0 - 20, fy - 1, fx0 + 20, fy - 1, '#5a6988', 1);
        if (n) g.flag(fl[i % n].country, fx0 - 6, fy, 12, 8);
      }
    }
  }
  function drawTower(g, cx, cy) {
    const X = x => x - cx, Y = y => y - cy;
    const col = '#9aa7c0', dk = '#6a7896', lt = '#c6d0e2';
    // main column + stairs
    g.rect(X(-176), Y(-268), 64, 268, dk);
    g.rect(X(-170), Y(-268), 52, 268, col);
    for (let y = -250; y < 0; y += 16) { g.line(X(-168), Y(y), X(-122), Y(y + 14), '#7c89a6', 2); }
    g.rect(X(-118), Y(-268), 6, 268, lt);
    const plat = (x0, x1, y, lbl) => {
      g.rect(X(x0), Y(y), x1 - x0, 9, col);
      g.rect(X(x0), Y(y) + 7, x1 - x0, 3, dk);
      g.rect(X(x0), Y(y) - 2, x1 - x0, 2, '#2f7f78');
      g.rect(X(x1) - 2, Y(y), 2, 10, lt);
      if (lbl) g.text(lbl, X(x1) - 14, Y(y) + 1, PAL.darkblue, { size: 'xs', align: 'center' });
      // rail
      g.rect(X(x0) + 2, Y(y) - 14, 2, 12, '#c0cbdc'); g.rect(X(x0) + 2, Y(y) - 14, Math.min(40, x1 - x0 - 6), 2, '#c0cbdc');
      // support
      g.rect(X(x0) + 20, Y(y) + 10, 10, -y - 10 > 0 ? Math.min(30, -y) : 0, dk);
    };
    plat(-170, -82, -26, '1');
    plat(-170, -60, -78, '3');
    plat(-170, -46, -130, '5');
    plat(-170, -28, -195, '7.5');
    plat(-176, 0, -260, '10');
    g.rect(X(-176), Y(-275), 4, 15, '#c0cbdc');
  }
  function drawBoards(g, cx, cy, bd, a) {
    const X = x => x - cx, Y = y => y - cy;
    // 1m board (background)
    g.rect(X(-230), Y(-26), 110, 4, '#c0cbdc'); g.rect(X(-230), Y(-22), 110, 2, '#5a6988');
    g.rect(X(-226), Y(-22), 30, 22, '#6a7896');
    // 3m stand
    g.rect(X(-196), Y(-86), 70, 86, '#6a7896'); g.rect(X(-190), Y(-86), 58, 86, '#9aa7c0');
    for (let y = -80; y < 0; y += 14) g.line(X(-188), Y(y), X(-136), Y(y + 12), '#7c89a6', 2);
    g.rect(X(-200), Y(-120), 3, 34, '#c0cbdc'); g.rect(X(-200), Y(-120), 60, 2, '#c0cbdc');
    // fulcrum
    g.rect(X(-76), Y(-86), 10, 6, PAL.gold); g.rect(X(-74), Y(-80), 6, 80, '#7c89a6');
    // flexing board
    let px0 = X(-150), py0 = Y(-90);
    for (let x = -150; x <= 0; x += 6) {
      const yy = -90 + boardY(x, bd);
      const sx = X(x), sy = Y(yy);
      g.line(px0, py0, sx, sy, '#e8eef8', 4);
      g.line(px0, py0 + 2, sx, sy + 2, '#2f7f78', 1);
      px0 = sx; py0 = sy;
    }
    g.text('3M', X(-120), Y(-86), PAL.darkblue, { size: 'xs' });
  }
  function drawPool(g, s, cx, cy, over) {
    const wy = Math.round(-cy), x0 = Math.round(-36 - cx);
    if (wy > 280) return;
    const xw = Math.max(0, x0);
    if (!over) {
      if (x0 > 0) {
        g.rect(0, wy, x0, 300, '#8b9bb4'); g.rect(0, wy, x0, 4, '#e8eef8');
        for (let x = M.wrap(-cx, 12); x < x0; x += 12) g.rect(x, wy + 4, 1, 300, '#7a89a4');
        for (let y = wy + 12; y < 280; y += 12) g.rect(0, y, x0, 1, '#7a89a4');
      }
      g.grad(xw, wy, 480 - xw, 170, '#2a8fd6', '#0f3d70', 9);
      g.rect(xw, wy + 170, 480 - xw, 120, '#0d3462');
      // floor lane stripes + underwater lights
      for (let x = M.wrap(-cx, 70) - 70; x < 480; x += 70) { if (x + 50 < xw) continue; g.rect(Math.max(xw, x), wy + 150, 46, 4, '#0a2648'); g.rect(Math.max(xw, x + 44), wy + 140, 4, 14, '#0a2648'); }
      for (let x = M.wrap(-cx + 30, 110) - 110; x < 480; x += 110) {
        if (x < xw + 4) continue;
        g.alpha(0.12); g.circle(x, wy + 46, 12, '#fff6d8'); g.alpha(1);
        g.circle(x, wy + 46, 3, '#dff3ff');
      }
      for (let i = 0; i < 30; i++) {
        const x = M.wrap(i * 41 - cx + S(g.t * 0.8 + i) * 6, 500) - 10, y = wy + 10 + (i * 23) % 130;
        if (x < xw) continue;
        g.rect(x, y, 6 + (i % 3) * 3, 1, 'rgba(159,216,255,0.22)');
      }
      if (x0 > -4) { g.rect(x0 - 3, wy, 3, 300, '#d5e2f2'); g.rect(x0, wy, 1, 300, '#9fb2d0'); }
      return;
    }
    g.alpha(0.42); g.rect(xw, wy + 1, 480 - xw, 290, '#1f6fb3'); g.alpha(1);
    g.rect(xw, wy - 1, 480 - xw, 2, '#9fd8ff');
    for (let i = 0; i < 44; i++) {
      const x = M.wrap(i * 29 + Math.floor(g.t * 12 + i * 3) % 7 - cx * 0.0, 520) - 20;
      if (x < xw) continue;
      g.rect(x, wy - 1 + ((i + Math.floor(g.t * 6)) % 3 === 0 ? -1 : 0), 3, 1, '#e8f8ff');
    }
    // surface agitation sprinklers (help divers see the surface)
    for (let i = 0; i < 18; i++) {
      const x = Math.round(30 + H(i, 3, 1) * 120 - cx), up = (Math.floor(g.t * 8) + i) % 4;
      if (x < xw) continue;
      g.px(x, wy - 1 - (up === 0 ? 1 : 0), '#ffffff');
    }
  }

  /* ========================================================= GYM ARENA === */
  function drawArena(g, s, cx, cy, mood) {
    const px = Math.round(-cx * 0.35), py = Math.round(-cy * 0.5);
    const warm = mood === 'warm';
    g.grad(0, 0, 480, 270, warm ? '#170e2a' : '#0b0e24', warm ? '#2a1a40' : '#18204a', 10);
    // roof rig + moving spotlights
    const ry = py - 170;
    if (ry > -30) {
      g.rect(0, ry, 480, 4, '#262b44');
      for (let i = -1; i < 25; i++) { const x = i * 24 + M.wrap(px, 24); g.line(x, ry + 3, x + 12, ry + 14, '#262b44', 1); g.line(x + 12, ry + 14, x + 24, ry + 3, '#262b44', 1); }
      g.rect(0, ry + 14, 480, 2, '#262b44');
    }
    // giant screen
    const sy = py - 132;
    if (sy > -60 && sy < 270) {
      const sx = (warm ? 300 : 160) + Math.round(px * (warm ? 0.08 : 0.6));
      g.rect(sx - 3, sy - 3, 166, 52, '#05060c'); g.rect(sx, sy, 160, 46, '#121733');
      const e = curEnt(s);
      g.rect(sx, sy, 160, 11, warm ? '#6b2a5a' : PAL.darkblue);
      g.text(warm ? 'ARTISTIC GYMNASTICS · VAULT' : 'TRAMPOLINE GYMNASTICS', sx + 80, sy + 2, PAL.white, { size: 'xs', align: 'center' });
      if (e) { g.flag(e.country, sx + 8, sy + 16, 30, 20); g.text(OG.entLabel(e) + ' ' + e.name, sx + 44, sy + 17, PAL.white, { size: 's', maxW: 110 }); }
      g.text('AICHI-NAGOYA 2026', sx + 44, sy + 32, PAL.cyan, { size: 'xs' });
    }
    // stands
    const st = py - 78;
    if (st < 270) {
      g.crowd(0, st, 480, 100, g.t, { ox: -px, seed: warm ? 5 : 9, excite: s.ph === 'card' ? 0.6 : 0.1, bg: warm ? '#2a1f45' : '#1e2850', step: 5 });
      g.alpha(0.38); g.rect(0, st, 480, 100, warm ? '#170e2a' : '#0b0e24'); g.alpha(1);
      for (let r = 0; r < 100; r += 20) g.rect(0, st + r + 18, 480, 2, warm ? '#3e2f5c' : '#2e3a66');
      for (let x = M.wrap(px, 140) - 140; x < 480; x += 140) { g.rect(x, st, 6, 100, warm ? '#2e2148' : '#1a2246'); for (let r = 0; r < 100; r += 5) g.rect(x + 1, st + r, 4, 1, warm ? '#3e2f5c' : '#2e3a66'); }
      g.adBoards(0, st + 100, 480, 12, g.t * 0.6, ['DOT GAMES 2026', 'AICHI-NAGOYA', 'PIXEL SPORTS', '8-BIT POWER']);
      g.rect(0, st + 112, 480, 300, warm ? '#24183a' : '#141b3c');
      for (let x = M.wrap(px, 30); x < 480; x += 30) g.rect(x, st + 112, 1, 300, warm ? '#2e2148' : '#1a2246');
    }
    // spot cones (in front of stands)
    for (let i = 0; i < 5; i++) {
      const lx = M.wrap(60 + i * 100 + px, 500) - 10, ly = ry + 16;
      const sw = S(g.t * 0.7 + i * 1.7) * 60;
      g.alpha(0.06);
      g.poly([lx - 3, ly, lx + 3, ly, lx + sw + 50, ly + 300, lx + sw - 50, ly + 300], warm ? '#ffd7a0' : '#bfe6ff');
      g.alpha(1);
      g.rect(lx - 4, ly - 2, 8, 5, '#3a4466'); g.rect(lx - 2, ly + 2, 4, 2, '#fff6d8');
    }
  }
  function floor(g, cy, c1, c2, cx) {
    const fy = Math.round(-cy);
    if (fy > 270) return;
    g.rect(0, fy, 480, 16, c1);
    g.rect(0, fy, 480, 2, c2);
    for (let y = fy + 5, k = 0; y < fy + 16; y += 4 + k, k++) g.rect(0, y, 480, 1, 'rgba(0,0,0,0.12)');
    // podium skirt
    g.rect(0, fy + 16, 480, 20, '#181425'); g.rect(0, fy + 16, 480, 1, OG.shade(c1, -0.4));
    const ox = Math.round(cx || 0);
    for (let i = -1; i < 6; i++) {
      const x = i * 110 - M.wrap(ox, 110);
      g.text(i % 2 ? 'AICHI-NAGOYA 2026' : 'DOT GAMES', x + 55, fy + 22, i % 2 ? '#feae34' : '#2ce8f5', { size: 'xs', align: 'center' });
    }
    g.rect(0, fy + 36, 480, 300, '#0b0a14');
  }
  function stickFig(a) { return a.land === 'stick'; }

  /* ============================================================ TRAMPOLINE */
  const TR_P = { dir: -1, d: 'T', u: 'P', w: { T: 2.0, P: 1.65, L: 0.55, O: 0.55, X: 0.03 }, twS: PI, twV: 3.8 * PI, twM: 8 * PI, cw: 0.5, cv: 1.1, tgt: TAU };
  const TG = 400, TBU = 3, TCT = 0.3, TCOM = 26;
  function trD(som, ht, pos) {
    if (!som && !ht) return 0;
    return r1(som * 0.5 + (som >= 2 ? 0.1 * som : 0) + ht * 0.1 + (pos !== 'C' && som >= 1 ? 0.1 * som : 0));
  }
  function trName(som, ht, pos) {
    if (!som && !ht) return '스트레이트 점프';
    let nm = som ? ['', '', '더블 ', '트리플 ', '쿼드 '][Math.min(som, 4)] + '백' : '';
    if (ht) nm += (nm ? ' ' : '') + half(ht) + '트위스트';
    if (som) nm += ' ' + ({ A: '(펴서)', B: '(파이크)', C: '(턱)' })[pos];
    return nm;
  }
  function gymLook(e) { const L = lookOf(e); return { suit: L.shirt, skin: L.skin, hair: L.hair, shoe: L.skin, ua: L.shirt, stripe: L.pants }; }
  KIND.tramp = {
    att1: 2,
    init(s, e, R) {
      const a = { e: e.idx, st: 'cont', t: 0, x: 0, y: -TCOM, vx: 0, vy: 0, E: 0.32, ct: 0, pr: -1, n: 0, sk: [], hd: 0, tof: 0, fin: false, finT: 2.2, crash: 0, stick: 0, dep: 0, lastQ: -1, zone: 0, stopT: 0 };
      flipInit(a);
      return a;
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'cont') {
        a.ct += dt;
        a.dep = S(clamp(a.ct / TCT, 0, 1) * PI) * (12 + 16 * a.E);
        a.y = -TCOM + a.dep;
        if (inp.ap && a.pr < 0) a.pr = a.ct;
        if (inp.l) a.vx -= 120 * dt; if (inp.r) a.vx += 120 * dt;
        a.vx *= 1 - 1.5 * dt;
        a.x += a.vx * dt * 0.4;
        if (a.ct >= TCT) {
          const q = a.pr < 0 ? -1 : clamp(1 - abs(a.pr - TCT / 2) / 0.12, 0, 1);
          a.lastQ = q;
          a.E = clamp(a.E * 0.98 + (q < 0 ? -0.1 : 0.24 * q - 0.05), 0.14, 1);
          const T = 0.72 + 1.12 * a.E;
          a.vy = -TG * T / 2; a.st = 'air'; a.n++; a.dep = 0;
          const keepX = a.x, keepVx = a.vx;
          flipInit(a); a.x = keepX; a.vx = keepVx;
          OG.sfx(s, 'bounce');
          if (q > 0.85) pop(s, '굿 타이밍', PAL.green, { z: 's', x: a.x + 30, y: -40, w: 1, d: 0.8 });
        }
      } else if (a.st === 'air') {
        const rt = a.n > TBU;
        if (rt) flipUpd(a, inp, dt, TR_P); else { a.at += dt; if (inp.ap) a.stT = a.at; }
        a.vy += TG * dt; a.y += a.vy * dt; a.x += a.vx * dt;
        trail(a, a.x, a.y);
        if (a.vy > 0 && a.y >= -TCOM) this.land(s, a, R, rt);
      } else if (a.st === 'stop' || a.st === 'fall') {
        a.stopT += dt;
        a.dep = Math.max(0, S(a.stopT * 9) * 10 * Math.exp(-a.stopT * 4));
        a.y = -TCOM + a.dep;
      }
    },
    land(s, a, R, rt) {
      const err0 = abs(nAng(a.rot)), twLeft = abs(a.twT - a.tw) / PI;
      const err = err0 + (a.tk > 0.6 ? 0.45 : 0) + twLeft * 0.7;
      const ax = abs(a.x);
      a.zone = ax < 14 ? 0 : ax < 28 ? 1 : ax < 42 ? 2 : 3;
      fx(s, R, a.x, 2, 6, { c: [9, 14], spd: 30, ang: -PI / 2, spr: 2.4, gr: 200, life: 0.4, w: 16 });
      if (rt) {
        const som = Math.round(abs(a.rot) / TAU), ht = Math.round(a.twT / PI), pos = a.started ? posLetter(a) : 'A';
        let ded = clamp(0.08 + err0 * 0.55 + twLeft * 0.4 + (a.tk > 0.6 ? 0.3 : 0), 0.05, 0.5);
        if (!som && !ht) ded = 0.5;
        a.tof += a.at;
        a.hd += a.zone * 0.1;
        if (err > 0.8 || ax > 58) {
          a.crash = 1; a.st = 'fall'; a.fin = true; a.stopT = 0;
          pop(s, ax > 58 ? '이탈!' : '착지 실패!', PAL.red, { z: 'xl' }); OG.sfx(s, 'crash');
          return;
        }
        a.sk.push([som, ht, pos, r2(ded), r2(a.at)]);
        const nm = trName(som, ht, pos);
        if (som || ht) pop(s, nm, som >= 3 ? PAL.gold : PAL.white, { z: som >= 3 ? 'l' : 'b', y: 30, d: 1.1 });
        if (err > 0.35) { pop(s, '흔들림', PAL.orange, { z: 's', x: a.x, y: -60, w: 1, d: 0.8 }); a.E = Math.max(0.14, a.E - 0.12); }
        if (a.sk.length >= 10) {
          a.stick = a.at - a.stT < 0.45 && err0 < 0.25 ? 1 : 0;
          a.st = 'stop'; a.fin = true; a.stopT = 0;
          pop(s, a.stick ? 'STICK!' : '루틴 완료', a.stick ? PAL.green : PAL.white, { z: 'xl', y: 70 });
          OG.sfx(s, a.stick ? 'perfect' : 'good');
          return;
        }
      }
      a.vx += R.gauss() * 7 + (err0 > 0.12 ? sgn(nAng(a.rot)) * err0 * 50 : 0);
      a.st = 'cont'; a.ct = 0; a.pr = -1; a.rot = 0; a.tw = 0; a.twT = 0; a.tk = 0; a.pk = 0; a.lx = 0; a.rv = 0;
      a.y = -TCOM;
    },
    judge(s, a, R) {
      const sk = a.sk, n = sk.length;
      let D = 0, ded = 0, best = null, bestD = -1;
      sk.forEach(k => { const d = trD(k[0], k[1], k[2]); D += d; ded += k[3]; if (d > bestD) { bestD = d; best = k; } });
      const miss = 10 - n;
      if (!a.stick && !a.crash) ded += 0.2;
      const baseE = Math.max(0, 20 - 2 * ded - miss * 2);
      const js = [];
      for (let i = 0; i < 5; i++) js.push(r1(clamp(baseE + R.gauss() * 0.35, 0, 20)));
      const dr = dropMarks(js, 1);
      const E = keptAvg(js, dr), T = a.tof, Hs = Math.max(0, 10 - a.hd - miss * 0.6);
      const tot = D + E + T + Hs;
      const nm = (n >= 10 ? '10스킬 완료' : n + '스킬 후 중단') + (best ? ' · 최고: ' + trName(best[0], best[1], best[2]) : '');
      return { sc: tot, nm: nm, js: js, dr: dr, jf: 1, parts: [['D', D.toFixed(1)], ['E', E.toFixed(2)], ['T', T.toFixed(2)], ['H', Hs.toFixed(1)]], tot: tot.toFixed(3), note: a.crash ? '중단' : a.stick ? 'STICK' : '', bad: !!a.crash };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.08);
      let D = clamp(7 + q * 11 + R.gauss() * 0.5, 4, 18.5), E = clamp(13.6 + q * 3.4 + R.gauss() * 0.45, 10, 18.2);
      let T = clamp(14.4 + q * 3.4 + R.gauss() * 0.3, 11, 18.8), Hh = clamp(8.7 + q * 1.0 + R.gauss() * 0.15, 7.5, 10);
      let nm = '10스킬 완료';
      if (R.chance(0.04 + (1 - q) * 0.12)) { const k = R.int(3, 8); D *= k / 10; E = Math.max(0, E - (10 - k) * 2); T *= k / 10; Hh -= (10 - k) * 0.6; nm = k + '스킬 후 중단'; }
      return { sc: D + E + T + Hh, nm: nm };
    },
    fmt: v => v.toFixed(3),
    hint(s, a) {
      if (a.st === 'cont' || (a.st === 'air' && a.n <= TBU)) return a.n < TBU ? '{A} 매트가 가장 깊을 때 · 준비 점프 ' + (a.n + 1) + '/' + TBU : '{A} 반동 타이밍  {L}{R} 매트 위에서 중앙 유지';
      return '{D} 턱 {U} 파이크 (백 공중돌기) {L}{R} 트위스트 {A} 펴기';
    },
    cam(s, a) { return [-240, Math.min(-212, a.y - 70)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      drawArena(g, s, cx, cy, 'cool');
      floor(g, cy - 34, '#2b3f73', '#3b5698', cx);
      const dep = a ? a.dep : 0, ax = a ? a.x : 0;
      tramp(g, cx, cy, dep, ax, false);
      if (a) {
        const e = curEnt(s), look = gymLook(e);
        const X = a.x - cx, Y = a.y - cy;
        if (a.st === 'cont') {
          const k = a.dep / 26;
          fig(g, X, -cy + a.dep, POSE.mix(POSE.mix(POSE.stand(), P_LINE_UP, 0.45), P_LAND, clamp(k * 1.4, 0, 1)), look, { anchor: 'feet' });
        } else if (a.st === 'air') {
          if (a.n > TBU) { drawTrail(g, a, s.cam, look, P_OPEN); spinArcs(g, X, Y, a.rv, 30, g.t); }
          const k = clamp(-a.vy / 300, -1, 1);
          const base = a.n > TBU ? P_OPEN : POSE.mix(P_LINE_UP, P_LINE_DN, clamp(0.5 - k, 0, 1));
          fig(g, X, Y, airPose(a, base, P_LINE_DN), look, { rot: a.rot, sq: C(a.tw), anchor: 'com' });
        } else if (a.st === 'stop') {
          fig(g, X, -cy + a.dep, a.stopT > 0.5 ? POSE.armsUp() : P_LAND, look, { anchor: 'feet' });
        } else {
          sitDown(g, X, -cy + a.dep, look);
        }
        tramp(g, cx, cy, dep, ax, true);
        fxDraw(g, s, cx, cy);
        if (s.ph === 'board' || s.ph === 'end') return;
        // HUD
        const sk = a.sk.length;
        g.rect(4, 30, 96, 52, 'rgba(24,20,37,0.75)');
        g.text(a.n <= TBU && sk === 0 ? '준비 점프' : '스킬 ' + Math.min(10, sk + (a.st === 'air' ? 1 : 0)) + '/10', 9, 33, PAL.white, { size: 's' });
        g.text('비행 ' + a.tof.toFixed(2) + 's', 9, 46, PAL.cyan, { size: 'xs' });
        g.text('높이', 9, 58, PAL.lightgrey, { size: 'xs' });
        g.bar(30, 58, 64, 7, a.E, a.E > 0.85 ? PAL.green : a.E > 0.5 ? PAL.yellow : PAL.orange);
        g.text('H -' + a.hd.toFixed(1), 9, 70, a.hd > 0.5 ? PAL.orange : PAL.lightgrey, { size: 'xs' });
        if (a.st === 'cont') { // timing ring
          const k = clamp(a.ct / TCT, 0, 1);
          const rx = X, ry = -cy + 26;
          g.rect(rx - 30, ry, 60, 5, PAL.black); g.rect(rx - 29, ry + 1, 58, 3, PAL.slate);
          g.rect(rx - 5, ry + 1, 10, 3, PAL.green);
          g.rect(rx - 29 + Math.round(k * 56), ry - 1, 2, 7, PAL.white);
        }
        if (a.st === 'air' && a.n > TBU) {
          const som = abs(a.rot) / TAU;
          g.text(som.toFixed(1) + '회전', X + 34, Y - 30, PAL.yellow, { size: 's', outline: PAL.black });
        }
      }
    }
  };
  function tramp(g, cx, cy, dep, ax, front) {
    const X = x => Math.round(x - cx), Y = y => Math.round(y - cy);
    const W = 58, FR = 70;
    if (!front) {
      // end decks
      [-1, 1].forEach(sd => {
        const x0 = sd < 0 ? X(-FR - 92) : X(FR + 4);
        g.rect(x0, Y(-4), 88, 38, '#24407a'); g.rect(x0, Y(-4), 88, 6, '#3d68b8');
        g.rect(x0 + 4, Y(2), 80, 2, '#e43b44');
      });
      // frame far rail + legs
      g.rect(X(-FR), Y(-8), FR * 2, 3, '#6b7a99');
      g.rect(X(-FR + 6), Y(-6), 4, 40, '#4c5878'); g.rect(X(FR - 10), Y(-6), 4, 40, '#4c5878');
      // bed (3/4 view): far edge y-6, near edge y+5
      const pts = [], pts2 = [];
      for (let i = 0; i <= 24; i++) {
        const x = -W + i * (W * 2 / 24);
        const k = Math.max(0, 1 - Math.pow((x - ax) / (W * 0.95), 2));
        const d = dep * (0.35 + 0.65 * k) * (1 - Math.pow(x / W, 2) * 0.6);
        pts.push(X(x), Y(-6 + d * 0.8)); pts2.unshift(X(x), Y(5 + d));
      }
      g.poly(pts.concat(pts2), '#1c1c2e');
      // markings: centre zone + zone lines
      const mk = (x, c, w) => {
        const k = Math.max(0, 1 - Math.pow((x - ax) / (W * 0.95), 2));
        const d = dep * (0.35 + 0.65 * k) * (1 - Math.pow(x / W, 2) * 0.6);
        g.rect(X(x) - Math.floor(w / 2), Y(-5 + d * 0.8), w, 10 + d * 0.2, c);
      };
      mk(0, '#e43b44', 28);
      [-42, -28, -14, 14, 28, 42].forEach(x => mk(x, 'rgba(255,255,255,0.6)', 1));
      mk(0, '#ffffff', 1);
      return;
    }
    // near rail + pads + springs (drawn over the athlete's feet)
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      for (let k = 0; k < 5; k++) { const yy = -5 + k * 2.4; g.line(X(sd * W), Y(yy), X(sd * (FR - 2)), Y(yy - 1), '#c0cbdc', 1); }
    }
    g.rect(X(-FR - 4), Y(4), 18, 8, '#3d68b8'); g.rect(X(FR - 14), Y(4), 18, 8, '#3d68b8');
    g.rect(X(-FR), Y(10), FR * 2, 3, '#8b9bb4');
    g.rect(X(-FR + 2), Y(12), 4, 24, '#6b7a99'); g.rect(X(FR - 6), Y(12), 4, 24, '#6b7a99');
    g.rect(X(-FR + 10), Y(30), FR * 2 - 20, 2, '#4c5878');
  }

  /* ================================================================ VAULT */
  const VT_P = { dir: 1, d: 'T', u: 'P', w: { T: 2.3, P: 1.9, L: 1.15, O: 1.15, X: 0.05 }, twS: PI, twV: 7 * PI, twM: 7 * PI, cw: 0.55, cv: 1.3, tgt: TAU };
  const VSB = 600, VTF = 642, VTL = 34, VTT = -36, VMAT = 690, VG = 360;
  function vaultD(som, ht, pos) {
    return r1(clamp(2.4 + som * 1.4 + ht * 0.35 + (pos !== 'C' && som >= 1 && !ht ? 0.4 : 0), 2.0, 6.4));
  }
  function vaultName(som, ht, pos) {
    if (som === 1 && ht === 6) return '양학선 (핸드스프링 3회 비틀기)';
    if (som === 1 && ht === 5) return '여2 (핸드스프링 2½ 비틀기)';
    if (som === 2 && ht === 1) return '드라굴레스쿠' + (pos === 'B' ? ' 파이크' : '');
    if (som === 2 && ht === 0) return '핸드스프링 더블 앞공중 ' + POSKO[pos];
    if (som === 0) return '핸드스프링' + (ht ? ' ' + half(ht) + '비틀기' : '');
    return '핸드스프링 ' + (som === 1 ? '' : som + '회 ') + '앞공중' + (ht ? ' ' + half(ht) + '비틀기' : ' ' + POSKO[pos]);
  }
  KIND.vault = {
    attW: '차 도마',
    init(s, e, R) {
      const a = { e: e.idx, st: 'run', t: 0, x: 40, y: -26, v: 0, ph: 0, last: '', idle: 0, q1: 0, q2: 0, Q: 0, hp: -9, vx: 0, vy: 0, land: '', lt: 0, err: 0, som: 0, ht: 0, pos: 'C', twLeft: 0, fin: false, finT: 2.0, rx: 0, ry: 0 };
      flipInit(a);
      return a;
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'run') {
        let pressed = false;
        if (inp.lp && a.last !== 'l') { a.v += 21; a.last = 'l'; pressed = true; }
        if (inp.rp && a.last !== 'r') { a.v += 21; a.last = 'r'; pressed = true; }
        if (pressed) a.idle = 0; else a.idle += dt;
        a.v -= a.v * 0.5 * dt;
        if (a.idle > 1.0) a.v = Math.max(a.v, 75);
        a.v = Math.min(a.v, 265);
        a.x += a.v * dt; a.ph += a.v * dt / 62;
        if (Math.floor(a.ph * 2) !== Math.floor((a.ph - a.v * dt / 62) * 2)) OG.sfx(s, 'step');
        if (inp.ap && a.x > VSB - 84) { a.q1 = clamp(1 - abs(a.x - (VSB - 42)) / 34, 0.08, 1); this.hurdle(s, a); }
        else if (a.x >= VSB - 6) { a.q1 = 0.1; this.hurdle(s, a); }
      } else if (a.st === 'hurdle') {
        const k = Math.min(1, a.t / 0.2);
        a.x = lerp(a.rx, VSB + 14, k); a.y = -26 - S(k * PI) * 10 - k * 4;
        if (k >= 1) { a.st = 'board'; a.t = 0; OG.sfx(s, 'bounce'); }
      } else if (a.st === 'board') {
        a.y = -26 - 4 + S(Math.min(1, a.t / 0.08) * PI) * 3;
        if (a.t >= 0.08) { a.st = 'pre'; a.t = 0; a.rx = a.x; a.ry = a.y; }
      } else if (a.st === 'pre') {
        const T = 0.3, k = Math.min(1, a.t / T);
        a.x = lerp(a.rx, VTF + 12, k); a.y = lerp(a.ry, VTT - 30, k) - S(k * PI) * 16;
        a.rot = lerp(0.2, PI * 0.96, M.ease(k));
        if (inp.ap) a.hp = a.t - T;
        if (k >= 1) { a.st = 'hands'; a.t = 0; OG.sfx(s, 'hit'); }
      } else if (a.st === 'hands') {
        if (inp.ap && a.hp < -0.1) a.hp = a.t;
        a.rot += 2.2 * dt; a.y -= 30 * dt; a.x += 40 * dt;
        if (a.t >= 0.15) {
          a.q2 = a.hp < -0.12 ? 0.12 : clamp(1 - abs(a.hp - 0.04) / 0.12, 0.12, 1);
          a.Q = clamp(0.22 * a.q1 + 0.38 * a.q2 + 0.4 * (a.v / 250), 0.05, 1);
          a.vy = -(70 + 150 * a.Q); a.vx = 50 + 0.32 * a.v;
          const r = a.rot; flipInit(a); a.rot = r; a.started = 1; a.rv = 1.0 * TAU;
          a.st = 'air'; a.t = 0;
          OG.sfx(s, 'jump');
          if (a.q2 > 0.85) pop(s, '강한 밀기!', PAL.green, { z: 'l', y: 40 });
        }
      } else if (a.st === 'air') {
        flipUpd(a, inp, dt, VT_P);
        a.vy += VG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        trail(a, a.x, a.y);
        const low = 24 * abs(C(a.rot)) * (1 - 0.45 * Math.max(a.tk, a.pk * 0.6)) + 6;
        if (a.vy > 0 && a.y + low >= -8) this.land(s, a, R);
      } else if (a.st === 'land') {
        a.lt += dt;
        if (a.land !== 'stick' && a.land !== 'fall' && a.lt < 0.5) a.x += (a.land === 'big' ? 46 : 24) * dt * (1 - a.lt * 2);
        if (a.land === 'fall' && a.lt < 0.4) a.x += 30 * dt;
      }
    },
    hurdle(s, a) {
      a.st = 'hurdle'; a.t = 0; a.rx = a.x;
      OG.sfx(s, 'jump');
      if (a.q1 > 0.85) pop(s, '정확한 구름판!', PAL.green, { z: 'l', y: 40 });
      else if (a.q1 < 0.3) pop(s, '구름판 타이밍 X', PAL.orange, { z: 'l', y: 40 });
    },
    land(s, a, R) {
      a.err = abs(nAng(a.rot));
      a.twLeft = abs(a.twT - a.tw) / PI;
      const k = Math.round(a.rot / TAU);
      a.som = Math.max(0, k - 1); a.ht = Math.round(a.twT / PI);
      a.pos = posLetter(a);
      const e = a.err + a.twLeft * 0.8 + (a.tk > 0.6 ? 0.5 : 0);
      const stickT = a.at - a.stT;
      if (e > 0.75 || k < 1) a.land = 'fall';
      else if (e < 0.2 && stickT < 0.5 && a.twLeft < 0.05) a.land = 'stick';
      else if (e < 0.22) a.land = 'small';
      else if (e < 0.42) a.land = 'step';
      else a.land = 'big';
      a.st = 'land'; a.lt = 0; a.fin = true; a.y = -26;
      fx(s, R, a.x, -8, 10, { c: [9, 14, 1], spd: 50, ang: -PI / 2, spr: 2.6, gr: 260, life: 0.5, w: 14 });
      OG.sfx(s, a.land === 'fall' ? 'crash' : 'land');
      const L = { stick: ['STICK!', PAL.green], small: ['작은 스텝', PAL.yellow], step: ['스텝', PAL.orange], big: ['큰 스텝', PAL.orange], fall: ['낙상!', PAL.red] }[a.land];
      pop(s, L[0], L[1], { z: 'xl' });
      if (a.land === 'stick') OG.sfx(s, 'perfect');
    },
    judge(s, a, R) {
      const D = a.land === 'fall' && a.som === 0 && a.err > 1.5 ? 2.0 : vaultD(a.som, a.ht, a.pos);
      let ded = { stick: 0, small: 0.1, step: 0.3, big: 0.5, fall: 1.0 }[a.land] || 0;
      ded += Math.min(0.6, a.err * 0.9) + (1 - a.Q) * 0.7 + (1 - a.q1) * 0.25 + Math.min(0.8, a.twLeft * 0.9) + (a.tT > 0.2 && a.pT > 0.2 ? 0.2 : 0);
      if (a.land === 'fall') ded += 0.5;
      const base = clamp(10 - ded - 0.25, 0, 10);
      const js = [];
      for (let i = 0; i < 5; i++) js.push(r1(clamp(base + R.gauss() * 0.12, 0, 10)));
      const dr = dropMarks(js, 1);
      const E = keptAvg(js, dr);
      const sc = D + E;
      return { sc: sc, nm: vaultName(a.som, a.ht, a.pos), js: js, dr: dr, jf: 1, parts: [['D', D.toFixed(1)], ['E', E.toFixed(3)]], tot: sc.toFixed(3), note: a.land === 'stick' ? 'STICK' : a.land === 'fall' ? '낙상' : '', bad: a.land === 'fall' };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.08);
      const opts = [[0, 2, 'C'], [1, 0, 'C'], [1, 2, 'A'], [1, 3, 'A'], [1, 4, 'A'], [2, 0, 'C'], [1, 5, 'A'], [2, 1, 'C'], [2, 1, 'B'], [1, 6, 'A']];
      const k = clamp(Math.round(q * 9 + R.gauss() * 0.8), 0, 9);
      const o = opts[k];
      let E = clamp(7.7 + q * 1.85 + R.gauss() * 0.22, 6.2, 9.8);
      if (R.chance(0.04 + (1 - q) * 0.12)) E -= R.range(1.0, 1.8);
      return { sc: vaultD(o[0], o[1], o[2]) + E, nm: vaultName(o[0], o[1], o[2]) };
    },
    fmt: v => v.toFixed(3),
    hint(s, a) {
      if (a.st === 'run') return a.x > VSB - 110 ? '{A} 구름판 직전 표시에서 도약!' : '{L}{R} 번갈아 연타: 질주';
      if (a.st === 'hurdle' || a.st === 'board' || a.st === 'pre' || a.st === 'hands') return '{A} 손이 도마에 닿는 순간 밀기!';
      if (a.st === 'air') return '{D} 턱 {U} 파이크 {L}{R} 비틀기 {A} 펴서 착지(STICK)';
      return '';
    },
    cam(s, a) { return [clamp(a.x - 210, -60, VMAT + 80), Math.min(-214, a.y - 112)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      drawArena(g, s, cx, cy, 'warm');
      floor(g, cy, '#2d5c8a', '#4b84b8', cx);
      const X = x => Math.round(x - cx), Y = y => Math.round(y - cy);
      // runway + marks
      g.rect(X(-60), Y(0) - 2, VSB + 60 - 8, 4, '#3a74c8');
      for (let x = 0; x < VSB; x += 26) g.rect(X(x), Y(0) - 2, 1, 4, '#8fb8f0');
      g.rect(X(VSB - 42) - 1, Y(0) - 4, 3, 6, PAL.yellow);
      // springboard
      g.poly([X(VSB), Y(0), X(VSB + 30), Y(-9), X(VSB + 30), Y(0)], '#e8eef8');
      g.poly([X(VSB), Y(0) - 1, X(VSB + 30), Y(-10), X(VSB + 30), Y(-8)], PAL.red);
      // table
      const tx = X(VTF), ty = Y(VTT);
      g.rect(tx + 12, ty + 8, 8, 30, '#5a6988'); g.rect(tx + 4, Y(0) - 4, 26, 4, '#3a4466');
      g.rect(tx - 1, ty - 1, VTL + 2, 10, '#181425');
      g.rect(tx, ty, VTL, 8, '#e8eef8'); g.rect(tx, ty, VTL, 3, '#0099db'); g.rect(tx + 2, ty + 4, VTL - 4, 1, '#c0cbdc');
      // mats
      g.rect(X(VMAT), Y(-8), 330, 9, '#2e64b8'); g.rect(X(VMAT), Y(-8), 330, 2, '#5f95e0');
      g.rect(X(VMAT + 40), Y(-8), 90, 2, '#ffffff'); g.rect(X(VMAT + 40), Y(-8), 1, 8, '#fff'); g.rect(X(VMAT + 130), Y(-8), 1, 8, '#fff');
      g.rect(X(VMAT + 330), Y(-8), 2, 9, '#183870');
      // judges' table
      g.rect(X(VMAT + 360), Y(-22), 70, 22, '#3a4466'); g.rect(X(VMAT + 360), Y(-24), 70, 3, '#c0cbdc');
      for (let i = 0; i < 3; i++) fig(g, X(VMAT + 372 + i * 22), Y(-14), POSE.sit(), { shirt: '#262b44', pants: '#181425', skin: OG.SKINS[i + 1], hair: PAL.black }, { anchor: 'hip', s: 1, f: -1 });
      if (!a) return;
      const e = curEnt(s), look = gymLook(e);
      const AX = a.x - cx, AY = a.y - cy;
      if (a.st === 'run') {
        fig(g, AX, Y(0), POSE.run(a.ph % 1, clamp(a.v / 230, 0.2, 1)), look, { anchor: 'feet' });
        // speed bar
        if (s.ph !== 'board' && s.ph !== 'end') g.text('스피드', 8, 32, PAL.white, { size: 'xs', outline: PAL.black });
        if (s.ph !== 'board' && s.ph !== 'end') g.bar(40, 32, 90, 8, a.v / 265, a.v > 220 ? PAL.green : a.v > 150 ? PAL.yellow : PAL.orange);
      } else if (a.st === 'hurdle' || a.st === 'board') {
        fig(g, AX, AY, POSE.mix(POSE.hurdle(), POSE.armsUp(), a.st === 'board' ? 1 : 0.4), look, { anchor: 'com' });
      } else if (a.st === 'pre' || a.st === 'hands') {
        fig(g, AX, AY, a.st === 'hands' ? P_LINE_UP : POSE.mix(POSE.armsUp(), P_LINE_UP, 0.6), look, { rot: a.rot, anchor: 'com' });
      } else if (a.st === 'air') {
        drawTrail(g, a, s.cam, look, P_LINE_DN);
        spinArcs(g, AX, AY, a.rv, 30, g.t);
        fig(g, AX, AY, airPose(a, POSE.mix(P_LINE_DN, P_LINE_UP, 0.4), P_LAND), look, { rot: a.rot, sq: C(a.tw), anchor: 'com' });
        const som = abs(a.rot) / TAU;
        g.text(half(Math.floor(a.tw / PI + 0.01)) + ' 비틀기 · ' + som.toFixed(1), AX + 30, AY - 34, PAL.yellow, { size: 'xs', outline: PAL.black });
      } else {
        const k = clamp(a.lt / 0.35, 0, 1);
        if (a.land === 'fall') { if (a.lt < 0.3) fig(g, AX, Y(-8), P_LAND, look, { anchor: 'feet' }); else sitDown(g, AX, Y(-8), look); }
        else fig(g, AX, Y(-8), a.lt > 0.6 ? POSE.armsUp() : POSE.mix(P_LAND, POSE.stand(), k), look, { anchor: 'feet' });
      }
      fxDraw(g, s, cx, cy);
    }
  };

  /* ========================================================= SNOW NIGHT === */
  function nightSky(g, cx, cy, seed, moon) {
    const py = -cy * 0.08;
    g.grad(0, 0, 480, 270, '#070a1c', '#1d2a5c', 12);
    for (let i = 0; i < 70; i++) {
      const x = M.wrap(H(i, seed, 1) * 520 - cx * 0.03, 480), y = H(i, seed, 2) * 150 + py * 0.3;
      const tw = H(i, Math.floor(g.t * 3 + i), 4) > 0.85;
      g.px(x, y, tw ? '#ffffff' : (i % 3 ? '#8b9bb4' : '#c0cbdc'));
    }
    if (moon) {
      const mx = 390 - cx * 0.02, my = 40 + py * 0.2;
      g.circle(mx, my, 14, 'rgba(255,246,216,0.08)'); g.circle(mx, my, 10, '#fff6d8'); g.circle(mx + 4, my - 2, 9, '#1a2550');
    }
  }
  function floodlight(g, x, y, h, sc, glow) {
    sc = sc || 1;
    g.rect(x - Math.max(1, sc), y, Math.max(2, 2 * sc), h, '#2a2f45');
    const w = Math.round(18 * sc), hh = Math.max(3, Math.round(8 * sc));
    g.rect(x - w / 2, y - hh, w, hh, '#3a4466');
    for (let i = 0; i < 3; i++) g.rect(x - w / 2 + 2 + i * (w - 4) / 3, y - hh + 1, Math.max(1, (w - 4) / 3 - 1), hh - 2, '#fff6d8');
    if (glow !== false) {
      g.alpha(0.06); g.circle(x, y - hh / 2, 22 * sc, '#fff6d8'); g.circle(x, y - hh / 2, 12 * sc, '#fff6d8'); g.alpha(1);
    }
  }
  function lightCone(g, x, y, x2, y2, w, a) {
    g.alpha(a || 0.05);
    g.poly([x - 4, y, x + 4, y, x2 + w, y2, x2 - w, y2], '#dff3ff');
    g.alpha(1);
  }
  function snowSpray(s, R, x, y, n, o) {
    o = o || {};
    fx(s, R, x, y, n, { c: [0, 1, 10], spd: o.spd || 70, ang: o.ang == null ? -PI / 2 : o.ang, spr: o.spr || 1.6, gr: 240, life: o.life || 0.7, w: o.w || 8, sz: 2, vx: o.vx || 0 });
  }
  function snowLook(e, kind) {
    const L = lookOf(e);
    if (kind === 'ski') return { shirt: L.shirt, pants: L.pants, skin: L.skin, hair: L.hair, cap: L.pants, visor: '#feae34', sleeves: true, tights: true, shoe: '#262b44' };
    return { shirt: L.shirt, pants: OG.shade(L.pants, 0.1), skin: L.skin, hair: L.hair, cap: '#262b44', visor: '#2ce8f5', sleeves: true, tights: true, shoe: '#181425' };
  }
  // terrain helper: column fill
  function terrain(g, cx, cy, fy, top, body, edge) {
    for (let x = 0; x < 480; x += 2) {
      const y = Math.round(fy(x + cx) - cy);
      if (y >= 270) continue;
      const yy = Math.max(y, -2);
      g.rect(x, yy, 2, 272 - yy, body);
      g.rect(x, y, 2, 3, top);
      if (edge) g.rect(x, y + 3, 2, 1, edge);
    }
  }

  /* ============================================================== AERIALS */
  const AE_P = { dir: -1, d: 'L', u: 'T', w: { T: 1.8, P: 1.45, L: 1.32, O: 0.12, X: 0.03 }, twS: TAU, twV: 2.4 * TAU, twM: 5 * TAU, cw: 0.55, cv: 1.15, tgt: TAU };
  const AG = 215;
  function aeY(x) {
    if (x < -700) return -330;
    if (x < -210) return -330 + (x + 700) * (330 / 490);
    if (x < -130) return 0;
    if (x <= -20) { const u = (x + 130) / 110; return -62 * Math.pow(u, 2.6); }
    if (x < 60) return 0;
    if (x < 520) return (x - 60) * 0.754;
    if (x < 640) { const u = (x - 520) / 120; return 346.8 + 120 * 0.754 * (u - u * u / 2); }
    return 392;
  }
  const aeA = x => Math.atan2(aeY(x + 2) - aeY(x - 2), 4);
  function aeDD(fl, tw, tuck) {
    if (fl <= 0) return 1.0;
    return r3(clamp((0.9 * fl + 0.45 * tw + 0.3) * (tuck ? 0.9 : 1), 1.0, 5.5));
  }
  function aeName(fl, tw, tuck) {
    if (fl <= 0) return tw ? '스트레이트 ' + tw + '트위스트' : '스트레이트 점프';
    const fn = ['', '싱글', '더블', '트리플', '쿼드'][Math.min(fl, 4)];
    const per = []; for (let i = 0; i < fl; i++) per.push(Math.floor(tw / fl) + (i >= fl - (tw % fl) ? 1 : 0));
    if (fl === 3 && per[1] < per[2]) { per[1]++; per[2]--; }
    const code = 'b' + per.map(n => n <= 0 ? (tuck ? 'T' : 'L') : ['', 'F', 'dF', 'tF', 'qF'][Math.min(4, n)]).join('');
    return fn + ' 백플립' + (tw ? ' ' + tw + '트위스트' : tuck ? ' (턱)' : ' (레이아웃)') + ' · ' + code;
  }
  KIND.aerial = {
    attW: '차 점프',
    init(s, e, R) {
      const a = { e: e.idx, st: 'top', t: 0, x: -640, y: aeY(-640), v: 0, vx: 0, vy: 0, q: 0, pr: 0, land: '', lt: 0, fl: 0, twc: 0, err: 0, tuck: 0, fin: false, finT: 2.2, apex: 0, sl: 0 };
      flipInit(a);
      return a;
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'top') {
        if (a.t > 0.6 || inp.ap) { a.st = 'in'; a.t = 0; OG.sfx(s, 'whoosh'); }
      } else if (a.st === 'in') {
        const ang = aeA(a.x);
        a.v += (S(ang) * 260 - (a.x > -130 ? 20 : 0)) * dt;
        a.v = clamp(a.v, 40, 340);
        a.x += a.v * C(ang) * dt; a.y = aeY(a.x);
        if (inp.ap && a.x > -78 && !a.pr) { a.pr = 1; a.q = clamp(1 - abs(a.x - (-36)) / 40, 0, 1); }
        if (R.chance(0.3)) snowSpray(s, R, a.x - 8, a.y, 1, { spd: 30, ang: -PI * 0.8, spr: 0.6, life: 0.4 });
        if (a.x >= -20) {
          a.st = 'air'; a.t = 0;
          a.vx = 100 + 10 * a.q; a.vy = -(228 + 66 * a.q);
          a.y = -62 - 26; a.rv = -0.1 * TAU;
          OG.sfx(s, 'jump');
          snowSpray(s, R, -20, -62, 12, { spd: 90, ang: -PI * 0.42, spr: 0.8, life: 0.8 });
          if (a.pr && a.q > 0.8) pop(s, '빅 팝!', PAL.green, { z: 'l', y: 40 }); else if (!a.pr || a.q < 0.3) pop(s, '팝 타이밍 X', PAL.orange, { z: 'l', y: 40 });
        }
      } else if (a.st === 'air') {
        flipUpd(a, inp, dt, AE_P);
        a.vy += AG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        a.apex = Math.max(a.apex, -62 - 26 - a.y);
        trail(a, a.x, a.y);
        if (a.vy > 0 && a.y + 24 * abs(C(a.rot)) * (1 - 0.4 * a.tk) + 4 >= aeY(a.x)) this.land(s, a, R);
      } else if (a.st === 'land') {
        a.lt += dt;
        const ang = aeA(a.x);
        if (a.land === 'crash') { a.sl += dt * 7; a.v = Math.max(0, a.v - 60 * dt); } else a.v = clamp(a.v + (S(ang) * 200 - 40) * dt, 0, 260);
        a.x += a.v * C(ang) * dt; a.y = aeY(a.x) - 26;
        if (R.chance(0.5) && a.v > 30) snowSpray(s, R, a.x - 6, aeY(a.x), 1, { spd: 40, ang: -PI * 0.75, spr: 0.8, life: 0.5 });
      }
    },
    land(s, a, R) {
      a.err = abs(nAng(a.rot));
      a.fl = Math.round(abs(a.rot) / TAU); a.twc = Math.round(a.tw / TAU);
      const twLeft = abs(a.twT - a.tw) / TAU;
      a.tuck = a.tT > a.lT ? 1 : 0;
      const e = a.err + twLeft * 1.2 + (a.tk > 0.6 ? 0.5 : 0);
      const stk = a.at - a.stT < 0.55;
      a.land = e > 0.7 ? 'crash' : e > 0.36 ? 'hand' : e < 0.16 && stk ? 'stick' : 'ok';
      a.twLeft = twLeft;
      a.st = 'land'; a.lt = 0; a.fin = true; a.v = 150; a.y = aeY(a.x) - 26;
      snowSpray(s, R, a.x, aeY(a.x), a.land === 'crash' ? 30 : 14, { spd: a.land === 'crash' ? 140 : 80, ang: -PI * 0.6, spr: 1.4, w: 16 });
      OG.sfx(s, a.land === 'crash' ? 'crash' : 'land'); OG.sfx(s, 'snow');
      const L = { stick: ['STICK!', PAL.green], ok: ['착지 성공', PAL.white], hand: ['손 짚음', PAL.orange], crash: ['CRASH', PAL.red] }[a.land];
      pop(s, L[0], L[1], { z: 'xl' });
      if (a.land === 'stick') OG.sfx(s, 'perfect');
      if (a.fl >= 3 && a.land !== 'crash') pop(s, ['', '', '더블', '트리플', '쿼드'][Math.min(4, a.fl)] + '!', PAL.gold, { z: 'xxl', y: 92, d: 1.8 });
    },
    judge(s, a, R) {
      const dd = aeDD(a.fl, a.twc, a.tuck);
      const air = clamp(0.5 + 1.5 * (a.q * 0.5 + clamp(a.apex / 230, 0, 1) * 0.5), 0, 2);
      const form = clamp(5 - a.twLeft * 3 - (a.tuck ? 0.6 : 0) - (a.tT > 0.2 && a.lT > 0.3 ? 0.4 : 0) - a.err * 2, 0, 5);
      const land = { stick: 3, ok: 2.5 - a.err * 2, hand: 1.2, crash: 0.3 }[a.land];
      const base = air + form + clamp(land, 0, 3);
      const js = judges(R, base, 5, 0.25, 0.1, 10), dr = dropMarks(js, 1);
      const sc = kept(js, dr) * dd;
      return { sc: sc, nm: aeName(a.fl, a.twc, a.tuck), js: js, dr: dr, jf: 1, dd: dd, parts: [['공중', air.toFixed(1)], ['자세', form.toFixed(1)], ['착지', clamp(land, 0, 3).toFixed(1)]], tot: sc.toFixed(2), note: { stick: 'STICK', hand: '손 짚음', crash: 'CRASH', ok: '' }[a.land], bad: a.land === 'crash' || a.land === 'hand' };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.09);
      const fl = q > 0.68 ? 3 : q > 0.38 ? 2 : 1;
      const tw = fl === 3 ? (q > 0.88 ? 4 : q > 0.78 ? 3 : 2) : fl === 2 ? (q > 0.5 ? 2 : 1) : 1;
      let avg = clamp(6.6 + 2.7 * q + R.gauss() * 0.45, 3, 9.8);
      if (R.chance(0.06 + (1 - q) * 0.18)) avg = R.range(2.5, 5.5);
      return { sc: 3 * avg * aeDD(fl, tw, 0), nm: aeName(fl, tw, 0) };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'top' || a.st === 'in') return '{A} 킥커 끝(립)에서 팝!';
      if (a.st === 'air') return '{D} 백플립(레이아웃) {U} 턱 {L}{R} 풀 트위스트 {A} 착지 자세';
      return '';
    },
    cam(s, a) { const gy = aeY(a.x + (a.st === 'air' ? 120 : 40)); return [a.x - 210, clamp(gy - 245, a.y - 220, a.y - 50)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      nightSky(g, cx, cy, 11, true);
      g.mountains(150 - cy * 0.08, 70, '#1d2546', 3, cx * 0.1, '#3a4a7a');
      g.mountains(185 - cy * 0.15, 55, '#151b36', 7, cx * 0.2);
      g.trees(232 - cy * 0.2, '#0e1a2a', 4, cx * 0.25, 9);
      // floodlights (world)
      [-560, -300, -60, 140, 420, 700].forEach(x => {
        const X = x - cx, gy = aeY(x) - cy;
        if (X < -60 || X > 540) return;
        floodlight(g, X, gy - 260, 260, 1.3);
        lightCone(g, X, gy - 260, X + 60, gy + 40, 90, 0.04);
      });
      // inrun fences
      for (let x = -700; x < -130; x += 14) { const X = x - cx, Y = aeY(x) - cy; if (X > -20 && X < 500) { g.rect(X, Y - 12, 1, 12, '#f77622'); } }
      terrain(g, cx, cy, aeY, '#f4f8ff', '#c9d8ee', '#e3ecf8');
      // shadow side of the kicker + dye lines
      const kx = -20 - cx, ky = -62 - cy;
      g.rect(kx, ky + 2, 3, 60, '#9fb2d0');
      for (let x = -120; x < -20; x += 4) { const X = x - cx, Y = aeY(x) - cy; g.rect(X, Y + 1, 2, 1, '#2a8fd6'); }
      for (let x = 70; x < 520; x += 3) { const X = x - cx; if (X < -2 || X > 482) continue; g.rect(X, aeY(x) - cy + 1, 2, 1, (Math.floor(x / 60) % 2) ? '#e43b44' : '#2a8fd6'); }
      // crowd + banners at the outrun
      const ox = 660 - cx, oy = 392 - cy;
      if (ox < 480 && oy < 290) {
        g.crowd(ox, oy - 34, 300, 30, g.t, { seed: 2, excite: s.ph === 'card' || (a && a.st === 'land') ? 0.6 : 0.1, bg: '#1d2546' });
        g.adBoards(ox, oy - 8, 300, 8, g.t, ['FREESTYLE AERIALS', 'DOT GAMES 2026', 'SNOW POWER']);
      }
      if (!a) { g.snowfall(g.t, 70); return; }
      const e = curEnt(s), look = snowLook(e, 'ski');
      const X = a.x - cx, Y = a.y - cy;
      const skiO = { len: 9, off: 1.2, col: e ? lookOf(e).pants : PAL.red, skis: true };
      if (a.st === 'top' || a.st === 'in') {
        const ang = aeA(a.x);
        const J = fig(g, X, Y, a.st === 'top' ? POSE.mix(POSE.ski(0.2), POSE.stand(), 0.5) : POSE.mix(POSE.tuckSki(), POSE.armsUp(), a.x > -60 ? 0.6 : 0), look, { rot: ang, anchor: 'feet' });
        board(g, J, skiO);
      } else if (a.st === 'air') {
        drawTrail(g, a, s.cam, look, P_OPEN);
        spinArcs(g, X, Y, a.rv, 32, g.t);
        const p = airPose(a, a.md === 'L' ? P_LINE_DN : POSE.mix(P_LINE_DN, P_OPEN, 0.5), POSE.mix(P_LAND, POSE.stand(), 0.4));
        const J = fig(g, X, Y, p, look, { rot: a.rot, sq: C(a.tw), anchor: 'com' });
        board(g, J, skiO);
        g.text(Math.floor(abs(a.rot) / TAU + 0.02) + '플립 · ' + Math.floor(a.tw / TAU + 0.02) + '트위스트', X + 34, Y - 36, PAL.yellow, { size: 'xs', outline: PAL.black });
      } else {
        const ang = aeA(a.x);
        if (a.land === 'crash') {
          const J = fig(g, X, Y + 10, POSE.fallen(), look, { rot: a.sl, anchor: 'com' });
          board(g, J, skiO);
        } else {
          const J = fig(g, X, aeY(a.x) - cy, a.land === 'hand' && a.lt < 0.8 ? POSE.sit() : a.lt > 0.7 && a.land !== 'hand' ? POSE.celebrate(g.t % 1) : POSE.ski(0.25), look, { rot: ang * 0.6, anchor: 'feet' });
          board(g, J, skiO);
        }
      }
      fxDraw(g, s, cx, cy);
      g.snowfall(g.t, 60);
    }
  };

  /* ============================================================ HALFPIPE */
  const PF = 72, PR = 150, PA = PR * PI / 2, PG = 300, PIPE_HITS = 5;
  const SP_PTS = [1.5, 2.5, 3.5, 4.8, 6, 7.2, 8.4, 9.4, 10.4, 11.2, 12];
  function pipePt(u) {
    const au = abs(u), sg = sgn(u);
    if (au <= PF) return [u, 0, 0];
    const ph = Math.min((au - PF) / PR, PI / 2);
    return [sg * (PF + PR * S(ph)), -PR * (1 - C(ph)), ph];
  }
  function pipeY(x) {
    const ax = abs(x);
    if (ax <= PF) return 0;
    if (ax >= PF + PR) return -PR;
    const ph = Math.asin((ax - PF) / PR);
    return -PR * (1 - C(ph));
  }
  function spinName(deg, dir) {
    if (!deg) return '스트레이트 에어';
    return (dir < 0 ? 'BS ' : 'FS ') + deg;
  }
  function trickPts(h) { // h: [deg, flips, grab, heightPx, land(0 crash,1 sketchy,2 clean), rep]
    if (h[4] === 0) return 0;
    let v = SP_PTS[Math.min(10, Math.round(h[0] / 180))] + Math.min(2, h[1]) * 2.2 + (h[2] ? 1.2 : 0) + clamp(h[3] / 26, 0, 6) * 0.7;
    if (h[4] === 1) v *= 0.55;
    if (h[5]) v *= 0.8;
    return v;
  }
  function boarderPose(k, gr, gk) {
    let p = { t: 0.3, aL: 0.9, aR: -0.6, eL: 0.6, eR: 0.5, lL: 0.55, lR: -0.35, kL: 0.9, kR: 0.7 };
    if (k) p = POSE.mix(p, { t: 0.5, aL: 1.4, aR: -0.9, eL: 0.4, eR: 0.3, lL: 0.9, lR: -0.1, kL: 1.6, kR: 1.3 }, k);
    if (gr) p = POSE.mix(p, gk === 'u' ? { t: 0.7, aL: 2.0, aR: -1.2, eL: 0.2, eR: 0.6, lL: 1.5, lR: 0.6, kL: 2.3, kR: 1.9 } : { t: 0.8, aL: 1.6, aR: 1.25, eL: 0.6, eR: 0.3, lL: 1.6, lR: 0.9, kL: 2.4, kR: 2.0 }, gr);
    return p;
  }
  KIND.pipe = {
    attW: '차 런',
    init(s, e, R) {
      return { e: e.idx, st: 'drop', t: 0, u: -(PF + PA), v: 0, x: -(PF + PR), y: -PR, vx: 0, vy: 0, f: 1, ang: PI / 2, sp: 0, spV: 0, spD: 1, fl: 0, flA: 0, gr: 0, grT: 0, gk: 'd', popT: -9, lpT: -9, hits: [], runT: 0, fallT: 0, at: 0, fin: false, finT: 2.0, crash: 0, top: 0, lastHit: 0, pk: 0, ld: 0 };
    },
    upd(s, a, inp, dt, R) {
      a.t += dt; a.runT += dt;
      if (inp.ap) a.popT = a.t;
      if (a.st === 'drop') {
        if (a.t > 0.7 || inp.ap) { a.st = 'ride'; a.u = -(PF + PA) + 1; a.v = 30; a.f = 1; OG.sfx(s, 'whoosh'); }
        return;
      }
      if (a.st === 'ride' || a.st === 'fall') {
        const pt = pipePt(a.u), ph = pt[2], sg = sgn(a.u);
        a.v += -PG * S(ph) * sg * dt;
        const down = a.u * a.v < 0;
        a.pk = inp.d && a.st === 'ride' ? Math.min(1, a.pk + dt * 6) : Math.max(0, a.pk - dt * 6);
        if (a.st === 'ride' && inp.d && ph > 0.05) a.v += (down ? 170 * S(Math.min(PI / 2, ph * 1.5)) : -70) * sgn(a.v) * dt;
        a.v -= a.v * (a.st === 'fall' ? 1.8 : 0.05) * dt;
        a.v = clamp(a.v, -430, 430);
        a.u += a.v * dt;
        const p2 = pipePt(a.u);
        a.x = p2[0]; a.y = p2[1]; a.ang = -sgn(a.u) * p2[2];
        if (a.st === 'ride' && abs(a.v) > 60 && R.chance(0.25)) snowSpray(s, R, a.x, a.y, 1, { spd: 25, ang: a.ang - PI / 2, spr: 1, life: 0.35 });
        if (a.st === 'fall') { a.fallT += dt; if (a.fallT > 1.3 && abs(a.u) < PF) { a.st = 'ride'; a.v = 150 * (a.u < 0 ? 1 : -1); a.f = sgn(a.v); a.crash++; } }
        if (abs(a.u) >= PF + PA && a.u * a.v > 0) {
          if (a.st === 'fall') { a.v = -a.v * 0.3; a.u = sgn(a.u) * (PF + PA - 1); }
          else this.launch(s, a, R);
        }
      } else if (a.st === 'air') {
        a.at += dt;
        a.vy += PG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        a.top = Math.max(a.top, -PR - a.y);
        if (inp.l || inp.r) { a.spV = appr(a.spV, (inp.r ? 1 : -1) * 2.5 * TAU, 40 * dt); a.spD = inp.r ? 1 : -1; }
        else {
          a.spV = appr(a.spV, 0, 150 * dt);
          const near = Math.round(a.sp / PI) * PI;
          if (abs(near - a.sp) < 0.75) a.sp = appr(a.sp, near, 4 * dt);
        }
        a.sp += a.spV * dt;
        if (inp.u) { a.flA += 1.5 * TAU * dt * a.f; a.fl = 1; }
        else {
          const tgt = -sgn(a.x) * Math.asin(clamp((abs(a.x) - PF) / PR, 0, 1));
          const d = nAng(tgt - (a.ang + a.flA));
          if (abs(d) < 1.1) a.flA += clamp(d, -1.8 * dt, 1.8 * dt);
        }
        if (inp.d) { a.gr = Math.min(1, a.gr + dt * 8); a.grT += dt; a.gk = 'd'; }
        else if (inp.u && false) a.gk = 'u';
        else a.gr = Math.max(0, a.gr - dt * 7);
        if (inp.ap) a.lpT = a.at;
        if (a.vy > 0 && a.y >= pipeY(a.x) - 1 && abs(a.x) > PF - 2) this.land(s, a, R);
      } else if (a.st === 'end') {
        a.v *= 1 - 2.5 * dt; a.u += a.v * dt;
        const p2 = pipePt(a.u); a.x = p2[0]; a.y = p2[1]; a.ang = -sgn(a.u) * p2[2];
      }
      const ended = a.hits.length >= PIPE_HITS || a.runT > 32 || (a.runT > 12 && !a.hits.length);
      if (ended && (a.st === 'ride' || a.st === 'fall') && !a.fin) {
        a.st = 'end'; a.fin = true; a.finT = 1.6;
        pop(s, '런 종료', PAL.white, { z: 'l' });
      }
    },
    launch(s, a, R) {
      const sg = sgn(a.u);
      a.st = 'air'; a.at = 0;
      a.x = sg * (PF + PR - 1); a.y = -PR;
      const pop2 = a.t - a.popT < 0.25;
      a.vy = -abs(a.v) * (pop2 ? 1.1 : 1); a.vx = -sg * 16;
      a.fdir = a.f;
      a.ang = -sg * PI / 2; a.flA = 0; a.fl = 0; a.sp = 0; a.spV = 0; a.gr = 0; a.grT = 0; a.top = 0; a.lpT = -9;
      OG.sfx(s, 'jump');
      snowSpray(s, R, a.x, a.y, 10, { spd: 60, ang: -PI / 2, spr: 1.2, life: 0.6 });
      if (pop2) pop(s, '팝!', PAL.green, { z: 'b', x: a.x, y: a.y - 20, w: 1, d: 0.6 });
    },
    land(s, a, R) {
      const sg = sgn(a.x);
      const ph = Math.asin(clamp((abs(a.x) - PF) / PR, 0, 1));
      const spErr = abs(a.sp - Math.round(a.sp / PI) * PI);
      const flTurns = Math.round(abs(a.flA) / TAU);
      const angErr = abs(nAng(a.ang + a.flA - (-sg * ph)));
      const err = Math.max(spErr, angErr * 0.8) + (a.gr > 0.5 ? 0.3 : 0);
      const ld = err > 0.62 ? 0 : err > 0.3 ? 1 : 2;
      const deg = Math.round(abs(a.sp) / PI) * 180;
      const rep = a.hits.some(h => h[0] === deg && h[1] === flTurns && h[4]) ? 1 : 0;
      const hit = [deg, flTurns, a.grT > 0.25 && a.gr < 0.5 ? 1 : 0, r1(a.top), ld, rep];
      a.hits.push(hit);
      a.u = sg * (PF + PR * ph);
      const sp = Math.hypot(a.vx, a.vy) * 0.95;
      a.v = -sg * sp;
      const facing = a.fdir * (C(a.sp) >= 0 ? 1 : -1);
      a.f = facing;
      a.y = pipeY(a.x);
      a.ang = -sg * ph;
      a.ld = ld;
      const nm = (flTurns ? (flTurns > 1 ? '더블 콕 ' : '콕 ') : '') + spinName(deg, a.spD) + (hit[2] ? ' 그랩' : '');
      if (ld === 0) {
        a.st = 'fall'; a.fallT = 0; a.v *= 0.4;
        pop(s, 'CRASH', PAL.red, { z: 'xl' }); OG.sfx(s, 'crash');
        snowSpray(s, R, a.x, a.y, 24, { spd: 120, spr: 2.4, w: 12 });
      } else {
        a.st = 'ride';
        if (a.lpT >= 0 && a.at - a.lpT < 0.45 && ld === 2) pop(s, '클린!', PAL.green, { z: 'b', y: 92, d: 0.9 });
        pop(s, nm, ld === 2 ? (deg >= 1080 ? PAL.gold : PAL.white) : PAL.orange, { z: deg >= 1080 ? 'xl' : 'l', y: 60 });
        OG.sfx(s, 'land'); OG.sfx(s, 'snow');
        snowSpray(s, R, a.x, a.y, 12, { spd: 80, ang: -PI / 2 - sg * 0.6, spr: 1.0 });
      }
    },
    judge(s, a, R) {
      let sum = 0, best = null, bv = -1;
      a.hits.forEach(h => { const v = trickPts(h); sum += v; if (v > bv) { bv = v; best = h; } });
      const base = clamp(10 + sum * 1.3 - a.crash * 6 - Math.max(0, PIPE_HITS - a.hits.length) * 2, 1, 99);
      const js = judges(R, base, 6, 1.4, 0.25, 100), dr = dropMarks(js, 1);
      const sc = keptAvg(js, dr);
      const nm = a.hits.length ? a.hits.length + '히트' + (best && best[4] ? ' · 베스트 ' + (best[1] ? '콕 ' : '') + spinName(best[0], 1).replace('FS ', '') : '') : '노 히트';
      return { sc: sc, nm: nm, js: js, dr: dr, jf: 2, tot: sc.toFixed(2), note: a.crash ? '넘어짐' : '', bad: !!a.crash };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.08);
      let sc = clamp(28 + 66 * q + R.gauss() * 3, 10, 98);
      if (R.chance(0.06 + (1 - q) * 0.2)) sc = R.range(12, 45);
      return { sc: sc, nm: '' };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'air') return '{L}{R} 스핀 {U} 콕(플립) {D} 그랩 {A} 착지 준비';
      return '{D} 내려갈 때 누르고 올라갈 때 떼기: 펌핑 · {A} 립에서 팝';
    },
    cam(s, a) { return [-240, Math.min(-238, a.y - 92)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      nightSky(g, cx, cy, 5, false);
      g.mountains(96 - cy * 0.05 - 238 * 0.05, 60, '#1a2347', 9, 0, '#34446e');
      // far pipe in perspective (vanishing point up the hill)
      const vpx = 240, vpy = 66 - (cy + 238) * 0.25;
      const N = (wx, wy) => [wx - cx, wy - cy];
      const Fp = (p, k) => [vpx + (p[0] - vpx) * k, vpy + (p[1] - vpy) * k];
      const kf = 0.16;
      const pts = [];
      for (let i = 0; i <= 16; i++) { const u = -(PF + PA) + i * (2 * (PF + PA) / 16); const p = pipePt(u); pts.push(N(p[0], p[1])); }
      const deckL = N(-520, -PR), deckR = N(520, -PR);
      // decks (far)
      g.poly([deckL[0], deckL[1]].concat(pts[0], Fp(pts[0], kf), Fp(deckL, kf)), '#8ea3c8');
      g.poly([pts[16][0], pts[16][1]].concat(deckR, Fp(deckR, kf), Fp(pts[16], kf)), '#8ea3c8');
      for (let i = 0; i < 16; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        const mid = (i + 0.5) / 16 - 0.5;
        const lit = 0.55 + 0.45 * (1 - abs(mid) * 2);
        g.poly([p1[0], p1[1], p2[0], p2[1]].concat(Fp(p2, kf), Fp(p1, kf)), OG.mix('#6f86b4', '#dfe9f8', lit));
      }
      // lip lines & far floodlights
      [pts[0], pts[16]].forEach((p, i) => {
        const f2 = Fp(p, kf);
        g.line(p[0], p[1], f2[0], f2[1], '#ffffff', 1);
        for (let k = 0; k < 4; k++) {
          const kk = 0.25 + k * 0.2, q = Fp([p[0] + (i ? 40 : -40), p[1]], kk);
          floodlight(g, q[0], q[1] - 90 * kk, 90 * kk, kk * 1.3, k < 2);
        }
      });
      // far end: the pipe keeps climbing to the start gate
      const far = []; for (let i = 0; i <= 16; i++) far.push.apply(far, Fp(pts[i], kf));
      const fd1 = Fp(deckL, kf), fd2 = Fp(deckR, kf);
      g.poly([fd1[0], fd1[1] - 6].concat(far, [fd2[0], fd2[1] - 6]), '#a9bcdc');
      g.poly(far.concat([vpx + 30, vpy - 12, vpx - 30, vpy - 12]), '#d9e5f6');
      g.rect(vpx - 8, vpy - 22, 16, 10, '#3a4466'); g.rect(vpx - 10, vpy - 24, 20, 3, PAL.red);
      g.rect(vpx - 6, vpy - 20, 12, 4, '#fee761');
      for (let k = 0; k < 5; k++) { const kk = 0.3 + k * 0.14, q1 = Fp(deckL, kk), q2 = Fp(deckR, kk), w = 30 * kk; g.rect(q1[0] + 2, q1[1] - 4 * kk - 2, w, Math.max(1, 3 * kk), k % 2 ? PAL.red : PAL.blue); g.rect(q2[0] - 2 - w, q2[1] - 4 * kk - 2, w, Math.max(1, 3 * kk), k % 2 ? PAL.blue : PAL.red); }
      // near cross-section
      terrain(g, cx, cy, x => (abs(x) > PF + PR ? -PR : pipeY(x)), '#ffffff', '#c4d4ec', '#e8f0fb');
      const lipL = N(-(PF + PR), -PR), lipR = N(PF + PR, -PR);
      g.rect(lipL[0] - 3, lipL[1], 4, 3, '#2a8fd6'); g.rect(lipR[0], lipR[1], 4, 3, '#2a8fd6');
      if (!a) { g.snowfall(g.t, 60); return; }
      const e = curEnt(s), look = snowLook(e, 'board');
      const bcol = e ? lookOf(e).shirt : PAL.red;
      const bo = { len: 8.5, off: 1.5, col: OG.shade(bcol, -0.1), edge: '#181425', th: 3, nose: true };
      const X = a.x - cx, Y = a.y - cy;
      if (a.st === 'drop') {
        const J = fig(g, X - 10, Y, boarderPose(0.3), look, { anchor: 'feet' });
        board(g, J, bo);
      } else if (a.st === 'air') {
        spinArcs(g, X, Y - 4, a.spV, 28, g.t);
        const J = fig(g, X, Y, boarderPose(0.6, a.gr, a.gk), look, { f: a.fdir, rot: a.fdir * (a.ang + a.flA), sq: C(a.sp), anchor: 'com' });
        board(g, J, bo);
        const deg = Math.floor(abs(a.sp) / PI + 0.1) * 180;
        if (deg) g.text(String(deg), X + 30, Y - 34, PAL.yellow, { size: 'b', outline: PAL.black });
      } else if (a.st === 'fall') {
        const J = fig(g, X, Y - 6, POSE.fallen(), look, { rot: a.ang + a.fallT * 3, anchor: 'com' });
        board(g, J, bo);
      } else {
        const J = fig(g, X, Y, a.st === 'end' && abs(a.v) < 40 ? POSE.celebrate(g.t % 1) : boarderPose(a.pk), look, { f: a.f, rot: a.f * a.ang, anchor: 'feet' });
        board(g, J, bo);
      }
      fxDraw(g, s, cx, cy);
      g.snowfall(g.t, 50);
      if (s.ph === 'board' || s.ph === 'end') return;
      // HUD
      g.rect(4, 30, 104, 36, 'rgba(24,20,37,0.75)');
      g.text('히트 ' + a.hits.length + '/' + PIPE_HITS, 9, 33, PAL.white, { size: 's' });
      const spd = a.st === 'air' ? Math.hypot(a.vx, a.vy) : abs(a.v);
      g.text('속도', 9, 47, PAL.lightgrey, { size: 'xs' });
      g.bar(32, 47, 70, 7, spd / 420, spd > 360 ? PAL.green : spd > 280 ? PAL.yellow : PAL.orange);
      g.text('남은 ' + Math.max(0, 32 - a.runT).toFixed(0) + 's', 9, 57, PAL.grey, { size: 'xs' });
      let tx = 116;
      a.hits.forEach((h, i) => { const ok = h[4]; g.rect(tx + i * 12, 34, 10, 10, ok === 2 ? PAL.green : ok === 1 ? PAL.orange : PAL.red); });
    }
  };

  /* ============================================================== BIG AIR */
  const BA_PTS = [[-1200, -470], [-900, -470], [-300, -62], [-250, -31], [-200, -11], [-150, -2], [-110, 0], [-80, -4], [-50, -14], [-22, -29], [0, -42], [6, -20], [205, -20], [760, 344], [820, 378], [900, 396], [1000, 400], [1800, 400]];
  const BAG = 270;
  function baY(x) {
    const P = BA_PTS;
    if (x <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) if (x <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    return P[P.length - 1][1];
  }
  const baA = x => Math.atan2(baY(x + 3) - baY(x - 3), 6);
  const BA_SP = [0, 30, 40, 48, 56, 63, 72, 78, 85, 90, 95, 98];
  function baCork(deg) { return deg >= 1800 ? '쿼드콕 ' : deg >= 1440 ? '트리플콕 ' : deg >= 1080 ? '더블콕 ' : deg >= 720 ? '콕 ' : ''; }
  KIND.bigair = {
    attW: '차 점프',
    init(s, e, R) {
      return { e: e.idx, st: 'top', t: 0, x: -960, y: -470, v: 0, vx: 0, vy: 0, tuck: 0, q: 0, pr: 0, sp: 0, spV: 0, spD: 1, gr: 0, grT: 0, gk: 'd', grMax: 0, ang: 0, lpT: -9, at: 0, land: '', zone: '', lt: 0, fin: false, finT: 2.2, lipV: 0 };
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'top') {
        if (inp.ap || a.t > 2.2) { a.st = 'in'; a.t = 0; a.v = 20; OG.sfx(s, 'whoosh'); }
      } else if (a.st === 'in') {
        const ang = baA(a.x);
        a.tuck = appr(a.tuck, inp.d && a.x < -300 ? 1 : 0, dt * 5);
        if (a.x < -300) { const vt = 290 + 120 * a.tuck; a.v += (vt - a.v) * 0.85 * dt; }
        else a.v -= (BAG * S(-ang) + 12) * dt;
        a.v = Math.max(30, a.v);
        a.x += a.v * C(ang) * dt; a.y = baY(a.x);
        if (inp.ap && a.x > -60 && !a.pr) { a.pr = 1; a.q = clamp(1 - abs(a.x + 18) / 40, 0, 1); }
        if (R.chance(0.3)) snowSpray(s, R, a.x - 8, a.y, 1, { spd: 30, ang: -PI * 0.8, spr: 0.6, life: 0.4 });
        if (a.x >= 0) {
          const la = baA(-6);
          a.st = 'air'; a.at = 0; a.lipV = a.v;
          a.vx = a.v * C(la); a.vy = a.v * S(la) - 55 * a.q; a.y = -42 - 22;
          a.ang = la;
          OG.sfx(s, 'jump');
          snowSpray(s, R, 0, -42, 12, { spd: 80, ang: -PI * 0.3, spr: 0.8 });
          if (a.pr && a.q > 0.8) pop(s, '빅 팝!', PAL.green, { z: 'l', y: 40 }); else if (!a.pr || a.q < 0.3) pop(s, '팝 타이밍 X', PAL.orange, { z: 'l', y: 40 });
        }
      } else if (a.st === 'air') {
        a.at += dt;
        a.vy += BAG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        if (inp.l || inp.r) { a.spV = appr(a.spV, (inp.r ? 1 : -1) * 2.4 * TAU, 40 * dt); a.spD = inp.r ? 1 : -1; }
        else { a.spV = appr(a.spV, 0, 150 * dt); const near = Math.round(a.sp / PI) * PI; if (abs(near - a.sp) < 0.75) a.sp = appr(a.sp, near, 4 * dt); }
        a.sp += a.spV * dt;
        if (inp.d || inp.u) { a.gr = Math.min(1, a.gr + dt * 8); a.grT += dt; a.gk = inp.d ? 'd' : 'u'; a.grMax = Math.max(a.grMax, a.grT); }
        else a.gr = Math.max(0, a.gr - dt * 7);
        if (inp.ap) a.lpT = a.at;
        const tgt = baA(Math.max(220, a.x + 60)) * 0.8;
        a.ang += clamp(tgt - a.ang, -1.2 * dt, 1.2 * dt);
        if (a.vy > 0 && a.y + 22 >= baY(a.x)) this.land(s, a, R);
      } else if (a.st === 'ride') {
        a.lt += dt;
        const ang = baA(a.x);
        if (a.land === 'crash') a.v = Math.max(0, a.v - 120 * dt); else a.v = Math.max(0, a.v + (S(ang) * 160 - (a.x > 820 ? 140 : 20)) * dt);
        a.x += a.v * C(ang) * dt; a.y = baY(a.x);
        if (a.v > 30 && R.chance(0.4)) snowSpray(s, R, a.x - 6, a.y, 1, { spd: 40, ang: -PI * 0.75, spr: 0.8, life: 0.5 });
      }
    },
    land(s, a, R) {
      const spErr = abs(a.sp - Math.round(a.sp / PI) * PI);
      const err = spErr + (a.gr > 0.5 ? 0.35 : 0);
      a.zone = a.x < 215 ? 'knuckle' : a.x > 740 ? 'flat' : a.x < 300 ? 'short' : 'sweet';
      a.land = err > 0.6 ? 'crash' : err > 0.3 ? 'sketchy' : (a.zone === 'knuckle' || a.zone === 'flat') ? 'hard' : 'clean';
      if ((a.zone === 'knuckle' || a.zone === 'flat') && err > 0.35) a.land = 'crash';
      a.deg = Math.round(abs(a.sp) / PI) * 180;
      a.st = 'ride'; a.lt = 0; a.fin = true; a.finT = 2.4;
      a.v = Math.hypot(a.vx, a.vy) * (a.land === 'crash' ? 0.5 : 0.8); a.y = baY(a.x);
      snowSpray(s, R, a.x, a.y, a.land === 'crash' ? 30 : 16, { spd: a.land === 'crash' ? 140 : 90, ang: -PI * 0.65, spr: 1.4, w: 14 });
      OG.sfx(s, a.land === 'crash' ? 'crash' : 'land'); OG.sfx(s, 'snow');
      const L = { clean: ['클린 랜딩!', PAL.green], sketchy: ['불안한 착지', PAL.orange], hard: [a.zone === 'flat' ? '오버슈트!' : '너클 착지', PAL.orange], crash: ['CRASH', PAL.red] }[a.land];
      pop(s, L[0], L[1], { z: 'l', y: 92 });
      if (a.land !== 'crash' && a.deg) pop(s, baCork(a.deg) + a.deg + '!', a.deg >= 1440 ? PAL.gold : PAL.white, { z: 'xxl', y: 54, d: 1.9 });
      if (a.land === 'clean' && a.deg >= 1080) OG.sfx(s, 'cheer');
    },
    judge(s, a, R) {
      let b = BA_SP[Math.min(11, Math.round(a.deg / 180))];
      const grab = a.grMax >= 0.35 && a.land !== 'crash';
      if (grab) b += 2.5 + Math.min(3.5, (a.grMax - 0.35) * 6);
      if (a.land === 'sketchy') b -= 16; else if (a.land === 'hard') b -= 9;
      if (a.zone === 'short' && a.land !== 'crash') b -= 3;
      b -= (1 - a.q) * 3;
      if (a.land === 'crash') b = Math.min(b, 8 + a.deg / 180 * 1.5);
      const js = judges(R, clamp(b, 1, 99), 6, 1.3, 0.25, 100), dr = dropMarks(js, 1);
      const sc = keptAvg(js, dr);
      const nm = (a.deg ? (a.spD < 0 ? 'BS ' : 'FS ') + baCork(a.deg) + a.deg : '스트레이트 에어') + (grab ? (a.gk === 'u' ? ' 메소드' : ' 인디') + ' 그랩' : '');
      return { sc: sc, nm: nm, js: js, dr: dr, jf: 2, tot: sc.toFixed(2), note: { clean: '클린', sketchy: '불안', hard: '하드 랜딩', crash: 'CRASH' }[a.land], bad: a.land !== 'clean' };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.09);
      const k = clamp(Math.round(4 + q * 6.5 + R.gauss() * 0.7), 2, 11);
      let sc = clamp(BA_SP[k] + 3 + R.gauss() * 2.2, 15, 99);
      if (R.chance(0.08 + (1 - q) * 0.25)) sc = R.range(10, 30);
      return { sc: sc, nm: baCork(k * 180) + k * 180 };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'top') return '{A} 드롭 인';
      if (a.st === 'in') return a.x < -300 ? '{D} 웅크려 가속 (초록 구간에 맞추기)' : '{A} 립에서 팝!';
      if (a.st === 'air') return '{L}{R} 스핀 (1080·1440…) {D}{U} 그랩 · 착지 전 놓기';
      return '';
    },
    cam(s, a) { return [a.x - 190, a.y - (a.st === 'ride' && a.x > 700 ? 185 : 150)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      nightSky(g, cx, cy, 21, false);
      // city skyline (parallax)
      const sy = 200 - cy * 0.06 - 20;
      for (let i = 0; i < 40; i++) {
        const w = 14 + H(i, 7, 1) * 22, h = 20 + H(i, 7, 2) * 70;
        const x = M.wrap(i * 26 - cx * 0.08, 1040) - 60;
        if (x > 480) continue;
        g.rect(x, sy - h, w, h + 200, '#141a36');
        for (let wy = sy - h + 4; wy < sy; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (H(Math.floor(wx), Math.floor(wy), i) > 0.62) g.px(wx, wy, H(i, wy, 3) > 0.5 ? '#feae34' : '#fee761');
      }
      const tvx = M.wrap(300 - cx * 0.08, 1040) - 60;
      g.rect(tvx, sy - 120, 4, 120, '#262b44'); g.rect(tvx - 6, sy - 96, 16, 6, '#3a4466'); g.px(tvx + 1, sy - 124, PAL.red);
      // fireworks after a big landing
      if (a && a.st === 'ride' && a.land === 'clean' && a.lt < 2.4) {
        for (let k = 0; k < 3; k++) {
          const t0 = (a.lt - k * 0.5); if (t0 < 0) continue;
          const fx0 = 120 + k * 120, fy0 = 60 + (k % 2) * 20, r = t0 * 40;
          const cols = [PAL.gold, PAL.red, PAL.cyan];
          g.alpha(Math.max(0, 1 - t0 / 1.4));
          for (let i = 0; i < 14; i++) { const an = i / 14 * TAU; g.rect(fx0 + C(an) * r, fy0 + S(an) * r + t0 * t0 * 8, 2, 2, cols[k]); }
          g.alpha(1);
        }
      }
      // scaffold under the ramp
      for (let x = -1180; x < 260; x += 28) {
        const X = x - cx; if (X < -30 || X > 510) continue;
        const top = baY(x) - cy;
        g.rect(X, top, 2, 500, '#3a4466');
        for (let y = top + 10; y < 300; y += 28) { g.line(X, y, X + 28, y + 28, '#2b3252', 1); g.rect(X, y, 28, 1, '#2b3252'); }
      }
      // floodlights
      [-700, -200, 400, 900].forEach(x => { const X = x - cx, Y = baY(x) - cy; if (X > -40 && X < 520) { floodlight(g, X, Y - 170, 170, 1.2); lightCone(g, X, Y - 170, X + 40, Y + 20, 80, 0.04); } });
      // ramp surface
      for (let x = 0; x < 480; x += 2) {
        const wx = x + cx, y = Math.round(baY(wx) - cy);
        if (y > 270) continue;
        const onStruct = wx < 6;
        g.rect(x, y, 2, onStruct ? 8 : 280, onStruct ? '#dfe9f8' : '#c4d4ec');
        g.rect(x, y, 2, 2, '#ffffff');
        if (onStruct) g.rect(x, y + 8, 2, 3, '#5a6988');
      }
      // kicker sides & knuckle markings
      g.rect(-cx - 1, -42 - cy, 3, 22, '#9fb2d0');
      for (let x = 210; x < 760; x += 40) { const X = x - cx; if (X > -4 && X < 484) g.rect(X, baY(x) - cy + 1, 3, 2, x > 300 && x < 740 ? '#63c74d' : '#e43b44'); }
      // outrun: dye lines + painted logo + finish arch
      for (let x = 900; x < 1700; x += 3) { const X = x - cx; if (X < -3 || X > 483) continue; g.rect(X, 400 - cy + 14 + ((x / 3) % 2), 3, 1, (Math.floor(x / 90) % 2) ? '#e43b44' : '#2a8fd6'); }
      if (1150 - cx < 520 && 1150 - cx > -200) { g.alpha(0.5); g.text('AICHI-NAGOYA', 1150 - cx, 400 - cy + 24, '#2a8fd6', { size: 'xl', align: 'center' }); g.alpha(1); }
      { const fx2 = 1320 - cx, fy2 = 400 - cy; if (fx2 > -80 && fx2 < 560) { g.rect(fx2 - 50, fy2 - 48, 4, 48, '#c0cbdc'); g.rect(fx2 + 46, fy2 - 48, 4, 48, '#c0cbdc'); g.rect(fx2 - 52, fy2 - 56, 104, 12, '#e43b44'); g.text('FINISH', fx2, fy2 - 54, '#ffffff', { size: 's', align: 'center' }); } }
      // crowd at the bottom
      const bx = 860 - cx, by = 400 - cy;
      if (bx < 480 && by < 300) { g.crowd(bx, by - 30, 420, 26, g.t, { seed: 6, excite: a && a.st === 'ride' ? 0.6 : 0.15, bg: '#1d2546' }); g.adBoards(bx, by - 6, 420, 8, g.t, ['BIG AIR', 'DOT GAMES 2026', 'SEND IT!']); }
      if (!a) { g.snowfall(g.t, 50); return; }
      const e = curEnt(s), look = snowLook(e, 'board');
      const bcol = e ? lookOf(e).shirt : PAL.red;
      const bo = { len: 8.5, off: 1.5, col: OG.shade(bcol, -0.1), edge: '#181425', th: 3, nose: true };
      const X = a.x - cx, Y = a.y - cy;
      if (a.st === 'top' || a.st === 'in') {
        const J = fig(g, X, Y, boarderPose(a.tuck), look, { rot: baA(a.x), anchor: 'feet' });
        board(g, J, bo);
        if (a.st === 'in' && a.x < -280) {
          g.text('속도', 9, 32, PAL.white, { size: 'xs', outline: PAL.black });
          const bx2 = 36, bw = 110;
          const inB = a.v >= 292 && a.v <= 322;
          g.bar(bx2, 32, bw, 8, (a.v - 200) / 200, a.v > 322 ? PAL.red : inB ? PAL.green : PAL.cyan);
          g.rect(bx2 + Math.round((292 - 200) / 200 * bw), 30, Math.round(30 / 200 * bw), 2, PAL.green);
          g.rect(bx2 + Math.round((292 - 200) / 200 * bw), 40, Math.round(30 / 200 * bw), 2, PAL.green);
          g.text(Math.round(a.v / 26 * 3.6) + 'km/h', bx2 + bw + 4, 31, PAL.white, { size: 'xs', outline: PAL.black });
        }
      } else if (a.st === 'air') {
        spinArcs(g, X, Y, a.spV, 28, g.t);
        const cork = abs(a.spV) > 6 ? S(a.sp * 0.5) * 0.55 : 0;
        const J = fig(g, X, Y, boarderPose(0.5, a.gr, a.gk), look, { rot: a.ang + cork, sq: C(a.sp), anchor: 'com' });
        board(g, J, bo);
        const deg = Math.floor(abs(a.sp) / PI + 0.1) * 180;
        if (deg) g.text(String(deg), X + 30, Y - 36, PAL.yellow, { size: 'l', outline: PAL.black });
      } else {
        const ang = baA(a.x);
        if (a.land === 'crash') { const J = fig(g, X, Y - 4, POSE.fallen(), look, { rot: ang + a.lt * 4, anchor: 'com' }); board(g, J, bo); }
        else { const J = fig(g, X, Y, a.v < 30 ? POSE.celebrate(g.t % 1) : boarderPose(0.2), look, { rot: ang, sq: C(a.sp), anchor: 'feet' }); board(g, J, bo); }
      }
      fxDraw(g, s, cx, cy);
      g.snowfall(g.t, 40);
    }
  };

  /* ================================================================ BMX ===
   * Side-scrolling park, 5 jump boxes. ◀▶ alternate = pedal on the ground.
   * ACTION at the lip = pop. In the air: ▼ backflip, ◀ tailwhip, ▶ barspin,
   * ▲ superman. Every trick must be finished and the bike lined up with
   * the landing ramp. */
  const BM_F = [[430, 46, 60, 70, 170], [1000, 58, 70, 90, 190], [1640, 52, 64, 100, 180], [2300, 66, 76, 100, 210], [3000, 60, 70, 80, 190]];
  const BM_END = 3560, BMG = 420, BWR = 9;
  function bmY(x) {
    for (const F of BM_F) {
      const x0 = F[0], h = F[1], up = F[2], dk = F[3], dn = F[4];
      if (x < x0 || x > x0 + up + dk + dn) continue;
      if (x <= x0 + up) return -h * Math.pow((x - x0) / up, 1.4);
      if (x <= x0 + up + dk) return -h;
      return -h + h * (x - x0 - up - dk) / dn;
    }
    return 0;
  }
  const bmA = x => Math.atan2(bmY(x + 2) - bmY(x - 2), 4);
  function bmFeat(x) { for (let i = 0; i < BM_F.length; i++) { const F = BM_F[i]; if (x >= F[0] - 60 && x <= F[0] + F[2] + F[3] + F[4] + 10) return i; } return -1; }
  function drawBike(g, X, Y, ang, f, o) {
    o = o || {};
    const cr = C(ang), sr = S(ang);
    const B = (lx, ly) => [X + (lx * cr - ly * sr) * f, Y + (lx * sr + ly * cr)];
    const cw = C(o.wh || 0);
    const Fx = lx => 13 + (lx - 13) * cw;
    const ea = Math.atan2(sr, cr * f);
    const fc = o.col || PAL.red, tc = '#262b44';
    const L = (p, q, c, t) => g.line(p[0], p[1], q[0], q[1], c, t || 2);
    const rw = B(Fx(-16), 0), fw = B(16, 0);
    ringE(g, rw[0], rw[1], 9 * Math.max(0.15, abs(cw)), 9, ea, tc, 2);
    const spin = o.sp || 0;
    for (let k = 0; k < 3; k++) {
      const a2 = spin + k * PI / 3;
      const d1 = [C(a2) * 7, S(a2) * 7];
      g.line(fw[0] - d1[0], fw[1] - d1[1], fw[0] + d1[0], fw[1] + d1[1], '#8b9bb4', 1);
      if (abs(cw) > 0.6) g.line(rw[0] - d1[0] * cw, rw[1] - d1[1], rw[0] + d1[0] * cw, rw[1] + d1[1], '#8b9bb4', 1);
    }
    ringE(g, fw[0], fw[1], 9, 9, ea, tc, 2);
    g.rect(fw[0] - 1, fw[1] - 1, 3, 3, '#c0cbdc'); g.rect(rw[0] - 1, rw[1] - 1, 3, 3, '#c0cbdc');
    const bb = B(Fx(-1), 2), seat = B(Fx(-8), -11), tt = B(Fx(-6), -9), ht = B(12, -10), hb = B(14, -4);
    L(rw, bb, fc); L(bb, seat, fc); L(tt, ht, fc); L(bb, hb, fc, 3); L(rw, tt, fc, 1);
    L(ht, hb, OG.shade(fc, -0.3), 3);
    L(hb, fw, '#c0cbdc', 2);
    g.line(seat[0] - 3 * f * cw, seat[1], seat[0] + 2 * f * cw, seat[1], '#181425', 2);
    const bt = B(11, -19);
    L(ht, bt, '#c0cbdc', 2);
    const bsc = C(o.bs || 0);
    const b1 = B(11 - 4 * bsc, -19), b2 = B(11 + 3 * bsc, -20);
    L(b1, b2, '#c0cbdc', 2);
    g.rect(b1[0] - 1, b1[1] - 1, 3, 3, '#181425');
    const ca = o.cr || 0;
    const p1 = B(Fx(-1) + C(ca) * 5, 2 + S(ca) * 5), p2 = B(Fx(-1) - C(ca) * 5, 2 - S(ca) * 5);
    L(bb, p1, '#5a6988', 1); L(bb, p2, '#5a6988', 1);
    g.circle(bb[0], bb[1], 2, '#5a6988');
    return { bars: bt, p1: p1, p2: p2, seat: seat, B: B };
  }
  const P_BMX = { t: 0.95, aL: 0.95, aR: 0.85, eL: 0.35, eR: 0.4, lL: 0.75, lR: 0.2, kL: 1.15, kR: 0.7 };
  const P_BMX_SM = { t: 1.45, aL: 0.75, aR: 0.7, eL: 0.1, eR: 0.15, lL: -1.2, lR: -1.35, kL: 0.1, kR: 0.05 };
  const P_BMX_OFF = { t: 0.6, aL: 2.2, aR: 1.9, eL: 0.3, eR: 0.3, lL: 0.9, lR: -0.1, kL: 1.3, kR: 0.9 };
  // 2-bone IK in figure-local units; angles from "down" towards +x (figure convention)
  function ik2(bx, by, tx, ty, l1, l2, bend) {
    const dx = tx - bx, dy = ty - by, d = clamp(Math.hypot(dx, dy), 0.5, l1 + l2 - 0.05);
    const base = Math.atan2(dx, dy);
    const off = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const a1 = base + bend * off;
    const jx = bx + S(a1) * l1, jy = by + C(a1) * l1;
    return [a1, Math.atan2(tx - jx, ty - jy)];
  }
  function bmxRider(g, bk, look, ang, o) {
    const sm = o.sm || 0, off = o.off || 0;
    const H = [-5 + sm * 3, -16 - sm * 3];
    const t = 0.85 + sm * 0.55;
    const toL = p => [(p[0] - H[0]) / 2, (p[1] - H[1]) / 2];
    const sh = [S(t) * SEG.to * 0.92, -C(t) * SEG.to * 0.92];
    const grip = toL([11 - 3 * C(o.bs || 0), -19]);
    const pose = { t: t, aL: 0, aR: 0, eL: 0, eR: 0, lL: 0, lR: 0, kL: 0, kR: 0 };
    if (off < 0.5 || (o.bs && !o.wh)) {
      const aa = ik2(sh[0], sh[1], grip[0], grip[1], SEG.ua, SEG.fa, -1);
      pose.aR = aa[0] - t; pose.eR = aa[1] - aa[0];
      const ab = ik2(sh[0], sh[1], grip[0] - 0.6, grip[1] + 0.3, SEG.ua, SEG.fa, -1);
      pose.aL = ab[0] - t; pose.eL = ab[1] - ab[0];
    }
    if (o.bs && off > 0.3) { pose.aR = 1.9; pose.eR = 0.3; pose.aL = 2.2; pose.eL = 0.2; }
    const ca = o.cr || 0;
    const f1 = toL([-1 + C(ca) * 5, 2 + S(ca) * 5]), f2 = toL([-1 - C(ca) * 5, 2 - S(ca) * 5]);
    if (sm > 0.05) { pose.lL = -1.15 * sm + (1 - sm) * 0.6; pose.lR = -1.3 * sm + (1 - sm) * 0.4; pose.kL = 0.1; pose.kR = 0.05; }
    if (sm < 0.95) {
      const l1 = ik2(0, 0, f1[0], f1[1], SEG.th, SEG.sh, 1), l2 = ik2(0, 0, f2[0], f2[1], SEG.th, SEG.sh, 1);
      const k = 1 - sm;
      pose.lL = lerp(pose.lL, l1[0], k); pose.kL = lerp(pose.kL, l1[0] - l1[1], k);
      pose.lR = lerp(pose.lR, l2[0], k); pose.kR = lerp(pose.kR, l2[0] - l2[1], k);
    }
    if (o.wh && off > 0.3) { pose.lL = 1.6; pose.kL = 1.2; pose.lR = 1.2; pose.kR = 1.4; }
    const hp = bk.B(H[0], H[1]);
    return fig(g, hp[0], hp[1], pose, look, { rot: ang, anchor: 'hip' });
  }
  function bmxLook(e) { const L = lookOf(e); return { shirt: L.shirt, pants: L.pants, skin: L.skin, hair: L.hair, cap: L.shirt, visor: '#181425', sleeves: true, tights: true, shoe: '#181425' }; }
  function bmxTrick(t) { // t: [flips, whips, bars, superman]
    const parts = [];
    if (t[0]) parts.push(t[0] > 1 ? '더블 백플립' : '백플립');
    if (t[1]) parts.push(t[1] > 1 ? '더블 테일윕' : '테일윕');
    if (t[2]) parts.push(t[2] > 1 ? '더블 바스핀' : '바스핀');
    if (t[3]) parts.push('슈퍼맨');
    return parts.length ? parts.join(' + ') : '에어';
  }
  function bmxPts(t) {
    let v = t[0] * 6 + (t[0] > 1 ? 2 : 0) + t[1] * 3.2 + t[2] * 2 + (t[3] ? 2.2 : 0);
    const n = (t[0] ? 1 : 0) + (t[1] ? 1 : 0) + (t[2] ? 1 : 0) + (t[3] ? 1 : 0);
    if (!n) v = 0.8;
    v *= 1 + 0.15 * Math.max(0, n - 1);
    return v;
  }
  KIND.bmx = {
    att1: 2, attW: '차 런',
    init(s, e, R) {
      return { e: e.idx, st: 'ride', t: 0, x: 40, y: -BWR, v: 120, last: '', idle: 0, ang: 0, vx: 0, vy: 0, pr: 0, q: 0, fl: 0, wq: 0, wh: 0, bq: 0, bs: 0, sm: 0, smT: 0, top: 0, ly: 0, at: 0, tricks: [], crash: 0, cT: 0, fin: false, finT: 1.8, cr: 0, sp: 0, feat: -1, pts: 0, rot: 0, tr: [], tc: 0 };
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'ride') {
        let pressed = false;
        if (inp.lp && a.last !== 'l') { a.v += 12; a.last = 'l'; pressed = true; }
        if (inp.rp && a.last !== 'r') { a.v += 12; a.last = 'r'; pressed = true; }
        a.idle = pressed ? 0 : a.idle + dt;
        const ang = bmA(a.x);
        a.v += (S(ang) * 300 - (a.v - 225) * (a.idle > 0.6 ? 0.8 : 0.4)) * dt;
        a.v = clamp(a.v, 120, 268);
        a.x += a.v * C(ang) * dt; a.y = bmY(a.x) - BWR; a.ang = ang;
        a.cr += a.v * dt * 0.08; a.sp += a.v * dt / BWR;
        const fi = bmFeat(a.x);
        if (fi >= 0) {
          const F = BM_F[fi], lip = F[0] + F[2];
          if (inp.ap && !a.pr && a.x > lip - 40 && a.x < lip) { a.pr = 1; a.q = clamp(1 - abs(a.x - (lip - 12)) / 28, 0, 1); }
          if (a.x >= lip - 1 && a.x < lip + 8 && a.feat !== fi) this.launch(s, a, R, fi);
        }
        if (a.x > BM_END && !a.fin) { a.st = 'end'; a.fin = true; pop(s, '런 종료', PAL.white, { z: 'l' }); OG.sfx(s, 'whistle'); }
      } else if (a.st === 'air') {
        a.at += dt;
        a.vy += BMG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        a.top = Math.max(a.top, a.ly - a.y);
        if (inp.d) { a.ang -= 1.55 * TAU * dt; a.fl += 1.55 * TAU * dt; }
        else {
          const tgt = Math.max(bmA(a.x + 30), 0.05);
          const d = nAng(tgt - a.ang);
          if (abs(d) < 1.2) a.ang += clamp(d, -1.6 * dt, 1.6 * dt);
        }
        if (inp.lp && a.wq < 2) { a.wq++; OG.sfx(s, 'whoosh'); }
        if (inp.rp && a.bq < 2) { a.bq++; OG.sfx(s, 'swing'); }
        a.wh = appr(a.wh, a.wq * TAU, 2.5 * TAU * dt);
        a.bs = appr(a.bs, a.bq * TAU, 3.4 * TAU * dt);
        if (inp.u) { a.sm = Math.min(1, a.sm + dt * 6); a.smT += dt; } else a.sm = Math.max(0, a.sm - dt * 7);
        a.sp += 6 * dt;
        a.rot = a.ang; trail(a, a.x, a.y, 4);
        if (a.vy > 0 && a.y + BWR >= bmY(a.x)) this.land(s, a, R);
      } else if (a.st === 'crash') {
        a.cT += dt;
        a.v = Math.max(0, a.v - 260 * dt);
        a.x += a.v * dt; a.y = bmY(a.x) - BWR;
        if (a.cT > 1.4) {
          const F = BM_F[Math.max(0, a.feat)];
          a.st = 'ride'; a.x = Math.max(a.x, F[0] + F[2] + F[3] + F[4] + 30); a.y = -BWR; a.v = 200; a.ang = 0;
        }
      } else if (a.st === 'end') {
        a.v = Math.max(0, a.v - 200 * dt); a.x += a.v * dt; a.y = bmY(a.x) - BWR; a.sp += a.v * dt / BWR;
      }
      if (!a.fin && a.t > 42) { a.st = 'end'; a.fin = true; }
    },
    launch(s, a, R, fi) {
      const F = BM_F[fi];
      const la = bmA(F[0] + F[2] - 3);
      a.feat = fi; a.st = 'air'; a.at = 0;
      a.vx = a.v * C(la); a.vy = a.v * S(la) - 48 * a.q; a.ang = la; a.ly = a.y;
      a.fl = 0; a.wq = 0; a.wh = 0; a.bq = 0; a.bs = 0; a.sm = 0; a.smT = 0; a.top = 0; a.tr = []; a.tc = 0;
      OG.sfx(s, 'jump');
      if (a.pr && a.q > 0.8) pop(s, '팝!', PAL.green, { z: 'b', x: a.x, y: a.y - 30, w: 1, d: 0.6 });
      a.pr = 0;
    },
    land(s, a, R) {
      const F = BM_F[a.feat];
      const deckEnd = F[0] + F[2] + F[3], slopeEnd = deckEnd + F[4];
      const tgt = bmA(a.x);
      const err = abs(nAng(a.ang - tgt));
      const left = Math.max(0, a.wq * TAU - a.wh) + Math.max(0, a.bq * TAU - a.bs);
      const flips = Math.round(a.fl / TAU);
      const t = [flips, a.wq, a.bq, a.smT > 0.3 ? 1 : 0];
      let ld = err < 0.3 ? 2 : err < 0.6 ? 1 : 0;
      if (left > 0.5 || a.sm > 0.45) ld = 0;
      const zone = a.x < deckEnd - 4 ? 'case' : a.x > slopeEnd + 10 ? 'flat' : 'ok';
      if (zone !== 'ok' && ld === 2) ld = 1;
      a.y = bmY(a.x) - BWR; a.le = r2(err); a.lz = zone;
      if (ld === 0) {
        a.st = 'crash'; a.cT = 0; a.crash++; a.v = Math.hypot(a.vx, a.vy) * 0.5;
        pop(s, 'CRASH', PAL.red, { z: 'xl' }); OG.sfx(s, 'crash');
        fx(s, R, a.x, bmY(a.x), 20, { c: [4, 15, 9], spd: 100, spr: 2.4, gr: 300, life: 0.8, w: 10 });
        a.tricks.push([t[0], t[1], t[2], t[3], 0, r1(a.top), 0]);
        return;
      }
      const rep = a.tricks.some(k => k[0] === t[0] && k[1] === t[1] && k[2] === t[2] && k[3] === t[3] && k[4]) ? 1 : 0;
      a.tricks.push([t[0], t[1], t[2], t[3], ld, r1(a.top), rep]);
      a.st = 'ride'; a.v = clamp(Math.hypot(a.vx, a.vy) * 0.95, 160, 300); a.ang = tgt;
      fx(s, R, a.x, bmY(a.x), 8, { c: [4, 15], spd: 50, spr: 2.2, gr: 260, life: 0.5, w: 16 });
      OG.sfx(s, 'land');
      pop(s, bmxTrick(t), ld === 2 ? (bmxPts(t) > 9 ? PAL.gold : PAL.white) : PAL.orange, { z: bmxPts(t) > 9 ? 'xl' : 'l', y: 58 });
      if (zone === 'case') pop(s, '케이스!', PAL.orange, { z: 'b', y: 86, d: 0.9 });
      if (zone === 'flat') pop(s, '오버슈트!', PAL.orange, { z: 'b', y: 86, d: 0.9 });
      if (ld === 2 && bmxPts(t) > 9) OG.sfx(s, 'cheer');
    },
    judge(s, a, R) {
      let sum = 0, best = null, bv = -1;
      a.tricks.forEach(k => {
        if (!k[4]) return;
        let v = bmxPts(k) + clamp(k[5] / 26, 0, 4) * 0.6;
        if (k[4] === 1) v *= 0.6;
        if (k[6]) v *= 0.75;
        sum += v; if (v > bv) { bv = v; best = k; }
      });
      const base = clamp(14 + sum * 1.25 - a.crash * 9 - (5 - a.tricks.length) * 4, 1, 99);
      const js = judges(R, base, 5, 1.3, 0.25, 100), dr = dropMarks(js, 1);
      const sc = keptAvg(js, dr);
      return { sc: sc, nm: a.tricks.filter(k => k[4]).length + '/' + BM_F.length + ' 성공' + (best ? ' · 베스트 ' + bmxTrick(best) : ''), js: js, dr: dr, jf: 2, tot: sc.toFixed(2), note: a.crash ? '크래시 ' + a.crash : '', bad: !!a.crash };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.08);
      let sc = clamp(30 + 63 * q + R.gauss() * 2.8, 12, 97);
      if (R.chance(0.05 + (1 - q) * 0.2)) sc = R.range(20, 50);
      return { sc: sc, nm: '' };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'air') return '{D} 백플립 {L} 테일윕 {R} 바스핀 {U} 슈퍼맨 · 착지 전 마무리';
      return '{L}{R} 번갈아: 페달  {A} 램프 끝에서 팝!';
    },
    cam(s, a) { return [a.x - 170, Math.min(-200, a.y - 150)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      g.grad(0, 0, 480, 270, '#3d8fe0', '#bfe6ff', 10);
      g.clouds(g.t, 20, 4);
      g.mountains(150 - cy * 0.1 - 20, 40, '#7fb0d8', 4, cx * 0.1);
      g.mountains(170 - cy * 0.15 - 30, 40, '#5f9a6a', 8, cx * 0.2);
      g.trees(200 - cy * 0.25 - 50, '#3e7a48', 6, cx * 0.3, 12);
      // fence + crowd + banners (parallax .6)
      const fy = 180 - (cy + 200) * 0.6;
      const ox = cx * 0.6;
      g.crowd(0, fy - 40, 480, 34, g.t, { ox: ox, seed: 12, excite: a && a.st === 'air' ? 0.4 : 0.1, bg: '#4a5a7a' });
      for (let x = -M.wrap(ox, 10); x < 480; x += 10) g.rect(x, fy - 6, 1, 26, '#8b9bb4');
      g.rect(0, fy - 6, 480, 1, '#c0cbdc'); g.rect(0, fy + 6, 480, 1, '#8b9bb4');
      for (let i = -1; i < 5; i++) { const bx = i * 130 - M.wrap(ox, 130); g.rect(bx + 6, fy - 4, 100, 10, i % 2 ? '#e43b44' : '#124e89'); g.text(i % 2 ? 'BMX FREESTYLE' : 'DOT GAMES 2026', bx + 56, fy - 3, '#fff', { size: 'xs', align: 'center' }); }
      g.rect(0, fy + 20, 480, 300, '#a9b4c4');
      // ground
      const gy0 = -cy;
      g.rect(0, gy0, 480, 300, '#8d97a8'); g.rect(0, gy0, 480, 2, '#c0cbdc');
      for (let x = -M.wrap(cx, 60); x < 480; x += 60) g.rect(x, gy0 + 2, 1, 40, '#7a8496');
      // ramps
      BM_F.forEach((F, i) => {
        const x0 = F[0] - cx;
        if (x0 > 500 || x0 + F[2] + F[3] + F[4] < -20) return;
        const pts = [];
        for (let x = F[0]; x <= F[0] + F[2] + F[3] + F[4]; x += 4) pts.push(x - cx, bmY(x) - cy);
        pts.push(F[0] + F[2] + F[3] + F[4] - cx, -cy, F[0] - cx, -cy);
        g.poly(pts, '#a0643a');
        // side braces / graffiti
        const dx0 = F[0] + F[2] - cx, dx1 = dx0 + F[3];
        for (let x = dx0; x < dx1; x += 14) g.line(x, -F[1] - cy + 4, x + 14, -cy - 2, '#7a4a2a', 1);
        g.text(['DOT', 'BMX', 'AIR', '2026', 'SEND'][i], (dx0 + dx1) / 2, -cy - F[1] / 2 - 4, ['#feae34', '#2ce8f5', '#ff0044', '#63c74d', '#fee761'][i], { size: 'b', align: 'center', outline: '#181425' });
        for (let x = F[0]; x < F[0] + F[2] + F[3] + F[4]; x += 2) { const y = bmY(x) - cy; g.rect(x - cx, y, 2, 2, '#d79a5f'); }
        g.rect(F[0] + F[2] - cx - 1, -F[1] - cy - 1, 3, 3, '#c0cbdc');
      });
      // finish
      g.rect(BM_END - cx, -cy - 60, 3, 60, '#c0cbdc'); g.rect(BM_END - cx, -cy - 60, 30, 12, '#e43b44'); g.text('END', BM_END - cx + 15, -cy - 58, '#fff', { size: 'xs', align: 'center' });
      if (!a) return;
      const e = curEnt(s), look = bmxLook(e);
      const X = a.x - cx, Y = a.y - cy;
      const col = e ? lookOf(e).pants : PAL.red;
      const crash = a.st === 'crash';
      if (crash) {
        drawBike(g, X + a.cT * 30, Y + 2, a.cT * 6, 1, { col: col, sp: a.sp });
        if (a.cT < 0.6) fig(g, X - 10, bmY(a.x) - cy, POSE.fallen(), look, { anchor: 'feet', rot: a.cT * 3 }); else sitDown(g, X - 10, bmY(a.x) - cy, look);
      } else {
        const ang = a.ang;
        if (a.st === 'air') {
          a.tr.forEach((tr, i) => { g.alpha(0.08 + 0.05 * i); drawBike(g, tr[0] - cx, tr[1] - cy, tr[2], 1, { col: '#ffffff', wh: 0, bs: 0 }); g.alpha(1); });
        }
        const bk = drawBike(g, X, Y, ang, 1, { col: col, wh: a.wh, bs: a.bs, sp: a.sp, cr: a.cr });
        const whOff = a.st === 'air' && a.wq * TAU - a.wh > 0.3 ? 1 : 0, bsOff = a.st === 'air' && a.bq * TAU - a.bs > 0.3 ? 1 : 0;
        bmxRider(g, bk, look, ang, { sm: a.sm || 0, off: Math.max(whOff, bsOff), wh: whOff, bs: bsOff ? a.bs : 0, cr: a.cr });
        if (a.st === 'air') {
          const t = [Math.floor(a.fl / TAU + 0.15), a.wq, a.bq, a.sm > 0.5 ? 1 : 0];
          if (t[0] || t[1] || t[2] || t[3]) g.text(bmxTrick(t), X, Y - 50, PAL.yellow, { size: 'xs', align: 'center', outline: PAL.black });
        }
      }
      fxDraw(g, s, cx, cy);
      if (s.ph === 'board' || s.ph === 'end') return;
      // HUD
      g.rect(4, 30, 100, 26, 'rgba(24,20,37,0.75)');
      g.text('램프 ' + Math.min(BM_F.length, a.tricks.length + (a.st === 'air' ? 1 : 0)) + '/' + BM_F.length, 9, 33, PAL.white, { size: 's' });
      g.text('속도', 9, 45, PAL.lightgrey, { size: 'xs' });
      g.bar(32, 45, 66, 7, (a.v - 120) / 148, a.v > 250 ? PAL.green : PAL.yellow);
      a.tricks.forEach((k, i) => g.rect(110 + i * 12, 34, 10, 10, k[4] === 2 ? PAL.green : k[4] === 1 ? PAL.orange : PAL.red));
    }
  };

  /* ========================================================= SKATE STREET */
  const SK_RAILS = [[380, -22, 560, -22, 'ledge'], [760, -22, 940, -22, 'rail'], [1300, -70, 1420, -22, 'hand'], [1720, -54, 1800, -54, 'rail'], [2240, -78, 2400, -14, 'hubba'], [2600, -26, 2760, -26, 'ledge']];
  const SK_BOX = [[380, 560, 22], [2600, 2760, 26]];
  const SK_ST = [[1140, 1200, 1300, 1420, 48, 5], [2080, 2150, 2240, 2400, 64, 8]]; // bank start, top, stairs start, stairs end, h, steps
  const SK_FB = [1640, 1700, 1820, 1880, 36];
  const SK_END = 2980, SKG = 700;
  function skY(x) {
    for (const st of SK_ST) {
      if (x < st[0] || x > st[3]) continue;
      if (x < st[1]) return -st[4] * (x - st[0]) / (st[1] - st[0]);
      if (x < st[2]) return -st[4];
      const k = Math.floor((x - st[2]) / ((st[3] - st[2]) / st[5]));
      return -st[4] + st[4] * (k + 1) / st[5];
    }
    const f = SK_FB;
    if (x >= f[0] && x <= f[3]) { if (x < f[1]) return -f[4] * (x - f[0]) / (f[1] - f[0]); if (x < f[2]) return -f[4]; return -f[4] + f[4] * (x - f[2]) / (f[3] - f[2]); }
    return 0;
  }
  function skRoll(x) { // smooth ground for riding (stairs as a slope)
    for (const st of SK_ST) if (x >= st[2] && x <= st[3]) return -st[4] + st[4] * (x - st[2]) / (st[3] - st[2]);
    return skY(x);
  }
  const skA = x => Math.atan2(skRoll(x + 2) - skRoll(x - 2), 4);
  function onStairs(x) { for (const st of SK_ST) if (x > st[2] + 2 && x < st[3] - 3) return st; return null; }
  function skLook(e) { const L = lookOf(e); return { shirt: L.shirt, pants: OG.shade(L.pants, 0.15), skin: L.skin, hair: L.hair, cap: L.pants, sleeves: false, tights: true, shoe: '#e8eef8' }; }
  const SK_RN = { ledge: '50-50 그라인드', rail: '보드슬라이드', hand: '핸드레일 그라인드', hubba: '허바 5-0' };
  const SK_RV = { ledge: 2.5, rail: 3.2, hand: 5, hubba: 4.4 };
  function skFlipName(t) { // t: [flips, dir(-1 kick / 1 heel), shove halves]
    const fl = t[0], sv = t[2];
    if (fl && sv >= 2) return (fl > 1 ? '더블 ' : '') + '360 플립';
    if (fl && sv === 1) return '바리얼 ' + (t[1] > 0 ? '힐플립' : '킥플립');
    if (fl) return (fl > 1 ? '더블 ' : '') + (t[1] > 0 ? '힐플립' : '킥플립');
    if (sv >= 2) return '360 샤빗';
    if (sv === 1) return '팝 샤빗';
    return '';
  }
  function skFlipPts(t) { return t[0] * 3 + (t[0] > 1 ? 1.5 : 0) + t[2] * 1.5 + (t[0] && t[2] ? 1.5 : 0); }
  const P_SK_RIDE = { t: 0.15, aL: 0.5, aR: -0.4, eL: 0.4, eR: 0.3, lL: 0.35, lR: -0.3, kL: 0.5, kR: 0.4 };
  const P_SK_AIR = { t: 0.3, aL: 1.4, aR: -0.6, eL: 0.4, eR: 0.3, lL: 1.1, lR: 0.3, kL: 1.9, kR: 1.4 };
  const P_SK_PUSH = { t: 0.25, aL: 0.6, aR: -0.5, eL: 0.4, eR: 0.3, lL: 0.2, lR: -0.6, kL: 0.5, kR: 0.1 };
  KIND.skate = {
    att1: 2, attW: '차 런',
    init(s, e, R) {
      return { e: e.idx, st: 'ride', t: 0, x: 30, y: 0, v: 170, vx: 0, vy: 0, fl: 0, flT: 0, fd: -1, sv: 0, svT: 0, gr: 0, rail: -1, bal: 0, bv: 0, gd: 0, gB: 0, at: 0, ly: 0, tricks: [], bail: 0, bT: 0, fin: false, finT: 1.8, push: 0, ftk: null, gap: 0 };
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'ride') {
        if (inp.rp) { a.v = Math.min(290, a.v + 30); a.push = 0.35; OG.sfx(s, 'step'); }
        a.push = Math.max(0, a.push - dt);
        const ang = skA(a.x);
        a.v += (S(ang) * 260 - (a.v - 190) * 0.25) * dt;
        a.v = clamp(a.v, 110, 300);
        const nx = a.x + a.v * C(ang) * dt;
        const box = SK_BOX.find(b => nx >= b[0] && a.x < b[0]);
        if (box) { this.bail(s, a, R, '부딪힘!'); return; }
        a.x = nx; a.y = skRoll(a.x);
        if (onStairs(a.x)) { this.bail(s, a, R, '계단 굴러떨어짐!'); return; }
        if (inp.ap) this.ollie(s, a, R, ang);
        if (a.x > SK_END && !a.fin) { a.st = 'end'; a.fin = true; pop(s, '런 종료', PAL.white, { z: 'l' }); OG.sfx(s, 'whistle'); }
      } else if (a.st === 'air') {
        a.at += dt;
        const py = a.y;
        a.vy += SKG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        a.top = Math.max(a.top || 0, a.ly - a.y);
        const hitBox = SK_BOX.find(b => a.x >= b[0] && a.x - a.vx * dt < b[0] && a.y > -b[2] + 2);
        if (hitBox) { this.bail(s, a, R, '부딪힘!'); return; }
        if (inp.lp && a.flT < 2 * TAU) { a.flT += TAU; if (a.flT === TAU) a.fd = -1; OG.sfx(s, 'click'); }
        if (inp.rp && a.flT < 2 * TAU) { a.flT += TAU; if (a.flT === TAU) a.fd = 1; OG.sfx(s, 'click'); }
        if (inp.up && a.svT < 2 * PI) { a.svT += PI; OG.sfx(s, 'click'); }
        a.fl = appr(a.fl, a.flT, 3.1 * TAU * dt);
        a.sv = appr(a.sv, a.svT, 3.6 * PI * dt);
        if (inp.d) a.gB = Math.min(1, a.gB + dt * 8); else a.gB = Math.max(0, a.gB - dt * 8);
        if (a.vy > 0) {
          for (let i = 0; i < SK_RAILS.length; i++) {
            const r = SK_RAILS[i];
            if (a.x < r[0] + 2 || a.x > r[2] - 10) continue;
            const ry = r[1] + (r[3] - r[1]) * (a.x - r[0]) / (r[2] - r[0]);
            if (py <= ry + 1 && a.y >= ry - 1) { this.lock(s, a, R, i); return; }
          }
          const gy = skY(a.x);
          if (a.y >= gy) {
            const box = SK_BOX.find(b => a.x >= b[0] && a.x <= b[1]);
            if (box && py <= -box[2] + 2) { this.lock(s, a, R, SK_RAILS.findIndex(r => r[0] === box[0])); return; }
            this.land(s, a, R);
          }
        }
      } else if (a.st === 'grind') {
        const r = SK_RAILS[a.rail];
        const sl = Math.atan2(r[3] - r[1], r[2] - r[0]);
        a.v = clamp(a.v + (S(sl) * 200 - 25) * dt, 90, 300);
        a.x += a.v * C(sl) * dt;
        a.y = r[1] + (r[3] - r[1]) * (a.x - r[0]) / (r[2] - r[0]);
        a.gd += a.v * dt; a.gt += dt;
        a.bv += (R.gauss() * 4.5 + a.bal * 3.2) * dt;
        if (inp.l) a.bv -= 7 * dt; if (inp.r) a.bv += 7 * dt;
        a.bv *= 1 - 0.6 * dt;
        a.bal += a.bv * dt;
        a.balSum += abs(a.bal) * dt;
        if (R.chance(0.4)) fx(s, R, a.x, a.y, 1, { c: [5, 6, 11], spd: 50, ang: PI + 0.3, spr: 0.8, gr: 300, life: 0.3, sz: 1 });
        if (abs(a.bal) > 1) { this.bail(s, a, R, '밸런스 잃음!'); return; }
        if (inp.ap || a.x >= r[2] - 2) this.unlock(s, a, R, inp.ap);
      } else if (a.st === 'bail') {
        a.bT += dt; a.v = Math.max(0, a.v - 300 * dt); a.x += a.v * dt; a.y = skY(a.x);
        if (a.bT > 1.3) {
          a.st = 'ride'; a.v = 170;
          for (const st of SK_ST) if (a.x > st[0] - 20 && a.x < st[3] + 20) a.x = st[3] + 30;
          for (const b of SK_BOX) if (a.x > b[0] - 30 && a.x < b[1] + 10) a.x = b[1] + 30;
          if (a.x > SK_FB[0] - 20 && a.x < SK_FB[3]) a.x = SK_FB[3] + 20;
          a.y = skRoll(a.x);
        }
      } else if (a.st === 'end') { a.v = Math.max(0, a.v - 150 * dt); a.x += a.v * dt; }
      if (!a.fin && a.t > 40) { a.st = 'end'; a.fin = true; }
    },
    ollie(s, a, R, ang) {
      a.st = 'air'; a.at = 0; a.ly = a.y; a.top = 0;
      a.vx = a.v * C(ang); a.vy = Math.min(a.v * S(ang), 0) - 255;
      a.fl = 0; a.flT = 0; a.sv = 0; a.svT = 0; a.gB = 0; a.fromRail = a.fromRail || 0;
      a.startStair = SK_ST.find(st => a.x >= st[1] - 30 && a.x <= st[2] + 2) || null;
      OG.sfx(s, 'jump');
    },
    flipInfo(a) { return [Math.round(a.flT / TAU), a.fd, Math.round(a.svT / PI)]; },
    flipLeft(a) { return abs(a.flT - a.fl) + abs(a.svT - a.sv) * 1.4; },
    lock(s, a, R, i) {
      if (i < 0) { this.land(s, a, R); return; }
      if (this.flipLeft(a) > 0.6) { this.bail(s, a, R, '보드 미완성!'); return; }
      const ft = this.flipInfo(a);
      a.ftk = ft[0] || ft[2] ? ft : null;
      a.st = 'grind'; a.rail = i; a.bal = R.range(-0.15, 0.15); a.bv = 0; a.gd = 0; a.gt = 0; a.balSum = 0;
      a.v = Math.max(a.v, Math.abs(a.vx));
      OG.sfx(s, 'hit');
      pop(s, (a.ftk ? skFlipName(a.ftk) + ' → ' : '') + SK_RN[SK_RAILS[i][4]], PAL.cyan, { z: 'b', y: 58, d: 1 });
    },
    unlock(s, a, R, olliedOut) {
      const r = SK_RAILS[a.rail];
      const len = a.gd, bq = clamp(1 - (a.balSum / Math.max(0.2, a.gt)) * 1.4, 0, 1);
      const v = SK_RV[r[4]] + len * 0.012 + bq * 1.2 + (a.ftk ? skFlipPts(a.ftk) * 0.8 + 1 : 0);
      const rep = a.tricks.some(k => k[0] === 'g' && k[1] === r[4]) ? 1 : 0;
      a.tricks.push(['g', r[4], r2(v * (rep ? 0.8 : 1)), a.ftk ? skFlipName(a.ftk) + ' → ' + SK_RN[r[4]] : SK_RN[r[4]]]);
      a.st = 'air'; a.at = 0; a.ly = a.y; a.top = 0;
      const sl = Math.atan2(r[3] - r[1], r[2] - r[0]);
      a.vx = a.v * C(sl); a.vy = a.v * S(sl) - (olliedOut ? 200 : 70);
      a.fl = 0; a.flT = 0; a.sv = 0; a.svT = 0;
      a.x = Math.max(a.x, r[0] + 3);
      a.startStair = null;
      a.fromRail = 1;
      pop(s, '+' + (v * (rep ? 0.8 : 1)).toFixed(1), PAL.green, { z: 's', x: a.x, y: a.y - 40, w: 1, d: 0.8 });
    },
    land(s, a, R) {
      const gy = skY(a.x);
      if (onStairs(a.x)) { this.bail(s, a, R, '계단 착지!'); return; }
      if (SK_BOX.some(b => a.x >= b[0] && a.x <= b[1])) { this.bail(s, a, R, '부딪힘!'); return; }
      if (this.flipLeft(a) > 0.55) { this.bail(s, a, R, '보드 미완성!'); return; }
      const ft = this.flipInfo(a);
      let v = skFlipPts(ft), nm = skFlipName(ft);
      let gap = 0;
      if (a.startStair && a.x >= a.startStair[3] - 3) { gap = a.startStair[5]; v += gap * 0.55 + 1; nm = (nm ? nm + ' · ' : '') + gap + '계단 갭'; }
      if (!a.fromRail && !nm) { v = 0.6; nm = '올리'; }
      if (a.fromRail && !nm) v = 0;
      a.fromRail = 0;
      if (v > 0) {
        const rep = a.tricks.some(k => k[0] === 'f' && k[3] === nm) ? 1 : 0;
        a.tricks.push(['f', '', r2(v * (rep ? 0.75 : 1)), nm]);
        pop(s, nm, v > 6 ? PAL.gold : PAL.white, { z: v > 6 ? 'xl' : 'l', y: 58 });
        if (v > 6) OG.sfx(s, 'cheer');
      }
      a.st = 'ride'; a.y = skRoll(a.x); a.v = clamp(Math.abs(a.vx), 140, 290);
      OG.sfx(s, 'land');
      fx(s, R, a.x, gy, 5, { c: [9, 14], spd: 30, spr: 2, gr: 200, life: 0.3, w: 10 });
    },
    bail(s, a, R, why) {
      a.st = 'bail'; a.bT = 0; a.bail++; a.v = Math.max(80, a.v * 0.6); a.y = skY(a.x);
      pop(s, why || 'BAIL', PAL.red, { z: 'l' }); OG.sfx(s, 'crash');
      fx(s, R, a.x, a.y, 14, { c: [9, 14, 4], spd: 80, spr: 2.4, gr: 300, life: 0.6, w: 10 });
      a.fromRail = 0;
    },
    judge(s, a, R) {
      let sum = 0, best = null, bv = -1;
      a.tricks.forEach(k => { sum += k[2]; if (k[2] > bv) { bv = k[2]; best = k; } });
      const kinds = {}; a.tricks.forEach(k => { kinds[k[0] === 'g' ? k[1] : k[3]] = 1; });
      const variety = Object.keys(kinds).length;
      const base = clamp(8 + sum * 1.0 + variety * 0.8 - a.bail * 8, 1, 99);
      const js = judges(R, base, 5, 1.4, 0.25, 100), dr = dropMarks(js, 1);
      const sc = keptAvg(js, dr);
      return { sc: sc, nm: a.tricks.length + '트릭' + (best ? ' · 베스트 ' + best[3] : ''), js: js, dr: dr, jf: 2, tot: sc.toFixed(2), note: a.bail ? '베일 ' + a.bail : '', bad: !!a.bail };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.08);
      let sc = clamp(28 + 64 * q + R.gauss() * 3, 10, 97);
      if (R.chance(0.08 + (1 - q) * 0.22)) sc = R.range(18, 50);
      return { sc: sc, nm: '' };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'air') return '{L} 킥플립 {R} 힐플립 {U} 샤빗 · 레일 위로 내려앉으면 그라인드';
      if (a.st === 'grind') return '{L}{R} 균형 잡기  {A} 올리로 빠져나오기';
      return '{A} 올리 (점프)  {R} 푸시 · 박스와 계단은 뛰어넘기!';
    },
    cam(s, a) { return [a.x - 170, Math.min(-205, a.y - 150)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      g.grad(0, 0, 480, 200, '#3b2a5c', '#f7a35c', 10);
      g.circle(380 - cx * 0.02, 150 - cy * 0.05 - 205 * 0.05, 26, '#ffd27a'); g.circle(380 - cx * 0.02, 150 - cy * 0.05 - 205 * 0.05, 20, '#ffe9a8');
      // skyline
      const sy = 170 - (cy + 205) * 0.2;
      for (let i = 0; i < 30; i++) {
        const w = 20 + H(i, 3, 1) * 26, h = 30 + H(i, 3, 2) * 80;
        const x = M.wrap(i * 34 - cx * 0.15, 1020) - 60;
        if (x > 480) continue;
        g.rect(x, sy - h, w, h + 200, '#3a2a55');
        for (let wy = sy - h + 5; wy < sy; wy += 7) for (let wx = x + 3; wx < x + w - 3; wx += 6) if (H(Math.floor(wx), Math.floor(wy), i + 40) > 0.7) g.px(wx, wy, '#feae34');
      }
      // palm trees
      for (let i = 0; i < 6; i++) {
        const x = M.wrap(i * 170 - cx * 0.35, 1020) - 40, by = 200 - (cy + 205) * 0.35;
        if (x > 500) continue;
        for (let k = 0; k < 60; k += 2) g.rect(x + S(k * 0.05) * 6, by - k, 3, 2, '#2a1d3d');
        for (let l = 0; l < 6; l++) { const an = -PI / 2 + (l - 2.5) * 0.55; g.line(x + 6, by - 60, x + 6 + C(an) * 22, by - 60 + S(an) * 12 + 8, '#2a1d3d', 2); }
      }
      // graffiti wall (parallax .7)
      const wy = 205 - (cy + 205) * 0.7 - 70, ox = cx * 0.7;
      g.rect(0, wy, 480, 300, '#6b6f86');
      for (let x = -M.wrap(ox, 40); x < 480; x += 40) g.rect(x, wy, 1, 70, '#5a5e74');
      g.rect(0, wy, 480, 3, '#8d91a8');
      for (let i = -1; i < 5; i++) {
        const gx = i * 150 - M.wrap(ox, 150);
        const k = M.wrap(i + Math.floor(ox / 150), 4);
        const cols = [['#ff0044', '#fee761'], ['#2ce8f5', '#b55088'], ['#63c74d', '#f77622'], ['#feae34', '#124e89']][k];
        g.ellipse(gx + 70, wy + 36, 52, 20, cols[1]);
        g.text(['SK8', 'DOT!', 'NAGOYA', 'GRIND'][k], gx + 70, wy + 24, cols[0], { size: 'xl', align: 'center', outline: '#181425' });
      }
      g.crowd(0, wy + 46, 480, 24, g.t, { ox: ox, seed: 21, excite: a && a.st === 'grind' ? 0.5 : 0.12, bg: '#4a4e66' });
      g.rect(0, wy + 66, 480, 4, '#c0cbdc');
      // ground
      const gy0 = -cy;
      g.rect(0, gy0, 480, 300, '#9a9cab'); g.rect(0, gy0, 480, 2, '#c8cad6');
      for (let x = -M.wrap(cx, 48); x < 480; x += 48) g.rect(x, gy0 + 2, 1, 80, '#868898');
      const X = x => x - cx, Y = y => y - cy;
      // stairs / platforms
      SK_ST.forEach(st => {
        if (X(st[0]) > 500 || X(st[3]) < -20) return;
        g.poly([X(st[0]), Y(0), X(st[1]), Y(-st[4]), X(st[2]), Y(-st[4]), X(st[2]), Y(0)], '#b0b2c0');
        g.rect(X(st[0]), Y(0) - 1, X(st[1]) - X(st[0]), 1, '#8d8fa0');
        g.line(X(st[0]), Y(0), X(st[1]), Y(-st[4]), '#d4d6e2', 2);
        g.rect(X(st[1]), Y(-st[4]), st[2] - st[1], 2, '#d4d6e2');
        const n = st[5], sw = (st[3] - st[2]) / n, sh = st[4] / n;
        for (let k = 0; k < n; k++) {
          const x0 = st[2] + k * sw, y0 = -st[4] + k * sh;
          g.rect(X(x0), Y(y0), sw + 1, -y0, k % 2 ? '#a6a8b6' : '#b0b2c0');
          g.rect(X(x0), Y(y0), sw + 1, 2, '#d4d6e2');
        }
      });
      // funbox
      const f = SK_FB;
      g.poly([X(f[0]), Y(0), X(f[1]), Y(-f[4]), X(f[2]), Y(-f[4]), X(f[3]), Y(0)], '#b0b2c0');
      g.line(X(f[0]), Y(0), X(f[1]), Y(-f[4]), '#d4d6e2', 2); g.rect(X(f[1]), Y(-f[4]), f[2] - f[1], 2, '#d4d6e2'); g.line(X(f[2]), Y(-f[4]), X(f[3]), Y(0), '#d4d6e2', 2);
      g.text('DOT', X((f[1] + f[2]) / 2), Y(-f[4] / 2) - 4, '#ff0044', { size: 'b', align: 'center', outline: '#181425' });
      // boxes (ledges)
      SK_BOX.forEach(b => { g.rect(X(b[0]), Y(-b[2]), b[1] - b[0], b[2], '#7d8094'); g.rect(X(b[0]), Y(-b[2]), b[1] - b[0], 3, '#c0cbdc'); g.rect(X(b[0]), Y(-b[2]) + 3, b[1] - b[0], 1, '#5a5e74'); });
      // rails
      SK_RAILS.forEach(r => {
        if (r[4] === 'ledge') return;
        if (r[4] === 'hubba') { g.poly([X(r[0]), Y(r[1]), X(r[2]), Y(r[3]), X(r[2]), Y(r[3]) + 12, X(r[0]), Y(r[1]) + 14], '#8d8fa0'); g.line(X(r[0]), Y(r[1]), X(r[2]), Y(r[3]), '#e8eef8', 2); return; }
        const c = r[4] === 'hand' ? '#feae34' : '#e8eef8';
        g.line(X(r[0]), Y(r[1]), X(r[2]), Y(r[3]), c, 2);
        const posts = r[4] === 'hand' ? [r[0] + 4, r[2] - 4] : [r[0] + 6, (r[0] + r[2]) / 2, r[2] - 6];
        posts.forEach(px => { const py = r[1] + (r[3] - r[1]) * (px - r[0]) / (r[2] - r[0]); g.rect(X(px), Y(py), 2, skY(px) - py, OG.shade(c, -0.3)); });
      });
      g.rect(X(SK_END), Y(-60), 3, 60, '#c0cbdc'); g.rect(X(SK_END), Y(-60), 30, 12, '#e43b44'); g.text('END', X(SK_END) + 15, Y(-58), '#fff', { size: 'xs', align: 'center' });
      if (!a) return;
      const e = curEnt(s), look = skLook(e);
      const AX = a.x - cx, AY = a.y - cy;
      const bcol = e ? lookOf(e).shirt : PAL.red;
      const bo = { len: 7, off: 1.6, col: '#181425', bot: bcol, w: 1.6, th: 2, nose: true, wheels: '#fee761' };
      if (a.st === 'bail') {
        if (a.bT < 0.5) fig(g, AX, AY, POSE.fallen(), look, { anchor: 'feet', rot: -a.bT * 2 }); else sitDown(g, AX, AY, look);
        g.line(AX + 16 + a.bT * 20, AY - 2, AX + 30 + a.bT * 20, AY - 2, bcol, 2);
      } else {
        const ang = a.st === 'grind' ? Math.atan2(SK_RAILS[a.rail][3] - SK_RAILS[a.rail][1], SK_RAILS[a.rail][2] - SK_RAILS[a.rail][0]) : a.st === 'air' ? 0 : skA(a.x);
        let p = a.st === 'air' ? P_SK_AIR : a.push > 0 ? P_SK_PUSH : P_SK_RIDE;
        if (a.st === 'air' && a.gB > 0) p = POSE.mix(p, POSE.grab(), a.gB);
        if (a.st === 'grind') p = POSE.mix(P_SK_RIDE, { t: 0.2, aL: 1.6 + a.bal, aR: -1.6 + a.bal, eL: 0.2, eR: 0.2, lL: 0.45, lR: -0.35, kL: 0.7, kR: 0.5 }, 0.8);
        const bob = a.st === 'air' ? Math.min(5, abs(S(a.fl / 2)) * 6 + abs(S(a.sv)) * 3) : 0;
        const J = fig(g, AX, AY - 3 - bob, p, look, { rot: ang + (a.st === 'grind' ? a.bal * 0.25 : 0), anchor: 'feet' });
        const B2 = Object.assign({}, bo, { flip: a.st === 'air' ? a.fl * (a.fd || -1) : 0, spin: a.st === 'air' ? a.sv : 0, off: 1.6 + bob / 2 });
        board(g, J, B2);
        if (a.st === 'grind') {
          g.text('밸런스', AX, AY - 62, PAL.white, { size: 'xs', align: 'center', outline: PAL.black });
          g.rect(AX - 30, AY - 52, 60, 6, PAL.black); g.rect(AX - 29, AY - 51, 58, 4, PAL.slate);
          g.rect(AX - 8, AY - 51, 16, 4, '#3e8948');
          g.rect(AX + Math.round(clamp(a.bal, -1, 1) * 28) - 1, AY - 54, 3, 10, abs(a.bal) > 0.7 ? PAL.red : PAL.white);
        }
      }
      fxDraw(g, s, cx, cy);
      if (s.ph === 'board' || s.ph === 'end') return;
      // HUD trick list
      g.rect(4, 30, 120, 14 + Math.min(5, a.tricks.length) * 10, 'rgba(24,20,37,0.75)');
      g.text('트릭 ' + a.tricks.length + (a.bail ? ' · 베일 ' + a.bail : ''), 9, 33, PAL.white, { size: 's' });
      a.tricks.slice(-5).forEach((k, i) => g.text(k[3] + ' +' + k[2].toFixed(1), 9, 45 + i * 10, k[0] === 'g' ? PAL.cyan : PAL.yellow, { size: 'xs', maxW: 110 }));
    }
  };

  /* ============================================================= SURFING ==
   * Front view of a peeling wave. Paddle (◀▶ mash) and pop up with ACTION,
   * then ▲▼ carve up/down the face. Hitting the lip fast = aerial (◀▶ spin),
   * otherwise a lip snap. Stay ahead of the curl; when the wave barrels,
   * ride low inside the tube. Wave score /10, heat = best two waves. */
  const LIP = 104, SUG = 520, CURLV = 128, RIDE_T = 17;
  function lipH(wx, curl) {
    if (wx < curl) return LIP * 0.86;
    return LIP * (1 - 0.32 * clamp((wx - curl - 160) / 700, 0, 1));
  }
  function surfLook(e) { const L = lookOf(e); return { shirt: L.shirt, pants: OG.shade(L.shirt, -0.35), skin: L.skin, hair: L.hair, sleeves: true, ua: L.shirt, thigh: OG.shade(L.shirt, -0.35), tights: false, shoe: L.skin }; }
  const P_SURF = { t: 0.45, aL: 1.2, aR: -0.7, eL: 0.4, eR: 0.3, lL: 0.7, lR: -0.45, kL: 1.2, kR: 0.8 };
  const P_SURF_LOW = { t: 0.9, aL: 1.5, aR: -1.0, eL: 0.3, eR: 0.2, lL: 1.1, lR: -0.2, kL: 2.0, kR: 1.6 };
  const P_PRONE = ph => ({ rot: PI / 2 - 0.12, t: 0, aL: PI * 0.5 + S(ph * TAU) * 1.2, aR: PI * 0.5 - S(ph * TAU) * 1.2, eL: 0.4, eR: 0.4, lL: 0.15, lR: 0.1, kL: 0.4, kR: 0.5 });
  function surfMvName(k) { return { bottom: '바텀턴', top: '탑턴', snap: '립 스냅', air: '에어', rev: '에어 리버스', rev7: '720 에어', tube: '튜브 라이딩' }[k] || k; }
  KIND.surf = {
    rule: 'best2', attW: '번째 파도',
    init(s, e, R) {
      const t0 = R.range(4.5, 8.5);
      return { e: e.idx, st: 'paddle', t: 0, x: 0, y: -18, th: 0, sp: 0, cx: -95, pv: 0, last: '', lift: 0, rt: 0, mv: [], cd: 0, pth: 0, tubeT: 0, inT: 0, br: [r2(t0), r2(t0 + R.range(2.6, 3.6))], vx: 0, vy: 0, spn: 0, spV: 0, gr: 0, top: 0, fin: false, finT: 2.0, wipe: '', wT: 0, pq: 0, late: 0 };
    },
    upd(s, a, inp, dt, R) {
      a.t += dt;
      if (a.st === 'paddle') {
        a.lift = a.t / 2.6;
        let pressed = false;
        if (inp.lp && a.last !== 'l') { a.pv += 0.13; a.last = 'l'; pressed = true; }
        if (inp.rp && a.last !== 'r') { a.pv += 0.13; a.last = 'r'; pressed = true; }
        if (pressed) OG.sfx(s, 'stroke');
        a.pv = clamp(a.pv - 0.45 * dt, 0, 1);
        a.y = -12 - a.lift * 46; a.x += (20 + a.pv * 50) * dt; a.cx = a.x - 95 + a.lift * 10;
        if (inp.ap && a.lift < 0.5) pop(s, '아직!', PAL.orange, { z: 'b', y: 70, d: 0.6 });
        if ((inp.ap && a.lift >= 0.5) || a.lift > 1.15) {
          const late = a.lift > 1.15;
          a.pq = late ? 0 : clamp(1 - abs(a.lift - 0.82) / 0.3, 0, 1);
          a.sp = late ? 110 : 130 + 95 * a.pv + 55 * a.pq;
          a.late = late ? 1 : 0;
          a.st = 'ride'; a.t = 0; a.th = 0.7; a.rt = 0;
          OG.sfx(s, 'whoosh');
          pop(s, late ? '늦은 테이크오프' : a.pq > 0.75 && a.pv > 0.45 ? '완벽한 테이크오프!' : '테이크오프', late ? PAL.orange : PAL.green, { z: 'l', y: 40 });
        }
        return;
      }
      a.rt += dt;
      a.cx += CURLV * dt;
      a.cd = Math.max(0, a.cd - dt);
      const lh = lipH(a.x, a.cx), d = a.x - a.cx;
      if (a.st === 'ride') {
        if (inp.d) a.th += 3.5 * dt;
        if (inp.u) a.th -= 3.5 * dt;
        if (!inp.u && !inp.d) a.th = appr(a.th, 0.12, 1.2 * dt);
        a.th = clamp(a.th, -1.3, 1.3);
        a.sp += (240 * S(a.th) - 0.35 * (a.sp - 190) + (d < 110 ? 75 : d > 280 ? -70 : 0)) * dt;
        if (inp.l) a.sp -= 170 * dt;
        if (inp.r) a.sp += 55 * dt;
        a.stall = inp.l ? 1 : 0;
        a.sp = clamp(a.sp, 70, 410);
        a.vx = a.sp * C(a.th); a.vy = a.sp * S(a.th) * 0.8;
        a.x += a.vx * dt; a.y += a.vy * dt;
        // top turn
        if (a.pth < -0.15 && a.th >= -0.15 && inp.d && a.y < -0.5 * lh && a.cd <= 0) this.mv(s, a, R, 'top', 0.45 + clamp((a.sp - 160) / 220, 0, 0.9) * (d < 130 ? 1.25 : 1));
        a.pth = a.th;
        if (a.y > 0) {
          a.y = 0;
          if (a.th > 0.25) {
            const v = 0.25 + clamp((a.sp - 190) / 420, 0, 0.5);
            a.th = -a.th * 0.7;
            if (a.cd <= 0) this.mv(s, a, R, 'bottom', v);
            fx(s, R, a.x, a.y, 6, { c: [0, 10, 2], spd: 60, ang: -PI * 0.7, spr: 0.9, gr: 300, life: 0.6 });
          }
        }
        if (a.y < -lh) {
          if (a.vy < -150 && a.sp > 235) this.launch(s, a, R, lh);
          else {
            a.y = -lh; a.th = 0.9;
            if (a.cd <= 0) this.mv(s, a, R, 'snap', (0.55 + clamp((a.sp - 150) / 150, 0, 1.4)) * (d < 130 ? 1.25 : 1));
            fx(s, R, a.x, a.y, 16, { c: [0, 10, 2], spd: 120, ang: -PI * 0.55, spr: 1.0, gr: 380, life: 0.8, sz: 2 });
            OG.sfx(s, 'splash');
          }
        }
        if (R.chance(0.5)) fx(s, R, a.x - 10, a.y + 2, 1, { c: [0, 10], spd: 30, ang: PI + a.th * 0.5 + 0.5, spr: 0.6, gr: 200, life: 0.4 });
        // tube
        const barrel = a.rt >= a.br[0] && a.rt <= a.br[1];
        if (a.rt >= a.br[0] - 1 && a.rt < a.br[0] - 1 + dt * 1.5) { pop(s, '배럴이 온다! 낮게!', PAL.cyan, { z: 'l', y: 88, d: 1.2 }); OG.sfx(s, 'whistle'); }
        if (barrel && d > 4 && d < 118) {
          if (a.y < -0.72 * lh && d < 95 && a.rt > a.br[0] + 0.35) { this.wipeout(s, a, R, '립에 맞음!'); return; }
          if (a.y > -0.64 * lh) { a.tubeT += dt; a.inT = 1; }
        } else if (a.inT) {
          a.inT = 0;
          if (a.tubeT > 0.45) { this.mv(s, a, R, 'tube', Math.min(6.5, 1.4 + a.tubeT * 1.5)); pop(s, '튜브 탈출!', PAL.cyan, { z: 'xl', y: 90 }); OG.sfx(s, 'cheer'); }
          a.tubeT = 0;
        }
        if (d < 6) { this.wipeout(s, a, R, '파도에 휩쓸림!'); return; }
        if (a.rt > RIDE_T) { a.st = 'kick'; a.fin = true; a.finT = 1.6; pop(s, '킥아웃', PAL.white, { z: 'l' }); }
      } else if (a.st === 'air') {
        a.vy += SUG * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        a.top = Math.max(a.top, -lh - a.y);
        if (inp.l || inp.r) a.spV = appr(a.spV, (inp.r ? 1 : -1) * 2.1 * TAU, 36 * dt);
        else { a.spV = appr(a.spV, 0, 150 * dt); const nr = Math.round(a.spn / TAU) * TAU; if (abs(nr - a.spn) < 0.85) a.spn = appr(a.spn, nr, 4 * dt); }
        a.spn += a.spV * dt;
        a.gr = inp.d ? Math.min(1, a.gr + dt * 8) : Math.max(0, a.gr - dt * 7);
        if (a.gr > 0.5) a.grT = (a.grT || 0) + dt;
        if (a.vy > 0 && a.y >= -lh + 3) this.land(s, a, R, lh);
      } else if (a.st === 'wipe') {
        a.wT += dt; a.x = a.cx - 10 + a.wT * 20; a.y = Math.min(0, a.y + 60 * dt);
        if (R.chance(0.5)) fx(s, R, a.x + R.range(-10, 10), a.y - 10, 1, { c: [0, 10, 1], spd: 50, spr: 2, gr: 200, life: 0.6, sz: 2 });
      } else if (a.st === 'kick') {
        a.th = appr(a.th, -1.2, 2 * dt); a.x += a.sp * 0.5 * C(a.th) * dt; a.y += a.sp * 0.5 * S(a.th) * dt; a.y = Math.max(a.y, -lh - 30);
      }
    },
    mv(s, a, R, kind, v) {
      const same = a.mv.filter(m => m[0] === kind).length;
      if (same >= 2) v *= 0.7;
      a.mv.push([kind, r2(v)]);
      a.cd = 0.45;
      pop(s, surfMvName(kind) + ' +' + v.toFixed(1), v > 2 ? PAL.gold : PAL.white, { z: v > 2 ? 'l' : 'b', y: 52 + (a.mv.length % 2) * 12, d: 1.0 });
      if (v > 1) OG.sfx(s, 'good');
    },
    launch(s, a, R, lh) {
      a.st = 'air'; a.vy = Math.min(a.vy * 1.25, -150) ; a.vx = a.vx * 0.85; a.y = -lh - 1;
      a.spn = 0; a.spV = 0; a.gr = 0; a.grT = 0; a.top = 0;
      OG.sfx(s, 'jump');
      fx(s, R, a.x, a.y, 18, { c: [0, 10, 2], spd: 130, ang: -PI / 2, spr: 1.2, gr: 380, life: 0.9, sz: 2 });
    },
    land(s, a, R, lh) {
      const er = abs(a.spn - Math.round(a.spn / TAU) * TAU) + (a.gr > 0.5 ? 0.35 : 0);
      const turns = Math.round(abs(a.spn) / TAU);
      if (er > 0.85) { this.wipeout(s, a, R, '착지 실패!'); return; }
      let v = turns >= 2 ? 5.4 : turns === 1 ? 3.6 : 1.5;
      v += clamp(a.top / 50, 0, 1.2) + ((a.grT || 0) > 0.3 ? 0.5 : 0);
      if (er > 0.45) { v *= 0.6; pop(s, '불안한 착지', PAL.orange, { z: 'b', y: 92, d: 0.9 }); }
      a.st = 'ride'; a.y = -lh + 4; a.th = 0.9; a.sp *= 0.88;
      this.mv(s, a, R, turns >= 2 ? 'rev7' : turns === 1 ? 'rev' : 'air', v);
      fx(s, R, a.x, a.y, 14, { c: [0, 10, 2], spd: 90, spr: 1.8, gr: 300, life: 0.7, sz: 2 });
      OG.sfx(s, 'splash');
    },
    wipeout(s, a, R, why) {
      a.st = 'wipe'; a.wT = 0; a.fin = true; a.finT = 1.8; a.wipe = why;
      pop(s, why, PAL.red, { z: 'xl' }); OG.sfx(s, 'crash'); OG.sfx(s, 'splash');
      fx(s, R, a.x, a.y, 26, { c: [0, 10, 1, 2], spd: 120, spr: 2.6, gr: 260, life: 1.0, sz: 2 });
    },
    judge(s, a, R) {
      let sum = 0;
      a.mv.forEach(m => { sum += m[1]; });
      const kinds = {}; a.mv.forEach(m => { kinds[m[0]] = 1; });
      let base = 0.6 + sum * 0.42 + Object.keys(kinds).length * 0.18 + clamp(a.rt / RIDE_T, 0, 1) * 0.5 - a.late * 0.3;
      if (a.wipe) base -= 0.8;
      base = clamp(base, 0.3, 9.9);
      const js = judges(R, base, 5, 0.3, 0.1, 10), dr = dropMarks(js, 1);
      const sc = keptAvg(js, dr);
      const best = a.mv.slice().sort((x, y) => y[1] - x[1])[0];
      return { sc: sc, nm: a.mv.length + '개 기술' + (best ? ' · 베스트 ' + surfMvName(best[0]) : ''), js: js, dr: dr, jf: 1, tot: sc.toFixed(2), note: a.wipe ? '와이프아웃' : sc >= 8 ? '엑설런트' : '', bad: !!a.wipe };
    },
    cpu(s, e, R) {
      const q = OG.cpuQuality(e, R, 0.1);
      let sc = clamp(3.4 + 5.6 * q + R.gauss() * 0.75, 0.5, 9.9);
      if (R.chance(0.08 + (1 - q) * 0.15)) sc = R.range(0.8, 3.5);
      return { sc: sc, nm: '' };
    },
    fmt: v => v.toFixed(2),
    hint(s, a) {
      if (a.st === 'paddle') return '{L}{R} 번갈아 패들 · 초록 구간에서 {A} 일어서기';
      if (a.st === 'air') return '{L}{R} 스핀 (360 = 에어 리버스) {D} 그랩';
      return '{U}{D} 카빙 (빠르게 립으로 = 에어) {L} 스톨 {R} 펌핑 · 튜브에선 낮게';
    },
    cam(s, a) { return [Math.max(a.x - 400, Math.min(a.x - 200, a.cx - 70)), Math.min(-178, a.y - 70)]; },
    draw(g, s, a) {
      const cx = s.cam[0], cy = s.cam[1];
      const curl = a ? a.cx : 0, trough = -cy;
      // sky + sun + far coast
      g.grad(0, 0, 480, 160, '#5fb6f2', '#d8f0ff', 10);
      const sx = 400, sy = 34;
      g.alpha(0.18); g.circle(sx, sy, 30, '#fff6d8'); g.alpha(1);
      g.circle(sx, sy, 16, '#fff6d8'); g.circle(sx, sy, 13, '#ffffff');
      g.clouds(g.t * 0.5, 14, 3);
      const hz = trough - LIP - 28;
      g.mountains(hz - 26, 26, '#6f9f9a', 2, cx * 0.05);
      g.rect(0, hz, 480, 300, '#2f86c4');
      for (let i = 0; i < 30; i++) g.rect(M.wrap(i * 37 - cx * 0.1 + Math.floor(g.t * 3), 480), hz + 2 + (i * 7) % 20, 5, 1, 'rgba(255,255,255,0.35)');
      // seagulls
      for (let i = 0; i < 3; i++) { const bx = M.wrap(i * 160 + g.t * 14, 520) - 20, by = 40 + i * 14 + S(g.t * 2 + i) * 4; g.line(bx - 3, by - 1, bx, by + 1, '#3a4466', 1); g.line(bx, by + 1, bx + 3, by - 1, '#3a4466', 1); }
      const barrel = a && a.rt >= a.br[0] && a.rt <= a.br[1] && a.st !== 'paddle';
      const FACE = ['#86e6e0', '#56c9d8', '#33a8cf', '#2289c2', '#1b72b2', '#155c9c'];
      const scale = a && a.st === 'paddle' ? 0.45 + 0.55 * clamp(a.lift, 0, 1) : 1;
      const tt = g.t;
      for (let x = 0; x < 480; x += 3) {
        const wx = x + cx;
        const h = lipH(wx, curl) * scale, top = trough - h;
        const dd = wx - curl;
        if (dd < -16) {
          // whitewater: lumpy foam pile, tallest right behind the curl
          const bump = Math.max(0, 1 + dd / 120) * 16;
          const fh = h * 0.8 + bump + S(wx * 0.07 + tt * 4) * 4 + S(wx * 0.19 - tt * 6) * 2;
          const ft = Math.round(trough - fh);
          g.rect(x, ft, 3, trough - ft + 8, '#d9f1f8');
          g.rect(x, ft, 3, 3, '#ffffff');
          for (let y = ft + 3; y < trough + 6; y += 3) {
            const v = H(Math.floor(wx / 3), Math.floor(y / 3), Math.floor(tt * 8));
            if (v > 0.55) g.rect(x, y, 3, 3, v > 0.86 ? '#ffffff' : v > 0.7 ? '#b9e3f0' : '#9fd3e6');
          }
          g.alpha(0.35); g.rect(x, ft - 6 - Math.round(H(Math.floor(wx / 3), 2, Math.floor(tt * 5)) * 8), 3, 6, '#ffffff'); g.alpha(1);
          continue;
        }
        for (let k = 0; k < 6; k++) {
          const w0 = k ? S(wx * 0.025 + k * 1.3 + tt * 1.2) * 2 : 0, w1 = k < 5 ? S(wx * 0.025 + (k + 1) * 1.3 + tt * 1.2) * 2 : 0;
          const y0 = Math.round(top + h * k / 6 + w0), y1 = Math.round(top + h * (k + 1) / 6 + w1);
          g.rect(x, y0, 3, y1 - y0 + 1, FACE[k]);
        }
        if (dd < 80) { g.alpha(0.42 * (1 - Math.max(0, dd) / 80)); g.rect(x, top + h * 0.22, 3, h * 0.66, '#0e3a6a'); g.alpha(1); }
        g.rect(x, top - 1, 3, 2, '#ffffff');
        if (dd < 0) {
          // pitching lip curtain falling into the foam
          const k = -dd / 16, bot = top + h * (0.25 + 0.7 * k);
          g.rect(x, top, 3, bot - top, '#a8e6ee'); g.rect(x, top, 3, 2, '#ffffff');
          g.rect(x, Math.round(bot) - 2, 3, 3, '#ffffff');
        } else if (dd < 46) {
          const k = 1 - dd / 46;
          g.rect(x, top + 1, 3, Math.round(3 + k * 10), '#bff0f4'); g.rect(x, top + 1, 3, 2, '#ffffff');
          if (H(Math.floor(wx / 3), 9, Math.floor(tt * 10)) > 0.6) g.px(x + 1, top - 2 - Math.round(k * 4), '#ffffff');
        }
      }
      // face streaks
      for (let i = 0; i < 46; i++) {
        const wx = Math.floor(curl / 400) * 400 + i * 23 + ((i * 97) % 400);
        const X = wx - cx; if (X < 0 || X > 478) continue;
        const h = lipH(wx, curl) * scale, k = M.wrap(H(i, 5, 5) + g.t * 0.12, 1);
        if (wx < curl + 8) continue;
        g.rect(X, trough - h + h * k, 4 + (i % 3) * 2, 1, 'rgba(255,255,255,0.28)');
      }
      // front water
      g.grad(0, trough, 480, 120, '#2a9fd6', '#1f6fb3', 5);
      for (let i = 0; i < 24; i++) g.rect(M.wrap(i * 41 - cx + S(g.t + i) * 4, 500) - 10, trough + 6 + (i * 13) % 80, 3, 1, 'rgba(255,255,255,0.35)');
      g.rect(0, trough, 480, 2, 'rgba(255,255,255,0.5)');
      if (!a) return;
      const bph = barrel ? clamp((a.rt - a.br[0]) / 0.5, 0, 1) * clamp((a.br[1] - a.rt) / 0.5, 0, 1) : 0;
      if (bph > 0) {
        for (let x = 0; x < 480; x += 3) {
          const wx = x + cx, dd = wx - curl;
          if (dd < 0 || dd > 120) continue;
          const h = lipH(wx, curl), top = trough - h, k = 1 - dd / 120;
          const bot = top + h * (0.15 + 0.85 * k) * bph;
          g.alpha(0.45 * bph); g.rect(x, bot, 3, trough - bot, '#0b2f57'); g.alpha(1);
        }
      }
      const e = curEnt(s), look = surfLook(e);
      const bcol = e ? lookOf(e).pants : PAL.yellow;
      const bo = { len: 10, off: 1.3, col: '#fff6d8', bot: bcol, edge: bcol, th: 3, nose: true, w: 1.2 };
      const X = a.x - cx, Y = a.y - cy;
      if (a.st === 'paddle') {
        const J = fig(g, X, Y - 4, P_PRONE(a.t * (1 + a.pv)), look, { anchor: 'hip' });
        const p1 = J.P(-9, 3), p2 = J.P(11, 3);
        g.line(X - 18, Y + 2, X + 22, Y + 1, '#fff6d8', 3); g.rect(X - 18, Y + 3, 40, 1, bcol);
        // paddle / pop meter
        g.text('패들', 10, 32, PAL.white, { size: 'xs', outline: PAL.black });
        g.bar(34, 32, 80, 7, a.pv, PAL.cyan);
        g.text('파도', 10, 44, PAL.white, { size: 'xs', outline: PAL.black });
        g.rect(34, 44, 80, 7, PAL.black); g.rect(35, 45, 78, 5, PAL.slate);
        g.rect(35 + Math.round(78 * 0.52 / 1.15), 45, Math.round(78 * 0.6 / 1.15), 5, '#3e8948');
        g.rect(35 + Math.round(78 * 0.72 / 1.15), 45, Math.round(78 * 0.2 / 1.15), 5, PAL.green);
        g.rect(35 + Math.round(78 * clamp(a.lift, 0, 1.15) / 1.15) - 1, 43, 2, 9, PAL.white);
        void p1; void p2;
      } else if (a.st === 'wipe') {
        fig(g, X, Y - 6, POSE.fallen(), look, { rot: a.wT * 5, anchor: 'com' });
        g.line(X + 20 - a.wT * 10, Y - 20 - a.wT * 20, X + 40 - a.wT * 10, Y - 26 - a.wT * 20, '#fff6d8', 3);
        g.alpha(0.7); g.circle(X, Y - 6, 18, '#e8f8ff'); g.alpha(1);
      } else {
        const ang = a.st === 'air' ? 0.15 : Math.atan2(a.vy, Math.max(30, a.vx)) * 0.85;
        const low = a.inT || a.stall ? 1 : clamp(a.th * 0.6, 0, 0.6);
        const p = POSE.mix(POSE.mix(P_SURF, P_SURF_LOW, low), POSE.grab(), a.st === 'air' ? a.gr : 0);
        if (a.st === 'air') spinArcs(g, X, Y - 18, a.spV, 26, g.t);
        const J = fig(g, X, Y - 2, p, look, { rot: ang, sq: a.st === 'air' ? C(a.spn) : 1, anchor: 'feet' });
        board(g, J, bo);
        if (a.st === 'ride' && a.sp > 150) { g.alpha(0.8); for (let k = 0; k < 4; k++) g.rect(X - 14 - k * 5, Y + 1 - k, 4, 2, '#ffffff'); g.alpha(1); }
      }
      // barrel curtain over the surfer
      if (bph > 0) {
        for (let x = 0; x < 480; x += 3) {
          const wx = x + cx, dd = wx - curl;
          if (dd < 0 || dd > 120) continue;
          const h = lipH(wx, curl), top = trough - h;
          const k = 1 - dd / 120;
          const bot = Math.round(top + h * (0.15 + 0.85 * k) * bph);
          g.alpha(0.72); g.rect(x, top, 3, bot - top, '#8fdde8'); g.alpha(1);
          for (let y = top + 4; y < bot - 4; y += 7) if (H(Math.floor(wx / 3), Math.floor(y / 7), Math.floor(g.t * 6)) > 0.7) g.rect(x, y, 3, 1, '#d8f6fa');
          g.rect(x, bot - 3, 3, 4, '#ffffff');
          if (H(Math.floor(wx / 3), 4, Math.floor(g.t * 12)) > 0.65) g.rect(x + 1, bot + 1 + Math.round(H(Math.floor(wx / 3), 5, Math.floor(g.t * 12)) * 5), 1, 2, '#e8f8ff');
        }
      }
      fxDraw(g, s, cx, cy);
      if (s.ph === 'board' || s.ph === 'end') return;
      // HUD
      if (a.st !== 'paddle') {
        g.rect(4, 30, 108, 14 + Math.min(4, a.mv.length) * 10, 'rgba(24,20,37,0.75)');
        const tot = a.mv.reduce((t, m) => t + m[1], 0);
        g.text('기술 ' + a.mv.length + ' · ' + Math.max(0, RIDE_T - a.rt).toFixed(0) + 's', 9, 33, PAL.white, { size: 's' });
        a.mv.slice(-4).forEach((m, i) => g.text(surfMvName(m[0]) + ' +' + m[1].toFixed(1), 9, 45 + i * 10, m[0] === 'tube' ? PAL.cyan : PAL.yellow, { size: 'xs' }));
        void tot;
        if (barrel) g.text(a.inT ? '튜브 ' + a.tubeT.toFixed(1) + 's' : '배럴! 낮게 들어가기', 240, 30, PAL.cyan, { size: 'b', align: 'center', outline: PAL.black });
      }
    }
  };

  /* ============================================================ ENGINE === */
  function startTurn(s, R) {
    const K = KIND[s.kind];
    s.ph = 'ready'; s.pt = 0; s.card = null; s.fx = []; s.pop = [];
    s.a = K.init(s, s.ents[s.turns[s.ti]], R);
    camStep(s, 1);
  }
  function camStep(s, k) {
    const K = KIND[s.kind];
    if (!s.a || !K.cam) return;
    const c = K.cam(s, s.a);
    s.cam[0] = r1(s.cam[0] + (c[0] - s.cam[0]) * k);
    s.cam[1] = r1(s.cam[1] + (c[1] - s.cam[1]) * k);
  }
  function finish(s) {
    const K = KIND[s.kind];
    const rows = s.ents.map((e, i) => {
      const list = e.human ? s.sc[i] : s.cpuA[i].map(x => x[0]);
      const v = agg(s.rule, list);
      return { idx: e.idx, score: r2(v == null ? 0 : v), text: K.fmt(v == null ? 0 : v) };
    });
    s.results = OG.sortResults(rows, false);
    s.done = true;
  }
  OG.defineEngine('air', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) {
      const cfg = ev.cfg || {};
      const K = KIND[cfg.kind];
      const humans = ents.filter(e => e.human);
      const nH = humans.length;
      const nAtt = nH <= 1 ? (cfg.att1 || K.att1 || 3) : nH === 2 ? 2 : 1;
      const turns = [];
      for (let k = 0; k < nAtt; k++) humans.forEach(h => turns.push(h.idx));
      const s = {
        evId: ev.id, kind: cfg.kind, h: cfg.h || 0, rule: cfg.rule || 'best', attW: K.attW || '차 시기',
        nAtt: nAtt, nH: nH, ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name, tag: e.tag || '', skill: e.skill, look: e.look })),
        turns: turns, ti: 0, ph: 'ready', pt: 0, t: -3, sc: ents.map(() => []), nm: ents.map(() => []), cpuA: [], rnd: 0,
        fx: [], pop: [], cam: [0, 0], a: null, card: null, done: false, results: null
      };
      s.cpuA = s.ents.map(e => {
        if (e.human) return [];
        const out = [];
        for (let k = 0; k < nAtt; k++) { const r = K.cpu(s, e, R); out.push([r2(r.sc), r.nm || '']); }
        return out;
      });
      if (!turns.length) { s.ph = 'end'; s.rnd = nAtt; s.a = ents.length ? K.init(s, s.ents[0], R) : null; camStep(s, 1); }
      else { s.a = K.init(s, s.ents[turns[0]], R); camStep(s, 1); }
      return s;
    },
    update(s, inputs, dt, R) {
      const K = KIND[s.kind];
      fxStep(s, dt);
      if (s.done) return;
      s.pt += dt;
      const anyA = () => s.ents.some(e => e.human && inputs[e.pid] && inputs[e.pid].ap);
      const cur = s.ti < s.turns.length ? s.ents[s.turns[s.ti]] : null;
      switch (s.ph) {
        case 'ready': {
          if (s.ti === 0 && s.t < 0) {
            const b = Math.ceil(-s.t);
            s.t += dt;
            if (Math.ceil(-s.t) !== b && s.t < 0) OG.sfx(s, 'beep');
          }
          if (s.pt >= (s.ti === 0 ? 3 : 1.9)) { s.ph = 'go'; s.pt = 0; s.t = 0; OG.sfx(s, s.ti === 0 ? 'go' : 'start'); }
          camStep(s, 0.2);
          break;
        }
        case 'go': case 'fin': {
          const inp = s.ph === 'go' ? (inputs[cur.pid] || OG.blankInput()) : OG.blankInput();
          K.upd(s, s.a, inp, dt, R);
          camStep(s, s.a.fin ? 0.08 : 0.16);
          if (s.ph === 'go' && (s.a.fin || s.pt > 70)) { s.a.fin = true; s.ph = 'fin'; s.pt = 0; }
          else if (s.ph === 'fin' && s.pt > (s.a.finT || 1.8)) {
            const cd = K.judge(s, s.a, R);
            cd.who = cur.idx;
            cd.sc = r2(cd.sc);
            if (cd.js) cd.js = cd.js.map(r2);
            s.sc[cur.idx].push(cd.sc); s.nm[cur.idx].push(cd.nm);
            s.card = cd; s.ph = 'card'; s.pt = 0;
            OG.sfx(s, cd.bad ? 'ding' : 'cheer');
          }
          break;
        }
        case 'card':
          if (s.pt > 4.6 || (s.pt > 1.4 && anyA())) {
            s.ti++;
            if (s.ti % Math.max(1, s.nH) === 0) {
              s.rnd = Math.min(s.nAtt, Math.floor(s.ti / Math.max(1, s.nH)));
              s.ph = s.ti >= s.turns.length ? 'end' : 'board'; s.pt = 0;
              if (s.ph === 'end') OG.sfx(s, 'medal'); else OG.sfx(s, 'confirm');
            } else startTurn(s, R);
          }
          break;
        case 'board':
          if (s.pt > 3.6 || (s.pt > 1.1 && anyA())) startTurn(s, R);
          break;
        case 'end':
          if (s.pt > 4 || (s.pt > 1.6 && anyA())) finish(s);
          break;
      }
    },
    draw(g, s) {
      const K = KIND[s.kind];
      K.draw(g, s, s.a);
      popDraw(g, s);
      if (s.ph === 'ready' || s.ph === 'go' || s.ph === 'fin') hudTurn(g, s);
      if (s.ph === 'ready') {
        turnBanner(g, s);
        if (s.ti === 0) g.countdown(-s.t);
        hintBar(g, s.a ? K.hint(s, Object.assign({}, s.a, { st: s.a.st })) : '');
      } else if (s.ph === 'go') hintBar(g, s.a ? K.hint(s, s.a) : '');
      else if (s.ph === 'card') drawCard(g, s);
      else if (s.ph === 'board') drawBoard(g, s, false);
      else if (s.ph === 'end') drawBoard(g, s, true);
    }
  });

  OG.defineEvents([
    { id: 'dive10m', name: '다이빙 10m 플랫폼', en: 'Diving 10m Platform', sport: 'diving', icon: '💦', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'dive', h: 10, rule: 'sum' },
      help: ['{A} 팔 스윙 게이지가 꽉 찰 때 도약', '공중: {D} 감싸기 {U} 굽히기 {L}{R} 트위스트', '{A} 입수 자세 — 머리부터 수직으로! (립 엔트리)'] },
    { id: 'dive3m', name: '다이빙 3m 스프링보드', en: 'Diving 3m Springboard', sport: 'diving', icon: '💦', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'dive', h: 3, rule: 'sum' },
      help: ['{A} 보드가 가장 깊이 휠 때 눌러 높이 뛰기', '공중: {D} 감싸기 {U} 굽히기 {L}{R} 트위스트', '{A} 입수 자세 — 수직으로 들어가면 고득점'] },
    { id: 'trampoline', name: '트램폴린', en: 'Trampoline', sport: 'trampoline', icon: '🤸', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'tramp', rule: 'best', att1: 2 },
      help: ['{A} 매트가 가장 깊을 때: 높이 상승 · {L}{R} 매트 위에서 중앙 유지', '공중: {D} 턱 {U} 파이크 (백 공중돌기) {L}{R} 트위스트', '10개 스킬 연속! 발로 똑바로 착지 · {A} 펴기'] },
    { id: 'vault', name: '도마', en: 'Vault', sport: 'gymnastics', icon: '🤸', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'vault', rule: 'avg' },
      help: ['{L}{R} 번갈아 연타: 도움닫기 · {A} 노란 표시에서 구름판', '{A} 손이 도마에 닿는 순간 밀기', '공중: {D} 턱 {U} 파이크 {L}{R} 비틀기 · {A} 펴서 STICK!'] },
    { id: 'aerials', name: '프리스타일 에어리얼', en: 'Freestyle Aerials', sport: 'freestyle', icon: '⛷️', tags: ['winter'], engine: 'air',
      cfg: { kind: 'aerial', rule: 'best' },
      help: ['{A} 킥커 끝에서 팝', '공중: {D} 백플립(레이아웃) {U} 턱 {L}{R} 풀 트위스트', '{A} 착지 자세 — 똑바로 서서 착지!'] },
    { id: 'halfpipe', name: '스노보드 하프파이프', en: 'Snowboard Halfpipe', sport: 'snowboard', icon: '🏂', tags: ['winter'], engine: 'air',
      cfg: { kind: 'pipe', rule: 'best' },
      help: ['{D} 내려갈 때 누르고 올라갈 때 떼기: 펌핑 · {A} 립에서 팝', '공중: {L}{R} 스핀 {U} 콕(플립) {D} 그랩', '5번의 히트 · 180° 단위로 착지 정렬'] },
    { id: 'bigair', name: '스노보드 빅에어', en: 'Snowboard Big Air', sport: 'snowboard', icon: '🏂', tags: ['winter'], engine: 'air',
      cfg: { kind: 'bigair', rule: 'best2' },
      help: ['{D} 웅크려 속도 조절 (초록 구간) · {A} 립에서 팝', '공중: {L}{R} 스핀 1080·1440·1800 {D}{U} 그랩', '착지 전 그랩 놓기 · 상위 2개 점프 합계'] },
    { id: 'bmx_free', name: 'BMX 프리스타일', en: 'BMX Freestyle Park', sport: 'bmx', icon: '🚲', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'bmx', rule: 'best', att1: 2 },
      help: ['{L}{R} 번갈아: 페달 · {A} 램프 끝에서 팝', '공중: {D} 백플립 {L} 테일윕 {R} 바스핀 {U} 슈퍼맨', '착지 전 기술 마무리 + 착지 램프에 바퀴 맞추기'] },
    { id: 'skate_street', name: '스케이트보드 스트리트', en: 'Skateboarding Street', sport: 'skateboarding', icon: '🛹', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'skate', rule: 'best', att1: 2 },
      help: ['{A} 올리 · {R} 푸시 (박스·계단은 뛰어넘기)', '공중: {L} 킥플립 {R} 힐플립 {U} 샤빗 · 레일에 내려앉아 그라인드', '그라인드 중 {L}{R} 균형 · {A} 빠져나오기'] },
    { id: 'surfing', name: '서핑', en: 'Surfing', sport: 'surfing', icon: '🏄', tags: ['summer', 'asian'], engine: 'air',
      cfg: { kind: 'surf', rule: 'best2' },
      help: ['{L}{R} 번갈아 패들 → {A} 초록 구간에서 일어서기', '{U}{D} 파도면 카빙 · 빠르게 립에 오르면 에어 (공중 {L}{R} 스핀)', '{L} 스톨로 배럴 안에 낮게 머물기! 상위 2개 파도 합계'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
