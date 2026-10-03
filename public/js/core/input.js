/* =========================================================================
 * Input — keyboard (4 local players) + gamepads.
 * Every player has 5 buttons: l r u d a  (left right up down ACTION)
 * Per frame an input object is produced:
 *   { l,r,u,d,a        : held booleans
 *     lp,rp,up,dp,ap   : pressed this frame (edge)
 *     lr,rr,ur,dr,ar   : released this frame }
 * Presses are counted between frames, so very fast mashing is never lost.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const BTN = ['l', 'r', 'u', 'd', 'a'];
  OG.BTN = BTN;

  const KEYMAP = [
    { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], a: ['Space', 'ShiftLeft'] },
    { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], a: ['Enter', 'ShiftRight', 'Slash', 'Numpad0'] },
    { l: ['KeyJ'], r: ['KeyL'], u: ['KeyI'], d: ['KeyK'], a: ['KeyO', 'KeyU'] },
    { l: ['KeyF', 'Numpad4'], r: ['KeyH', 'Numpad6'], u: ['KeyT', 'Numpad8'], d: ['KeyG', 'Numpad5'], a: ['KeyY', 'KeyR', 'NumpadEnter'] }
  ];
  OG.KEYMAP = KEYMAP;
  OG.KEY_LABELS = [
    { l: 'A', r: 'D', u: 'W', d: 'S', a: 'SPACE' },
    { l: '←', r: '→', u: '↑', d: '↓', a: 'ENTER' },
    { l: 'J', r: 'L', u: 'I', d: 'K', a: 'O' },
    { l: 'F', r: 'H', u: 'T', d: 'G', a: 'Y' }
  ];

  const codeTo = {}; // code -> [player, btn]
  KEYMAP.forEach((m, p) => BTN.forEach(b => m[b].forEach(code => { (codeTo[code] = codeTo[code] || []).push([p, b]); })));

  function blank() { const o = {}; BTN.forEach(b => { o[b] = false; o[b + 'p'] = false; o[b + 'r'] = false; }); return o; }
  OG.blankInput = blank;

  const In = OG.Input = {
    held: [0, 1, 2, 3].map(() => ({})),          // keyboard held
    presses: [0, 1, 2, 3].map(() => ({})),       // keyboard presses since last poll
    releases: [0, 1, 2, 3].map(() => ({})),
    padPrev: [{}, {}, {}, {}],
    // global (menu) keys
    escPressed: false, anyPressed: false,
    // remote overrides (online clients) : slot -> state
    onKey: null
  };

  In.attach = function (target) {
    target.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Escape') In.escPressed = true;
      In.anyPressed = true;
      const m = codeTo[e.code];
      if (m) {
        e.preventDefault();
        if (!e.repeat) m.forEach(([p, b]) => { In.presses[p][b] = (In.presses[p][b] || 0) + 1; In.held[p][b] = true; });
      } else if (['Tab', 'Backspace'].includes(e.code)) e.preventDefault();
      if (In.onKey) In.onKey(e);
    });
    target.addEventListener('keyup', e => {
      const m = codeTo[e.code];
      if (m) m.forEach(([p, b]) => { In.held[p][b] = false; In.releases[p][b] = (In.releases[p][b] || 0) + 1; });
    });
    target.addEventListener('blur', () => { In.held.forEach(h => BTN.forEach(b => { h[b] = false; })); });
  };

  function readPad(i) {
    const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
    const gp = pads[i];
    if (!gp || !gp.connected) return null;
    const b = n => gp.buttons[n] && gp.buttons[n].pressed;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    return {
      l: b(14) || ax < -0.5 || b(4) || b(2),
      r: b(15) || ax > 0.5 || b(5) || b(1),
      u: b(12) || ay < -0.5 || b(3),
      d: b(13) || ay > 0.5,
      a: b(0) || b(7) || b(6)
    };
  }

  /* Poll local players 0..3 → array of input objects. Counts presses so
   * that two presses within one frame register as pressed (lp) and also
   * expose lc/rc/... counts. */
  In.poll = function () {
    const out = [];
    for (let p = 0; p < 4; p++) {
      const o = blank();
      const pad = typeof navigator !== 'undefined' ? readPad(p) : null;
      const prev = In.padPrev[p];
      BTN.forEach(b => {
        const kp = In.presses[p][b] || 0, kr = In.releases[p][b] || 0;
        let held = !!In.held[p][b];
        let pressed = kp > 0, released = kr > 0;
        let count = kp;
        if (pad) {
          if (pad[b]) held = true;
          if (pad[b] && !prev[b]) { pressed = true; count++; }
          if (!pad[b] && prev[b]) released = true;
        }
        o[b] = held || pressed;          // a tap shorter than a frame still counts as held for that frame
        o[b + 'p'] = pressed;
        o[b + 'r'] = released;
        o[b + 'c'] = count;
      });
      if (pad) In.padPrev[p] = pad; else In.padPrev[p] = {};
      In.presses[p] = {}; In.releases[p] = {};
      out.push(o);
    }
    return out;
  };
  In.pollGlobal = function () {
    const r = { esc: In.escPressed, any: In.anyPressed };
    In.escPressed = false; In.anyPressed = false;
    return r;
  };
  In.padCount = function () {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
    return Array.from(navigator.getGamepads()).filter(p => p && p.connected).length;
  };

  /* Merge inputs: OR of several input objects (used for "any player" menus) */
  OG.mergeInputs = function (list) {
    const o = blank();
    list.forEach(i => { if (!i) return; BTN.forEach(b => { o[b] = o[b] || i[b]; o[b + 'p'] = o[b + 'p'] || i[b + 'p']; o[b + 'r'] = o[b + 'r'] || i[b + 'r']; o[b + 'c'] = (o[b + 'c'] || 0) + (i[b + 'c'] || 0); }); });
    return o;
  };

  /* Remote input accumulator (host side). Remote clients send
   * {h:{l,r,u,d,a}, c:{l:n,...}} where c are cumulative press counters. */
  OG.RemoteInput = function () { this.held = {}; this.cnt = {}; this.last = {}; this.relCnt = {}; this.lastRel = {}; };
  OG.RemoteInput.prototype.update = function (msg) {
    if (msg.h) this.held = msg.h;
    if (msg.c) this.cnt = msg.c;
    if (msg.rc) this.relCnt = msg.rc;
  };
  OG.RemoteInput.prototype.poll = function () {
    const o = blank();
    BTN.forEach(b => {
      const c = this.cnt[b] || 0, l = this.last[b] || 0;
      const rc = this.relCnt[b] || 0, rl = this.lastRel[b] || 0;
      o[b + 'p'] = c > l; o[b + 'c'] = Math.max(0, c - l);
      o[b + 'r'] = rc > rl;
      o[b] = !!this.held[b] || o[b + 'p'];
      this.last[b] = c; this.lastRel[b] = rc;
    });
    return o;
  };
})(typeof window !== 'undefined' ? window : globalThis);
