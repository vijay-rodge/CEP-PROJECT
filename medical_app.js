// HealthMate Medical Search – client app
// - Medical-only search via API with client fallback
// - Camera/Gallery OCR with preprocessing and suggestions
// - Structured result sections and related links
(function(){
  const $ = (s)=>document.querySelector(s);
  const $$ = (s)=>Array.from(document.querySelectorAll(s));

  // Cache UI elements once
  const ui = {
    themeBtn: $('#themeBtn'),
    backdrop: $('#backdrop'),
    searchInput: $('#searchInput'),
    searchBtn: $('#searchBtn'),
    imageBtn: $('#imageBtn'),
    resTitle: $('#resTitle'),
    resExtract: $('#resExtract'),
    openLink: $('#openLink'),
    chips: $('#chips'),
    imagePanel: $('#imagePanel'),
    camera: $('#camera'),
    video: $('#video'),
    canvas: $('#canvas'),
    captureBtn: $('#captureBtn'),
    closeCamBtn: $('#closeCamBtn'),
    ocrOut: $('#ocrOut'),
    toast: $('#toast'),
    imgChooser: $('#imgChooser'),
    chooseGallery: $('#chooseGallery'),
    chooseCamera: $('#chooseCamera'),
    galleryInput: $('#galleryInput')
  };

  // Suggestion list (used for quick picks and OCR detection hints)
  const SUGGESTIONS = [
    { name:'Migraine', cat:'neurological' },{ name:'Malaria', cat:'infectious' },{ name:'COVID-19', cat:'infectious' },
    { name:'Tuberculosis', cat:'infectious' },{ name:'Hepatitis B', cat:'infectious' },{ name:'Diabetes', cat:'chronic' },
    { name:'Hypertension', cat:'chronic' },{ name:'Asthma', cat:'respiratory' },{ name:'Pneumonia', cat:'respiratory' },
    { name:'Influenza', cat:'respiratory' },{ name:'Common Cold', cat:'respiratory' },{ name:'Anxiety', cat:'mental' },
    { name:'Depression', cat:'mental' },{ name:'Acidity', cat:'digestive' },{ name:'Stomach Ulcer', cat:'digestive' },
    { name:'Thyroid', cat:'chronic' },{ name:'Sinusitis', cat:'respiratory' },{ name:'Arthritis', cat:'chronic' },
    { name:'Eczema', cat:'skin' },{ name:'Psoriasis', cat:'skin' }
  ];
  let currentCategory = 'all'; // retained only for chip rendering

  // Track last search origin to tailor messaging
  let lastOrigin = 'text';

  function toast(msg,ms=2200){ ui.toast.textContent = msg; ui.toast.classList.add('show'); setTimeout(()=>ui.toast.classList.remove('show'), ms); }

  // Theme
  function applyTheme(){
    const t = localStorage.getItem('hm_theme')||'dark';
    document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');
    ui.themeBtn.querySelector('i').className = 'fa-solid ' + (t==='dark'?'fa-sun':'fa-moon');
  }
  function toggleTheme(){
    const t = localStorage.getItem('hm_theme')||'dark';
    localStorage.setItem('hm_theme', t==='dark'?'light':'dark');
    applyTheme();
  }

  // Render chips – show fewer on small screens
  function renderChips(){
    ui.chips.innerHTML = '';
    const list = (currentCategory==='all'?SUGGESTIONS:SUGGESTIONS.filter(x=>x.cat===currentCategory));
    const isMobile = (window.innerWidth || 0) <= 480;
    const max = isMobile ? Math.min(6, list.length) : Math.min(12, list.length);
    list.slice(0, max).forEach(item=>{
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = item.name;
      b.onclick = () => { ui.searchInput.value = item.name; doSearch(); };
      ui.chips.appendChild(b);
    });
  }

  // Medical-only filter via Wikipedia summary+categories
  function looksMedical(summary,categories){
    const text = `${summary?.title||''} ${summary?.description||''} ${summary?.extract||''}`.toLowerCase();
    const hints = ['disease','disorder','syndrome','infection','virus','bacteria','medical','medicine','patholog','health','illness','symptom'];
    const catTitles = (categories||[]).map(c=>(c.title||'').toLowerCase());
    const allow = ['diseases','medicine','medical','health','pathology','infectious','virology','bacteriology','neurology','dermatology','gastroenterology','endocrinology','psychiatry','cardiology','pulmonology'];
    return hints.some(h=>text.includes(h)) || catTitles.some(t=>allow.some(a=>t.includes(a)));
  }

  // Wikipedia helpers
  async function fetchCategories(title){
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=categories&cllimit=50&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const r = await fetch(url); if(!r.ok) return [];
    const j = await r.json(); const pages = j?.query?.pages||{}; const first = pages[Object.keys(pages)[0]]; return first?.categories||[];
  }
  async function wikiSummary(title){
    const u = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const r = await fetch(u, { headers: { 'Accept':'application/json' }});
    if(!r.ok) throw new Error('notfound');
    return await r.json();
  }
  async function wikiSections(title){
    const u = `https://en.wikipedia.org/api/rest_v1/page/mobile-sections/${encodeURIComponent(title)}`;
    const r = await fetch(u, { headers:{ 'Accept':'application/json' }});
    if(!r.ok) return null;
    return await r.json();
  }
  async function wikiRelated(title){
    const u = `https://en.wikipedia.org/api/rest_v1/page/related/${encodeURIComponent(title)}`;
    const r = await fetch(u, { headers:{ 'Accept':'application/json' }});
    if (!r.ok) return [];
    const j = await r.json();
    const pages = j && j.pages || [];
    return pages;
  }

  // Summarization combining exact + search fallback with medical-only filter
  async function medicalSummary(query){
    try {
      const s = await wikiSummary(query);
      const cats = await fetchCategories(s.title);
      if (looksMedical(s,cats)) return s;
    } catch (_) { /* ignore */ }
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
    const r = await fetch(searchUrl); const j = await r.json();
    const items = j?.query?.search||[];
    for (const it of items){
      try {
        const s = await wikiSummary(it.title);
        const cats = await fetchCategories(s.title);
        if (looksMedical(s,cats)) return s;
      } catch(_){}
    }
    return null;
  }

  // Result rendering + share data
  function showResult(s){
    if (!s){
      const isImage = lastOrigin === 'image';
      ui.resTitle.textContent = isImage ? 'Image not related to medical content' : 'No results found';
      ui.resExtract.textContent = isImage ? 'We could not detect medical-related information in the image. Try a clearer label, packaging text, or search by name.' : 'No medical information was found. Try another term or a clearer image.';
      ui.openLink && ui.openLink.removeAttribute('href');
      const shareBtnEl = document.getElementById('shareBtn');
      if (shareBtnEl) shareBtnEl.style.display = 'none';
      if (ui.openLink) ui.openLink.style.display = 'none';
      return;
    }
    ui.resTitle.textContent = s.title;
    ui.resExtract.textContent = s.extract||'';
    const link = s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title)}`;
    if (ui.openLink){
      ui.openLink.setAttribute('href', link);
      ui.openLink.style.display = 'inline-flex';
      ui.openLink.dataset.shareTitle = s.title;
      ui.openLink.dataset.shareUrl = link;
    }
    const shareBtnEl = document.getElementById('shareBtn');
    if (shareBtnEl){ shareBtnEl.style.display = 'inline-flex'; }
  }

  // Share button logic with clipboard fallback
  const shareBtn = document.getElementById('shareBtn');
  shareBtn && shareBtn.addEventListener('click', async ()=>{
    const title = ui.openLink && ui.openLink.dataset && ui.openLink.dataset.shareTitle || 'HealthMate Result';
    const url = ui.openLink && ui.openLink.dataset && ui.openLink.dataset.shareUrl || location.href;
    const text = ui.resExtract && ui.resExtract.textContent || '';
    try {
      if (navigator.share){
        await navigator.share({ title, text, url });
        toast('Shared');
      } else if (navigator.clipboard){
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } else {
        window.prompt('Copy this link:', url);
      }
    } catch(_) { toast('Share canceled'); }
  });

  // Extract structured sections from mobile-sections API
  function htmlToReadableText(html){
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    tmp.querySelectorAll('li').forEach(li=>{ li.innerHTML = '• ' + (li.textContent||''); });
    tmp.querySelectorAll('p, li').forEach(el=>{ el.insertAdjacentText('beforeend', '\n'); });
    const text = tmp.textContent || tmp.innerText || '';
    return text.replace(/\n\s*\n+/g,'\n').replace(/\s+$/,'').trim();
  }
  function extractSectionText(sections, names, maxSections=3){
    if (!sections || !sections.sections) return '';
    const wanted = names.map(n=>n.toLowerCase());
    const chunks = [];
    for (const s of sections.sections){
      const heading = (s.line||'').toLowerCase();
      if (wanted.some(w => heading.includes(w))){
        const html = s.text || '';
        const text = htmlToReadableText(html);
        if (text) chunks.push(text);
        if (chunks.length >= maxSections) break;
      }
    }
    return chunks.join('\n\n');
  }
  async function enrichMedicalSections(title){
    try{
      const sec = await wikiSections(title);
      if (!sec) return { symptoms:'', treatment:'', prevention:'' };
      const symptoms = extractSectionText(sec, ['symptoms', 'signs and symptoms']);
      const treatment = extractSectionText(sec, ['treatment', 'management', 'therapy', 'medication', 'drug therapy', 'remedy', 'care']);
      const prevention = extractSectionText(sec, ['prevention', 'precautions', 'risk reduction', 'control', 'prophylaxis', 'public health']);
      return { symptoms, treatment, prevention };
    } catch(_){ return { symptoms:'', treatment:'', prevention:'' }; }
  }
  function renderMedSections({ symptoms, treatment, prevention }){
    const pS = document.getElementById('symptomsPanel');
    const pT = document.getElementById('treatmentPanel');
    const pP = document.getElementById('preventionPanel');
    const sS = document.getElementById('symptomsSec');
    const sT = document.getElementById('treatmentSec');
    const sP = document.getElementById('preventionSec');
    if (pS && sS){ if (symptoms){ pS.style.display='block'; sS.textContent=symptoms; } else { pS.style.display='none'; sS.textContent=''; } }
    if (pT && sT){ if (treatment){ pT.style.display='block'; sT.textContent=treatment; } else { pT.style.display='none'; sT.textContent=''; } }
    if (pP && sP){ if (prevention){ pP.style.display='block'; sP.textContent=prevention; } else { pP.style.display='none'; sP.textContent=''; } }
  }
  async function renderRelated(title){
    const panel = document.getElementById('relatedPanel');
    const list = document.getElementById('relatedList');
    if (!panel || !list){ return; }
    try{
      const pages = await wikiRelated(title);
      const items = (pages || []).filter(p=>p && p.title).slice(0,3);
      list.innerHTML = '';
      if (items.length === 0){ panel.style.display='none'; return; }
      for (const it of items){
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'link';
        a.target = '_blank'; a.rel = 'noopener';
        a.textContent = it.title;
        a.href = (it.content_urls && it.content_urls.desktop && it.content_urls.desktop.page) ? it.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(it.title)}`;
        li.appendChild(a);
        list.appendChild(li);
      }
      panel.style.display='block';
    } catch(_){ panel.style.display='none'; list.innerHTML=''; }
  }

  // Camera handling and OCR
  let stream = null;
  async function startCam(){
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('Camera not supported'); return; }
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure){ toast('Camera needs HTTPS or localhost'); }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment'} }, audio:false });
      if (ui.video) ui.video.srcObject = stream; if (ui.camera) ui.camera.removeAttribute('hidden');
    } catch(e){ toast('Camera permission denied'); }
  }
  function stopCam(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if (ui.camera) ui.camera.setAttribute('hidden',''); }

  // Basic preprocessing to improve OCR signal
  function preprocessToCanvas(source){
    return new Promise((resolve)=>{
      if (source instanceof HTMLCanvasElement){
        const src = source;
        const scale = 2;
        const cw = Math.max(320, Math.min(2000, src.width * scale));
        const ch = Math.max(240, Math.min(2000, src.height * scale));
        const out = document.createElement('canvas'); out.width=cw; out.height=ch;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, 0, 0, cw, ch);
        const img = ctx.getImageData(0,0,cw,ch);
        const data = img.data; let sum=0;
        for(let i=0;i<data.length;i+=4){
          const r=data[i],g=data[i+1],b=data[i+2];
          let v = 0.299*r + 0.587*g + 0.114*b; sum += v; data[i]=data[i+1]=data[i+2]=v;
        }
        const mean = sum/(data.length/4);
        const contrast = 1.2;
        for(let i=0;i<data.length;i+=4){
          let v = data[i]; v = (v-128)*contrast + 128; v = v>255?255:(v<0?0:v);
          const th = mean * 0.95; const bin = v>th?255:0; data[i]=data[i+1]=data[i+2]=bin;
        }
        ctx.putImageData(img,0,0);
        resolve(out);
      } else if (source instanceof Blob){
        const imgEl = new Image();
        imgEl.onload = ()=>{
          const scale = 2;
          const cw = Math.max(320, Math.min(2000, imgEl.naturalWidth * scale));
          const ch = Math.max(240, Math.min(2000, imgEl.naturalHeight * scale));
          const out = document.createElement('canvas'); out.width=cw; out.height=ch;
          const ctx = out.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(imgEl, 0, 0, cw, ch);
          const img = ctx.getImageData(0,0,cw,ch);
          const data = img.data; let sum=0;
          for(let i=0;i<data.length;i+=4){
            const r=data[i],g=data[i+1],b=data[i+2];
            let v = 0.299*r + 0.587*g + 0.114*b; sum += v; data[i]=data[i+1]=data[i+2]=v;
          }
          const mean = sum/(data.length/4);
          const contrast = 1.2;
          for(let i=0;i<data.length;i+=4){
            let v = data[i]; v = (v-128)*contrast + 128; v = v>255?255:(v<0?0:v);
            const th = mean * 0.95; const bin = v>th?255:0; data[i]=data[i+1]=data[i+2]=bin;
          }
          ctx.putImageData(img,0,0);
          resolve(out);
        };
        imgEl.src = URL.createObjectURL(source);
      } else {
        resolve(null);
      }
    });
  }

  // OCR cleanup + preview
  function cleanOcrText(t){
    if (!t) return '';
    let s = t;
    s = s.replace(/[\u2010-\u2015]/g,'-');
    s = s.replace(/[^\w\s\-\+\/\(\)\.,]/g,' ');
    s = s.replace(/\s+/g,' ').trim();
    return s;
  }
  let lastOcrFullText = '';
  function setOcrStatus(text, showSearchAll){
    const s = ui.ocrStatus || document.getElementById('ocrStatus');
    if (s) s.textContent = text || '';
    const b = ui.ocrSearchAllBtn || document.getElementById('ocrSearchAllBtn');
    if (b) b.style.display = showSearchAll ? 'inline-flex' : 'none';
  }
  function setOcrPreview(fullText){
    lastOcrFullText = fullText || '';
    const MAX = 240;
    const t = lastOcrFullText;
    const preview = t.length > MAX ? t.slice(0, MAX) + '…' : t;
    if (ui.ocrOut) ui.ocrOut.textContent = preview || '(No text)';
  }
  (function(){
    const b = document.getElementById('ocrSearchAllBtn');
    if (!b) return;
    b.addEventListener('click', async ()=>{
      const full = lastOcrFullText;
      if (!full || full === '(No text)'){ toast('Nothing to search'); return; }
      ui.searchInput.value = full;
      await doSearch();
    });
  })();

  // Choose best token from OCR when no direct hit
  function chooseBestCandidate(text){
    if (!text) return '';
    const words = text.split(/[^A-Za-z0-9\-\+]+/).filter(Boolean);
    const stop = new Set(['the','and','for','with','from','tablet','capsule','use','only','store','keep','dose','daily','dose','doctor','consult','shake','before','children','out','reach','more','than','may','cause','liver','damage','allergic','reaction','face','mouth','breathing','stop']);
    let best = '';
    for (const w of words){
      const lw = w.toLowerCase();
      if (lw.length < 4) continue;
      if (stop.has(lw)) continue;
      if (SUGGESTIONS.some(s=>s.name.toLowerCase()===lw)) return w;
      if (lw.length > best.length) best = w;
    }
    return best;
  }

  // Core search flow (API first, then client fallback). Also renders sections & related
  async function doSearch(){
    lastOrigin = 'text';
    const q = ui.searchInput.value.trim(); if(!q){ toast('Type a disease name'); return; }
    ui.searchBtn.classList.add('is-loading');
    try {
      const apiUrl = `/api/search?q=${encodeURIComponent(q)}`;
      let s = null;
      try {
        const r = await fetch(apiUrl, { headers: { 'Accept':'application/json' } });
        if (r.ok) { s = await r.json(); }
      } catch(_) {}
      if (!s) { s = await medicalSummary(q); }
      showResult(s);
      if (s && s.title){
        const extra = await enrichMedicalSections(s.title);
        renderMedSections(extra);
        await renderRelated(s.title);
      } else {
        renderMedSections({ symptoms:'', treatment:'', prevention:'' });
        const panel = document.getElementById('relatedPanel'); if(panel) panel.style.display='none';
      }
    } catch(e){
      showResult(null);
      renderMedSections({ symptoms:'', treatment:'', prevention:'' });
      const panel = document.getElementById('relatedPanel'); if(panel) panel.style.display='none';
    } finally { ui.searchBtn.classList.remove('is-loading'); }
  }

  // Camera chooser modal
  function showChooser(){ if(ui.imgChooser){ ui.imgChooser.style.display='block'; } if(ui.backdrop){ ui.backdrop.removeAttribute('hidden'); } }
  function hideChooser(){ if(ui.imgChooser){ ui.imgChooser.style.display='none'; } if(ui.backdrop){ ui.backdrop.setAttribute('hidden',''); } }

  // Events
  ui.themeBtn && ui.themeBtn.addEventListener('click', toggleTheme);
  ui.searchBtn && ui.searchBtn.addEventListener('click', doSearch);
  ui.searchInput && ui.searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doSearch(); });
  ui.imageBtn && ui.imageBtn.addEventListener('click', showChooser);
  ui.backdrop && ui.backdrop.addEventListener('click', hideChooser);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') hideChooser(); });
  ui.chooseGallery && ui.chooseGallery.addEventListener('click', ()=>{ ui.galleryInput && ui.galleryInput.click(); });
  ui.galleryInput && ui.galleryInput.addEventListener('change', async (e)=>{
    const f = e.target.files && e.target.files[0];
    hideChooser(); if (f) await analyzeFileOrCanvas(f);
  });
  ui.chooseCamera && ui.chooseCamera.addEventListener('click', async ()=>{
    hideChooser(); await startCam(); ui.imagePanel && ui.imagePanel.scrollIntoView({ behavior:'smooth', block:'center' });
  });
  ui.closeCamBtn && ui.closeCamBtn.addEventListener('click', stopCam);

  // Clicking the Camera panel (when camera is hidden) opens the chooser (Gallery/Camera)
  ui.imagePanel && ui.imagePanel.addEventListener('click', (e)=>{
    const camHidden = ui.camera && ui.camera.hasAttribute('hidden');
    if (!camHidden) return;
    // Avoid triggering when clicking explicit buttons inside the panel
    const target = e.target;
    if (target && (target.closest && target.closest('button'))) return;
    showChooser();
  });
  async function analyzeFileOrCanvas(source){
    lastOrigin = 'image';
    setOcrStatus('Analyzing…', false);
    setOcrPreview('');
    try {
      const pre = await preprocessToCanvas(source) || source;
      const { createWorker } = Tesseract;
      const worker = await createWorker('eng');
      if (worker.setParameters){
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+()/., ',
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: '6'
        });
      }
      const { data:{ text } } = await worker.recognize(pre);
      await worker.terminate();
      const cleaned = cleanOcrText(text);
      setOcrPreview(cleaned);
      // quick map to suggestion if detected within text
      const hit = SUGGESTIONS.find(x => cleaned.toLowerCase().includes(x.name.toLowerCase()));
      if (hit){
        setOcrStatus(`Detected: ${hit.name}`, false);
        ui.searchInput.value = hit.name; await doSearch(); return;
      }
      // else choose best candidate token and try
      const cand = chooseBestCandidate(cleaned);
      if (cand && cand.length >= 4){
        setOcrStatus(`Trying: ${cand}`, true);
        ui.searchInput.value = cand;
        const s = await medicalSummary(cand);
        if (s) { showResult(s); return; }
      }
      // final fallback: automatically search full text
      if (cleaned && cleaned.length > 6){
        setOcrStatus('Searching full text…', false);
        ui.searchInput.value = cleaned;
        await doSearch();
      } else {
        setOcrStatus('No clear term found. Try Search All Text.', true);
      }
    } catch(e){ setOcrStatus('Failed to analyze', false); toast('Failed to analyze'); }
    finally { /* no-op */ }
  }
  async function tryVisualSearchWithCanvas(canvas){
    try{
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      const arrBuf = await blob.arrayBuffer();
      const r = await fetch('/api/visual-search', { method:'POST', headers:{ 'Content-Type':'application/octet-stream' }, body: arrBuf });
      const jr = await r.json();
      if (jr && jr.disabled){ return false; }
      if (jr && jr.summary){ showResult(jr.summary); return true; }
      if (jr && jr.notMedical){ showResult(null); return true; }
      return false;
    } catch(_){ return false; }
  }
  ui.captureBtn && ui.captureBtn.addEventListener('click', async ()=>{
    const w = (ui.video && ui.video.videoWidth) || 640, h = (ui.video && ui.video.videoHeight) || 480;
    if (ui.canvas){ ui.canvas.width=w; ui.canvas.height=h; }
    const ctx = ui.canvas && ui.canvas.getContext('2d');
    if (ctx && ui.video){
      ctx.drawImage(ui.video,0,0,w,h);
      ui.camera && (ui.camera.style.outline = '2px solid var(--primary)');
      setTimeout(()=>{ if(ui.camera) ui.camera.style.outline=''; }, 200);
      lastOrigin = 'image';
      // Try visual search first; fallback to OCR
      const ok = await tryVisualSearchWithCanvas(ui.canvas);
      if (!ok){ await analyzeFileOrCanvas(ui.canvas); }
    }
  });
  ui.camera && ui.camera.addEventListener('dragover', (e)=>{ e.preventDefault(); });
  ui.camera && ui.camera.addEventListener('drop', async (e)=>{
    e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type && f.type.startsWith('image/')) { await analyzeFileOrCanvas(f); }
  });

  // Init
  applyTheme();
  renderChips();
})();



