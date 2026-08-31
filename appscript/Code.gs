// ============ Apps Script Bootstrap — ROBUST v2 (defines wrappers, fixes self-check) ============
const GH_RAW = 'https://raw.githubusercontent.com/AbstractDimensions/daily_tetris_CDI/main/appscript';
const GH_CORE = 'core.js';
let _REMOTE_LOADED = false;
let _WRAPPERS = {};
function _loadRemote_(){
  const url = GH_RAW + '/' + GH_CORE + '?v=' + Date.now();
  const r = UrlFetchApp.fetch(url, {headers:{'Cache-Control':'no-cache'}, muteHttpExceptions:true});
  if(r.getResponseCode()!==200) throw new Error('GitHub fetch '+r.getResponseCode()+' '+r.getContentText().slice(0,500));
  return r.getContentText();
}
function _ensureRemote_(){
  if(_REMOTE_LOADED) return;
  // save wrappers before they get overwritten
  _WRAPPERS.generateMissingDay = generateMissingDay;
  _WRAPPERS.dailyRun = dailyRun;
  _WRAPPERS.doGet = doGet;
  _WRAPPERS.setup = setup;
  let code = _loadRemote_();
  code = code.replace(/^\s*const\s+/gm, 'var ');
  (0, eval)(code);
  _REMOTE_LOADED = true;
  Logger.log('remote core loaded from ' + GH_RAW + '/' + GH_CORE);
}
function generateMissingDay(){
  _ensureRemote_();
  const fn = (0, eval)('generateMissingDay');
  if(fn === _WRAPPERS.generateMissingDay) throw new Error('core did not define generateMissingDay');
  return fn.apply(this, arguments);
}
function dailyRun(){
  _ensureRemote_();
  const fn = (0, eval)('dailyRun');
  if(fn === _WRAPPERS.dailyRun) throw new Error('core did not define dailyRun');
  return fn.apply(this, arguments);
}
function setup(){
  _ensureRemote_();
  const fn = (0, eval)('setup');
  return fn.apply(this, arguments);
}
function installTriggers(){
  _ensureRemote_();
  const fn = (0, eval)('installTriggers');
  return fn.apply(this, arguments);
}
function doGet(e){
  _ensureRemote_();
  const fn = (0, eval)('doGet');
  if(fn === _WRAPPERS.doGet) throw new Error('core did not define doGet');
  return fn.call(this, e);
}
function doPost(e){
  _ensureRemote_();
  try{ const fn=(0,eval)('doPost'); if(typeof fn==='function') return fn.call(this,e);}catch(err){}
  return doGet(e);
}
function reloadRemote(){ _REMOTE_LOADED=false; _ensureRemote_(); Logger.log('reloaded'); }
