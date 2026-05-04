/**
 * js/sentiment.js — SmartClass Sentiment Analysis Module
 * Handles: NLP keyword analysis · emotion tiles · sentiment chart
 * Depends on: app.js (window.state, window.el, window.setEl, window.toast, window.log)
 */
'use strict';

var SENT_POS = [
  'understand','understood','great','clear','excellent','good','helpful','easy',
  'interesting','amazing','love','awesome','perfect','makes sense','got it','thanks',
  'well explained','very clear','now i get','i get it','nice','brilliant','simple',
  'straightforward','follow along','keeping up'
];
var SENT_NEG = [
  'confused','confusing','lost','don\'t understand','don\'t get','hard','difficult',
  'boring','unclear','struggle','stuck','frustrated','frustrating','hate','terrible',
  'awful','too fast','too slow','not following','can\'t follow','don\'t follow',
  'going too fast','repeat','again'
];
var SENT_NEUTRAL = ['ok','okay','fine','maybe','perhaps','alright','so so','average','moderate','normal','regular'];

// ── Analyze ───────────────────────────────────────────────────────────────────
window.analyzeSentiment = function() {
  var input = window.el('sent-input');
  if (!input || !input.value.trim()) return;
  var txt = input.value.toLowerCase();
  var posScore = 0, negScore = 0, posFound = [], negFound = [];

  SENT_POS.forEach(function(w) { if (txt.includes(w)) { posScore++; posFound.push(w); } });
  SENT_NEG.forEach(function(w) { if (txt.includes(w)) { negScore++; negFound.push(w); } });

  var netScore  = posScore - negScore;
  var intensity = Math.min(100, Math.round(Math.max(posScore, negScore) * 20));
  var label, icon, color, badge, desc, posBar, negBar;

  if (netScore > 0) {
    label='Positive'; icon='😊'; color='var(--green)'; badge='b-green';
    posBar=Math.min(100,posScore*25); negBar=Math.min(30,negScore*10);
    desc='Student demonstrates understanding and positive engagement.';
  } else if (netScore < 0) {
    label='Negative'; icon='😟'; color='var(--red)'; badge='b-red';
    posBar=Math.min(30,posScore*10); negBar=Math.min(100,negScore*25);
    desc='Student may be struggling, confused, or disengaged.';
  } else if (posScore === 0 && negScore === 0) {
    var hasNeutral = SENT_NEUTRAL.some(function(w) { return txt.includes(w); });
    label='Neutral'; icon='😐'; color='var(--brand)'; badge='b-blue';
    posBar=40; negBar=40;
    desc = hasNeutral ? 'Student response shows neutral engagement.' : 'No strong sentiment signals detected.';
  } else {
    label='Mixed'; icon='🤔'; color='var(--purple)'; badge='b-purple';
    posBar=Math.min(60,posScore*20); negBar=Math.min(60,negScore*20);
    desc='Both positive and negative signals detected — student may need clarification.';
  }

  var kwHtml = '';
  if (posFound.length) kwHtml += posFound.slice(0,5).map(function(w) { return '<span class="sent-kw pos">+' + w + '</span>'; }).join('');
  if (negFound.length) kwHtml += negFound.slice(0,5).map(function(w) { return '<span class="sent-kw neg">−' + w + '</span>'; }).join('');

  var out = window.el('sent-result');
  if (out) {
    out.style.display = 'block';
    out.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:16px">'
      + '<div style="font-size:52px;line-height:1;flex-shrink:0">' + icon + '</div>'
      + '<div style="flex:1">'
      + '<div style="font-size:20px;font-weight:800;color:' + color + '">' + label + ' Sentiment</div>'
      + '<div style="font-size:13px;color:var(--text-2);margin-top:4px">' + desc + '</div>'
      + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">'
      + '<span class="badge ' + badge + '">' + label + '</span>'
      + '<span style="font-family:var(--mono);font-size:12px;color:var(--text-3)">Net: ' + (netScore > 0 ? '+' : '') + netScore + '</span>'
      + '<span style="font-family:var(--mono);font-size:12px;color:var(--text-3)">Intensity: ' + intensity + '%</span></div>'
      + '<div style="margin-top:12px">'
      + '<div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Sentiment Breakdown</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:12px;color:var(--green);width:55px;flex-shrink:0">Positive</span><div class="sent-meter-bar"><div class="sent-meter-fill" style="width:' + posBar + '%;background:var(--green)"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--text-3);width:30px">' + posScore + '</span></div>'
      + '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--red);width:55px;flex-shrink:0">Negative</span><div class="sent-meter-bar"><div class="sent-meter-fill" style="width:' + negBar + '%;background:var(--red)"></div></div><span style="font-family:var(--mono);font-size:11px;color:var(--text-3);width:30px">' + negScore + '</span></div>'
      + '</div>'
      + (kwHtml ? '<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">Detected Keywords</div><div class="sent-keywords">' + kwHtml + '</div></div>' : '')
      + '</div></div>'
      + '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border-2);font-size:13px;color:var(--text-2)"><strong>Input:</strong> &ldquo;' + input.value + '&rdquo;</div>';
    window.log('💬 Sentiment: ' + label + ' (' + netScore + ')', 'blue');
  }

  var entry = { ts: new Date().toISOString(), label: label, score: netScore, text: input.value.slice(0, 120) };
  window.state.sentLog.push(entry);
  if (typeof pushSentPoint === 'function') pushSentPoint(label);
  input.value = '';
};

// ── Emotion tiles (sentiment page) ───────────────────────────────────────────
window.renderEmotionTiles = function() {
  var grid = window.el('emotion-grid-live'); if (!grid) return;
  var students = window.state.students.filter(function(s) { return s.emotion; });
  var total    = students.length;
  var tally    = { Happy:0, Neutral:0, Confused:0, Bored:0, Stressed:0 };
  students.forEach(function(s) { if (tally[s.emotion] !== undefined) tally[s.emotion]++; });

  var defs = [
    { key:'Happy',   icon:'😊', color:'var(--green)'  },
    { key:'Neutral', icon:'😐', color:'var(--brand)'  },
    { key:'Confused',icon:'🤔', color:'var(--purple)' },
    { key:'Bored',   icon:'😴', color:'var(--orange)' },
    { key:'Stressed',icon:'😰', color:'var(--red)'    }
  ];
  var tiles = defs.map(function(d) {
    var pct = total > 0 ? Math.round(tally[d.key] / total * 100) : 0;
    return '<div class="em-tile">'
      + '<div class="em-icon">' + d.icon + '</div>'
      + '<div class="em-name">' + d.key + '</div>'
      + '<div class="em-pct" style="color:' + d.color + '">' + (total > 0 ? pct + '%' : '—') + '</div>'
      + '<div class="prog mt-4"><div class="prog-fill" style="width:' + pct + '%;background:' + d.color + '"></div></div>'
      + '</div>';
  });
  tiles.push('<div class="em-tile" style="background:var(--bg-2);border:1.5px dashed var(--border)"><div class="em-icon">👥</div><div class="em-name">Scanned</div><div class="em-pct" style="color:var(--text-2)">' + total + '</div><div style="font-size:11px;color:var(--text-3);margin-top:4px">of ' + window.state.students.length + '</div></div>');
  grid.innerHTML = tiles.join('');
  if (total === 0) grid.insertAdjacentHTML('beforeend', '<div style="grid-column:1/-1;text-align:center;font-size:13px;color:var(--text-3);padding:10px">Start face recognition to detect emotions.</div>');
};

// ── Emotion donut refresh (called from updateStats) ───────────────────────────
window.refreshEmotionDonut = function() {
  var ch = window.state.chartInst.emotDo; if (!ch) return;
  var keys  = ['Happy','Neutral','Confused','Bored','Stressed'];
  var tally = [0,0,0,0,0];
  window.state.students.forEach(function(s) { var i = keys.indexOf(s.emotion); if (i >= 0) tally[i]++; });
  if (tally.some(function(v) { return v > 0; })) { ch.data.datasets[0].data = tally; ch.update('none'); }
};

// ── Sentiment chart helpers (shared with charts.js) ───────────────────────────
window.pushSentPoint = function(label, timeLabel) {
  var ch  = window.state.chartInst.sentLive; if (!ch) return;
  var now = timeLabel || new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  var ds  = ch.data.datasets, n = ch.data.labels.length;
  var p0  = n > 0 ? ds[0].data[n-1] : 0;
  var p1  = n > 0 ? ds[1].data[n-1] : 0;
  var p2  = n > 0 ? ds[2].data[n-1] : 0;
  ch.data.labels.push(now);
  ds[0].data.push(p0 + (label === 'Positive' ? 1 : 0));
  ds[1].data.push(p1 + (label === 'Neutral' || label === 'Mixed' ? 1 : 0));
  ds[2].data.push(p2 + (label === 'Negative' ? 1 : 0));
  ch.update('none');
  var total = ds[0].data[ch.data.labels.length-1] + ds[1].data[ch.data.labels.length-1] + ds[2].data[ch.data.labels.length-1];
  window.setEl('sent-chart-sub', 'Based on ' + total + ' analysis' + (total !== 1 ? 'es' : '') + ' this session');
};

// keep alias
var pushSentPoint = window.pushSentPoint;