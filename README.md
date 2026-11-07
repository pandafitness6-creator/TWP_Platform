# Train With Panda — independent deployment handover, v0.9.16

Start with docs/DEPLOY.md. This package is intended for a NEW Supabase project and your own Cloudflare Pages account. No previous owner's accounts or connection values are required or supplied.

Included: editable application source (src/, see below), all images/fonts/login videos, reproducible build and lockfile, 20 database migrations including shipped library content, account-management Edge Function, initial-coach setup, local verification, reconstructed frontend version history and checksums.

## Frontend source layout

The portal ships as one self-contained HTML page. Its source lives in src/, split by kind. `npm run assemble` (scripts/assemble.mjs) joins the parts back into that page, standalone/Train-With-Panda-Portal.html.

| Path | Contains |
|---|---|
| src/portal.template.html | The page shell: head, body markup, `<style>` and `<script>` tags. Markers show where each part goes. Third-party font notices are kept here. |
| src/js/ | The application JavaScript: 26 files in execution order, from `PANDA_RESOLVE_ASSET` (01) to the app itself, `PandaPortal` (26). See src/js/README.md. |
| src/data/ | 18 JSON data files (exercise catalogue, plans, recipes, seed content…), one per `window.PANDA_*` global, stored byte-exact. See src/data/README.md. |
| src/css/ | 9 stylesheets in cascade order, each the body of one `<style>` block |
| src/fonts/ | The 3 embedded fonts as .woff files (PandaDisplay, PandaSans, PandaArabic) |
| src/media/ | 1,047 images, login videos and other media as ordinary files, inlined as base64 |

Each src/ folder has a manifest.json that fixes the order of its parts. That order is load-bearing: JS execution order, data load order, the CSS cascade, and the build's media bundles. The template, src/js and src/css reference parts with markers: `/*@js src/js/<file>*/`, `/*@data src/data/<file>*/null`, `/*@css src/css/<file>*/`, `/*@font src/fonts/<file>*/` and `<!--@media src/media/manifest.json-->`. assemble.mjs stops with a clear error, and writes nothing, if any of these happen:

- a part is missing or not listed;
- the parts are out of order;
- a marker is malformed;
- a file was reformatted at its edges (wrong final newline);
- a JS file contains `</script`.

### Generated files, never edited

standalone/Train-With-Panda-Portal.html, public/ and release.json are build outputs and are gitignored. `npm run build` runs `npm run assemble` first, then builds public/ from the standalone and records every output hash in release.json. Editing a generated file has no effect: the next build overwrites it.

The three article PNGs are in assets/articles/ and are copied into public/media/articles/ during build. Build helpers are in scripts/; backend logic is in supabase/functions/ and supabase/migrations/. scripts/restructure/ holds the one-time scripts that split the original single-file source into src/; they are kept for reference and refuse to run again.

### Making a frontend change

1. Edit the relevant file under src/.
   - Keep execution and cascade order: don't reorder files without updating that folder's manifest.json.
   - Don't reformat src/data, src/css, src/js or the template. Prettier and VS Code format-on-save are turned off for them (.prettierignore, .vscode/settings.json), because the output is compared byte for byte.
2. `npm run assemble`. It prints the standalone's sha256. Unchanged v0.9.16 sources give e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0; any intended change gives a new hash.
3. `npm run build`, then `npm run check`.
4. Optionally, local runtime checks: `cd tests && npm install && npm run verify`. This installs the 22 migrations into an in-memory PostgreSQL, then boots the page assembled from src/ in jsdom. It rewrites docs/VERIFICATION.json.
5. Before handing over or releasing, `npm run manifest`. This refreshes MANIFEST.json and MANIFEST.sha256: size and sha256 of every source file in the package. `node scripts/manifest.mjs --check` reports whether they are current. Build outputs are not listed there; release.json covers them.

The original v0.9.16 standalone was reconstructed from the latest public build by reinserting the original media payloads. src/ reassembles it byte-for-byte.

## Deployment state

A build without deployment-config.json has empty backend connection fields. It must be configured and rebuilt for your own Supabase project before use. There are no existing coach/customer accounts in the database seeds. Existing live customer records, passwords, invoices, private photographs and coach customizations are NOT transferred: this is an independent installation package with schema and shipped content, not a production database backup.

## History, verification and licensing

history/CHANGELOG.md explains the releases and the limits of the reconstructed history. history/frontend-history.bundle contains neutral-author frontend commits for v0.9.14, v0.9.15 and v0.9.16; it is not an original Git log.

No deployment to Cloudflare or Supabase was performed while preparing this handover. Local validation results: docs/VERIFICATION.json. Customer-side final acceptance: docs/ACCEPTANCE.md.

No node_modules, local secret files, test-account credentials, account caches, personal browser evidence or original deployment metadata are included. Dependency installation requires internet access. Third-party font notices remain in the HTML source (src/portal.template.html); see docs/THIRD-PARTY.md. This handover does not invent a new software license: redistribution and commercial rights follow your purchase/agreement.

