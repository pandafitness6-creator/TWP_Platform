# BEFORE — baseline before restructuring

Captured 2026-10-31 on branch `dev` at commit `14a69f0`, package version 0.9.16.
Environment: Windows 11, Node v22.22.0, GNU grep 3.0, Git Bash.
MiB = 1,048,576 bytes, KiB = 1,024 bytes, MB = 1,000,000 bytes.

## 1. File metrics

| Metric | Value |
|---|---|
| `standalone/Train-With-Panda-Portal.html` size | 79,896,002 bytes (76.19 MiB, 79.90 MB) |
| Total line count (`wc -l`) | 7,070 |
| Lines longer than 1,000 characters | 1,198 |
| Lines longer than 20,000 characters | 1,053 |
| Longest line | 3,304,849 characters (line 3008, `panda-login-video-female`) |
| Line endings | LF |

**Source files** (excluding `public/`, `node_modules/`, `.git/` and `.wrangler/`): **67 files**
- 55 are tracked by git.
- 12 are local or ignored: `.env.local`, `deployment-config.json`, `release.json` and 9 files under `supabase/.temp/`.

| Directory | Files on disk | Tracked |
|---|---|---|
| (root) | 12 | 9 |
| supabase/ | 31 | 22 |
| scripts/ | 6 | 6 |
| docs/ | 5 | 5 |
| history/ | 4 | 4 |
| assets/ | 3 | 3 |
| database/ | 3 | 3 |
| tests/ | 2 | 2 |
| standalone/ | 1 | 1 |

**Largest files**

| File | Bytes |
|---|---|
| `standalone/Train-With-Panda-Portal.html` | 79,896,002 (76.19 MiB) |
| `history/frontend-history.bundle` | 64,766,822 (61.77 MiB) |
| `assets/articles/01-tempo.png` | 2,141,307 |
| `assets/articles/03-how-hard-to-train.png` | 2,108,686 |
| `assets/articles/02-how-much-weight.png` | 2,080,290 |
| `database/FRESH-INSTALL.sql` | 890,021 |

**Git object store:** 125.43 MiB. It holds 72 loose objects and 0 packs.

## 2. Code breakdown (standalone HTML)

| Part | Blocks | Lines | Size |
|---|---|---|---|
| CSS (`<style>`) | 9 | 2,405 | 356,384 bytes (348.0 KiB) |
| JavaScript (executable `<script>`) | 1 | 2,462 | 2,889,592 bytes (2,821.9 KiB / 2.76 MiB) |
| Base64 media (`<script type="text/plain">`) | 1,047 | 1,047 (one line each) | 76,568,780 bytes encoded (73.02 MiB) |
| Markup and other | — | remainder | ≈ 79.3 KiB |

**CSS:** the 9 style blocks are 267,581, 64,199, 2,720, 2,512, 13,654, 1,793, 550, 621 and 2,754 bytes.

**JavaScript**
- Everything runs from a single inline `<script>` block.
- It contains 385 named `function` declarations. Arrow functions are not counted.
- 22 of its lines are data assignments of the form `window.PANDA_* = …`, totalling 1,745,214 bytes (≈ 60% of the JS bytes).
- 16 JS lines are longer than 20,000 characters, totalling 2,214,355 bytes.
- The longest JS line is 577,850 characters: `window.PANDA_CATALOGUE`, line 5415.

**Base64 media payloads:** 1,047 payloads.
- Total size is 76,568,780 bytes encoded (73.02 MiB) and 57,425,499 bytes decoded (54.77 MiB). That is ≈ 95.8% of the file.
- 685 have the id `panda-embedded-asset-*`.
- 268 have the id `panda-library-image-*`.
- 40 have the id `panda-recipe-photo-*`.
- 28 have the id `panda-final-image-*`.
- The remaining 26 are single named assets: brand marks, wallpapers, editorial covers, login posters and videos, composition images, and studio images.
- The two largest are the login videos, at 3,304,849 and 3,277,923 characters.
- Separately, 3 inline `data:…;base64` URIs sit inside the CSS and JS, totalling 0.13 MiB.

**`window.Panda*` modules: 22**

`PandaAccountUI`, `PandaAnatomy`, `PandaAttention`, `PandaBrand`, `PandaCalories`, `PandaChat`, `PandaChatBadge`, `PandaCloud`, `PandaCoaching`, `PandaEducationUpgrade`, `PandaExperience`, `PandaFraming`, `PandaGuides`, `PandaI18n`, `PandaLoginVideo`, `PandaPortal`, `PandaRecipes`, `PandaSeed`, `PandaSelects`, `PandaServices`, `PandaStudio`, `PandaUI`

**`window.PANDA_*` data and config globals: 23**

`PANDA_RESOLVE_ASSET`, `PANDA_CONFIG`, `PANDA_MEDIA`, `PANDA_CAST`, `PANDA_LOGIN_VIDEOS`, `PANDA_ARABIC`, `PANDA_AR_ARTICLES`, `PANDA_PLAN_LIBRARY`, `PANDA_CARDIO_TEMPLATES`, `PANDA_SUPPLEMENT_PLANS`, `PANDA_AUTHORED_AR`, `PANDA_ARTICLE_IMAGES`, `PANDA_CATALOGUE`, `PANDA_EXERCISE_CATEGORIES`, `PANDA_LIBRARY_EXTENSION`, `PANDA_CARDIO_EXTENSION`, `PANDA_SEED_BASE`, `PANDA_RECIPE_SEED`, `PANDA_RECIPE_INGREDIENTS`, `PANDA_EDUCATION_095`, `PANDA_CARDIO_METHODS`, `PANDA_CARDIO_INTENSITIES`, `PANDA_CARDIO_DEFAULTS`

## 3. Developer experience metrics

### Finding a function definition with grep

Command: `grep -n -E 'function weekCalendar\(' standalone/Train-With-Panda-Portal.html`

| Metric | Value |
|---|---|
| Wall time, 5 runs | 0.071, 0.069, 0.068, 0.069, 0.069 s (median 0.069 s) |
| `grep -n -F` (fixed string), 5 runs | 0.077, 0.078, 0.073, 0.080, 0.075 s (median 0.077 s) |
| `git grep -n -F`, 3 runs | 0.097, 0.094, 0.092 s |
| Matches | 1, on line 6610 |
| Output size | 1,178 bytes, because the whole function body is on one line of 1,173 characters |

A search that lands on a data line prints the whole line. For example, any match inside `PANDA_CATALOGUE` returns 577,850 characters.

### Opening in a standard editor

I measured the file's properties and did not open it in an editor interactively.

- **File size:** 76.19 MiB. This is above VS Code's large-file threshold of 20 MiB or 300,000 lines. Above that threshold VS Code opens the file with tokenization, syntax highlighting, folding and other language features turned off.
- **Long lines:** 1,053 lines exceed VS Code's default `editor.maxTokenizationLineLength` of 20,000 characters, so those lines are not tokenized even when features are on.
- **Longest line:** 3,304,849 characters.
- **GitHub:** the file is above GitHub's 50 MB per-file warning threshold and below its 100 MB hard limit.

### A one-line change in git diff

I measured this in a throwaway repository that holds only this file. The user's global git config converts LF to CRLF on checkout.

| Change | `git diff --stat` | Diff output | Longest diff line | `git diff` time | Object store growth from the commit |
|---|---|---|---|---|---|
| A: rename `function exerciseEdit(` → `exerciseEditX(` (line 6720, 53 characters) | 1 file changed, 1 insertion(+), 1 deletion(-) | 13 lines, 12,091 bytes | 3 context lines from neighbouring one-line functions, each several KB | 1.47 s | +58,522 KiB |
| B: add 1 space inside `PANDA_CATALOGUE` (line 5415) | 1 file changed, 1 insertion(+), 1 deletion(-) | 13 lines, 1,264,603 bytes | 577,852 characters | 1.51 s | +58,522 KiB |

- `git add` plus the first commit of the file took 2.38 s.
- The commit for change A took 2.71 s.
- Each commit writes a new zlib-compressed copy of the whole file as a loose object (≈ 57 MiB) until git packs it.
- For change B, `git diff --word-diff=porcelain` output is 686,765 bytes.

## 4. Build output (`npm run build`)

I ran the build in a scratch copy containing `standalone/`, `scripts/`, `assets/`, `package.json` and `deployment-config.json`, so the project's `public/` and `release.json` stayed unchanged. I deleted `public/` and `release.json` before each run.

| Metric | Value |
|---|---|
| Build time, 3 clean runs | 10.24 s (first run, cold), 1.75 s, 1.48 s |
| Output files | 279 |
| Total output size | 77,899,439 bytes (74.29 MiB) |
| Largest asset | `media/panda-media-5c4ebd8344d9daa4.js`, 8,383,607 bytes (8.00 MiB) |
| `index.html` | 3,271,050 bytes (3.12 MiB) |
| Public connection configured | yes, from `deployment-config.json` |

Build console line: `Built 279 public files; 779 embedded media payloads preserved in bundles; 268 library images externalized byte-for-byte; largest asset 8.00 MiB.`

| Output group | Files | Bytes |
|---|---|---|
| `index.html` + `_headers` | 2 | 3,271,050 + 260 |
| `media/panda-media-*.js` (base64 media bundles, split at about 8 MiB) | 6 | 8,383,607; 8,368,351; 8,257,388; 8,253,481; 6,237,839; 3,905,434 |
| `media/library/*.webp` (externalized library images) | 268 | 24,891,746 in total (69,070 to 134,876 each) |
| `media/articles/*.png` | 3 | 6,330,283 |

The project's existing `public/`, built 2026-10-06, also contains 279 files. Its `index.html` is the same size, 3,271,050 bytes.
