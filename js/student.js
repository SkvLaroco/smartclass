/**
 * js/student.js — SmartClass Student Portal
 *
 * Completely isolated from the teacher/admin portal.
 * Rendered when role === 'student' after login.
 * Students can NEVER access teacher routes, camera controls,
 * enrollment tools, analytics, or admin settings.
 *
 * Pages:
 *   🏠  Home          — dashboard stats, announcements, latest note
 *   📅  Attendance    — personal record, rate, session history
 *   📚  Lesson Notes  — teacher-shared summaries + PDF download
 *   📝  My Summarizer — student uploads their own PDF/text to summarize
 *   💬  Feedback      — mood + message to teacher (optional anon)
 *   👤  My Profile    — photo, student ID, change password
 */
'use strict';

/* ── State ─────────────────────────────────────────────────────────────────── */
var SP = {
  page        : 'home',
  user        : null,
  enrolled    : null,   // matched face-enrollment record from localStorage
  stats       : null,
  announcements: [],
  latestNote  : null,
  notes       : [],
  attendance  : { records:[], summary:null },
  clockTimer  : null,
};

// API URL is resolved lazily so it is always correct even if app.js loads last
var JSPDF_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
var PDFJS_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER= 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
function _studentApiUrl() {
  // API_BASE is a var declared at top-level in app.js — available as window property in browsers
  var base = (typeof API_BASE !== 'undefined' ? API_BASE : null)
          || (typeof window.API_BASE !== 'undefined' ? window.API_BASE : null)
          || '/smartclass/api';
  return base + '/student.php';
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════════════════ */
window.initStudentPortal = function(user) {
  try {
    SP.user = user;
    SP.stats = null; SP.announcements = []; SP.latestNote = null;
    SP.attendance = { records:[], summary:null }; SP.notes = [];

    // Match enrolled face record from localStorage (for profile photo)
    var allEnrolled = (window.loadEnrolled ? window.loadEnrolled() : []);
    SP.enrolled = allEnrolled.find(function(e) {
      return e.sid === user.student_sid || e.name === user.name;
    }) || null;

    // Build the shell HTML immediately — this is what renders the nav/hero/tabs
    _buildShell();
    _tick();

    // Show home page right away (with empty stats while API loads)
    _navigate('home');

    // Then fetch real data in the background and refresh home
    _apiCall('dashboard', {}, function(err, data) {
      if (!err && data && data.ok) {
        SP.stats         = data.stats         || null;
        SP.announcements = data.announcements || [];
        SP.latestNote    = data.latest_note   || null;
        // Re-render home with real data only if still on home page
        if (SP.page === 'home') _pageHome();
      }
    });
  } catch(e) {
    console.error('[student portal] init error:', e);
    var portal = document.getElementById('student-portal');
    if (portal) portal.innerHTML = '<div style="padding:40px;text-align:center;color:red">Portal error: ' + e.message + '</div>';
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   SHELL — fixed nav + hero + tabs
═══════════════════════════════════════════════════════════════════════════ */
function _buildShell() {
  var portal = document.getElementById('student-portal');
  if (!portal) return;

  var user    = SP.user;
  var section = _findSection(user.section_id);
  var hr      = new Date().getHours();
  var greet   = hr < 12 ? '🌅 Good morning' : hr < 17 ? '☀️ Good afternoon' : '🌙 Good evening';
  var fname   = (user.name || '').split(' ')[0] || user.name;

  portal.innerHTML = [
    '<!-- NAV -->',
    '<nav class="sp-nav">',
    '  <div class="sp-brand">🎓 SmartClass <span class="sp-brand-tag">Student</span></div>',
    '  <div class="sp-nav-right">',
    '    <div class="sp-user-chip">',
    '      <span class="sp-user-ava">' + _esc(user.avatar || '👩‍🎓') + '</span>',
    '      <div>',
    '        <div class="sp-user-name">' + _esc(user.name) + '</div>',
    '        <div class="sp-user-meta">ID: ' + _esc(user.student_sid || '—') + ' &nbsp;·&nbsp; ' + _esc(section.name || '—') + '</div>',
    '      </div>',
    '    </div>',
    '    <button class="sp-btn-logout" onclick="doLogout()">🚪 Sign Out</button>',
    '  </div>',
    '</nav>',

    '<!-- HERO -->',
    '<div class="sp-hero">',
    '  <div>',
    '    <div class="sp-hero-greet">' + greet + ', ' + _esc(fname) + '! 👋</div>',
    '    <div class="sp-hero-sub" id="sp-hero-sub">' + _esc(section.name || '') + (section.subject ? ' &nbsp;·&nbsp; ' + _esc(section.subject) : '') + '</div>',
    '  </div>',
    '  <div class="sp-hero-clock" id="sp-clock"></div>',
    '</div>',

    '<!-- TABS -->',
    '<div class="sp-tabbar" id="sp-tabbar">',
    '  <button class="sp-tab active" data-p="home"       onclick="spNav(\'home\')">🏠 Home</button>',
    '  <button class="sp-tab"        data-p="attendance" onclick="spNav(\'attendance\')">📅 Attendance</button>',
    '  <button class="sp-tab"        data-p="notes"      onclick="spNav(\'notes\')">📚 Lesson Notes</button>',
    '  <button class="sp-tab"        data-p="summarizer" onclick="spNav(\'summarizer\')">📝 Summarizer</button>',
    '  <button class="sp-tab"        data-p="feedback"   onclick="spNav(\'feedback\')">💬 Feedback</button>',
    '  <button class="sp-tab"        data-p="profile"    onclick="spNav(\'profile\')">👤 Profile</button>',
    '</div>',

    '<!-- CONTENT -->',
    '<div class="sp-content" id="sp-content">',
    '  <div class="sp-loading"><div class="sp-spin"></div><span>Loading…</span></div>',
    '</div>',
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════════════════════════════════ */
window.spNav = function(page) {
  SP.page = page;
  document.querySelectorAll('.sp-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.p === page);
  });
  switch (page) {
    case 'home':       _pageHome();       break;
    case 'attendance': _pageAttendance(); break;
    case 'notes':      _pageNotes();      break;
    case 'summarizer': _pageSummarizer(); break;
    case 'feedback':   _pageFeedback();   break;
    case 'profile':    _pageProfile();    break;
  }
};

var _navigate = window.spNav;

function _html(h) {
  var c = document.getElementById('sp-content');
  if (c) c.innerHTML = h;
}
function _loading() {
  _html('<div class="sp-loading"><div class="sp-spin"></div><span>Loading…</span></div>');
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOME
═══════════════════════════════════════════════════════════════════════════ */
function _pageHome() {
  var s   = SP.stats || {};
  var ann = SP.announcements || [];
  var ln  = SP.latestNote || null;
  // Ensure all expected keys have safe defaults
  s.sessions_total   = s.sessions_total   || 0;
  s.sessions_present = s.sessions_present || 0;
  s.sessions_late    = s.sessions_late    || 0;
  s.sessions_absent  = s.sessions_absent  || 0;
  s.note_count       = s.note_count       || 0;
  s.feedback_count   = s.feedback_count   || 0;

  var attPctVal = (s && s.attendance_pct != null) ? s.attendance_pct : null;
  var pct   = attPctVal != null ? attPctVal + '%' : '—';
  var pctC  = attPctVal == null ? '#8d99bb' : attPctVal >= 75 ? '#2f9e44' : attPctVal >= 50 ? '#e8590c' : '#c92a2a';
  var warn  = attPctVal != null && attPctVal < 75
    ? '<div class="sp-alert sp-alert-warn">⚠️ Your attendance is below 75%. Please attend regularly to avoid academic issues.</div>'
    : '';

  var statCards = [
    _statCard('📅', pct,                       'Attendance Rate',    s.sessions_total + ' sessions', pctC),
    _statCard('✅', s.sessions_present || 0,    'Times Present',      (s.sessions_late||0) + ' late · ' + (s.sessions_absent||0) + ' absent', '#2f9e44'),
    _statCard('📚', s.note_count || 0,          'Lesson Notes',       'Available to download', '#3b5bdb'),
    _statCard('💬', s.feedback_count || 0,      'Feedback Sent',      'Click to send more →', '#6741d9', "spNav('feedback')"),
  ].join('');

  var annHtml = ann.length ? ann.map(function(a) {
    var cfg = {
      urgent   :{ icon:'🚨', bg:'#fff5f5', border:'#ffc9c9', tc:'#c92a2a' },
      important:{ icon:'📌', bg:'#fff8e8', border:'#ffd8a8', tc:'#e8590c' },
      normal   :{ icon:'📢', bg:'#f0f4ff', border:'#c5d0ff', tc:'#3b5bdb' },
    }[a.priority] || { icon:'📢', bg:'#f0f4ff', border:'#c5d0ff', tc:'#3b5bdb' };
    var d = new Date(a.created_at).toLocaleDateString('en-PH',{month:'short',day:'numeric'});
    return '<div class="sp-ann" style="background:' + cfg.bg + ';border-color:' + cfg.border + '">'
      + '<div style="font-size:20px;flex-shrink:0">' + cfg.icon + '</div>'
      + '<div style="flex:1"><div style="font-weight:700;color:' + cfg.tc + ';font-size:14px">' + _esc(a.title) + '</div>'
      + '<div style="font-size:13px;color:#4a5578;margin-top:4px;line-height:1.6">' + _esc(a.body) + '</div>'
      + '<div style="font-size:11px;color:#8d99bb;margin-top:6px">' + _esc(d) + '</div></div></div>';
  }).join('') : '<div class="sp-empty">No announcements from your teacher yet.</div>';

  var noteHtml = ln
    ? '<div class="sp-note-card" onclick="spNav(\'notes\')" style="cursor:pointer">'
      + '<div style="font-weight:800;font-size:14px;color:#1a1a2e;margin-bottom:6px">📄 ' + _esc(ln.title) + '</div>'
      + '<div style="font-size:13px;color:#4a5578;line-height:1.65">' + _esc((ln.summary||'').slice(0,200)) + '…</div>'
      + '<div style="margin-top:10px;font-size:12px;font-weight:700;color:#3b5bdb">View all lesson notes →</div>'
      + '</div>'
    : '<div class="sp-empty">No lesson notes shared yet. Your teacher will post them after class.</div>';

  _html(warn
    + '<div class="sp-stat-grid">' + statCards + '</div>'
    + '<div class="sp-sh" style="margin-top:24px">📢 Announcements</div>'
    + '<div class="sp-ann-list">' + annHtml + '</div>'
    + '<div class="sp-sh" style="margin-top:24px">📄 Latest Lesson Note</div>'
    + noteHtml
  );
}

function _statCard(icon, val, label, sub, color, onclick) {
  var click = onclick ? ' onclick="' + onclick + '" style="cursor:pointer"' : '';
  return '<div class="sp-card sp-stat"' + click + '>'
    + '<div style="font-size:24px">' + icon + '</div>'
    + '<div style="font-size:26px;font-weight:800;color:' + (color||'#3b5bdb') + ';line-height:1.1;margin:6px 0 2px">' + val + '</div>'
    + '<div style="font-size:12px;font-weight:700;color:#1a1a2e">' + label + '</div>'
    + '<div style="font-size:11px;color:#8d99bb;margin-top:2px">' + sub + '</div>'
    + '</div>';
}

/* ═══════════════════════════════════════════════════════════════════════════
   ATTENDANCE
═══════════════════════════════════════════════════════════════════════════ */
function _pageAttendance() {
  _loading();
  _apiCall('get_attendance', {}, function(err, data) {
    if (!err && data && data.ok) {
      SP.attendance = { records: data.records, summary: data.summary };
    }
    var records = SP.attendance.records || [];
    var sum     = SP.attendance.summary || {};
    var pct     = sum.pct != null ? sum.pct + '%' : '—';
    var pctC    = (sum.pct||0) >= 75 ? '#2f9e44' : (sum.pct||0) >= 50 ? '#e8590c' : '#c92a2a';
    var bar     = sum.pct ? sum.pct + '%' : '0%';

    var warn = (sum.pct != null && sum.pct < 75)
      ? '<div class="sp-alert sp-alert-warn">⚠️ Attendance below 75%. You may have academic consequences. Please talk to your professor.</div>'
      : (sum.pct >= 90 ? '<div class="sp-alert sp-alert-ok">✅ Excellent attendance! Keep it up.</div>' : '');

    var statusMap = {
      present: '<span class="sp-badge-g">✅ Present</span>',
      late:    '<span class="sp-badge-o">⏰ Late</span>',
      absent:  '<span class="sp-badge-r">❌ Absent</span>',
      pending: '<span class="sp-badge-n">— Pending</span>',
    };
    var emojis = {Happy:'😊',Neutral:'😐',Confused:'🤔',Bored:'😴',Stressed:'😰'};

    var rows = records.length ? records.map(function(r) {
      var d   = new Date(r.session_date).toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
      var emj = r.emotion ? emojis[r.emotion] + ' ' + r.emotion : '—';
      var conf= r.confidence ? r.confidence + '%' : '—';
      return '<tr>'
        + '<td><strong>' + _esc(d) + '</strong></td>'
        + '<td style="color:#8d99bb;font-size:12px">' + _esc(r.session_label || '—') + '</td>'
        + '<td>' + (statusMap[r.status] || statusMap.pending) + '</td>'
        + '<td style="font-size:12px;color:#4a5578">' + _esc(emj) + '</td>'
        + '<td style="font-family:monospace;font-size:12px;color:#8d99bb">' + conf + '</td>'
        + '</tr>';
    }).join('')
    : '<tr><td colspan="5" style="text-align:center;padding:36px;color:#8d99bb">No attendance records yet. They appear after each class session.</td></tr>';

    _html(warn
      + '<div class="sp-card sp-att-summary">'
      + '  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px">'
      + '    <div><div style="font-size:36px;font-weight:800;color:' + pctC + '">' + pct + '</div>'
      + '         <div style="font-size:13px;color:#8d99bb;margin-top:2px">Attendance Rate</div></div>'
      + '    <div style="display:flex;gap:20px;flex-wrap:wrap">'
      + '      <div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#2f9e44">' + (sum.present||0) + '</div><div style="font-size:11px;color:#8d99bb">Present</div></div>'
      + '      <div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#e8590c">' + (sum.late||0) + '</div><div style="font-size:11px;color:#8d99bb">Late</div></div>'
      + '      <div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#c92a2a">' + (sum.absent||0) + '</div><div style="font-size:11px;color:#8d99bb">Absent</div></div>'
      + '      <div style="text-align:center"><div style="font-size:22px;font-weight:800;color:#1a1a2e">' + (sum.total||0) + '</div><div style="font-size:11px;color:#8d99bb">Total</div></div>'
      + '    </div>'
      + '  </div>'
      + '  <div style="margin-top:16px">'
      + '    <div style="height:10px;background:#eef1f8;border-radius:99px;overflow:hidden">'
      + '      <div style="height:100%;width:' + bar + ';background:' + pctC + ';border-radius:99px;transition:width .5s"></div>'
      + '    </div>'
      + '    <div style="font-size:11px;color:#8d99bb;margin-top:4px">Target: 75% minimum attendance required</div>'
      + '  </div>'
      + '</div>'
      + '<div class="sp-sh" style="margin-top:20px">Session History</div>'
      + '<div class="sp-card" style="overflow:hidden;padding:0">'
      + '  <div style="overflow-x:auto"><table class="sp-tbl">'
      + '    <thead><tr><th>Date</th><th>Session</th><th>Status</th><th>Mood</th><th>Confidence</th></tr></thead>'
      + '    <tbody>' + rows + '</tbody>'
      + '  </table></div>'
      + '</div>'
    );
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   LESSON NOTES
═══════════════════════════════════════════════════════════════════════════ */
function _pageNotes() {
  _loading();
  _apiCall('get_notes', {}, function(err, data) {
    if (!err && data && data.ok) { SP.notes = data.notes || []; }
    var notes = SP.notes;

    if (!notes.length) {
      _html('<div class="sp-empty-page"><div style="font-size:48px">📚</div>'
        + '<div style="font-size:16px;font-weight:700;color:#4a5578">No lesson notes yet</div>'
        + '<div style="font-size:13px;color:#8d99bb;max-width:340px;text-align:center">Your professor will share lesson summaries here after each class session. Check back soon!</div></div>');
      return;
    }

    var cards = notes.map(function(n, i) {
      var d    = new Date(n.created_at).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'});
      var pts  = (n.key_points||[]).slice(0,4).map(function(p){ return '<li style="margin-bottom:4px">' + _esc(p) + '</li>'; }).join('');
      var terms= (n.key_terms||[]).slice(0,6).map(function(t){ return '<span class="sp-term">' + _esc(t) + '</span>'; }).join('');
      return '<div class="sp-note-card">'
        + '  <div class="sp-note-head">'
        + '    <div>'
        + '      <div class="sp-note-title">📄 ' + _esc(n.title) + '</div>'
        + '      <div class="sp-note-meta">' + _esc(d) + ' &nbsp;·&nbsp; ' + _esc(n.shared_by||'Teacher') + ' &nbsp;·&nbsp; ' + (n.word_count||0) + ' words</div>'
        + '    </div>'
        + '    <button class="sp-btn-dl" onclick="spDownloadNote(' + i + ')">📥 Download PDF</button>'
        + '  </div>'
        + '  <div class="sp-note-body">' + _esc(n.summary.slice(0,300)) + (n.summary.length>300?'…':'') + '</div>'
        + (pts ? '<ul class="sp-note-pts">' + pts + '</ul>' : '')
        + (terms ? '<div class="sp-terms">' + terms + '</div>' : '')
        + '</div>';
    }).join('');

    _html('<div class="sp-sh">📚 Lesson Notes (' + notes.length + ')</div>' + cards);
  });
}

window.spDownloadNote = function(idx) {
  var note = SP.notes[idx];
  if (!note) return;
  function _gen(jsPDF) {
    var doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    var mg  = 20, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var mxW = W - mg * 2, y = mg;
    function t(text, size, style, color, gap) {
      doc.setFontSize(size); doc.setFont('helvetica', style||'normal');
      doc.setTextColor.apply(doc, color||[26,26,46]);
      if (gap) y += gap;
      doc.splitTextToSize(String(text||''), mxW).forEach(function(l) {
        if (y + size * 0.4 > H - mg) { doc.addPage(); y = mg; }
        doc.text(l, mg, y); y += size * 0.42;
      });
    }
    doc.setFillColor(59,91,219); doc.rect(0,0,W,12,'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('SmartClass · Lesson Note · ' + new Date().toLocaleDateString('en-PH'), mg, 8.5);
    y = 20;
    t(note.title, 17, 'bold', [26,26,46]);
    doc.setTextColor(130,150,185); doc.setFontSize(9);
    doc.text('Shared by ' + (note.shared_by||'Teacher') + ' · ' + (note.word_count||0) + ' words', mg, y);
    y += 6; doc.setDrawColor(220,225,240); doc.line(mg, y, W-mg, y); y += 7;
    t('SUMMARY', 9, 'bold', [110,120,160], 2);
    t(note.summary, 11, 'normal', [50,55,80], 3);
    if ((note.key_points||[]).length) {
      t('KEY POINTS', 9, 'bold', [110,120,160], 7);
      note.key_points.forEach(function(p,i){ t((i+1)+'. '+p, 11, 'normal', [50,55,80]); });
    }
    if ((note.key_terms||[]).length) {
      t('KEY TERMS', 9, 'bold', [110,120,160], 7);
      t(note.key_terms.join(' · '), 11, 'normal', [59,91,219]);
    }
    var pages = doc.internal.getNumberOfPages();
    for (var p=1;p<=pages;p++) {
      doc.setPage(p); doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(165,170,190);
      doc.text('SmartClass · Student Portal · Page '+p+' of '+pages, mg, H-7);
    }
    doc.save('LessonNote_' + note.title.replace(/[^a-z0-9]/gi,'_').slice(0,40) + '.pdf');
    window.toast && window.toast('📥 PDF downloaded!', 'green');
  }
  var PDF = (window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  if (PDF) { _gen(PDF); return; }
  var s = document.createElement('script'); s.src = JSPDF_CDN;
  s.onload  = function() { _gen((window.jspdf&&window.jspdf.jsPDF)||window.jsPDF); };
  s.onerror = function() { window.toast && window.toast('Could not load PDF library','red'); };
  document.head.appendChild(s);
};

/* ═══════════════════════════════════════════════════════════════════════════
   STUDENT SUMMARIZER
   Students can upload their own PDF / paste text and get an AI summary.
   Uses the same PHP proxy as the teacher (Ollama or local NLP).
   NO access to mic recording (that's a teacher-only classroom tool).
═══════════════════════════════════════════════════════════════════════════ */
function _pageSummarizer() {
  _html([
    '<div class="sp-sh">📝 Personal Lesson Summarizer</div>',
    '<p style="font-size:13px;color:#4a5578;margin:0 0 20px">',
    '  Upload a PDF or paste text from your notes/readings, and get an AI-powered summary.',
    '  <em style="color:#8d99bb">Tagalog and English both supported.</em>',
    '</p>',

    '<!-- Mode Tabs -->',
    '<div class="sp-sum-tabs">',
    '  <button class="sp-sum-tab active" onclick="spSumTab(this,\'file\')">📄 Upload PDF</button>',
    '  <button class="sp-sum-tab"        onclick="spSumTab(this,\'text\')">📝 Paste Text</button>',
    '</div>',

    '<!-- FILE PANEL -->',
    '<div id="sp-sum-file" class="sp-sum-panel">',
    '  <div class="sp-drop-zone" id="sp-drop" onclick="document.getElementById(\'sp-file-inp\').click()"',
    '       ondragover="event.preventDefault();this.classList.add(\'hover\')"',
    '       ondragleave="this.classList.remove(\'hover\')"',
    '       ondrop="event.preventDefault();this.classList.remove(\'hover\');spHandleDrop(event)">',
    '    <div style="font-size:36px">📂</div>',
    '    <div style="font-weight:700;font-size:14px;color:#4a5578;margin-top:8px">Click or drag & drop a PDF</div>',
    '    <div style="font-size:12px;color:#8d99bb;margin-top:4px">Supports .pdf and .txt files · max 15 MB</div>',
    '  </div>',
    '  <input type="file" id="sp-file-inp" accept=".pdf,.txt" style="display:none" onchange="spHandleFile(event)">',
    '  <div id="sp-file-info" style="display:none;margin-top:12px;padding:12px 16px;background:#f0f4ff;border-radius:10px;border:1.5px solid #c5d0ff;display:flex;align-items:center;gap:12px">',
    '    <span id="sp-file-icon" style="font-size:24px">📄</span>',
    '    <div style="flex:1"><div id="sp-file-name" style="font-weight:600;font-size:13px"></div>',
    '         <div id="sp-file-sz"   style="font-size:12px;color:#8d99bb"></div></div>',
    '    <button onclick="spClearFile()" style="border:none;background:none;cursor:pointer;font-size:18px;color:#8d99bb">✕</button>',
    '  </div>',
    '  <div id="sp-file-loading" class="sp-sum-loading"><div class="sp-spin"></div> Extracting text from PDF…</div>',
    '  <button class="sp-btn-primary" id="sp-btn-file-sum" onclick="spSummarizeFile()" disabled style="margin-top:12px;width:100%">✨ Summarize</button>',
    '</div>',

    '<!-- TEXT PANEL -->',
    '<div id="sp-sum-text" class="sp-sum-panel" style="display:none">',
    '  <textarea id="sp-text-inp" rows="8" placeholder="Paste your lesson notes, reading material, or any text here… (Tagalog or English)" style="width:100%;padding:12px 14px;border:1.5px solid #dde3f0;border-radius:10px;font-family:inherit;font-size:13px;background:#f4f6fb;color:#1a1a2e;resize:vertical;outline:none;box-sizing:border-box"></textarea>',
    '  <div id="sp-text-loading" class="sp-sum-loading"><div class="sp-spin"></div> Summarizing…</div>',
    '  <button class="sp-btn-primary" onclick="spSummarizeText()" style="margin-top:12px;width:100%">✨ Summarize</button>',
    '</div>',

    '<!-- RESULT -->',
    '<div id="sp-sum-result" style="display:none;margin-top:20px;padding:20px;background:#f0f4ff;border:1.5px solid #c5d0ff;border-radius:14px;font-size:14px;line-height:1.75;color:#1a1a2e"></div>',
  ].join('\n'));

  // Store file ref
  window._spCurrentFile = null;
}

window.spSumTab = function(btn, panel) {
  document.querySelectorAll('.sp-sum-tab').forEach(function(t){ t.classList.remove('active'); });
  btn.classList.add('active');
  document.getElementById('sp-sum-file').style.display = panel==='file' ? '' : 'none';
  document.getElementById('sp-sum-text').style.display = panel==='text' ? '' : 'none';
};

window.spHandleDrop = function(e) {
  var f = e.dataTransfer.files[0]; if (f) _spSetFile(f);
};
window.spHandleFile = function(e) {
  var f = e.target.files[0]; if (f) _spSetFile(f);
};
function _spSetFile(file) {
  if (file.size > 15*1024*1024) { window.toast&&window.toast('File too large (max 15 MB)','orange'); return; }
  window._spCurrentFile = file;
  var ext = file.name.split('.').pop().toLowerCase();
  var drop = document.getElementById('sp-drop'); if (drop) drop.style.display = 'none';
  var fi   = document.getElementById('sp-file-info'); if (fi) fi.style.display = 'flex';
  var ic   = document.getElementById('sp-file-icon'); if (ic) ic.textContent = ext==='pdf'?'📄':'📝';
  var fn   = document.getElementById('sp-file-name'); if (fn) fn.textContent = file.name;
  var fs   = document.getElementById('sp-file-sz');   if (fs) fs.textContent = (file.size/1024).toFixed(1)+' KB · '+ext.toUpperCase();
  var btn  = document.getElementById('sp-btn-file-sum'); if (btn) btn.disabled = false;
}
window.spClearFile = function() {
  window._spCurrentFile = null;
  var drop = document.getElementById('sp-drop'); if (drop) drop.style.display = '';
  var fi   = document.getElementById('sp-file-info'); if (fi) fi.style.display = 'none';
  var btn  = document.getElementById('sp-btn-file-sum'); if (btn) btn.disabled = true;
  var inp  = document.getElementById('sp-file-inp'); if (inp) inp.value = '';
};

window.spSummarizeFile = function() {
  var file = window._spCurrentFile;
  if (!file) { window.toast&&window.toast('No file selected','orange'); return; }
  var ld = document.getElementById('sp-file-loading'); if (ld) ld.style.display = 'flex';
  var btn= document.getElementById('sp-btn-file-sum'); if (btn) btn.disabled = true;
  var ext= file.name.split('.').pop().toLowerCase();

  function _afterExtract(text) {
    if (ld) ld.style.display = 'none';
    if (btn) btn.disabled = false;
    if (!text || text.trim().length < 20) { window.toast&&window.toast('Could not extract text from this file','orange'); return; }
    _spDoSummarize(text);
  }

  if (ext === 'pdf') {
    _spExtractPdf(file, _afterExtract);
  } else {
    var r = new FileReader();
    r.onload  = function(e) { _afterExtract(e.target.result||''); };
    r.onerror = function()  { if(ld)ld.style.display='none'; if(btn)btn.disabled=false; window.toast&&window.toast('Error reading file','red'); };
    r.readAsText(file,'UTF-8');
  }
};

window.spSummarizeText = function() {
  var inp = document.getElementById('sp-text-inp');
  if (!inp||!inp.value.trim()) { window.toast&&window.toast('Paste some text first','orange'); return; }
  var ld = document.getElementById('sp-text-loading'); if(ld) ld.style.display='flex';
  _spDoSummarize(inp.value);
};

function _spDoSummarize(text) {
  var res = document.getElementById('sp-sum-result');
  if (res) { res.style.display='none'; res.innerHTML=''; }

  fetch(window.API_BASE + '/summarize.php', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text:text, mode:'text' })
  })
  .then(function(r){
    var ct = r.headers.get('content-type')||'';
    if (!ct.includes('application/json')) throw new Error('API not available');
    return r.json();
  })
  .then(function(data) {
    var ld2 = document.querySelectorAll('.sp-sum-loading');
    ld2.forEach(function(l){ l.style.display='none'; });
    if (!data.ok) { _spLocalSum(text); return; }
    _spShowResult(data.summary);
  })
  .catch(function() {
    document.querySelectorAll('.sp-sum-loading').forEach(function(l){ l.style.display='none'; });
    _spLocalSum(text);
  });
}

function _spLocalSum(text) {
  // Simple local NLP fallback
  var STOP = new Set('the a an is it in on at to of and or but for with this that was are be as by from have has had been do did will would could should may might not no so if then also which when where how what who its he she they we you i me my your his her our their na ng sa mga ay at si ni ito siya sila kami kayo tayo nang po ho ba din rin lang yung kasi pero'.split(' '));
  var words = text.replace(/\s+/g,' ').split(/\s+/);
  var freq  = {};
  words.forEach(function(w){ var lw=w.toLowerCase().replace(/[^a-z]/g,''); if(lw.length>3&&!STOP.has(lw)) freq[lw]=(freq[lw]||0)+1; });
  var sents = text.split(/[.!?]+/).map(function(s){return s.trim();}).filter(function(s){return s.length>20;});
  var scored= sents.map(function(s){
    var score=s.toLowerCase().split(/\s+/).reduce(function(sum,w){return sum+(freq[w.replace(/[^a-z]/g,'')]||0);},0)/Math.max(1,s.split(/\s+/).length);
    return {s:s,score:score};
  });
  scored.sort(function(a,b){return b.score-a.score;});
  var top   = scored.slice(0,5).map(function(x){return x.s;});
  var terms = Object.entries(freq).sort(function(a,b){return b[1]-a[1];}).slice(0,8).map(function(e){return e[0];});
  var title = terms.slice(0,3).map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(', ')||'Summary';
  _spShowResult({ title:title, summary:top.join('. ')+'.', keyPoints:top.slice(0,4), keyTerms:terms, wordCount:words.length });
}

function _spShowResult(s) {
  var pts   = (s.keyPoints||[]).map(function(p){return '<li>'+_esc(p)+'</li>';}).join('');
  var terms = (s.keyTerms||[]).map(function(t){return '<span class="sp-term">'+_esc(t)+'</span>';}).join('');
  var html  =
    '<div style="font-weight:800;font-size:15px;color:#1a1a2e;margin-bottom:6px">📝 ' + _esc(s.title) + '</div>'
    + '<div style="font-size:12px;color:#8d99bb;margin-bottom:14px;font-family:monospace">' + (s.wordCount||0) + ' words · AI summarized</div>'
    + '<div style="font-weight:700;font-size:11px;color:#8d99bb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Summary</div>'
    + '<div style="font-size:13.5px;color:#4a5578;line-height:1.75;margin-bottom:14px">' + _esc(s.summary) + '</div>'
    + (pts ? '<div style="font-weight:700;font-size:11px;color:#8d99bb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Key Points</div><ul style="padding-left:18px;color:#4a5578;font-size:13px;line-height:1.7;margin-bottom:14px">' + pts + '</ul>' : '')
    + (terms ? '<div style="font-weight:700;font-size:11px;color:#8d99bb;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Key Terms</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:16px">' + terms + '</div>' : '')
    + '<button class="sp-btn-primary" onclick="spDownloadSummaryPDF()" style="font-size:12px">📥 Download PDF</button>';

  window._spLastSummary = s;
  var res = document.getElementById('sp-sum-result');
  if (res) { res.style.display=''; res.innerHTML=html; }
}

window.spDownloadSummaryPDF = function() {
  var s = window._spLastSummary; if (!s) return;
  function _gen(jsPDF) {
    var doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    var mg=20,W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),mxW=W-mg*2,y=mg;
    function t(text,sz,style,color,gap){ doc.setFontSize(sz);doc.setFont('helvetica',style||'normal');doc.setTextColor.apply(doc,color||[26,26,46]);if(gap)y+=gap;doc.splitTextToSize(String(text||''),mxW).forEach(function(l){if(y+sz*0.4>H-mg){doc.addPage();y=mg;}doc.text(l,mg,y);y+=sz*0.42;}); }
    doc.setFillColor(59,91,219);doc.rect(0,0,W,12,'F');doc.setFontSize(8);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
    doc.text('SmartClass · My Summary · '+new Date().toLocaleDateString('en-PH'),mg,8.5);y=20;
    t(s.title,17,'bold',[26,26,46]);y+=4;
    doc.setTextColor(130,150,185);doc.setFontSize(9);doc.text((s.wordCount||0)+' words',mg,y);y+=7;
    doc.setDrawColor(220,225,240);doc.line(mg,y,W-mg,y);y+=7;
    t('SUMMARY',9,'bold',[110,120,160],2);t(s.summary,11,'normal',[50,55,80],3);
    if((s.keyPoints||[]).length){t('KEY POINTS',9,'bold',[110,120,160],7);s.keyPoints.forEach(function(p,i){t((i+1)+'. '+p,11,'normal',[50,55,80]);});}
    if((s.keyTerms||[]).length){t('KEY TERMS',9,'bold',[110,120,160],7);t(s.keyTerms.join(' · '),11,'normal',[59,91,219]);}
    var pages=doc.internal.getNumberOfPages();
    for(var p=1;p<=pages;p++){doc.setPage(p);doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(165,170,190);doc.text('SmartClass Student Portal · Page '+p+' of '+pages,mg,H-7);}
    doc.save('MySummary_'+s.title.replace(/[^a-z0-9]/gi,'_').slice(0,40)+'.pdf');
    window.toast&&window.toast('📥 Downloaded!','green');
  }
  var PDF=(window.jspdf&&window.jspdf.jsPDF)||window.jsPDF;
  if(PDF){_gen(PDF);return;}
  var sc=document.createElement('script');sc.src=JSPDF_CDN;sc.onload=function(){_gen((window.jspdf&&window.jspdf.jsPDF)||window.jsPDF);};sc.onerror=function(){window.toast&&window.toast('PDF library unavailable','red');};document.head.appendChild(sc);
};

function _spExtractPdf(file, callback) {
  function _run() {
    var lib = window.pdfjsLib; if(!lib){callback('');return;}
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    var fr = new FileReader();
    fr.onload = function(e) {
      lib.getDocument({data: new Uint8Array(e.target.result)}).promise.then(function(pdf) {
        var pages=pdf.numPages, texts=new Array(pages), pending=pages;
        if(!pages){callback('');return;}
        for(var p=1;p<=pages;p++){(function(pn){pdf.getPage(pn).then(function(pg){return pg.getTextContent();}).then(function(tc){var lines=[],lastY=null;tc.items.forEach(function(item){if(lastY!==null&&Math.abs(item.transform[5]-lastY)>5)lines.push('\n');lines.push(item.str);lastY=item.transform[5];});texts[pn-1]=lines.join(' ').replace(/ {2,}/g,' ');}).catch(function(){texts[pn-1]='';}).finally(function(){pending--;if(pending===0)callback(texts.join('\n\n'));});})(p);}
      }).catch(function(){callback('');});
    };
    fr.onerror=function(){callback('');};
    fr.readAsArrayBuffer(file);
  }
  if(window.pdfjsLib){_run();return;}
  var s=document.createElement('script');s.src=PDFJS_CDN;s.onload=_run;s.onerror=function(){callback('');};document.head.appendChild(s);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEEDBACK
═══════════════════════════════════════════════════════════════════════════ */
function _pageFeedback() {
  _html([
    '<div class="sp-sh">💬 Send Feedback to Your Teacher</div>',
    '<p style="font-size:13px;color:#4a5578;margin:0 0 20px;line-height:1.6">',
    '  Help your teacher understand how you\'re feeling about the class.',
    '  You can send this anonymously — your teacher sees the mood and message but not your name.',
    '</p>',
    '<div class="sp-card">',
    '  <div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:14px">How are you feeling about the class? <span style="color:#c92a2a">*</span></div>',
    '  <div class="sp-mood-row" id="sp-moods">',
    '    <button class="sp-mood" data-mood="great"    onclick="spPickMood(this)">😁<span>Great</span></button>',
    '    <button class="sp-mood" data-mood="good"     onclick="spPickMood(this)">😊<span>Good</span></button>',
    '    <button class="sp-mood" data-mood="okay"     onclick="spPickMood(this)">😐<span>Okay</span></button>',
    '    <button class="sp-mood" data-mood="confused" onclick="spPickMood(this)">😕<span>Confused</span></button>',
    '    <button class="sp-mood" data-mood="lost"     onclick="spPickMood(this)">😰<span>Lost / Struggling</span></button>',
    '  </div>',
    '  <div style="margin-top:20px">',
    '    <label style="font-weight:700;font-size:13px;color:#1a1a2e;display:block;margin-bottom:8px">Message for your teacher <span style="font-weight:400;color:#8d99bb">(optional)</span></label>',
    '    <textarea id="sp-fb-msg" rows="4" placeholder="e.g. \'The recursion topic was confusing for me\' or \'Great class today, I understood everything!\'"',
    '      style="width:100%;padding:12px 14px;border:1.5px solid #dde3f0;border-radius:10px;font-family:inherit;font-size:13px;background:#f4f6fb;color:#1a1a2e;resize:vertical;outline:none;box-sizing:border-box"></textarea>',
    '  </div>',
    '  <label style="display:flex;align-items:center;gap:10px;margin-top:14px;cursor:pointer;font-size:13px;color:#4a5578">',
    '    <input type="checkbox" id="sp-fb-anon" style="width:16px;height:16px;cursor:pointer;accent-color:#3b5bdb">',
    '    Submit anonymously — teacher will NOT see my name',
    '  </label>',
    '  <button class="sp-btn-primary" id="sp-fb-btn" onclick="spSubmitFeedback()" disabled style="margin-top:20px;width:100%">📤 Submit Feedback</button>',
    '  <div id="sp-fb-ok" style="display:none;margin-top:16px;padding:16px;background:#ebfbee;border:1.5px solid #b2f2bb;border-radius:10px;color:#2f9e44;font-weight:700;text-align:center">',
    '    ✅ Feedback submitted! Thank you for helping improve the class.',
    '  </div>',
    '</div>',
  ].join('\n'));

  document.querySelectorAll('.sp-mood').forEach(function(b) {
    b.addEventListener('click', function() {
      var s = document.getElementById('sp-fb-btn'); if(s) s.disabled = false;
    });
  });
}

window.spPickMood = function(btn) {
  document.querySelectorAll('.sp-mood').forEach(function(b){ b.classList.remove('sel'); });
  btn.classList.add('sel');
};

window.spSubmitFeedback = function() {
  var sel  = document.querySelector('.sp-mood.sel');
  if (!sel) { window.toast&&window.toast('Pick a mood first','orange'); return; }
  var mood = sel.dataset.mood;
  var msg  = (document.getElementById('sp-fb-msg')||{}).value||'';
  var anon = (document.getElementById('sp-fb-anon')||{}).checked ? 1 : 0;
  var btn  = document.getElementById('sp-fb-btn');
  if (btn) { btn.disabled=true; btn.textContent='Submitting…'; }

  _apiCall('submit_feedback', {mood:mood, message:msg, is_anonymous:anon}, function(err,data) {
    if (!err && data && data.ok) {
      var ok = document.getElementById('sp-fb-ok'); if(ok) ok.style.display='';
      if (btn) btn.style.display = 'none';
      window.toast&&window.toast('✅ Feedback sent!','green');
    } else {
      if (btn) { btn.disabled=false; btn.textContent='📤 Submit Feedback'; }
      window.toast&&window.toast('Error sending feedback — try again','red');
    }
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   PROFILE + CHANGE PASSWORD
═══════════════════════════════════════════════════════════════════════════ */
function _pageProfile() {
  var user    = SP.user || {};
  var enr     = SP.enrolled;
  var section = _findSection(user.section_id);

  var photo = enr && enr.photoDataUrl
    ? '<img src="' + enr.photoDataUrl + '" class="sp-profile-photo" alt="Photo">'
    : '<div class="sp-profile-ava">' + _esc(user.avatar||'👩‍🎓') + '</div>';

  var faceBadge = enr && enr.trained
    ? '<span class="sp-badge-g" style="font-size:12px">✅ Face enrolled (' + ((enr.descriptors||[]).length) + ' samples)</span>'
    : '<span class="sp-badge-n" style="font-size:12px">⚠️ Not enrolled — ask your teacher</span>';

  _html([
    '<div class="sp-sh">👤 My Profile</div>',
    '<div class="sp-card sp-profile-top">',
    '  ' + photo,
    '  <div>',
    '    <div style="font-size:20px;font-weight:800;color:#1a1a2e">' + _esc(user.name) + '</div>',
    '    <div style="font-size:13px;color:#8d99bb;margin-top:3px">@' + _esc(user.username) + ' &nbsp;·&nbsp; Student</div>',
    '    <div style="margin-top:8px">' + faceBadge + '</div>',
    '  </div>',
    '</div>',

    '<div class="sp-detail-grid">',
    '  ' + _detail('Student ID',    user.student_sid||'—'),
    '  ' + _detail('Section',       section.name||user.section_id||'—'),
    '  ' + _detail('Subject',       section.subject||'—'),
    '  ' + _detail('Year Level',    (enr&&enr.year)||'—'),
    '  ' + _detail('Date Enrolled', enr ? new Date(enr.enrolledAt||Date.now()).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : 'Not yet'),
    '  ' + _detail('Role',          'Student'),
    '</div>',

    '<div class="sp-card" style="margin-top:16px;padding:16px 18px;background:#f0f4ff;border-color:#c5d0ff">',
    '  <strong style="color:#1a1a2e">💡 How attendance works:</strong>',
    '  <div style="font-size:13px;color:#4a5578;margin-top:6px;line-height:1.6">',
    '    When your teacher starts the camera during class, the AI recognizes your face and marks you present automatically.',
    '    Make sure you are enrolled (photo captured) for this to work. Ask your teacher if you are not enrolled.',
    '  </div>',
    '</div>',

    '<div class="sp-sh" style="margin-top:24px">🔒 Change Password</div>',
    '<div class="sp-card">',
    '  <div class="sp-form-row">',
    '    <label>Current Password</label>',
    '    <input type="password" id="sp-pw-cur" placeholder="Your current password" class="sp-input">',
    '  </div>',
    '  <div class="sp-form-row">',
    '    <label>New Password <span style="color:#8d99bb;font-weight:400">(min 6 characters)</span></label>',
    '    <input type="password" id="sp-pw-new" placeholder="New password" class="sp-input">',
    '  </div>',
    '  <div class="sp-form-row">',
    '    <label>Confirm New Password</label>',
    '    <input type="password" id="sp-pw-cfm" placeholder="Confirm new password" class="sp-input">',
    '  </div>',
    '  <button class="sp-btn-primary" onclick="spChangePassword()" style="margin-top:8px">🔒 Change Password</button>',
    '  <div id="sp-pw-msg" style="display:none;margin-top:10px;padding:10px;border-radius:8px;font-size:13px"></div>',
    '</div>',

    '<button class="sp-btn-logout" onclick="doLogout()" style="margin-top:24px;width:100%;padding:12px;justify-content:center;font-size:14px">🚪 Sign Out</button>',
  ].join('\n'));
}

function _detail(label, val) {
  return '<div class="sp-detail"><div class="sp-detail-lbl">' + _esc(label) + '</div><div class="sp-detail-val">' + _esc(val) + '</div></div>';
}

window.spChangePassword = function() {
  var cur = (document.getElementById('sp-pw-cur')||{}).value||'';
  var nw  = (document.getElementById('sp-pw-new')||{}).value||'';
  var cfm = (document.getElementById('sp-pw-cfm')||{}).value||'';
  var msg = document.getElementById('sp-pw-msg');
  function show(text, ok) {
    if (!msg) return;
    msg.style.display='';
    msg.style.background = ok ? '#ebfbee' : '#fff5f5';
    msg.style.color      = ok ? '#2f9e44' : '#c92a2a';
    msg.style.border     = '1.5px solid ' + (ok ? '#b2f2bb' : '#ffc9c9');
    msg.textContent      = text;
  }
  if (!cur||!nw||!cfm) { show('Please fill in all fields.', false); return; }
  if (nw.length < 6)   { show('New password must be at least 6 characters.', false); return; }
  if (nw !== cfm)      { show('New passwords do not match.', false); return; }

  _apiCall('change_password', {current_password:cur, new_password:nw}, function(err,data) {
    if (!err && data && data.ok) {
      show('✅ Password changed successfully!', true);
      ['sp-pw-cur','sp-pw-new','sp-pw-cfm'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
    } else {
      show((data&&data.error)||'Error changing password.', false);
    }
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */
function _apiCall(action, extra, callback) {
  // If no auth token (offline/local-fallback session) show a clear warning banner
  if (!window.authToken) {
    // Show offline notice only on dashboard action (once), not every tab switch
    if (action === 'dashboard') {
      var c = document.getElementById('sp-content');
      if (c) {
        var offlineBanner = '<div style="margin-bottom:16px;padding:14px 18px;background:#fff8e8;border:1.5px solid #ffd8a8;border-radius:12px;color:#e8590c;font-size:13px;font-weight:600;display:flex;gap:10px;align-items:flex-start">'
          + '<span style="font-size:18px;flex-shrink:0">⚠️</span>'
          + '<div><strong>XAMPP / MySQL is not running.</strong><br>'
          + '<span style="font-weight:400">Your attendance, notes, and announcements require the database. '
          + 'Start XAMPP, make sure Apache and MySQL are running, then log in again.</span></div></div>';
        c.innerHTML = offlineBanner + c.innerHTML;
      }
    }
    callback(null, { ok: false, error: 'offline', _offline: true });
    return;
  }
  var payload = Object.assign({ action:action, token:window.authToken }, extra||{});
  fetch(_studentApiUrl(), {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  })
  .then(function(r){
    var ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('not json');
    return r.json();
  })
  .then(function(d){ callback(null, d); })
  .catch(function(e){ callback(e, null); });
}

function _findSection(id) {
  var sections = window.loadSections ? window.loadSections() : [];
  return sections.find(function(s){ return s.id===id; }) || {};
}

function _tick() {
  if (SP.clockTimer) clearInterval(SP.clockTimer);
  SP.clockTimer = setInterval(function() {
    var c = document.getElementById('sp-clock');
    if (c) c.textContent = new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }, 1000);
}

function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}