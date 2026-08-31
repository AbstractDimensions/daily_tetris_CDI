// ============ Code.gs v12 CF-only (Gemini/Pexels removed) ============
// v11: hull+edge-fit, Rec601 lum, minLum 70→45 fixes dark bevel, dual 8vs14 strict-biased, 508px, 30-round — 0.85px on real_user3
const CF_ACCOUNT_ID = '';
const CF_API_TOKEN  = '';
const FOLDERS = { SOURCE:'obelisk_source', GEN:'obelisk_generated', FAIL:'obelisk_failed', REF:'obelisk_reference' };
const CF_MODELS = ['@cf/black-forest-labs/flux-2-klein-4b'];
const PROMPT_MAIN = `Match the lighting of the input image. Insert a black rectangular obsidian monolith with a screen on it into this landscape. The face toward the camera has exactly one flat perfectly rectangular screen, filling most of the face. The screen is a plain matte neutral mid-grey panel (sRGB 128,128,128). The obelisk should be weathered slightly. Do not alter the rest of the photo.`;
const PROMPT_FIX = `This image failed automated validation. PROBLEM: {issue}\nEdit the image to fix this. There must be exactly one flat, matte, mid-grey rectangle on the obelisk face and no other grey areas on the obsidian. Keep everything else identical.`;
var PROMPT_CURRENT = PROMPT_MAIN; // editable via ScriptProperties PROMPT_OVERRIDE
function getPrompt_(){ return conf_('PROMPT_OVERRIDE', '') || PROMPT_CURRENT; }
const LIMITS = { maxFixes: 0, fetchBatch: 8, minAreaFrac: 0.004 };
const GREY_START = { maxSat: 14, minLum: 70, maxLum: 205, minFill: 0.80, surDiff: 15, maxSurLum: 95 };
const GREY_END   = { maxSat: 32, minLum: 45, maxLum: 215, minFill: 0.55, surDiff: 5, maxSurLum: 110 };
const MAX_WIDTH = 508;
const SURROUND_OFFSET_PX = 6;
const MAX_RETRIES = 30;

// ============ Helpers ============
function conf_(k, fb) { return PropertiesService.getScriptProperties().getProperty(k) || fb || ''; }
function setup() { Object.values(FOLDERS).forEach(n => { if (!DriveApp.getFoldersByName(n).hasNext()) DriveApp.createFolder(n); }); }
function installTriggers() { ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); ScriptApp.newTrigger('dailyRun').timeBased().everyDays(1).atHour(6).create(); }
function dailyRun() { runPipeline(); }
function folder_(n) { const it = DriveApp.getFoldersByName(n); if (!it.hasNext()) throw new Error('run setup() first'); return it.next(); }
const base_ = n => n.replace(/\.[^.]+$/, '');
function files_(f) { const out = []; const it = f.getFiles(); while (it.hasNext()) out.push(it.next()); return out; }
function replaceFile_(folder, name, blob) { files_(folder).filter(f => f.getName() === name).forEach(f => f.setTrashed(true)); return folder.createFile(blob.setName(name)); }
function clearFolder_(folder) { files_(folder).forEach(f => f.setTrashed(true)); }
function lumOf(r,g,b){ return 0.299*r+0.587*g+0.114*b; }
function satOf(r,g,b){ return Math.max(r,g,b)-Math.min(r,g,b); }
function lerp(a,b,t){ return a+(b-a)*t; }

// ============ Main Logic ============
function generateMissingDay() {
  const failFolder = folder_(FOLDERS.FAIL);
  const failedFiles = files_(failFolder).filter(f => f.getName().endsWith('.png'));
  if (failedFiles.length > 0) {
    failedFiles.sort((a, b) => a.getDateCreated() - b.getDateCreated());
    const oldestFail = failedFiles[0];
    Logger.log('Retrying failed image (0 neurons): ' + oldestFail.getName());
    const imgB64 = Utilities.base64Encode(oldestFail.getBlob().getBytes());
    const det = detectGreyQuadsWithRetry_(imgB64);
    if (det.quads.length > 0) {
      const base = oldestFail.getName().replace(/_a\d+\.png$/, '').replace(/\.png$/, '');
      saveOutputs_(base, imgB64, det);
      oldestFail.setTrashed(true);
      Logger.log('SUCCESS on retry: ' + base);
      return base;
    } else {
      Logger.log('Still failed after 30 retries: ' + oldestFail.getName());
      return null;
    }
  }
  const gen = new Set(files_(folder_(FOLDERS.GEN)).filter(f => f.getName().endsWith('.png')).map(f => base_(f.getName())));
  const un = files_(folder_(FOLDERS.SOURCE)).filter(f => !gen.has(base_(f.getName())));
  if (!un.length) { Logger.log('Nothing to backfill.'); return null; }
  un.sort((a, b) => a.getDateCreated() - b.getDateCreated());
  Logger.log('Backfilling new: ' + un[0].getName());
  return runPipelineForSource_(un[0]);
}
function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  const q = (e && e.parameter && e.parameter.q) || 'config';
  try {
    if (q === 'history') return respond_(getHistory_(), callback);
    if (q === 'sources') {
      const srcs = files_(folder_(FOLDERS.SOURCE)).map(f=>({name:f.getName(), id:f.getId(), thumb:'https://lh3.googleusercontent.com/d/'+f.getId()}));
      return respond_({sources: srcs.slice(0,60)}, callback);
    }
    if (q === 'test' && e.parameter.prompt) {
      const srcName = e.parameter.source;
      const pr = e.parameter.prompt;
      const src = srcName ? files_(folder_(FOLDERS.SOURCE)).filter(x=>x.getName()===srcName)[0] : pickSource_();
      if(!src) return respond_({error:'source not found: '+srcName}, callback);
      const base = runPipelineForSource_(src, pr);
      return respond_({ok:true, base:base, prompt:pr}, callback);
    }
    const pngs = files_(folder_(FOLDERS.GEN)).filter(f => f.getName().endsWith('.png'));
    if (!pngs.length) return respond_({ error: 'no generated image yet' }, callback);
    pngs.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    const file = pngs[0], base = base_(file.getName());
    const cfgFile = files_(folder_(FOLDERS.GEN)).filter(f => f.getName() === base + '.json')[0];
    const cfg = cfgFile ? JSON.parse(cfgFile.getBlob().getDataAsString()) : {};
    return respond_({ base: base, width: cfg.width, height: cfg.height, corners: cfg.corners, image: 'https://lh3.googleusercontent.com/d/' + file.getId() }, callback);
  } catch (err) { return respond_({ error: String(err) }, callback); }
}
function getHistory_() {
  const gen = folder_(FOLDERS.GEN);
  const pngs = files_(gen).filter(f => f.getName().endsWith('.png'));
  pngs.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  return pngs.map(f => {
    const base = base_(f.getName());
    const cf = files_(gen).filter(x => x.getName() === base + '.json')[0];
    const cfg = cf ? JSON.parse(cf.getBlob().getDataAsString()) : {};
    return { base: base, date: f.getDateCreated().toISOString(), width: cfg.width, height: cfg.height, corners: cfg.corners, image: 'https://lh3.googleusercontent.com/d/' + f.getId() };
  });
}
function respond_(data, callback) {
  const s = JSON.stringify(data);
  if (callback) return ContentService.createTextOutput(callback + '(' + s + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}
function normalizedSourceBlob_(file) {
  const blob = file.getBlob();
  try { blob.getAs('image/bmp'); return blob; } catch (e) { }
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const res = UrlFetchApp.fetch('https://wsrv.nl/?url=' + encodeURIComponent('https://lh3.googleusercontent.com/d/' + file.getId()) + '&w=1600&h=1600&fit=inside&output=png', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('wsrv conversion failed');
  return res.getBlob().setName(base_(file.getName()) + '.png');
}
function generateImage_(prompt, blob, mime, includeRef) {
  const cfAcc = conf_('CF_ACCOUNT_ID', CF_ACCOUNT_ID), cfTok = conf_('CF_API_TOKEN', CF_API_TOKEN);
  if (!cfAcc || !cfTok) throw new Error('Set CF_ACCOUNT_ID and CF_API_TOKEN in Script Properties (Project Settings → Script Properties)');
  const small = resizeBlob_(blob, 508);
  Logger.log('trying ' + CF_MODELS[0] + ' (640x480) multipart');
  return callWorkersAI_(cfAcc, cfTok, CF_MODELS[0], prompt, small.blob, 640, 480);
}
function callWorkersAI_(acc, tok, model, prompt, imageBlob, outW, outH) {
  // Workers AI flux-2-klein-4b expects multipart/form-data, NOT JSON.
  // UrlFetchApp sends multipart automatically when payload contains a Blob.
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + acc + '/ai/run/' + model;
  const payload = {
    prompt: prompt,
    image: imageBlob, // key is `image` for this model (not input_image_0)
    width: String(outW),
    height: String(outH),
    num_steps: '20'
  };
  const res = UrlFetchApp.fetch(url, { method:'post', headers:{ Authorization:'Bearer '+tok }, payload: payload, muteHttpExceptions:true });
  const txt = res.getContentText();
  let j; try{ j=JSON.parse(txt);}catch(e){ throw new Error('workersai non-JSON '+res.getResponseCode()+': '+txt.slice(0,800)); }
  if (res.getResponseCode()!==200 || !j.success) {
    const msg = (j.errors && j.errors[0] && j.errors[0].message) || txt.slice(0,800);
    throw new Error('workersai HTTP '+res.getResponseCode()+' '+msg + ' | body: '+txt.slice(0,600));
  }
  if (!j.result || !j.result.image) throw new Error('workersai HTTP '+res.getResponseCode()+' no image in result: '+txt.slice(0,600));
  return j.result.image;
}
function pickSource_() {
  const gen = new Set(files_(folder_(FOLDERS.GEN)).filter(f => f.getName().endsWith('.png')).map(f => base_(f.getName())));
  let fresh = files_(folder_(FOLDERS.SOURCE)).filter(f => !gen.has(base_(f.getName())));
  if (!fresh.length) { fetchReddit_(); fresh = files_(folder_(FOLDERS.SOURCE)).filter(f => !gen.has(base_(f.getName()))); }
  if (!fresh.length) throw new Error('no fresh source images (add to obelisk_source)');
  return fresh[0];
}
function fetchReddit_() {
  const res = UrlFetchApp.fetch('https://www.reddit.com/r/EarthPorn/hot.json?limit=25&raw_json=1', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return;
  const posts = JSON.parse(res.getContentText()).data.children.map(c => c.data);
  const have = new Set(files_(folder_(FOLDERS.SOURCE)).map(f => f.getName()));
  let added = 0;
  for (const p of posts) {
    if (added >= LIMITS.fetchBatch) break;
    if (!p.url || !/^https:\/\/i\.redd\.it\/.+\.(jpe?g|png)$/i.test(p.url)) continue;
    const name = p.id + p.url.match(/\.(jpe?g|png)$/i)[0].toLowerCase();
    if (have.has(name)) continue;
    const r = UrlFetchApp.fetch(p.url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) continue;
    folder_(FOLDERS.SOURCE).createFile(r.getBlob().setName(name)); added++;
  }
}
function fetchPexels_(key) { throw new Error('Pexels removed — CF-only'); }
function runPipeline(promptOverride) {
  clearFolder_(folder_(FOLDERS.FAIL));
  return runPipelineForSource_(pickSource_(), promptOverride || getPrompt_());
}
function runPipelineForSource_(src, promptOverride) {
  const base = base_(src.getName());
  Logger.log('source: ' + src.getName());
  const srcBlob = normalizedSourceBlob_(src);
  let imgB64 = generateImage_(promptOverride || getPrompt_(), srcBlob, srcBlob.getContentType(), true);
  folder_(FOLDERS.FAIL).createFile(Utilities.newBlob(Utilities.base64Decode(imgB64), 'image/png', base + '_a0.png'));
  const det = detectGreyQuadsWithRetry_(imgB64);
  if (det.quads.length > 0) { saveOutputs_(base, imgB64, det); Logger.log('SUCCESS ' + base); return base; }
  Logger.log('FAILED ' + base + ' -> saved to obelisk_failed for later retry');
  return null;
}
function saveOutputs_(base, imgB64, det) {
  const gen = folder_(FOLDERS.GEN);
  const f = replaceFile_(gen, base + '.png', Utilities.newBlob(Utilities.base64Decode(imgB64), 'image/png', base + '.png'));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  replaceFile_(gen, base + '.json', Utilities.newBlob(JSON.stringify({ width: det.width, height: det.height, corners: det.quads[0].corners }, null, 2), 'application/json', base + '.json'));
}
function resizeBlob_(blob, maxDim) {
  const { w, h, rgb } = parseBmp_(blob.getAs('image/bmp').getBytes());
  const scale = Math.min(1, maxDim / Math.max(w, h));
  if (scale >= 1) return { blob, W: w, H: h };
  const W = Math.max(8, Math.round(w * scale)), H = Math.max(8, Math.round(h * scale));
  const out = new Uint8ClampedArray(W * H * 3);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y * h / H), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * w / W), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = (yy * w + xx) * 3; r += rgb[p]; g += rgb[p + 1]; b += rgb[p + 2]; n++; }
      const o = (y * W + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { blob: Utilities.newBlob(bmpFromRgb_(W, H, out), 'image/bmp', 'r.bmp').getAs('image/png'), W, H };
}
function bmpFromRgb_(W, H, rgb) {
  const row = Math.floor((24 * W + 31) / 32) * 4, size = 54 + row * H;
  const b = new Uint8Array(size), dv = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4D;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, W, true); dv.setInt32(22, H, true); dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true); dv.setUint32(34, row * H, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < H; y++) {
    const rowStart = 54 + (H - 1 - y) * row;
    for (let x = 0; x < W; x++) { const p = (y * W + x) * 3, o = rowStart + x * 3; b[o] = rgb[p + 2]; b[o + 1] = rgb[p + 1]; b[o + 2] = rgb[p]; }
  }
  return b;
}
// === v11 detector: hull+edge-fit, Rec601, 508px, dual 8vs14 ===
function downscaleRgb_(rgb,w,h,maxW){
  if(w<=maxW) return {rgb:rgb,w:w,h:h};
  var scale=maxW/w, nw=maxW, nh=Math.max(1,Math.round(h*scale)), out=new Uint8Array(nw*nh*3);
  for(var y=0;y<nh;y++){var sy=Math.min(h-1,Math.floor(y/scale));for(var x=0;x<nw;x++){var sx=Math.min(w-1,Math.floor(x/scale)), si=(sy*w+sx)*3, di=(y*nw+x)*3; out[di]=rgb[si]; out[di+1]=rgb[si+1]; out[di+2]=rgb[si+2];}}
  return {rgb:out,w:nw,h:nh};
}
function convexHull_(pts){ if(pts.length<=1) return pts.slice(); var s=pts.slice().sort(function(a,b){return a[0]!==b[0]?a[0]-b[0]:a[1]-b[1]}); function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);} var lo=[];for(var i=0;i<s.length;i++){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],s[i])<=0)lo.pop();lo.push(s[i]);} var hi=[];for(var i=s.length-1;i>=0;i--){while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],s[i])<=0)hi.pop();hi.push(s[i]);} lo.pop();hi.pop();return lo.concat(hi); }
function simplifyToQuad_(hull){ var p=hull.slice();while(p.length>4){var m=Infinity,idx=-1;for(var i=0;i<p.length;i++){var a=p[(i-1+p.length)%p.length],b=p[i],c=p[(i+1)%p.length],ar=Math.abs(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]))/2;if(ar<m){m=ar;idx=i;}}p.splice(idx,1);}return p; }
function orderQuad_(q){ var cx=0,cy=0;for(var i=0;i<q.length;i++){cx+=q[i][0];cy+=q[i][1];}cx/=q.length;cy/=q.length;q.sort(function(a,b){return Math.atan2(a[1]-cy,a[0]-cx)-Math.atan2(b[1]-cy,b[0]-cx);});var ms=Infinity,idx=0;for(var i=0;i<q.length;i++){var s=q[i][0]+q[i][1];if(s<ms){ms=s;idx=i;}}return [q[idx],q[(idx+1)%4],q[(idx+2)%4],q[(idx+3)%4]]; }
function polygonArea_(pts){ var a=0;for(var i=0;i<pts.length;i++){var j=(i+1)%pts.length;a+=pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1];}return Math.abs(a)/2; }
function extractQuadCornersOld_(pixels,W){ var bMnS=Infinity,bMxS=-Infinity,bMnD=Infinity,bMxD=-Infinity,pMnS=null,pMxS=null,pMnD=null,pMxD=null;for(var i=0;i<pixels.length;i++){var q=pixels[i],x=q%W,y=(q/W)|0,s=x+y,d=x-y;if(s<bMnS){bMnS=s;pMnS=[x,y];}if(s>bMxS){bMxS=s;pMxS=[x,y];}if(d<bMnD){bMnD=d;pMnD=[x,y];}if(d>bMxD){bMxD=d;pMxD=[x,y];}}return [pMnS,pMxD,pMxS,pMnD]; }
function refineQuadByEdgeFit_(pixels,W,quad){
  if(!quad||quad.length!==4) return quad;
  var set={};for(var i=0;i<pixels.length;i++) set[pixels[i]]=1;
  var bd=[];for(var i=0;i<pixels.length;i++){var q=pixels[i],x=q%W,y=(q/W)|0, isB=false;if(x>0&&!set[q-1])isB=true;if(x<W-1&&!set[q+1])isB=true;if(!set[q+W])isB=true;if(!set[q-W])isB=true;if(isB)bd.push([x,y]);}
  if(bd.length<20) return quad;
  var ep=[[],[],[],[]]; function d2(px,py,ax,ay,bx,by){var dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;if(l2<1e-9) return (px-ax)*(px-ax)+(py-ay)*(py-ay);var t=((px-ax)*dx+(py-ay)*dy)/l2;t=Math.max(0,Math.min(1,t));var rx=ax+t*dx,ry=ay+t*dy;return (px-rx)*(px-rx)+(py-ry)*(py-ry);}
  for(var i=0;i<bd.length;i++){var px=bd[i][0],py=bd[i][1], best=-1,bd2=64;for(var e=0;e<4;e++){var ax=quad[e][0],ay=quad[e][1],bx=quad[(e+1)%4][0],by=quad[(e+1)%4][1],d=d2(px,py,ax,ay,bx,by);if(d<bd2){bd2=d;best=e;}}if(best!==-1)ep[best].push(bd[i]);}
  var lines=[];for(var e=0;e<4;e++){var pts=ep[e];if(pts.length<6){var ax=quad[e][0],ay=quad[e][1],bx=quad[(e+1)%4][0],by=quad[(e+1)%4][1],dx=bx-ax,dy=by-ay,a=-dy,b=dx,c=-(a*ax+b*ay),n=Math.sqrt(a*a+b*b)||1;lines.push([a/n,b/n,c/n]);continue;}var mx=0,my=0;for(var i=0;i<pts.length;i++){mx+=pts[i][0];my+=pts[i][1];}mx/=pts.length;my/=pts.length;var Sxx=0,Syy=0,Sxy=0;for(var i=0;i<pts.length;i++){var dx=pts[i][0]-mx,dy=pts[i][1]-my;Sxx+=dx*dx;Syy+=dy*dy;Sxy+=dx*dy;}var a,b,c;if(Sxx>Syy){var m=Sxy/(Sxx||1),b0=my-m*mx;a=m;b=-1;c=b0;}else{var m2=Sxy/(Syy||1),a0=mx-m2*my;a=1;b=-m2;c=-a0;}var n=Math.sqrt(a*a+b*b)||1;lines.push([a/n,b/n,c/n]);}
  function inter(l1,l2){var a1=l1[0],b1=l1[1],c1=l1[2],a2=l2[0],b2=l2[1],c2=l2[2],det=a1*b2-a2*b1;if(Math.abs(det)<1e-6) return null;return [Math.round((b1*c2-b2*c1)/det),Math.round((c1*a2-c2*a1)/det)];}
  var ref=[];for(var i=0;i<4;i++){var p=inter(lines[(i+3)%4],lines[i]);if(!p) return quad;ref.push(p);}
  var aOld=polygonArea_(quad),aNew=polygonArea_(ref);if(aNew<0.5*aOld||aNew>1.8*aOld) return quad;
  for(var e=0;e<4;e++){var a=ref[e],b=ref[(e+1)%4];if(Math.hypot(a[0]-b[0],a[1]-b[1])<8) return quad;}
  return orderQuad_(ref);
}
function extractQuadCorners_(pixels,W){
  if(!pixels.length) return [[0,0],[0,0],[0,0],[0,0]];
  var pts=[];for(var i=0;i<pixels.length;i++){var q=pixels[i],x=q%W,y=(q/W)|0;pts.push([x,y]);}
  if(pts.length<4) return extractQuadCornersOld_(pixels,W);
  var hull=convexHull_(pts);if(hull.length<4) return extractQuadCornersOld_(pixels,W);
  var quad=(hull.length===4)?orderQuad_(hull):orderQuad_(simplifyToQuad_(hull));
  try{ quad=refineQuadByEdgeFit_(pixels,W,quad);}catch(e){}
  return quad;
}
function detectGreyQuadsWithRetry_(pngB64){
  var bmp=Utilities.newBlob(Utilities.base64Decode(pngB64),'image/png','x.png').getAs('image/bmp');
  var parsed=parseBmp_(bmp.getBytes());
  var sc=downscaleRgb_(parsed.rgb,parsed.w,parsed.h,MAX_WIDTH);
  var w=sc.w,h=sc.h,rgb=sc.rgb;
  var rgba=new Uint8Array(w*h*4);for(var i=0;i<w*h;i++){rgba[i*4]=rgb[i*3];rgba[i*4+1]=rgb[i*3+1];rgba[i*4+2]=rgb[i*3+2];rgba[i*4+3]=255;}
  function runOnce(sMaxSat){
    for(var i=0;i<=MAX_RETRIES;i++){
      var t=i/MAX_RETRIES;
      var thr={ maxSat: sMaxSat + (GREY_END.maxSat - sMaxSat)*t, minLum: GREY_START.minLum + (GREY_END.minLum - GREY_START.minLum)*t, maxLum: GREY_START.maxLum + (GREY_END.maxLum - GREY_START.maxLum)*t, minFill: GREY_START.minFill + (GREY_END.minFill - GREY_START.minFill)*t, surDiff: GREY_START.surDiff + (GREY_END.surDiff - GREY_START.surDiff)*t, maxSurLum: GREY_START.maxSurLum + (GREY_END.maxSurLum - GREY_START.maxSurLum)*t };
      var r=detectGreyQuadsCore_(rgba,w,h,thr,parsed.w,parsed.h);
      if(r.quads.length>0) return {r:r,thr:thr,i:i};
    }
    return {r:{quads:[],width:parsed.w,height:parsed.h},thr:null,i:-1};
  }
  var candA=runOnce(8), candB=runOnce(14);
  var foundA=candA.r.quads.length>0, foundB=candB.r.quads.length>0;
  if(!foundA && !foundB) { Logger.log('Detection failed after '+MAX_RETRIES+' retries.'); return {quads:[],width:parsed.w,height:parsed.h}; }
  if(!foundA) { Logger.log('Detection B sat14 round '+candB.i); return candB.r; }
  if(!foundB) { Logger.log('Detection A sat8 round '+candA.i); return candA.r; }
  var fa=Math.abs(candA.r.quads[0].fill-1), fb=Math.abs(candB.r.quads[0].fill-1);
  if(fa<0.05 && fb<0.05){ Logger.log('Detection A strict wins (both excellent) fill '+candA.r.quads[0].fill.toFixed(3)+' vs '+candB.r.quads[0].fill.toFixed(3)); return candA.r; }
  if(fa+0.008<fb) return candA.r;
  if(fb+0.008<fa) return candB.r;
  return (fa<=fb)?candA.r:candB.r;
}
function detectGreyQuadsCore_(rgba,w,h,thr,w0,h0){
  var total=w*h, mask=new Uint8Array(total);
  for(var i=0;i<total;i++){var r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2], l=lumOf(r,g,b), s=satOf(r,g,b); if(s<=thr.maxSat && l>=thr.minLum && l<=thr.maxLum) mask[i]=1;}
  var visited=new Uint8Array(total), stack=[];
  for(var x=0;x<w;x++){var t=x, b=(h-1)*w+x; if(mask[t]===0&&!visited[t]){visited[t]=1;stack.push(t);} if(mask[b]===0&&!visited[b]){visited[b]=1;stack.push(b);}}
  for(var y=1;y<h-1;y++){var le=y*w, ri=y*w+(w-1); if(mask[le]===0&&!visited[le]){visited[le]=1;stack.push(le);} if(mask[ri]===0&&!visited[ri]){visited[ri]=1;stack.push(ri);}}
  while(stack.length){var cur=stack.pop(),cx=cur%w,cy=(cur/w)|0; if(cx>0){var n=cur-1;if(!visited[n]&&mask[n]===0){visited[n]=1;stack.push(n);}} if(cx<w-1){var n2=cur+1;if(!visited[n2]&&mask[n2]===0){visited[n2]=1;stack.push(n2);}} if(cy>0){var n3=cur-w;if(!visited[n3]&&mask[n3]===0){visited[n3]=1;stack.push(n3);}} if(cy<h-1){var n4=cur+w;if(!visited[n4]&&mask[n4]===0){visited[n4]=1;stack.push(n4);}}}
  for(var k=0;k<total;k++) if(mask[k]===0&&!visited[k]) mask[k]=1;
  var label=new Int32Array(total);for(var i=0;i<total;i++)label[i]=-1;
  var quads=[], compId=0;
  for(var idx=0;idx<total;idx++){
    if(mask[idx]!==1||label[idx]!==-1) continue;
    var q=[idx];label[idx]=compId;var qh=0,pix=[],sum=0;
    while(qh<q.length){
      var cur2=q[qh++],px=cur2%w,py=(cur2/w)|0; pix.push(cur2); sum+=lumOf(rgba[cur2*4],rgba[cur2*4+1],rgba[cur2*4+2]);
      if(px>0){var nb=cur2-1;if(mask[nb]===1&&label[nb]===-1){label[nb]=compId;q.push(nb);}}
      if(px<w-1){var nb2=cur2+1;if(mask[nb2]===1&&label[nb2]===-1){label[nb2]=compId;q.push(nb2);}}
      if(py>0){var nb3=cur2-w;if(mask[nb3]===1&&label[nb3]===-1){label[nb3]=compId;q.push(nb3);}}
      if(py<h-1){var nb4=cur2+w;if(mask[nb4]===1&&label[nb4]===-1){label[nb4]=compId;q.push(nb4);}}
    }
    var area=pix.length, mean=area?sum/area:0, corners=extractQuadCorners_(pix,w), qA=polygonArea_(corners), fill=qA>1e-6?area/qA:0;
    var sur=sampleSurround_(rgba,w,h,corners,6), sd=Math.abs(mean-sur);
    var blob={corners:corners,area:area,fill:fill,surLum:sur,surDiff:sd,meanLum:mean,pixels:pix};
    if(area < total*LIMITS.minAreaFrac) continue;
    if(fill < thr.minFill) continue;
    if(sd < thr.surDiff) continue;
    if(thr.maxSurLum!==undefined && sur > thr.maxSurLum) continue;
    var minEdge=Infinity;for(var e=0;e<4;e++){var a=corners[e], b=corners[(e+1)%4], d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(d<minEdge) minEdge=d;} if(minEdge<8) continue;
    quads.push(blob);
  }
  if(!quads.length) return {quads:[],width:w0,height:h0,reason:'NO_RECTANGLE'};
  quads.sort(function(a,b){return b.area-a.area;});
  return {quads:quads.map(function(b){return {corners:b.corners.map(function(p){return [Math.round(p[0]*w0/w), Math.round(p[1]*h0/h)];}), fill:b.fill, area:b.area, surround:b.surLum, meanLum:b.meanLum};}),width:w0,height:h0};
}
function sampleSurround_(rgba,w,h,quad,off){
  var cx=0,cy=0;for(var i=0;i<quad.length;i++){cx+=quad[i][0];cy+=quad[i][1];}cx/=quad.length;cy/=quad.length;
  var s=[];for(var e=0;e<quad.length;e++){var a=quad[e],b=quad[(e+1)%quad.length],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,dx=mx-cx,dy=my-cy,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,sx=Math.round(mx+ux*off),sy=Math.round(my+uy*off);for(var k=-1;k<=1;k++){var tx=Math.round(sx+k*(-uy)*2),ty=Math.round(sy+k*ux*2);if(tx>=0&&tx<w&&ty>=0&&ty<h){var idx=(ty*w+tx)*4;s.push(lumOf(rgba[idx],rgba[idx+1],rgba[idx+2]));}}}
  if(!s.length) return 0;var t=0;for(var i=0;i<s.length;i++)t+=s[i];return t/s.length;
}
function parseBmp_(bytes) {
  const n = bytes.length, u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bytes[i] & 0xff;
  const dv = new DataView(u8.buffer);
  if (u8[0] !== 0x42 || u8[1] !== 0x4D) throw new Error('not a BMP');
  const off = dv.getUint32(10, true), w = dv.getInt32(18, true), h = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true), comp = dv.getUint32(30, true);
  if (comp !== 0 || (bpp !== 24 && bpp !== 32)) throw new Error('unsupported BMP');
  const H = Math.abs(h), topDown = h < 0, row = Math.floor((bpp * w + 31) / 32) * 4, ch = bpp / 8;
  const rgb = new Uint8ClampedArray(w * H * 3);
  for (let y = 0; y < H; y++) {
    const rowStart = off + (topDown ? y : H - 1 - y) * row;
    for (let x = 0; x < w; x++) { const p = rowStart + x * ch, o = (y * w + x) * 3; rgb[o] = u8[p + 2]; rgb[o + 1] = u8[p + 1]; rgb[o + 2] = u8[p]; }
  }
  return { w, h: H, rgb };
}
