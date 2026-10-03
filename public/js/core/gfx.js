/* =========================================================================
 * Graphics helpers — pixel drawing on a 480x270 canvas.
 *   const g = new OG.Gfx(ctx)
 * Everything is drawn with integer coordinates so it stays crisp when the
 * canvas is upscaled with nearest-neighbour.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const M = OG.M, PAL = OG.PAL;

  /* Offscreen canvas factory (works in browser, mocked in node smoke test) */
  OG.makeCanvas = function (w, h) {
    if (OG._mockCanvas) return OG._mockCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  const FONTS = {
    xs: { f: '8px Galmuri7', h: 8 },
    s: { f: '10px Galmuri9', h: 10 },
    m: { f: '12px Galmuri11', h: 12 },
    b: { f: 'bold 12px Galmuri11', h: 12 },
    l: { f: '15px Galmuri14', h: 15 },
    xl: { f: 'bold 24px Galmuri11', h: 24 },
    xxl: { f: '30px Galmuri14', h: 30 }
  };
  OG.FONTS = FONTS;

  function Gfx(ctx) {
    this.ctx = ctx;
    this.W = OG.W; this.H = OG.H;
    this.t = 0; // global cosmetic time (seconds) – set by the app every frame
    if (ctx) ctx.imageSmoothingEnabled = false;
  }
  OG.Gfx = Gfx;
  const P = Gfx.prototype;

  /* ----------------------------- primitives ----------------------------- */
  P.clear = function (c) { this.ctx.fillStyle = c || PAL.black; this.ctx.fillRect(0, 0, this.W, this.H); };
  P.rect = function (x, y, w, h, c) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  P.rectO = function (x, y, w, h, c, t) { // outline
    t = t || 1; x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const ctx = this.ctx; ctx.fillStyle = c;
    ctx.fillRect(x, y, w, t); ctx.fillRect(x, y + h - t, w, t);
    ctx.fillRect(x, y, t, h); ctx.fillRect(x + w - t, y, t, h);
  };
  P.px = function (x, y, c) { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
  P.alpha = function (a) { this.ctx.globalAlpha = a; };
  P.save = function () { this.ctx.save(); };
  P.restore = function () { this.ctx.restore(); };
  P.translate = function (x, y) { this.ctx.translate(Math.round(x), Math.round(y)); };
  P.clip = function (x, y, w, h) { const c = this.ctx; c.beginPath(); c.rect(x, y, w, h); c.clip(); };

  // Pixel line (Bresenham) with square brush of size t
  P.line = function (x0, y0, x1, y1, c, t) {
    t = t || 1;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const ctx = this.ctx; ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    const o = Math.floor(t / 2);
    for (;;) {
      ctx.fillRect(x0 - o, y0 - o, t, t);
      if ((x0 === x1 && y0 === y1) || n++ > 2000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  // Filled circle made of horizontal spans (pixel-crisp)
  P.circle = function (cx, cy, r, c) {
    const ctx = this.ctx; ctx.fillStyle = c;
    cx = Math.round(cx); cy = Math.round(cy);
    if (r < 0.75) { ctx.fillRect(cx, cy, 1, 1); return; }
    const rr = r * r;
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
      const hw = Math.floor(Math.sqrt(Math.max(0, rr - y * y)) + 0.35);
      if (rr - y * y < 0) continue;
      ctx.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  };
  P.circleO = function (cx, cy, r, c) {
    const ctx = this.ctx; ctx.fillStyle = c;
    cx = Math.round(cx); cy = Math.round(cy);
    const n = Math.max(12, Math.round(r * 7));
    let lx = null, ly = null;
    for (let i = 0; i <= n; i++) {
      const a = i / n * M.TAU;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (x !== lx || y !== ly) ctx.fillRect(x, y, 1, 1);
      lx = x; ly = y;
    }
  };
  P.ellipse = function (cx, cy, rx, ry, c) {
    const ctx = this.ctx; ctx.fillStyle = c;
    cx = Math.round(cx); cy = Math.round(cy);
    const iry = Math.ceil(ry);
    for (let y = -iry; y <= iry; y++) {
      const k = 1 - (y * y) / (ry * ry);
      if (k < 0) continue;
      const hw = Math.round(rx * Math.sqrt(k));
      ctx.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
    }
  };
  P.shadow = function (x, y, w) { this.ellipse(x, y, w || 5, 1.5, 'rgba(0,0,0,0.3)'); };
  // Filled polygon: pts = [x0,y0,x1,y1,...]
  P.poly = function (pts, c) {
    const ctx = this.ctx; ctx.fillStyle = c; ctx.beginPath();
    ctx.moveTo(Math.round(pts[0]), Math.round(pts[1]));
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(Math.round(pts[i]), Math.round(pts[i + 1]));
    ctx.closePath(); ctx.fill();
  };
  // vertical banded gradient (pixel-art style, n bands)
  P.grad = function (x, y, w, h, c1, c2, n) {
    n = n || 8;
    const a = hexToRgb(c1), b = hexToRgb(c2);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1 || 1);
      const y0 = Math.round(y + h * i / n), y1 = Math.round(y + h * (i + 1) / n);
      this.rect(x, y0, w, y1 - y0, rgbToHex(M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t), M.lerp(a[2], b[2], t)));
    }
  };
  P.image = function (img, x, y, w, h) {
    if (w == null) this.ctx.drawImage(img, Math.round(x), Math.round(y));
    else this.ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  /* ------------------------------- colours ------------------------------ */
  function hexToRgb(h) {
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  }
  OG.hexToRgb = hexToRgb; OG.rgbToHex = rgbToHex;
  // shade(color, k): k<0 darker, k>0 lighter (−1..1)
  OG.shade = function (c, k) {
    const a = hexToRgb(c);
    const t = k < 0 ? 0 : 255, f = Math.abs(k);
    return rgbToHex(a[0] + (t - a[0]) * f, a[1] + (t - a[1]) * f, a[2] + (t - a[2]) * f);
  };
  OG.mix = function (c1, c2, t) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex(M.lerp(a[0], b[0], t), M.lerp(a[1], b[1], t), M.lerp(a[2], b[2], t));
  };

  /* -------------------------------- text -------------------------------- */
  // opt: {size:'xs'|'s'|'m'|'b'|'l'|'xl'|'xxl', align:'left'|'center'|'right', shadow:color|true, outline:color, alpha}
  P.text = function (str, x, y, c, opt) {
    opt = opt || {};
    str = String(str);
    const ctx = this.ctx, F = FONTS[opt.size || 'm'] || FONTS.m;
    ctx.font = F.f; ctx.textBaseline = 'top';
    let w = ctx.measureText(str).width;
    if (opt.maxW && w > opt.maxW) { // squeeze long text
      ctx.save(); const k = opt.maxW / w;
      let ox = opt.align === 'center' ? x - opt.maxW / 2 : opt.align === 'right' ? x - opt.maxW : x;
      ctx.translate(Math.round(ox), Math.round(y)); ctx.scale(k, 1);
      this._txt(str, 0, 0, c, opt);
      ctx.restore();
      return opt.maxW;
    }
    if (opt.align === 'center') x -= w / 2; else if (opt.align === 'right') x -= w;
    this._txt(str, Math.round(x), Math.round(y), c, opt);
    return w;
  };
  P._txt = function (str, x, y, c, opt) {
    const ctx = this.ctx;
    if (opt.outline) {
      ctx.fillStyle = opt.outline;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) ctx.fillText(str, x + dx, y + dy);
    } else if (opt.shadow) {
      ctx.fillStyle = opt.shadow === true ? 'rgba(0,0,0,0.6)' : opt.shadow;
      ctx.fillText(str, x + 1, y + 1);
    }
    ctx.fillStyle = c || PAL.white;
    ctx.fillText(str, x, y);
  };
  P.textW = function (str, size) {
    const F = FONTS[size || 'm'] || FONTS.m;
    this.ctx.font = F.f;
    return this.ctx.measureText(String(str)).width;
  };
  // Keycap glyph used in help text. label: 'L','R','U','D','A' or any short text
  const KEY_LABEL = { L: '◀', R: '▶', U: '▲', D: '▼', A: 'A' };
  P.keycap = function (x, y, label, opt) {
    opt = opt || {};
    const txt = KEY_LABEL[label] || label;
    const isA = label === 'A';
    const w = Math.max(11, Math.ceil(this.textW(txt, 'xs')) + 5);
    const bg = isA ? PAL.red : PAL.lightgrey, fg = isA ? PAL.white : PAL.black;
    this.rect(x, y + 1, w, 10, OG.shade(bg, -0.45));
    this.rect(x, y, w, 10, bg);
    this.text(txt, x + w / 2, y + 1, fg, { size: 'xs', align: 'center' });
    return w;
  };
  // Rich text with {L}{R}{U}{D}{A} keycaps. Returns width.
  P.rich = function (str, x, y, c, opt) {
    opt = opt || {};
    const parts = String(str).split(/(\{[A-Z]+\})/);
    let total = 0;
    const measure = () => parts.reduce((s, p) => {
      if (/^\{[A-Z]+\}$/.test(p)) return s + Math.max(11, Math.ceil(this.textW(KEY_LABEL[p.slice(1, -1)] || p.slice(1, -1), 'xs')) + 5) + 1;
      return s + this.textW(p, opt.size || 's');
    }, 0);
    total = measure();
    let cx = opt.align === 'center' ? x - total / 2 : opt.align === 'right' ? x - total : x;
    cx = Math.round(cx);
    for (const p of parts) {
      if (!p) continue;
      if (/^\{[A-Z]+\}$/.test(p)) cx += this.keycap(cx, y, p.slice(1, -1)) + 1;
      else cx += this.text(p, cx, y, c, { size: opt.size || 's', shadow: opt.shadow });
    }
    return total;
  };
  P.emoji = function (ch, x, y, size, opt) {
    const ctx = this.ctx;
    ctx.font = (size || 12) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    let w = ctx.measureText(ch).width;
    if (opt && opt.align === 'center') x -= w / 2;
    ctx.fillText(ch, Math.round(x), Math.round(y));
  };

  /* ------------------------------- UI bits ------------------------------ */
  P.panel = function (x, y, w, h, opt) {
    opt = opt || {};
    const bg = opt.bg || 'rgba(24,20,37,0.88)', bd = opt.border || PAL.lightgrey;
    this.rect(x + 1, y + 1, w - 2, h - 2, bg);
    this.rect(x + 2, y, w - 4, 1, bd); this.rect(x + 2, y + h - 1, w - 4, 1, bd);
    this.rect(x, y + 2, 1, h - 4, bd); this.rect(x + w - 1, y + 2, 1, h - 4, bd);
    this.px(x + 1, y + 1, bd); this.px(x + w - 2, y + 1, bd); this.px(x + 1, y + h - 2, bd); this.px(x + w - 2, y + h - 2, bd);
    if (opt.title) {
      const tw = this.textW(opt.title, 's') + 10;
      this.rect(x + 6, y - 5, tw, 11, bd);
      this.text(opt.title, x + 11, y - 4, opt.titleColor || PAL.black, { size: 's' });
    }
  };
  // horizontal meter: frac 0..1
  P.bar = function (x, y, w, h, frac, c, bg, border) {
    this.rect(x, y, w, h, border || PAL.black);
    this.rect(x + 1, y + 1, w - 2, h - 2, bg || PAL.slate);
    const fw = Math.round((w - 2) * M.clamp(frac, 0, 1));
    if (fw > 0) {
      this.rect(x + 1, y + 1, fw, h - 2, c || PAL.green);
      if (h > 4) this.rect(x + 1, y + 1, fw, 1, OG.shade(c || PAL.green, 0.35));
    }
  };
  P.vbar = function (x, y, w, h, frac, c, bg) {
    this.rect(x, y, w, h, PAL.black);
    this.rect(x + 1, y + 1, w - 2, h - 2, bg || PAL.slate);
    const fh = Math.round((h - 2) * M.clamp(frac, 0, 1));
    if (fh > 0) this.rect(x + 1, y + h - 1 - fh, w - 2, fh, c || PAL.green);
  };
  // medal: kind 1=gold 2=silver 3=bronze
  P.medal = function (x, y, kind, r) {
    r = r || 4;
    const c = kind === 1 ? PAL.medalGold : kind === 2 ? PAL.medalSilver : PAL.medalBronze;
    this.line(x - 2, y - r - 4, x, y - r, PAL.blue, 1); this.line(x + 2, y - r - 4, x, y - r, PAL.red, 1);
    this.circle(x, y, r, OG.shade(c, -0.35));
    this.circle(x, y, r - 1, c);
    this.px(x - Math.floor(r / 2), y - Math.floor(r / 2), '#fff');
  };
  P.medalColor = function (kind) { return kind === 1 ? PAL.medalGold : kind === 2 ? PAL.medalSilver : PAL.medalBronze; };

  /* ============================== FLAGS ================================= *
   * Flag spec DSL (see data/countries.js). Ops separated by '|':
   *   bg:c                       fill
   *   h:c1,c2,...                equal horizontal stripes (top→bottom)
   *   hw:c1,w1,c2,w2,...         weighted horizontal stripes
   *   v:c1,c2,...                equal vertical stripes (left→right)
   *   vw:c1,w1,c2,w2,...         weighted vertical stripes
   *   rect:c,x,y,w,h             rectangle (fractions of flag w/h)
   *   cross:c,cx,cy,t            plus-cross through (cx,cy); t = bar thickness (fraction of HEIGHT)
   *   saltire:c,t                diagonal X, t = thickness (fraction of height)
   *   diag:c,corner              triangle half: corner ul|ur|ll|lr (the corner that is filled)
   *   band:c,t,dir               diagonal band, dir 'up' (bottom-left→top-right) | 'down'
   *   tri:c,w                    hoist triangle (left edge full height, tip at x=w)
   *   circle:c,cx,cy,r           disc, r = fraction of HEIGHT
   *   ring:c,cx,cy,r,t           ring outline (thickness t fraction of height)
   *   star:c,cx,cy,r[,rot]       5-pointed star, r = fraction of height
   *   star6:c,cx,cy,r            6-pointed star
   *   crescent:c,cx,cy,r,cut,off crescent: disc c then disc in colour `cut` shifted by off*r to the right (default .35)
   *   sun:c,cx,cy,r              disc with 12 rays
   *   poly:c,x1,y1,x2,y2,...     polygon (fractions)
   *   union:x,y,w,h              mini Union Jack in a rect (fractions)
   * Colours: hex without '#', or a shortcut from FLAG_COLORS.
   * ===================================================================== */
  const FLAG_COLORS = {
    r: '#d52b1e', dr: '#9e1b32', w: '#ffffff', k: '#000000', b: '#0038a8', nb: '#012169',
    lb: '#75aadb', g: '#009b3a', dg: '#006233', y: '#fcd116', o: '#ff8200', gr: '#888888'
  };
  OG.FLAG_COLORS = FLAG_COLORS;
  function fcol(s) {
    if (!s) return '#ff00ff';
    if (FLAG_COLORS[s]) return FLAG_COLORS[s];
    return s[0] === '#' ? s : '#' + s;
  }
  function starPts(cx, cy, r, n, rot, inner) {
    const pts = [];
    inner = inner || 0.4;
    rot = rot || 0;
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + rot + i * Math.PI / n;
      const rr = i % 2 ? r * inner : r;
      pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    return pts;
  }
  function drawFlagSpec(ctx, spec, W, H) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const fillPoly = (pts, c) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath(); ctx.fill();
    };
    const disc = (cx, cy, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, Math.max(r, 0.6), 0, M.TAU); ctx.fill(); };
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const ops = String(spec || 'bg:gr').split('|');
    for (const op of ops) {
      const ci = op.indexOf(':');
      const name = ci < 0 ? op : op.slice(0, ci);
      const a = ci < 0 ? [] : op.slice(ci + 1).split(',');
      const n = i => parseFloat(a[i]);
      try {
        switch (name) {
          case 'bg': ctx.fillStyle = fcol(a[0]); ctx.fillRect(0, 0, W, H); break;
          case 'h': case 'v': {
            const k = a.length;
            for (let i = 0; i < k; i++) {
              ctx.fillStyle = fcol(a[i]);
              if (name === 'h') { const y0 = Math.round(H * i / k), y1 = Math.round(H * (i + 1) / k); ctx.fillRect(0, y0, W, y1 - y0); }
              else { const x0 = Math.round(W * i / k), x1 = Math.round(W * (i + 1) / k); ctx.fillRect(x0, 0, x1 - x0, H); }
            }
            break;
          }
          case 'hw': case 'vw': {
            let tot = 0; for (let i = 1; i < a.length; i += 2) tot += parseFloat(a[i]);
            let acc = 0;
            for (let i = 0; i < a.length; i += 2) {
              const w = parseFloat(a[i + 1]);
              ctx.fillStyle = fcol(a[i]);
              if (name === 'hw') { const y0 = Math.round(H * acc / tot), y1 = Math.round(H * (acc + w) / tot); ctx.fillRect(0, y0, W, y1 - y0); }
              else { const x0 = Math.round(W * acc / tot), x1 = Math.round(W * (acc + w) / tot); ctx.fillRect(x0, 0, x1 - x0, H); }
              acc += w;
            }
            break;
          }
          case 'rect': ctx.fillStyle = fcol(a[0]); ctx.fillRect(Math.round(n(1) * W), Math.round(n(2) * H), Math.max(1, Math.round(n(3) * W)), Math.max(1, Math.round(n(4) * H))); break;
          case 'cross': {
            const t = Math.max(1, Math.round(n(3) * H));
            ctx.fillStyle = fcol(a[0]);
            ctx.fillRect(0, Math.round(n(2) * H - t / 2), W, t);
            ctx.fillRect(Math.round(n(1) * W - t / 2), 0, t, H);
            break;
          }
          case 'saltire': {
            const t = Math.max(1, n(1) * H) / 2;
            const c = fcol(a[0]);
            fillPoly([0, -t, W, H - t, W, H + t, 0, t], c);
            fillPoly([0, H - t, W, -t, W, t, 0, H + t], c);
            break;
          }
          case 'diag': {
            const c = fcol(a[0]), k = a[1];
            if (k === 'ul') fillPoly([0, 0, W, 0, 0, H], c);
            else if (k === 'ur') fillPoly([0, 0, W, 0, W, H], c);
            else if (k === 'll') fillPoly([0, 0, W, H, 0, H], c);
            else fillPoly([W, 0, W, H, 0, H], c);
            break;
          }
          case 'band': {
            const t = n(1) * H / 2, c = fcol(a[0]);
            if (a[2] === 'down') fillPoly([0, -t, W, H - t, W, H + t, 0, t], c);
            else fillPoly([0, H - t, W, -t, W, t, 0, H + t], c);
            break;
          }
          case 'tri': fillPoly([0, 0, n(1) * W, H / 2, 0, H], fcol(a[0])); break;
          case 'circle': disc(n(1) * W, n(2) * H, n(3) * H, fcol(a[0])); break;
          case 'ring': {
            ctx.strokeStyle = fcol(a[0]); ctx.lineWidth = Math.max(1, n(4) * H);
            ctx.beginPath(); ctx.arc(n(1) * W, n(2) * H, n(3) * H, 0, M.TAU); ctx.stroke();
            break;
          }
          case 'star': fillPoly(starPts(n(1) * W, n(2) * H, Math.max(n(3) * H, 1), 5, isNaN(n(4)) ? 0 : n(4)), fcol(a[0])); break;
          case 'star6': fillPoly(starPts(n(1) * W, n(2) * H, Math.max(n(3) * H, 1), 6, 0, 0.55), fcol(a[0])); break;
          case 'crescent': {
            const r = n(3) * H, off = isNaN(n(5)) ? 0.35 : n(5);
            disc(n(1) * W, n(2) * H, r, fcol(a[0]));
            disc(n(1) * W + off * r, n(2) * H, r * 0.82, fcol(a[4]));
            break;
          }
          case 'sun': {
            const cx = n(1) * W, cy = n(2) * H, r = n(3) * H, c = fcol(a[0]);
            fillPoly(starPts(cx, cy, r * 1.6, 12, 0, 0.62), c);
            disc(cx, cy, r, c);
            break;
          }
          case 'poly': {
            const pts = [];
            for (let i = 1; i < a.length; i += 2) pts.push(parseFloat(a[i]) * W, parseFloat(a[i + 1]) * H);
            fillPoly(pts, fcol(a[0]));
            break;
          }
          case 'union': {
            const x = n(0) * W, y = n(1) * H, w = n(2) * W, h = n(3) * H;
            ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
            ctx.fillStyle = '#012169'; ctx.fillRect(x, y, w, h);
            const t = h * 0.2;
            fillPoly([x, y - t / 2, x + w, y + h - t / 2, x + w, y + h + t / 2, x, y + t / 2], '#fff');
            fillPoly([x, y + h - t / 2, x + w, y - t / 2, x + w, y + t / 2, x, y + h + t / 2], '#fff');
            const t2 = h * 0.08;
            fillPoly([x, y - t2 / 2, x + w, y + h - t2 / 2, x + w, y + h + t2 / 2, x, y + t2 / 2], '#c8102e');
            fillPoly([x, y + h - t2 / 2, x + w, y - t2 / 2, x + w, y + t2 / 2, x, y + h + t2 / 2], '#c8102e');
            ctx.fillStyle = '#fff'; ctx.fillRect(x, y + h * 0.33, w, h * 0.34); ctx.fillRect(x + w / 2 - h * 0.17, y, h * 0.34, h);
            ctx.fillStyle = '#c8102e'; ctx.fillRect(x, y + h * 0.4, w, h * 0.2); ctx.fillRect(x + w / 2 - h * 0.1, y, h * 0.2, h);
            ctx.restore();
            break;
          }
          default: break;
        }
      } catch (e) { /* ignore malformed op */ }
    }
    ctx.restore();
  }
  OG.drawFlagSpec = drawFlagSpec;

  const flagCache = {};
  OG.flagCanvas = function (code, w, h) {
    const key = code + '_' + w + 'x' + h;
    if (flagCache[key]) return flagCache[key];
    const c = OG.makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const country = OG.COUNTRY_MAP && OG.COUNTRY_MAP[code];
    drawFlagSpec(ctx, country ? country.flag : 'bg:gr|circle:w,.5,.5,.3', w, h);
    flagCache[key] = c;
    return c;
  };
  // Draw flag of IOC code at x,y (top-left), size w x h. opt: {border:color|false, wave:t}
  P.flag = function (code, x, y, w, h, opt) {
    w = Math.round(w || 18); h = Math.round(h || Math.round(w * 2 / 3));
    x = Math.round(x); y = Math.round(y);
    opt = opt || {};
    const img = OG.flagCanvas(code, w, h);
    if (opt.wave != null) {
      for (let i = 0; i < w; i++) {
        const dy = Math.round(Math.sin(opt.wave * 6 + i * 0.35) * (i / w) * Math.max(1, h * 0.12));
        this.ctx.drawImage(img, i, 0, 1, h, x + i, y + dy, 1, h);
      }
    } else this.ctx.drawImage(img, x, y);
    if (opt.border !== false) this.rectO(x - 1, y - 1, w + 2, h + 2, opt.border || 'rgba(0,0,0,0.55)');
  };

  /* ============================ FIGURE ================================= *
   * Procedural pixel athlete.
   *   joints = g.figure(x, y, pose, look, opt)
   * pose (radians):
   *   t   torso lean (0 upright, + forward)
   *   aL/aR shoulder: upper-arm angle RELATIVE to torso (0 down, + forward, PI = up)
   *   eL/eR elbow bend (forearm relative to upper arm, + = bends forward/up)
   *   lL/lR hip: thigh angle (absolute, 0 straight down, + forward)
   *   kL/kR knee bend (shin relative to thigh, + = bends backward like a real knee)
   *   rot  whole-body rotation about hip (flips, swimming, diving)
   * "L" limbs are drawn behind the body (far side) and slightly darker.
   * look: {shirt, pants, skin, hair, shoe?, cap?, suit?, sleeves?:bool}
   *   suit: one colour for the whole body (swimsuit/skinsuit/ski suit)
   *   cap: colour of helmet/cap over the head
   * opt: {facing:1|-1, scale:1|2, anchor:'feet'|'hip', rot}
   * Returns joint positions (screen coords) so props can be attached:
   *   {hip, neck, head, shL, shR, elL, elR, hdL, hdR, knL, knR, ftL, ftR}
   * Standing height ≈ 24px at scale 1.
   * =================================================================== */
  const SEG = { thigh: 5.5, shin: 5.5, torso: 8, uarm: 4.2, farm: 4.2, head: 2.6 };
  P.figure = function (x, y, pose, look, opt) {
    pose = pose || OG.Pose.stand();
    look = look || {};
    opt = opt || {};
    const f = opt.facing || 1, s = opt.scale || 1;
    const rot = (pose.rot || 0) + (opt.rot || 0);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    // local → screen (local: +x forward, +y down, origin hip)
    const tf = (lx, ly) => [lx * cr - ly * sr, lx * sr + ly * cr];
    const dir = (ang, len) => [Math.sin(ang) * len, Math.cos(ang) * len]; // 0 = down
    const t = pose.t || 0;
    const neckL = [Math.sin(t) * SEG.torso, -Math.cos(t) * SEG.torso];
    const shoulderL = [neckL[0] * 0.92, neckL[1] * 0.92];
    const limb = (base, a1, l1, a2, l2) => {
      const d1 = dir(a1, l1);
      const j1 = [base[0] + d1[0], base[1] + d1[1]];
      const d2 = dir(a2, l2);
      return [j1, [j1[0] + d2[0], j1[1] + d2[1]]];
    };
    const aL = (pose.aL || 0) + t, aR = (pose.aR || 0) + t;
    const armL = limb(shoulderL, aL, SEG.uarm, aL + (pose.eL || 0), SEG.farm);
    const armR = limb(shoulderL, aR, SEG.uarm, aR + (pose.eR || 0), SEG.farm);
    const lL = pose.lL || 0, lR = pose.lR || 0;
    const legL = limb([0, 0], lL, SEG.thigh, lL - (pose.kL || 0), SEG.shin);
    const legR = limb([0, 0], lR, SEG.thigh, lR - (pose.kR || 0), SEG.shin);
    const headL = [neckL[0] + Math.sin(t + (pose.h || 0)) * (SEG.head + 0.6), neckL[1] - Math.cos(t + (pose.h || 0)) * (SEG.head + 0.6)];
    // compute anchor
    const pts = { neck: neckL, sh: shoulderL, head: headL, elL: armL[0], hdL: armL[1], elR: armR[0], hdR: armR[1], knL: legL[0], ftL: legL[1], knR: legR[0], ftR: legR[1] };
    const scr = {};
    for (const k in pts) { const p = tf(pts[k][0], pts[k][1]); scr[k] = [p[0] * f * s, p[1] * s]; }
    let hx = x, hy = y;
    if ((opt.anchor || 'feet') === 'feet') {
      const lowest = Math.max(scr.ftL[1], scr.ftR[1], scr.head[1] + SEG.head * s, scr.hdL[1], scr.hdR[1]);
      hy = y - lowest - 1;
    }
    const J = { hip: [hx, hy] };
    for (const k in scr) J[k] = [hx + scr[k][0], hy + scr[k][1]];
    J.shL = J.sh; J.shR = J.sh;
    // colours
    const suit = look.suit;
    const shirt = suit || look.shirt || PAL.red;
    const pants = suit || look.pants || PAL.navy;
    const skin = look.skin || PAL.skin2;
    const shoe = look.shoe || PAL.black;
    const sleeve = suit ? suit : (look.sleeves ? shirt : skin);
    const legLow = suit ? suit : (look.tights ? pants : skin);
    const dk = c => OG.shade(c, -0.28);
    const T = Math.max(1, Math.round(2 * s)), TT = Math.max(2, Math.round(3 * s));
    const L = (a, b, c, th) => this.line(a[0], a[1], b[0], b[1], c, th);
    // back limbs
    L(J.hip, J.knL, dk(pants), T); L(J.knL, J.ftL, dk(legLow), T); this.px(J.ftL[0] + f * s, J.ftL[1], dk(shoe));
    L(J.sh, J.elL, dk(look.sleeves || suit ? shirt : shirt), T); L(J.elL, J.hdL, dk(sleeve), T);
    // torso
    L(J.hip, J.neck, shirt, TT);
    // shorts block around hip
    this.rect(J.hip[0] - s, J.hip[1] - s, 2 * s + 1, 2 * s, pants);
    // front leg
    L(J.hip, J.knR, pants, T); L(J.knR, J.ftR, legLow, T); this.rect(J.ftR[0] - (f < 0 ? s : 0), J.ftR[1], 2 * s, s, shoe);
    // head
    const hr = SEG.head * s;
    this.circle(J.head[0], J.head[1], hr, skin);
    const hairC = look.cap || look.hair || PAL.black;
    // hair/cap: top half of the head (rotated with the body)
    const up = tf(0, -1), back = tf(-1, 0);
    for (let i = -Math.round(hr); i <= Math.round(hr); i++) {
      for (let j = -Math.round(hr); j <= Math.round(hr); j++) {
        if (i * i + j * j > hr * hr + 0.5) continue;
        const dotUp = i * up[0] * f + j * up[1];
        const dotBack = i * back[0] * f + j * back[1];
        if (dotUp > hr * 0.15 || (dotBack > hr * 0.35 && dotUp > -hr * 0.5 && !look.cap)) this.px(J.head[0] + i, J.head[1] + j, hairC);
      }
    }
    if (look.visor) this.px(J.head[0] + f * Math.round(hr * 0.6), J.head[1], look.visor);
    // front arm
    L(J.sh, J.elR, look.sleeves || suit ? shirt : shirt, T); L(J.elR, J.hdR, sleeve, T);
    return J;
  };

  /* ============================== POSES ================================ */
  const S = Math.sin, C = Math.cos, PI = Math.PI;
  OG.Pose = {
    stand: () => ({ t: 0.02, aL: 0.08, aR: -0.08, eL: 0.2, eR: 0.2, lL: 0.05, lR: -0.05, kL: 0, kR: 0 }),
    // ph: cycle phase 0..1 ; k: intensity 0..1 (sprint=1)
    run: (ph, k) => {
      k = k == null ? 1 : k;
      const a = ph * PI * 2;
      return {
        t: 0.18 + 0.12 * k,
        aL: -S(a) * (0.6 + 0.6 * k), aR: S(a) * (0.6 + 0.6 * k), eL: 1.5, eR: 1.5,
        lL: S(a) * (0.5 + 0.5 * k), lR: -S(a) * (0.5 + 0.5 * k),
        kL: Math.max(0, -C(a)) * (0.8 + 1.0 * k) + 0.2, kR: Math.max(0, C(a)) * (0.8 + 1.0 * k) + 0.2
      };
    },
    walk: (ph) => {
      const a = ph * PI * 2;
      return { t: 0.05, aL: -S(a) * 0.5, aR: S(a) * 0.5, eL: 1.2, eR: 1.2, lL: S(a) * 0.4, lR: -S(a) * 0.4, kL: Math.max(0, -C(a)) * 0.5, kR: Math.max(0, C(a)) * 0.5 };
    },
    set: () => ({ t: 1.25, aL: -0.2, aR: -0.2, eL: 0, eR: 0, lL: 1.6, lR: 0.4, kL: 2.3, kR: 1.6 }), // sprint start crouch
    crouch: () => ({ t: 0.5, aL: 0.4, aR: 0.6, eL: 0.8, eR: 0.8, lL: 1.2, lR: 1.0, kL: 2.2, kR: 2.0 }),
    jump: () => ({ t: 0.2, aL: 2.6, aR: 2.4, eL: 0.3, eR: 0.3, lL: 0.9, lR: 0.2, kL: 1.6, kR: 0.4 }),
    tuck: () => ({ t: 0.6, aL: 1.0, aR: 1.0, eL: 1.2, eR: 1.2, lL: 1.9, lR: 1.9, kL: 2.6, kR: 2.6 }),
    pike: () => ({ t: 1.2, aL: 0.4, aR: 0.4, eL: 0, eR: 0, lL: 1.4, lR: 1.4, kL: 0, kR: 0 }),
    straight: () => ({ t: 0, aL: PI, aR: PI, eL: 0, eR: 0, lL: 0, lR: 0, kL: 0, kR: 0 }),
    hurdle: () => ({ t: 0.6, aL: -0.6, aR: 1.6, eL: 0.2, eR: 0.1, lL: -0.4, lR: 1.55, kL: 1.8, kR: 0.05 }),
    armsUp: () => ({ t: 0, aL: 2.7, aR: 2.9, eL: 0.2, eR: 0.2, lL: 0.12, lR: -0.12, kL: 0, kR: 0 }),
    celebrate: (ph) => ({ t: -0.05, aL: 2.6 + S(ph * PI * 2) * 0.3, aR: 2.8 - S(ph * PI * 2) * 0.3, eL: 0.4, eR: 0.4, lL: 0.15, lR: -0.15, kL: 0, kR: 0 }),
    sad: () => ({ t: 0.35, h: 0.4, aL: 0.05, aR: 0.05, eL: 0.1, eR: 0.1, lL: 0, lR: 0, kL: 0.1, kR: 0.1 }),
    sit: () => ({ t: 0.1, aL: 0.6, aR: 0.6, eL: 0.6, eR: 0.6, lL: 1.55, lR: 1.45, kL: 1.4, kR: 1.4 }),
    // swimming: horizontal (rot = PI/2). ph = stroke phase
    swimFree: (ph) => { const a = ph * PI * 2; return { rot: PI / 2 - 0.06, t: 0, aL: a, aR: a + PI, eL: 0.4, eR: 0.4, lL: S(a * 2) * 0.25, lR: -S(a * 2) * 0.25, kL: 0.2, kR: 0.2 }; },
    swimBack: (ph) => { const a = ph * PI * 2; return { rot: -PI / 2 + 0.06, t: 0, aL: -a, aR: -a + PI, eL: 0, eR: 0, lL: S(a * 2) * 0.25, lR: -S(a * 2) * 0.25, kL: 0.2, kR: 0.2 }; },
    swimFly: (ph) => { const a = ph * PI * 2; const s = (S(a) + 1) / 2; return { rot: PI / 2 - 0.2 + s * 0.3, t: 0, aL: PI * 0.25 + s * PI * 0.75, aR: PI * 0.3 + s * PI * 0.75, eL: 0.2, eR: 0.2, lL: S(a) * 0.4, lR: S(a) * 0.4, kL: 0.5 + S(a) * 0.4, kR: 0.5 + S(a) * 0.4 }; },
    swimBreast: (ph) => { const a = ph * PI * 2; const s = (S(a) + 1) / 2; return { rot: PI / 2 - 0.1, t: 0, aL: PI * (0.6 + 0.4 * s), aR: PI * (0.62 + 0.4 * s), eL: 1.4 * (1 - s), eR: 1.4 * (1 - s), lL: 0.6 * (1 - s), lR: 0.5 * (1 - s), kL: 1.8 * (1 - s), kR: 1.8 * (1 - s) }; },
    // seated rowing: ph 0 catch → 0.5 finish
    row: (ph) => { const a = M.pingpong(ph * 2, 1); return { t: -0.3 + (1 - a) * 0.9, aL: 1.5 - a * 1.2, aR: 1.5 - a * 1.2, eL: a * 1.4, eR: a * 1.4, lL: 1.55 - (1 - a) * 0.3, lR: 1.55 - (1 - a) * 0.3, kL: 0.4 + (1 - a) * 2.0, kR: 0.4 + (1 - a) * 2.0 }; },
    // kneeling/sitting paddle stroke (canoe/kayak)
    paddle: (ph) => { const a = ph * PI * 2; return { t: 0.2 + S(a) * 0.15, aL: 1.0 + S(a) * 0.7, aR: 1.4 - S(a) * 0.7, eL: 0.6, eR: 0.6, lL: 1.5, lR: 1.5, kL: 0.3, kR: 0.3 }; },
    cycle: (ph) => { const a = ph * PI * 2; return { t: 1.05, aL: 0.4, aR: 0.4, eL: 0.4, eR: 0.4, lL: 0.9 + S(a) * 0.55, lR: 0.9 - S(a) * 0.55, kL: 1.4 + C(a) * 0.6, kR: 1.4 - C(a) * 0.6 }; },
    skate: (ph) => { const a = ph * PI * 2; return { t: 1.1, aL: -0.4 - S(a) * 0.6, aR: -0.6 + S(a) * 0.6, eL: 0.2, eR: 0.2, lL: 0.7 + S(a) * 0.5, lR: 0.7 - S(a) * 0.5, kL: 1.2 + Math.max(0, S(a)) * 0.5, kR: 1.2 + Math.max(0, -S(a)) * 0.5 }; },
    ski: (ph) => { const a = ph * PI * 2; return { t: 0.45, aL: 0.6 + S(a) * 0.7, aR: 0.6 - S(a) * 0.7, eL: 0.5, eR: 0.5, lL: 0.35 + S(a) * 0.35, lR: 0.35 - S(a) * 0.35, kL: 0.6, kR: 0.6 }; },
    tuckSki: () => ({ t: 1.2, aL: 0.9, aR: 1.0, eL: 1.6, eR: 1.6, lL: 1.0, lR: 0.9, kL: 1.8, kR: 1.7 }),
    // throwing: wind (0) → release (1)
    throw: (k) => ({ t: 0.1 - 0.4 * (1 - k) + 0.3 * k, aL: 1.2 - k * 1.6, aR: -2.4 * (1 - k) + 2.4 * k, eL: 0.4, eR: 0.3, lL: 0.5, lR: -0.3, kL: 0.5, kR: 0.1 }),
    lift: (k) => ({ t: 0.9 * (1 - k), aL: PI * k * 1.0 + 0.2 * (1 - k), aR: PI * k * 1.0 + 0.2 * (1 - k), eL: 0, eR: 0, lL: 1.2 * (1 - k) + 0.1, lR: 1.1 * (1 - k) - 0.1, kL: 2.2 * (1 - k), kR: 2.1 * (1 - k) }),
    // fighting stance & attacks
    guard: () => ({ t: 0.15, aL: 1.6, aR: 1.1, eL: 1.8, eR: 1.9, lL: 0.45, lR: -0.35, kL: 0.4, kR: 0.3 }),
    punch: () => ({ t: 0.3, aL: 1.0, aR: 1.62, eL: 1.8, eR: 0.05, lL: 0.5, lR: -0.5, kL: 0.4, kR: 0.1 }),
    kick: () => ({ t: -0.35, aL: 1.2, aR: 0.5, eL: 1.6, eR: 1.4, lL: -0.2, lR: 1.75, kL: 0.1, kR: 0.05 }),
    lunge: () => ({ t: 0.3, aL: -0.9, aR: 1.62, eL: 0.6, eR: 0.0, lL: -0.6, lR: 1.0, kL: 0.1, kR: 1.1 }),
    grab: () => ({ t: 0.45, aL: 1.4, aR: 1.5, eL: 0.6, eR: 0.5, lL: 0.6, lR: -0.2, kL: 0.8, kR: 0.4 }),
    fallen: () => ({ rot: -PI / 2, t: 0, aL: 2.8, aR: 0.4, eL: 0.2, eR: 0.3, lL: 0.2, lR: -0.1, kL: 0.3, kR: 0 }),
    // target sports
    bow: (draw) => ({ t: 0, aL: PI / 2, aR: PI / 2, eL: 0, eR: 2.6 * draw + 0.2, lL: 0.12, lR: -0.12, kL: 0, kR: 0 }),
    aim: () => ({ t: 0.05, aL: 1.55, aR: 1.25, eL: 0.05, eR: 1.6, lL: 0.12, lR: -0.12, kL: 0, kR: 0 }),
    swing: (k) => ({ t: 0.5, aL: 0.4 + k * 2.2, aR: 0.3 + k * 2.2, eL: 0.2, eR: 0.2, lL: 0.2, lR: -0.15, kL: 0.3, kR: 0.3 }), // golf/bat k:-1 back .. 1 follow
    dive: (k) => ({ t: 0.3 + k, aL: PI * 0.9, aR: PI * 0.9, eL: 0, eR: 0, lL: 0.3 * (1 - k), lR: 0.3 * (1 - k), kL: 0, kR: 0 }),
    // lerp two poses
    mix: (p1, p2, k) => {
      const o = {};
      const keys = new Set(Object.keys(p1).concat(Object.keys(p2)));
      keys.forEach(key => { o[key] = M.lerp(p1[key] || 0, p2[key] || 0, k); });
      return o;
    }
  };

  /* ============================ SCENERY ================================ */
  // Crowd in a stand. density 0..1, t = time
  P.crowd = function (x, y, w, h, t, opt) {
    opt = opt || {};
    const bg = opt.bg || '#3a4466';
    this.rect(x, y, w, h, bg);
    const cols = opt.colors || ['#e43b44', '#feae34', '#0099db', '#ffffff', '#63c74d', '#b55088', '#f77622', '#c0cbdc', '#2ce8f5', '#fee761'];
    const step = opt.step || 4;
    const excite = opt.excite || 0;
    // opt.ox: horizontal world offset (px) for parallax scrolling
    const ox = Math.floor(opt.ox || 0), shift = M.wrap(ox, step), base = ox - shift;
    this.save(); this.clip(x, y, w, h);
    for (let ry = 0; ry < h; ry += step) {
      for (let rx = 0; rx < w + step; rx += step) {
        const wx = rx + base;
        const hsh = OG.hash(wx + (opt.seed || 0) * 977, ry, 7);
        if (hsh > (opt.density || 0.85)) continue;
        const jump = (excite > 0 && OG.hash(wx, ry, Math.floor(t * 6)) < excite) ? -1 : 0;
        const c = cols[Math.floor(OG.hash(wx, ry, 3) * cols.length)];
        const sx = x + rx - shift + (ry / step % 2 ? 2 : 0), sy = y + ry + jump;
        this.rect(sx, sy + 2, 3, step - 2, c);
        this.rect(sx + 1, sy, 1, 2, OG.SKINS[Math.floor(OG.hash(wx, ry, 9) * 5)]);
        if (excite > 0.3 && OG.hash(wx, ry, Math.floor(t * 4) + 11) < 0.05) this.px(sx + 1, sy - 2, '#fff'); // camera flash
      }
    }
    this.restore();
  };
  P.clouds = function (t, y, speed, color, n) {
    n = n || 5; color = color || 'rgba(255,255,255,0.85)';
    for (let i = 0; i < n; i++) {
      const w = 26 + Math.floor(OG.hash(i, 1, 1) * 30);
      const cx = M.wrap(OG.hash(i, 2, 2) * 600 - t * (speed || 4) * (0.5 + OG.hash(i, 3, 3)), 600) - 60;
      const cy = y + Math.floor(OG.hash(i, 4, 4) * 30);
      this.rect(cx, cy, w, 5, color); this.rect(cx + 5, cy - 3, w - 12, 3, color); this.rect(cx + 10, cy - 5, w * 0.35, 2, color);
    }
  };
  // jagged mountain silhouette across the screen
  P.mountains = function (y, h, color, seed, offset, snowCap) {
    const W = this.W;
    offset = offset || 0;
    for (let x = 0; x < W; x++) {
      const wx = x + offset;
      const v = (Math.sin(wx * 0.013 + seed) * 0.5 + Math.sin(wx * 0.031 + seed * 2) * 0.3 + Math.sin(wx * 0.07 + seed * 3) * 0.2 + 1) / 2;
      const top = Math.round(y + h - v * h);
      this.rect(x, top, 1, y + h - top + 2, color);
      if (snowCap && v > 0.7) this.rect(x, top, 1, Math.round((v - 0.7) * h * 0.8) + 1, snowCap);
    }
  };
  P.trees = function (y, color, seed, offset, spacing) {
    spacing = spacing || 14; offset = offset || 0;
    for (let i = -1; i < this.W / spacing + 2; i++) {
      const wi = i + Math.floor(offset / spacing);
      const x = wi * spacing - offset + Math.floor(OG.hash(wi, seed, 5) * 6);
      const h = 10 + Math.floor(OG.hash(wi, seed, 6) * 10);
      for (let k = 0; k < h; k++) {
        const hw = Math.floor((k / h) * 5) + 1;
        this.rect(x - hw, y - h + k, hw * 2 + 1, 1, color);
      }
      this.rect(x, y, 1, 3, PAL.darkbrown);
    }
  };
  P.water = function (x, y, w, h, t, c1, c2) {
    this.rect(x, y, w, h, c1 || PAL.water);
    const c = c2 || 'rgba(255,255,255,0.25)';
    for (let yy = 2; yy < h; yy += 6) {
      for (let xx = 0; xx < w; xx += 16) {
        const o = Math.floor((t * 10 + yy * 3) % 16);
        this.rect(x + ((xx + o) % w), y + yy, 5, 1, c);
      }
    }
  };
  P.snowfall = function (t, n, color) {
    n = n || 60;
    for (let i = 0; i < n; i++) {
      const x = M.wrap(OG.hash(i, 1, 9) * 520 + Math.sin(t + i) * 10, 500) - 10;
      const y = M.wrap(OG.hash(i, 2, 9) * 300 + t * (20 + OG.hash(i, 3, 9) * 25), 290) - 10;
      this.px(x, y, color || '#fff');
    }
  };
  P.confetti = function (t, n) {
    n = n || 80;
    const cols = ['#e43b44', '#feae34', '#0099db', '#63c74d', '#fee761', '#b55088', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const x = M.wrap(OG.hash(i, 1, 4) * 520 + Math.sin(t * 2 + i) * 14, 500) - 10;
      const y = M.wrap(OG.hash(i, 2, 4) * 300 + t * (30 + OG.hash(i, 3, 4) * 40), 290) - 10;
      this.rect(x, y, 2, Math.sin(t * 8 + i) > 0 ? 2 : 1, cols[i % cols.length]);
    }
  };
  // LED advertising boards (stadium)
  P.adBoards = function (x, y, w, h, t, texts) {
    texts = texts || ['DOT GAMES 2026', 'PIXEL SPORTS', 'AICHI-NAGOYA', '8-BIT POWER'];
    this.rect(x, y, w, h, PAL.black);
    const cols = [PAL.blue, PAL.red, PAL.green, PAL.purple];
    const seg = 120;
    const off = Math.floor(t * 20) % seg;
    for (let i = -1; i < w / seg + 1; i++) {
      const sx = x + i * seg - off;
      const k = M.wrap(i + Math.floor(t * 20 / seg), texts.length);
      this.rect(sx + 1, y + 1, seg - 2, h - 2, cols[k % cols.length]);
      this.text(texts[k], sx + seg / 2, y + Math.max(0, (h - 8) / 2), '#fff', { size: 'xs', align: 'center' });
    }
  };
  // Big centred banner text (e.g. countdown / FINISH)
  P.banner = function (str, y, c, opt) {
    opt = opt || {};
    this.text(str, this.W / 2, y, c || PAL.yellow, { size: opt.size || 'xl', align: 'center', outline: PAL.black });
  };
  // Generic countdown overlay: pass seconds remaining of a 3s countdown (3..0) → draws 3,2,1,GO
  P.countdown = function (remain) {
    if (remain > 3 || remain < -0.6) return;
    const label = remain > 2 ? '3' : remain > 1 ? '2' : remain > 0 ? '1' : 'GO!';
    const col = remain > 0 ? PAL.white : PAL.green;
    this.text(label, this.W / 2, 100, col, { size: 'xxl', align: 'center', outline: PAL.black });
  };
})(typeof window !== 'undefined' ? window : globalThis);
