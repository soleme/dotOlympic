/* =========================================================================
 * engine: climb — 스포츠클라이밍
 *   climb_speed   : 15 m 표준 스피드 벽. 모든 인간 플레이어가 각자 레인에서 동시에
 *                   레이스, 빈 레인은 CPU. 1차/2차 시기 중 베스트 기록.
 *   climb_boulder : 볼더 3~4문제 (차례제). 그립 게이지, 방향 선택, 다이노 타이밍,
 *                   배런도어 버티기, 탑 매칭. 점수 = 탑 25 / 존 10 − 실패 시도당 0.1
 * Climbers are drawn from BEHIND (facing the wall) with 2-bone IK limbs that
 * actually grab the holds (g.figure is a side view, which doesn't fit a wall).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const lerp = M.lerp, clamp = M.clamp;
  const BTNS = ['l', 'r', 'u', 'd', 'a'];
  const GLY = { l: '◀', r: '▶', u: '▲', d: '▼', a: 'A' };
  const KEYC = { l: 'L', r: 'R', u: 'U', d: 'D', a: 'A' };
  const OLC = '#14101e';

  /* ------------------------------------------------------------ input -- */
  function pressed(inp, skipD) {
    if (!inp) return '';
    let b = '', n = 0;
    for (let i = 0; i < 5; i++) {
      const k = BTNS[i];
      if (skipD && k === 'd') continue;
      if (inp[k + 'p']) { if (!b) b = k; n++; }
    }
    return n > 1 ? '*' : b;
  }
  function anyInput(inp) {
    if (!inp) return false;
    for (let i = 0; i < 5; i++) if (inp[BTNS[i]] || inp[BTNS[i] + 'p']) return true;
    return false;
  }

  /* -------------------------------------------------------------- fx --- */
  function addFx(s, o) {
    o.t0 = s.clk;
    if (o.ln == null) o.ln = 0;
    s.fx.push(o);
    if (s.fx.length > 32) s.fx.shift();
  }
  function pruneFx(s) {
    for (let i = s.fx.length - 1; i >= 0; i--) if (s.clk - s.fx[i].t0 > (s.fx[i].life || 1.2)) s.fx.splice(i, 1);
  }
  function drawFx(g, s, map) {
    for (let i = 0; i < s.fx.length; i++) {
      const f = s.fx[i];
      const life = f.life || 1.2, age = s.clk - f.t0, k = age / life;
      if (k < 0 || k > 1) continue;
      const p = map(f);
      if (!p) continue;
      const x = p[0], y = p[1];
      const seed = Math.floor(f.t0 * 997);
      if (f.k === 'txt') {
        g.alpha(k > 0.7 ? (1 - k) / 0.3 : 1);
        const rise = Math.min(age, 0.35) * 26 + age * 5;
        g.text(f.s, x, y - rise, f.c || PAL.white, { size: f.sz || 'b', align: 'center', outline: PAL.black });
        g.alpha(1);
      } else if (f.k === 'dust') {
        const n = f.n || 8;
        g.alpha(Math.max(0, 1 - k) * 0.9);
        for (let j = 0; j < n; j++) {
          const a = OG.hash(j, seed, 5) * M.TAU, sp = 12 + OG.hash(seed, j, 6) * 26;
          const px = x + Math.cos(a) * sp * age, py = y + Math.sin(a) * sp * age * 0.6 - age * 8 + age * age * 16;
          const sz = j % 3 === 0 ? 2 : 1;
          g.rect(px, py, sz, sz, f.c || '#f2f2f2');
        }
        g.alpha(1);
      } else if (f.k === 'ring') {
        g.alpha(1 - k); g.circleO(x, y, 3 + age * 36, f.c || PAL.yellow); g.alpha(1);
      } else if (f.k === 'spark') {
        g.alpha(1 - k);
        for (let j = 0; j < 12; j++) {
          const a = j / 12 * M.TAU + seed, r0 = 3 + age * 34, r1 = r0 + 5;
          g.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1, j % 2 ? (f.c || PAL.yellow) : PAL.white, 1);
        }
        g.alpha(1);
      }
    }
  }

  /* ---------------------------------------------------- small helpers -- */
  function countdown(g, remain, cx, cy) {
    if (remain > 3 || remain < -0.6) return;
    const label = remain > 2 ? '3' : remain > 1 ? '2' : remain > 0 ? '1' : 'GO!';
    g.text(label, cx, cy, remain > 0 ? PAL.white : PAL.green, { size: 'xxl', align: 'center', outline: PAL.black });
  }
  function keyAt(g, x, y, b) { // keycap centred on x,y
    const w = Math.max(11, Math.ceil(g.textW(GLY[b] || b, 'xs')) + 5);
    g.keycap(Math.round(x - w / 2), Math.round(y - 5), KEYC[b] || b);
  }
  function lp(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]; }

  /* ------------------------------------------------------ IK + figure -- */
  // two-bone IK from (ax,ay) to (bx,by); elbow/knee picked on the side away from cx
  function ik(ax, ay, bx, by, l1, l2, cx) {
    let dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
    if (d < 0.01) { dx = 0; dy = 0.01; d = 0.01; }
    const st = clamp(d / ((l1 + l2) * 0.97), 1, 1.18); l1 *= st; l2 *= st;
    const mx = (l1 + l2) * 0.999;
    if (d > mx) { bx = ax + dx / d * mx; by = ay + dy / d * mx; dx = bx - ax; dy = by - ay; d = mx; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d, px = ax + ux * a, py = ay + uy * a;
    const e1x = px - uy * h, e1y = py + ux * h, e2x = px + uy * h, e2y = py - ux * h;
    return Math.abs(e1x - cx) >= Math.abs(e2x - cx) ? [e1x, e1y, bx, by] : [e2x, e2y, bx, by];
  }
  function limb(g, ax, ay, J, c1, c2, w, ol) {
    if (ol) { g.line(ax, ay, J[0], J[1], OLC, w + 2); g.line(J[0], J[1], J[2], J[3], OLC, w + 2); }
    g.line(ax, ay, J[0], J[1], c1, w); g.line(J[0], J[1], J[2], J[3], c2, w);
  }
  function polyOL(g, pts, c, ol) {
    if (ol) {
      const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let k = 0; k < 4; k++) g.poly(pts.map((v, i) => v + D[k][i % 2]), OLC);
    }
    g.poly(pts, c);
  }
  /* Back-view climber. B (screen px): {x,y hip centre, lean, P px/m, hl,hr,fl,fr:[x,y]}
   * o: {harness, bag, label, lc, pony, t, shake, rand} */
  function drawClimber(g, B, look, o) {
    o = o || {};
    const P = B.P, big = P >= 20;
    const sh = o.shake || 0;
    const hx = B.x + sh, hy = B.y;
    const lean = B.lean || 0;
    const ux = Math.sin(lean), uy = -Math.cos(lean), rx = -uy, ry = ux;
    const nx = hx + ux * 0.5 * P, ny = hy + uy * 0.5 * P;
    const sd = 0.19 * P, sdn = 0.05 * P, hpw = 0.1 * P;
    const sL = [nx - rx * sd - ux * sdn, ny - ry * sd - uy * sdn], sR = [nx + rx * sd - ux * sdn, ny + ry * sd - uy * sdn];
    const pL = [hx - rx * hpw, hy - ry * hpw], pR = [hx + rx * hpw, hy + ry * hpw];
    const aw = Math.max(1, Math.round(P * 0.075)), lw = Math.max(1, Math.round(P * 0.1));
    const skin = look.skin, shirt = look.shirt, pants = look.pants;
    const ua = 0.3 * P, fa = 0.29 * P, th = 0.43 * P, sn = 0.43 * P;
    const aL = ik(sL[0], sL[1], B.hl[0] + sh, B.hl[1], ua, fa, hx), aR = ik(sR[0], sR[1], B.hr[0] + sh, B.hr[1], ua, fa, hx);
    const lL = ik(pL[0], pL[1], B.fl[0] + sh, B.fl[1], th, sn, hx), lR = ik(pR[0], pR[1], B.fr[0] + sh, B.fr[1], th, sn, hx);
    // legs + shoes
    const pantsD = OG.shade(pants, -0.18);
    limb(g, pL[0], pL[1], lL, pantsD, pantsD, lw, big);
    limb(g, pR[0], pR[1], lR, pants, pants, lw, big);
    const sw = Math.max(2, Math.round(0.14 * P)), shh = Math.max(1, Math.round(0.065 * P));
    [lL, lR].forEach(L => {
      if (big) g.rect(L[2] - sw / 2 - 1, L[3] - shh - 1, sw + 2, shh + 2, OLC);
      g.rect(L[2] - sw / 2, L[3] - shh, sw, shh, '#2c2c3e');
      if (big) g.rect(L[2] - sw / 2, L[3] - 1, sw, 1, o.rand || PAL.orange);
    });
    // arms
    const sleeve = o.sleeve || skin;
    limb(g, sL[0], sL[1], aL, sleeve, OG.shade(skin, -0.08), aw, big);
    limb(g, sR[0], sR[1], aR, sleeve, skin, aw, big);
    // torso (tank top) + bib
    const tw = 0.035 * P;
    const torso = [sL[0] - rx * tw, sL[1] - ry * tw, sR[0] + rx * tw, sR[1] + ry * tw, pR[0] + rx * tw * 0.4, pR[1] + ry * tw * 0.4, pL[0] - rx * tw * 0.4, pL[1] - ry * tw * 0.4];
    polyOL(g, torso, shirt, big);
    if (big) {
      // shoulder blades shading + competition bib
      const mx = (nx + hx) / 2, my = (ny + hy) / 2;
      g.line(nx - ux, ny - uy + 2, hx + ux * 2, hy + uy * 2, OG.shade(shirt, -0.12), 1);
      const bw = Math.round(0.17 * P), bh = Math.round(0.12 * P);
      g.rect(mx - bw / 2, my - bh / 2 - 1, bw, bh, '#f4f4f4');
      g.rect(mx - bw / 2 + 2, my - 1, bw - 4, 1, '#55607a');
      g.rect(mx - bw / 2 + 2, my - bh / 2 + 1, 3, 2, o.lc || PAL.red);
    }
    // waist / shorts
    g.rect(hx - hpw - 1, hy - Math.max(1, 0.05 * P), 2 * hpw + 3, Math.max(2, 0.1 * P), pants);
    if (o.harness) {
      const hw = Math.max(1, Math.round(0.045 * P));
      g.line(pL[0] - rx * 2, pL[1] - 1, pR[0] + rx * 2, pR[1] - 1, '#3b3d52', hw);
      g.line(lL[0] * 0.3 + pL[0] * 0.7 - 2, lL[1] * 0.3 + pL[1] * 0.7, lL[0] * 0.3 + pL[0] * 0.7 + 2, lL[1] * 0.3 + pL[1] * 0.7, '#3b3d52', hw);
      g.line(lR[0] * 0.3 + pR[0] * 0.7 - 2, lR[1] * 0.3 + pR[1] * 0.7, lR[0] * 0.3 + pR[0] * 0.7 + 2, lR[1] * 0.3 + pR[1] * 0.7, '#3b3d52', hw);
    }
    if (o.bag) { // chalk bag on the back
      const bw = Math.max(2, Math.round(0.12 * P)), bh = Math.max(2, Math.round(0.1 * P));
      if (big) g.rect(hx - bw / 2 - 1, hy - bh - 1, bw + 2, bh + 2, OLC);
      g.rect(hx - bw / 2, hy - bh, bw, bh, o.bagC || '#2ce8f5');
      g.rect(hx - bw / 2, hy - bh, bw, 1, '#ffffff');
    }
    // neck + head
    const hr = Math.max(1.6, 0.115 * P);
    const hcx = nx + ux * (0.04 * P + hr), hcy = ny + uy * (0.04 * P + hr);
    g.line(nx, ny, hcx, hcy, skin, Math.max(1, Math.round(0.09 * P)));
    if (big) g.circle(hcx, hcy, hr + 1, OLC);
    g.circle(hcx, hcy, hr, look.hair);
    if (big) { g.px(hcx - hr, hcy + 1, skin); g.px(hcx + hr, hcy + 1, skin); g.px(hcx - 1, hcy - hr + 1, OG.shade(look.hair, 0.3)); }
    if (o.pony) g.line(hcx, hcy + hr * 0.4, hcx + Math.sin((o.t || 0) * 4) * 1.2, hcy + hr + 0.15 * P, look.hair, Math.max(1, Math.round(P * 0.05)));
    // hands on top
    const hs = Math.max(1, Math.round(0.075 * P));
    [aL, aR].forEach(A => {
      if (big) g.rect(A[2] - hs / 2 - 1, A[3] - hs / 2 - 1, hs + 2, hs + 2, OLC);
      g.rect(A[2] - hs / 2, A[3] - hs / 2, hs, hs, skin);
      if (big) g.px(A[2] - hs / 2, A[3] - hs / 2, '#ffffff');
    });
    if (o.label) g.text(o.label, hcx, hcy - hr - 11, o.lc || PAL.white, { size: 'xs', align: 'center', outline: PAL.black });
    return { head: [hcx, hcy], hr };
  }

  /* ----------------------------------------------- pose construction --- *
   * All poses are in metres (x right, y UP). cfg = {b:{x,y,lean}, hl, hr, f:[fl,fr]} */
  function bodyOf(hl, hr) {
    const top = Math.max(hl[1], hr[1]);
    const w = 0.5 + clamp((hr[1] - hl[1]) * 0.6, -0.3, 0.3);
    const x = hl[0] * (1 - w) + hr[0] * w;
    const lean = clamp(((hl[0] + hr[0]) / 2 - x) * 0.6 + (hr[1] - hl[1]) * 0.2, -0.35, 0.35);
    return { x, y: top - 1.1, lean };
  }
  function feetOf(b, snaps) {
    const out = [];
    for (let sd = -1; sd <= 1; sd += 2) {
      let fx = b.x + sd * 0.26, fy = b.y - 0.74;
      if (fy < 0.05) { fx = b.x + sd * 0.2; fy = 0; } else if (snaps) {
        let best = 0.34 * 0.34, bp = null;
        for (let i = 0; i < snaps.length; i++) {
          const p = snaps[i], dx = p.x - fx, dy = p.y - fy, d = dx * dx + dy * dy;
          if (d < best && p.y < b.y - 0.35) { best = d; bp = p; }
        }
        if (bp) { fx = bp.x + sd * 0.03; fy = bp.y + 0.03; }
      }
      out.push([fx, fy]);
    }
    return out;
  }
  // blend config A → C while hand mh ('l'|'r'|'b') travels; p 0..1
  function blendPose(A, C, mh, p) {
    p = clamp(p, 0, 1);
    const e = M.ease(p);
    const hp = clamp((p - 0.1) / 0.9, 0, 1), he = M.ease(hp), arc = Math.sin(Math.PI * hp) * 0.12;
    const b = { x: lerp(A.b.x, C.b.x, e), y: lerp(A.b.y, C.b.y, e) + Math.sin(Math.PI * p) * 0.05, lean: lerp(A.b.lean, C.b.lean, e) };
    const mvL = mh === 'l' || mh === 'b', mvR = mh === 'r' || mh === 'b';
    const hl = mvL ? [lerp(A.hl[0], C.hl[0], he), lerp(A.hl[1], C.hl[1], he) + arc] : A.hl.slice();
    const hr = mvR ? [lerp(A.hr[0], C.hr[0], he), lerp(A.hr[1], C.hr[1], he) + arc] : A.hr.slice();
    const k1 = M.ease(clamp(p * 1.5, 0, 1)), k2 = M.ease(clamp((p - 0.35) / 0.65, 0, 1));
    const kL = mh === 'l' ? k2 : k1, kR = mh === 'l' ? k1 : k2;
    const fl = [lerp(A.f[0][0], C.f[0][0], kL), lerp(A.f[0][1], C.f[0][1], kL) + Math.sin(Math.PI * kL) * 0.08];
    const fr = [lerp(A.f[1][0], C.f[1][0], kR), lerp(A.f[1][1], C.f[1][1], kR) + Math.sin(Math.PI * kR) * 0.08];
    return { b, hl, hr, f: [fl, fr] };
  }
  function standCfg(x, t, walk, chalk) {
    const ph = walk ? Math.sin(t * 11) : 0;
    const b = { x, y: 0.92 + Math.abs(ph) * 0.02, lean: 0 };
    const hl = [x - 0.27 - ph * 0.05, 0.84], hr = [x + 0.27 + ph * 0.05, 0.84];
    if (chalk) { hr[0] = x + 0.04; hr[1] = 0.88 + Math.sin(t * 9) * 0.03; }
    return { b, hl, hr, f: [[x - 0.14 + ph * 0.1, Math.max(0, ph) * 0.07], [x + 0.14 - ph * 0.1, Math.max(0, -ph) * 0.07]] };
  }
  function fallCfg(x, y, happy) {
    const b = { x, y, lean: 0 };
    const up = happy ? 1.15 : 0.95;
    return { b, hl: [x - 0.42, y + up], hr: [x + 0.42, y + up], f: [[x - 0.22, y - 0.6], [x + 0.24, y - 0.66]] };
  }
  function landCfg(x, p, happy, t) {
    const k = M.ease(clamp((p - 0.25) / 0.75, 0, 1));
    const y = lerp(0.5, 0.92, k);
    const b = { x, y, lean: 0 };
    let hl = [x - 0.3, y - 0.1], hr = [x + 0.3, y - 0.1];
    if (happy && p > 0.2) { const w = Math.sin(t * 10) * 0.06; hl = [x - 0.36, y + 1.08 + w]; hr = [x + 0.36, y + 1.08 - w]; }
    return { b, hl, hr, f: [[x - 0.25 + k * 0.1, 0], [x + 0.25 - k * 0.1, 0]] };
  }
  // convert a metre-pose to screen space
  function toScr(C, X, Y, P) {
    return {
      x: X(C.b.x), y: Y(C.b.y), lean: C.b.lean, P,
      hl: [X(C.hl[0]), Y(C.hl[1])], hr: [X(C.hr[0]), Y(C.hr[1])],
      fl: [X(C.f[0][0]), Y(C.f[0][1])], fr: [X(C.f[1][0]), Y(C.f[1][1])]
    };
  }

  /* ------------------------------------------------------------ holds -- */
  function drawHold(g, x, y, ty, col, P) {
    const ol = OG.shade(col, -0.72), dk = OG.shade(col, -0.35), lt = OG.shade(col, 0.45);
    const k = P / 40;
    if (ty === 'jug' || ty === 'speed') {
      const rx = Math.max(2, (ty === 'speed' ? 0.2 : 0.17) * P), ry = Math.max(1.2, (ty === 'speed' ? 0.12 : 0.1) * P);
      g.ellipse(x, y + 1, rx + 1, ry + 1, ol);
      g.ellipse(x, y, rx, ry, col);
      g.ellipse(x, y + ry * 0.45, rx * 0.85, ry * 0.5, dk);
      if (P >= 20) { g.rect(x - rx * 0.5, y - ry * 0.6, Math.max(1, rx * 0.5), 1, lt); g.rect(x - 1, y - 1, 2, 2, ol); }
    } else if (ty === 'crimp') {
      const w = Math.max(3, 0.24 * P), h = Math.max(2, 0.07 * P);
      g.rect(x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, ol);
      g.rect(x - w / 2, y - h / 2, w, h, col);
      g.rect(x - w / 2, y + h / 2 - 1, w, 1, dk);
      g.rect(x - w / 2 + 1, y - h / 2, w - 2, 1, lt);
    } else if (ty === 'sloper') {
      const rx = Math.max(2, 0.21 * P), ry = Math.max(1.5, 0.13 * P);
      g.ellipse(x, y + 1, rx + 1, ry + 1, ol);
      g.ellipse(x, y, rx, ry, dk);
      g.ellipse(x - 1 * k, y - ry * 0.25, rx * 0.8, ry * 0.65, col);
      g.ellipse(x - rx * 0.3, y - ry * 0.45, rx * 0.3, ry * 0.25, lt);
    } else if (ty === 'pinch') {
      const rx = Math.max(1.2, 0.065 * P), ry = Math.max(2, 0.16 * P);
      g.ellipse(x, y, rx + 1, ry + 1, ol);
      g.ellipse(x, y, rx, ry, col);
      g.rect(x + rx * 0.2, y - ry * 0.7, 1, ry * 1.3, dk);
      g.rect(x - rx * 0.6, y - ry * 0.6, 1, ry * 0.6, lt);
    } else { // foot chip
      const w = Math.max(2, 0.08 * P);
      g.rect(x - w / 2 - 1, y - w / 2 - 1, w + 2, w + 1, ol);
      g.rect(x - w / 2, y - w / 2, w, w - 1, col);
    }
  }

  /* =============================== SPEED ================================ */
  // Standardised route (lane-local metres, lane = 3 m wide). Hands alternate R,L,R…;
  // the button for each hold follows from its direction (◀ ▶ ▲), buzzer = ACTION.
  const SPD = (function () {
    const mv = [['r', .9, .6], ['l', -.9, .65], ['u', .2, .7], ['l', -.8, .6], ['r', .9, .65], ['u', -.2, .7], ['r', .8, .6],
      ['u', -.2, .65], ['u', .2, .7], ['l', -.9, .6], ['r', .8, .65], ['l', -.9, .7], ['u', .2, .6], ['l', -.8, .65],
      ['r', .9, .7], ['u', -.2, .6], ['r', .8, .65], ['l', -.9, .7], ['u', .2, .6]];
    const H = [{ x: 1.35, y: 1.75, b: '', hand: '' }];
    let x = 1.35, y = 1.75;
    for (let i = 0; i < mv.length; i++) {
      x += mv[i][1]; y += mv[i][2];
      H.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, b: mv[i][0], hand: i % 2 ? 'l' : 'r' });
    }
    H.push({ x: 1.5, y: 14.8, b: 'a', hand: 'l', buzz: 1 });
    const F = [];
    for (let k = 1; k < H.length - 1; k++) {
      const lh = H[k].hand === 'l' ? k : k - 1, rh = H[k].hand === 'r' ? k : k - 1;
      const b = bodyOf([H[lh].x, H[lh].y + 0.04], [H[rh].x, H[rh].y + 0.04]);
      const sd = k % 2 ? -1 : 1, fy = b.y - 0.74;
      if (fy > 0.3) F.push({ x: Math.round((b.x + sd * 0.26) * 100) / 100, y: Math.round(fy * 100) / 100 });
    }
    const snaps = F.concat(H.slice(0, -1).map(h => ({ x: h.x, y: h.y })));
    return { H, F, N: H.length - 1, snaps };
  })();
  const SP_LIMIT = 20;   // seconds per run before an unfinished lane counts as "no time"

  function cpuSpeedTime(q, R) {
    if (R.chance(0.02 + 0.05 * (1 - q))) return -2;
    let t = (7.95 - 2.9 * q) * (1 + 0.022 * R.gauss());
    if (R.chance(0.06 + 0.2 * (1 - q))) t += R.range(0.3, 0.8);
    return M.round(Math.max(4.8, t), 3);
  }

  function speedInit(ev, ents, opts, R) {
    const hum = ents.filter(e => e.human).sort((a, b) => a.pid - b.pid).map(e => e.idx);
    const cpu = ents.filter(e => !e.human).map(e => e.idx);
    const nL = Math.max(1, Math.min(8, ents.length, Math.max(2, hum.length)));
    const P = nL <= 4 ? 28 : 14;
    const s = {
      evId: ev.id, mode: 'speed', t: -3, clk: 0, phase: 'count', pt: 0, run: 0, nRuns: 2,
      nL, P, cam: 0, camMax: P === 28 ? 8.4 : 0, win: -1,
      ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, tag: e.tag || '', look: e.look | 0 })),
      runs: ents.map(() => [-1, -1]),
      cq: ents.map(e => e.human ? [0, 0] : [OG.cpuQuality(e, R, 0.09), OG.cpuQuality(e, R, 0.09)]),
      cpuT: [], heats: [], lanes: [], fx: [], done: false, results: null
    };
    s.cpuT = s.cq.map((qq, i) => ents[i].human ? [0, 0] : qq.map(q => cpuSpeedTime(q, R)));
    const need = Math.max(0, nL - hum.length);
    const pool = R.shuffle(cpu.slice());
    for (let r = 0; r < 2; r++) {
      const ln = hum.slice(0, nL);
      for (let j = 0; j < need && pool.length; j++) ln.push(pool[(r * need + j) % pool.length]);
      s.heats.push(r === 0 ? ln : ln.reverse());
    }
    spSetupRun(s, R);
    return s;
  }
  function spSetupRun(s, R) {
    const heat = s.heats[s.run];
    s.lanes = heat.map(idx => {
      const e = s.ents[idx];
      const L = { e: idx, hi: 0, lh: 0, rh: 0, to: -1, mh: '', mv: 0, dur: 0.3, slip: 0, flow: 0, wait: 0, buf: '', fin: -1, rt: -1, dm: 0.3, rtT: 0, ps: 0 };
      if (!e.human) {
        const q = s.cq[idx][s.run];
        L.rtT = M.round(0.13 + 0.12 * (1 - q) + Math.abs(R.gauss()) * 0.03, 3);
        L.dm = ((7.95 - 2.9 * q) - L.rtT - 0.1) / SPD.N;
        L.ps = 0.004 + 0.012 * (1 - q);
      }
      return L;
    });
    s.ents.forEach((e, i) => { if (!e.human && heat.indexOf(i) < 0) s.runs[i][s.run] = s.cpuT[i][s.run]; });
    s.t = -3; s.phase = 'count'; s.pt = 0; s.win = -1;
  }
  function spSlip(s, L, i) {
    L.slip = 0.5; L.flow = 0; L.buf = '';
    OG.sfx(s, s.ents[L.e].human ? 'fail' : 'miss');
    const h = SPD.H[L.hi];
    addFx(s, { k: 'txt', ln: i, x: h.x, y: h.y + 0.45, s: '미끄러짐!', c: PAL.red, sz: 's', life: 0.9 });
    addFx(s, { k: 'dust', ln: i, x: h.x, y: h.y - 1.75, c: '#ffffff', n: 9, life: 0.7 });
  }
  function spStart(s, L, i, b, buffered) {
    const nx = SPD.H[L.hi + 1];
    if (b !== nx.b) { spSlip(s, L, i); return; }
    const pf = L.flow;
    if (L.hi === 0) { L.rt = M.round(Math.max(0, s.t), 3); L.flow = 0; } else {
      const quick = buffered || L.wait < 0.12;
      L.flow = quick ? Math.min(1, L.flow + 0.25) : Math.max(0, L.flow - 0.35);
    }
    L.dur = 0.3 - 0.09 * L.flow;
    L.to = L.hi + 1; L.mh = nx.hand; L.mv = 0; L.wait = 0;
    if (pf < 1 && L.flow >= 1) addFx(s, { k: 'txt', ln: i, x: nx.x, y: nx.y + 0.3, s: 'FLOW!', c: PAL.cyan, sz: 's', life: 0.8 });
  }
  function spArrive(s, L, i) {
    L.hi = L.to; if (L.mh === 'l') L.lh = L.to; else L.rh = L.to;
    L.to = -1; L.mv = 0; L.wait = 0;
    const h = SPD.H[L.hi];
    if (L.hi === SPD.N) {
      L.fin = M.round(s.t, 3);
      OG.sfx(s, 'buzzer');
      addFx(s, { k: 'spark', ln: i, x: h.x, y: h.y, c: PAL.yellow, life: 0.8 });
      addFx(s, { k: 'ring', ln: i, x: h.x, y: h.y, c: PAL.green, life: 0.6 });
      addFx(s, { k: 'txt', ln: i, x: 1.5, y: h.y - 2.3, s: OG.fmt.time(L.fin, 2), c: PAL.yellow, sz: 'l', life: 2.6 });
    } else if (s.ents[L.e].human) {
      OG.sfx(s, 'tick');
      addFx(s, { k: 'dust', ln: i, x: h.x, y: h.y, c: '#ffffff', n: 4, life: 0.4 });
    }
  }
  function spLane(s, L, i, inputs, dt, R) {
    if (L.fin !== -1) return;
    const e = s.ents[L.e];
    if (L.slip > 0) L.slip = Math.max(0, L.slip - dt);
    if (L.to >= 0) { L.mv += dt / L.dur; if (L.mv >= 1) spArrive(s, L, i); }
    if (L.fin !== -1) return;
    if (e.human) {
      if (L.to < 0 && L.slip <= 0 && L.buf) { const bb = L.buf; L.buf = ''; spStart(s, L, i, bb, true); }
      const b = pressed(inputs && inputs[e.pid], true);
      if (b && L.slip <= 0) {
        if (L.to >= 0) { if (L.mv >= 0.4 && !L.buf) L.buf = b; } else spStart(s, L, i, b, false);
      }
      if (L.to < 0) L.wait += dt;
    } else if (L.to < 0 && L.slip <= 0 && s.t >= L.rtT) {
      if (L.hi > 0 && R.chance(L.ps)) spSlip(s, L, i);
      else {
        const nx = SPD.H[L.hi + 1];
        if (L.hi === 0) L.rt = M.round(s.t, 3);
        L.to = L.hi + 1; L.mh = nx.hand; L.mv = 0;
        L.dur = clamp(L.dm * (1 + 0.07 * R.gauss()), 0.16, 0.6);
      }
    }
  }
  function spEndRun(s) {
    let best = 9999, bi = -1;
    s.lanes.forEach((L, i) => {
      if (L.fin === -1) {
        L.fin = -2;
        addFx(s, { k: 'txt', ln: i, x: 1.5, y: SPD.H[L.hi].y + 0.8, s: '시간 초과', c: PAL.red, sz: 's', life: 2.6 });
      }
      s.runs[L.e][s.run] = L.fin;
      if (L.fin >= 0 && L.fin < best) { best = L.fin; bi = i; }
    });
    s.win = bi; s.phase = 'post'; s.pt = 0;
    OG.sfx(s, 'cheer');
  }
  function spBest(s, i) {
    let b = -1, any = false;
    s.runs[i].forEach(t => { if (t >= 0 && (b < 0 || t < b)) b = t; if (t !== -1) any = true; });
    return b >= 0 ? b : any ? -2 : -1;
  }
  function spResults(s) {
    return OG.sortResults(s.ents.map((e, i) => {
      const b = spBest(s, i);
      if (b < 0) return { idx: i, score: 9999, text: 'DNF', dnf: true };
      return { idx: i, score: M.round(b, 3), text: OG.fmt.time(b, 2) };
    }), true);
  }
  function spHipY(L) {
    let y = SPD.H[L.hi].y;
    if (L.to >= 0) y = lerp(y, SPD.H[L.to].y, M.ease(clamp(L.mv, 0, 1)));
    return y - 1.05;
  }
  function speedUpdate(s, inputs, dt, R) {
    s.clk += dt;
    if (s.phase === 'count') {
      const pt = s.t; s.t += dt;
      if (s.t < 0 && Math.ceil(pt) !== Math.ceil(s.t)) OG.sfx(s, 'beep');
      if (s.t >= 0) { s.phase = 'race'; OG.sfx(s, 'go'); OG.sfx(s, 'crowd'); }
    } else if (s.phase === 'race') {
      s.t += dt;
      for (let i = 0; i < s.lanes.length; i++) spLane(s, s.lanes[i], i, inputs, dt, R);
      if (s.lanes.every(L => L.fin !== -1) || s.t > SP_LIMIT) spEndRun(s);
    } else if (s.phase === 'post') {
      s.t += dt; s.pt += dt;
      if (s.pt > 2.8) {
        if (s.run < s.nRuns - 1) { s.run++; spSetupRun(s, R); } else { s.results = spResults(s); s.done = true; }
      }
    }
    // camera follows the lowest still-climbing human
    let tg = 0;
    if (s.camMax > 0 && s.phase !== 'count') {
      const H = s.lanes.filter(L => s.ents[L.e].human), act = H.filter(L => L.fin === -1);
      if (act.length) tg = Math.min.apply(null, act.map(spHipY)) - 2.2;
      else if (H.length) tg = s.camMax;
      else tg = Math.max.apply(null, s.lanes.map(spHipY)) - 3.2;
    }
    s.cam += (clamp(tg, 0, s.camMax) - s.cam) * Math.min(1, dt * 5);
    pruneFx(s);
  }

  // lane pose (lane-local metres)
  function spCfg(lh, rh) {
    const a = SPD.H[lh], c = SPD.H[rh];
    const hl = [a.x, a.y + 0.04], hr = [c.x, c.y + 0.04];
    if (lh === rh) { hl[0] -= 0.11; hr[0] += 0.11; }
    const b = bodyOf(hl, hr);
    return { hl, hr, b, f: feetOf(b, SPD.snaps) };
  }
  function spPose(s, L) {
    let C = spCfg(L.lh, L.rh);
    if (L.to >= 0) C = blendPose(C, spCfg(L.mh === 'l' ? L.to : L.lh, L.mh === 'r' ? L.to : L.rh), L.mh, L.mv);
    if (L.slip > 0) {
      const k = Math.sin(clamp(1 - L.slip / 0.5, 0, 1) * Math.PI);
      C.b.y -= 0.2 * k;
      C.f[0] = [C.f[0][0] - 0.1 * k, C.f[0][1] - 0.3 * k];
      C.f[1] = [C.f[1][0] + 0.12 * k, C.f[1][1] - 0.25 * k];
    }
    if (L.fin >= 0 && s.t - L.fin > 0.3) {
      const w = Math.sin(s.clk * 11) * 0.07;
      C.hr = [C.b.x + 0.38, C.b.y + 1.18 + w];
    }
    return C;
  }

  function speedDraw(g, s) {
    const P = s.P, nL = s.nL, LW = 3 * P;
    const WX = Math.round((350 - nL * LW) / 2), WR = WX + nL * LW;
    const GY = 238, cam = s.cam, t = g.t;
    const Y = h => GY - (h - cam) * P;
    const X = (i, x) => WX + i * LW + x * P;
    const big = P >= 28;
    // ---- night sky, moon, skyline
    g.grad(0, 0, 480, 270, '#070920', '#2a2d5c', 12);
    for (let i = 0; i < 50; i++) {
      const sx = OG.hash(i, 3, 1) * 480, sy = M.wrap(OG.hash(i, 4, 1) * 190 + cam * P * 0.05, 190);
      g.px(sx, sy, OG.hash(i, 5, Math.floor(t * 2)) > 0.92 ? '#6f7aa8' : '#d8def5');
    }
    const my = 30 + cam * P * 0.05;
    g.circle(46, my, 9, '#f3edd0'); g.circle(43, my - 2, 2, '#ddd6b6'); g.circle(49, my + 3, 1.5, '#ddd6b6');
    const sky0 = 176 + cam * P * 0.3;
    for (let i = 0; i < 22; i++) {
      const bx = Math.round(i * 23 - 8 + OG.hash(i, 1, 2) * 8), bw = 15 + Math.floor(OG.hash(i, 2, 2) * 14), bh = 30 + Math.floor(OG.hash(i, 3, 2) * 80);
      const top = sky0 - bh;
      if (top > 270) continue;
      g.rect(bx, top, bw, 270 - top, i % 3 ? '#12153a' : '#171b45');
      for (let wy = top + 4; wy < Math.min(270, top + 120); wy += 6)
        for (let wx = bx + 3; wx < bx + bw - 3; wx += 5) if (OG.hash(wx, wy, 9) > 0.64) g.rect(wx, wy, 2, 2, OG.hash(wx, wy, 8) > 0.5 ? '#c78a2a' : '#e8dc9a');
    }
    // ---- stands beside the wall (world space)
    const exc = s.phase === 'race' ? 0.35 : s.phase === 'post' ? 0.6 : 0.12;
    const sTop = Y(4.4), sBot = Y(0);
    [[0, WX - 8], [WR + 8, 352]].forEach((r, k) => {
      const w = r[1] - r[0];
      if (w < 10 || sTop > 270) return;
      g.rect(r[0], sTop - 4, w, sBot - sTop + 4, '#232744');
      g.crowd(r[0], sTop, w, sBot - sTop, t, { excite: exc, seed: k + 3, bg: '#2a2f52' });
      g.rect(r[0], sTop - 4, w, 2, '#8b9bb4'); g.rect(r[0], sTop - 2, w, 1, '#3a4466');
      for (let x = r[0] + 3; x < r[1]; x += 10) g.rect(x, sTop - 8, 1, 6, '#8b9bb4');
    });
    // ---- spotlights
    g.alpha(0.07);
    for (let k = 0; k < 2; k++) {
      const ox = k ? 340 : 10, ex = 175 + Math.sin(t * 0.7 + k * 2.1) * 120;
      g.poly([ox, 0, ex - 34, 270, ex + 34, 270], '#fff6d8');
    }
    g.alpha(1);
    // ---- wall frame + top beam
    const wTop = Y(15.25), wBot = Y(0);
    g.rect(WX - 7, wTop - 6, 7, wBot - wTop + 6, '#3a4466'); g.rect(WR, wTop - 6, 7, wBot - wTop + 6, '#3a4466');
    g.rect(WX - 7, wTop - 6, 1, wBot - wTop + 6, '#5a6988'); g.rect(WR + 6, wTop - 6, 1, wBot - wTop + 6, '#262b44');
    for (let h = 0; h <= 15; h += 5) {
      const yy = Y(h);
      if (yy < -10 || yy > 270) continue;
      g.rect(WX - 7, yy, 7, 1, '#fee761');
      if (h > 0) g.text(h + 'm', WX - 9, yy - 4, PAL.lightgrey, { size: 'xs', align: 'right', outline: PAL.black });
    }
    // ---- lanes
    const dot = big ? 7 : 7;
    for (let i = 0; i < nL; i++) {
      const x0 = X(i, 0);
      for (let r = 0; r < 10; r++) {
        const y1 = Y(r * 1.5), y0 = Y(r * 1.5 + 1.5);
        if (y1 < 0 || y0 > 270) continue;
        for (let c = 0; c < 2; c++) g.rect(x0 + c * 1.5 * P, y0, 1.5 * P, y1 - y0, (r + c + i) % 2 ? '#e2672d' : '#d65c29');
        g.rect(x0, y0, LW, 1, '#a7431d');
        for (let yy = Math.ceil(y0 + 3); yy < y1 - 1; yy += dot)
          for (let xx = x0 + 3 + ((yy / dot | 0) % 2) * 3; xx < x0 + LW - 2; xx += dot) g.px(xx, yy, '#b44d22');
      }
      g.rect(x0 + 1.5 * P, Y(15), 1, Y(0) - Y(15), '#b9501f');
      g.rect(x0, Y(15.25), LW, Y(15) - Y(15.25), '#c2552a');
      if (i > 0) { g.rect(x0 - 1, Y(15.25), 2, Y(0) - Y(15.25), '#2a1a14'); g.rect(x0, Y(15.25), 1, Y(0) - Y(15.25), '#f2e8d8'); }
    }
    // top beam with LED + auto-belays
    g.rect(WX - 10, wTop - 12, WR - WX + 20, 12, '#1d2038');
    g.rect(WX - 10, wTop - 12, WR - WX + 20, 1, '#5a6988');
    if (WR - WX > 120) g.text('SPEED WALL  ·  15 M', (WX + WR) / 2, wTop - 10, PAL.orange, { size: 'xs', align: 'center' });
    for (let i = 0; i < nL; i++) {
      const ax = X(i, 1.5);
      g.rect(ax - 5, wTop - 2, 10, 7, '#5a6988'); g.rect(ax - 4, wTop - 1, 8, 5, '#8b9bb4'); g.px(ax, wTop + 1, PAL.red);
    }
    // ---- holds
    s.lanes.forEach((L, i) => {
      const e = s.ents[L.e];
      SPD.F.forEach(f => { const yy = Y(f.y); if (yy > -5 && yy < 275) drawHold(g, X(i, f.x), yy, 'foot', '#b81f2c', P); });
      for (let j = 0; j < SPD.N; j++) {
        const h = SPD.H[j], yy = Y(h.y);
        if (yy < -8 || yy > 278) continue;
        drawHold(g, X(i, h.x), yy, 'speed', '#c8202f', P);
      }
      // buzzer pad
      const bz = SPD.H[SPD.N], bx = X(i, bz.x), by = Y(bz.y);
      const lit = L.fin >= 0, blink = lit && Math.floor(s.clk * 6) % 2;
      g.rect(bx - 0.3 * P - 1, by - 0.2 * P - 1, 0.6 * P + 2, 0.4 * P + 2, OLC);
      g.rect(bx - 0.3 * P, by - 0.2 * P, 0.6 * P, 0.4 * P, '#e8e8f0');
      g.rect(bx - 0.18 * P, by - 0.1 * P, 0.36 * P, 0.2 * P, lit ? (blink ? PAL.green : '#a6ff8a') : '#7a1420');
      if (lit) { g.alpha(0.25); g.circle(bx, by, 0.6 * P, PAL.green); g.alpha(1); }
      // button glyphs on the upcoming holds (human lanes)
      if (e.human && L.fin === -1 && s.phase !== 'post') {
        const col = OG.PCOLORS[e.pid % OG.PCOLORS.length];
        for (let j = Math.min(SPD.N, L.hi + 4); j >= L.hi + 1; j--) {
          const h = SPD.H[j], hx = X(i, h.x), hy = Y(h.y);
          if (hy < -6 || hy > 276) continue;
          if (j === L.hi + 1 && L.to < 0) {
            const pr = 0.36 * P + Math.sin(s.clk * 12) * 1.5;
            g.circleO(hx, hy, pr, col); g.circleO(hx, hy, pr + 1, OLC);
            keyAt(g, hx, hy - 0.42 * P - 2, h.b);
          } else {
            g.alpha(j === L.hi + 1 ? 1 : 0.8 - (j - L.hi - 2) * 0.18);
            g.text(GLY[h.b], hx, hy - 0.36 * P - 4, j === L.hi + 1 ? col : PAL.white, { size: 'xs', align: 'center', outline: OLC });
            g.alpha(1);
          }
        }
      }
    });
    // ---- floor & mats (before climbers so feet stand on them)
    const fy = Y(0);
    if (fy < 270) {
      g.rect(0, fy, 352, 270 - fy, '#1a1c30');
      g.rect(WX - 12, fy, WR - WX + 24, 7, '#2d6fd1'); g.rect(WX - 12, fy, WR - WX + 24, 1, '#6aa0f0');
      g.rect(WX - 12, fy + 7, WR - WX + 24, 6, '#1d4a91');
      for (let i = 0; i < nL; i++) {
        const x0 = X(i, 0);
        g.rect(x0 + 0.85 * P, fy + 1, 0.9 * P, 3, '#181425'); g.rect(x0 + 0.85 * P, fy + 1, 0.9 * P, 1, PAL.yellow);
        g.text(String.fromCharCode(65 + i), x0 + LW / 2, fy + 6, '#cfe0ff', { size: 'xs', align: 'center' });
        g.rect(x0, fy + 7, 1, 6, '#163a75');
      }
    }
    // ---- ropes + climbers
    s.lanes.forEach((L, i) => {
      const e = s.ents[L.e];
      const B = toScr(spPose(s, L), x => X(i, x), Y, P);
      const ax = X(i, 1.5), ay = wTop + 4;
      g.line(ax, ay, B.x, B.y - 0.1 * P, '#efe2a8', 1);
      if (big) g.line(ax + 1, ay, B.x + 1, B.y - 0.1 * P, '#a8954c', 1);
      const shake = L.slip > 0 ? Math.round(Math.sin(s.clk * 70) * 1.5) : 0;
      drawClimber(g, B, OG.lookOf(e), { harness: true, label: OG.entLabel(e), lc: OG.entColor(e), pony: (e.look & 1) === 1, t: s.clk, shake, rand: OG.lookOf(e).pants });
    });
    // ---- fx
    drawFx(g, s, f => [X(f.ln, f.x), Y(f.y)]);
    // ---- lane timing boards
    s.lanes.forEach((L, i) => {
      const e = s.ents[L.e], bx = X(i, 0) + 3, bw = LW - 6, by = 3, bh = big ? 24 : 26;
      g.rect(bx, by, bw, bh, '#0c0c1c');
      g.rectO(bx, by, bw, bh, e.human ? OG.entColor(e) : '#5a6988');
      g.flag(e.country, bx + 3, by + 3, 12, 8);
      g.text(OG.entLabel(e), bx + 17, by + 3, OG.entColor(e), { size: 'xs' });
      let tt = '0.00', tc = PAL.yellow;
      if (L.fin >= 0) { tt = OG.fmt.time(L.fin, 2); tc = (s.win === i || nL === 1) ? PAL.green : PAL.white; } else if (L.fin === -2) { tt = '실패'; tc = PAL.red; } else if (s.phase !== 'count') tt = OG.fmt.time(Math.max(0, s.t), 2);
      if (big) {
        g.text(tt, bx + bw - 3, by + 2, tc, { size: 'l', align: 'right' });
        if (L.rt >= 0) g.text('RT ' + L.rt.toFixed(2), bx + 3, by + 15, PAL.grey, { size: 'xs' });
        if (e.human && !(s.phase === 'post' && s.win === i)) for (let k = 0; k < 4; k++) g.rect(bx + bw - 27 + k * 6, by + 18, 5, 3, L.flow > k * 0.25 + 0.01 ? PAL.cyan : '#3a4466');
      } else g.text(tt, bx + bw / 2, by + 13, tc, { size: 's', align: 'center' });
      if (s.phase === 'post' && s.win === i && nL > 1) {
        const wx = big ? bx + bw - 29 : bx + bw / 2 - 13, wy = big ? by + 14 : by + bh - 1;
        g.rect(wx, wy, 26, 9, PAL.green);
        g.text('WIN', wx + 13, wy, PAL.black, { size: 'xs', align: 'center' });
      }
    });
    // ---- right panel: standings + route card
    g.rect(352, 0, 128, 270, 'rgba(8,9,24,0.55)');
    const n = s.ents.length;
    g.panel(356, 10, 120, 24 + n * 12, { title: (s.run + 1) + '차 시기 / 2' });
    const rows = s.ents.map((e, i) => ({ i, b: spBest(s, i) }));
    rows.sort((a, b) => { const ka = a.b >= 0 ? a.b : a.b === -2 ? 9998 : 9999, kb = b.b >= 0 ? b.b : b.b === -2 ? 9998 : 9999; return ka - kb || a.i - b.i; });
    const inHeat = s.lanes.map(L => L.e);
    rows.forEach((r, k) => {
      const e = s.ents[r.i], yy = 22 + k * 12;
      if (inHeat.indexOf(r.i) >= 0) g.rect(359, yy - 1, 114, 11, 'rgba(255,255,255,0.08)');
      g.text(r.b >= 0 ? String(k + 1) : '-', 366, yy, PAL.grey, { size: 'xs', align: 'center' });
      g.flag(e.country, 373, yy + 1, 12, 8);
      g.text(OG.entLabel(e), 389, yy, OG.entColor(e), { size: 'xs' });
      g.text(r.b >= 0 ? OG.fmt.time(r.b, 2) : r.b === -2 ? 'DNF' : '—', 470, yy, r.b >= 0 ? (k === 0 ? PAL.yellow : PAL.white) : PAL.grey, { size: 'xs', align: 'right' });
    });
    const ry = 40 + n * 12;
    g.panel(356, ry, 120, 46, { title: '표준 루트' });
    for (let j = 1; j <= SPD.N; j++) {
      const cx = 362 + ((j - 1) % 10) * 11, cy = ry + 10 + Math.floor((j - 1) / 10) * 16;
      const hb = SPD.H[j].b;
      g.rect(cx - 1, cy, 10, 11, hb === 'a' ? PAL.red : '#2a2f52');
      g.text(GLY[hb], cx + 4, cy + 1, PAL.white, { size: 'xs', align: 'center' });
      s.lanes.forEach(L => {
        const e = s.ents[L.e];
        if (e.human && L.hi + 1 === j && L.fin === -1) g.rect(cx - 1, cy + 11 + (e.pid % 2) * 2, 10, 2, OG.PCOLORS[e.pid % 8]);
      });
    }
    g.text('같은 루트 · 외워서 빠르게!', 416, ry + 50, PAL.grey, { size: 'xs', align: 'center' });
    // ---- bottom hint
    g.rect(0, 254, 352, 16, 'rgba(8,9,24,0.78)');
    g.rich('{L}{R}{U} 홀드에 표시된 방향 · 꼭대기 버저 {A}', 176, 257, PAL.white, { align: 'center' });
    // ---- banners
    if (s.phase === 'count') {
      if (s.t < -0.4) {
        g.text((s.run + 1) + '차 시기', 176, 60, PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
        g.text(s.run ? '레인 교대 — 더 빠르게!' : '버튼은 홀드에 표시돼요', 176, 86, PAL.yellow, { size: 's', align: 'center', outline: PAL.black });
      }
      countdown(g, -s.t, 176, 108);
    } else if (s.phase === 'race' && s.t < 0.5) countdown(g, -s.t, 176, 108);
    else if (s.phase === 'post' && s.pt > 0.5) {
      g.text(s.run < s.nRuns - 1 ? '1차 시기 종료' : '경기 종료', 176, 118, PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
    }
  }

  /* ============================== BOULDER =============================== */
  // h: [x, y, type]  e: [from, to, dyno?, swing±1]  v: volumes (flat polygons)
  const BT = [
    { name: '슬랩 밸런스', col: '#fee761', steep: 0.8, diff: 0.45,
      h: [[-0.9, 1.75, 'jug'], [-0.2, 2.2, 'crimp'], [-1.0, 2.55, 'jug'], [-0.35, 2.95, 'pinch'], [0.45, 3.3, 'sloper'], [0.25, 3.95, 'crimp'], [-0.4, 4.25, 'jug']],
      e: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4, 0, 1], [4, 5], [5, 6]], zone: 3, top: 6,
      v: [{ p: [-1.65, 2.05, -0.7, 2.3, -1.3, 3.35], c: '#5a6988' }, { p: [0.1, 3.0, 0.95, 3.12, 0.78, 3.72, 0.05, 3.62], c: '#3a4466' }] },
    { name: '다이노', col: '#2ce8f5', steep: 1.2, diff: 0.6,
      h: [[0, 1.7, 'jug'], [-0.6, 2.25, 'crimp'], [0.1, 2.75, 'jug'], [0.05, 3.35, 'sloper'], [0.55, 3.95, 'jug'], [-0.05, 4.3, 'jug']],
      e: [[0, 1], [1, 2], [2, 4, 1], [2, 3], [3, 4, 0, 1], [4, 5]], zone: 2, top: 5,
      v: [{ p: [-0.3, 2.45, 0.5, 2.45, 0.72, 2.85, 0.42, 3.12, -0.2, 3.12, -0.48, 2.8], c: '#262b44' }, { p: [0.75, 3.55, 1.45, 3.7, 1.0, 4.45], c: '#b55088' }] },
    { name: '오버행 크림프', col: '#63c74d', steep: 1.9, diff: 0.72,
      h: [[-1.5, 1.75, 'jug'], [-0.85, 2.15, 'crimp'], [-0.9, 2.75, 'crimp'], [-0.25, 3.05, 'pinch'], [0.45, 3.35, 'crimp'], [0.5, 3.95, 'sloper'], [1.15, 4.25, 'jug']],
      e: [[0, 1], [1, 2], [2, 3, 0, 1], [3, 4], [4, 5], [4, 6, 1], [5, 6]], zone: 3, top: 6,
      v: [{ p: [-0.65, 2.55, 0.15, 2.7, -0.2, 3.45], c: '#3a4466' }, { p: [0.95, 3.85, 1.6, 3.95, 1.45, 4.55, 0.9, 4.5], c: '#5a6988' }] },
    { name: '코디네이션', col: '#ff6fae', steep: 1.5, diff: 0.82,
      h: [[0.9, 1.7, 'jug'], [-0.35, 2.75, 'jug'], [0.3, 2.25, 'crimp'], [-0.4, 3.4, 'sloper'], [0.35, 3.7, 'pinch'], [0.1, 4.3, 'jug']],
      e: [[0, 1, 1], [0, 2], [2, 1], [1, 3, 0, -1], [3, 4], [4, 5]], zone: 1, top: 5,
      v: [{ p: [-0.85, 2.45, 0.1, 2.5, -0.05, 3.1, -0.75, 3.15], c: '#feae34' }, { p: [0.55, 3.25, 1.2, 3.4, 0.7, 4.05], c: '#262b44' }] }
  ];
  const GRIP = { jug: 0.015, pinch: 0.04, crimp: 0.052, sloper: 0.065 };
  const PCACHE = {};
  function probData(tp, mir) {
    const key = tp + '_' + mir;
    if (PCACHE[key]) return PCACHE[key];
    const T = BT[tp];
    const holds = T.h.map(h => ({ x: h[0] * mir, y: h[1], ty: h[2] }));
    const edges = T.e.map(e => {
      const a = holds[e[0]], b = holds[e[1]], dx = b.x - a.x;
      const btn = e[2] ? 'a' : dx > 0.3 ? 'r' : dx < -0.3 ? 'l' : 'u';
      const dist = Math.hypot(dx, b.y - a.y);
      return { f: e[0], to: e[1], b: btn, dy: !!e[2], sw: (e[3] || 0) * mir, ctr: clamp(0.4 + dist * 0.22, 0.55, 0.85) };
    });
    const chips = [];
    holds.forEach((h, j) => {
      const cy = h.y - 1.45;
      if (cy > 0.3 && j !== T.top) chips.push({ x: Math.round((h.x + (j % 2 ? 0.28 : -0.28)) * 100) / 100, y: Math.round(cy * 100) / 100 });
    });
    for (let i = 0; i < 9; i++) chips.push({ x: Math.round((-1.7 + i * 0.42 + OG.hash(i, tp, 3) * 0.2) * mir * 100) / 100, y: Math.round((0.35 + OG.hash(i, tp, 4) * 0.55) * 100) / 100 });
    const vols = T.v.map(v => ({ p: v.p.map((q, i) => i % 2 ? q : q * mir), c: v.c }));
    const snaps = chips.concat(holds.map(h => ({ x: h.x, y: h.y })));
    return (PCACHE[key] = { holds, edges, chips, vols, snaps, zone: T.zone, top: T.top, col: T.col, name: T.name, steep: T.steep, diff: T.diff });
  }
  function sideX(x) { return clamp(x > 0 ? x - 1.4 : x + 1.4, -2.3, 2.3); } // judgement text beside the climber
  function pdOf(s, k) { const p = s.probs[clamp(k, 0, s.probs.length - 1)]; return probData(p.tp, p.mir); }

  function cpuBoulder(q, diff, R) {
    const n = 3 + (R.chance(0.5) ? 1 : 0);
    let t = 0, z = 0;
    const pT = clamp(0.05 + 1.0 * (q - diff), 0.02, 0.85), pZ = clamp(0.45 + 1.2 * (q - diff), 0.06, 0.95);
    for (let a = 1; a <= n && !t; a++) {
      if (R.f() < pT) { t = a; if (!z) z = a; } else if (!z && R.f() < pZ) z = a;
    }
    return { t, z, a: t || n };
  }
  function bPts(r) { return r.t ? 25 - 0.1 * (r.t - 1) : r.z ? 10 - 0.1 * (r.z - 1) : 0; }
  function bScore(list, n) {
    let T = 0, Z = 0, pts = 0;
    for (let k = 0; k < n && k < list.length; k++) { const r = list[k]; if (r.t) T++; if (r.t || r.z) Z++; pts += bPts(r); }
    return { T, Z, pts: M.round(pts, 1) };
  }
  function boulderInit(ev, ents, opts, R) {
    const hum = ents.filter(e => e.human).sort((a, b) => a.pid - b.pid).map(e => e.idx);
    const nP = hum.length >= 5 ? 2 : hum.length >= 3 ? 3 : 4; // fewer problems when many humans take turns
    const s = {
      evId: ev.id, mode: 'boulder', t: -3, clk: 0, phase: 'count', pt: 0, nP,
      T: clamp(Math.round(150 / Math.max(1, hum.length * nP)), 9, 30),
      probs: [], turns: [], ti: 0, rev: 0, c: null, fx: [], done: false, results: null,
      ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, tag: e.tag || '', look: e.look | 0 })),
      res: ents.map(() => [])
    };
    for (let k = 0; k < nP; k++) s.probs.push({ tp: k, mir: R.chance(0.5) ? -1 : 1 });
    ents.forEach((e, i) => {
      for (let k = 0; k < nP; k++) s.res[i].push(e.human ? { t: 0, z: 0, a: 0 } : cpuBoulder(OG.cpuQuality(e, R, 0.12), BT[s.probs[k].tp].diff, R));
    });
    for (let k = 0; k < nP; k++) hum.forEach(idx => s.turns.push([k, idx]));
    if (!s.turns.length) { s.phase = 'end'; s.rev = nP; } else bSetupTurn(s);
    return s;
  }
  function bSetupTurn(s) {
    const tr = s.turns[s.ti], pd = pdOf(s, tr[0]);
    const sx = pd.holds[0].x;
    s.c = {
      e: tr[1], st: 'stand', stT: 0, lh: 0, rh: 0, lead: 0, to: -1, mh: '', mv: 0, dur: 0.36, ei: -1, lastH: 'l',
      grip: 1, att: 0, zn: false, tl: s.T, idle: 0, sw: 0, so: 0, rk: 0, dyOk: false, dyV: 0, fum: 0,
      bx: sx, by: 0.92, vy: 0, gx: sx + (sx > 0 ? 0.9 : -0.9), ending: false, topped: false
    };
    s.phase = 'count'; s.t = s.ti ? -2 : -3; s.pt = 0;
  }
  function bPickHand(c, b) {
    if (b === 'l') return 'l';
    if (b === 'r') return 'r';
    if (c.lh !== c.rh) return c.lh === c.lead ? 'r' : 'l';
    return c.lastH === 'r' ? 'l' : 'r';
  }
  function bCfg(pd, lh, rh) {
    const a = pd.holds[lh], b = pd.holds[rh];
    const hl = [a.x, a.y + 0.04], hr = [b.x, b.y + 0.04];
    if (lh === rh) { hl[0] -= 0.1; hr[0] += 0.1; }
    const body = bodyOf(hl, hr);
    return { hl, hr, b: body, f: feetOf(body, pd.snaps) };
  }
  // full pose of the boulder climber (metres)
  function bPose(s, c, pd) {
    const st = c.st, sx = pd.holds[0].x;
    if (st === 'stand') {
      const p = clamp(c.stT / 0.55, 0, 1);
      return standCfg(lerp(c.gx, sx, M.ease(p)), s.clk, p < 1 && Math.abs(c.gx - sx) > 0.05, p >= 1);
    }
    if (st === 'mount') return blendPose(standCfg(sx, 0, false, false), bCfg(pd, 0, 0), 'b', c.stT / 0.45);
    if (st === 'move') return blendPose(bCfg(pd, c.lh, c.rh), bCfg(pd, c.mh === 'l' ? c.to : c.lh, c.mh === 'r' ? c.to : c.rh), c.mh, c.mv);
    if (st === 'fly') {
      const A = bCfg(pd, c.lh, c.rh); A.b.y -= 0.22;
      const T = bCfg(pd, c.to, c.to);
      const p = clamp(c.stT / 0.42, 0, 1), e = M.easeOut(p), miss = c.dyOk ? 0 : 0.3;
      const b = { x: lerp(A.b.x, T.b.x, e), y: lerp(A.b.y, T.b.y - miss, e) + Math.sin(Math.PI * p) * 0.16, lean: lerp(A.b.lean, T.b.lean, e) };
      const hp = M.ease(clamp((p - 0.08) / 0.92, 0, 1));
      return {
        b, hl: [lerp(A.hl[0], T.hl[0], hp), lerp(A.hl[1], T.hl[1] - miss, hp)], hr: [lerp(A.hr[0], T.hr[0], hp), lerp(A.hr[1], T.hr[1] - miss, hp)],
        f: [[b.x - 0.2, b.y - 0.7 + Math.sin(p * 6) * 0.05], [b.x + 0.16, b.y - 0.62]]
      };
    }
    if (st === 'fall' || st === 'drop') return fallCfg(c.bx, c.by, c.topped);
    if (st === 'land') return landCfg(c.bx, c.stT / 0.9, c.topped, s.clk);
    if (st === 'done') return c.topped ? landCfg(c.bx, 1, true, s.clk) : standCfg(c.bx, 0, false, false);
    // on the wall: wall / swing / match / charge / top
    const C = bCfg(pd, c.lh, c.rh);
    if (c.rk > 0.01) {
      const free = c.lh === c.lead && c.rh !== c.lead ? 'r' : 'l';
      const bag = [C.b.x + (free === 'l' ? -0.05 : 0.05), C.b.y + 0.02 + Math.sin(s.clk * 9) * 0.03];
      if (free === 'l') C.hl = lp(C.hl, bag, c.rk); else C.hr = lp(C.hr, bag, c.rk);
      C.b.x = lerp(C.b.x, pd.holds[c.lead].x, 0.35 * c.rk);
    }
    if (c.so > 0.01) {
      const sw = c.sw || 1, k = c.so;
      const free = c.lh === c.lead && c.rh !== c.lead ? 'r' : c.rh === c.lead && c.lh !== c.lead ? 'l' : (sw > 0 ? 'l' : 'r');
      C.b.x += sw * 0.4 * k; C.b.lean += sw * 0.45 * k; C.b.y -= 0.08 * k;
      const fh = [C.b.x + sw * 0.75, C.b.y + 0.55];
      if (free === 'l') C.hl = lp(C.hl, fh, k); else C.hr = lp(C.hr, fh, k);
      const fi = sw > 0 ? 1 : 0;
      C.f[fi] = lp(C.f[fi], [C.b.x + sw * 0.7, C.b.y - 0.45], k);
      C.f[1 - fi] = lp(C.f[1 - fi], [C.b.x - sw * 0.1, C.b.y - 0.75], k);
    }
    if (st === 'charge') { const k = clamp(c.stT / 0.25, 0, 1); C.b.y -= 0.22 * k; }
    if (st === 'top' && c.stT > 0.35) C.hr = [C.b.x + 0.4, C.b.y + 1.2 + Math.sin(s.clk * 12) * 0.05];
    return C;
  }
  function bFall(s, c, pd, msg) {
    const p = bPose(s, c, pd);
    c.bx = p.b.x; c.by = Math.max(0.5, p.b.y); c.vy = 0; c.st = 'fall'; c.stT = 0; c.to = -1; c.rk = 0;
    if (msg) {
      addFx(s, { k: 'txt', x: sideX(c.bx), y: c.by + 0.6, s: msg, c: PAL.red, sz: 'l', life: 1.3 });
      OG.sfx(s, 'fail');
    }
  }
  function bReach(s, c, pd, r) {
    if (c.lead === pd.zone && !c.zn) {
      c.zn = true;
      if (!r.z) r.z = c.att;
      const h = pd.holds[pd.zone];
      addFx(s, { k: 'txt', x: sideX(h.x), y: h.y, s: 'ZONE!', c: PAL.cyan, sz: 'l', life: 1.3 });
      addFx(s, { k: 'ring', x: h.x, y: h.y, c: PAL.cyan, life: 0.6 });
      OG.sfx(s, 'ding');
    }
  }
  function bTop(s, c, pd, r) {
    c.st = 'top'; c.stT = 0; c.topped = true; c.ending = true; c.lh = c.rh = c.lead = pd.top;
    if (!r.t) r.t = c.att;
    if (!r.z) r.z = c.att;
    const h = pd.holds[pd.top];
    addFx(s, { k: 'txt', x: sideX(h.x), y: h.y - 0.2, s: 'TOP!', c: PAL.yellow, sz: 'xl', life: 1.9 });
    addFx(s, { k: 'spark', x: h.x, y: h.y, c: PAL.yellow, life: 0.9 });
    addFx(s, { k: 'dust', x: h.x, y: h.y, n: 14, life: 1.0 });
    OG.sfx(s, 'perfect'); OG.sfx(s, 'cheer');
  }
  function bAfterLand(s, c, pd, r) {
    if (c.lead === pd.top) { if (c.lh === c.rh) bTop(s, c, pd, r); else { c.st = 'match'; c.stT = 0; } } else { c.st = 'wall'; c.stT = 0; }
  }
  function bArrive(s, c, pd, r) {
    const prev = c.lead, to = c.to, ed = c.ei >= 0 ? pd.edges[c.ei] : null;
    if (c.mh === 'l') c.lh = to; else c.rh = to;
    c.lastH = c.mh; c.lead = to; c.to = -1; c.mv = 0; c.ei = -1;
    const oth = c.mh === 'l' ? c.rh : c.lh;
    if (oth !== to) {
      const a = pd.holds[oth], h = pd.holds[to];
      if (h.y - a.y > 0.9 || Math.hypot(h.x - a.x, h.y - a.y) > 1.3) { if (c.mh === 'l') c.rh = prev; else c.lh = prev; }
    }
    const h = pd.holds[to];
    OG.sfx(s, 'click');
    addFx(s, { k: 'dust', x: h.x, y: h.y, n: 5, life: 0.45 });
    bReach(s, c, pd, r);
    if (ed && ed.sw) { c.st = 'swing'; c.sw = ed.sw; c.stT = 0; OG.sfx(s, 'whoosh'); } else bAfterLand(s, c, pd, r);
  }
  function bWallPress(s, c, pd, r, b) {
    let ei = -1;
    for (let i = 0; i < pd.edges.length; i++) if (pd.edges[i].f === c.lead && pd.edges[i].b === b) ei = i;
    const h = pd.holds[c.lead];
    if (ei < 0) {
      c.grip = Math.max(0, c.grip - 0.12); c.fum = 0.35;
      OG.sfx(s, 'miss');
      addFx(s, { k: 'txt', x: sideX(h.x), y: h.y - 0.5, s: b === 'a' ? '다이노 불가!' : '헛손질!', c: PAL.orange, sz: 's', life: 0.8 });
      return;
    }
    const ed = pd.edges[ei];
    c.ei = ei; c.to = ed.to;
    if (ed.dy) { c.st = 'charge'; c.stT = 0; OG.sfx(s, 'charge'); return; }
    c.mh = bPickHand(c, b); c.mv = 0; c.dur = 0.36; c.st = 'move'; c.stT = 0;
    c.grip = Math.max(0, c.grip - 0.04);
  }
  function bEndTurn(s) {
    const c = s.c, r = s.res[c.e][s.turns[s.ti][0]];
    c.st = 'done'; c.stT = 0;
    s.phase = 'sum'; s.pt = 0;
    OG.sfx(s, r.t || r.z ? 'coin' : 'back');
  }
  function bNextTurn(s) {
    s.ti++;
    if (s.ti >= s.turns.length) { s.ti = s.turns.length - 1; s.rev = s.nP; s.phase = 'end'; s.pt = 0; OG.sfx(s, 'whistle'); return; }
    s.rev = s.turns[s.ti][0];
    bSetupTurn(s);
  }
  function bClimb(s, inputs, dt, R) {
    const c = s.c, e = s.ents[c.e], k = s.turns[s.ti][0], pd = pdOf(s, k), r = s.res[c.e][k];
    const inp = (inputs && inputs[e.pid]) || null;
    const b = pressed(inp, false);
    c.idle = anyInput(inp) ? 0 : c.idle + dt;
    c.stT += dt;
    if (c.fum > 0) c.fum = Math.max(0, c.fum - dt);
    if (!c.ending && c.st !== 'top') c.tl = Math.max(0, c.tl - dt);
    c.rk = M.approach(c.rk, c.st === 'wall' && inp && inp.d ? 1 : 0, dt * 5);
    c.so = M.approach(c.so, c.st === 'swing' ? 1 : 0, dt * (c.st === 'swing' ? 2.4 : 4));
    switch (c.st) {
      case 'stand':
        if (c.stT >= 0.8) {
          c.att++; r.a = c.att; c.lh = c.rh = c.lead = 0; c.lastH = 'l'; c.zn = false;
          c.grip = Math.max(0.6, 1 - 0.05 * (c.att - 1)); c.st = 'mount'; c.stT = 0;
          OG.sfx(s, 'step');
          if (c.att > 1) addFx(s, { k: 'txt', x: pd.holds[0].x, y: pd.holds[0].y + 0.6, s: c.att + '번째 시도', c: PAL.white, sz: 's', life: 1.0 });
        }
        break;
      case 'mount': if (c.stT >= 0.45) { c.st = 'wall'; c.stT = 0; } break;
      case 'wall': if (b && b !== 'd' && c.fum <= 0) bWallPress(s, c, pd, r, b); break; // fumble = short lockout
      case 'move': c.mv += dt / c.dur; if (c.mv >= 1) bArrive(s, c, pd, r); break;
      case 'swing': {
        const need = c.sw > 0 ? 'l' : 'r';
        if (b === need) {
          OG.sfx(s, 'good');
          const h = pd.holds[c.lead];
          addFx(s, { k: 'txt', x: sideX(h.x), y: h.y - 0.3, s: '균형!', c: PAL.green, sz: 'b', life: 0.9 });
          bAfterLand(s, c, pd, r);
        } else if (b && b !== 'd') bFall(s, c, pd, '중심 잃음!');
        else if (c.stT > 0.8) bFall(s, c, pd, '배런도어…');
        break;
      }
      case 'match':
        if (b === 'u') { c.mh = c.lh === pd.top ? 'r' : 'l'; c.to = pd.top; c.ei = -1; c.mv = 0; c.dur = 0.28; c.st = 'move'; c.stT = 0; } else if (c.stT > 3) bFall(s, c, pd, '매칭 실패');
        break;
      case 'charge':
        if (b === 'd') { c.st = 'wall'; c.stT = 0; } else if ((b === 'a' && c.stT > 0.1) || c.stT > 2.2) {
          const ed = pd.edges[c.ei], v = M.pingpong(c.stT, 0.55);
          c.dyV = v; c.dyOk = Math.abs(v - ed.ctr) <= 0.11;
          c.grip = Math.max(0, c.grip - 0.08); c.st = 'fly'; c.stT = 0;
          OG.sfx(s, 'jump');
        }
        break;
      case 'fly':
        if (c.stT >= 0.42) {
          if (c.dyOk) {
            c.lh = c.rh = c.lead = c.to; c.lastH = 'r'; c.to = -1; c.ei = -1;
            const h = pd.holds[c.lead];
            OG.sfx(s, 'good');
            addFx(s, { k: 'txt', x: sideX(h.x), y: h.y - 0.3, s: '캐치!', c: PAL.green, sz: 'l', life: 1.0 });
            addFx(s, { k: 'dust', x: h.x, y: h.y, n: 12, life: 0.7 });
            bReach(s, c, pd, r);
            if (c.lead === pd.top) bTop(s, c, pd, r); else { c.st = 'wall'; c.stT = 0; }
          } else bFall(s, c, pd, '놓쳤다!');
        }
        break;
      case 'top':
        if (c.stT >= 1.1) { const p = bPose(s, c, pd); c.bx = p.b.x; c.by = p.b.y; c.vy = 1.6; c.st = 'drop'; c.stT = 0; }
        break;
      case 'fall': case 'drop':
        c.vy -= 15 * dt; c.by += c.vy * dt;
        if (c.by <= 0.5) {
          c.by = 0.5; c.st = 'land'; c.stT = 0;
          OG.sfx(s, 'land');
          addFx(s, { k: 'dust', x: c.bx, y: 0.05, n: 12, c: '#c9d6ff', life: 0.6 });
        }
        break;
      case 'land':
        if (c.stT >= 0.9) { if (c.ending || c.tl < 1.5) bEndTurn(s); else { c.gx = c.bx; c.st = 'stand'; c.stT = 0; } }
        break;
      default: break;
    }
    if (s.phase !== 'climb') return;
    // grip drain / rest
    if (c.st === 'wall' || c.st === 'move' || c.st === 'swing' || c.st === 'match' || c.st === 'charge') {
      let d = (GRIP[pd.holds[c.lh].ty] + GRIP[pd.holds[c.rh].ty]) / 2 * pd.steep;
      if (c.st === 'swing' || c.st === 'charge') d += 0.02;
      if (c.rk > 0.5) {
        const lt = pd.holds[c.lead].ty;
        d = GRIP[lt] * pd.steep * 0.7 - (lt === 'jug' ? 0.17 : 0.08);
        if (Math.floor(s.clk * 4) !== Math.floor((s.clk - dt) * 4)) {
          const p = bPose(s, c, pd);
          addFx(s, { k: 'dust', x: p.b.x, y: p.b.y + 0.05, n: 5, life: 0.6 });
        }
      }
      c.grip = clamp(c.grip - d * dt, 0, 1);
      if (c.grip <= 0) bFall(s, c, pd, '그립 소진!');
    }
    // time up / idle
    if (!c.ending && c.st !== 'top' && c.st !== 'drop' && (c.tl <= 0 || c.idle > 7)) {
      c.ending = true;
      OG.sfx(s, 'whistle');
      addFx(s, { k: 'txt', x: 0, y: 3.9, s: c.tl <= 0 ? '시간 종료' : '기권', c: PAL.orange, sz: 'l', life: 1.6 });
      if (c.st === 'stand') bEndTurn(s);
      else if (c.st !== 'fall' && c.st !== 'land') bFall(s, c, pd, '');
    }
  }
  function boulderUpdate(s, inputs, dt, R) {
    s.clk += dt;
    if (s.phase === 'count') {
      const pt = s.t; s.t += dt;
      if (s.t < 0 && Math.ceil(pt) !== Math.ceil(s.t)) OG.sfx(s, 'beep');
      if (s.t >= 0) { s.phase = 'climb'; OG.sfx(s, 'go'); }
    } else if (s.phase === 'climb') {
      s.t += dt;
      bClimb(s, inputs, dt, R);
    } else if (s.phase === 'sum') {
      s.pt += dt;
      if (s.pt > 1.9) bNextTurn(s);
    } else if (s.phase === 'end') {
      s.pt += dt;
      if (s.pt > 2.6) {
        s.results = OG.sortResults(s.ents.map((e, i) => {
          const sc = bScore(s.res[i], s.nP);
          return { idx: i, score: sc.pts, text: sc.T + 'T' + sc.Z + 'z ' + sc.pts.toFixed(1) };
        }), false);
        s.done = true;
      }
    }
    pruneFx(s);
  }

  function drawVolume(g, pts, c, X, Y) {
    const sp = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i += 2) { const x = X(pts[i]), y = Y(pts[i + 1]); sp.push(x, y); cx += x; cy += y; }
    const n = sp.length / 2; cx /= n; cy /= n;
    polyOL(g, sp, c, true);
    for (let i = 0; i < n; i++) {
      const ax = sp[i * 2], ay = sp[i * 2 + 1], bx = sp[((i + 1) % n) * 2], by = sp[((i + 1) % n) * 2 + 1];
      const nx = by - ay, ny = -(bx - ax), l = Math.hypot(nx, ny) || 1;
      const lit = (-nx / l) * 0.5 + (-ny / l) * 0.8; // light from top-left
      g.poly([cx, cy, ax, ay, bx, by], OG.shade(c, lit > 0 ? lit * 0.35 : lit * 0.4));
    }
    g.rect(cx - 1, cy - 1, 2, 2, OG.shade(c, -0.5));
  }
  function boulderDraw(g, s) {
    const P = 40, CX = 176, GY = 232, t = g.t;
    const X = x => CX + x * P, Y = h => GY - h * P;
    const k = s.turns.length ? s.turns[clamp(s.ti, 0, s.turns.length - 1)][0] : s.nP - 1;
    const pd = pdOf(s, k), c = s.c;
    // ---- arena
    g.grad(0, 0, 480, 270, '#0b0d21', '#1f2347', 10);
    g.rect(0, 10, 480, 2, '#3a4466'); g.rect(0, 22, 480, 1, '#3a4466');
    for (let x = 0; x < 480; x += 16) g.line(x, 12, x + 8, 22, '#2c3354', 1);
    for (let i = 0; i < 6; i++) {
      const lx = 30 + i * 58;
      g.rect(lx - 4, 22, 8, 5, '#5a6988'); g.rect(lx - 3, 26, 6, 2, '#fff6d8');
    }
    g.alpha(0.06);
    for (let i = 0; i < 6; i++) { const lx = 30 + i * 58, ex = CX + (lx - CX) * 0.4 + Math.sin(t * 0.6 + i) * 30; g.poly([lx - 3, 28, lx + 3, 28, ex + 46, 232, ex - 46, 232], '#fff6d8'); }
    g.alpha(1);
    // ---- wall
    g.poly([0, 62, 60, 48, 60, 232, 0, 232], '#a7b1c4');
    g.poly([292, 48, 352, 62, 352, 232, 292, 232], '#9ba6ba');
    g.rect(60, 48, 232, Y(2.4) - 48, '#e4e9f0');
    g.rect(60, Y(2.4), 232, GY - Y(2.4), '#d3dae5');
    g.rect(60, Y(2.4), 232, 1, '#9aa6b8'); g.rect(60, Y(2.4) + 1, 232, 1, '#f2f5f9');
    for (let x = 60; x <= 292; x += 58) g.rect(x, 48, 1, 184, '#bfc8d6');
    g.rect(60, Y(3.6), 232, 1, '#c6cedb'); g.rect(60, Y(1.2), 232, 1, '#bfc8d6');
    for (let y = 52; y < 230; y += 8) for (let x = 64 + ((y >> 3) % 2) * 4; x < 290; x += 8) g.px(x, y, '#b9c3d1');
    for (let y = 70; y < 230; y += 9) for (let x = 6 + ((y / 9 | 0) % 2) * 4; x < 56; x += 9) g.px(x, y, '#909bb0');
    for (let y = 70; y < 230; y += 9) for (let x = 298 + ((y / 9 | 0) % 2) * 4; x < 350; x += 9) g.px(x, y, '#8a95aa');
    g.rect(0, 40, 352, 8, '#22263f'); g.rect(0, 40, 352, 1, '#5a6988');
    g.text('BOULDER ' + (k + 1) + ' · ' + pd.name, CX, 40, PAL.orange, { size: 'xs', align: 'center' });
    // other boulders' holds on the side wings (decor)
    const DC = ['#e43b44', '#b55088', '#f77622', '#0099db', '#68386c'];
    for (let i = 0; i < 14; i++) {
      const side = i % 2, hx = side ? 300 + OG.hash(i, 1, 9) * 44 : 6 + OG.hash(i, 1, 9) * 46;
      const hy = 80 + OG.hash(i, 2, 9) * 140, ty = ['jug', 'crimp', 'sloper', 'pinch'][i % 4];
      drawHold(g, hx, hy, ty, DC[(i + k) % DC.length], 30);
    }
    // ---- problem: volumes, chips, holds, tapes
    pd.vols.forEach(v => drawVolume(g, v.p, v.c, X, Y));
    pd.chips.forEach(f => drawHold(g, X(f.x), Y(f.y), 'foot', pd.col, P));
    pd.holds.forEach((h, j) => drawHold(g, X(h.x), Y(h.y), h.ty, pd.col, P));
    const tag = (x, y, str, col) => {
      const w = g.textW(str, 'xs') + 4;
      g.rect(x - w / 2 - 1, y - 1, w + 2, 10, OLC); g.rect(x - w / 2, y, w, 8, '#ffffff');
      g.text(str, x, y, col, { size: 'xs', align: 'center' });
    };
    const h0 = pd.holds[0], hz = pd.holds[pd.zone], ht = pd.holds[pd.top];
    tag(X(h0.x) + (h0.x >= 0 ? 22 : -22), Y(h0.y) - 4, 'START', '#262b44');
    tag(X(hz.x) + (hz.x >= 0 ? 20 : -20), Y(hz.y) - 4, 'ZONE', '#0b7f8a');
    tag(X(ht.x) + (ht.x >= 0 ? 18 : -18), Y(ht.y) - 4, 'TOP', PAL.red);
    // ---- crash mats
    g.rect(0, 232, 352, 9, '#2f63c4'); g.rect(0, 232, 352, 1, '#6a9cf0');
    for (let x = 58; x < 352; x += 74) g.rect(x, 232, 1, 9, '#1f478f');
    g.rect(0, 241, 352, 8, '#1e4389');
    g.text('DOT GAMES 2026', 120, 241, '#6a8ad0', { size: 'xs', align: 'center' });
    g.text('AICHI-NAGOYA', 250, 241, '#6a8ad0', { size: 'xs', align: 'center' });
    // ---- move options
    const climbing = s.phase === 'climb' && c && c.st === 'wall';
    if (climbing) {
      const lh = pd.holds[c.lead];
      pd.edges.forEach(ed => {
        if (ed.f !== c.lead) return;
        const th = pd.holds[ed.to], x0 = X(lh.x), y0 = Y(lh.y), x1 = X(th.x), y1 = Y(th.y);
        const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 5));
        for (let i = 1; i < n; i++) if ((i + Math.floor(s.clk * 8)) % 3) g.rect(lerp(x0, x1, i / n) - 1, lerp(y0, y1, i / n) - 1, 2, 2, ed.dy ? PAL.orange : '#ffffff');
        const pr = 9 + Math.sin(s.clk * 10) * 1.5;
        g.circleO(x1, y1, pr, ed.dy ? PAL.orange : PAL.yellow); g.circleO(x1, y1, pr + 1, OLC);
        keyAt(g, x1, y1 - 17, ed.b);
        if (ed.dy) g.text('다이노', x1, y1 + 7, PAL.orange, { size: 'xs', align: 'center', outline: OLC });
      });
    }
    if (s.phase === 'climb' && c && c.st === 'match') {
      const h = pd.holds[pd.top];
      keyAt(g, X(h.x) + (h.x >= 0 ? -18 : 18), Y(h.y) + Math.sin(s.clk * 12) * 1.5, 'u');
      g.circleO(X(h.x), Y(h.y), 9 + Math.sin(s.clk * 10) * 1.5, PAL.yellow);
    }
    // ---- climber
    if (c && s.phase !== 'end') {
      const e = s.ents[c.e], look = OG.lookOf(e);
      const B = toScr(bPose(s, c, pd), X, Y, P);
      const shake = c.fum > 0 || (c.grip < 0.25 && (c.st === 'wall' || c.st === 'match')) ? Math.round(Math.sin(s.clk * 60)) : 0;
      drawClimber(g, B, look, { bag: true, bagC: OG.shade(look.pants, 0.25), label: OG.entLabel(e), lc: OG.entColor(e), pony: (e.look & 1) === 1, t: s.clk, shake, rand: look.shirt });
      // dyno meter
      if (s.phase === 'climb' && c.st === 'charge' && c.ei >= 0) {
        const ed = pd.edges[c.ei], mx = B.x + (pd.holds[ed.to].x >= pd.holds[c.lead].x ? -46 : 40), my = B.y - 52, mh = 60;
        g.rect(mx - 1, my - 1, 10, mh + 2, OLC); g.rect(mx, my, 8, mh, '#3a4466');
        g.rect(mx, my + mh * (1 - ed.ctr - 0.11), 8, mh * 0.22, PAL.green);
        const v = M.pingpong(c.stT, 0.55), cy = my + mh * (1 - v);
        g.rect(mx - 3, cy - 1, 14, 3, PAL.white); g.rect(mx - 3, cy, 14, 1, PAL.red);
        g.text('파워', mx + 4, my - 10, PAL.white, { size: 'xs', align: 'center', outline: OLC });
      }
      if (s.phase === 'climb' && c.st === 'swing') {
        const need = c.sw > 0 ? 'l' : 'r', kx = B.x - c.sw * 34, ky = B.y - 40;
        const k2 = 1 - clamp(c.stT / 0.8, 0, 1);
        g.circleO(kx, ky, 8 + k2 * 8, PAL.red);
        keyAt(g, kx, ky, need);
        g.text('버텨!', kx, ky + 9, PAL.yellow, { size: 's', align: 'center', outline: OLC });
      }
      if (s.phase === 'climb' && (c.st === 'wall' || c.st === 'match' || c.st === 'charge' || c.st === 'swing' || c.st === 'move') && c.grip < 0.35) {
        g.bar(B.x - 12, B.y - 70, 24, 4, c.grip, Math.floor(s.clk * 8) % 2 ? PAL.red : PAL.orange);
      }
    }
    // ---- foreground crowd silhouettes
    const exc = (s.phase === 'climb' && c && (c.st === 'top' || c.st === 'drop')) || (s.phase === 'sum' && c && c.topped);
    for (let i = 0; i < 42; i++) {
      const hx = i * 8.6 + OG.hash(i, 3, 3) * 4, hy = 254 + OG.hash(i, 4, 3) * 5 - (exc && OG.hash(i, Math.floor(t * 5), 2) < 0.5 ? 2 : 0);
      g.rect(hx - 5, hy + 3, 10, 20, '#0a0b17');
      g.circle(hx, hy, 3.5, '#0a0b17');
      if (exc && i % 3 === 0) { g.line(hx - 4, hy + 4, hx - 6, hy - 6, '#0a0b17', 2); g.line(hx + 4, hy + 4, hx + 6, hy - 6, '#0a0b17', 2); }
      if (OG.hash(i, Math.floor(t * 3), 7) < 0.04) g.rect(hx + 3, hy - 2, 2, 2, '#ffffff');
    }
    // ---- fx
    drawFx(g, s, f => [X(f.x), Y(f.y)]);
    // ---- HUD: climber panel, clock
    if (c) {
      const e = s.ents[c.e], r = s.res[c.e][k];
      g.panel(4, 4, 140, 42, { border: OG.entColor(e) });
      g.flag(e.country, 9, 9, 18, 12);
      g.text(e.tag || OG.entLabel(e), 32, 9, OG.entColor(e), { size: 'b' });
      g.text('볼더 ' + (k + 1) + '/' + s.nP, 139, 10, PAL.white, { size: 's', align: 'right' });
      g.text('시도 ' + Math.max(1, c.att), 9, 24, PAL.lightgrey, { size: 'xs' });
      const badge = (x, str, on, col) => { g.rect(x, 23, 22, 9, on ? col : '#3a4466'); g.text(str, x + 11, 23, on ? PAL.black : PAL.grey, { size: 'xs', align: 'center' }); };
      badge(92, 'Z', !!r.z || c.zn, PAL.cyan); badge(117, 'T', !!r.t, PAL.yellow);
      g.text('그립', 9, 34, PAL.lightgrey, { size: 'xs' });
      g.bar(30, 35, 110, 7, c.grip, c.grip > 0.5 ? PAL.green : c.grip > 0.25 ? PAL.yellow : PAL.red);
      const tl = Math.ceil(c.tl), low = c.tl < 5 && s.phase === 'climb';
      g.panel(150, 4, 52, 22, { border: low ? PAL.red : PAL.lightgrey });
      g.text('0:' + (tl < 10 ? '0' : '') + tl, 176, 7, low && Math.floor(s.clk * 4) % 2 ? PAL.red : PAL.white, { size: 'l', align: 'center' });
    }
    // ---- leaderboard
    g.rect(352, 0, 128, 270, 'rgba(8,9,24,0.6)');
    const n = s.ents.length;
    g.panel(356, 10, 120, 24 + n * 12, { title: '순위 · 탑/존' });
    const rows = s.ents.map((e, i) => ({ i, sc: bScore(s.res[i], e.human ? s.nP : s.rev) }));
    rows.sort((a, b) => b.sc.pts - a.sc.pts || a.i - b.i);
    rows.forEach((rw, j) => {
      const e = s.ents[rw.i], yy = 22 + j * 12;
      if (c && rw.i === c.e) g.rect(359, yy - 1, 114, 11, 'rgba(255,255,255,0.1)');
      g.text(String(j + 1), 365, yy, PAL.grey, { size: 'xs', align: 'center' });
      g.flag(e.country, 371, yy + 1, 12, 8);
      g.text(OG.entLabel(e), 386, yy, OG.entColor(e), { size: 'xs' });
      g.text(rw.sc.T + 'T' + rw.sc.Z + 'z', 432, yy, PAL.lightgrey, { size: 'xs', align: 'right' });
      g.text(rw.sc.pts.toFixed(1), 471, yy, j === 0 ? PAL.yellow : PAL.white, { size: 'xs', align: 'right' });
    });
    const py = 40 + n * 12;
    g.panel(356, py, 120, 18 + s.nP * 11, { title: '문제' });
    for (let j = 0; j < s.nP; j++) {
      const q = pdOf(s, j), yy = py + 9 + j * 11;
      g.rect(362, yy + 1, 6, 6, q.col);
      g.text((j + 1) + '. ' + q.name, 372, yy, j === k ? PAL.white : PAL.grey, { size: 'xs' });
      if (c) { const r = s.res[c.e][j]; if (r.t || r.z) g.text(r.t ? 'T' : 'Z', 470, yy, r.t ? PAL.yellow : PAL.cyan, { size: 'xs', align: 'right' }); }
    }
    // ---- bottom hint
    g.rect(0, 255, 352, 15, 'rgba(8,9,24,0.7)');
    let hint = '{L}{U}{R} 홀드 선택 · {A} 다이노 · {D} 초크(휴식)';
    if (c && s.phase === 'climb') {
      if (c.st === 'charge') hint = '{A} 초록 구간에서 점프! · {D} 취소';
      else if (c.st === 'swing') hint = (c.sw > 0 ? '{L}' : '{R}') + ' 반대쪽으로 버텨!';
      else if (c.st === 'match') hint = '{U} 두 손 매칭하면 완등!';
    }
    g.rich(hint, CX, 258, PAL.white, { align: 'center' });
    // ---- overlays
    if (s.phase === 'count' && c) {
      const e = s.ents[c.e], col = OG.entColor(e);
      g.panel(76, 58, 200, 52, { border: col });
      g.flag(e.country, 92, 68, 24, 16, { wave: t });
      g.text((e.tag || OG.entLabel(e)) + ' 차례', 190, 64, col, { size: 'xl', align: 'center', outline: PAL.black });
      g.text('볼더 ' + (k + 1) + ' · ' + pd.name + ' · ' + s.T + '초', 176, 93, PAL.white, { size: 's', align: 'center' });
      countdown(g, -s.t, 176, 122);
    } else if (s.phase === 'climb' && s.t < 0.5) countdown(g, -s.t, 176, 122);
    if (s.phase === 'sum' && c) {
      const r = s.res[c.e][k];
      const title = r.t ? 'TOP!' : r.z ? 'ZONE' : '실패', col = r.t ? PAL.yellow : r.z ? PAL.cyan : PAL.grey;
      g.panel(96, 72, 160, 60, { border: col });
      g.text(title, CX, 78, col, { size: 'xl', align: 'center', outline: PAL.black });
      g.text(r.t ? r.t + '번째 시도에 완등' : r.z ? r.z + '번째 시도에 존 획득' : '시도 ' + r.a + '회', CX, 104, PAL.white, { size: 's', align: 'center' });
      g.text('+' + bPts(r).toFixed(1) + '점', CX, 117, col, { size: 'b', align: 'center' });
    }
    if (s.phase === 'end') {
      g.text('경기 종료', CX, 96, PAL.white, { size: 'xl', align: 'center', outline: PAL.black });
      const top = rows[0] && s.ents[rows[0].i];
      if (top) g.text('1위 ' + OG.entLabel(top) + '  ' + rows[0].sc.pts.toFixed(1) + '점', CX, 126, PAL.yellow, { size: 'b', align: 'center', outline: PAL.black });
    }
  }

  /* ============================== ENGINE ================================= */
  OG.defineEngine('climb', {
    type: 'solo', fieldSize: 8,
    init(ev, ents, opts, R) { return (ev.cfg && ev.cfg.mode) === 'boulder' ? boulderInit(ev, ents, opts, R) : speedInit(ev, ents, opts, R); },
    update(s, inputs, dt, R) { if (s.done) return; if (s.mode === 'boulder') boulderUpdate(s, inputs, dt, R); else speedUpdate(s, inputs, dt, R); },
    draw(g, s) { if (s.mode === 'boulder') boulderDraw(g, s); else speedDraw(g, s); },
    _pd: pdOf // test hook (boulder problem data)
  });

  OG.defineEvents([
    { id: 'climb_speed', name: '스포츠클라이밍 스피드', en: 'Sport Climbing Speed', sport: 'climbing', icon: '🧗',
      tags: ['summer', 'asian'], engine: 'climb', lowerBetter: true, cfg: { mode: 'speed' },
      help: ['{L}{R}{U}: 다음 홀드에 표시된 방향 버튼 (틀리면 미끄러짐)', '리듬 있게 연속 입력하면 FLOW로 더 빨라져요', '꼭대기에서 {A}: 버저를 쳐서 기록 정지!'] },
    { id: 'climb_boulder', name: '스포츠클라이밍 볼더', en: 'Sport Climbing Boulder', sport: 'climbing', icon: '🧗',
      tags: ['summer', 'asian'], engine: 'climb', lowerBetter: false, cfg: { mode: 'boulder' },
      help: ['{L}{U}{R}: 다음 홀드 선택 · {A}: 다이노 (초록 구간에서 다시 {A})', '{D} 누르고 있기: 초크·휴식으로 그립 회복', '탑 홀드에서 {U}로 두 손 매칭 = 완등! (탑 25 · 존 10점)'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
