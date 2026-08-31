// ============ Apps Script Bootstrap — paste this ONCE into https://script.google.com Code.gs ============
// After this, all logic is fetched from GitHub at
// https://raw.githubusercontent.com/AbstractDimensions/daily_tetris_CDI/main/appscript/core.js
// Just git push to update — no more pasting. Cache-busted on every run.
const GH_RAW = 'https://raw.githubusercontent.com/AbstractDimensions/daily_tetris_CDI/main/appscript';
function _loadRemote_(name){
  const url = GH_RAW + '/' + name + '?v=' + Date.now();
  const r = UrlFetchApp.fetch(url, {headers:{'Cache-Control':'no-cache'}, muteHttpExceptions:true});
  if(r.getResponseCode()!==200) throw new Error('GitHub fetch '+r.getResponseCode()+' for '+name+': '+r.getContentText().slice(0,300));
  return r.getContentText();
}
// Load core on startup — defines generateMissingDay, doGet, dailyRun, etc.
try{ eval(_loadRemote_('core.js')); }catch(e){ Logger.log('bootstrap load failed: '+e+'\n'+e.stack); throw e; }
// Expose manual buttons in the Apps Script UI (Run -> generateMissingDay / dailyRun / setup)
