/* =========================================================================
 * App — main loop, players, tournament state, records, snapshots.
 * The whole game state lives in App.S (plain JSON). In online play the host
 * runs everything and streams S to clients, which only draw it.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M;

  const STORE_KEY = 'dotOlympic2026';
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }

  const App = OG.App = {
    S: null,
    mode: 'local',          // local | host | client
    remote: {},             // cid -> RemoteInput (host)
    fx: [],                 // sound effects to forward to clients
    store: load(),
    acc: 0, last: 0,
    myPid: -1,              // client: my player id
    snapT: 0
  };

  App.newState = function () {
    const st = App.store;
    return {
      scene: 'title', sd: {}, players: [],
      settings: Object.assign({ difficulty: 1, mode: 'summer', count: 1, sound: true, music: true }, st.settings || {}),
      tour: null, medals: {}, room: null, seed: (Math.random() * 1e9) | 0, v: 0
    };
  };

  App.saveStore = function () { App.store.settings = App.S.settings; save(App.store); };

  /* ----------------------------- records ------------------------------ */
  App.getRecord = function (evId) { return (App.store.records || {})[evId] || null; };
  App.submitRecord = function (ev, row, ent) {
    if (row.dnf || typeof row.score !== 'number') return false;
    const recs = App.store.records || (App.store.records = {});
    const cur = recs[ev.id];
    const better = !cur || (ev.lowerBetter ? row.score < cur.score : row.score > cur.score);
    if (better) { recs[ev.id] = { score: row.score, text: row.text, country: ent.country, date: Date.now() }; save(App.store); }
    return better;
  };

  /* ------------------------------ scenes ------------------------------ */
  App.go = function (scene, args) {
    const S = App.S;
    S.scene = scene;
    S.sd = {};
    const sc = OG.scenes[scene];
    if (sc && sc.enter) sc.enter(App, args || {});
    App.onScene(scene);
  };
  App.sfx = function (name) { App.fx.push(name); if (App.S.settings.sound) OG.Audio.play(name); };
  // music depends on the scene only (so clients reproduce it too)
  let curMusic = null;
  App.onScene = function (scene) {
    const want = { title: 'title', menu: 'title', ceremony: 'anthem', final: 'victory' }[scene] || null;
    if (want === curMusic) return;
    curMusic = want;
    OG.Audio.stopMusic();
    if (want && App.S.settings.music) OG.Audio.music(want, want === 'title');
  };

  /* ------------------------------ players ----------------------------- */
  // player: {pid, country, src:{type:'local',slot}|{type:'remote',cid}, state:'choose'|'ready', ci}
  App.inputsFor = function (local) {
    const out = [];
    App.S.players.forEach(p => {
      if (p.src.type === 'local') out[p.pid] = local[p.src.slot] || OG.blankInput();
      else out[p.pid] = (App.rin && App.rin[p.src.cid]) || OG.blankInput();
    });
    return out;
  };

  /* ------------------------------ main loop --------------------------- */
  App.start = function (canvas) {
    App.canvas = canvas;
    const ctx = canvas.getContext('2d');
    App.g = new OG.Gfx(ctx);
    App.S = App.newState();
    OG.Input.attach(window);
    const unlock = () => { OG.Audio.init(); OG.Audio.resume(); if (curMusic && App.S.settings.music) { const m = curMusic; curMusic = null; App.onScene(App.S.scene); if (!curMusic) curMusic = m; } };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    App.fit();
    window.addEventListener('resize', App.fit);
    App.go('title');
    requestAnimationFrame(App.frame);
  };
  App.fit = function () {
    const c = App.canvas;
    const k = Math.max(1, Math.min(Math.floor(window.innerWidth / OG.W), Math.floor(window.innerHeight / OG.H))) || 1;
    const kk = Math.min(window.innerWidth / OG.W, window.innerHeight / OG.H);
    const scale = kk >= 2 ? k : kk; // integer scaling when possible
    c.style.width = Math.floor(OG.W * scale) + 'px';
    c.style.height = Math.floor(OG.H * scale) + 'px';
  };

  App.frame = function (ts) {
    const now = ts / 1000;
    let dt = App.last ? now - App.last : OG.DT;
    App.last = now;
    if (dt > 0.25) dt = 0.25;
    App.acc += dt;
    let steps = 0;
    while (App.acc >= OG.DT && steps < 6) { App.step(); App.acc -= OG.DT; steps++; }
    if (steps >= 6) App.acc = 0;
    App.render(now);
    requestAnimationFrame(App.frame);
  };

  App.step = function () {
    const local = OG.Input.poll();
    const gl = OG.Input.pollGlobal();
    if (App.mode === 'client') { OG.Net.clientStep(local, gl); return; }
    const S = App.S;
    // poll remote players once per step (polling consumes press edges)
    App.rin = {};
    for (const cid in App.remote) App.rin[cid] = App.remote[cid].poll();
    const sc = OG.scenes[S.scene];
    const menu = OG.mergeInputs(local);
    if (gl.esc) menu.esc = true;
    const ctx = { local, menu, gl, inputs: App.inputsFor(local) };
    if (sc && sc.update) sc.update(App, ctx, OG.DT);
    S.v++;
    if (App.mode === 'host') OG.Net.hostStep(OG.DT);
  };

  App.render = function (now) {
    const g = App.g;
    g.t = now;
    const S = App.mode === 'client' ? OG.Net.view : App.S;
    if (!S) { g.clear('#0d0b16'); g.text('연결 중…', 240, 130, '#fff', { align: 'center' }); return; }
    const sc = OG.scenes[S.scene];
    try { if (sc) sc.draw(g, S, App); }
    catch (e) { console.error(e); g.text('render error: ' + e.message, 4, 250, '#f00', { size: 'xs' }); }
    if (App.mode !== 'local') OG.Net.drawStatus(g, S);
  };

  /* ---------------------------- tournament ---------------------------- */
  // Build event list for a mode
  App.eventsForMode = function (mode) {
    return OG.EVENTS.filter(e => OG.engines[e.engine] && (mode === 'all' || e.tags.indexOf(mode) >= 0));
  };
  App.buildProgram = function (mode, count, R) {
    const pool = App.eventsForMode(mode).slice();
    R.shuffle(pool);
    if (count >= pool.length) return pool.map(e => e.id);
    // variety: one per sport first
    const out = [], usedSport = {};
    pool.forEach(e => { if (out.length < count && !usedSport[e.sport]) { usedSport[e.sport] = 1; out.push(e.id); } });
    pool.forEach(e => { if (out.length < count && out.indexOf(e.id) < 0) out.push(e.id); });
    return out;
  };
  App.startTournament = function (events) {
    const S = App.S;
    S.tour = { events, idx: 0, done: [], log: {} };
    S.medals = {};
    App.go(events.length > 1 ? 'opening' : 'schedule');
  };
  App.currentEvent = function () {
    const S = App.S;
    if (!S.tour) return null;
    return OG.EVENT_MAP[S.tour.events[S.tour.idx]] || null;
  };
  App.awardMedals = function (ranking) {
    // ranking: [{idx, rank}] with entrants; award by rank 1/2/3
    const S = App.S;
    ranking.forEach(r => {
      if (r.rank < 1 || r.rank > 3 || r.dnf) return;
      const m = S.medals[r.country] || (S.medals[r.country] = [0, 0, 0]);
      m[r.rank - 1]++;
    });
  };
  App.medalOrder = function (medals) {
    return Object.keys(medals).sort((a, b) => {
      const A = medals[a], B = medals[b];
      return (B[0] - A[0]) || (B[1] - A[1]) || (B[2] - A[2]) || (OG.countryName(a) < OG.countryName(b) ? -1 : 1);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
