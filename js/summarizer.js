/**
 * js/summarizer.js — SmartClass Lesson Summarizer
 *
 * Features:
 *  [MIC]   Web Speech API with fil-PH locale → en-US fallback
 *          Live Tagalog→English translation via MyMemory API (free, no key needed)
 *  [FILE]  Real PDF text extraction via pdf.js 3.x CDN (not readAsText)
 *  [AI]    Summarisation via PHP proxy → Anthropic Claude API (key stays server-side)
 *  [NLP]   Accurate local fallback when API is not configured
 *  [PDF]   Download summary as a proper PDF using jsPDF
 *
 * Depends on: app.js · api/summarize.php (PHP proxy) · pdf.js CDN · jsPDF CDN
 */
'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */
var SUMMARIZE_API   = '/smartclass/api/summarize.php';
var MYMEMORY_API    = 'https://api.mymemory.translated.net/get';
var PDFJS_CDN       = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var JSPDF_CDN       = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

/* ═══════════════════════════════════════════════════════════════════════════
   MIC STATE
═══════════════════════════════════════════════════════════════════════════ */
var _micRec            = null;
var _micRawTranscript  = '';   // original language (may contain Tagalog)
var _micEnTranscript   = '';   // English translation buffer (displayed)
var _micTimer          = null;
var _micSeconds        = 0;
var _micLang           = 'fil-PH';
var _translationQueue  = Promise.resolve(); // serial translation queue

/* ═══════════════════════════════════════════════════════════════════════════
   TAB SWITCHER
═══════════════════════════════════════════════════════════════════════════ */
window.switchSumMode = function(mode) {
  document.querySelectorAll('.sum-tab').forEach(function(t)  { t.classList.remove('active'); });
  document.querySelectorAll('.sum-panel').forEach(function(p){ p.classList.remove('active'); });
  var tab   = window.el('sum-tab-'   + mode);
  var panel = window.el('sum-panel-' + mode);
  if (tab)   tab.classList.add('active');
  if (panel) panel.classList.add('active');
};

/* ═══════════════════════════════════════════════════════════════════════════
   MICROPHONE — Web Speech API + live Tagalog→English translation
═══════════════════════════════════════════════════════════════════════════ */
window.toggleMic = function() {
  if (_micRec) _stopMic();
  else         _startMic();
};

function _startMic() {
  if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
    window.toast('❌ Speech recognition requires Chrome or Edge', 'red'); return;
  }

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _micRec = new SR();
  _micRec.continuous     = true;
  _micRec.interimResults = true;
  _micRec.lang           = _micLang;    // 'fil-PH' → Tagalog/Filipino

  _micRawTranscript = '';
  _micEnTranscript  = '';

  var tEl = window.el('mic-transcript');
  if (tEl) tEl.innerHTML = '<em style="color:var(--text-3)">Listening… (Tagalog &amp; English supported)</em>';

  _micRec.onresult = function(event) {
    var interimRaw = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      var chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        _micRawTranscript += chunk + ' ';
        // Queue a translation of this final chunk
        _enqueueTranslation(chunk);
      } else {
        interimRaw += chunk;
      }
    }
    // Show raw interim immediately so teacher sees what's being transcribed
    if (tEl) {
      tEl.innerHTML = (_micEnTranscript
        ? '<span style="color:var(--text)">' + _escHtml(_micEnTranscript) + '</span>'
        : '')
        + (interimRaw
          ? '<span style="color:var(--text-3);font-style:italic"> ' + _escHtml(interimRaw) + '</span>'
          : '');
    }
    var btn = window.el('btn-summarize-mic');
    if (btn) btn.disabled = _micRawTranscript.trim().length < 20;
  };

  _micRec.onerror = function(e) {
    if (e.error === 'language-not-supported' || e.error === 'network') {
      // Retry with en-US — Tagalog words will still be picked up phonetically
      window.toast('Switching to en-US (fil-PH not available here)', 'orange', 3000);
      _micLang = 'en-US';
      try { _micRec.lang = 'en-US'; } catch(ex) {}
    } else if (e.error !== 'no-speech') {
      window.toast('Mic error: ' + e.error, 'orange');
      _stopMic();
    }
  };

  _micRec.onend = function() {
    // Auto-restart if teacher hasn't clicked Stop (Chrome stops after silence)
    if (_micRec) {
      try { _micRec.start(); } catch(ex) {}
    }
  };

  try {
    _micRec.start();
  } catch(e) {
    window.toast('Could not start microphone: ' + e.message, 'red');
    _micRec = null; return;
  }

  var btn = window.el('mic-btn'); if (btn) btn.classList.add('recording');
  window.setEl('mic-status', '🔴 Recording… Tagalog & English → translating to English live');

  _micSeconds = 0;
  _micTimer = setInterval(function() {
    _micSeconds++;
    var m = Math.floor(_micSeconds / 60), s = _micSeconds % 60;
    window.setEl('mic-timer-display', String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0'));
  }, 1000);
}

function _stopMic() {
  if (_micRec) {
    _micRec.onend = null; // prevent auto-restart
    try { _micRec.stop(); } catch(e) {}
    _micRec = null;
  }
  clearInterval(_micTimer);
  var btn = window.el('mic-btn'); if (btn) btn.classList.remove('recording');
  window.setEl('mic-status', 'Recording stopped. Click "Summarize Lesson" when ready.');
  var sumBtn = window.el('btn-summarize-mic');
  if (sumBtn) sumBtn.disabled = _micRawTranscript.trim().length < 20;
}

/**
 * Translate a chunk of text (Tagalog or mixed) to English using the free
 * MyMemory API (no API key required, 10 000 words/day free).
 */
function _enqueueTranslation(rawChunk) {
  rawChunk = rawChunk.trim();
  if (!rawChunk) return;

  _translationQueue = _translationQueue.then(function() {
    return _translateToEnglish(rawChunk).then(function(translated) {
      _micEnTranscript += translated + ' ';
      // Refresh transcript display
      var tEl = window.el('mic-transcript');
      if (tEl) tEl.innerHTML = '<span style="color:var(--text)">' + _escHtml(_micEnTranscript) + '</span>';
    }).catch(function() {
      // If translation fails, just append the raw text
      _micEnTranscript += rawChunk + ' ';
    });
  });
}

/**
 * Translate text → English using MyMemory (free, no key).
 * Tries fil→en first, then tl→en.
 */
function _translateToEnglish(text) {
  if (!text || text.trim().length < 3) return Promise.resolve(text);

  // If text is already predominantly English, skip translation
  if (_looksEnglish(text)) return Promise.resolve(text);

  var encoded = encodeURIComponent(text.trim());
  return fetch(MYMEMORY_API + '?q=' + encoded + '&langpair=fil%7Cen')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var t = (data.responseData && data.responseData.translatedText) || text;
      // MyMemory returns the source text unchanged if it can't translate
      return t === text ? text : t;
    })
    .catch(function() { return text; });
}

/** Heuristic: does text contain mostly ASCII English letters? */
function _looksEnglish(text) {
  var words = text.trim().split(/\s+/);
  if (words.length < 3) return true; // short phrases — just pass through
  var tagalogMarkers = /\b(ang|ng|sa|mga|ay|na|at|si|ni|ito|siya|sila|kami|kayo|tayo|nang|kung|pero|kasi|talaga|po|ho|opo|yung|yun|doon|dito|naman|lang|din|rin|ba|ako|ikaw|siya|kamo)\b/i;
  return !tagalogMarkers.test(text);
}

window.clearMicTranscript = function() {
  _stopMic();
  _micRawTranscript = ''; _micEnTranscript = '';
  window.setEl('mic-status', 'Click to start recording');
  window.setEl('mic-timer-display', '');
  var t = window.el('mic-transcript');
  if (t) t.innerHTML = '<em style="color:var(--text-3)">Transcript will appear here… (Tagalog &amp; English)</em>';
  var r = window.el('mic-result'); if (r) { r.innerHTML=''; r.classList.remove('show'); }
  var btn = window.el('btn-summarize-mic'); if (btn) btn.disabled = true;
  _micLang = 'fil-PH'; // reset language preference
};

window.summarizeMic = function() {
  var text = (_micEnTranscript.trim() || _micRawTranscript.trim());
  if (!text) { window.toast('No transcript yet — record first', 'orange'); return; }
  _doSummarize(text, 'mic', 'mic-result', 'mic-loading');
};

/* ═══════════════════════════════════════════════════════════════════════════
   FILE UPLOAD — real PDF text extraction using pdf.js
═══════════════════════════════════════════════════════════════════════════ */
window.handleDragOver   = function(e) { e.preventDefault(); var z=window.el('file-drop-zone'); if(z) z.classList.add('dragover'); };
window.handleDragLeave  = function()  { var z=window.el('file-drop-zone'); if(z) z.classList.remove('dragover'); };
window.handleFileDrop   = function(e) { e.preventDefault(); var z=window.el('file-drop-zone'); if(z) z.classList.remove('dragover'); var f=e.dataTransfer.files[0]; if(f) _processFile(f); };
window.handleFileSelect = function(e) { var f=e.target.files[0]; if(f) _processFile(f); };

window.clearFile = function() {
  var fi = window.el('file-info'), fiz = window.el('file-drop-zone');
  if (fi)  fi.style.display  = 'none';
  if (fiz) fiz.style.display = '';
  var inp = window.el('file-upload-input'); if (inp) inp.value = '';
  window._currentFile = null;
  var btn = window.el('btn-summarize-file'); if (btn) btn.disabled = true;
};

function _processFile(file) {
  if (file.size > 15 * 1024 * 1024) { window.toast('File too large (max 15 MB)', 'orange'); return; }
  var ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf','txt'].includes(ext)) {
    window.toast('Please upload a PDF or .txt file', 'orange'); return;
  }
  window._currentFile = file;
  var icon = ext === 'pdf' ? '📄' : '📝';
  var fi = window.el('file-info'), fiz = window.el('file-drop-zone');
  if (fi) {
    fi.style.display = 'flex';
    window.setEl('file-icon', icon);
    window.setEl('file-name', file.name);
    window.setEl('file-size', (file.size / 1024).toFixed(1) + ' KB · ' + ext.toUpperCase());
  }
  if (fiz) fiz.style.display = 'none';
  var btn = window.el('btn-summarize-file'); if (btn) btn.disabled = false;
  window.toast('✓ File ready: ' + file.name, 'green');
}

window.summarizeFile = function() {
  var file = window._currentFile;
  if (!file) { window.toast('No file loaded', 'orange'); return; }
  var loading = window.el('file-loading'); if (loading) loading.classList.add('show');
  var btn     = window.el('btn-summarize-file'); if (btn) btn.disabled = true;
  var ext     = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    _extractPdfText(file, function(text, pageCount) {
      if (loading) loading.classList.remove('show');
      if (btn) btn.disabled = false;
      if (!text || text.trim().length < 30) {
        window.toast('❌ Could not extract text. The PDF may be scanned/image-based.', 'red', 5000);
        return;
      }
      window.toast('✓ Extracted ' + text.split(/\s+/).length + ' words from ' + pageCount + ' pages', 'green');
      _doSummarize(text, 'file', 'file-result', 'file-loading');
    });
  } else {
    // Plain text file
    var reader = new FileReader();
    reader.onload = function(e) {
      if (loading) loading.classList.remove('show');
      if (btn) btn.disabled = false;
      var text = e.target.result || '';
      if (text.length < 10) { window.toast('File appears empty', 'orange'); return; }
      _doSummarize(text, 'file', 'file-result', 'file-loading');
    };
    reader.onerror = function() {
      if (loading) loading.classList.remove('show');
      if (btn) btn.disabled = false;
      window.toast('Error reading file', 'red');
    };
    reader.readAsText(file, 'UTF-8');
  }
};

/**
 * Real PDF text extraction using pdf.js.
 * Reads ALL pages and concatenates their text content.
 * This is the correct way — readAsText() only works on plain text files.
 */
function _extractPdfText(file, callback) {
  function _run() {
    var pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) { callback('', 0); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    var fr = new FileReader();
    fr.onload = function(e) {
      var data = new Uint8Array(e.target.result);
      pdfjsLib.getDocument({ data: data }).promise.then(function(pdf) {
        var numPages = pdf.numPages;
        var pageTexts = new Array(numPages);
        var pending   = numPages;

        if (numPages === 0) { callback('', 0); return; }

        for (var p = 1; p <= numPages; p++) {
          (function(pageNum) {
            pdf.getPage(pageNum).then(function(page) {
              return page.getTextContent();
            }).then(function(tc) {
              // Join items, preserving line breaks
              var lines   = [];
              var lastY   = null;
              tc.items.forEach(function(item) {
                if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) lines.push('\n');
                lines.push(item.str);
                lastY = item.transform[5];
              });
              pageTexts[pageNum - 1] = lines.join(' ').replace(/ {2,}/g, ' ');
            }).catch(function() {
              pageTexts[pageNum - 1] = '';
            }).finally(function() {
              pending--;
              if (pending === 0) callback(pageTexts.join('\n\n'), numPages);
            });
          })(p);
        }
      }).catch(function(err) {
        console.error('[pdf.js extract]', err);
        callback('', 0);
      });
    };
    fr.onerror = function() { callback('', 0); };
    fr.readAsArrayBuffer(file);
  }

  // Load pdf.js CDN if not already present
  if (window.pdfjsLib) {
    _run();
  } else {
    var script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload  = function() { _run(); };
    script.onerror = function() {
      window.toast('Could not load pdf.js — check internet connection', 'red');
      callback('', 0);
    };
    document.head.appendChild(script);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PASTE TEXT
═══════════════════════════════════════════════════════════════════════════ */
window.summarizeText = function() {
  var input = window.el('text-input');
  if (!input || !input.value.trim()) { window.toast('Paste some text first', 'orange'); return; }
  _doSummarize(input.value, 'text', 'text-result', 'text-loading');
};

/* ═══════════════════════════════════════════════════════════════════════════
   CORE SUMMARIZE ORCHESTRATOR
═══════════════════════════════════════════════════════════════════════════ */
function _doSummarize(text, mode, resultId, loadingId) {
  var loading = window.el(loadingId); if (loading) loading.classList.add('show');

  _callApiSummarize(text, function(summary, err) {
    if (loading) loading.classList.remove('show');

    if (err || !summary) {
      // Graceful fallback to local NLP
      var local = _nlpSummarize(text);
      _renderSummary(resultId, local.html);
      _saveSummaryHistory(mode, local.title, local.plain, local.wordCount);
      window.log('📝 Summary (local NLP, ' + local.wordCount + ' words)', 'purple');
      if (err) {
        // specific error already toasted by _callApiSummarize
      }
      return;
    }

    var html = _buildSummaryHtml(summary, mode);
    _renderSummary(resultId, html);
    _saveSummaryHistory(mode, summary.title, summary.summary, summary.wordCount);
    window.log('✨ AI summary ready — ' + summary.wordCount + ' words summarized', 'purple');
    window.toast('✓ Summary ready!', 'green');
  });
}

function _renderSummary(resultId, html) {
  var out = window.el(resultId);
  if (out) { out.classList.add('show'); out.innerHTML = html; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHP PROXY CALL → Anthropic Claude
═══════════════════════════════════════════════════════════════════════════ */
function _callApiSummarize(text, callback) {
  fetch(SUMMARIZE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text, mode: 'text' })
  })
  .then(function(res) {
    var ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('API returned non-JSON (' + res.status + ')');
    return res.json();
  })
  .then(function(data) {
    if (!data.ok) {
      // Show specific toast for each Ollama error type
      if (data.code === 'OLLAMA_OFFLINE') {
        window.toast('⚠️ Ollama is not running. Open a terminal → run: ollama serve', 'red', 9000);
      } else if (data.code === 'MODEL_NOT_FOUND') {
        window.toast('⚠️ Model not pulled yet. Run: ollama pull qwen2.5', 'orange', 9000);
      } else if (data.code === 'TOO_SHORT') {
        window.toast('Text is too short to summarize', 'orange');
      } else {
        window.toast('Ollama error — using local summarizer instead', 'orange', 5000);
      }
      callback(null, data.error || 'Ollama error');
      return;
    }
    callback(data.summary, null);
  })
  .catch(function(err) {
    console.warn('[summarizer] PHP proxy error:', err.message);
    callback(null, err.message);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER AI SUMMARY HTML
═══════════════════════════════════════════════════════════════════════════ */
function _buildSummaryHtml(s, mode) {
  var modeLabel = { mic:'🎙️ Microphone', file:'📄 Document', text:'📝 Text' }[mode] || '📝';
  var keyPtsHtml = (s.keyPoints || []).map(function(p) {
    return '<li style="margin-bottom:6px;line-height:1.6">' + _escHtml(p) + '</li>';
  }).join('');
  var termsHtml = (s.keyTerms || []).map(function(t) {
    return '<span style="display:inline-block;padding:3px 10px;border-radius:99px;background:var(--brand-dim);color:var(--brand);font-size:12px;font-weight:600;margin:2px">' + _escHtml(t) + '</span>';
  }).join('');

  return '<div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px">📝 ' + _escHtml(s.title) + '</div>'
    + '<div style="font-size:12px;color:var(--text-3);margin-bottom:16px;font-family:var(--mono)">'
    + s.wordCount + ' words · ' + modeLabel + ' · Claude AI · Tagalog→English'
    + '</div>'
    + '<div style="font-weight:700;font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Summary</div>'
    + '<div style="line-height:1.8;color:var(--text-2);font-size:14px;margin-bottom:18px">' + _escHtml(s.summary) + '</div>'
    + (keyPtsHtml ? '<div style="font-weight:700;font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Key Points</div><ul style="padding-left:20px;color:var(--text-2);font-size:13.5px;margin-bottom:18px">' + keyPtsHtml + '</ul>' : '')
    + (termsHtml  ? '<div style="font-weight:700;font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Key Terms</div><div style="margin-bottom:16px">' + termsHtml + '</div>' : '')
    + '<div style="padding-top:14px;border-top:1px solid var(--border-2);display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn btn-primary btn-sm" onclick="downloadSummaryPDF()" style="font-size:12px">📥 Download PDF</button>'
    + '<button class="btn btn-ghost btn-sm" onclick="copySummaryText(this)" style="font-size:12px">📋 Copy Text</button>'
    + '<button class="btn btn-ghost btn-sm" onclick="shareCurrentSummary(this,s)" style="font-size:12px;background:var(--green-dim);color:var(--green)">📌 Share with Students</button>'
    + '</div>';
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOCAL NLP FALLBACK — improved accuracy
═══════════════════════════════════════════════════════════════════════════ */
function _nlpSummarize(text) {
  var STOP = new Set([
    'the','a','an','is','it','in','on','at','to','of','and','or','but','for','with',
    'this','that','was','are','be','as','by','from','have','has','had','been','do',
    'did','will','would','could','should','may','might','not','no','so','if','then',
    'also','which','when','where','how','what','who','its','he','she','they','we',
    'you','i','me','my','your','his','her','our','their','its','than','just','been',
    // Tagalog stop words
    'na','ng','sa','mga','ay','at','si','ni','ito','iyan','siya','sila','kami',
    'kayo','tayo','nang','po','ho','ba','din','rin','lang','yung','kasi','pero'
  ]);

  var clean = text.replace(/\s+/g, ' ').trim();
  var wordCount = clean.split(/\s+/).length;

  // Split into sentences — support Filipino sentence patterns
  var sentences = clean
    .replace(/([.!?؟])\s+/g, '$1\n')
    .split('\n')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s.length > 25 && s.split(/\s+/).length > 4; });

  if (!sentences.length) {
    return { html: '<p style="color:var(--text-3)">Text too short to summarize.</p>', plain:'', title:'Lesson Summary', wordCount:wordCount };
  }

  // Word frequency (TF-style)
  var freq = {};
  clean.toLowerCase().split(/\s+/).forEach(function(w) {
    var clean_w = w.replace(/[^a-z]/g, '');
    if (clean_w.length > 3 && !STOP.has(clean_w)) freq[clean_w] = (freq[clean_w] || 0) + 1;
  });

  // Score sentences by contained keyword frequency
  var scored = sentences.map(function(s) {
    var words = s.toLowerCase().split(/\s+/);
    var score = words.reduce(function(sum, w) {
      return sum + (freq[w.replace(/[^a-z]/g, '')] || 0);
    }, 0) / Math.max(1, words.length);
    return { s: s, score: score };
  });

  // Pick top N preserving original order
  var topN = Math.min(6, Math.max(3, Math.ceil(sentences.length * 0.28)));
  var topIdxs = scored
    .map(function(item, i) { return { idx:i, score:item.score }; })
    .sort(function(a,b) { return b.score - a.score; })
    .slice(0, topN)
    .map(function(x) { return x.idx; })
    .sort(function(a,b) { return a-b; });

  var topSentences = topIdxs.map(function(i) { return sentences[i]; });
  var summaryText  = topSentences.join('. ').replace(/\.\./g, '.') + '.';

  // Top terms for title + tags
  var sortedTerms = Object.entries(freq)
    .sort(function(a,b) { return b[1]-a[1]; })
    .slice(0, 10)
    .map(function(e) { return e[0]; });
  var title = sortedTerms.slice(0,4).map(function(w){ return w.charAt(0).toUpperCase()+w.slice(1); }).join(', ') || 'Lesson Summary';
  var termsHtml = sortedTerms.map(function(t) {
    return '<span style="display:inline-block;padding:3px 10px;border-radius:99px;background:var(--brand-dim);color:var(--brand);font-size:12px;font-weight:600;margin:2px">' + t + '</span>';
  }).join('');

  var html = '<div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px">📝 ' + _escHtml(title) + '</div>'
    + '<div style="font-size:12px;color:var(--text-3);margin-bottom:14px;font-family:var(--mono)">'
    + wordCount + ' words · ' + sentences.length + ' sentences → ' + topSentences.length + ' key points · Local NLP'
    + '</div>'
    + '<div style="font-weight:700;font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Summary</div>'
    + '<div style="line-height:1.8;color:var(--text-2);font-size:14px;margin-bottom:18px">' + _escHtml(summaryText) + '</div>'
    + (termsHtml ? '<div style="font-weight:700;font-size:12px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Key Terms</div><div style="margin-bottom:16px">' + termsHtml + '</div>' : '')
    + '<div style="padding-top:14px;border-top:1px solid var(--border-2);display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn btn-primary btn-sm" onclick="downloadSummaryPDF()" style="font-size:12px">📥 Download PDF</button>'
    + '<button class="btn btn-ghost btn-sm" onclick="copySummaryText(this)" style="font-size:12px">📋 Copy Text</button>'
    + '<button class="btn btn-ghost btn-sm" onclick="shareCurrentSummary(this,s)" style="font-size:12px;background:var(--green-dim);color:var(--green)">📌 Share with Students</button>'
    + '</div>';

  return { html:html, plain:summaryText, title:title, wordCount:wordCount };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PDF DOWNLOAD — jsPDF (real PDF file, not print dialog)
═══════════════════════════════════════════════════════════════════════════ */
window.downloadSummaryPDF = function() {
  // Find the visible summary panel
  var panels = ['mic-result','file-result','text-result'];
  var resultEl = null;
  panels.forEach(function(id) { var e = window.el(id); if (e && e.classList.contains('show')) resultEl = e; });
  if (!resultEl) { window.toast('No summary to download', 'orange'); return; }

  var titleEl = resultEl.querySelector('div[style*="font-weight:800"]');
  var title   = titleEl ? titleEl.innerText.replace(/^📝\s*/, '').trim() : 'Lesson Summary';
  var date    = new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });

  function _generate(jsPDF) {
    var doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    var margin   = 20;
    var pageW    = doc.internal.pageSize.getWidth();
    var pageH    = doc.internal.pageSize.getHeight();
    var maxWidth = pageW - margin * 2;
    var y        = margin;

    function addText(text, size, style, color, extraY) {
      doc.setFontSize(size);
      doc.setFont('helvetica', style || 'normal');
      doc.setTextColor.apply(doc, color || [30, 30, 50]);
      if (extraY) y += extraY;
      var lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach(function(line) {
        if (y + size * 0.4 > pageH - margin) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += size * 0.45;
      });
    }

    // Header bar
    doc.setFillColor(59, 91, 219);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('SmartClass · Lesson Summarizer · ' + date, margin, 9);
    y = 22;

    // Title
    addText(title, 18, 'bold', [30, 30, 50]);
    y += 4;

    // Pull all text out of the result element in a clean format
    var sections = resultEl.querySelectorAll('[style*="text-transform:uppercase"]');
    var sectionNames = Array.from(sections).map(function(s){ return s.innerText.trim(); });
    var fullText     = resultEl.innerText || resultEl.textContent || '';

    // Remove duplicate title and buttons text
    fullText = fullText
      .replace(/📝\s*[^\n]+\n/, '')
      .replace(/📥 Download PDF/g, '')
      .replace(/📋 Copy Text/g, '')
      .trim();

    // Split by section headers (uppercase words)
    var blocks = fullText.split(/\n{2,}/);
    blocks.forEach(function(block) {
      block = block.trim();
      if (!block || block.length < 3) return;
      var isHeader = block === block.toUpperCase() && block.length < 60;
      if (isHeader) {
        y += 4;
        addText(block, 10, 'bold', [100, 110, 150]);
        y += 1;
      } else {
        addText(block, 11, 'normal', [40, 40, 60]);
        y += 2;
      }
    });

    // Footer
    var totalPages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(160,160,180);
      doc.text('SmartClass v2.1 · Page ' + p + ' of ' + totalPages, margin, pageH - 8);
    }

    var safeTitle = title.replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    doc.save('SmartClass_Summary_' + safeTitle + '.pdf');
    window.toast('📥 PDF downloaded!', 'green');
  }

  // Load jsPDF lazily
  if (window.jspdf && window.jspdf.jsPDF) {
    _generate(window.jspdf.jsPDF);
  } else if (window.jsPDF) {
    _generate(window.jsPDF);
  } else {
    var s = document.createElement('script');
    s.src = JSPDF_CDN;
    s.onload = function() {
      var PDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!PDF) { window.toast('Could not load jsPDF — check internet', 'red'); return; }
      _generate(PDF);
    };
    s.onerror = function() { window.toast('Could not load jsPDF', 'red'); };
    document.head.appendChild(s);
  }
};

/* Copy summary text to clipboard */
window.copySummaryText = function(btn) {
  var panels = ['mic-result','file-result','text-result'];
  var text = '';
  panels.forEach(function(id) { var e = window.el(id); if (e && e.classList.contains('show')) text = e.innerText || ''; });
  if (!text) { window.toast('Nothing to copy', 'orange'); return; }
  navigator.clipboard.writeText(text.replace(/📥.*|📋.*/g,'').trim())
    .then(function() { window.toast('✓ Copied to clipboard', 'green'); if(btn) btn.textContent='✓ Copied!'; setTimeout(function(){if(btn)btn.textContent='📋 Copy Text';},2000); })
    .catch(function() { window.toast('Copy failed', 'red'); });
};

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════════════════════════════════ */
function _saveSummaryHistory(mode, title, plain, wordCount) {
  var hist = window.loadSumHistory();
  hist.push({ id:'SUM-'+Date.now(), date:new Date().toISOString(), mode:mode, title:title, text:(plain||'').slice(0,300), wordCount:wordCount });
  window.saveSumHistory(hist);
  if (typeof window.renderSumHistory === 'function') window.renderSumHistory();
}

window.renderSumHistory = function() {
  var body = window.el('sum-history-body'); if (!body) return;
  var hist = window.loadSumHistory().reverse();
  if (!hist.length) { body.innerHTML = '<div style="text-align:center;color:var(--text-3);font-size:13px;padding:20px">No summaries yet.</div>'; return; }
  var icons = { mic:'🎙️', file:'📄', text:'📝' };
  body.innerHTML = hist.slice(0,10).map(function(h) {
    var d = new Date(h.date).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return '<div style="padding:12px 0;border-bottom:1px solid var(--border-2);display:flex;gap:12px;align-items:flex-start">'
      + '<div style="font-size:20px;flex-shrink:0">'+(icons[h.mode]||'📝')+'</div>'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:700;color:var(--text)">'+_escHtml(h.title)+'</div>'
      + '<div style="font-size:12px;color:var(--text-3);margin-top:2px">'+d+' · '+h.wordCount+' words</div>'
      + '<div style="font-size:12px;color:var(--text-2);margin-top:4px;line-height:1.5">'+_escHtml((h.text||'').slice(0,120))+'…</div>'
      + '</div>'
      + '<button class="btn btn-sm" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red);padding:5px 10px;font-size:11px" '
      + 'onclick="deleteSummary(\''+h.id+'\')" title="Delete this summary">🗑️</button>'
      + '</div>';
  }).join('');
};

/* ═══════════════════════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════════════════════ */
function _escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Share Summary with Students ─────────────────────────────────────────────── */
window.shareCurrentSummary = function(btn, summaryData) {
  if (btn) { btn.textContent = 'Sharing…'; btn.disabled = true; }
  // Pull latest summary data from visible panel
  var panels   = ['mic-result','file-result','text-result'];
  var resultEl = null;
  panels.forEach(function(id) { var e = window.el(id); if (e && e.classList.contains('show')) resultEl = e; });

  if (!resultEl) { window.toast('No summary to share', 'orange'); if (btn) { btn.textContent = '📌 Share with Students'; btn.disabled = false; } return; }

  // Extract data from the rendered HTML
  var titleEl = resultEl.querySelector('[style*="font-weight:800"]');
  var title   = titleEl ? titleEl.innerText.replace(/^📝\s*/,'').trim() : 'Lesson Summary';
  var content = resultEl.innerText || '';

  // Use summaryData if provided (from AI result), else build from text
  var s = (typeof summaryData === 'object' && summaryData) ? summaryData : null;
  var summary   = s ? s.summary   : content.slice(0, 1000);
  var keyPoints = s ? (s.keyPoints || []) : [];
  var keyTerms  = s ? (s.keyTerms  || []) : [];
  var wordCount = s ? (s.wordCount || 0)  : content.split(/\s+/).length;

  if (typeof window.shareNoteWithStudents === 'function') {
    window.shareNoteWithStudents(title, summary, keyPoints, keyTerms, wordCount);
  } else {
    window.toast('shareNoteWithStudents not loaded', 'red');
  }

  setTimeout(function() {
    if (btn) { btn.textContent = '✅ Shared!'; btn.disabled = false; }
  }, 2000);
};
/* ═══════════════════════════════════════════════════════════════════════════
   OLLAMA STATUS CHECK — shown on Settings page
═══════════════════════════════════════════════════════════════════════════ */
window.checkOllamaStatus = function() {
  var badge = document.getElementById('ollama-status');
  if (!badge) return;
  badge.textContent = '⏳ Checking…';
  badge.style.background = 'var(--orange-dim)';
  badge.style.color = 'var(--orange)';

  fetch(window.API_BASE + '/summarize.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'ping', mode: 'text' })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (d.code === 'OLLAMA_OFFLINE') {
      badge.textContent = '● Offline — run: ollama serve';
      badge.style.background = 'var(--red-dim)';
      badge.style.color = 'var(--red)';
    } else if (d.code === 'MODEL_NOT_FOUND') {
      badge.textContent = '● Model missing — see config.php';
      badge.style.background = 'var(--red-dim)';
      badge.style.color = 'var(--red)';
    } else if (d.code === 'TOO_SHORT') {
      // API reachable and Ollama is up — "ping" was too short to summarize (expected)
      badge.textContent = '● Active (Ollama running)';
      badge.style.background = 'var(--green-dim)';
      badge.style.color = 'var(--green)';
    } else if (d.ok) {
      badge.textContent = '● Active';
      badge.style.background = 'var(--green-dim)';
      badge.style.color = 'var(--green)';
    } else {
      badge.textContent = '● Error: ' + (d.error || 'unknown');
      badge.style.background = 'var(--red-dim)';
      badge.style.color = 'var(--red)';
    }
  })
  .catch(function() {
    badge.textContent = '● PHP API offline (XAMPP?)';
    badge.style.background = 'var(--red-dim)';
    badge.style.color = 'var(--red)';
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   DELETE SUMMARY FUNCTIONS
═══════════════════════════════════════════════════════════════════════════ */

/**
 * Delete a single summary from history by ID
 */
window.deleteSummary = function(summaryId) {
  if (!summaryId) return;
  
  // Confirm deletion
  if (!confirm('Delete this summary? This action cannot be undone.')) return;
  
  var hist = window.loadSumHistory();
  var filtered = hist.filter(function(item) { return item.id !== summaryId; });
  
  if (filtered.length === hist.length) {
    window.toast('❌ Summary not found', 'red');
    return;
  }
  
  window.saveSumHistory(filtered);
  window.renderSumHistory();
  window.toast('✅ Summary deleted', 'green');
  window.log('🗑️ Deleted summary: ' + summaryId, 'orange');
};

/**
 * Clear all summary history
 */
window.clearAllSummaries = function() {
  var hist = window.loadSumHistory();
  
  if (!hist || hist.length === 0) {
    window.toast('No summaries to clear', 'orange');
    return;
  }
  
  // Confirm clearing all
  var count = hist.length;
  if (!confirm('Delete all ' + count + ' summar' + (count === 1 ? 'y' : 'ies') + '? This action cannot be undone.')) return;
  
  window.saveSumHistory([]);
  window.renderSumHistory();
  window.toast('✅ All summaries cleared (' + count + ' deleted)', 'green');
  window.log('🗑️ Cleared all summary history (' + count + ' items)', 'orange');
};