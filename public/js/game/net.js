/* =========================================================================
 * Online multiplayer (WebSocket relay, see server.js)
 * Host runs the whole game and streams App.S as diff patches (~30 Hz);
 * clients send their button states and only render the received state.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const Net = OG.Net = {
    ws: null, view: null, room: null, cid: null, ping: 0, status: '',
    last: {}, lastPaths: null, snapAcc: 0, fullAcc: 0, needFull: true,
    cnt: {}, rcnt: {}, held: {}, sendAcc: 0, lastSent: '', lastScene: null
  };
  const SNAP_HZ = 30;

  function wsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
  Net.available = function () { return typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && typeof WebSocket !== 'undefined'; };

  /* ------------------------------ dialog ------------------------------ */
  Net.openDialog = function () {
    const ov = document.getElementById('overlay');
    const App = OG.App;
    if (!Net.available()) {
      ov.innerHTML = '<div class="box"><h2>온라인 멀티</h2>' +
        '<p>온라인 플레이는 게임 서버로 접속해야 합니다.</p>' +
        '<p style="color:#fee761">터미널에서 <b>npm start</b> 실행 후<br>브라우저로 <b>http://localhost:3000</b> 접속</p>' +
        '<p class="hint">같은 Wi-Fi의 친구는 서버 컴퓨터의 IP 주소(예: http://192.168.0.10:3000)로 접속하면 됩니다.</p>' +
        '<div class="row"><button id="nclose">닫기</button></div></div>';
      ov.classList.add('show');
      document.getElementById('nclose').onclick = () => ov.classList.remove('show');
      return;
    }
    ov.innerHTML = '<div class="box"><h2>온라인 멀티</h2>' +
      '<div class="row"><button id="nhost">방 만들기 (호스트)</button></div>' +
      '<label>방 코드로 참가</label><input id="ncode" maxlength="4" placeholder="예: ABCD" autocomplete="off">' +
      '<div class="row"><button id="njoin" class="alt">참가하기</button><button id="nclose" class="alt">취소</button></div>' +
      '<div class="msg" id="nmsg"></div>' +
      '<p class="hint">호스트가 대회를 진행하고, 참가자는 자기 키보드(아무 키 세트나)로 자기 선수를 조작합니다. 최대 8명.</p></div>';
    ov.classList.add('show');
    const msg = t => { document.getElementById('nmsg').textContent = t; };
    document.getElementById('nclose').onclick = () => { ov.classList.remove('show'); };
    document.getElementById('nhost').onclick = () => {
      msg('서버에 연결 중…');
      Net.connect(() => Net.send({ t: 'host' }), err => msg(err));
    };
    const join = () => {
      const code = document.getElementById('ncode').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) { msg('4자리 방 코드를 입력하세요'); return; }
      msg('참가 중…');
      Net.connect(() => Net.send({ t: 'join', room: code }), err => msg(err));
    };
    document.getElementById('njoin').onclick = join;
    document.getElementById('ncode').addEventListener('keydown', e => { if (e.key === 'Enter') join(); e.stopPropagation(); });
    setTimeout(() => document.getElementById('ncode').focus(), 50);
  };
  Net.closeDialog = function () { const ov = document.getElementById('overlay'); if (ov) ov.classList.remove('show'); };

  /* ---------------------------- connection ---------------------------- */
  Net.connect = function (onOpen, onErr) {
    if (Net.ws) { try { Net.ws.close(); } catch (e) { /* */ } }
    let ws;
    try { ws = new WebSocket(wsUrl()); } catch (e) { onErr && onErr('연결 실패: ' + e.message); return; }
    Net.ws = ws;
    ws.onopen = () => { Net.status = 'online'; onOpen && onOpen(); };
    ws.onerror = () => { onErr && onErr('서버에 연결할 수 없습니다 (npm start 확인)'); };
    ws.onclose = () => {
      if (Net.ws !== ws) return;
      Net.ws = null;
      const App = OG.App;
      if (App.mode !== 'local') {
        const wasClient = App.mode === 'client';
        App.mode = 'local'; Net.view = null; App.S.room = null;
        App.S.players = App.S.players.filter(p => p.src.type === 'local');
        if (wasClient) App.go('menu');
        Net.toast('연결이 끊어졌습니다');
      }
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } Net.onMsg(m); };
  };
  Net.send = function (o) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(o)); };
  Net.leave = function () {
    const App = OG.App;
    if (Net.ws) { const w = Net.ws; Net.ws = null; try { w.close(); } catch (e) { /* */ } }
    App.mode = 'local'; Net.view = null; App.S.room = null;
    App.S.players = App.S.players.filter(p => p.src.type === 'local');
    App.remote = {};
  };
  Net.toast = function (txt) { Net.toastTxt = txt; Net.toastT = 3; };

  Net.onMsg = function (m) {
    const App = OG.App;
    switch (m.t) {
      case 'hosted':
        Net.closeDialog();
        App.mode = 'host'; Net.room = m.room; Net.addrs = m.addrs || [];
        App.S.room = m.room; Net.needFull = true; Net.last = {}; Net.lastPaths = null;
        App.go('lobby', {});
        Net.toast('방 ' + m.room + ' 생성! 친구에게 코드를 알려주세요');
        break;
      case 'joined':
        Net.closeDialog();
        App.mode = 'client'; Net.room = m.room; Net.cid = m.cid; Net.view = null;
        OG.Audio.stopMusic();
        break;
      case 'error':
        { const el = document.getElementById('nmsg'); if (el) el.textContent = m.msg; else Net.toast(m.msg); }
        break;
      case 'peer-join':
        if (App.mode === 'host') {
          App.remote[m.cid] = new OG.RemoteInput();
          const p = OG.addPlayer(App, { type: 'remote', cid: m.cid });
          Net.needFull = true;
          App.sfx('coin');
          Net.toast(p ? 'P' + (p.pid + 1) + ' 접속!' : '관전자 접속 (자리 없음)');
        }
        break;
      case 'peer-leave':
        if (App.mode === 'host') {
          OG.removePlayerByCid(App, m.cid);
          delete App.remote[m.cid];
          Net.toast('참가자 한 명이 나갔습니다');
        }
        break;
      case 'in':
        if (App.mode === 'host' && App.remote[m.cid]) App.remote[m.cid].update(m.d);
        break;
      case 'snap':
        if (App.mode === 'client') Net.applySnap(m);
        break;
      case 'host-left':
        Net.toast('호스트가 방을 닫았습니다');
        Net.leave(); App.go('menu');
        break;
      case 'pong':
        Net.ping = Math.round(performance.now() - m.ts);
        break;
    }
  };

  /* ----------------------------- host side ---------------------------- */
  const EXPAND = { '': 1, 'sd': 1, 'sd.state': 1 };
  function collect(obj, prefix, out) {
    for (const k in obj) {
      const path = prefix ? prefix + '.' + k : k;
      const v = obj[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && EXPAND[path]) collect(v, path, out);
      else out[path] = v;
    }
  }
  Net.hostStep = function (dt) {
    const App = OG.App;
    Net.snapAcc += dt; Net.fullAcc += dt;
    if (Net.toastT > 0) Net.toastT -= dt;
    if (Net.snapAcc < 1 / SNAP_HZ) return;
    Net.snapAcc = 0;
    const S = App.S;
    if (S.scene !== Net.lastScene) { Net.needFull = true; Net.lastScene = S.scene; }
    if (Net.fullAcc > 4) Net.needFull = true;
    const cur = {};
    collect(S, '', cur);
    const set = {}, del = [];
    const full = Net.needFull;
    for (const p in cur) {
      const js = JSON.stringify(cur[p]);
      if (full || Net.last[p] !== js) { set[p] = cur[p]; Net.last[p] = js; }
    }
    if (!full && Net.lastPaths) for (const p in Net.lastPaths) if (!(p in cur)) { del.push(p); delete Net.last[p]; }
    Net.lastPaths = cur;
    if (full) { Net.needFull = false; Net.fullAcc = 0; }
    const fx = App.fx.splice(0, App.fx.length);
    if (!full && !Object.keys(set).length && !del.length && !fx.length) return;
    Net.send({ t: 'snap', full, set, del, fx });
  };

  /* ---------------------------- client side --------------------------- */
  function setPath(o, path, v) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (!cur[ks[i]] || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }
  function delPath(o, path) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { cur = cur[ks[i]]; if (!cur) return; }
    delete cur[ks[ks.length - 1]];
  }
  Net.applySnap = function (m) {
    const App = OG.App;
    if (m.full) { Net.view = {}; }
    if (!Net.view) return; // wait for a full snapshot
    for (const p in m.set) setPath(Net.view, p, m.set[p]);
    (m.del || []).forEach(p => delPath(Net.view, p));
    if (m.fx && App.S.settings.sound) m.fx.forEach(n => OG.Audio.play(n));
    const V = Net.view;
    const me = (V.players || []).find(p => p.src && p.src.type === 'remote' && p.src.cid === Net.cid);
    App.myPid = me ? me.pid : -1;
    if (V.scene !== Net.clientScene) { Net.clientScene = V.scene; App.onScene(V.scene); }
  };
  const BTN = OG.BTN;
  Net.clientStep = function (local, gl) {
    if (Net.toastT > 0) Net.toastT -= OG.DT;
    if (gl.esc) {
      Net.escArm = (Net.escArm || 0) + 1;
      if (Net.escArm >= 2) { Net.escArm = 0; Net.leave(); OG.App.go('menu'); return; }
      Net.toast('ESC를 한 번 더 누르면 방에서 나갑니다');
    }
    const o = OG.mergeInputs(local);
    BTN.forEach(b => {
      Net.cnt[b] = (Net.cnt[b] || 0) + (o[b + 'c'] || 0);
      if (o[b + 'r']) Net.rcnt[b] = (Net.rcnt[b] || 0) + 1;
      Net.held[b] = !!o[b];
    });
    const msg = JSON.stringify([Net.cnt, Net.rcnt, Net.held]);
    Net.sendAcc += OG.DT;
    if (msg !== Net.lastSent || Net.sendAcc > 0.25) {
      Net.lastSent = msg; Net.sendAcc = 0;
      Net.send({ t: 'in', d: { h: Net.held, c: Net.cnt, rc: Net.rcnt } });
    }
    Net.pingAcc = (Net.pingAcc || 0) + OG.DT;
    if (Net.pingAcc > 2) { Net.pingAcc = 0; Net.send({ t: 'ping', ts: performance.now() }); }
  };

  Net.drawStatus = function (g, S) {
    const App = OG.App;
    let txt = '';
    if (App.mode === 'host') txt = '🌐 방 ' + (Net.room || '') + ' · 호스트 · ' + (S.players || []).filter(p => p.src.type === 'remote').length + '명 접속';
    if (App.mode === 'client') txt = '🌐 방 ' + (Net.room || '') + ' · ' + (App.myPid >= 0 ? '나 = P' + (App.myPid + 1) : '관전') + ' · ' + Net.ping + 'ms';
    if (txt && S.scene !== 'play') g.text(txt, 476, 258, '#8b9bb4', { size: 'xs', align: 'right' });
    if (App.mode === 'client' && S.scene === 'play' && App.myPid >= 0) g.text('나 = P' + (App.myPid + 1), 476, 14, OG.PCOLORS[App.myPid], { size: 'xs', align: 'right', outline: '#181425' });
    if (App.mode === 'host' && S.scene === 'lobby' && Net.addrs && Net.addrs.length) {
      g.text('친구 접속 주소: ' + Net.addrs[0] + '  ·  방 코드 ' + Net.room, 240, 222, PAL_CYAN, { size: 'xs', align: 'center' });
    }
    if (Net.toastT > 0 && Net.toastTxt) {
      const w = g.textW(Net.toastTxt, 's') + 16;
      g.rect(240 - w / 2, 28, w, 16, 'rgba(24,20,37,0.9)'); g.rectO(240 - w / 2, 28, w, 16, '#feae34');
      g.text(Net.toastTxt, 240, 31, '#ffffff', { size: 's', align: 'center' });
    }
  };
  const PAL_CYAN = '#2ce8f5';
})(typeof window !== 'undefined' ? window : globalThis);
