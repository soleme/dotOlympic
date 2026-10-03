#!/usr/bin/env node
/* Headless smoke test for every event engine.
 *   node tools/smoke.js                 # all events
 *   node tools/smoke.js race            # events of one engine
 *   node tools/smoke.js 100m hurdles110 # specific event ids
 * For each event it runs: bots (1, 2 and 4 humans, or 1-2 for duels) and an
 * IDLE run (humans never press anything) and checks that:
 *   - init/update/draw never throw (draw is exercised with a mock canvas)
 *   - state stays JSON-safe (no NaN/Infinity/undefined/functions/classes)
 *   - the event finishes (state.done) within the time limit
 *   - results are well-formed
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public', 'js');

function mockCtx() {
  const target = {
    measureText: s => ({ width: String(s).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    canvas: { width: 480, height: 270 }
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; return () => {}; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const sandbox = { console, Math, JSON, Date, setTimeout, clearTimeout, setInterval, clearInterval };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const loaderSrc = fs.readFileSync(path.join(ROOT, 'loader.js'), 'utf8');
vm.runInContext(loaderSrc, sandbox, { filename: 'loader.js' });
const scripts = sandbox.OG_SCRIPTS.filter(s => !s.startsWith('game/'));
for (const s of scripts) {
  const src = fs.readFileSync(path.join(ROOT, s), 'utf8');
  try { vm.runInContext(src, sandbox, { filename: s }); }
  catch (e) { console.error('LOAD FAIL ' + s + ': ' + e.stack); process.exitCode = 1; }
}
const OG = sandbox.OG;
OG._mockCanvas = (w, h) => ({ width: w, height: h, getContext: () => mockCtx() });
const g = new OG.Gfx(mockCtx());

const args = process.argv.slice(2);
let events = OG.EVENTS;
if (args.length) events = events.filter(e => args.includes(e.engine) || args.includes(e.id));
if (!events.length) { console.log('no events matched', args); process.exit(1); }

const COUNTRIES = ['KOR', 'JPN', 'USA', 'CHN', 'FRA', 'BRA', 'KEN', 'GER'].filter(c => OG.COUNTRY_MAP[c]);
while (COUNTRIES.length < 8) COUNTRIES.push(OG.COUNTRIES[COUNTRIES.length % OG.COUNTRIES.length].code);

function run(ev, humans, mode, seed) {
  const engine = OG.engines[ev.engine];
  if (!engine) return { ok: false, msg: 'engine ' + ev.engine + ' missing' };
  const holder = { seed };
  const R0 = OG.rng(holder);
  const players = [];
  for (let i = 0; i < humans; i++) players.push({ pid: i, country: COUNTRIES[i] });
  const ents = engine.type === 'duel' ? OG.makeEntrants(players.slice(0, 2), 2, 1, R0) : OG.makeEntrants(players, engine.fieldSize || 8, 1, R0);
  let state;
  try { state = engine.init(ev, ents, { difficulty: 1 }, R0); state.seed = holder.seed; }
  catch (e) { return { ok: false, msg: 'init threw: ' + e.stack.split('\n').slice(0, 3).join(' | ') }; }
  const bots = players.map((p, i) => new OG.Bot(seed * 13 + i));
  const limit = (engine.type === 'duel' ? 240 : 300) * 60;
  let f = 0, maxSize = 0;
  for (; f < limit && !state.done; f++) {
    const inputs = mode === 'idle' ? players.map(() => OG.blankInput()) : bots.map(b => b.input());
    try { engine.update(state, inputs, OG.DT, OG.rng(state)); }
    catch (e) { return { ok: false, msg: 'update threw @' + (f / 60).toFixed(1) + 's: ' + e.stack.split('\n').slice(0, 4).join(' | ') }; }
    if (state.sfx) state.sfx.length = 0;
    if (f % 7 === 0) {
      try { g.t = f / 60; engine.draw(g, state); }
      catch (e) { return { ok: false, msg: 'draw threw @' + (f / 60).toFixed(1) + 's: ' + e.stack.split('\n').slice(0, 4).join(' | ') }; }
    }
    if (f % 60 === 0) {
      const v = OG.validateState(state);
      if (v.length) return { ok: false, msg: 'state problem @' + (f / 60).toFixed(1) + 's: ' + v.slice(0, 3).join('; ') };
      maxSize = Math.max(maxSize, JSON.stringify(state).length);
    }
  }
  if (!state.done) return { ok: false, msg: 'did not finish within ' + limit / 60 + 's (' + mode + ')' };
  try { engine.draw(g, state); } catch (e) { return { ok: false, msg: 'final draw threw: ' + e.message }; }
  const rv = OG.validateResults(engine, state, ents);
  if (rv.length) return { ok: false, msg: 'results: ' + rv.join('; ') };
  const roundtrip = JSON.parse(JSON.stringify(state));
  try { engine.draw(g, roundtrip); } catch (e) { return { ok: false, msg: 'draw of JSON-roundtripped state threw: ' + e.message }; }
  const top = state.results[0];
  return { ok: true, secs: f / 60, size: maxSize, top: (ents[top.idx].human ? ents[top.idx].tag : ents[top.idx].country) + ' ' + top.text };
}

let fails = 0;
const engineCounts = {};
for (const ev of events) {
  engineCounts[ev.engine] = (engineCounts[ev.engine] || 0) + 1;
  const engine = OG.engines[ev.engine];
  const humansList = engine && engine.type === 'duel' ? [1, 2] : [1, 2, 4];
  const lines = [];
  let ok = true;
  for (const h of humansList) {
    const r = run(ev, h, 'bot', 100 + h);
    lines.push(h + 'P:' + (r.ok ? r.secs.toFixed(0) + 's ' + (r.size / 1024).toFixed(1) + 'KB [' + r.top + ']' : 'FAIL ' + r.msg));
    ok = ok && r.ok;
  }
  const idle = run(ev, 1, 'idle', 7);
  lines.push('idle:' + (idle.ok ? idle.secs.toFixed(0) + 's' : 'FAIL ' + idle.msg));
  ok = ok && idle.ok;
  if (!ok) fails++;
  console.log((ok ? 'OK   ' : 'FAIL ') + ev.id.padEnd(22) + ' ' + lines.join('  '));
}
console.log('\n' + events.length + ' events, ' + fails + ' failing. per engine:', JSON.stringify(engineCounts));
process.exitCode = fails ? 1 : 0;
