/* =========================================================================
 * Shared game-level helpers: entrant creation, CPU skill, bracket utils.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const M = OG.M;

  OG.DIFFS = [{ ko: '쉬움', adj: -0.18 }, { ko: '보통', adj: 0 }, { ko: '어려움', adj: 0.12 }];

  // CPU skill 0..1 from country power + difficulty
  OG.cpuSkill = function (country, difficulty, R) {
    const c = OG.COUNTRY_MAP[country];
    const p = c ? c.power : 30;
    const adj = (OG.DIFFS[difficulty] || OG.DIFFS[1]).adj;
    return M.clamp(0.28 + (p / 100) * 0.58 + adj + R.gauss() * 0.07, 0.05, 0.98);
  };

  // Pick n distinct CPU countries, weighted towards strong nations but with variety
  OG.pickCountries = function (n, exclude, R) {
    const ex = new Set(exclude || []);
    const pool = OG.COUNTRIES.filter(c => !ex.has(c.code));
    const out = [];
    for (let k = 0; k < n && pool.length; k++) {
      let tot = 0;
      const w = pool.map(c => { const v = 4 + Math.pow(c.power, 1.35) / 6; tot += v; return v; });
      let r = R.f() * tot, i = 0;
      while (i < pool.length - 1 && (r -= w[i]) > 0) i++;
      out.push(pool[i].code);
      pool.splice(i, 1);
    }
    return out;
  };

  /* players: [{pid, country, name?}]  (humans)
   * returns entrants array: {idx, pid, human, country, name, tag, skill, look} */
  OG.makeEntrants = function (players, total, difficulty, R) {
    const ents = [];
    players.forEach((p, i) => {
      ents.push({ idx: ents.length, pid: p.pid, human: true, country: p.country, name: countryName(p.country), tag: 'P' + (p.pid + 1), skill: 0.7, look: R.i(256) });
    });
    const cpus = OG.pickCountries(Math.max(0, total - ents.length), players.map(p => p.country), R);
    cpus.forEach(code => ents.push({ idx: ents.length, pid: -1, human: false, country: code, name: countryName(code), tag: '', skill: OG.cpuSkill(code, difficulty, R), look: R.i(256) }));
    return ents;
  };
  function countryName(code) { const c = OG.COUNTRY_MAP[code]; return c ? c.ko : code; }
  OG.countryName = countryName;

  // label used in HUDs: "P1" for humans, 3-letter code for CPU
  OG.entLabel = function (ent) { return ent.human ? ent.tag : ent.country; };
  OG.entColor = function (ent) { return ent.human ? OG.PCOLORS[ent.pid % OG.PCOLORS.length] : OG.PAL.lightgrey; };

  // Generic skill-based duel resolution for CPU vs CPU
  OG.cpuDuel = function (a, b, R) {
    const pa = 1 / (1 + Math.exp(-(a.skill - b.skill) * 8));
    return R.f() < pa ? 0 : 1;
  };

  // Rank solo results: list [{idx, score, text, dnf}] ; lowerBetter
  OG.sortResults = function (list, lowerBetter) {
    return list.slice().sort((x, y) => {
      if (!!x.dnf !== !!y.dnf) return x.dnf ? 1 : -1;
      return lowerBetter ? x.score - y.score : y.score - x.score;
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------------------------------------------------------------------------
 * Dev validation helpers (used by dev/play.html and tools/smoke.js)
 * ------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  const OG = root.OG;
  // Returns a list of problems that would break JSON snapshots (online play)
  OG.validateState = function (state) {
    const errs = [];
    const seen = new Set();
    (function walk(v, path) {
      if (errs.length > 8) return;
      const t = typeof v;
      if (v === null || t === 'string' || t === 'boolean') return;
      if (t === 'number') { if (!isFinite(v)) errs.push(path + ' is ' + v); return; }
      if (t === 'undefined') { errs.push(path + ' is undefined'); return; }
      if (t === 'function') { errs.push(path + ' is a function'); return; }
      if (t === 'object') {
        if (seen.has(v)) { errs.push(path + ' is a shared/cyclic reference'); return; }
        seen.add(v);
        const proto = Object.getPrototypeOf(v);
        if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) { errs.push(path + ' is not a plain object'); return; }
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, path + '[' + i + ']'));
        else for (const k in v) walk(v[k], path + '.' + k);
        seen.delete(v);
        return;
      }
      errs.push(path + ' has type ' + t);
    })(state, 'state');
    return errs;
  };
  OG.validateResults = function (engine, state, ents) {
    const errs = [];
    const res = state.results;
    if (!Array.isArray(res)) return ['state.results missing'];
    if (engine.type === 'duel') {
      if (res.length !== 2) errs.push('duel results must have 2 rows');
    } else if (res.length !== ents.length) errs.push('solo results rows ' + res.length + ' != entrants ' + ents.length);
    const idxs = new Set();
    res.forEach((r, i) => {
      if (typeof r.idx !== 'number' || !ents[r.idx]) errs.push('row ' + i + ' bad idx ' + r.idx);
      if (idxs.has(r.idx)) errs.push('row ' + i + ' duplicate idx ' + r.idx);
      idxs.add(r.idx);
      if (typeof r.text !== 'string') errs.push('row ' + i + ' text must be a string');
      if (engine.type !== 'duel' && !r.dnf && typeof r.score !== 'number') errs.push('row ' + i + ' score must be a number');
    });
    return errs;
  };
  // Simple bot that mashes buttons — for auto testing
  OG.Bot = function (seed, delay) { this.h = { seed: seed || 1 }; this.R = OG.rng(this.h); this.t = 0; this.hold = {}; this.next = 'l'; this.delay = delay || 0; };
  OG.Bot.prototype.input = function () {
    const R = this.R, o = OG.blankInput();
    this.t++;
    if (this.t < this.delay) return o;
    const press = b => { o[b] = true; o[b + 'p'] = true; o[b + 'c'] = 1; this.hold[b] = R.int(2, 8); };
    // alternate L/R ~9-11 Hz
    if (this.t % R.int(5, 7) === 0) { press(this.next); this.next = this.next === 'l' ? 'r' : 'l'; if (R.chance(0.35)) press(this.next === 'l' ? 'r' : 'l'); }
    if (R.chance(0.035)) press('a');
    if (R.chance(0.02)) press('u');
    if (R.chance(0.02)) press('d');
    OG.BTN.forEach(b => {
      if (!o[b + 'p'] && this.hold[b] > 0) { this.hold[b]--; o[b] = true; if (this.hold[b] === 0) { o[b] = false; o[b + 'r'] = true; } }
    });
    return o;
  };
})(typeof window !== 'undefined' ? window : globalThis);
