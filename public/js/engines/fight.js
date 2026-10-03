/* =========================================================================
 * engine: fight — side-view 1-vs-1 combat sports (type 'duel')
 * One engine, eleven rule sets (state.kind):
 *   judo · wrestle · box · tkd · fence · karate · sanda · kurash · bjj · mma · arcade
 * Controls (relative to facing): ◀▶ move · ▲ high/jump/duck · ▼ block/defend ·
 * ACTION attack (tap = quick, hold = strong, direction + ACTION = other technique).
 * Grapple / ground / count phases are "mash ◀▶" tug-of-war mini-games with
 * ACTION as the commit button. CPU fighters produce the same virtual inputs as
 * humans (see ai()), so every rule applies to both.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const PI = Math.PI;
  const CH = 0.2;                       // ACTION held this long → strong technique
  const CAP = 72;                       // hard cap (s) on a bout after GO, everything included
  const RED = '#d8343c', BLUE = '#2457c5', WHITE = '#f4f2ec', INK = '#141020';

  /* ------------------------------------------------------------------ *
   * Arena / rule constants per kind
   *   L,R  inner boundary (walk limit) · FY feet line · gap start distance
   *   out  'push' (wrestling 1pt) | 'gam' (taekwondo penalty) | 'ring' (sanda)
   * ------------------------------------------------------------------ */
  const KD = {
    judo: { L: 70, R: 410, FY: 214, gap: 92, spd: 58, time: 50, gold: 15, grip: 1, lim: 6, drift: 14 },
    wrestle: { L: 96, R: 384, FY: 214, gap: 84, spd: 58, time: 55, grip: 1, lim: 5, out: 'push', drift: 42, gapWin: 10 },
    box: { L: 78, R: 402, FY: 216, gap: 112, spd: 72, time: 16, rounds: 3, hp: 1 },
    tkd: { L: 86, R: 394, FY: 214, gap: 112, spd: 74, time: 50, gold: 15, out: 'gam', gapWin: 12 },
    fence: { L: 56, R: 424, FY: 214, gap: 112, spd: 82, time: 55, gold: 15, target: 8 },
    karate: { L: 84, R: 396, FY: 214, gap: 106, spd: 74, time: 55, gapWin: 8 },
    sanda: { L: 110, R: 370, FY: 206, gap: 100, spd: 70, time: 55, out: 'ring', hp: 1, grip: 1, lim: 2.5, drift: 40 },
    kurash: { L: 74, R: 406, FY: 214, gap: 84, spd: 58, time: 50, gold: 15, grip: 1, lim: 6, drift: 14 },
    bjj: { L: 74, R: 406, FY: 214, gap: 84, spd: 58, time: 55, grip: 1, lim: 5, drift: 10 },
    mma: { L: 86, R: 394, FY: 214, gap: 112, spd: 70, time: 25, rounds: 2, hp: 1 },
    arcade: { L: 96, R: 384, FY: 182, gap: 140, spd: 84, time: 18, rounds: 3, hp: 1, jump: 1 }
  };

  /* ------------------------------------------------------------------ *
   * Techniques. key = T|H (tap/hold) + direction (u, d, f = toward).
   *  st/ac/rc startup/active/recovery (s) · rg reach (px) · h hi|mid|lo|air
   *  pts score · dmg damage · push knockback · hs hitstun · p pose · tr travel speed
   * ------------------------------------------------------------------ */
  const REACH = { n: '잡기', st: .1, ac: .1, rc: .26, rg: 44, p: 'reach', grip: 1, sta: 2 };
  const SHOOT = { n: '태클', st: .1, ac: .22, rc: .45, rg: 30, tr: 250, p: 'shoot', shoot: 1, sta: 6 };
  const MV = {
    box: {
      T: { n: '잽', st: .07, ac: .06, rc: .13, rg: 46, h: 'hi', dmg: 4, push: 30, hs: .22, p: 'jab', fx: 'punch', sta: 3 },
      H: { n: '스트레이트', st: .15, ac: .07, rc: .22, rg: 50, h: 'hi', dmg: 10, push: 80, hs: .36, p: 'cross', fx: 'hit', sta: 8, big: 1 },
      Tf: { n: '훅', st: .12, ac: .07, rc: .2, rg: 40, h: 'hi', dmg: 8, push: 50, hs: .32, p: 'hook', fx: 'hit', sta: 7 },
      Tu: { n: '어퍼컷', st: .13, ac: .07, rc: .24, rg: 36, h: 'hi', dmg: 11, push: 40, hs: .4, p: 'upper', fx: 'hit', sta: 9, gb: 1 },
      Td: { n: '바디블로', st: .1, ac: .07, rc: .18, rg: 42, h: 'mid', dmg: 5, sdmg: 14, push: 24, hs: .28, p: 'body', fx: 'punch', sta: 5 }
    },
    tkd: {
      T: { mn: 30, n: '몸통 돌려차기', st: .12, ac: .08, rc: .22, rg: 56, h: 'mid', pts: 2, push: 60, hs: .3, p: 'kick', fx: 'kick', sta: 5 },
      Tf: { n: '커트 발차기', st: .08, ac: .07, rc: .18, rg: 52, h: 'mid', pts: 2, push: 120, hs: .25, p: 'push', fx: 'kick', sta: 4 },
      Tu: { mn: 30, n: '머리 돌려차기', st: .18, ac: .08, rc: .28, rg: 56, h: 'hi', pts: 3, push: 50, hs: .36, p: 'hkick', fx: 'kick', sta: 7 },
      H: { mn: 30, n: '뒤차기', st: .22, ac: .09, rc: .3, rg: 60, h: 'mid', pts: 4, push: 140, hs: .4, p: 'spin', fx: 'kick', spin: 1, big: 1, sta: 9 },
      Hu: { mn: 30, n: '뒤후려차기', st: .26, ac: .09, rc: .34, rg: 58, h: 'hi', pts: 5, push: 70, hs: .5, p: 'spinh', fx: 'kick', spin: 1, big: 1, sta: 10 },
      Td: { n: '주먹 지르기', st: .07, ac: .06, rc: .14, rg: 38, h: 'mid', pts: 1, push: 40, hs: .2, p: 'jab', fx: 'punch', sta: 3 }
    },
    karate: {
      T: { n: '기자미 즈키', st: .06, ac: .06, rc: .14, rg: 48, h: 'hi', pts: 1, push: 14, hs: .2, p: 'jab', fx: 'punch', sta: 3 },
      H: { n: '갸쿠 즈키', st: .12, ac: .07, rc: .2, rg: 56, h: 'mid', pts: 1, push: 18, hs: .25, p: 'cross', fx: 'punch', sta: 5 },
      Tf: { n: '주단 마와시게리', st: .15, ac: .08, rc: .26, rg: 56, h: 'mid', pts: 2, push: 20, hs: .3, p: 'kick', fx: 'kick', sta: 6 },
      Tu: { n: '조단 마와시게리', st: .22, ac: .08, rc: .32, rg: 56, h: 'hi', pts: 3, push: 20, hs: .4, p: 'hkick', fx: 'kick', big: 1, sta: 8 },
      Td: { n: '아시바라이', st: .1, ac: .07, rc: .22, rg: 44, h: 'lo', sweep: 1, push: 0, hs: .3, p: 'sweep', fx: 'kick', sta: 5 },
      F: { n: '마무리 즈키', st: .07, ac: .12, rc: .22, rg: 64, h: 'lo', pts: 3, p: 'finish', fx: 'punch', fin: 1, big: 1 }
    },
    sanda: {
      T: { n: '직권', st: .07, ac: .06, rc: .15, rg: 46, h: 'hi', pts: 1, dmg: 3, push: 30, hs: .22, p: 'jab', fx: 'punch', sta: 3 },
      H: { n: '강권', st: .15, ac: .07, rc: .24, rg: 50, h: 'hi', pts: 1, dmg: 7, push: 70, hs: .34, p: 'cross', fx: 'hit', sta: 7 },
      Tf: { n: '측퇴', st: .16, ac: .08, rc: .26, rg: 60, h: 'mid', pts: 2, dmg: 6, push: 160, hs: .34, p: 'side', fx: 'kick', sta: 7 },
      Hf: { n: '강 측퇴', st: .2, ac: .09, rc: .3, rg: 62, h: 'mid', pts: 2, dmg: 8, push: 250, hs: .4, p: 'side', fx: 'kick', big: 1, sta: 9 },
      Tu: { n: '고퇴', st: .2, ac: .08, rc: .3, rg: 56, h: 'hi', pts: 2, dmg: 8, push: 50, hs: .38, p: 'hkick', fx: 'kick', sta: 8 },
      Td: { n: '소퇴 쓸기', st: .12, ac: .07, rc: .24, rg: 46, h: 'lo', pts: 2, dmg: 2, sweep: 1, hs: .3, p: 'sweep', fx: 'kick', sta: 5 },
      G: { n: '잡기', st: .08, ac: .1, rc: .22, rg: 36, p: 'reach', grip: 1, sta: 2 }
    },
    mma: {
      T: { n: '잽', st: .07, ac: .06, rc: .13, rg: 46, h: 'hi', dmg: 4, push: 30, hs: .22, p: 'jab', fx: 'punch', sta: 3 },
      H: { n: '크로스', st: .15, ac: .07, rc: .22, rg: 50, h: 'hi', dmg: 10, push: 80, hs: .36, p: 'cross', fx: 'hit', sta: 8, big: 1 },
      Tf: { n: '훅', st: .12, ac: .07, rc: .2, rg: 40, h: 'hi', dmg: 9, push: 50, hs: .32, p: 'hook', fx: 'hit', sta: 7 },
      Tu: { n: '하이킥', st: .22, ac: .08, rc: .32, rg: 56, h: 'hi', dmg: 15, push: 60, hs: .45, p: 'hkick', fx: 'kick', sta: 10, big: 1 },
      Td: SHOOT
    },
    arcade: {
      T: { n: '약펀치', st: .06, ac: .06, rc: .12, rg: 48, h: 'hi', dmg: 4, push: 40, hs: .22, p: 'jab', fx: 'punch' },
      H: { n: '강펀치', st: .16, ac: .08, rc: .24, rg: 52, h: 'hi', dmg: 9, push: 90, hs: .38, p: 'cross', fx: 'hit', big: 1 },
      Tf: { n: '돌려차기', st: .14, ac: .08, rc: .24, rg: 58, h: 'mid', dmg: 8, push: 90, hs: .34, p: 'kick', fx: 'kick' },
      Hf: { n: '강 돌려차기', st: .2, ac: .09, rc: .3, rg: 60, h: 'hi', dmg: 11, push: 130, hs: .42, p: 'hkick', fx: 'kick', big: 1 },
      Td: { n: '다리 쓸기', st: .12, ac: .08, rc: .26, rg: 56, h: 'lo', dmg: 6, sweep: 1, hs: .3, p: 'sweep', fx: 'kick' },
      Hd: { n: '승룡 어퍼', st: .06, ac: .16, rc: .36, rg: 42, h: 'hi', dmg: 13, push: 70, hs: .5, p: 'upper', fx: 'hit', aa: 1, big: 1 },
      J: { n: '점프킥', st: .04, ac: .3, rc: .05, rg: 54, h: 'air', dmg: 8, push: 60, hs: .3, p: 'jkick', fx: 'kick', air: 1 },
      FB: { n: '파동권', st: .22, ac: .05, rc: .35, rg: 0, p: 'fireball', proj: 1 }
    },
    fence: {
      T: { n: '베기', st: .06, ac: .07, rc: .16, rg: 58, h: 'hi', p: 'cut', fx: 'swing' },
      Tu: { n: '머리 베기', st: .09, ac: .07, rc: .2, rg: 62, h: 'hi', p: 'cuth', fx: 'swing' },
      H: { n: '런지', st: .12, ac: .12, rc: .34, rg: 60, tr: 230, h: 'hi', p: 'lunge', fx: 'swing' },
      Tf: { n: '플레슈', st: .14, ac: .18, rc: .45, rg: 58, tr: 330, h: 'hi', p: 'fleche', fx: 'swing' }
    },
    judo: { T: REACH }, kurash: { T: REACH },
    wrestle: { T: REACH, Td: SHOOT }, bjj: { T: REACH, Td: SHOOT }
  };
  // CPU technique preferences and preferred distance
  const AIK = {
    box: [['T', 5], ['H', 3], ['Tf', 2], ['Tu', 1.4], ['Td', 2]],
    tkd: [['T', 5], ['Tf', 2.5], ['Tu', 2.4], ['H', 1.4], ['Hu', .9], ['Td', 1]],
    karate: [['T', 4], ['H', 3], ['Tf', 2.5], ['Tu', 1.4], ['Td', 1.2]],
    sanda: [['T', 4], ['H', 2], ['Tf', 3], ['Tu', 2], ['Td', 1.4]],
    mma: [['T', 4], ['H', 3], ['Tf', 2], ['Tu', 1.1], ['Td', 1.8]],
    arcade: [['T', 4], ['H', 2], ['Tf', 3], ['Hf', 1], ['Td', 1.6]],
    fence: [['T', 3], ['Tu', 2]],
    judo: [['T', 3], ['H', 1]], kurash: [['T', 3], ['H', 1]], wrestle: [['T', 2], ['Td', 1.5], ['H', .5]], bjj: [['T', 2], ['Td', 1.4]]
  };
  const AIR = { box: 44, tkd: 52, karate: 52, sanda: 50, mma: 44, arcade: 50, fence: 60, judo: 38, kurash: 38, wrestle: 40, bjj: 40 };
  // throw technique names by direction held when committing (grip mini-game)
  const TECH = {
    judo: { u: ['업어치기', 'over'], f: ['허벅다리걸기', 'over'], b: ['안다리걸기', 'reap'], '': ['허리후리기', 'over'], d: ['밭다리후리기', 'reap'] },
    kurash: { u: ['허리 들어메치기', 'lift'], f: ['엉덩이 던지기', 'over'], b: ['다리 걸기', 'reap'], '': ['허리 던지기', 'over'], d: ['발 후리기', 'reap'] },
    wrestle: { u: ['수플렉스', 'lift'], f: ['허리 던지기', 'over'], b: ['안다리', 'reap'], '': ['다리 걸기', 'reap'], d: ['다리 걸기', 'reap'] },
    sanda: { u: ['들어 던지기', 'lift'], f: ['엉덩이 던지기', 'over'], b: ['안다리', 'reap'], '': ['솔각', 'reap'], d: ['솔각', 'reap'] },
    bjj: { u: ['테이크다운', 'reap'], f: ['테이크다운', 'reap'], b: ['테이크다운', 'reap'], '': ['테이크다운', 'reap'], d: ['테이크다운', 'reap'] }
  };

  /* ------------------------------------------------------------------ *
   * Inputs
   * ------------------------------------------------------------------ */
  function blankRel() { return { f: false, b: false, fp: false, bp: false, u: false, d: false, a: false, up: false, dp: false, ap: false, ar: false, mash: 0 }; }
  function relIn(I, face) {
    const n = b => (I[b + 'c'] != null ? I[b + 'c'] : (I[b + 'p'] ? 1 : 0)) | 0;
    const r = face > 0;
    return {
      f: !!(r ? I.r : I.l), b: !!(r ? I.l : I.r), fp: !!(r ? I.rp : I.lp), bp: !!(r ? I.lp : I.rp),
      u: !!I.u, d: !!I.d, a: !!I.a, up: !!I.up, dp: !!I.dp, ap: !!I.ap, ar: !!I.ar, mash: n('l') + n('r')
    };
  }
  function dirOf(c) { return c.u ? 'u' : c.d ? 'd' : c.f ? 'f' : c.b ? 'b' : ''; }
  function ctl(s, i, inputs, R, dt) {
    const e = s.ents[i];
    if (e.human) return relIn((inputs && inputs[e.pid]) || {}, s.f[i].face);
    return ai(s, i, R, dt);
  }

  /* ------------------------------------------------------------------ *
   * State helpers
   * ------------------------------------------------------------------ */
  function mark(s, i) { return 240 + (i ? 1 : -1) * KD[s.kind].gap / 2; }
  function mkF(s, i) {
    return {
      x: mark(s, i), y: 0, vx: 0, vy: 0, jvx: 0, face: i ? -1 : 1, st: 'idle', stT: 0, mv: null, hs: 0, downT: 0,
      aT: -1, aDir: '', fb: 0, buf: '', bufT: 0, blkT: 0, gd: 100, hp: 100, sta: 100, kd: 0, kdr: 0, inv: 0,
      pts: 0, wa: 0, yon: 0, chala: 0, pen: 0, adv: 0, ctl: 0, act: 0, hits: 0, pass: 0, rs: 0, dmgD: 0,
      flash: 0, hl: 0, spr: 0, dT: -9, fT: -9, rip: 0, wd: 1,
      ai: { cd: .6 + i * .15, ctr: 0, mv: 0, mvT: 0, a: 0, first: 0, dir: '', blk: 0, bdir: 'd', bfirst: 0, react: -1, rd: 0, mash: 0, side: 0, thr: 50, go: 0, q: [] }
    };
  }
  function setSt(F, st) { F.st = st; F.stT = 0; }
  function free(F) { return F.st === 'idle' || F.st === 'walk' || F.st === 'block' || F.st === 'sblock'; }
  function resolve(k, key) {
    const T = MV[k];
    if (T[key]) return key;
    const dir = key.slice(1);
    if (key[0] === 'H' && T['T' + dir]) return 'T' + dir;
    if (T[key[0]]) return key[0];
    return 'T';
  }
  function banner(s, str, c, d, big) { s.ban = { s: str, c: c || PAL.yellow, t: 0, d: d || 1.5, big: big ? 1 : 0 }; }
  function pop(s, str, x, y, c) {
    s.pop.push({ s: str, x: Math.round(x), y: Math.round(y), c: c || PAL.white, t: 0 });
    if (s.pop.length > 6) s.pop.shift();
  }
  function spark(s, x, y, k) {
    s.fx.push({ k: k, x: Math.round(x), y: Math.round(y), t: 0 });
    if (s.fx.length > 24) s.fx.shift();
  }
  function walkTo(s, F, nx) { const kd = KD[s.kind]; F.x = M.clamp(nx, Math.min(F.x, kd.L), Math.max(F.x, kd.R)); }
  function cornerCol(s, i) {
    const k = s.kind;
    if (k === 'judo' || k === 'bjj') return i ? '#2b5cd8' : WHITE;
    if (k === 'kurash') return i ? '#2b62c8' : '#2e9a52';
    if (k === 'fence') return i ? '#3fd06a' : RED;
    if (k === 'sanda') return i ? '#3a3f55' : RED;
    return i ? BLUE : RED;
  }

  /* ------------------------------------------------------------------ *
   * CPU: produces relative inputs (same path as humans)
   * ------------------------------------------------------------------ */
  function ai(s, i, R, dt) {
    const F = s.f[i], O = s.f[1 - i], A = F.ai, k = s.kind, kd = KD[k];
    const sk = s.ents[i].skill;
    const c = blankRel();
    if (s.ph !== 'fight') { A.a = 0; A.blk = 0; A.q = []; A.react = -1; return c; }
    if (A.q.length) { const fr = A.q.shift(); for (const key in fr) c[key] = fr[key]; return c; }
    const rate = 4.5 + 8 * sk;
    const mash = mult => {
      A.mash += rate * (mult == null ? 1 : mult) * dt * (0.75 + R.f() * 0.5);
      while (A.mash >= 1) { A.mash -= 1; c.mash++; A.side = 1 - A.side; if (A.side) c.fp = true; else c.bp = true; }
    };
    const tap = () => { c.ap = true; c.a = true; c.ar = true; };
    A.cd -= dt;
    const m = s.mode, g = s.gr;
    if (m === 'grip') {
      const adv = i === 0 ? g.bal : -g.bal;
      if (g.wind) {
        if (g.wind.who !== i) {
          if (!A.rd) { A.rd = 1; A.react = R.chance(.2 + .55 * sk) ? .07 + (1 - sk) * .22 : -1; }
          if (A.react >= 0) { A.react -= dt; if (A.react < 0) { c.d = true; c.dp = true; } }
        }
        return c;
      }
      A.rd = 0;
      if (A.blk > 0) { A.blk -= dt; c.d = true; return c; }
      if (adv < -55 && R.chance(dt * 1.2)) { A.blk = .45; return c; }
      mash(1);
      if (A.cd <= 0 && (adv > A.thr || (g.t > g.lim * .72 && adv > 4))) {
        tap(); const r = R.f(); if (r < .3) c.u = true; else if (r < .55) c.f = true; else if (r < .7) c.b = true;
        A.cd = .9;
      }
      return c;
    }
    if (m === 'ground') {
      if (g.k !== 'gnd' || g.sub) { mash(g.sub ? 1.1 : 1); return c; }
      mash(1);
      if (g.top === i) {
        if (k === 'mma' && g.pd <= 0 && R.chance(dt * (1.5 + 2.5 * sk))) tap();
        else if ((g.pos >= 1 || k === 'bjj') && R.chance(dt * (.06 + .22 * sk) * (g.pos + .3))) { tap(); c.u = true; }
      } else if (g.pos === 0 && R.chance(dt * .07 * (.5 + sk))) tap();
      return c;
    }
    if (m === 'count') { if (g.who === i) mash(g.cr); return c; }
    if (m === 'after') { if (g.tori === i && A.go && g.t > .25 + (1 - sk) * .4) { c.d = true; c.dp = true; } return c; }
    if (m !== 'stand') return c;
    // ---------------- stand-up fighting ----------------
    const dist = Math.abs(O.x - F.x);
    if (A.a > 0) {                                   // holding ACTION (charge)
      A.a -= dt; c.a = true;
      if (A.dir) c[A.dir] = true;
      if (A.first) { c.ap = true; A.first = 0; }
      if (A.a <= 0) { c.a = false; c.ar = true; }
      return c;
    }
    // reaction to incoming attack
    if (O.st === 'atk' && O.mv && O.mv.t <= dt * 1.5 && A.react < 0) {
      const om = MV[k][O.mv.k];
      const threat = om && (om.proj || dist < (om.rg || 30) + (om.tr ? 70 : 22));
      if (threat && R.chance(.2 + .66 * sk)) A.react = Math.max(.03, .26 - .22 * sk + R.range(-.03, .06));
    }
    if (A.react >= 0) {
      A.react -= dt;
      if (A.react < 0 && O.st === 'atk' && O.mv) {
        const om = MV[k][O.mv.k];
        if (k === 'box' && om.h === 'hi' && R.chance(.35)) { c.u = true; c.up = true; return c; }
        if (k === 'arcade') { A.blk = .35; A.bdir = om.h === 'lo' ? 'd' : 'b'; }
        else { A.blk = k === 'fence' ? .2 : .32; A.bdir = 'd'; A.bfirst = 1; }
      }
    }
    if (A.blk > 0) {
      A.blk -= dt;
      if (A.bdir === 'b') c.b = true;
      else { c.d = true; if (A.bfirst) { c.dp = true; A.bfirst = 0; } }
      return c;
    }
    const attack = key => {
      A.dir = key.length > 1 ? key[1] : '';
      A.a = key[0] === 'H' ? CH + .02 + R.f() * (Math.abs(O.x - F.x) > 70 ? .3 : .06) : dt * 1.5;
      A.first = 1;
    };
    if (k === 'fence' && F.rip > 0 && R.chance(.4 + .5 * sk)) { attack('T'); return c; }
    if (k === 'karate' && s.swept && s.swept.by === i && R.chance(dt * 9 * (.3 + sk))) { tap(); return c; }
    if (A.cd <= 0 && (free(F) || F.st === 'jump')) {
      A.cd = .06 + (1 - sk) * .26 + R.f() * .12;
      const agg = .35 + .5 * sk;
      const pref = AIR[k];
      if (k === 'fence') {
        if (dist > 128) { A.mv = 1; A.mvT = .1 + R.f() * .25; }
        else if (dist > 72) {
          if (R.chance(agg * .55)) attack(dist > 100 && R.chance(.4) ? 'Tf' : 'H');
          else { A.mv = R.chance(.55) ? 1 : -1; A.mvT = .08 + R.f() * .2; }
        } else if (R.chance(agg)) attack(R.chance(.6) ? 'T' : 'Tu');
        else { A.mv = -1; A.mvT = .12 + R.f() * .2; }
      } else {
        // choose among techniques whose reach fits the current distance
        const reachOf = key => { const d = MV[k][resolve(k, key)]; return (d.rg || 40) + (d.tr ? d.tr * (d.st + d.ac) * .8 : 0) - 5; };
        const mnOf = key => (MV[k][resolve(k, key)].mn || 0) + 2;
        const om = O.st === 'atk' && O.mv ? MV[k][O.mv.k] : null;
        const busyOpp = om && !O.mv.wh && O.mv.t < om.st + om.ac && dist < (om.rg || 30) + 10;
        if (busyOpp && R.chance(.25 + .6 * sk)) { A.blk = .3; A.bdir = k === 'arcade' && om.h !== 'lo' ? 'b' : 'd'; A.bfirst = 1; return c; }
        const L = AIK[k].filter(r => dist <= reachOf(r[0]) && dist >= mnOf(r[0]) && (r[0][0] !== 'H' || (!busyOpp && (dist > 60 || O.st === 'hit' || (om && O.mv.wh)))));
        let maxR = 0, minM = 99;
        AIK[k].forEach(r => { maxR = Math.max(maxR, reachOf(r[0])); minM = Math.min(minM, mnOf(r[0])); });
        const vuln = O.st === 'hit' || (om && O.mv.wh) || O.st === 'down';
        let key = '';
        if (kd.grip && !MV[k].T.dmg && O.st === 'block' && dist <= reachOf('T') && R.chance(.6)) key = 'H';
        else if (k === 'arcade' && O.y > 10 && dist < 60 && R.chance(.6 * sk)) key = 'Hd';
        else if (A.ctr && dist <= reachOf('T') && dist >= mnOf('T')) key = 'T';
        else if (L.length && R.chance(vuln ? .92 : agg)) {
          let tot = 0; L.forEach(r => { tot += r[1]; });
          let r = R.f() * tot; key = L[0][0];
          for (const it of L) { r -= it[1]; if (r <= 0) { key = it[0]; break; } }
        }
        A.ctr = 0;
        if (key) attack(key);
        else if (dist > maxR) {
          A.mv = 1; A.mvT = .06 + R.f() * .2;
          if ((k === 'wrestle' || k === 'mma' || k === 'bjj') && dist < 82 && R.chance(agg * .3)) attack('Td');
          else if (k === 'arcade' && dist > 92 && R.chance(.22 + .2 * sk) && !s.proj.some(p => p.own === i)) {
            A.q = [{ d: true, dp: true }, { d: true, f: true, fp: true }, { f: true, a: true, ap: true }, { ar: true }];
          } else if (k === 'arcade' && dist < 120 && R.chance(.1)) {
            A.q = [{ u: true, up: true, f: true }, {}, {}, {}, {}, {}, {}, {}, {}, { a: true, ap: true }, { ar: true }];
          }
        } else if (dist < minM) { A.mv = -1; A.mvT = .1 + R.f() * .15; }
        else if (R.chance(.45)) { A.mv = R.chance(.55 + .2 * sk) ? -1 : 1; A.mvT = .05 + R.f() * .12; }
      }
    }
    // punish a whiffed attack quickly
    if (A.cd > .04 && O.st === 'atk' && O.mv && O.mv.wh && R.chance(dt * 6 * sk)) A.cd = 0;
    if (A.mvT > 0) { A.mvT -= dt; if (A.mv > 0) c.f = true; else if (A.mv < 0) c.b = true; }
    return c;
  }

  /* ------------------------------------------------------------------ *
   * Init / update
   * ------------------------------------------------------------------ */
  function init(ev, ents, opts, R) {
    const kind = ev.cfg.kind, kd = KD[kind];
    const s = {
      evId: ev.id, kind: kind, t: -3, ph: 'pre', phT: 0, mode: 'stand', gr: null,
      clock: kd.time, el: 0, round: 1, rounds: kd.rounds || 1, golden: 0, stopT: 0, stopD: 0, reset: 0, brT: 0,
      ents: ents.map(e => ({ idx: e.idx, pid: e.pid, human: !!e.human, country: e.country, name: e.name, tag: e.tag || '', skill: e.skill, look: e.look | 0 })),
      f: [], fx: [], pop: [], ban: null, shake: 0, slow: 0, flash: 0, ex: 0,
      ref: { x: 240, act: 'idle', t: 0, side: 0 },
      lamp: [0, 0], pend: null, senshu: -1, last: -1, big: [0, 0], proj: [], jd: [[0, 0], [0, 0], [0, 0]], rw: [0, 0], prio: -1,
      swept: null, win: null, done: false, results: null
    };
    s.f = [mkF(s, 0), mkF(s, 1)];
    return s;
  }

  function update(s, inputs, dt, R) {
    if (s.done) return;
    let k = 1;
    if (s.slow > 0) { s.slow = Math.max(0, s.slow - dt); k = 0.32; }
    const sdt = dt * k;
    s.t += s.ph === 'pre' ? dt : sdt;
    s.phT += dt;
    fxUpd(s, sdt);
    const C = [ctl(s, 0, inputs, R, sdt), ctl(s, 1, inputs, R, sdt)];
    // referee drifts to the middle of the action
    const midx = s.mode === 'count' ? s.f[s.gr.who].x + (s.gr.who ? -26 : 26) : (s.f[0].x + s.f[1].x) / 2;
    s.ref.x += M.clamp(midx - s.ref.x, -90 * dt, 90 * dt);
    if (s.ph === 'pre') {
      if (s.t >= 0) {
        s.ph = 'fight'; s.phT = 0;
        banner(s, startWord(s), PAL.white, 1);
        OG.sfx(s, s.kind === 'box' || s.kind === 'mma' ? 'bell' : 'whistle');
        s.ref.act = 'start'; s.ref.t = 0;
      }
      return;
    }
    if (s.ph !== 'over') {
      s.el += dt;
      if (s.el >= CAP) { endNow(s, R); return; }
    }
    if (s.ph === 'fight') fight(s, C, sdt, R);
    else if (s.ph === 'stop') stopPh(s, sdt, R);
    else if (s.ph === 'break') breakPh(s, dt, R);
    else if (s.ph === 'over') overPh(s, dt);
  }
  function startWord(s) {
    return { judo: '하지메!', kurash: '하지메!', karate: '하지메!', bjj: '컴뱃!', box: 'BOX!', fence: 'ALLEZ!', tkd: '시작!', wrestle: '시작!', sanda: '开始!', mma: 'FIGHT!', arcade: 'FIGHT!' }[s.kind] || '시작!';
  }

  function fxUpd(s, dt) {
    for (const e of s.fx) e.t += dt;
    s.fx = s.fx.filter(e => e.t < .5);
    for (const e of s.pop) e.t += dt;
    s.pop = s.pop.filter(e => e.t < 1.3);
    if (s.ban) { s.ban.t += dt; if (s.ban.t > s.ban.d) s.ban = null; }
    s.shake = Math.max(0, s.shake - 26 * dt);
    s.flash = Math.max(0, s.flash - dt);
    s.ex = Math.max(0, s.ex - .35 * dt);
    s.lamp[0] = Math.max(0, s.lamp[0] - dt); s.lamp[1] = Math.max(0, s.lamp[1] - dt);
    s.ref.t += dt;
    if (s.swept) { s.swept.t -= dt; if (s.swept.t <= 0) s.swept = null; }
  }

  function fight(s, C, dt, R) {
    const m = s.mode;
    if (m === 'stand') standUpd(s, C, dt, R);
    else if (m === 'grip') gripUpd(s, C, dt, R);
    else if (m === 'throw') throwUpd(s, C, dt, R);
    else if (m === 'after') afterUpd(s, C, dt, R);
    else if (m === 'ground') groundUpd(s, C, dt, R);
    else if (m === 'count') countUpd(s, C, dt, R);
    if (s.ph !== 'fight') return;
    if (m === 'stand' || m === 'grip' || m === 'ground') {
      if (m === 'ground' && s.kind === 'mma') s.f[s.gr.top].ctl += dt;
      s.clock -= dt;
      if (s.clock <= 0) { s.clock = 0; timeUp(s, R); }
    }
  }

  /* ----------------------------- stand-up ----------------------------- */
  function standUpd(s, C, dt, R) {
    for (let i = 0; i < 2; i++) fUpd(s, i, C[i], dt, R);
    if (s.mode !== 'stand' || s.ph !== 'fight') return;
    projUpd(s, dt, R);
    sep(s);
    outs(s, R);
    if (s.pend && s.ph === 'fight') { s.pend.t -= dt; if (s.pend.t <= 0) touch(s, s.pend.who); }
    if (s.ph === 'fight' && s.mode === 'stand') passivity(s);
  }

  function fUpd(s, i, c, dt, R) {
    const F = s.f[i], k = s.kind, kd = KD[k];
    if (s.mode !== 'stand') return;
    F.stT += dt;
    if (F.inv > 0) F.inv -= dt;
    if (F.rip > 0) F.rip -= dt;
    if (F.flash > 0) F.flash -= dt;
    if (F.hl > 0) F.hl -= dt;
    if (F.spr > 0) F.spr -= dt;
    F.gd = Math.min(100, F.gd + 16 * dt);
    if (F.st !== 'atk') F.sta = Math.min(100, F.sta + (F.st === 'block' ? 4 : 8) * dt);
    F.pass += dt;
    if (c.dp) F.dT = s.t;
    if (c.fp) F.fT = s.t;
    // ACTION: tap / hold / direction
    let key = '';
    if (c.ap) {
      F.aT = 0; F.aDir = dirOf(c);
      F.fb = (k === 'arcade' && s.t - F.dT < .5 && F.fT >= F.dT && s.t - F.fT < .3) ? 1 : 0;
    } else if (F.aT >= 0) { F.aT += dt; if (!F.aDir) F.aDir = dirOf(c); }
    if (F.aT >= 0 && (c.ar || !c.a || F.aT >= .9)) {
      key = F.fb ? 'FB' : (F.aT >= CH ? 'H' : 'T') + (F.aDir === 'b' ? '' : F.aDir);
      F.aT = -1; F.fb = 0;
    }
    if (key) {
      if (k === 'karate' && s.swept && s.swept.by === i) key = 'F';
      if (F.y > 3 && MV[k].J) key = 'J';
      if (free(F) || (F.st === 'jump' && key === 'J')) startMove(s, i, key, R);
      else { F.buf = key; F.bufT = .2; }
    } else if (F.buf && free(F)) { startMove(s, i, F.buf, R); F.buf = ''; }
    if (F.bufT > 0) { F.bufT -= dt; if (F.bufT <= 0) F.buf = ''; }
    if (s.mode !== 'stand') return;
    switch (F.st) {
      case 'atk': moveUpd(s, i, dt, R); break;
      case 'hit': F.hs -= dt; if (F.hs <= 0) setSt(F, 'idle'); break;
      case 'down':
        F.downT -= dt;
        if (F.downT <= 0) { setSt(F, 'idle'); F.inv = .35; }
        break;
      case 'duck': if (F.stT > .4) setSt(F, 'idle'); break;
      case 'jump': break;
      default: {
        const threat = k === 'arcade' && c.b && threatened(s, i);
        if (c.d) { if (F.st !== 'block') { setSt(F, 'block'); F.blkT = 0; } F.blkT += dt; }
        else if (threat) { if (F.st !== 'sblock') setSt(F, 'sblock'); }
        else if (c.up && k === 'box') setSt(F, 'duck');
        else if (c.up && kd.jump && F.y <= 0 && !c.a) {
          setSt(F, 'jump'); F.vy = 320; F.jvx = ((c.f ? 1 : 0) - (c.b ? 1 : 0)) * 80 * F.face; OG.sfx(s, 'jump');
        } else {
          const v = (c.f ? 1 : 0) - (c.b ? 1 : 0);
          const sp = kd.spd * (F.aT >= 0 ? .5 : 1) * (F.sta < 20 ? .75 : 1);
          if (v) { walkTo(s, F, F.x + F.face * v * sp * dt); if (F.st !== 'walk') setSt(F, 'walk'); F.wd = v; }
          else if (F.st !== 'idle') setSt(F, 'idle');
        }
      }
    }
    // physics
    if (F.vx) {
      const nx = F.x + F.vx * dt;
      F.x = kd.out ? nx : M.clamp(nx, kd.L, kd.R);
      F.vx *= Math.exp(-7 * dt);
      if (Math.abs(F.vx) < 2) F.vx = 0;
    }
    if (F.y > 0 || F.vy > 0) {
      F.y += F.vy * dt; F.vy -= 980 * dt;
      walkTo(s, F, F.x + F.jvx * dt);
      if (F.y <= 0) {
        F.y = 0; F.vy = 0; F.jvx = 0;
        if (F.st === 'atk') F.mv = null;
        if (F.st === 'jump' || F.st === 'atk') setSt(F, 'idle');
        OG.sfx(s, 'land');
      }
    }
  }
  function threatened(s, i) {
    const O = s.f[1 - i];
    return O.st === 'atk' || s.proj.some(p => p.own !== i && Math.abs(p.x - s.f[i].x) < 110);
  }

  function startMove(s, i, key, R) {
    const F = s.f[i], O = s.f[1 - i], k = s.kind;
    const dist = Math.abs(O.x - F.x);
    if (k === 'sanda' && key[1] === 'f' && dist < 38) key = 'G';
    if (k === 'mma' && key === 'Hd') key = 'Td';
    if (k === 'karate' && key === 'F' && !(s.swept && s.swept.by === i)) key = 'T';
    if (key === 'FB' && s.proj.some(p => p.own === i)) key = 'T';
    const rk = resolve(k, key);
    const d = MV[k][rk];
    F.mv = { k: rk, t: 0, hit: 0, t0: s.t, pw: (key[0] === 'H' && rk !== key) ? 1.3 : 1, wh: 0, sl: 1 + Math.max(0, 40 - F.sta) / 40 * .6 };
    setSt(F, 'atk');
    F.act += 1; F.pass = 0;
    F.sta = Math.max(0, F.sta - (d.sta || 2));
    OG.sfx(s, d.spin || d.big || d.proj ? 'whoosh' : 'swing');
    if (d.spin) F.wd = 1;
  }
  function moveUpd(s, i, dt, R) {
    const F = s.f[i], m = F.mv;
    if (!m) { setSt(F, 'idle'); return; }
    const d = MV[s.kind][m.k];
    m.t += dt;
    const st = d.st * m.sl, ac = d.ac, rc = d.rc * (m.wh ? 1.6 : 1) * m.sl;
    if (d.tr && m.t < st + ac && !m.hit) walkTo(s, F, F.x + F.face * d.tr * dt);
    if (d.proj && !m.hit && m.t >= st) { m.hit = 1; spawnProj(s, i); }
    if (!m.hit && m.t >= st && m.t < st + ac) tryHit(s, i, d, R);
    if (F.mv !== m) return;
    if (!m.hit && m.t >= st + ac && !m.wh) { m.wh = 1; F.sta = Math.max(0, F.sta - 5); }
    if (m.t >= st + ac + rc) { F.mv = null; setSt(F, F.y > 0 ? 'jump' : 'idle'); }
  }

  function tryHit(s, i, d, R) {
    const F = s.f[i], O = s.f[1 - i];
    const dist = Math.abs(O.x - F.x);
    if (dist > d.rg || (d.mn && dist < d.mn)) return;
    if (O.inv > 0 || O.st === 'fall') return;
    if (O.st === 'down' && !d.fin) return;
    if (d.fin && O.st !== 'down') return;
    if (d.h === 'hi' && O.st === 'duck') return;
    if (d.h === 'lo' && O.y > 6) return;
    if (O.y > 22 && !d.air && !d.aa) return;
    F.mv.hit = 1;
    if (d.grip) return gripStart(s, i, R);
    if (d.shoot) return shootHit(s, i, R);
    if (blocking(s, O, d)) return onBlock(s, i, d, R);
    onHit(s, i, d, R);
  }
  function blocking(s, O, d) {
    if (s.kind === 'arcade') {
      if (O.st === 'sblock') return d.h !== 'lo';
      if (O.st === 'block') return d.h !== 'air';
      return false;
    }
    return O.st === 'block';
  }
  function hitY(s, O, d) { const kd = KD[s.kind]; return kd.FY - O.y - (d.h === 'hi' || d.h === 'air' ? 40 : d.h === 'lo' ? 12 : 28); }

  function onBlock(s, i, d, R) {
    const F = s.f[i], O = s.f[1 - i], k = s.kind;
    const pw = F.mv ? F.mv.pw : 1;
    if (k === 'fence') {
      if (O.blkT < .3 || R.chance(.2)) {
        pop(s, '파라드!', O.x, KD.fence.FY - 74, PAL.cyan);
        OG.sfx(s, 'block');
        spark(s, (F.x + O.x) / 2, KD.fence.FY - 40, 'parry');
        F.mv = null; setSt(F, 'hit'); F.hs = .42; O.rip = .7; F.vx = -F.face * 30;
        O.act += 2;
        return;
      }
      return onHit(s, i, d, R);
    }
    if (!s.ents[1 - i].human && R.chance(.4 + .5 * s.ents[1 - i].skill)) { O.ai.cd = 0; O.ai.ctr = 1; }
    O.gd -= (d.dmg || (d.pts || 1) * 4) * 2.4 * pw + 6;
    O.vx = F.face * (d.push || 30) * .6 * pw;
    F.vx = -F.face * 18;
    spark(s, O.x - F.face * 7, hitY(s, O, d), 'block');
    OG.sfx(s, 'block');
    if (d.gb && (k === 'box' || k === 'mma')) O.hp = Math.max(1, O.hp - d.dmg * .35);
    F.act += .5;
    if (O.gd <= 0) {
      O.gd = 55; O.mv = null; setSt(O, 'hit'); O.hs = .65;
      pop(s, '가드 브레이크!', O.x, KD[k].FY - 70, PAL.orange);
      OG.sfx(s, 'crash');
    }
  }

  function onHit(s, i, d, R) {
    const F = s.f[i], O = s.f[1 - i], k = s.kind, kd = KD[k];
    if (k === 'fence') return fenceHit(s, i, R);
    const pw = F.mv ? F.mv.pw : 1;
    const counter = O.st === 'atk' && O.mv && O.mv.t < MV[k][O.mv.k].st;
    const mult = pw * (counter ? 1.25 : 1) * (F.sta < 20 ? .7 : 1);
    O.mv = null; O.aT = -1; O.buf = '';
    if (d.sweep) {
      setSt(O, 'down'); O.downT = k === 'karate' ? 1.05 : .8;
      if (k === 'karate') s.swept = { by: i, v: 1 - i, t: .95 };
    } else if (!d.fin) { setSt(O, 'hit'); O.hs = d.hs * (counter ? 1.3 : 1); }
    O.vx = F.face * (d.push || 0) * mult;
    O.flash = .14;
    F.hits++; F.act += 2;
    spark(s, O.x - F.face * 6, hitY(s, O, d), d.big || pw > 1 ? 'big' : 'hit');
    s.shake = Math.max(s.shake, d.big || pw > 1 ? 5 : 2.5);
    OG.sfx(s, d.fx || 'hit');
    if (counter && k !== 'karate') pop(s, 'COUNTER!', O.x, kd.FY - 82, PAL.orange);
    if (d.dmg && kd.hp) {
      const dm = d.dmg * mult;
      O.hp = Math.max(0, O.hp - dm); F.rs += dm; F.dmgD += dm;
      if (d.sdmg) O.sta = Math.max(0, O.sta - d.sdmg);
    }
    if (k === 'tkd') { O.hl = .4; award(s, i, d.pts, d.n, true); return; }
    if (k === 'karate') {
      if (d.pts) {
        const nm = d.pts >= 3 ? 'IPPON' : d.pts === 2 ? 'WAZA-ARI' : 'YUKO';
        award(s, i, d.pts, nm + '  ' + d.n, true);
        s.swept = null;
        if (s.ph === 'fight') stop(s, 1.6, 1, '야메!');
      }
      return;
    }
    if (k === 'sanda' && d.pts) award(s, i, d.pts, null, true);
    if (s.ph !== 'fight') return;
    if (kd.hp && O.hp <= 0) {
      if (k === 'box') return knockdown(s, 1 - i, R);
      if (k === 'arcade') return roundWin(s, i, 'ko');
      s.slow = 1.1; s.flash = .2;
      return finish(s, i, 'ko');
    }
    if (k === 'box' && (d.big || pw > 1) && O.hp < 24 && R.chance(.3)) knockdown(s, 1 - i, R);
  }

  function fenceHit(s, i, R) {
    const F = s.f[i], O = s.f[1 - i];
    s.lamp[i] = 1.6;
    OG.sfx(s, 'buzzer');
    spark(s, O.x - F.face * 6, KD.fence.FY - 40, 'hit');
    O.flash = .14;
    F.hits++; F.act += 2;
    const t0 = F.mv ? F.mv.t0 : s.t;
    if (s.pend && s.pend.who !== i) {
      const j = s.pend.who;
      let w;
      if (F.rip > 0) w = i; else if (s.f[j].rip > 0) w = j;
      else w = Math.abs(t0 - s.pend.t0) < .05 ? -1 : (t0 < s.pend.t0 ? i : j);
      s.pend = null;
      if (w < 0) { pop(s, '동시 공격 · 무효', 240, 90, PAL.lightgrey); stop(s, 1.4, 1, 'HALTE!'); return; }
      touch(s, w);
    } else if (!s.pend) s.pend = { who: i, t: .12, t0: t0 };
  }
  function touch(s, w) {
    s.pend = null;
    s.lamp[w] = 1.6;
    banner(s, 'TOUCHÉ!', w ? '#5cf08a' : '#ff6b72', 1.2);
    s.ex = .7;
    award(s, w, 1, null, true);
    if (s.ph === 'fight') stop(s, 1.2, 1, 'EN GARDE');
  }

  function spawnProj(s, i) {
    const F = s.f[i];
    s.proj.push({ x: Math.round(F.x + F.face * 24), y: KD.arcade.FY - 32, vx: F.face * 200, own: i, t: 0, dead: 0 });
    OG.sfx(s, 'power');
  }
  function projUpd(s, dt, R) {
    if (!s.proj.length) return;
    for (const p of s.proj) {
      p.x += p.vx * dt; p.t += dt;
      const O = s.f[1 - p.own];
      if (!p.dead && Math.abs(p.x - O.x) < 12 && O.y < 24 && O.st !== 'down') {
        p.dead = 1;
        if (O.st === 'sblock' || O.st === 'block') {
          O.hp = Math.max(1, O.hp - 2); O.vx = Math.sign(p.vx) * 40;
          spark(s, O.x - Math.sign(p.vx) * 7, p.y, 'block'); OG.sfx(s, 'block');
        } else {
          O.hp = Math.max(0, O.hp - 10); O.mv = null; setSt(O, 'hit'); O.hs = .42; O.vx = Math.sign(p.vx) * 90; O.flash = .14;
          s.f[p.own].hits++; s.f[p.own].rs += 10;
          spark(s, O.x - Math.sign(p.vx) * 6, p.y, 'big'); OG.sfx(s, 'hit'); s.shake = 4;
          if (O.hp <= 0) { s.proj = []; return roundWin(s, p.own, 'ko'); }
        }
      }
      if (p.x < KD.arcade.L - 50 || p.x > KD.arcade.R + 50) p.dead = 1;
    }
    s.proj = s.proj.filter(p => !p.dead);
  }

  function sep(s) {
    const a = s.f[0], b = s.f[1], kd = KD[s.kind];
    const MIN = s.kind === 'fence' ? 30 : 24;
    const d = b.x - a.x;
    if (d < MIN) {
      const push = (MIN - d) / 2;
      a.x -= push; b.x += push;
      const lockA = a.st !== 'hit', lockB = b.st !== 'hit';
      if (lockA && a.x < kd.L) { b.x += kd.L - a.x; a.x = kd.L; }
      if (lockB && b.x > kd.R) { a.x -= b.x - kd.R; b.x = kd.R; }
    }
  }
  function outs(s, R) {
    const kd = KD[s.kind];
    if (!kd.out || s.ph !== 'fight') return;
    for (let i = 0; i < 2; i++) {
      const F = s.f[i];
      if (F.x < kd.L - 4 || F.x > kd.R + 4) {
        const j = 1 - i;
        if (kd.out === 'gam') { F.pen++; award(s, j, 1, '감점 · 장외', true); }
        else if (kd.out === 'push') award(s, j, 1, '장외 (푸시아웃)', true);
        else {
          F.mode = 0; setSt(F, 'fall'); F.vy = 0; F.mv = null;
          s.shake = 6; OG.sfx(s, 'crash'); s.ex = 1;
          award(s, j, 3, '링아웃!', true);
          if (s.ph === 'fight') stop(s, 2.1, 1, '');
          s.f[i].st = 'fall';
          return;
        }
        if (s.ph === 'fight') stop(s, 1.4, 1, '');
        return;
      }
    }
  }
  function passivity(s) {
    const k = s.kind;
    if (k !== 'judo' && k !== 'kurash' && k !== 'wrestle') return;
    for (let i = 0; i < 2; i++) {
      const F = s.f[i], O = s.f[1 - i];
      if (F.pass > 22 && F.pass > O.pass + 4) {
        F.pass = 0; O.pass = 0; F.pen++;
        if (k === 'wrestle') { pop(s, '패시브 경고', F.x, KD[k].FY - 74, PAL.orange); award(s, 1 - i, 1, null, true); return; }
        pop(s, k === 'judo' ? '지도' : '경고', F.x, KD[k].FY - 74, PAL.yellow);
        OG.sfx(s, 'whistle');
        if (k === 'judo' && F.pen >= 3) return finish(s, 1 - i, 'hansoku');
        return;
      }
    }
  }

  /* ---------------------------- grapple ------------------------------ */
  function gripStart(s, i, R) {
    const F = s.f[i], O = s.f[1 - i], kd = KD[s.kind];
    const charged = F.mv && F.mv.pw > 1;
    if (O.st === 'block' && !charged && (O.blkT < .8 || R.chance(.5))) {
      pop(s, '그립 끊기!', O.x, kd.FY - 72, PAL.lightgrey);
      OG.sfx(s, 'block');
      O.vx = F.face * 40; F.vx = -F.face * 40;
      return;
    }
    s.mode = 'grip';
    s.gr = { k: 'grip', t: 0, bal: i ? -12 : 12, cx: (F.x + O.x) / 2, wind: null, lim: kd.lim };
    s.f.forEach((P, j) => {
      P.mv = null; P.aT = -1; P.buf = ''; setSt(P, 'grip');
      P.ai.thr = 74 - 36 * s.ents[j].skill + R.range(-10, 14); P.ai.cd = .5; P.ai.blk = 0;
    });
    F.act += 2; F.pass = 0;
    OG.sfx(s, 'block');
  }
  function gripUpd(s, C, dt, R) {
    const g = s.gr, kd = KD[s.kind];
    g.t += dt;
    if (g.wind) {
      const w = g.wind, j = 1 - w.who;
      w.t += dt;
      if (C[j].dp || (C[j].d && w.t > .05)) w.blk = 1;
      if (w.t >= .3) return throwResolve(s, R);
    } else {
      const p = [0, 0];
      for (let i = 0; i < 2; i++) {
        const F = s.f[i], c = C[i];
        F.def = c.d ? 1 : 0;
        const pw = 2.6 * (.75 + .25 * F.sta / 100);
        p[i] = c.mash * pw * (c.d ? 0 : 1);
        if (c.mash) F.sta = Math.max(0, F.sta - c.mash * .25); else F.sta = Math.min(100, F.sta + 6 * dt);
      }
      if (s.f[1].def) p[0] *= .45;
      if (s.f[0].def) p[1] *= .45;
      g.bal = M.clamp(g.bal + p[0] - p[1], -100, 100);
      g.bal *= Math.exp(-.12 * dt);
      g.cx += g.bal / 100 * (kd.drift || 14) * dt;
      if (!kd.out) g.cx = M.clamp(g.cx, kd.L + 14, kd.R - 14);
      for (let i = 0; i < 2 && !g.wind; i++) {
        if (C[i].ap) {
          const d = dirOf(C[i]);
          const tt = (TECH[s.kind] || TECH.judo)[d] || TECH.judo[''];
          g.wind = { who: i, t: 0, tech: tt[0], type: tt[1], blk: 0 };
          s.f[i].act += 3; s.f[i].pass = 0;
          OG.sfx(s, 'whoosh');
        }
      }
      if (g.t > g.lim && !g.wind) { pop(s, s.kind === 'judo' || s.kind === 'kurash' ? '마테!' : '브레이크!', 240, 84, PAL.white); return stop(s, 1.1, 1, ''); }
    }
    s.f[0].x = g.cx - 13; s.f[1].x = g.cx + 13;
    if (kd.out && !g.wind) {
      for (let i = 0; i < 2; i++) {
        const F = s.f[i];
        if (F.x < kd.L - 4 || F.x > kd.R + 4) {
          s.mode = 'stand'; s.gr = null;
          s.f.forEach(P => setSt(P, 'idle'));
          setSt(F, 'hit'); F.hs = 1;
          outs(s, R);
          return;
        }
      }
    }
  }
  function throwResolve(s, R) {
    const g = s.gr, w = g.wind, i = w.who, j = 1 - i, k = s.kind;
    const adv = i === 0 ? g.bal : -g.bal;
    const e = s.ents[i];
    const sk = e.human ? .55 : e.skill;
    const q = adv + (sk - .5) * 24 + R.range(-12, 12) - (w.blk ? 32 : 0);
    const th = {
      judo: [68, 36, 12], kurash: [68, 38, 14], wrestle: [62, 22, 999], sanda: [999, 18, 999], bjj: [999, 18, 999]
    }[k] || [68, 36, 12];
    let res = q >= th[0] ? 'big' : q >= th[1] ? 'mid' : q >= th[2] ? 'small' : q >= -22 ? 'fail' : 'counter';
    if (res === 'small' && th[2] >= 999) res = 'fail';
    if (res === 'fail') {
      g.wind = null; g.bal += i === 0 ? -34 : 34;
      pop(s, w.blk ? '버텼다!' : '실패!', s.f[j].x, KD[k].FY - 72, PAL.lightgrey);
      OG.sfx(s, 'block');
      return;
    }
    let tori = i, uke = j, tech = w.tech, type = w.type;
    if (res === 'counter') { tori = j; uke = i; res = 'mid'; tech = '되치기!'; type = 'reap'; }
    throwStart(s, tori, uke, res, tech, type);
  }
  function throwStart(s, tori, uke, res, tech, type) {
    const T = s.f[tori], U = s.f[uke], kd = KD[s.kind];
    s.mode = 'throw';
    s.gr = { k: 'throw', tori: tori, uke: uke, t: 0, dur: type === 'tackle' ? .42 : (res === 'big' ? .85 : .68), res: res, tech: tech, type: type, tx: T.x, ux: U.x, f: T.face };
    T.mv = null; U.mv = null; T.aT = -1; U.aT = -1;
    setSt(T, 'throw'); setSt(U, 'thrown');
    if (res === 'big') { s.slow = .95; s.flash = .12; }
    pop(s, tech, T.x, kd.FY - 84, PAL.white);
    OG.sfx(s, type === 'tackle' ? 'whoosh' : 'throw');
  }
  function shootHit(s, i, R) {
    const F = s.f[i], O = s.f[1 - i], kd = KD[s.kind];
    if (O.st === 'block' && (O.blkT < .55 || R.chance(.3))) {
      pop(s, 'SPRAWL!', O.x, kd.FY - 76, PAL.cyan);
      OG.sfx(s, 'block');
      F.mv = null; setSt(F, 'down'); F.downT = .75; F.vx = -F.face * 20; O.act += 2; O.spr = .7;
      return;
    }
    throwStart(s, i, 1 - i, 'mid', '태클!', 'tackle');
  }
  function throwUpd(s, C, dt, R) {
    const g = s.gr;
    g.t += dt;
    if (g.t >= g.dur) land(s, R);
  }
  function land(s, R) {
    const g = s.gr, k = s.kind, kd = KD[k], T = s.f[g.tori], U = s.f[g.uke];
    const lx = g.tx + g.f * (g.type === 'tackle' ? 22 : 34);
    U.x = M.clamp(lx, kd.L - 24, kd.R + 24); setSt(U, 'down'); U.downT = 9;
    if (g.type === 'tackle') T.x = U.x - g.f * 18;
    setSt(T, 'idle');
    s.shake = g.res === 'big' ? 9 : 5;
    spark(s, U.x, kd.FY, 'dust');
    OG.sfx(s, g.res === 'big' ? 'crash' : 'land');
    s.ex = 1;
    const res = g.res, ti = g.tori;
    T.act += 3; T.pass = 0; U.pass = 0;
    const cx = (T.x + U.x) / 2;
    if (k === 'judo') {
      if (res === 'big') return finish(s, ti, 'ippon');
      if (res === 'mid') {
        T.wa++; banner(s, 'WAZA-ARI', PAL.yellow, 1.3); OG.sfx(s, 'good');
        if (T.wa >= 2) return finish(s, ti, 'awase');
        if (s.golden) return finish(s, ti, 'gs');
        s.mode = 'after'; s.gr = { k: 'after', tori: ti, uke: g.uke, t: 0 };
        T.ai.go = R.chance(.45 + .4 * s.ents[ti].skill) ? 1 : 0;
        return;
      }
      pop(s, '효과 없음', U.x, kd.FY - 50, PAL.lightgrey);
      return stop(s, 1.3, 1, '마테!');
    }
    if (k === 'kurash') {
      if (res === 'big') return finish(s, ti, 'halal');
      if (res === 'mid') { T.yon++; banner(s, 'YONBOSH', PAL.yellow, 1.3); OG.sfx(s, 'good'); }
      else { T.chala++; banner(s, 'CHALA', PAL.white, 1.1); }
      if (s.golden) return finish(s, ti, 'gs');
      return stop(s, 1.4, 1, '');
    }
    if (k === 'wrestle') {
      if (res === 'big') {
        award(s, ti, 4, '그랜드 앰플리튜드 +4', true);
        if (s.ph !== 'fight') return;
        s.mode = 'ground'; s.gr = { k: 'fall', top: ti, t: 0, esc: 0, cx: cx };
        banner(s, '폴 위기!', PAL.orange, 1);
        return;
      }
      award(s, ti, 2, g.tech === '되치기!' ? '되치기 +2' : '테이크다운 +2', true);
      if (s.ph !== 'fight') return;
      s.mode = 'ground'; s.gr = { k: 'par', top: ti, t: 0, roll: 0, esc: 0, an: 0, cx: cx };
      return;
    }
    if (k === 'sanda') { award(s, ti, 2, '쓰러뜨리기 +2', true); if (s.ph === 'fight') stop(s, 1.5, 1, ''); return; }
    if (k === 'bjj') { award(s, ti, 2, '테이크다운 +2', true); if (s.ph !== 'fight') return; return groundStart(s, ti, cx); }
    if (k === 'mma') { T.ctl += 3; pop(s, '테이크다운!', cx, kd.FY - 70, PAL.white); return groundStart(s, ti, cx); }
    stop(s, 1.2, 1, '');
  }
  function groundStart(s, top, cx) {
    s.mode = 'ground';
    s.gr = { k: 'gnd', top: top, pos: 0, bar: 0, t: 0, sub: null, pd: 0, an: 0, cx: M.clamp(cx, KD[s.kind].L, KD[s.kind].R), near: 0 };
    s.f.forEach(P => { P.mv = null; P.aT = -1; setSt(P, 'ground'); });
  }
  function afterUpd(s, C, dt, R) {
    const g = s.gr;
    g.t += dt;
    const c = C[g.tori];
    if (c.dp || (c.ap && g.t > .05)) {
      s.mode = 'ground';
      const T = s.f[g.tori], U = s.f[g.uke];
      s.gr = { k: 'pin', top: g.tori, t: 0, esc: 0, wa: 0, cx: (T.x + U.x) / 2 };
      banner(s, '오사에코미!', PAL.white, 1);
      OG.sfx(s, 'whistle');
      return;
    }
    if (g.t > 1.3) stop(s, 1.1, 1, '마테!');
  }

  /* ----------------------------- ground ------------------------------ */
  function groundUpd(s, C, dt, R) {
    const g = s.gr, k = s.kind;
    g.t += dt;
    const top = g.top, bot = 1 - top, T = s.f[top], B = s.f[bot], cT = C[top], cB = C[bot];
    if (g.an > 0) g.an = Math.max(0, g.an - dt);
    T.flash = Math.max(0, T.flash - dt); B.flash = Math.max(0, B.flash - dt);
    if (g.k === 'pin') {
      g.esc = Math.max(0, g.esc + cB.mash * 3.6 - cT.mash * 1.2);
      if (!g.wa && g.t >= 5) {
        g.wa = 1; T.wa++; banner(s, 'WAZA-ARI', PAL.yellow, 1.1); OG.sfx(s, 'good');
        if (T.wa >= 2) return finish(s, top, 'awase');
        if (s.golden) return finish(s, top, 'gs');
      }
      if (g.t >= 10) return finish(s, top, 'osae');
      if (g.esc >= 100) { pop(s, '토케타! (탈출)', g.cx, KD[k].FY - 60, PAL.white); B.act += 3; return stop(s, 1.3, 1, '마테!'); }
      return;
    }
    if (g.k === 'par') {
      g.roll += cT.mash * 2.4; g.esc += cB.mash * 2.2;
      if (g.roll >= 100) {
        g.roll = 0; g.an = .6; OG.sfx(s, 'throw'); s.shake = 3;
        award(s, top, 2, '가로들기 +2', true);
        if (s.ph !== 'fight') return;
      }
      if (g.esc >= 100) { pop(s, '탈출!', g.cx, KD[k].FY - 60, PAL.white); return stop(s, 1.2, 1, ''); }
      if (g.t >= 6.5 && g.an <= 0) return stop(s, 1.2, 1, '');
      return;
    }
    if (g.k === 'fall') {
      g.esc = Math.max(0, g.esc + cB.mash * 3.2 - cT.mash * 1.2);
      if (g.esc >= 100) { pop(s, '브릿지 탈출!', g.cx, KD[k].FY - 60, PAL.white); return stop(s, 1.3, 1, ''); }
      if (g.t >= 3) { s.slow = .8; return finish(s, top, 'fall'); }
      return;
    }
    // bjj / mma
    g.pd -= dt;
    if (g.sub) {
      const a = g.sub.who, d = 1 - a;
      g.sub.lock += C[a].mash * 2.9 - C[d].mash * 3.3 - 5 * dt;
      g.sub.t += dt;
      if (g.sub.lock >= 100) { s.slow = .7; return finish(s, a, 'sub'); }
      if (g.sub.lock <= 0) {
        pop(s, '탈출!', g.cx, KD[k].FY - 60, PAL.white);
        s.f[a].adv++;
        if (a === top && g.pos > 0) g.pos--;
        g.sub = null; g.bar = 0; g.t = 0;
      }
      return;
    }
    g.bar += cT.mash * 2.3 - cB.mash * 2.5;
    if (cT.ap) {
      if (k === 'mma' && !cT.u) pound(s, cB, R);
      else subStart(s, top);
    } else if (cB.ap && g.pos === 0) subStart(s, bot);
    if (g.sub) return;
    if (g.bar >= 100) {
      if (g.pos < 3) {
        g.pos++; g.bar = 0; g.t = 0;
        const nm = ['', '가드 패스', '마운트', '백 테이크'][g.pos];
        if (k === 'bjj') award(s, top, [0, 3, 4, 4][g.pos], nm + ' +' + [0, 3, 4, 4][g.pos], true);
        else { T.ctl += 2; pop(s, nm + '!', g.cx, KD[k].FY - 64, PAL.white); }
        OG.sfx(s, 'good');
        if (s.ph !== 'fight') return;
      } else g.bar = 100;
    }
    if (g.bar <= -100) {
      g.bar = 0;
      if (k === 'bjj') {
        award(s, bot, 2, '스윕 +2', true);
        if (s.ph !== 'fight') return;
        g.top = bot; g.pos = 0; g.t = 0;
      } else {
        pop(s, '일어났다!', g.cx, KD[k].FY - 64, PAL.white);
        standFromGround(s);
        return;
      }
    }
    g.bar = M.clamp(g.bar, -100, 100);
    if (k === 'mma' && g.t > 15) return stop(s, 1.2, 1, '스탠드업!');
  }
  function standFromGround(s) {
    const g = s.gr, kd = KD[s.kind];
    const cx = M.clamp(g.cx, kd.L + 30, kd.R - 30);
    s.mode = 'stand'; s.gr = null;
    s.f.forEach((P, i) => { setSt(P, 'idle'); P.x = cx + (i ? 30 : -30); P.inv = .4; P.mv = null; });
  }
  function pound(s, cB, R) {
    const g = s.gr;
    if (g.pd > 0) return;
    const top = g.top, T = s.f[top], B = s.f[1 - top];
    g.pd = .28; g.an = .2;
    const dmg = (3 + g.pos * 1.6) * (cB.d ? .4 : 1);
    B.hp = Math.max(0, B.hp - dmg); T.rs += dmg; T.dmgD += dmg; T.hits++; B.flash = .1;
    const kd = KD[s.kind];
    spark(s, g.cx + (top === 0 ? 14 : -14), kd.FY - 8, cB.d ? 'block' : 'hit');
    OG.sfx(s, cB.d ? 'block' : 'punch'); s.shake = Math.max(s.shake, 2);
    if (B.hp <= 0) { s.slow = .8; finish(s, top, 'tko'); }
  }
  function subStart(s, who) {
    const g = s.gr, topA = who === g.top;
    const name = topA ? ['풋락', '기무라', '암바', '리어 네이키드 초크'][g.pos] : (g.t % 2 < 1 ? '트라이앵글 초크' : '암바');
    g.sub = { who: who, lock: topA ? 22 + g.pos * 9 : 26, t: 0, n: name };
    pop(s, name + '!', g.cx, KD[s.kind].FY - 70, PAL.orange);
    OG.sfx(s, 'power');
    s.f[who].act += 3;
  }

  /* --------------------------- knockdowns ---------------------------- */
  function knockdown(s, who, R) {
    const F = s.f[who];
    F.kd++; F.kdr++;
    F.mv = null; F.aT = -1; setSt(F, 'down');
    s.shake = 7; s.slow = .7; s.flash = .1; s.ex = 1;
    OG.sfx(s, 'crash');
    if (F.kd >= 3) return finish(s, 1 - who, 'tko');
    banner(s, 'DOWN!', PAL.orange, 1.2);
    s.mode = 'count';
    s.gr = { k: 'count', who: who, t: 0, n: 0, up: 0, cr: R.range(.3, 1.15) * (.55 + .6 * s.ents[who].skill) };
    setSt(s.f[1 - who], 'idle');
  }
  function countUpd(s, C, dt, R) {
    const g = s.gr, F = s.f[g.who], O = s.f[1 - g.who], kd = KD[s.kind];
    g.t += dt;
    const n = Math.min(10, Math.floor(g.t / .62));
    if (n > g.n) { g.n = n; OG.sfx(s, n >= 10 ? 'bell' : 'tick'); }
    const cx = g.who === 0 ? kd.R - 6 : kd.L + 6;
    if (Math.abs(O.x - cx) > 2) { O.x += M.clamp(cx - O.x, -80 * dt, 80 * dt); if (O.st !== 'walk') setSt(O, 'walk'); O.wd = Math.sign(cx - O.x) * O.face; }
    else if (O.st !== 'idle') setSt(O, 'idle');
    g.up += C[g.who].mash * 5.5;
    if (g.up >= 100 * F.kd && g.n >= 2) {
      F.hp = Math.max(F.hp, 44 - F.kd * 8); setSt(F, 'idle'); F.inv = .5;
      pop(s, '일어났다!', F.x, kd.FY - 70, PAL.white);
      return stop(s, 1.4, 0, 'BOX!');
    }
    if (g.n >= 10) { s.flash = .15; finish(s, 1 - g.who, 'ko'); }
  }

  /* ------------------------ scoring & ending ------------------------- */
  function award(s, i, n, label, popIt) {
    const F = s.f[i], O = s.f[1 - i], kd = KD[s.kind];
    if (!n) return;
    F.pts += n; s.last = i;
    if (n > s.big[i]) s.big[i] = n;
    if (popIt) pop(s, '+' + n, F.x, kd.FY - 70 - F.y, n >= 4 ? PAL.yellow : PAL.white);
    if (label) banner(s, label, n >= 3 ? PAL.yellow : PAL.white, 1.1, n >= 4);
    if (n >= 3) s.ex = 1;
    OG.sfx(s, n >= 3 ? 'perfect' : 'ding');
    if (s.kind === 'karate' && s.senshu < 0 && O.pts === 0) s.senshu = i;
    if (s.ph !== 'fight' && s.ph !== 'stop') return;
    if (kd.gapWin && F.pts - O.pts >= kd.gapWin) return finish(s, i, 'gap');
    if (kd.target && F.pts >= kd.target) return finish(s, i, 'pts');
    if (s.golden && F.pts !== O.pts) return finish(s, F.pts > O.pts ? i : 1 - i, 'gs');
  }
  function leader(s) {
    const a = s.f[0], b = s.f[1], k = s.kind;
    const cmp = (x, y) => x > y ? 0 : y > x ? 1 : -1;
    if (k === 'judo') return cmp(a.wa, b.wa);
    if (k === 'kurash') { const r = cmp(a.yon, b.yon); return r >= 0 ? r : cmp(a.chala, b.chala); }
    return cmp(a.pts, b.pts);
  }
  function timeUp(s, R) {
    const k = s.kind, kd = KD[k];
    if (s.mode === 'ground' && s.gr && (s.gr.k === 'pin' || s.gr.k === 'fall')) return;
    if (s.mode === 'ground' && s.gr && s.gr.sub) return;
    if (k === 'box' || k === 'mma') { scoreRound(s, R); OG.sfx(s, 'bell'); if (s.round < s.rounds) return roundBreak(s); return decision(s, R); }
    if (k === 'arcade') {
      const a = s.f[0].hp, b = s.f[1].hp;
      const w = a > b ? 0 : b > a ? 1 : s.f[0].hits > s.f[1].hits ? 0 : s.f[1].hits > s.f[0].hits ? 1 : R.i(2);
      return roundWin(s, w, 'time');
    }
    OG.sfx(s, 'buzzer');
    tieBreak(s, R, true);
  }
  // hard cap reached: end the bout right now with the current standing
  function endNow(s, R) {
    const k = s.kind;
    if (s.ph === 'over' || s.done) return;
    OG.sfx(s, 'buzzer');
    if (k === 'box' || k === 'mma') { scoreRound(s, R); return decision(s, R); }
    if (k === 'arcade') {
      const a = s.f[0], b = s.f[1];
      const w = s.rw[0] !== s.rw[1] ? (s.rw[0] > s.rw[1] ? 0 : 1) : a.hp !== b.hp ? (a.hp > b.hp ? 0 : 1) : a.hits !== b.hits ? (a.hits > b.hits ? 0 : 1) : R.i(2);
      if (s.rw[w] <= s.rw[1 - w]) s.rw[w] = s.rw[1 - w] + 1;
      return finish(s, w, 'arcade', 'TIME OVER');
    }
    tieBreak(s, R, false);
  }
  function tieBreak(s, R, allowGolden) {
    const k = s.kind, kd = KD[k];
    const L = leader(s);
    if (L >= 0) return finish(s, L, s.golden ? 'gs' : (k === 'judo' ? 'waza' : k === 'kurash' ? 'kpts' : 'pts'));
    if (k === 'wrestle') {
      if (s.big[0] !== s.big[1]) return finish(s, s.big[0] > s.big[1] ? 0 : 1, 'crit');
      if (s.last >= 0) return finish(s, s.last, 'crit');
      return decision(s, R);
    }
    if (k === 'karate') { if (s.senshu >= 0) return finish(s, s.senshu, 'senshu'); return decision(s, R); }
    if (k === 'bjj') {
      if (s.f[0].adv !== s.f[1].adv) return finish(s, s.f[0].adv > s.f[1].adv ? 0 : 1, 'adv');
      return decision(s, R);
    }
    if (allowGolden && kd.gold && !s.golden && s.el < CAP - kd.gold - 4) {
      s.golden = 1; s.clock = kd.gold;
      if (k === 'fence') { s.prio = R.i(2); banner(s, '우선권 1분', PAL.gold, 1.6); }
      else banner(s, k === 'tkd' ? '골든 라운드' : 'GOLDEN SCORE', PAL.gold, 1.6, true);
      OG.sfx(s, 'drum');
      return stop(s, 1.8, 1, '');
    }
    if (k === 'fence' && s.prio >= 0) return finish(s, s.prio, 'prio');
    if (k === 'judo' && s.f[0].pen !== s.f[1].pen) return finish(s, s.f[0].pen < s.f[1].pen ? 0 : 1, 'shido');
    return decision(s, R);
  }
  function scoreRound(s, R) {
    const a = s.f[0], b = s.f[1];
    const ra = a.rs + a.ctl * 1.5, rb = b.rs + b.ctl * 1.5;
    for (let j = 0; j < 3; j++) {
      const va = ra + R.gauss() * 5, vb = rb + R.gauss() * 5;
      const w = va > vb ? 0 : 1;
      const lose = s.f[1 - w];
      s.jd[j][w] += 10; s.jd[j][1 - w] += lose.kdr > 0 ? 8 : 9;
    }
    a.rs = 0; b.rs = 0; a.ctl = 0; b.ctl = 0; a.kdr = 0; b.kdr = 0;
  }
  function roundBreak(s) {
    s.ph = 'break'; s.phT = 0; s.brT = 3.2; s.mode = 'stand'; s.gr = null; s.proj = [];
    banner(s, s.round + 'R 종료', PAL.white, 1.6);
    s.f.forEach(F => { F.mv = null; F.aT = -1; if (F.st !== 'idle') setSt(F, 'idle'); });
  }
  function breakPh(s, dt, R) {
    s.brT -= dt;
    const kd = KD[s.kind];
    s.f.forEach((F, i) => {
      F.stT += dt;
      if (s.kind === 'arcade') return;
      const cx = i ? kd.R - 4 : kd.L + 4;
      if (Math.abs(F.x - cx) > 2) { F.x += M.clamp(cx - F.x, -70 * dt, 70 * dt); if (F.st !== 'walk') setSt(F, 'walk'); F.wd = Math.sign(cx - F.x) * F.face; }
      else if (F.st !== 'idle') setSt(F, 'idle');
    });
    if (s.brT <= 0) {
      s.round++; s.clock = kd.time;
      s.f.forEach(F => {
        F.sta = 100; F.gd = 100;
        F.hp = s.kind === 'arcade' ? 100 : Math.min(100, F.hp + 18);
        setSt(F, 'idle'); F.flash = 0;
      });
      stop(s, 1.4, 1, '');
      banner(s, s.kind === 'arcade' ? 'ROUND ' + s.round : s.round + ' 라운드', PAL.yellow, 1.3, true);
    }
  }
  function roundWin(s, w, how) {
    s.rw[w]++;
    const L = s.f[1 - w];
    s.proj = [];
    if (how === 'ko') { s.slow = 1.2; s.flash = .2; setSt(L, 'down'); L.downT = 99; OG.sfx(s, 'crash'); }
    else OG.sfx(s, 'buzzer');
    const perfect = s.f[w].hp >= 100;
    if (s.rw[w] >= 2) return finish(s, w, 'arcade', how === 'ko' ? (perfect ? 'PERFECT!' : 'K.O.') : 'TIME OVER');
    banner(s, how === 'ko' ? (perfect ? 'PERFECT K.O.' : 'K.O.') : 'TIME OVER', how === 'ko' ? PAL.hotpink : PAL.yellow, 2.2, true);
    s.ph = 'break'; s.phT = 0; s.brT = 2.6; s.mode = 'stand'; s.gr = null;
    setSt(s.f[w], 'win');
  }
  function decision(s, R) {
    const k = s.kind;
    const votes = [0, 0];
    if (k === 'box' || k === 'mma') {
      for (let j = 0; j < 3; j++) {
        const a = s.jd[j][0], b = s.jd[j][1];
        const w = a > b ? 0 : b > a ? 1 : (s.f[0].hits !== s.f[1].hits ? (s.f[0].hits > s.f[1].hits ? 0 : 1) : R.i(2));
        votes[w]++;
      }
    } else {
      const n = k === 'karate' ? 5 : 3;
      const base = s.f.map(F => F.act * .5 + F.hits * 2 + F.pts * 3 - F.pen * 2 + F.adv * 2 + F.wa * 4 + F.yon * 3);
      for (let j = 0; j < n; j++) {
        const a = base[0] + R.gauss() * 3, b = base[1] + R.gauss() * 3;
        votes[a >= b ? 0 : 1]++;
      }
    }
    const w = votes[0] > votes[1] ? 0 : 1;
    s.votes = votes;
    finish(s, w, 'dec');
  }
  function finTexts(s, w, how, extra) {
    const F = s.f[w], O = s.f[1 - w];
    const sc = F.pts + ' : ' + O.pts, scl = O.pts + ' : ' + F.pts;
    const v = s.votes || [2, 1];
    switch (how) {
      case 'ippon': case 'awase': case 'osae': return ['한판승', '한판패', 'IPPON!'];
      case 'waza': return ['절반승', '절반패', '절반승'];
      case 'shido': return ['지도승', '지도패', '지도승'];
      case 'hansoku': return ['반칙승', '반칙패', 'HANSOKU-MAKE'];
      case 'halal': return ['할랄승', '할랄패', 'HALAL!'];
      case 'kpts': return ['Y' + F.yon + ' C' + F.chala + ' 승', 'Y' + O.yon + ' C' + O.chala + ' 패', '우세승'];
      case 'gs':
        if (s.kind === 'judo') return ['골든스코어승', '골든스코어패', 'GOLDEN SCORE!'];
        if (s.kind === 'kurash') return ['골든스코어승', '골든스코어패', 'GOLDEN SCORE!'];
        return [sc, scl, s.kind === 'tkd' ? '골든 포인트!' : '결승점!'];
      case 'fall': return ['폴승', '폴패', 'FALL!'];
      case 'gap':
        if (s.kind === 'wrestle') return [sc + ' (테크니컬)', scl, '테크니컬 폴!'];
        return [sc, scl, '점수차 승!'];
      case 'crit': return [sc + ' (기준)', scl, '기준 승'];
      case 'pts': return [sc, scl, s.kind === 'fence' ? 'VICTOIRE!' : '승리!'];
      case 'ko': return ['KO승', 'KO패', 'K.O.!'];
      case 'tko': return ['TKO승', 'TKO패', 'T.K.O.!'];
      case 'sub': return ['서브미션승', '서브미션패', 'TAP OUT!'];
      case 'adv': return [sc + ' 어드밴티지', scl, '어드밴티지 승'];
      case 'senshu': return [sc + ' 선취', scl, '선취 승'];
      case 'prio': return [sc + ' 우선권', scl, '우선권 승'];
      case 'arcade': return [s.rw[w] + ' : ' + s.rw[1 - w], s.rw[1 - w] + ' : ' + s.rw[w], extra || 'K.O.'];
      case 'dec': default: return ['판정 ' + v[w] + ':' + v[1 - w], '판정 ' + v[1 - w] + ':' + v[w], '판정승'];
    }
  }
  function finish(s, w, how, extra) {
    if (s.ph === 'over' || s.done) return;
    const tx = finTexts(s, w, how, extra);
    s.ph = 'over'; s.phT = 0;
    s.win = { w: w, how: how, wt: tx[0], lt: tx[1] };
    banner(s, tx[2], how === 'ko' || how === 'tko' || how === 'arcade' ? PAL.hotpink : PAL.yellow, 3, true);
    const W = s.f[w], L = s.f[1 - w];
    W.mv = null; L.mv = null; s.pend = null; s.proj = [];
    const keepDown = s.mode === 'ground' || s.mode === 'count' || s.mode === 'throw' || L.st === 'down' || how === 'ko' || how === 'tko' || how === 'fall' || how === 'sub' || how === 'ippon' || how === 'halal';
    s.endMode = s.mode;
    if (s.mode === 'throw' || s.mode === 'after') { s.mode = 'stand'; s.gr = null; }
    if (s.mode !== 'ground') {
      setSt(W, 'win'); W.y = 0;
      if (keepDown) { setSt(L, 'down'); L.downT = 99; } else setSt(L, 'lose');
    }
    s.ref.act = 'raise'; s.ref.t = 0; s.ref.side = w;
    s.ex = 1;
    OG.sfx(s, how === 'ko' || how === 'tko' ? 'bell' : 'whistle');
    OG.sfx(s, 'cheer');
  }
  function overPh(s, dt) {
    s.f.forEach(F => { F.stT += dt; if (F.flash > 0) F.flash -= dt; });
    if (s.mode === 'ground' && s.phT > 1.2) {
      // stand the winner up for the celebration
      const g = s.gr, W = s.f[s.win.w], L = s.f[1 - s.win.w];
      W.x = g.cx + (s.win.w ? 16 : -16); L.x = g.cx + (s.win.w ? -16 : 16);
      s.mode = 'stand'; s.gr = null; setSt(W, 'win'); setSt(L, 'down'); L.downT = 99;
    }
    if (s.phT >= 2.8) {
      s.results = [{ idx: s.ents[s.win.w].idx, text: s.win.wt }, { idx: s.ents[1 - s.win.w].idx, text: s.win.lt }];
      s.done = true;
    }
  }
  function stop(s, dur, reset, word) {
    if (s.ph === 'over' || s.done) return;
    s.ph = 'stop'; s.phT = 0; s.stopT = dur; s.stopD = dur; s.reset = reset ? 1 : 0;
    s.mode = 'stand'; s.gr = null; s.pend = null; s.proj = []; s.swept = null;
    s.f.forEach(F => {
      F.mv = null; F.aT = -1; F.buf = ''; F.vx = 0; F.vy = 0; F.jvx = 0;
      if (F.st !== 'down' && F.st !== 'fall') setSt(F, 'idle');
    });
    if (word) banner(s, word, PAL.white, .9);
    s.ref.act = 'stop'; s.ref.t = 0;
  }
  function stopPh(s, dt, R) {
    s.stopT -= dt;
    if (s.clock > 0) s.clock = Math.max(0, s.clock - dt);
    s.f.forEach((F, i) => {
      F.stT += dt;
      if (F.flash > 0) F.flash -= dt;
      if (F.hl > 0) F.hl -= dt;
      if (F.st === 'fall') { F.y = Math.max(-30, F.y - 170 * dt); return; }
      if (F.st === 'down' && s.stopT < s.stopD - .7) setSt(F, 'idle');
      if (F.y > 0) F.y = Math.max(0, F.y - 200 * dt);
      if (s.reset && F.st !== 'down') {
        const mx = mark(s, i), d = mx - F.x;
        if (Math.abs(d) > 1.5) { F.x += M.clamp(d, -120 * dt, 120 * dt); if (F.st !== 'walk') setSt(F, 'walk'); F.wd = Math.sign(d) * F.face; }
        else { F.x = mx; if (F.st === 'walk') setSt(F, 'idle'); }
      }
    });
    if (s.stopT <= 0) {
      s.f.forEach((F, i) => { if (s.reset) F.x = mark(s, i); F.y = 0; F.vx = 0; if (F.st !== 'idle') setSt(F, 'idle'); });
      s.ph = 'fight'; s.phT = 0; s.mode = 'stand'; s.gr = null;
      if (s.clock > 0) banner(s, startWord(s), PAL.white, .8);
      s.ref.act = 'start'; s.ref.t = 0;
      if (s.clock <= 0) timeUp(s, R);
    }
  }

  /* ------------------------------------------------------------------ *
   * CPU vs CPU result
   * ------------------------------------------------------------------ */
  function cpuMatch(ev, a, b, R) {
    const k = ev.cfg.kind;
    const w = OG.cpuDuel(a, b, R);
    const gap = Math.abs(a.skill - b.skill);
    const r = R.f();
    const pts = (base, spread, lo) => {
      const W = base + R.int(0, spread), L = Math.max(0, Math.min(W - 1, lo + R.int(0, Math.max(1, Math.round(base * (1 - gap) * .8)))));
      return W + ' : ' + L;
    };
    let text;
    switch (k) {
      case 'judo': text = r < .45 + gap * .5 ? '한판승' : r < .8 ? '절반승' : r < .9 ? '골든스코어승' : '지도승'; break;
      case 'kurash': text = r < .45 + gap * .5 ? '할랄승' : r < .85 ? 'Y1 C' + R.int(0, 2) + ' 승' : '판정 2:1'; break;
      case 'wrestle': text = r < .2 + gap * .4 ? '폴승' : r < .45 + gap * .3 ? (10 + R.int(0, 3)) + ' : ' + R.int(0, 2) : pts(3, 6, 0); break;
      case 'box': text = r < .18 + gap * .5 ? (R.chance(.6) ? 'KO승' : 'TKO승') : (R.chance(.65) ? '판정 3:0' : '판정 2:1'); break;
      case 'tkd': text = r < .15 + gap * .4 ? (12 + R.int(0, 6)) + ' : ' + R.int(0, 6) : pts(8, 9, 3); break;
      case 'fence': text = '8 : ' + R.int(Math.max(0, 4 - Math.round(gap * 10)), 7); break;
      case 'karate': text = r < .2 + gap * .4 ? (8 + R.int(0, 3)) + ' : ' + R.int(0, 2) : pts(3, 4, 0); break;
      case 'sanda': text = r < .12 + gap * .3 ? 'KO승' : pts(5, 6, 1); break;
      case 'bjj': text = r < .25 + gap * .5 ? '서브미션승' : pts(4, 8, 0); break;
      case 'mma': text = r < .2 + gap * .3 ? 'KO승' : r < .35 + gap * .4 ? 'TKO승' : r < .5 + gap * .4 ? '서브미션승' : (R.chance(.6) ? '판정 3:0' : '판정 2:1'); break;
      case 'arcade': text = R.chance(.45 + gap) ? '2 : 0' : '2 : 1'; break;
      default: text = '승';
    }
    return { winner: w, text: text };
  }

  /* ================================================================== *
   * DRAWING
   * ================================================================== */
  const SEG = { thigh: 5.5, shin: 5.5, torso: 8, uarm: 4.2, farm: 4.2, head: 2.6 };
  function joints(x, y, pose, f, s, anchor) {
    const rot = pose.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const tf = (lx, ly) => [lx * cr - ly * sr, lx * sr + ly * cr];
    const dir = (a, l) => [Math.sin(a) * l, Math.cos(a) * l];
    const t = pose.t || 0;
    const neck = [Math.sin(t) * SEG.torso, -Math.cos(t) * SEG.torso];
    const sh = [neck[0] * .92, neck[1] * .92];
    const limb = (b, a1, l1, a2, l2) => { const d1 = dir(a1, l1), j1 = [b[0] + d1[0], b[1] + d1[1]], d2 = dir(a2, l2); return [j1, [j1[0] + d2[0], j1[1] + d2[1]]]; };
    const aL = (pose.aL || 0) + t, aR = (pose.aR || 0) + t;
    const armL = limb(sh, aL, SEG.uarm, aL + (pose.eL || 0), SEG.farm);
    const armR = limb(sh, aR, SEG.uarm, aR + (pose.eR || 0), SEG.farm);
    const lL = pose.lL || 0, lR = pose.lR || 0;
    const legL = limb([0, 0], lL, SEG.thigh, lL - (pose.kL || 0), SEG.shin);
    const legR = limb([0, 0], lR, SEG.thigh, lR - (pose.kR || 0), SEG.shin);
    const ha = t + (pose.h || 0);
    const hd = [neck[0] + Math.sin(ha) * (SEG.head + .6), neck[1] - Math.cos(ha) * (SEG.head + .6)];
    const pts = { neck: neck, sh: sh, head: hd, elL: armL[0], hdL: armL[1], elR: armR[0], hdR: armR[1], knL: legL[0], ftL: legL[1], knR: legR[0], ftR: legR[1] };
    const J = {};
    for (const key in pts) { const p = tf(pts[key][0], pts[key][1]); J[key] = [p[0] * f * s, p[1] * s]; }
    let hy = y;
    if (anchor !== 'hip') {
      const low = Math.max(J.ftL[1], J.ftR[1], J.head[1] + SEG.head * s, J.hdL[1], J.hdR[1], J.knL[1], J.knR[1]);
      hy = y - low - 1;
    }
    for (const key in J) { J[key][0] += x; J[key][1] += hy; }
    J.hip = [x, hy];
    J.f = f; J.s = s; J.rot = rot;
    return J;
  }
  function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

  /* Procedural fighter with outlines and sport outfits.
   * o: {skin,hair, top, ua (upper arm), fa (forearm), sh (shorts), th (thigh), sn (shin), shoe,
   *     belt, glove, gr (glove radius), head:'hair'|'gear'|'mask'|'band', gear, band, hogu, hl (hogu lit), lapel, flash, sabre} */
  function drawFig(g, x, y, pose, o, opt) {
    const f = opt.face || 1, s = opt.scale || 2;
    const J = joints(x, y, pose, f, s, opt.anchor);
    const T = Math.max(2, Math.round(2 * s)), TT = Math.max(3, Math.round(3 * s)) + (o.bulk || 0);
    const W = o.flash ? '#ffffff' : null;
    const C = col => W || col;
    const D = col => W || OG.shade(col, -0.3);
    const out = W ? '#ffffff' : (o.out || INK);
    const L = (a, b, col, th) => g.line(a[0], a[1], b[0], b[1], col, th);
    const hr = Math.round(SEG.head * s);
    const gr = o.glove ? Math.round(o.gr || 3) : 0;
    const vt = norm([J.neck[0] - J.hip[0], J.neck[1] - J.hip[1]]);
    const foot = (k, a, col) => {
      const ft = J['ft' + k], kn = J['kn' + k];
      const sv = norm([ft[0] - kn[0], ft[1] - kn[1]]);
      const fw = [-sv[1] * f, sv[0] * f];
      const fx = fw[0] > 0 ? 1 : -1;
      g.line(ft[0], ft[1], ft[0] + fw[0] * 2.5 * s * (fx === Math.sign(fw[0]) ? 1 : 1), ft[1] + fw[1] * 2.5 * s, col, Math.max(2, s));
    };
    // ---- outline pass
    L(J.hip, J.knL, out, T + 2); L(J.knL, J.ftL, out, T + 2);
    L(J.sh, J.elL, out, T + 2); L(J.elL, J.hdL, out, T + 2);
    L(J.hip, J.knR, out, T + 2); L(J.knR, J.ftR, out, T + 2);
    L(J.sh, J.elR, out, T + 2); L(J.elR, J.hdR, out, T + 2);
    L(J.hip, J.neck, out, TT + 2);
    foot('L', 0, out); foot('R', 0, out);
    g.circle(J.head[0], J.head[1], hr + 1, out);
    if (gr) { g.circle(J.hdL[0], J.hdL[1], gr + 1, out); g.circle(J.hdR[0], J.hdR[1], gr + 1, out); }
    // ---- back limbs
    L(J.hip, J.knL, D(o.th), T); L(J.knL, J.ftL, D(o.sn), T); foot('L', 0, D(o.shoe));
    L(J.sh, J.elL, D(o.ua), T); L(J.elL, J.hdL, D(o.fa), T);
    if (gr) g.circle(J.hdL[0], J.hdL[1], gr, D(o.glove));
    // ---- torso
    L(J.hip, J.neck, C(o.top), TT);
    if (o.lapel && !W) {
      const a = [J.neck[0] + vt[1] * f * -1, J.neck[1] - vt[0] * f * -1];
      g.line(J.neck[0], J.neck[1], J.hip[0] + vt[0] * 3 * s + f * 1, J.hip[1] + vt[1] * 3 * s, OG.shade(o.top, -0.22), 1);
      g.px(a[0], a[1], OG.shade(o.top, -0.22));
    }
    if (o.hogu) {
      const h0 = [J.hip[0] + vt[0] * 2 * s, J.hip[1] + vt[1] * 2 * s], h1 = [J.hip[0] + vt[0] * 6.6 * s, J.hip[1] + vt[1] * 6.6 * s];
      L(h0, h1, W || (o.hl ? '#fff6a0' : o.hogu), TT + 1);
      g.line(h0[0] + f, h0[1], h1[0] + f, h1[1], W || (o.hl ? '#ffffff' : OG.shade(o.hogu, .3)), 1);
    }
    if (o.lame) {
      const h0 = [J.hip[0] + vt[0] * 2.2 * s, J.hip[1] + vt[1] * 2.2 * s];
      L(h0, J.sh, C(o.lame), TT);
      g.line(h0[0] + f, h0[1], J.sh[0] + f, J.sh[1], W || '#eef2f8', 1);
    }
    // shorts block
    g.circle(J.hip[0], J.hip[1], Math.max(2, s * 1.6), C(o.sh));
    if (o.belt) {
      const bc = [J.hip[0] + vt[0] * 1.6 * s, J.hip[1] + vt[1] * 1.6 * s];
      const p = [vt[1], -vt[0]];
      g.line(bc[0] - p[0] * 3.4, bc[1] - p[1] * 3.4, bc[0] + p[0] * 3.4, bc[1] + p[1] * 3.4, C(o.belt), 2);
      g.rect(bc[0] + f * 3 - (f < 0 ? 1 : 0), bc[1], 1, 3, C(o.belt));
    }
    // ---- front leg
    L(J.hip, J.knR, C(o.th), T); L(J.knR, J.ftR, C(o.sn), T); foot('R', 0, C(o.shoe));
    // ---- head
    g.circle(J.head[0], J.head[1], hr, C(o.skin));
    const u = norm([J.head[0] - J.neck[0], J.head[1] - J.neck[1]]);
    const bk = [u[1] * f, -u[0] * f];
    const head = o.head || 'hair';
    if (head === 'mask') {
      g.circle(J.head[0], J.head[1], hr, W || '#3a3f4c');
      for (let i = -hr; i <= hr; i++) for (let j = -hr; j <= hr; j++) {
        if (i * i + j * j > hr * hr) continue;
        const fr = -(i * bk[0] + j * bk[1]);
        if (fr > hr * .1 && (i + j) % 2 === 0) g.px(J.head[0] + i, J.head[1] + j, W || '#6d7486');
        if (fr < -hr * .45) g.px(J.head[0] + i, J.head[1] + j, W || o.band || '#e8e8e8');
      }
      // bib
      g.line(J.head[0] - bk[0] * 2 + u[0] * -hr, J.head[1] - bk[1] * 2 - u[1] * hr, J.head[0] - bk[0] * hr * .2 - u[0] * (hr + 2), J.head[1] - bk[1] * hr * .2 - u[1] * (hr + 2), W || '#f4f4f4', 2);
    } else {
      const hc = head === 'gear' ? o.gear : (o.hair || PAL.black);
      for (let i = -hr; i <= hr; i++) for (let j = -hr; j <= hr; j++) {
        if (i * i + j * j > hr * hr + .5) continue;
        const du = i * u[0] + j * u[1], db = i * bk[0] + j * bk[1];
        if (head === 'gear') {
          if (du > hr * .05 || db > -hr * .1 || du < -hr * .65) g.px(J.head[0] + i, J.head[1] + j, W || hc);
        } else if (du > hr * .2 || (db > hr * .3 && du > -hr * .45)) g.px(J.head[0] + i, J.head[1] + j, W || hc);
      }
      if (head === 'band') {
        const bcx = J.head[0] + u[0] * hr * .3, bcy = J.head[1] + u[1] * hr * .3;
        g.line(bcx - bk[0] * hr, bcy - bk[1] * hr, bcx + bk[0] * hr, bcy + bk[1] * hr, W || o.band, 2);
        const tl = Math.sin((opt.t || 0) * 9) * 1.5;
        g.line(bcx + bk[0] * hr, bcy + bk[1] * hr, bcx + bk[0] * (hr + 5), bcy + bk[1] * (hr + 5) + 2 + tl, W || o.band, 1);
      }
      if (head === 'gear') g.px(J.head[0] + u[0] * (hr - 1), J.head[1] + u[1] * (hr - 1), W || OG.shade(hc, .4));
      // eye
      if (!W) g.px(J.head[0] - bk[0] * hr * .5 + u[0] * .6, J.head[1] - bk[1] * hr * .5 + u[1] * .6, INK);
    }
    // ---- front arm
    L(J.sh, J.elR, C(o.ua), T); L(J.elR, J.hdR, C(o.fa), T);
    if (gr) { g.circle(J.hdR[0], J.hdR[1], gr, C(o.glove)); g.px(J.hdR[0] - 1, J.hdR[1] - 1, W || OG.shade(o.glove, .45)); }
    if (o.sabre) {
      const sd = norm([J.hdR[0] - J.elR[0], J.hdR[1] - J.elR[1]]);
      const ang = o.sabreA != null ? o.sabreA : 0;
      const ca = Math.cos(ang * f), sa = Math.sin(ang * f);
      const dv = [sd[0] * ca - sd[1] * sa, sd[0] * sa + sd[1] * ca];
      const tip = [J.hdR[0] + dv[0] * 26, J.hdR[1] + dv[1] * 26];
      g.line(J.hdR[0], J.hdR[1], tip[0], tip[1], W || '#dfe6ee', 1);
      g.line(J.hdR[0] + dv[0] * 2, J.hdR[1] + dv[1] * 2, tip[0] - dv[0] * 4, tip[1] - dv[1] * 4, W || '#9aa6b5', 1);
      g.circle(J.hdR[0] + dv[0] * 1.5, J.hdR[1] + dv[1] * 1.5, 2, W || '#c8ccd4');
      J.tip = tip;
    }
    return J;
  }

  const PZ = {
    gStrike: { t: .12, h: -.1, aL: 1.2, aR: .75, eL: 2.1, eR: 2.0, lL: .42, lR: -.34, kL: .3, kR: .2 },
    gBox: { t: .24, h: -.2, aL: .95, aR: .7, eL: 2.5, eR: 2.5, lL: .38, lR: -.3, kL: .4, kR: .26 },
    gTkd: { t: .04, aL: .8, aR: .45, eL: 1.9, eR: 1.7, lL: .3, lR: -.36, kL: .16, kR: .12 },
    gGrap: { t: .42, h: -.3, aL: 1.25, aR: 1.0, eL: .9, eR: 1.0, lL: .48, lR: -.3, kL: .62, kR: .42 },
    gWres: { t: .78, h: -.65, aL: 1.0, aR: .85, eL: .9, eR: 1.0, lL: .85, lR: -.25, kL: 1.35, kR: .85 },
    gFence: { t: .04, aL: -.55, aR: 1.0, eL: -1.9, eR: .5, lL: .65, lR: -.6, kL: .9, kR: .3 },
    gArc: { t: .15, h: -.1, aL: 1.1, aR: .75, eL: 2.2, eR: 2.0, lL: .5, lR: -.42, kL: .45, kR: .3 },
    jab: { t: .28, h: -.2, aL: 1.0, aR: 1.42, eL: 2.2, eR: .05, lL: .5, lR: -.45, kL: .4, kR: .15 },
    cross: { t: .45, h: -.35, aL: .9, aR: 1.2, eL: 2.3, eR: 0, lL: .6, lR: -.6, kL: .5, kR: .05 },
    hook: { t: .3, h: -.2, aL: 1.0, aR: 1.6, eL: 2.3, eR: 1.3, lL: .5, lR: -.45, kL: .45, kR: .2 },
    upper: { t: -.05, h: .1, aL: 1.0, aR: 1.2, eL: 2.4, eR: 2.1, lL: .4, lR: -.35, kL: .55, kR: .35 },
    body: { t: .75, h: -.7, aL: .9, aR: .95, eL: 2.3, eR: .1, lL: .85, lR: -.4, kL: 1.2, kR: .5 },
    kick: { t: -.5, h: .3, aL: 1.3, aR: .5, eL: 1.7, eR: 1.4, lL: -.22, lR: 1.65, kL: .1, kR: .1 },
    hkick: { t: -.8, h: .6, aL: 1.0, aR: .3, eL: 1.7, eR: 1.4, lL: -.12, lR: 2.35, kL: .05, kR: 0 },
    push: { t: -.3, h: .2, aL: 1.2, aR: .7, eL: 1.9, eR: 1.6, lL: -.1, lR: 1.5, kL: .15, kR: .3 },
    side: { t: -.75, h: .55, aL: 1.0, aR: .4, eL: 1.8, eR: 1.4, lL: -.15, lR: 1.78, kL: .05, kR: 0 },
    spin: { t: .85, h: -.5, aL: .5, aR: .2, eL: 1.2, eR: 1.0, lL: .2, lR: -1.7, kL: .3, kR: 0 },
    spinh: { t: 1.05, h: -.8, aL: .4, aR: .2, eL: 1.2, eR: 1.0, lL: .25, lR: -2.4, kL: .3, kR: 0 },
    jkick: { t: -.35, aL: 1.6, aR: .8, eL: 1.2, eR: 1.4, lL: .9, lR: 1.6, kL: 1.9, kR: .1 },
    sweep: { t: .55, h: -.4, aL: 1.6, aR: .6, eL: 1.0, eR: 1.4, lL: 1.55, lR: 1.45, kL: 2.5, kR: 0 },
    finish: { t: .95, h: -.6, aL: .8, aR: 1.05, eL: 2, eR: .1, lL: 1.2, lR: .3, kL: 2.0, kR: 1.4 },
    reach: { t: .5, h: -.4, aL: 1.45, aR: 1.5, eL: .3, eR: .15, lL: .6, lR: -.35, kL: .6, kR: .25 },
    shoot: { t: 1.25, h: -1.0, aL: 1.0, aR: 1.15, eL: .4, eR: .2, lL: 1.4, lR: -.5, kL: 1.9, kR: .4 },
    cut: { t: .2, aL: -.6, aR: 1.75, eL: -1.8, eR: 0, lL: .8, lR: -.6, kL: .9, kR: .2 },
    cuth: { t: .15, aL: -.6, aR: 2.1, eL: -1.8, eR: -.3, lL: .7, lR: -.55, kL: .85, kR: .25 },
    lunge: { t: .3, aL: -1.2, aR: 1.42, eL: -.4, eR: 0, lL: 1.05, lR: -.95, kL: 1.15, kR: .05 },
    fleche: { t: .55, aL: -.9, aR: 1.25, eL: -.4, eR: 0, lL: -.6, lR: 1.1, kL: 1.4, kR: .4 },
    fireball: { t: .35, h: -.3, aL: 1.35, aR: 1.4, eL: .15, eR: 0, lL: .65, lR: -.6, kL: .55, kR: .1 },
    hit: { t: -.35, h: .35, aL: .5, aR: .2, eL: .8, eR: .9, lL: .25, lR: -.35, kL: .35, kR: .25 },
    down: { rot: -PI / 2, t: 0, h: .2, aL: 2.6, aR: .5, eL: .3, eR: .4, lL: .25, lR: -.05, kL: .4, kR: .1 },
    sitDown: { t: -.25, h: .2, aL: -.6, aR: -.5, eL: .2, eR: .3, lL: 1.45, lR: 1.3, kL: .3, kR: 1.2 },
    bBlock: { t: .32, h: .25, aL: .65, aR: .55, eL: 2.75, eR: 2.85, lL: .42, lR: -.3, kL: .5, kR: .35 },
    gBlock: { t: .08, h: .1, aL: 1.1, aR: .55, eL: 2.4, eR: 2.0, lL: .45, lR: -.4, kL: .5, kR: .35 },
    jigo: { t: .55, h: -.4, aL: 1.0, aR: .85, eL: .8, eR: .7, lL: .8, lR: -.6, kL: 1.1, kR: .8 },
    sprawl: { t: 1.3, h: -.9, aL: .25, aR: .45, eL: .3, eR: .3, lL: -.55, lR: -.95, kL: .2, kR: .1 },
    parry: { t: .02, aL: -.5, aR: 1.5, eL: -2.0, eR: 1.7, lL: .55, lR: -.65, kL: .9, kR: .35 },
    duck: { t: .95, h: -.6, aL: .8, aR: .6, eL: 2.6, eR: 2.7, lL: .95, lR: -.15, kL: 1.6, kR: .9 },
    crouch: { t: .45, h: -.3, aL: 1.0, aR: .7, eL: 2.3, eR: 2.2, lL: 1.35, lR: .95, kL: 2.3, kR: 1.9 },
    jump: { t: .1, aL: 1.2, aR: .9, eL: 1.8, eR: 1.6, lL: 1.2, lR: .6, kL: 1.9, kR: 1.4 },
    grip: { t: .45, h: -.35, aL: 1.35, aR: 1.62, eL: .55, eR: .25, lL: .55, lR: -.35, kL: .55, kR: .3 },
    wind: { t: -.05, aL: 1.0, aR: -.4, eL: 2.2, eR: 1.6, lL: .45, lR: -.45, kL: .35, kR: .3 },
    tOver: { t: 1.15, h: -.6, aL: 1.6, aR: 1.1, eL: .5, eR: 1.0, lL: .35, lR: -.15, kL: 1.0, kR: .6 },
    tReap: { t: .6, h: -.3, aL: 1.7, aR: 1.3, eL: .4, eR: .7, lL: .1, lR: -1.3, kL: .2, kR: .1 },
    tLift: { t: -.55, h: .6, aL: 2.4, aR: 2.6, eL: .6, eR: .4, lL: .35, lR: -.2, kL: .7, kR: .5 },
    tTackle: { t: 1.35, h: -1.1, aL: 1.3, aR: 1.5, eL: .4, eR: .3, lL: 1.1, lR: -.3, kL: 1.9, kR: .6 },
    uke: { t: -.2, h: .4, aL: 2.2, aR: 1.8, eL: .5, eR: .4, lL: .35, lR: -.3, kL: .3, kR: .2 },
    lieGuard: { rot: -PI / 2, t: 0, h: .3, aL: 2.0, aR: 1.6, eL: .8, eR: 1.0, lL: 1.35, lR: 1.6, kL: 2.0, kR: 1.8 },
    lieFlat: { rot: -PI / 2, t: 0, h: .2, aL: 2.4, aR: 1.2, eL: .6, eR: 1.0, lL: .1, lR: .35, kL: .1, kR: .6 },
    kneel: { t: .3, h: -.2, aL: .9, aR: .7, eL: .6, eR: .5, lL: .05, lR: .25, kL: 1.65, kR: 1.6 },
    mount: { t: .15, h: -.1, aL: 1.6, aR: 1.0, eL: 1.3, eR: 1.6, lL: 1.0, lR: 1.25, kL: 2.6, kR: 2.7 },
    sideCtl: { rot: PI / 2, t: -.15, h: -.4, aL: 1.0, aR: 1.25, eL: 1.3, eR: 1.1, lL: 1.45, lR: 1.65, kL: 1.5, kR: 1.6 },
    allFours: { rot: PI / 2, t: -.25, h: -.5, aL: 1.85, aR: 1.75, eL: .3, eR: .3, lL: PI / 2, lR: PI / 2, kL: PI / 2, kR: PI / 2 },
    parTop: { t: 1.0, h: -.6, aL: .3, aR: .1, eL: .9, eR: 1.1, lL: .2, lR: .5, kL: 1.8, kR: 1.6 },
    sitBack: { t: -.1, aL: 1.2, aR: 1.0, eL: .6, eR: .8, lL: 1.5, lR: 1.4, kL: .6, kR: .7 },
    backTop: { t: .25, aL: 1.4, aR: 1.25, eL: 1.8, eR: 2.0, lL: 1.5, lR: 1.35, kL: .8, kR: .9 },
    refStand: { t: 0, h: 0, aL: .1, aR: -.1, eL: .2, eR: .2, lL: .1, lR: -.1, kL: 0, kR: 0 },
    refStop: { t: .05, aL: 1.5, aR: 1.6, eL: 0, eR: 0, lL: .2, lR: -.2, kL: .1, kR: 0 },
    refStart: { t: .1, aL: .2, aR: 1.0, eL: .2, eR: 0, lL: .2, lR: -.2, kL: .1, kR: 0 },
    refUp: { t: -.05, aL: .1, aR: PI - .15, eL: .2, eR: 0, lL: .12, lR: -.12, kL: 0, kR: 0 },
    refSide: { t: 0, aL: .1, aR: 1.6, eL: .2, eR: 0, lL: .12, lR: -.12, kL: 0, kR: 0 },
    refCount: { t: .35, aL: .3, aR: 1.3, eL: .3, eR: 1.2, lL: .5, lR: -.2, kL: .6, kR: .2 }
  };
  const mix = OG.Pose.mix;
  function stanceOf(k) {
    return { box: PZ.gBox, mma: PZ.gBox, tkd: PZ.gTkd, fence: PZ.gFence, judo: PZ.gGrap, kurash: PZ.gGrap, bjj: PZ.gGrap, wrestle: PZ.gWres, arcade: PZ.gArc }[k] || PZ.gStrike;
  }
  function bob(p, t, k) {
    const o = Object.assign({}, p);
    const b = Math.sin(t * (k === 'tkd' ? 9 : k === 'box' || k === 'arcade' ? 7 : 4));
    o.kL = (o.kL || 0) + b * .12; o.kR = (o.kR || 0) + b * .1; o.lL = (o.lL || 0) + b * .05;
    o.eL = (o.eL || 0) + b * .06;
    return o;
  }
  function fighterPose(s, i) {
    const F = s.f[i], k = s.kind, kd = KD[k];
    const t = s.t + i * .37;
    const st = bob(stanceOf(k), t, k);
    let p = st, f = F.face, y = kd.FY - F.y;
    let sabreA = 0;
    switch (F.st) {
      case 'walk': {
        const ph = Math.sin(F.stT * 11) * .28 * (F.wd || 1);
        p = Object.assign({}, st); p.lL += ph; p.lR -= ph; p.kL += Math.max(0, ph) * .8; p.kR += Math.max(0, -ph) * .8;
        break;
      }
      case 'block':
        p = k === 'box' || k === 'mma' || k === 'sanda' ? PZ.bBlock : k === 'fence' ? PZ.parry : k === 'arcade' ? PZ.crouch : (kd.grip && !MV[k].T.dmg) ? PZ.jigo : PZ.gBlock;
        if (F.spr > 0) p = PZ.sprawl;
        if (k === 'fence') sabreA = -1.2;
        break;
      case 'sblock': p = PZ.bBlock; break;
      case 'duck': p = PZ.duck; break;
      case 'jump': p = F.vy > 0 ? PZ.jump : mix(PZ.jump, st, .4); break;
      case 'atk': {
        const m = F.mv;
        if (!m) break;
        const d = MV[k][m.k];
        const S = d.st * m.sl, A = d.ac, Rr = d.rc * (m.wh ? 1.6 : 1) * m.sl;
        const a = m.t < S ? M.easeOut(m.t / S) : m.t < S + A ? 1 : Math.max(0, 1 - (m.t - S - A) / Rr);
        let tgt = PZ[d.p] || PZ.jab;
        if (d.spin) {
          if (m.t > S * .45 && m.t < S + A + Rr * .45) { f = -F.face; p = mix(PZ.gStrike, tgt, a); }
          else p = mix(st, PZ.gStrike, a * .6);
        } else if (d.p === 'fleche') {
          const r = OG.Pose.run(m.t * 3.2, 1);
          p = mix(r, tgt, m.t < S + A ? .6 : a);
        } else p = mix(st, tgt, a);
        if (d.p === 'jkick') { p = mix(PZ.jump, PZ.jkick, a); }
        if (k === 'fence') sabreA = d.p === 'cut' || d.p === 'cuth' ? (1 - a) * -1.8 : 0;
        break;
      }
      case 'hit': p = mix(st, PZ.hit, Math.min(1, F.hs * 6 + .3)); break;
      case 'down': p = PZ.down; break;
      case 'fall': p = PZ.down; break;
      case 'win': p = OG.Pose.celebrate(F.stT * 1.5); break;
      case 'lose': p = OG.Pose.sad(); break;
    }
    if (F.aT >= CH && F.st !== 'atk' && free(F)) p = mix(p, PZ.wind, .55);
    if (k === 'fence' && F.st !== 'atk' && F.st !== 'block' && F.st !== 'down') sabreA = -.35;
    return { p: p, x: F.x, y: y, f: f, sabreA: sabreA };
  }

  function outfit(s, i) {
    const e = s.ents[i], b = OG.lookOf(e), k = s.kind, F = s.f[i];
    const o = { skin: b.skin, hair: b.hair, top: b.shirt, ua: b.shirt, fa: b.skin, sh: b.pants, th: b.pants, sn: b.skin, shoe: b.skin, head: 'hair' };
    const gi = (c, extra) => Object.assign(o, { top: c, ua: c, fa: c, sh: c, th: c, sn: c, lapel: 1, bulk: 1 }, extra || {});
    switch (k) {
      case 'judo': gi(i ? '#2b5cd8' : WHITE, { belt: '#1a1a22' }); break;
      case 'bjj': gi(i ? '#24398a' : WHITE, { belt: '#1a1a22' }); break;
      case 'karate': gi(WHITE, { belt: i ? BLUE : RED, glove: i ? BLUE : RED, gr: 2 }); break;
      case 'kurash': gi(i ? '#2b62c8' : '#2e9a52', { sh: WHITE, th: WHITE, sn: WHITE, belt: '#e43b44' }); break;
      case 'tkd': gi(WHITE, { hogu: i ? BLUE : RED, hl: F.hl > 0 ? 1 : 0, head: 'gear', gear: i ? BLUE : RED, bulk: 0 }); break;
      case 'wrestle': { const c = i ? BLUE : RED; Object.assign(o, { top: c, ua: o.skin, fa: o.skin, sh: c, th: c, sn: o.skin, shoe: '#e8e8ee' }); break; }
      case 'box': Object.assign(o, { top: b.shirt, ua: b.shirt, fa: o.skin, sh: b.pants, th: b.pants, sn: o.skin, shoe: '#1a1a22', glove: i ? BLUE : RED, gr: 3.5 }); break;
      case 'mma': Object.assign(o, { top: b.shirt, ua: b.shirt, fa: o.skin, sh: b.pants, th: b.pants, sn: o.skin, glove: i ? BLUE : RED, gr: 2.5 }); break;
      case 'sanda': { const c = i ? '#2a2e40' : RED; Object.assign(o, { top: c, ua: o.skin, fa: o.skin, sh: c, th: c, sn: o.skin, glove: c, gr: 3.5, head: 'gear', gear: c }); break; }
      case 'fence': Object.assign(o, { top: WHITE, ua: WHITE, fa: WHITE, sh: WHITE, th: WHITE, sn: b.shirt, shoe: '#e8e8ee', head: 'mask', band: b.shirt, lame: '#c3c9d4', sabre: 1 }); break;
      case 'arcade': Object.assign(o, { top: b.shirt, ua: b.shirt, fa: o.skin, sh: b.shirt, th: b.shirt, sn: b.shirt, shoe: o.skin, belt: '#1a1a22', head: 'band', band: b.pants === b.shirt ? WHITE : b.pants, lapel: 1, bulk: 1 }); break;
    }
    o.flash = F.flash > 0 && Math.floor(F.flash * 40) % 2 === 0 ? 1 : 0;
    return o;
  }
  function refOutfit(s) {
    const k = s.kind;
    const base = { skin: PAL.skin2, hair: '#3e2731', fa: PAL.skin2, shoe: '#1a1a22', head: 'hair' };
    if (k === 'box') return Object.assign(base, { top: '#f2f2f2', ua: '#f2f2f2', sh: '#1a1a22', th: '#1a1a22', sn: '#1a1a22', belt: '#1a1a22' });
    if (k === 'wrestle') return Object.assign(base, { top: '#f2f2f2', ua: '#f2f2f2', sh: '#22242c', th: '#22242c', sn: '#22242c' });
    if (k === 'mma') return Object.assign(base, { top: '#1f2128', ua: '#1f2128', sh: '#1f2128', th: '#1f2128', sn: '#1f2128', glove: '#3a3f4c', gr: 1.5 });
    if (k === 'sanda' || k === 'tkd') return Object.assign(base, { top: '#1f3770', ua: '#1f3770', fa: '#1f3770', sh: '#22242c', th: '#22242c', sn: '#22242c' });
    return Object.assign(base, { top: '#262a36', ua: '#262a36', fa: '#262a36', sh: '#262a36', th: '#262a36', sn: '#262a36', lapel: 1 });
  }

  /* --------------------------- venues -------------------------------- */
  function pX(x, y, FY) { return 240 + (x - 240) * (1 + (y - FY) * 0.0042); }
  function quad(g, xa, xb, y0, y1, FY, c) { g.poly([pX(xa, y0, FY), y0, pX(xb, y0, FY), y0, pX(xb, y1, FY), y1, pX(xa, y1, FY), y1], c); }
  function vline(g, x, y0, y1, FY, c) { g.line(pX(x, y0, FY), y0, pX(x, y1, FY), y1, c, 1); }
  function hall(g, s, o) {
    o = o || {};
    g.grad(0, 31, 480, 126, o.w1 || '#0b0d1e', o.w2 || '#1d2242', 7);
    g.crowd(0, 40, 480, 64, g.t, { excite: s.ex || 0, seed: o.seed || 7, density: .84, bg: o.seat || '#252a45', step: 5 });
    g.alpha(.3); g.rect(0, 40, 480, 64, '#05060f'); g.alpha(1);
    g.rect(0, 104, 480, 2, '#5a6988');
    g.adBoards(0, 106, 480, 11, g.t, o.ads);
    g.grad(0, 117, 480, 40, o.w3 || '#141831', o.w4 || '#1d2342', 4);
    g.alpha(.05);
    for (let i = 0; i < 3; i++) { const x = 100 + i * 140; g.poly([x - 8, 31, x + 8, 31, x + 80, 170, x - 80, 170], '#ffffff'); }
    g.alpha(1);
  }
  function screenBoard(g, x, y, w, h, title) {
    g.rect(x - 1, y - 1, w + 2, h + 2, '#05060f');
    g.rect(x, y, w, h, '#101528');
    g.rectO(x, y, w, h, '#3a4466');
    g.text(title, x + w / 2, y + 2, PAL.gold, { size: 'xs', align: 'center' });
  }

  function vTatami(g, s, mat, safe, seam, ads, ornament) {
    const FY = KD[s.kind].FY;
    hall(g, s, { ads: ads });
    g.rect(0, 156, 480, 114, safe);
    // safety area seams
    for (let x = -200; x <= 680; x += 28) vline(g, x, 157, 270, FY, OG.shade(safe, -0.12));
    for (const y of [176, 204, 238]) g.rect(0, y, 480, 1, OG.shade(safe, -0.12));
    quad(g, KD[s.kind].L - 14, KD[s.kind].R + 14, 166, 262, FY, mat);
    for (let x = KD[s.kind].L - 14; x <= KD[s.kind].R + 14; x += 28) vline(g, x, 166, 262, FY, OG.shade(mat, -0.1));
    for (const y of [180, 198, 222, 248]) g.line(pX(KD[s.kind].L - 14, y, FY), y, pX(KD[s.kind].R + 14, y, FY), y, OG.shade(mat, -0.1), 1);
    if (ornament) ornament(g, s);
    // front edge shade
    g.rect(0, 262, 480, 8, OG.shade(safe, -0.25));
    // start marks
    g.rect(pX(mark(s, 0), FY + 4, FY) - 4, FY + 4, 8, 2, '#f4f4f4');
    g.rect(pX(mark(s, 1), FY + 4, FY) - 4, FY + 4, 8, 2, '#3a7bf0');
  }
  function vJudo(g, s) {
    vTatami(g, s, '#e8c652', '#2d5db0', 0, ['JUDO', 'AICHI-NAGOYA 2026', 'IJF', 'DOT GAMES']);
    screenBoard(g, 8, 120, 60, 30, 'JUDO');
    screenBoard(g, 412, 120, 60, 30, '柔道');
  }
  function vKurash(g, s) {
    const FY = KD.kurash.FY;
    vTatami(g, s, '#21a9a6', '#21396e', 0, ['KURASH', 'AICHI-NAGOYA 2026', 'UZBEK SPIRIT', 'DOT GAMES'], (g2) => {
      // ikat style ornamental border
      const y0 = 168, y1 = 258;
      for (let x = KD.kurash.L - 12; x < KD.kurash.R + 12; x += 10) {
        g2.poly([pX(x, y0, FY), y0, pX(x + 5, y0, FY), y0 + 4, pX(x + 10, y0, FY), y0], '#f2c14e');
        g2.poly([pX(x, y1, FY), y1, pX(x + 5, y1, FY), y1 - 5, pX(x + 10, y1, FY), y1], '#e2483d');
      }
    });
    // turquoise domes on the back wall
    for (let i = 0; i < 4; i++) {
      const x = 60 + i * 120;
      g.rect(x - 14, 128, 28, 28, '#1a3c6e'); g.circle(x, 128, 13, '#1fa3c0'); g.rect(x - 1, 112, 2, 4, '#f2c14e');
      g.rect(x - 5, 140, 10, 16, '#0f2448');
    }
  }
  function vBjj(g, s) {
    vTatami(g, s, '#3d4aa0', '#202544', 0, ['JU-JITSU NE-WAZA', 'AICHI-NAGOYA 2026', 'JJIF', 'DOT GAMES'], (g2) => {
      const FY = KD.bjj.FY;
      g2.line(pX(KD.bjj.L - 14, 166, FY), 166, pX(KD.bjj.R + 14, 166, FY), 166, '#feae34', 1);
      g2.line(pX(KD.bjj.L - 14, 262, FY), 262, pX(KD.bjj.R + 14, 262, FY), 262, '#feae34', 2);
    });
  }
  function vKarate(g, s) {
    const FY = KD.karate.FY;
    vTatami(g, s, '#2a63c4', '#1b2f63', 0, ['KARATE', 'AICHI-NAGOYA 2026', 'WKF', 'DOT GAMES'], (g2) => {
      quad(g2, KD.karate.L - 14, KD.karate.R + 14, 166, 172, FY, '#d8343c');
      quad(g2, KD.karate.L - 14, KD.karate.R + 14, 256, 262, FY, '#d8343c');
      g2.poly([pX(KD.karate.L - 14, 166, FY), 166, pX(KD.karate.L, 166, FY), 166, pX(KD.karate.L, 262, FY), 262, pX(KD.karate.L - 14, 262, FY), 262], '#d8343c');
      g2.poly([pX(KD.karate.R, 166, FY), 166, pX(KD.karate.R + 14, 166, FY), 166, pX(KD.karate.R + 14, 262, FY), 262, pX(KD.karate.R, 262, FY), 262], '#d8343c');
    });
    // corner judges with flags
    for (let j = 0; j < 2; j++) {
      const x = j ? 448 : 32, f = j ? -1 : 1;
      const raise = s.ph === 'stop' && s.last >= 0 && s.phT < 1.4;
      const pose = raise ? { t: 0, aL: .3, aR: (s.last === 0) === (j === 0) ? 2.6 : .3, eL: .2, eR: 0, lL: 1.5, lR: 1.4, kL: 1.5, kR: 1.4 } : { t: 0, aL: .4, aR: .4, eL: .3, eR: .3, lL: 1.5, lR: 1.4, kL: 1.5, kR: 1.4 };
      g.rect(x - 6, 168, 12, 3, '#3a3f4c'); g.rect(x - 5, 171, 2, 8, '#3a3f4c'); g.rect(x + 3, 171, 2, 8, '#3a3f4c');
      const J = drawFig(g, x, 178, pose, refOutfit(s), { face: f, scale: 1.5 });
      const fc = s.last === 1 ? BLUE : RED;
      if (raise) { g.line(J.hdR[0], J.hdR[1], J.hdR[0], J.hdR[1] - 8, '#c0cbdc', 1); g.rect(J.hdR[0] + (f > 0 ? 0 : -6), J.hdR[1] - 9, 6, 5, fc); }
    }
  }
  function vWrestle(g, s) {
    const FY = KD.wrestle.FY;
    hall(g, s, { ads: ['UWW WRESTLING', 'AICHI-NAGOYA 2026', 'FREESTYLE', 'DOT GAMES'] });
    g.rect(0, 156, 480, 114, '#1b2350');
    quad(g, 20, 460, 160, 270, FY, '#2a5bd0');
    g.ellipse(240, FY + 4, 186, 44, '#f07a2a');
    g.ellipse(240, FY + 4, 170, 39, '#e8b83c');
    g.ellipse(240, FY + 4, 152, 35, '#f2c94c');
    // inner circle
    g.ellipse(240, FY + 4, 32, 7, '#e86a2a');
    g.ellipse(240, FY + 4, 29, 6, '#f2c94c');
    g.rect(238, FY + 1, 4, 7, '#f4f4f4');
    g.rect(222, FY + 3, 10, 2, RED); g.rect(248, FY + 3, 10, 2, BLUE);
    g.text('UWW', 240, 248, 'rgba(255,255,255,0.35)', { size: 'b', align: 'center' });
    // corner pads
    g.rect(30, 238, 12, 6, RED); g.rect(438, 238, 12, 6, BLUE);
  }
  function vBox(g, s) {
    const FY = KD.box.FY;
    g.grad(0, 31, 480, 140, '#06070f', '#161a33', 6);
    g.crowd(0, 44, 480, 74, g.t, { excite: s.ex || 0, seed: 11, density: .8, bg: '#151933', step: 5 });
    g.alpha(.45); g.rect(0, 44, 480, 74, '#04050b'); g.alpha(1);
    // overhead light rig
    g.rect(80, 31, 320, 4, '#2a2f45');
    for (let i = 0; i < 6; i++) { g.rect(96 + i * 56, 34, 10, 4, '#fff7c2'); }
    g.alpha(.07); g.poly([90, 36, 390, 36, 470, 230, 10, 230], '#fff6c0'); g.alpha(1);
    // apron + canvas
    g.poly([34, 150, 446, 150, 474, 236, 6, 236], '#5d84b8');
    g.poly([40, 152, 440, 152, 466, 232, 14, 232], '#7ea4d4');
    g.alpha(.12); g.ellipse(240, 200, 140, 26, '#ffffff'); g.alpha(1);
    g.text('DOT BOXING', 240, 186, 'rgba(255,255,255,0.12)', { size: 'l', align: 'center' });
    g.rect(6, 236, 468, 26, '#1d2d58');
    g.rect(6, 236, 468, 2, '#2e4a8a');
    for (let i = 0; i < 6; i++) g.text('AICHI-NAGOYA 2026', 46 + i * 78, 247, 'rgba(255,255,255,0.35)', { size: 'xs', align: 'center' });
    // back ropes + posts
    const ropes = [104, 118, 132];
    g.rect(30, 92, 8, 62, RED); g.rect(442, 92, 8, 62, BLUE);
    g.rect(30, 92, 8, 3, OG.shade(RED, .3)); g.rect(442, 92, 8, 3, OG.shade(BLUE, .3));
    ropes.forEach((y, j) => { const c = j === 1 ? '#f4f4f4' : j === 0 ? RED : BLUE; g.rect(38, y, 404, 2, c); g.rect(38, y + 2, 404, 1, OG.shade(c, -0.4)); });
    // side ropes (front corners → back corners)
    for (let j = 0; j < 3; j++) {
      const c = j === 1 ? '#f4f4f4' : j === 0 ? RED : BLUE;
      g.line(34, ropes[j], 6, 176 + j * 16, c, 2); g.line(446, ropes[j], 474, 176 + j * 16, c, 2);
    }
    g.rect(0, 166, 10, 72, RED); g.rect(470, 166, 10, 72, BLUE);
    g.rect(0, 166, 10, 3, '#ff8a8f'); g.rect(470, 166, 10, 3, '#6aa0ff');
  }
  function vTkd(g, s) {
    const FY = KD.tkd.FY;
    hall(g, s, { ads: ['WORLD TAEKWONDO', 'AICHI-NAGOYA 2026', '태권도', 'DOT GAMES'], w1: '#0d0b1f', w2: '#221a44' });
    g.rect(0, 156, 480, 114, '#262a44');
    quad(g, 14, 466, 160, 270, FY, '#7d4bb8');
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = PI / 8 + k * PI / 4;
      pts.push(240 + Math.cos(a) * 190, FY + 4 + Math.sin(a) * 50);
    }
    g.poly(pts, '#2f7fe0');
    // boundary line
    for (let k = 0; k < 8; k++) {
      const a = PI / 8 + k * PI / 4, b = PI / 8 + (k + 1) * PI / 4;
      g.line(240 + Math.cos(a) * 190, FY + 4 + Math.sin(a) * 50, 240 + Math.cos(b) * 190, FY + 4 + Math.sin(b) * 50, '#ffffff', 1);
    }
    g.ellipse(240, FY + 4, 24, 6, '#5ea8ff');
    g.text('WT', 240, FY + 18, 'rgba(255,255,255,0.4)', { size: 'b', align: 'center' });
    // big screens
    screenBoard(g, 150, 120, 180, 32, 'TAEKWONDO');
    for (let i = 0; i < 2; i++) {
      g.rect(158 + i * 86, 132, 78, 17, i ? BLUE : RED);
      g.text(String(s.f[i].pts), 197 + i * 86, 133, '#fff', { size: 'b', align: 'center' });
    }
  }
  function vFence(g, s) {
    const FY = KD.fence.FY;
    hall(g, s, { ads: ['FIE FENCING', 'AICHI-NAGOYA 2026', 'SABRE', 'DOT GAMES'], w1: '#0a0d1c', w2: '#14193a' });
    g.rect(0, 156, 480, 114, '#121733');
    // scoring machine
    const lit0 = s.lamp[0] > 0, lit1 = s.lamp[1] > 0;
    g.rect(196, 118, 88, 34, '#05060f'); g.rectO(196, 118, 88, 34, '#3a4466');
    g.rect(200, 122, 30, 26, lit0 ? '#ff3b4a' : '#4a1418'); g.rect(250, 122, 30, 26, lit1 ? '#3bff6b' : '#123a1c');
    if (lit0) { g.alpha(.25); g.circle(215, 135, 30, '#ff3b4a'); g.alpha(1); }
    if (lit1) { g.alpha(.25); g.circle(265, 135, 30, '#3bff6b'); g.alpha(1); }
    g.text(String(s.f[0].pts), 215, 128, '#fff', { size: 'b', align: 'center' });
    g.text(String(s.f[1].pts), 265, 128, '#fff', { size: 'b', align: 'center' });
    g.rect(238, 152, 4, 8, '#3a4466');
    // piste
    g.poly([pX(14, 194, FY), 194, pX(466, 194, FY), 194, pX(466, 232, FY), 232, pX(14, 232, FY), 232], '#7f8ba0');
    g.poly([pX(14, 194, FY), 194, pX(466, 194, FY), 194, pX(466, 196, FY), 196, pX(14, 196, FY), 196], '#a8b3c4');
    g.rect(0, 232, 480, 4, '#4a556a');
    // warning zones
    quad(g, 14, 48, 196, 232, FY, '#9c5a4a'); quad(g, 432, 466, 196, 232, FY, '#9c5a4a');
    [14, 48, 186, 240, 294, 432, 466].forEach(x => vline(g, x, 196, 232, FY, '#f4f4f4'));
    vline(g, 240, 196, 232, FY, '#ffffff');
    // reels
    g.rect(2, 222, 10, 10, '#2a2f45'); g.rect(468, 222, 10, 10, '#2a2f45');
  }
  function vSanda(g, s) {
    const FY = KD.sanda.FY;
    g.grad(0, 31, 480, 130, '#140a12', '#2c1420', 6);
    g.crowd(0, 42, 480, 66, g.t, { excite: s.ex || 0, seed: 21, density: .82, bg: '#2a1a28', step: 5 });
    g.alpha(.35); g.rect(0, 42, 480, 66, '#08040a'); g.alpha(1);
    // lanterns
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 80, y = 34 + (i % 2) * 6 + Math.round(Math.sin(g.t * 1.5 + i) * 1);
      g.line(x, 31, x, y, '#5a3a2a', 1); g.ellipse(x, y + 7, 6, 7, '#e0362c'); g.rect(x - 4, y, 8, 2, '#f2c14e'); g.rect(x - 4, y + 13, 8, 2, '#f2c14e');
      g.alpha(.18); g.circle(x, y + 7, 12, '#ffb070'); g.alpha(1);
    }
    g.adBoards(0, 108, 480, 11, g.t, ['WUSHU SANDA', '散打', 'AICHI-NAGOYA 2026', 'DOT GAMES']);
    g.grad(0, 119, 480, 60, '#24121c', '#381a26', 4);
    // floor + safety mats
    g.rect(0, 178, 480, 92, '#1f1c30');
    g.rect(0, 240, 480, 30, '#2b4a8c'); g.rect(0, 240, 480, 2, '#3b62b0');
    // lei tai platform
    const L = KD.sanda.L - 10, R = KD.sanda.R + 10;
    g.poly([pX(L, 176, FY), 176, pX(R, 176, FY), 176, pX(R, FY + 8, FY), FY + 8, pX(L, FY + 8, FY), FY + 8], '#d64a2e');
    g.poly([pX(L + 8, 180, FY), 180, pX(R - 8, 180, FY), 180, pX(R - 8, FY + 4, FY), FY + 4, pX(L + 8, FY + 4, FY), FY + 4], '#f0c24a');
    g.ellipse(240, 196, 30, 8, '#d64a2e'); g.ellipse(240, 196, 26, 7, '#1a1a22');
    g.poly([214, 196, 266, 196, 260, 200, 220, 201], '#f4f4f4');
    g.circle(232, 194, 2, '#f4f4f4'); g.circle(248, 198, 2, '#1a1a22');
    // front face
    const fx0 = pX(L, FY + 8, FY), fx1 = pX(R, FY + 8, FY);
    g.rect(fx0, FY + 8, fx1 - fx0, 30, '#9c1f1f');
    g.rect(fx0, FY + 8, fx1 - fx0, 2, '#c8342c');
    for (let x = fx0 + 8; x < fx1 - 8; x += 24) { g.rect(x, FY + 18, 12, 2, '#f0c24a'); g.rect(x + 5, FY + 14, 2, 10, '#f0c24a'); }
    g.text('散打 SANDA', 240, FY + 24, '#f0c24a', { size: 's', align: 'center' });
  }
  function vMma(g, s) {
    const FY = KD.mma.FY;
    g.grad(0, 31, 480, 140, '#05060c', '#14161f', 6);
    g.crowd(0, 44, 480, 60, g.t, { excite: s.ex || 0, seed: 31, density: .8, bg: '#141622', step: 5 });
    g.alpha(.45); g.rect(0, 44, 480, 60, '#030306'); g.alpha(1);
    g.alpha(.08); g.poly([120, 31, 360, 31, 470, 240, 10, 240], '#ffffff'); g.alpha(1);
    // canvas
    g.poly([pX(28, 158, FY), 158, pX(452, 158, FY), 158, pX(452, 250, FY), 250, pX(28, 250, FY), 250], '#d8dde6');
    const pts = [];
    for (let k = 0; k < 8; k++) { const a = PI / 8 + k * PI / 4; pts.push(240 + Math.cos(a) * 120, FY + 2 + Math.sin(a) * 30); }
    g.poly(pts, '#c3c9d4');
    g.text('DOT FC', 240, FY - 4, 'rgba(30,30,40,0.25)', { size: 'xl', align: 'center' });
    g.rect(0, 250, 480, 20, '#0d0e14');
    // back fence
    g.rect(0, 100, 480, 2, '#5a6070');
    for (let x = 0; x < 480; x += 6) for (let y = 104; y < 158; y += 6) { g.px(x + ((y / 6) % 2) * 3, y, '#4a4f5c'); g.px(x + 1 + ((y / 6) % 2) * 3, y + 1, '#3a3f4c'); }
    for (let x = 20; x < 480; x += 110) g.rect(x, 98, 8, 62, '#15171e');
    // front posts (left & right)
    g.rect(4, 150, 12, 100, '#15171e'); g.rect(464, 150, 12, 100, '#15171e');
    g.rect(4, 150, 12, 4, RED); g.rect(464, 150, 12, 4, BLUE);
    for (let y = 160; y < 250; y += 6) { g.px(18 + (y % 12) / 2, y, '#4a4f5c'); g.px(460 - (y % 12) / 2, y, '#4a4f5c'); }
  }

  /* ---------------------- esports arcade screen ---------------------- */
  const CRT = { x: 58, y: 12, w: 364, h: 182 };
  function vArcadeOuter(g, s) {
    g.grad(0, 0, 480, 270, '#08051a', '#1b0e33', 8);
    // stage lights
    for (let i = 0; i < 5; i++) {
      const x = 30 + i * 105, c = ['#ff2e88', '#2ce8f5', '#feae34', '#2ce8f5', '#ff2e88'][i];
      g.alpha(.1 + .05 * Math.sin(g.t * 3 + i)); g.poly([x - 4, 0, x + 4, 0, x + 60, 270, x - 60, 270], c); g.alpha(1);
    }
    // LED side walls
    for (let y = 20; y < 196; y += 6) {
      for (let x = 6; x < 50; x += 6) g.rect(x, y, 4, 4, OG.hash(x, y, Math.floor(g.t * 4)) < .2 ? '#ff2e88' : '#2a1846');
      for (let x = 430; x < 474; x += 6) g.rect(x, y, 4, 4, OG.hash(x, y, Math.floor(g.t * 4) + 3) < .2 ? '#2ce8f5' : '#2a1846');
    }
    // monitor bezel
    g.rect(CRT.x - 8, CRT.y - 6, CRT.w + 16, CRT.h + 14, '#14121c');
    g.rect(CRT.x - 6, CRT.y - 4, CRT.w + 12, CRT.h + 10, '#2a2836');
    g.rect(CRT.x - 3, CRT.y - 2, CRT.w + 6, CRT.h + 4, '#05050a');
    g.text('AICHI-NAGOYA 2026 · ESPORTS', 240, CRT.y + CRT.h + 2, '#8b9bb4', { size: 'xs', align: 'center' });
  }
  function vArcadeStage(g, s) {
    const X = CRT.x, Y = CRT.y, W = CRT.w, H = CRT.h, FY = KD.arcade.FY;
    g.grad(X, Y, W, 110, '#2b1a5a', '#f2785a', 8);
    g.circle(240, Y + 92, 26, '#ffd27a'); g.circle(240, Y + 92, 22, '#ffe7a8');
    g.mountains(Y + 70, 40, '#4a2a5e', 3, 0, null);
    // pagoda silhouettes
    for (const px of [110, 372]) {
      for (let k = 0; k < 4; k++) { const w = 34 - k * 7, y = Y + 112 - k * 13; g.rect(px - w / 2, y, w, 3, '#1c1030'); g.rect(px - w / 2 + 4, y + 3, w - 8, 10, '#2a1846'); }
      g.rect(px - 1, Y + 54, 2, 10, '#1c1030');
    }
    g.mountains(Y + 100, 30, '#2a1846', 9, 40, null);
    // ground
    g.rect(X, FY - 4, W, Y + H - FY + 4, '#6b3a2a');
    for (let x = X; x < X + W; x += 16) g.rect(x, FY - 4, 15, 2, '#8a4e36');
    for (let y = FY + 2; y < Y + H; y += 5) g.rect(X, y, W, 1, '#5a2e22');
    // crowd silhouettes on the stage edges
    for (let i = 0; i < 18; i++) {
      const x = X + 6 + i * 20 + (i % 2) * 4, b = Math.abs(Math.sin(g.t * 6 + i)) * 2 * (s.ex > .3 ? 1 : 0);
      g.circle(x, FY - 18 - b, 3, '#3a1c38'); g.rect(x - 3, FY - 15 - b, 7, 9, '#3a1c38');
    }
  }
  function arcadeHud(g, s) {
    const X = CRT.x, Y = CRT.y, W = CRT.w;
    for (let i = 0; i < 2; i++) {
      const F = s.f[i], e = s.ents[i];
      const bw = 140, bx = i ? X + W - 10 - bw : X + 10, by = Y + 8;
      g.rect(bx - 1, by - 1, bw + 2, 10, '#000');
      g.rect(bx, by, bw, 8, '#5a0d14');
      const fw = Math.round(bw * F.hp / 100);
      g.rect(i ? bx + bw - fw : bx, by, fw, 8, F.hp > 30 ? '#ffd23f' : '#ff4a3a');
      g.rect(i ? bx + bw - fw : bx, by, fw, 2, '#fff7c2');
      g.flag(e.country, i ? bx + bw - 14 : bx, by + 12, 14, 9);
      const nm = (e.human ? e.tag + ' ' : '') + e.country;
      g.text(nm, i ? bx + bw - 18 : bx + 18, by + 12, e.human ? OG.PCOLORS[e.pid % 8] : '#ffffff', { size: 'xs', align: i ? 'right' : 'left', outline: '#000' });
      for (let r = 0; r < 2; r++) {
        const cx = i ? bx + bw - 26 - r * 9 - 30 : bx + 26 + r * 9 + 30;
        g.rect(cx - 3, by + 13, 7, 7, '#000'); g.rect(cx - 2, by + 14, 5, 5, s.rw[i] > r ? '#ffd23f' : '#3a3f55');
      }
    }
    g.rect(229, Y + 5, 22, 16, '#000');
    g.text(String(Math.ceil(s.clock)).padStart(2, '0'), 240, Y + 6, s.clock < 10 ? '#ff4a3a' : '#ffd23f', { size: 'b', align: 'center' });
  }
  function crtFx(g) {
    const X = CRT.x, Y = CRT.y, W = CRT.w, H = CRT.h;
    g.alpha(.16);
    for (let y = Y; y < Y + H; y += 2) g.rect(X, y, W, 1, '#000');
    g.alpha(.06); g.rect(X, Y, W, 4, '#ffffff');
    g.alpha(1);
    // rounded corners
    const cc = '#05050a';
    for (let k = 0; k < 4; k++) {
      g.rect(X, Y + k, 4 - k, 1, cc); g.rect(X + W - 4 + k, Y + k, 4 - k, 1, cc);
      g.rect(X, Y + H - 1 - k, 4 - k, 1, cc); g.rect(X + W - 4 + k, Y + H - 1 - k, 4 - k, 1, cc);
    }
  }
  function arcadePlayers(g, s) {
    // two players seated at desks in front of the screen (seen from behind)
    for (let i = 0; i < 2; i++) {
      const e = s.ents[i], F = s.f[i], lk = OG.lookOf(e);
      const x = i ? 336 : 144, y = 232;
      g.rect(x - 46, 208, 92, 8, '#2a2836'); g.rect(x - 46, 216, 92, 20, '#1c1a26');
      g.flag(e.country, x + 22, 219, 18, 12);
      // arcade stick
      const lean = F.st === 'walk' ? (F.wd * F.face) * 2 : 0;
      g.rect(x - 34, 204, 18, 5, '#0d0c14'); g.line(x - 25, 204, x - 25 + lean, 197, '#c0cbdc', 1); g.circle(x - 25 + lean, 196, 2, i ? '#2ce8f5' : '#ff2e88');
      for (let b = 0; b < 3; b++) g.circle(x + 18 + b * 6, 206, 2, F.st === 'atk' && b === 1 ? '#fff' : ['#ff2e88', '#feae34', '#2ce8f5'][b]);
      // chair + player (back view)
      g.rect(x - 16, 236, 32, 34, '#26213a'); g.rect(x - 16, 236, 32, 3, i ? '#2ce8f5' : '#ff2e88');
      const bobY = F.st === 'atk' ? -1 : 0;
      g.rect(x - 13, 214 + bobY, 26, 24, lk.shirt); g.rect(x - 13, 214 + bobY, 26, 3, OG.shade(lk.shirt, .2));
      g.circle(x, 206 + bobY, 8, lk.hair);
      g.rect(x - 10, 200 + bobY, 20, 2, '#14121c'); g.rect(x - 11, 202 + bobY, 3, 7, '#14121c'); g.rect(x + 8, 202 + bobY, 3, 7, '#14121c');
      if (e.human) g.text(e.tag, x, 248, OG.PCOLORS[e.pid % 8], { size: 's', align: 'center', outline: '#000' });
      else g.text(e.country, x, 248, '#c0cbdc', { size: 's', align: 'center', outline: '#000' });
    }
    // foreground crowd with light sticks
    for (let i = 0; i < 26; i++) {
      const x = 8 + i * 19, b = Math.abs(Math.sin(g.t * 4 + i * 1.3)) * 3 * (.4 + (s.ex || 0));
      g.circle(x, 262 - b, 6, '#0d0a18'); g.rect(x - 7, 266 - b, 14, 6, '#0d0a18');
      if (i % 3 === 0) { const c = i % 2 ? '#2ce8f5' : '#ff2e88'; g.line(x + 6, 258 - b, x + 9, 248 - b, c, 2); }
    }
  }

  /* ----------------------------- referee ----------------------------- */
  function drawRef(g, s) {
    const k = s.kind, kd = KD[k];
    if (k === 'arcade') return;
    let x = s.ref.x, y = kd.FY - 22, f = 1, p = PZ.refStand;
    if (k === 'fence') { x = 240; y = 193; }
    const a = s.ref.act, t = s.ref.t;
    if (s.mode === 'count') {
      x = s.ref.x; y = kd.FY - 6;
      p = mix(PZ.refStand, PZ.refCount, .5 + .5 * Math.sin(s.gr.t * PI / .62));
      f = s.gr.who === 0 ? -1 : 1;
    } else if (a === 'raise' && s.ph === 'over') {
      const W = s.f[s.ref.side];
      x = s.mode === 'ground' ? s.gr.cx + (s.ref.side ? -40 : 40) : W.x + (s.ref.side ? -16 : 16); y = kd.FY - 8;
      if (k === 'fence') { x = 240; y = 193; }
      f = s.ref.side ? 1 : -1;
      p = k === 'fence' ? PZ.refSide : PZ.refUp;
    } else if (a === 'start' && t < .6) p = mix(PZ.refStart, PZ.refStand, t / .6);
    else if (a === 'stop' && t < 1) p = PZ.refStop;
    else if (s.mode === 'ground' && s.gr && s.gr.k === 'pin') p = PZ.refSide;
    if (s.mode === 'ground' && s.gr && k !== 'fence') {
      const side = s.gr.cx < 240 ? 1 : -1;
      x = s.gr.cx + side * 50; f = -side;
    }
    if (s.mode === 'count') return { x: x, y: y, p: p, f: f };
    const sc = a === 'raise' && s.ph === 'over' ? 2 : 1.5;
    drawFig(g, x, y, p, refOutfit(s), { face: f, scale: sc, t: s.t });
    return null;
  }
  function drawRefFront(g, s, r) {
    if (!r) return;
    const J = drawFig(g, r.x, r.y, r.p, refOutfit(s), { face: r.f, scale: 2, t: s.t });
    if (s.mode === 'count') {
      const n = Math.max(1, s.gr.n);
      g.text(String(n), J.head[0], J.head[1] - 26, n >= 8 ? PAL.red : PAL.white, { size: 'xl', align: 'center', outline: INK });
    }
  }

  /* ------------------------- fighters by mode ------------------------ */
  function label(g, s, i, x, y) {
    const e = s.ents[i];
    const txt = OG.entLabel(e), c = OG.entColor(e);
    const w = g.textW(txt, 'xs') + 4;
    g.rect(Math.round(x - w / 2), y - 1, w, 9, 'rgba(20,16,32,0.75)');
    g.text(txt, x, y, c, { size: 'xs', align: 'center' });
    if (e.human) g.poly([x - 2, y + 8, x + 2, y + 8, x, y + 10], c);
  }
  function drawFighterStd(g, s, i, ox) {
    const F = s.f[i], kd = KD[s.kind];
    const P = fighterPose(s, i);
    const o = outfit(s, i);
    o.sabreA = P.sabreA;
    if (F.st !== 'fall') g.shadow(Math.round(P.x), kd.FY + 1, F.y > 0 ? Math.max(4, 11 - F.y / 6) : 11);
    const J = drawFig(g, P.x + (ox || 0), P.y, P.p, o, { face: P.f, scale: 2, t: s.t });
    // charge glow
    if (F.aT >= CH && F.st !== 'atk') {
      const r = 2 + Math.min(4, (F.aT - CH) * 8) + (Math.floor(s.t * 20) % 2);
      g.alpha(.55); g.circle(J.hdR[0], J.hdR[1], r + 2, PAL.yellow); g.alpha(1);
      g.circle(J.hdR[0], J.hdR[1], r - 1, '#ffffff');
    }
    // fencing body wire + riposte glow
    if (s.kind === 'fence') {
      const reel = i ? 474 : 6;
      g.line(J.hip[0] - F.face * 3, J.hip[1], reel, 226, 'rgba(20,20,30,0.7)', 1);
      if (J.tip && (s.lamp[i] > 1.2)) { g.circle(J.tip[0], J.tip[1], 2, i ? '#3bff6b' : '#ff3b4a'); }
    }
    if (F.st !== 'down' && F.st !== 'fall') label(g, s, i, J.head[0], Math.min(J.head[1] - 16, P.y - 66));
    return J;
  }
  function drawGrip(g, s) {
    const gr = s.gr, kd = KD[s.kind];
    const lean = gr.bal / 100;
    for (let i = 0; i < 2; i++) {
      const F = s.f[i];
      const me = i === 0 ? lean : -lean;
      let p = Object.assign({}, PZ.grip);
      p.t += me * .25; p.lL += Math.sin(s.t * 7 + i) * .12; p.lR -= Math.sin(s.t * 7 + i) * .12;
      let f = F.face, x = F.x;
      if (gr.wind) {
        const k = Math.min(1, gr.wind.t / .3);
        if (gr.wind.who === i) {
          const tg = gr.wind.type === 'reap' ? PZ.tReap : gr.wind.type === 'lift' ? PZ.tLift : PZ.tOver;
          p = mix(p, tg, k * .6);
          if (gr.wind.type === 'over' && k > .5) f = -F.face;
          x += F.face * k * 6;
        } else if (gr.wind.blk) p = mix(p, PZ.jigo, .7);
      }
      const o = outfit(s, i);
      g.shadow(Math.round(x), kd.FY + 1, 11);
      const J = drawFig(g, x, kd.FY - F.y, p, o, { face: f, scale: 2, t: s.t });
      label(g, s, i, J.head[0], J.head[1] - 18);
    }
  }
  function arcPos(g0, k) {
    // uke hip path for a throw, relative to tori
    const f = g0.f;
    if (g0.type === 'tackle') return { dx: 22 * f + k * 2 * f, dy: -18 * (1 - k) - 4, rot: -k * PI / 2 };
    if (g0.type === 'reap') return { dx: 26 * f + k * 10 * f, dy: -18 + Math.sin(k * PI) * -10 + k * 12, rot: -M.easeOut(k) * PI / 2 };
    const hgt = g0.type === 'lift' ? 62 : 46;
    const dx = M.lerp(24, 34, k) * f - Math.sin(k * PI) * 16 * f;
    return { dx: dx, dy: -18 - Math.sin(k * PI) * hgt + k * 12, rot: M.ease(k) * PI * 1.5 };
  }
  function drawThrow(g, s) {
    const gr = s.gr, kd = KD[s.kind];
    const k = Math.min(1, gr.t / gr.dur);
    const T = s.f[gr.tori], U = s.f[gr.uke];
    const tp = gr.type === 'reap' ? PZ.tReap : gr.type === 'lift' ? PZ.tLift : gr.type === 'tackle' ? PZ.tTackle : PZ.tOver;
    const tf = gr.type === 'over' && k < .85 ? -T.face : T.face;
    const tx = gr.tx + (gr.type === 'tackle' ? T.face * k * 10 : 0);
    g.shadow(Math.round(tx), kd.FY + 1, 11);
    const ap = arcPos(gr, M.ease(k));
    g.shadow(Math.round(tx + ap.dx), kd.FY + 1, 8);
    const JT = drawFig(g, tx, kd.FY, mix(PZ.grip, tp, Math.min(1, k * 2.5)), outfit(s, gr.tori), { face: tf, scale: 2, t: s.t });
    const up = Object.assign({}, PZ.uke); up.rot = ap.rot;
    drawFig(g, tx + ap.dx, kd.FY + ap.dy, up, outfit(s, gr.uke), { face: U.face, scale: 2, anchor: 'hip', t: s.t });
    label(g, s, gr.tori, JT.head[0], JT.head[1] - 18);
    if (gr.res === 'big' && k > .2) {
      g.alpha(.25); g.line(tx + ap.dx - 20 * gr.f, kd.FY + ap.dy - 10, tx + ap.dx, kd.FY + ap.dy, '#ffffff', 3); g.alpha(1);
    }
  }
  function groundLayout(s) {
    // returns draw list [{i, p, x, y, f, an}] bottom first
    const gr = s.gr, kd = KD[s.kind], FY = kd.FY;
    const top = gr.top, bot = 1 - top;
    const fB = top === 1 ? 1 : -1;            // bottom faces the top fighter
    const cx = gr.cx;
    const L = [];
    let shake = 0;
    if (gr.sub) shake = Math.round(Math.sin(s.t * 40) * 1.2);
    if (gr.k === 'pin' || gr.k === 'fall') {
      L.push({ i: bot, p: PZ.lieFlat, x: cx - fB * 2, y: FY, f: fB });
      L.push({ i: top, p: PZ.sideCtl, x: cx - fB * 2 + shake, y: FY - 10, f: -fB, an: 'feet' });
    } else if (gr.k === 'par') {
      const ang = gr.an > 0 ? (1 - gr.an / .6) * PI * 2 : 0;
      const pb = Object.assign({}, PZ.allFours), pt = Object.assign({}, PZ.parTop);
      if (ang) { pb.rot = (pb.rot || 0) + ang * fB; pt.rot = (pt.rot || 0) + ang * fB; }
      L.push({ i: bot, p: pb, x: cx + fB * 4, y: FY - 2, f: fB, an: ang ? 'hip' : 'feet', hy: FY - 14 });
      L.push({ i: top, p: pt, x: cx - fB * 10, y: FY - 2, f: fB, an: ang ? 'hip' : 'feet', hy: FY - 18 });
    } else {
      const pos = gr.pos;
      if (pos === 0) {
        L.push({ i: bot, p: PZ.lieGuard, x: cx - fB * 8, y: FY, f: fB });
        const pk = Object.assign({}, PZ.kneel);
        if (gr.an > 0) { pk.aR = 2.2; pk.eR = .1; }
        L.push({ i: top, p: pk, x: cx + fB * 10 + shake, y: FY, f: -fB });
      } else if (pos === 1) {
        L.push({ i: bot, p: PZ.lieFlat, x: cx, y: FY, f: fB });
        L.push({ i: top, p: PZ.sideCtl, x: cx - fB * 2 + shake, y: FY - 10, f: -fB });
      } else if (pos === 2) {
        L.push({ i: bot, p: PZ.lieFlat, x: cx, y: FY, f: fB });
        const pm = Object.assign({}, PZ.mount);
        if (gr.an > 0) { pm.aR = 1.4; pm.eR = .1; pm.t = .5; }
        L.push({ i: top, p: pm, x: cx + fB * 6 + shake, y: FY - 6, f: -fB });
      } else {
        L.push({ i: bot, p: PZ.sitBack, x: cx + fB * 6, y: FY, f: fB });
        L.push({ i: top, p: PZ.backTop, x: cx - fB * 12 + shake, y: FY, f: fB });
        // draw order: top behind
        L.reverse();
      }
    }
    return L;
  }
  function drawGround(g, s) {
    const kd = KD[s.kind];
    g.shadow(Math.round(s.gr.cx), kd.FY + 1, 26);
    const L = groundLayout(s);
    let lastJ = null;
    for (const it of L) {
      const o = outfit(s, it.i);
      lastJ = drawFig(g, it.x, it.an === 'hip' ? it.hy : it.y, it.p, o, { face: it.f, scale: 2, anchor: it.an || 'feet', t: s.t });
    }
    // labels
    for (let i = 0; i < 2; i++) label(g, s, i, s.gr.cx + (i ? 18 : -18), kd.FY - 66);
  }
  function drawAfter(g, s) {
    const gr = s.gr, kd = KD[s.kind];
    const T = s.f[gr.tori], U = s.f[gr.uke];
    g.shadow(Math.round(U.x), kd.FY + 1, 14);
    drawFig(g, U.x, kd.FY, PZ.down, outfit(s, gr.uke), { face: U.face, scale: 2, t: s.t });
    g.shadow(Math.round(T.x), kd.FY + 1, 11);
    const J = drawFig(g, T.x, kd.FY, mix(PZ.grip, PZ.reach, .5), outfit(s, gr.tori), { face: T.face, scale: 2, t: s.t });
    label(g, s, gr.tori, J.head[0], J.head[1] - 18);
  }
  function drawCount(g, s) {
    const gr = s.gr, kd = KD[s.kind];
    const F = s.f[gr.who], O = s.f[1 - gr.who];
    // standing opponent in the neutral corner
    drawFighterStd(g, s, 1 - gr.who);
    const sit = Math.min(1, gr.up / (100 * Math.max(1, F.kd)));
    const p = sit > .35 ? mix(PZ.down, PZ.sitDown, Math.min(1, (sit - .35) * 2)) : PZ.down;
    g.shadow(Math.round(F.x), kd.FY + 1, 14);
    drawFig(g, F.x, kd.FY, p, outfit(s, gr.who), { face: F.face, scale: 2, t: s.t });
  }

  /* ------------------------------- FX -------------------------------- */
  function drawFx(g, s) {
    for (const e of s.fx) {
      const k = e.t / .5;
      if (e.k === 'dust') {
        for (let j = 0; j < 7; j++) {
          const a = (j / 6) * PI, r = 6 + k * 22;
          g.alpha(Math.max(0, .6 - k * .6));
          g.circle(e.x + Math.cos(a) * r * (j % 2 ? 1 : -1), e.y - Math.sin(a) * r * .35 - k * 4, 3 + k * 3, '#e8e0d0');
        }
        g.alpha(1);
        continue;
      }
      const big = e.k === 'big', col = e.k === 'block' ? '#c0cbdc' : e.k === 'parry' ? '#2ce8f5' : big ? '#fee761' : '#ffffff';
      const n = big ? 10 : 7, r0 = 2 + k * (big ? 16 : 10), r1 = r0 + (big ? 7 : 5) * (1 - k);
      if (k < .3) g.circle(e.x, e.y, (big ? 6 : 4) * (1 - k * 2), '#ffffff');
      for (let j = 0; j < n; j++) {
        const a = j / n * PI * 2 + OG.hash(e.x, e.y, j) * .6;
        g.line(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0, e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1, col, big && j % 2 ? 2 : 1);
      }
      if (big && k < .5) { g.alpha(.35); g.circle(e.x, e.y, 10 + k * 10, '#fee761'); g.alpha(1); }
    }
    for (const p of s.proj) {
      const fl = Math.floor(s.t * 20) % 2;
      g.alpha(.4); g.circle(p.x - Math.sign(p.vx) * 6, p.y, 6, '#2ce8f5'); g.alpha(1);
      g.circle(p.x, p.y, 7, '#2a7bff'); g.circle(p.x, p.y, 5, fl ? '#7ee8ff' : '#bff6ff'); g.circle(p.x + Math.sign(p.vx) * 2, p.y, 2, '#ffffff');
    }
  }
  function drawPops(g, s) {
    for (const p of s.pop) {
      const y = p.y - p.t * 22;
      g.alpha(Math.min(1, (1.3 - p.t) * 2.5));
      g.text(p.s, p.x, Math.round(y), p.c, { size: p.s.length <= 3 ? 'l' : 's', align: 'center', outline: INK });
      g.alpha(1);
    }
  }

  /* ------------------------------- HUD ------------------------------- */
  function hud(g, s) {
    if (s.kind === 'arcade') return;
    g.rect(0, 0, 480, 31, '#0c0b18');
    g.rect(0, 31, 480, 1, '#3a4466');
    for (let i = 0; i < 2; i++) hudSide(g, s, i);
    // clock
    const t = Math.max(0, Math.ceil(s.clock));
    const str = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    g.rect(212, 2, 56, 27, '#000000'); g.rectO(212, 2, 56, 27, s.golden ? PAL.gold : '#3a4466');
    g.text(str, 240, 4, s.golden ? PAL.gold : (s.clock < 10 && s.ph === 'fight' ? '#ff6b6b' : PAL.yellow), { size: 'l', align: 'center' });
    let sub = '';
    if (s.rounds > 1) sub = s.round + 'R / ' + s.rounds;
    else if (s.golden) sub = s.kind === 'fence' ? '우선권' : s.kind === 'tkd' ? '골든라운드' : 'GOLDEN';
    else sub = OG.EVENT_MAP[s.evId] ? OG.EVENT_MAP[s.evId].name : '';
    g.text(sub, 240, 20, '#8b9bb4', { size: 'xs', align: 'center', maxW: 52 });
  }
  function hudSide(g, s, i) {
    const e = s.ents[i], F = s.f[i], k = s.kind;
    const L = i === 0;
    const x0 = L ? 2 : 270, w = 208;
    const cc = cornerCol(s, i);
    g.rect(L ? x0 : x0 + w - 3, 2, 3, 27, cc);
    const fx = L ? x0 + 6 : x0 + w - 6 - 24;
    g.flag(e.country, fx, 3, 24, 16);
    const tx = L ? fx + 28 : fx - 4;
    const al = L ? 'left' : 'right';
    g.text(OG.entLabel(e), tx, 3, OG.entColor(e), { size: 'b', align: al });
    g.text(e.name, L ? fx : fx + 24, 21, '#c0cbdc', { size: 'xs', align: al, maxW: 70 });
    // score area near the clock
    const sx = L ? 206 : 274;            // inner edge
    const box = (val, wdt, bg, fg, lab) => {
      const bx = L ? sx - off - wdt : sx + off;
      g.rect(bx, 3, wdt, 25, bg); g.rectO(bx, 3, wdt, 25, OG.shade(bg, .25));
      g.text(String(val), bx + wdt / 2, 6, fg || '#ffffff', { size: 'xl', align: 'center' });
      if (lab) g.text(lab, bx + wdt / 2, -1, '#8b9bb4', { size: 'xs', align: 'center' });
      return wdt + 3;
    };
    const small = (txt, off, col, bg) => {
      const tw = g.textW(txt, 'xs') + 6;
      const bx = L ? sx - off - tw : sx + off;
      g.rect(bx, 9, tw, 12, bg || '#1d2342');
      g.text(txt, bx + tw / 2, 11, col || '#ffffff', { size: 'xs', align: 'center' });
      return tw + 3;
    };
    let off = 0;
    if (k === 'judo') {
      off += box(F.wa, 22, '#1d2342', F.wa ? PAL.yellow : '#ffffff');
      off += small('W', off, '#8b9bb4', '#0c0b18');
      for (let j = 0; j < F.pen; j++) { const bx = L ? sx - off - 8 - j * 9 : sx + off + j * 9; g.rect(bx, 9, 7, 11, PAL.yellow); g.rectO(bx, 9, 7, 11, '#b8860b'); }
    } else if (k === 'kurash') {
      off += box(F.yon, 20, '#1d2342', PAL.yellow);
      off += small('Y', off, '#8b9bb4', '#0c0b18');
      off += box(F.chala, 20, '#1d2342', '#ffffff');
      off += small('C', off, '#8b9bb4', '#0c0b18');
    } else if (k === 'box' || k === 'mma') {
      const bw = 92, bx = L ? sx - bw : sx;
      g.text('HP', L ? bx - 3 : bx + bw + 3, 4, '#8b9bb4', { size: 'xs', align: L ? 'right' : 'left' });
      const hpw = Math.round((bw - 2) * F.hp / 100);
      g.rect(bx, 4, bw, 9, '#000'); g.rect(bx + 1, 5, bw - 2, 7, '#3a1218');
      g.rect(L ? bx + 1 + (bw - 2 - hpw) : bx + 1, 5, hpw, 7, F.hp > 35 ? '#63c74d' : F.hp > 15 ? '#feae34' : '#e43b44');
      g.rect(bx, 16, bw, 5, '#000'); const sw = Math.round((bw - 2) * F.sta / 100);
      g.rect(L ? bx + 1 + (bw - 2 - sw) : bx + 1, 17, sw, 3, '#2ce8f5');
      for (let j = 0; j < F.kd; j++) g.text('▼', L ? bx + bw - 6 - j * 8 : bx + 2 + j * 8, 22, PAL.red, { size: 'xs' });
    } else {
      const bg = k === 'fence' ? (i ? '#16592a' : '#6a1a20') : OG.shade(cc, -0.45);
      off += box(F.pts, 30, bg, '#ffffff');
      if (k === 'tkd') off += small('감점 ' + F.pen, off, '#c0cbdc');
      if (k === 'karate' && s.senshu === i) off += small('선취', off, '#0c0b18', PAL.gold);
      if (k === 'bjj') { off += small('A ' + F.adv, off, '#63c74d'); }
      if (k === 'wrestle' && F.pen) off += small('P' + F.pen, off, PAL.orange);
      if (k === 'fence' && s.prio === i && s.golden) off += small('P', off, '#0c0b18', PAL.gold);
    }
  }

  function hintFor(s, i) {
    const k = s.kind, F = s.f[i], g = s.gr, m = s.mode;
    if (s.ph !== 'fight') return '';
    if (m === 'grip') {
      if (g.wind) return g.wind.who === i ? '' : '{D} 버티기!';
      return '{L}{R} 연타: 균형 무너뜨리기  ·  {A} 던지기';
    }
    if (m === 'after') return g.tori === i ? '{D} 누르기 (오사에코미)!' : '';
    if (m === 'count') return g.who === i ? '{L}{R} 연타: 일어나!' : '';
    if (m === 'ground') {
      const top = g.top === i;
      if (g.k === 'pin') return top ? '{L}{R} 연타: 누르기 유지' : '{L}{R} 연타: 탈출!';
      if (g.k === 'par') return top ? '{L}{R} 연타: 가로들기' : '{L}{R} 연타: 탈출';
      if (g.k === 'fall') return top ? '{L}{R} 연타: 폴!' : '{L}{R} 연타: 브릿지 탈출!';
      if (g.sub) return g.sub.who === i ? '{L}{R} 연타: 조르기!' : '{L}{R} 연타: 탈출!';
      if (top) return k === 'mma' ? '{L}{R} 포지션 · {A} 파운딩 · {U}+{A} 서브미션' : '{L}{R} 연타: 패스  ·  {A} 서브미션';
      return k === 'mma' ? '{L}{R} 연타: 일어나기 · {A} 가드 서브미션' : '{L}{R} 연타: 스윕  ·  {A} 가드 서브미션';
    }
    if (s.swept && s.swept.by === i) return '{A} 마무리 찌르기!';
    if (F.rip > 0) return '{A} 리포스트!';
    return null;
  }
  function drawHints(g, s) {
    const hs = [];
    s.ents.forEach((e, i) => { if (e.human) { const h = hintFor(s, i); if (h) hs.push({ h: h, e: e }); } });
    if (!hs.length) return;
    const two = hs.length === 2 && hs[0].h !== hs[1].h;
    g.rect(0, 255, 480, 15, 'rgba(12,11,24,0.78)');
    if (!two) { g.rich(hs[0].h, 240, 257, PAL.white, { align: 'center' }); return; }
    hs.forEach((it, j) => {
      g.text(it.e.tag, j ? 476 : 4, 258, OG.PCOLORS[it.e.pid % 8], { size: 'xs', align: j ? 'right' : 'left' });
      g.rich(it.h, j ? 360 : 120, 257, PAL.white, { align: 'center' });
    });
  }
  function meters(g, s) {
    const m = s.mode, gr = s.gr;
    if (s.ph !== 'fight' || !gr) return;
    const cx = 240, y = 40;
    if (m === 'grip') {
      const w = 150, x0 = cx - w / 2;
      g.rect(x0 - 2, y - 2, w + 4, 12, INK);
      g.rect(x0, y, w / 2, 8, OG.shade(cornerCol(s, 0), -0.2)); g.rect(cx, y, w / 2, 8, OG.shade(cornerCol(s, 1), -0.2));
      g.rect(x0, y, 14, 8, '#ffd23f'); g.rect(x0 + w - 14, y, 14, 8, '#ffd23f');
      const px = cx + Math.round(gr.bal / 100 * (w / 2 - 2));
      g.rect(px - 2, y - 3, 5, 14, '#ffffff'); g.rect(px - 1, y - 2, 3, 12, INK);
      g.text('균형', cx, y + 10, '#c0cbdc', { size: 'xs', align: 'center' });
      const lim = Math.max(0, 1 - gr.t / gr.lim);
      g.rect(cx - 30, y + 20, 60, 2, '#3a4466'); g.rect(cx - 30, y + 20, Math.round(60 * lim), 2, '#c0cbdc');
    } else if (m === 'ground') {
      if (gr.k === 'pin') {
        const w = 160, x0 = cx - w / 2;
        g.text('오사에코미 ' + gr.t.toFixed(1) + '초', cx, y - 2, PAL.white, { size: 's', align: 'center', outline: INK });
        g.rect(x0 - 1, y + 11, w + 2, 8, INK); g.rect(x0, y + 12, Math.round(w * Math.min(1, gr.t / 10)), 6, gr.t >= 5 ? PAL.yellow : '#63c74d');
        g.rect(cx, y + 10, 1, 10, '#ffffff');
        g.rect(x0, y + 22, Math.round(w * Math.min(1, gr.esc / 100)), 3, '#2ce8f5');
        g.text('탈출', x0 - 3, y + 19, '#2ce8f5', { size: 'xs', align: 'right' });
      } else if (gr.k === 'fall' || gr.k === 'par') {
        const w = 140, x0 = cx - w / 2;
        const v = gr.k === 'fall' ? Math.min(1, gr.t / 3) : gr.roll / 100;
        g.text(gr.k === 'fall' ? '폴 카운트' : '파테르 · 가로들기', cx, y - 2, PAL.white, { size: 's', align: 'center', outline: INK });
        g.rect(x0 - 1, y + 11, w + 2, 7, INK); g.rect(x0, y + 12, Math.round(w * v), 5, PAL.orange);
        g.rect(x0, y + 20, Math.round(w * Math.min(1, gr.esc / 100)), 3, '#2ce8f5');
      } else {
        const names = ['가드', '사이드', '마운트', '백'];
        for (let j = 0; j < 4; j++) {
          const bx = cx - 92 + j * 46;
          const on = gr.pos === j;
          g.rect(bx, y - 3, 44, 11, on ? cornerCol(s, gr.top) : '#1d2342');
          g.text(names[j], bx + 22, y - 2, on ? (s.kind === 'judo' || gr.top === 0 && (s.kind === 'bjj') ? INK : '#ffffff') : '#5a6988', { size: 'xs', align: 'center' });
        }
        if (gr.sub) {
          const w = 150, x0 = cx - w / 2;
          const sh = Math.round(Math.sin(s.t * 50) * 1);
          g.text(gr.sub.n, cx + sh, y + 11, PAL.orange, { size: 's', align: 'center', outline: INK });
          g.rect(x0 - 1, y + 24, w + 2, 8, INK); g.rect(x0, y + 25, Math.round(w * M.clamp(gr.sub.lock / 100, 0, 1)), 6, '#ff4a3a');
        } else {
          const w = 150, x0 = cx - w / 2;
          g.rect(x0 - 1, y + 11, w + 2, 6, INK);
          const v = gr.bar / 100;
          if (v > 0) g.rect(cx, y + 12, Math.round(w / 2 * v), 4, cornerCol(s, gr.top));
          else g.rect(cx + Math.round(w / 2 * v), y + 12, Math.round(-w / 2 * v), 4, cornerCol(s, 1 - gr.top));
          g.rect(cx, y + 10, 1, 8, '#ffffff');
        }
      }
    } else if (m === 'count') {
      const F = s.f[gr.who];
      if (s.ents[gr.who].human) {
        const w = 120, x0 = cx - w / 2;
        g.text('일어나라!', cx, y - 2, PAL.white, { size: 's', align: 'center', outline: INK });
        g.rect(x0 - 1, y + 11, w + 2, 7, INK); g.rect(x0, y + 12, Math.round(w * Math.min(1, gr.up / (100 * F.kd))), 5, '#63c74d');
      }
    }
  }

  function draw(g, s) {
    const k = s.kind, kd = KD[k];
    g.clear(PAL.black);
    const sh = s.shake > 0 ? s.shake : 0;
    const ox = sh ? Math.round(Math.sin(s.t * 91) * sh * .6) : 0, oy = sh ? Math.round(Math.cos(s.t * 77) * sh * .5) : 0;
    if (k === 'arcade') {
      vArcadeOuter(g, s);
      g.save(); g.clip(CRT.x, CRT.y, CRT.w, CRT.h); g.translate(ox, oy);
      vArcadeStage(g, s);
    } else {
      g.save(); g.translate(ox, oy);
      ({ judo: vJudo, kurash: vKurash, bjj: vBjj, karate: vKarate, wrestle: vWrestle, box: vBox, tkd: vTkd, fence: vFence, sanda: vSanda, mma: vMma })[k](g, s);
    }
    const refFront = drawRef(g, s);
    const m = s.mode;
    if (m === 'grip' && s.gr) drawGrip(g, s);
    else if (m === 'throw' && s.gr) drawThrow(g, s);
    else if (m === 'ground' && s.gr) drawGround(g, s);
    else if (m === 'after' && s.gr) drawAfter(g, s);
    else if (m === 'count' && s.gr) drawCount(g, s);
    else {
      // draw the attacker last so strikes overlap the target
      const order = s.f[1].st === 'atk' && s.f[0].st !== 'atk' ? [0, 1] : s.f[0].st === 'atk' ? [1, 0] : [0, 1];
      order.forEach(i => drawFighterStd(g, s, i));
    }
    drawRefFront(g, s, refFront);
    drawFx(g, s);
    drawPops(g, s);
    if (k === 'arcade') {
      arcadeHud(g, s);
      if (s.slow > 0) { g.alpha(.12); g.rect(CRT.x, CRT.y, CRT.w, CRT.h, '#ff2e88'); g.alpha(1); }
      bannerDraw(g, s, CRT.y + 52);
      g.countdown(-s.t);
      crtFx(g);
      g.restore();
      arcadePlayers(g, s);
    } else {
      g.restore();
      // slow-motion vignette bars
      if (s.slow > 0) { g.alpha(.85); g.rect(0, 32, 480, 8, '#000'); g.rect(0, 246, 480, 9, '#000'); g.alpha(1); }
      hud(g, s);
      meters(g, s);
      bannerDraw(g, s, 70);
      g.countdown(-s.t);
    }
    if (s.flash > 0) { g.alpha(Math.min(.45, s.flash * 3)); g.rect(0, 0, 480, 270, '#ffffff'); g.alpha(1); }
    drawHints(g, s);
  }
  function bannerDraw(g, s, y) {
    const b = s.ban;
    if (!b) return;
    const k = Math.min(1, b.t / .12);
    const yy = Math.round(y - (1 - k) * 12);
    g.alpha(Math.min(1, (b.d - b.t) * 4, 1));
    if (b.big) {
      g.alpha(Math.min(.7, (b.d - b.t) * 3)); g.rect(0, yy - 6, 480, 40, 'rgba(10,8,20,0.75)'); g.alpha(Math.min(1, (b.d - b.t) * 4));
      g.rect(0, yy - 6, 480, 1, b.c); g.rect(0, yy + 33, 480, 1, b.c);
      g.text(b.s, 240, yy, b.c, { size: 'xxl', align: 'center', outline: INK, maxW: 460 });
    } else g.text(b.s, 240, yy, b.c, { size: 'xl', align: 'center', outline: INK, maxW: 460 });
    g.alpha(1);
  }

  OG.defineEngine('fight', { type: 'duel', init: init, update: update, draw: draw, cpuMatch: cpuMatch });

  OG.defineEvents([
    { id: 'judo', name: '유도', en: 'Judo', sport: 'judo', icon: '🥋', tags: ['summer', 'asian'], engine: 'fight', cfg: { kind: 'judo' },
      help: ['{A} 가까이서 잡기 · {D} 방어 자세 · 잡은 뒤 {L}{R} 연타로 균형 무너뜨리기', '{A} 메치기 ({U}/{R}/{D} 방향에 따라 기술 변화) · 절반 2개 = 한판', '절반 후 {D}: 누르기 · 상대는 {L}{R} 연타로 탈출'] },
    { id: 'wrestling', name: '레슬링 자유형', en: 'Freestyle Wrestling', sport: 'wrestling', icon: '🤼', tags: ['summer', 'asian'], engine: 'fight', cfg: { kind: 'wrestle' },
      help: ['{A} 맞잡기 · {D}+{A} 태클(테이크다운 2점) · {D} 스프롤 방어', '맞잡은 뒤 {L}{R} 연타 → {A} 던지기 (크면 4점) · 밀어내기 1점', '파테르: {L}{R} 연타로 가로들기 2점 · 10점 차 테크니컬 폴'] },
    { id: 'boxing', name: '복싱', en: 'Boxing', sport: 'boxing', icon: '🥊', tags: ['summer', 'asian'], engine: 'fight', cfg: { kind: 'box' },
      help: ['{A} 잽 · {A} 길게: 스트레이트 · {R}+{A} 훅 · {U}+{A} 어퍼 · {D}+{A} 바디', '{D} 가드 · {U} 더킹 · 다운되면 {L}{R} 연타로 일어나기', '3라운드 · KO 또는 심판 판정'] },
    { id: 'taekwondo', name: '태권도', en: 'Taekwondo', sport: 'taekwondo', icon: '🥋', tags: ['summer', 'asian'], engine: 'fight', cfg: { kind: 'tkd' },
      help: ['{A} 몸통 돌려차기 2점 · {U}+{A} 머리 3점 · {D}+{A} 주먹 1점', '{A} 길게: 뒤차기 4점 · {U}+{A} 길게: 뒤후려차기 5점 · {D} 막기', '장외 = 감점(상대 +1) · 12점 차 승리'] },
    { id: 'fencing', name: '펜싱 사브르', en: 'Sabre', sport: 'fencing', icon: '🤺', tags: ['summer', 'asian'], engine: 'fight', cfg: { kind: 'fence' },
      help: ['{A} 베기 · {A} 길게: 런지 · {R}+{A} 플레슈 (앞으로 돌진)', '{D} 타이밍 맞춰 파라드 → 바로 {A} 리포스트 (우선권)', '동시 공격은 먼저 시작한 쪽 득점 · 10점 선취'] },
    { id: 'karate', name: '가라테 구미테', en: 'Karate Kumite', sport: 'karate', icon: '🥋', tags: ['asian'], engine: 'fight', cfg: { kind: 'karate' },
      help: ['{A} 찌르기 유코 1점 · {R}+{A} 중단 차기 와자아리 2점 · {U}+{A} 상단 차기 잇폰 3점', '{D}+{A} 발 쓸기 → 넘어지면 {A} 마무리 3점 · {D} 막기', '8점 차 승리 · 동점이면 선취점'] },
    { id: 'wushu_sanda', name: '우슈 산타', en: 'Wushu Sanda', sport: 'wushu', icon: '🐉', tags: ['asian'], engine: 'fight', cfg: { kind: 'sanda' },
      help: ['{A} 주먹 1점 · {R}+{A} 옆차기 2점(멀리 밀기) · {U}+{A} 높은 차기 2점 · {D}+{A} 쓸기', '붙어서 {R}+{A} 잡기 → {L}{R} 연타 후 {A} 던지기 2점', '상대를 무대(레이타이) 밖으로 밀어내면 3점!'] },
    { id: 'kurash', name: '쿠라시', en: 'Kurash', sport: 'kurash', icon: '🤼', tags: ['asian'], engine: 'fight', cfg: { kind: 'kurash' },
      help: ['{A} 띠 잡기 · {D} 방어 · 잡은 뒤 {L}{R} 연타로 균형 빼앗기', '{A} 던지기 ({U}: 들어메치기) · 할랄 = 즉시 승리 · 욘보시 · 찰라', '굳히기 없음 · 서서 던지기만!'] },
    { id: 'jujitsu', name: '주짓수', en: 'Ju-Jitsu Ne-Waza', sport: 'jujitsu', icon: '🥋', tags: ['asian'], engine: 'fight', cfg: { kind: 'bjj' },
      help: ['{A} 잡기 / {D}+{A} 태클 → 그라운드 (테이크다운 2점)', '{L}{R} 연타: 위 = 패스 3 · 마운트 4 · 백 4 / 아래 = 스윕 2', '{A} 서브미션 → {L}{R} 연타로 조르기 / 탈출'] },
    { id: 'mma', name: '종합격투기', en: 'MMA', sport: 'mma', icon: '🥊', tags: ['asian'], engine: 'fight', cfg: { kind: 'mma' },
      help: ['{A} 잽 · {A} 길게: 크로스 · {R}+{A} 훅 · {U}+{A} 하이킥 · {D} 가드/스프롤', '{D}+{A} 태클 → 그라운드: {L}{R} 포지션 · {A} 파운딩 · {U}+{A} 서브미션', 'KO · TKO · 서브미션 · 판정 (2라운드)'] },
    { id: 'esports_fight', name: 'e스포츠 격투게임', en: 'Esports Fighting Game', sport: 'esports', icon: '🎮', tags: ['asian'], engine: 'fight', cfg: { kind: 'arcade' },
      help: ['{A} 펀치 · {A} 길게: 강펀치 · {R}+{A} 킥 · {D}+{A} 쓸기 · {U} 점프(공중 {A} 킥)', '{D}{R}+{A} 파동권! · {D} 앉아 막기 · 뒤로 = 서서 막기', '{D}+{A} 길게: 승룡 어퍼 · 2라운드 먼저 이기면 승리'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
