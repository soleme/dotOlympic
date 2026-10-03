/* Script manifest — loaded in order by index.html / dev pages (document.write keeps
 * it synchronous and file:// friendly). tools/smoke.js reads the same list. */
(function (root) {
  var SCRIPTS = [
    'core/util.js', 'core/gfx.js', 'core/audio.js', 'core/input.js', 'core/common.js',
    'data/countries.js', 'data/sports.js',
    'engines/race.js', 'engines/field.js', 'engines/meter.js', 'engines/target.js', 'engines/ball.js',
    'engines/routine.js', 'engines/air.js', 'engines/climb.js', 'engines/downhill.js', 'engines/net.js', 'engines/fight.js',
    'engines/kabaddi.js',
    'game/scenes.js', 'game/net.js', 'game/app.js'
  ];
  root.OG_SCRIPTS = SCRIPTS;
  if (typeof document !== 'undefined' && document.currentScript) {
    var base = document.currentScript.src.replace(/loader\.js.*$/, '');
    var skipGame = document.currentScript.getAttribute('data-nogame') != null;
    SCRIPTS.forEach(function (s) {
      if (skipGame && s.indexOf('game/') === 0) return;
      document.write('<script src="' + base + s + '"><\/script>');
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
