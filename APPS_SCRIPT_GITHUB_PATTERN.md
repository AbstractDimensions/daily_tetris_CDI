# Apps Script → GitHub fetch pattern (copy for another AI)

Used in `daily_tetris_CDI` so the AI can push to GitHub and Apps Script auto-loads without pasting.

## Repo layout
```
appscript/
  core.js          # 300+ lines — all real logic (pipeline, detector, fetch, doGet)
  Code.gs          # ~60-line bootstrap — ONLY file pasted once into Apps Script editor
  appsscript.json  # manifest — oauthScopes: drive, script.external_request, script.scriptapp, script.storage
prompt_tester.html # hosted on GitHub Pages, calls ?q=test
index.html         # calls ?callback=handleConfig / ?q=history via JSONP
```

## Why two files
- Apps Script has no `import`/npm. Pasted code gets stale. Bootstrap fetches the latest `core.js` from `raw.githubusercontent.com` on **every execution**, so a `git push` is instantly live (raw cache ~2 min, busted with `?v=Date.now()`).
- Bootstrap must define wrapper functions **immediately** so the Editor dropdown shows `generateMissingDay`/`dailyRun`/`doGet` even before the fetch succeeds.

## Bootstrap `Code.gs` (paste once)
```gs
const GH_RAW = 'https://raw.githubusercontent.com/<user>/<repo>/main/appscript';
const _WRAPPERS = {};
function _loadRemote_(name){
  const r = UrlFetchApp.fetch(GH_RAW + '/' + name + '?v=' + Date.now(), {headers:{'Cache-Control':'no-cache'}, muteHttpExceptions:true});
  if(r.getResponseCode()!==200) throw new Error(name+' fetch '+r.getResponseCode());
  return r.getContentText();
}
function ensureRemote_(){
  if(typeof generateMissingDay !== 'undefined' && generateMissingDay !== _WRAPPERS.generateMissingDay) return;
  const code = _loadRemote_('core.js');
  try{ (0, eval)(code); }catch(e){ throw new Error('remote eval failed: '+e); }
  if(typeof generateMissingDay === 'undefined') throw new Error('generateMissingDay not found after remote load');
}
const _wrap = (n, fn) => { const w = function(){ ensureRemote_(); return fn.apply(this, arguments); }; _WRAPPERS[n]=w; return w; };
var generateMissingDay = _wrap('generateMissingDay', function(){ ensureRemote_(); return this.generateMissingDay.apply(this, arguments); });
var dailyRun           = _wrap('dailyRun',           function(){ ensureRemote_(); return this.dailyRun.apply(this, arguments); });
var doGet              = _wrap('doGet',              function(e){ ensureRemote_(); return this.doGet(e); });
var doPost             = _wrap('doPost',             function(e){ ensureRemote_(); return this.doPost ? this.doPost(e) : null; });
// note: use (0,eval) not direct eval — direct eval stays in function scope, indirect eval runs in global scope so defs stick.
// save _WRAPPERS before eval — checking fn===generateMissingDay after overwrite is always true (self-compare bug).
```

## `core.js` must export plain globals
No `export`, just `function generateMissingDay(){...} function doGet(e){...} function dailyRun(){...}`. Any `const` at top is global after `eval`.

## Gotchas we hit
1. **`Address unavailable` / `Authentication error` on Cloudflare** — `callWorkersAI` must send `multipart/form-data` (`payload: {prompt, image: blob}` with `Authorization: Bearer tok`), not JSON `{image: base64}`. `flux-2-klein-4b` requires multipart.
2. **Drive permission on `doGet` but not on `generateMissingDay`** — Editor runs as you, Web App runs as deployment. Fix: `appsscript.json` must include `https://www.googleapis.com/auth/drive` (not `script.cache` — invalid scope → `Error 400 invalid_scope`), then **Deploy > Manage deployments > New version** and re-authorize.
3. **`generateMissingDay not found after remote load`** — was comparing wrapper to itself. Save wrappers table before eval.
4. **`script.cache` is not a valid OAuth scope** — valid set: `drive`, `script.external_request`, `script.scriptapp`, `script.storage`.

## Deploy steps for new clone
1. `gh repo clone <repo>` → edit `appscript/core.js` locally
2. `git commit -m "core: ..." && git push`
3. One-time in Apps Script editor: paste `Code.gs` + `appsscript.json`, Save, `Deploy > Web app > Execute as Me > Anyone`, copy `/exec` URL into `index.html:API_URL` and `prompt_tester.html`
4. Run `generateMissingDay` from dropdown → authorize drive → check `Executions` logs: `remote core loaded from ...`

