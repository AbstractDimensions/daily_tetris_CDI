# TODO — daily_tetris_CDI

Updated 2026-08-31 — defaults locked to screenshot.

### Defaults (now in `index.html`)
- Preset **Brick Breaker**, Embed `https://youtu.be/Z4SXUkRg2M?si=vZtESEqpDRLMBgsI`, Blend `overlay`
- `scrOp 0.5 / pix 1 / noi 0.1 / pos 0 / sca 0.45 / blur 0.5 / bright 1 / gray 0 / sepia 0.2 / hue 0 / inv 0 / sat 2 / con 1 / vig2 0.4 / vigR 105 / halo -0.5 / haloR 35 / ivig 0 / ivigR 75 / noiAnim false`

### 1. Games
- [ ] Add Conway's Game of Life (small canvas, click to seed, play/pause/clear, speed slider, wrap edges)
- [ ] Add Snake (arrow/WASD, score, wall/self collision, -? penalty — keep consistent with Pong/Breaker)
- [ ] Other small 2D candidates: 2048, Minesweeper (5×5), Asteroids (vector), Pac-like chase, Sokoban level 1
- Keep `fitText()` adaptive HUD pattern (v20d) and loss overlays consistent

### 2. Daily YouTube Mix → ytdlp
- [ ] Decide source: liked playlist / `mix` URL / channel
- [ ] Daily job (cron or Apps Script trigger) → `yt-dlp --extract-audio --audio-format mp3` / `opus` from mix URL, save to Drive `music/` or S3
- [ ] Consider `yt-dlp --flat-playlist --print url` to pick one unseen per day, dedupe via `history.json`
- [ ] License / ToS note — only own mixes

### 3. Reddit image fetch (broken)
- [ ] Current `fetchReddit_` hits `old.reddit.com` JSON without auth — often 429/blocked. Options:
  - Use `https://www.reddit.com/r/<sub>/top.json?t=day&limit=8` with `User-Agent: daily_tetris_CDI/1.0` + OAuth
  - Or drop Reddit and use Pexels/Unsplash fallback only
- [ ] Re-enable in `appscript/core.js:fetchReddit_` and `pickSource_` once tested

### 4. Prompt iteration app
- [ ] `prompt_tester.html` exists (calls `?q=test&prompt=&source=`) — polish:
  - Preview source grid, prompt textarea, live `?q=test` with CF multipart, show returned `base` + `quads.length`
  - Save prompt to `ScriptProperties PROMPT_OVERRIDE` via new `?q=setPrompt`
  - Add A/B compare (side-by-side gens)

