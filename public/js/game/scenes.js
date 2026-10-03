/* =========================================================================
 * Scenes — menus, lobby (country select), tournament flow, results,
 * medal ceremony, medal table, closing ceremony.
 * Each scene: { enter(App, args), update(App, ctx, dt), draw(g, S, App) }
 * draw() must only read S (it also runs on online clients).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG, M = OG.M, PAL = OG.PAL;
  const SC = OG.scenes = {};

  /* ------------------------------ UI kit ------------------------------- */
  const UI = OG.UI = {
    bg(g, t, c1, c2) {
      g.grad(0, 0, 480, 270, c1 || '#1b1838', c2 || '#0d0b16', 10);
      for (let i = 0; i < 40; i++) {
        const x = M.wrap(OG.hash(i, 1, 1) * 480 - t * (6 + OG.hash(i, 2, 2) * 10), 480);
        const y = OG.hash(i, 3, 3) * 270;
        g.px(x, y, OG.hash(i, 4, Math.floor(t * 2)) > 0.3 ? '#3a4466' : '#5a6988');
      }
    },
    header(g, title, color, sub) {
      g.rect(0, 0, 480, 22, '#181425');
      g.rect(0, 22, 480, 1, color || PAL.gold);
      g.text(title, 8, 5, color || PAL.gold, { size: 'l' });
      if (sub) g.text(sub, 472, 7, '#8b9bb4', { size: 's', align: 'right' });
    },
    footer(g, txt) {
      g.rect(0, 256, 480, 14, '#181425');
      g.rect(0, 255, 480, 1, '#3a4466');
      g.rich(txt, 240, 258, '#c0cbdc', { align: 'center', size: 'xs' });
    },
    blink(g) { return Math.floor(g.t * 2.5) % 2 === 0; },
    tagBox(g, x, y, txt, c) {
      const w = g.textW(txt, 'xs') + 6;
      g.rect(x, y, w, 10, c); g.text(txt, x + 3, y + 1, '#181425', { size: 'xs' });
      return w;
    }
  };
  const MODE_MAP = {}; OG.MODES.forEach(m => { MODE_MAP[m.key] = m; });
  const COUNT_OPTS = [5, 10, 15, 20, 30, 999, -1]; // 999 = all, -1 = custom
  const countLabel = c => c === 999 ? '전체' : c === -1 ? '직접 선택' : c + '개';

  function menuNav(App, sd, menu, n, key) {
    key = key || 'sel';
    if (menu.up) { sd[key] = (sd[key] + n - 1) % n; App.sfx('select'); }
    if (menu.dp) { sd[key] = (sd[key] + 1) % n; App.sfx('select'); }
  }
  // fire on press, then repeat while held
  function rep(sd, id, held, pressed, dt) {
    const r = sd.rep || (sd.rep = {});
    if (pressed) { r[id] = -0.32; return true; }
    if (!held) { delete r[id]; return false; }
    if (r[id] == null) return false;
    r[id] += dt;
    if (r[id] > 0.055) { r[id] = 0; return true; }
    return false;
  }

  /* =============================== TITLE =============================== */
  SC.title = {
    enter(App) { App.S.sd = { t: 0 }; },
    update(App, ctx, dt) {
      const sd = App.S.sd; sd.t += dt;
      if (sd.t > 0.4 && (ctx.menu.ap || ctx.menu.esc || ctx.gl.any && (ctx.menu.lp || ctx.menu.rp || ctx.menu.up || ctx.menu.dp || ctx.menu.ap))) { App.sfx('confirm'); App.go('menu'); }
    },
    draw(g, S) {
      const t = g.t;
      g.grad(0, 0, 480, 190, '#1a1446', '#e0705a', 12);
      // stars
      for (let i = 0; i < 50; i++) g.px(OG.hash(i, 5, 5) * 480, OG.hash(i, 6, 6) * 90, OG.hash(i, 7, Math.floor(t * 3)) > 0.2 ? '#ffffff' : '#8b9bb4');
      // sun
      g.circle(380, 150, 34, '#feae34'); g.circle(380, 150, 28, '#fee761');
      for (let y = 128; y < 190; y += 6) g.rect(340, y, 80, 2, '#e0705a');
      // stadium silhouette
      g.poly([0, 190, 40, 150, 140, 136, 340, 136, 440, 150, 480, 190], '#2a1f4a');
      for (let x = 50; x < 440; x += 20) g.rect(x, 140 + Math.abs(x - 240) / 18, 2, 12, '#3e2f66');
      for (let i = 0; i < 6; i++) { const x = 60 + i * 72; g.rect(x, 112, 2, 30, '#3e2f66'); g.rect(x - 4, 110, 10, 4, OG.hash(i, Math.floor(t * 4), 1) > 0.3 ? '#fee761' : '#feae34'); }
      // fireworks
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.5 + k * 0.33) % 1;
        const fx = 60 + OG.hash(k, Math.floor(t * 0.5 + k * 0.33), 1) * 360, fy = 30 + OG.hash(k, Math.floor(t * 0.5 + k * 0.33), 2) * 50;
        const col = ['#ff0044', '#2ce8f5', '#fee761', '#63c74d'][k % 4];
        if (ph < 0.6) for (let a = 0; a < 12; a++) { const r = ph * 40; g.px(fx + Math.cos(a / 12 * M.TAU) * r, fy + Math.sin(a / 12 * M.TAU) * r + ph * ph * 10, col); }
      }
      g.rect(0, 190, 480, 80, '#181425');
      // torch
      const tx = 240, ty = 118;
      g.rect(tx - 3, ty, 6, 26, '#c0cbdc'); g.rect(tx - 6, ty - 4, 12, 6, '#feae34'); g.rect(tx - 6, ty - 4, 12, 1, '#fee761');
      for (let i = 0; i < 18; i++) {
        const fx = tx + Math.sin(t * 9 + i) * (5 - i * 0.25), fy = ty - 6 - i * 1.4 - Math.abs(Math.sin(t * 7 + i * 2)) * 3;
        g.rect(fx - 2, fy, 4, 2, i < 6 ? '#fee761' : i < 12 ? '#feae34' : '#e43b44');
      }
      // title
      g.text('도트 올림픽', 240, 26, '#ffffff', { size: 'xxl', align: 'center', outline: '#181425' });
      g.text('2026', 240, 60, PAL.gold, { size: 'xl', align: 'center', outline: '#181425' });
      g.text('하계 · 동계 · 아시안게임 아이치-나고야', 240, 88, '#fee761', { size: 's', align: 'center', shadow: '#181425' });
      // parade of flags
      const n = OG.COUNTRIES.length;
      const off = (t * 26) % (n * 22);
      for (let i = 0; i < 24; i++) {
        const k = Math.floor((off / 22) + i) % n;
        const x = i * 22 - (off % 22) - 10;
        const c = OG.COUNTRIES[k];
        g.flag(c.code, x, 200 + Math.round(Math.sin(t * 4 + i) * 1.5), 18, 12, { wave: t + i });
      }
      g.text(OG.COUNTRIES.length + '개국 · ' + OG.EVENTS.length + '개 종목 · 최대 8인 멀티', 240, 224, '#8b9bb4', { size: 's', align: 'center' });
      if (UI.blink(g)) g.text('PRESS START', 240, 240, '#ffffff', { size: 'm', align: 'center', outline: '#181425' });
      g.text('P1 SPACE · P2 ENTER', 476, 260, '#5a6988', { size: 'xs', align: 'right' });
    }
  };

  /* ============================== MAIN MENU ============================= */
  const MENU = [
    { key: 'tour', ko: '대회 시작', sub: '1~4인 로컬 대회 · 메달 경쟁' },
    { key: 'online', ko: '온라인 멀티', sub: '방을 만들거나 참가 (최대 8인)' },
    { key: 'practice', ko: '종목 연습', sub: '원하는 종목 하나만 바로 플레이' },
    { key: 'controls', ko: '조작법', sub: '키보드 4인 / 게임패드' },
    { key: 'settings', ko: '설정', sub: '난이도 · 사운드 · 기록' }
  ];
  SC.menu = {
    enter(App) { App.S.sd = { sel: 0, t: 0 }; App.S.players = []; App.S.tour = null; },
    update(App, ctx, dt) {
      const sd = App.S.sd, m = ctx.menu;
      sd.t += dt;
      menuNav(App, sd, m, MENU.length);
      if (m.esc) { App.go('title'); return; }
      if (m.ap) {
        App.sfx('confirm');
        const k = MENU[sd.sel].key;
        if (k === 'tour') App.go('lobby', {});
        else if (k === 'practice') App.go('lobby', { practice: true });
        else if (k === 'online') OG.Net.openDialog();
        else App.go(k);
      }
    },
    draw(g, S) {
      UI.bg(g, g.t);
      UI.header(g, '도트 올림픽 2026', PAL.gold, 'MAIN MENU');
      const sd = S.sd;
      MENU.forEach((it, i) => {
        const y = 44 + i * 36, on = i === sd.sel;
        g.panel(40, y, 220, 30, { bg: on ? '#3a4466' : 'rgba(24,20,37,0.8)', border: on ? PAL.gold : '#3a4466' });
        if (on) g.text('▶', 48, y + 8, PAL.gold, { size: 'm' });
        g.text(it.ko, 62, y + 4, on ? '#ffffff' : '#c0cbdc', { size: 'l' });
        g.text(it.sub, 62, y + 19, '#8b9bb4', { size: 'xs' });
      });
      // right side info
      g.panel(280, 44, 180, 174, { title: 'DOT GAMES' });
      const cnt = k => OG.EVENTS.filter(e => e.tags.indexOf(k) >= 0).length;
      const rows = [['☀️', '하계 올림픽', cnt('summer'), PAL.gold], ['❄️', '동계 올림픽', cnt('winter'), PAL.cyan], ['🌏', '아시안게임 2026', cnt('asian'), '#ff0044']];
      rows.forEach((r, i) => {
        g.emoji(r[0], 292, 58 + i * 22, 12);
        g.text(r[1], 310, 59 + i * 22, r[3], { size: 's' });
        g.text(r[2] + '종목', 450, 59 + i * 22, '#ffffff', { size: 's', align: 'right' });
      });
      g.text('전 세계 ' + OG.COUNTRIES.length + '개국 참가', 370, 132, '#ffffff', { size: 's', align: 'center' });
      for (let i = 0; i < 7; i++) {
        const c = OG.COUNTRIES[Math.floor(M.wrap(g.t * 1.2 + i * 31, OG.COUNTRIES.length))];
        g.flag(c.code, 292 + i * 23, 150, 18, 12, { wave: g.t + i });
      }
      g.text('신규: 서핑 · MMA · 파델 · 테크볼', 370, 176, '#63c74d', { size: 'xs', align: 'center' });
      g.text('카바디 · 세팍타크로 · 우슈 · 크리켓', 370, 188, '#8b9bb4', { size: 'xs', align: 'center' });
      g.text('스키마운티니어링 (밀라노-코르티나)', 370, 200, '#8b9bb4', { size: 'xs', align: 'center' });
      UI.footer(g, '{U}{D} 이동   {A} 선택   ESC 뒤로');
    }
  };

  /* ============================ CONTROLS =============================== */
  SC.controls = {
    enter(App) { App.S.sd = {}; },
    update(App, ctx) { if (ctx.menu.ap || ctx.menu.esc) { App.sfx('back'); App.go('menu'); } },
    draw(g) {
      UI.bg(g, g.t);
      UI.header(g, '조작법', PAL.gold, '버튼 5개: ◀ ▶ ▲ ▼ ACTION');
      OG.KEY_LABELS.forEach((k, i) => {
        const x = 16 + (i % 2) * 230, y = 34 + Math.floor(i / 2) * 78;
        g.panel(x, y, 218, 70, { title: 'P' + (i + 1), titleColor: '#181425', border: OG.PCOLORS[i] });
        const keys = [['◀', k.l], ['▶', k.r], ['▲', k.u], ['▼', k.d], ['ACTION', k.a]];
        keys.forEach((kk, j) => {
          g.text(kk[0], x + 12 + (j % 3) * 70, y + 12 + Math.floor(j / 3) * 26, '#8b9bb4', { size: 'xs' });
          g.text(kk[1], x + 12 + (j % 3) * 70, y + 22 + Math.floor(j / 3) * 26, '#ffffff', { size: 'm' });
        });
      });
      g.text('🎮 게임패드: 연결 순서대로 P1~P4 · 십자키/스틱 = 방향 · A = ACTION · LB/RB = ◀▶ 연타', 240, 196, '#c0cbdc', { size: 'xs', align: 'center' });
      g.text('대부분의 달리기 종목은 ◀▶ 번갈아 연타! 종목 시작 전 화면에 자세한 설명이 나옵니다.', 240, 212, '#fee761', { size: 'xs', align: 'center' });
      g.text('키보드 하나에 여러 명이 동시에 누르면 일부 키가 인식되지 않을 수 있어요 (키보드 한계).', 240, 226, '#8b9bb4', { size: 'xs', align: 'center' });
      UI.footer(g, '{A} / ESC 돌아가기');
    }
  };

  /* ============================ SETTINGS =============================== */
  SC.settings = {
    enter(App) { App.S.sd = { sel: 0, wipe: 0 }; },
    update(App, ctx) {
      const S = App.S, sd = S.sd, m = ctx.menu, st = S.settings;
      menuNav(App, sd, m, 5);
      const d = m.lp ? -1 : m.rp ? 1 : 0;
      if (m.esc || (sd.sel === 4 && m.ap)) { App.saveStore(); App.sfx('back'); App.go('menu'); return; }
      if (sd.sel === 0 && d) { st.difficulty = M.clamp(st.difficulty + d, 0, 2); App.sfx('select'); }
      if (sd.sel === 1 && (d || m.ap)) { st.sound = !st.sound; App.sfx('select'); }
      if (sd.sel === 2 && (d || m.ap)) { st.music = !st.music; OG.Audio.musicOn = st.music; if (!st.music) OG.Audio.stopMusic(); App.sfx('select'); }
      if (sd.sel === 3 && m.ap) { sd.wipe++; if (sd.wipe >= 2) { App.store.records = {}; App.saveStore(); sd.wipe = 0; App.sfx('fail'); } else App.sfx('beep'); }
      if (sd.sel !== 3) sd.wipe = 0;
      OG.Audio.enabled = st.sound || st.music;
    },
    draw(g, S) {
      UI.bg(g, g.t);
      UI.header(g, '설정', PAL.gold);
      const st = S.settings, sd = S.sd;
      const rows = [['CPU 난이도', OG.DIFFS[st.difficulty].ko], ['효과음', st.sound ? '켜짐' : '꺼짐'], ['음악', st.music ? '켜짐' : '꺼짐'],
        ['기록 초기화', sd.wipe ? '한 번 더 누르면 삭제!' : '{A} 두 번'], ['돌아가기', '']];
      rows.forEach((r, i) => {
        const y = 46 + i * 34, on = i === sd.sel;
        g.panel(80, y, 320, 26, { bg: on ? '#3a4466' : 'rgba(24,20,37,0.8)', border: on ? PAL.gold : '#3a4466' });
        g.text(r[0], 96, y + 7, on ? '#fff' : '#c0cbdc', { size: 'm' });
        if (r[1]) g.rich((i < 3 && on ? '◀ ' : '') + r[1] + (i < 3 && on ? ' ▶' : ''), 384, y + 8, i === 3 && sd.wipe ? PAL.red : PAL.yellow, { align: 'right', size: 's' });
      });
      UI.footer(g, '{U}{D} 이동   {L}{R} 변경   ESC 저장 후 나가기');
    }
  };

  /* ============================== LOBBY ================================ */
  const DEFAULT_C = ['KOR', 'JPN', 'USA', 'CHN', 'GBR', 'FRA', 'BRA', 'KEN'];
  function countryIndex(code) { const i = OG.COUNTRIES.findIndex(c => c.code === code); return i < 0 ? 0 : i; }
  function regionStart(i, dir) {
    const C = OG.COUNTRIES, r = C[i].region;
    const order = OG.REGIONS.map(x => x.key);
    const ri = M.wrap(order.indexOf(r) + dir, order.length);
    const target = order[ri];
    const j = C.findIndex(c => c.region === target);
    return j < 0 ? i : j;
  }
  function freePid(S) { for (let p = 0; p < 8; p++) if (!S.players.some(x => x.pid === p)) return p; return -1; }
  OG.addPlayer = function (App, src, country) {
    const S = App.S;
    const pid = freePid(S);
    if (pid < 0) return null;
    const saved = (App.store.lastCountry || {})[src.type === 'local' ? src.slot : 'r'];
    const code = country || saved || DEFAULT_C[pid] || 'KOR';
    const p = { pid, country: code, ci: countryIndex(code), src, state: 'choose', name: src.name || '' };
    S.players.push(p);
    S.players.sort((a, b) => a.pid - b.pid);
    return p;
  };
  OG.removePlayerByCid = function (App, cid) {
    const S = App.S;
    S.players = S.players.filter(p => !(p.src.type === 'remote' && p.src.cid === cid));
  };
  SC.lobby = {
    enter(App, args) {
      const S = App.S;
      S.sd = { practice: !!args.practice, t: 0, startArm: 0 };
      // keep remote players, reset their state
      S.players = S.players.filter(p => p.src.type === 'remote');
      S.players.forEach(p => { p.state = 'choose'; });
    },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd;
      sd.t += dt;
      if (ctx.menu.esc) { App.sfx('back'); if (App.mode === 'host') OG.Net.leave(); App.go('menu'); return; }
      // local join
      ctx.local.forEach((inp, slot) => {
        if (!S.players.some(p => p.src.type === 'local' && p.src.slot === slot) && inp.ap && sd.t > 0.2) {
          if (S.players.length < 8) { OG.addPlayer(App, { type: 'local', slot }); App.sfx('coin'); inp.ap = false; }
        }
      });
      const inputs = App.inputsFor(ctx.local);
      let allReady = S.players.length > 0;
      S.players.forEach(p => {
        const inp = inputs[p.pid] || OG.blankInput();
        if (p.state === 'choose') {
          allReady = false;
          const n = OG.COUNTRIES.length;
          if (rep(sd, 'l' + p.pid, inp.l, inp.lp, dt)) { p.ci = M.wrap(p.ci - 1, n); App.sfx('select'); }
          if (rep(sd, 'r' + p.pid, inp.r, inp.rp, dt)) { p.ci = M.wrap(p.ci + 1, n); App.sfx('select'); }
          if (inp.up) { p.ci = regionStart(p.ci, -1); App.sfx('select'); }
          if (inp.dp) { p.ci = regionStart(p.ci, 1); App.sfx('select'); }
          p.country = OG.COUNTRIES[p.ci].code;
          if (inp.ap) { p.state = 'ready'; p.readyT = 0; App.sfx('confirm'); const lc = App.store.lastCountry || (App.store.lastCountry = {}); lc[p.src.type === 'local' ? p.src.slot : 'r'] = p.country; App.saveStore(); }
        } else {
          p.readyT = (p.readyT || 0) + dt;
          if (inp.dp || inp.lp || inp.rp) { p.state = 'choose'; App.sfx('back'); }
          else if (inp.ap && p.readyT > 0.25) sd.startArm = 1;
        }
      });
      if (allReady && sd.startArm) {
        App.sfx('confirm');
        if (sd.practice) App.go('pick', { practice: true }); else App.go('setup');
      }
      sd.startArm = 0;
    },
    draw(g, S, App) {
      UI.bg(g, g.t, '#1b1838', '#0d0b16');
      UI.header(g, S.sd.practice ? '종목 연습 — 국가 선택' : '참가 국가 선택', PAL.gold, S.room ? '방 코드 ' + S.room : '로컬 멀티 (최대 ' + (S.room ? 8 : 4) + '인)');
      const n = Math.max(4, S.players.length);
      const two = n > 4;
      const cols = 4, pw = 112, ph = two ? 108 : 196;
      const slots = [];
      // local slots not joined yet → join hints; plus joined players
      const shown = S.players.slice();
      for (let s = 0; s < 4 && shown.length < (two ? 8 : 4); s++) {
        if (!S.players.some(p => p.src.type === 'local' && p.src.slot === s) && App.mode !== 'client') shown.push({ empty: true, slot: s });
      }
      shown.slice(0, two ? 8 : 4).forEach((p, i) => {
        const x = 8 + (i % cols) * (pw + 4), y = 30 + Math.floor(i / cols) * (ph + 4);
        slots.push([p, x, y]);
      });
      slots.forEach(([p, x, y]) => {
        if (p.empty) {
          g.panel(x, y, pw, ph, { bg: 'rgba(24,20,37,0.6)', border: '#3a4466' });
          const k = OG.KEY_LABELS[p.slot];
          g.text('P' + (p.slot + 1) + ' 자리', x + pw / 2, y + ph / 2 - 22, '#5a6988', { size: 'm', align: 'center' });
          if (UI.blink(g)) g.text(k.a + ' 눌러 참가', x + pw / 2, y + ph / 2 - 4, '#c0cbdc', { size: 's', align: 'center' });
          g.text(k.l + k.r + k.u + k.d, x + pw / 2, y + ph / 2 + 12, '#5a6988', { size: 'xs', align: 'center' });
          return;
        }
        const col = OG.PCOLORS[p.pid];
        const c = OG.COUNTRY_MAP[p.country] || OG.COUNTRIES[0];
        const ready = p.state === 'ready';
        g.panel(x, y, pw, ph, { bg: ready ? '#262b44' : 'rgba(24,20,37,0.9)', border: col });
        g.text('P' + (p.pid + 1), x + 6, y + 4, col, { size: 'b' });
        if (App && App.mode === 'client' && p.pid === App.myPid && UI.blink(g)) g.text('◀ 나', x + 26, y + 5, col, { size: 'xs' });
        const src = p.src.type === 'local' ? OG.KEY_LABELS[p.src.slot].a : '온라인';
        g.text(src, x + pw - 6, y + 5, '#8b9bb4', { size: 'xs', align: 'right' });
        const big = !two;
        const fw = big ? 72 : 42, fh = big ? 48 : 28;
        const fy = y + 20;
        g.flag(c.code, x + pw / 2 - fw / 2, fy, fw, fh, { wave: ready ? g.t : null });
        if (!ready) {
          g.text('◀', x + 6, fy + fh / 2 - 6, UI.blink(g) ? col : '#5a6988', { size: 'm' });
          g.text('▶', x + pw - 14, fy + fh / 2 - 6, UI.blink(g) ? col : '#5a6988', { size: 'm' });
        }
        let ty = fy + fh + 6;
        g.text(c.ko, x + pw / 2, ty, '#ffffff', { size: big ? 'm' : 's', align: 'center', maxW: pw - 8 }); ty += big ? 15 : 12;
        g.text(c.en, x + pw / 2, ty, '#8b9bb4', { size: 'xs', align: 'center', maxW: pw - 8 }); ty += 11;
        if (big) {
          const reg = OG.REGIONS.find(r => r.key === c.region);
          g.text(c.code + ' · ' + (reg ? reg.ko : ''), x + pw / 2, ty, '#c0cbdc', { size: 'xs', align: 'center' }); ty += 12;
          // kit preview
          g.figure(x + pw / 2, ty + 34, ready ? OG.Pose.celebrate(g.t) : OG.Pose.stand(), OG.lookOf({ country: c.code, look: p.pid * 41 }), { scale: 1 });
          ty += 40;
          g.text('전력 ' + '★'.repeat(Math.max(1, Math.round(c.power / 20))), x + pw / 2, ty, '#feae34', { size: 'xs', align: 'center' }); ty += 12;
        }
        if (ready) g.text('준비 완료!', x + pw / 2, y + ph - 16, PAL.green, { size: big ? 'm' : 's', align: 'center' });
        else g.text(big ? '▲▼ 대륙  A 결정' : 'A 결정', x + pw / 2, y + ph - 14, '#8b9bb4', { size: 'xs', align: 'center' });
      });
      const allReady = S.players.length > 0 && S.players.every(p => p.state === 'ready');
      if (allReady && UI.blink(g)) g.text('모두 준비 완료! ACTION을 한 번 더 누르면 시작', 240, 236, PAL.yellow, { size: 's', align: 'center', outline: '#181425' });
      else if (!S.players.length) g.text('각자 자기 ACTION 키를 눌러 참가하세요', 240, 236, '#c0cbdc', { size: 's', align: 'center' });
      UI.footer(g, '{L}{R} 국가 변경   {U}{D} 대륙 이동   {A} 결정   {D} 취소   ESC 뒤로');
    }
  };

  /* ============================== SETUP ================================ */
  SC.setup = {
    enter(App) { App.S.sd = { sel: 0 }; },
    update(App, ctx) {
      const S = App.S, sd = S.sd, m = ctx.menu, st = S.settings;
      menuNav(App, sd, m, 4);
      if (m.esc) { App.sfx('back'); App.go('lobby'); return; }
      const d = m.lp ? -1 : m.rp ? 1 : 0;
      if (d) {
        App.sfx('select');
        if (sd.sel === 0) { const i = OG.MODES.findIndex(x => x.key === st.mode); st.mode = OG.MODES[M.wrap(i + d, OG.MODES.length)].key; }
        if (sd.sel === 1) { const i = Math.max(0, COUNT_OPTS.indexOf(st.count)); st.count = COUNT_OPTS[M.wrap(i + d, COUNT_OPTS.length)]; }
        if (sd.sel === 2) st.difficulty = M.clamp(st.difficulty + d, 0, 2);
      }
      if (COUNT_OPTS.indexOf(st.count) < 0) st.count = 10;
      if (m.ap) {
        App.saveStore();
        App.sfx('confirm');
        if (st.count === -1) { App.go('pick', { practice: false }); return; }
        const R = OG.rng(S);
        App.startTournament(App.buildProgram(st.mode, st.count, R));
      }
    },
    draw(g, S, App) {
      const st = S.settings, sd = S.sd;
      const md = MODE_MAP[st.mode];
      UI.bg(g, g.t);
      UI.header(g, '대회 설정', md.color, S.players.length + '명 참가');
      const evs = App.eventsForMode(st.mode);
      const rows = [['대회', md.icon + ' ' + md.ko], ['종목 수', countLabel(st.count) + (st.count > 0 && st.count < 999 ? '' : st.count === 999 ? ' (' + evs.length + ')' : '')], ['CPU 난이도', OG.DIFFS[st.difficulty].ko], ['▶ 대회 시작!', '']];
      rows.forEach((r, i) => {
        const y = 36 + i * 30, on = i === sd.sel;
        g.panel(24, y, 250, 24, { bg: on ? '#3a4466' : 'rgba(24,20,37,0.8)', border: on ? md.color : '#3a4466' });
        g.text(r[0], 36, y + 6, on ? '#fff' : '#c0cbdc', { size: i === 3 ? 'b' : 'm' });
        if (r[1]) g.text((on ? '◀ ' : '') + r[1] + (on ? ' ▶' : ''), 264, y + 7, PAL.yellow, { size: 's', align: 'right' });
      });
      // mode description
      const desc = {
        summer: ['LA 2028 대비 하계 종목 총집합', '육상 · 수영 · 체조 · 구기 · 격투기 …'],
        winter: ['2026 밀라노-코르티나 동계 종목', '스키 · 스케이트 · 썰매 · 컬링 · 산악스키'],
        asian: ['2026 아이치-나고야 아시안게임', '카바디 · 세팍타크로 · 우슈 · 크리켓 · 신규 MMA/파델/테크볼/서핑'],
        all: ['하계 + 동계 + 아시안게임', '모든 종목을 한 대회에서!']
      }[st.mode];
      g.text(desc[0], 30, 160, '#ffffff', { size: 's' });
      g.text(desc[1], 30, 174, '#8b9bb4', { size: 'xs' });
      // sports icons of mode
      const sports = [];
      evs.forEach(e => { if (sports.indexOf(e.sport) < 0) sports.push(e.sport); });
      g.text(evs.length + '개 종목 · ' + sports.length + '개 스포츠', 30, 188, PAL.yellow, { size: 'xs' });
      sports.slice(0, 28).forEach((sp, i) => g.emoji(OG.SPORTS[sp] ? OG.SPORTS[sp].icon : '•', 30 + (i % 14) * 17, 202 + Math.floor(i / 14) * 18, 12));
      // players
      g.panel(290, 36, 176, 210, { title: '참가 선수' });
      S.players.forEach((p, i) => {
        const y = 48 + i * 24;
        g.text('P' + (p.pid + 1), 300, y + 2, OG.PCOLORS[p.pid], { size: 's' });
        g.flag(p.country, 322, y + 1, 18, 12);
        g.text(OG.countryName(p.country), 346, y + 2, '#fff', { size: 's', maxW: 112 });
      });
      g.text('나머지는 전 세계 CPU 국가', 378, 232, '#8b9bb4', { size: 'xs', align: 'center' });
      UI.footer(g, '{U}{D} 항목   {L}{R} 변경   {A} 시작   ESC 뒤로');
    }
  };

  /* ============================ EVENT PICK ============================= */
  const TABS = ['summer', 'winter', 'asian', 'all'];
  function pickList(tab) {
    const evs = OG.EVENTS.filter(e => OG.engines[e.engine] && (tab === 'all' || e.tags.indexOf(tab) >= 0));
    return evs.sort((a, b) => ((OG.SPORTS[a.sport] || {}).order || 0) - ((OG.SPORTS[b.sport] || {}).order || 0)).map(e => e.id);
  }
  SC.pick = {
    enter(App, args) {
      const tab = Math.max(0, TABS.indexOf(App.S.settings.mode));
      App.S.sd = { practice: !!args.practice, tab, cur: 0, scroll: 0, chosen: [], list: pickList(TABS[tab]) };
    },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd, m = ctx.menu;
      if (m.esc) { App.sfx('back'); App.go(sd.practice ? 'lobby' : 'setup'); return; }
      if (m.lp || m.rp) { sd.tab = M.wrap(sd.tab + (m.rp ? 1 : -1), TABS.length); sd.list = pickList(TABS[sd.tab]); sd.cur = 0; sd.scroll = 0; App.sfx('select'); }
      const n = sd.list.length + (sd.practice ? 0 : 1);
      if (rep(sd, 'u', m.u, m.up, dt)) { sd.cur = M.wrap(sd.cur - 1, n); App.sfx('select'); }
      if (rep(sd, 'd', m.d, m.dp, dt)) { sd.cur = M.wrap(sd.cur + 1, n); App.sfx('select'); }
      const vis = 15;
      if (sd.cur < sd.scroll) sd.scroll = sd.cur;
      if (sd.cur >= sd.scroll + vis) sd.scroll = sd.cur - vis + 1;
      if (m.ap) {
        if (sd.practice) { App.sfx('confirm'); App.startTournament([sd.list[sd.cur]]); S.tour.practice = true; return; }
        if (sd.cur === 0) {
          if (sd.chosen.length) { App.sfx('confirm'); App.startTournament(sd.chosen.slice()); } else App.sfx('fail');
          return;
        }
        const id = sd.list[sd.cur - 1];
        const k = sd.chosen.indexOf(id);
        if (k >= 0) sd.chosen.splice(k, 1); else sd.chosen.push(id);
        App.sfx('click');
      }
    },
    draw(g, S, App) {
      const sd = S.sd;
      UI.bg(g, g.t);
      UI.header(g, sd.practice ? '종목 연습 — 종목 선택' : '종목 직접 선택', PAL.gold, sd.practice ? '' : sd.chosen.length + '개 선택');
      TABS.forEach((t, i) => {
        const md = MODE_MAP[t], on = i === sd.tab;
        g.rect(8 + i * 118, 26, 114, 14, on ? md.color : '#262b44');
        g.text(md.ko, 8 + i * 118 + 57, 28, on ? '#181425' : '#8b9bb4', { size: 's', align: 'center' });
      });
      const off = sd.practice ? 0 : 1;
      const vis = 15;
      for (let r = 0; r < vis; r++) {
        const i = sd.scroll + r;
        const y = 44 + r * 14;
        if (i >= sd.list.length + off) break;
        const on = i === sd.cur;
        if (on) g.rect(8, y - 1, 300, 14, '#3a4466');
        if (!sd.practice && i === 0) { g.text('▶ 선택한 ' + sd.chosen.length + '개 종목으로 대회 시작', 14, y + 1, sd.chosen.length ? PAL.green : '#5a6988', { size: 's' }); continue; }
        const ev = OG.EVENT_MAP[sd.list[i - off]];
        if (!sd.practice) g.text(sd.chosen.indexOf(ev.id) >= 0 ? '☑' : '☐', 12, y, PAL.yellow, { size: 's' });
        g.emoji(ev.icon, sd.practice ? 12 : 26, y, 10);
        g.text(ev.name, sd.practice ? 28 : 42, y + 1, on ? '#fff' : '#c0cbdc', { size: 's', maxW: 170 });
        const eng = OG.engines[ev.engine];
        g.text(eng && eng.type === 'duel' ? '토너먼트' : '기록전', 300, y + 1, eng && eng.type === 'duel' ? PAL.orange : '#5a6988', { size: 'xs', align: 'right' });
      }
      // scrollbar
      const total = sd.list.length + off;
      if (total > vis) { g.rect(310, 44, 2, vis * 14, '#262b44'); g.rect(310, 44 + (sd.scroll / total) * vis * 14, 2, Math.max(6, vis / total * vis * 14), '#8b9bb4'); }
      // details
      const idx = sd.cur - off;
      const ev = idx >= 0 ? OG.EVENT_MAP[sd.list[idx]] : null;
      g.panel(320, 44, 152, 206, { title: '종목 정보' });
      if (ev) {
        g.emoji(ev.icon, 332, 56, 24);
        g.text(ev.name, 362, 58, '#fff', { size: 'm', maxW: 106 });
        g.text((OG.SPORTS[ev.sport] || {}).ko || '', 362, 72, '#8b9bb4', { size: 'xs' });
        let tx = 330;
        ev.tags.forEach(t => { tx += UI.tagBox(g, tx, 88, MODE_MAP[t].ko, MODE_MAP[t].color) + 3; });
        ev.help.forEach((h, i) => wrapRich(g, h, 330, 106 + i * 26, 136));
        const rec = App && App.getRecord ? App.getRecord(ev.id) : null;
        if (rec) { g.text('내 최고 기록', 330, 222, PAL.gold, { size: 'xs' }); g.flag(rec.country, 330, 233, 12, 8); g.text(rec.text, 346, 232, '#fff', { size: 's' }); }
      }
      UI.footer(g, '{L}{R} 탭   {U}{D} 이동   {A} ' + (sd.practice ? '플레이' : '선택') + '   ESC 뒤로');
    }
  };
  // simple word-wrap for rich help text (max 2 lines)
  function wrapRich(g, txt, x, y, w) {
    const words = txt.split(' ');
    let line = '', ly = y, lines = 0;
    words.forEach(wd => {
      const test = line ? line + ' ' + wd : wd;
      if (g.textW(test.replace(/\{[A-Z]\}/g, 'WW'), 'xs') > w && line) { g.rich(line, x, ly, '#c0cbdc', { size: 'xs' }); ly += 12; line = wd; lines++; }
      else line = test;
    });
    if (line) g.rich(line, x, ly, '#c0cbdc', { size: 'xs' });
  }
  OG.wrapRich = wrapRich;

  /* ============================== OPENING ============================== */
  // Parade of nations: every country marches in with its flag.
  SC.opening = {
    enter(App) { App.S.sd = { t: 0 }; App.sfx('cheer'); },
    update(App, ctx, dt) {
      const sd = App.S.sd; sd.t += dt;
      if ((sd.t > 0.6 && (ctx.menu.ap || ctx.menu.esc)) || sd.t > 17.5) { App.sfx('confirm'); App.go('schedule'); }
    },
    draw(g, S) {
      const t = S.sd.t, gt = g.t;
      const md = MODE_MAP[S.settings.mode] || MODE_MAP.all;
      g.grad(0, 0, 480, 120, '#070a1e', '#1d2450', 8);
      for (let i = 0; i < 40; i++) g.px(OG.hash(i, 9, 9) * 480, OG.hash(i, 8, 8) * 50, '#ffffff');
      g.crowd(0, 50, 480, 64, gt, { excite: 0.45, seed: 11, bg: '#1a1f3a' });
      g.adBoards(0, 114, 480, 9, gt, ['OPENING CEREMONY', md.en, 'DOT GAMES 2026', 'PARADE OF NATIONS']);
      g.rect(0, 123, 480, 147, '#3e8948');
      g.rect(0, 150, 480, 46, PAL.track);
      for (let k = 0; k < 4; k++) g.rect(0, 152 + k * 11, 480, 1, PAL.trackline);
      // cauldron
      const gap = 24;
      const head = t < 7 ? 70 * t + 25 * t * t : 1715 + 420 * (t - 7);
      const lit = head / gap > OG.COUNTRIES.length + 4;
      g.rect(440, 66, 6, 58, '#8b9bb4'); g.poly([426, 62, 460, 62, 452, 72, 434, 72], '#c0cbdc');
      if (lit) for (let i = 0; i < 14; i++) g.rect(437 + Math.sin(gt * 9 + i) * 6, 58 - i * 2 - Math.abs(Math.sin(gt * 7 + i)) * 3, 5, 2, i < 5 ? '#fee761' : i < 10 ? '#feae34' : '#e43b44');
      // parade
      const C = OG.COUNTRIES, n = C.length;
      const humanSet = {}; S.players.forEach(p => { humanSet[p.country] = p.pid; });
      for (let k = 0; k < 70; k++) {
        const idx = Math.floor(head / gap) - k;
        if (idx < 0) break;
        const c = C[idx % n];
        const x = 500 - (head - idx * gap);
        if (x < -30 || x > 500) continue;
        const lane = idx % 2;
        const y = 168 + lane * 18;
        const hp = humanSet[c.code];
        const J = g.figure(x, y, OG.Pose.walk((gt * 1.6 + idx * 0.3) % 1), OG.lookOf({ country: c.code, look: idx * 7 }), { facing: -1 });
        g.rect(J.hdR[0], J.hdR[1] - 22, 1, 24, '#c0cbdc');
        g.flag(c.code, J.hdR[0] - 18, J.hdR[1] - 22, 18, 12, { wave: gt + idx, border: hp != null ? OG.PCOLORS[hp] : null });
        if (hp != null) g.text('P' + (hp + 1), x, y - 46, OG.PCOLORS[hp], { size: 's', align: 'center', outline: '#181425' });
      }
      const shown = Math.min(n, Math.max(0, Math.floor(head / gap) + 1));
      g.rect(0, 0, 480, 20, 'rgba(24,20,37,0.85)');
      g.text('개회식 — ' + md.ko, 8, 4, md.color, { size: 'm' });
      g.text('입장 ' + shown + ' / ' + n + '개국', 472, 5, '#ffffff', { size: 's', align: 'right' });
      const cur = C[Math.max(0, Math.min(n - 1, Math.floor(head / gap) - 6)) % n];
      if (cur) { g.rect(140, 218, 200, 22, 'rgba(24,20,37,0.8)'); g.flag(cur.code, 148, 223, 18, 12); g.text(cur.ko + ' · ' + cur.en, 172, 223, '#fff', { size: 's', maxW: 160 }); }
      if (lit) g.text('🔥 성화 점화!', 330, 30, PAL.gold, { size: 'l', align: 'center', outline: '#181425' });
      UI.footer(g, '{A} 건너뛰기');
    }
  };

  /* ============================== SCHEDULE ============================= */
  SC.schedule = {
    enter(App) { App.S.sd = { t: 0, quit: 0 }; if (App.S.tour && App.S.tour.idx >= App.S.tour.events.length) App.go('final'); },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd, m = ctx.menu;
      sd.t += dt;
      if (m.esc) { sd.quit++; App.sfx('beep'); if (sd.quit >= 2) { App.go('menu'); return; } }
      if (m.ap && sd.t > 0.3) { App.sfx('confirm'); App.go('intro'); }
    },
    draw(g, S, App) {
      const tour = S.tour, sd = S.sd;
      if (!tour) return;
      const md = MODE_MAP[S.settings.mode] || MODE_MAP.all;
      UI.bg(g, g.t);
      UI.header(g, tour.practice ? '종목 연습' : md.ko + ' 일정', md.color, (tour.idx + 1) + ' / ' + tour.events.length + ' 종목');
      // event cards
      const cols = 6, cw = 76, ch = 30;
      const start = Math.max(0, Math.min(tour.idx - 10, tour.events.length - 24));
      tour.events.slice(start, start + 24).forEach((id, k) => {
        const i = start + k;
        const ev = OG.EVENT_MAP[id];
        const x = 6 + (k % cols) * (cw + 2), y = 28 + Math.floor(k / cols) * (ch + 2);
        const cur = i === tour.idx, done = i < tour.idx;
        g.rect(x, y, cw, ch, cur ? '#3a4466' : done ? '#181425' : '#262b44');
        if (cur) g.rectO(x, y, cw, ch, UI.blink(g) ? PAL.gold : '#8b9bb4');
        g.emoji(ev.icon, x + 3, y + 3, 10);
        g.text(ev.name, x + 17, y + 4, done ? '#5a6988' : '#fff', { size: 'xs', maxW: cw - 20 });
        const log = tour.log[id];
        if (done && log) {
          const best = log.best;
          if (best && best.rank <= 3) g.medal(x + 8, y + 22, best.rank, 3);
          g.text(best ? (best.tag + ' ' + best.rank + '위') : '', x + 15, y + 18, '#8b9bb4', { size: 'xs', maxW: cw - 18 });
        } else if (cur) g.text('NEXT ▶', x + cw - 4, y + 18, PAL.gold, { size: 'xs', align: 'right' });
      });
      // human countries medal summary
      const y0 = 164;
      g.panel(6, y0, 468, 86, { title: '우리 선수단 메달' });
      S.players.forEach((p, i) => {
        const x = 16 + (i % 4) * 114, y = y0 + 12 + Math.floor(i / 4) * 34;
        const m = S.medals[p.country] || [0, 0, 0];
        g.text('P' + (p.pid + 1), x, y + 2, OG.PCOLORS[p.pid], { size: 's' });
        g.flag(p.country, x + 20, y + 1, 18, 12);
        g.text(OG.countryName(p.country), x + 42, y + 2, '#fff', { size: 'xs', maxW: 66 });
        [0, 1, 2].forEach(k => { g.medal(x + 6 + k * 30, y + 24, k + 1, 4); g.text(String(m[k]), x + 13 + k * 30, y + 19, '#fff', { size: 's' }); });
      });
      UI.footer(g, sd.quit ? 'ESC 한 번 더 누르면 대회를 포기하고 메뉴로' : '{A} 다음 종목으로   ESC 대회 포기');
    }
  };

  /* =============================== INTRO =============================== */
  function bracketSeed(ents, size, R) {
    const humans = ents.filter(e => e.human), cpus = ents.filter(e => !e.human);
    cpus.sort((a, b) => b.skill - a.skill);
    const order = size === 4 ? [0, 2, 1, 3] : [0, 4, 2, 6, 1, 5, 3, 7];
    const slots = new Array(size).fill(-1);
    humans.forEach((h, i) => { slots[order[i]] = h.idx; });
    // strongest CPUs to slots far from humans (seeded), rest random
    const free = order.filter(s => slots[s] < 0);
    const rest = R.shuffle(cpus.slice());
    free.forEach((s, i) => { slots[s] = rest[i] ? rest[i].idx : -1; });
    const r0 = [];
    for (let i = 0; i < size; i += 2) r0.push({ a: slots[i], b: slots[i + 1], w: -1, text: '' });
    return { size, rounds: [r0] };
  }
  SC.intro = {
    enter(App) {
      const S = App.S;
      const ev = App.currentEvent();
      const eng = OG.engines[ev.engine];
      const R = OG.rng(S);
      const humans = S.players.map(p => ({ pid: p.pid, country: p.country }));
      let ents, br = null;
      if (eng.type === 'duel') {
        const size = humans.length <= 2 ? 4 : 8;
        ents = OG.makeEntrants(humans.slice(0, 8), size, S.settings.difficulty, R);
        br = bracketSeed(ents, size, R);
      } else ents = OG.makeEntrants(humans, Math.max(eng.fieldSize || 8, humans.length), S.settings.difficulty, R);
      S.sd = { evId: ev.id, ents, br, ready: {}, t: 0, go: 0 };
    },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd;
      sd.t += dt;
      if (ctx.menu.esc) { App.sfx('back'); App.go('schedule'); return; }
      S.players.forEach(p => { const inp = ctx.inputs[p.pid]; if (inp && inp.ap && sd.t > 0.5 && !sd.ready[p.pid]) { sd.ready[p.pid] = 1; App.sfx('coin'); } });
      const all = S.players.every(p => sd.ready[p.pid]) || sd.t > 40;
      if (all) { sd.go += dt; if (sd.go > 0.7) startEvent(App); }
    },
    draw(g, S) {
      const sd = S.sd;
      const ev = OG.EVENT_MAP[sd.evId];
      if (!ev) return;
      const eng = OG.engines[ev.engine];
      const sp = OG.SPORTS[ev.sport] || { ko: '' };
      const md = MODE_MAP[ev.tags[0]] || MODE_MAP.all;
      UI.bg(g, g.t, '#16203a', '#0d0b16');
      g.rect(0, 0, 480, 54, '#181425'); g.rect(0, 54, 480, 2, md.color);
      g.emoji(ev.icon, 12, 8, 36);
      g.text(ev.name, 58, 8, '#ffffff', { size: 'xl', maxW: 300 });
      g.text(sp.ko + (ev.en ? ' · ' + ev.en : ''), 60, 36, '#8b9bb4', { size: 's' });
      let tx = 470;
      ev.tags.slice().reverse().forEach(t => { const m = MODE_MAP[t]; const w = g.textW(m.ko, 'xs') + 6; tx -= w + 3; UI.tagBox(g, tx, 8, m.ko, m.color); });
      g.text(eng.type === 'duel' ? '⚔ 토너먼트 (1:1)' : '🏁 기록 경쟁', 470, 24, eng.type === 'duel' ? PAL.orange : PAL.cyan, { size: 's', align: 'right' });
      // help
      g.panel(8, 64, 274, 92, { title: '조작 방법' });
      ev.help.slice(0, 4).forEach((h, i) => g.rich(h, 18, 76 + i * 18, '#ffffff', { size: 's' }));
      // keys per player
      g.panel(8, 164, 274, 86, { title: '플레이어 키' });
      S.players.slice(0, 8).forEach((p, i) => {
        const x = 16 + (i % 2) * 134, y = 176 + Math.floor(i / 2) * 18;
        const k = p.src.type === 'local' ? OG.KEY_LABELS[p.src.slot] : null;
        g.text('P' + (p.pid + 1), x, y, OG.PCOLORS[p.pid], { size: 's' });
        g.flag(p.country, x + 18, y + 1, 12, 8);
        g.text(k ? k.l + k.r + k.u + k.d + ' / ' + k.a : '온라인 (자기 키보드)', x + 34, y, '#c0cbdc', { size: 'xs', maxW: 92 });
        g.text(sd.ready[p.pid] ? '✔' : '', x + 126, y, PAL.green, { size: 's', align: 'right' });
      });
      // entrants
      g.panel(290, 64, 182, 186, { title: eng.type === 'duel' ? '대진표' : '출전 선수' });
      if (sd.br) drawBracket(g, sd, 296, 76, 172, 168, true);
      else sd.ents.slice(0, 12).forEach((e, i) => {
        const y = 76 + i * 14;
        g.text(String(i + 1), 298, y + 1, '#5a6988', { size: 'xs' });
        g.flag(e.country, 310, y + 1, 12, 8);
        g.text(e.name, 326, y, e.human ? OG.PCOLORS[e.pid] : '#c0cbdc', { size: 's', maxW: 100 });
        if (e.human) g.text(e.tag, 466, y, OG.PCOLORS[e.pid], { size: 's', align: 'right' });
        else g.text('★'.repeat(Math.max(1, Math.round(e.skill * 5))), 466, y + 1, '#5a6988', { size: 'xs', align: 'right' });
      });
      const all = S.players.every(p => sd.ready[p.pid]);
      if (all) g.banner('READY!', 112, PAL.green, { size: 'xl' });
      UI.footer(g, all ? '곧 시작합니다…' : '모두 자기 {A} 키를 누르면 시작!   ESC 일정으로');
    }
  };

  function drawBracket(g, sd, x, y, w, h, compact) {
    const br = sd.br, ents = sd.ents;
    const rounds = Math.log2(br.size);
    const colW = Math.floor(w / (rounds + 1));
    const boxW = Math.min(colW - 8, 60);
    // who occupies slot k of column r (r = 0 first round entrants, r = rounds champion)
    const occ = (r, k) => {
      if (r === 0) { const mt = br.rounds[0][k >> 1]; return mt ? (k % 2 ? mt.b : mt.a) : -1; }
      const mt = br.rounds[r - 1] && br.rounds[r - 1][k];
      return mt && mt.w >= 0 ? mt.w : -1;
    };
    const slotY = (r, k) => y + (k + 0.5) * (h / (br.size >> r));
    for (let r = 0; r <= rounds; r++) {
      const n = br.size >> r;
      const xx = x + r * colW;
      for (let k = 0; k < n; k++) {
        const yy = Math.round(slotY(r, k));
        const idx = occ(r, k);
        // connector to next round
        if (r < rounds) {
          const ny = Math.round(slotY(r + 1, k >> 1));
          const nx = x + (r + 1) * colW;
          const won = occ(r + 1, k >> 1) === idx && idx >= 0;
          const lc = won ? PAL.gold : '#3a4466';
          g.rect(xx + boxW, yy, (nx - xx - boxW) / 2, 1, lc);
          g.rect(xx + boxW + Math.floor((nx - xx - boxW) / 2), Math.min(yy, ny), 1, Math.abs(ny - yy) + 1, lc);
          if (won) g.rect(xx + boxW + Math.floor((nx - xx - boxW) / 2), ny, Math.ceil((nx - xx - boxW) / 2), 1, lc);
        }
        const champ = r === rounds;
        g.rect(xx, yy - 6, boxW, 12, champ && idx >= 0 ? '#5a4a1a' : '#262b44');
        if (idx < 0) { g.text('?', xx + boxW / 2, yy - 5, '#5a6988', { size: 'xs', align: 'center' }); continue; }
        const e = ents[idx];
        // eliminated in this round?
        const nextIdx = r < rounds ? occ(r + 1, k >> 1) : idx;
        const lost = r < rounds && nextIdx >= 0 && nextIdx !== idx;
        g.alpha(lost ? 0.45 : 1);
        g.flag(e.country, xx + 2, yy - 4, 12, 8);
        g.text(e.human ? e.tag : e.country, xx + 16, yy - 5, e.human ? OG.PCOLORS[e.pid] : '#ffffff', { size: 'xs' });
        g.alpha(1);
        if (champ) g.text('🏆', xx + boxW - 12, yy - 6, '#fff', { size: 's' });
        // score of the match this entrant won
        if (!compact && r > 0) {
          const mt = br.rounds[r - 1][k];
          if (mt && mt.text) g.text(mt.text, xx + boxW / 2, yy + 7, '#8b9bb4', { size: 'xs', align: 'center', maxW: colW - 4 });
        }
      }
    }
  }
  OG.drawBracket = drawBracket;

  function startEvent(App) {
    const S = App.S, sd = S.sd;
    const ev = OG.EVENT_MAP[sd.evId];
    const eng = OG.engines[ev.engine];
    if (eng.type === 'duel') App.go('bracket', { evId: sd.evId, ents: sd.ents, br: sd.br });
    else App.go('play', { evId: sd.evId, ents: sd.ents });
  }

  /* =============================== PLAY ================================ */
  SC.play = {
    enter(App, args) {
      const S = App.S;
      const ev = OG.EVENT_MAP[args.evId];
      const eng = OG.engines[ev.engine];
      let ents = args.ents, map = null;
      if (args.match) {
        const mt = args.br.rounds[args.match.r][args.match.m];
        map = [mt.a, mt.b];
        ents = map.map((i, k) => Object.assign({}, args.ents[i], { idx: k }));
      }
      const holder = { seed: (OG.rng(S).f() * 2 ** 31) | 0 };
      const R0 = OG.rng(holder);
      const state = eng.init(ev, ents, { difficulty: S.settings.difficulty }, R0);
      state.seed = holder.seed;
      S.sd = { evId: ev.id, ents: args.ents, br: args.br || null, match: args.match || null, map, state, paused: false, psel: 0, t: 0 };
      App.sfx('start');
    },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd;
      const ev = OG.EVENT_MAP[sd.evId];
      const eng = OG.engines[ev.engine];
      if (ctx.menu.esc) { sd.paused = !sd.paused; sd.psel = 0; App.sfx('beep'); }
      if (sd.paused) {
        const m = ctx.menu;
        if (m.up || m.dp) { sd.psel = M.wrap(sd.psel + (m.up ? -1 : 1), 3); App.sfx('select'); }
        if (m.ap) {
          App.sfx('confirm');
          if (sd.psel === 0) sd.paused = false;
          else if (sd.psel === 1) { App.go('play', { evId: sd.evId, ents: sd.ents, br: sd.br, match: sd.match }); }
          else App.go('menu');
        }
        return;
      }
      sd.t += dt;
      const st = sd.state;
      // map inputs by pid (engine uses ent.pid)
      try { eng.update(st, ctx.inputs, dt, OG.rng(st)); }
      catch (e) { console.error(e); st.done = true; if (!st.results) st.results = fallbackResults(eng, sd); }
      if (st.sfx && st.sfx.length) { st.sfx.forEach(n => App.sfx(n)); st.sfx = []; }
      if (st.done) {
        if (!Array.isArray(st.results) || !st.results.length) st.results = fallbackResults(eng, sd);
        if (sd.match) finishMatch(App, ev, eng, sd);
        else finishSolo(App, ev, sd);
      }
    },
    draw(g, S) {
      const sd = S.sd;
      const ev = OG.EVENT_MAP[sd.evId];
      const eng = ev && OG.engines[ev.engine];
      if (!eng || !sd.state) return;
      eng.draw(g, sd.state);
      if (sd.paused) {
        g.alpha(0.7); g.rect(0, 0, 480, 270, '#0d0b16'); g.alpha(1);
        g.panel(160, 80, 160, 100, { title: '일시정지' });
        ['계속하기', '처음부터 다시', '메인 메뉴로'].forEach((t, i) => {
          const on = i === sd.psel;
          g.text((on ? '▶ ' : '  ') + t, 180, 98 + i * 22, on ? PAL.yellow : '#c0cbdc', { size: 'm' });
        });
      }
    }
  };
  function fallbackResults(eng, sd) {
    const ents = sd.match ? sd.map.map((i, k) => ({ idx: k })) : sd.ents;
    return ents.map((e, i) => ({ idx: i, score: 0, text: '-', dnf: false }));
  }

  function finishSolo(App, ev, sd) {
    const res = sd.state.results;
    const rows = [];
    let rank = 0, prev = null;
    res.forEach((r, i) => {
      const e = sd.ents[r.idx];
      if (!e) return;
      if (!(prev && !r.dnf && !prev.dnf && prev.score === r.score)) rank = i + 1;
      rows.push({ idx: r.idx, rank: r.dnf ? 99 : rank, text: r.text, dnf: !!r.dnf, score: r.score, country: e.country, human: e.human, tag: e.tag, pid: e.pid, look: e.look });
      prev = r;
    });
    // events with 3+ tied/sorted rows: rank only for medals
    endEvent(App, ev, rows);
  }

  function endEvent(App, ev, rows) {
    const S = App.S;
    App.awardMedals(rows);
    // records for humans
    let newRec = null;
    rows.filter(r => r.human && !r.dnf).forEach(r => {
      if (OG.engines[ev.engine].type === 'duel') return;
      if (App.submitRecord(ev, r, r)) newRec = r;
    });
    const humansRows = rows.filter(r => r.human);
    const best = humansRows.slice().sort((a, b) => a.rank - b.rank)[0] || null;
    if (S.tour) S.tour.log[ev.id] = { best: best ? { rank: best.rank, tag: best.tag } : null };
    App.go('results', { evId: ev.id, rows, newRec: newRec ? newRec.pid : -1 });
  }

  /* ============================== BRACKET ============================== */
  SC.bracket = {
    enter(App, args) {
      App.S.sd = { evId: args.evId, ents: args.ents, br: args.br, t: 0, wait: 0, next: null, last: args.last || null };
      SC.bracket.findNext(App.S.sd);
    },
    findNext(sd) {
      const br = sd.br;
      const r = br.rounds.length - 1;
      const rd = br.rounds[r];
      const k = rd.findIndex(mt => mt.w < 0);
      if (k >= 0) { sd.next = { r, m: k }; return; }
      // round done → next round or finished
      if (rd.length === 1) { sd.next = null; sd.finished = true; return; }
      const nr = [];
      for (let i = 0; i < rd.length; i += 2) nr.push({ a: rd[i].w, b: rd[i + 1].w, w: -1, text: '' });
      br.rounds.push(nr);
      sd.next = { r: r + 1, m: 0 };
    },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd;
      sd.t += dt;
      const ev = OG.EVENT_MAP[sd.evId];
      const eng = OG.engines[ev.engine];
      if (ctx.menu.esc && sd.t > 0.3) { App.sfx('back'); App.go('menu'); return; }
      if (sd.finished) {
        if (sd.t > 1.2 && (ctx.menu.ap || sd.t > 4)) bracketResults(App, ev, sd);
        return;
      }
      const mt = sd.br.rounds[sd.next.r][sd.next.m];
      const A = sd.ents[mt.a], B = sd.ents[mt.b];
      const humanMatch = (A && A.human) || (B && B.human);
      if (!A || !B) { mt.w = A ? mt.a : mt.b; mt.text = '부전승'; SC.bracket.findNext(sd); return; }
      if (!humanMatch) {
        sd.wait += dt;
        if (sd.wait > 0.45) {
          sd.wait = 0;
          const R = OG.rng(S);
          let res = eng.cpuMatch ? eng.cpuMatch(ev, A, B, R) : null;
          if (!res) res = { winner: OG.cpuDuel(A, B, R), text: '승' };
          mt.w = res.winner === 0 ? mt.a : mt.b; mt.text = res.text || '';
          App.sfx('tick');
          SC.bracket.findNext(sd);
        }
        return;
      }
      if (sd.t > 0.4 && S.players.some(p => { const i = ctx.inputs[p.pid]; return i && i.ap; })) {
        App.sfx('confirm');
        App.go('play', { evId: sd.evId, ents: sd.ents, br: sd.br, match: sd.next });
      }
    },
    draw(g, S) {
      const sd = S.sd;
      const ev = OG.EVENT_MAP[sd.evId];
      UI.bg(g, g.t, '#2a1a2e', '#0d0b16');
      UI.header(g, ev.icon + ' ' + ev.name + ' 토너먼트', PAL.orange, roundName(sd.br, sd.next ? sd.next.r : sd.br.rounds.length - 1));
      g.panel(10, 30, 300, 220, { title: '대진표' });
      drawBracket(g, sd, 20, 44, 280, 200, false);
      g.panel(318, 30, 154, 220, { title: '경기' });
      if (sd.last) {
        g.text('직전 경기', 395, 44, '#8b9bb4', { size: 'xs', align: 'center' });
        g.text(sd.last, 395, 56, '#fff', { size: 's', align: 'center', maxW: 146 });
      }
      if (sd.finished) {
        const fin = sd.br.rounds[sd.br.rounds.length - 1][0];
        const W = sd.ents[fin.w];
        g.text('우승', 395, 90, PAL.gold, { size: 'l', align: 'center' });
        if (W) { g.flag(W.country, 371, 112, 48, 32, { wave: g.t }); g.text(W.name, 395, 150, W.human ? OG.PCOLORS[W.pid] : '#fff', { size: 'm', align: 'center', maxW: 146 }); }
        UI.footer(g, '{A} 결과 보기');
        return;
      }
      const mt = sd.br.rounds[sd.next.r][sd.next.m];
      const A = sd.ents[mt.a], B = sd.ents[mt.b];
      g.text(roundName(sd.br, sd.next.r), 395, 80, PAL.yellow, { size: 'm', align: 'center' });
      [A, B].forEach((e, i) => {
        if (!e) return;
        const y = 104 + i * 62;
        g.flag(e.country, 335, y, 36, 24);
        g.text(e.name, 377, y + 2, e.human ? OG.PCOLORS[e.pid] : '#fff', { size: 's', maxW: 90 });
        g.text(e.human ? e.tag : 'CPU ' + '★'.repeat(Math.max(1, Math.round(e.skill * 5))), 377, y + 15, e.human ? OG.PCOLORS[e.pid] : '#8b9bb4', { size: 'xs' });
      });
      g.text('VS', 395, 140, PAL.red, { size: 'l', align: 'center', outline: '#181425' });
      const humanMatch = (A && A.human) || (B && B.human);
      UI.footer(g, humanMatch ? '{A} 경기 시작!' : 'CPU 경기 진행 중…');
    }
  };
  function roundName(br, r) {
    const left = br.size >> r;
    return left === 2 ? '결승' : left === 4 ? '준결승' : left === 8 ? '8강' : (left + '강');
  }
  function finishMatch(App, ev, eng, sd) {
    const res = sd.state.results;
    const winLocal = res[0].idx;
    const mt = sd.br.rounds[sd.match.r][sd.match.m];
    mt.w = sd.map[winLocal];
    mt.text = res[0].text || '';
    const W = sd.ents[mt.w];
    const L = sd.ents[sd.map[1 - winLocal]];
    const last = (W.human ? W.tag + ' ' : '') + W.name + ' 승 ' + (res[0].text || '') + ' (vs ' + (L ? L.name : '') + ')';
    App.sfx(W.human ? 'cheer' : 'fail');
    App.go('bracket', { evId: sd.evId, ents: sd.ents, br: sd.br, last });
  }
  function bracketResults(App, ev, sd) {
    const br = sd.br;
    const R = br.rounds;
    const fin = R[R.length - 1][0];
    const rows = [];
    const push = (idx, rank, text) => {
      const e = sd.ents[idx];
      if (!e || rows.some(r => r.idx === idx)) return;
      rows.push({ idx, rank, text, dnf: false, score: 0, country: e.country, human: e.human, tag: e.tag, pid: e.pid, look: e.look });
    };
    push(fin.w, 1, '금메달 ' + (fin.text || ''));
    push(fin.w === fin.a ? fin.b : fin.a, 2, '결승 ' + (fin.text ? '패' : ''));
    if (R.length >= 2) R[R.length - 2].forEach(mt => push(mt.w === mt.a ? mt.b : mt.a, 3, '준결승 패'));
    if (R.length >= 3) R[R.length - 3].forEach(mt => push(mt.w === mt.a ? mt.b : mt.a, 5, '8강 패'));
    sd.ents.forEach(e => push(e.idx, 9, '-'));
    endEvent(App, ev, rows);
  }

  /* ============================== RESULTS ============================== */
  SC.results = {
    enter(App, args) {
      App.S.sd = { evId: args.evId, rows: args.rows, newRec: args.newRec, t: 0 };
      const human = args.rows.find(r => r.human && r.rank <= 3);
      App.sfx(human ? 'medal' : 'cheer');
      if (args.newRec >= 0) setTimeout(() => App.sfx('record'), 600);
    },
    update(App, ctx, dt) {
      const sd = App.S.sd; sd.t += dt;
      if (sd.t > 0.8 && (ctx.menu.ap || ctx.menu.esc)) { App.sfx('confirm'); App.go('ceremony', { evId: sd.evId, rows: sd.rows }); }
    },
    draw(g, S, App) {
      const sd = S.sd;
      const ev = OG.EVENT_MAP[sd.evId];
      UI.bg(g, g.t, '#14223a', '#0d0b16');
      UI.header(g, ev.icon + ' ' + ev.name + ' 결과', PAL.gold, (OG.SPORTS[ev.sport] || {}).ko);
      const rows = sd.rows.slice(0, 10);
      rows.forEach((r, i) => {
        const y = 30 + i * 20;
        const vis = Math.min(1, Math.max(0, (sd.t - i * 0.08) * 4));
        if (vis <= 0) return;
        const x = 20 + (1 - vis) * 60;
        g.alpha(vis);
        g.rect(x, y, 440, 18, r.human ? '#3a2f5a' : i % 2 ? '#1c1f36' : '#22263f');
        if (r.human) g.rect(x, y, 3, 18, OG.PCOLORS[r.pid]);
        if (r.rank <= 3) g.medal(x + 14, y + 11, r.rank, 5);
        else g.text(r.dnf ? '-' : String(r.rank), x + 14, y + 4, '#8b9bb4', { size: 's', align: 'center' });
        g.flag(r.country, x + 28, y + 3, 18, 12);
        g.text(OG.countryName(r.country), x + 52, y + 3, r.human ? '#fff' : '#c0cbdc', { size: 'm', maxW: 200 });
        if (r.human) g.text(r.tag, x + 262, y + 4, OG.PCOLORS[r.pid], { size: 's' });
        g.text(r.text, x + 432, y + 3, r.rank === 1 ? PAL.gold : '#fff', { size: 'm', align: 'right', maxW: 150 });
        g.alpha(1);
      });
      if (sd.newRec >= 0 && Math.floor(g.t * 3) % 2) g.text('🎉 개인 신기록! (P' + (sd.newRec + 1) + ')', 240, 234, PAL.yellow, { size: 'm', align: 'center', outline: '#181425' });
      UI.footer(g, '{A} 시상식으로');
    }
  };

  /* ============================== CEREMONY ============================= */
  SC.ceremony = {
    enter(App, args) {
      const rows = args.rows.filter(r => r.rank <= 3);
      const pod = [rows.find(r => r.rank === 1), rows.find(r => r.rank === 2), rows.filter(r => r.rank === 3)[0], rows.filter(r => r.rank === 3)[1]].map(r => r || null);
      App.S.sd = { evId: args.evId, pod, t: 0 };
    },
    update(App, ctx, dt) {
      const sd = App.S.sd; sd.t += dt;
      if (sd.t > 1.5 && (ctx.menu.ap || ctx.menu.esc)) { App.sfx('confirm'); App.go('medals'); }
    },
    draw(g, S) {
      const sd = S.sd, t = sd.t;
      const ev = OG.EVENT_MAP[sd.evId];
      g.grad(0, 0, 480, 170, '#0b1030', '#26305a', 8);
      g.crowd(0, 60, 480, 70, g.t, { excite: 0.5, seed: 7, bg: '#1a1f3a' });
      g.rect(0, 130, 480, 140, '#2a3150');
      // spotlights
      g.alpha(0.08); g.poly([140, 0, 200, 0, 280, 200, 200, 200], '#fff'); g.poly([280, 0, 340, 0, 280, 200, 200, 200], '#fff'); g.alpha(1);
      // flag poles
      const flags = [sd.pod[1], sd.pod[0], sd.pod[2]];
      const px = [170, 240, 310];
      const rise = M.clamp(t / 4, 0, 1);
      flags.forEach((r, i) => {
        if (!r) return;
        const x = px[i];
        const hgt = i === 1 ? 1 : 0.85;
        g.rect(x, 20, 2, 110, '#c0cbdc');
        const fy = 118 - (118 - 26) * rise * hgt;
        g.flag(r.country, x + 2, fy, 36, 24, { wave: g.t + i });
      });
      // podium
      const base = 230;
      const blocks = [[180, 30, 2], [240, 44, 1], [300, 22, 3]];
      blocks.forEach(([x, h, k]) => {
        g.rect(x - 28, base - h, 56, h, k === 1 ? '#feae34' : k === 2 ? '#c0cbdc' : '#d08a4c');
        g.rect(x - 28, base - h, 56, 3, '#ffffff');
        g.text(String(k), x, base - h + 8, '#181425', { size: 'xl', align: 'center' });
      });
      g.rect(130, base, 220, 4, '#181425');
      const athletes = [[sd.pod[1], 180, 30], [sd.pod[0], 240, 44], [sd.pod[2], 300, 22]];
      athletes.forEach(([r, x, h], i) => {
        if (!r) return;
        const look = OG.lookOf({ country: r.country, look: r.look || 0 });
        const J = g.figure(x, base - h, i === 1 ? OG.Pose.celebrate(g.t) : OG.Pose.armsUp(), look, { scale: 2 });
        g.medal(J.neck[0], J.neck[1] + 8, i === 1 ? 1 : i === 0 ? 2 : 3, 3);
        g.text(r.human ? r.tag : r.country, x, base - h - 66, r.human ? OG.PCOLORS[r.pid] : '#fff', { size: 's', align: 'center', outline: '#181425' });
      });
      if (sd.pod[3]) { // second bronze (combat sports)
        const r = sd.pod[3];
        g.figure(350, base, OG.Pose.armsUp(), OG.lookOf({ country: r.country, look: r.look || 0 }), { scale: 2 });
        g.flag(r.country, 340, base - 66, 18, 12);
      }
      g.confetti(g.t, 70);
      g.rect(0, 0, 480, 18, 'rgba(24,20,37,0.85)');
      g.text('🏅 시상식 — ' + ev.name, 240, 3, PAL.gold, { size: 'm', align: 'center' });
      const g1 = sd.pod[0];
      if (g1) g.text('금메달 ' + OG.countryName(g1.country) + (g1.human ? ' (' + g1.tag + ')' : ''), 240, 240, '#fff', { size: 'l', align: 'center', outline: '#181425' });
      if (t > 1.5) UI.footer(g, '{A} 메달 순위');
    }
  };

  /* =============================== MEDALS ============================== */
  SC.medals = {
    enter(App) { App.S.sd = { t: 0 }; },
    update(App, ctx, dt) {
      const S = App.S, sd = S.sd; sd.t += dt;
      if (sd.t > 0.6 && (ctx.menu.ap || ctx.menu.esc)) {
        App.sfx('confirm');
        if (!S.tour) { App.go('menu'); return; }
        S.tour.idx++;
        if (S.tour.practice) { App.go('pick', { practice: true }); return; }
        if (S.tour.idx >= S.tour.events.length) App.go('final'); else App.go('schedule');
      }
    },
    draw(g, S, App) {
      UI.bg(g, g.t, '#1a1838', '#0d0b16');
      const tour = S.tour;
      UI.header(g, '메달 순위', PAL.gold, tour ? (Math.min(tour.idx + 1, tour.events.length) + ' / ' + tour.events.length + ' 종목 완료') : '');
      drawMedalTable(g, S, App, 12);
      UI.footer(g, '{A} 계속');
    }
  };
  function drawMedalTable(g, S, App, n) {
    const order = App.medalOrder(S.medals);
    const humanC = S.players.map(p => p.country);
    // ensure human countries appear
    let list = order.slice(0, n);
    humanC.forEach(c => { if (list.indexOf(c) < 0 && order.indexOf(c) >= 0) list.push(c); });
    g.text('순위', 30, 28, '#8b9bb4', { size: 'xs' });
    g.text('국가', 70, 28, '#8b9bb4', { size: 'xs' });
    [0, 1, 2].forEach(k => g.medal(330 + k * 40, 33, k + 1, 4));
    g.text('합계', 450, 28, '#8b9bb4', { size: 'xs', align: 'right' });
    list.slice(0, 14).forEach((c, i) => {
      const y = 40 + i * 15;
      const m = S.medals[c];
      const rank = order.indexOf(c) + 1;
      const hum = humanC.indexOf(c) >= 0;
      g.rect(20, y, 440, 14, hum ? '#3a2f5a' : i % 2 ? '#1c1f36' : '#22263f');
      if (hum) { const p = S.players.find(pp => pp.country === c); g.rect(20, y, 3, 14, OG.PCOLORS[p.pid]); }
      g.text(String(rank), 34, y + 2, rank <= 3 ? PAL.gold : '#c0cbdc', { size: 's', align: 'center' });
      g.flag(c, 52, y + 2, 15, 10);
      g.text(OG.countryName(c), 72, y + 2, hum ? '#fff' : '#c0cbdc', { size: 's', maxW: 200 });
      [0, 1, 2].forEach(k => g.text(String(m[k]), 330 + k * 40, y + 2, '#fff', { size: 's', align: 'center' }));
      g.text(String(m[0] + m[1] + m[2]), 450, y + 2, PAL.yellow, { size: 's', align: 'right' });
    });
    if (!order.length) g.text('아직 메달이 없습니다', 240, 120, '#8b9bb4', { align: 'center' });
  }
  OG.drawMedalTable = drawMedalTable;

  /* =============================== FINAL =============================== */
  SC.final = {
    enter(App) { App.S.sd = { t: 0 }; App.sfx('cheer'); },
    update(App, ctx, dt) {
      const sd = App.S.sd; sd.t += dt;
      if (sd.t > 2 && (ctx.menu.ap || ctx.menu.esc)) { App.sfx('confirm'); App.go('menu'); }
    },
    draw(g, S, App) {
      const t = g.t;
      g.grad(0, 0, 480, 270, '#07081a', '#2a1f4a', 10);
      // fireworks
      for (let k = 0; k < 6; k++) {
        const cyc = Math.floor(t * 0.6 + k * 0.17);
        const ph = (t * 0.6 + k * 0.17) % 1;
        const fx = 40 + OG.hash(k, cyc, 1) * 400, fy = 30 + OG.hash(k, cyc, 2) * 80;
        const col = ['#ff0044', '#2ce8f5', '#fee761', '#63c74d', '#b55088', '#feae34'][k];
        if (ph < 0.7) for (let a = 0; a < 16; a++) { const r = ph * 46; g.rect(fx + Math.cos(a / 16 * M.TAU) * r, fy + Math.sin(a / 16 * M.TAU) * r + ph * ph * 14, 2, 2, col); }
      }
      const order = App.medalOrder(S.medals);
      g.text('폐회식', 240, 12, '#ffffff', { size: 'xl', align: 'center', outline: '#181425' });
      const top = order[0];
      if (top) {
        g.text('종합 1위', 240, 44, PAL.gold, { size: 'm', align: 'center' });
        g.flag(top, 216, 60, 48, 32, { wave: t });
        g.text(OG.countryName(top), 240, 96, '#fff', { size: 'l', align: 'center', outline: '#181425' });
      }
      g.panel(40, 120, 400, 124, { title: '우리 선수단 성적' });
      S.players.forEach((p, i) => {
        const y = 134 + i * 13;
        const m = S.medals[p.country] || [0, 0, 0];
        const rank = order.indexOf(p.country) + 1;
        g.text('P' + (p.pid + 1), 56, y, OG.PCOLORS[p.pid], { size: 's' });
        g.flag(p.country, 78, y + 1, 12, 8);
        g.text(OG.countryName(p.country), 96, y, '#fff', { size: 's', maxW: 140 });
        g.text('금 ' + m[0] + '  은 ' + m[1] + '  동 ' + m[2], 330, y, PAL.yellow, { size: 's', align: 'right' });
        g.text(rank ? '종합 ' + rank + '위' : '메달 없음', 428, y, '#c0cbdc', { size: 's', align: 'right' });
      });
      g.confetti(t, 40);
      if (S.sd.t > 2) UI.footer(g, '{A} 메인 메뉴로');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
