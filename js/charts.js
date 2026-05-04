/**
 * js/charts.js — SmartClass Charts Module
 * Handles: dashboard charts · analytics charts · sentiment live chart
 * Depends on: Chart.js CDN · app.js · attendance.js · sentiment.js
 */
'use strict';

// ── Shared Chart.js defaults ──────────────────────────────────────────────────
var CD = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color:'#8d99bb', font:{family:'JetBrains Mono',size:10} }, grid:{color:'rgba(0,0,0,0.04)'} },
    y: { ticks: { color:'#8d99bb', font:{family:'JetBrains Mono',size:10} }, grid:{color:'rgba(0,0,0,0.04)'} }
  }
};
function withLegend(o) {
  return Object.assign({}, CD, o, {
    plugins: { legend: { display:true, labels:{color:'#4a5578',font:{family:'JetBrains Mono',size:10},padding:14,boxWidth:10} } }
  });
}
function emptyChart(canvasId, msg) {
  var e = document.getElementById(canvasId);
  if (e) e.parentNode.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-3);font-size:13px;flex-direction:column;gap:8px;text-align:center;padding:20px">' + msg + '</div>';
}

// ── Dashboard Charts ──────────────────────────────────────────────────────────
window.initDashboardCharts = function() {
  ['attBar','emotDo','engTrend'].forEach(function(k) {
    if (window.state.chartInst[k]) { window.state.chartInst[k].destroy(); delete window.state.chartInst[k]; }
  });

  var sessions = window.loadSessions(), last7 = sessions.slice(-7);

  // Attendance bar
  var c1 = window.el('chart-att');
  if (c1) {
    if (!last7.length) {
      emptyChart('chart-att', '<span style="font-size:28px">📋</span>No sessions yet.<br>Start and end a session.');
    } else {
      window.state.chartInst.attBar = new Chart(c1, {
        type: 'bar',
        data: {
          labels: last7.map(function(s) { return s.label || '—'; }),
          datasets: [
            { label:'Present', data:last7.map(function(s){return s.present||0;}), backgroundColor:'rgba(47,158,68,0.75)', borderRadius:5, borderSkipped:false },
            { label:'Late',    data:last7.map(function(s){return s.late||0;}),    backgroundColor:'rgba(240,140,0,0.6)',  borderRadius:5, borderSkipped:false },
            { label:'Absent',  data:last7.map(function(s){return s.absent||0;}),  backgroundColor:'rgba(201,42,42,0.6)', borderRadius:5, borderSkipped:false }
          ]
        },
        options: Object.assign({}, withLegend(), {
          scales: Object.assign({}, CD.scales, {
            x: Object.assign({}, CD.scales.x, { stacked:true }),
            y: Object.assign({}, CD.scales.y, { stacked:true })
          })
        })
      });
    }
  }

  // Emotion donut
  var c2 = window.el('chart-emotion');
  if (c2) {
    window.state.chartInst.emotDo = new Chart(c2, {
      type: 'doughnut',
      data: {
        labels: ['Happy','Neutral','Confused','Bored','Stressed'],
        datasets: [{
          data: [0,0,0,0,0],
          backgroundColor: ['rgba(47,158,68,.8)','rgba(59,91,219,.8)','rgba(103,65,217,.8)','rgba(240,140,0,.8)','rgba(201,42,42,.8)'],
          borderWidth: 0, hoverOffset: 8
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false, cutout:'70%',
        plugins: { legend: { position:'bottom', labels:{color:'#4a5578',font:{family:'JetBrains Mono',size:10},padding:12,boxWidth:10} } }
      }
    });
    if (typeof window.refreshEmotionDonut === 'function') window.refreshEmotionDonut();
  }

  // Engagement trend
  var c3 = window.el('chart-eng');
  if (c3) {
    window.state.chartInst.engTrend = new Chart(c3, {
      type: 'line',
      data: { labels:[], datasets:[{ data:[], borderColor:'var(--brand)', backgroundColor:'rgba(59,91,219,.07)', fill:true, tension:0.45, pointRadius:3, pointBackgroundColor:'var(--brand)' }] },
      options: Object.assign({}, CD, { scales: Object.assign({}, CD.scales, { y: Object.assign({}, CD.scales.y, { min:0, max:100 }) }) })
    });
  }
};

// ── Sentiment Live Chart ──────────────────────────────────────────────────────
window.initSentimentChart = function() {
  if (window.state.chartInst.sentLive) { window.state.chartInst.sentLive.destroy(); delete window.state.chartInst.sentLive; }
  var c = window.el('chart-sent-live'); if (!c) return;
  window.state.chartInst.sentLive = new Chart(c, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label:'Positive',     data:[], borderColor:'rgba(47,158,68,1)',  backgroundColor:'rgba(47,158,68,.06)',  fill:true, tension:0.4, pointRadius:4 },
        { label:'Neutral/Mixed',data:[], borderColor:'rgba(59,91,219,1)',  backgroundColor:'rgba(59,91,219,.05)',  fill:true, tension:0.4, pointRadius:4 },
        { label:'Negative',     data:[], borderColor:'rgba(201,42,42,1)',  backgroundColor:'rgba(201,42,42,.04)',  fill:true, tension:0.4, pointRadius:4 }
      ]
    },
    options: Object.assign({}, withLegend(), { animation:{ duration:250 } })
  });
  window.state.sentLog.forEach(function(e) {
    if (typeof window.pushSentPoint === 'function')
      window.pushSentPoint(e.label, new Date(e.ts).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }));
  });
};

// ── Analytics Charts ──────────────────────────────────────────────────────────
window.initAnalyticsCharts = function() {
  ['analTrend','analGest','analEmot'].forEach(function(k) {
    if (window.state.chartInst[k]) { window.state.chartInst[k].destroy(); delete window.state.chartInst[k]; }
  });

  var sessions = window.loadSessions();
  window.setEl('analytics-sessions', sessions.length);

  if (!sessions.length) {
    ['analytics-avg-att','analytics-avg-eng','analytics-total-gest','analytics-pos-mood'].forEach(function(id) { window.setEl(id, '—'); });
    window.setEl('analytics-avg-att-sub', 'No sessions yet');
    window.setEl('analytics-avg-eng-sub', 'No sessions yet');
  } else {
    var avgAtt    = Math.round(sessions.reduce(function(a,s){return a+(s.attPct||0);},0)/sessions.length);
    var avgEng    = Math.round(sessions.reduce(function(a,s){return a+(s.engAvg||0);},0)/sessions.length);
    var totalGest = sessions.reduce(function(a,s){var g=s.gestures||{};return a+(g.raise||0)+(g.thumbup||0)+(g.point||0)+(g.wave||0);},0);
    var totalEmot = 0, posEmot = 0;
    sessions.forEach(function(s) {
      var t = s.emotTally || {};
      var sum = (t.Happy||0)+(t.Neutral||0)+(t.Confused||0)+(t.Bored||0)+(t.Stressed||0);
      totalEmot += sum; posEmot += (t.Happy||0)+(t.Neutral||0);
    });
    window.setEl('analytics-avg-att',  avgAtt + '%');
    window.setEl('analytics-avg-att-sub', sessions.length + ' sessions');
    window.setEl('analytics-avg-eng',  avgEng + '%');
    window.setEl('analytics-avg-eng-sub', sessions.length + ' sessions');
    window.setEl('analytics-total-gest', totalGest);
    window.setEl('analytics-pos-mood',  totalEmot > 0 ? Math.round(posEmot/totalEmot*100) + '%' : '—');
  }

  // Attendance & Engagement Trend
  var c1 = window.el('chart-trend');
  if (c1) {
    if (!sessions.length) {
      emptyChart('chart-trend', '<span style="font-size:28px">📈</span>No sessions yet.');
    } else {
      window.state.chartInst.analTrend = new Chart(c1, {
        type: 'line',
        data: {
          labels: sessions.map(function(s){return s.label||'—';}),
          datasets: [
            { label:'Attendance %', data:sessions.map(function(s){return s.attPct||0;}), borderColor:'rgba(47,158,68,1)', backgroundColor:'rgba(47,158,68,.07)', fill:true, tension:0.4, pointRadius:4, pointBackgroundColor:'rgba(47,158,68,1)' },
            { label:'Engagement %', data:sessions.map(function(s){return s.engAvg||0;}), borderColor:'rgba(59,91,219,1)', backgroundColor:'rgba(59,91,219,.07)', fill:true, tension:0.4, pointRadius:4, pointBackgroundColor:'rgba(59,91,219,1)' }
          ]
        },
        options: Object.assign({}, withLegend(), { scales: Object.assign({}, CD.scales, { y: Object.assign({}, CD.scales.y, { min:0, max:100 }) }) })
      });
    }
  }

  // Gesture Frequency
  var c2 = window.el('chart-gest-freq');
  if (c2) {
    var gt = { raise:0, thumbup:0, point:0, wave:0 };
    sessions.forEach(function(s) { var g=s.gestures||{}; Object.keys(gt).forEach(function(k){gt[k]+=(g[k]||0);}); });
    Object.keys(window.state.gestureTotal).forEach(function(k) { gt[k] += (window.state.gestureTotal[k]||0); });
    var gdata = [gt.raise, gt.thumbup, gt.point, gt.wave];
    if (!gdata.some(function(v){return v>0;})) {
      emptyChart('chart-gest-freq', '<span style="font-size:28px">✋</span>No gestures logged.');
    } else {
      window.state.chartInst.analGest = new Chart(c2, {
        type: 'bar',
        data: { labels:['Raise Hand','Thumbs Up','Pointing','Wave'], datasets:[{ label:'Count', data:gdata, backgroundColor:'rgba(232,89,12,.72)', borderRadius:6 }] },
        options: CD
      });
    }
  }

  // Emotion Timeline
  var c3 = window.el('chart-emot-time');
  if (c3) {
    if (!sessions.length) {
      emptyChart('chart-emot-time', '<span style="font-size:28px">😐</span>No emotion data yet.');
    } else {
      var ekeys   = ['Happy','Neutral','Confused','Bored','Stressed'];
      var ecolors = ['rgba(47,158,68,1)','rgba(59,91,219,1)','rgba(103,65,217,1)','rgba(240,140,0,1)','rgba(201,42,42,1)'];
      window.state.chartInst.analEmot = new Chart(c3, {
        type: 'line',
        data: {
          labels: sessions.map(function(s){return s.label||'—';}),
          datasets: ekeys.map(function(k,i) {
            return {
              label: k,
              data: sessions.map(function(s){return (s.emotTally||{})[k]||0;}),
              borderColor: ecolors[i],
              backgroundColor: ecolors[i].replace(',1)',',0.07)'),
              fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:ecolors[i]
            };
          })
        },
        options: withLegend()
      });
    }
  }
};