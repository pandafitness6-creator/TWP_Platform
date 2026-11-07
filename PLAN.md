# PLAN — restructuring `standalone/Train-With-Panda-Portal.html`

Analysis only; no project files were changed. Line numbers refer to the current file: commit `14a69f0`, sha256 `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, 79,896,002 bytes, 7,070 lines. The JavaScript was parsed with acorn 8 (installed outside the project) to get exact statement boundaries and references.

## 0. Approach and file map

**Recommended approach: split, then reassemble.** Each stage moves content out of the HTML into `src/`, and a new `scripts/assemble.mjs` rebuilds the standalone HTML from `src/`.

- Each stage is accepted only if the assembled HTML has the **same sha256 as today's file**.
- If it does, everything downstream is identical by construction: `public/`, `release.json` and `npm run check`, with no change to `build.mjs`.
- Changing `build.mjs` to read `src/` directly is a separate, optional step (§1.3).

**Current layout of the file**

| Lines | Content |
|---|---|
| 1–7 | doctype, `<html>`, `<head>`, meta, `<title>` |
| 8–2217 | style block 1 |
| 2218 | style block 2 (one line) |
| 2219 | favicon `<link>` |
| 2220–2232 | style block 3 `#panda-coaching-095` |
| 2233–3279 | **1,047 media payloads**, one per line |
| 3280–3553 | 274 empty lines |
| 3554–3734 | style blocks 4–9 |
| 3735–3740 | empty lines |
| 3741 | `</head>` |
| 3742–3749 | `<body>` shell markup: sidebar, topbar, main, footer, mobile nav, dialog, toast, noscript |
| 3750–4606 | 857 empty lines |
| 4607–7068 | **one `<script>` block** |
| 7069–7070 | `</body></html>` |

**Size of the HTML file left after each stage** (the template that `assemble.mjs` fills in)

| After stage | Approx. size of the HTML template |
|---|---|
| today | 79,896,002 bytes |
| 1 — media out | 3,252,574 bytes |
| 2 — data out | ≈ 1.0 MB |
| 3 — CSS out | ≈ 0.65 MB |
| 4 — JS out | ≈ 7 KB (shell markup + include markers) |

## 1. Media extraction (stage 1)

### 1.1 How `scripts/build.mjs` extracts media today

1. **Find payloads.** It reads the standalone file and runs a regex that matches every `<script type="text/plain" id="panda-…">BASE64</script>`.
   - It fails unless the id starts with `panda-` and the body is pure base64.
   - It replaces the **first** match with `<!--PANDA_MEDIA_BUNDLES-->` and every other match with `''`. The surrounding newline characters stay, so `public/index.html` keeps **1,046 empty lines** where the payloads were.
2. **Library images → files.** Each of the 268 `panda-library-image-*` payloads is base64-decoded.
   - It must be a WebP.
   - It is written to `public/media/library/<sha256[0:24]>.webp`.
3. **Patch the resolver.** The resolver index inside `window.PANDA_RESOLVE_ASSET` is parsed with `scripts/media-index.mjs`, which finds it by the marker `window.PANDA_RESOLVE_ASSET=(()=>{const index=`.
   - Each library-image entry gets a third element, `'./media/library/….webp'`.
   - The lookup string `if(!record)return key;const node=document.getElementById(record[0]);` must appear exactly once. It is patched to return `record[2]` first.
4. **Bundle the rest.** The other 779 payloads are grouped **in source order**. A new group starts when the running size of `JSON.stringify([id, body])` would pass 8 MiB.
   - Each group becomes `public/media/panda-media-<sha256(code)[0:16]>.js`. At runtime that file rebuilds the `<script type="text/plain">` nodes in `<head>`.
   - Today this gives 6 bundles.
5. **Wire up the page.** The marker is replaced with one `<script src>` per bundle, and `<link rel="preload">` tags are added before `</head>`.
6. **Connection settings.** If `deployment-config.json` exists, `window.PANDA_CONFIG = {…};` is replaced by regex.
7. **Write outputs:**
   - `index.html` and `_headers`.
   - `release.json`, which records the standalone's sha256 and size and the hash of every public file.

At runtime, media is read in two ways:
- `PANDA_RESOLVE_ASSET(key)` maps 1,181 keys to 1,044 distinct payload ids, then reads `document.getElementById(id).textContent`.
- `PandaLoginVideo` reads `document.getElementById(PANDA_LOGIN_VIDEOS[gender].id)` for the 2 login videos.

`panda-embedded-asset-56` (AVIF, 24,524 bytes) is **not referenced anywhere**. It must still be kept, because `check.mjs` checks the payload count.

### 1.2 Can the source reference external media instead?

**Yes, and byte-for-byte reconstruction is possible.** The preconditions all hold:

| Check | Result |
|---|---|
| All 1,047 payloads are canonical base64 (`decode(x).toString('base64') === x`) | yes, 0 exceptions |
| Whitespace inside payloads | none |
| Tag shape | every one is exactly `<script type="text/plain" id="ID">B64</script>`, one per line, lines 2233–3279 contiguous |
| Decoded types | 712 AVIF, 329 WebP, 3 PNG, 1 SVG, 2 MP4 |
| Resolver prefix matches the decoded type | 0 mismatches |
| Decoded total | 57,425,499 bytes (from 76,568,780 bytes of base64) |

**Proposed layout**

- `src/media/<id>.<avif|webp|png|svg|mp4>` holds the decoded binaries, so images become viewable files.
- `src/media/manifest.json` is an ordered array of `[id, filename]` in today's source order. Order decides bundle grouping and bundle file names.
- In the template, lines 2233–3279 become one marker line, e.g. `<!--@media-->`.
- `assemble.mjs` expands the marker back into 1,047 lines of `<script type="text/plain" id="ID">` + `base64(file)` + `</script>`, joined by `\n`.

### 1.3 What `build.mjs` would need to change

**Option A — recommended for stage 1: no change.** Add `"prebuild": "node scripts/assemble.mjs"` (or call it at the top of `build.mjs`). The build keeps reading the assembled standalone file exactly as today.

**Option B — later, optional: build from `src/` directly.**
- Replace the payload regex with a read of `src/media/manifest.json`.
- Get each bundled payload as `fs.readFileSync(file).toString('base64')`.
- Write library images straight from the file bytes; the sha256 of the bytes is unchanged.
- Keep the 8 MiB grouping on the same `JSON.stringify([id, body])` byte count, in manifest order.
- Insert the bundle marker at the media line and emit **1,046 `\n`** after it, so `index.html` stays byte-identical. Dropping those blank lines is a deliberate output change; do it separately with a new baseline.
- `release.json.standalone` (file, bytes, sha256) must then point at the assembled file or a hash of `src/`.
- `scripts/check.mjs` reads the expected payloads from the standalone with the same regex. It must read the assembled file or `src/media` instead.
- `tests/verify.cjs` loads the standalone in jsdom with payloads replaced by `AA==`. It needs the assembled file to exist.

### 1.4 Stage 1 risks

| Risk | Detail | Mitigation |
|---|---|---|
| CRLF conversion | `core.autocrlf=true` is set system-wide (`C:/Program Files/Git/etc/gitconfig`). Before stage 0 the repo had no `.gitattributes`, so a fresh clone on this machine checked the 76 MiB standalone out with CRLF, which broke `check.mjs`'s hash test. Extracted text parts would be affected the same way. | **Fixed in stage 0** (§8): `.gitattributes` forces LF and marks binaries, including `src/media/**`. `assemble.mjs` should still fail on any `\r`. |
| Payload order | Changing the manifest order changes bundle grouping and hashed bundle names. | The manifest is ordered; the assembler never sorts. |
| Orphan payload | `panda-embedded-asset-56` looks unused and could be deleted by a cleanup. | Keep it until a deliberate, separately verified removal. |
| Stale manifests | `MANIFEST.json` and `MANIFEST.sha256` list every package file and hash, including the standalone (line 306). No script generates them. | Regenerate them after the restructure; add a small script. |
| Repo size | Git history keeps the 80 MB blob; the restructure does not shrink `.git` (125.43 MiB). Future commits stop adding about 57 MiB per edit. | Rewriting history is out of scope. |
| Path length on Windows | The longest proposed path, `…\Train-With-Panda\src\media\panda-library-image-cardio-v915-sheet_9789d5bd3d09-female.webp`, is about 160 characters, under 260. A `git gc` in the scratch repo failed with "Filename too long" on a deeper temp path. | Keep `src/media` flat; optionally set `core.longpaths=true`. |

**Byte-for-byte output: yes.** Option A is identical by construction once the assembled sha256 matches. Option B is identical if the 1,046 blank lines and the manifest order are reproduced.

## 2. Data extraction (stage 2)

### 2.1 The 23 `window.PANDA_*` assignments

- **Bytes** = size of the right-hand side.
- **JSON** means the text parses as JSON.
- **round-trip** means `JSON.stringify(JSON.parse(text)) === text`. Only round-trip blobs could be stored pretty-printed and re-minified byte-identically.
- **verbatim** means the text is valid JSON but must be stored exactly as-is. Re-serialising it would change, e.g., `0.0` → `0`, `100.0` → `100`, `76.0` → `76`, or remove the space after `:`.

| # | Global | Line | Bytes | Class | Proposed file |
|---|---|---|---|---|---|
| 1 | `PANDA_RESOLVE_ASSET` | 4609 | 122,367 | **code**: a closure resolver. Its embedded index (122,081 bytes) is JSON, round-trip | index → `src/data/media-index.json`; resolver code stays in JS |
| 2 | `PANDA_CONFIG` | 4612 | 84 | data, but a JS literal with single quotes; `build.mjs` regex-replaces it | **keep inline** |
| 3 | `PANDA_MEDIA` | 4614 | 261,500 | JSON, verbatim; mutated at 5453 (`approved_paths.push`) | `src/data/panda-media.json` |
| 4 | `PANDA_CAST` | 4617 | 78,752 | JSON, verbatim; mutated at 5414 and 5424 | `src/data/panda-cast.json` |
| 5 | `PANDA_LOGIN_VIDEOS` | 4620 | 179 | JSON, round-trip | `src/data/panda-login-videos.json` |
| 6 | `PANDA_ARABIC` | 4814–5318 | 21,392 | **code**: `Object.fromEntries` over a 503-row `english\|arabic` template literal (21,273 bytes; no backticks, `${` or backslashes) | text → `src/data/panda-arabic-base.txt`; wrapper stays in JS |
| 7 | `PANDA_AR_ARTICLES` | 5393 | 116,410 | JSON, round-trip | `src/data/panda-ar-articles.json` |
| 8 | `PANDA_PLAN_LIBRARY` | 5394 | 195,193 | JSON, verbatim; mutated at 5396 (`programs.push`) | `src/data/panda-plan-library.json` |
| 9 | `PANDA_CARDIO_TEMPLATES` | 5395 | 13,623 | JSON, round-trip | `src/data/panda-cardio-templates.json` |
| 10 | `PANDA_SUPPLEMENT_PLANS` | 5397 | 16,364 | JSON, round-trip | `src/data/panda-supplement-plans.json` |
| 11 | `PANDA_AUTHORED_AR` | 5409 | 3 | **computed at runtime** (`=map`, two functions deep inside `PandaStudio`) | not data; stays |
| 12 | `PANDA_ARTICLE_IMAGES` | 5413 | 1,263 | JSON, verbatim | `src/data/panda-article-images.json` |
| 13 | `PANDA_CATALOGUE` | 5415 | 577,826 | JSON, round-trip; mutated at 5419 and 5422 | `src/data/panda-catalogue.json` |
| 14 | `PANDA_EXERCISE_CATEGORIES` | 5417 | 194 | data, but a JS array with single quotes | **keep inline** (too small to matter) |
| 15 | `PANDA_LIBRARY_EXTENSION` | 5418 | 106,873 | JSON, round-trip | `src/data/panda-library-extension.json` |
| 16 | `PANDA_CARDIO_EXTENSION` | 5421 | 1,664 | JSON, round-trip | `src/data/panda-cardio-extension.json` |
| 17 | `PANDA_SEED_BASE` | 5425 | 80,437 | JSON, verbatim | `src/data/panda-seed-base.json` |
| 18 | `PANDA_RECIPE_SEED` | 5463 | 107,161 | JSON, round-trip; assigned **inside** the 5427–5599 closure | `src/data/panda-recipe-seed.json` |
| 19 | `PANDA_RECIPE_INGREDIENTS` | 5464 | 10,639 | JSON, round-trip; inside the closure | `src/data/panda-recipe-ingredients.json` |
| 20 | `PANDA_EDUCATION_095` | 5467 | 52,758 | JSON, round-trip; inside the closure | `src/data/panda-education-095.json` |
| 21 | `PANDA_CARDIO_METHODS` | 5602 | 807 | JSON, round-trip | `src/data/panda-cardio-methods.json` |
| 22 | `PANDA_CARDIO_INTENSITIES` | 5603 | 338 | JSON, round-trip | `src/data/panda-cardio-intensities.json` |
| 23 | `PANDA_CARDIO_DEFAULTS` | 5604 | 155 | JSON, round-trip | `src/data/panda-cardio-defaults.json` |

**Summary:**
- 18 are pure JSON: 13 round-trip and 5 verbatim.
- 2 are code with an extractable data body: `PANDA_RESOLVE_ASSET` and `PANDA_ARABIC`.
- 2 are JS-literal data, best kept inline: `PANDA_CONFIG` and `PANDA_EXERCISE_CATEGORIES`.
- 1 is runtime-computed: `PANDA_AUTHORED_AR`.
- None contains functions.
- 4 are mutated after assignment: `PANDA_MEDIA`, `PANDA_CAST`, `PANDA_PLAN_LIBRARY` and `PANDA_CATALOGUE`.
- `window.PANDA_ASSETS` is read (`?.`) by `PandaExperience` and `PandaUI` but never assigned.

**Translation dictionaries: about 0.5 MB more data.** These are not among the 23 globals. `PandaI18n.dictionary` **is the same object** as `PANDA_ARABIC` (line 5335). It is extended by 17 `Object.assign` calls:

| Calls (by line) | Class |
|---|---|
| 5321 (62 KB), 5325 (24 KB), 5330, 5332, 5333, **5391 (248 KB)** | JSON, round-trip |
| 5326, 5327 (89 KB), 5597 (38 KB), 6416, 7056–7059 | JSON, verbatim |
| 5328, 6175, 7060 | JS literals; keep inline |

Proposed: `src/i18n/ar-<line or sequence>.json`, one file per call, **kept in today's order**.

Order is load-bearing. Line 5335 builds a lowercase lookup `Map` from the dictionary **once, at load time**. Entries added after that line (5391, 5597, 6416, 7056–7060) are found by exact match but not by the case-insensitive lookup. Merging or reordering these files would change which strings get translated.

### 2.2 How to extract

**Don't load the data at runtime** (`fetch` of `.json`). That would make startup async and break the single-file/offline standalone.

**Inline at assemble time.** The JS keeps a placeholder that is still valid JS, e.g. `window.PANDA_CATALOGUE=/*@json data/panda-catalogue.json*/[];`. `assemble.mjs` replaces `/*@json X*/[]` (or `{}`) with the file's exact text.

**Stage 2a — byte-identical.** Store every blob verbatim, including the minified single line.

**Stage 2b — optional, not byte-identical.**
- Pretty-print the JSON files so diffs become line-based.
- The assembler minifies with `JSON.stringify`.
- The 12 round-trip blobs stay byte-identical.
- The verbatim ones change bytes (`0.0` → `0` and similar) but not values.
- Verify by deep-equal of the parsed values, then take a new baseline hash.

## 3. CSS extraction (stage 3)

| # | Lines | id | Bytes | Purpose (from its comments and selectors) | Data URIs | Selectors repeated from earlier blocks |
|---|---|---|---|---|---|---|
| 1 | 8–2217 | — | 267,581 | "Unified visual system 0.9.16": design tokens, reset, every component; 11 `@media` | 2 woff: PandaDisplay (line 13, 23,152 bytes), PandaSans (line 19, 35,916 bytes) | — |
| 2 | 2218 (one line) | — | 64,199 | "Presentation selection and Arabic": PandaArabic font, RTL rules, experience controls | 1 woff: PandaArabic (43,868 bytes) | 3 |
| 3 | 2220–2232 | `panda-coaching-095` | 2,720 | Coaching tools 0.9.12 | 0 | 1 |
| 4 | 3554–3560 | `panda-studio-096` | 2,512 | Studio 0.9.12 | 0 | 3 |
| 5 | 3561–3696 | `panda-supplement-097` | 13,654 | Supplements, mobile client list, water entry, supersets and coach notes | 0 | 14 |
| 6 | 3697–3712 | `panda-cards-0915` | 1,793 | 0.9.15 overview summaries and meal-card spacing | 0 | 8 |
| 7 | 3713–3717 | `panda-chat-badge` | 550 | Unread badge in the nav | 0 | 1 |
| 8 | 3718–3725 | `panda-meal-photo-tools` | 621 | Meal photo tools under the preview | 0 | 2 |
| 9 | 3726–3734 | `panda-chat-0915` | 2,754 | Chat layout | 0 | 1 |

- **Load order matters.** Blocks 2–9 restate selectors from earlier blocks (33 overlaps in total), so they override by source order. Keep the 9 blocks in today's order and at today's positions.
- **No JS references the style elements.** There are 0 references to the style ids and no `document.styleSheets` use.
- **Data URIs.** Only the 3 woff fonts, 137,318 bytes of base64 in total. All three are canonical base64, so they can move to `src/fonts/panda-display.woff`, `panda-sans.woff` and `panda-arabic.woff` and be re-inlined byte-identically.
  - Other data URIs: the favicon `<link>` (line 2219) uses a non-base64 SVG data URI, and JS line 4779 replaces it at runtime with a `PandaBrand` SVG. Both stay.
- **Proposed files:** `src/styles/01-base.css`, `02-arabic-presentation.css`, `03-coaching-095.css`, `04-studio-096.css`, `05-supplement-097.css`, `06-cards-0915.css`, `07-chat-badge.css`, `08-meal-photo-tools.css`, `09-chat-0915.css`.
  - The `<style id="…">` tags stay in the template with an include marker inside.
  - Each file holds the **exact** text between the tags. Block 1 starts on the `<style>` line itself (`  <style>/* TRAIN…`). Block 2 stays a single 64 KB line; reformatting it is a separate, non-identical change.

## 4. JS module extraction (stage 4)

### 4.1 Top-level structure

- The script has **47 top-level statements, all `ExpressionStatement`s**.
- There are **0 top-level `function`, `const`, `let`, `var` or `class` declarations**, so no names are shared through the script's top-level scope.
- Modules talk only through `window.*` properties: either `window.PandaX` or bare `PandaX`, which resolves to the global at call time.
- 13 of the 47 units use function-level `'use strict'`.

### 4.2 The 22 modules

| Module | Defined in (lines) | Export line | Form |
|---|---|---|---|
| PandaLoginVideo | 4621–4738 | 4621 | `window.X=(()=>{…})()` |
| PandaExperience | 4741–4776 | 4774 | IIFE; calls `apply()` at load (4775) |
| PandaBrand | 4778 | 4778 | object literal |
| PandaFraming | 4781–4812 | 4781 | `window.X=(()=>{…})()` |
| PandaI18n | 5324–5389 | 5385 | IIFE; holds 7 dictionary `Object.assign`s (5325–5333); calls `apply()` at load (5388) |
| PandaStudio | 5398–5411 | 5398 | `window.X=(()=>{…})()`; also sets `PANDA_AUTHORED_AR` (5409) |
| PandaEducationUpgrade | 5454–5462 | 5454 | inside the shared IIFE 5427–5599 |
| PandaCoaching | 5469–5538 | 5537 | nested IIFE inside 5427–5599 |
| PandaRecipes | 5540–5590 | 5540 | nested `window.X=(()=>{…})()` inside 5427–5599 |
| PandaSeed | 5591–5598 | 5598 | `create()` + export; uses the enclosing `clone`, `day`, `education`, `strategy`, `roadmap` |
| PandaServices | 5606–5674 | 5673 | IIFE |
| PandaCloud | 5679–5827 | 5825 | IIFE |
| PandaChatBadge | 5831–5842 | 5831 | `window.X=(()=>{…})()` |
| PandaChat | 5843–5901 | 5843 | `window.X=(()=>{…})()` |
| PandaGuides | 5905–6102 | 6101 | IIFE |
| PandaAttention | 6105–6125 | 6124 | IIFE |
| PandaSelects | 6128–6162 | 6161 | IIFE |
| PandaUI | 6164–6292 | 6291 | IIFE |
| PandaAnatomy | 6296–6358 | 6357 | IIFE |
| PandaAccountUI | 6361–6414 | 6413 | IIFE |
| PandaCalories | 6419–6440 | 6419 | `window.X=(()=>{…})()` |
| PandaPortal | 6442–7064 | 7061 | IIFE, 623 lines, 306.8 KB; **boots the app** (`render()` 7055, `PandaCloud.start()` 7062) |

**Unit 5427–5599 must stay one file.** It defines `PandaEducationUpgrade`, `PandaCoaching`, `PandaRecipes`, `PandaSeed` and three data globals inside **one** closure, and `PandaSeed.create` uses that closure's local `clone`, `day`, `education`, `strategy` and `roadmap`.

**`PandaPortal` stays one file in this stage.** Its 295 inner statements share mutable closure state (`state`, `route`, `dirty`, `recipeDraft` and others). Splitting it is a real refactor, not an extraction.

### 4.3 Dependency map

- **Eager** = read while the unit itself is being evaluated, outside nested functions. Only these impose load order.
- **Lazy** = read inside functions. These are a lower bound for what actually runs at load, because `apply()` and `render()` are called during evaluation and reach lazy references through `?.` guards.

| Unit (lines) | Eager reads | Lazy reads |
|---|---|---|
| PandaLoginVideo (4621) | — | PANDA_LOGIN_VIDEOS, PandaExperience, PandaServices, PandaUI |
| PandaExperience (4741) | — | PANDA_ASSETS, PANDA_CAST, PANDA_RESOLVE_ASSET, PandaBrand, PandaFraming, PandaI18n, PandaLoginVideo, PandaPortal, PandaServices, PandaUI |
| PandaBrand (4778) | — | PANDA_RESOLVE_ASSET |
| favicon (4779) | PandaBrand | — |
| PandaFraming (4781) | — | PANDA_CAST, PANDA_MEDIA, PandaExperience |
| dictionary add (5321) | PANDA_ARABIC | — |
| PandaI18n (5324) | PANDA_ARABIC | PANDA_AUTHORED_AR, PandaExperience, PandaServices |
| dictionary adds (5391, 6416) | PandaI18n | — |
| plan push (5396) | PANDA_PLAN_LIBRARY, PANDA_CARDIO_TEMPLATES | — |
| PandaStudio (5398) | — | PANDA_AR_ARTICLES, PANDA_CATALOGUE, PANDA_PLAN_LIBRARY, PANDA_SUPPLEMENT_PLANS, PandaCoaching, PandaServices |
| cast paths (5414, 5424) | PANDA_CAST | — |
| catalogue merges (5419, 5422) | PANDA_CATALOGUE, PANDA_LIBRARY_EXTENSION, PANDA_CARDIO_EXTENSION | — |
| Seed/Coaching/Recipes (5427) | PANDA_ARABIC, PANDA_MEDIA | PANDA_SEED_BASE, PandaServices, PandaStudio |
| PandaServices (5606) | PANDA_CATALOGUE | PANDA_CARDIO_*, PANDA_MEDIA, PANDA_SEED_BASE, PandaCoaching, PandaExperience, PandaRecipes, PandaSeed, PandaStudio |
| PandaCloud (5679) | PANDA_CONFIG | PandaSeed, PandaServices |
| PandaChatBadge (5831) | — | PandaCloud, PandaServices |
| PandaChat (5843) | — | PandaChatBadge, PandaCloud, PandaExperience, PandaServices |
| PandaGuides (5905) | — | — |
| PandaAttention (6105) | — | PandaCoaching, PandaServices |
| PandaSelects (6128) | — | PandaUI |
| PandaUI (6164) | PANDA_ARABIC | PANDA_ASSETS, PANDA_CAST, PANDA_MEDIA, PANDA_RESOLVE_ASSET, PandaExperience, PandaSelects |
| PandaAnatomy (6296) | PandaUI | — |
| PandaAccountUI (6361) | PandaCloud, PandaUI | PandaBrand, PandaExperience, PandaI18n, PandaLoginVideo, PandaPortal, PandaServices |
| PandaCalories (6419) | — | PandaCoaching |
| PandaPortal (6442) | PANDA_ARABIC, PandaCloud, PandaI18n, PandaRecipes, PandaSeed, PandaServices, PandaUI | the remaining 15 modules and 9 data globals |

**Execution order matters. Keep today's order exactly.**
- Eager edges require it. For example, PandaUI must come before PandaAnatomy and PandaAccountUI, and PANDA_CATALOGUE must be fully merged (5419, 5422) before PandaServices reads it.
- Data mutations run in sequence, e.g. `PANDA_CAST.paths` at 5414 then 5424.
- The PandaI18n lowercase map is built at a fixed point (§2.1).
- `PandaPortal` must be last, because it starts the app.

### 4.4 Proposed files

Every line from 4608 to 7067 belongs to exactly one file. Comment and blank lines attach to the **following** unit. The assembler joins the files in this order with `\n`.

| File | Lines | File | Lines |
|---|---|---|---|
| `src/js/01-resolve-asset.js` | 4608–4609 | `14-cardio-options.js` | 5600–5604 |
| `02-config.js` | 4610–4612 | `15-services.js` | 5605–5674 |
| `03-media-cast.js` | 4613–4620 | `16-cloud.js` | 5675–5827 |
| `04-login-video.js` | 4621–4738 | `17-chat-badge.js` | 5828–5842 |
| `05-experience.js` | 4739–4776 | `18-chat.js` | 5843–5901 |
| `06-brand.js` | 4777–4779 | `19-guides.js` | 5902–6102 |
| `07-framing.js` | 4780–4812 | `20-attention.js` | 6103–6125 |
| `08-arabic.js` | 4813–5321 | `21-selects.js` | 6126–6162 |
| `09-i18n.js` | 5322–5391 | `22-ui.js` | 6163–6292 |
| `10-plan-data.js` | 5392–5397 | `23-anatomy.js` | 6293–6358 |
| `11-studio.js` | 5398–5411 | `24-account-ui.js` | 6359–6416 |
| `12-catalogue.js` | 5412–5425 | `25-calories.js` | 6417–6440 |
| `13-seed-coaching-recipes.js` | 5426–5599 | `26-portal.js` | 6441–7067 |

**Must stay in the HTML template:**
- the head metadata;
- the favicon `<link rel="icon">`, which 4779 rewrites;
- the body shell markup (3742–3749), whose element ids `sidebar`, `topbar`, `main`, `mobile-nav`, `modal`, `modal-content`, `toast` are looked up by the JS;
- the `<script>`/`</script>` wrapper.

**Must stay recognisable to the build** (unchanged, because the assembled file is identical):
- `window.PANDA_CONFIG = {…};` (02);
- the resolver marker and lookup string (01).

The output stays **one inline `<script>`**. Because there are no top-level declarations, serving the 26 files as separate classic `<script>` tags would also be semantically safe, but that changes the bytes of `index.html`. Converting to ES modules is **not** recommended: it makes everything strict and deferred, and 34 of 47 units are not strict today.

## 5. Risks across all stages

| Risk | Finding | Consequence for the plan |
|---|---|---|
| `</script>` / `</style>` inside JS | 0 occurrences of `</script`, `<\/script`, `</style` or `<!--` in the JS. CSS contains no `</style`. | Inlining is safe today. `assemble.mjs` should **fail** if a JS part contains `</script` or a CSS part contains `</style`, so a future edit cannot silently break the page. |
| Inline event handlers | 0 `on…=` attributes in the body markup and 0 in JS template strings. All events use `addEventListener` / delegation. | No global function names need to survive. |
| Same-scope reliance | No shared top-level scope (§4.1). Shared **closure** scope exists inside unit 5427–5599 and inside PandaPortal. | Those two stay single files. |
| Execution-order reliance | Eager references, data mutations, `apply()` / `render()` at load, and the i18n map snapshot. | Concatenate in the original order only. |
| Other dynamic code | 0 `eval`, `new Function`, `document.write`, `document.currentScript`, `import()` or `with`. | — |
| Build and check coupling | `build.mjs`, `media-index.mjs`, `check.mjs` and `tests/verify.cjs` depend on: the standalone path, the text/plain tag regex, the resolver marker and lookup string, the `PANDA_CONFIG` regex, and `</head>`. | All keep working while the assembled file is byte-identical. Each needs a deliberate update if the output is later allowed to change. |
| Line endings and editor normalisation | `core.autocrlf=true` system-wide; editors may add a final newline, trim trailing whitespace or reformat on save. | `.gitattributes` (eol=lf, binaries marked); `.editorconfig` with `insert_final_newline = false` for `src/**`, or an assembler rule that every part ends with exactly one `\n`, which it strips. The sha256 gate catches any drift. |
| JSON re-serialisation | 5 data blobs and 8 dictionary blobs do not round-trip (`0.0`, `100.0`, `", "` spacing). | Stage 2a stores them verbatim. Pretty-printing is stage 2b (§2.2). |
| Standalone file status | `README.md` calls the standalone "the canonical source"; `check.mjs`, `tests/verify.cjs`, `release.json` and `MANIFEST.*` all name it. | **Decision needed** (§7). |
| Line numbers | Error stack traces and these line references change once output bytes change. | None while output stays byte-identical. |

## 6. Effort and verification per stage

### 6.1 Baseline to save before stage 0

- The `release.json` from a clean build: 279 file entries with name, bytes and sha256.
- The standalone sha256: `e7aa57c4…`.
- `npm run check` passes against today's `public/` (1.6 s): *"1 inline scripts, 779 unchanged bundled payloads and 268 byte-identical external library images"*.

### 6.2 Gates every stage must pass, in order

1. **G1 — standalone identical.** `node scripts/assemble.mjs --out <tmp>`; `sha256(tmp) === e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`.
2. **G2 — public output identical.** Run a clean build in a scratch copy with the **same** `deployment-config.json`, because today's `public/` is built with the connection configured.
   - Compare the new `release.json.files` with the baseline: all 279 name/bytes/sha256 entries must match.
   - Also run `diff -r` against the current `public/`.
3. **G3 — check passes.** `npm run check` PASS.
4. **G4 — runtime boots.** `cd tests && npm install && npm run verify`. This boots the page in jsdom and requires 0 runtime errors.
   - `tests/node_modules` is not installed yet.
   - The script rewrites `docs/VERIFICATION.json`, so run it on a copy or restore that file afterwards.
5. **G5 — manual smoke test.** `npm run dev`, then check: login screen and login video, switching to Arabic, an exercise-library image (an externalised WebP), a recipe photo (a bundled AVIF), and the exercise anatomy view.

### 6.3 Stage-by-stage

| Stage | Work | Stage-specific checks | Estimated effort |
|---|---|---|---|
| 0 — line endings | **Done 2026-10-31**, see §8: `.gitattributes` | Fresh clone checks out LF, rebuilds identically, `npm run check` passes | done |
| 1 prep | `assemble.mjs` and the baseline are **done** with stage 1. Still open: `.editorconfig`; a `prebuild` hook, which waits on decision 1 in §7 | G1–G3 | 1 h |
| 1 — media | **Done 2026-10-31**, see §9 | G1–G3 passed; G4–G5 not run | done |
| 2a — data | **18 pure-JSON globals done 2026-10-31**, see §10. Still in the template: the 2 code-wrapped data bodies (resolver index, `PANDA_ARABIC` text) and the 14 extractable dictionary blobs (§2.1) | Each file is valid JSON and byte-equal to the original slice; G1–G3 passed | done (globals); 1–2 h left for index, Arabic text and dictionaries |
| 2b — data, optional | Pretty-print JSON; assembler minifies | Deep-equal of every parsed value, old vs new; **new** baseline hash, because G1/G2 are expected to change | 2–3 h |
| 3 — CSS | **Done 2026-10-31**, see §11 | Fonts re-encode to the original base64; G1–G3 passed | done |
| 4 — JS | **Done 2026-10-31**, see §12 | All 47 statements inside exactly one file; every file parses with its data filled in; G1–G3 passed | done |
| 1b — build from `src/`, optional | §1.3 option B; update `check.mjs` and `verify.cjs` | G2 byte-identical, including the 1,046 blank lines; G3–G5 | 3–4 h |
| 5 — wrap-up | **Done 2026-10-31**, see §13 | G1–G4 passed; fresh clone passes | done |

Stages 0–4 with byte-identical output come to about **12–20 hours**. Stage 1 alone removes 96% of the file's bytes from the hand-edited source.

## 7. Open decisions

1. **What happens to `standalone/Train-With-Panda-Portal.html` once `src/` exists?**
   - (a) Keep committing it as a generated artifact. Nothing downstream changes, but every edit still adds about 57 MiB to the repo.
   - (b) **Recommended:** gitignore it and generate it with `assemble.mjs` before build, check and test. README, DEPLOY and MANIFEST must say so.
   - **Decided 2026-10-31: (b).**
     - The standalone is gitignored and untracked (`git rm --cached`), and kept on disk.
     - `"prebuild": "npm run assemble"` runs before every build. `assemble.mjs` now creates `standalone/` if it is missing, as it is in a fresh clone.
     - README.md and docs/DEPLOY.md name `src/portal.template.html` + `src/media/` as the source of truth.
     - Verified: a fresh clone without the standalone runs `npm install`, `npm run build` and `npm run check`, and they pass. With `deployment-config.json` added, it builds the identical 279 public files.
     - `MANIFEST.json` / `MANIFEST.sha256` still list the standalone; regenerate them in the wrap-up.
2. **Is stage 2b wanted** (readable JSON diffs at the cost of a new output hash)? Or stay byte-identical throughout and accept minified data files?
3. **`panda-embedded-asset-56`** (unreferenced, 24.5 KB): keep, or remove as a separate change with a new baseline?

## 8. Stage 0 — line endings (done 2026-10-31)

This fixes a bug that existed before the restructure. No extraction was done, and no tracked file was changed.

### The bug

- `core.autocrlf=true` is set in the system Git config (`C:/Program Files/Git/etc/gitconfig`), and the repo had no `.gitattributes`.
- Git therefore converted LF to CRLF on checkout. The index stores every text file with LF, which `git ls-files --eol` shows as `i/lf` for all 51 text files.
- `scripts/check.mjs` compares the standalone's sha256 with `release.json`, and the build hashes it into the output. Any CR byte breaks both.

**Reproduced** in a fresh `git clone` of commit `14a69f0`, with no `.gitattributes`:
- `standalone/Train-With-Panda-Portal.html` was checked out with **7,070 CR bytes**, one per line.
- Its sha256 was `ddf2565e…`, not `e7aa57c4…`.
- `npm run check` failed with *"Standalone changed. Rebuild before deployment."*
- After a rebuild, `public/index.html` also differed from the project's build. A deploy from such a clone would have shipped CRLF in the page.

### The change

A new file, `.gitattributes`, in the project root:

| Rule | Effect |
|---|---|
| `* text=auto eol=lf` | Every file Git detects as text is stored and checked out with LF, whatever `core.autocrlf` says |
| `*.html *.css *.js *.mjs *.cjs *.ts *.json *.jsonc *.md *.txt *.sql *.toml *.sha256 .env.example text eol=lf` | These are always text, always LF, with no auto-detection. This covers the standalone HTML and every build, check and test script. |
| `*.png *.jpg *.jpeg *.gif *.ico *.webp *.avif *.mp4 *.webm *.woff *.woff2 *.bundle binary` | Never converted or text-diffed. This covers the article PNGs and `history/frontend-history.bundle`. |
| `src/media/** binary` | Ahead of stage 1: extracted payloads, including the one SVG, must stay byte-exact |

No tracked file needed renormalising. Every text file was already LF in the index, and the 4 binaries already read as `-text`.

### Verification

| Check | Result |
|---|---|
| Project working copy: CR bytes in the standalone HTML | 0 |
| Its sha256 | `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, equal to `release.json` and to `MANIFEST.sha256` |
| `git ls-files --eol` for the standalone | `i/lf w/lf attr/text eol=lf` |
| `npm run check` in the project | PASS (*"1 inline scripts, 779 unchanged bundled payloads and 268 byte-identical external library images"*), exit 0 |
| Fresh clone **with** `.gitattributes`: checkout | 0 CR bytes, 0 files with CRLF, sha256 `e7aa57c4…` |
| Fresh clone with `.gitattributes`: `npm run build` then `npm run check` | build: 279 files; check: PASS. Standalone hash and all 279 public file entries (name, bytes, sha256) equal to the project's `release.json` |
| Control: the same clone **without** `.gitattributes` | 7,070 CR bytes; `index.html` differs from the project's build |

The clone tests ran in a scratch directory, with `deployment-config.json` copied in because it is gitignored. The directory was deleted afterwards.

### Still to do

- ~~`.gitattributes` only reaches clones once it is committed.~~ Committed in `f19efc6`.
- **`wrangler.jsonc` is CRLF in this working copy only** (`i/lf w/crlf`). The repo copy is LF, and Git stores it as LF on the next commit, so nothing needs doing. A fresh checkout gets LF.
- The other items first planned for stage 0 (`.editorconfig`, skeleton `assemble.mjs`, saved baseline, `prebuild`) are now the "1 prep" row in §6.3.

## 9. Stage 1 — media extraction (done 2026-10-31)

Only media moved. CSS, JS, data globals, `build.mjs` and `check.mjs` are untouched.

### What changed

| Path | What it is |
|---|---|
| `src/portal.template.html` | The standalone HTML with lines 2233–3279 (the 1,047 payload lines) replaced by one line, `<!--@media src/media/manifest.json-->`. **3,252,590 bytes, 6,024 lines** (was 79,896,002 bytes, 7,070 lines). |
| `src/media/<payload id>.<ext>` | 1,047 decoded binaries, named by payload id: 712 `.avif`, 329 `.webp`, 3 `.png`, 1 `.svg` (`panda-embedded-asset-671`), 2 `.mp4`. 57,425,499 bytes in total. Includes the unreferenced `panda-embedded-asset-56.avif` (24,524 bytes). |
| `src/media/manifest.json` | The 1,047 filenames in original source order, one per line. Order decides how `build.mjs` groups bundles, and so the bundle filenames. |
| `scripts/assemble.mjs` | Rebuilds `standalone/Train-With-Panda-Portal.html` (or `--out <file>`). See the list below. |
| `scripts/restructure/extract-media.mjs` | The one-time migration that produced `src/`. See the list below. |
| `package.json` | Adds `"assemble": "node scripts/assemble.mjs"`. |
| `.gitattributes` | Adds `src/media/manifest.json text eol=lf diff merge`, so the manifest is diffable despite the `src/media/** binary` rule. |

What `scripts/assemble.mjs` does:
- Reads the template and expands the marker into `<script type="text/plain" id="ID">` + `base64(file)` + `</script>` lines, in manifest order.
- Fails on any CR in the template.
- Fails unless the marker appears exactly once.
- Fails on a file in `src/media` that is not in the manifest, and on an invalid or duplicate id.
- Prints the byte count and sha256 of what it wrote. A run takes about 2.3 s.

What `scripts/restructure/extract-media.mjs` does:
- Refuses to run if `src/media` exists.
- Requires the payload lines to be contiguous and canonical base64.
- Detects each file type from its magic bytes.
- Writes nothing unless the result reassembles to the identical sha256.

### Acceptance

| # | Criterion | Result |
|---|---|---|
| 1 | `npm run assemble` gives the identical standalone | **sha256 before `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, after `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`.** `cmp` confirms byte-identical; `git status` shows the standalone unchanged. |
| 2 | `npm run build` gives the identical 279 public files | 279 files. A sha256 list of `public/` is identical to the one saved before stage 1. `release.json` is byte-identical to the saved copy, covering all 279 entries' name, bytes and sha256 plus the standalone entry. |
| 3 | `npm run check` | PASS, exit 0 |
| 4 | The 3 base64 data URIs in the CSS are untouched | The template still contains 3 `data:font/woff;base64,` URIs (PandaDisplay, PandaSans, PandaArabic), the same as the original. |

Criterion 4 asked about "CSS and JS". All 3 are in the CSS: the JS holds none of the 3 base64 URIs; its favicon SVG is a non-base64 data URI.

G4 (jsdom verify) and G5 (browser smoke test) from §6.2 were not run. They exercise the same assembled bytes, so they add nothing until the output is allowed to change.

### Notes for the next stages

- **Do not edit the generated standalone directly.** Edits now go into `src/portal.template.html`, then `npm run assemble`. The standalone is still committed and is still what `build`, `check` and `tests/verify.cjs` read. Decision 1 in §7 is still open.
- Until that decision, committing `src/media` (≈ 57 MB) alongside the standalone (≈ 80 MB) stores the media twice in Git.
- The template still has very long lines: the JS data globals, up to 577,850 characters. Editors set to add a final newline or trim whitespace would change its bytes. The sha256 printed by `assemble` catches this. `.editorconfig` is still open.

## 10. Stage 2 — data globals (done 2026-10-31)

Only the 18 pure-JSON `window.PANDA_*` globals moved. CSS, JS modules, media, `build.mjs` and `check.mjs` are untouched.

### What changed

| Path | What it is |
|---|---|
| `src/data/panda-*.json` | 18 files, one per global, holding the exact original bytes (1,621,942 bytes in total). They are not reformatted and have no trailing newline. All 18 sizes match the acorn-derived sizes in §2.1. |
| `src/data/manifest.json` | `[{global, file}]` in template order |
| `src/portal.template.html` | Each value replaced in place: `window.PANDA_CATALOGUE=/*@data src/data/panda-catalogue.json*/;`. Now **1,631,418 bytes, 6,024 lines** (was 3,252,590 bytes, 6,024 lines). |
| `scripts/assemble.mjs` | Resolves `/*@data …*/` markers before media (see the checks below) |
| `scripts/restructure/extract-data.mjs` | One-time migration. It finds each value by text, with a string-aware bracket match, so it needs no parser dependency. It writes nothing unless the template round-trips exactly, and refuses to run if `src/data` exists. |

Checks `assemble.mjs` makes, each failing with a clear error:
- A data file is missing.
- A file is not listed in the manifest.
- The manifest lists a file twice.
- The marker order differs from the manifest order.
- A marker is missing from the template.
- A marker does not directly follow its `window.<global>=`.
- A file ends with whitespace or a newline.
- A file is invalid JSON.

**Left in the template, as instructed:**
- The 5 globals that are not pure JSON: `PANDA_RESOLVE_ASSET`, `PANDA_CONFIG`, `PANDA_ARABIC`, `PANDA_AUTHORED_AR` and `PANDA_EXERCISE_CATEGORIES`.
- All 17 `Object.assign` dictionary calls, which are not globals. Their order is unchanged.

### Acceptance

| # | Criterion | Result |
|---|---|---|
| 1 | `npm run assemble` sha256 | expected `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, actual `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`; `cmp` against the file committed in `14a69f0` is byte-identical |
| 2 | `npm run build` | 279 files; names and sha256 identical to the pre-stage-1 baseline; `release.json` byte-identical |
| 3 | `npm run check` | PASS, exit 0 |
| 4 | Clear errors | 8 broken copies in a scratch directory each fail with a specific message, and none writes output (table below) |

| Tampering | Error |
|---|---|
| Delete `panda-catalogue.json` | `Data file missing: src/data/panda-catalogue.json (PANDA_CATALOGUE).` |
| Swap manifest entries 4 and 5 | `Data markers out of order: position 4 in src/data/manifest.json is panda-plan-library.json (PANDA_PLAN_LIBRARY), but the template has panda-ar-articles.json there.` |
| Move a global earlier in the template | `Data markers out of order: position 1 … is panda-media.json (PANDA_MEDIA), but the template has panda-cardio-methods.json there.` |
| Remove the last marker | `Template is missing the data marker for panda-cardio-defaults.json (PANDA_CARDIO_DEFAULTS).` |
| Add an unlisted file | `Data file not listed in src/data/manifest.json: src/data/panda-extra.json` |
| Append a final newline | `src/data/panda-cast.json ends with whitespace or a newline; …` |
| Break the JSON | `src/data/panda-login-videos.json is not valid JSON: Unexpected end of JSON input` |
| Rename the global before a marker | `Data marker for panda-seed-base.json must directly follow window.PANDA_SEED_BASE=` |

### Notes

- **The data files are single-line minified JSON.** A JSON formatter (e.g. format-on-save) would keep them valid but change their bytes. The assembled sha256 would then differ, and `npm run check` / the output hashes would show it. Making them readable is stage 2b.
- **The template line count did not change.** Every global was already on one line.
- **Editor protection was added afterwards** (2026-10-31): `.vscode/settings.json` treats `src/data/panda-*.json` as plain text and turns off save-time formatting and newline edits for it; `.prettierignore` excludes `src/data/`; `src/data/README.md` explains the rule. Verified with `npx prettier@3 --check`: the files are skipped with the ignore file, and flagged for reformatting without it. `assemble.mjs` ignores `README.md` in `src/data`.

## 11. Stage 3 — CSS and fonts (done 2026-10-31)

Only CSS and fonts moved. JS modules, data, media, `build.mjs` and `check.mjs` are untouched.

### What changed

| Path | What it is |
|---|---|
| `src/css/01-visual-system.css` … `09-chat-layout.css` | The 9 `<style>` blocks in source order, named by number and purpose (see the table below). The block text is exact; each file adds a single final newline, which `assemble.mjs` strips. |
| `src/css/manifest.json` | `[{file, id}]` in source order. The order is load-bearing: later blocks override 33 selectors from earlier ones. |
| `src/fonts/panda-display.woff`, `panda-sans.woff`, `panda-arabic.woff` | The 3 embedded fonts as binary woff (23,152 / 35,916 / 43,868 bytes). Inside the CSS, each base64 body is now `/*@font src/fonts/<file>*/`; the `data:font/woff;base64,` prefix stays in the CSS. |
| `src/fonts/manifest.json` | `[{family, file}]` in the order the fonts appear in the CSS |
| `src/portal.template.html` | Each block body replaced by `/*@css src/css/<file>*/` inside its original `<style>` tag. The block's own leading and trailing newlines stay in the template. Now **1,275,396 bytes, 3,643 lines** (was 1,631,418 bytes, 6,024 lines). |
| `scripts/assemble.mjs` | Restructured around shared manifest and order checks, now also used for data. Resolves data, then CSS (with fonts), then media. |
| `scripts/restructure/extract-css.mjs` | One-time migration. It refuses to run if `src/css` or `src/fonts` exists, and writes nothing unless the template round-trips exactly. |
| `.vscode/settings.json`, `.prettierignore` | Format protection extended to `src/css/` (`[css]` format-on-save, format-on-paste and format-on-type off) and to the template (Prettier ignore) |

| File | Style id | Bytes |
|---|---|---|
| `01-visual-system.css` | (none) | 188,893 (contains PandaDisplay, PandaSans) |
| `02-presentation-arabic.css` | (none) | 5,745 (contains PandaArabic) |
| `03-coaching-tools.css` | panda-coaching-095 | 2,719 |
| `04-studio.css` | panda-studio-096 | 2,511 |
| `05-supplements-and-updates.css` | panda-supplement-097 | 13,654 |
| `06-overview-meal-cards.css` | panda-cards-0915 | 1,792 |
| `07-chat-badge.css` | panda-chat-badge | 549 |
| `08-meal-photo-tools.css` | panda-meal-photo-tools | 620 |
| `09-chat-layout.css` | panda-chat-0915 | 2,753 |

**Why the final newline is stored differently from `src/data`.** The boundary newlines differ per block: block 1 ends with `\n\n`, block 2 has none, blocks 3–9 start and end with `\n`. Those exact newlines therefore live in the template, around the marker. Every CSS file then ends with exactly one newline, so an editor's "insert final newline" or "trim final newlines" changes nothing. `assemble.mjs` fails if a file has no final newline, or more than one.

### Acceptance

| # | Criterion | Result |
|---|---|---|
| 1 | `npm run assemble` sha256 | expected `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, actual `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`; `cmp` against the file committed in `14a69f0` is byte-identical |
| 2 | `npm run build` | 279 files; names and sha256 identical to the pre-stage-1 baseline; `release.json` byte-identical |
| 3 | `npm run check` | PASS, exit 0 |
| 4 | Clear errors | 12 broken copies in a scratch directory each fail with a specific message, and none writes output (list below) |

The 12 cases:
- a CSS file missing;
- an unlisted CSS file;
- CSS manifest entries swapped;
- CSS blocks swapped in the template;
- the last CSS marker removed;
- a marker inside the wrong `<style>` tag;
- a missing final newline;
- an extra final newline;
- a font file missing;
- font manifest entries swapped;
- font markers swapped between `@font-face` rules;
- a data file missing (regression check).

## 12. Stage 4 — JavaScript (done 2026-10-31)

Only the inline `<script>` body moved. Data, CSS, fonts, media, `build.mjs` and `check.mjs` are untouched.

### What changed

| Path | What it is |
|---|---|
| `src/js/01-resolve-asset.js` … `26-portal.js` | The script body, split at the §4.4 boundaries, in original order. Each file holds its lines exactly, plus the single final newline that `assemble.mjs` strips. Total 1,268,415 bytes. The full contents table is in `src/js/README.md`. |
| `src/js/manifest.json` | `[{file}]` in execution order |
| `src/js/README.md` | Rules (order, the two whole closures, final newline, no `</script`) and a table of what each file contains |
| `src/portal.template.html` | The script body is now 26 `/*@js src/js/<file>*/` lines, between the script's original blank first line and three blank last lines. Now **7,766 bytes, 1,213 lines** (was 1,275,396 bytes, 3,643 lines). Most remaining lines are the original file's runs of empty lines (274 after the media marker, 857 before `<script>`), kept for byte-identity. |
| `scripts/assemble.mjs` | Resolves JS first. The data markers moved into JS files 03, 10, 12, 13 and 14, so the data and CSS checks now run on the JS-resolved source. |
| `scripts/restructure/extract-js.mjs` | One-time migration. It checks the script body's shape, refuses to run if `src/js` exists, and writes nothing unless the template round-trips exactly. |
| `.vscode/settings.json`, `.prettierignore` | Format protection extended to `src/js/` |

Checks `assemble.mjs` adds for JS, each failing with a clear error:
- a file is missing, unlisted, or listed twice;
- marker order differs from the manifest;
- a marker is missing;
- a marker is not on a line of its own;
- a marker is outside the inline `<script>`;
- a file has no final newline, or more than one;
- a file contains CR characters;
- a file contains `</script`.

**Boundary verification** (acorn, scratch only):
- All 47 top-level statements fall inside exactly one file, and 0 cross a file boundary.
- Every file parses on its own once its data markers are filled.
- No file ends with a blank line, and the JS has 0 lines with trailing whitespace.

The two shared-closure units are whole files: `13-seed-coaching-recipes.js` (original 5426–5599: `PandaEducationUpgrade`, `PandaCoaching`, `PandaRecipes`, `PandaSeed`) and `26-portal.js` (original 6441–7064: `PandaPortal`).

### Acceptance

| # | Criterion | Result |
|---|---|---|
| 1 | `npm run assemble` sha256 | expected `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, actual `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`; `cmp` against the file committed in `14a69f0` is byte-identical |
| 2 | `npm run build` | 279 files; names and sha256 identical to the pre-stage-1 baseline; `release.json` byte-identical |
| 3 | `npm run check` | PASS, exit 0 |
| 4 | Clear errors | 11 broken copies in a scratch directory each fail with a specific message, and none writes output; the unchanged control assembles (list below) |

The 11 cases:
- a JS file missing;
- an unlisted JS file;
- manifest entries swapped;
- markers swapped in the template;
- the portal marker removed;
- a marker not on its own line;
- a marker moved outside `<script>`;
- a missing final newline;
- an extra final newline;
- `</script>` inside a file;
- a data file missing (regression check).

### Known follow-up

**Five JS files are not valid JS as stored:** 03, 10, 12, 13 and 14. A data marker leaves `window.PANDA_X=/*@data …*/;`, so editors and linters report syntax errors there until the data is filled in. The build is unaffected.

Fix: change the data-marker form to a valid placeholder such as `/*@data src/data/x.json*/null`, which `assemble.mjs` replaces as a whole. This is a template-only change, verifiable by the same sha256.

**Resolved 2026-10-31.**
- All 18 markers now read `window.PANDA_X=/*@data src/data/<file>*/null;`.
- `assemble.mjs` replaces the marker including `null`, and rejects the old form with: *Every data marker must be written /\*@data src/data/<file>\*/null*.
- All 26 raw `src/js` files parse with acorn. The sha256 is unchanged (`e7aa57c4…`), the build is identical and `npm run check` passes.
- `scripts/restructure/extract-data.mjs` still documents the original form; it is a historical one-time script and refuses to run again.

## 13. Stage 5 — wrap-up (done 2026-10-31)

### MANIFEST.json / MANIFEST.sha256

**Generated by the new `scripts/manifest.mjs`** (`npm run manifest`; `--check` fails if out of date). Same formats as before: `{version, files:[{path, bytes, sha256}]}` and `sha256sum`-style lines, sorted case-insensitively.

**Scope changed from "handover package" to "source package."**
- The original 333 entries were the 53 tracked files, plus the generated `public/` (279 files) and `release.json`, plus the standalone.
- Now listed: every file Git tracks or would add (tracked files plus untracked files that are not ignored), except the two manifests. That includes `src/` and excludes the generated standalone, `public/` and `release.json`.

Why build outputs are no longer listed:
- They are gitignored, and they depend on the builder's `deployment-config.json`. The old manifest's `public/index.html` (`ff86786c…`) was the unconfigured build; a configured build differs (`186c06ba…`), while the other 278 public files matched.
- `release.json` already records the hash of every output and of the standalone on each build.

**Text files are hashed as a checkout contains them, with LF.**
- `manifest.mjs` asks `git check-attr` which files are text and converts CRLF to LF before hashing them. Binaries are hashed raw; all 1,054 binary entries were checked against their disk bytes.
- This was found by the fresh-clone test. The project's working-copy `wrangler.jsonc` has CRLF from a local edit, so a raw-bytes manifest disagreed with every clone (`f97d352a…` vs `9fb16d05…`).
- `.vscode/settings.json` now also sets `files.eol` to `\n`, so VS Code on Windows no longer creates CRLF files.

### tests/verify.cjs

- It read `standalone/Train-With-Panda-Portal.html` directly, which fails in a fresh clone and can test stale output. It now runs `scripts/assemble.mjs --out <tmp>` and boots that file in jsdom, then deletes it.
- The check labels are unchanged, so `docs/VERIFICATION.json` is byte-identical after a run.
- **G4 has now run for the first time:** `cd tests && npm install && npm run verify` passed all 6 checks — 20 migrations, no seeded accounts, 3 articles, RLS, migration-020 rerun, and the page assembled from `src/` booting with no JS errors.

### README.md

New sections:
- **"Frontend source layout"**: what lives in each `src/` folder, the markers, manifests and why order matters, and what `assemble.mjs` rejects.
- **"Generated files, never edited"**.
- **"Making a frontend change"**: edit → assemble → build → check → verify → manifest.

The handover and licensing text is kept. The font-notice location (the template) was re-checked.

