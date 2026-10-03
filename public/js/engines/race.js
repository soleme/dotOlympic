/* =========================================================================
 * engine: race — side-view lane races (Hyper-Olympic style)
 * Track & field sprints/hurdles/relay/walk/marathon, swimming, rowing,
 * canoe/kayak, cycling, BMX, equestrian jumping, modern pentathlon laser-run,
 * triathlon, speed skating, short track, cross-country, biathlon, ski-mo.
 *
 * Physics are in real-world units (m, m/s). Each segment has a time scale
 * `ts` (display seconds per game second) so long races take ~20 s of play
 * but show realistic times, and `ppm` (screen px per metre) so the screen
 * scroll speed always feels the same.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;

  const SCROLL = 180;          // screen px per game second at reference speed
  const LY0 = 86, LAREA = 144; // lane area top & height
  const KIND = {               // animation cadence (cycles / game second at vref) & default drag
    run: { cad: 2.4, drag: 1.6 }, walk: { cad: 2.1, drag: 1.4 }, swim: { cad: 0.95, drag: 1.6 },
    row: { cad: 1.2, drag: 1.0 }, kayak: { cad: 1.3, drag: 1.3 }, canoe: { cad: 1.2, drag: 1.3 },
    skate: { cad: 1.5, drag: 1.2 }, ski: { cad: 1.2, drag: 1.4 }, skin: { cad: 1.0, drag: 1.6 },
    bike: { cad: 1.9, drag: 0.8 }, bmx: { cad: 1.7, drag: 1.3 }, horse: { cad: 1.9, drag: 1.5 }
  };

  /* ----------------------------- helpers ----------------------------- */
  function segIndex(s, pos) {
    for (let i = 0; i < s.segs.length; i++) if (pos < s.segs[i].to) return i;
    return s.segs.length - 1;
  }
  function X(s, pos) {
    if (s.pool) {
      const L = s.pool, m = M.wrap(pos, 2 * L);
      const d = m <= L ? m : 2 * L - m;
      return d * s.segs[0].ppm;
    }
    const sg = s.segs[segIndex(s, pos)];
    return sg.px0 + (pos - sg.from) * sg.ppm;
  }
  function dirAt(s, pos) {
    if (!s.pool) return 1;
    return Math.floor(Math.max(0, pos - 0.001) / s.pool) % 2 === 0 ? 1 : -1;
  }
  function laneGeom(s) {
    const n = s.lanes.length;
    const lh = Math.min(24, Math.floor(LAREA / Math.max(n, 1)));
    const top = LY0 + Math.floor((LAREA - lh * n) / 2);
    return { lh, top };
  }
  function laneY(s, i) { const g = laneGeom(s); return g.top + i * g.lh + g.lh - 3; }
  function msg(s, tx, c, lane, life) { s.msgs.push({ tx, c: c || PAL.white, lane: lane == null ? -1 : lane, life: life || 1.4, age: 0 }); if (s.msgs.length > 12) s.msgs.shift(); }
  function terrainAt(s, pos) {
    if (!s.terrain) return null;
    for (const tr of s.terrain) if (pos >= tr.a && pos < tr.b) return tr.type;
    return null;
  }
  function inCorner(s, pos) {
    if (!s.corners) return false;
    const lap = s.corners.lap, m = M.wrap(pos, lap);
    return (m > lap * 0.25 && m < lap * 0.5) || (m > lap * 0.75 && m < lap);
  }
  const anyInput = inp => inp && (inp.l || inp.r || inp.u || inp.d || inp.a);

  /* ------------------------------ init ------------------------------- */
  function init(ev, ents, opts, R) {
    const cfg = ev.cfg;
    const segCfg = cfg.segs || [{ len: cfg.dist, kind: cfg.kind, look: cfg.look, ctrl: cfg.ctrl, vref: cfg.vref, ts: cfg.ts, beat: cfg.beat, drag: cfg.drag, stroke: cfg.stroke }];
    const segs = [];
    let from = 0, px = 0;
    segCfg.forEach(c => {
      const kind = c.kind || 'run';
      const sg = {
        from, to: from + c.len, len: c.len, kind, look: c.look || 'track', ctrl: c.ctrl || 'alt',
        vref: c.vref || 10, ts: c.ts || 1, beat: c.beat || 0.3, drag: c.drag || KIND[kind].drag,
        stroke: c.stroke || 'free', uphill: !!c.uphill, refRate: c.refRate || 10.5
      };
      sg.ppm = SCROLL / (sg.vref * sg.ts);
      if (c.ppmMul) sg.ppm *= c.ppmMul;
      sg.px0 = px;
      sg.boost = sg.ctrl === 'alt' ? sg.vref * sg.drag / sg.refRate : sg.vref * sg.drag * sg.beat;
      px += c.len * sg.ppm;
      from += c.len;
      segs.push(sg);
    });
    const dist = from;
    const s = {
      evId: ev.id, t: -3.2, gunT: 0, started: false, rt: 0, done: false,
      segs, dist, pool: cfg.pool || 0, start: cfg.start || 'stand',
      stamina: cfg.stamina || 0, breath: !!cfg.breath, walkLimit: cfg.walkLimit || 0, relay: cfg.relay || 0,
      fault: !!cfg.fault, trans: !!cfg.trans, transN: cfg.transN || 3, stopTs: cfg.stopTs || 4,
      hurdles: [], ranges: [], bumps: [], terrain: null, corners: null,
      lanes: [], ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: e.human, country: e.country, tag: e.tag, look: e.look })),
      cam: -170, msgs: [], fs: {}, finCount: 0, post: 0, humanDoneT: 0, label: cfg.label || '',
      coat: []
    };
    if (s.start === 'blocks') s.gunT = R.range(0.1, 0.9);
    // obstacles
    if (cfg.hurdles) {
      const h = cfg.hurdles;
      for (let i = 0; i < h.n; i++) s.hurdles.push({ pos: h.first + i * h.gap, h: h.h || 10, kind: h.kind || 'hurdle', water: !!(h.water && i % h.water === h.water - 1) });
    }
    if (cfg.ranges) s.ranges = cfg.ranges.map(r => ({ at: r.at, shots: r.shots || 5, mode: r.mode || 'biathlon', pen: r.pen || 23 }));
    if (cfg.bumps) for (let i = 0; i < cfg.bumps.n; i++) s.bumps.push(cfg.bumps.first + i * cfg.bumps.gap);
    if (cfg.terrain) {
      s.terrain = [];
      const step = dist / 9;
      const types = ['flat', 'up', 'down', 'up', 'flat', 'down', 'up', 'down', 'flat'];
      for (let i = 0; i < 9; i++) s.terrain.push({ a: i * step, b: (i + 1) * step, type: types[i] });
    }
    if (cfg.corners) s.corners = { lap: cfg.corners };
    s.maxT = segs.reduce((a, sg) => a + sg.len / (sg.vref * sg.ts), 0) * 2.3 + s.ranges.length * 14 + 12;
    // lanes
    const order = ents.map(e => e.idx);
    s.lanes = order.map(i => {
      const e = ents[i];
      const q = e.human ? 0.8 : OG.cpuQuality(e, R, 0.1);
      return {
        idx: i, pos: 0, prev: 0, v: 0, clk: 0, fin: -1, dnf: '', st: 'ready', place: 0,
        last: '', lastTapT: -9, lastStroke: -9, lastL: -9, lastR: -9, lastA: -9, ph: R.f(), y: 0, vy: 0, air: false,
        stam: 1, oxy: 1, rate: 0, lift: 0, warn: 0, nh: 0, kn: [], faults: 0, leg: 0, legT: 0, ri: 0,
        shots: 0, hits: 0, tg: [], cross: 0, cd: 0, penT: 0, shootT: 0, tn: 0, tT: 0, segI: 0, turnArm: false,
        nb: 0, ri2: 0, react: -1, idle: 0, q, cjd: 38 + R.gauss() * (1.1 - q) * 14, cpass: 0, ctrn: 0,
        cReact: 0.12 + (1 - q) * 0.12 + R.f() * 0.06, diveT: 0, slip: 0
      };
    });
    // CPU relay pass point
    s.lanes.forEach(L => { L.cpass = R.range(-6, 2); s.coat.push(R.i(4)); });
    return s;
  }

  /* ----------------------------- update ------------------------------ */
  function update(s, inputs, dt, R) {
    s.t += dt;
    s.msgs.forEach(m => { m.age += dt; });
    s.msgs = s.msgs.filter(m => m.age < m.life);
    // ---------- pre-start ----------
    if (!s.started) {
      if (s.t > -2.95 && s.t - dt <= -2.95) OG.sfx(s, s.start === 'blocks' || s.start === 'dive' ? 'whistle' : 'beep');
      if (s.start !== 'blocks' && s.start !== 'dive') {
        [-2, -1].forEach(k => { if (s.t >= k && s.t - dt < k) OG.sfx(s, 'beep'); });
      }
      if (s.start === 'blocks' || s.start === 'dive') {
        // false start check after "set"
        if (s.t > -1.5) {
          for (const L of s.lanes) {
            const e = s.ents[L.idx];
            if (!e.human || L.dnf) continue;
            const inp = inputs[e.pid];
            if (inp && (inp.lp || inp.rp || inp.ap)) {
              s.fs[e.pid] = (s.fs[e.pid] || 0) + 1;
              OG.sfx(s, 'buzzer');
              if (s.fs[e.pid] >= 3) { L.dnf = 'DQ'; L.st = 'out'; msg(s, e.tag + ' 실격 (부정출발 3회)', PAL.red, -1, 2.5); }
              else msg(s, e.tag + ' 부정출발! 경고 ' + s.fs[e.pid] + '/2', PAL.yellow, -1, 2.5);
              s.t = -3.2; s.gunT = R.range(0.1, 0.9);
              return;
            }
          }
        }
        if (s.t >= -1.5 && s.t - dt < -1.5) OG.sfx(s, 'tick');
      }
      if (s.t >= s.gunT) {
        s.started = true; s.rt = 0;
        OG.sfx(s, s.start === 'blocks' ? 'gun' : s.start === 'dive' ? 'buzzer' : 'go');
        s.lanes.forEach(L => {
          if (L.dnf) return;
          if (s.ranges.length && s.ranges[0].at <= 0) enterRange(s, L, R);
          else L.st = s.start === 'dive' ? 'block' : 'go';
        });
      }
      return;
    }
    // ---------- race ----------
    s.rt += dt;
    for (const L of s.lanes) {
      const e = s.ents[L.idx];
      const inp = e.human ? (inputs[e.pid] || OG.blankInput()) : null;
      stepLane(s, L, e, inp, dt, R);
    }
    // camera
    let focus = null;
    for (const L of s.lanes) {
      const e = s.ents[L.idx];
      if (!e.human || L.dnf) continue;
      if (!focus || (L.fin < 0 && (focus.fin >= 0 || L.pos > focus.pos))) focus = L;
    }
    if (!focus) for (const L of s.lanes) if (!focus || L.pos > focus.pos) focus = L;
    if (focus) {
      const dir = dirAt(s, focus.pos);
      let target = X(s, focus.pos) - (s.pool ? (dir > 0 ? 200 : 280) : 170);
      if (!s.pool) target = Math.max(-70, target);
      else target = M.clamp(target, -90, s.pool * s.segs[0].ppm - 390);
      s.cam += (target - s.cam) * Math.min(1, dt * 7);
    }
    // ---------- end conditions ----------
    const humans = s.lanes.filter(L => s.ents[L.idx].human);
    const humansDone = humans.every(L => L.fin >= 0 || L.dnf);
    const allDone = s.lanes.every(L => L.fin >= 0 || L.dnf);
    if (humansDone) s.humanDoneT += dt;
    if (s.rt > s.maxT) {
      s.lanes.forEach(L => { if (L.fin < 0 && !L.dnf && s.ents[L.idx].human) { L.dnf = 'DNF'; L.st = 'out'; } });
    }
    if (allDone || (humansDone && s.humanDoneT > 3) || s.rt > s.maxT + 1) {
      // project unfinished CPUs
      s.lanes.forEach(L => {
        if (L.fin >= 0 || L.dnf) return;
        const sg = s.segs[segIndex(s, L.pos)];
        const v = Math.max(L.v, sg.vref * (0.6 + 0.3 * L.q));
        let extra = 0;
        s.ranges.forEach((r, i) => { if (i >= L.ri) extra += (4 + (1 - L.q) * 4) * s.stopTs + (1 - L.q) * 2 * r.pen; });
        L.fin = L.clk + (s.dist - L.pos) / v + extra;
        L.st = 'fin';
      });
      s.post += dt;
      if (s.post > 2.2) finish(s);
    }
  }

  function finish(s) {
    const rows = s.lanes.map(L => {
      if (L.dnf) return { idx: L.idx, score: 999999, text: L.dnf, dnf: true };
      const tt = OG.fmt.time(L.fin, 2);
      if (s.fault) return { idx: L.idx, score: L.faults * 1000 + L.fin, text: (L.faults ? L.faults + '벌점 ' : '무과실 ') + tt };
      return { idx: L.idx, score: L.fin, text: tt };
    });
    s.results = OG.sortResults(rows, true);
    s.done = true;
  }

  function enterRange(s, L, R) {
    const rg = s.ranges[L.ri];
    L.st = 'shoot'; L.v = 0; L.shots = 0; L.hits = 0; L.tg = []; L.cross = R.f() * 6.28; L.cd = 0.5; L.shootT = 0;
    L.pos = Math.max(L.pos, rg.at);
    L.prev = L.pos;
  }

  function stepLane(s, L, e, inp, dt, R) {
    stepLaneCore(s, L, e, inp, dt, R);
    if (s.relay && L.st === 'run') relayCheck(s, L);
  }

  function stepLaneCore(s, L, e, inp, dt, R) {
    const human = e.human;
    if (L.dnf || L.st === 'out') return;
    // after finish: coast & stop
    if (L.fin >= 0) {
      L.v *= Math.pow(0.25, dt);
      if (!s.pool) L.pos += L.v * s.segs[s.segs.length - 1].ts * dt * 0.3;
      L.ph += dt * 0.6 * (L.v > 0.5 ? 1 : 0);
      return;
    }
    if (human) {
      if (anyInput(inp)) L.idle = 0; else L.idle += dt;
      if (L.idle > 14 && L.st !== 'shoot' && L.st !== 'trans') { L.dnf = 'DNF'; L.st = 'out'; msg(s, e.tag + ' 기권', PAL.grey); return; }
      if (inp.ap) L.lastA = s.t;
    }
    const si = segIndex(s, L.pos);
    const sg = s.segs[si];
    // ---- special states ----
    if (L.st === 'block') { // swim start: wait for dive
      L.clk += dt * sg.ts;
      const go = human ? (inp.ap || inp.lp || inp.rp || s.rt > 2.0) : s.rt > 0.55 + (1 - L.q) * 0.25;
      if (go) { L.st = 'dive'; L.diveT = 0; L.react = s.rt; L.v = sg.vref * 1.15; OG.sfx(s, 'whoosh'); }
      return;
    }
    if (L.st === 'dive') {
      L.diveT += dt;
      L.clk += dt * sg.ts;
      L.prev = L.pos;
      L.pos += L.v * sg.ts * dt;
      if (L.diveT > 0.42) { L.st = 'run'; L.v = sg.vref * 0.95; OG.sfx(s, 'splash'); }
      return;
    }
    if (L.st === 'go') { // waiting for reaction (land starts)
      L.clk += dt * sg.ts;
      const go = human ? (inp.lp || inp.rp || inp.ap || (sg.ctrl === 'tuck')) : s.rt > L.cReact;
      if (go) {
        L.st = 'run'; L.react = s.rt;
        if (human && s.start === 'blocks' && s.rt < 0.1) msg(s, '반응 ' + s.rt.toFixed(3) + '!', PAL.green, s.lanes.indexOf(L));
      } else return;
    }
    if (L.st === 'shoot') { shootStep(s, L, e, inp, dt, R); return; }
    if (L.st === 'pen') {
      L.penT -= dt;
      L.ph += dt * 2;
      if (L.penT <= 0) { L.st = 'run'; L.v = sg.vref * 0.4; }
      return;
    }
    if (L.st === 'trans') {
      L.clk += dt * 12;
      L.tT += dt;
      if (human) {
        if (inp.ap) { L.tn++; OG.sfx(s, 'click'); }
        if (L.tn >= s.transN || L.tT > 6) { L.st = 'run'; L.v = sg.vref * 0.3; L.tn = 0; OG.sfx(s, 'good'); }
      } else if (L.tT > 0.6 + (1 - L.q) * 1.0) { L.st = 'run'; L.v = sg.vref * 0.3; }
      return;
    }
    // ---- moving ----
    const ctrl = sg.ctrl;
    const terr = terrainAt(s, L.pos);
    const tuckSeg = ctrl === 'tuck';
    let drag = sg.drag;
    if (L.air) drag *= 0.25;
    let boostMul = 1;
    if (terr === 'up' || sg.uphill) { boostMul = 0.62; drag *= 1.0; }
    let staminaCap = 1.12;
    if (s.stamina) staminaCap = 0.72 + 0.4 * L.stam;
    let cap = sg.vref * staminaCap;
    if (terr === 'up' || sg.uphill) cap *= 0.75;
    if (s.breath && L.oxy <= 0) boostMul *= 0.35;
    if (human) {
      // --- taps ---
      if (!L.air && !tuckSeg) {
        if (ctrl === 'alt' || ctrl === 'rhythm') {
          const keys = [];
          if (inp.lp) keys.push('l');
          if (inp.rp) keys.push('r');
          if (keys.length === 2 && L.last === 'l') keys.reverse();
          for (const k of keys) {
            let q = 1;
            if (k === L.last) q = 0.15;
            else if (ctrl === 'rhythm') { const iv = s.t - L.lastTapT; q = iv < sg.beat ? Math.pow(Math.max(0, iv) / sg.beat, 1.7) : 1; }
            if (s.walkLimit) {
              const iv = Math.max(0.03, s.t - L.lastTapT);
              L.rate = L.rate * 0.72 + (1 / iv) * 0.28;
            }
            L.v += sg.boost * q * boostMul;
            L.last = k; L.lastTapT = s.t;
            if (sg.kind === 'run' || sg.kind === 'walk') { if (L.nb++ % 2 === 0) OG.sfx(s, 'step'); }
            else if (sg.kind === 'swim' || sg.kind === 'kayak' || sg.kind === 'canoe') { if (L.nb++ % 2 === 0) OG.sfx(s, 'stroke'); }
            else if (sg.kind === 'skate') { if (L.nb++ % 2 === 0) OG.sfx(s, 'ice'); }
            else if (sg.kind === 'ski' || sg.kind === 'skin') { if (L.nb++ % 2 === 0) OG.sfx(s, 'snow'); }
          }
        } else if (ctrl === 'both') {
          if (inp.lp) L.lastL = s.t;
          if (inp.rp) L.lastR = s.t;
          if ((inp.lp || inp.rp) && Math.abs(L.lastL - L.lastR) < 0.14 && s.t - L.lastStroke > 0.16) {
            const iv = s.t - L.lastStroke;
            const q = iv < sg.beat ? Math.pow(iv / sg.beat, 1.7) : 1;
            L.v += sg.boost * q * boostMul;
            L.lastStroke = s.t;
            L.lastL = L.lastR = -9;
            OG.sfx(s, sg.kind === 'swim' ? 'splash' : 'stroke');
            if (q > 0.92 && iv < sg.beat * 1.35) { L.nb++; if (L.nb % 4 === 0) msg(s, '리듬 굿!', PAL.cyan, s.lanes.indexOf(L), 0.6); }
          }
        }
      }
      if (s.walkLimit) {
        if (s.t - L.lastTapT > 0.45) L.rate *= Math.pow(0.2, dt);
        if (L.rate > s.walkLimit) L.lift += dt; else L.lift = Math.max(0, L.lift - dt * 0.6);
        if (L.lift > 0.8) {
          L.lift = 0; L.warn++;
          OG.sfx(s, 'whistle');
          if (L.warn >= 3) { L.dnf = 'DQ'; L.st = 'out'; msg(s, e.tag + ' 실격! (레드카드)', PAL.red, -1, 2.5); return; }
          msg(s, '경고 ' + L.warn + '/3 (발 뜸!)', PAL.yellow, s.lanes.indexOf(L), 1.6);
        }
      }
      // tuck (downhill segment / terrain down)
      if (tuckSeg || terr === 'down') {
        const tgt = sg.vref * (inp.d ? 1.08 : 0.82) * (tuckSeg ? 1 : 1.12);
        L.v += (tgt - L.v) * 0.9 * dt;
      }
      // breath
      if (s.breath && sg.kind === 'swim' && inp.up) { L.oxy = 1; L.v *= 0.93; OG.sfx(s, 'stroke'); }
      // jump
      if (s.hurdles.length && !L.air && (inp.ap || inp.up) && L.nh < s.hurdles.length) jump(s, L, sg);
      // relay pass
      if (s.relay && inp.ap) tryPass(s, L, true);
      // swim turn
      if (s.pool && inp.ap) {
        const wall = (Math.floor(L.pos / s.pool) + 1) * s.pool;
        if (wall < s.dist && wall - L.pos < 2.6) L.turnArm = true;
      }
    } else {
      // --- CPU ---
      let pace = 1;
      if (s.stamina) pace = L.pos / s.dist > 0.78 ? 1.04 : 0.9;
      let tgt = sg.vref * (0.72 + 0.28 * L.q) * pace;
      if (tuckSeg) tgt = sg.vref * (0.86 + 0.2 * L.q);
      if (terr === 'up' || sg.uphill) tgt *= 0.72;
      if (terr === 'down') tgt *= 1.12;
      if (s.walkLimit) tgt *= 0.97;
      if (!L.air) L.v += (Math.min(tgt, cap) - L.v) * Math.min(1, sg.drag * 1.05 * dt);
      // hurdles
      if (s.hurdles.length && !L.air && L.nh < s.hurdles.length) {
        const h = s.hurdles[L.nh];
        const dx = (h.pos - L.pos) * sg.ppm;
        if (dx <= L.cjd) { jump(s, L, sg); L.cjd = 38 + R.gauss() * (1.1 - L.q) * 14; }
      }
      if (s.relay) tryPass(s, L, false);
      if (s.pool) {
        const wall = (Math.floor(L.pos / s.pool) + 1) * s.pool;
        if (wall < s.dist && wall - L.pos < 1.5 && !L.turnArm) L.turnArm = R.f() < 0.55 + 0.45 * L.q;
      }
    }
    // --- common physics ---
    if (human) {
      if (!tuckSeg && terr !== 'down') L.v -= L.v * drag * dt;
      else L.v -= L.v * 0.15 * dt;
    }
    if (s.corners && inCorner(s, L.pos)) {
      if (human && !inp.a) {
        L.v -= L.v * 1.3 * dt;
        if (L.v > sg.vref * 0.85 && L.slip <= 0) { msg(s, '미끄러짐! {A}', PAL.yellow, s.lanes.indexOf(L), 0.8); L.slip = 1.2; OG.sfx(s, 'ice'); }
      }
    }
    if (L.slip > 0) L.slip -= dt;
    L.v = M.clamp(L.v, 0, Math.max(cap, tuckSeg || terr === 'down' ? sg.vref * 1.3 : 0));
    if (s.stamina) {
      const r = L.v / sg.vref;
      L.stam = M.clamp(L.stam - Math.max(0, r - 0.78) * s.stamina * 2.2 * dt + (r < 0.7 ? 0.05 * dt : 0), 0, 1);
    }
    if (s.breath && sg.kind === 'swim') {
      if (human) L.oxy = Math.max(0, L.oxy - dt * 0.1);
      else L.oxy = 1;
    }
    // air
    if (L.air) {
      L.y += L.vy * dt;
      L.vy -= (sg.kind === 'horse' ? 640 : 680) * dt;
      if (L.y <= 0) {
        L.y = 0; L.air = false; L.vy = 0;
        OG.sfx(s, 'land');
        const hp = s.hurdles[L.nh - 1];
        if (hp && hp.water) { L.v *= 0.9; OG.sfx(s, 'splash'); }
      }
    }
    // advance
    L.prev = L.pos;
    const prevClk = L.clk;
    L.pos += L.v * sg.ts * dt;
    L.clk += dt * sg.ts;
    L.ph += dt * KIND[sg.kind].cad * Math.min(1.3, L.v / sg.vref);
    // hurdles crossing
    while (L.nh < s.hurdles.length && L.pos >= s.hurdles[L.nh].pos) {
      const h = s.hurdles[L.nh];
      if (L.y < h.h * 0.8) {
        L.kn.push(L.nh);
        if (s.fault) { L.faults += 4; L.v *= 0.85; msg(s, '낙하! +4', PAL.red, s.lanes.indexOf(L)); }
        else { L.v *= 0.6; if (human) msg(s, '허들 걸림!', PAL.red, s.lanes.indexOf(L)); }
        OG.sfx(s, 'crash');
      } else if (human) OG.sfx(s, 'whoosh');
      L.nh++;
    }
    // bumps (BMX)
    if (s.bumps.length) {
      while (L.ri2 < s.bumps.length && L.pos >= s.bumps[L.ri2]) {
        const pumped = human ? (s.t - L.lastA < 0.3) : R.f() < 0.4 + 0.55 * L.q;
        if (pumped) { L.v += sg.vref * 0.07; if (human) { msg(s, 'PUMP!', PAL.green, s.lanes.indexOf(L), 0.6); OG.sfx(s, 'good'); } }
        else L.v *= 0.94;
        L.ri2++;
      }
    }
    // pool turns
    if (s.pool) {
      const w0 = Math.floor(L.prev / s.pool), w1 = Math.floor(L.pos / s.pool);
      if (w1 > w0 && w1 * s.pool < s.dist) {
        if (L.turnArm) { L.v = Math.max(L.v, sg.vref * 1.05); if (human) { msg(s, '굿 턴!', PAL.green, s.lanes.indexOf(L)); OG.sfx(s, 'good'); } }
        else { L.v *= 0.5; if (human) msg(s, '느린 턴…', PAL.grey, s.lanes.indexOf(L)); }
        L.turnArm = false;
        OG.sfx(s, 'splash');
      }
    }
    // segment change → transition
    const si2 = segIndex(s, L.pos);
    if (si2 !== L.segI) {
      L.segI = si2;
      if (s.trans && L.pos < s.dist) { L.st = 'trans'; L.tn = 0; L.tT = 0; L.v = 0; OG.sfx(s, 'beep'); if (human) msg(s, '바꿈 구역! {A} 연타', PAL.yellow, s.lanes.indexOf(L), 1.5); return; }
    }
    // range
    if (L.ri < s.ranges.length && L.pos >= s.ranges[L.ri].at) { enterRange(s, L, R); return; }
    // finish
    if (L.pos >= s.dist) {
      const frac = (s.dist - L.prev) / Math.max(1e-6, L.pos - L.prev);
      L.fin = prevClk + (L.clk - prevClk) * frac;
      if (s.pool) L.pos = s.dist;
      L.st = 'fin'; L.place = ++s.finCount;
      OG.sfx(s, L.place === 1 ? 'cheer' : 'ding');
      if (human) msg(s, (L.place <= 3 ? ['', '1위!', '2위!', '3위!'][L.place] + ' ' : L.place + '위 ') + OG.fmt.time(L.fin, 2), L.place === 1 ? PAL.yellow : PAL.white, s.lanes.indexOf(L), 3);
    }
  }

  function jump(s, L, sg) {
    L.air = true;
    L.vy = sg.kind === 'horse' ? 178 : 152;
    L.v *= 0.98;
    OG.sfx(s, 'jump');
  }

  function tryPass(s, L, human) {
    if (L.leg >= s.relay - 1) return;
    const legLen = s.dist / s.relay;
    const legEnd = (L.leg + 1) * legLen;
    const inZone = L.pos > legEnd - 12 && L.pos < legEnd + 8;
    if (human) {
      if (inZone) {
        L.leg++; L.v *= 0.99;
        const good = Math.abs(L.pos - legEnd) < 5;
        msg(s, good ? '완벽한 바통 터치!' : '바통 터치', good ? PAL.green : PAL.white, s.lanes.indexOf(L), 1);
        OG.sfx(s, good ? 'perfect' : 'good');
        if (good) L.v = Math.min(L.v * 1.04, s.segs[0].vref * 1.1);
      } else if (L.pos < legEnd - 12) msg(s, '아직 이르다!', PAL.grey, s.lanes.indexOf(L), 0.5);
    } else if (L.pos > legEnd + L.cpass) { L.leg++; }
  }
  // called each frame by stepLane via relay check for missed zones
  function relayCheck(s, L) {
    if (!s.relay || L.leg >= s.relay - 1) return;
    const legLen = s.dist / s.relay;
    const legEnd = (L.leg + 1) * legLen;
    if (L.pos > legEnd + 8) { L.leg++; L.st = 'pen'; L.penT = 1.2; L.v = 0; msg(s, '바통 실수!', PAL.red, s.lanes.indexOf(L)); OG.sfx(s, 'fail'); }
  }

  function shootStep(s, L, e, inp, dt, R) {
    const rg = s.ranges[L.ri];
    L.clk += dt * s.stopTs;
    L.shootT += dt;
    L.cross += dt * (rg.mode === 'laser' ? 3.6 : 3.1);
    L.cd -= dt;
    const done = () => {
      L.ri++;
      const miss = L.shots - L.hits;
      if (rg.mode === 'biathlon' && miss > 0) {
        L.st = 'pen'; L.penT = miss * 0.7; L.clk += miss * rg.pen;
        if (e.human) msg(s, '벌칙 주로 ' + miss + '바퀴', PAL.red, s.lanes.indexOf(L), 1.5);
      } else { L.st = 'run'; L.v = 0; }
      if (e.human && L.hits === L.shots) { msg(s, '클린!', PAL.green, s.lanes.indexOf(L), 1.2); OG.sfx(s, 'perfect'); }
    };
    const need = rg.mode === 'laser' ? 5 : rg.shots;
    if (L.cd > 0) return;
    let fire = false, hit = false;
    const aim = Math.abs(Math.sin(L.cross));
    if (e.human) {
      if (inp.ap || L.shootT > 4 + L.shots * 1.6) { fire = true; hit = aim < 0.22; }
    } else if (L.shootT > (0.55 + (1 - L.q) * 0.5) * (L.shots + 1) + 0.4) {
      fire = true; hit = R.f() < 0.7 + 0.28 * L.q;
    }
    if (fire) {
      L.cd = 0.28;
      if (rg.mode === 'laser') {
        if (hit) { L.tg.push(1); L.hits++; L.shots++; OG.sfx(s, 'target'); }
        else { OG.sfx(s, 'miss'); }
        if (L.hits >= need || L.shootT > 10) { L.shots = Math.max(L.shots, L.hits); done(); }
      } else {
        L.tg.push(hit ? 1 : 0); L.shots++; if (hit) L.hits++;
        OG.sfx(s, hit ? 'target' : 'shot');
        if (L.shots >= need) done();
      }
    }
  }


  /* ------------------------------ draw ------------------------------- */
  const LOOK = {
    track: { bg: 'stadium', lane: PAL.track, line: PAL.trackline },
    turf: { bg: 'stadium', lane: '#4fa04a', line: '#7ccf6a' },
    velodrome: { bg: 'indoor', lane: '#d9a066', line: '#8a5a2b' },
    pool: { bg: 'pool', lane: PAL.water, line: '#ffffff' },
    water: { bg: 'lake', lane: '#2f7fc4', line: '#ffffff' },
    sea: { bg: 'sea', lane: '#2a7bbd', line: '#ffffff' },
    ice: { bg: 'arena', lane: PAL.ice, line: '#e43b44' },
    ice2: { bg: 'arena', lane: PAL.ice, line: '' },
    snow: { bg: 'mountain', lane: PAL.snow, line: '#c7d6ea' },
    road: { bg: 'city', lane: '#6b7591', line: '#e8e8e8' },
    dirt: { bg: 'dirt', lane: '#a8693f', line: '#d7a46e' }
  };

  function drawBackground(g, s, look) {
    const L = LOOK[look] || LOOK.track;
    const cam = s.cam, t = g.t;
    const bg = L.bg;
    if (bg === 'stadium' || bg === 'indoor' || bg === 'arena' || bg === 'pool') {
      const wall = bg === 'pool' ? '#1d3b63' : bg === 'arena' ? '#20253f' : bg === 'indoor' ? '#2c2235' : '#2a3150';
      g.rect(0, 12, 480, 74, wall);
      if (bg === 'stadium') { g.grad(0, 12, 480, 14, '#3b6fb6', '#8fc6f0', 4); g.rect(0, 22, 480, 2, '#c0cbdc'); }
      g.crowd(0, 24, 480, 42, t, { ox: cam * 0.35, excite: s.started ? 0.25 : 0.05, seed: 3 });
      if (bg === 'pool') {
        g.rect(0, 66, 480, 20, '#d5e2f2');
        for (let x = -M.wrap(cam * 0.9, 16); x < 480; x += 16) g.rect(x, 66, 1, 20, '#b8c8de');
        g.adBoards(0, 66, 480, 8, t, ['AQUATICS', 'DOT GAMES 2026', '水泳 SWIM', 'PIXEL POOL']);
      } else if (bg === 'arena') {
        g.rect(0, 66, 480, 14, '#ffffff');
        g.adBoards(0, 68, 480, 9, t, ['ICE ARENA', 'DOT GAMES 2026', 'MILANO-CORTINA', 'SPEED']);
        g.rect(0, 80, 480, 6, '#9fb4cc');
      } else {
        g.adBoards(0, 66, 480, 10, t);
        g.rect(0, 76, 480, 10, bg === 'indoor' ? '#3a2a24' : '#3e8948');
      }
    } else if (bg === 'lake' || bg === 'sea') {
      g.grad(0, 12, 480, 52, '#5fb6f2', '#bfe6ff', 6);
      g.clouds(t, 18, 3);
      if (bg === 'lake') {
        g.mountains(30, 22, '#7aa0c8', 2, cam * 0.05);
        g.trees(66, '#2f6b3e', 4, cam * 0.25, 9);
        g.rect(0, 66, 480, 6, '#3e8948');
        for (let x = -M.wrap(cam * 0.3, 60); x < 480; x += 60) { g.rect(x + 10, 54, 30, 12, '#c0cbdc'); g.crowd(x + 11, 56, 28, 8, t, { seed: x, density: 0.9 }); }
      } else {
        g.ellipse(80 - (cam * 0.03) % 600, 62, 40, 8, '#6a8f5a');
        g.ellipse(330 - (cam * 0.03) % 600, 63, 60, 7, '#5d8250');
      }
      g.water(0, 72, 480, 14, t, bg === 'lake' ? '#2f7fc4' : '#2a7bbd');
    } else if (bg === 'mountain') {
      g.grad(0, 12, 480, 50, '#4a8fd8', '#bfe0ff', 6);
      g.clouds(t, 16, 2);
      g.mountains(20, 36, '#8aa6c8', 7, cam * 0.04, '#ffffff');
      g.mountains(38, 26, '#6f8fb8', 11, cam * 0.1, '#e8f2ff');
      g.rect(0, 62, 480, 24, PAL.snow2);
      g.trees(72, '#265c42', 9, cam * 0.4, 12);
      for (let x = -M.wrap(cam * 0.6, 40); x < 480; x += 40) {
        g.rect(x, 74, 1, 8, '#5a6988'); g.rect(x + 1, 74, 5, 3, ['#e43b44', '#0099db', '#feae34'][Math.floor(OG.hash(Math.floor((x + cam * 0.6) / 40), 2, 2) * 3)]);
      }
    } else if (bg === 'city') {
      g.grad(0, 12, 480, 50, '#4f9be0', '#cce9ff', 6);
      for (let i = -1; i < 14; i++) {
        const wx = i + Math.floor(cam * 0.2 / 40);
        const x = wx * 40 - cam * 0.2;
        const h = 18 + Math.floor(OG.hash(wx, 5, 1) * 34);
        const c = ['#8b9bb4', '#5a6988', '#c0cbdc', '#a4b3c8'][Math.floor(OG.hash(wx, 6, 1) * 4)];
        g.rect(x, 66 - h, 34, h, c);
        for (let yy = 66 - h + 3; yy < 62; yy += 5) for (let xx = 3; xx < 30; xx += 6) g.rect(x + xx, yy, 2, 2, OG.hash(wx, yy, xx) > 0.4 ? '#fee761' : '#3a4466');
      }
      g.rect(0, 66, 480, 20, '#3e8948');
      g.crowd(0, 66, 480, 10, t, { ox: cam * 0.6, density: 0.6, seed: 9, bg: '#3e8948' });
      g.rect(0, 76, 480, 3, '#c0cbdc');
      for (let x = -M.wrap(cam, 30); x < 480; x += 30) g.rect(x, 76, 15, 3, '#e43b44');
      g.rect(0, 79, 480, 7, '#8b9bb4');
    } else if (bg === 'dirt') {
      g.grad(0, 12, 480, 40, '#5fb6f2', '#c6ecff', 5);
      g.mountains(30, 20, '#7cb36a', 5, cam * 0.08);
      g.rect(0, 50, 480, 36, '#2a3150');
      g.crowd(0, 52, 480, 22, t, { ox: cam * 0.4, excite: 0.2, seed: 5 });
      g.adBoards(0, 74, 480, 8, t, ['BMX', 'DOT GAMES 2026', 'RACE', 'PIXEL']);
      g.rect(0, 82, 480, 4, '#7a4a2b');
    }
  }

  function drawLaneStrip(g, s, look, x0, x1, y, h, idx) {
    const L = LOOK[look] || LOOK.track;
    if (x1 <= x0) return;
    g.rect(x0, y, x1 - x0, h, idx % 2 && look === 'turf' ? '#58aa52' : L.lane);
    const cam = s.cam, t = g.t;
    if (look === 'pool') {
      // lane rope
      for (let x = x0 - M.wrap(x0 + cam, 4); x < x1; x += 4) g.rect(x, y, 2, 2, Math.floor((x + cam) / 4) % 6 < 3 ? '#e43b44' : '#ffffff');
      for (let x = x0 - M.wrap(x0 + cam * 1, 18); x < x1; x += 18) g.rect(x + (Math.floor(t * 8 + y) % 6), y + 4 + (x % 3), 6, 1, 'rgba(255,255,255,0.25)');
      g.rect(x0, y + h - 3, x1 - x0, 1, '#1f6fb3');
    } else if (look === 'water' || look === 'sea') {
      for (let x = x0 - M.wrap(x0 + cam, 22); x < x1; x += 22) g.rect(x + (Math.floor(t * 6 + y) % 8), y + 3 + (OG.hash(Math.floor((x + cam) / 22), y, 1) * (h - 5) | 0), 7, 1, 'rgba(255,255,255,0.22)');
      if (look === 'water') for (let x = x0 - M.wrap(x0 + cam, 30); x < x1; x += 30) g.rect(x, y, 2, 2, Math.floor((x + cam) / 30) % 2 ? '#feae34' : '#ffffff');
    } else if (look === 'snow') {
      g.rect(x0, y + h - 6, x1 - x0, 1, '#c7d6ea'); g.rect(x0, y + h - 3, x1 - x0, 1, '#c7d6ea');
      g.rect(x0, y, x1 - x0, 1, '#e2ebf7');
    } else if (look === 'ice' || look === 'ice2') {
      for (let x = x0 - M.wrap(x0 + cam, 40); x < x1; x += 40) g.rect(x + 7, y + 5, 14, 1, '#cfe6f7');
      if (L.line) g.rect(x0, y, x1 - x0, 1, idx === 0 ? '#e43b44' : '#9ec6e6');
    } else if (look === 'road') {
      g.rect(x0, y, x1 - x0, 1, '#5a6480');
      if (idx % 3 === 1) for (let x = x0 - M.wrap(x0 + cam, 24); x < x1; x += 24) g.rect(x, y + Math.floor(h / 2), 12, 1, '#e8e8e8');
    } else if (look === 'dirt') {
      for (let x = x0 - M.wrap(x0 + cam, 9); x < x1; x += 9) g.px(x, y + 3 + (Math.floor((x + cam) / 9) % 5), '#8e5733');
      g.rect(x0, y, x1 - x0, 1, '#c9905e');
    } else {
      if (L.line) g.rect(x0, y, x1 - x0, 1, L.line);
    }
  }

  function drawFlagPost(g, x, yTop, yBot, label) {
    // finish gantry
    for (let yy = yTop; yy < yBot; yy += 3) { g.rect(x, yy, 3, 3, (yy / 3) % 2 ? '#000' : '#fff'); g.rect(x + 3, yy, 3, 3, (yy / 3) % 2 ? '#fff' : '#000'); }
    if (label) { g.rect(x - 20, yTop - 14, 46, 11, PAL.red); g.text(label, x + 3, yTop - 13, '#fff', { size: 'xs', align: 'center' }); }
  }

  function drawAthlete(g, s, L, i, x, y) {
    const e = s.ents[L.idx];
    const si = segIndex(s, L.pos);
    const sg = s.segs[si];
    const kind = sg.kind;
    const look = OG.lookOf({ country: e.country, look: e.look + L.leg * 53 });
    const dir = dirAt(s, L.pos);
    const k = Math.min(1, L.v / (sg.vref || 1));
    const ph = L.ph;
    const pre = !s.started || L.st === 'go' || L.st === 'block';
    const finSlow = L.fin >= 0 && L.v < sg.vref * 0.3;
    let J;
    if (kind === 'swim') {
      if (L.st === 'block' || (!s.started && s.start === 'dive')) {
        J = g.figure(x - 4, y - 7, OG.Pose.crouch(), Object.assign({ cap: look.shirt, suit: look.pants }, look), { facing: dir });
        g.rect(x - 9, y - 6, 9, 4, '#c0cbdc');
        return J;
      }
      if (L.st === 'dive') {
        const dk = L.diveT / 0.42;
        J = g.figure(x, y - 4 - Math.sin(dk * Math.PI) * 10, OG.Pose.dive(dk), Object.assign({ cap: look.shirt, suit: look.pants }, look), { facing: dir, anchor: 'hip', rot: dir * (Math.PI * 0.35 + dk * Math.PI * 0.25) });
        return J;
      }
      const stroke = sg.stroke;
      const pose = finSlow ? OG.Pose.swimBack(0.2) : stroke === 'fly' ? OG.Pose.swimFly(ph) : stroke === 'back' ? OG.Pose.swimBack(ph) : stroke === 'breast' ? OG.Pose.swimBreast(ph) : OG.Pose.swimFree(ph);
      if (finSlow) { // hanging at the wall, arm up
        J = g.figure(x, y + 2, OG.Pose.armsUp(), Object.assign({ cap: look.shirt, suit: look.pants }, look), { facing: dir });
        g.rect(x - 8, y - 6, 16, 8, 'rgba(42,143,214,0.75)');
        return J;
      }
      J = g.figure(x, y - 4, pose, Object.assign({ cap: look.shirt, suit: look.pants }, look), { facing: dir, anchor: 'hip' });
      g.rect(x - 14, y - 4, 28, 5, 'rgba(42,143,214,0.62)');
      if (L.v > 0.4) for (let j = 0; j < 4; j++) g.px(x - dir * (10 + j * 3) + (OG.hash(i, j, Math.floor(g.t * 12)) * 3 | 0), y - 4 - (OG.hash(j, i, Math.floor(g.t * 12)) * 2 | 0), '#ffffff');
      return J;
    }
    if (kind === 'row' || kind === 'kayak' || kind === 'canoe') {
      const hullC = kind === 'row' ? '#f2f2f2' : look.shirt;
      const len = kind === 'row' ? 18 : 13;
      g.poly([x - len, y - 3, x + len, y - 3, x + len + 3, y - 4, x + len - 2, y - 1, x - len + 2, y - 1], hullC);
      g.rect(x - len + 2, y - 1, len * 2 - 4, 1, OG.shade(hullC, -0.35));
      let pose, rph;
      if (kind === 'row') {
        rph = s.ents[L.idx].human ? Math.min(1, (s.t - L.lastStroke) / (sg.beat * 1.25)) * 0.999 : (s.t / sg.beat * 0.8 + i * 0.13) % 1;
        if (pre) rph = 0;
        pose = OG.Pose.row(rph);
      } else pose = OG.Pose.paddle(ph);
      if (kind === 'canoe') { pose.lL = 0.3; pose.kL = 2.6; pose.lR = 1.4; pose.kR = 1.4; }
      J = g.figure(x, y - 5, pose, Object.assign({ cap: look.shirt }, look), { facing: kind === 'row' ? -1 : 1, anchor: 'hip' });
      if (kind === 'row') {
        const a = M.pingpong(rph * 2, 1);
        const ox = 10 - a * 22;
        g.line(J.hdR[0], J.hdR[1], x + ox, y + 2, '#5a6988', 1);
        g.rect(x + ox - 2, y + 1, 4, 2, '#feae34');
      } else {
        const sw = Math.sin(ph * Math.PI * 2);
        const hx = (J.hdL[0] + J.hdR[0]) / 2, hy = (J.hdL[1] + J.hdR[1]) / 2;
        if (kind === 'kayak') {
          const ax = hx + sw * 3, ay = hy;
          g.line(ax - 9, ay + sw * 6, ax + 9, ay - sw * 6, '#3a4466', 1);
          g.rect(ax - 10, ay + sw * 6 - 1, 3, 3, '#feae34'); g.rect(ax + 8, ay - sw * 6 - 1, 3, 3, '#feae34');
        } else {
          g.line(hx, hy - 6, hx - 6 - sw * 4, y + 1, '#8a5a2b', 1);
          g.rect(hx - 8 - sw * 4, y - 1, 3, 4, '#c28569');
        }
      }
      if (L.v > 0.5) for (let j = 0; j < 5; j++) g.px(x - len - 2 - j * 3, y - 2 + (j % 2), 'rgba(255,255,255,0.7)');
      return J;
    }
    if (kind === 'bike' || kind === 'bmx') {
      const r = kind === 'bmx' ? 3 : 4, wb = kind === 'bmx' ? 6 : 7;
      let by = y;
      if (s.bumps.length) by -= bumpH(s, L.pos);
      const disc = sg.look === 'velodrome';
      const wa = ph * Math.PI * 2;
      [x - wb, x + wb].forEach((wx, wi) => {
        if (disc && wi === 0) g.circle(wx, by - r, r, '#3a4466'); else g.circleO(wx, by - r, r, '#181425');
        g.line(wx, by - r, wx + Math.cos(wa) * r, by - r + Math.sin(wa) * r, '#8b9bb4', 1);
      });
      const seat = [x - 2, by - 10], bar = [x + wb - 1, by - 11];
      g.line(x - wb, by - r, seat[0], seat[1], look.shirt, 1); g.line(seat[0], seat[1], bar[0], bar[1], look.shirt, 1);
      g.line(bar[0], bar[1], x + wb, by - r, '#8b9bb4', 1); g.line(x - wb, by - r, x + 1, by - r, look.shirt, 1); g.line(x + 1, by - r, bar[0] - 1, bar[1] + 1, look.shirt, 1);
      const pose = kind === 'bmx' ? Object.assign(OG.Pose.cycle(ph), { t: 0.75, lL: 0.6, lR: 0.5, kL: 1.0, kR: 1.0 }) : OG.Pose.cycle(pre ? 0 : ph);
      J = g.figure(seat[0], seat[1] - (kind === 'bmx' ? 4 : 1), pose, Object.assign({ cap: look.shirt, sleeves: true, tights: true }, look), { anchor: 'hip' });
      return J;
    }
    if (kind === 'horse') {
      J = drawHorse(g, x, y - L.y, ph, s.coat[i] || 0, L.air, look, pre || finSlow);
      return J;
    }
    if (kind === 'skate') {
      const pose = pre ? Object.assign(OG.Pose.skate(0), { t: 1.0 }) : finSlow ? OG.Pose.armsUp() : OG.Pose.skate(ph);
      J = g.figure(x, y - 1, pose, Object.assign({ suit: look.shirt, cap: look.shirt }, look));
      g.line(J.ftL[0] - 3, J.ftL[1] + 1, J.ftL[0] + 3, J.ftL[1] + 1, '#c0cbdc', 1);
      g.line(J.ftR[0] - 3, J.ftR[1] + 1, J.ftR[0] + 3, J.ftR[1] + 1, '#ffffff', 1);
      if (k > 0.8) for (let j = 0; j < 3; j++) g.px(x - 6 - j * 3, y - 1 - (j % 2), '#ffffff');
      return J;
    }
    if (kind === 'ski' || kind === 'skin') {
      const terr = terrainAt(s, L.pos);
      const tuck = sg.ctrl === 'tuck' || terr === 'down';
      const pose = L.st === 'shoot' ? OG.Pose.aim() : L.st === 'trans' ? OG.Pose.crouch() : tuck ? OG.Pose.tuckSki() : finSlow ? OG.Pose.armsUp() : OG.Pose.ski(ph);
      const yy = y - 1 + (terr === 'up' ? -1 : 0);
      J = g.figure(x, yy, pose, Object.assign({ suit: look.shirt, cap: look.pants }, look));
      g.line(x - 9, y, x + 9, y, look.pants === '#ffffff' ? '#3a4466' : look.pants, 1);
      g.px(x + 9, y - 1, look.pants);
      if (!tuck && L.st !== 'shoot') {
        g.line(J.hdL[0], J.hdL[1], J.hdL[0] - 5, y, '#5a6988', 1);
        g.line(J.hdR[0], J.hdR[1], J.hdR[0] - 5, y, '#8b9bb4', 1);
      }
      if (L.st === 'shoot') g.line(J.hdR[0] - 2, J.hdR[1], J.hdR[0] + 9, J.hdR[1] - 1, '#3a4466', 1);
      return J;
    }
    // run / walk
    let pose;
    if (L.st === 'shoot') pose = OG.Pose.aim();
    else if (L.st === 'pen') pose = OG.Pose.run(ph * 2 % 1, 0.4);
    else if (pre) pose = s.start === 'blocks' ? (s.t > -1.5 && !s.started ? Object.assign(OG.Pose.set(), { t: 1.0, lL: 1.35, kL: 2.0 }) : OG.Pose.set()) : OG.Pose.stand();
    else if (L.air) pose = OG.Pose.hurdle();
    else if (finSlow) pose = L.place === 1 ? OG.Pose.celebrate(g.t) : OG.Pose.walk(ph);
    else if (kind === 'walk') pose = OG.Pose.walk(ph);
    else pose = OG.Pose.run(ph % 1, Math.max(0.35, k));
    if (kind === 'walk' && L.lift > 0.2 && Math.floor(g.t * 10) % 2) g.text('!', x, y - 34, PAL.red, { size: 'b', align: 'center' });
    J = g.figure(x, y - L.y, pose, look);
    if (L.st === 'shoot') g.line(J.hdR[0] - 1, J.hdR[1], J.hdR[0] + 7, J.hdR[1], '#3a4466', 1);
    return J;
  }

  function drawHorse(g, x, y, ph, coatI, air, look, still) {
    const coat = ['#8a5a2b', '#5e3a26', '#c0cbdc', '#2a2a2a'][coatI % 4];
    const dk = OG.shade(coat, -0.3);
    const a = ph * Math.PI * 2;
    const by = y - 12;
    // legs
    const legs = [[-7, 0.0], [-5, 0.15], [6, 0.5], [8, 0.65]];
    legs.forEach(([lx, off], li) => {
      let ang = still ? 0 : Math.sin(a + off * Math.PI * 2) * 0.7;
      if (air) ang = li < 2 ? -0.9 : 1.1;
      const kx = x + lx + Math.sin(ang) * 5, ky = by + 4 + Math.cos(ang) * 5;
      const fa = ang + (li < 2 ? -0.6 : 0.8) * (air ? 1.4 : Math.max(0, Math.sin(a + off * 6.28)));
      g.line(x + lx, by + 2, kx, ky, li % 2 ? coat : dk, 2);
      g.line(kx, ky, kx + Math.sin(fa) * 5, ky + Math.cos(fa) * 5, li % 2 ? coat : dk, 1);
    });
    g.ellipse(x, by, 10, 4, coat);
    // neck & head
    g.poly([x + 6, by - 3, x + 9, by - 2, x + 14, by - 10, x + 11, by - 12], coat);
    g.rect(x + 11, by - 13, 7, 4, coat); g.rect(x + 16, by - 11, 2, 2, dk); g.px(x + 13, by - 12, '#181425');
    g.line(x + 7, by - 4, x + 11, by - 12, '#181425', 1);
    // tail
    g.line(x - 10, by - 1, x - 14, by + 5 + Math.sin(a) * 2, '#181425', 2);
    // saddle cloth
    g.rect(x - 4, by - 4, 7, 4, look.shirt);
    const pose = { t: 0.55, aL: 1.1, aR: 1.2, eL: 0.7, eR: 0.6, lL: 1.0, lR: 0.9, kL: 1.9, kR: 1.9 };
    return g.figure(x - 1, by - 5, pose, Object.assign({ cap: '#181425', sleeves: true, tights: true, pants: '#ffffff' }, look), { anchor: 'hip' });
  }

  function bumpH(s, pos) {
    let h = 0;
    for (const b of s.bumps) { const d = Math.abs(pos - b); if (d < 5) h = Math.max(h, Math.cos(d / 5 * Math.PI / 2) * 5); }
    return h;
  }

  function drawObstacles(g, s, laneIdx, y, lh) {
    const cam = s.cam;
    for (let hi = 0; hi < s.hurdles.length; hi++) {
      const h = s.hurdles[hi];
      const x = X(s, h.pos) - cam;
      if (x < -20 || x > 500) continue;
      const knocked = s.lanes[laneIdx].kn.indexOf(hi) >= 0;
      if (h.kind === 'fence') {
        const c1 = ['#e43b44', '#0099db', '#feae34', '#63c74d'][hi % 4];
        g.rect(x - 1, y - h.h - 2, 2, h.h + 2, '#fff'); g.rect(x + 5, y - h.h - 2, 2, h.h + 2, '#fff');
        if (!knocked) { g.rect(x - 2, y - h.h, 10, 2, c1); g.rect(x - 2, y - h.h + 5, 10, 2, '#fff'); }
        else g.rect(x - 4, y - 2, 12, 2, c1);
        g.rect(x - 1, y - 2, 8, 2, '#3e8948');
      } else if (h.kind === 'barrier') {
        if (h.water) g.rect(x + 2, y - 2, 18, 3, '#2a8fd6');
        g.rect(x - 1, y - h.h, 2, h.h, '#fff'); g.rect(x - 2, y - h.h, 5, 2, '#181425'); g.rect(x - 2, y - h.h + 2, 5, 1, '#fff');
      } else {
        if (knocked) { g.line(x - 3, y - 1, x + 5, y - 3, '#ffffff', 1); g.rect(x - 3, y - 2, 2, 2, '#181425'); }
        else {
          g.rect(x, y - h.h, 1, h.h, '#c0cbdc'); g.rect(x + 3, y - h.h + 2, 1, h.h - 2, '#8b9bb4');
          g.rect(x - 1, y - h.h, 6, 3, '#ffffff'); g.rect(x + 1, y - h.h, 2, 3, '#181425');
        }
      }
    }
    if (s.bumps.length) {
      for (const b of s.bumps) {
        const x = X(s, b) - cam;
        if (x < -40 || x > 520) continue;
        const w = 5 * s.segs[0].ppm;
        for (let dx = -w; dx <= w; dx++) {
          const hh = Math.cos(Math.abs(dx) / w * Math.PI / 2) * 5;
          g.rect(x + dx, y - hh, 1, hh + 1, '#8e5733');
        }
      }
    }
    // relay zones
    if (s.relay) {
      const legLen = s.dist / s.relay;
      for (let k = 1; k < s.relay; k++) {
        const x0 = X(s, k * legLen - 12) - cam, x1 = X(s, k * legLen + 8) - cam;
        if (x1 < 0 || x0 > 480) continue;
        g.rect(x0, y - lh + 3, 1, lh - 3, PAL.yellow); g.rect(x1, y - lh + 3, 1, lh - 3, PAL.yellow);
        const L = s.lanes[laneIdx];
        if (L.leg === k - 1 && L.fin < 0 && !L.dnf) {
          const e = s.ents[L.idx];
          const look = OG.lookOf({ country: e.country, look: e.look + k * 53 });
          const near = (k * legLen - L.pos) < 25;
          g.figure(x0 + 4, y, near ? OG.Pose.run(g.t * 1.5 % 1, 0.25) : OG.Pose.stand(), look);
        }
      }
    }
    // shooting range
    s.ranges.forEach(r => {
      const x = X(s, r.at) - cam;
      if (x < -40 || x > 520) return;
      g.rect(x - 2, y - lh + 3, 1, lh - 3, '#ffffff');
      g.rect(x + 18, y - lh + 4, 10, 6, '#181425');
      const L = s.lanes[laneIdx];
      for (let k = 0; k < 5; k++) g.px(x + 19 + k * 2, y - lh + 6, L.tg[k] ? '#ffffff' : '#5a6988');
    });
  }

  function draw(g, s) {
    const ev = OG.EVENT_MAP[s.evId];
    const cam = s.cam;
    g.clear('#181425');
    // focus look for background
    let fpos = 0;
    s.lanes.forEach(L => { if (s.ents[L.idx].human && !L.dnf) fpos = Math.max(fpos, L.pos); });
    const bgLook = s.segs[segIndex(s, fpos)].look;
    drawBackground(g, s, bgLook);
    const geo = laneGeom(s);
    // lanes
    for (let i = 0; i < s.lanes.length; i++) {
      const y0 = geo.top + i * geo.lh;
      if (s.pool) drawLaneStrip(g, s, 'pool', 0, 480, y0, geo.lh, i);
      else {
        s.segs.forEach(sg => {
          const x0 = Math.max(0, sg.px0 - cam), x1 = Math.min(480, sg.px0 + sg.len * sg.ppm - cam + (sg === s.segs[s.segs.length - 1] ? 2000 : 0));
          drawLaneStrip(g, s, sg.look, Math.round(x0), Math.round(x1), y0, geo.lh, i);
        });
        if (cam < 0) drawLaneStrip(g, s, s.segs[0].look, 0, Math.round(-cam), y0, geo.lh, i);
      }
      // terrain tint
      if (s.terrain) s.terrain.forEach(tr => {
        if (tr.type === 'flat') return;
        const x0 = X(s, tr.a) - cam, x1 = X(s, tr.b) - cam;
        if (x1 < 0 || x0 > 480) return;
        g.alpha(0.12); g.rect(Math.max(0, x0), y0, Math.min(480, x1) - Math.max(0, x0), geo.lh, tr.type === 'up' ? '#a22633' : '#124e89'); g.alpha(1);
      });
      if (s.corners) {
        const lap = s.corners.lap;
        for (let k = 0; k * lap < s.dist + lap; k++) {
          [[0.25, 0.5], [0.75, 1]].forEach(([a, b]) => {
            const x0 = X(s, k * lap + a * lap) - cam, x1 = X(s, k * lap + b * lap) - cam;
            if (x1 < 0 || x0 > 480) return;
            g.alpha(0.18); g.rect(Math.max(0, x0), y0, Math.min(480, x1) - Math.max(0, x0), geo.lh, '#0099db'); g.alpha(1);
            if (i === 0) for (let x = x0; x < x1; x += 14) g.rect(x, y0 + 1, 3, 2, '#181425');
          });
        }
      }
    }
    // markers
    const sgF = s.segs[segIndex(s, fpos)];
    const stepM = niceStep(110 / sgF.ppm);
    if (!s.pool) {
      const m0 = Math.floor(Math.max(0, (cam) / sgF.ppm) / stepM) * stepM;
      for (let k = 0; k < 8; k++) {
        const m = m0 + k * stepM;
        if (m <= 0 || m >= s.dist) continue;
        const x = X(s, m) - cam;
        if (x < -20 || x > 500) continue;
        g.rect(x, geo.top - 4, 1, 4, '#ffffff');
        g.text(fmtDist(m), x + 2, geo.top - 10, '#ffffff', { size: 'xs', shadow: true });
      }
    } else {
      const ppm = s.segs[0].ppm;
      [5, 15, 25, 35, 45].forEach(m => { const x = m * ppm - cam; if (x > -10 && x < 490) g.text(m === 25 ? '25m' : '', x, geo.top - 10, '#fff', { size: 'xs', align: 'center' }); });
      // walls
      [0, s.pool].forEach(m => { const x = m * ppm - cam; if (x > -10 && x < 490) g.rect(x - 2, geo.top - 2, 4, geo.lh * s.lanes.length + 2, '#e8eef5'); });
      // backstroke flags
      [5, s.pool - 5].forEach(m => { const x = m * ppm - cam; if (x > -30 && x < 510) for (let k = 0; k < 6; k++) g.poly([x - 4 + k * 0, geo.top - 6, x + 4, geo.top - 6, x, geo.top - 2], ['#e43b44', '#ffffff', '#0099db'][k % 3]); });
    }
    // start & finish lines
    if (!s.pool) {
      const xs = X(s, 0) - cam;
      if (xs > -10 && xs < 490) g.rect(xs, geo.top, 2, geo.lh * s.lanes.length, '#ffffff');
      const xf = X(s, s.dist) - cam;
      if (xf > -10 && xf < 500) drawFlagPost(g, xf, geo.top, geo.top + geo.lh * s.lanes.length, 'FINISH');
    }
    // per lane obstacles + athletes (top to bottom)
    for (let i = 0; i < s.lanes.length; i++) {
      const L = s.lanes[i];
      const y = laneY(s, i);
      drawObstacles(g, s, i, y, geo.lh);
      if (L.dnf && L.st === 'out' && !s.ents[L.idx].human) continue;
      const x = X(s, L.pos) - cam;
      if (x < -30) { // behind the screen
        if (s.ents[L.idx].human) { g.poly([2, y - 8, 8, y - 12, 8, y - 4], OG.entColor(s.ents[L.idx])); g.text(s.ents[L.idx].tag, 10, y - 14, OG.entColor(s.ents[L.idx]), { size: 'xs' }); }
        continue;
      }
      if (x > 510) { if (s.ents[L.idx].human) g.poly([478, y - 8, 472, y - 12, 472, y - 4], OG.entColor(s.ents[L.idx])); continue; }
      if (s.segs[segIndex(s, L.pos)].kind !== 'swim') g.shadow(x, y, 6);
      const J = drawAthlete(g, s, L, i, x, y);
      const e = s.ents[L.idx];
      if (e.human && J) {
        const hy = Math.min(J.head[1], J.hdL[1], J.hdR[1]) - 10;
        g.text(e.tag, x, hy, OG.PCOLORS[e.pid], { size: 'xs', align: 'center', outline: '#181425' });
      }
      if (L.dnf) g.text(L.dnf, x, y - 30, PAL.red, { size: 'xs', align: 'center', outline: '#000' });
    }
    // lane labels
    for (let i = 0; i < s.lanes.length; i++) {
      const L = s.lanes[i], e = s.ents[L.idx];
      const y = geo.top + i * geo.lh;
      g.alpha(0.75); g.rect(0, y + 1, 36, Math.min(geo.lh - 2, 11), '#181425'); g.alpha(1);
      g.text(String(i + 1), 2, y + 2, '#c0cbdc', { size: 'xs' });
      g.flag(e.country, 8, y + 2, 12, 8);
      g.text(e.human ? e.tag : e.country, 22, y + 2, OG.entColor(e), { size: 'xs' });
    }
    // floating messages
    s.msgs.forEach(m => {
      const a = 1 - Math.max(0, (m.age - m.life + 0.3) / 0.3);
      g.alpha(M.clamp(a, 0, 1));
      if (m.lane >= 0 && s.lanes[m.lane]) {
        const L = s.lanes[m.lane];
        const x = M.clamp(X(s, L.pos) - cam, 40, 440), y = laneY(s, m.lane) - 40 - m.age * 8;
        g.rich(m.tx, x, y, m.c, { align: 'center', size: 's', shadow: true });
      } else g.text(m.tx.replace(/\{[A-Z]\}/g, ''), 240, 46 - m.age * 4, m.c, { size: 'l', align: 'center', outline: '#181425' });
      g.alpha(1);
    });
    drawHUD(g, s, ev);
  }

  function niceStep(v) {
    const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
    for (const st of steps) if (st >= v) return st;
    return 10000;
  }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m % 1000 ? 1 : 0) + 'km' : Math.round(m) + 'm'; }

  function drawHUD(g, s, ev) {
    // top bar
    g.rect(0, 0, 480, 12, '#181425');
    g.text(ev ? ev.name : '', 4, 1, '#ffffff', { size: 's' });
    const humans = s.lanes.filter(L => s.ents[L.idx].human);
    const leader = s.lanes.reduce((a, L) => (L.fin < 0 && !L.dnf && (!a || L.pos > a.pos)) ? L : a, null);
    const clockL = humans.find(L => L.fin < 0 && !L.dnf) || leader || s.lanes[0];
    const clock = s.started ? (clockL ? (clockL.fin >= 0 ? clockL.fin : clockL.clk) : 0) : 0;
    g.text(OG.fmt.time(clock, s.dist >= 5000 ? 0 : 2), 476, 1, PAL.yellow, { size: 's', align: 'right' });
    const lbl = s.label || fmtDist(s.dist);
    g.text(lbl, 300, 1, '#c0cbdc', { size: 's', align: 'center' });
    // minimap
    g.rect(40, 14, 400, 6, 'rgba(24,20,37,0.7)');
    g.rect(44, 17, 392, 1, '#5a6988');
    g.rect(436, 14, 2, 6, '#fff');
    s.ranges.forEach(r => g.rect(44 + 392 * r.at / s.dist, 15, 1, 4, PAL.yellow));
    s.lanes.forEach(L => {
      const e = s.ents[L.idx];
      const x = 44 + 392 * M.clamp(L.pos / s.dist, 0, 1);
      if (e.human) g.rect(x - 1, 14, 3, 6, OG.PCOLORS[e.pid]); else g.rect(x, 16, 2, 3, '#c0cbdc');
    });
    // pre-start text
    if (!s.started) {
      if (s.start === 'blocks') {
        g.banner(s.t < -1.5 ? '제자리에…' : '차렷!', 110, s.t < -1.5 ? '#ffffff' : PAL.yellow, { size: 'xl' });
        if (s.t >= -1.5) g.text('총소리 전에 누르면 부정출발!', 240, 140, '#ffffff', { size: 's', align: 'center', outline: '#181425' });
      }
      else if (s.start === 'dive') {
        g.banner(s.t < -1.5 ? 'Take your marks' : '준비…', 110, '#ffffff', { size: 'xl' });
        if (s.t >= -1.5) g.text('출발 신호 후 {A} 다이빙!'.replace('{A}', 'ACTION'), 240, 140, '#ffffff', { size: 's', align: 'center', outline: '#181425' });
      }
      else g.countdown(-s.t);
    } else if (s.rt < 0.7) g.banner(s.start === 'blocks' ? '탕!' : 'GO!', 110, PAL.green, { size: 'xxl' });
    // bottom panels
    const n = Math.max(1, humans.length);
    const pw = Math.floor(480 / n);
    g.rect(0, 232, 480, 38, '#181425');
    humans.forEach((L, k) => drawPanel(g, s, L, k * pw, 233, pw - 2, 36));
    if (!humans.length) g.text('관전 모드', 240, 245, '#8b9bb4', { align: 'center' });
  }

  function drawPanel(g, s, L, x, y, w, h) {
    const e = s.ents[L.idx];
    const col = OG.PCOLORS[e.pid];
    const sg = s.segs[segIndex(s, L.pos)];
    g.rect(x, y, w, h, '#262b44');
    g.rect(x, y, 2, h, col);
    g.text(e.tag, x + 4, y + 1, col, { size: 's' });
    if (w >= 70) g.flag(e.country, x + 22, y + 2, 12, 8);
    // status / time
    let st = '';
    if (L.dnf) st = L.dnf;
    else if (L.fin >= 0) st = (L.place ? L.place + '위 ' : '') + OG.fmt.time(L.fin, 2);
    else if (s.started) st = fmtDist(Math.max(0, s.dist - L.pos)) + '';
    g.text(st, x + w - 3, y + 1, L.fin >= 0 ? PAL.yellow : '#c0cbdc', { size: 's', align: 'right', maxW: w - 40 });
    // speed bar
    const bw = w - 8;
    g.bar(x + 4, y + 12, bw, 5, L.v / (sg.vref * 1.12), L.v > sg.vref ? PAL.orange : PAL.green);
    let by = y + 18;
    if (s.stamina) { g.bar(x + 4, by, bw, 3, L.stam, L.stam < 0.3 ? PAL.red : PAL.cyan); by += 4; }
    if (s.breath && sg.kind === 'swim') { g.bar(x + 4, by, bw, 3, L.oxy, L.oxy < 0.3 ? PAL.red : '#9fd8ff'); by += 4; }
    if (s.walkLimit) {
      const fr = L.rate / (s.walkLimit * 1.4);
      g.bar(x + 4, by, bw, 3, fr, L.rate > s.walkLimit ? PAL.red : PAL.yellow);
      g.rect(x + 4 + bw / 1.4, by - 1, 1, 5, '#fff');
      for (let k = 0; k < L.warn; k++) g.rect(x + w - 8 - k * 5, y + 12, 3, 5, PAL.yellow);
      by += 4;
    }
    // shooting
    if (L.st === 'shoot') {
      const rg = s.ranges[Math.min(L.ri, s.ranges.length - 1)];
      const cx = x + w / 2, cy = y + 26;
      g.rect(x + 3, y + 18, w - 6, 17, '#181425');
      for (let k = 0; k < 5; k++) {
        const tx = cx - 24 + k * 12;
        g.circle(tx, cy, 4, L.tg[k] ? '#ffffff' : '#3a4466');
        g.circleO(tx, cy, 4, '#8b9bb4');
      }
      const ax = cx + Math.sin(L.cross) * 26;
      g.rect(ax - 6, cy, 13, 1, PAL.red); g.rect(ax, cy - 6, 1, 13, PAL.red);
      g.rect(cx - 6, y + 19, 13, 1, PAL.green);
      if (rg) g.text(rg.mode === 'laser' ? '명중 ' + L.hits + '/5' : L.shots + '/5', x + w - 4, y + 19, '#fff', { size: 'xs', align: 'right' });
      return;
    }
    // hint
    let hint = '';
    if (!s.started) hint = s.start === 'dive' ? '신호 후 {A} 다이빙' : '신호 후 출발!';
    else if (L.dnf || L.fin >= 0) hint = '';
    else if (L.st === 'block') hint = '{A} 다이빙!';
    else if (L.st === 'trans') hint = '{A} 연타! ' + L.tn + '/' + s.transN;
    else if (L.st === 'pen') hint = '벌칙 주로…';
    else if (sg.ctrl === 'tuck') hint = '{D} 꾹: 활강 자세';
    else if (s.terrain && terrainAt(s, L.pos) === 'down') hint = '{D} 크라우치';
    else if (s.relay && L.leg < s.relay - 1 && Math.abs((L.leg + 1) * s.dist / s.relay - L.pos) < 14) hint = '{A} 바통!';
    else if (s.pool && (Math.floor(L.pos / s.pool) + 1) * s.pool < s.dist && (Math.floor(L.pos / s.pool) + 1) * s.pool - L.pos < 4) hint = '{A} 턴!';
    else if (s.breath && L.oxy < 0.35) hint = '{U} 호흡!';
    else if (s.hurdles.length && L.nh < s.hurdles.length && (s.hurdles[L.nh].pos - L.pos) * sg.ppm < 70) hint = '{A} 점프!';
    else if (s.corners && inCorner(s, L.pos)) hint = '{A} 꾹: 코너!';
    else if (s.bumps.length && L.ri2 < s.bumps.length && (s.bumps[L.ri2] - L.pos) < 4) hint = '{A} 펌핑!';
    else if (sg.ctrl === 'both') hint = '{L}+{R} 동시에!';
    else if (sg.ctrl === 'rhythm') hint = '{L}{R} 리듬 있게';
    else hint = '{L}{R} 연타!';
    if (hint && w >= 70) g.rich(hint, x + 4, Math.max(by + 1, y + 24), '#ffffff', { size: 'xs' });
    // rhythm beat indicator
    if ((sg.ctrl === 'both' || sg.ctrl === 'rhythm') && s.started && !L.dnf && L.fin < 0 && w >= 90) {
      const last = sg.ctrl === 'both' ? L.lastStroke : L.lastTapT;
      const fr = M.clamp((s.t - last) / sg.beat, 0, 1.6);
      const bx = x + w - 30, byy = y + 25;
      g.rect(bx, byy, 26, 4, '#3a4466');
      g.rect(bx + 16, byy - 1, 2, 6, PAL.green);
      g.rect(bx + Math.min(25, fr * 17), byy, 2, 4, fr >= 0.92 && fr <= 1.25 ? PAL.green : PAL.yellow);
    }
  }

  OG.defineEngine('race', { type: 'solo', fieldSize: 8, init, update, draw });

  /* ------------------------------ events ----------------------------- */
  const SA = ['summer', 'asian'], WI = ['winter'];
  const RUN = '{L}{R} 번갈아 빠르게 연타: 달리기';
  OG.defineEvents([
    // ---- Athletics ----
    { id: 'm100', name: '100m 달리기', en: '100m', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 100, kind: 'run', look: 'track', vref: 11.4, ts: 1, start: 'blocks' },
      help: [RUN, '"차렷" 뒤 총소리 전에 누르면 부정출발!'] },
    { id: 'm400', name: '400m 달리기', en: '400m', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 400, kind: 'run', look: 'track', vref: 10.4, ts: 1.9, start: 'blocks', stamina: 0.3 },
      help: [RUN, '파란 체력 바를 아끼다가 마지막 직선에서 전력 질주!'] },
    { id: 'hurdles110', name: '110m 허들', en: '110m Hurdles', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 110, kind: 'run', look: 'track', vref: 9.6, ts: 1, start: 'blocks', hurdles: { first: 13.72, gap: 9.14, n: 10, h: 10 } },
      help: [RUN, '{A} 또는 {U}: 허들 넘기 (타이밍!)'] },
    { id: 'steeple', name: '3000m 장애물', en: '3000m Steeplechase', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 3000, kind: 'run', look: 'track', vref: 7.6, ts: 27, start: 'stand', stamina: 0.2, label: '3000m SC', hurdles: { first: 150, gap: 240, n: 12, h: 9, kind: 'barrier', water: 3 } },
      help: [RUN, '{A}: 장애물/물웅덩이 넘기', '체력 관리!'] },
    { id: 'relay4x100', name: '4x100m 계주', en: '4x100m Relay', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 400, kind: 'run', look: 'track', vref: 11.5, ts: 1.6, start: 'blocks', relay: 4, label: '4x100m' },
      help: [RUN, '노란 구역 안에서 {A}: 바통 터치', '구역을 지나치면 바통 실수!'] },
    { id: 'racewalk', name: '20km 경보', en: '20km Race Walk', sport: 'athletics', icon: '🚶', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 20000, kind: 'walk', look: 'road', vref: 4.9, ts: 250, refRate: 7, walkLimit: 7.6, start: 'stand' },
      help: ['{L}{R} 번갈아: 걷기', '너무 빨리 누르면 발이 떠서 경고! 3번이면 실격'] },
    { id: 'marathon', name: '마라톤', en: 'Marathon', sport: 'athletics', icon: '🏃', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 42195, kind: 'run', look: 'road', vref: 7.0, ts: 420, start: 'stand', stamina: 0.32, label: '42.195km' },
      help: [RUN, '체력(파란 바)이 바닥나면 속도가 크게 떨어진다', '페이스 조절이 핵심!'] },
    // ---- Swimming ----
    { id: 'swim_free', name: '자유형 100m', en: '100m Freestyle', sport: 'swimming', icon: '🏊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 100, kind: 'swim', stroke: 'free', look: 'pool', vref: 2.34, ts: 2.3, pool: 50, breath: true, start: 'dive' },
      help: ['신호 후 {A}: 다이빙  /  {L}{R} 연타: 스트로크', '{U}: 숨쉬기 (산소 바)  /  벽 앞에서 {A}: 턴'] },
    { id: 'swim_fly', name: '접영 100m', en: '100m Butterfly', sport: 'swimming', icon: '🏊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 100, kind: 'swim', stroke: 'fly', look: 'pool', ctrl: 'both', beat: 0.55, vref: 2.17, ts: 2.4, pool: 50, start: 'dive' },
      help: ['{L}+{R} 동시에 누르기: 접영 스트로크', '박자 표시가 초록일 때 눌러야 빠르다', '벽 앞에서 {A}: 턴'] },
    { id: 'swim_back', name: '배영 100m', en: '100m Backstroke', sport: 'swimming', icon: '🏊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 100, kind: 'swim', stroke: 'back', look: 'pool', vref: 2.09, ts: 2.45, pool: 50, start: 'dive' },
      help: ['{L}{R} 번갈아 연타: 배영', '벽 앞에서 {A}: 턴'] },
    { id: 'swim_breast', name: '평영 100m', en: '100m Breaststroke', sport: 'swimming', icon: '🏊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 100, kind: 'swim', stroke: 'breast', look: 'pool', ctrl: 'both', beat: 0.65, vref: 1.9, ts: 2.7, pool: 50, start: 'dive' },
      help: ['{L}+{R} 동시에: 평영 킥 & 풀', '너무 빨리 누르면 손해! 박자 맞추기', '벽 앞에서 {A}: 턴'] },
    { id: 'openwater', name: '마라톤 수영 10km', en: 'Open Water 10km', sport: 'swimming', icon: '🌊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 10000, kind: 'swim', stroke: 'free', look: 'sea', vref: 1.83, ts: 320, stamina: 0.25, breath: true, start: 'stand', label: '10km' },
      help: ['{L}{R} 연타: 수영  /  {U}: 숨쉬기', '체력 관리하며 바다를 건너라!'] },
    // ---- Rowing / Canoe ----
    { id: 'rowing', name: '조정 싱글스컬 2000m', en: 'Rowing Single Sculls', sport: 'rowing', icon: '🚣', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 2000, kind: 'row', look: 'water', ctrl: 'both', beat: 0.72, vref: 5.65, ts: 18, start: 'stand' },
      help: ['{L}+{R} 동시에: 노 젓기', '박자(초록)에 맞춰 일정한 리듬으로!'] },
    { id: 'kayak', name: '카약 K-1 500m', en: 'Kayak K-1 500m', sport: 'canoe', icon: '🛶', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 500, kind: 'kayak', look: 'water', vref: 5.3, ts: 5, start: 'stand' },
      help: ['{L}{R} 번갈아 연타: 좌우 패들링'] },
    { id: 'canoe', name: '카누 C-1 1000m', en: 'Canoe C-1 1000m', sport: 'canoe', icon: '🛶', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 1000, kind: 'canoe', look: 'water', ctrl: 'rhythm', beat: 0.33, vref: 4.85, ts: 11, start: 'stand' },
      help: ['{L}{R} 번갈아 리듬 있게: 외날 패들', '너무 빠르면 헛스트로크!'] },
    // ---- Cycling ----
    { id: 'track_tt', name: '트랙 사이클 1km 독주', en: 'Track Cycling 1km TT', sport: 'cycling', icon: '🚴', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 1000, kind: 'bike', look: 'velodrome', vref: 18.2, ts: 2.9, start: 'stand' },
      help: ['{L}{R} 번갈아 연타: 페달링', '가속은 느리지만 최고 속도가 빠르다'] },
    { id: 'road_itt', name: '도로 사이클 개인독주', en: 'Road Cycling ITT', sport: 'cycling', icon: '🚴', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 32400, kind: 'bike', look: 'road', vref: 18.2, ts: 110, stamina: 0.22, start: 'stand', terrain: true, label: '32.4km' },
      help: ['{L}{R} 연타: 페달링  /  내리막 {D}: 에어로 자세', '체력 관리!'] },
    { id: 'bmx_race', name: 'BMX 레이싱', en: 'BMX Racing', sport: 'bmx', icon: '🚲', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 400, kind: 'bmx', look: 'dirt', vref: 12.5, ts: 1.5, start: 'stand', bumps: { first: 30, gap: 24, n: 14 } },
      help: ['{L}{R} 연타: 페달링', '언덕 꼭대기에서 {A}: 펌핑으로 가속'] },
    // ---- Equestrian / multi-sport ----
    { id: 'showjump', name: '승마 장애물 비월', en: 'Show Jumping', sport: 'equestrian', icon: '🏇', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 420, kind: 'horse', look: 'turf', vref: 6.5, ts: 2.6, start: 'stand', fault: true, hurdles: { first: 40, gap: 36, n: 10, h: 15, kind: 'fence' } },
      help: ['{L}{R} 연타: 갤럽', '{A}: 장애물 점프 — 떨어뜨리면 벌점 4'] },
    { id: 'laser_run', name: '근대5종 레이저런', en: 'Modern Pentathlon Laser Run', sport: 'modern_pentathlon', icon: '🎯', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { dist: 1800, kind: 'run', look: 'turf', vref: 5.6, ts: 11, start: 'stand', stamina: 0.18, stopTs: 3, ranges: [{ at: 0, mode: 'laser' }, { at: 600, mode: 'laser' }, { at: 1200, mode: 'laser' }], label: 'Laser Run' },
      help: ['사격장: 조준점이 초록 가운데 올 때 {A} — 5발 명중', '{L}{R} 연타: 600m 달리기'] },
    { id: 'triathlon', name: '트라이애슬론', en: 'Triathlon', sport: 'triathlon', icon: '🏊', tags: SA, engine: 'race', lowerBetter: true,
      cfg: { segs: [{ len: 1500, kind: 'swim', look: 'sea', vref: 1.7, ts: 135 }, { len: 40000, kind: 'bike', look: 'road', vref: 13.2, ts: 470 }, { len: 10000, kind: 'run', look: 'road', vref: 6.0, ts: 260 }],
        trans: true, transN: 3, start: 'stand', stamina: 0.15, label: '1.5/40/10km' },
      help: ['수영 → 사이클 → 달리기: {L}{R} 연타', '바꿈 구역에서 {A} 3번 연타!'] },
    // ---- Winter ----
    { id: 'ss500', name: '스피드스케이팅 500m', en: 'Speed Skating 500m', sport: 'speed_skating', icon: '⛸️', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { dist: 500, kind: 'skate', look: 'ice', ctrl: 'rhythm', beat: 0.28, vref: 16.25, ts: 1.8, start: 'blocks' },
      help: ['{L}{R} 번갈아 리듬 있게: 스트로크', '박자가 초록일 때 눌러야 최고 속도!'] },
    { id: 'ss1500', name: '스피드스케이팅 1500m', en: 'Speed Skating 1500m', sport: 'speed_skating', icon: '⛸️', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { dist: 1500, kind: 'skate', look: 'ice', ctrl: 'rhythm', beat: 0.3, vref: 17.6, ts: 5.2, start: 'blocks', stamina: 0.28 },
      help: ['{L}{R} 리듬 있게: 스트로크', '체력을 아꼈다가 마지막 바퀴 스퍼트!'] },
    { id: 'shorttrack', name: '쇼트트랙 1000m', en: 'Short Track 1000m', sport: 'short_track', icon: '⛸️', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { dist: 1000, kind: 'skate', look: 'ice2', ctrl: 'rhythm', beat: 0.28, vref: 13.3, ts: 3.8, start: 'stand', corners: 111.12 },
      help: ['{L}{R} 리듬 있게: 스트로크', '파란 코너 구간에서는 {A}를 꾹 눌러 기울이기!'] },
    { id: 'xc_ski', name: '크로스컨트리 10km', en: 'Cross-Country 10km', sport: 'cross_country', icon: '🎿', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { dist: 10000, kind: 'ski', look: 'snow', vref: 9.0, ts: 75, start: 'stand', terrain: true, stamina: 0.15, label: '10km' },
      help: ['{L}{R} 연타: 스키 & 폴', '빨간 오르막은 더 빠르게, 파란 내리막은 {D} 크라우치'] },
    { id: 'biathlon', name: '바이애슬론 스프린트', en: 'Biathlon Sprint', sport: 'biathlon', icon: '🎯', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { dist: 10000, kind: 'ski', look: 'snow', vref: 9.0, ts: 80, start: 'stand', terrain: true, stopTs: 4, ranges: [{ at: 3300, mode: 'biathlon', pen: 23 }, { at: 6600, mode: 'biathlon', pen: 23 }], label: '10km' },
      help: ['{L}{R} 연타: 스키', '사격: 조준점이 초록 가운데 올 때 {A} (빗나가면 벌칙 주로)'] },
    { id: 'skimo', name: '산악스키 스프린트', en: 'Ski Mountaineering Sprint', sport: 'ski_mountaineering', icon: '🏔️', tags: WI, engine: 'race', lowerBetter: true,
      cfg: { segs: [{ len: 320, kind: 'skin', look: 'snow', vref: 3.0, ts: 8, uphill: true }, { len: 300, kind: 'ski', look: 'snow', ctrl: 'tuck', vref: 15, ts: 2 }],
        trans: true, transN: 4, start: 'stand', label: 'Sprint' },
      help: ['오르막: {L}{R} 연타로 스킨 등반', '전환 구역: {A} 4번 연타 (스킨 떼기)', '내리막: {D} 꾹 눌러 활강'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
