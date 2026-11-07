# src/js — the portal's JavaScript, in execution order

`scripts/assemble.mjs` concatenates these files, in `manifest.json` order, into the page's single inline `<script>`. Each file replaces its `/*@js src/js/<file>*/` line in `src/portal.template.html`.

The files are classic-script code, not ES modules. They share no top-level variables: every file is one or more self-contained top-level statements, and modules talk to each other only through `window.Panda*` / `window.PANDA_*`.

## Rules

- **Order is execution order. Don't reorder files.** Several files read globals set by earlier files while they load: data mutations, `PandaUI` before `PandaAnatomy` and `PandaAccountUI`, the i18n dictionary snapshot. `26-portal.js` starts the app and must stay last. See PLAN.md §4.3.
- **Keep 13-seed-coaching-recipes.js and 26-portal.js whole.** Each is one closure whose parts share private variables.
- **Each file ends with exactly one newline.** `assemble.mjs` removes it, and stops with an error if it is missing or doubled.
- **Don't reformat, and never write `</script` in a file.** The output is checked byte-for-byte. `assemble.mjs` rejects `</script`, because it would end the inline script early.
- **Files 03, 10, 12, 13, 14 and 16 contain data markers** of the form `window.PANDA_MEDIA=/*@data src/data/panda-media.json*/null;`. `assemble.mjs` replaces the marker and its `null` with the file from `src/data/`. The `null` keeps every file valid JavaScript for editors and linters; a marker without it is rejected.
- After any edit, run `npm run assemble` and compare the printed sha256.

## Files

The "Lines" column gives the line numbers of the v0.9.16 standalone.

| File | Lines | Contains |
|---|---|---|
| 01-resolve-asset.js | 4609 | `PANDA_RESOLVE_ASSET`: media-key resolver with its embedded index (`build.mjs` patches it) |
| 02-config.js | 4610–4612 | `PANDA_CONFIG`: public connection settings (`build.mjs` replaces it) |
| 03-media-cast.js | 4613–4620 | `PANDA_MEDIA`, `PANDA_CAST`, `PANDA_LOGIN_VIDEOS` (data markers) |
| 04-login-video.js | 4621–4738 | `PandaLoginVideo` |
| 05-experience.js | 4739–4776 | `PandaExperience`: language and imagery preferences |
| 06-brand.js | 4777–4779 | `PandaBrand`, plus the favicon update |
| 07-framing.js | 4780–4812 | `PandaFraming`: subject-aware photo cropping |
| 08-arabic.js | 4813–5321 | `PANDA_ARABIC` base dictionary and its first extension |
| 09-i18n.js | 5322–5391 | `PandaI18n`, with its dictionary extensions |
| 10-plan-data.js | 5392–5397 | `PANDA_AR_ARTICLES`, `PANDA_PLAN_LIBRARY`, `PANDA_CARDIO_TEMPLATES`, `PANDA_SUPPLEMENT_PLANS` (data markers), cardio-into-plan merge |
| 11-studio.js | 5398–5411 | `PandaStudio` (also sets `PANDA_AUTHORED_AR`) |
| 12-catalogue.js | 5412–5425 | `PANDA_ARTICLE_IMAGES`, `PANDA_CATALOGUE`, `PANDA_EXERCISE_CATEGORIES`, `PANDA_LIBRARY_EXTENSION`, `PANDA_CARDIO_EXTENSION`, `PANDA_SEED_BASE` (data markers), catalogue merges |
| 13-seed-coaching-recipes.js | 5426–5599 | One shared closure: `PandaEducationUpgrade`, `PandaCoaching`, `PandaRecipes`, `PandaSeed`, and `PANDA_RECIPE_SEED`, `PANDA_RECIPE_INGREDIENTS`, `PANDA_EDUCATION_095` (data markers) |
| 14-cardio-options.js | 5600–5604 | `PANDA_CARDIO_METHODS`, `PANDA_CARDIO_INTENSITIES`, `PANDA_CARDIO_DEFAULTS` (data markers) |
| 15-services.js | 5605–5674 | `PandaServices`: local state and records |
| 16-cloud.js | 5675–5827 | `PANDA_TIMEZONES` (data marker: country → IANA zones), `PandaCloud`: Supabase connection and client access expiry rules |
| 17-chat-badge.js | 5828–5842 | `PandaChatBadge` |
| 18-chat.js | 5843–5901 | `PandaChat` |
| 19-guides.js | 5902–6102 | `PandaGuides`: exercise technique guides |
| 20-attention.js | 6103–6125 | `PandaAttention` |
| 21-selects.js | 6126–6162 | `PandaSelects`: enhanced select controls |
| 22-ui.js | 6163–6292 | `PandaUI`: shared UI helpers |
| 23-anatomy.js | 6293–6358 | `PandaAnatomy` |
| 24-account-ui.js | 6359–6416 | `PandaAccountUI`, plus a dictionary extension |
| 25-calories.js | 6417–6440 | `PandaCalories` |
| 26-portal.js | 6441–7064 | `PandaPortal`: the app, routes and rendering; **starts the app** |
