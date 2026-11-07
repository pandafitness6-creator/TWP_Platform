# AFTER — measurements after restructuring

Captured 2026-10-31 on branch `dev` at commit `ac972b3` (stages 0–5 complete), package version 0.9.16.
Environment: Windows 11, Node v22.22.0, GNU grep 3.0, Git Bash — the same as BEFORE.md.
MiB = 1,048,576 bytes, KiB = 1,024 bytes, MB = 1,000,000 bytes. Commands and methodology follow BEFORE.md; any difference is noted where it occurs.

**Output is unchanged.** `npm run assemble` still produces the identical standalone (sha256 `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, 79,896,002 bytes, 7,070 lines). `npm run build` produces 279 public files whose sha256 list is identical to the one recorded before stage 1.

## Before vs after

| Metric | Before | After |
|---|---|---|
| What a developer edits | 1 file: 79,896,002 bytes (76.19 MiB), 7,070 lines | 54 text files, 3,117,431 bytes in total. Template: 7,766 bytes, 1,213 lines. Largest code file: `26-portal.js`, 329,196 bytes, 624 lines. Median JS file ≈ 7 KB. |
| Lines > 1,000 characters (edited text) | 1,198 | 149 |
| Lines > 20,000 characters (edited text) | 1,053 | 16, in 13 of 54 files (9 data files, 4 JS files) |
| Longest line | 3,304,849 (a login video) | 577,468 (`src/data/panda-catalogue.json`) |
| Media | 1,047 base64 payloads inside the HTML, 76,568,780 bytes | 1,047 binary files, 57,425,499 bytes (−25%) |
| Source files on disk / tracked | 67 / 55 | 1,189 / 1,176 |
| grep for `function weekCalendar(` | 0.069 s (median), line 6610 of the 76 MiB file | 0.022 s in `src/js/26-portal.js` (line 170); 0.022 s across `src/js/`; 0.128 s across all of `src/` |
| One-line **code** change: `git diff` time | 1.47 s | 0.039 s |
| One-line code change: commit time | 2.71 s | 0.073 s |
| One-line code change: object-store growth | +58,522 KiB | **+119 KiB** |
| One-line **data** change: diff size | 1,264,603 bytes | 1,155,902 bytes (still a whole 577 KB line, see §3) |
| One-line data change: object-store growth | +58,522 KiB | **+79 KiB** |
| `npm run build`, warm | 1.48–1.75 s (build only) | 2.64–3.01 s (assemble + build) |
| Build output | 279 files, 77,899,439 bytes, largest 8,383,607 bytes | identical: 279 files, 77,899,439 bytes, largest 8,383,607 bytes, all hashes equal |

**What did not improve:**
- **Data diffs.** The data files are still single-line minified JSON, stored byte-exact; stage 2b would fix this.
- **Build time** is about 1.1–1.3 s longer, because the assemble step and an extra npm process now run first.
- **`git grep`** is slightly slower: there are 1,176 tracked files instead of 55.
- **The repo's object store is larger** (§1): history still holds the old 80 MB file, and `src/` was added on top.

## 1. File metrics

### What a developer edits

The single 76 MiB file is now generated and gitignored (`standalone/Train-With-Panda-Portal.html`, unchanged bytes). Developers edit `src/`.

| Part | Files | Bytes | Lines (`wc -l`) | Lines > 1,000 chars | Lines > 20,000 chars | Longest line | Largest file |
|---|---|---|---|---|---|---|---|
| `src/portal.template.html` | 1 | 7,766 | 1,213 | 0 | 0 | 265 | — |
| `src/js/*.js` | 26 | 1,268,487 | 2,456 | 132 | 7 | 183,514 (`09-i18n.js`) | `09-i18n.js` 385,643 |
| `src/css/*.css` | 9 | 219,236 | 2,390 | 3 | 0 | 5,744 (`02-presentation-arabic.css`) | `01-visual-system.css` 188,893 |
| `src/data/panda-*.json` | 18 | 1,621,942 | 0 (one line each, no final newline) | 14 | 9 | 577,468 (`panda-catalogue.json`) | `panda-catalogue.json` 577,826 |
| **All editable text** | **54** | **3,117,431** | **6,059** | **149** | **16** | 577,468 | 577,826 |

- **Template line count.** 1,064 of the template's 1,213 lines are empty: runs of empty lines kept from the original file for byte-identical output.
- **JS lines over 20,000 characters (7 lines in 4 files):**
  - `01-resolve-asset.js`: 1 line, the 122,395-character media index;
  - `08-arabic.js`: 1 line, max 46,001;
  - `09-i18n.js`: 2 lines, max 183,514;
  - `13-seed-coaching-recipes.js`: 3 lines, max 35,914.
  - All 7 are embedded data: dictionaries, education text and the media index.
- **Short JS files.** 15 of 26 JS files have no line over 1,000 characters.
- **CR bytes** in all `src/` text: 0.

### Source files

Counted with the same exclusions as BEFORE: `public/`, `node_modules/`, `.git/`, `.wrangler/`, `tests/node_modules/`.

**1,189 files on disk; 1,176 tracked by git** (BEFORE: 67 / 55). The 13 on disk but not tracked are:
- `.env.local`, `deployment-config.json`;
- `release.json` and the standalone, both generated;
- 9 files under `supabase/.temp/`.

| Directory | Files on disk (before → after) | Tracked (before → after) |
|---|---|---|
| (root) | 12 → 16 | 9 → 13 |
| `.vscode/` | 0 → 1 | 0 → 1 |
| `src/` | 0 → 1,111 | 0 → 1,111 |
| `scripts/` | 6 → 12 | 6 → 12 |
| `supabase/` | 31 → 31 | 22 → 22 |
| `docs/` | 5 → 5 | 5 → 5 |
| `history/` | 4 → 4 | 4 → 4 |
| `assets/` | 3 → 3 | 3 → 3 |
| `database/` | 3 → 3 | 3 → 3 |
| `tests/` | 2 → 2 | 2 → 2 |
| `standalone/` | 1 → 1 | 1 → **0** (generated, gitignored) |

`src/` breakdown:

| Folder | Files |
|---|---|
| `media/` | 1,047 + manifest |
| `js/` | 26 + manifest + README |
| `data/` | 18 + manifest + README |
| `css/` | 9 + manifest |
| `fonts/` | 3 + manifest |
| template | 1 |

### Largest files

| File | Bytes | Tracked |
|---|---|---|
| `standalone/Train-With-Panda-Portal.html` | 79,896,002 | no (generated) |
| `history/frontend-history.bundle` | 64,766,822 | yes (unchanged) |
| `src/media/panda-login-video-female.mp4` | 2,478,588 | yes |
| `src/media/panda-login-video-male.mp4` | 2,458,395 | yes |
| `assets/articles/01-tempo.png` | 2,141,307 | yes |
| `assets/articles/03-how-hard-to-train.png` | 2,108,686 | yes |
| `assets/articles/02-how-much-weight.png` | 2,080,290 | yes |
| `database/FRESH-INSTALL.sql` | 890,021 | yes |

The largest text file in `src/` is `src/data/panda-catalogue.json` (577,826 bytes). The largest JS file is `src/js/09-i18n.js` (385,643 bytes).

### Git object store

| | Before | After |
|---|---|---|
| `git count-objects -vH` | 72 loose objects, 125.43 MiB, 0 packs | 2,324 loose objects, 227.17 MiB, 0 packs |
| Reachable from refs | — | 183.12 MiB |
| Unreachable loose objects | — | ≈ 44 MiB |

Why the store grew:
- **History still contains the original 80 MB standalone,** in 2 commits, and the restructure does not rewrite history.
- **`src/` adds the media again as binary files** (≈ 55 MiB; AVIF/WebP/MP4 barely compress further).
- **The ≈ 44 MiB of unreachable objects** come from rewritten intermediate commits. `git gc --prune=now` would remove them.

What changed is the growth per edit (§3), not the size already recorded.

## 2. Code breakdown

| Part | Before (inside the HTML) | After (separate files) |
|---|---|---|
| CSS | 9 `<style>` blocks, 356,384 bytes including 137,318 bytes of font base64 | 9 files in `src/css/`, 219,236 bytes. Same text, with the font bodies replaced by 3 `/*@font …*/` markers. |
| Fonts | 3 `data:font/woff;base64` URIs inside the CSS (137,318 characters) | 3 `.woff` files in `src/fonts/`, 102,936 bytes (PandaDisplay 23,152, PandaSans 35,916, PandaArabic 43,868) |
| JavaScript | 1 inline `<script>`, 2,889,592 bytes, of which ≈ 60% data assignments | 26 files in `src/js/`, 1,268,487 bytes, 2,456 lines |
| Data | 22 `window.PANDA_* =` lines inside the JS, 1,745,214 bytes | 18 pure-JSON globals in `src/data/` (1,621,942 bytes), each referenced as `window.PANDA_X=/*@data src/data/<file>*/null;`. The other 5 `PANDA_*` globals (resolver, config, Arabic base dictionary, authored-Arabic map, exercise categories) are code or JS literals and stay in `src/js`. |
| Media | 1,047 `<script type="text/plain">` base64 payloads, 76,568,780 bytes encoded | 1,047 binary files in `src/media/`, 57,425,499 bytes: 712 AVIF, 329 WebP, 3 PNG, 1 SVG, 2 MP4 |
| Markup and other | ≈ 79.3 KiB | `src/portal.template.html`, 7,766 bytes, plus the third-party font notice |

Line counts of CSS and JS are not directly comparable with BEFORE. BEFORE counted lines per block by splitting on newlines (CSS 2,405, JS 2,462), which counts each block's partial last line. AFTER uses `wc -l` per file (CSS 2,390, JS 2,456). The text itself is unchanged.

**`window.Panda*` modules: 22** (unchanged), defined in 19 of the 26 JS files. The other 7 files hold data globals, config, the resolver, and data merges.

**`window.PANDA_*` globals: 23** (unchanged). Data comes from 18 `/*@data` markers; 5 globals are inline.

Every `src/` folder has a `manifest.json` that fixes the order of its parts. `scripts/assemble.mjs` checks that the manifests, files and markers agree, and rejects any mismatch.

## 3. Developer experience

### Finding a function definition with grep

Same search string as BEFORE: `function weekCalendar(`. It is now at `src/js/26-portal.js` line 170; it was line 6610 of the single file.

| Command | Before | After |
|---|---|---|
| `grep -n -E 'function weekCalendar\('` on the file that holds it, 5 runs | 0.071, 0.069, 0.068, 0.069, 0.069 s (median 0.069) | 0.022, 0.024, 0.022, 0.021, 0.019 s (median 0.022) |
| `grep -n -F`, same file, 5 runs | median 0.077 s | 0.024, 0.021, 0.026, 0.020, 0.021 s (median 0.021) |
| `git grep -n -F`, whole repo, 3 runs | 0.097, 0.094, 0.092 s | 0.118, 0.120, 0.115 s (1,176 tracked files instead of 55) |
| `grep -rn -E` across `src/js/`, 5 runs | — | 0.023, 0.022, 0.022, 0.023, 0.023 s |
| `grep -rn -E` across all of `src/`, including 57 MB of media, 5 runs | — | 0.127–0.129 s |
| Matches | 1 | 1 |
| Output | 1,178 bytes | 1,177 bytes (file); 1,197 bytes recursive, because the path is included |

- **The match still prints one long line.** `weekCalendar` is a one-line function of 1,173 characters, and the code itself was not reformatted.
- **A search inside the catalogue still returns the whole line.** `grep -n 'Supine Pelvic' src/data/panda-catalogue.json` returns 577,829 bytes (BEFORE: 577,850, the whole `PANDA_CATALOGUE` line). `grep -o` with context avoids this: a 40-character-context match is 94 bytes.

### Opening in a standard editor

As in BEFORE, these are measured file properties; files were not opened in an editor for timing.

| Property | Before | After |
|---|---|---|
| Size of the edited file vs VS Code's 20 MiB / 300,000-line large-file threshold | 76.19 MiB, above the threshold: tokenization, highlighting and folding off | Every editable file is far below it. Largest text file 577,826 bytes; the template is 7,766 bytes. |
| Lines over VS Code's default `editor.maxTokenizationLineLength` (20,000) | 1,053 lines in the one file | 16 lines. 9 are the 9 large data files, which `.vscode/settings.json` maps to plain text anyway. 7 are in 4 JS files; those lines are not tokenized, but the rest of each file is. |
| Files that are syntactically valid on their own | — | All 26 JS files parse as JavaScript (acorn). Data markers use the valid placeholder `…*/null`. |
| Format-on-save protection | none | `.vscode/settings.json` (`[css]`/`[javascript]` format-on-save off, data files as plain text, `files.eol` = `\n`) and `.prettierignore` for `src/data`, `src/css`, `src/js` and the template |
| GitHub file-size limits (warning at 50 MB, block at 100 MB) | standalone 79.90 MB: above the warning | No `src/` file is above 2.48 MB. The standalone is no longer tracked. `history/frontend-history.bundle` (64.77 MB, unchanged) is still above the 50 MB warning. |

### A one-line change in git diff

Same method as BEFORE: a throwaway repository and the same two edits. BEFORE's repo held only the standalone. AFTER's holds the committed `src/` (1,111 files) plus `.gitattributes`.

| Change | `git diff --stat` | Diff output | Longest diff line | `git diff` time | Commit time | Object-store growth |
|---|---|---|---|---|---|---|
| A, before: rename `function exerciseEdit(` → `exerciseEditX(` in the standalone (line 6720) | 1 file changed, 1 insertion(+), 1 deletion(-) | 13 lines, 12,091 bytes | 3 context lines, each several KB | 1.47 s | 2.71 s | +58,522 KiB |
| **A, after:** same rename in `src/js/26-portal.js` (line 280) | 1 file changed, 1 insertion(+), 1 deletion(-) | 13 lines, 12,141 bytes | 5,057 characters (a neighbouring one-line function as context) | **0.039 s** | **0.073 s** | **+119 KiB** |
| B, before: add 1 space inside `PANDA_CATALOGUE` (standalone line 5415) | 1 file changed, 1 insertion(+), 1 deletion(-) | 13 lines, 1,264,603 bytes | 577,852 characters | 1.51 s | — | +58,522 KiB |
| **B, after:** same space in `src/data/panda-catalogue.json` | 1 file changed, 1 insertion(+), 1 deletion(-) | 9 lines, 1,155,902 bytes | 577,828 characters | **0.043 s** | **0.067 s** | **+79 KiB** |

| | Before | After |
|---|---|---|
| `git add` + first commit of everything | 2.38 s (1 file) | 2.95 s (1,111 files) |
| `git diff --word-diff=porcelain` output for change B | 686,765 bytes | 578,020 bytes |

**Change A, a code edit.** It now produces the same small diff ≈ 38× faster. The commit stores one new 329 KB file version plus three small tree objects: **+119 KiB, ≈ 490× less than the whole 57 MiB file before.**

**Change B, a data edit.** It still produces a diff the size of the whole 577 KB line, because the data files stay single-line minified JSON so the build stays byte-identical. Repo growth fell from 57 MiB to 79 KiB. Line-level data diffs need stage 2b: pretty-printed data files, accepting a new output hash.

### Repo growth per commit

| | Before | After |
|---|---|---|
| A one-line edit anywhere | ≈ 57 MiB: a new zlib copy of the whole 76 MiB file | ≈ 79–119 KiB: one new copy of the edited file, plus tree objects |
| A media change | ≈ 57 MiB | the size of the changed media file |

## 4. Build output (`npm run build`)

Same method as BEFORE: 3 clean runs in a scratch copy, deleting the outputs before each run and keeping the same `deployment-config.json`.
- **Copied in:** `src/`, `scripts/`, `assets/`, `package.json`, `deployment-config.json`. `standalone/` is not copied: it is generated.
- **Deleted before each run:** `public/`, `release.json` and the standalone.

| Metric | Before | After |
|---|---|---|
| `npm run build`, 3 clean runs | 10.24 s (first run, cold), 1.75 s, 1.48 s | 2.83 s, 2.64 s, 3.01 s |
| Of which: assemble from `src/` | — | 0.63 s (`node scripts/assemble.mjs`) |
| Of which: `build.mjs` alone | ≈ 1.5 s | 1.29 s |
| Output files | 279 | 279 |
| Total output size | 77,899,439 bytes (74.29 MiB) | 77,899,439 bytes (74.29 MiB) |
| Largest asset | `media/panda-media-5c4ebd8344d9daa4.js`, 8,383,607 bytes (8.00 MiB) | the same file, 8,383,607 bytes |
| `index.html` | 3,271,050 bytes | 3,271,050 bytes |
| Output identical to BEFORE | — | yes: sha256 of all 279 files equal |

- **Why the build is slower.** `npm run build` now runs `prebuild` → `npm run assemble` first. The extra time is the assemble step (≈ 0.6 s) plus the nested npm start-up.
- **Standalone output.** The standalone the build reads is byte-identical to BEFORE's source file (sha256 `e7aa57c4…`).
- **Other verification now in place** (not measured in BEFORE):
  - `npm run check` passes.
  - `cd tests && npm run verify` passes 6/6, including a jsdom boot of the page assembled from `src/`.
  - A fresh clone passes `npm install`, `npm run build`, `npm run check` and `node scripts/manifest.mjs --check`.
