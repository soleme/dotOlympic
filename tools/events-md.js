#!/usr/bin/env node
/* Prints a Markdown list of all events grouped by mode (used for README). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', 'public', 'js');
const sb = { console }; sb.window = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'loader.js'), 'utf8'), sb);
sb.OG_SCRIPTS.filter(s => !s.startsWith('game/')).forEach(s => vm.runInContext(fs.readFileSync(path.join(ROOT, s), 'utf8'), sb, { filename: s }));
const OG = sb.OG;
const out = [];
OG.MODES.filter(m => m.key !== 'all').forEach(m => {
  const evs = OG.EVENTS.filter(e => e.tags.includes(m.key));
  out.push(`### ${m.icon} ${m.ko} (${evs.length}개 종목)`);
  const bySport = {};
  evs.forEach(e => { (bySport[e.sport] = bySport[e.sport] || []).push(e); });
  Object.keys(bySport).sort((a, b) => OG.SPORTS[a].order - OG.SPORTS[b].order).forEach(sp => {
    const S = OG.SPORTS[sp];
    out.push(`- ${S.icon} **${S.ko}**: ` + bySport[sp].map(e => e.name + (OG.engines[e.engine].type === 'duel' ? ' ⚔' : '')).join(', '));
  });
  out.push('');
});
out.push(`총 ${OG.EVENTS.length}개 종목 · ${new Set(OG.EVENTS.map(e => e.sport)).size}개 스포츠 · ⚔ = 1:1 토너먼트`);
console.log(out.join('\n'));
