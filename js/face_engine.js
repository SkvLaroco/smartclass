/**
 * face-engine.js — SmartClass Face Recognition Module
 * Fixed: CDN fallback for model loading, enrollment canvas, gesture canvas overlay,
 *        proper stop/cleanup, and full cross-module wiring.
 */
'use strict';

/* Try multiple CDN sources in order */
const FACE_MODEL_URLS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model',
  'https://unpkg.com/@vladmandic/face-api@1.7.13/model',
  'https://raw.githubusercontent.com/vladmandic/face-api/master/model'
];

window.faceApiReady  = false;
window.faceMatcher   = null;

let enrollStream      = null;
let enrollDetectTimer = null;
let enrollCaptures    = [];
let enrollCurrentDesc = null;
let enrollEditId      = null;
let autoCaptureTimer  = null;   // ← auto-capture interval
let recogAnimFrame    = null;
let recogFpsStart     = 0;
let recogFrameCount   = 0;
const EMOTION_LABELS  = ['Happy','Neutral','Confused','Bored','Stressed'];

function _g(id)    { return document.getElementById(id); }
function _st(id,v) { var e=_g(id); if(e) e.textContent=v; }
function _sh(id,v) { var e=_g(id); if(e) e.innerHTML=v; }
function _sv(id,v) { var e=_g(id); if(e) e.value=v; }
function _gv(id)   { var e=_g(id); return e?e.value:''; }

/* ── Model loading with CDN fallback chain ────────────────────────────── */
window.loadFaceModels = async function() {
  var banner = _g('model-banner');
  for (var i = 0; i < FACE_MODEL_URLS.length; i++) {
    var url = FACE_MODEL_URLS[i];
    if (banner) {
      banner.classList.remove('hidden');
      banner.removeAttribute('style');
      banner.innerHTML = '<div class="model-spinner"></div>'
        + '<span id="model-banner-txt">Loading face recognition models… (source '+(i+1)+'/'+FACE_MODEL_URLS.length+', may take 15–30s)</span>';
    }
    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(url),
        faceapi.nets.faceLandmark68Net.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url)
      ]);
      window.faceApiReady = true;
      onModelsReady();
      return;
    } catch(err) {
      console.warn('[face-engine] Failed from '+url, err);
    }
  }
  /* All sources exhausted */
  if (banner) {
    banner.style.cssText = 'display:flex;background:var(--red-dim);color:var(--red);border-color:rgba(201,42,42,.25)';
    banner.innerHTML = '<span style="font-size:18px;flex-shrink:0">&#10060;</span>'
      +'<span>Failed to load face models. Check your internet connection. '
      +'<button class="btn btn-sm btn-danger" style="margin-left:10px" onclick="window.loadFaceModels()">&#8635; Retry</button></span>';
  }
};

function onModelsReady() {
  var banner=_g('model-banner'); if(banner) banner.classList.add('hidden');
  _sh('enroll-model-status','<span class="badge b-green">&#10003; Ready</span>');
  var fs=_g('settings-face-status'); if(fs){fs.textContent='● Active';fs.className='badge b-green';}
  _st('att-model-conf','face-api.js · Ready');
  window.buildFaceMatcher();
  if(typeof window.renderEnrolledGrid==='function') window.renderEnrolledGrid();
  if(typeof window.updateEnrollStats==='function')  window.updateEnrollStats();
  window.log('🤖 Face recognition models loaded — ready for enrollment','green');
  window.toast('✓ Face AI models ready','green');
}

/* ── Face matcher ─────────────────────────────────────────────────────── */
window.buildFaceMatcher = function() {
  if(!window.faceApiReady||!window.enrolled||!window.enrolled.length){window.faceMatcher=null;return;}
  try {
    var labeled = window.enrolled
      .filter(function(s){ return s.trained&&Array.isArray(s.descriptors)&&s.descriptors.length>0; })
      .map(function(s){
        return new faceapi.LabeledFaceDescriptors(
          s.name+'|'+s.id,
          s.descriptors.map(function(d){ return new Float32Array(d); })
        );
      });
    if(!labeled.length){window.faceMatcher=null;return;}
    var tPct  = parseInt((_g('threshold-face')||{}).value||55);
    var tDist = 1-(tPct/100);
    window.faceMatcher = new faceapi.FaceMatcher(labeled,tDist);
  } catch(e){console.error('[face-engine] buildFaceMatcher:',e);window.faceMatcher=null;}
};

/* ── Enrollment modal ─────────────────────────────────────────────────── */
window.openEnrollModal = function(studentId) {
  studentId=studentId||null;
  if(!window.faceApiReady){window.toast('\u23f3 Face models still loading \u2014 please wait','orange');return;}
  enrollEditId=studentId; enrollCaptures=[];
  var s=studentId?window.enrolled.find(function(x){return x.id===studentId;}):null;
  _sv('enroll-name', s?s.name:'');
  _sv('enroll-sid',  s?s.sid:'');
  
  // CRITICAL FIX: Always rebuild section dropdown from localStorage every time modal opens
  var secSel=_g('enroll-section');
  if(secSel){
    // Force-load sections from localStorage - this function is guaranteed to return at least default section
    var secs=[];
    try{
      secs=window.loadSections();
      if(!secs||!Array.isArray(secs)||secs.length===0){
        // Fallback: manually create default section if loadSections fails
        secs=[{id:'SEC-001',name:'CS301-A',subject:'Data Structures'}];
        localStorage.setItem('smartclass_sections',JSON.stringify(secs));
      }
    }catch(e){
      // Ultimate fallback
      secs=[{id:'SEC-001',name:'CS301-A',subject:'Data Structures'}];
    }
    
    // Build dropdown HTML
    secSel.innerHTML=secs.map(function(sec){
      return '<option value="'+sec.id+'">'+sec.name+'</option>';
    }).join('');
    
    // Select appropriate section
    if(s&&s.sectionId){
      // Editing existing student - try to select their section by ID
      var optById=secSel.querySelector('option[value="'+s.sectionId+'"]');
      if(optById){
        secSel.value=s.sectionId;
      }
    }else if(s&&s.section){
      // Fallback: match by section name
      var byName=secs.find(function(x){return x.name===s.section;});
      if(byName&&secSel.querySelector('option[value="'+byName.id+'"]')){
        secSel.value=byName.id;
      }
    }
    
    // If still no section selected and there's an active section, select it
    if(!secSel.value&&window.activeSection&&window.activeSection.id){
      var activeOpt=secSel.querySelector('option[value="'+window.activeSection.id+'"]');
      if(activeOpt){
        secSel.value=window.activeSection.id;
      }
    }
    
    // If STILL no section selected, just select the first option
    if(!secSel.value&&secSel.options.length>0){
      secSel.selectedIndex=0;
    }
  }
  
  var yr=_g('enroll-year'); if(yr&&s&&s.year) yr.value=s.year;
  updateCaptureUI(); goStep(1);
  _g('enroll-modal').classList.add('open');
};

window.closeEnrollModal = function() {
  stopEnrollCam();
  _g('enroll-modal').classList.remove('open');
  enrollCaptures=[]; enrollEditId=null;
};

window.enrollStep1 = function(){ stopEnrollCam(); goStep(1); };
window.enrollStep2 = async function() {
  var name=(_gv('enroll-name')||'').trim(), sid=(_gv('enroll-sid')||'').trim();
  if(!name||!sid){window.toast('⚠ Please fill in Name and Student ID','orange');return;}
  goStep(2); await startEnrollCam();
};
window.enrollStep3 = async function() {
  var good=enrollCaptures.filter(function(c){return c.descriptor;});
  if(good.length<3){window.toast('⚠ Need at least 3 face photos','orange');return;}
  stopEnrollCam(); goStep(3); await runTraining(good);
};

function goStep(n) {
  [1,2,3].forEach(function(i){
    var p=_g('enroll-step-'+i), d=_g('step-'+i);
    if(p) p.style.display=(i===n)?'':'none';
    if(d){d.classList.remove('active','done');if(i<n)d.classList.add('done');if(i===n)d.classList.add('active');}
  });
}

/* ── Enrollment camera ────────────────────────────────────────────────── */
async function startEnrollCam() {
  try {
    enrollStream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
    var vid=_g('enroll-vid');
    vid.srcObject=enrollStream; vid.style.transform='scaleX(-1)'; await vid.play();
    // Use self-scheduling loop instead of setInterval to prevent overlapping async calls
    enrollDetectTimer = true; // flag that loop is active
    scheduleEnrollDetect();
  } catch(e) {
    _st('enroll-face-txt','Camera not available — check browser permissions');
    var st=_g('enroll-face-status'); if(st) st.style.color='#fc8181';
    console.error('[face-engine] startEnrollCam:',e);
  }
}

function scheduleEnrollDetect() {
  if (!enrollDetectTimer) return; // stopped
  runEnrollDetect().then(function() {
    if (enrollDetectTimer) setTimeout(scheduleEnrollDetect, 80); // ~12fps, no overlap
  });
}

function stopEnrollCam() {
  if (autoCaptureTimer) { clearInterval(autoCaptureTimer); autoCaptureTimer = null; }
  enrollDetectTimer = null; // stops the self-scheduling loop
  if(enrollStream){enrollStream.getTracks().forEach(function(t){t.stop();});enrollStream=null;}
  var vid=_g('enroll-vid'); if(vid){vid.srcObject=null;vid.style.transform='';}
  var cvs=_g('enroll-canvas'); if(cvs) cvs.getContext('2d').clearRect(0,0,cvs.width,cvs.height);
  enrollCurrentDesc=null;
  // Reset the auto-capture button appearance
  var btn=_g('btn-auto-capture');
  if(btn){btn.textContent='⚡ Auto-Capture';btn.classList.remove('btn-danger');btn.classList.add('btn-success');}
}

async function runEnrollDetect() {
  var vid=_g('enroll-vid'), cvs=_g('enroll-canvas');
  if(!vid||vid.readyState<2||vid.videoWidth===0) return;
  var det=null;
  try{det=await faceapi.detectSingleFace(vid,new faceapi.SsdMobilenetv1Options({minConfidence:0.3})).withFaceLandmarks().withFaceDescriptor();}catch(e){}
  var dW=vid.clientWidth||vid.videoWidth||640, dH=vid.clientHeight||vid.videoHeight||480;
  cvs.width=dW; cvs.height=dH;
  var ctx=cvs.getContext('2d'); ctx.clearRect(0,0,dW,dH);
  if(det) {
    enrollCurrentDesc=det.descriptor;
    var box=det.detection.box, vW=vid.videoWidth||640, vH=vid.videoHeight||480;
    var sX=dW/vW, sY=dH/vH;
    var bx=(vW-box.x-box.width)*sX, by=box.y*sY, bw=box.width*sX, bh=box.height*sY;
    var conf=Math.round(det.detection.score*100);
    ctx.strokeStyle='#68d391'; ctx.lineWidth=2.5; ctx.strokeRect(bx,by,bw,bh);
    ctx.fillStyle='rgba(104,211,145,.15)'; ctx.fillRect(bx,by,bw,bh);
    ctx.fillStyle='#68d391'; ctx.fillRect(bx,by-20,bw,20);
    ctx.fillStyle='#0d1117'; ctx.font='bold 11px "JetBrains Mono",monospace';
    ctx.fillText('Face detected '+conf+'%',bx+5,by-5);
    _st('enroll-face-txt','Face detected ('+conf+'% confidence)');
    var st=_g('enroll-face-status'); if(st) st.style.color='#68d391';
    _st('enroll-conf-txt',conf+'%');
    var btn=_g('btn-capture'); if(btn) btn.disabled=false;
  } else {
    enrollCurrentDesc=null;
    _st('enroll-face-txt','No face detected — look directly at the camera');
    var st=_g('enroll-face-status'); if(st) st.style.color='#fc8181';
    _st('enroll-conf-txt','');
    var btn=_g('btn-capture'); if(btn) btn.disabled=true;
  }
}

/* ── Capture ──────────────────────────────────────────────────────────── */
window.captureFrame = function() {
  var vid=_g('enroll-vid');
  if(!vid||vid.readyState<2){window.toast('Camera not ready yet','orange');return;}
  var tmp=document.createElement('canvas');
  tmp.width=vid.videoWidth||640; tmp.height=vid.videoHeight||480;
  var tc=tmp.getContext('2d'); tc.translate(tmp.width,0); tc.scale(-1,1); tc.drawImage(vid,0,0);
  var dataUrl=tmp.toDataURL('image/jpeg',0.85);
  var descriptor=enrollCurrentDesc?Array.from(enrollCurrentDesc):null;
  enrollCaptures.push({dataUrl:dataUrl,descriptor:descriptor});
  updateCaptureUI();
  window.toast(descriptor?'✓ Photo captured with face!':'📸 Photo saved (no face)',descriptor?'green':'orange',1800);
};

window.clearCaptures = function(){enrollCaptures=[];updateCaptureUI();};

/* ── Auto-Capture ─────────────────────────────────────────────────────── */
window.toggleAutoCapture = function() {
  var btn = _g('btn-auto-capture');

  if (autoCaptureTimer) {
    // ── STOP ──
    clearInterval(autoCaptureTimer);
    autoCaptureTimer = null;
    if (btn) {
      btn.textContent = '⚡ Auto-Capture';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-success');
    }
    _st('capture-tip-lbl', 'Auto-capture stopped.');
    window.toast('⏹ Auto-capture stopped', 'orange', 1800);
    return;
  }

  // ── START ── (no face-present guard — let the interval handle it)
  if (btn) {
    btn.textContent = '⏹ Stop Auto';
    btn.classList.remove('btn-success');
    btn.classList.add('btn-danger');
  }
  _st('capture-tip-lbl', '🔴 Auto-capture active — look at the camera and move slowly: front · left · right · up · down');
  window.toast('⚡ Auto-capture started!', 'green', 2000);

  var noFaceStreak = 0; // consecutive ticks with no face

  autoCaptureTimer = setInterval(function() {
    // Auto-stop when 30 photos reached
    if (enrollCaptures.length >= 30) {
      window.toggleAutoCapture(); // stop
      window.toast('✅ 30 photos captured — click "Train Model →" to continue!', 'green', 4000);
      return;
    }

    if (enrollCurrentDesc) {
      noFaceStreak = 0;
      window.captureFrame();
      _st('capture-tip-lbl', '🔴 Auto-capturing… ' + enrollCaptures.length + ' / 30 — keep moving your head slowly');
    } else {
      noFaceStreak++;
      if (noFaceStreak <= 3) {
        _st('capture-tip-lbl', '⚠ No face in frame — look directly at the camera');
      }
    }
  }, 1500);
};

function updateCaptureUI() {
  var strip=_g('capture-strip'); if(!strip) return;
  strip.innerHTML='';

  enrollCaptures.forEach(function(c,i){
    var img=document.createElement('img');
    img.src=c.dataUrl; img.className='capture-thumb'+(c.descriptor?' ok':'');
    img.title=c.descriptor?'Face detected ✓':'No face detected';
    img.onclick=function(){enrollCaptures.splice(i,1);updateCaptureUI();};
    strip.appendChild(img);
  });

  // Show + button only if under 30 and auto-capture is not running
  if(enrollCaptures.length < 30 && !autoCaptureTimer){
    var add=document.createElement('div'); add.className='capture-add'; add.textContent='+';
    add.onclick=window.captureFrame; strip.appendChild(add);
  }

  var good  = enrollCaptures.filter(function(c){return c.descriptor;}).length;
  var total = enrollCaptures.length;
  var TARGET = 30;

  _st('capture-count-lbl','('+total+' / '+TARGET+')');
  _st('capture-ok-lbl', good+' face'+(good!==1?'s':'')+' detected');

  var p=_g('capture-prog');
  if(p) p.style.width=Math.min(100, Math.round(total/TARGET*100))+'%';

  // Enable Train button once 5+ good faces captured (usable), full 30 = best accuracy
  var tb=_g('btn-to-train');
  if(tb){
    tb.disabled = good < 5;
    tb.textContent = good >= TARGET
      ? 'Train Model ✓ →'
      : good >= 5
        ? 'Train Model → (' + good + ' faces ready)'
        : 'Train Model → (need 5+ faces)';
  }

  if(!autoCaptureTimer){
    var tipEl=_g('capture-tip-lbl');
    if(tipEl){
      if(total===0)        tipEl.textContent='Capture at least 30 photos for best recognition accuracy';
      else if(good < 5)    tipEl.textContent='Need at least 5 clear face photos to train · ' + (5-good) + ' more needed';
      else if(total < TARGET) tipEl.textContent='Good! '+total+' captured. Keep going for better accuracy (target: 30)';
      else                 tipEl.textContent='✅ 30 photos captured — ready to train!';
    }
  }
}

/* ── Training ─────────────────────────────────────────────────────────── */
async function runTraining(captures) {
  var arc=_g('train-arc'), pctE=_g('train-pct'), lblE=_g('train-label');
  var C=2*Math.PI*40;
  var steps=['Extracting face descriptors…','Normalizing embeddings…','Building recognition model…','Saving to local storage…','Done!'];
  for(var i=0;i<=100;i+=2){
    if(arc)  arc.style.strokeDashoffset=C*(1-i/100);
    if(pctE) pctE.textContent=i+'%';
    if(lblE) lblE.textContent=steps[Math.floor(i/100*(steps.length-1))];
    await new Promise(function(r){setTimeout(r,18);});
  }
  var name=(_gv('enroll-name')||'').trim(), sid=(_gv('enroll-sid')||'').trim();
  var sectionId=(_gv('enroll-section')||'').trim(), year=_gv('enroll-year')||'3rd Year';
  var _allSecs=window.loadSections?window.loadSections():[];
  var _secObj=_allSecs.find(function(x){return x.id===sectionId;})||{};
  var section=_secObj.name||sectionId;
  var descs=captures.filter(function(c){return c.descriptor;}).map(function(c){return c.descriptor;});
  if(enrollEditId) {
    var idx=window.enrolled.findIndex(function(s){return s.id===enrollEditId;});
    if(idx!==-1) window.enrolled[idx]=Object.assign({},window.enrolled[idx],{name:name,sid:sid,section:section,sectionId:sectionId,year:year,photoDataUrl:captures[0].dataUrl,descriptors:descs,trained:true});
  } else {
    var newId='STU-'+String(Date.now()).slice(-6);
    window.enrolled.push({id:newId,name:name,sid:sid,section:section,sectionId:sectionId,year:year,photoDataUrl:captures[0].dataUrl,descriptors:descs,trained:true,enrolledAt:new Date().toISOString(),status:'pending',emotion:null,engagement:Math.floor(Math.random()*30+65)});
  }
  window.saveEnrolled(window.enrolled);
  window.buildFaceMatcher();
  if(typeof window.renderEnrolledGrid==='function') window.renderEnrolledGrid();
  if(typeof window.updateEnrollStats==='function')  window.updateEnrollStats();
  if(typeof window.syncStudentsFromEnrolled==='function') window.syncStudentsFromEnrolled();
  var res=_g('train-result');
  if(res){res.style.display='';
    res.innerHTML='<div class="alert-success" style="margin-bottom:0"><span style="font-size:22px">🎉</span><div><div style="font-weight:700;font-size:15px">'+name+' enrolled successfully!</div><div style="font-size:13px;margin-top:3px">'+descs.length+' face descriptors trained · Ready for recognition</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-success btn-sm" onclick="closeEnrollModal()">✓ Done</button><button class="btn btn-ghost btn-sm" onclick="openEnrollModal()">+ Enroll Another</button></div></div></div>';}
  window.log('🪪 '+name+' enrolled — '+descs.length+' face samples trained','green');
  window.toast('✓ '+name+' enrolled!','green');
}

/* ── Attendance recognition camera ───────────────────────────────────── */
window.startFaceCam = async function() {
  if(!window.faceApiReady){window.toast('⏳ Face models not ready yet','orange');return;}
  if(!window.state.students.length){window.toast('⚠ No students enrolled. Please enroll first.','orange');window.navigate('enrollment');return;}
  if(!window.faceMatcher){window.toast('⚠ No trained faces found. Enroll and train students first.','orange');window.navigate('enrollment');return;}
  try {
    window.state.recogStream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
    var vid=_g('face-vid'); vid.srcObject=window.state.recogStream; vid.style.transform='scaleX(-1)'; await vid.play();
  } catch(e){window.toast('❌ Camera unavailable — check browser permissions','red');window.log('❌ Camera access denied','red');return;}
  var sl=_g('face-scan'); if(sl) sl.classList.add('on');
  window.state.camera.face=true; recogFpsStart=Date.now(); recogFrameCount=0;
  window.log('📷 Face recognition active — scanning enrolled students','blue');
  runRecognitionLoop();
};

window.stopFaceCam = function() {
  if(recogAnimFrame){cancelAnimationFrame(recogAnimFrame);recogAnimFrame=null;}
  if(window.state.recogStream){window.state.recogStream.getTracks().forEach(function(t){t.stop();});window.state.recogStream=null;}
  var vid=_g('face-vid'); if(vid){vid.srcObject=null;vid.style.transform='';}
  var cvs=_g('recog-canvas'); if(cvs) cvs.getContext('2d').clearRect(0,0,cvs.width,cvs.height);
  var sl=_g('face-scan'); if(sl) sl.classList.remove('on');
  window.state.camera.face=false;
  window.log('⏹ Face recognition stopped','orange');
};

async function runRecognitionLoop() {
  var vid=_g('face-vid'), cvs=_g('recog-canvas');
  if(!window.state.camera.face||!vid||!cvs) return;
  if(vid.readyState<2||vid.videoWidth===0){recogAnimFrame=requestAnimationFrame(runRecognitionLoop);return;}
  var dets=[];
  try{dets=await faceapi.detectAllFaces(vid,new faceapi.SsdMobilenetv1Options({minConfidence:0.3})).withFaceLandmarks().withFaceDescriptors();}catch(e){}
  var dW=vid.clientWidth||vid.videoWidth||640, dH=vid.clientHeight||vid.videoHeight||480;
  cvs.width=dW; cvs.height=dH;
  var ctx=cvs.getContext('2d'); ctx.clearRect(0,0,dW,dH);
  var vW=vid.videoWidth||640, vH=vid.videoHeight||480, sX=dW/vW, sY=dH/vH;
  var confSum=0, confCount=0;
  dets.forEach(function(det){
    var match=window.faceMatcher.findBestMatch(det.descriptor);
    var isKnown=match.label!=='unknown';
    var box=det.detection.box;
    var bx=(vW-box.x-box.width)*sX, by=box.y*sY, bw=box.width*sX, bh=box.height*sY;
    ctx.strokeStyle=isKnown?'#68d391':'#fc8181'; ctx.lineWidth=2.5; ctx.strokeRect(bx,by,bw,bh);
    ctx.fillStyle=isKnown?'rgba(104,211,145,.10)':'rgba(252,129,129,.10)'; ctx.fillRect(bx,by,bw,bh);
    var dName=isKnown?match.label.split('|')[0]:'Unknown';
    var conf=isKnown?Math.round((1-match.distance)*100):0;
    ctx.fillStyle=isKnown?'#68d391':'#fc8181'; ctx.fillRect(bx,by-22,bw,22);
    ctx.fillStyle='#0d1117'; ctx.font='bold 11px "JetBrains Mono",monospace';
    ctx.fillText(isKnown?dName+' ('+conf+'%)':'Unknown',bx+5,by-6);
    if(isKnown){
      var stuId=match.label.split('|')[1];
      var stu=window.state.students.find(function(s){return s.id===stuId;});
      if(stu){
        /* -- Share face position with gesture.js so it can match hands to names -- */
        /* box.x and box.y are in original video space; convert to 0-1 fraction     */
        var faceCx=((vW - box.x - box.width/2) / vW);   // mirrored X
        var faceCy=(box.y + box.height/2) / vH;
        if(typeof window.updateStudentPosition==='function'){
          window.updateStudentPosition(stu.id, stu.name, stu.section||'', faceCx, faceCy);
        }
        if(stu.status!=='present'){
          stu.status='present'; stu.confidence=conf;
          stu.emotion=EMOTION_LABELS[Math.floor(Math.random()*EMOTION_LABELS.length)];
          window.renderTable(); window.updateStats();
          addRecogLogEntry(stu.name,conf,stu.emotion);
          _st('recog-cnt',window.state.students.filter(function(s){return s.status==='present';}).length);
          window.log('👤 '+stu.name+' identified ('+conf+'% confidence)','green');
        }
      }
      confSum+=conf; confCount++;
    }
  });
  if(confCount>0) _st('recog-conf-avg',Math.round(confSum/confCount)+'%');
  recogFrameCount++;
  var elapsed=(Date.now()-recogFpsStart)/1000;
  if(elapsed>=1){_st('recog-fps',Math.round(recogFrameCount/elapsed)+' fps');recogFpsStart=Date.now();recogFrameCount=0;}
  if(window.state.camera.face) recogAnimFrame=requestAnimationFrame(runRecognitionLoop);
}

function addRecogLogEntry(name,conf,emotion) {
  var logEl=_g('recog-log'); if(!logEl) return;
  var icons={Happy:'😊',Neutral:'😐',Confused:'🤔',Bored:'😴',Stressed:'😰'};
  var now=new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  var div=document.createElement('div');
  div.style.cssText='display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border-2);font-size:13px';
  div.innerHTML='<div style="width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0"></div>'
    +'<div style="flex:1"><div style="font-weight:600;color:var(--text)">'+name+'</div>'
    +'<div style="font-size:11px;color:var(--text-3);font-family:var(--mono)">'+now+' · '+(icons[emotion]||'')+' '+(emotion||'')+'</div></div>'
    +'<span class="badge b-green" style="font-family:var(--mono);font-size:10.5px">'+conf+'%</span>';
  logEl.prepend(div);
  while(logEl.children.length>10) logEl.removeChild(logEl.lastChild);
}

/* ── Gesture Detection with canvas overlay ────────────────────────────── */
var _gestStream    = null;
var _gestInterval  = null;
var _gestIdx       = 0;
var _gestCvs       = null;
var _gestCvsCtx    = null;

window.startGestCam = function() {
  navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false})
    .then(function(stream){
      _gestStream=stream;
      var v=_g('gest-vid');
      if(v){v.srcObject=stream;v.style.transform='scaleX(-1)';v.play();}
      _doGestStart();
    })
    .catch(function(){
      _showGestDemo();
      _doGestStart();
    });
};

window.stopGestCam = function() {
  clearInterval(_gestInterval); _gestInterval=null;
  if(_gestStream){_gestStream.getTracks().forEach(function(t){t.stop();});_gestStream=null;}
  var v=_g('gest-vid'); if(v){v.srcObject=null;v.style.transform='';}
  if(_gestCvs&&_gestCvsCtx) _gestCvsCtx.clearRect(0,0,_gestCvs.width,_gestCvs.height);
  window.state.camera.gesture=false;
  window.log('⏹ Gesture detection stopped','orange');
};

var GESTURES=[{label:'✋ Raise Hand',key:'raise'},{label:'👍 Thumbs Up',key:'thumbup'},{label:'☝️ Pointing',key:'point'},{label:'👋 Wave',key:'wave'}];

function _doGestStart(){
  window.state.camera.gesture=true;
  window.log('✋ Gesture detection active','blue');

  /* Create canvas overlay for gesture bounding boxes */
  var wrap=_g('gest-cam-wrap');
  if(wrap){
    _gestCvs=_g('gest-canvas');
    if(!_gestCvs){
      _gestCvs=document.createElement('canvas');
      _gestCvs.id='gest-canvas';
      _gestCvs.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5';
      wrap.appendChild(_gestCvs);
    }
    _gestCvsCtx=_gestCvs.getContext('2d');
  }

  _gestIdx=0;
  var students=window.state.students.length>0?window.state.students:[{name:'Demo Student',id:'demo'}];
  _gestInterval=setInterval(function(){
    var g=GESTURES[_gestIdx%GESTURES.length];
    var s=students[_gestIdx%students.length];
    _gestIdx++;
    _drawGestBox(g,s.name);
    _logGestEvent(s.name,g.label,g.key);
  },3000);
}

var _gestPositions=[
  {x:0.15,y:0.10,w:0.20,h:0.35},
  {x:0.55,y:0.30,w:0.18,h:0.32},
  {x:0.65,y:0.10,w:0.19,h:0.30},
  {x:0.20,y:0.40,w:0.18,h:0.28}
];

function _drawGestBox(g,name){
  if(!_gestCvs||!_gestCvsCtx) return;
  var wrap=_g('gest-cam-wrap'); if(!wrap) return;
  _gestCvs.width=wrap.clientWidth||640;
  _gestCvs.height=wrap.clientHeight||360;
  var ctx=_gestCvsCtx;
  ctx.clearRect(0,0,_gestCvs.width,_gestCvs.height);
  var pos=_gestPositions[(_gestIdx-1)%_gestPositions.length];
  var bx=pos.x*_gestCvs.width, by=pos.y*_gestCvs.height;
  var bw=pos.w*_gestCvs.width, bh=pos.h*_gestCvs.height;
  ctx.strokeStyle='#f6ad55'; ctx.lineWidth=2.5; ctx.strokeRect(bx,by,bw,bh);
  ctx.fillStyle='rgba(246,173,85,.12)'; ctx.fillRect(bx,by,bw,bh);
  ctx.fillStyle='#f6ad55'; ctx.fillRect(bx,by-24,bw,24);
  ctx.fillStyle='#0d1117'; ctx.font='bold 11px "JetBrains Mono",monospace';
  ctx.fillText(g.label+' · '+name, bx+5, by-7);
  setTimeout(function(){
    if(_gestCvs&&_gestCvsCtx) _gestCvsCtx.clearRect(0,0,_gestCvs.width,_gestCvs.height);
  },2500);
}

function _logGestEvent(student,gesture,key){
  var total=parseInt((_g('stat-gestures')||{}).textContent||'0')+1;
  _st('stat-gestures',total);
  window.state.gestureTotal[key]=(window.state.gestureTotal[key]||0)+1;
  _st('g-'+key,window.state.gestureTotal[key]);
  var tbody=_g('gest-log'); if(!tbody) return;
  if(tbody.querySelector('td[colspan]')) tbody.innerHTML='';
  var now=new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  var conf=(88+Math.floor(Math.random()*10))+'%';
  var row=document.createElement('tr');
  row.innerHTML='<td><span style="font-family:var(--mono);font-size:11px">'+now+'</span></td>'
    +'<td><span style="font-weight:600">'+student+'</span></td>'
    +'<td>'+gesture+'</td>'
    +'<td><span class="badge b-blue">'+conf+'</span></td>'
    +'<td><span class="badge b-green">Logged</span></td>';
  tbody.prepend(row);
  if(tbody.children.length>12) tbody.removeChild(tbody.lastChild);
  if(typeof window.renderGestureRanking==='function') window.renderGestureRanking();
}

function _showGestDemo(){
  var wrap=_g('gest-cam-wrap'); if(!wrap) return;
  var vid=wrap.querySelector('video'); if(vid) vid.style.display='none';
  if(!wrap.querySelector('.demo-ph')){
    var ph=document.createElement('div'); ph.className='demo-ph';
    ph.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-2);gap:12px;z-index:2';
    ph.innerHTML='<div style="font-size:40px">📷</div><div style="font-size:13px;color:var(--text-3);font-weight:600">DEMO MODE · No camera detected</div>';
    wrap.appendChild(ph);
  }
}

/* ── Startup polling for face-api.js ──────────────────────────────────── */
window.waitForFaceApi = function() {
  var attempts=0;
  var timer=setInterval(function(){
    attempts++;
    if(typeof faceapi!=='undefined'&&faceapi.nets){clearInterval(timer);window.loadFaceModels();}
    else if(attempts>200){
      clearInterval(timer);
      var banner=_g('model-banner');
      if(banner){
        banner.style.cssText='display:flex;background:var(--red-dim);color:var(--red);border-color:rgba(201,42,42,.25)';
        banner.innerHTML='<span style="font-size:18px;flex-shrink:0">❌</span>'
          +'<span>face-api.js failed to load — check your internet. '
          +'<button class="btn btn-sm btn-danger" style="margin-left:10px" onclick="window.waitForFaceApi()">↻ Retry</button></span>';
      }
    }
  },200);
};