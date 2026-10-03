/* =========================================================================
 * 도트 올림픽 2026 — core utilities
 * Global namespace: window.OG
 * All game files are plain scripts (no modules) so index.html also works
 * when opened directly from disk (file://).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG = root.OG || {};

  OG.W = 480;           // internal resolution (pixels)
  OG.H = 270;
  OG.FPS = 60;
  OG.DT = 1 / 60;       // fixed simulation step

  /* ---------------------------------------------------------------------
   * Palette (Endesga-32 based). Engines are encouraged to use these names.
   * ------------------------------------------------------------------- */
  OG.PAL = {
    black: '#181425', navy: '#262b44', slate: '#3a4466', darkgrey: '#5a6988',
    grey: '#8b9bb4', lightgrey: '#c0cbdc', white: '#ffffff',
    red: '#e43b44', darkred: '#a22633', maroon: '#3e2731', rust: '#be4a2f',
    orange: '#f77622', gold: '#feae34', yellow: '#fee761',
    green: '#63c74d', darkgreen: '#3e8948', forest: '#265c42', teal: '#193c3e',
    darkblue: '#124e89', blue: '#0099db', cyan: '#2ce8f5',
    purple: '#68386c', pink: '#b55088', rose: '#f6757a', hotpink: '#ff0044',
    sand: '#ead4aa', tan: '#e4a672', brown: '#b86f50', darkbrown: '#733e39',
    skin1: '#f5cfa6', skin2: '#e8b796', skin3: '#c28569', skin4: '#8d5a3b', skin5: '#5e3a26',
    track: '#c4553a', trackline: '#f2e8d8', grass: '#4fa04a', grass2: '#3e8948',
    water: '#2a8fd6', water2: '#1f6fb3', ice: '#dff3ff', ice2: '#b8dcf2', snow: '#f4f8ff', snow2: '#d5e2f2',
    medalGold: '#ffd23f', medalSilver: '#d6dde6', medalBronze: '#d08a4c',
    sky: '#5fb6f2', sky2: '#9fd8ff', night: '#14182e'
  };
  OG.SKINS = ['#f5cfa6', '#e8b796', '#c28569', '#8d5a3b', '#5e3a26'];
  OG.HAIRS = ['#181425', '#3e2731', '#733e39', '#b86f50', '#e4a672', '#c0cbdc'];

  /* ---------------------------------------------------------------------
   * Math helpers
   * ------------------------------------------------------------------- */
  const M = OG.M = {
    clamp: (v, a, b) => v < a ? a : v > b ? b : v,
    lerp: (a, b, t) => a + (b - a) * t,
    inv: (a, b, v) => (v - a) / (b - a),
    sign: v => v < 0 ? -1 : v > 0 ? 1 : 0,
    approach: (v, target, step) => v < target ? Math.min(v + step, target) : Math.max(v - step, target),
    dist: (x0, y0, x1, y1) => Math.hypot(x1 - x0, y1 - y0),
    wrap: (v, n) => ((v % n) + n) % n,
    // smooth ping-pong in [0,1] for a value t (seconds) and period p
    pingpong: (t, p) => { const x = (t / p) % 2; return x < 1 ? x : 2 - x; },
    ease: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    easeOut: t => 1 - (1 - t) * (1 - t),
    angDiff: (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; },
    round: (v, d) => { const p = Math.pow(10, d || 0); return Math.round(v * p) / p; },
    TAU: Math.PI * 2
  };

  /* ---------------------------------------------------------------------
   * Seeded RNG that keeps its seed INSIDE a serializable state object.
   *   const R = OG.rng(state)   // uses/updates state.seed
   * Engines get an R in init/update; never use Math.random() for gameplay
   * (cosmetic-only randomness in draw() should use OG.hash instead).
   * ------------------------------------------------------------------- */
  function mulberry(s) {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
  }
  OG.rng = function (holder) {
    if (holder.seed == null) holder.seed = (Math.random() * 2 ** 31) | 0;
    const R = {
      f() { const r = mulberry(holder.seed); holder.seed = r[0]; return r[1]; },
      range(a, b) { return a + (b - a) * R.f(); },
      i(n) { return Math.floor(R.f() * n); },
      int(a, b) { return a + Math.floor(R.f() * (b - a + 1)); },
      chance(p) { return R.f() < p; },
      pick(arr) { return arr[Math.floor(R.f() * arr.length)]; },
      sign() { return R.f() < 0.5 ? -1 : 1; },
      gauss() { let u = 0, v = 0; while (u === 0) u = R.f(); while (v === 0) v = R.f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(M.TAU * v); },
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(R.f() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
    };
    return R;
  };
  // Deterministic hash → [0,1) for cosmetic randomness in draw()
  OG.hash = function (a, b, c) {
    let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
  };

  /* ---------------------------------------------------------------------
   * Sound requests. Engines NEVER touch audio directly: they push names
   * into state.sfx; the framework plays (and forwards online) and clears.
   *   OG.sfx(state, 'jump')
   * Names: see OG.Audio.SFX in audio.js
   * ------------------------------------------------------------------- */
  OG.sfx = function (state, name) {
    (state.sfx || (state.sfx = [])).push(name);
  };

  /* ---------------------------------------------------------------------
   * Time / score formatting
   * ------------------------------------------------------------------- */
  OG.fmt = {
    time(sec, dec) { // 9.58 / 1:02.35 / 1:05:21
      dec = dec == null ? 2 : dec;
      if (!isFinite(sec)) return '--';
      if (sec < 60) return sec.toFixed(dec);
      const m = Math.floor(sec / 60), s = sec - m * 60;
      if (m < 60) return m + ':' + (s < 10 ? '0' : '') + s.toFixed(dec);
      const h = Math.floor(m / 60), mm = m % 60;
      return h + ':' + (mm < 10 ? '0' : '') + mm + ':' + (s < 10 ? '0' : '') + s.toFixed(0);
    },
    dist(m, dec) { return isFinite(m) ? m.toFixed(dec == null ? 2 : dec) + 'm' : '--'; },
    pts(p, dec) { return isFinite(p) ? p.toFixed(dec == null ? 2 : dec) : '--'; },
    int(v) { return String(Math.round(v)); }
  };

  /* ---------------------------------------------------------------------
   * Registries: engines, events, sports
   * ------------------------------------------------------------------- */
  OG.engines = {};
  OG.EVENTS = [];
  OG.EVENT_MAP = {};
  OG.defineEngine = function (name, def) { def.name = name; OG.engines[name] = def; return def; };
  /* Event definition:
   * { id, name (ko), en, sport (key of OG.SPORTS), icon (emoji), tags: ['summer'|'winter'|'asian'],
   *   engine, cfg: {...}, help: ['{L}{R} 번갈아 연타: 달리기', '{A}: 점프'],
   *   lowerBetter (bool, solo events: is lower score better?) } */
  OG.defineEvent = function (ev) {
    if (OG.EVENT_MAP[ev.id]) { console.warn('duplicate event id', ev.id); return; }
    ev.cfg = ev.cfg || {};
    ev.tags = ev.tags || [];
    ev.help = ev.help || [];
    OG.EVENTS.push(ev);
    OG.EVENT_MAP[ev.id] = ev;
    return ev;
  };
  OG.defineEvents = function (list) { list.forEach(OG.defineEvent); };

  OG.deepClone = o => JSON.parse(JSON.stringify(o));

  // ----- helpers shared by engines -------------------------------------
  // Look/kit for an entrant (shirt/pants/skin/hair) – stable per entrant.
  OG.lookOf = function (ent) {
    const c = OG.COUNTRY_MAP && OG.COUNTRY_MAP[ent.country];
    const kit = (c && c.kit) || ['#e43b44', '#262b44'];
    return {
      shirt: kit[0], pants: kit[1],
      skin: OG.SKINS[ent.look % OG.SKINS.length],
      hair: OG.HAIRS[(ent.look >> 3) % OG.HAIRS.length]
    };
  };
  // CPU performance helper: returns a value in ~[0,1] combining skill & luck.
  //   q = OG.cpuQuality(ent, R)  -> use to scale CPU results
  OG.cpuQuality = function (ent, R, spread) {
    spread = spread == null ? 0.12 : spread;
    return M.clamp(ent.skill + R.gauss() * spread, 0, 1);
  };
})(typeof window !== 'undefined' ? window : globalThis);
