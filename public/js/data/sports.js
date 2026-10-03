/* =========================================================================
 * Sports catalogue. Events (defined in engine files) reference these keys.
 * ========================================================================= */
(function (root) {
  'use strict';
  const OG = root.OG;
  const S = [
    // key, 한국어, icon
    ['athletics', '육상', '🏃'], ['swimming', '수영', '🏊'], ['diving', '다이빙', '💦'],
    ['artistic_swimming', '아티스틱 스위밍', '🩱'], ['water_polo', '수구', '🤽'],
    ['gymnastics', '기계체조', '🤸'], ['rhythmic', '리듬체조', '🎀'], ['trampoline', '트램폴린', '🤸'],
    ['cycling', '사이클', '🚴'], ['bmx', 'BMX', '🚲'], ['mtb', '산악자전거', '🚵'],
    ['rowing', '조정', '🚣'], ['canoe', '카누', '🛶'], ['sailing', '요트', '⛵'], ['surfing', '서핑', '🏄'],
    ['archery', '양궁', '🏹'], ['shooting', '사격', '🎯'],
    ['judo', '유도', '🥋'], ['wrestling', '레슬링', '🤼'], ['boxing', '복싱', '🥊'], ['taekwondo', '태권도', '🥋'],
    ['fencing', '펜싱', '🤺'], ['karate', '가라테', '🥋'],
    ['tennis', '테니스', '🎾'], ['table_tennis', '탁구', '🏓'], ['badminton', '배드민턴', '🏸'],
    ['volleyball', '배구', '🏐'], ['beach_volleyball', '비치발리볼', '🏐'],
    ['football', '축구', '⚽'], ['basketball', '농구', '🏀'], ['handball', '핸드볼', '🤾'], ['hockey', '하키', '🏑'],
    ['rugby', '럭비', '🏉'], ['baseball', '야구', '⚾'], ['softball', '소프트볼', '🥎'], ['cricket', '크리켓', '🏏'],
    ['golf', '골프', '⛳'], ['lacrosse', '라크로스', '🥍'], ['flag_football', '플래그 풋볼', '🏈'], ['squash', '스쿼시', '🎾'],
    ['weightlifting', '역도', '🏋️'], ['equestrian', '승마', '🏇'], ['modern_pentathlon', '근대5종', '🏅'],
    ['triathlon', '트라이애슬론', '🏊'], ['climbing', '스포츠클라이밍', '🧗'], ['skateboarding', '스케이트보드', '🛹'],
    ['breaking', '브레이킹', '🕺'],
    // winter
    ['speed_skating', '스피드스케이팅', '⛸️'], ['short_track', '쇼트트랙', '⛸️'], ['figure_skating', '피겨스케이팅', '⛸️'],
    ['alpine', '알파인 스키', '⛷️'], ['ski_jumping', '스키점프', '🎿'], ['cross_country', '크로스컨트리', '🎿'],
    ['biathlon', '바이애슬론', '🎯'], ['nordic_combined', '노르딕 복합', '🎿'], ['freestyle', '프리스타일 스키', '⛷️'], ['snowboard', '스노보드', '🏂'],
    ['bobsleigh', '봅슬레이', '🛷'], ['luge', '루지', '🛷'], ['skeleton', '스켈레톤', '🛷'],
    ['curling', '컬링', '🥌'], ['ice_hockey', '아이스하키', '🏒'], ['ski_mountaineering', '산악스키', '🏔️'],
    // Asian Games 2026 specials
    ['kabaddi', '카바디', '🤼'], ['sepak_takraw', '세팍타크로', '⚽'], ['wushu', '우슈', '🐉'], ['kurash', '쿠라시', '🤼'],
    ['jujitsu', '주짓수', '🥋'], ['mma', '종합격투기', '🥊'], ['soft_tennis', '소프트테니스', '🎾'], ['padel', '파델', '🎾'],
    ['teqball', '테크볼', '⚽'], ['esports', 'e스포츠', '🎮']
  ];
  OG.SPORTS = {};
  OG.SPORT_ORDER = [];
  S.forEach((r, i) => { OG.SPORTS[r[0]] = { key: r[0], ko: r[1], icon: r[2], order: i }; OG.SPORT_ORDER.push(r[0]); });

  // Game modes / tags
  OG.MODES = [
    { key: 'summer', ko: '하계 올림픽', en: 'SUMMER GAMES', color: '#feae34', icon: '☀️' },
    { key: 'winter', ko: '동계 올림픽', en: 'WINTER GAMES', color: '#2ce8f5', icon: '❄️' },
    { key: 'asian', ko: '아시안게임 2026', en: 'AICHI-NAGOYA 2026', color: '#ff0044', icon: '🌏' },
    { key: 'all', ko: '전 종목 통합', en: 'ALL EVENTS', color: '#63c74d', icon: '🏅' }
  ];
  OG.PCOLORS = ['#e43b44', '#0099db', '#63c74d', '#feae34', '#b55088', '#2ce8f5', '#f77622', '#ead4aa'];
})(typeof window !== 'undefined' ? window : globalThis);
