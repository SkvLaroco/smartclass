/**
 * js/app.js — SmartClass Core
 * Handles: helpers · storage · app state · login (MySQL via PHP API) ·
 *          navigation · session management · sections · enrollment grid ·
 *          settings · user management
 */
'use strict';

// ═══════════════════════════════════════════════════════════════
//  CONFIG — point to your XAMPP folder
// ═══════════════════════════════════════════════════════════════
var API_BASE = '/smartclass/api'; // Adjust if your htdocs subfolder differs

// ═══════════════════════════════════════════════════════════════
//  DOM HELPERS
// ═══════════════════════════════════════════════════════════════
window.el    = function(id)    { return document.getElementById(id); };
window.setEl = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };

window.toast = function(msg, type, dur) {
  type = type || 'blue'; dur = dur || 3200;
  var c = document.getElementById('toast-container');
  if (!c) return;
  var d = document.createElement('div');
  d.className = 'toast-item ' + type;
  d.innerHTML = msg;
  c.appendChild(d);
  setTimeout(function() {
    d.style.opacity = '0';
    d.style.transform = 'translateY(8px)';
    d.style.transition = '.25s ease';
    setTimeout(function() { d.remove(); }, 260);
  }, dur);
};

window.log = function(msg, color) {
  color = color || 'blue';
  var feed = document.getElementById('activity-feed');
  if (!feed) return;
  var colors = { blue: 'var(--brand)', green: 'var(--green)', orange: 'var(--orange)', red: 'var(--red)', purple: 'var(--purple)' };
  var now = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  var div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = '<div class="feed-dot" style="background:' + (colors[color] || colors.blue) + '"></div>'
    + '<div><div class="feed-msg">' + msg + '</div><div class="feed-time">' + now + '</div></div>';
  feed.prepend(div);
  if (feed.children.length > 9) feed.removeChild(feed.lastChild);
};

window.setPreset = function(btn) { el('sent-input').value = btn.textContent; };

// ═══════════════════════════════════════════════════════════════
//  LOCAL STORAGE — enrolled students & sessions stay client-side
//  (face descriptors are too large for MySQL)
// ═══════════════════════════════════════════════════════════════
var STORE_KEY      = 'smartclass_enrolled_v2';
var SESSIONS_KEY   = 'smartclass_sessions_v1';
var SECTIONS_KEY   = 'smartclass_sections_v1';
var SUMHISTORY_KEY = 'smartclass_sumhist_v1';
var SETTINGS_KEY   = 'smartclass_settings_v1';
var AUTH_KEY       = 'smartclass_auth_v1';   // stores { token, user }

window.loadEnrolled    = function() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch(e) { return []; } };
window.saveEnrolled    = function(arr) { localStorage.setItem(STORE_KEY, JSON.stringify(arr)); };
window.loadSessions    = function() { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || []; } catch(e) { return []; } };
window.saveSessions    = function(arr) { localStorage.setItem(SESSIONS_KEY, JSON.stringify(arr)); };
window.loadSumHistory  = function() { try { return JSON.parse(localStorage.getItem(SUMHISTORY_KEY)) || []; } catch(e) { return []; } };
window.saveSumHistory  = function(arr) { localStorage.setItem(SUMHISTORY_KEY, JSON.stringify(arr.slice(-20))); };
window.loadSettings    = function() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch(e) { return {}; } };
window.saveSettingsData = function(obj) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj)); };

// Sections: synced from MySQL on login but also cached locally for offline resilience
window.loadSections = function() {
  try {
    var s = JSON.parse(localStorage.getItem(SECTIONS_KEY));
    if (s && s.length) return s;
  } catch(e) {}
  var def = [{ id: 'SEC-001', name: 'CS301-A', subject: 'Data Structures', createdAt: new Date().toISOString() }];
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(def));
  return def;
};
window.saveSections = function(arr) { localStorage.setItem(SECTIONS_KEY, JSON.stringify(arr)); };

// Auth token helpers
window.loadAuth = function() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch(e) { return null; } };
window.saveAuth = function(obj) { localStorage.setItem(AUTH_KEY, JSON.stringify(obj)); };
window.clearAuth = function() { localStorage.removeItem(AUTH_KEY); };

window.enrolled = window.loadEnrolled();

// ═══════════════════════════════════════════════════════════════
//  APP STATE
// ═══════════════════════════════════════════════════════════════
window.currentUser   = null;
window.activeSection = null;

window.authToken     = null;

window.state = {
  sessionActive: false, sessionStart: null, sessionTimer: null,
  camera: { face: false, gesture: false },
  students: [], chartInst: {},
  gestureTotal: { raise: 0, thumbup: 0, point: 0, wave: 0 },
  gestureByStudent: {},
  engScore: 0, engSamples: [], engInterval: null,
  recogStream: null,
  sentLog: []
};

// ═══════════════════════════════════════════════════════════════
//  LOGIN — calls PHP/MySQL API
// ═══════════════════════════════════════════════════════════════
/* switchLoginRole removed — role is auto-detected from DB */

window.doLogin = function() {
  var u = (el('login-user') || {}).value || '';
  var p = (el('login-pass') || {}).value || '';
  var errEl = el('login-err');
  var btn   = el('login-btn');

  if (!u || !p) {
    if (errEl) { errEl.textContent = 'Please enter username and password.'; errEl.style.display = 'block'; }
    return;
  }

  // Always wipe any existing saved session before a new login attempt.
  // This prevents stale sessions from a different role from being restored on refresh.
  window.clearAuth();

  if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
  if (errEl) errEl.style.display = 'none';

  fetch(API_BASE + '/auth.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', username: u, password: p })
  })
  .then(function(res) {
    // If server returns non-JSON (e.g. 404 HTML page), treat as API unavailable
    var ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('API not available (got ' + res.status + ' ' + ct + ')');
    }
    return res.json();
  })
  .then(function(data) {
    if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
    if (!data.ok) {
      // API is reachable and explicitly said credentials are wrong — show its error
      if (errEl) { errEl.textContent = data.error || 'Invalid username or password.'; errEl.style.display = 'block'; }
      return;
    }
    // MySQL login success
    window.authToken   = data.token;
    window.currentUser = data.user;
    window.saveAuth({ token: data.token, user: data.user });
    _onLoginSuccess(data.user);
  })
  .catch(function(err) {
    if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
    // API unreachable / path wrong / XAMPP not running → try local fallback
    console.warn('[auth] API unavailable, using local fallback:', err.message);
    _localLoginFallback(u, p);
  });
};

/** Dev/offline fallback — remove in production */
function _localLoginFallback(u, p) {
  var errEl = el('login-err');
  var defaults = [
    { id: 'U1', username: 'admin',    password: 'admin123',   role: 'admin',     name: 'Administrator',     avatar: '🛡',  student_sid: null, section_id: null },
    { id: 'U2', username: 'prof',     password: 'prof123',    role: 'professor', name: 'Prof. Maria Santos', avatar: '👩‍🏫', student_sid: null, section_id: null },
    { id: 'U3', username: 'prof2',    password: 'prof123',    role: 'professor', name: 'Prof. Juan Cruz',    avatar: '👨‍🏫', student_sid: null, section_id: null },
    { id: 'S1', username: 'student1', password: 'student123', role: 'student',   name: 'Maria Santos',       avatar: '👩‍🎓', student_sid: '2024-0001', section_id: 'SEC-001' },
    { id: 'S2', username: 'student2', password: 'student123', role: 'student',   name: 'Juan Dela Cruz',     avatar: '👨‍🎓', student_sid: '2024-0002', section_id: 'SEC-001' }
  ];
  var user = defaults.find(function(x) { return x.username === u && x.password === p; });
  if (!user) {
    if (errEl) { errEl.textContent = 'Invalid credentials. (API offline — local fallback)'; errEl.style.display = 'block'; }
    return;
  }
  var userObj = { id: user.id, username: user.username, role: user.role, name: user.name, avatar: user.avatar, student_sid: user.student_sid || null, section_id: user.section_id || null };
  window.currentUser = userObj;
  window.authToken   = null;
  // Save without a real token so refresh restores the correct role/portal.
  // token:null means the auto-restore skips API verification and uses the saved user directly.
  window.saveAuth({ token: null, user: userObj });
  _onLoginSuccess(window.currentUser);
}

function _onLoginSuccess(user) {
  el('login-screen').style.display = 'none';

  // ── Student gets their own portal ──────────────────────────────────────────
  if (user.role === 'student') {
    // Hide both teacher panels completely
    var sidebar = el('app-sidebar'); if (sidebar) sidebar.style.display = 'none';
    var main    = el('app-main');    if (main)    main.style.display    = 'none';
    // Show student portal
    var sp = el('student-portal');
    if (sp) { sp.style.display = 'block'; }
    if (typeof window.initStudentPortal === 'function') {
      window.initStudentPortal(user);
    } else {
      console.error('[SmartClass] initStudentPortal not found — is student.js loaded?');
    }
    return;
  }

  // ── Admin / Professor: teacher portal ──────────────────────────────────────
  el('app-sidebar').style.display = '';
  el('app-main').style.display    = '';

  var adminNav   = el('admin-nav-section');
  var adminUsers = el('admin-users-card');
  if (adminNav)   adminNav.style.display   = user.role === 'admin' ? '' : 'none';
  if (adminUsers) adminUsers.style.display = user.role === 'admin' ? '' : 'none';

  window.setEl('sidebar-username', user.name);
  window.setEl('sidebar-role', (user.role === 'admin' ? 'Administrator' : 'Instructor') + ' · SmartClass');
  var av = el('sidebar-avatar'); if (av) av.textContent = user.avatar || '👤';

  var hr = new Date().getHours();
  var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  window.setEl('dash-greeting', greet + ', ' + (user.name.split(' ')[0] || user.name) + ' 👋');

  var sections = window.loadSections();
  if (sections.length) { window.activeSection = sections[0]; _applySectionUI(); }

  window.navigate('dashboard');
  window.syncStudentsFromEnrolled();
  window.waitForFaceApi();
  window.log('🔐 Signed in as ' + user.name + ' (' + user.role + ')', 'blue');

  if (user.role === 'admin') _loadUsersFromDB();
}

window.doLogout = function() {
  // Invalidate server session if we have a token
  if (window.authToken) {
    fetch(API_BASE + '/auth.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout', token: window.authToken })
    }).catch(function() {});
  }
  // Stop all camera streams
  window.stopFaceCam && window.stopFaceCam();
  window.stopGestCam && window.stopGestCam();
  // Clear ALL saved state — this is the most important line.
  // If this is missing, refreshing the page restores the previous session.
  window.clearAuth();
  window.authToken   = null;
  window.currentUser = null;
  // Hide all portals
  var sidebar = el('app-sidebar'); if (sidebar) sidebar.style.display = 'none';
  var main    = el('app-main');    if (main)    main.style.display    = 'none';
  var sp      = el('student-portal');
  if (sp) { sp.style.display = 'none'; sp.innerHTML = ''; }
  // Show login screen
  el('login-screen').style.display = 'flex';
  var u = el('login-user'), p = el('login-pass');
  if (u) u.value = ''; if (p) p.value = '';
};

// Login on Enter key
['login-user', 'login-pass'].forEach(function(id) {
  var e = el(id); if (e) e.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') window.doLogin(); });
});

// ── Load users from MySQL (admin only) ──────────────────────────────────────
function _loadUsersFromDB() {
  if (!window.authToken) return;
  fetch(API_BASE + '/users.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'list', token: window.authToken })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.ok) {
      window._dbUsers = data.users; // cache for settings panel
      renderUsersSettings();
    }
  })
  .catch(function() { /* silent */ });
}

// ═══════════════════════════════════════════════════════════════
//  SECTIONS
// ═══════════════════════════════════════════════════════════════
window.openSectionsModal  = function() { renderSectionsList(); el('sections-modal').classList.add('open'); };
window.closeSectionsModal = function() { el('sections-modal').classList.remove('open'); };

function renderSectionsList() {
  var list = el('section-list'); if (!list) return;
  var sections = window.loadSections();
  if (!sections.length) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;text-align:center;padding:20px">No sections yet.</div>';
    return;
  }
  list.innerHTML = sections.map(function(sec) {
    var count    = window.enrolled.filter(function(s) { return s.sectionId === sec.id; }).length;
    var isActive = window.activeSection && window.activeSection.id === sec.id;
    return '<div class="section-item">'
      + '<div style="font-size:18px">' + (isActive ? '📌' : '📚') + '</div>'
      + '<div style="flex:1"><div class="section-item-name">' + sec.name
      + (isActive ? ' <span class="badge b-green" style="font-size:10px">Active</span>' : '') + '</div>'
      + '<div class="section-item-count">' + sec.subject + ' · ' + count + ' student' + (count !== 1 ? 's' : '') + '</div></div>'
      + '<button class="btn btn-ghost btn-sm" onclick="setActiveSection(\'' + sec.id + '\')" ' + (isActive ? 'disabled' : '') + '>Set Active</button>'
      + '<button class="btn btn-danger btn-sm" onclick="deleteSection(\'' + sec.id + '\')" ' + (isActive ? 'disabled' : '') + '>✕</button>'
      + '</div>';
  }).join('');
}

window.addSection = function() {
  var name    = (el('new-section-name')    || {}).value || '';
  var subject = (el('new-section-subject') || {}).value || '';
  if (!name) { window.toast('Enter a section name', 'orange'); return; }
  var sections = window.loadSections();
  if (sections.find(function(s) { return s.name.toLowerCase() === name.toLowerCase(); })) {
    window.toast('Section "' + name + '" already exists', 'orange'); return;
  }
  sections.push({ id: 'SEC-' + Date.now(), name: name.trim(), subject: subject.trim() || 'General', createdAt: new Date().toISOString() });
  window.saveSections(sections);
  el('new-section-name').value = ''; el('new-section-subject').value = '';
  renderSectionsList(); _populateSectionDropdowns();
  window.toast('Section ' + name + ' created', 'green');
};

window.deleteSection = function(id) {
  var sections = window.loadSections();
  var sec = sections.find(function(s) { return s.id === id; });
  if (!sec) return;
  var count = window.enrolled.filter(function(s) { return s.sectionId === id; }).length;
  if (count > 0 && !confirm('Section "' + sec.name + '" has ' + count + ' students. Delete anyway?')) return;
  sections = sections.filter(function(s) { return s.id !== id; });
  window.saveSections(sections);
  renderSectionsList(); _populateSectionDropdowns();
  window.toast('Section removed', 'orange');
};

window.setActiveSection = function(id) {
  var sections = window.loadSections();
  var sec = sections.find(function(s) { return s.id === id; });
  if (!sec) return;
  window.activeSection = sec;
  _applySectionUI();
  renderSectionsList();
  window.syncStudentsFromEnrolled();
  window.toast('Active section: ' + sec.name, 'green');
  window.log('📚 Active section: ' + sec.name + ' — ' + sec.subject, 'blue');
};

function _applySectionUI() {
  if (!window.activeSection) return;
  var sec = window.activeSection;
  window.setEl('sidebar-section-label', sec.name + ' · ' + sec.subject);
  window.setEl('active-section-chip',   '📚 ' + sec.name + ' – ' + sec.subject);
  window.setEl('dash-desc',             'Real-time analytics · ' + sec.name + ' · ' + sec.subject);
  window.setEl('analytics-desc',        'Semester performance · ' + sec.name + ' · ' + sec.subject);
}

function _populateSectionDropdowns() {
  // Load sections with guaranteed fallback
  var sections = [];
  try {
    sections = window.loadSections();
    // Double-check we actually got sections
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      // Force create default section if loadSections somehow failed
      sections = [{id: 'SEC-001', name: 'CS301-A', subject: 'Data Structures', createdAt: new Date().toISOString()}];
      localStorage.setItem('smartclass_sections', JSON.stringify(sections));
    }
  } catch (e) {
    // Ultimate fallback if something goes wrong
    sections = [{id: 'SEC-001', name: 'CS301-A', subject: 'Data Structures', createdAt: new Date().toISOString()}];
    try {
      localStorage.setItem('smartclass_sections', JSON.stringify(sections));
    } catch (lsErr) { /* localStorage might be disabled */ }
  }
  
  // Update filter dropdowns
  ['filter-section-enroll', 'filter-section-att'].forEach(function(id) {
    var sel = el(id); if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">All Sections</option>';
    sections.forEach(function(sec) { sel.innerHTML += '<option value="' + sec.id + '">' + sec.name + '</option>'; });
    if (prev) sel.value = prev;
  });
  
  // CRITICAL: Always refresh the enroll modal section dropdown
  var enrollSel = el('enroll-section');
  if (enrollSel) {
    var prevVal = enrollSel.value;
    // Build options HTML
    var optionsHtml = sections.map(function(sec) {
      return '<option value="' + sec.id + '">' + sec.name + '</option>';
    }).join('');
    enrollSel.innerHTML = optionsHtml;
    
    // Restore previous selection if it still exists
    if (prevVal && enrollSel.querySelector('option[value="' + prevVal + '"]')) {
      enrollSel.value = prevVal;
    } else if (window.activeSection && window.activeSection.id) {
      // If previous selection is gone but there's an active section, select it
      var activeOpt = enrollSel.querySelector('option[value="' + window.activeSection.id + '"]');
      if (activeOpt) enrollSel.value = window.activeSection.id;
    } else if (enrollSel.options.length > 0) {
      // Default to first option
      enrollSel.selectedIndex = 0;
    }
  }
  
  // Update settings section dropdown
  var cfgSel = el('cfg-section-select');
  if (cfgSel) {
    cfgSel.innerHTML = sections.map(function(sec) {
      return '<option value="' + sec.id + '"' + (window.activeSection && window.activeSection.id === sec.id ? ' selected' : '') + '>' + sec.name + '</option>';
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
//  ENROLLMENT GRID
// ═══════════════════════════════════════════════════════════════
window.renderEnrolledGrid = function() {
  var grid = el('enrolled-grid'); if (!grid) return;
  var q         = ((el('enroll-search') || {}).value || '').toLowerCase();
  var filterSec = ((el('filter-section-enroll') || {}).value || '');
  var filtered  = window.enrolled.filter(function(s) {
    var matchQ   = !q || s.name.toLowerCase().includes(q) || (s.sid || '').toLowerCase().includes(q);
    var matchSec = !filterSec || s.sectionId === filterSec;
    return matchQ && matchSec;
  });
  if (!filtered.length) {
    grid.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px;grid-column:1/-1;font-size:14px">'
      + (q || filterSec ? 'No students match your filter.'
        : 'No students enrolled yet.<br><button class="btn btn-primary btn-sm" style="margin-top:14px" onclick="openEnrollModal()">+ Enroll First Student</button>')
      + '</div>';
    return;
  }
  grid.innerHTML = filtered.map(function(s) {
    return '<div class="enroll-card' + (s.trained ? ' trained' : '') + '">'
      + '<button class="enroll-del" onclick="deleteEnrolled(\'' + s.id + '\')" title="Remove">✕</button>'
      + (s.photoDataUrl
        ? '<img src="' + s.photoDataUrl + '" class="enroll-avatar" alt="' + s.name + '">'
        : '<div class="enroll-avatar-placeholder">' + s.name.split(' ').map(function(p) { return p[0]; }).join('').slice(0, 2) + '</div>')
      + '<div class="enroll-name">' + s.name + '</div>'
      + '<div class="enroll-id">' + s.sid + '</div>'
      + '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + s.section + '</div>'
      + '<div class="enroll-status">'
      + (s.trained
        ? '<span class="badge b-green" style="font-size:10.5px">✓ ' + ((s.descriptors || []).length) + ' samples</span>'
        : '<span class="badge b-orange" style="font-size:10.5px">⚠ Not trained</span>')
      + '</div>'
      + '<button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;justify-content:center;font-size:11px" onclick="openEnrollModal(\'' + s.id + '\')">Re-enroll</button>'
      + '</div>';
  }).join('');
};

window.deleteEnrolled = function(id) {
  var s = window.enrolled.find(function(x) { return x.id === id; });
  if (!s || !confirm('Remove ' + s.name + '?')) return;
  window.enrolled = window.enrolled.filter(function(x) { return x.id !== id; });
  window.saveEnrolled(window.enrolled);
  if (typeof window.buildFaceMatcher === 'function') window.buildFaceMatcher();
  window.renderEnrolledGrid(); window.updateEnrollStats(); window.syncStudentsFromEnrolled();
  window.toast('Removed ' + s.name, 'orange');
};

window.clearAllEnrolled = function() {
  if (!window.enrolled.length) return;
  if (!confirm('Remove all ' + window.enrolled.length + ' enrolled students?')) return;
  window.enrolled = []; window.saveEnrolled(window.enrolled);
  if (typeof window.buildFaceMatcher === 'function') window.buildFaceMatcher();
  window.renderEnrolledGrid(); window.updateEnrollStats(); window.syncStudentsFromEnrolled();
  window.toast('All enrollments cleared', 'red');
};

window.updateEnrollStats = function() {
  var trained = window.enrolled.filter(function(s) { return s.trained; }).length;
  window.setEl('enroll-stat-count',    window.enrolled.length);
  window.setEl('enroll-stat-trained',  trained);
  window.setEl('enrolled-count-badge', window.enrolled.length);
  window.setEl('ftab-enrolled-count',  window.enrolled.length);
  window.setEl('settings-enrolled-count', window.enrolled.length);
};

// ═══════════════════════════════════════════════════════════════
//  SYNC STUDENTS
// ═══════════════════════════════════════════════════════════════
window.syncStudentsFromEnrolled = function() {
  var filterSec = ((el('filter-section-att') || {}).value || '');
  var existing  = new Map(window.state.students.map(function(s) { return [s.id, s]; }));
  var source    = filterSec
    ? window.enrolled.filter(function(s) { return s.sectionId === filterSec; })
    : window.enrolled;
  window.state.students = source.map(function(e) {
    var prev = existing.get(e.id);
    return {
      id: e.id, name: e.name, sid: e.sid, sectionId: e.sectionId, section: e.section,
      initials: e.name.split(' ').map(function(p) { return p[0]; }).join('').slice(0, 2),
      status:     prev ? prev.status     : 'pending',
      emotion:    prev ? prev.emotion    : null,
      confidence: prev ? prev.confidence : null,
      engagement: 0
    };
  });
  window.renderTable(); window.updateStats(); window.updateEnrollStats();
  window.setEl('stat-total',   window.state.students.length);
  window.setEl('stat-total-s', window.state.students.length);
  window.setEl('att-table-sub', window.state.students.length + ' students');
  var banner = el('att-no-students-banner');
  if (banner) banner.style.display = window.state.students.length === 0 ? '' : 'none';
  if (typeof window.renderGestureRanking    === 'function') window.renderGestureRanking();
  if (typeof window._populateGestStudentSelect === 'function') window._populateGestStudentSelect();
};

// ═══════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════
var PAGE_TITLES = { dashboard:'Dashboard',enrollment:'Face Enrollment',attendance:'Attendance',gesture:'Gesture Detection',sentiment:'Sentiment Analysis',summarizer:'Lesson Summarizer',analytics:'Analytics Report',settings:'Settings' };
var PAGE_SUBS   = { dashboard:'Overview',enrollment:'Register student faces',attendance:"Today's Session",gesture:'Participation Tracking',sentiment:'Emotion Monitoring',summarizer:'AI Lesson Summary',analytics:'Semester Overview',settings:'System Configuration' };

window.navigate = function(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item[data-page]').forEach(function(n) { n.classList.remove('active'); });
  document.querySelectorAll('.ftab[data-page]').forEach(function(t) { t.classList.remove('active'); });
  var page = el('page-' + id); if (page) page.classList.add('active');
  var nav  = document.querySelector('.nav-item[data-page="' + id + '"]'); if (nav) nav.classList.add('active');
  var tab  = document.querySelector('.ftab[data-page="' + id + '"]');     if (tab) tab.classList.add('active');
  window.setEl('tb-page', PAGE_TITLES[id] || id);
  window.setEl('tb-sub',  PAGE_SUBS[id]   || '');
  if (id === 'dashboard')  { if (typeof initDashboardCharts === 'function') initDashboardCharts(); }
  if (id === 'analytics')  { if (typeof initAnalyticsCharts === 'function') initAnalyticsCharts(); renderUsersSettings(); }
  if (id === 'sentiment')  { if (typeof renderEmotionTiles  === 'function') renderEmotionTiles();  if (typeof initSentimentChart === 'function') initSentimentChart(); }
  if (id === 'enrollment') { window.renderEnrolledGrid(); window.updateEnrollStats(); }
  if (id === 'summarizer') { if (typeof renderSumHistory === 'function') renderSumHistory(); }
  if (id === 'settings')   { _populateSectionDropdowns(); renderUsersSettings(); if (typeof window.loadTeacherExtras === 'function') window.loadTeacherExtras(); }
};

// ═══════════════════════════════════════════════════════════════
//  CLOCK & SESSION
// ═══════════════════════════════════════════════════════════════
function tickClock() { window.setEl('clock', new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' })); }
setInterval(tickClock, 1000); tickClock();

function updateSessionTimer() {
  if (!window.state.sessionStart) return;
  var s = Math.floor((Date.now() - window.state.sessionStart) / 1000);
  window.setEl('sb-timer', [Math.floor(s/3600), Math.floor((s%3600)/60), s%60].map(function(n) { return String(n).padStart(2, '0'); }).join(':'));
}

window.toggleSession = function() {
  window.state.sessionActive = !window.state.sessionActive;
  var btn = el('session-btn'), banner = el('session-banner');
  if (window.state.sessionActive) {
    window.state.sessionStart = Date.now();
    window.state.engSamples = []; window.state.sentLog = [];
    window.state.gestureTotal = { raise:0, thumbup:0, point:0, wave:0 };
    window.state.gestureByStudent = {};
    window.state.sessionTimer = setInterval(updateSessionTimer, 1000);
    if (btn) { btn.classList.add('running'); btn.innerHTML = '⏹ End Session'; }
    if (banner) banner.classList.add('active');
    window.log('▶ Session started', 'green');
    startEngagementTick();
    ['raise','thumbup','point','wave'].forEach(function(k) { window.setEl('g-' + k, '0'); });
    window.setEl('stat-gestures', '0');
  } else {
    clearInterval(window.state.sessionTimer);
    if (btn) { btn.classList.remove('running'); btn.innerHTML = '▶ Start Session'; }
    if (banner) banner.classList.remove('active');
    _saveCurrentSession();
    window.log('⏹ Session ended — data saved', 'orange');
    stopEngagementTick();
    var ap = el('page-analytics');
    if (ap && ap.classList.contains('active') && typeof initAnalyticsCharts === 'function') initAnalyticsCharts();
  }
};

function startEngagementTick() {
  window.state.engInterval = setInterval(function() {
    var total   = window.state.students.length;
    var present = window.state.students.filter(function(s) { return s.status === 'present' || s.status === 'late'; }).length;
    var base    = total > 0 ? Math.round(present / total * 100) : 0;
    window.state.engScore = Math.min(99, Math.max(0, base + (Math.random() - .5) * 8));
    var r = Math.round(window.state.engScore);
    window.state.engSamples.push(r);
    window.setEl('stat-engagement', r + '%');
    var ch = window.state.chartInst.engTrend;
    if (ch) {
      ch.data.datasets[0].data.push(r);
      ch.data.labels.push(new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }));
      if (ch.data.labels.length > 14) { ch.data.labels.shift(); ch.data.datasets[0].data.shift(); }
      ch.update('none');
    }
  }, 4500);
}
function stopEngagementTick() { clearInterval(window.state.engInterval); }

function _saveCurrentSession() {
  if (!window.state.sessionStart) return;
  var students = window.state.students, total = students.length;
  var present  = students.filter(function(s) { return s.status === 'present'; }).length;
  var late     = students.filter(function(s) { return s.status === 'late'; }).length;
  var emotTally = { Happy:0, Neutral:0, Confused:0, Bored:0, Stressed:0 };
  students.forEach(function(s) { if (s.emotion && emotTally[s.emotion] !== undefined) emotTally[s.emotion]++; });
  var session = {
    id: 'SES-' + Date.now(), date: new Date().toISOString(),
    label: new Date().toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric' }),
    section: window.activeSection ? window.activeSection.name : '',
    totalStudents: total, present: present, late: late, absent: total - present - late,
    attPct: total ? Math.round((present + late) / total * 100) : 0,
    engAvg: window.state.engSamples.length
      ? Math.round(window.state.engSamples.reduce(function(a,b) { return a+b; }, 0) / window.state.engSamples.length)
      : 0,
    engSamples: window.state.engSamples.slice(), emotTally: emotTally,
    gestures: Object.assign({}, window.state.gestureTotal),
    sentLog: window.state.sentLog.slice(), durationMs: Date.now() - window.state.sessionStart
  };
  var sessions = window.loadSessions(); sessions.push(session);
  if (sessions.length > 20) sessions = sessions.slice(sessions.length - 20);
  window.saveSessions(sessions);
  window.setEl('analytics-sessions', sessions.length);
  // Sync attendance records to MySQL for student portal
  if (window.syncAttendanceToMySQL) window.syncAttendanceToMySQL();
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════
window.saveSettings = function() {
  var cfg = {
    code:       el('cfg-code')       ? el('cfg-code').value       : '',
    subject:    el('cfg-subject')    ? el('cfg-subject').value    : '',
    instructor: el('cfg-instructor') ? el('cfg-instructor').value : '',
    schedule:   el('cfg-schedule')   ? el('cfg-schedule').value   : '',
    room:       el('cfg-room')       ? el('cfg-room').value       : ''
  };
  window.saveSettingsData(cfg);
  window.toast('Settings saved', 'green');
};

function renderUsersSettings() {
  var list = el('users-list'); if (!list) return;
  if (!window.currentUser || window.currentUser.role !== 'admin') {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:10px">Admin access required.</div>';
    return;
  }

  // Use DB users if available, fall back to local
  var users = window._dbUsers || [
    { id:'U1', username:'admin', role:'admin',     full_name:'Administrator',     avatar:'🛡' },
    { id:'U2', username:'prof',  role:'professor', full_name:'Prof. Maria Santos', avatar:'👩‍🏫' },
    { id:'U3', username:'prof2', role:'professor', full_name:'Prof. Juan Cruz',    avatar:'👨‍🏫' }
  ];

  list.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">'
    + users.map(function(u) {
      var name = u.full_name || u.name || u.username;
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:8px">'
        + '<div style="font-size:20px">' + (u.avatar || '👤') + '</div>'
        + '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + name + '</div>'
        + '<div style="font-size:11px;color:var(--text-3);font-family:var(--mono)">@' + u.username + '</div></div>'
        + '<span class="role-badge ' + (u.role === 'admin' ? 'admin' : 'prof') + '">' + u.role + '</span>'
        + (window.authToken ? '<button class="btn btn-danger btn-sm" style="margin-left:6px" onclick="deleteUserDB(' + u.id + ')">✕</button>' : '')
        + '</div>';
    }).join('')
    + '</div>'
    + '<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-2)">'
    + '<div style="font-size:12px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Add User</div>'
    + '<div class="g2" style="gap:8px;margin-bottom:8px"><div class="field" style="margin:0"><input id="new-u-name" placeholder="Full name" style="font-size:13px"></div><div class="field" style="margin:0"><input id="new-u-user" placeholder="Username" style="font-size:13px"></div></div>'
    + '<div class="g2" style="gap:8px;margin-bottom:8px"><div class="field" style="margin:0"><input id="new-u-pass" placeholder="Password" type="password" style="font-size:13px"></div>'
    + '<div class="field" style="margin:0"><select id="new-u-role" style="font-size:13px;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--bg);font-family:var(--font)"><option value="professor">Professor</option><option value="admin">Admin</option></select></div></div>'
    + '<button class="btn btn-primary btn-sm" style="width:100%;justify-content:center" onclick="addUserDB()">+ Add User</button>'
    + '</div>';
}

window.addUserDB = function() {
  var name  = (el('new-u-name') || {}).value || '';
  var uname = (el('new-u-user') || {}).value || '';
  var pass  = (el('new-u-pass') || {}).value || '';
  var role  = (el('new-u-role') || {}).value || 'professor';
  if (!name || !uname || !pass) { window.toast('Fill all fields', 'orange'); return; }

  if (!window.authToken) {
    window.toast('API not connected — user not saved to database', 'orange'); return;
  }

  fetch(API_BASE + '/users.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action:'add', token: window.authToken, full_name: name, username: uname, password: pass, role: role })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (!data.ok) { window.toast(data.error || 'Error adding user', 'red'); return; }
    window.toast('User added: ' + name, 'green');
    _loadUsersFromDB();
  })
  .catch(function() { window.toast('API unreachable', 'red'); });
};

window.deleteUserDB = function(uid) {
  if (!confirm('Delete this user?')) return;
  fetch(API_BASE + '/users.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action:'delete', token: window.authToken, user_id: uid })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    window.toast(data.ok ? 'User deleted' : (data.error || 'Error'), data.ok ? 'orange' : 'red');
    if (data.ok) _loadUsersFromDB();
  });
};

// ═══════════════════════════════════════════════════════════════
//  SLIDERS
// ═══════════════════════════════════════════════════════════════
function initSliders() {
  document.querySelectorAll('input[type=range][data-out]').forEach(function(r) {
    var out = el(r.dataset.out);
    if (out) {
      out.textContent = r.value + '%';
      r.addEventListener('input', function() {
        out.textContent = r.value + '%';
        if (r.id === 'threshold-face' && typeof window.buildFaceMatcher === 'function') window.buildFaceMatcher();
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  initSliders();
  _populateSectionDropdowns();

  // Wire nav
  document.querySelectorAll('.nav-item[data-page]').forEach(function(item) {
    item.addEventListener('click', function() { window.navigate(item.dataset.page); });
  });
  document.querySelectorAll('.ftab[data-page]').forEach(function(tab) {
    tab.addEventListener('click', function() { window.navigate(tab.dataset.page); });
  });

  // Wire buttons
  var sbtn = el('session-btn');     if (sbtn) sbtn.addEventListener('click', window.toggleSession);
  var bsf  = el('btn-start-face'); if (bsf)  bsf.addEventListener('click', function() { window.startFaceCam(); });
  var bstf = el('btn-stop-face');  if (bstf) bstf.addEventListener('click', function() { window.stopFaceCam(); });
  var bsg  = el('btn-start-gest'); if (bsg)  bsg.addEventListener('click', function() { window.startGestCam(); });
  var bstg = el('btn-stop-gest');  if (bstg) bstg.addEventListener('click', function() { window.stopGestCam(); });
  var ba   = el('btn-analyze');    if (ba)   ba.addEventListener('click', window.analyzeSentiment);
  var si   = el('sent-input');     if (si)   si.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.analyzeSentiment(); } });
  var as   = el('att-search');     if (as)   as.addEventListener('input', function() { window.renderTable(); });

  // Auto-restore session on page refresh
  var saved = window.loadAuth();
  if (saved && saved.user) {
    if (!saved.token) {
      // Offline/local-fallback session — restore directly without API call
      window.authToken   = null;
      window.currentUser = saved.user;
      _onLoginSuccess(saved.user);
    } else {
      // Real MySQL session — verify the token is still valid
      fetch(API_BASE + '/auth.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', token: saved.token })
      })
      .then(function(res) {
        var ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error('not json');
        return res.json();
      })
      .then(function(data) {
        if (data.ok) {
          window.authToken   = saved.token;
          window.currentUser = data.user;
          _onLoginSuccess(data.user);
        } else {
          // Token expired — clear and show login
          window.clearAuth();
        }
      })
      .catch(function() {
        // API offline — restore from saved user without a live token
        window.authToken   = null;
        window.currentUser = saved.user;
        _onLoginSuccess(saved.user);
      });
    }
  }

  window.log('🚀 SmartClass v2.1 initialized', 'blue');
});

/* ═══════════════════════════════════════════════════════════════════════════
   TEACHER EXTRAS — Announcements, Notes Sharing, Feedback Inbox
   (Extends the Settings page with student-portal management tools)
═══════════════════════════════════════════════════════════════════════════ */

/** Called from the Settings page to load and render teacher extras panels */
window.loadTeacherExtras = function() {
  _renderAnnouncementPanel();
  _renderFeedbackInbox();
};

// ── Announcement Management ───────────────────────────────────────────────────
function _renderAnnouncementPanel() {
  var panel = el('teacher-ann-panel'); if (!panel) return;

  // Show the post form immediately — don't wait for the fetch
  var postForm = '<div style="padding-top:14px;border-top:1px solid var(--border-2);margin-top:4px">'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    + '<input id="ann-title" placeholder="Announcement title" class="search-input" style="width:100%;box-sizing:border-box">'
    + '<textarea id="ann-body" placeholder="Message body…" rows="3" style="padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:13px;background:var(--bg);color:var(--text);resize:vertical;outline:none;width:100%;box-sizing:border-box"></textarea>'
    + '<select id="ann-priority" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);background:var(--bg)">'
    + '<option value="normal">📢 Normal</option><option value="important">📌 Important</option><option value="urgent">🚨 Urgent</option></select>'
    + '<button class="btn btn-primary btn-sm" style="justify-content:center" onclick="postAnnouncement()">📢 Post Announcement</button>'
    + '</div></div>';

  if (!window.authToken) {
    panel.innerHTML = '<p style="color:var(--text-3);font-size:13px;margin-bottom:12px">⚠️ Not connected to MySQL — announcements won\'t be saved to the database.</p>' + postForm;
    return;
  }

  panel.innerHTML = '<p style="color:var(--text-3);font-size:12px">Loading announcements…</p>';

  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action:'get_announcements', token: window.authToken })
  })
  .then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('teacher_extras.php returned HTTP ' + r.status + ' (not JSON). Make sure the file is named teacher_extras.php inside your api/ folder.');
    }
    return r.json();
  })
  .then(function(data) {
    if (!data.ok) {
      panel.innerHTML = '<p style="color:var(--red);font-size:13px;margin-bottom:12px">⚠️ ' + (data.error || 'API error') + '</p>' + postForm;
      return;
    }
    var icons = {urgent:'🚨',important:'📌',normal:'📢'};
    var items = (data.announcements || []).map(function(a) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border-radius:8px;margin-bottom:8px">'
        + '<span style="font-size:18px">' + (icons[a.priority]||'📢') + '</span>'
        + '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + a.title + '</div>'
        + '<div style="font-size:11px;color:var(--text-3)">' + a.priority + ' · ' + new Date(a.created_at).toLocaleDateString('en-PH') + '</div></div>'
        + '<button class="btn btn-danger btn-sm" onclick="deleteAnnouncement(' + a.id + ')">✕</button></div>';
    }).join('') || '<p style="color:var(--text-3);font-size:13px;margin-bottom:12px">No active announcements yet.</p>';

    panel.innerHTML = items + postForm;
  })
  .catch(function(err) {
    panel.innerHTML = '<div style="padding:12px;background:var(--red-dim);border:1px solid rgba(201,42,42,.2);border-radius:8px;margin-bottom:12px">'
      + '<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">⚠️ Could not load announcements</div>'
      + '<div style="font-size:12px;color:var(--text-2)">' + (err.message || 'API unreachable') + '</div>'
      + '<div style="font-size:11px;color:var(--text-3);margin-top:6px">Check: XAMPP is running · teacher_extras.php exists in api/ folder · No PHP errors</div>'
      + '</div>' + postForm;
  });
}

window.postAnnouncement = function() {
  var title = (el('ann-title')||{}).value || '';
  var body  = (el('ann-body')||{}).value  || '';
  var pri   = (el('ann-priority')||{}).value || 'normal';
  var sec   = window.activeSection ? window.activeSection.id : null;
  if (!title || !body) { window.toast('Fill in title and message', 'orange'); return; }
  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action:'post_announcement', token:window.authToken, title:title, body:body, priority:pri, section_id:sec })
  }).then(function(r){return r.json();}).then(function(d) {
    if (d.ok) { window.toast('✅ Announcement posted!', 'green'); _renderAnnouncementPanel(); }
    else       window.toast(d.error||'Error', 'red');
  }).catch(function(){ window.toast('API error', 'red'); });
};

window.deleteAnnouncement = function(id) {
  if (!confirm('Delete this announcement?')) return;
  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action:'delete_announcement', token:window.authToken, id:id })
  }).then(function(r){return r.json();}).then(function(d) {
    if (d.ok) { window.toast('Removed', 'orange'); _renderAnnouncementPanel(); }
  }).catch(function(){});
};

// ── Feedback Inbox ────────────────────────────────────────────────────────────
function _renderFeedbackInbox() {
  var inbox = el('teacher-feedback-inbox'); if (!inbox) return;

  if (!window.authToken) {
    inbox.innerHTML = '<p style="color:var(--text-3);font-size:13px">⚠️ Not connected to MySQL — log in with XAMPP running to see student feedback.</p>';
    return;
  }

  inbox.innerHTML = '<p style="color:var(--text-3);font-size:12px">Loading feedback…</p>';

  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ action:'get_feedback', token:window.authToken })
  })
  .then(function(r) {
    var ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('teacher_extras.php returned HTTP ' + r.status + ' (not JSON). Check the file exists and has no PHP errors.');
    }
    return r.json();
  })
  .then(function(data) {
    if (!data.ok) {
      inbox.innerHTML = '<p style="color:var(--red);font-size:13px">⚠️ ' + (data.error || 'Could not load feedback') + '</p>';
      return;
    }
    var moodEmoji = {great:'😁',good:'😊',okay:'😐',confused:'😕',lost:'😰'};
    var moodColor = {great:'var(--green)',good:'var(--brand)',okay:'var(--text-3)',confused:'var(--orange)',lost:'var(--red)'};
    var mc = data.mood_counts || {};
    var hasAny = Object.values(mc).some(function(v){ return v > 0; });

    var moodBar = hasAny
      ? Object.keys(mc).map(function(m) {
          return '<span style="margin-right:10px">' + (moodEmoji[m]||'') + ' <strong>' + mc[m] + '</strong> ' + m + '</span>';
        }).join('')
      : '<span style="color:var(--text-3)">No mood data yet</span>';

    var rows = (data.feedback||[]).slice(0,20).map(function(f) {
      var d = new Date(f.created_at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      return '<div style="display:flex;gap:12px;padding:10px;background:var(--bg);border-radius:8px;margin-bottom:8px;align-items:flex-start">'
        + '<div style="font-size:22px;flex-shrink:0">' + (moodEmoji[f.mood]||'😐') + '</div>'
        + '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:' + (moodColor[f.mood]||'var(--text)') + '">'
        + f.student_name + '</div>'
        + (f.message ? '<div style="font-size:13px;color:var(--text-2);margin-top:3px">' + f.message + '</div>' : '')
        + '<div style="font-size:11px;color:var(--text-3);margin-top:4px">' + d + '</div></div></div>';
    }).join('') || '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No student feedback submitted yet.</div>';

    inbox.innerHTML = '<div style="margin-bottom:12px;padding:10px;background:var(--bg-3);border-radius:8px;font-size:13px">' + moodBar + '</div>' + rows;
  })
  .catch(function(err) {
    inbox.innerHTML = '<div style="padding:12px;background:var(--red-dim);border:1px solid rgba(201,42,42,.2);border-radius:8px">'
      + '<div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:4px">⚠️ Could not load feedback</div>'
      + '<div style="font-size:12px;color:var(--text-2)">' + (err.message || 'API unreachable') + '</div>'
      + '<div style="font-size:11px;color:var(--text-3);margin-top:6px">Check: XAMPP is running · teacher_extras.php exists in api/ folder</div>'
      + '</div>';
  });
}

// ── Share Note (called from summarizer result) ────────────────────────────────
window.shareNoteWithStudents = function(title, summary, keyPoints, keyTerms, wordCount) {
  if (!window.authToken) { window.toast('Login via MySQL to share notes with students', 'orange'); return; }
  var sec = window.activeSection ? window.activeSection.id : null;
  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      action:'share_note', token:window.authToken,
      title:title, summary:summary, key_points:keyPoints||[], key_terms:keyTerms||[],
      word_count:wordCount||0, section_id:sec
    })
  }).then(function(r){return r.json();}).then(function(d) {
    if (d.ok) window.toast('📚 Lesson note shared with students!', 'green', 4000);
    else       window.toast(d.error||'Could not share note', 'red');
  }).catch(function(){ window.toast('API unavailable', 'orange'); });
};

// ── Sync attendance to MySQL when teacher ends session ────────────────────────
window.syncAttendanceToMySQL = function() {
  if (!window.authToken || !window.state.students.length) return;
  var students = window.state.students.map(function(s) {
    return {
      sid:          s.sid  || '',
      name:         s.name || '',
      section_id:   s.sectionId  || '',
      section_name: s.section    || '',
      status:       s.status     || 'pending',
      emotion:      s.emotion    || null,
      confidence:   s.confidence || null
    };
  });
  var label = window.activeSection
    ? (window.activeSection.name + ' · ' + new Date().toLocaleDateString('en-PH'))
    : new Date().toLocaleDateString('en-PH');

  fetch(API_BASE + '/teacher_extras.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      action:'sync_attendance', token:window.authToken,
      students:students, session_date:new Date().toISOString().split('T')[0], session_label:label
    })
  }).then(function(r){return r.json();}).then(function(d) {
    if (d.ok) window.log('🔄 Attendance synced to MySQL (' + d.synced + ' students)', 'green');
  }).catch(function(){});
};
