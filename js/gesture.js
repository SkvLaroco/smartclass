/**
 * js/gesture.js — SmartClass Gesture Detection (MediaPipe Hands)
 *
 * Deep-learning powered gesture detection for the whole classroom.
 * Uses MediaPipe Hands to detect ALL hands in the frame simultaneously,
 * classifies gestures from 21 hand landmarks, and associates them with
 * known student positions (updated by the face recognition loop).
 *
 * Gesture classes:  Raise Hand · Thumbs Up · Pointing · Wave
 * Max simultaneous: 8 hands (4 students with both hands)
 *
 * Depends on: app.js (window.state, window.el, window.toast, window.log)
 * CDN scripts added in index.html: @mediapipe/hands, camera_utils, drawing_utils
 */
'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
var _gestStream   = null;
var _gestCamera   = null;
var _gestHands    = null;
var _gestCvs      = null;
var _gestCvsCtx   = null;
var _gestRunning  = false;
var _gestAutoLog  = true;
var _gestDebounce = {};       // { key: timestamp }
var GESTURE_COOLDOWN = 3500; // ms between auto-logs per person

var GESTURE_LABELS = {
  raise:   '✋ Raise Hand',
  thumbup: '👍 Thumbs Up',
  point:   '☝️ Pointing',
  wave:    '👋 Wave'
};

var GESTURE_COLORS = {
  raise:   '#68d391',
  thumbup: '#f6ad55',
  point:   '#76e4f7',
  wave:    '#b794f4'
};

// Student position map — updated by face_engine.js each recognition frame
// { studentId: { id, name, section, cx, cy, lastSeen } }  cx/cy in 0-1 fraction
window._studentPositions = {};

// ── Lazy-load MediaPipe CDN scripts ───────────────────────────────────────────
function _loadMediaPipe(callback) {
  if (window.Hands) { callback(true); return; }
  var loaded = 0, total = 0;
  var srcs = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1620248257/drawing_utils.js'
  ];
  total = srcs.length;
  srcs.forEach(function(src) {
    if (document.querySelector('script[src="' + src + '"]')) { loaded++; if (loaded === total) callback(!!window.Hands); return; }
    var s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = s.onerror = function() { loaded++; if (loaded === total) callback(!!window.Hands); };
    document.head.appendChild(s);
  });
}

// ── Camera: start ─────────────────────────────────────────────────────────────
window.startGestCam = function() {
  window.toast('⏳ Loading MediaPipe Hands…', 'blue', 3000);
  _loadMediaPipe(function(ok) {
    if (!ok) {
      window.toast('⚠️ MediaPipe unavailable — camera-only mode', 'orange');
      _openCamera(function(stream) {
        if (stream) { _gestStream = stream; _attachVideo(stream); }
        else _showDemoPlaceholder();
        window.state.camera.gesture = true;
        window._populateGestStudentSelect();
        window.log('📷 Camera active (manual gestures only)', 'orange');
      });
      return;
    }
    _openCamera(function(stream) {
      if (!stream) {
        _showDemoPlaceholder();
        window.state.camera.gesture = true;
        window._populateGestStudentSelect();
        window.log('📷 No camera — gesture buttons available', 'orange');
        return;
      }
      _gestStream = stream;
      _attachVideo(stream);
      _initHands();
    });
  });
};

// ── Camera: stop ─────────────────────────────────────────────────────────────
window.stopGestCam = function() {
  _gestRunning = false;
  if (_gestCamera) { try { _gestCamera.stop(); } catch(e) {} _gestCamera = null; }
  if (_gestHands)  { try { _gestHands.close(); } catch(e) {} _gestHands  = null; }
  if (_gestStream) { _gestStream.getTracks().forEach(function(t){t.stop();}); _gestStream = null; }
  var v = document.getElementById('gest-vid');
  if (v) { v.srcObject = null; v.style.transform = ''; }
  if (_gestCvs && _gestCvsCtx) _gestCvsCtx.clearRect(0, 0, _gestCvs.width, _gestCvs.height);
  window.state.camera.gesture = false;
  window.log('⏹ Gesture detection stopped', 'orange');
};

// Try rear camera → front → any
function _openCamera(callback) {
  var constraints = [
    { video: { width:1280, height:720, facingMode:'environment' }, audio:false },
    { video: { width:1280, height:720, facingMode:'user' },        audio:false },
    { video: true, audio: false }
  ];
  var i = 0;
  function tryNext() {
    if (i >= constraints.length) { callback(null); return; }
    navigator.mediaDevices.getUserMedia(constraints[i++])
      .then(function(s) { callback(s); })
      .catch(function()  { tryNext(); });
  }
  tryNext();
}

function _attachVideo(stream) {
  var v = document.getElementById('gest-vid');
  if (v) { v.srcObject = stream; v.style.transform = 'scaleX(-1)'; v.play(); }
}

// ── Initialise MediaPipe Hands ────────────────────────────────────────────────
function _initHands() {
  var vid = document.getElementById('gest-vid');
  if (!vid || !window.Hands) return;

  // Canvas overlay
  var wrap = document.getElementById('gest-cam-wrap');
  if (wrap) {
    _gestCvs = document.getElementById('gest-canvas');
    if (!_gestCvs) {
      _gestCvs = document.createElement('canvas');
      _gestCvs.id = 'gest-canvas';
      _gestCvs.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5';
      wrap.appendChild(_gestCvs);
    }
    _gestCvsCtx = _gestCvs.getContext('2d');
  }

  _gestHands = new Hands({
    locateFile: function(f) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/' + f;
    }
  });
  _gestHands.setOptions({
    maxNumHands            : 8,
    modelComplexity        : 1,
    minDetectionConfidence : 0.65,
    minTrackingConfidence  : 0.55
  });
  _gestHands.onResults(_onResults);

  // Prefer Camera util (smooth RAF loop) otherwise fall back to manual loop
  if (window.Camera) {
    _gestCamera = new Camera(vid, {
      onFrame: async function() {
        if (_gestHands && _gestRunning) { try { await _gestHands.send({image:vid}); } catch(e){} }
      },
      width: 1280, height: 720
    });
    _gestCamera.start();
  } else {
    _gestRunning = true;
    (function loop() {
      if (!_gestRunning || !_gestHands) return;
      _gestHands.send({image:vid}).catch(function(){});
      setTimeout(loop, 80);
    })();
  }

  _gestRunning = true;
  window.state.camera.gesture = true;
  window._populateGestStudentSelect();
  window.log('🤖 MediaPipe Hands active — watching whole class', 'blue');
  window.toast('✅ Gesture detection active — watching whole class', 'green');
}

// ── Results handler (every frame) ────────────────────────────────────────────
function _onResults(results) {
  if (!_gestCvs || !_gestCvsCtx) return;

  var wrap = document.getElementById('gest-cam-wrap');
  _gestCvs.width  = wrap ? wrap.clientWidth  : 640;
  _gestCvs.height = wrap ? wrap.clientHeight : 360;

  var ctx = _gestCvsCtx, W = _gestCvs.width, H = _gestCvs.height;
  ctx.clearRect(0, 0, W, H);

  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.font = '11px "JetBrains Mono",monospace';
    ctx.fillText('Scanning for gestures…', 10, 22);
    return;
  }

  results.multiHandLandmarks.forEach(function(lm, idx) {
    var gesture = _classify(lm);

    // Draw skeleton regardless — shows teacher the system is working
    var skelColor = gesture ? (GESTURE_COLORS[gesture.key] || '#f6ad55') : 'rgba(255,255,255,0.25)';
    _drawSkeleton(ctx, lm, W, H, skelColor);

    if (!gesture) return;

    // Bounding box
    var xs = lm.map(function(l){return l.x;}), ys = lm.map(function(l){return l.y;});
    var pad = 0.04;
    var bx  = Math.max(0, (Math.min.apply(null,xs) - pad) * W);
    var by  = Math.max(0, (Math.min.apply(null,ys) - pad) * H);
    var bw  = Math.min(W - bx, (Math.max.apply(null,xs) - Math.min.apply(null,xs) + pad*2) * W);
    var bh  = Math.min(H - by, (Math.max.apply(null,ys) - Math.min.apply(null,ys) + pad*2) * H);

    // Find student
    var cx = (Math.min.apply(null,xs) + Math.max.apply(null,xs)) / 2;
    var cy = (Math.min.apply(null,ys) + Math.max.apply(null,ys)) / 2;
    var student     = _nearestStudent(cx, cy) || _selectedStudent();
    var displayName = student ? student.name : ('Person ' + (idx + 1));
    var color       = GESTURE_COLORS[gesture.key];

    // Draw box
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = _rgba(color, 0.12); ctx.fillRect(bx, by, bw, bh);

    // Label bar
    var barH = 26;
    ctx.fillStyle = color;
    ctx.fillRect(bx, Math.max(0, by - barH), bw, barH);
    ctx.fillStyle = '#0d1117'; ctx.font = 'bold 11px "JetBrains Mono",monospace';
    ctx.fillText(gesture.label + '  ·  ' + displayName, bx + 5, Math.max(16, by - 8));

    // Auto-log
    if (_gestAutoLog && gesture.confidence >= 0.70) {
      var dkey = student ? student.id : ('pos_' + Math.round(cx*10) + '_' + idx);
      var now  = Date.now();
      if (!_gestDebounce[dkey] || now - _gestDebounce[dkey] > GESTURE_COOLDOWN) {
        _gestDebounce[dkey] = now;
        _logEntry(displayName, gesture, student, true);
      }
    }
  });
}

// ── Hand skeleton ─────────────────────────────────────────────────────────────
var CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];
var TIP_IDX = new Set([4,8,12,16,20]);

function _drawSkeleton(ctx, lm, W, H, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  CONNECTIONS.forEach(function(c) {
    ctx.beginPath();
    ctx.moveTo(lm[c[0]].x*W, lm[c[0]].y*H);
    ctx.lineTo(lm[c[1]].x*W, lm[c[1]].y*H);
    ctx.stroke();
  });
  lm.forEach(function(l, i) {
    ctx.beginPath();
    ctx.arc(l.x*W, l.y*H, TIP_IDX.has(i) ? 4 : 2.5, 0, 2*Math.PI);
    ctx.fillStyle = TIP_IDX.has(i) ? color : '#fff'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  });
}

function _rgba(hex, a) {
  var r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}

// ── Gesture classification ────────────────────────────────────────────────────
function _classify(L) {
  function up(tip, pip) { return L[tip].y < L[pip].y - 0.025; }
  function thumbUp()     { return L[4].y  < L[3].y  - 0.02;   }

  var th = thumbUp(), ix = up(8,6), mi = up(12,10), ri = up(16,14), pi = up(20,18);
  var ext = [ix,mi,ri,pi].filter(Boolean).length;
  var wy  = L[0].y; // wrist Y (0=top, 1=bottom)

  // RAISE HAND: 3+ fingers extended, hand in upper 70% of frame
  if (ext >= 3 && wy < 0.70) {
    var c = Math.min(0.97, 0.75 + (ext-3)*0.05 + (0.70-wy)*0.15);
    return { key:'raise', label:GESTURE_LABELS.raise, confidence:c };
  }
  // THUMBS UP: thumb up, others closed, thumb tip above wrist
  if (th && ext === 0 && L[4].y < L[0].y)
    return { key:'thumbup', label:GESTURE_LABELS.thumbup, confidence:0.90 };
  // POINTING: only index extended
  if (ix && !mi && !ri && !pi)
    return { key:'point', label:GESTURE_LABELS.point, confidence:0.88 };
  // WAVE: all extended, hand at mid-level
  if (ext >= 4 && th && wy >= 0.40 && wy <= 0.90)
    return { key:'wave', label:GESTURE_LABELS.wave, confidence:0.78 };

  return null;
}

// ── Student matching ──────────────────────────────────────────────────────────
function _nearestStudent(cx, cy) {
  var positions = window._studentPositions || {};
  var now = Date.now();
  // Prune stale
  Object.keys(positions).forEach(function(id) {
    if (now - positions[id].lastSeen > 30000) delete positions[id];
  });
  var best = null, bestD = 0.28;
  Object.values(positions).forEach(function(p) {
    var d = Math.sqrt(Math.pow(p.cx-cx,2) + Math.pow(p.cy-cy,2));
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}

function _selectedStudent() {
  var sel = document.getElementById('gest-student-select');
  if (!sel || !sel.value) return null;
  return window.state.students.find(function(s) { return s.id === sel.value; }) || null;
}

/**
 * Called by face_engine.js each recognition frame to keep student positions fresh.
 */
window.updateStudentPosition = function(studentId, name, section, cx, cy) {
  window._studentPositions[studentId] = { id:studentId, name:name, section:section||'', cx:cx, cy:cy, lastSeen:Date.now() };
};

// ── Log entry ─────────────────────────────────────────────────────────────────
function _logEntry(displayName, gesture, student, auto) {
  var key = gesture.key;
  window.state.gestureTotal[key] = (window.state.gestureTotal[key] || 0) + 1;
  var el = document.getElementById('g-' + key); if (el) el.textContent = window.state.gestureTotal[key];
  var tot = Object.values(window.state.gestureTotal).reduce(function(a,b){return a+b;}, 0);
  var se  = document.getElementById('stat-gestures'); if (se) se.textContent = tot;

  if (student && student.id) {
    if (!window.state.gestureByStudent[student.id])
      window.state.gestureByStudent[student.id] = {raise:0,thumbup:0,point:0,wave:0,total:0};
    window.state.gestureByStudent[student.id][key]++;
    window.state.gestureByStudent[student.id].total++;
  }

  var tbody = document.getElementById('gest-log'); if (!tbody) return;
  if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
  var now = new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  var row = document.createElement('tr');
  row.innerHTML = '<td><span style="font-family:var(--mono);font-size:11px">'+now+'</span></td>'
    +'<td><span style="font-weight:600">'+displayName+'</span></td>'
    +'<td>'+gesture.label+'</td>'
    +'<td><span style="font-size:12px;color:var(--text-3)">'+(student?student.section||'—':'—')+'</span></td>'
    +'<td>'+(auto?'<span class="badge b-green">🤖 Auto-detected</span>':'<span class="badge b-blue">👩‍🏫 Manual</span>')+'</td>';
  tbody.prepend(row);
  if (tbody.children.length > 25) tbody.removeChild(tbody.lastChild);
  if (typeof window.renderGestureRanking === 'function') window.renderGestureRanking();
  window.log('✋ '+gesture.label+' — '+displayName+(auto?' (AI)':' (manual)'),'blue');
}

// ── Manual log (teacher button) ───────────────────────────────────────────────
window.logGesture = function(key) {
  var sel = document.getElementById('gest-student-select');
  var stuId = sel ? sel.value : '';
  var student = stuId ? window.state.students.find(function(s){return s.id===stuId;}) : null;
  var name = student ? student.name : '(Unknown)';
  _logEntry(name, {key:key, label:GESTURE_LABELS[key], confidence:1}, student, false);
  window.toast(GESTURE_LABELS[key]+' logged for '+name, 'blue', 1500);
};

// ── Ranking ───────────────────────────────────────────────────────────────────
window.renderGestureRanking = function() {
  var body = document.getElementById('gest-rank-body'); if (!body) return;
  var entries = Object.keys(window.state.gestureByStudent).map(function(id) {
    var stu = window.state.students.find(function(s){return s.id===id;});
    return {name: stu ? stu.name : id, count: window.state.gestureByStudent[id].total||0};
  }).filter(function(e){return e.count>0;}).sort(function(a,b){return b.count-a.count;}).slice(0,5);
  if (!entries.length) { body.innerHTML='<div style="color:var(--text-3);font-size:13px;text-align:center;padding:20px">No gestures detected yet</div>'; return; }
  var rc = ['rank-1','rank-2','rank-3','rank-n','rank-n'], mx = entries[0].count;
  body.innerHTML = entries.map(function(e,i){
    return '<div class="part-item"><div class="rank-num '+rc[i]+'">'+(i+1)+'</div>'
      +'<div style="flex:1"><div class="part-name">'+e.name+'</div>'
      +'<div class="prog" style="margin-top:5px"><div class="prog-fill" style="width:'+Math.round(e.count/mx*100)+'%;background:var(--brand)"></div></div></div>'
      +'<span style="font-family:var(--mono);font-size:13px;font-weight:600;color:var(--text-2)">'+e.count+'</span></div>';
  }).join('');
};

// ── Student dropdown ──────────────────────────────────────────────────────────
window._populateGestStudentSelect = function() {
  var sel = document.getElementById('gest-student-select'); if (!sel) return;
  var prev = sel.value;
  sel.innerHTML = '<option value="">🤖 Auto-detect by face position</option>';
  window.state.students.forEach(function(s) {
    sel.innerHTML += '<option value="'+s.id+'">'+s.name+'</option>';
  });
  if (prev) sel.value = prev;
};

// ── Demo placeholder ──────────────────────────────────────────────────────────
function _showDemoPlaceholder() {
  var wrap = document.getElementById('gest-cam-wrap'); if (!wrap) return;
  var vid = wrap.querySelector('video'); if (vid) vid.style.display = 'none';
  if (!wrap.querySelector('.demo-ph')) {
    var ph = document.createElement('div'); ph.className = 'demo-ph';
    ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-2);gap:12px;z-index:2';
    ph.innerHTML = '<div style="font-size:40px">📷</div><div style="font-size:13px;font-weight:600;color:var(--text-3)">No camera — manual mode</div>';
    wrap.appendChild(ph);
  }
}