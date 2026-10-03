# 도트 올림픽 2026 — Developer Guide (engine API)

Pixel-art multi-event sports game. Plain browser JavaScript (no build step, no modules).
Everything hangs off the global `OG`. Internal resolution **480×270**, upscaled with nearest-neighbour.
UI language: **Korean**.

```
public/
  index.html            game
  dev/play.html         single-event test bench   (?ev=<id>&p=<humans>&auto=1&fast=<sec>)
  dev/flags.html        flag preview
  js/loader.js          ordered script manifest (all files already listed)
  js/core/util.js       OG namespace, PAL palette, M math, OG.rng, OG.hash, OG.sfx, OG.fmt, registries
  js/core/gfx.js        OG.Gfx drawing helpers, flag renderer, procedural figure + OG.Pose
  js/core/audio.js      chiptune SFX (engines never call it directly)
  js/core/input.js      keyboard/gamepad → per-player input objects
  js/core/common.js     entrants, CPU skill, validation, test bot
  js/data/countries.js  all countries (OG.COUNTRIES / OG.COUNTRY_MAP)
  js/data/sports.js     sport catalogue OG.SPORTS (keys used by events), OG.PCOLORS
  js/engines/*.js       ★ event engines + their event definitions
  js/game/*.js          menus, tournament flow, online play
tools/smoke.js          headless test of every event (node tools/smoke.js <engine|eventId>)
```

## 1. Engine contract

Each engine file registers ONE OR MORE engines and the events that use them:

```js
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;

  OG.defineEngine('myengine', {
    type: 'solo',          // 'solo' = engine runs the whole field (all humans + CPU) and ranks everybody
                           // 'duel' = engine runs ONE 1-vs-1 match; the framework runs a bracket around it
    fieldSize: 8,          // solo only: total entrants (humans + CPU). default 8
    init(ev, entrants, opts, R) { return state; },
    update(state, inputs, dt, R) { /* mutate state */ },
    draw(g, state) { /* render from state only */ },
    cpuMatch(ev, a, b, R) { return { winner: 0 | 1, text: '3 : 1' }; }   // duel only, optional
  });

  OG.defineEvents([
    { id: 'example100', name: '예시 100m', en: 'Example 100m', sport: 'athletics', icon: '🏃',
      tags: ['summer', 'asian'], engine: 'myengine', lowerBetter: true,
      cfg: { dist: 100 },
      help: ['{L}{R} 번갈아 연타: 달리기', '{A}: 점프'] }
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
```

### Arguments
* `ev` — the event definition (use `ev.cfg` to parametrise one engine for many events).
* `entrants` — array of
  `{ idx, pid, human, country, name, tag, skill, look }`
  * `idx` index in the array (use it in results), `pid` player number for inputs (0..7, `-1` for CPU),
  * `human` bool, `country` IOC code (`g.flag(country,…)`), `name` Korean country name, `tag` `'P1'..'P8'` for humans,
  * `skill` 0..1 CPU strength (country power + difficulty + noise), `look` int for skin/hair (`OG.lookOf(ent)` → `{shirt,pants,skin,hair}` in the country's team kit).
  * Solo engines may get **1–8 humans** (4 local + online). Duel engines get exactly 2 entrants (0, 1 or 2 humans).
* `opts` — `{ difficulty: 0|1|2 }`
* `inputs` — `inputs[ent.pid]` for human entrants. Input object:
  `{ l,r,u,d,a }` held · `{ lp,rp,up,dp,ap }` pressed this frame · `{ lr,rr,ur,dr,ar }` released this frame ·
  `{ lc,rc,uc,dc,ac }` number of presses this frame (mashing can exceed 1/frame).
  The 5 buttons: ◀ ▶ ▲ ▼ and ACTION. Keyboard: P1 WASD+Space, P2 arrows+Enter, P3 IJKL+O, P4 TFGH+Y.
  **Design all controls around these 5 buttons.**
* `dt` — always `1/60` (fixed step).
* `R` — seeded RNG bound to `state.seed`: `R.f() R.range(a,b) R.i(n) R.int(a,b) R.chance(p) R.pick(arr) R.sign() R.gauss() R.shuffle(arr)`.
  Use R for ALL gameplay randomness. `draw()` must not use Math.random — use `OG.hash(a,b,c)` for cosmetic noise and `g.t` (global time, seconds) for ambient animation.

### State rules (IMPORTANT — online play sends the state as JSON snapshots and remote screens only run `draw`)
* Plain JSON only: numbers, strings, booleans, null, arrays, plain objects. **No** functions, classes, Map/Set, `undefined`, `NaN`, `Infinity` (use e.g. `9999`).
* `draw(g, state)` must render everything from `state` alone (plus constant tables like `OG.COUNTRY_MAP`, `OG.EVENT_MAP[state.evId]`). Store `evId`/needed cfg in the state.
* Keep state compact (aim < 20 KB JSON). Static generated data (courses, gates) is fine.
* Sounds: `OG.sfx(state, 'jump')` — names: `select confirm back beep tick start go gun whistle buzzer step jump land throw swing whoosh hit kick punch block splash stroke bounce net shot arrow target miss fail good perfect cheer crowd coin medal record ding bell click wind crash ice snow drum power charge`.
* Finish: set `state.done = true` and `state.results`.
  * **solo**: one row per entrant, sorted best first: `{ idx, score, text, dnf? }` — `score` numeric (respect `ev.lowerBetter`), `text` display string (`'9.84'`, `'8.21m'`, `'95.4점'`). Use `OG.sortResults(rows, lowerBetter)`; `dnf:true` rows go last.
  * **duel**: exactly 2 rows, winner first: `{ idx, text }` (text like `'승'`/`'패'` or `'3 : 1'`).
  * Show the final moment on screen ~1.5–2.5 s before setting `done` (framework shows result tables/medals afterwards — don't draw those yourself).
* **Never stall**: if humans do nothing, the event must still end (time limits, auto-fail, auto-advance turns ~10 s). Solo: < 3 min sim time in the idle case; duel: time limit.
* The framework shows an intro (event name, `help` lines, key map) and a READY check before calling `init`/`update`. Start your own timeline with a 3-second countdown (`g.countdown(remaining)`), e.g. `state.t` counting from −3.

### Multiple humans in solo events
* Simultaneous (lanes, split-screen) when it makes sense, otherwise **turns**: show a clear banner `"P2 차례"` with the player's colour `OG.PCOLORS[pid]` and only read that player's input.
* CPU results: simulate with `ent.skill` (e.g. `OG.cpuQuality(ent, R)`), calibrated so that on normal difficulty a good human can win gold but not trivially; weak nations should be clearly beatable.

### HUD conventions
* Human athletes: label `ent.tag` (P1…) in `OG.PCOLORS[ent.pid]` above them; CPU: 3-letter code (`OG.entLabel(ent)`, `OG.entColor(ent)`).
* Flags: `g.flag(code, x, y, w, h)` (18×12 or 12×8 small; 24×16 normal).
* Bottom line hint for the current control: `g.rich('{L}{R} 연타!', x, y, PAL.white)` — tokens `{L} {R} {U} {D} {A}` render as keycaps.
* Text: `g.text(str, x, y, color, {size:'xs'|'s'|'m'|'b'|'l'|'xl'|'xxl', align:'left'|'center'|'right', shadow:true, outline:PAL.black, maxW})`. Sizes ≈ 8/10/12/12bold/15/24/30 px. Korean text is fine.

## 2. Graphics API (`g`, see core/gfx.js)
`clear rect rectO px line(x0,y0,x1,y1,c,thick) circle circleO ellipse poly([x,y,...],c) grad(x,y,w,h,c1,c2,bands) shadow alpha save restore translate clip image`
`text textW rich keycap emoji panel(x,y,w,h,{title}) bar(x,y,w,h,frac,c) vbar medal(x,y,kind) flag(code,x,y,w,h,{wave:t})`
Scenery: `crowd(x,y,w,h,t,{excite,seed,density}) clouds(t,y,speed) mountains(y,h,color,seed,offset,snowCap) trees(y,color,seed,offset,spacing) water(x,y,w,h,t) snowfall(t,n) confetti(t) adBoards(x,y,w,h,t) banner(str,y,c) countdown(remain)`
Colours: `OG.PAL.*` (Endesga-32 based: black navy slate darkgrey grey lightgrey white red darkred orange gold yellow green darkgreen forest blue darkblue cyan purple pink sand tan brown track trackline grass water ice snow medalGold …), `OG.shade(c, k)` (−1 darker … +1 lighter), `OG.mix(c1,c2,t)`.

### Procedural athlete
```js
const J = g.figure(x, y, pose, look, { facing: 1|-1, scale: 1|2, anchor: 'feet'|'hip', rot });
```
* `look` = `OG.lookOf(ent)` plus optional `{ suit: color, cap: color, sleeves: true, tights: true, visor: color }`.
* `pose` angles (radians): `t` torso lean, `aL/aR` arms relative to torso (0 down, π up, + forward), `eL/eR` elbows, `lL/lR` thighs (0 down, + forward), `kL/kR` knees (+ bends back), `rot` whole-body rotation.
* Ready-made: `OG.Pose.stand() run(ph,k) walk(ph) set() crouch() jump() tuck() pike() straight() hurdle() armsUp() celebrate(ph) sad() sit() swimFree(ph) swimBack(ph) swimFly(ph) swimBreast(ph) row(ph) paddle(ph) cycle(ph) skate(ph) ski(ph) tuckSki() throw(k) lift(k) guard() punch() kick() lunge() grab() fallen() bow(draw) aim() swing(k) dive(k) mix(p1,p2,k)`.
* Returns joints `{hip, neck, head, sh, elL, elR, hdL, hdR, knL, knR, ftL, ftR}` (screen coords `[x,y]`) to attach props (rackets, oars, skis, bows, balls…). Standing height ≈ 24 px at scale 1, 48 px at scale 2.

## 3. Testing
* Headless smoke test (must pass for every event you add):
  `node tools/smoke.js <engineName>` — runs bots with 1/2/4 humans + an idle run; checks exceptions, JSON-safety, termination, results.
* Visual check: `public/dev/play.html?ev=<id>&p=1&auto=1&fast=<sec>` renders one deterministic frame after simulating `<sec>` seconds.
  ```
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --allow-file-access-from-files \
     --screenshot=<scratchpad>/shot.png --window-size=980,720 "file:///Users/yj_5g/coding/olympic/public/dev/play.html?ev=<id>&p=2&auto=1&fast=6"
  ```
  The text under the canvas shows errors and the final results.
* Manual: open `public/dev/play.html` in a browser (lists every event).
