/* =========================================================================
 * Chiptune sound effects & tiny music sequencer (WebAudio, no assets)
 *   OG.Audio.play('jump')
 * Engines must NOT call this directly – use OG.sfx(state, name).
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const A = OG.Audio = { enabled: true, volume: 0.5, musicOn: true, ctx: null, master: null };

  A.init = function () {
    if (A.ctx || typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return;
    try {
      A.ctx = new (root.AudioContext || root.webkitAudioContext)();
      A.master = A.ctx.createGain();
      A.master.gain.value = A.volume;
      A.master.connect(A.ctx.destination);
      A.noiseBuf = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate);
      const d = A.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { A.ctx = null; }
  };
  A.resume = function () { if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume(); };
  A.setVolume = function (v) { A.volume = v; if (A.master) A.master.gain.value = v; };

  // tone(freq, dur, type, vol, slideTo, delay)
  function tone(f, dur, type, vol, slide, delay) {
    const c = A.ctx; if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(vol == null ? 0.15 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(A.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, filt, delay, type) {
    const c = A.ctx; if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = A.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = filt || 2000;
    const g = c.createGain();
    g.gain.setValueAtTime(vol == null ? 0.2 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(f); f.connect(g); g.connect(A.master);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12); // midi → Hz

  /* Available effect names (use with OG.sfx(state, name)):
   * select confirm back beep start go gun whistle buzzer step jump land
   * throw swing hit kick punch block splash stroke bounce net shot arrow
   * target miss fail good perfect cheer crowd coin medal record ding
   * click wind whoosh crash ice snow bell drum power charge tick */
  const SFX = {
    select: () => tone(880, 0.05, 'square', 0.08),
    confirm: () => { tone(660, 0.06, 'square', 0.1); tone(990, 0.09, 'square', 0.1, null, 0.06); },
    back: () => tone(440, 0.08, 'square', 0.08, 220),
    beep: () => tone(660, 0.12, 'square', 0.12),
    tick: () => tone(1200, 0.03, 'square', 0.05),
    start: () => tone(990, 0.3, 'square', 0.14),
    go: () => { tone(1320, 0.35, 'square', 0.14); tone(660, 0.35, 'triangle', 0.14); },
    gun: () => { noise(0.25, 0.4, 3000); tone(120, 0.15, 'square', 0.15, 40); },
    whistle: () => { tone(2300, 0.35, 'sine', 0.12); tone(2350, 0.35, 'sine', 0.06); },
    buzzer: () => tone(140, 0.5, 'sawtooth', 0.15),
    step: () => noise(0.03, 0.08, 1200),
    jump: () => tone(300, 0.15, 'square', 0.1, 700),
    land: () => noise(0.12, 0.25, 600),
    throw: () => { noise(0.2, 0.15, 3000, 0, 'bandpass'); tone(500, 0.15, 'triangle', 0.08, 200); },
    swing: () => noise(0.15, 0.18, 2500, 0, 'bandpass'),
    whoosh: () => noise(0.3, 0.15, 1800, 0, 'bandpass'),
    hit: () => { tone(200, 0.08, 'square', 0.15, 80); noise(0.06, 0.2, 2000); },
    kick: () => { tone(150, 0.1, 'square', 0.18, 60); noise(0.05, 0.15, 1500); },
    punch: () => { noise(0.08, 0.3, 900); tone(110, 0.08, 'square', 0.14, 50); },
    block: () => tone(300, 0.06, 'square', 0.1, 260),
    splash: () => noise(0.35, 0.25, 1200),
    stroke: () => noise(0.12, 0.1, 800),
    bounce: () => tone(420, 0.06, 'triangle', 0.15, 300),
    net: () => noise(0.1, 0.12, 700),
    shot: () => { noise(0.18, 0.35, 4000); tone(90, 0.1, 'square', 0.12, 40); },
    arrow: () => { noise(0.08, 0.1, 5000, 0, 'highpass'); tone(900, 0.1, 'triangle', 0.06, 600); },
    target: () => { tone(200, 0.05, 'square', 0.15); noise(0.05, 0.2, 1500); },
    miss: () => tone(300, 0.2, 'triangle', 0.1, 150),
    fail: () => { tone(330, 0.15, 'square', 0.12, 300); tone(262, 0.3, 'square', 0.12, 200, 0.15); },
    good: () => { tone(784, 0.08, 'square', 0.1); tone(1046, 0.12, 'square', 0.1, null, 0.08); },
    perfect: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.09, 'square', 0.1, null, i * 0.06)); },
    cheer: () => { noise(1.2, 0.18, 2500, 0, 'bandpass'); noise(0.9, 0.1, 1200, 0.2); },
    crowd: () => noise(0.8, 0.06, 1500, 0, 'bandpass'),
    coin: () => { tone(988, 0.06, 'square', 0.1); tone(1319, 0.2, 'square', 0.1, null, 0.06); },
    medal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'square', 0.11, null, i * 0.1)); },
    record: () => { [784, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.11, null, i * 0.09)); },
    ding: () => tone(1568, 0.25, 'triangle', 0.14),
    bell: () => { tone(1046, 0.6, 'triangle', 0.12); tone(1568, 0.6, 'sine', 0.06); },
    click: () => tone(1800, 0.02, 'square', 0.06),
    wind: () => noise(0.6, 0.06, 600, 0, 'bandpass'),
    crash: () => { noise(0.5, 0.35, 900); tone(80, 0.3, 'square', 0.12, 40); },
    ice: () => noise(0.12, 0.08, 6000, 0, 'highpass'),
    snow: () => noise(0.15, 0.08, 3500, 0, 'highpass'),
    drum: () => { tone(110, 0.12, 'sine', 0.3, 50); noise(0.04, 0.1, 800); },
    power: () => tone(200, 0.4, 'sawtooth', 0.08, 900),
    charge: () => tone(400, 0.05, 'square', 0.05, 500)
  };
  A.SFX = SFX;
  A.play = function (name) {
    if (!A.enabled || !A.ctx) return;
    const f = SFX[name];
    if (f) try { f(); } catch (e) { /* ignore */ }
  };

  /* ------------------------------ music --------------------------------
   * Very small square-wave sequencer for fanfares/loops.
   * A song is { bpm, notes: [[midi|0, beats], ...], bass?: [[midi, beats]...] }
   * --------------------------------------------------------------------- */
  const SONGS = {
    fanfare: { bpm: 132, notes: [[67, .5], [72, .5], [76, .5], [79, 1], [76, .5], [79, 2], [0, .5], [74, .5], [77, .5], [81, 1], [77, .5], [81, 2]], bass: [[48, 2], [52, 2], [50, 2], [53, 2]] },
    anthem: { bpm: 96, notes: [[67, 1], [72, 1.5], [71, .5], [72, 1], [76, 1], [74, 1.5], [72, .5], [74, 1], [77, 1], [76, 1], [74, 1], [72, 2]], bass: [[48, 2], [53, 2], [55, 2], [48, 2], [53, 2], [55, 2], [48, 2]] },
    title: { bpm: 140, notes: [[72, .5], [72, .5], [79, .5], [79, .5], [81, .5], [81, .5], [79, 1], [77, .5], [77, .5], [76, .5], [76, .5], [74, .5], [74, .5], [72, 1], [79, .5], [79, .5], [77, .5], [77, .5], [76, .5], [76, .5], [74, 1], [79, .5], [79, .5], [77, .5], [77, .5], [76, .5], [76, .5], [74, 1]], bass: [[48, 1], [55, 1], [53, 1], [48, 1], [53, 1], [48, 1], [55, 1], [48, 1]] },
    victory: { bpm: 150, notes: [[72, .33], [72, .33], [72, .33], [72, 1], [68, 1], [70, 1], [72, .66], [70, .33], [72, 2]], bass: [[48, 1], [44, 1], [46, 1], [48, 2]] }
  };
  A.SONGS = SONGS;
  let musicTimer = null;
  A.music = function (name, loop) {
    A.stopMusic();
    if (!A.ctx || !A.musicOn || !A.enabled) return;
    const s = SONGS[name]; if (!s) return;
    const beat = 60 / s.bpm;
    const playOnce = () => {
      let t = 0;
      s.notes.forEach(n => { if (n[0]) tone(N(n[0]), n[1] * beat * 0.9, 'square', 0.06, null, t); t += n[1] * beat; });
      let tb = 0;
      if (s.bass) while (tb < t - 0.01) s.bass.forEach(n => { if (tb < t - 0.01) { tone(N(n[0]), n[1] * beat * 0.8, 'triangle', 0.09, null, tb); tb += n[1] * beat; } });
      return t;
    };
    const len = playOnce();
    if (loop) musicTimer = setInterval(playOnce, len * 1000);
  };
  A.stopMusic = function () { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
