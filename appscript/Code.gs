// ============ Apps Script Bootstrap — ROBUST (paste ONCE, defines functions immediately) ============
// GitHub is source of truth: https://raw.githubusercontent.com/AbstractDimensions/daily_tetris_CDI/main/appscript/core.js
// No top-level fetch — each entry point lazy-loads and then delegates. Functions exist instantly.
const GH_RAW = 'https://raw.githubusercontent.com/AbstractDimensions/daily_tetris_CDI/main/appscript';
const GH_CORE = 'core.js';

function _loadRemote_(){
  const url = GH_RAW + '/' + GH_CORE + '?v=' + Date.now();
  const r = UrlFetchApp.fetch(url, {headers:{'Cache-Control':'no-cache'}, muteHttpExceptions:true});
  if(r.getResponseCode()!==200) throw new Error('GitHub fetch '+r.getResponseCode()+' '+r.getContentText().slice(0,400));
  return r.getContentText();
}
let _REMOTE_LOADED = false;
function _ensureRemote_(){
  if(_REMOTE_LOADED) return;
  let code = _loadRemote_();
  // core uses `const` — indirect eval needs `var` to become true globals on first load
  // (const would stay block-scoped in indirect eval)
  code = code.replace(/^\s*const\s+/gm, 'var ');
  // indirect eval = global scope, so `function generateMissingDay(){}` becomes global
  (0, eval)(code);
  _REMOTE_LOADED = true;
  Logger.log('remote core loaded from ' + GH_RAW + '/' + GH_CORE);
}

// ---- manual entry points — these are what Apps Script shows in the Run dropdown ----
function generateMissingDay(){
  _ensureRemote_();
  // after load, the global was overwritten to the core version — call it without recursing
  const fn = (0, eval)('generateMissingDay');
  if(fn === generateMissingDay) throw new Error('generateMissingDay not found after remote load');
  return fn.apply(this, arguments);
}
function dailyRun(){
  _ensureRemote_();
  const fn = (0, eval)('dailyRun');
  if(fn === dailyRun) throw new Error('dailyRun not found after remote load');
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
  return fn.call(this, e);
}
function doPost(e){
  _ensureRemote_();
  const fn = (0, eval)('doPost');
  if(typeof fn === 'function') return fn.call(this, e);
  return doGet(e);
}
// optional: force reload (Run this if you pushed a new core.js and Apps Script cached the old)
function reloadRemote(){
  _REMOTE_LOADED = false;
  _ensureRemote_();
  Logger.log('reloaded');
}
