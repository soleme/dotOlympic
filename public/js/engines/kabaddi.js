/* =========================================================================
 * engine: kabaddi — 7-a-side raid game on a 3/4 top-down clay court (duel)
 *  Raids alternate. The raider must keep chanting "카바디" (hold ACTION) while
 *  in the opponent half, tag defenders and get back across the midline before
 *  the breath runs out. Defenders (CPU teammates + the human-controlled
 *  "anchor") tackle with ACTION; a tackled raider mashes ◀▶ to drag the pile
 *  to the midline. Points: 1 per tagged defender, bonus line +1, tackle +1
 *  (super tackle +2 with ≤3 defenders), all-out +2. Revival per point scored.
 * Court units are metres: u ∈ [0,13] (team 0 end line at u=0), v ∈ [0,10].
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI;
  const CW = 13, CD = 10, MID = 6.5, BAULK = 3.75, BONUS = 4.75;
  const BREATH = 7.5;           // seconds of breath while in the opponent half
  const CAP = 84;               // hard cap (s): no new raid starts after this
  const SY0 = 86, SY1 = 228;    // court far / near screen y
  const RAIDS = 5;              // raids per team in regulation
  const INK = '#141020';

  function scr(u, v) {
    const k = 0.9 + 0.1 * v / CD;
    return [240 + (u - MID) * 28 * k, SY0 + v * (SY1 - SY0) / CD];
  }
  const side = tm => tm ? 1 : -1;                 // direction from midline to own end line
  const depthOf = (tm, u) => (u - MID) * -side(tm); // raider of team tm: >0 inside enemy half
  function dist(a, b) { return Math.hypot(a.u - b.u, a.v - b.v); }

  function hsl(c) {
    const x = OG.hexToRgb(c).map(v => v / 255), mx = Math.max(x[0], x[1], x[2]), mn = Math.min(x[0], x[1], x[2]);
    const l = (mx + mn) / 2, d = mx - mn;
    let h = 0;
    if (d > 0) h = mx === x[0] ? ((x[1] - x[2]) / d) % 6 : mx === x[1] ? (x[2] - x[0]) / d + 2 : (x[0] - x[1]) / d + 4;
    return [h * 60, d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1), l];
  }
  // 0 = identical … large = clearly different (perceptual-ish)
  function colDist(a, b) {
    const x = hsl(a), y = hsl(b);
    let dh = Math.abs(x[0] - y[0]); if (dh > 180) dh = 360 - dh;
    const sat = Math.min(x[1], y[1]);
    return Math.abs(x[2] - y[2]) * 300 + (sat > .25 ? dh * 2.2 : 0) + Math.abs(x[1] - y[1]) * 60;
  }
  function teamKit(s, tm) {
    const c0 = OG.COUNTRY_MAP[s.ents[0].country], c1 = OG.COUNTRY_MAP[s.ents[1].country];
    const k0 = (c0 && c0.kit) || ['#e43b44', '#262b44'];
    const k1 = (c1 && c1.kit) || ['#0099db', '#ffffff'];
    if (tm === 0) return { shirt: k0[0], pants: k0[1] };
    let sh = k1[0], pa = k1[1];
    if (colDist(sh, k0[0]) < 150) { sh = colDist(k1[1], k0[0]) >= 150 ? k1[1] : (colDist('#f4f4f4', k0[0]) > 200 ? '#f4f4f4' : '#262b44'); pa = k1[0]; }
    return { shirt: sh, pants: pa };
  }

  /* ------------------------------------------------------------------ */
  function init(ev, ents, opts, R) {
    const s = {
      evId: ev.id, t: -3, el: 0, ph: 'pre', phT: 0,
      ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name, tag: e.tag || '', skill: e.skill, look: e.look | 0 })),
      sc: [0, 0], outQ: [[], []], rot: [0, 0], pl: [],
      raidNo: 0, total: RAIDS * 2, atk: 0, raider: -1, br: 1, chant: 0, crossed: 0, bonus: 0, rt: 0,
      ctl: [-1, -1], str: null, res: null, sup: 0, golden: 0,
      ai: { plan: 'go', tgt: -1, t: 0, gv: 5, side: 0, mash: 0 },
      pop: [], fx: [], ban: null, shake: 0, ex: 0, done: false, results: null
    };
    for (let i = 0; i < 14; i++) {
      const tm = i < 7 ? 0 : 1;
      s.pl.push({ tm: tm, no: (i % 7) + 1, u: 0, v: 0, st: 'stand', f: tm ? -1 : 1, on: 1, tg: 0, dt: 0, du: 0, dv: 0, hu: 0, hv: 0, ai: R.f() * .3, ph: R.f(), mv: 0 });
    }
    formation(s, 0); formation(s, 1);
    s.pl.forEach(p => { p.u = p.hu; p.v = p.hv; });
    return s;
  }
  function onCourt(s, tm) { return s.pl.filter(p => p.tm === tm && p.on); }
  function formation(s, tm) {
    const ps = onCourt(s, tm).sort((a, b) => a.v - b.v || a.no - b.no);
    const n = ps.length;
    ps.forEach((p, k) => {
      const v = n === 1 ? 5 : 1.2 + 7.6 * k / (n - 1);
      const d = 3.0 + 1.3 * Math.pow(Math.abs(v - 5) / 3.8, 2);
      p.hu = MID + side(tm) * d; p.hv = v;
    });
  }
  function skillOf(s, tm) { const e = s.ents[tm]; return e.human ? .62 : e.skill; }
  function banner(s, str, c, d) { s.ban = { s: str, c: c || PAL.yellow, t: 0, d: d || 1.4 }; }
  function pop(s, str, u, v, c) {
    const p = scr(u, v);
    s.pop.push({ s: str, x: Math.round(p[0]), y: Math.round(p[1] - 40), c: c || PAL.white, t: 0 });
    if (s.pop.length > 6) s.pop.shift();
  }

  /* ------------------------------ raids ------------------------------ */
  function startRaid(s, R) {
    const A = s.raidNo % 2, D = 1 - A;
    s.atk = A;
    s.ph = 'raid'; s.phT = 0;
    formation(s, 0); formation(s, 1);
    const cand = s.pl.map((p, i) => i).filter(i => s.pl[i].tm === A && s.pl[i].on);
    const r = cand[s.rot[A] % cand.length];
    s.rot[A]++;
    s.raider = r;
    s.pl.forEach((p, i) => {
      p.tg = 0; p.dt = 0; p.mv = 0;
      if (!p.on) { p.st = 'bench'; return; }
      p.st = 'stand';
      p.u = p.hu; p.v = p.hv; p.f = p.tm ? -1 : 1;
      if (p.tm === A && i !== r) { p.u = MID + side(A) * (4.6 + (p.no % 3) * .5); }
    });
    const rp = s.pl[r];
    rp.u = MID + side(A) * 1.0; rp.v = 5; rp.f = A ? -1 : 1;
    s.br = 1; s.chant = 0; s.nc = 0; s.crossed = 0; s.bonus = 0; s.rt = 0; s.str = null; s.res = null;
    s.ai = { plan: 'go', tgt: -1, t: 0, gv: 2 + R.f() * 6, side: 0, mash: 0, bonusTry: R.chance(.3) ? 1 : 0 };
    // defending human controls the defender closest to the raider
    s.ctl = [-1, -1];
    if (s.ents[D].human) {
      let best = -1, bd = 99;
      s.pl.forEach((p, i) => { if (p.tm === D && p.on) { const d = Math.hypot(p.u - MID, p.v - 5); if (d < bd) { bd = d; best = i; } } });
      s.ctl[D] = best;
    }
    if (s.ents[A].human) s.ctl[A] = r;
    const e = s.ents[A];
    banner(s, (s.golden ? '골든 레이드 · ' : 'RAID ' + (s.raidNo + 1) + ' · ') + (e.human ? e.tag : e.country), s.golden ? PAL.gold : PAL.white, 1.2);
    OG.sfx(s, 'whistle');
  }

  function inputOf(s, tm, inputs) {
    const e = s.ents[tm];
    if (!e.human) return null;
    return (inputs && inputs[e.pid]) || {};
  }
  const cnt = (I, b) => (I[b + 'c'] != null ? I[b + 'c'] : (I[b + 'p'] ? 1 : 0)) | 0;

  function raidUpd(s, inputs, dt, R) {
    const A = s.atk, D = 1 - A, rp = s.pl[s.raider];
    s.rt += dt;
    if (s.str) return struggleUpd(s, inputs, dt, R);
    // ---------------- raider ----------------
    const I = inputOf(s, A, inputs);
    let mx = 0, my = 0, chant;
    if (I) {
      mx = (I.r ? 1 : 0) - (I.l ? 1 : 0); my = (I.d ? 1 : 0) - (I.u ? 1 : 0);
      chant = !!I.a;
    } else {
      const m = raiderAI(s, dt, R); mx = m[0]; my = m[1]; chant = true;
    }
    s.chant = chant ? 1 : 0;
    const ml = Math.hypot(mx, my);
    const spd = (I ? 3.4 : 2.7 + .9 * skillOf(s, A)) * (s.ai.plan === 'touch' && !I ? 1.35 : 1);
    if (ml > 0) { rp.u += mx / ml * spd * dt; rp.v += my / ml * spd * dt; rp.mv = 1; if (mx) rp.f = mx > 0 ? 1 : -1; } else rp.mv = 0;
    rp.ph += dt * (ml > 0 ? 2.4 : .6);
    const dep = depthOf(A, rp.u);
    if (dep > 0) {
      if (!s.crossed) { s.crossed = 1; OG.sfx(s, 'step'); }
      s.nc = chant ? 0 : (s.nc || 0) + dt;
      if (s.nc > .2) return raiderOut(s, '숨 끊김! (구호 중단)', R);
      s.br -= dt / BREATH;
      if (s.br <= 0) { s.br = 0; return raiderOut(s, '숨이 다했다!', R); }
      if (!s.bonus && dep >= BONUS && onCourt(s, D).length >= 6) {
        s.bonus = 1; pop(s, '보너스 +1', rp.u, rp.v, PAL.gold); OG.sfx(s, 'ding');
      }
    } else if (s.crossed) {
      return endRaid(s, 'ok', '', R);
    } else {
      s.br = Math.min(1, s.br + dt * .3);
      if (s.rt > 5) return raiderOut(s, '레이드 시간 초과', R);
    }
    if (rp.v < -0.3 || rp.v > CD + .3 || rp.u < -0.3 || rp.u > CW + .3) return raiderOut(s, '장외!', R);
    rp.v = M.clamp(rp.v, -0.4, CD + .4);
    // ---------------- defenders ----------------
    const Id = inputOf(s, D, inputs);
    const sk = skillOf(s, D);
    const defs = s.pl.map((p, i) => i).filter(i => s.pl[i].tm === D && s.pl[i].on);
    for (const i of defs) {
      const p = s.pl[i];
      p.ph += dt * (p.mv ? 2.2 : .5);
      if (p.st === 'down') { p.dt -= dt; if (p.dt <= 0) p.st = 'stand'; continue; }
      if (p.st === 'dive') {
        p.dt -= dt;
        p.u += p.du * 5.2 * dt; p.v += p.dv * 5.2 * dt;
        if (dist(p, rp) < .6 && s.crossed && depthOf(A, rp.u) > 0) { tackle(s, i, R); if (s.str || s.ph !== 'raid') return; }
        if (depthOf(D, p.u) > -0.15) p.u = MID + side(D) * 0.15;
        p.v = M.clamp(p.v, -0.2, CD + .2);
        if (p.dt <= 0) { p.st = 'down'; p.dt = .7; }
        continue;
      }
      let tu = p.hu, tv = M.clamp(p.hv + (rp.v - 5) * .3, .4, CD - .4);
      const human = Id && s.ctl[D] === i;
      if (human) {
        const hx = (Id.r ? 1 : 0) - (Id.l ? 1 : 0), hy = (Id.d ? 1 : 0) - (Id.u ? 1 : 0);
        const hl = Math.hypot(hx, hy);
        if (hl) { p.u += hx / hl * 3.1 * dt; p.v += hy / hl * 3.1 * dt; p.mv = 1; } else p.mv = 0;
        if (Id.ap) {
          const d = dist(p, rp);
          let du = hx, dv = hy;
          if (d < 2.2 || !hl) { du = rp.u - p.u; dv = rp.v - p.v; }
          const l = Math.hypot(du, dv) || 1;
          p.st = 'dive'; p.dt = .32; p.du = du / l; p.dv = dv / l; OG.sfx(s, 'whoosh');
        }
      } else {
        const d = dist(p, rp);
        if (s.crossed && d < 1.05 && R.f() < .7) {
          // keep a safe distance (any touch counts!)
          const l = d || 1;
          tu = p.u + (p.u - rp.u) / l * .8 + side(D) * .25; tv = p.v + (p.v - rp.v) / l * .8;
        }
        const wu = tu - p.u, wv = tv - p.v, wl = Math.hypot(wu, wv);
        if (wl > .08) { const sp = Math.min(2.3, wl * 4); p.u += wu / wl * sp * dt; p.v += wv / wl * sp * dt; p.mv = 1; } else p.mv = 0;
        // tackle decision
        p.ai -= dt;
        if (p.ai <= 0) {
          p.ai = .14 + R.f() * .1;
          const rd = depthOf(A, rp.u);
          if (s.crossed && rd > 0 && d < 1.5) {
            const helpers = defs.filter(j => j !== i && s.pl[j].st !== 'down' && dist(s.pl[j], rp) < 1.8).length;
            let pc = (.1 + .4 * sk) * (1 + .6 * helpers) * (rd > 2.6 ? 1.6 : rd < 1 ? .45 : 1) * (s.ai.plan === 'back' ? 1.25 : 1);
            if (s.br < .3) pc *= 1.6;
            if (R.f() < pc) {
              const du = rp.u + (I ? 0 : 0) - p.u, dv = rp.v - p.v, l = Math.hypot(du, dv) || 1;
              p.st = 'dive'; p.dt = .3; p.du = du / l; p.dv = dv / l; OG.sfx(s, 'whoosh');
            }
          }
        }
      }
      p.u = M.clamp(p.u, -0.2, CW + .2); p.v = M.clamp(p.v, -0.2, CD + .2);
      // a defender may not cross into the raiding half
      if (depthOf(D, p.u) > -0.15) p.u = MID + side(D) * 0.15;
      p.f = rp.u > p.u ? 1 : -1;
      // contact → touched
      if (!p.tg && s.crossed && depthOf(A, rp.u) > 0 && dist(p, rp) < .78) {
        p.tg = 1; pop(s, '터치!', p.u, p.v, PAL.yellow); OG.sfx(s, 'hit'); s.shake = 2;
      }
    }
  }

  function raiderAI(s, dt, R) {
    const A = s.atk, D = 1 - A, rp = s.pl[s.raider], ai = s.ai;
    const sk = skillOf(s, A);
    const dep = depthOf(A, rp.u);
    const defs = s.pl.filter(p => p.tm === D && p.on);
    ai.t += dt;
    const into = -side(A);
    let gx = 0, gy = 0;
    const near = defs.filter(p => p.st !== 'down' && dist(p, rp) < 1.4).length;
    if (ai.plan === 'go') {
      // walk in towards a target defender
      if (ai.tgt < 0 || !s.pl[ai.tgt] || !s.pl[ai.tgt].on) {
        let best = -1, bs = -99;
        s.pl.forEach((p, i) => {
          if (p.tm !== D || !p.on) return;
          const sup = defs.filter(q => q !== p && dist(q, p) < 2).length;
          const sc = -sup * 1.2 - Math.abs(p.v - rp.v) * .3 + R.f() * 1.5 + (p.tg ? -5 : 0);
          if (sc > bs) { bs = sc; best = i; }
        });
        ai.tgt = best;
      }
      if (ai.bonusTry && dep > 0 && onCourt(s, D).length >= 6 && near === 0) { ai.plan = 'bonus'; }
      const T = s.pl[ai.tgt];
      if (T) {
        const au = T.u - into * .95, av = T.v;
        gx = au - rp.u; gy = av - rp.v;
        if (Math.hypot(gx, gy) < .35 || (dep > 0 && dist(T, rp) < 1.7)) { ai.plan = 'touch'; ai.t = 0; }
      } else { gx = into; }
      if (dep > 0 && (near >= 3 || s.br < .5 || ai.t > 4.5)) ai.plan = 'back';
    } else if (ai.plan === 'touch') {
      const T = s.pl[ai.tgt];
      if (!T || T.tg || ai.t > .55) { ai.plan = 'back'; ai.t = 0; }
      else { gx = T.u - rp.u; gy = T.v - rp.v; }
      if (T && T.tg) ai.plan = R.chance(.25 + .25 * sk) && s.br > .6 && near < 2 ? 'go' : 'back';
      if (ai.plan === 'go') ai.tgt = -1;
    } else if (ai.plan === 'bonus') {
      gx = into; gy = 0;
      if (s.bonus || near >= 1 || s.br < .6) ai.plan = 'back';
    } else {
      // back to the midline, dodging defenders
      gx = -into * 1.4; gy = 0;
      for (const p of defs) {
        const d = dist(p, rp);
        if (d < 1.6 && p.st !== 'down') { gy += (rp.v - p.v) / (d * d + .1) * .8; gx += (rp.u - p.u) / (d * d + .1) * .3; }
      }
      if (rp.v < 1) gy += 1; if (rp.v > CD - 1) gy -= 1;
    }
    // reaction: sidestep an incoming dive
    for (const p of defs) if (p.st === 'dive' && dist(p, rp) < 1.6 && R.chance(sk * .25)) { gy += (rp.v > p.v ? 1 : -1) * 2; }
    const l = Math.hypot(gx, gy);
    if (l < .05) return [0, 0];
    return [gx / l, gy / l];
  }

  function tackle(s, di, R) {
    const A = s.atk, D = 1 - A, rp = s.pl[s.raider], dp = s.pl[di];
    const defs = s.pl.map((p, i) => i).filter(i => s.pl[i].tm === D && s.pl[i].on);
    const helpers = defs.filter(j => j !== di && s.pl[j].st !== 'down' && dist(s.pl[j], rp) < 1.7);
    const dep = depthOf(A, rp.u);
    const p = .4 + .12 * Math.min(3, helpers.length) + .3 * (skillOf(s, D) - skillOf(s, A)) + (dep > 3 ? .12 : 0) - (dep < .9 ? .22 : 0);
    dp.tg = 1;
    if (R.f() < p) {
      const h = [di].concat(helpers.slice(0, 2));
      s.sup = onCourt(s, D).length <= 3 ? 1 : 0;
      s.str = { h: h, t: 0, pull: 0 };
      h.forEach((j, k) => { const q = s.pl[j]; q.st = 'hold'; q.tg = 1; q.du = (q.u - rp.u) * .5; q.dv = (q.v - rp.v) * .5 + (k - 1) * .25; });
      rp.st = 'held';
      s.shake = 5; s.ex = 1;
      OG.sfx(s, 'crash');
      pop(s, s.sup ? '슈퍼 태클!' : '태클!', rp.u, rp.v, PAL.orange);
    } else {
      dp.st = 'down'; dp.dt = 1.0;
      pop(s, '뿌리쳤다!', rp.u, rp.v, PAL.white);
      OG.sfx(s, 'whoosh');
    }
  }
  function struggleUpd(s, inputs, dt, R) {
    const A = s.atk, D = 1 - A, rp = s.pl[s.raider], st = s.str;
    st.t += dt;
    s.br -= dt / BREATH;
    const I = inputOf(s, A, inputs);
    let pull;
    if (I) pull = (cnt(I, 'l') + cnt(I, 'r')) * .11;
    else pull = (4.5 + 7 * skillOf(s, A)) * dt * .11 * (.75 + R.f() * .5);
    let resist = 0;
    st.h.forEach(j => { resist += (.24 + .22 * skillOf(s, D)) * dt; });
    const Id = inputOf(s, D, inputs);
    if (Id && st.h.indexOf(s.ctl[D]) >= 0) resist += (cnt(Id, 'l') + cnt(Id, 'r')) * .04;
    const mv = M.clamp(pull - resist, -.4 * dt, 1);
    rp.u += side(A) * mv;          // towards the midline / own half
    st.pull += mv;
    rp.ph += dt * 6;
    st.h.forEach(j => { const q = s.pl[j]; q.u = rp.u + q.du; q.v = rp.v + q.dv; q.ph += dt * 6; });
    if ((st.t * 10 | 0) % 3 === 0) s.shake = Math.max(s.shake, 1.5);
    if (depthOf(A, rp.u) <= .45) {
      pop(s, '중앙선 터치!', rp.u, rp.v, PAL.green);
      st.h.forEach(j => { s.pl[j].tg = 1; s.pl[j].st = 'down'; s.pl[j].dt = 2; });
      rp.st = 'stand';
      s.str = null;
      return endRaid(s, 'ok', '', R);
    }
    if (st.t >= 2.8 || s.br <= 0) { s.br = Math.max(0, s.br); return raiderOut(s, '태클 성공!', R, true); }
  }

  function revive(s, tm, n) {
    let k = 0;
    while (n > 0 && s.outQ[tm].length) {
      const i = s.outQ[tm].shift(); const p = s.pl[i];
      p.on = 1; p.st = 'stand'; n--; k++;
    }
    return k;
  }
  function raiderOut(s, why, R, tackled) {
    const A = s.atk, D = 1 - A;
    const rp = s.pl[s.raider];
    rp.st = 'down'; rp.dt = 9;
    let res = why;
    const pts = tackled && s.sup ? 2 : 1;
    // bonus stands even when the raider is caught
    if (s.bonus) s.sc[A] += 1;
    s.sc[D] += pts;
    rp.on = 0; s.outQ[A].push(s.raider);
    const rv = revive(s, D, 1);
    finishRaid(s, res + '  ' + teamName(s, D) + ' +' + pts + (s.bonus ? ' / 보너스 +1' : ''), D, pts, rv, R);
    OG.sfx(s, tackled ? 'cheer' : 'fail');
  }
  function endRaid(s, how, why, R) {
    const A = s.atk, D = 1 - A;
    const tagged = s.pl.map((p, i) => i).filter(i => s.pl[i].tm === D && s.pl[i].on && s.pl[i].tg);
    const pts = tagged.length + (s.bonus ? 1 : 0);
    s.sc[A] += pts;
    tagged.forEach(i => { s.pl[i].on = 0; s.pl[i].st = 'down'; s.pl[i].dt = 9; s.outQ[D].push(i); });
    const rv = revive(s, A, tagged.length);
    let txt;
    if (pts > 0) { txt = '레이드 성공! ' + teamName(s, A) + ' +' + pts; OG.sfx(s, 'good'); }
    else { txt = '빈 레이드 (0점)'; OG.sfx(s, 'beep'); }
    finishRaid(s, txt, pts ? A : -1, pts, rv, R);
  }
  function finishRaid(s, txt, who, pts, rv, R) {
    s.ph = 'end'; s.phT = 0; s.str = null;
    s.res = { s: txt, who: who, pts: pts };
    // all out
    for (let tm = 0; tm < 2; tm++) {
      if (onCourt(s, tm).length === 0) {
        s.sc[1 - tm] += 2;
        revive(s, tm, 7);
        s.res.all = tm;
        OG.sfx(s, 'cheer');
      }
    }
    if (who >= 0 || s.res.all != null) s.ex = 1;
    const c = who < 0 ? PAL.lightgrey : who === 0 ? PAL.yellow : PAL.yellow;
    if (s.res.all != null || who >= 0) banner(s, s.res.all != null ? '올 아웃! +2' : '+' + pts, s.res.all != null ? PAL.hotpink : c, 1.6);
  }
  function teamName(s, tm) { const e = s.ents[tm]; return e.human ? e.tag : e.country; }

  function afterRaid(s, R) {
    s.raidNo++;
    const evenDone = s.raidNo % 2 === 0;
    if (evenDone && (s.raidNo >= s.total || s.el >= CAP)) {
      if (s.sc[0] !== s.sc[1]) return finish(s, s.sc[0] > s.sc[1] ? 0 : 1, '');
      if (s.el < CAP - 14 && s.golden < 2) { s.golden++; s.total += 2; return startRaid(s, R); }
      // still level: more players on court, then coin toss
      const a = onCourt(s, 0).length, b = onCourt(s, 1).length;
      return finish(s, a !== b ? (a > b ? 0 : 1) : R.i(2), a !== b ? ' (잔류 인원)' : ' (추첨)');
    }
    startRaid(s, R);
  }
  function finish(s, w, note) {
    s.ph = 'over'; s.phT = 0;
    const a = s.sc[w], b = s.sc[1 - w];
    s.win = { w: w, wt: a + ' : ' + b + (note || ''), lt: b + ' : ' + a };
    banner(s, teamName(s, w) + ' 승리!', PAL.yellow, 3);
    s.ex = 1;
    OG.sfx(s, 'buzzer'); OG.sfx(s, 'cheer');
    s.pl.forEach(p => { if (p.on && p.st !== 'bench') p.st = p.tm === w ? 'win' : 'stand'; });
  }

  function update(s, inputs, dt, R) {
    if (s.done) return;
    s.t += dt; s.phT += dt;
    for (const p of s.pop) p.t += dt;
    s.pop = s.pop.filter(p => p.t < 1.3);
    if (s.ban) { s.ban.t += dt; if (s.ban.t > s.ban.d) s.ban = null; }
    s.shake = Math.max(0, s.shake - 20 * dt);
    s.ex = Math.max(0, s.ex - .3 * dt);
    if (s.ph === 'pre') {
      s.pl.forEach(p => { p.ph += dt * .5; });
      if (s.t >= 0) startRaid(s, R);
      return;
    }
    if (s.ph !== 'over') s.el += dt;
    if (s.ph === 'raid') raidUpd(s, inputs, dt, R);
    else if (s.ph === 'end') {
      s.pl.forEach(p => { if (p.st === 'down' && p.on) { p.dt -= dt; if (p.dt <= 0) p.st = 'stand'; } p.ph += dt * .5; });
      if (s.phT > 1.8) afterRaid(s, R);
    } else if (s.ph === 'over') {
      s.pl.forEach(p => { p.ph += dt; });
      if (s.phT > 2.8) {
        s.results = [{ idx: s.ents[s.win.w].idx, text: s.win.wt }, { idx: s.ents[1 - s.win.w].idx, text: s.win.lt }];
        s.done = true;
      }
    }
  }

  function cpuMatch(ev, a, b, R) {
    const w = OG.cpuDuel(a, b, R);
    const gap = Math.abs(a.skill - b.skill);
    const W = 4 + R.int(0, 8);
    const L = Math.max(0, W - 1 - R.int(0, Math.round(2 + gap * 12)));
    return { winner: w, text: W + ' : ' + L };
  }

  /* ============================== DRAW =============================== */
  const SEG = { thigh: 5.5, shin: 5.5, torso: 8, uarm: 4.2, farm: 4.2, head: 2.6 };
  function fig(g, x, y, pose, o, f, s) {
    const rot = pose.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const tf = (lx, ly) => [lx * cr - ly * sr, lx * sr + ly * cr];
    const dir = (a, l) => [Math.sin(a) * l, Math.cos(a) * l];
    const t = pose.t || 0;
    const neck = [Math.sin(t) * SEG.torso, -Math.cos(t) * SEG.torso];
    const sh = [neck[0] * .92, neck[1] * .92];
    const limb = (b, a1, l1, a2, l2) => { const d1 = dir(a1, l1), j1 = [b[0] + d1[0], b[1] + d1[1]], d2 = dir(a2, l2); return [j1, [j1[0] + d2[0], j1[1] + d2[1]]]; };
    const aL = (pose.aL || 0) + t, aR = (pose.aR || 0) + t;
    const armL = limb(sh, aL, SEG.uarm, aL + (pose.eL || 0), SEG.farm), armR = limb(sh, aR, SEG.uarm, aR + (pose.eR || 0), SEG.farm);
    const legL = limb([0, 0], pose.lL || 0, SEG.thigh, (pose.lL || 0) - (pose.kL || 0), SEG.shin), legR = limb([0, 0], pose.lR || 0, SEG.thigh, (pose.lR || 0) - (pose.kR || 0), SEG.shin);
    const hd = [neck[0] + Math.sin(t) * (SEG.head + .6), neck[1] - Math.cos(t) * (SEG.head + .6)];
    const P = { neck: neck, sh: sh, head: hd, elL: armL[0], hdL: armL[1], elR: armR[0], hdR: armR[1], knL: legL[0], ftL: legL[1], knR: legR[0], ftR: legR[1] };
    const J = {};
    for (const k in P) { const p = tf(P[k][0], P[k][1]); J[k] = [p[0] * f * s, p[1] * s]; }
    const low = Math.max(J.ftL[1], J.ftR[1], J.head[1] + SEG.head * s, J.hdL[1], J.hdR[1], J.knL[1], J.knR[1]);
    const hy = y - low - 1;
    for (const k in J) { J[k][0] += x; J[k][1] += hy; }
    J.hip = [x, hy];
    const T = Math.max(2, Math.round(2 * s)), TT = Math.max(3, Math.round(3 * s));
    const L = (a, b, c, th) => g.line(a[0], a[1], b[0], b[1], c, th);
    const hr = Math.round(SEG.head * s);
    const out = o.out || INK, dk = c => OG.shade(c, -.3);
    [[J.hip, J.knL], [J.knL, J.ftL], [J.sh, J.elL], [J.elL, J.hdL], [J.hip, J.knR], [J.knR, J.ftR], [J.sh, J.elR], [J.elR, J.hdR]].forEach(q => L(q[0], q[1], out, T + 2));
    L(J.hip, J.neck, out, TT + 2);
    g.circle(J.head[0], J.head[1], hr + 1, out);
    L(J.hip, J.knL, dk(o.pants), T); L(J.knL, J.ftL, dk(o.skin), T);
    L(J.sh, J.elL, dk(o.skin), T); L(J.elL, J.hdL, dk(o.skin), T);
    L(J.hip, J.neck, o.shirt, TT);
    g.circle(J.hip[0], J.hip[1], Math.max(2, s * 1.5), o.pants);
    L(J.hip, J.knR, o.pants, T); L(J.knR, J.ftR, o.skin, T);
    g.circle(J.head[0], J.head[1], hr, o.skin);
    const u = [J.head[0] - J.neck[0], J.head[1] - J.neck[1]], ul = Math.hypot(u[0], u[1]) || 1; u[0] /= ul; u[1] /= ul;
    const bk = [u[1] * f, -u[0] * f];
    for (let i = -hr; i <= hr; i++) for (let j = -hr; j <= hr; j++) {
      if (i * i + j * j > hr * hr + .5) continue;
      const du = i * u[0] + j * u[1], db = i * bk[0] + j * bk[1];
      if (du > hr * .2 || (db > hr * .3 && du > -hr * .45)) g.px(J.head[0] + i, J.head[1] + j, o.hair);
    }
    g.px(J.head[0] - bk[0] * hr * .5, J.head[1] - bk[1] * hr * .5, INK);
    L(J.sh, J.elR, o.skin, T); L(J.elR, J.hdR, o.skin, T);
    return J;
  }
  const PS = {
    ready: { t: .3, aL: 1.0, aR: .8, eL: .9, eR: .8, lL: .45, lR: -.25, kL: .7, kR: .5 },
    raid: { t: .35, aL: -.4, aR: 1.5, eL: .3, eR: .1, lL: .5, lR: -.3, kL: .7, kR: .4 },
    dive: { rot: 1.2, t: 0, aL: 1.4, aR: 1.6, eL: .2, eR: .1, lL: -.3, lR: -.1, kL: .4, kR: .2 },
    hold: { rot: .9, t: .2, aL: 1.6, aR: 1.8, eL: .6, eR: .4, lL: -.2, lR: .4, kL: 1.0, kR: .8 },
    held: { t: .9, aL: -.5, aR: 1.8, eL: .2, eR: 0, lL: .9, lR: -.6, kL: 1.4, kR: .2 },
    down: { rot: -PI / 2, t: 0, aL: 2.4, aR: .6, eL: .3, eR: .4, lL: .2, lR: -.1, kL: .4, kR: .1 },
    sit: { t: .1, aL: .6, aR: .5, eL: .8, eR: .7, lL: 1.5, lR: 1.4, kL: 1.5, kR: 1.4 }
  };
  function poseOf(s, i) {
    const p = s.pl[i];
    switch (p.st) {
      case 'dive': return PS.dive;
      case 'hold': return PS.hold;
      case 'held': return PS.held;
      case 'down': return PS.down;
      case 'win': return OG.Pose.celebrate(p.ph);
    }
    if (p.mv) return OG.Pose.run(p.ph % 1, .7);
    if (i === s.raider && s.ph === 'raid') return OG.Pose.mix(PS.raid, OG.Pose.run(p.ph % 1, .3), .3);
    const r = Object.assign({}, PS.ready);
    r.kL += Math.sin(p.ph * 6) * .1; r.kR += Math.sin(p.ph * 6) * .1;
    return r;
  }

  function court(g, s) {
    const c = (u, v) => scr(u, v);
    const P = (pts) => { const o = []; pts.forEach(q => { const p = c(q[0], q[1]); o.push(p[0], p[1]); }); return o; };
    // surround mat
    g.poly(P([[-2.2, -.9], [CW + 2.2, -.9], [CW + 2.2, CD + 1.4], [-2.2, CD + 1.4]]), '#2c4f86');
    // clay court
    g.poly(P([[0, 0], [CW, 0], [CW, CD], [0, CD]]), '#c47a45');
    // clay texture
    for (let k = 0; k < 520; k++) {
      const u = OG.hash(k, 3, 1) * CW, v = OG.hash(k, 5, 2) * CD, p = c(u, v);
      g.px(p[0], p[1], OG.hash(k, 7, 3) < .5 ? '#b56c3b' : '#d38b55');
    }
    // lobbies
    g.alpha(.18); g.poly(P([[0, 0], [CW, 0], [CW, 1], [0, 1]]), '#ffffff'); g.poly(P([[0, CD - 1], [CW, CD - 1], [CW, CD], [0, CD]]), '#ffffff'); g.alpha(1);
    const W = '#f6efe2';
    const ln = (u0, v0, u1, v1, col, th) => { const a = c(u0, v0), b = c(u1, v1); g.line(a[0], a[1], b[0], b[1], col || W, th || 1); };
    ln(0, 0, CW, 0); ln(0, CD, CW, CD, W, 2); ln(0, 0, 0, CD); ln(CW, 0, CW, CD);
    ln(0, 1, CW, 1); ln(0, CD - 1, CW, CD - 1);
    ln(MID, 0, MID, CD, '#ffffff', 2);
    [MID - BAULK, MID + BAULK].forEach(u => ln(u, 1, u, CD - 1));
    [MID - BONUS, MID + BONUS].forEach(u => { for (let v = 1; v < CD - 1; v += .5) ln(u, v, u, v + .25, '#ffe9a8'); });
    // sitting blocks
    for (let tm = 0; tm < 2; tm++) {
      const u0 = tm ? CW + .5 : -2.0, u1 = u0 + 1.5;
      g.poly(P([[u0, 2], [u1, 2], [u1, 8], [u0, 8]]), '#22406e');
      ln(u0, 2, u1, 2, '#7fa6e0'); ln(u0, 8, u1, 8, '#7fa6e0');
    }
  }

  function draw(g, s) {
    g.clear('#0d0b1a');
    const sh = s.shake;
    const ox = sh ? Math.round(Math.sin(s.t * 83) * sh * .6) : 0;
    // stands
    g.grad(0, 28, 480, 50, '#120f22', '#24204a', 5);
    g.crowd(0, 29, 480, 33, g.t, { excite: s.ex, seed: 41, density: .86, bg: '#2a2550', step: 4 });
    g.rect(0, 61, 480, 1, '#5a6988');
    g.adBoards(0, 62, 480, 10, g.t, ['KABADDI · AICHI-NAGOYA 2026', '카바디!', 'DOT GAMES', 'ASIAN GAMES 2026']);
    g.rect(0, 72, 480, 198, '#203a66');
    g.save(); g.translate(ox, 0);
    court(g, s);
    // benched (out) players in sitting blocks
    for (let tm = 0; tm < 2; tm++) {
      const kit = teamKit(s, tm);
      s.outQ[tm].forEach((i, k) => {
        if (s.ph === 'end' && s.pl[i].st === 'down' && s.pl[i].dt > 8.2 - s.phT) return;
        const p = scr(tm ? CW + 1.25 : -1.25, 2.6 + k * .9);
        fig(g, p[0], p[1], PS.sit, { shirt: kit.shirt, pants: kit.pants, skin: OG.SKINS[(s.ents[tm].look + i * 3) % 5], hair: OG.HAIRS[(i * 7) % 4] }, tm ? -1 : 1, 1);
      });
    }
    // players sorted by depth
    const order = s.pl.map((p, i) => i).filter(i => s.pl[i].on || i === s.raider || (s.pl[i].st === 'down' && s.ph === 'end')).sort((a, b) => s.pl[a].v - s.pl[b].v);
    const rp = s.raider >= 0 ? s.pl[s.raider] : null;
    for (const i of order) {
      const p = s.pl[i];
      if (!p.on && !(i === s.raider && s.ph !== 'pre') && !(p.st === 'down' && s.ph === 'end')) continue;
      const kit = teamKit(s, p.tm);
      const q = scr(p.u, p.v);
      const look = { shirt: kit.shirt, pants: kit.pants, skin: OG.SKINS[(s.ents[p.tm].look + i * 3) % 5], hair: OG.HAIRS[(i * 7) % 4], num: p.no };
      g.ellipse(q[0], q[1] + 1, 6, 2, 'rgba(0,0,0,0.3)');
      // human ring
      const hum = s.ctl[p.tm] === i && s.ents[p.tm].human && s.ph === 'raid';
      if (hum) { const c = OG.PCOLORS[s.ents[p.tm].pid % 8]; g.ellipse(q[0], q[1] + 1, 9, 3, c); g.ellipse(q[0], q[1] + 1, 7, 2, '#c47a45'); }
      const J = fig(g, q[0], q[1], poseOf(s, i), look, p.f, 1.5);
      if (p.tg && p.on && s.ph === 'raid') { g.text('!', J.head[0], J.head[1] - 18, Math.floor(s.t * 8) % 2 ? PAL.red : PAL.yellow, { size: 'b', align: 'center', outline: INK }); }
      if (hum) g.text(s.ents[p.tm].tag, J.head[0], J.head[1] - 15, OG.PCOLORS[s.ents[p.tm].pid % 8], { size: 'xs', align: 'center', outline: INK });
      if (i === s.raider && s.ph === 'raid') {
        // breath bar + chant bubble
        const bx = Math.round(J.head[0] - 10), by = Math.round(J.head[1] - 12);
        g.rect(bx - 1, by - 1, 22, 4, INK); g.rect(bx, by, Math.round(20 * s.br), 2, s.br > .4 ? '#2ce8f5' : '#ff4a3a');
        if (s.chant && s.crossed) {
          const txt = Math.floor(s.t * 4) % 2 ? '카바디!' : '카바디';
          const tw = g.textW(txt, 'xs') + 6, tx = Math.round(J.head[0] + (p.f > 0 ? 6 : -6 - tw)), ty = by - 14;
          g.rect(tx, ty, tw, 10, '#ffffff'); g.rectO(tx, ty, tw, 10, INK);
          g.text(txt, tx + 3, ty + 1, INK, { size: 'xs' });
        }
        if (!hum) g.text(teamName(s, p.tm), J.head[0], by - (s.chant && s.crossed ? 24 : 10), '#ffffff', { size: 'xs', align: 'center', outline: INK });
      }
    }
    if (s.str && rp) {
      const q = scr(rp.u, rp.v);
      for (let k = 0; k < 4; k++) { const a = s.t * 9 + k * 1.7; g.alpha(.5); g.circle(q[0] + Math.cos(a) * 12, q[1] - 2 + Math.sin(a) * 3, 3, '#e8c9a0'); }
      g.alpha(1);
    }
    // umpire at the midline (near side)
    // scorer's table + front-row crowd
    g.rect(300, 238, 84, 12, '#14182e'); g.rect(300, 238, 84, 2, '#3a4466');
    g.text('SCORER', 342, 240, '#8b9bb4', { size: 'xs', align: 'center' });
    for (let k = 0; k < 26; k++) {
      const x = 8 + k * 19, b = Math.abs(Math.sin(g.t * 4 + k * 1.3)) * 2 * (.3 + s.ex);
      if (x > 290 && x < 394) continue;
      g.circle(x, 258 - b, 6, '#0d0a18'); g.rect(x - 7, 262 - b, 14, 8, '#0d0a18');
    }
    const up = scr(MID, CD + .9);
    fig(g, up[0], up[1], s.str ? { t: 0, aL: .2, aR: 2.6, eL: .2, eR: 0, lL: .1, lR: -.1 } : OG.Pose.stand(), { shirt: '#f4f4f4', pants: '#1a1a22', skin: PAL.skin2, hair: '#3e2731' }, -1, 1.5);
    g.restore();
    for (const p of s.pop) {
      g.alpha(Math.min(1, (1.3 - p.t) * 2.5));
      g.text(p.s, p.x, Math.round(p.y - p.t * 18), p.c, { size: 's', align: 'center', outline: INK });
      g.alpha(1);
    }
    hud(g, s);
    if (s.ban) {
      const b = s.ban;
      g.alpha(Math.min(1, (b.d - b.t) * 4));
      g.text(b.s, 240, 104, b.c, { size: b.s.length > 8 ? 'l' : 'xl', align: 'center', outline: INK, maxW: 460 });
      g.alpha(1);
    }
    if (s.ph === 'end' && s.res) {
      g.rect(80, 236, 320, 16, 'rgba(12,11,24,0.85)');
      g.text(s.res.s, 240, 239, PAL.white, { size: 's', align: 'center', maxW: 310 });
    }
    g.countdown(-s.t);
    hints(g, s);
  }

  function hud(g, s) {
    g.rect(0, 0, 480, 28, '#0c0b18'); g.rect(0, 28, 480, 1, '#3a4466');
    for (let tm = 0; tm < 2; tm++) {
      const e = s.ents[tm], kit = teamKit(s, tm), L = tm === 0;
      g.rect(L ? 0 : 477, 0, 3, 28, kit.shirt);
      const fx = L ? 6 : 450;
      g.flag(e.country, fx, 3, 24, 16);
      g.text(OG.entLabel(e), L ? 34 : 446, 2, OG.entColor(e), { size: 'b', align: L ? 'left' : 'right' });
      g.text(e.name, L ? 34 : 446, 16, '#c0cbdc', { size: 'xs', align: L ? 'left' : 'right', maxW: 80 });
      // score
      const bx = L ? 170 : 276;
      g.rect(bx, 2, 34, 24, OG.shade(kit.shirt, -0.5)); g.rectO(bx, 2, 34, 24, OG.shade(kit.shirt, -0.1));
      g.text(String(s.sc[tm]), bx + 17, 4, '#ffffff', { size: 'xl', align: 'center' });
      // players on court
      const n = onCourt(s, tm).length;
      for (let k = 0; k < 7; k++) {
        const dx = L ? 164 - k * 6 - 4 : 316 + k * 6;
        g.rect(dx, 20, 4, 5, k < n ? kit.shirt : '#2a2f45');
      }
      // raid attack marker
      if (s.ph === 'raid' && s.atk === tm) g.text('RAID', L ? 128 : 352, 5, PAL.gold, { size: 'xs', align: 'center' });
    }
    // centre: raid count + breath
    g.rect(208, 2, 64, 24, '#000'); g.rectO(208, 2, 64, 24, '#3a4466');
    const rn = Math.min(s.raidNo + 1, s.total);
    g.text(s.golden ? '골든 레이드' : '레이드 ' + rn + '/' + s.total, 240, 4, s.golden ? PAL.gold : PAL.yellow, { size: 'xs', align: 'center' });
    if (s.ph === 'raid') {
      g.text('숨', 214, 14, '#8b9bb4', { size: 'xs' });
      g.rect(225, 15, 42, 7, '#1d2342'); g.rect(226, 16, Math.round(40 * s.br), 5, s.br > .4 ? '#2ce8f5' : (Math.floor(s.t * 8) % 2 ? '#ff4a3a' : '#ffd23f'));
    } else g.text('카바디', 240, 14, '#8b9bb4', { size: 'xs', align: 'center' });
  }
  function hints(g, s) {
    if (s.ph !== 'raid') return;
    const out = [];
    for (let tm = 0; tm < 2; tm++) {
      const e = s.ents[tm];
      if (!e.human) continue;
      let h;
      if (tm === s.atk) {
        if (s.str) h = '{L}{R} 연타: 중앙선으로 끌고 가기!';
        else if (!s.crossed) h = '{A} 누른 채 "카바디!" · {L}{R}{U}{D} 상대 진영으로';
        else h = '{A} 계속 누르기! 터치 후 중앙선 복귀';
      } else {
        if (s.str && s.str.h.indexOf(s.ctl[tm]) >= 0) h = '{L}{R} 연타: 붙잡아!';
        else h = '{L}{R}{U}{D} 이동 · {A} 태클 (닿으면 아웃!)';
      }
      out.push({ h: h, e: e });
    }
    if (!out.length) return;
    g.rect(0, 255, 480, 15, 'rgba(12,11,24,0.8)');
    if (out.length === 1) g.rich(out[0].h, 240, 257, PAL.white, { align: 'center' });
    else out.forEach((o, j) => {
      g.text(o.e.tag, j ? 476 : 4, 258, OG.PCOLORS[o.e.pid % 8], { size: 'xs', align: j ? 'right' : 'left' });
      g.rich(o.h, j ? 360 : 122, 257, PAL.white, { align: 'center' });
    });
  }

  OG.defineEngine('kabaddi', { type: 'duel', init: init, update: update, draw: draw, cpuMatch: cpuMatch });
  OG.defineEvents([
    { id: 'kabaddi', name: '카바디', en: 'Kabaddi', sport: 'kabaddi', icon: '🤼', tags: ['asian'], engine: 'kabaddi', cfg: {},
      help: ['공격: {A} 누른 채 "카바디!" 숨 참기 · {L}{R}{U}{D} 이동 → 수비수 터치 후 중앙선 복귀', '수비: {L}{R}{U}{D} 이동 · {A} 태클 · 레이더에게 닿기만 해도 아웃!', '태클당하면 {L}{R} 연타로 중앙선까지 끌고 가기 · 보너스 라인 +1'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
