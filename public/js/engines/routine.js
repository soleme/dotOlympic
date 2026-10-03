/* =========================================================================
 * engine: routine — judged rhythm performances
 *   (figure skating, artistic gymnastics, rhythmic, artistic swimming,
 *    breaking, dressage, wushu taolu, karate kata)
 *
 * Prompts (◀ ▶ ▲ ▼ A, holds, mashes) scroll toward a hit line in time with
 * the beat. PERFECT / GOOD / MISS judgements drive the athlete animation
 * (clean element / shaky / fall) and the score (difficulty + execution,
 * shown as a judges' panel in each sport's real format).
 * Humans perform in turns; CPU athletes are simulated with the same charts
 * and the same scoring code (judgement probabilities from ent.skill).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL, Pose = OG.Pose;
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs;
  const WP = 0.075, WG = 0.15;                  // judgement windows (s)
  const HX = 64, LY = 223, LH = 27, SPD = 150;  // note lane geometry
  const DURS = [32, 32, 29, 26, 23, 20, 18, 16, 14];

  /* ----------------------------- helpers ------------------------------ */
  const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const sm = u => { u = c01(u); return u * u * (3 - 2 * u); };
  const lerp = M.lerp;
  const mixP = (a, b, k) => Pose.mix(a, b, c01(k));
  const PZ = (t, aL, aR, eL, eR, lL, lR, kL, kR, h) => ({ t, aL, aR, eL, eR, lL, lR, kL, kR, h: h || 0 });
  function kf(fr, u) {
    if (u <= fr[0][0]) return fr[0][1];
    for (let i = 1; i < fr.length; i++) {
      if (u <= fr[i][0]) { const a = fr[i - 1], b = fr[i]; return Pose.mix(a[1], b[1], sm((u - a[0]) / ((b[0] - a[0]) || 1))); }
    }
    return fr[fr.length - 1][1];
  }
  const H = OG.hash;
  const arc = u => 4 * c01(u) * (1 - c01(u));
  const flipF = (f, u, n) => (Math.floor(c01(u) * n * 2 - 0.0001) % 2 ? -f : f); // spin illusion

  // Forward kinematics identical to g.figure (so props / trails can be placed without drawing)
  const SEG = { thigh: 5.5, shin: 5.5, torso: 8, uarm: 4.2, farm: 4.2, head: 2.6 };
  function fk(x, y, pose, opt) {
    opt = opt || {};
    const f = opt.facing || 1, s = opt.scale || 1;
    const rot = (pose.rot || 0) + (opt.rot || 0), cr = cos(rot), sr = sin(rot);
    const tf = (lx, ly) => [lx * cr - ly * sr, lx * sr + ly * cr];
    const dir = (a, l) => [sin(a) * l, cos(a) * l];
    const t = pose.t || 0;
    const neck = [sin(t) * SEG.torso, -cos(t) * SEG.torso], sh = [neck[0] * 0.92, neck[1] * 0.92];
    const limb = (b, a1, l1, a2, l2) => { const d1 = dir(a1, l1), j1 = [b[0] + d1[0], b[1] + d1[1]], d2 = dir(a2, l2); return [j1, [j1[0] + d2[0], j1[1] + d2[1]]]; };
    const aL = (pose.aL || 0) + t, aR = (pose.aR || 0) + t;
    const armL = limb(sh, aL, SEG.uarm, aL + (pose.eL || 0), SEG.farm);
    const armR = limb(sh, aR, SEG.uarm, aR + (pose.eR || 0), SEG.farm);
    const lL = pose.lL || 0, lR = pose.lR || 0;
    const legL = limb([0, 0], lL, SEG.thigh, lL - (pose.kL || 0), SEG.shin);
    const legR = limb([0, 0], lR, SEG.thigh, lR - (pose.kR || 0), SEG.shin);
    const head = [neck[0] + sin(t + (pose.h || 0)) * (SEG.head + 0.6), neck[1] - cos(t + (pose.h || 0)) * (SEG.head + 0.6)];
    const pts = { neck, sh, head, elL: armL[0], hdL: armL[1], elR: armR[0], hdR: armR[1], knL: legL[0], ftL: legL[1], knR: legR[0], ftR: legR[1] };
    const scr = {};
    for (const k in pts) { const p = tf(pts[k][0], pts[k][1]); scr[k] = [p[0] * f * s, p[1] * s]; }
    let hy = y;
    if ((opt.anchor || 'feet') === 'feet') {
      const lowest = Math.max(scr.ftL[1], scr.ftR[1], scr.head[1] + SEG.head * s, scr.hdL[1], scr.hdR[1]);
      hy = y - lowest - 1;
    }
    const J = { hip: [x, hy] };
    for (const k in scr) J[k] = [x + scr[k][0], hy + scr[k][1]];
    return J;
  }
  // draw athlete (+hair bun / extras); returns joints
  function fig(g, x, y, pose, look, opt) {
    const J = g.figure(x, y, pose, look, opt);
    if (look.bun) {
      const f = opt.facing || 1, s = opt.scale || 1, rot = (pose.rot || 0) + (opt.rot || 0) + (pose.t || 0);
      const bx = J.head[0] - f * (cos(rot) * 2.6 * s) + f * sin(rot) * 1.2 * s;
      const by = J.head[1] - sin(rot) * 2.6 * s - cos(rot) * 1.2 * s;
      g.circle(bx, by, 1.2 * s, look.hair);
      if (look.bunC) g.px(bx, by - s, look.bunC);
    }
    return J;
  }
  function hipAt(pose, opt, joint, tx, ty) { // hip position so that `joint` lands on (tx,ty)
    const J = fk(0, 0, pose, Object.assign({}, opt, { anchor: 'hip' }));
    return [tx - J[joint][0], ty - J[joint][1]];
  }
  const fmtN = (v, d) => v.toFixed(d);

  /* ------------------------------ poses -------------------------------- */
  const PS = {
    stand: Pose.stand(),
    salute: PZ(-0.05, 2.75, 2.95, 0.15, 0.15, 0.05, -0.05, 0, 0),
    present: PZ(0.0, 2.2, 2.4, 0.1, 0.1, 0.0, -0.35, 0, 0),
    land: PZ(0.35, 1.9, 2.1, 0.1, 0.1, 0.9, 0.75, 1.5, 1.3),
    landUp: PZ(0.1, 2.6, 2.8, 0.1, 0.1, 0.3, 0.25, 0.5, 0.4),
    step: PZ(0.2, 1.2, 2.8, 0.4, 0.2, 0.5, -0.5, 0.6, 0.2),
    sit: PZ(-0.2, 1.6, 1.4, 0.3, 0.3, 1.45, 1.5, 0.25, 0.3),
    tuck: PZ(0.7, 1.1, 1.2, 1.3, 1.3, 2.1, 2.0, 2.5, 2.5),
    pike: PZ(1.3, 0.6, 0.7, 0, 0, 1.5, 1.45, 0, 0),
    layout: PZ(-0.05, 0.25, 0.3, 0.1, 0.1, -0.05, -0.08, 0.05, 0.05),
    arched: PZ(-0.25, 3.0, 3.1, 0, 0, -0.35, -0.3, 0.2, 0.1),
    hurdle: PZ(0.25, 2.6, 2.8, 0.1, 0.1, 0.9, -0.3, 0.8, 0.2),
    split: PZ(0.05, 2.5, 2.9, 0.1, 0.1, 1.55, -1.45, 0, 0.1),
    ring: PZ(-0.35, 2.8, 3.0, 0.2, 0.2, 1.45, -1.5, 0, 1.6),
    passe: PZ(0.0, 2.9, 3.0, 0.3, 0.3, 0.0, 0.9, 0, 2.4),
    crouch: PZ(0.6, 0.9, 1.1, 0.8, 0.8, 1.6, 1.4, 2.4, 2.2),
    arms: PZ(0.0, 1.57, 1.45, 0.1, 0.1, 0.05, -0.05, 0, 0),
    lunge: PZ(0.15, 2.4, 0.6, 0.2, 0.3, 0.9, -0.6, 0.9, 0.1),
    bow: PZ(0.9, 0.2, 0.2, 0, 0, 0.0, 0.0, 0, 0),
    wave: PZ(0.0, 2.9, 0.15, 0.4, 0.2, 0.05, -0.05, 0, 0)
  };
  const LAND_HIP = fk(0, 0, PS.land, { scale: 2 }).hip[1];
  // dance step keyed to a phase (gap choreography)
  function dance(ph, k, style) {
    const a = ph * TAU;
    if (style === 1) return PZ(0.05 + 0.1 * sin(a), 1.8 + 0.9 * sin(a), 2.4 - 0.9 * sin(a), 0.4, 0.4, 0.3 * sin(a), -0.3 * sin(a), 0.2, 0.2);
    return PZ(0.0, 2.2 + 0.6 * sin(a), 1.0 - 0.6 * sin(a), 0.6, 0.6 + 0.4 * k, 0.15 * cos(a), -0.4 * k, 0.2, 0.6 * k);
  }

  /* ------------------------------ looks -------------------------------- */
  function baseLook(ent) {
    if (OG.COUNTRY_MAP && OG.COUNTRY_MAP[ent.country]) return OG.lookOf(ent);
    return { shirt: PAL.red, pants: PAL.navy, skin: OG.SKINS[ent.look % 5], hair: OG.HAIRS[(ent.look >> 3) % 6] };
  }
  function kitCol(ent, i) { const L = baseLook(ent); return i ? L.pants : L.shirt; }
  // pick a vivid costume colour (white kits get the secondary colour)
  function vivid(ent) {
    const L = baseLook(ent);
    const lum = c => { const r = OG.hexToRgb(c); return (r[0] + r[1] + r[2]) / 3; };
    if (lum(L.shirt) > 225) return L.pants;
    return L.shirt;
  }

  /* ---------------------------- particles ------------------------------ */
  function addFx(P, k, x, y, d) {
    if (P.sim) return;
    P.fx.push({ k, t0: P.t, x: Math.round(x), y: Math.round(y), d: d || 0 });
    if (P.fx.length > 14) P.fx.shift();
  }
  const FXS = {
    chalk: { n: 14, life: 0.9, c: ['#ffffff', '#e8e8f0', '#c0cbdc'], sp: 40, up: 30, gr: -10, sz: 2 },
    spray: { n: 18, life: 0.7, c: ['#ffffff', '#dff3ff', '#b8dcf2'], sp: 70, up: 30, gr: 140, sz: 1 },
    splash: { n: 22, life: 0.9, c: ['#ffffff', '#9fd8ff', '#5fb6f2'], sp: 40, up: 110, gr: 260, sz: 2 },
    spark: { n: 12, life: 0.7, c: ['#fee761', '#ffffff', '#feae34'], sp: 60, up: 40, gr: 20, sz: 1 },
    dust: { n: 14, life: 0.9, c: ['#e4a672', '#ead4aa', '#b86f50'], sp: 45, up: 22, gr: 30, sz: 2 },
    star: { n: 10, life: 0.8, c: ['#ffffff', '#2ce8f5', '#fee761'], sp: 70, up: 50, gr: 0, sz: 1 },
    petal: { n: 12, life: 1.2, c: ['#f6757a', '#ffffff', '#fee761', '#b55088'], sp: 50, up: 60, gr: 60, sz: 2 },
    hit: { n: 8, life: 0.35, c: ['#ffffff', '#fee761'], sp: 120, up: 0, gr: 0, sz: 1 }
  };
  function drawFx(g, P) {
    for (let i = 0; i < P.fx.length; i++) {
      const f = P.fx[i], st = FXS[f.k]; if (!st) continue;
      const a = P.t - f.t0; if (a < 0 || a > st.life) continue;
      const fade = 1 - a / st.life;
      for (let k = 0; k < st.n; k++) {
        const h1 = H(k, i * 7 + Math.round(f.t0 * 60), 3), h2 = H(k, f.x, 5), h3 = H(k, f.y, 9);
        let vx = (h1 - 0.5) * 2 * st.sp, vy = -h2 * st.up - 10;
        if (f.d) vx = f.d * abs(vx) * 0.8 + (h1 - 0.5) * 20;
        const x = f.x + vx * a, y = f.y + vy * a + st.gr * a * a;
        if (fade < 0.5 && H(k, i, Math.floor(a * 30)) > fade * 2) continue;
        const c = st.c[Math.floor(h3 * st.c.length)];
        const sz = st.sz + (h3 > 0.7 && st.sz > 1 ? 1 : 0);
        g.rect(x, y, sz, sz, c);
      }
    }
  }

  /* ============================= KINDS ================================ *
   * Each kind: bpm, sc (scoring), plan(R,L) → element defs, fill(R,beats)
   * → filler notes, stage(g,s,P,t), actor(g,s,P,t), bounds [x0,x1], x0 start.
   * Element def: {a: anim id, nm: name, bv: value, b: beats,
   *   n: [[beatOff, btn, kind, lenBeats, crit]], mv: travel px, link, cf}
   *   btn: l r u d a | x (alternate ◀▶ mash) | ? random dir | > forward | < back
   *   kind: t tap | h hold | r hold + timed release | m mash
   * =================================================================== */
  const K = {};
  const pickLv = (R, arr, L) => { // arr sorted easy → hard; choose near level L
    const i = M.clamp(Math.round(L * (arr.length - 1) + R.gauss() * 0.8), 0, arr.length - 1);
    return arr[i];
  };
  const E = (a, nm, bv, b, n, extra) => Object.assign({ a, nm, bv, b, n, mv: 0 }, extra || {});
  const DIRS = ['l', 'r', 'u', 'd'];

  /* --------------------------- common stage ---------------------------- */
  function spot(g, x, yTop, yBot, w0, w1, c, a) {
    g.alpha(a);
    g.poly([x - w0, yTop, x + w0, yTop, x + w1, yBot, x - w1, yBot], c);
    g.alpha(1);
  }
  function arenaBack(g, t, o) {
    o = o || {};
    const top = o.top || '#0d0f1f', mid = o.mid || '#1d2140';
    g.grad(0, 0, 480, o.h || 120, top, mid, 6);
    // roof truss + lights
    g.rect(0, 8, 480, 2, '#2a2f52');
    for (let i = 0; i < 12; i++) {
      const x = 20 + i * 40;
      g.line(x, 10, x + 20, 3, '#2a2f52'); g.line(x + 20, 3, x + 40, 10, '#2a2f52');
      g.rect(x + 18, 10, 5, 3, '#4a4f72'); g.rect(x + 19, 13, 3, 1, '#fff7c0');
    }
    if (o.crowd !== false) {
      g.crowd(0, o.cy || 26, 480, o.ch || 84, t, { excite: o.excite || 0, seed: o.seed || 3, bg: o.cbg || '#20253f', density: 0.72 });
      g.rect(0, o.cy || 26, 480, o.ch || 84, o.dim || 'rgba(10,10,28,0.58)');
      for (let i = 0; i < 6; i++) { const fx = Math.floor(H(i, Math.floor(t * 3), 5) * 480), fy = (o.cy || 26) + Math.floor(H(i, Math.floor(t * 3), 6) * (o.ch || 84)); if (H(i, Math.floor(t * 7), 2) < 0.25 + (o.excite || 0) * 0.5) { g.rect(fx - 1, fy, 3, 1, '#fff'); g.rect(fx, fy - 1, 1, 3, '#fff'); } }
    }
    // hanging banners
    if (o.banners) {
      const bc = o.banners;
      for (let i = 0; i < bc.length; i++) {
        const x = 40 + i * (400 / Math.max(1, bc.length - 1)) - 9;
        g.rect(x, 26, 18, 20, bc[i]); g.rect(x, 46, 18, 2, OG.shade(bc[i], -0.4));
        g.line(x + 2, 10, x + 2, 26, '#2a2f52'); g.line(x + 15, 10, x + 15, 26, '#2a2f52');
        g.rect(x + 8, 30, 2, 10, 'rgba(255,255,255,0.6)');
      }
    }
  }
  function sweepSpots(g, t, y0, y1, cols, a) {
    for (let i = 0; i < cols.length; i++) {
      const x0 = 60 + i * (360 / Math.max(1, cols.length - 1));
      const sw = sin(t * 0.6 + i * 1.7) * 90;
      g.alpha(a || 0.09);
      g.poly([x0 - 3, y0, x0 + 3, y0, x0 + sw + 26, y1, x0 + sw - 26, y1], cols[i]);
      g.alpha(1);
    }
  }
  function scoreboard(g, x, y, w, h, title, t) {
    g.rect(x - 1, y - 1, w + 2, h + 2, '#0a0a14');
    g.rect(x, y, w, h, '#131a33');
    for (let yy = y + 1; yy < y + h; yy += 2) g.rect(x, yy, w, 1, 'rgba(255,255,255,0.03)');
    g.text(title, x + w / 2, y + 2, PAL.yellow, { size: 'xs', align: 'center' });
  }

  /* =============================== FLOOR =============================== */
  const FLOOR_Y = 196;
  const PASSES = [ // easy → hard: [nm, bv, salto pose, saltos, twists, front]
    ['백 더블 턱', 0.3, 'tuck', 2, 0, 0], ['프론트 더블 턱', 0.4, 'tuck', 2, 0, 1], ['더블 피크', 0.4, 'pike', 2, 0, 0],
    ['트리플 트위스트', 0.4, 'layout', 1, 3, 0], ['더블 레이아웃', 0.5, 'layout', 2, 0, 0], ['더블 더블', 0.5, 'tuck', 2, 2, 0],
    ['더블 레이아웃 풀', 0.6, 'layout', 2, 1, 0], ['트리플 더블', 0.8, 'tuck', 2, 3, 0]
  ];
  function passEl(R, L, combo) {
    const p = pickLv(R, PASSES, L);
    const front = p[5];
    const n = front
      ? [[0, '>', 't'], [1, '>', 't'], [2, '>', 't'], [3, 'a', 't', 0, 1], [5, 'd', 't', 0, 1]]
      : [[0, '>', 't'], [1, '>', 't'], [2, 'd', 't'], [2.5, 'u', 't'], [3, 'a', 't', 0, 1], [5, 'd', 't', 0, 1]];
    const el = E('pass', p[0], p[1], 6.5, n, { mv: 300, ps: p[2], ns: p[3], nt: p[4], fr: front, pass: 1 });
    if (combo && !front) { // + connected back tuck
      el.n = n.slice(0, 5).concat([[5, 'a', 't', 0, 1], [6.5, 'd', 't', 0, 1]]);
      el.b = 8; el.nm += ' + 백 턱'; el.bv += 0.1; el.cmb = 1; el.link = 1;
    }
    return el;
  }
  K.floor = {
    bpm: 120, sc: 'gym', D0: 4.55, D1: 1.6, bounds: [64, 416], x0: 80, gap: 2, maxGap: 4,
    look(ent) { const c = vivid(ent); const L = baseLook(ent); return Object.assign(L, { shirt: c, pants: c, sleeves: true, bun: !(ent.look & 1), shoe: L.skin }); },
    plan(R, L) {
      const leap = () => R.pick([E('leap', '스위치 링 리프', 0.3, 3, [[0, '>', 't'], [1, 'u', 't', 0, 1]], { mv: 70, v: 'ring' }), E('leap', '스플릿 점프', 0.2, 3, [[0, '>', 't'], [1, 'u', 't', 0, 1]], { mv: 60, v: 'split' })]);
      const turn = () => E('turn', L > 0.7 ? '트리플 턴' : '더블 턴', L > 0.7 ? 0.4 : 0.2, 3, [[0, 'u', 't'], [0.5, 'x', 'm', 1.5]], { mv: 0 });
      return [passEl(R, L), leap(), passEl(R, L, 1), turn(), passEl(R, L), leap(), passEl(R, L * 0.8)];
    },
    fill(R, beats) { const o = []; for (let b = 0; b + 1 <= beats; b += 2) o.push([b, R.pick(DIRS), 't']); return o; },
    hint: '{L}{R}{U}{D}{A} 타이밍 맞춰 누르기',
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, banners: ['#e43b44', '#0099db', '#feae34', '#63c74d', '#b55088'] });
      scoreboard(g, 20, 30, 92, 26, '기계체조 · 마루운동', t);
      if (P) g.text(OG.entLabel(s.ents[P.idx]) + '  D ' + (P.dLive || 0).toFixed(1), 66, 42, PAL.white, { size: 'xs', align: 'center' });
      g.adBoards(0, 110, 480, 12, t, ['AICHI-NAGOYA 2026', 'DOT GAMES', 'GYMNASTICS', 'PIXEL SPORTS']);
      g.rect(0, 122, 480, 100, '#3a3f5c');
      // podium surround + blue carpet (perspective)
      g.poly([20, 150, 460, 150, 480, 220, 0, 220], '#1e4fa8');
      g.poly([34, 154, 446, 154, 464, 214, 16, 214], '#2a64c4');
      for (let i = 0; i < 9; i++) { const x0 = 34 + i * 51.5, x1 = 16 + i * 56; g.line(x0, 154, x1, 214, 'rgba(255,255,255,0.05)'); }
      g.line(34, 154, 446, 154, '#ffffff'); g.line(16, 214, 464, 214, '#ffffff');
      g.line(34, 154, 16, 214, '#ffffff'); g.line(446, 154, 464, 214, '#ffffff');
      g.rect(0, 220, 480, 3, '#262b44');
      // background apparatus silhouettes
      g.rect(8, 128, 3, 22, '#2a2f4a'); g.rect(40, 128, 3, 22, '#2a2f4a'); g.rect(6, 126, 40, 3, '#2a2f4a');
      g.rect(440, 132, 30, 6, '#2a2f4a'); g.rect(452, 138, 6, 12, '#2a2f4a');
    },
    actor(g, s, P, t) {
      const st = gymPose(s, P, t, this);
      const look = this.look(s.ents[P.idx]);
      g.alpha(0.22); g.ellipse(st.x, FLOOR_Y + 1, 16 - Math.min(10, st.lift / 6), 3, '#000'); g.alpha(1);
      spotLight(g, st.x, FLOOR_Y, 0.10);
      fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
    }
  };
  function spotLight(g, x, y, a) {
    g.alpha(a); g.ellipse(x, y, 26, 6, '#fff7d0'); g.alpha(a * 0.6); g.poly([x - 6, 0, x + 6, 0, x + 26, y, x - 26, y], '#fff7d0'); g.alpha(1);
  }

  // Shared gymnastics-style body animation (floor / beam acro)
  // returns {x, y, pose, f, rot, anchor, lift}
  function gymPose(s, P, t, Kd, groundY) {
    groundY = groundY || FLOOR_Y;
    const spb = 60 / Kd.bpm, q = at(P, t);
    let x, y = groundY, pose = PS.stand, f = 1, rot = 0, anchor = 'feet', lift = 0;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      const d = b - a;
      const gt = q.t1 - q.t0;
      x = lerp(a, b, sm(q.u));
      f = q.next ? (d === 0 ? q.next.dir : Math.sign(d)) : (q.prev ? q.prev.dir : 1);
      if (!q.next) { // outro: final pose
        const k = (t - q.t0) / spb;
        pose = k < 1 ? mixP(PS.land, PS.salute, k) : PS.salute; f = q.prev ? q.prev.dir : 1;
      } else if (!q.prev && t < q.t1 - spb * 1.2) {
        pose = t < 0 ? PS.salute : mixP(PS.salute, PS.stand, t / spb); f = 1;
      } else if (abs(d) > 30) {
        const ph = (t - q.t0) / gt * (abs(d) / 26);
        pose = mixP(Pose.walk(ph % 1), dance(ph, 0.5, 1), 0.4);
      } else {
        const ph = (t - q.t0) / spb / 2;
        pose = dance(ph, 0.6 + 0.4 * sin(ph * 3), (q.i % 2));
        // touch of choreography on filler notes
        const ln = lastHitNote(P, t, -1);
        if (ln && t - ln.jt < 0.35) pose = mixP(pose, PS.present, 1 - (t - ln.jt) / 0.35);
      }
      if (P.fallT >= 0 && t - P.fallT < 1.2 && t >= P.fallT) { pose = mixP(PS.sit, PS.stand, (t - P.fallT - 0.6) / 0.6); }
      return { x, y, pose, f, rot, anchor, lift };
    }
    const e = q.e, bt = (t - e.t0) / spb; f = e.dir;
    const res = e.res;
    const span = e.x1 - e.x0;
    if (e.a === 'pass') {
      const fr = e.fr, cmb = e.cmb, runB = fr ? 3 : 2, fin = cmb ? 6.5 : 5;
      if (bt < runB) {                          // run-up
        const u = bt / runB;
        x = e.x0 + span * (fr ? 0.36 : 0.3) * u * u;
        pose = Pose.run((bt * 1.6) % 1, 0.4 + u * 0.6);
        if (bt > runB - 0.35) pose = mixP(pose, PS.hurdle, (bt - (runB - 0.35)) / 0.35);
      } else if (!fr && bt < 3) {               // round-off + back handspring
        const u = bt - 2;
        x = e.x0 + span * (0.3 + 0.24 * u);
        const th = u < 0.5 ? TAU * sm(u * 2) : TAU * sm((u - 0.5) * 2);
        f = u < 0.25 ? e.dir : -e.dir;
        rot = e.dir * th * f;
        lift = u < 0.5 ? arc(u * 2) * 8 : arc((u - 0.5) * 2) * 12;
        pose = PS.arched; anchor = 'hip'; y = groundY - 21 - lift;
      } else if (bt < fin) {                    // salto(s)
        let k0 = 3, k1 = 5, nS = e.ns, jh = 58, xs0 = fr ? 0.36 : 0.54, xs1 = cmb ? 0.82 : 1;
        const second = cmb && bt >= 5;
        if (second) { k0 = 5; k1 = 6.5; nS = 1; jh = 34; xs0 = 0.82; xs1 = 1; }
        const u = (bt - k0) / (k1 - k0);
        x = e.x0 + span * lerp(xs0, xs1, u);
        lift = arc(u) * jh;
        const th = TAU * nS * sm(c01(u / 0.9));
        f = fr ? e.dir : -e.dir;
        if (e.nt && !second) f = flipF(f, (u - 0.12) / 0.7, e.nt);
        rot = e.dir * th * f;
        const ps = second ? PS.tuck : (PS[e.ps] || PS.tuck);
        pose = u < 0.12 ? mixP(PS.arched, ps, u / 0.12) : u > 0.8 ? mixP(ps, PS.land, (u - 0.8) / 0.2) : ps;
        anchor = 'hip'; y = groundY + lerp(-21, LAND_HIP, c01((u - 0.8) / 0.2)) - lift;
      } else {                                  // landing
        x = e.x1; f = fr ? e.dir : -e.dir;
        const k = bt - fin;
        if (res === 3) pose = k < 1.2 ? PS.sit : mixP(PS.sit, PS.stand, (k - 1.2) * 2);
        else if (res === 2) { pose = k < 0.5 ? mixP(PS.land, PS.step, k * 2) : mixP(PS.step, PS.salute, (k - 0.5) * 2); x = e.x1 + e.dir * Math.min(1, k * 2) * 10; }
        else pose = k < 0.4 ? PS.land : mixP(PS.land, PS.salute, (k - 0.4) * 2.5);
      }
    } else if (e.a === 'leap') {
      x = lerp(e.x0, e.x1, sm(bt / 2.2));
      if (bt < 1) pose = Pose.run(bt * 1.5 % 1, 0.5);
      else if (bt < 2) { const u = bt - 1, lp = e.v === 'ring' ? PS.ring : PS.split; lift = arc(u) * 26; pose = u < 0.15 ? mixP(PS.hurdle, lp, u / 0.15) : lp; y = groundY - lift; }
      else { const k = bt - 2; pose = res === 3 ? (k < 0.6 ? PS.sit : mixP(PS.sit, PS.stand, k - 0.6)) : mixP(PS.land, PS.present, k * 1.5); }
    } else if (e.a === 'turn') {
      x = e.x0;
      if (bt < 0.5) pose = mixP(PS.stand, PS.passe, bt * 2);
      else if (bt < 2.2) { pose = PS.passe; const u = (bt - 0.5) / 1.7; f = flipF(e.dir, u, res === 3 ? 1 : (e.bv > 0.3 ? 3 : 2)); }
      else pose = mixP(res === 3 ? PS.step : PS.passe, PS.present, (bt - 2.2) * 1.5);
    } else { x = e.x0; pose = PS.stand; }
    if (x == null) x = e.x0;
    return { x, y, pose, f, rot, anchor, lift };
  }
  function lastHitNote(P, t, elIdx) {
    for (let i = P.notes.length - 1; i >= 0; i--) { const n = P.notes[i]; if (n.e === elIdx && n.j && n.j < 3 && n.jt <= t) return n; }
    return null;
  }

  /* =========================== FIGURE SKATING ========================== */
  const ICE_Y = 196;
  const SK = {
    glide: PZ(0.2, 1.3, 1.5, 0.25, 0.25, 0.25, -0.55, 0.5, 0.1),
    glide2: PZ(0.15, 1.7, 1.1, 0.3, 0.1, -0.45, 0.2, 0.1, 0.45),
    start: PZ(0.0, 0.5, 2.6, 0.6, 0.4, 0.0, 0.3, 0, 0.6),
    prep: PZ(0.35, 0.8, 1.9, 0.4, 0.2, 0.75, -0.25, 1.4, 0.3),
    air: PZ(0.0, 0.45, 0.55, 2.5, 2.5, 0.05, 0.12, 0.05, 0.3),
    land: PZ(0.3, 1.65, 1.45, 0.15, 0.15, 0.3, -1.05, 0.5, 0.05),
    stumble: PZ(0.5, 2.7, 0.3, 0.3, 0.6, 0.6, 0.2, 1.2, 0.8),
    camel: PZ(1.45, 1.6, 1.7, 0.1, 0.1, 0.05, -1.55, 0.1, 0.0),
    sit: PZ(0.75, 1.5, 1.6, 0.1, 0.1, 1.55, 1.25, 2.6, 0.0),
    layback: PZ(-0.85, 2.9, 3.0, 0.3, 0.3, 0.05, -0.6, 0.0, 1.6),
    upright: PZ(0.0, 2.8, 2.9, 0.4, 0.4, 0.0, 0.25, 0, 0.9),
    spiral: PZ(1.3, 2.2, 1.4, 0.1, 0.1, 0.0, -1.7, 0.0, 0.0),
    slide: { rot: -PI / 2 + 0.25, t: 0, aL: 2.6, aR: 0.8, eL: 0.3, eR: 0.3, lL: 0.5, lR: 0.1, kL: 1.0, kR: 0.3, h: 0 },
    bow: PZ(0.8, 0.4, 2.6, 0.3, 0.2, 0.05, -0.5, 0.1, 0.4),
    twA: PZ(0.1, 2.6, 0.6, 0.6, 0.3, 0.1, -0.5, 0.2, 0.6),
    twB: PZ(0.25, 0.5, 2.4, 0.3, 0.6, -0.4, 0.4, 0.6, 0.1),
    twC: PZ(0.5, 1.2, 1.2, 1.4, 1.4, 0.9, 0.2, 1.6, 0.3),
    twD: PZ(-0.1, 2.9, 2.9, 0.2, 0.2, 0.0, -0.8, 0, 0.2)
  };
  const SK_J1 = [['트리플 플립', 5.3, 3], ['트리플 러츠', 5.9, 3], ['쿼드 토루프', 9.5, 4], ['쿼드 살코', 9.7, 4], ['쿼드 플립', 11.0, 4], ['쿼드 러츠', 11.5, 4]];
  const SK_CB = [['트리플 플립+더블 토루프', 6.6, 3, 2], ['트리플 러츠+트리플 토루프', 10.1, 3, 3], ['쿼드 토루프+트리플 토루프', 13.7, 4, 3], ['쿼드 러츠+트리플 토루프', 15.7, 4, 3]];
  const SK_SP = [['플라잉 카멜 스핀', 3.2, 'camel'], ['체인지 풋 싯 스핀', 3.0, 'sit'], ['체인지 풋 콤비네이션 스핀', 3.5, 'combo'], ['레이백 스핀', 2.7, 'layback']];
  function skLook(ent) {
    const c = vivid(ent), L = baseLook(ent), fem = !(ent.look & 1);
    return Object.assign(L, { shirt: c, pants: fem ? OG.shade(L.skin, -0.06) : '#1c1830', sleeves: true, tights: true, shoe: fem ? '#ffffff' : '#262b44', bun: fem, skirt: fem ? OG.shade(c, -0.12) : null });
  }
  function skirt(g, J, c) {
    const ax = J.hip[0] - J.neck[0], ay = J.hip[1] - J.neck[1], l = Math.hypot(ax, ay) || 1;
    const ux = ax / l, uy = ay / l, px = -uy, py = ux;
    const h = J.hip;
    g.poly([h[0] + px * 3 - ux * 2, h[1] + py * 3 - uy * 2, h[0] - px * 3 - ux * 2, h[1] - py * 3 - uy * 2, h[0] - px * 7 + ux * 6, h[1] - py * 7 + uy * 6, h[0] + px * 7 + ux * 6, h[1] + py * 7 + uy * 6], c);
  }
  function skatePose(P, t) {
    const spb = 60 / K.skate.bpm, q = at(P, t);
    let x, y = ICE_Y, pose = SK.glide, f = 1, lift = 0;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u));
      f = b > a + 2 ? 1 : b < a - 2 ? -1 : (q.prev ? q.prev.dir : 1);
      const k = (t - q.t0) / spb;
      if (!q.next) {
        pose = k < 0.8 ? mixP(SK.glide, SK.upright, k / 0.8) : k < 2.4 ? SK.upright : mixP(SK.upright, SK.bow, (k - 2.4) * 1.5);
        x = a + f * Math.min(1, k * 0.4) * 24;
      } else if (!q.prev && t < 0.8) { pose = t < 0 ? SK.start : mixP(SK.start, SK.glide, t / 0.8); f = 1; }
      else {
        const ph = (t - q.t0) / spb / 2;
        pose = mixP(SK.glide, SK.glide2, 0.5 + 0.5 * sin(ph * TAU));
        const ln = lastHitNote(P, t, -1);
        if (ln && t - ln.jt < 0.6) pose = mixP(pose, SK.spiral, sin(c01((t - ln.jt) / 0.6) * PI));
      }
      return { x, y, pose, f, lift };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir;
    if (e.a === 'jump' || e.a === 'jcombo') {
      const cmb = e.a === 'jcombo', endB = cmb ? 6.5 : 5;
      const J = cmb ? [[2, 3, e.ns], [3.5, 4.3, e.nt]] : [[2, 3, e.ns]];
      x = lerp(e.x0, e.x1, bt / endB);
      const lastLand = J[J.length - 1][1];
      if (bt < 2) { pose = mixP(SK.glide, SK.prep, bt / 2); f = bt < 0.8 ? e.dir : -e.dir; }
      else if (bt < lastLand) {
        let air = null;
        J.forEach(j => { if (bt >= j[0] && bt < j[1]) air = j; });
        f = -e.dir;
        if (air) {
          const u = (bt - air[0]) / (air[1] - air[0]);
          lift = arc(u) * (air === J[0] ? 30 : 22);
          pose = u < 0.15 ? mixP(SK.prep, SK.air, u / 0.15) : u > 0.82 ? mixP(SK.air, SK.land, (u - 0.82) / 0.18) : SK.air;
          f = flipF(-e.dir, c01((u - 0.08) / 0.8), air[2] + (air[2] % 1 ? 0 : 0));
          y = ICE_Y - lift;
        } else pose = mixP(SK.land, SK.prep, (bt - 3) / 0.5);
      } else {
        const k = bt - lastLand;
        f = -e.dir;
        if (res === 3) {
          if (k < 1.3) { pose = SK.slide; x = e.x1 + f * 0; }
          else pose = mixP(PS.crouch, SK.glide, (k - 1.3) * 1.2);
        } else if (res === 2) pose = k < 0.6 ? mixP(SK.land, SK.stumble, sin(k / 0.6 * PI)) : mixP(SK.land, SK.glide, (k - 0.6));
        else pose = k < 1 ? SK.land : mixP(SK.land, SK.glide, k - 1);
      }
    } else if (e.a === 'spin') {
      const n = P.notes[e.n0] || { c: 0, n: 1, t: e.t0 };
      const u = (bt - 0.5) / 3.5;
      x = lerp(e.x0, e.x1, sm(bt / 0.6));
      let sp = SK[e.v] || SK.camel;
      if (e.v === 'combo') sp = u < 0.33 ? SK.camel : u < 0.66 ? SK.sit : SK.upright;
      if (bt < 0.5) pose = mixP(SK.glide, sp, bt * 2);
      else if (bt < 4) {
        const prog = n.n ? n.c / n.n : 1;
        const ang = (t - e.t0) * (6 + 16 * Math.min(1, prog + 0.2)) + n.c * 0.8;
        f = cos(ang) >= 0 ? 1 : -1;
        pose = sp;
        if (e.res === 2 && e.q < 0.5) pose = mixP(sp, SK.upright, 0.4);
      } else pose = mixP(sp, SK.glide, (bt - 4) * 1.5);
    } else if (e.a === 'steps') {
      x = lerp(e.x0, e.x1, c01(bt / 5.6));
      let cnt = 0, last = null;
      for (let i = e.n0; i < e.n1; i++) { const n = P.notes[i]; if (n.j && n.jt <= t) { cnt++; last = n; } }
      f = cnt % 2 ? -e.dir : e.dir;
      const pz = { l: SK.twA, r: SK.twB, u: SK.twD, d: SK.twC };
      pose = last ? mixP(SK.glide, pz[last.b] || SK.twA, 1 - c01((t - last.jt - 0.15) / 0.3)) : SK.glide;
      if (last && last.j === 3) pose = mixP(pose, SK.stumble, 0.5);
    } else { x = e.x0; }
    return { x, y, pose, f, lift };
  }
  K.skate = {
    bpm: 104, sc: 'skate', bounds: [70, 410], x0: 110, gap: 2, maxGap: 3.5, drum: [1, 0, 0, 0], outro: 2.6,
    failTx: '넘어짐!', mashTx: '스핀!',
    subTx: el => '기본점 ' + el.bv.toFixed(2),
    plan(R, L) {
      const j1 = pickLv(R, SK_J1, L), cb = pickLv(R, SK_CB, L);
      const ax = L > 0.5 ? ['트리플 악셀', 8.0, 3.5] : ['더블 악셀', 3.3, 2.5];
      const sp = [SK_SP[0], SK_SP[1], R.chance(0.6) ? SK_SP[2] : SK_SP[3]];
      R.shuffle(sp);
      const jump = j => E('jump', j[0], j[1], 5, [[0, 'a', 'r', 2, 1]], { mv: 110, ns: Math.ceil(j[2]) });
      const spin = p => E('spin', p[0], p[1], 5, [[0.5, 'a', 'm', 3.5]], { mv: 16, v: p[2], nf: 1 });
      const sn = []; for (let b = 0; b < 5; b += 0.5) sn.push([b, '?', 't']);
      return [
        jump(j1), spin(sp[0]),
        E('jcombo', cb[0], cb[1], 6.5, [[0, 'a', 'r', 2, 1], [3.5, 'a', 't', 0, 1]], { mv: 150, ns: cb[2], nt: cb[3], link: 1 }),
        E('steps', L > 0.6 ? '스텝 시퀀스 (레벨4)' : '스텝 시퀀스 (레벨3)', L > 0.6 ? 3.9 : 3.3, 6, sn, { mv: 170, nf: 1 }),
        jump(ax), spin(sp[1]), spin(sp[2])
      ];
    },
    fill(R, beats) { const o = []; if (beats >= 1) o.push([Math.min(1, beats - 0.5), R.pick(['l', 'r', 'u']), 't']); return o; },
    hint: '{A} 누르고 → 떼는 순간 점프 · {A} 연타 = 스핀',
    stage(g, s, P, t) {
      g.grad(0, 0, 480, 106, '#05060e', '#151a33', 6);
      arenaBack(g, t, { cy: 16, ch: 78, excite: P ? Math.max(P.ex, s.phase === 'score' ? 0.8 : 0) : 0, top: '#05060e', mid: '#151a33', h: 106, dim: 'rgba(5,6,18,0.55)' });
      sweepSpots(g, t, 0, 196, ['#9fd8ff', '#ffffff', '#f6757a', '#ffffff', '#9fd8ff'], 0.06);
      // glass + boards
      g.rect(0, 90, 480, 14, 'rgba(190,225,255,0.10)');
      for (let x = 10; x < 480; x += 60) g.rect(x, 90, 1, 14, 'rgba(255,255,255,0.25)');
      g.rect(0, 104, 480, 18, '#f4f8ff'); g.rect(0, 104, 480, 2, '#1e4fa8'); g.rect(0, 120, 480, 2, '#c0cbdc');
      const ads = ['AICHI-NAGOYA', 'DOT GAMES 2026', 'ISU', 'PIXEL', 'MILANO-CORTINA'];
      for (let i = 0; i < 6; i++) { const x = 8 + i * 80; g.rect(x, 108, 64, 9, ['#e43b44', '#0099db', '#262b44', '#63c74d', '#b55088', '#f77622'][i]); g.text(ads[i % ads.length], x + 32, 108, '#fff', { size: 'xs', align: 'center', maxW: 60 }); }
      // ice
      g.grad(0, 122, 480, 100, '#bfe0f2', '#f0faff', 8);
      g.rect(0, 122, 480, 5, 'rgba(255,255,255,0.4)');
      for (let i = 0; i < 40; i++) { const x = H(i, 3, 3) * 480, y = 128 + H(i, 4, 4) * 90, w = 8 + H(i, 5, 5) * 30; g.line(x, y, x + w, y + (H(i, 6, 6) - 0.5) * 6, 'rgba(150,190,220,0.35)'); }
      for (let i = 0; i < 5; i++) { const x = 48 + i * 96 + sin(t * 0.3 + i) * 10; g.alpha(0.18); g.ellipse(x, 150, 22, 3, '#ffffff'); g.alpha(1); }
      g.alpha(0.25); g.ellipse(240, 172, 46, 9, '#7fb4d8'); g.alpha(1); g.ellipse(240, 172, 42, 7, '#d8eefa');
      g.text('2026', 240, 168, 'rgba(120,170,210,0.5)', { size: 'xs', align: 'center' });
      // flowers thrown at the end
      if (P && P.t > P.end - 2.4) drawFlowers(g, P, t);
    },
    actor(g, s, P, t) {
      const st = skatePose(P, t), ent = s.ents[P.idx], look = skLook(ent);
      const opt = { facing: st.f, scale: 2, anchor: 'feet' };
      // reflection
      g.save(); g.clip(0, ICE_Y, 480, 222 - ICE_Y); g.ctx.translate(0, ICE_Y * 2 + 2); g.ctx.scale(1, -1); g.alpha(0.16);
      g.figure(st.x, st.y, st.pose, look, opt); g.alpha(1); g.restore();
      g.alpha(0.25); g.ellipse(st.x, ICE_Y + 1, 12 - Math.min(8, st.lift / 4), 2, '#5a7a9a'); g.alpha(1);
      const J = fig(g, st.x, st.y, st.pose, look, opt);
      if (look.skirt && !st.pose.rot) skirt(g, J, look.skirt);
      // blades
      [J.ftL, J.ftR].forEach(ft => g.rect(ft[0] - 3, ft[1] + 2, 7, 1, '#e8eef4'));
      // sparkles
      for (let i = 0; i < 3; i++) { const k = H(i, Math.floor(g.t * 8), 1); if (k < 0.5) g.px(lerp(J.hip[0], J.neck[0], 0.2 + i * 0.3) + (k - 0.25) * 6, lerp(J.hip[1], J.neck[1], 0.2 + i * 0.3), '#ffffff'); }
    },
    onEl(s, P, el, res) {
      if (P.sim) return;
      if (el.a === 'jump' || el.a === 'jcombo') {
        const spb = 60 / this.bpm, lt = el.t0 + (el.a === 'jcombo' ? 4.3 : 3) * spb;
        P.fx.push({ k: 'spray', t0: M.round(Math.max(lt, P.t), 3), x: Math.round(lerp(el.x0, el.x1, (el.a === 'jcombo' ? 4.3 / 6.5 : 0.6))), y: ICE_Y, d: el.dir });
        if (P.fx.length > 14) P.fx.shift();
      }
      if (el.a === 'spin') addFx(P, 'spray', el.x1, ICE_Y, 0);
    }
  };
  function drawFlowers(g, P, t) {
    const t0 = P.end - 2.2;
    for (let i = 0; i < 14; i++) {
      const tl = t0 + i * 0.13 + H(i, 2, 2) * 0.3;
      const a = t - tl; if (a < 0) continue;
      const ox = 20 + H(i, 3, 1) * 440, ex = ox + (H(i, 4, 1) - 0.5) * 80, ey = 140 + H(i, 5, 1) * 70;
      const u = Math.min(1, a / 0.8);
      const x = lerp(ox, ex, u), y = lerp(100, ey, u) - arc(u) * 40;
      const teddy = H(i, 6, 1) < 0.2;
      if (teddy) { g.circle(x, y, 3, '#b86f50'); g.circle(x - 2, y - 3, 1.5, '#b86f50'); g.circle(x + 2, y - 3, 1.5, '#b86f50'); g.px(x, y, '#733e39'); }
      else {
        g.line(x, y, x + 3, y + 4, '#3e8948', 1);
        const c = ['#e43b44', '#f6757a', '#fee761', '#ffffff', '#b55088'][i % 5];
        g.rect(x - 2, y - 2, 4, 3, c); g.px(x - 1, y - 3, c); g.px(x + 1, y - 1, '#fff');
      }
    }
  }

  /* ================================ BEAM =============================== */
  const BEAM_Y = 150, BEAM_X0 = 92, BEAM_X1 = 388, MAT_Y = 210;
  K.beam = {
    bpm: 92, sc: 'gym', D0: 4.35, D1: 1.6, bounds: [118, 362], x0: 128, gap: 3, maxGap: 4, fallDed: 1, drum: [1, 0, 0, 0],
    failTx: '낙하!', hint: '기술: 화살표/{A} 타이밍 · 사이사이 {L}{R} 균형',
    look: ent => K.floor.look(ent),
    plan(R, L) {
      const ring = L > 0.5;
      const dis = pickLv(R, [['레이아웃 풀 내리기', 0.3, 'layout', 1, 1], ['더블 턱 내리기', 0.4, 'tuck', 2, 0], ['더블 피크 내리기', 0.5, 'pike', 2, 0], ['더블 레이아웃 내리기', 0.6, 'layout', 2, 0]], L);
      return [
        E('bleap', ring ? '스위치 링 리프' : '스플릿 리프', ring ? 0.3 : 0.1, 3, [[0, '>', 't'], [1, 'u', 't', 0, 1]], { mv: 50, v: ring ? 'ring' : 'split' }),
        E('bhs', '백 핸드스프링', 0.2, 3, [[0, 'd', 't'], [1, 'u', 't', 0, 1]], { mv: 45 }),
        E('bturn', L > 0.6 ? '더블 턴' : '풀 턴', L > 0.6 ? 0.3 : 0.1, 3, [[0, 'u', 'h', 1.5]], { mv: 0, nf: 1 }),
        E('aerial', '프론트 에어리얼', 0.4, 3, [[0, '>', 't'], [1, 'a', 't', 0, 1]], { mv: 45 }),
        E('series', L > 0.6 ? '백 핸드스프링 + 레이아웃' : '백 핸드스프링 + 백 턱', L > 0.6 ? 0.5 : 0.3, 4, [[0, 'd', 't'], [1, 'u', 't'], [2, 'a', 't', 0, 1]], { mv: 80, link: 1, ps: L > 0.6 ? 'layout' : 'tuck' }),
        E('wolf', '울프 턴', 0.2, 3, [[0, 'd', 'h', 1.5]], { mv: 0, nf: 1 }),
        E('bdis', dis[0], dis[1], 5, [[0, '>', 't'], [1, 'd', 't'], [2, 'a', 't', 0, 1], [3.5, 'd', 't', 0, 1]], { mvTo: 430, ps: dis[2], ns: dis[3], nt: dis[4] })
      ];
    },
    fill: null,
    hintFn(s, P) {
      const q = at(P, P.t);
      if (q.gap && q.next && P.t > 0 && !(P.fallT >= 0 && P.t - P.fallT < 2.2)) return '{L}{R} 균형 잡기! 바늘을 가운데로';
      return null;
    },
    tick(s, P, inp, dt, R) {
      const t = P.t; if (t < 0) return;
      const q = at(P, t);
      const fallen = P.fallT >= 0 && t - P.fallT < 2.2 && t >= P.fallT;
      if (q.gap && q.next && !fallen) {
        if (R.chance(dt * 1.1)) P.bv += R.sign() * R.range(0.25, 0.6);
        P.bv += (R.gauss() * 1.6 + P.bal * 1.6) * dt;
        if (inp) { if (inp.l) P.bv -= 3.6 * dt; if (inp.r) P.bv += 3.6 * dt; }
        else if (P.auto) P.bv -= (P.bal * 4 + P.bv * 1.2) * dt;
        P.bv *= 1 - 1.4 * dt;
        P.bal += P.bv * dt;
        if (abs(P.bal) > 0.62 && !P.wobF) {
          P.wobF = 1; P.wob++;
          if (!P.sim) { P.co = { tx: '흔들림! -0.1', c: PAL.orange, t0: t, sub: '' }; OG.sfx(s, 'miss'); }
        }
        if (abs(P.bal) < 0.3) P.wobF = 0;
        if (abs(P.bal) >= 1) {
          P.falls++; P.fallT = M.round(t, 3); P.bal = 0; P.bv = 0; P.combo = 0;
          if (!P.sim) { P.co = { tx: '낙하! -1.0', c: PAL.red, t0: t, sub: '' }; OG.sfx(s, 'crash'); P.shake = t; addFx(P, 'chalk', beamPose(P, t).x, MAT_Y, 0); }
        }
      } else { P.bal *= 1 - 3 * dt; P.bv = 0; }
      P.bal = M.round(P.bal, 4); P.bv = M.round(P.bv, 4);
    },
    simExtra(P, q, R) {
      for (let i = 1; i < P.els.length; i++) {
        if (R.chance(0.03 + 0.4 * (1 - q))) P.wob++;
        if (R.chance(0.15 * (1 - q) * (1 - q))) P.falls++;
      }
    },
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, banners: ['#b55088', '#0099db', '#feae34', '#63c74d', '#e43b44'] });
      scoreboard(g, 20, 30, 92, 26, '기계체조 · 평균대', t);
      if (P) g.text(OG.entLabel(s.ents[P.idx]) + '  D ' + (P.dLive || 0).toFixed(1), 66, 42, PAL.white, { size: 'xs', align: 'center' });
      g.adBoards(0, 110, 480, 12, t, ['AICHI-NAGOYA 2026', 'DOT GAMES', 'BALANCE BEAM', 'PIXEL SPORTS']);
      g.grad(0, 122, 480, 100, '#3a3f5c', '#2a2f4c', 4);
      // mats
      g.poly([60, 196, 420, 196, 446, 214, 34, 214], '#2a64c4');
      g.rect(34, 214, 412, 4, '#1e4fa8'); g.line(60, 196, 420, 196, '#5fb6f2');
      // beam legs
      [[132, 1], [348, -1]].forEach(([x, k]) => {
        g.rect(x - 2, BEAM_Y + 5, 5, 44, '#8b9bb4'); g.rect(x - 1, BEAM_Y + 5, 1, 44, '#c0cbdc');
        g.line(x, BEAM_Y + 28, x - 16, 202, '#8b9bb4', 3); g.line(x, BEAM_Y + 28, x + 16, 202, '#8b9bb4', 3);
        g.rect(x - 20, 200, 40, 4, '#5a6988');
      });
      // beam
      g.rect(BEAM_X0, BEAM_Y, BEAM_X1 - BEAM_X0, 6, '#d9b48a');
      g.rect(BEAM_X0, BEAM_Y, BEAM_X1 - BEAM_X0, 1, '#f2d8b4'); g.rect(BEAM_X0, BEAM_Y + 5, BEAM_X1 - BEAM_X0, 1, '#a07850');
      g.rect(BEAM_X0 - 1, BEAM_Y + 1, 1, 4, '#a07850'); g.rect(BEAM_X1, BEAM_Y + 1, 1, 4, '#a07850');
      g.alpha(0.25); g.rect(BEAM_X0 + 4, 204, BEAM_X1 - BEAM_X0 - 8, 3, '#000'); g.alpha(1);
    },
    actor(g, s, P, t) {
      const st = beamPose(P, t), ent = s.ents[P.idx], look = this.look(ent);
      if (st.y > BEAM_Y + 4) { g.alpha(0.25); g.ellipse(st.x, MAT_Y - 12, 12, 2, '#000'); g.alpha(1); }
      else { g.alpha(0.3); g.ellipse(st.x, BEAM_Y + 1, 7, 1, '#000'); g.alpha(1); }
      spotLight(g, st.x, BEAM_Y + 2, 0.08);
      fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
      // balance meter (in the lane while balancing)
      const q = at(P, t);
      if (s.phase === 'play' && q.gap && q.next && t > 0) {
        const cx = 240, w = 170, gy = 74;
        g.rect(cx - w / 2 - 30, gy - 4, w + 36, 16, 'rgba(12,10,26,0.8)');
        g.rect(cx - w / 2, gy, w, 8, '#3a4466');
        g.rect(cx - w / 2, gy, w * 0.19, 8, '#a22633'); g.rect(cx + w / 2 - w * 0.19, gy, w * 0.19, 8, '#a22633');
        g.rect(cx - w * 0.15, gy, w * 0.3, 8, '#3e8948');
        const nx = cx + P.bal * w / 2;
        g.rect(nx - 1, gy - 3, 3, 14, abs(P.bal) > 0.62 ? PAL.red : PAL.yellow);
        g.text('균형', cx - w / 2 - 4, gy - 1, abs(P.bal) > 0.62 ? PAL.red : PAL.white, { size: 'xs', align: 'right' });
        if (abs(P.bal) > 0.3) g.keycap(P.bal > 0 ? cx - w / 2 - 28 : cx + w / 2 + 4, gy - 2, P.bal > 0 ? 'L' : 'R');
      }
    },
    onEl(s, P, el, res) { if (!P.sim && res === 2 && el.a !== 'bdis') P.bv += (P.bal >= 0 ? 1 : -1) * 0.5; }
  };
  function beamPose(P, t) {
    const spb = 60 / K.beam.bpm, q = at(P, t);
    let x, y = BEAM_Y, pose = PS.stand, f = 1, rot = 0, anchor = 'feet', lift = 0;
    // fall override
    if (P.fallT >= 0 && t >= P.fallT && t - P.fallT < 2.2) {
      const k = t - P.fallT;
      const base = beamPoseNoFall(P, P.fallT, spb);
      x = base.x; f = base.f;
      if (k < 0.35) { y = lerp(BEAM_Y, MAT_Y - 4, sm(k / 0.35)); pose = mixP(PS.arms, PS.sit, k / 0.35); }
      else if (k < 1.5) { y = MAT_Y - 4; pose = k < 0.9 ? PS.sit : mixP(PS.sit, PS.stand, (k - 0.9) / 0.4); }
      else { const u = (k - 1.5) / 0.7; y = lerp(MAT_Y - 4, BEAM_Y, sm(u)) - arc(u) * 12; pose = mixP(PS.crouch, PS.arms, u); }
      return { x, y, pose, f, rot, anchor, lift };
    }
    return beamPoseNoFall(P, t, spb);
  }
  function beamPoseNoFall(P, t, spb) {
    const q = at(P, t);
    let x, y = BEAM_Y, pose = PS.stand, f = 1, rot = 0, anchor = 'feet', lift = 0;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = b > a + 2 ? 1 : b < a - 2 ? -1 : (q.next ? q.next.dir : 1);
      if (!q.next) { y = MAT_Y - 4; x = a; f = q.prev ? q.prev.dir : 1; pose = PS.salute; return { x, y, pose, f, rot, anchor, lift }; }
      if (!q.prev && t < 0) { // mount
        const k = t + 3;
        if (k < 1.0) { x = P.x0 - 34; y = MAT_Y - 4; pose = PS.salute; }
        else if (k < 1.7) { const u = (k - 1.0) / 0.7; x = lerp(P.x0 - 34, P.x0, u); y = lerp(MAT_Y - 4, BEAM_Y, sm(u)) - arc(u) * 16; pose = mixP(PS.crouch, PS.arms, u); }
        else { x = P.x0; pose = mixP(PS.arms, PS.salute, k - 1.7); }
        return { x, y, pose, f: 1, rot, anchor, lift };
      }
      const ph = (t - q.t0) / spb;
      const bal = P.bal || 0;
      pose = abs(b - a) > 8 ? mixP(Pose.walk(ph * 0.5 % 1), PS.arms, 0.6) : mixP(PS.arms, PS.present, 0.3 + 0.3 * sin(ph * 1.5));
      pose = Object.assign({}, pose);
      pose.t = (pose.t || 0) + bal * 0.55 * f;
      if (abs(bal) > 0.3) { const w = sin(t * 18) * abs(bal); pose.aL = 1.6 + w * 1.2 - bal * f; pose.aR = 1.6 - w * 1.2 + bal * f; pose.lR = (pose.lR || 0) + abs(bal) * 0.6; }
      return { x, y, pose, f, rot, anchor, lift };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = e.x0;
    const span = e.x1 - e.x0;
    if (e.a === 'bleap') {
      x = lerp(e.x0, e.x1, sm(bt / 2.2));
      const lp = e.v === 'ring' ? PS.ring : PS.split;
      if (bt < 1) pose = mixP(PS.stand, PS.hurdle, bt);
      else if (bt < 2) { const u = bt - 1; lift = arc(u) * 22; y = BEAM_Y - lift; pose = u < 0.15 ? mixP(PS.hurdle, lp, u / 0.15) : u > 0.85 ? mixP(lp, PS.land, (u - 0.85) / 0.15) : lp; }
      else pose = mixP(PS.land, PS.arms, (bt - 2) * 1.5);
    } else if (e.a === 'bturn' || e.a === 'wolf') {
      const wolfP = PZ(0.5, 2.6, 2.7, 0.2, 0.2, 1.5, 1.6, 0.0, 2.6);
      const tp = e.a === 'wolf' ? wolfP : PS.passe;
      if (bt < 0.4) pose = mixP(PS.arms, tp, bt / 0.4);
      else if (bt < 2) { pose = tp; f = flipF(e.dir, (bt - 0.4) / 1.6, e.bv > 0.2 ? 2 : 1); }
      else pose = mixP(tp, PS.arms, (bt - 2) * 1.5);
    } else if (e.a === 'bhs' || e.a === 'series') {
      f = -e.dir;
      const s1 = e.a === 'series';
      if (bt < 1) { pose = mixP(PS.arms, PZ(0.3, 2.8, 2.9, 0, 0, 0.8, 0.7, 1.3, 1.2), bt); }
      else if (bt < 2) {
        const u = bt - 1; x = e.x0 + span * (s1 ? 0.45 : 1) * sm(u);
        lift = arc(u) * 14; rot = e.dir * TAU * sm(u) * f; pose = PS.arched; anchor = 'hip'; y = BEAM_Y - 21 - lift;
      } else if (s1 && bt < 3) {
        const u = bt - 2; x = e.x0 + span * lerp(0.45, 1, u);
        lift = arc(u) * 34; rot = e.dir * TAU * sm(c01(u / 0.9)) * f;
        const ps = PS[e.ps] || PS.tuck;
        pose = u < 0.15 ? mixP(PS.arched, ps, u / 0.15) : u > 0.8 ? mixP(ps, PS.land, (u - 0.8) / 0.2) : ps;
        anchor = 'hip'; y = BEAM_Y + lerp(-21, LAND_HIP, c01((u - 0.8) / 0.2)) - lift;
      } else { x = e.x1; pose = res === 2 ? mixP(PS.land, PS.step, 0.6) : mixP(PS.land, PS.arms, (bt - (s1 ? 3 : 2)) * 1.4); }
    } else if (e.a === 'aerial') {
      if (bt < 1) { x = lerp(e.x0, e.x0 + span * 0.2, bt); pose = mixP(PS.stand, PS.hurdle, bt); }
      else if (bt < 2) {
        const u = bt - 1; x = e.x0 + span * lerp(0.2, 1, u);
        lift = arc(u) * 24; rot = e.dir * TAU * sm(c01(u / 0.9)) * f;
        pose = u > 0.8 ? mixP(PS.split, PS.land, (u - 0.8) / 0.2) : PS.split; anchor = 'hip'; y = BEAM_Y + lerp(-21, LAND_HIP, c01((u - 0.8) / 0.2)) - lift;
      } else { x = e.x1; pose = mixP(PS.land, PS.arms, (bt - 2) * 1.4); }
    } else if (e.a === 'bdis') {
      const endX = BEAM_X1 - 14;
      if (bt < 1) { x = lerp(e.x0, endX - 24, bt); pose = Pose.run(bt * 1.4 % 1, 0.4); }
      else if (bt < 2) {
        const u = bt - 1; x = lerp(endX - 24, endX, u);
        const th = TAU * sm(u); f = u < 0.25 ? e.dir : -e.dir; rot = e.dir * th * f; lift = arc(u) * 10;
        pose = PS.arched; anchor = 'hip'; y = BEAM_Y - 21 - lift;
      } else if (bt < 3.5) {
        const u = (bt - 2) / 1.5; x = lerp(endX, e.x1, u); f = -e.dir;
        lift = arc(u) * 40 + (1 - u) * (MAT_Y - 4 - BEAM_Y);
        if (e.nt) f = flipF(f, (u - 0.1) / 0.7, e.nt);
        rot = e.dir * TAU * e.ns * sm(c01(u / 0.9)) * f;
        const ps = PS[e.ps] || PS.tuck;
        pose = u < 0.12 ? mixP(PS.arched, ps, u / 0.12) : u > 0.8 ? mixP(ps, PS.land, (u - 0.8) / 0.2) : ps;
        anchor = 'hip'; y = MAT_Y - 4 + lerp(-21, LAND_HIP, c01((u - 0.8) / 0.2)) - lift;
      } else {
        x = e.x1; f = -e.dir; y = MAT_Y - 4; const k = bt - 3.5;
        pose = res === 3 ? PS.sit : res === 2 ? mixP(PS.land, PS.step, sin(c01(k) * PI)) : (k < 0.4 ? PS.land : mixP(PS.land, PS.salute, (k - 0.4) * 2));
        if (res === 2) x = e.x1 + e.dir * Math.min(1, k * 2) * 8;
      }
    }
    return { x, y, pose, f, rot, anchor, lift };
  }

  /* ================================ RINGS ============================== */
  const RG = { cx: 240, hy: 84, top: 18, mat: 208 };
  function menLook(ent) {
    const L = baseLook(ent), c = vivid(ent);
    return Object.assign(L, { shirt: c, pants: '#f4f4f8', tights: true, shoe: '#ffffff' });
  }
  function frontFig(g, cx, hy, o, look) {
    const sw = 7, arm = 17, torso = 16, leg = 22, hr = 5;
    const p = o.p, a = o.a;
    const tr = o.tr ? Math.round(sin(o.tt * 55) * o.tr) : 0;
    const Sy = hy + arm * cos(a) * p + tr;
    const hdx = sw + arm * sin(a) + (o.hw || 0);
    const hL = [cx - hdx, hy], hR = [cx + hdx, hy];
    const ap = Math.abs(p) < 0.22 ? (p < 0 ? -0.22 : 0.22) : p;
    const hipY = Sy + torso * ap;
    const lp = o.lp == null ? 1 : o.lp;
    const footY = hipY + leg * ap * lp;
    const sp = o.sp || 1;
    const pants = look.pants, shirt = look.shirt, skin = look.skin;
    // legs
    const fL = cx - 3 - sp, fR = cx + 3 + sp;
    g.line(cx - 3, hipY, fL, footY, OG.shade(pants, -0.12), 4);
    g.line(cx + 3, hipY, fR, footY, pants, 4);
    if (abs(lp) < 0.5) { g.rect(fL - 2, footY - 2, 5, 4, look.shoe); g.rect(fR - 2, footY - 2, 5, 4, look.shoe); }
    else { g.rect(fL - 2, footY + (ap > 0 ? 0 : -2), 4, 2, look.shoe); g.rect(fR - 1, footY + (ap > 0 ? 0 : -2), 4, 2, look.shoe); }
    // torso
    g.poly([cx - sw - 1, Sy - ap, cx + sw + 1, Sy - ap, cx + 5, hipY, cx - 5, hipY], shirt);
    g.rect(cx - 5, hipY - (ap > 0 ? 1 : -1), 11, 3, OG.shade(pants, -0.05));
    g.line(cx - sw, Sy, cx + sw, Sy, OG.shade(shirt, 0.2), 1);
    // arms
    const elL = [lerp(cx - sw, hL[0], 0.5), lerp(Sy, hL[1], 0.5)], elR = [lerp(cx + sw, hR[0], 0.5), lerp(Sy, hR[1], 0.5)];
    if (o.bend) { elL[0] -= o.bend; elR[0] += o.bend; }
    g.line(cx - sw, Sy, elL[0], elL[1], skin, 4); g.line(elL[0], elL[1], hL[0], hL[1], skin, 3);
    g.line(cx + sw, Sy, elR[0], elR[1], skin, 4); g.line(elR[0], elR[1], hR[0], hR[1], skin, 3);
    // head
    const hyy = Sy - (hr + 3) * (p >= 0 ? 1 : -1);
    g.rect(cx - 1, Math.min(Sy, hyy), 3, abs(hyy - Sy), skin);
    g.circle(cx, hyy, hr, skin);
    const hair = look.hair;
    if (p >= 0) { g.rect(cx - hr, hyy - hr, hr * 2 + 1, 3, hair); g.px(cx - hr, hyy - 2, hair); g.px(cx + hr, hyy - 2, hair); }
    else { g.rect(cx - hr, hyy + hr - 2, hr * 2 + 1, 3, hair); }
    if (p >= 0) { g.px(cx - 2, hyy, '#181425'); g.px(cx + 2, hyy, '#181425'); }
    return { hL, hR, Sy, hipY, footY };
  }
  function ringsDraw(g, hL, hR, look) {
    const top = RG.top;
    [[RG.cx - 13, hL], [RG.cx + 13, hR]].forEach(([ax, h]) => {
      g.line(ax, top + 2, h[0], h[1] - 7, '#262b44', 1); g.line(ax + 1, top + 2, h[0] + 1, h[1] - 7, '#5a6988', 1);
      g.circleO(h[0], h[1] - 3, 4, '#c88a50'); g.circleO(h[0], h[1] - 3, 3, '#e4a672');
    });
  }
  function ringsState(P, t) {
    const spb = 60 / K.rings.bpm, q = at(P, t);
    const o = { p: 1, a: 0, lp: 1, sp: 1, tr: 0, tt: t };
    const hang = () => { o.p = cos(0.12 * sin(t * 2.4)); };
    if (q.gap) {
      hang();
      if (!q.next) { // after dismount: stand on mat
        const d = q.prev && q.prev.a === 'rdis' ? q.prev : null;
        return { side: 1, x: RG.cx + (d ? d.dir : 1) * 70, y: RG.mat, pose: PS.salute, f: d ? -d.dir : 1, rot: 0, anchor: 'feet', o };
      }
      if (!q.prev && t < -1.6) return { side: 1, x: RG.cx, y: RG.mat, pose: PS.salute, f: 1, rot: 0, anchor: 'feet', o };
      if (!q.prev && t < -0.9) { // jump up to rings
        const u = (t + 1.6) / 0.7; o.p = 1; o.a = 0;
        return { side: 1, x: RG.cx, y: lerp(RG.mat, RG.hy + 66, sm(u)), pose: PS.salute, f: 1, rot: 0, anchor: 'feet', o };
      }
      const ln = lastHitNote(P, t, -1);
      if (ln && t - ln.jt < 0.6) o.p = cos(0.9 * sin(c01((t - ln.jt) / 0.6) * PI));
      return { o };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    const kfs = (fr, u) => { if (u <= fr[0][0]) return fr[0][1]; for (let i = 1; i < fr.length; i++) if (u <= fr[i][0]) { const A = fr[i - 1], B = fr[i]; return lerp(A[1], B[1], sm((u - A[0]) / (B[0] - A[0]))); } return fr[fr.length - 1][1]; };
    if (e.a === 'swingHS' || e.a === 'giant') {
      if (e.a === 'giant') { o.p = cos(PI * Math.min(bt, 4)); }
      else o.p = cos(kfs([[0, 0], [0.5, 0.8], [1, 0.1], [1.5, 1.7], [2, 0.3], [2.6, 2.4], [3, PI], [3.6, PI], [4.2, 0]], bt));
      if (res === 3 && bt > 2.6) { o.p = cos(kfs([[2.6, 2.0], [3.2, 0.6], [4, 0]], bt)); o.bend = 3; }
    } else if (e.a === 'cross' || e.a === 'lcross' || e.a === 'maltese' || e.a === 'invcross') {
      const inv = e.a === 'invcross';
      const n = P.notes[e.n0] || {};
      const failT = (n.j === 3 || n.j === 2) ? n.jt : 99;
      if (!inv) {
        o.a = kfs([[0, 0], [0.5, PI], [1.2, PI / 2], [3.5, PI / 2], [4.2, PI], [5, 0]], bt);
        o.p = 1;
        if (e.a === 'lcross') o.lp = kfs([[0.8, 1], [1.4, 0.18], [3.5, 0.18], [4.2, 1]], bt);
        if (e.a === 'maltese') o.p = kfs([[0.8, 1], [1.4, 0.15], [3.5, 0.15], [4.2, 1]], bt);
      } else {
        const th = kfs([[0, 0], [0.5, 1.6], [1, PI], [4, PI], [5, 0]], bt);
        o.p = cos(th);
        o.a = kfs([[1, 0], [1.6, PI / 2], [3.5, PI / 2], [4, 0]], bt);
      }
      if (bt > 1.2 && bt < 3.6) o.tr = 0.4;
      if (t > failT && n.j === 3) { const k = c01((t - failT) / 0.5); o.a = lerp(o.a, 0, k); o.p = inv ? lerp(o.p, 1, k) : o.p; o.tr = 1.5 * (1 - k); o.lp = 1; }
      else if (t > failT && n.j === 2 && t - failT < 0.8) o.tr = 1.2;
    } else if (e.a === 'rdis') {
      const rel = 2, land = 4;
      if (bt < rel) { o.p = cos(kfs([[0, 0], [0.5, 1.0], [1, 0.2], [1.5, 2.0], [2, 2.6]], bt)); return { o }; }
      const lx = RG.cx + e.dir * 70;
      if (bt < land) {
        const u = (bt - rel) / (land - rel);
        const x = lerp(RG.cx, lx, u), hipY = lerp(RG.hy - 6, RG.mat - 22, u) - arc(u) * 46;
        let f = -e.dir;
        if (e.nt) f = flipF(f, (u - 0.1) / 0.7, e.nt);
        const rot = e.dir * TAU * e.ns * sm(c01(u / 0.9)) * f;
        const ps = PS[e.ps] || PS.tuck;
        const pose = u < 0.1 ? mixP(PS.straight || PS.layout, ps, u / 0.1) : u > 0.8 ? mixP(ps, PS.land, (u - 0.8) / 0.2) : ps;
        return { side: 1, x, y: hipY + (u > 0.8 ? (LAND_HIP + 21) * (u - 0.8) / 0.2 : 0), pose, f, rot, anchor: 'hip', o, empty: 1 };
      }
      const k = bt - land;
      const pose = res === 3 ? PS.sit : res === 2 ? mixP(PS.land, PS.step, sin(c01(k) * PI)) : (k < 0.5 ? PS.land : mixP(PS.land, PS.salute, (k - 0.5) * 2));
      return { side: 1, x: lx + (res === 2 ? e.dir * Math.min(1, k * 2) * 8 : 0), y: RG.mat, pose, f: -e.dir, rot: 0, anchor: 'feet', o, empty: 1 };
    }
    return { o };
  }
  K.rings = {
    bpm: 104, sc: 'gym', D0: 4.4, D1: 1.6, bounds: [240, 240], x0: 240, gap: 2, maxGap: 3, fallDed: 0.8, fallTx: '실패', drum: [1, 0, 1, 0],
    failTx: '실패!',
    look: menLook,
    plan(R, L) {
      const dis = pickLv(R, [['더블 턱 내리기', 0.3, 'tuck', 2, 0], ['더블 레이아웃 내리기', 0.4, 'layout', 2, 0], ['더블 더블 내리기', 0.5, 'tuck', 2, 2], ['더블 레이아웃 풀인 내리기', 0.6, 'layout', 2, 1]], L);
      const str = pickLv(R, [['cross', '아이언 크로스', 0.3], ['lcross', 'L자 크로스', 0.4], ['maltese', '말테제', 0.6]], L);
      const hold = (a, nm, bv) => E(a, nm, bv, 5, a === 'invcross' ? [[0, 'u', 't'], [1, 'd', 'h', 2.5, 1]] : [[0.5, 'u', 't'], [1.2, 'd', 'h', 2.3, 1]], { nf: 0 });
      return [
        E('swingHS', '스윙 → 물구나무', 0.2, 4.2, [[0, 'd', 't'], [1, 'u', 't'], [2, 'd', 't'], [3, 'u', 't', 0, 1]]),
        hold('cross', '아이언 크로스', 0.3),
        E('giant', '자이언트 스윙', 0.2, 4, [[0, 'd', 't'], [1, 'u', 't'], [2, 'd', 't'], [3, 'u', 't']], { nf: 1 }),
        hold('invcross', '인버티드 크로스', 0.4),
        hold(str[0], str[1], str[2]),
        E('swingHS', '야마와키 → 물구나무', 0.3, 4.2, [[0, 'd', 't'], [1, 'u', 't'], [2, 'd', 't'], [3, 'u', 't', 0, 1]]),
        E('rdis', dis[0], dis[1], 6, [[0, 'd', 't'], [1, 'u', 't'], [2, 'a', 't', 0, 1], [4, 'd', 't', 0, 1]], { ps: dis[2], ns: dis[3], nt: dis[4], mv: 0, dir: 1 })
      ];
    },
    fill(R, beats) { const o = []; if (beats >= 0.9) o.push([0.5, R.pick(['u', 'd']), 't']); return o; },
    hint: '{D} 꾹 = 크로스 버티기 · {A} 이탈 · {D} 착지',
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, banners: ['#0099db', '#e43b44', '#feae34', '#63c74d', '#ffffff'] });
      scoreboard(g, 20, 30, 92, 26, '기계체조 · 링', t);
      if (P) g.text(OG.entLabel(s.ents[P.idx]) + '  D ' + (P.dLive || 0).toFixed(1), 66, 42, PAL.white, { size: 'xs', align: 'center' });
      g.adBoards(0, 112, 480, 12, t, ['AICHI-NAGOYA 2026', 'DOT GAMES', 'STILL RINGS', 'PIXEL SPORTS']);
      g.grad(0, 124, 480, 98, '#3a3f5c', '#2a2f4c', 4);
      // frame
      g.rect(150, RG.mat + 6, 180, 4, '#5a6988');
      [[166, 196], [314, 284]].forEach(([b, tp]) => { g.line(b, 214, tp, RG.top, '#8b9bb4', 3); g.line(b + (b < 240 ? -18 : 18), 214, tp, RG.top, '#5a6988', 2); });
      g.rect(180, RG.top - 2, 120, 4, '#8b9bb4'); g.rect(180, RG.top - 2, 120, 1, '#c0cbdc');
      // landing mat
      g.poly([140, 200, 340, 200, 356, 214, 124, 214], '#2a64c4'); g.rect(124, 214, 232, 4, '#1e4fa8'); g.line(140, 200, 340, 200, '#5fb6f2');
    },
    actor(g, s, P, t) {
      const st = ringsState(P, t), ent = s.ents[P.idx], look = this.look(ent);
      spotLight(g, RG.cx, 206, 0.07);
      if (st.side) {
        // empty rings swinging
        const sw = sin(t * 3) * 3 * (st.empty ? 1 : 0.3);
        ringsDraw(g, [RG.cx - 13 + sw, RG.hy], [RG.cx + 13 + sw, RG.hy], look);
        g.alpha(0.25); g.ellipse(st.x, RG.mat + 1, 11, 2, '#000'); g.alpha(1);
        fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
        return;
      }
      const o = st.o;
      const sw = 7, arm = 17;
      const hdx = sw + arm * sin(o.a);
      ringsDraw(g, [RG.cx - hdx, RG.hy], [RG.cx + hdx, RG.hy], look);
      g.alpha(0.2); g.ellipse(RG.cx, RG.mat + 1, 12, 2, '#000'); g.alpha(1);
      frontFig(g, RG.cx, RG.hy, o, look);
    },
    onEl(s, P, el, res) {
      if (el.a === 'rdis') {
        const spb = 60 / this.bpm;
        if (!P.sim) { P.fx.push({ k: 'chalk', t0: M.round(Math.max(P.t, el.t0 + 4 * spb), 3), x: RG.cx + el.dir * 70, y: RG.mat, d: 0 }); if (P.fx.length > 14) P.fx.shift(); }
      }
    }
  };

  /* =============================== POMMEL ============================== */
  const PH = { cx: 240, top: 150, py: 143, floor: 210 };
  function pommelFig(g, cx, o, look) {
    const phi = o.phi, sp = o.sp || 0, hs = o.hs || 0;
    const S = [cx - cos(phi) * 4 * (1 - hs), lerp(127, 125, hs)];
    const hip = [S[0] - cos(phi) * 7 * (1 - hs), lerp(141, 109, hs) + (o.sag || 0)];
    const legs = [];
    const proj = (dx, dz) => [dx, dz * -0.22];
    const L = 26;
    if (hs > 0.5) { legs.push([hip[0] - 2, hip[1] - 22, -1]); legs.push([hip[0] + 2, hip[1] - 22, -1]); }
    else {
      const angs = o.scissor != null ? [PI / 2 + o.scissor, -PI / 2 + o.scissor] : sp ? [phi + sp, phi - sp] : [phi + 0.06, phi - 0.06];
      angs.forEach(a => { const pr = proj(cos(a) * L, sin(a) * L); legs.push([hip[0] + pr[0], hip[1] + 2 + pr[1] + (o.sag || 0) * 1.5, sin(a)]); });
    }
    const pants = look.pants, skin = look.skin, shirt = look.shirt;
    const drawLegs = far => legs.forEach((l, i) => {
      if ((l[2] > 0) !== far) return;
      const c = far ? OG.shade(pants, -0.25) : pants;
      g.line(hip[0] + (i ? 2 : -2), hip[1], l[0], l[1], c, far ? 4 : 5);
      g.rect(l[0] - 2, l[1] - 2, 4, 4, look.shoe);
    });
    return { S, hip, drawLegs, draw() {
      g.poly([S[0] - 8, S[1], S[0] + 8, S[1], hip[0] + 5, hip[1], hip[0] - 5, hip[1]], shirt);
      g.rect(hip[0] - 5, hip[1] - 1, 11, 3, OG.shade(pants, -0.05));
      g.line(S[0] - 7, S[1], cx - 17, PH.py, skin, 4); g.line(S[0] + 7, S[1], cx + 17, PH.py, skin, 4);
      const hyy = S[1] - 8 * (hs > 0.5 ? -1 : 1);
      g.circle(S[0], hyy, 5, skin);
      if (hs > 0.5) g.rect(S[0] - 5, hyy + 3, 11, 3, look.hair);
      else { g.rect(S[0] - 5, hyy - 5, 11, 3, look.hair); g.px(S[0] - 2, hyy, '#181425'); g.px(S[0] + 2, hyy, '#181425'); }
    } };
  }
  function pommelState(P, t) {
    const spb = 60 / K.pommel.bpm, hb = spb / 2, q = at(P, t);
    const phi = PI - (t / hb) * (PI / 2);
    const o = { phi, sp: 0, hs: 0, sag: 0 };
    // recent miss → sag
    for (let i = P.notes.length - 1; i >= 0; i--) { const n = P.notes[i]; if (n.j === 3 && n.jt <= t && t - n.jt < 0.35) { o.sag = 5 * (1 - (t - n.jt) / 0.35); break; } if (n.t < t - 1) break; }
    if (P.fallT >= 0 && t >= P.fallT && t - P.fallT < 2) {
      const k = t - P.fallT;
      if (k < 1.3) return { side: 1, x: PH.cx - 40, y: PH.floor, pose: k < 0.7 ? PS.sad : PS.stand, f: 1, rot: 0, anchor: 'feet', o };
      const u = (k - 1.3) / 0.7;
      return { side: 1, x: lerp(PH.cx - 40, PH.cx, u), y: lerp(PH.floor, PH.py + 30, sm(u)) - arc(u) * 8, pose: PS.salute, f: 1, rot: 0, anchor: 'feet', o };
    }
    if (q.gap) {
      if (!q.next) {
        const d = q.prev; return { side: 1, x: PH.cx + 76, y: PH.floor, pose: PS.salute, f: -1, rot: 0, anchor: 'feet', o };
      }
      if (!q.prev && t < -1.4) return { side: 1, x: PH.cx - 34, y: PH.floor, pose: PS.salute, f: 1, rot: 0, anchor: 'feet', o };
      if (!q.prev && t < 0) { const u = c01((t + 1.4) / 0.6); if (u < 1) return { side: 1, x: lerp(PH.cx - 34, PH.cx, u), y: lerp(PH.floor, PH.py + 30, sm(u)), pose: PS.armsUp || PS.salute, f: 1, rot: 0, anchor: 'feet', o }; }
      return { o };
    }
    const e = q.e, bt = (t - e.t0) / spb;
    if (e.a === 'flair') o.sp = 0.6;
    if (e.a === 'magyar') o.cx = lerp(e.x0, e.x1, bt / 4);
    if (e.a === 'scissor') { o.scissor = sin(bt * PI) * 0.6; }
    if (e.a === 'russian') o.tw = 1;
    if (e.a === 'pdis') {
      if (bt < 2.5) { o.hs = sm(bt / 2); if (P.notes[e.n0] && P.notes[e.n0].j === 3) o.hs = Math.min(o.hs, 0.4); return { o }; }
      const lx = PH.cx + 76;
      if (bt < 3.5) {
        const u = bt - 2.5;
        const rot = PI * (1 - sm(u)) * (u < 0.5 ? 1 : 1);
        return { side: 1, x: lerp(PH.cx + 10, lx, u), y: lerp(PH.py - 30, PH.floor - 22, sm(u)) - arc(u) * 10, pose: mixP(PS.layout, PS.land, u), f: u < 0.5 ? 1 : -1, rot: (u < 0.5 ? 1 : -1) * rot, anchor: 'hip', o };
      }
      const k = bt - 3.5, res = e.res;
      const pose = res === 3 ? PS.sit : res === 2 ? mixP(PS.land, PS.step, sin(c01(k) * PI)) : (k < 0.5 ? PS.land : mixP(PS.land, PS.salute, (k - 0.5) * 2));
      return { side: 1, x: lx, y: PH.floor, pose, f: -1, rot: 0, anchor: 'feet', o };
    }
    return { o };
  }
  K.pommel = {
    bpm: 100, sc: 'gym', D0: 4.45, D1: 1.6, bounds: [216, 264], x0: 240, gap: 1.5, maxGap: 2.5, fallDed: 1, drum: [1, 0, 1, 0],
    failTx: '말에서 떨어짐!',
    look: menLook,
    plan(R, L) {
      const circ = (a, nm, bv, extra) => { const n = []; for (let b = 0; b < 4; b += 0.5) n.push([b, '@', 't']); return E(a, nm, bv, 4, n, extra); };
      return [
        circ('circ', '플랭크 원 돌기', 0.2),
        circ('flair', '토마스 플레어', 0.4),
        E('scissor', '시저스', 0.2, 3, [[0, 'l', 't'], [1, 'r', 't'], [2, 'l', 't']], { nf: 1 }),
        circ('magyar', L > 0.6 ? '마자르 이동' : '이동 원 돌기', L > 0.6 ? 0.4 : 0.2, { mv: 40 }),
        circ('russian', L > 0.5 ? '러시안 1080°' : '러시안 720°', L > 0.5 ? 0.4 : 0.3),
        circ('flair', '플레어 + 핸드스탠드', L > 0.7 ? 0.5 : 0.3, { link: 1 }),
        E('pdis', '물구나무 내리기', L > 0.6 ? 0.4 : 0.3, 5, [[0, 'u', 'h', 2, 1], [2.5, 'a', 't', 0, 1], [3.5, 'd', 't', 0, 1]])
      ];
    },
    fill(R, beats) { const o = []; for (let b = 0; b < beats; b += 0.5) o.push([b, '@', 't']); return o; },
    hint: '다리 방향 = 버튼: {L} 왼쪽 {U} 뒤 {R} 오른쪽 {D} 앞 (원 돌기)',
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, banners: ['#63c74d', '#e43b44', '#0099db', '#feae34', '#b55088'] });
      scoreboard(g, 20, 30, 92, 26, '기계체조 · 안마', t);
      if (P) g.text(OG.entLabel(s.ents[P.idx]) + '  D ' + (P.dLive || 0).toFixed(1), 66, 42, PAL.white, { size: 'xs', align: 'center' });
      g.adBoards(0, 110, 480, 12, t, ['AICHI-NAGOYA 2026', 'DOT GAMES', 'POMMEL HORSE', 'PIXEL SPORTS']);
      g.grad(0, 122, 480, 100, '#3a3f5c', '#2a2f4c', 4);
      g.poly([110, 200, 370, 200, 392, 216, 88, 216], '#2a64c4'); g.line(110, 200, 370, 200, '#5fb6f2');
      // legs
      [210, 270].forEach(x => { g.rect(x - 3, 166, 6, 40, '#8b9bb4'); g.rect(x - 2, 166, 1, 40, '#c0cbdc'); g.rect(x - 12, 204, 24, 4, '#5a6988'); });
    },
    actor(g, s, P, t) {
      const st = pommelState(P, t), ent = s.ents[P.idx], look = this.look(ent);
      const cx = st.o.cx || PH.cx;
      spotLight(g, PH.cx, 206, 0.07);
      let pf = null;
      if (!st.side) { pf = pommelFig(g, cx, st.o, look); pf.drawLegs(true); }
      // horse body
      g.rect(172, PH.top, 136, 16, '#6b3b26'); g.circle(172, PH.top + 8, 8, '#6b3b26'); g.circle(308, PH.top + 8, 8, '#6b3b26');
      g.rect(170, PH.top, 140, 3, '#8a5236'); g.rect(172, PH.top + 13, 136, 3, '#4e2a1b');
      for (let x = 176; x < 306; x += 6) g.px(x, PH.top + 8, '#8a5236');
      // pommels
      [PH.cx - 17, PH.cx + 17].forEach(x => { g.rect(x - 6, PH.top - 1, 2, 2, '#c0cbdc'); g.rect(x + 4, PH.top - 1, 2, 2, '#c0cbdc'); g.rect(x - 5, PH.py - 1, 10, 3, '#f4f4f8'); g.rect(x - 6, PH.py, 2, 6, '#e0e0e8'); g.rect(x + 4, PH.py, 2, 6, '#e0e0e8'); });
      if (pf) { pf.draw(); pf.drawLegs(false); }
      else { g.alpha(0.25); g.ellipse(st.x, PH.floor + 1, 11, 2, '#000'); g.alpha(1); fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor }); }
    }
  };

  /* ============================== RHYTHMIC ============================= */
  const RY = 196;
  const RHP = {
    chasse: PZ(0.0, 2.7, 1.3, 0.2, 0.2, 0.7, -0.6, 0.3, 0.2),
    chasse2: PZ(-0.05, 2.0, 2.2, 0.2, 0.4, -0.3, 0.5, 0.1, 0.6),
    walkB: PZ(-0.1, 1.2, 2.9, 0.3, 0.1, -0.2, 0.3, 0.1, 0.1),
    penche: PZ(1.45, 1.2, 2.6, 0.1, 0.1, 0.0, -2.95, 0, 0.0),
    attitude: PZ(-0.15, 2.9, 2.3, 0.3, 0.2, 0.0, -1.4, 0, 1.3),
    reach: PZ(-0.1, 3.0, 2.0, 0.1, 0.2, 0.05, -0.5, 0, 0.2),
    pose0: PZ(-0.2, 3.0, 2.2, 0.2, 0.3, 0.05, -0.7, 0, 0.6),
    pickup: PZ(1.2, 1.2, 1.4, 0.2, 0.2, 0.9, 0.6, 1.4, 1.2),
    fin: PZ(-0.35, 2.9, 1.0, 0.1, 0.3, 1.5, -0.2, 2.7, 2.3)
  };
  const RIB = ['#e43b44', '#feae34', '#2ce8f5', '#ff0044', '#63c74d', '#b55088', '#fee761', '#0099db'];
  function rgPose(P, t) {
    const spb = 60 / K.rhythmic.bpm, q = at(P, t);
    let x, y = RY, pose = RHP.chasse, f = 1, rot = 0, anchor = 'feet', mode = 'snake', stick = null;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = b > a + 2 ? 1 : b < a - 2 ? -1 : (q.next ? q.next.dir : 1);
      const k = (t - q.t0) / spb;
      if (!q.next) { pose = k < 1 ? mixP(RHP.chasse, RHP.fin, k) : RHP.fin; f = q.prev ? q.prev.dir : 1; mode = k < 1 ? 'circle' : 'rest'; }
      else if (!q.prev && t < 0.3) { pose = RHP.pose0; mode = 'rest'; f = 1; }
      else { const ph = (t - q.t0) / spb / 2; pose = mixP(RHP.chasse, RHP.chasse2, 0.5 + 0.5 * sin(ph * TAU)); y = RY - arc(ph * 2 % 1) * 4; mode = 'snake'; }
      return { x, y, pose, f, rot, anchor, mode, stick };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = lerp(e.x0, e.x1, c01(bt / ((e.t1 - e.t0) / spb)));
    if (e.a === 'rspiral') { const ph = bt / 2; pose = mixP(RHP.chasse, RHP.chasse2, 0.5 + 0.5 * sin(ph * TAU)); y = RY - arc(bt % 1) * 7; mode = 'spiral'; }
    else if (e.a === 'rsnake') { pose = mixP(RHP.walkB, RHP.reach, 0.5 + 0.5 * sin(bt * PI)); f = -e.dir; mode = 'snake'; }
    else if (e.a === 'rleap') {
      const lp = e.v === 'ring' ? PS.ring : PS.split;
      if (bt < 1) pose = mixP(RHP.chasse, PS.hurdle, bt);
      else if (bt < 2) { const u = bt - 1; y = RY - arc(u) * 28; pose = u < 0.15 ? mixP(PS.hurdle, lp, u / 0.15) : u > 0.85 ? mixP(lp, PS.land, (u - 0.85) / 0.15) : lp; }
      else pose = mixP(PS.land, RHP.chasse, (bt - 2) * 1.5);
      mode = 'circle';
    } else if (e.a === 'rpivot') {
      x = e.x0; const n = P.notes[e.n0 + 1] || P.notes[e.n0];
      if (bt < 0.5) pose = mixP(RHP.chasse, RHP.attitude, bt * 2);
      else if (bt < 3) { pose = RHP.attitude; const ang = (t - e.t0) * 10 + (n ? n.c : 0) * 1.2; f = cos(ang) >= 0 ? 1 : -1; if (res === 2 && e.q < 0.5) pose = mixP(RHP.attitude, PS.stand, 0.5); }
      else pose = mixP(RHP.attitude, RHP.chasse, (bt - 3) * 2);
      mode = 'spin';
    } else if (e.a === 'rthrow') {
      const tThrow = e.t0, tCatch = e.t0 + 3 * spb;
      const caught = !(res === 3);
      if (bt < 0.4) { pose = mixP(RHP.chasse, PS.salute, bt / 0.4); mode = 'circle'; }
      else if (bt < 3) {
        // roll under the apparatus
        const u = (bt - 0.4) / 2.6;
        if (u < 0.2) pose = mixP(PS.salute, PS.crouch, u / 0.2);
        else if (u < 0.65) { pose = PS.tuck; rot = e.dir * TAU * sm((u - 0.2) / 0.45); anchor = 'hip'; y = RY - 12; }
        else pose = mixP(PS.crouch, RHP.reach, (u - 0.65) / 0.35);
        mode = 'air';
      } else { pose = caught ? (bt < 3.6 ? mixP(PS.salute, RHP.chasse, (bt - 3) / 0.6) : RHP.chasse) : (bt < 3.8 ? RHP.pickup : RHP.chasse); mode = caught ? 'circle' : (bt < 3.8 ? 'drop' : 'snake'); }
      // stick flight
      if (bt >= 0.4 && bt < 3) {
        const u = (bt - 0.4) / 2.6;
        const sx0 = lerp(e.x0, e.x1, 0.4 / 4) + f * 6, sx1 = lerp(e.x0, e.x1, 3 / 4) + f * 6;
        stick = [lerp(sx0, sx1, u), RY - 46 - arc(u) * 110, u * 14];
      } else if (!caught && bt >= 3 && bt < 3.8) stick = [lerp(e.x0, e.x1, 0.8) + f * 22, RY - 2, 1.6, 1];
    } else if (e.a === 'rbal') { x = e.x0; pose = bt < 0.5 ? mixP(RHP.chasse, RHP.penche, bt * 2) : bt < 2.6 ? RHP.penche : mixP(RHP.penche, RHP.chasse, (bt - 2.6) * 2); mode = 'snake'; }
    else if (e.a === 'rillu') {
      if (bt < 1) pose = mixP(RHP.chasse, RHP.penche, bt);
      else if (bt < 2) { const u = bt - 1; pose = RHP.penche; rot = e.dir * TAU * sm(u) * f * 0.999; }
      else pose = mixP(RHP.penche, RHP.chasse, bt - 2);
      mode = 'spiral';
    }
    return { x, y, pose, f, rot, anchor, mode, stick };
  }
  function rgTip(P, t) {
    const st = rgPose(P, t);
    if (st.stick) return [st.stick[0] + cos(st.stick[2]) * 8, st.stick[1] + sin(st.stick[2]) * 8];
    const J = fk(st.x, st.y, st.pose, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
    const h = J.hdR, el = J.elR;
    let dx = h[0] - el[0], dy = h[1] - el[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const tip = [h[0] + dx * 11, h[1] + dy * 11];
    if (st.mode === 'spiral') { tip[0] += cos(t * 16) * 7; tip[1] += sin(t * 16) * 7; }
    else if (st.mode === 'snake') tip[1] += sin(t * 13) * 7;
    else if (st.mode === 'circle') { tip[0] += cos(t * 7) * 15; tip[1] += sin(t * 7) * 12; }
    else if (st.mode === 'spin') { tip[0] += cos(t * 11) * 18; tip[1] += 6 + sin(t * 22) * 3; }
    return tip;
  }
  K.rhythmic = {
    bpm: 116, sc: 'rhythmic', bounds: [80, 400], x0: 100, gap: 2, maxGap: 3, drum: [1, 0, 1, 0], failTx: '수구 떨어뜨림!',
    look(ent) {
      const L = baseLook(ent), c = vivid(ent);
      return Object.assign(L, { shirt: c, pants: c, sleeves: !!(ent.look & 2), bun: true, bunC: '#fee761', shoe: L.skin });
    },
    plan(R, L) {
      const ring = L > 0.5;
      return [
        E('rspiral', '리본 나선 + 샤세', 0.3, 4, [[0, 'l', 't'], [1, 'r', 't'], [2, 'l', 't'], [3, 'r', 't']], { mv: 90, nf: 1 }),
        E('rleap', ring ? '링 리프' : '스플릿 리프', ring ? 0.5 : 0.3, 3, [[0, '>', 't'], [1, 'u', 't', 0, 1]], { mv: 70, v: ring ? 'ring' : 'split' }),
        E('rthrow', L > 0.6 ? '높이 던지기 + 2회 구르기 캐치' : '높이 던지기 + 구르기 캐치', L > 0.6 ? 0.8 : 0.6, 4, [[0, 'a', 't'], [1.5, '?', 't'], [3, 'a', 't', 0, 1]], { mv: 90 }),
        E('rpivot', L > 0.6 ? '애티튜드 피봇 3회전' : '애티튜드 피봇 2회전', L > 0.6 ? 0.6 : 0.4, 3.5, [[0, 'u', 't'], [0.5, 'a', 'm', 2.5]], { nf: 1 }),
        E('rsnake', '리본 뱀 모양', 0.3, 4, [[0, 'u', 't'], [1, 'd', 't'], [2, 'u', 't'], [3, 'd', 't']], { mv: 60, nf: 1 }),
        E('rbal', '팡셰 밸런스', 0.4, 3, [[0, 'u', 'h', 2]], { nf: 1 }),
        E('rillu', '일루전', 0.3, 3, [[0, 'd', 't'], [1, 'a', 't', 0, 1]], { mv: 30 }),
        E('rthrow', '던지기 + 일루전 캐치', 0.7, 4, [[0, 'a', 't'], [1.5, '?', 't'], [3, 'a', 't', 0, 1]], { mv: 80 })
      ];
    },
    fill(R, beats) { const o = []; for (let b = 0.5; b < beats; b += 2) o.push([b, R.pick(DIRS), 't']); return o; },
    hint: '화살표 타이밍 · {A} 던지기 → {A} 캐치!',
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, cbg: '#2a1f3f', dim: 'rgba(30,8,40,0.5)', top: '#120818', mid: '#2a1438', banners: ['#ff0044', '#b55088', '#feae34', '#2ce8f5', '#ff0044'] });
      sweepSpots(g, t, 0, 200, ['#ff77c8', '#ffffff', '#c28cff', '#ffffff', '#ff77c8'], 0.07);
      g.adBoards(0, 110, 480, 12, t, ['AICHI-NAGOYA 2026', 'RHYTHMIC GYMNASTICS', 'DOT GAMES', 'RIBBON']);
      g.rect(0, 122, 480, 100, '#2a2140');
      g.poly([24, 146, 456, 146, 478, 216, 2, 216], '#7a2a6a');
      g.poly([38, 150, 442, 150, 462, 212, 18, 212], '#a03a88');
      g.line(38, 150, 442, 150, '#ffffff'); g.line(18, 212, 462, 212, '#ffffff'); g.line(38, 150, 18, 212, '#ffffff'); g.line(442, 150, 462, 212, '#ffffff');
      for (let i = 0; i < 6; i++) { g.alpha(0.06); g.ellipse(60 + i * 72, 180, 30, 8, '#fff'); g.alpha(1); }
    },
    actor(g, s, P, t) {
      const st = rgPose(P, t), ent = s.ents[P.idx], look = this.look(ent);
      const rc = RIB[(ent.look >> 2) % RIB.length], rc2 = OG.shade(rc, -0.3);
      g.alpha(0.25); g.ellipse(st.x, RY + 1, 12, 2, '#000'); g.alpha(1);
      spotLight(g, st.x, RY, 0.09);
      // ribbon trail
      const pts = [];
      for (let k = 0; k < 26; k++) { const tt = t - k * 0.028; const p = rgTip(P, Math.max(-3, tt)); pts.push([p[0], Math.min(RY, p[1] + k * k * 0.035)]); }
      const J = fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
      if (st.mode === 'drop' || (st.stick && st.stick[3])) {
        const sx = st.stick ? st.stick[0] : st.x + 20;
        g.line(sx - 6, RY - 1, sx + 6, RY - 2, '#ffffff', 1);
        for (let k = 0; k < 10; k++) g.rect(sx + 6 + k * 4, RY - 1 + (k % 2), 4, 1, k % 2 ? rc2 : rc);
      } else {
        for (let k = 0; k < pts.length - 1; k++) g.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], k % 3 === 2 ? rc2 : rc, k < 18 ? 2 : 1);
        // stick
        const tip = pts[0];
        const hand = st.stick ? [st.stick[0], st.stick[1]] : J.hdR;
        g.line(hand[0], hand[1], tip[0], tip[1], '#ffffff', 1);
      }
    },
    onEl(s, P, el, res) { if (el.a === 'rthrow' && !P.sim) addFx(P, res === 3 ? 'dust' : 'star', lerp(el.x0, el.x1, 0.75), RY - 40, 0); }
  };

  /* ========================== ARTISTIC SWIMMING ======================== */
  const WY = 134;
  const SWP = {
    up: PZ(0.0, 0.5, 0.5, 0.8, 0.8, 0.5, 0.4, 1.4, 1.2),
    inv: PZ(0.0, 0.25, 0.3, 0.1, 0.1, 0.02, -0.02, 0, 0),
    vee: PZ(-0.05, 2.6, 2.7, 0.05, 0.05, 0.3, 0.2, 0.4, 0.3),
    crouch: PZ(0.6, 2.6, 2.6, 0.4, 0.4, 1.8, 1.8, 2.5, 2.5),
    pike: PZ(1.3, 0.4, 0.5, 0.1, 0.1, 1.5, 1.45, 0, 0),
    flam: PZ(0.0, 2.9, 3.0, 0.1, 0.1, 0.4, PI / 2, 2.0, 0.0),
    knight: PZ(0.0, 0.2, 0.3, 0, 0, -0.9, 0.05, 0.4, 0)
  };
  const SW_ARMS = { l: PZ(0, 3.0, 0.6, 0.1, 0.8, 0.5, 0.4, 1.4, 1.2), r: PZ(0, 0.6, 3.0, 0.8, 0.1, 0.5, 0.4, 1.4, 1.2), u: PZ(0, 2.7, 2.8, 0.1, 0.1, 0.5, 0.4, 1.4, 1.2), d: PZ(0, 1.57, 1.57, 0.1, 0.1, 0.5, 0.4, 1.4, 1.2) };
  // returns {x, hipY, pose, f, rot}
  function swPose(P, t, who) {
    const spb = 60 / K.swim.bpm, q = at(P, t);
    const side = who ? 1 : -1;
    let x = 240 + side * 30, hipY = WY + 18, pose = SWP.up, f = -side, rot = 0;
    const egg = ph => { const p = Object.assign({}, pose); p.kL = 1.2 + 0.4 * sin(ph * 9); p.kR = 1.2 + 0.4 * sin(ph * 9 + 2); return p; };
    if (q.gap) {
      pose = SWP.up;
      if (!q.next) { const k = (t - q.t0) / spb; pose = k < 1 ? mixP(SWP.up, SWP.vee, k) : SWP.vee; hipY = WY + 18 - Math.min(1, k) * 6; }
      else {
        const ln = lastHitNote(P, t, -1);
        if (ln && t - ln.jt < 0.8 && t >= ln.jt) pose = mixP(SWP.up, SW_ARMS[ln.b] || SWP.vee, sin(c01((t - ln.jt) / 0.8) * PI));
        pose = egg(t); hipY += sin(t * 3 + side) * 1.5;
      }
      return { x, hipY, pose, f, rot };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    const inv = (k, lift) => { rot = PI; pose = SWP.inv; hipY = WY + 30 - lift; };
    if (e.a === 'svert' || e.a === 'sspin') {
      const n = P.notes[e.n0 + 1] || {};
      if (bt < 1) { const u = bt; rot = PI * sm(u); pose = mixP(SWP.up, SWP.inv, u); hipY = WY + 18 + 12 * sm(u); }
      else if (bt < 3.6) {
        let up = sm((bt - 1) / 0.8);
        if (n.j === 3 || (n.h === 2 && n.j === 2)) up = Math.min(up, n.jt ? Math.max(0.3, 1 - (t - n.jt) * 2) : 0.4);
        inv(0, up * 28);
        if (e.a === 'sspin' && bt > 1.5) { const m = P.notes[e.n0 + 2] || { c: 0 }; f = cos((t - e.t0) * 9 + m.c) >= 0 ? -side : side; hipY += (bt - 1.5) * 3; }
      } else { const u = (bt - 3.6) / 0.9; rot = PI * (1 - sm(u)); pose = mixP(SWP.inv, SWP.up, u); hipY = WY + 30 - 12 * sm(u); }
    } else if (e.a === 'sboost') {
      if (bt < 1) { pose = mixP(SWP.up, SWP.crouch, bt); hipY = WY + 18 + 10 * bt; }
      else if (bt < 2.2) { const u = (bt - 1) / 1.2; const ok = res !== 3; hipY = WY + 28 - arc(u) * (ok ? 50 : 24); pose = mixP(SWP.crouch, SWP.vee, Math.min(1, u * 3)); }
      else { pose = mixP(SWP.vee, SWP.up, bt - 2.2); hipY = WY + 18; }
    } else if (e.a === 'slift') {
      if (who === 1) { // base
        x = 240; f = -1;
        if (bt < 2) { pose = mixP(SWP.up, SWP.crouch, bt / 2); hipY = WY + 18 + 14 * sm(bt / 2); }
        else if (bt < 2.6) { pose = mixP(SWP.crouch, SWP.vee, (bt - 2) / 0.6); hipY = WY + 32 - 10 * sm((bt - 2) / 0.6); }
        else { pose = mixP(SWP.vee, SWP.up, (bt - 2.6)); hipY = WY + 22 - 4 * c01(bt - 2.6); }
      } else {
        f = 1;
        if (bt < 2) { x = lerp(240 - 30, 240, sm(bt / 2)); pose = mixP(SWP.up, SWP.crouch, bt / 2); hipY = WY + 18 + 6 * sm(bt / 2); }
        else if (bt < 4) {
          const u = (bt - 2) / 2, ok = res !== 3;
          x = 240 + u * 26; hipY = WY + 10 - arc(u) * (ok ? 92 : 40);
          rot = -TAU * sm(c01(u / 0.85)) * (ok ? 1 : 0.5);
          pose = u < 0.1 ? mixP(SWP.crouch, PS.layout, u / 0.1) : u < 0.8 ? (ok ? PS.tuck : PS.layout) : mixP(PS.tuck, SWP.inv, (u - 0.8) / 0.2);
          if (u > 0.85) { rot = PI; hipY = lerp(WY - 10, WY + 30, (u - 0.85) / 0.15); }
        } else { const u = c01((bt - 4) / 0.8); x = 266 - 36 * u; rot = PI * (1 - u); pose = mixP(SWP.inv, SWP.up, u); hipY = WY + 28 - 10 * u; }
      }
    } else if (e.a === 'sbarra') {
      if (bt < 0.5) { pose = mixP(SWP.up, SWP.pike, bt * 2); rot = PI * 0.5 * sm(bt * 2); hipY = WY + 18 + 14 * bt * 2; }
      else if (bt < 2) { pose = SWP.pike; rot = PI * 0.5 + PI * 0.3 * sm((bt - 0.5) / 1.5); hipY = WY + 32; }
      else if (bt < 3.4) { const u = (bt - 2) / 1.4, ok = res !== 3; rot = PI; pose = mixP(SWP.pike, SWP.inv, Math.min(1, u * 4)); hipY = WY + 30 - arc(u) * (ok ? 40 : 18); }
      else { const u = c01((bt - 3.4) / 0.8); rot = PI * (1 - u); pose = mixP(SWP.inv, SWP.up, u); hipY = WY + 30 - 12 * u; }
    } else if (e.a === 'sflam') {
      if (bt < 1) { const u = bt; rot = -PI / 2 * sm(u); pose = mixP(SWP.up, SWP.flam, u); hipY = WY + 18 - 14 * sm(u); }
      else if (bt < 3) { rot = -PI / 2; pose = SWP.flam; hipY = WY + 4 + sin(t * 2) * 1; const n = P.notes[e.n1 - 1] || {}; if (n.j === 3) pose = mixP(SWP.flam, SWP.knight, 0.6); }
      else { const u = c01(bt - 3); rot = -PI / 2 * (1 - sm(u)); pose = mixP(SWP.flam, SWP.up, u); hipY = WY + 4 + 14 * u; }
      f = side < 0 ? 1 : -1;
    } else if (e.a === 'sarms') {
      let last = null; for (let i = e.n0; i < e.n1; i++) { const n = P.notes[i]; if (n.j && n.j < 3 && n.jt <= t) last = n; }
      pose = last ? mixP(SWP.up, SW_ARMS[last.b] || SWP.vee, 1 - c01((t - last.jt - 0.25) / 0.3)) : SWP.up;
      pose = egg(t);
      if (last) pose = mixP(SWP.up, SW_ARMS[last.b], 0.9);
      hipY = WY + 16;
    }
    if (side > 0) { /* mirror partner */ }
    return { x, hipY, pose, f, rot };
  }
  K.swim = {
    bpm: 104, sc: 'swim', bounds: [240, 240], x0: 240, gap: 2, maxGap: 3, drum: [1, 0, 1, 0], failTx: '싱크로 실패!',
    subTx: el => 'DD ' + el.bv.toFixed(4),
    look(ent) { const L = baseLook(ent), c = vivid(ent); return Object.assign(L, { suit: null, shirt: c, pants: c, hair: '#181425', bun: true, bunC: '#fee761', shoe: L.skin }); },
    plan(R, L) {
      const k = 0.85 + 0.25 * L;
      const dd = v => M.round(v * k, 4);
      return [
        E('sarms', '팔 동작 시퀀스', dd(1.8), 3, [[0, '?', 't'], [0.5, '?', 't'], [1, '?', 't'], [1.5, '?', 't'], [2, '?', 't']], { nf: 1 }),
        E('svert', '수직 자세 (버티컬)', dd(2.6), 4.5, [[0, 'd', 't'], [1, 'u', 'h', 2.5]], { nf: 0 }),
        E('sboost', '부스트', dd(2.4), 3.2, [[0, 'd', 't'], [1, 'a', 't', 0, 1]]),
        E('slift', '듀엣 리프트 (백 플립)', dd(3.6), 5, [[0, 'd', 't'], [1, 'd', 't'], [2, 'a', 't', 0, 1]]),
        E('sspin', '스핀 360°', dd(3.0), 4.5, [[0, 'd', 't'], [1, 'u', 't'], [1.5, 'x', 'm', 2]], { nf: 1 }),
        E('sflam', '플라밍고', dd(2.7), 4, [[0, 'd', 't'], [1, 'u', 'h', 2]], { nf: 1 }),
        E('sbarra', '바라쿠다', dd(3.1), 4.2, [[0, 'd', 't'], [0.5, 'u', 'r', 1.5, 1]])
      ];
    },
    fill(R, beats) { const o = []; for (let b = 0.5; b < beats; b += 1) o.push([b, R.pick(DIRS), 't']); return o; },
    hint: '두 선수 싱크로! 화살표 = 팔 동작 · {U} 꾹 = 다리 들기',
    stage(g, s, P, t) {
      g.grad(0, 0, 480, WY, '#0b1530', '#1e3a66', 6);
      arenaBack(g, t, { cy: 18, ch: 74, excite: P ? P.ex : 0, top: '#0b1530', mid: '#1e3a66', h: 0, cbg: '#1c2a4a', dim: 'rgba(8,16,40,0.45)' });
      sweepSpots(g, t, 0, WY, ['#9fd8ff', '#ffffff', '#ffd0f0', '#ffffff', '#9fd8ff'], 0.07);
      // deck & big screen
      g.rect(0, 92, 480, 30, '#26324f'); g.adBoards(0, 100, 480, 10, t, ['AICHI-NAGOYA 2026', 'ARTISTIC SWIMMING', 'DOT GAMES', 'DUET']);
      g.rect(0, 116, 480, 18, '#c0cbdc'); g.rect(0, 116, 480, 2, '#ffffff'); g.rect(0, 130, 480, 4, '#8b9bb4');
      // underwater
      g.grad(0, WY, 480, 222 - WY, '#1f7fc8', '#0b3a73', 8);
      for (let i = 0; i < 9; i++) { const x = M.wrap(i * 61 + t * 6, 520) - 20; g.alpha(0.08); g.poly([x, WY, x + 14, WY, x + 40, 222, x + 26, 222], '#ffffff'); g.alpha(1); }
      for (let x = 0; x < 480; x += 16) g.rect(x, 212, 1, 10, 'rgba(255,255,255,0.15)');
      g.rect(0, 212, 480, 1, 'rgba(255,255,255,0.2)'); g.rect(232, 212, 16, 10, 'rgba(10,20,50,0.5)');
    },
    actor(g, s, P, t) {
      const ent = s.ents[P.idx], look = this.look(ent);
      const draw = (who) => {
        let lag = 0;
        const q = at(P, t);
        if (q.e && q.e.res) lag = q.e.res === 2 ? 0.1 : q.e.res === 3 ? 0.3 : 0;
        const st = swPose(P, t - (who ? lag : 0), who);
        g.figure(st.x, st.hipY, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: 'hip' });
        return st;
      };
      draw(0); draw(1);
      // water tint over submerged parts + surface
      g.rect(0, WY + 1, 480, 222 - WY - 1, 'rgba(25,110,200,0.38)');
      for (let x = 0; x < 480; x += 2) { const yy = WY + Math.round(sin(x * 0.12 + t * 3) * 1); g.rect(x, yy, 2, 1, 'rgba(220,240,255,0.85)'); }
      for (let i = 0; i < 8; i++) { const x = M.wrap(i * 67 - t * 12, 500) - 10; g.rect(x, WY + 3 + (i % 3), 10, 1, 'rgba(255,255,255,0.25)'); }
    },
    onEl(s, P, el, res) { if (!P.sim && (el.a === 'sboost' || el.a === 'slift' || el.a === 'sbarra')) { addFx(P, 'splash', 240, WY, 0); } }
  };

  /* =============================== BREAKING ============================ */
  const BY = 200;
  const BRP = {
    top1: PZ(0.1, 1.0, 2.0, 1.4, 1.6, 0.5, -0.3, 0.3, 0.2),
    top2: PZ(0.05, 2.0, 0.9, 1.6, 1.3, -0.3, 0.5, 0.2, 0.3),
    crouch: PZ(1.1, 0.3, 0.7, 0.2, 0.3, 1.9, 1.7, 2.6, 2.4),
    sweep: PZ(1.0, 0.25, 0.6, 0.1, 0.3, 1.6, -0.2, 2.6, 0.1),
    sweep2: PZ(0.9, 0.5, 0.3, 0.3, 0.1, -0.2, 1.7, 0.1, 2.6),
    mill: PZ(0.0, 2.8, 0.6, 0.2, 0.3, 1.0, -1.0, 0.0, 0.0),
    head: PZ(0.0, 1.3, 1.3, 1.0, 1.0, 0.25, -0.25, 0.0, 0.0),
    flare: PZ(0.0, 2.9, 2.9, 0.1, 0.1, 1.5, -1.5, 0.0, 0.0),
    chair: PZ(0.3, 3.05, 1.2, 0.0, 1.0, 1.5, 0.6, 1.6, 1.4),
    baby: PZ(0.8, 2.7, 3.0, 1.2, 0.4, 1.7, 0.4, 2.4, 1.4),
    hollow: PZ(-0.6, 3.1, 3.1, 0.0, 0.0, -0.6, -0.4, 1.8, 1.4),
    back: PZ(0.0, 2.8, 2.6, 0.3, 0.3, 1.2, 0.4, 1.6, 0.3),
    cross: PZ(0.0, 2.2, 2.4, 0.4, 0.4, 0.1, -0.1, 0, 0)
  };
  function brPose(P, t) {
    const spb = 60 / K.breaking.bpm, q = at(P, t);
    let x, y = BY, pose = BRP.top1, f = 1, rot = 0, anchor = 'feet';
    const bounce = ph => -Math.round(arc((ph * 2) % 1) * 2);
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = b > a + 2 ? 1 : b < a - 2 ? -1 : 1;
      const ph = t / spb;
      if (!q.next) { const k = (t - q.t0) / spb; pose = k < 0.6 ? mixP(BRP.top1, BRP.cross, k / 0.6) : BRP.cross; f = 1; return { x, y, pose, f, rot, anchor }; }
      pose = mixP(BRP.top1, BRP.top2, 0.5 + 0.5 * sin(ph * PI)); y = BY + bounce(ph);
      return { x, y, pose, f, rot, anchor };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = lerp(e.x0, e.x1, c01(bt / ((e.t1 - e.t0) / spb)));
    const ent = P.notes[e.n0] || {};
    if (e.a === 'toprock') {
      let cnt = 0; for (let i = e.n0; i < e.n1; i++) if (P.notes[i].j && P.notes[i].jt <= t) cnt++;
      const ph = bt; pose = mixP(cnt % 2 ? BRP.top2 : BRP.top1, BRP.cross, 0.25 + 0.25 * sin(ph * TAU)); y = BY + bounce(ph);
      f = (Math.floor(bt / 2) % 2) ? -e.dir : e.dir;
    } else if (e.a === 'footwork') {
      if (bt < 0.4) pose = mixP(BRP.top1, BRP.crouch, bt / 0.4);
      else { const ph = (bt - 0.4) * 1.0; pose = mixP(BRP.sweep, BRP.sweep2, 0.5 + 0.5 * sin(ph * PI * 2)); f = Math.floor(ph) % 2 ? -e.dir : e.dir; }
    } else if (e.a === 'windmill' || e.a === 'headspin' || e.a === 'flare') {
      const m = P.notes[e.n1 - 1] || { c: 0, n: 1 };
      const sp = 6 + 10 * Math.min(1, (m.n ? m.c / m.n : 1) + 0.3);
      const ang = (t - e.t0) * sp + m.c * 0.6;
      if (bt < 0.5) { pose = mixP(BRP.top1, BRP.crouch, bt * 2); }
      else if (bt < 3.3) {
        if (e.a === 'windmill') { pose = BRP.mill; rot = PI / 2 + sin(ang) * 0.35; f = cos(ang) >= 0 ? 1 : -1; }
        else if (e.a === 'headspin') { pose = BRP.head; rot = PI; f = cos(ang * 1.4) >= 0 ? 1 : -1; }
        else { pose = BRP.flare; rot = PI * 0.5 + sin(ang) * 0.5; f = cos(ang) >= 0 ? 1 : -1; y = BY - 4 - Math.round(arc((ang / PI) % 1) * 4); }
        if (res === 2 && e.q < 0.5) rot += sin(t * 20) * 0.2;
      } else pose = mixP(BRP.crouch, BRP.top1, (bt - 3.3) * 2);
    } else if (e.a === 'freeze') {
      const fp = BRP[e.v] || BRP.chair;
      const n = P.notes[e.n0] || {};
      const failed = n.j === 3 && t >= n.jt;
      if (bt < 0.3) { pose = mixP(BRP.crouch, fp, bt / 0.3); rot = (e.v === 'chair' ? -PI * 0.85 : e.v === 'baby' ? PI * 0.6 : PI) * sm(bt / 0.3); }
      else if (bt < 2.6 && !failed) { pose = fp; rot = e.v === 'chair' ? -PI * 0.85 : e.v === 'baby' ? PI * 0.6 : PI; }
      else if (failed && t - n.jt < 1) { pose = BRP.back; rot = -PI / 2; }
      else pose = mixP(BRP.crouch, BRP.top1, c01((bt - 2.6) * 2));
    } else if (e.a === 'suicide') {
      if (bt < 1) pose = mixP(BRP.top1, PS.hurdle, bt);
      else if (bt < 1.4) { const u = (bt - 1) / 0.4; pose = mixP(PS.layout, BRP.back, u); rot = -PI / 2 * sm(u); }
      else if (bt < 2.6) { pose = BRP.back; rot = -PI / 2; }
      else { pose = mixP(BRP.crouch, BRP.top1, (bt - 2.6) * 2); }
    }
    return { x, y, pose, f, rot, anchor };
  }
  K.breaking = {
    bpm: 108, sc: 'brk', bounds: [150, 330], x0: 200, gap: 2, maxGap: 3, drum: [1, 1, 1, 1], mashSfx: 'step', failTx: '크래시!',
    subTx: el => ({ power: '파워무브', freeze: '프리즈', top: '탑록', foot: '풋워크', drop: '드롭' }[el.gr] || '') + ' · HYPE ↑', mashTx: '파워무브!',
    look(ent) { const L = baseLook(ent); return Object.assign(L, { shoe: '#ffffff', sleeves: !!(ent.look & 4), cap: (ent.look & 2) ? OG.shade(L.pants, 0.2) : null, tights: true }); },
    plan(R, L) {
      const power = [
        E('windmill', '윈드밀', 0.5, 3.8, [[0.5, 'x', 'm', 2.8]], { nf: 1, gr: 'power' }),
        E('headspin', '헤드스핀', 0.6, 3.8, [[0.5, 'a', 'm', 2.8]], { nf: 1, gr: 'power' }),
        E('flare', '에어 플레어', 0.7, 3.8, [[0.5, 'u', 'm', 2.8]], { nf: 1, gr: 'power' })
      ];
      R.shuffle(power);
      const fz = v => E('freeze', v === 'chair' ? '에어 체어 프리즈' : v === 'baby' ? '베이비 프리즈' : '할로우백 프리즈', 0.5, 3, [[0, 'd', 'h', 2.2, 1]], { v, link: 1, gr: 'freeze' });
      const tr = []; ['l', 'r', 'l', 'r'].forEach((b, i) => tr.push([i, b, 't']));
      const fw = []; ['l', 'd', 'r', 'u', 'l', 'd', 'r', 'u'].forEach((b, i) => fw.push([i * 0.5, b, 't']));
      return [
        E('toprock', '탑록', 0.2, 4, tr, { mv: 40, nf: 1, gr: 'top' }),
        E('footwork', '6스텝 풋워크', 0.3, 4.4, fw, { mv: 0, nf: 1, gr: 'foot' }),
        power[0], fz('chair'),
        E('suicide', '수어사이드 드롭', 0.3, 3, [[1, 'a', 't', 0, 1]], { gr: 'drop' }),
        power[1], fz(R.chance(0.5) ? 'baby' : 'hollow'),
        E('toprock', '탑록 → 마무리', 0.2, 4, tr, { mv: 40, nf: 1, gr: 'top' })
      ];
    },
    fill(R, beats) { const o = []; for (let b = 0; b + 0.4 < beats; b += 1) o.push([b, b % 2 ? 'r' : 'l', 't']); return o; },
    hint: '비트에 맞춰! 파워무브 = 연타 · 프리즈 = {D} 꾹',
    tick(s, P, inp, dt, R) { },
    stage(g, s, P, t) {
      const spb = 60 / this.bpm, beat = Math.max(0, t) / spb, pulse = 1 - (beat % 1);
      g.clear('#07060c');
      // LED wall
      g.rect(40, 14, 400, 92, '#0d0a1a');
      for (let i = 0; i < 40; i++) {
        const h = 10 + Math.abs(sin(i * 0.7 + Math.floor(beat) * 1.3)) * 50 * (0.5 + 0.5 * pulse) + H(i, Math.floor(beat), 3) * 20;
        const c = ['#ff0044', '#b55088', '#2ce8f5', '#feae34'][Math.floor(i / 10)];
        for (let yy = 0; yy < h; yy += 3) g.rect(44 + i * 10, 100 - yy, 8, 2, c);
      }
      g.text('BREAKING', 240, 62, '#ffffff', { size: 'xl', align: 'center', outline: '#ff0044' });
      g.text('AICHI-NAGOYA 2026 · BATTLE', 240, 88, PAL.yellow, { size: 's', align: 'center', outline: PAL.black });
      // truss & lights
      g.rect(0, 6, 480, 4, '#3a4466'); for (let x = 0; x < 480; x += 12) g.line(x, 6, x + 6, 10, '#5a6988');
      sweepSpots(g, t * 1.6, 8, BY + 6, ['#ff0044', '#2ce8f5', '#fee761', '#b55088', '#63c74d'], 0.12);
      // speakers
      [[6, 1], [436, 0]].forEach(([x]) => { g.rect(x, 96, 38, 104, '#14121c'); g.rect(x + 1, 97, 36, 102, '#1d1a28'); [116, 150, 182].forEach(yy => { g.circle(x + 19, yy, 12 + (pulse > 0.8 ? 1 : 0), '#0a0a12'); g.circle(x + 19, yy, 5, '#3a4466'); }); });
      // DJ booth (DJ behind the deck)
      g.figure(89, 150, PZ(0.15 + pulse * 0.1, 1.2, 0.9, 1.4, 1.6, 0.1, -0.1, 0, 0, 0.3 * pulse), { shirt: '#181425', pants: '#262b44', skin: PAL.skin3, hair: '#181425', cap: '#e43b44' }, { scale: 2, facing: 1 });
      g.rect(52, 128, 74, 30, '#1d1a28'); g.rect(52, 128, 74, 2, '#ff0044'); g.rect(56, 134, 66, 1, '#3a3456');
      g.rect(58, 124, 58, 5, '#3a4466'); g.circle(70, 124, 5, '#0a0a12'); g.circle(102, 124, 5, '#0a0a12');
      g.px(70 + Math.round(cos(t * 8) * 3), 124 + Math.round(sin(t * 8) * 2), '#fff'); g.px(102 + Math.round(cos(t * 8 + 2) * 3), 124 + Math.round(sin(t * 8 + 2) * 2), '#fff');
      g.text('DJ', 89, 142, PAL.cyan, { size: 'xs', align: 'center' });
      // floor
      g.grad(0, 158, 480, 64, '#1a1626', '#0c0a12', 4);
      g.alpha(0.5); g.ellipse(240, 204, 120, 14, '#2a2440'); g.alpha(1);
      g.alpha(0.3 + 0.3 * pulse); g.ellipse(240, 204, 112, 12, '#ff0044'); g.alpha(1); g.ellipse(240, 204, 108, 10, '#1a1626');
      // crowd cypher (silhouettes, rim-lit)
      const hype = P ? P.hype : 0.5;
      for (let i = 0; i < 24; i++) {
        const side = i < 12 ? 0 : 1, k = i % 12;
        const cx = side ? 352 + k * 11 + (k % 2) * 3 : 8 + k * 11 + (k % 2) * 3, cy = 178 + (k % 3) * 7;
        const jump = H(i, Math.floor(beat), 1) < hype * 0.7 ? -Math.round(pulse * 3) : 0;
        const c = ['#141020', '#1c1730', '#100c1a'][i % 3], rim = side ? '#ff0044' : '#2ce8f5';
        const arms = hype > 0.5 && H(i, 3, 3) < hype;
        if (arms) { g.line(cx - 4, cy + 4 + jump, cx - 7, cy - 9 + jump, c, 2); g.line(cx + 4, cy + 4 + jump, cx + 7, cy - 9 + jump, c, 2); }
        g.rect(cx - 5, cy + 4 + jump, 11, 40, c); g.rect(cx - 4, cy + 2 + jump, 9, 2, c);
        g.circle(cx, cy - 2 + jump, 4, c);
        g.rect(side ? cx - 5 : cx + 5, cy + 4 + jump, 1, 20, rim); g.px(side ? cx - 3 : cx + 3, cy - 5 + jump, rim);
      }
      // hype meter
      if (P && s.phase === 'play') {
        g.rect(4, 24, 118, 13, 'rgba(12,10,26,0.8)');
        g.bar(30, 26, 88, 9, hype, hype > 0.7 ? PAL.hotpink : hype > 0.4 ? PAL.orange : PAL.grey);
        g.text('HYPE', 7, 27, hype > 0.7 ? PAL.hotpink : PAL.white, { size: 'xs' });
        if (hype > 0.7) for (let i = 0; i < 6; i++) g.rect(30 + H(i, Math.floor(t * 10), 2) * 88, 23 - H(i, Math.floor(t * 10), 4) * 4, 2, 2, PAL.yellow);
      }
    },
    actor(g, s, P, t) {
      const st = brPose(P, t), ent = s.ents[P.idx], look = this.look(ent);
      g.alpha(0.35); g.ellipse(st.x, BY + 1, 13, 2, '#000'); g.alpha(1);
      // reflection
      g.save(); g.clip(0, BY, 480, 222 - BY); g.ctx.translate(0, BY * 2 + 2); g.ctx.scale(1, -1); g.alpha(0.12);
      g.figure(st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor }); g.alpha(1); g.restore();
      fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
    },
    onEl(s, P, el, res) { if (!P.sim && el.a === 'freeze' && res === 1) addFx(P, 'star', el.x0, BY - 30, 0); }
  };

  /* =============================== DRESSAGE ============================ */
  const DY = 196;
  const COATS = [['#7b4a2a', '#2a1a14'], ['#a0522d', '#7a3a1d'], ['#2a2020', '#141010'], ['#b8b8c0', '#e8e8ee'], ['#5e3a26', '#1a1210']];
  const GAITS = {
    walk: { off: [0, 0.5, 0.25, 0.75], st: 0.62, reach: 6, lift: 6, bob: 1 },
    trot: { off: [0, 0.5, 0.5, 0], st: 0.5, reach: 7, lift: 8, bob: 2 },
    passage: { off: [0, 0.5, 0.5, 0], st: 0.45, reach: 5, lift: 15, bob: 5 },
    piaffe: { off: [0, 0.5, 0.5, 0], st: 0.5, reach: 1.5, lift: 13, bob: 3 },
    extended: { off: [0, 0.5, 0.5, 0], st: 0.45, reach: 15, lift: 7, bob: 3 },
    canter: { off: [0.45, 0.3, 0.3, 0], st: 0.42, reach: 10, lift: 9, bob: 4 },
    halt: { off: [0, 0, 0, 0], st: 1, reach: 0, lift: 0, bob: 0 }
  };
  function leg2(g, ax, ay, hx, hy, l1, l2, bendDir, c, th) {
    const dx = hx - ax, dy = hy - ay; let d = Math.hypot(dx, dy) || 1;
    const dd = Math.min(d, l1 + l2 - 0.5);
    const a = Math.atan2(dy, dx), al = Math.acos(M.clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1));
    const ka = a + al * bendDir;
    const kx = ax + cos(ka) * l1, ky = ay + sin(ka) * l1;
    const fx = ax + dx / d * dd, fy = ay + dy / d * dd;
    g.line(ax, ay, kx, ky, c, th); g.line(kx, ky, fx, fy, c, th - 1);
    return [fx, fy];
  }
  // horse with rider anchor; f = ±1 facing, sx = horizontal squash (pirouette)
  function drawHorse(g, x, y, o) {
    const f = o.f, sx = Math.max(0.2, Math.abs(o.sx == null ? 1 : o.sx)), k = f * sx;
    const X = dx => x + dx * k;
    const coat = o.coat, dark = OG.shade(coat, -0.35), pts = o.points;
    const gt = GAITS[o.gait] || GAITS.walk;
    const bob = -Math.round(Math.abs(sin(o.ph * TAU * (o.gait === 'walk' ? 2 : 2))) * gt.bob * 0.5) - (o.gait === 'passage' || o.gait === 'piaffe' ? 2 : 0);
    const by = y + bob + (o.rear || 0);
    // legs: [front near, front far, hind near, hind far]
    const legs = [[22, -34, 1, 0], [19, -34, 1, 1], [-20, -36, -1, 0], [-23, -36, -1, 1]];
    const offs = gt.off;
    const legPos = legs.map((L, i) => {
      const ph = M.wrap(o.ph + offs[i], 1);
      let hx, hy;
      if (ph < gt.st) { const u = ph / gt.st; hx = L[0] + lerp(gt.reach, -gt.reach, u); hy = 0; }
      else { const u = (ph - gt.st) / (1 - gt.st); hx = L[0] + lerp(-gt.reach, gt.reach, u) + (L[2] > 0 ? 3 : 0) * sin(u * PI); hy = -sin(u * PI) * gt.lift * (L[2] > 0 ? 1 : 0.7); }
      return [hx, hy];
    });
    const drawLeg = (i, c) => {
      const L = legs[i], lp = legPos[i];
      const ax = X(L[0]), ay = by + L[1] + 4;
      const ft = leg2(g, ax, ay, X(lp[0]), y + lp[1] - 3, 16, 15, (L[2] > 0 ? -1 : 1) * (k > 0 ? 1 : -1), c, 4);
      g.rect(ft[0] - 2, ft[1], 4, 3, '#181425');
      if (o.socks && i % 2 === 0) g.rect(ft[0] - 2, ft[1] - 3, 4, 3, '#ffffff');
    };
    // far legs
    drawLeg(1, OG.shade(pts, -0.2)); drawLeg(3, OG.shade(pts, -0.2));
    // tail
    const sw = sin(o.t * 3) * 2;
    g.line(X(-33), by - 46, X(-37 + sw), by - 20, OG.shade(o.mane, 0), 4); g.line(X(-36 + sw), by - 26, X(-38 + sw * 1.5), by - 16, OG.shade(o.mane, 0), 3);
    // body
    const ell = (cx, cy, rx, ry, c) => g.ellipse(X(cx), by + cy, Math.max(1, rx * sx), ry, c);
    ell(0, -42, 30, 11, coat); ell(-22, -46, 12, 10, coat); ell(22, -44, 11, 10, coat);
    ell(0, -36, 24, 4, OG.shade(coat, -0.15));
    g.ellipse(X(-4), by - 51, Math.max(1, 20 * sx), 2, OG.shade(coat, 0.18));
    // neck + head
    g.poly([X(12), by - 52, X(26), by - 38, X(36), by - 58, X(42), by - 72, X(34), by - 76, X(24), by - 66], coat);
    g.poly([X(34), by - 77, X(42), by - 74, X(53), by - 55, X(51), by - 50, X(45), by - 50, X(39), by - 62], coat);
    g.poly([X(36), by - 78, X(38), by - 84, X(40), by - 77], dark);
    g.px(X(45), by - 67, '#181425'); g.px(X(50), by - 53, '#181425');
    // plaited mane
    for (let i = 0; i < 6; i++) { const u = i / 5; g.circle(X(lerp(14, 36, u)), by - lerp(54, 76, u) - 1, 1.6, o.mane); }
    // bridle & reins
    g.line(X(37), by - 74, X(48), by - 54, '#181425', 1); g.line(X(40), by - 62, X(50), by - 58, '#181425', 1);
    // saddle pad + saddle
    g.poly([X(-12), by - 52, X(12), by - 52, X(10), by - 38, X(-10), by - 38], '#ffffff');
    g.poly([X(-9), by - 55, X(8), by - 53, X(7), by - 48, X(-9), by - 48], '#181425');
    // near legs
    drawLeg(0, pts); drawLeg(2, pts);
    return { seat: [X(-1), by - 54], bit: [X(48), by - 56] };
  }
  const RIDER = PZ(0.02, 0.55, 0.62, 1.15, 1.05, 0.5, 0.55, 1.25, 1.2);
  function drPose(P, t) {
    const spb = 60 / K.dressage.bpm, q = at(P, t);
    let x, f = 1, sx = 1, gait = 'trot', ph = t / (spb * 2), salute = 0;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = b > a + 2 ? 1 : b < a - 2 ? -1 : (q.prev ? q.prev.dir : 1);
      gait = abs(b - a) > 60 ? 'canter' : abs(b - a) > 10 ? 'trot' : 'walk';
      if (!q.next) { gait = 'halt'; salute = c01(((t - q.t0) / spb) - 0.5) < 1 ? 0 : 0; }
      if (!q.prev && t < 0) gait = 'walk';
      return { x, f, sx, gait, ph, salute };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = lerp(e.x0, e.x1, c01(bt / ((e.t1 - e.t0) / spb)));
    if (e.a === 'piaffe') { gait = 'piaffe'; ph = bt / 2; }
    else if (e.a === 'passage') { gait = 'passage'; ph = bt / 2; }
    else if (e.a === 'extended') { gait = 'extended'; ph = bt; }
    else if (e.a === 'pirouette') { gait = 'canter'; ph = bt; const th = TAU * c01(bt / 4); sx = cos(th); f = (sx >= 0 ? 1 : -1) * e.dir; x = e.x0; }
    else if (e.a === 'tempi') { gait = 'canter'; ph = bt; }
    else if (e.a === 'halfpass') { gait = 'trot'; ph = bt / 2; }
    else if (e.a === 'halt') { gait = bt < 1 ? 'trot' : 'halt'; ph = bt / 2; x = lerp(e.x0, e.x1, c01(bt)); salute = bt > 1.5 ? sin(c01((bt - 1.5) / 1.4) * PI) : 0; }
    if (res === 3 && e.a !== 'halt') { const n = P.notes.slice(e.n0, e.n1).find(n => n.j === 3); if (n && t > n.jt && t - n.jt < 1) gait = 'walk'; }
    return { x, f, sx, gait, ph, salute };
  }
  K.dressage = {
    bpm: 84, sc: 'dress', bounds: [90, 390], x0: 70, gap: 2, maxGap: 3, drum: [1, 0, 1, 0], mashSfx: 'step', failTx: '리듬 흐트러짐!',
    subTx: el => '계수 ×' + el.cf,
    plan(R, L) {
      const lr = n => { const o = []; for (let i = 0; i < n; i++) o.push([i, i % 2 ? 'r' : 'l', 't']); return o; };
      const lr2 = n => { const o = []; for (let i = 0; i < n; i++) o.push([i * 0.5, i % 2 ? 'r' : 'l', 't']); return o; };
      return [
        E('passage', '파사지', 0.8, 4, lr(4), { mv: 80, cf: 2, nf: 1 }),
        E('extended', '익스텐디드 트롯', 0.6, 3, lr2(6), { mv: 150, cf: 1, nf: 1 }),
        E('piaffe', '피아페', 0.9, 4, lr(4), { mv: 0, cf: 2, nf: 1 }),
        E('pirouette', '캔터 피루엣', 0.9, 4, [[0, 'u', 't'], [1, 'u', 't'], [2, 'u', 't'], [3, 'u', 't']], { mv: 0, cf: 2, nf: 1 }),
        E('tempi', '원 템포 체인지', 0.8, 4, lr(4), { mv: 120, cf: 1, nf: 1 }),
        E('halfpass', '하프 패스', 0.6, 4, [[0, '>', 't'], [1, '>', 't'], [2, '>', 't'], [3, '>', 't']], { mv: 90, cf: 1, nf: 1 }),
        E('halt', '정지 · 경례', 0.4, 3.2, [[0, 'd', 't'], [1.5, 'a', 't']], { mv: 30, cf: 1, nf: 1 })
      ];
    },
    fill(R, beats) { return beats >= 1 ? [[0.5, '>', 't']] : []; },
    hint: '말 발걸음에 맞춰 {L}{R} · 피루엣 {U} · 정지 {D} → 경례 {A}',
    stage(g, s, P, t) {
      g.grad(0, 0, 480, 90, '#5fb6f2', '#bfe3f5', 6);
      g.clouds(t, 6, 3);
      // grandstand
      g.rect(0, 40, 480, 70, '#5a6988'); g.rect(0, 36, 480, 6, '#3a4466');
      g.crowd(0, 44, 480, 60, t, { excite: P ? P.ex * 0.6 : 0, seed: 9, bg: '#4a5878', density: 0.8 });
      g.rect(0, 30, 480, 8, '#262b44'); for (let x = 0; x < 480; x += 40) g.rect(x, 30, 2, 80, '#262b44');
      // judges box at C
      g.rect(420, 96, 50, 20, '#ffffff'); g.rect(420, 96, 50, 3, '#e43b44'); g.text('C', 445, 102, PAL.black, { size: 'xs', align: 'center' });
      // hedge & flowers
      g.rect(0, 108, 480, 14, '#3e8948');
      for (let x = 0; x < 480; x += 8) { g.circle(x + 4, 109, 4, '#3e8948'); if (H(x, 1, 1) < 0.4) g.px(x + 3, 110, ['#e43b44', '#fee761', '#ffffff', '#b55088'][x % 4]); }
      // arena sand
      g.grad(0, 122, 480, 100, '#d9b98a', '#e8cfa4', 5);
      for (let i = 0; i < 50; i++) { const x = H(i, 7, 7) * 480, yy = 130 + H(i, 8, 8) * 88; g.rect(x, yy, 6 + H(i, 9, 9) * 10, 1, 'rgba(160,120,80,0.25)'); }
      // back boards with letters
      g.rect(0, 124, 480, 4, '#ffffff'); g.rect(0, 128, 480, 1, '#c0cbdc');
      ['K', 'V', 'E', 'S', 'H'].forEach((L, i) => { const x = 70 + i * 85; g.rect(x - 4, 117, 9, 8, '#ffffff'); g.text(L, x + 1, 117, PAL.black, { size: 'xs', align: 'center' }); });
      // front boards
      g.rect(0, 212, 480, 6, '#ffffff'); g.rect(0, 218, 480, 2, '#c0cbdc');
      ['F', 'P', 'B', 'R', 'M'].forEach((L, i) => { const x = 70 + i * 85; g.rect(x - 7, 204, 15, 14, '#ffffff'); g.rectO(x - 7, 204, 15, 14, '#8b9bb4'); g.text(L, x + 1, 206, PAL.black, { size: 's', align: 'center' }); g.circle(x - 10, 214, 2, '#e43b44'); g.circle(x + 12, 214, 2, '#fee761'); });
      g.text('A', 8, 204, PAL.black, { size: 's' }); g.text('C', 466, 204, PAL.black, { size: 's' });
    },
    actor(g, s, P, t) {
      const st = drPose(P, t), ent = s.ents[P.idx];
      const ci = COATS[(ent.look >> 1) % COATS.length];
      const coat = ci[0], pts = ci[0] === '#b8b8c0' ? '#8b8b94' : OG.shade(ci[0], -0.45), mane = ci[0] === '#b8b8c0' ? '#e8e8ee' : '#181010';
      g.alpha(0.25); g.ellipse(st.x, DY + 1, 30 * Math.max(0.3, Math.abs(st.sx)), 3, '#5a3a20'); g.alpha(1);
      const hr = drawHorse(g, st.x, DY, { f: st.f, sx: st.sx, gait: st.gait, ph: st.ph, coat, points: pts, mane, t, socks: !!(ent.look & 8) });
      const L = baseLook(ent);
      const look = { shirt: '#181425', pants: '#f4f4f8', skin: L.skin, hair: L.hair, tights: true, sleeves: true, shoe: '#181425' };
      const pose = Object.assign({}, RIDER);
      if (st.salute > 0) { pose.aR = lerp(RIDER.aR, -0.2, st.salute); pose.eR = lerp(RIDER.eR, 0.1, st.salute); pose.h = 0.4 * st.salute; }
      const fr = st.f >= 0 ? 1 : -1;
      const J = g.figure(hr.seat[0], hr.seat[1], pose, look, { facing: fr, scale: 2, anchor: 'hip' });
      g.line(J.knR[0], J.knR[1], J.ftR[0], J.ftR[1], '#181425', 4);
      g.rect(J.ftR[0] - 1, J.ftR[1] - 1, 3, 2, '#c0cbdc');
      // top hat
      if (!(st.salute > 0.5)) { g.rect(J.head[0] - 4, J.head[1] - 5, 9, 2, '#181425'); g.rect(J.head[0] - 3, J.head[1] - 12, 7, 8, '#181425'); }
      g.line(J.hdR[0], J.hdR[1], hr.bit[0], hr.bit[1], '#3e2731', 1);
      g.rect(J.hdR[0] - 1, J.hdR[1] - 1, 2, 2, '#ffffff');
      // rider tails
      g.line(J.hip[0] - fr * 2, J.hip[1] - 2, J.hip[0] - fr * 7, J.hip[1] + 6, '#181425', 3);
      if (st.salute > 0.5) { g.rect(J.hdR[0] - 3, J.hdR[1] - 1, 7, 2, '#181425'); g.rect(J.hdR[0] - 2, J.hdR[1] - 7, 5, 6, '#181425'); }
    },
    onNote(s, P, n, j) { if (!P.sim && j < 3) OG.sfx(s, 'step'); }
  };

  /* ================================ WUSHU ============================== */
  const WUY = 198;
  const WUP = {
    ready: PZ(0.0, 0.2, 1.4, 0.3, 1.6, 0.05, -0.05, 0, 0),
    bow: PZ(0.15, -0.4, 1.6, 2.2, 0.05, -0.75, 1.0, 0.0, 1.2),
    horse: PZ(0.0, 1.57, -0.4, 0.05, 2.2, 1.2, 1.1, 1.7, 1.6),
    crouch: PZ(0.6, 2.7, 2.8, 0.2, 0.2, 1.6, 1.4, 2.5, 2.3),
    kick: PZ(-0.2, 2.6, 1.9, 0.2, 0.1, -0.3, 2.0, 0.6, 0.0),
    tornado: PZ(-0.1, 2.8, 1.5, 0.2, 0.3, 0.1, 1.9, 1.4, 0.0),
    butterfly: PZ(0.1, 2.0, 2.4, 0.2, 0.2, 1.2, -1.2, 0.2, 0.3),
    cart: PZ(0.0, 2.6, 2.8, 0.1, 0.1, 1.3, -1.3, 0, 0),
    split: PZ(-0.1, 2.7, 1.6, 0.1, 0.05, -1.55, 1.55, 0, 0),
    salute: PZ(0.0, 1.35, 1.35, 1.5, 1.5, 0.05, -0.05, 0, 0),
    strike1: PZ(0.2, 1.0, 2.6, 0.5, 0.0, -0.6, 0.8, 0.1, 1.0),
    strike2: PZ(0.05, 2.2, 0.6, 0.3, 0.2, 0.3, -0.5, 0.6, 0.1),
    strike3: PZ(-0.1, 1.6, 3.1, 0.2, 0.0, 0.1, 0.3, 0.0, 0.6),
    strike4: PZ(0.5, 1.2, 1.4, 0.4, 0.0, 1.3, -0.4, 2.1, 0.2)
  };
  function wuPose(P, t) {
    const spb = 60 / K.wushu.bpm, q = at(P, t);
    let x, y = WUY, pose = WUP.ready, f = 1, rot = 0, anchor = 'feet', wa = 0;
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = b > a + 2 ? 1 : b < a - 2 ? -1 : (q.next ? q.next.dir : 1);
      const k = (t - q.t0) / spb;
      if (!q.next) { pose = k < 1 ? mixP(WUP.bow, WUP.salute, k) : WUP.salute; f = 1; }
      else if (!q.prev && t < 0.3) { pose = WUP.salute; f = 1; }
      else { const ln = lastHitNote(P, t, -1); pose = ln && t - ln.jt < 0.5 ? mixP(WUP.bow, WUP.strike2, 1 - (t - ln.jt) / 0.5) : mixP(WUP.ready, WUP.bow, 0.5 + 0.5 * sin(k * 1.5)); }
      return { x, y, pose, f, rot, anchor, wa };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = lerp(e.x0, e.x1, c01(bt / ((e.t1 - e.t0) / spb)));
    const landed = (k, lp) => res === 3 ? (k < 1 ? PS.sit : mixP(PS.sit, WUP.ready, k - 1)) : res === 2 ? mixP(lp, PS.step, 0.5) : lp;
    if (e.a === 'wstance') pose = bt < 1 ? mixP(WUP.ready, WUP.strike1, bt) : mixP(WUP.strike1, WUP.bow, (bt - 1) * 2);
    else if (e.a === 'wcombo') {
      let last = null; for (let i = e.n0; i < e.n1; i++) { const n = P.notes[i]; if (n.j && n.jt <= t) last = n; }
      const pz = { l: WUP.strike2, r: WUP.strike1, u: WUP.strike3, d: WUP.strike4 };
      pose = last ? mixP(pz[last.b] || WUP.bow, WUP.bow, c01((t - last.jt - 0.15) / 0.4)) : WUP.bow;
      wa = last ? (1 - c01((t - last.jt) / 0.25)) * 2.2 : 0;
    } else if (e.a === 'wflour') {
      const n = P.notes[e.n0] || { c: 0 };
      pose = mixP(WUP.horse, WUP.strike3, 0.5); wa = (t - e.t0) * 14 + n.c * 0.9;
      if (bt > 2.6) pose = mixP(pose, WUP.bow, (bt - 2.6) * 2);
    } else if (e.a === 'wtorn' || e.a === 'wbutt' || e.a === 'wcart' || e.a === 'wkick') {
      const take = 1, land = e.a === 'wkick' || e.a === 'wcart' ? 2 : 2.2;
      if (bt < take) pose = mixP(WUP.ready, WUP.crouch, bt);
      else if (bt < land) {
        const u = (bt - take) / (land - take);
        const hgt = e.a === 'wbutt' ? 30 : 36;
        y = WUY - arc(u) * hgt;
        if (e.a === 'wtorn') { pose = WUP.tornado; f = flipF(e.dir, u, e.v === 720 ? 2 : 1); }
        else if (e.a === 'wbutt') { pose = WUP.butterfly; anchor = 'hip'; y = WUY - 20 - arc(u) * hgt; rot = PI / 2 * (cos(u * TAU * (e.v === 720 ? 2 : 1)) > 0 ? 1 : -1) * 0.9; f = flipF(e.dir, u, e.v === 720 ? 2 : 1); }
        else if (e.a === 'wcart') { pose = WUP.cart; anchor = 'hip'; y = WUY - 22 - arc(u) * 30; rot = TAU * sm(u); }
        else pose = u < 0.5 ? mixP(WUP.crouch, WUP.kick, u * 2) : mixP(WUP.kick, PS.land, (u - 0.5) * 2);
      } else pose = landed(bt - land, e.a === 'wtorn' || e.a === 'wbutt' ? WUP.horse : WUP.bow);
    } else if (e.a === 'wsplit') {
      if (bt < 1) pose = mixP(WUP.ready, WUP.crouch, bt);
      else if (bt < 1.8) { const u = (bt - 1) / 0.8; y = WUY - arc(u) * 30; pose = mixP(WUP.crouch, WUP.split, u); }
      else pose = res === 3 ? PS.sit : WUP.split;
    }
    return { x, y, pose, f, rot, anchor, wa };
  }
  function weaponPts(J, st, kind) {
    const h = J.hdR, el = J.elR;
    let dx = h[0] - el[0], dy = h[1] - el[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    const a = Math.atan2(dy, dx) + (st.wa || 0);
    const ux = cos(a), uy = sin(a);
    return kind === 'staff' ? [[h[0] - ux * 20, h[1] - uy * 20], [h[0] + ux * 34, h[1] + uy * 34]] : [[h[0] - ux * 2, h[1] - uy * 2], [h[0] + ux * 26, h[1] + uy * 26]];
  }
  K.wushu = {
    bpm: 126, sc: 'wushu', bounds: [80, 400], x0: 110, gap: 2, maxGap: 3, drum: [1, 0, 1, 1], failTx: '착지 실패!',
    subTx: el => '난도 +' + el.bv.toFixed(1),
    look(ent) { const L = baseLook(ent), c = vivid(ent); return Object.assign(L, { shirt: c, pants: OG.shade(c, -0.15), sleeves: true, tights: true, shoe: '#ffffff' }); },
    weapon: ent => (ent.look & 4) ? 'staff' : 'sword',
    introSub: (s, P) => K.wushu.weapon(s.ents[P.idx]) === 'staff' ? '곤술 (棍術)' : '검술 (劍術)',
    plan(R, L) {
      const sn = []; for (let b = 0; b < 3; b += 0.5) sn.push([b, '?', 't']);
      const t720 = L > 0.6;
      return [
        E('wstance', '궁보 충권', 0.1, 2, [[0, '>', 't'], [1, 'd', 't']], { mv: 40, nf: 1 }),
        E('wcombo', '연속 공격', 0.2, 3, sn, { mv: 50, nf: 1 }),
        E('wtorn', t720 ? '선풍각 720° + 마보' : '선풍각 360° + 마보', t720 ? 0.4 : 0.3, 3.4, [[0, 'd', 't'], [1, 'a', 't', 0, 1], [2.2, 'd', 't', 0, 1]], { mv: 40, v: t720 ? 720 : 360, link: 1 }),
        E('wflour', '무기 화려한 돌리기', 0.2, 3, [[0, 'x', 'm', 2.5]], { nf: 1 }),
        E('wbutt', L > 0.7 ? '선자 720° (나비 회전)' : '선자 (나비 차기)', L > 0.7 ? 0.4 : 0.2, 3.4, [[0, '>', 't'], [1, 'a', 't', 0, 1], [2.2, 'd', 't', 0, 1]], { mv: 70, v: L > 0.7 ? 720 : 360, link: 1 }),
        E('wcombo', '연속 공격 2', 0.2, 3, sn, { mv: 50, nf: 1 }),
        E('wcart', '측공번 (공중 옆돌기)', 0.2, 3, [[0, '>', 't'], [1, 'a', 't', 0, 1]], { mv: 60 }),
        E('wkick', '등공비각', 0.2, 2.6, [[0, '>', 't'], [1, 'u', 't', 0, 1]], { mv: 40 }),
        E('wsplit', '도약 일자 착지', 0.2, 3, [[0, 'u', 't'], [1, 'd', 't', 0, 1]], { mv: 20 })
      ];
    },
    fill(R, beats) { const o = []; for (let b = 0.5; b < beats; b += 1.5) o.push([b, R.pick(DIRS), 't']); return o; },
    hint: '화살표 = 공격 · {A} 도약 → {D} 착지 고정!',
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, cbg: '#2a1a1a', dim: 'rgba(30,6,6,0.5)', top: '#140606', mid: '#2a0c0c', banners: ['#e43b44', '#feae34', '#e43b44', '#feae34', '#e43b44'] });
      // lanterns
      for (let i = 0; i < 7; i++) { const x = 34 + i * 68, yy = 50 + sin(t * 1.5 + i) * 2; g.line(x, 10, x, yy - 7, '#3e2731'); g.ellipse(x, yy, 7, 8, '#e43b44'); g.rect(x - 4, yy - 9, 9, 2, '#feae34'); g.rect(x - 4, yy + 7, 9, 2, '#feae34'); g.rect(x - 1, yy - 6, 2, 12, 'rgba(255,230,120,0.4)'); g.line(x, yy + 9, x, yy + 14, '#feae34'); }
      g.rect(130, 82, 220, 22, '#a22633'); g.rectO(130, 82, 220, 22, '#feae34');
      g.text('武術 · WUSHU TAOLU · AICHI-NAGOYA 2026', 240, 88, '#fee761', { size: 'xs', align: 'center' });
      g.adBoards(0, 110, 480, 12, t, ['AICHI-NAGOYA 2026', 'WUSHU TAOLU', 'DOT GAMES', '長拳']);
      g.rect(0, 122, 480, 100, '#2a1418');
      g.poly([22, 148, 458, 148, 478, 216, 2, 216], '#8a1a22');
      g.poly([36, 152, 444, 152, 462, 212, 18, 212], '#c4202c');
      g.line(36, 152, 444, 152, '#ffffff'); g.line(18, 212, 462, 212, '#ffffff'); g.line(36, 152, 18, 212, '#ffffff'); g.line(444, 152, 462, 212, '#ffffff');
      g.line(240, 152, 240, 212, 'rgba(255,255,255,0.35)');
      // drum on the side
      g.ellipse(456, 140, 14, 5, '#e8cfa4'); g.rect(442, 140, 29, 16, '#a22633'); g.ellipse(456, 156, 14, 5, '#7a1a22');
    },
    actor(g, s, P, t) {
      const st = wuPose(P, t), ent = s.ents[P.idx], look = this.look(ent), kind = this.weapon(ent);
      g.alpha(0.3); g.ellipse(st.x, WUY + 1, 13, 2, '#000'); g.alpha(1);
      spotLight(g, st.x, WUY, 0.08);
      // weapon trail (past tip positions)
      const tips = [];
      for (let k = 1; k <= 6; k++) { const s2 = wuPose(P, t - k * 0.025); const J2 = fk(s2.x, s2.y, s2.pose, { facing: s2.f, scale: 2, rot: s2.rot, anchor: s2.anchor }); tips.push(weaponPts(J2, s2, kind)[1]); }
      const J = fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
      // sash
      g.rect(J.hip[0] - 3, J.hip[1] - 2, 7, 2, '#fee761'); g.line(J.hip[0], J.hip[1], J.hip[0] - st.f * 5, J.hip[1] + 6, '#fee761', 1);
      const wp = weaponPts(J, st, kind);
      let prev = wp[1];
      tips.forEach((p, i) => { g.alpha(0.5 - i * 0.07); g.line(prev[0], prev[1], p[0], p[1], '#ffffff', 2); prev = p; });
      g.alpha(1);
      if (kind === 'staff') { g.line(wp[0][0], wp[0][1], wp[1][0], wp[1][1], '#9a5a30', 2); g.rect(wp[1][0] - 1, wp[1][1] - 1, 3, 3, '#e43b44'); }
      else { g.line(J.hdR[0], J.hdR[1], wp[1][0], wp[1][1], '#e8eef4', 1); g.line(wp[0][0], wp[0][1], J.hdR[0], J.hdR[1], '#feae34', 2); g.rect(wp[0][0] - 1, wp[0][1], 2, 4, '#e43b44'); }
    },
    onEl(s, P, el, res) { if (!P.sim && (el.a === 'wtorn' || el.a === 'wbutt' || el.a === 'wsplit')) addFx(P, res === 3 ? 'dust' : 'spark', el.x1, WUY, 0); }
  };

  /* ============================ KARATE KATA ============================ */
  const KY = 194;
  const KP = {
    yoi: PZ(0.0, 0.35, 0.35, 0.5, 0.5, 0.1, -0.1, 0, 0),
    rei: PZ(0.5, 0.05, 0.05, 0.1, 0.1, 0.0, 0.0, 0, 0),
    zuki: PZ(0.1, -0.45, 1.57, 2.3, 0.0, -0.6, 0.85, 0.0, 0.9),
    gedan: PZ(0.1, -0.45, 0.5, 2.3, 0.1, -0.6, 0.85, 0.0, 0.9),
    age: PZ(0.0, -0.45, 2.6, 2.3, 1.3, -0.6, 0.85, 0.0, 0.9),
    chamber: PZ(0.0, 1.2, 0.7, 1.9, 1.9, 0.0, 1.9, 0.0, 2.5),
    mae: PZ(-0.15, 1.2, 0.7, 1.9, 1.9, 0.0, 1.65, 0.0, 0.1),
    yoko: PZ(-0.6, 1.6, 0.6, 1.9, 1.5, 0.05, 1.9, 0.0, 0.0),
    kokutsu: PZ(-0.05, 1.0, 1.5, 1.8, 0.6, -0.5, 0.4, 1.2, 0.2),
    kiai: PZ(0.2, -0.45, 1.6, 2.3, 0.0, -0.8, 0.95, 0.0, 1.1),
    tuck: PZ(0.2, 1.2, 1.5, 1.8, 1.6, 1.6, 1.5, 2.4, 2.4),
    kneel: PZ(0.3, 1.3, 1.5, 1.8, 0.1, 1.5, -0.3, 2.6, 1.6)
  };
  const KATAS = ['운스 (Unsu)', '아난 (Anan)', '수파린페이 (Suparinpei)', '고쥬시호 (Gojushiho)', '팝렌 (Papuren)', '쿠루룬파 (Kururunfa)', '칸쿠다이 (Kanku-dai)'];
  function kaPose(P, t) {
    const spb = 60 / K.kata.bpm, q = at(P, t);
    let x, y = KY, pose = KP.yoi, f = 1, rot = 0, anchor = 'feet';
    if (q.gap) {
      const a = q.prev ? q.prev.x1 : P.x0, b = q.next ? q.next.x0 : a;
      x = lerp(a, b, sm(q.u)); f = (q.next ? q.next.dir : (q.prev ? q.prev.dir : 1));
      const k = (t - q.t0) / spb;
      if (!q.next) { pose = k < 1 ? mixP(KP.zuki, KP.yoi, k) : k < 2 ? KP.yoi : mixP(KP.yoi, KP.rei, sin(c01(k - 2) * PI)); f = 1; }
      else if (!q.prev && t < 0.6) { pose = t < -1.5 ? mixP(KP.yoi, KP.rei, sin(c01((t + 3) / 1.2) * PI)) : KP.yoi; f = 1; }
      else { const ln = lastHitNote(P, t, -1); pose = ln && t - ln.jt < 0.6 ? mixP(KP.zuki, KP.gedan, (t - ln.jt) / 0.6) : mixP(q.prev ? KP.zuki : KP.yoi, KP.kokutsu, sm(q.u) * 0.5); }
      return { x, y, pose, f, rot, anchor };
    }
    const e = q.e, bt = (t - e.t0) / spb, res = e.res;
    f = e.dir; x = lerp(e.x0, e.x1, sm(c01(bt / 1.2)));
    let last = null; for (let i = e.n0; i < e.n1; i++) { const n = P.notes[i]; if (n.j && n.jt <= t) last = n; }
    const snap = (from, to, n) => n ? mixP(from, to, c01((t - n.jt) / 0.06)) : from;
    if (e.a === 'kgedan') pose = last ? snap(KP.zuki, KP.gedan, last.b === 'd' ? last : null) : mixP(KP.yoi, KP.zuki, bt);
    else if (e.a === 'koizuki') pose = last ? snap(KP.gedan, KP.zuki, last) : KP.gedan;
    else if (e.a === 'kage') { f = e.dir; pose = last && last.b === 'u' ? snap(KP.zuki, KP.age, last) : mixP(KP.zuki, KP.kokutsu, bt); }
    else if (e.a === 'kmae' || e.a === 'kyoko') {
      const n = P.notes[e.n0] || {};
      const kp = e.a === 'kmae' ? KP.mae : KP.yoko;
      if (bt < 1) pose = mixP(KP.zuki, KP.chamber, bt * 3);
      else if (bt < 1.6) pose = n.j === 3 ? mixP(KP.chamber, PS.step, 0.6) : mixP(KP.chamber, kp, (bt - 1) / 0.08);
      else pose = mixP(kp, KP.zuki, (bt - 1.6) * 2);
      if (e.a === 'kyoko' && last && last.k === 't') pose = snap(KP.yoko, KP.zuki, last);
    } else if (e.a === 'kshuto') pose = mixP(KP.zuki, KP.kokutsu, bt * 2);
    else if (e.a === 'kkiai') {
      let cnt = 0; for (let i = e.n0; i < e.n1; i++) if (P.notes[i].j && P.notes[i].jt <= t) cnt++;
      pose = cnt >= 4 ? KP.kiai : cnt % 2 ? snap(KP.gedan, KP.zuki, last) : (last ? snap(KP.zuki, KP.gedan, last) : KP.zuki);
      if (cnt >= 4 && last && last.j === 3) pose = mixP(KP.kiai, PS.step, 0.5);
    } else if (e.a === 'kjump') {
      if (bt < 1) pose = mixP(KP.zuki, KP.tuck, bt * 0.6);
      else if (bt < 1.8) { const u = (bt - 1) / 0.8; y = KY - arc(u) * 34; pose = KP.tuck; f = flipF(e.dir, u, 1); }
      else pose = res === 3 ? mixP(KP.kneel, PS.sit, 0.5) : (last && last.b === 'a' ? snap(KP.kneel, KP.kiai, last) : KP.kneel);
    }
    return { x, y, pose, f, rot, anchor };
  }
  K.kata = {
    bpm: 76, sc: 'kata', bounds: [120, 360], x0: 150, gap: 1.5, maxGap: 2.5, drum: [1, 0, 0, 0], failTx: '균형 상실!',
    subTx: el => '키메!',
    introSub: (s, P) => '카타: ' + KATAS[(P.idx * 3 + s.ents[P.idx].look) % KATAS.length],
    plan(R, L) {
      return R.shuffle([
        E('kgedan', '게단바라이', 0.3, 2, [[0, '>', 't'], [1, 'd', 't']], { mv: 40, nf: 1 }),
        E('koizuki', '오이즈키', 0.3, 2, [[0, '>', 't'], [1, '>', 't']], { mv: 50, nf: 1 }),
        E('kage', '아게우케', 0.3, 2, [[0, '<', 't'], [1, 'u', 't']], { mv: 30, nf: 1 }),
        E('kmae', '마에게리', 0.4, 2.2, [[0, 'u', 'r', 1, 1]], { mv: 20 }),
        E('kshuto', '슈토우케 (코쿠츠다치)', 0.3, 2.2, [[0, '<', 't'], [0.5, 'd', 'h', 1.4]], { mv: 30, nf: 1 }),
        E('kyoko', '요코게리 + 엔피', 0.5, 2.4, [[0, 'u', 'r', 1, 1], [1.6, '>', 't']], { mv: 30 })
      ]).concat([
        E('kkiai', '산본즈키 + 기합!', 0.6, 3, [[0, '>', 't'], [0.5, '>', 't'], [1, '>', 't'], [2, 'a', 't', 0, 1]], { mv: 50 }),
        E('kjump', '뛰어 돌기 + 기합!', 0.7, 3, [[0, 'd', 't'], [1, 'u', 't', 0, 1], [2, 'a', 't', 0, 1]], { mv: 20 })
      ]);
    },
    fill(R, beats) { return beats >= 1 ? [[0.5, R.pick(['l', 'r', 'd']), 't']] : []; },
    hint: '{R}{L} 찌르기 · {U} 막기/차기 · {D} 하단 · {A} 기합!',
    onNote(s, P, n, j) {
      if (P.sim) return;
      if (n.b === 'a' && j < 3) { P.kiaiT = P.t; P.shake = P.t; OG.sfx(s, 'power'); }
      else if (j < 3) OG.sfx(s, n.b === 'u' && n.k === 'r' ? 'kick' : 'punch');
    },
    stage(g, s, P, t) {
      arenaBack(g, t, { excite: P ? P.ex : 0, cbg: '#1c2030', banners: ['#e43b44', '#ffffff', '#0099db', '#ffffff', '#e43b44'] });
      g.adBoards(0, 104, 480, 12, t, ['AICHI-NAGOYA 2026', 'KARATE KATA', 'DOT GAMES', '空手']);
      g.rect(0, 116, 480, 106, '#2a2f4c');
      // tatami with red border
      g.poly([40, 140, 440, 140, 474, 218, 6, 218], '#a22633');
      g.poly([60, 146, 420, 146, 448, 212, 32, 212], '#2a5aa8');
      for (let i = 1; i < 8; i++) { const u = i / 8; g.line(lerp(60, 420, u), 146, lerp(32, 448, u), 212, 'rgba(0,0,0,0.12)'); }
      for (let j = 1; j < 4; j++) { const v = j / 4; g.line(lerp(60, 32, v), lerp(146, 212, v), lerp(420, 448, v), lerp(146, 212, v), 'rgba(0,0,0,0.12)'); }
      // judges (seated at the back edge with flags)
      const raise = s.phase === 'score' && P ? s.pt : -1;
      const sc = P ? s.sc[P.idx] : null;
      for (let i = 0; i < 5; i++) {
        const jx = 120 + i * 60, jy = 136;
        g.rect(jx - 6, jy - 2, 12, 6, '#3a3f5c');
        const red = sc && sc.flags ? sc.flags[i] : 1;
        const up = raise > 2.4 + i * 0.12;
        const look = { shirt: '#262b44', pants: '#5a6988', skin: OG.SKINS[i % 5], hair: '#181425' };
        const pose = up ? PZ(0, red ? 2.9 : 0.4, red ? 0.4 : 2.9, 0, 0, 1.45, 1.45, 1.5, 1.5) : PZ(0, 0.6, 0.6, 0.6, 0.6, 1.45, 1.45, 1.5, 1.5);
        const J = g.figure(jx, jy + 4, pose, look, { scale: 1, facing: 1 });
        const fl = (h, c) => { g.line(h[0], h[1], h[0], h[1] - 5, '#c0cbdc'); g.rect(h[0], h[1] - 6, 4, 3, c); };
        fl(J.hdL, '#e43b44'); fl(J.hdR, '#0099db');
      }
      if (P && P.kiaiT != null && P.t - P.kiaiT < 0.6 && P.t >= P.kiaiT) {
        const a = P.t - P.kiaiT;
        g.text('기합!', 240, 60 - a * 10, PAL.yellow, { size: 'xxl', align: 'center', outline: PAL.red });
      }
    },
    actor(g, s, P, t) {
      const st = kaPose(P, t), ent = s.ents[P.idx];
      const L = baseLook(ent);
      const look = { shirt: '#f4f4f8', pants: '#f4f4f8', skin: L.skin, hair: L.hair, sleeves: true, tights: true, shoe: L.skin };
      g.alpha(0.3); g.ellipse(st.x, KY + 1, 13, 2, '#000'); g.alpha(1);
      spotLight(g, st.x, KY, 0.08);
      const J = fig(g, st.x, st.y, st.pose, look, { facing: st.f, scale: 2, rot: st.rot, anchor: st.anchor });
      // gi lapel + belt
      g.line(J.neck[0], J.neck[1] + 1, J.hip[0] + st.f * 2, J.hip[1] - 6, '#c0cbdc', 1);
      g.rect(J.hip[0] - 4, J.hip[1] - 3, 9, 3, '#e43b44');
      g.line(J.hip[0] + st.f * 3, J.hip[1], J.hip[0] + st.f * 5, J.hip[1] + 6, '#e43b44', 1);
      if (P.kiaiT != null && t - P.kiaiT < 0.25 && t >= P.kiaiT) { g.alpha(0.6); g.circleO(J.hdR[0], J.hdR[1], 4 + (t - P.kiaiT) * 40, '#ffffff'); g.alpha(1); }
    }
  };

  /* ============================ TIMELINE ============================== */
  function at(P, t) {
    const els = P.els;
    let prevEnd = -3;
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (t < e.t0) return { gap: true, i, e: null, prev: i ? els[i - 1] : null, next: e, t0: prevEnd, t1: e.t0, u: c01((t - prevEnd) / ((e.t0 - prevEnd) || 1)) };
      if (t <= e.t1) return { gap: false, i, e, u: c01((t - e.t0) / ((e.t1 - e.t0) || 1)) };
      prevEnd = e.t1;
    }
    return { gap: true, i: els.length, e: null, prev: els[els.length - 1] || null, next: null, t0: prevEnd, t1: P.end, u: c01((t - prevEnd) / ((P.end - prevEnd) || 1)) };
  }

  /* ========================= CHART BUILDING =========================== */
  function buildChart(Kd, R, L, dur) {
    const spb = 60 / Kd.bpm;
    const plan = Kd.plan(R, L);
    const totBV = plan.reduce((a, e) => a + e.bv, 0);
    const firstBeat = Math.ceil(1.7 / spb);
    const lastBeat = Math.floor((dur - (Kd.outro || 2.2)) / spb);
    const avail = lastBeat - firstBeat;
    const gap = Kd.gap || 2;
    // drop non-final elements until it fits
    const els = plan.slice();
    const need = () => els.reduce((a, e) => a + e.b, 0) + gap * (els.length - 1);
    while (els.length > 2 && need() > avail) {
      let k = -1, worst = 99;
      for (let i = 1; i < els.length - 1; i++) { const sc = els[i].bv + (i % 3) * 0.01; if (sc < worst) { worst = sc; k = i; } }
      if (k < 0) break;
      els.splice(k, 1);
    }
    const extra = Math.max(0, avail - need());
    const gapB = els.length > 1 ? Math.min(Kd.maxGap || 4, gap + Math.floor(extra / (els.length - 1) * 2) / 2) : gap;
    const notes = [], out = [];
    let beat = firstBeat;
    const b0 = Kd.bounds || [80, 400];
    let x = Kd.x0 != null ? Kd.x0 : 240, dir = 1;
    els.forEach((d, ei) => {
      if (ei > 0) {
        // filler notes in the gap
        if (Kd.fill) Kd.fill(R, gapB - 0.5, d).forEach(fn => notes.push(mkNote(Kd, R, (beat + fn[0]) * spb, fn, -1, dir, spb)));
        beat += gapB;
      }
      // direction / placement
      if (d.mv) {
        if (d.pass) { dir = (x - b0[0] < b0[1] - x) ? 1 : -1; }
        else if (x + dir * d.mv > b0[1] || x + dir * d.mv < b0[0]) dir = -dir;
      }
      if (d.mvTo != null) { dir = d.mvTo > x ? 1 : -1; }
      const x0 = x;
      let x1 = d.mv ? M.clamp(x + dir * d.mv, b0[0], b0[1]) : x;
      if (d.mvTo != null) x1 = d.mvTo;
      const el = { a: d.a, nm: d.nm, bv: d.bv, t0: beat * spb, t1: (beat + d.b) * spb, x0, x1, dir: d.dir || dir, n0: notes.length, n1: 0, res: 0, q: 0, link: d.link ? 1 : 0, cf: d.cf || 1, gr: d.gr || d.a, crit: 0 };
      ['ps', 'ns', 'nt', 'fr', 'cmb', 'v', 'w', 'nf'].forEach(k => { if (d[k] != null) el[k] = d[k]; });
      d.n.forEach(fn => { const n = mkNote(Kd, R, (beat + fn[0]) * spb, fn, out.length, el.dir, spb); notes.push(n); if (n.cr) el.crit = 1; });
      el.n1 = notes.length;
      out.push(el);
      beat += d.b; x = x1;
    });
    notes.sort((a, b) => a.t - b.t);
    // re-index elements' note ranges after sort
    out.forEach((el, i) => { el.n0 = 9999; el.n1 = -1; });
    notes.forEach((n, i) => { if (n.e >= 0) { const el = out[n.e]; el.n0 = Math.min(el.n0, i); el.n1 = Math.max(el.n1, i + 1); } });
    out.forEach(el => { if (el.n1 < 0) { el.n0 = 0; el.n1 = 0; } });
    const planBV = totBV;
    const chartBV = out.reduce((a, e) => a + e.bv, 0);
    return { notes, els: out, end: beat * spb + (Kd.outro || 2.2), planBV, chartBV, x0: Kd.x0 != null ? Kd.x0 : 240 };
  }
  function mkNote(Kd, R, t, fn, e, dir, spb) {
    let b = fn[1];
    if (b === '?') b = R.pick(DIRS);
    else if (b === '@') b = ['l', 'u', 'r', 'd'][M.wrap(Math.round(t / (spb / 2)), 4)];
    else if (b === '>') b = dir > 0 ? 'r' : 'l';
    else if (b === '<') b = dir > 0 ? 'l' : 'r';
    const k = fn[2] || 't';
    const d = (fn[3] || 0) * spb;
    return { t: M.round(t, 4), b, k, d: M.round(d, 4), e, cr: fn[4] ? 1 : 0, j: 0, h: 0, c: 0, n: k === 'm' ? Math.max(3, Math.round(d * (b === 'x' ? 6.5 : 6))) : 0, jt: 0, aj: 0, j1: 0 };
  }

  /* ============================ PERFORMANCE =========================== */
  function newPerf(s, idx, R, level, opts) {
    const Kd = K[s.kind];
    const ch = buildChart(Kd, R, level, s.dur);
    const P = {
      idx, t: -3, notes: ch.notes, els: ch.els, end: M.round(ch.end, 3), x0: ch.x0, planBV: M.round(ch.planBV, 3), chartBV: M.round(ch.chartBV, 3),
      L: M.round(level, 3), combo: 0, maxC: 0, nP: 0, nG: 0, nM: 0, falls: 0, wob: 0, fallT: -9, cv: 0, cvMax: 0,
      lj: 0, ljt: -9, co: null, fx: [], ex: 0, hype: 0.3, hsum: 0, bal: 0, bv: 0, wobF: 0, beat: -1, dLive: 0,
      auto: opts && opts.auto ? 1 : 0, sim: opts && opts.sim ? 1 : 0, shake: -9
    };
    if (P.auto) P.notes.forEach(n => { n.aj = simJ(opts.q, R, n); });
    return P;
  }
  // CPU judgement probabilities
  function simJ(q, R, n) {
    let pp = 0.2 + 0.72 * q, pm = 0.015 + 0.3 * (1 - q) * (1 - q);
    if (n.k !== 't') { pp -= 0.05; pm += 0.01; }
    const r = R.f();
    return r < pp ? 1 : r < 1 - pm ? 2 : 3;
  }

  function judge(s, P, n, j) {
    if (n.j) return;
    n.j = j; n.jt = M.round(P.t, 3);
    if (j === 1) { P.nP++; P.combo++; } else if (j === 2) { P.nG++; P.combo++; } else { P.nM++; P.combo = 0; }
    if (P.combo > P.maxC) P.maxC = P.combo;
    P.hype = c01(P.hype + (j === 1 ? 0.07 : j === 2 ? 0.025 : -0.14));
    if (!P.sim) {
      P.lj = j; P.ljt = P.t;
      OG.sfx(s, j === 1 ? 'ding' : j === 2 ? 'click' : 'miss');
      if (j < 3) addFx(P, 'hit', HX, LY + LH / 2, 0);
    }
    const Kd = K[s.kind];
    if (Kd.onNote) Kd.onNote(s, P, n, j);
    if (n.e >= 0) checkEl(s, P, P.els[n.e]);
  }
  function checkEl(s, P, el) {
    if (el.res) return;
    let sum = 0, cnt = 0, critMiss = false;
    const eIdx = P.els.indexOf(el);
    for (let i = el.n0; i < el.n1; i++) {
      const n = P.notes[i]; if (n.e !== eIdx) continue;
      if (!n.j) return;
      sum += n.j === 1 ? 1 : n.j === 2 ? 0.6 : 0; cnt++;
      if (n.j === 3 && n.cr) critMiss = true;
    }
    const q = cnt ? sum / cnt : 1;
    const Kd = K[s.kind];
    let res = critMiss ? 3 : q >= 0.95 ? 1 : q >= 0.5 ? 2 : 3;
    if (res === 3 && (Kd.noFall || (el.nf && !critMiss))) res = 2;
    el.q = M.round(q, 3); el.res = res;
    const ei = P.els.indexOf(el);
    const prev = ei > 0 ? P.els[ei - 1] : null;
    if (el.link) { P.cvMax++; if (res === 1 && (!prev || prev.res === 1 || el.cmb)) P.cv++; }
    if (res === 3) { P.falls++; P.fallT = M.round(Math.max(P.t, el.t0 + (el.t1 - el.t0) * 0.6), 3); }
    P.dLive = M.round(P.dLive + (res === 3 ? 0 : el.bv), 2);
    if (!P.sim) {
      const good = res === 1;
      P.co = { tx: res === 3 ? (Kd.failTx || '넘어짐!') : el.nm + (good ? '!' : ''), c: res === 1 ? PAL.yellow : res === 2 ? PAL.white : PAL.red, t0: P.t, sub: res === 3 ? '' : (Kd.subTx ? Kd.subTx(el) : '+' + el.bv.toFixed(1)) };
      if (res === 1) { OG.sfx(s, 'good'); P.ex = 1; } else if (res === 3) { OG.sfx(s, 'fail'); P.shake = P.t; }
    }
    if (Kd.onEl) Kd.onEl(s, P, el, res);
  }

  // per-frame play update
  function updatePlay(s, P, inp, dt, R) {
    const Kd = K[s.kind];
    P.t += dt;
    const t = P.t;
    const spb = 60 / Kd.bpm;
    // music beat
    const bi = Math.floor(t / spb);
    if (bi !== P.beat && t >= 0 && t < P.end - 1.2) {
      P.beat = bi;
      if (!P.sim) { const pat = Kd.drum || [1, 0, 1, 0]; if (pat[bi % pat.length]) OG.sfx(s, 'drum'); }
    }
    P.ex = Math.max(0, P.ex - dt * 0.6);
    P.hype = c01(P.hype - dt * 0.018);
    if (t > 0) P.hsum += P.hype * dt;
    const notes = P.notes;
    if (P.auto) {
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]; if (n.j) continue;
        const tt = n.k === 't' ? n.t : n.t + n.d;
        if (t >= tt + (n.aj === 2 ? 0.05 : 0)) {
          if (n.k === 'm') n.c = n.aj === 1 ? n.n : n.aj === 2 ? Math.ceil(n.n * 0.7) : Math.floor(n.n * 0.3);
          judge(s, P, n, n.aj);
        }
        if (n.k !== 't' && t >= n.t && t < n.t + n.d) { n.h = 1; if (n.k === 'm') n.c = Math.min(n.n, Math.floor((t - n.t) / n.d * n.n)); }
      }
    } else if (inp) {
      // releases of holds
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.h !== 1 || n.j || (n.k !== 'h' && n.k !== 'r')) continue;
        const end = n.t + n.d;
        if (!inp[n.b] || inp[n.b + 'r']) { // released
          n.h = 2;
          let j2;
          if (n.k === 'r') { const dd = abs(t - end); j2 = dd <= 0.09 ? 1 : dd <= 0.2 ? 2 : 3; }
          else { const frac = (t - n.t) / (n.d || 1); j2 = t >= end - 0.06 ? 1 : frac >= 0.75 ? 2 : 3; }
          judge(s, P, n, Math.max(n.j1, j2));
        }
      }
      // presses
      for (let bi2 = 0; bi2 < 5; bi2++) {
        const b = OG.BTN[bi2];
        if (!inp[b + 'p']) continue;
        const cnt = inp[b + 'c'] || 1;
        let used = false;
        // active mash
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (n.k !== 'm' || n.j) continue;
          if (t >= n.t - WG && t <= n.t + n.d && (n.b === b || (n.b === 'x' && (b === 'l' || b === 'r')))) {
            if (n.b === 'x') { if (P.lastX !== b) { n.c += 1; P.lastX = b; } }
            else n.c += cnt;
            n.h = 1; used = true;
            if (!P.sim && n.c % 3 === 0) OG.sfx(s, Kd.mashSfx || 'tick');
            break;
          }
        }
        if (used) continue;
        // nearest pending tap / hold start
        let best = null, bd = 9;
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (n.j || n.h || n.k === 'm') continue;
          if (n.t - t > WG + 0.05) break;
          if (n.b !== b) continue;
          const dd = abs(t - n.t);
          if (dd <= WG && dd < bd) { bd = dd; best = n; }
        }
        if (best) {
          const j = bd <= WP ? 1 : 2;
          if (best.k === 't') judge(s, P, best, j);
          else { best.h = 1; best.j1 = j; if (!P.sim) { P.lj = j; P.ljt = t; } }
          used = true;
        } else {
          // wrong button near a pending note → miss (anti-spam)
          for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            if (n.j || n.h || n.k === 'm') continue;
            if (n.t - t > 0.1) break;
            if (abs(t - n.t) <= 0.1 && n.b !== b && !(n.b === 'x')) { judge(s, P, n, 3); break; }
          }
        }
      }
    }
    // timeouts
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.j) continue;
      if (n.t > t + 0.5) break;
      if (n.k === 't' && t > n.t + WG) judge(s, P, n, 3);
      else if ((n.k === 'h' || n.k === 'r') && !n.h && t > n.t + WG) judge(s, P, n, 3);
      else if (n.k === 'h' && n.h === 1 && t >= n.t + n.d) { n.h = 2; judge(s, P, n, n.j1); }
      else if (n.k === 'r' && n.h === 1 && t > n.t + n.d + 0.2) { n.h = 2; judge(s, P, n, 3); }
      else if (n.k === 'm' && t > n.t + n.d) { const r = n.c / n.n; judge(s, P, n, r >= 1 ? 1 : r >= 0.6 ? 2 : 3); }
    }
    if (Kd.tick) Kd.tick(s, P, inp, dt, R);
    // expire fx
    if (P.fx.length && P.t - P.fx[0].t0 > 2) P.fx.shift();
  }

  /* ============================== SCORING ============================= */
  function stats(P) {
    const N = Math.max(1, P.nP + P.nG + P.nM);
    const acc = (P.nP + P.nG * 0.6) / N;
    let bvSum = 0, bvGot = 0, cleanSum = 0;
    P.els.forEach(e => { bvSum += e.bv; bvGot += e.bv * (e.res === 1 ? 1 : e.res === 2 ? 0.5 + 0.45 * e.q : 0.4); cleanSum += e.res === 1 ? 1 : 0; });
    const ratio = bvSum ? bvGot / bvSum : 1;
    const norm = 36 / N;
    return { N, acc, pr: P.nP / N, gr: P.nG / N, mr: P.nM / N, ratio, norm, clean: P.els.length ? cleanSum / P.els.length : 1, combo: P.maxC / N, hype: P.t > 0 ? P.hsum / Math.max(1, P.end) : 0.5 };
  }
  function jPanel(R, base, n, sd, step, lo, hi) { // judge cards around base
    const out = [];
    for (let i = 0; i < n; i++) out.push(M.round(M.clamp(Math.round((base + R.gauss() * sd) / step) * step, lo, hi), 2));
    return out;
  }
  function trimmedMean(a) {
    const s = a.slice().sort((x, y) => x - y); s.shift(); s.pop();
    return s.reduce((p, c) => p + c, 0) / s.length;
  }
  function trimIdx(a) { // indices of min & max (struck out)
    let mi = 0, ma = 0;
    a.forEach((v, i) => { if (v < a[mi]) mi = i; if (v > a[ma]) ma = i; });
    if (mi === ma) ma = (mi + 1) % a.length;
    return [mi, ma];
  }
  const SC = {
    gym(P, Kd, R) {
      const st = stats(P);
      const Dp = Kd.D0 + Kd.D1 * P.L;
      const cv = Math.min(0.3, P.cv * 0.1);
      const D = M.round(Dp * (0.35 + 0.65 * st.ratio) + cv, 1);
      const ded = (P.nG * 0.1 + P.nM * 0.3) * st.norm + P.wob * 0.1;
      const Eraw = M.clamp(10 - 0.9 - ded, 0, 10);
      const jd = jPanel(R, Eraw, 5, 0.12, 0.1, 0, 10);
      const Ev = M.round(trimmedMean(jd), 3);
      const fd = (Kd.fallDed || 1) * P.falls;
      const tot = M.round(Math.max(0, D + Ev - fd), 3);
      return { tot, txt: tot.toFixed(3), parts: [['D 난도 점수', D, 1], ['E 실시 점수', Ev, 3], [(Kd.fallTx || '낙하') + ' ' + P.falls + '회', -fd, 1, P.falls > 0]], jd, jl: 'E 심판', dec: 3 };
    },
    skate(P, Kd, R) {
      const st = stats(P);
      let tes = 0;
      P.els.forEach(e => {
        let goe;
        if (e.res === 1) goe = 2.2 + Math.min(1.8, P.maxC / 12);
        else if (e.res === 2) goe = Math.round(e.q * 5 - 2);
        else goe = -5;
        tes += e.bv * (e.res === 3 ? 0.75 : 1) * (1 + goe / 10);
      });
      tes = tes * (P.planBV / Math.max(1, P.chartBV));
      const comp = 5.2 + 4.3 * st.acc * st.acc - 0.25 * P.falls;
      const jd = jPanel(R, comp, 9, 0.18, 0.25, 0, 10);
      const pcs = M.round(trimmedMean(jd) * 3 * 1.67, 2);
      const tesR = M.round(tes, 2);
      const tot = M.round(tesR + pcs - P.falls, 2);
      return { tot, txt: tot.toFixed(2), parts: [['TES 기술점수', tesR, 2], ['PCS 구성점수', pcs, 2], ['감점', -P.falls, 2, P.falls > 0]], jd, jl: 'PCS 심판', dec: 2, jdDec: 2 };
    },
    rhythmic(P, Kd, R) {
      const st = stats(P);
      const D = M.round((14.1 + 3.4 * P.L) * (0.3 + 0.7 * st.ratio), 1);
      const Araw = M.clamp(10 - 1.1 - (1 - st.acc) * 5, 0, 10);
      const Eraw = M.clamp(10 - 0.9 - (P.nG * 0.1 + P.nM * 0.3) * st.norm, 0, 10);
      const jdA = jPanel(R, Araw, 4, 0.12, 0.1, 0, 10), jd = jPanel(R, Eraw, 4, 0.12, 0.1, 0, 10);
      const A = M.round(trimmedMean(jdA), 3), Ev = M.round(trimmedMean(jd), 3);
      const pen = M.round(P.falls * 0.7, 1);
      const tot = M.round(Math.max(0, D + A + Ev - pen), 3);
      return { tot, txt: tot.toFixed(3), parts: [['D 난도', D, 3], ['A 예술', A, 3], ['E 실시', Ev, 3], ['수구 낙하 ' + P.falls + '회', -pen, 1, P.falls > 0]], jd, jl: 'E 심판', dec: 3 };
    },
    swim(P, Kd, R) {
      const st = stats(P);
      let el = 0;
      P.els.forEach(e => {
        const ex = e.res === 1 ? 8.5 + Math.min(1.1, P.maxC / 16) : e.res === 2 ? 5.2 + 3.2 * e.q : 3.5;
        const dd = e.res === 3 ? Math.min(e.bv, 1.0) : e.bv;
        el += dd * ex;
      });
      el = M.round(el * (P.planBV / Math.max(1, P.chartBV)) * 1.08, 4);
      const ai0 = 6.3 + 3.5 * st.acc * st.acc;
      const jd = jPanel(R, ai0, 5, 0.18, 0.25, 0, 10);
      const ai = M.round(trimmedMean(jd) * 10, 4);
      const pen = M.round(P.nM * 0.5 * st.norm, 4);
      const tot = M.round(Math.max(0, el + ai - pen), 4);
      return { tot, txt: tot.toFixed(4), parts: [['엘리먼트', el, 4], ['예술 인상', ai, 4], ['싱크로 페널티', -pen, 4, pen > 0]], jd, jl: '예술 인상 심판', dec: 4, jdDec: 2 };
    },
    brk(P, Kd, R) {
      const st = stats(P);
      let pq = 0, pn = 0; const groups = {}, all = {};
      P.els.forEach(e => { all[e.gr] = 1; if (e.res !== 3 && e.q >= 0.5) groups[e.gr] = 1; if (e.gr === 'power' || e.gr === 'freeze') { pq += e.q; pn++; } });
      pq = pn ? pq / pn : st.acc;
      const voc = Object.keys(groups).length / Math.max(1, Object.keys(all).length);
      const lv = 0.86 + 0.14 * P.L;
      const crit = [
        ['테크닉', 20 * (0.5 + 0.5 * Math.pow(pq, 1.2)) * lv],
        ['어휘', 20 * (0.55 + 0.45 * voc) * lv],
        ['실행', Math.max(0, 20 * (0.45 + 0.55 * st.acc * st.acc) - P.falls * 1.5)],
        ['음악성', 20 * (0.4 + 0.6 * st.pr)],
        ['독창성', 20 * (0.45 + 0.35 * Math.min(1, st.hype * 1.3) + 0.2 * Math.min(1, P.maxC / 20)) * lv]
      ];
      const base = crit.reduce((a, c) => a + c[1], 0);
      const jd = jPanel(R, base, 5, 1.2, 0.1, 0, 100);
      const tot = M.round(trimmedMean(jd), 2);
      return { tot, txt: tot.toFixed(2), parts: crit.map(c => [c[0], M.round(c[1], 2), 2]), jd, jl: '심판 (트리비움)', dec: 2, jdDec: 1, bars: 1 };
    },
    dress(P, Kd, R) {
      const st = stats(P);
      let sum = 0, mx = 0;
      P.els.forEach(e => {
        let m = e.res === 1 ? 7.8 + 1.2 * e.q + Math.min(1, P.maxC / 22) : e.res === 2 ? 5.2 + 3 * e.q : 4;
        m = Math.round(Math.min(10, m) * 2) / 2;
        sum += m * e.cf; mx += 10 * e.cf;
      });
      const art = (6.0 + 3.6 * Math.pow(st.acc, 1.5)) * (0.9 + 0.1 * P.L);
      const pct0 = (sum + art * 16) / (mx + 160) * 96;
      const jd = jPanel(R, pct0, 5, 0.9, 0.001, 0, 100);
      const tot = M.round(jd.reduce((a, b) => a + b, 0) / jd.length, 3);
      return { tot, txt: tot.toFixed(3) + '%', parts: [['동작 점수 합계', M.round(sum, 1), 1], ['예술 점수', M.round(art * 16, 1), 1], ['최종 (5심 평균)', tot, 3]], jd, jl: 'E · H · C · M · B', dec: 3, jdDec: 2, unit: '%', noTrim: 1 };
    },
    wushu(P, Kd, R) {
      const st = stats(P);
      const A = M.round(M.clamp(5 - (P.nG * 0.018 + P.nM * 0.065) * st.norm - P.falls * 0.3, 0, 5), 2);
      const b0 = 2.1 + 0.85 * st.acc * st.acc;
      const jd = jPanel(R, b0, 5, 0.06, 0.01, 0, 3);
      const B = M.round(trimmedMean(jd), 3);
      const C = M.round(Math.min(2, (1.35 + 0.55 * P.L) * st.ratio + Math.min(0.2, P.cv * 0.1)), 2);
      const tot = M.round(A + B + C, 3);
      return { tot, txt: tot.toFixed(3), parts: [['A 동작 질량 (5)', A, 2], ['B 연기 수준 (3)', B, 3], ['C 난도 (2)', C, 2]], jd, jl: 'B 심판', dec: 3, jdDec: 2 };
    },
    kata(P, Kd, R) {
      const st = stats(P);
      let kq = 0, kn = 0;
      P.notes.forEach(n => { if (n.b === 'a') { kq += n.j === 1 ? 1 : n.j === 2 ? 0.6 : 0; kn++; } });
      kq = kn ? kq / kn : st.acc;
      const T = 6.0 + 3.5 * Math.pow(st.acc, 1.4) - 0.4 * P.falls;
      const A = (6.0 + 3.5 * (0.6 * st.pr + 0.4 * kq)) * (0.94 + 0.06 * P.L);
      const base = 0.7 * T + 0.3 * A;
      const jd = jPanel(R, base, 7, 0.16, 0.1, 5, 10);
      const srt = jd.slice().sort((a, b) => a - b);
      const tot = M.round(srt.slice(1, 6).reduce((a, b) => a + b, 0), 1);
      return { tot, txt: tot.toFixed(1), parts: [['기술 (70%)', M.round(T, 2), 2], ['경기력 (30%)', M.round(A, 2), 2], ['중간 5심 합계', tot, 1]], jd, jl: '7심제 (최고·최저 제외)', dec: 1, jdDec: 1, flags: [1, 1, 1, 1, 1] };
    }
  };

  /* ============================== DRAWING ============================= */
  const BCOL = { l: '#2f8fe0', r: '#f77622', u: '#4fbf4a', d: '#e0a020', a: '#e43b44', x: '#b55088' };
  function glyph(g, x, y, b, c) {
    if (b === 'l') g.poly([x - 4, y, x + 3, y - 4, x + 3, y + 4], c);
    else if (b === 'r') g.poly([x + 4, y, x - 3, y - 4, x - 3, y + 4], c);
    else if (b === 'u') g.poly([x, y - 4, x + 4, y + 3, x - 4, y + 3], c);
    else if (b === 'd') g.poly([x, y + 4, x + 4, y - 3, x - 4, y - 3], c);
    else if (b === 'x') { g.poly([x - 5, y, x - 1, y - 3, x - 1, y + 3], c); g.poly([x + 5, y, x + 1, y - 3, x + 1, y + 3], c); }
    else g.text('A', x + 1, y - 5, c, { size: 'b', align: 'center' });
  }
  function noteKey(g, x, y, b, dim) {
    const c = dim ? '#5a6988' : BCOL[b];
    g.rect(x - 7, y - 6, 15, 15, OG.shade(c, -0.5));
    g.rect(x - 6, y - 7, 13, 15, c); g.rect(x - 7, y - 6, 15, 13, c);
    g.rect(x - 5, y - 6, 11, 1, OG.shade(c, 0.45));
    glyph(g, x, y, b, dim ? '#8b9bb4' : '#ffffff');
  }
  function drawLane(g, s, P, Kd) {
    const t = P.t, spb = 60 / Kd.bpm, cy = LY + LH / 2;
    g.rect(0, LY, 480, LH, 'rgba(12,10,26,0.78)');
    g.rect(0, LY, 480, 1, 'rgba(255,255,255,0.22)'); g.rect(0, LY + LH - 1, 480, 1, 'rgba(255,255,255,0.12)');
    for (let b = Math.ceil((t - 0.5) / spb); b * spb < t + 3; b++) {
      const x = HX + (b * spb - t) * SPD;
      if (x < 0 || x > 480) continue;
      g.rect(x, LY + 3, 1, LH - 6, b % 4 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)');
    }
    // hit target
    const bp = t >= 0 ? (t / spb) % 1 : 0, pul = bp < 0.15 ? 1 : 0;
    g.rect(HX - 10, LY + 2, 21, LH - 4, 'rgba(255,255,255,0.08)');
    g.rectO(HX - 10 - pul, LY + 2 - pul, 21 + pul * 2, LH - 4 + pul * 2, pul ? PAL.yellow : 'rgba(255,255,255,0.7)');
    // notes
    const ns = P.notes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.t > t + 3.1) continue;
      const end = n.t + n.d;
      if ((n.j && n.k === 't' && n.j < 3) || (n.j && n.j < 3 && n.k !== 't' && t > end + 0.05)) continue;
      if (end < t - 0.5) continue;
      const x = HX + (n.t - t) * SPD;
      const miss = n.j === 3;
      if (n.k === 'h' || n.k === 'r' || n.k === 'm') {
        const xe = HX + (end - t) * SPD;
        const xs = n.h === 1 && !n.j ? HX : x;
        const c = miss ? '#5a6988' : BCOL[n.b];
        if (xe > xs) {
          g.rect(xs, cy - 4, xe - xs, 9, OG.shade(c, -0.45));
          g.rect(xs, cy - 3, xe - xs, 7, n.k === 'm' ? OG.shade(c, -0.15) : c);
          if (n.k === 'm') for (let k = Math.floor(xs); k < xe; k += 6) g.rect(k + ((t * 40) % 6), cy - 3, 2, 7, 'rgba(255,255,255,0.25)');
          g.rect(xs, cy - 4, xe - xs, 1, OG.shade(c, 0.4));
        }
        if (n.k === 'r') { // release marker
          g.rect(xe - 1, cy - 8, 3, 17, '#ffffff'); g.rect(xe, cy - 7, 1, 15, c);
        } else g.rect(xe - 2, cy - 5, 3, 11, OG.shade(c, -0.3));
        if (n.k === 'm' && t >= n.t - WG && t <= end && !n.j) {
          const lbl = n.c + '/' + n.n;
          g.text(lbl, HX + 26, cy - 5, PAL.white, { size: 's', outline: PAL.black });
        }
        if (!(n.h === 1 && !n.j)) noteKey(g, x, cy, n.b, miss);
        else noteKey(g, HX, cy, n.b, false);
      } else {
        noteKey(g, x, cy, n.b, miss);
      }
    }
    // labels for upcoming special notes
    const nx = ns.find(n => !n.j && n.t > t - 0.2 && n.t < t + 2.6 && n.k !== 't');
    if (nx) {
      const x = HX + (nx.t - t) * SPD;
      const lb = nx.k === 'm' ? '연타!' : nx.k === 'r' ? '누르고 → 떼기' : '꾹 누르기';
      if (x > HX + 8 && x < 410) g.text(lb, x, LY - 9, PAL.white, { size: 'xs', align: 'center', outline: PAL.black });
    }
    // judgement pop
    const age = t - P.ljt;
    if (P.lj && age < 0.6) {
      const tx = P.lj === 1 ? 'PERFECT!' : P.lj === 2 ? 'GOOD' : 'MISS';
      const c = P.lj === 1 ? PAL.yellow : P.lj === 2 ? PAL.green : PAL.grey;
      const yy = LY - 18 - Math.min(4, age * 30);
      g.text(tx, HX, yy, c, { size: P.lj === 1 && age < 0.1 ? 'l' : 'b', align: 'center', outline: PAL.black });
    }
    if (P.combo >= 3) g.text(P.combo + ' COMBO', 476, LY - 11, P.combo >= 10 ? PAL.yellow : PAL.white, { size: 's', align: 'right', outline: PAL.black });
  }

  function drawHUD(g, s, P, Kd) {
    const ent = s.ents[P.idx];
    // progress bar
    const pr = c01(P.t / (P.end - 1.5));
    g.rect(0, 0, 480, 2, 'rgba(0,0,0,0.5)'); g.rect(0, 0, 480 * pr, 2, PAL.yellow);
    // performer card
    g.rect(4, 5, 118, 17, 'rgba(12,10,26,0.78)');
    g.flag(ent.country, 7, 8, 16, 11);
    const lbl = ent.human ? ent.tag : OG.entLabel(ent);
    g.text(lbl, 27, 8, ent.human ? OG.PCOLORS[ent.pid % 8] : PAL.lightgrey, { size: 's', shadow: true });
    g.text(OG.countryName ? OG.countryName(ent.country) : ent.country, 27 + g.textW(lbl + ' ', 's'), 8, PAL.white, { size: 's', shadow: true, maxW: 90 - g.textW(lbl, 's') });
    // leader
    const lead = leader(s);
    if (lead) {
      const le = s.ents[lead.idx];
      g.rect(358, 5, 118, 17, 'rgba(12,10,26,0.78)');
      g.text('선두', 362, 9, PAL.gold, { size: 'xs' });
      g.flag(le.country, 382, 8, 16, 11);
      g.text(s.sc[lead.idx].txt, 472, 8, PAL.white, { size: 's', align: 'right', shadow: true });
    }
    // element callout
    if (P.co && P.t - P.co.t0 < 1.4) {
      const a = P.t - P.co.t0;
      const yy = 30 - Math.max(0, 0.15 - a) * 40;
      const tw = Math.min(300, g.textW(P.co.tx, 'l') + 24);
      g.alpha(0.7); g.rect(240 - tw / 2, yy - 3, tw, P.co.sub ? 34 : 21, '#0c0a1a'); g.alpha(1);
      g.text(P.co.tx, 240, yy, P.co.c, { size: 'l', align: 'center', outline: PAL.black, maxW: 290 });
      if (P.co.sub) g.text(P.co.sub, 240, yy + 17, PAL.cyan, { size: 's', align: 'center', outline: PAL.black });
    }
    // hint
    let hint = Kd.hint || '';
    const nx = P.notes.find(n => !n.j && n.t > P.t - 0.3);
    if (nx && nx.t - P.t < 1.6) {
      const key = '{' + (nx.b === 'x' ? 'L}{R' : nx.b.toUpperCase()) + '}';
      if (nx.k === 'm') hint = key + ' 연타! ' + (Kd.mashTx || '');
      else if (nx.k === 'r') hint = key + ' 누르고 있다가 끝 표시에서 떼기!';
      else if (nx.k === 'h') hint = key + ' 끝까지 꾹 누르기!';
    }
    if (Kd.hintFn) hint = Kd.hintFn(s, P) || hint;
    g.rich(hint, 240, 256, PAL.white, { align: 'center', shadow: true });
  }

  function leader(s) {
    let best = null;
    s.sc.forEach((sc, i) => { if (sc && sc.posted && (!best || sc.tot > best.tot)) best = { idx: i, tot: sc.tot }; });
    return best;
  }
  function standings(s) {
    const rows = [];
    s.sc.forEach((sc, i) => { if (sc && sc.posted) rows.push({ idx: i, tot: sc.tot }); });
    rows.sort((a, b) => b.tot - a.tot);
    return rows;
  }
  function drawBoard(g, s, x, y, w, maxRows, title, hl) {
    const rows = standings(s);
    const n = Math.min(maxRows, rows.length);
    if (!n && !title) return;
    g.panel(x, y, w, 18 + Math.max(1, n) * 13, { title: title || '순위' });
    if (!n) g.text('아직 기록 없음', x + w / 2, y + 10, PAL.grey, { size: 'xs', align: 'center' });
    for (let i = 0; i < n; i++) {
      const r = rows[i], e = s.ents[r.idx], yy = y + 10 + i * 13;
      if (r.idx === hl) g.rect(x + 3, yy - 2, w - 6, 12, 'rgba(254,174,52,0.25)');
      if (i < 3) g.medal(x + 10, yy + 4, i + 1, 3); else g.text(String(i + 1), x + 10, yy, PAL.grey, { size: 'xs', align: 'center' });
      g.flag(e.country, x + 18, yy, 12, 8);
      g.text(OG.entLabel(e), x + 34, yy - 1, OG.entColor(e), { size: 's' });
      g.text(s.sc[r.idx].txt, x + w - 6, yy - 1, PAL.white, { size: 's', align: 'right', maxW: w - 62 });
    }
  }

  function drawScore(g, s, P, k) {
    const sc = s.sc[P.idx], ent = s.ents[P.idx];
    if (!sc) return;
    const a = k; // seconds into score phase
    const x = 98, y = 32, w = 252, h = 162;
    g.alpha(Math.min(1, a * 4)); g.panel(x, y, w, h, { title: '심판 채점', bg: 'rgba(14,12,28,0.95)' }); g.alpha(1);
    if (a < 0.2) return;
    g.flag(ent.country, x + 10, y + 10, 24, 16);
    g.text((ent.human ? ent.tag + ' ' : '') + (OG.countryName ? OG.countryName(ent.country) : ent.country), x + 40, y + 12, ent.human ? OG.PCOLORS[ent.pid % 8] : PAL.white, { size: 'b', maxW: w - 50 });
    // judges cards
    const jd = sc.jd || [];
    const tr = jd.length >= 3 ? trimIdx(jd) : [-1, -1];
    g.text(sc.jl || '', x + w / 2, y + 31, PAL.grey, { size: 'xs', align: 'center' });
    const cw = Math.min(30, Math.floor((w - 20) / Math.max(1, jd.length)));
    const x0 = x + (w - jd.length * cw) / 2;
    for (let i = 0; i < jd.length; i++) {
      const sh = a > 0.4 + i * 0.08;
      const cx = x0 + i * cw;
      g.rect(cx, y + 42, cw - 3, 14, sh ? '#ffffff' : '#3a4466');
      if (sh) {
        g.text(fmtN(jd[i], sc.jdDec != null ? sc.jdDec : 1), cx + (cw - 3) / 2, y + 45, PAL.black, { size: 'xs', align: 'center', maxW: cw - 5 });
        if ((i === tr[0] || i === tr[1]) && a > 1.0 && !sc.noTrim) g.line(cx + 1, y + 55, cx + cw - 5, y + 43, PAL.red);
      }
      g.text('J' + (i + 1), cx + (cw - 3) / 2, y + 57, PAL.grey, { size: 'xs', align: 'center' });
    }
    const vis = sc.parts.filter(p => p[3] !== false);
    const gap = vis.length > 3 ? 10 : 13;
    vis.forEach((p, i) => {
      if (a < 1.1 + i * 0.3) return;
      const yy = y + 70 + i * gap;
      g.text(p[0], x + 14, yy, PAL.lightgrey, { size: vis.length > 3 ? 'xs' : 's' });
      if (sc.bars) g.bar(x + 70, yy + 1, 120, 7, p[1] / 20, PAL.cyan);
      g.text(p[1].toFixed(p[2]), x + w - 14, yy, p[1] < 0 ? PAL.rose : PAL.white, { size: vis.length > 3 ? 'xs' : 's', align: 'right' });
    });
    if (sc.flags && a > 2.4) {
      const red = sc.flags.reduce((q, v) => q + v, 0);
      g.text('깃발 판정 (선두 대비)  AKA ' + red + ' : ' + (5 - red) + ' AO', x + w / 2, y + 119, red >= 3 ? PAL.rose : PAL.cyan, { size: 'xs', align: 'center' });
    }
    if (a > 2.1) {
      const kk = Math.min(1, (a - 2.1) / 0.6);
      const v = sc.tot * sm(kk);
      g.rect(x + 10, y + h - 36, w - 20, 1, PAL.slate);
      g.text(v.toFixed(sc.dec) + (sc.unit || ''), x + w / 2 - (kk >= 1 ? 18 : 0), y + h - 31, PAL.yellow, { size: 'xl', align: 'center', outline: PAL.black, maxW: w - 90 });
      if (kk >= 1) {
        const rows = standings(s);
        const rank = rows.findIndex(r => r.idx === P.idx) + 1;
        if (rank > 0) {
          const rt = rank === 1 ? '현재 1위!' : '현재 ' + rank + '위';
          g.text(rt, x + w - 10, y + h - 24, rank === 1 ? PAL.gold : PAL.white, { size: 's', align: 'right', outline: PAL.black });
          if (rank <= 3) g.medal(x + w - 22, y + h - 32, rank, 4);
        }
      }
    }
  }

  /* =============================== ENGINE ============================== */
  function startNext(s, R) {
    // post CPU results that perform before the next human
    while (s.pos < s.order.length) {
      const idx = s.order[s.pos];
      const e = s.ents[idx];
      if (e.human || idx === s.demo) break;
      s.sc[idx].posted = true; s.recent = idx;
      s.pos++;
    }
    if (s.pos >= s.order.length) { s.phase = 'final'; s.pt = 0; s.P = null; OG.sfx(s, 'cheer'); return; }
    const idx = s.order[s.pos];
    const e = s.ents[idx];
    const auto = !e.human;
    s.P = newPerf(s, idx, R, e.human ? 0.93 : M.clamp(e.skill + R.gauss() * 0.05, 0.05, 1), { auto, q: auto ? M.clamp(e.skill + 0.05, 0, 1) : 0 });
    s.phase = 'intro'; s.pt = 0;
  }
  function finishPerf(s, R) {
    const P = s.P, Kd = K[s.kind];
    const sc = SC[Kd.sc](P, Kd, R);
    if (sc.flags) {
      const ld = leader(s);
      const lj = ld && ld.idx !== P.idx ? s.sc[ld.idx].jd : null;
      sc.flags = [0, 1, 2, 3, 4].map(i => (!lj || sc.jd[i] + (sc.tot - (ld ? ld.tot : 0)) / 5 >= lj[i]) ? 1 : 0);
    }
    sc.posted = true;
    s.sc[P.idx] = sc;
    s.phase = 'score'; s.pt = 0;
    OG.sfx(s, 'cheer');
  }
  function simulateCPU(s, ent, R) {
    const Kd = K[s.kind];
    const q = OG.cpuQuality(ent, R, 0.05);
    const P = newPerf(s, ent.idx, R, M.clamp(ent.skill + R.gauss() * 0.05, 0.05, 1), { sim: true });
    P.notes.forEach(n => {
      const j = simJ(q, R, n);
      if (n.k === 'm') n.c = j === 1 ? n.n : Math.ceil(n.n * 0.7);
      P.t = n.t; judge(s, P, n, j);
    });
    if (Kd.simExtra) Kd.simExtra(P, q, R);
    P.t = P.end; P.hsum = P.end * (0.25 + 0.6 * (P.nP / Math.max(1, P.notes.length)));
    const sc = SC[Kd.sc](P, Kd, R);
    sc.posted = false;
    return sc;
  }

  OG.defineEngine('routine', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) {
      const kind = ev.cfg.kind;
      const nh = ents.filter(e => e.human).length;
      const s = {
        evId: ev.id, kind, phase: 'next', pt: 0, dur: DURS[Math.min(8, nh)], done: false,
        ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, tag: e.tag || '', look: e.look | 0, skill: M.round(e.skill || 0.5, 3) })),
        order: [], pos: 0, sc: [], P: null, demo: -1, recent: -1, nh
      };
      // performing order: weaker first, humans late (dramatic), random tie-break
      const keyed = s.ents.map(e => ({ idx: e.idx, k: (e.human ? 0.82 : e.skill) + R.gauss() * 0.12 }));
      keyed.sort((a, b) => a.k - b.k);
      s.order = keyed.map(o => o.idx);
      if (nh === 0 && s.ents.length) { // spectator demo: strongest CPU performs on screen
        let b = 0; s.ents.forEach((e, i) => { if (e.skill > s.ents[b].skill) b = i; });
        s.demo = b; s.order.splice(s.order.indexOf(b), 1); s.order.push(b);
      }
      s.ents.forEach(e => { s.sc[e.idx] = (e.human || e.idx === s.demo) ? null : simulateCPU(s, e, R); });
      return s;
    },
    update(s, inputs, dt, R) {
      if (s.done) return;
      s.pt += dt;
      if (s.phase === 'next') startNext(s, R);
      if (s.phase === 'intro') {
        const P = s.P;
        P.t = s.pt - 3;
        const k = Math.ceil(3 - s.pt);
        if (k !== s.ck && k >= 1 && k <= 3) { s.ck = k; OG.sfx(s, 'beep'); }
        if (s.pt >= 3) { s.phase = 'play'; s.ck = 0; P.t = 0; OG.sfx(s, 'go'); }
      } else if (s.phase === 'play') {
        const P = s.P, ent = s.ents[P.idx];
        const inp = ent.human ? (inputs[ent.pid] || OG.blankInput()) : null;
        updatePlay(s, P, inp, dt, R);
        if (P.t >= P.end) finishPerf(s, R);
      } else if (s.phase === 'score') {
        s.P.t += dt;
        const lim = s.nh >= 4 ? 3.2 : 4.2;
        const ent = s.ents[s.P.idx];
        const inp = ent.human ? inputs[ent.pid] : null;
        if (s.pt > lim || (s.pt > 2.9 && inp && inp.ap)) { s.pos++; s.phase = 'next'; s.pt = 0; startNext(s, R); }
      } else if (s.phase === 'final') {
        if (s.pt > 2.6) {
          const rows = s.ents.map(e => { const sc = s.sc[e.idx]; return { idx: e.idx, score: sc ? sc.tot : 0, text: sc ? sc.txt : '-' }; });
          s.results = OG.sortResults(rows, false);
          s.done = true;
        }
      }
    },
    draw(g, s) {
      const Kd = K[s.kind];
      const P = s.P;
      const t = P ? P.t : s.pt;
      let shx = 0;
      if (P && P.t - P.shake < 0.3 && P.t >= P.shake) shx = Math.round(sin(P.t * 90) * 2);
      if (shx) { g.save(); g.translate(shx, 0); }
      Kd.stage(g, s, P, P ? P.t : g.t);
      if (P) {
        Kd.actor(g, s, P, P.t);
        drawFx(g, P);
      }
      if (shx) g.restore();
      if (s.phase === 'intro' || s.phase === 'play') {
        drawLane(g, s, P, Kd);
        drawHUD(g, s, P, Kd);
      }
      if (s.phase === 'intro') {
        const ent = s.ents[P.idx];
        const col = ent.human ? OG.PCOLORS[ent.pid % 8] : PAL.lightgrey;
        const name = OG.countryName ? OG.countryName(ent.country) : ent.country;
        const label = ent.human ? ent.tag + ' 차례' : '시범 연기';
        g.rect(0, 40, 480, 46, 'rgba(12,10,26,0.82)');
        g.rect(0, 40, 480, 2, col); g.rect(0, 84, 480, 2, col);
        g.flag(ent.country, 150, 49, 36, 24, { wave: g.t });
        g.text(label, 196, 45, col, { size: 'xl', outline: PAL.black });
        g.text(name + (Kd.introSub ? '  ·  ' + Kd.introSub(s, P) : ''), 198, 70, PAL.white, { size: 's', shadow: true });
        drawBoard(g, s, 334, 96, 138, 4, '현재 순위', -1);
        g.countdown(3 - s.pt + 0.0001 > 3 ? 3 : 3 - s.pt);
      }
      if (s.phase === 'score' && P) {
        drawScore(g, s, P, s.pt);
        const ent = s.ents[P.idx];
        let nxt = null; for (let i = s.pos + 1; i < s.order.length; i++) { const e2 = s.ents[s.order[i]]; if (e2.human) { nxt = e2; break; } }
        g.rect(0, 226, 480, 44, 'rgba(12,10,26,0.85)');
        if (nxt) g.text('다음 차례: ' + nxt.tag + ' ' + (OG.countryName ? OG.countryName(nxt.country) : nxt.country), 240, 232, OG.PCOLORS[nxt.pid % 8], { size: 'b', align: 'center', outline: PAL.black });
        else g.text('모든 연기 종료 — 최종 순위 발표', 240, 232, PAL.yellow, { size: 'b', align: 'center', outline: PAL.black });
        if (ent.human && s.pt > 2.9) g.rich('{A} 계속', 240, 252, PAL.white, { align: 'center', shadow: true });
        drawBoard(g, s, 356, 40, 120, 6, '순위', P.idx);
      }
      if (s.phase === 'final') {
        g.rect(0, 0, 480, 270, 'rgba(12,10,26,0.55)');
        g.banner('최종 순위', 26, PAL.yellow, { size: 'l' });
        drawBoard(g, s, 140, 52, 200, 8, OG.EVENT_MAP[s.evId] ? OG.EVENT_MAP[s.evId].name : '결과', -1);
        g.confetti(g.t, 60);
      }
    }
  });

  OG.defineEvents([
    { id: 'floor', name: '마루운동', en: 'Floor Exercise', sport: 'gymnastics', icon: '🤸', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'floor' },
      help: ['화살표/{A}가 판정선에 닿을 때 정확히 누르기', '{A}: 공중돌기 도약 · {D}: 착지 고정(스틱!)', 'PERFECT 연속 = 연결 가산점'] },
    { id: 'figure_skating', name: '피겨스케이팅', en: 'Figure Skating', sport: 'figure_skating', icon: '⛸️', tags: ['winter'], engine: 'routine', cfg: { kind: 'skate' },
      help: ['점프: {A} 누르고 있다가 끝 표시에서 떼기', '스핀: {A} 연타 · 스텝: 화살표 타이밍', '쇼트 프로그램 (TES + PCS)'] },
    { id: 'beam', name: '평균대', en: 'Balance Beam', sport: 'gymnastics', icon: '🤸', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'beam' },
      help: ['기술 사이: {L}{R}로 균형 바늘을 가운데로', '화살표/{A} 타이밍: 도약·공중돌기', '떨어지면 -1.0 감점!'] },
    { id: 'rings', name: '링', en: 'Still Rings', sport: 'gymnastics', icon: '🤸', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'rings' },
      help: ['{U}{D} 박자에 맞춰 스윙', '{D} 꾹 누르기: 크로스 버티기', '{A} 이탈 → {D} 착지 고정!'] },
    { id: 'pommel', name: '안마', en: 'Pommel Horse', sport: 'gymnastics', icon: '🤸', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'pommel' },
      help: ['원 돌기: {L}{U}{R}{D} 순서로 리듬 맞춰', '다리가 향하는 방향의 버튼!', '마무리: {U} 꾹(물구나무) → {A} → {D}'] },
    { id: 'rhythmic', name: '리듬체조 리본', en: 'Rhythmic Gymnastics', sport: 'rhythmic', icon: '🎀', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'rhythmic' },
      help: ['리본 동작: 화살표를 박자에 맞춰', '{A} 던지기 → 떨어질 때 {A} 캐치!', '피봇: {A} 연타'] },
    { id: 'artistic_swim', name: '아티스틱 스위밍 듀엣', en: 'Artistic Swimming Duet', sport: 'artistic_swimming', icon: '🩱', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'swim' },
      help: ['두 선수의 싱크로! 박자를 놓치면 엇박자', '{U} 꾹 누르기: 다리를 물 위로', '{A}: 부스트 · 리프트'] },
    { id: 'breaking', name: '브레이킹', en: 'Breaking', sport: 'breaking', icon: '🕺', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'breaking' },
      help: ['탑록·풋워크: 비트에 맞춰 화살표', '파워무브: 연타! · 프리즈: {D} 꾹', 'PERFECT로 관중 HYPE 올리기'] },
    { id: 'dressage', name: '승마 마장마술', en: 'Dressage', sport: 'equestrian', icon: '🏇', tags: ['summer', 'asian'], engine: 'routine', cfg: { kind: 'dressage' },
      help: ['{L}{R}: 말의 발걸음 리듬 (피아페·파사지)', '{U}: 캔터 피루엣 보폭', '마지막: {D} 정지 → {A} 경례'] },
    { id: 'wushu_taolu', name: '우슈 투로 (장권)', en: 'Wushu Taolu', sport: 'wushu', icon: '🐉', tags: ['asian'], engine: 'routine', cfg: { kind: 'wushu' },
      help: ['화살표: 검/곤 공격 동작', '{A} 도약(선풍각·선자) → {D} 착지 고정', '연타: 무기 돌리기'] },
    { id: 'karate_kata', name: '가라테 카타', en: 'Karate Kata', sport: 'karate', icon: '🥋', tags: ['asian'], engine: 'routine', cfg: { kind: 'kata' },
      help: ['{R}/{L} 찌르기·이동 · {U} 막기 · {D} 하단 막기', '{U} 누르고 떼기: 발차기 스냅', '{A}: 기합! (힘 있게)'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
