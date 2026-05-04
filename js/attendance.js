/**
 * js/attendance.js — SmartClass Attendance Module
 * Handles: attendance table · status buttons · stats · CSV export
 * Depends on: app.js (window.state, window.enrolled, window.setEl, window.el)
 */
'use strict';

// ── Stats bar ───────────────────────────────────────────────────────────────
window.updateStats = function() {
  var present = window.state.students.filter(function(s) { return s.status === 'present'; }).length;
  var absent  = window.state.students.filter(function(s) { return s.status === 'absent';  }).length;
  var total   = window.state.students.length;
  var pct     = total ? Math.round(present / total * 100) : 0;

  window.setEl('stat-present',   present);
  window.setEl('stat-absent',    absent);
  window.setEl('stat-pct',       pct + '%');
  window.setEl('stat-present-s', present);
  window.setEl('stat-absent-s',  absent);
  window.setEl('stat-total',     total);
  window.setEl('stat-total-s',   total);

  var pb = window.el('prog-present'); if (pb) pb.style.width = pct + '%';
  var ab = window.el('prog-absent');  if (ab) ab.style.width = (total ? Math.round(absent / total * 100) : 0) + '%';

  if (typeof refreshEmotionDonut === 'function') refreshEmotionDonut();
};

// ── Attendance table ─────────────────────────────────────────────────────────
window.renderTable = function() {
  var tbody = window.el('att-tbody'); if (!tbody) return;
  var q = ((window.el('att-search') || {}).value || '').toLowerCase();
  var emotions  = { Happy:'😊', Neutral:'😐', Confused:'🤔', Bored:'😴', Stressed:'😰' };
  var emColors  = { Happy:'b-green', Neutral:'b-blue', Confused:'b-purple', Bored:'b-orange', Stressed:'b-red' };
  var rows = window.state.students.filter(function(s) {
    return !q || s.name.toLowerCase().includes(q) || (s.sid || '').toLowerCase().includes(q);
  });

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:40px">'
      + (window.state.students.length === 0
        ? 'No students enrolled. <a href="#" onclick="navigate(\'enrollment\');return false">Enroll students →</a>'
        : 'No results')
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(function(s) {
    var badge = {
      present: '<span class="badge b-green">● Present</span>',
      absent:  '<span class="badge b-red">● Absent</span>',
      late:    '<span class="badge b-orange">● Late</span>',
      pending: '<span class="badge b-gray">— Pending</span>'
    }[s.status] || '';

    var emBadge   = s.emotion
      ? '<span class="badge ' + (emColors[s.emotion] || 'b-gray') + '">' + (emotions[s.emotion] || '') + ' ' + s.emotion + '</span>'
      : '<span style="color:var(--text-3)">—</span>';
    var confBadge = s.confidence
      ? '<span class="badge b-blue" style="font-family:var(--mono);font-size:11px">' + s.confidence + '%</span>'
      : '<span style="color:var(--text-3)">—</span>';

    var ee = window.enrolled.find(function(e) { return e.id === s.id; });
    var avatar = ee && ee.photoDataUrl
      ? '<img src="' + ee.photoDataUrl + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--border-2);flex-shrink:0">'
      : '<div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--purple));display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;color:#fff;flex-shrink:0">' + s.initials + '</div>';

    return '<tr>'
      + '<td><div style="display:flex;align-items:center;gap:10px">' + avatar
      + '<div><div style="font-weight:600;font-size:13.5px">' + s.name + '</div>'
      + '<div style="font-size:11px;color:var(--text-3);font-family:var(--mono)">' + s.sid + '</div></div></div></td>'
      + '<td><span style="font-size:12px;color:var(--text-3)">' + s.section + '</span></td>'
      + '<td>' + badge + '</td>'
      + '<td>' + emBadge + '</td>'
      + '<td>' + confBadge + '</td>'
      + '<td><div style="display:flex;gap:5px">'
      + '<button class="ob ob-p" onclick="setStatus(\'' + s.id + '\',\'present\')">P</button>'
      + '<button class="ob ob-l" onclick="setStatus(\'' + s.id + '\',\'late\')">L</button>'
      + '<button class="ob ob-a" onclick="setStatus(\'' + s.id + '\',\'absent\')">A</button>'
      + '</div></td></tr>';
  }).join('');
};

// ── Manual status override ────────────────────────────────────────────────────
window.setStatus = function(id, status) {
  var s = window.state.students.find(function(x) { return x.id === id; });
  if (s) { s.status = status; window.renderTable(); window.updateStats(); }
};

window.markAllPresent = function() {
  window.state.students.forEach(function(s) { s.status = 'present'; });
  window.renderTable(); window.updateStats();
  window.log('✅ All students marked present', 'green');
};

window.resetAttendance = function() {
  window.state.students.forEach(function(s) { s.status = 'pending'; s.emotion = null; s.confidence = null; });
  window.renderTable(); window.updateStats();
  window.log('🔄 Attendance reset', 'orange');
};

// ── CSV export ────────────────────────────────────────────────────────────────
window.exportCSV = function() {
  var rows = [['ID', 'Name', 'Student ID', 'Section', 'Status', 'Emotion', 'Confidence']];
  window.state.students.forEach(function(s) {
    rows.push([s.id, s.name, s.sid || '', s.section || '', s.status, s.emotion || '—', s.confidence ? s.confidence + '%' : '—']);
  });
  var csv = rows.map(function(r) { return r.join(','); }).join('\n');
  var a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'attendance_' + new Date().toISOString().split('T')[0] + '.csv'
  });
  a.click();
  window.log('📥 Attendance exported', 'blue');
};

window.exportSessionsCSV = function() {
  var sessions = window.loadSessions();
  if (!sessions.length) { window.toast('No sessions to export', 'orange'); return; }
  var rows = [['Date', 'Section', 'Total', 'Present', 'Late', 'Absent', 'Att%', 'Eng%']];
  sessions.forEach(function(s) {
    rows.push([s.date.split('T')[0], s.section || '', s.totalStudents, s.present, s.late, s.absent, s.attPct, s.engAvg]);
  });
  var csv = rows.map(function(r) { return r.join(','); }).join('\n');
  var a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'sessions_' + new Date().toISOString().split('T')[0] + '.csv'
  });
  a.click();
};