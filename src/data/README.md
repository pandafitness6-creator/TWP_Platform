# src/data — do not reformat these files

Each `panda-*.json` file is the value of one `window.PANDA_*` data global. `scripts/assemble.mjs` copies the file's bytes **exactly** into the generated standalone HTML, at its `/*@data src/data/<file>*/null` marker in `src/js/`, e.g. `window.PANDA_CATALOGUE=/*@data src/data/panda-catalogue.json*/null;`. The `null` keeps the JS file valid before assembly, and the whole marker, `null` included, is replaced. `manifest.json` lists the globals in the order the template uses them.

## Why the bytes matter

The build is checked byte-for-byte. The assembled standalone must have sha256 `e7aa57c459faa6ac92c06050de859d81ba6a8366e3ef9ada9d098c85fdb907f0`, and `npm run build` / `npm run check` compare every public file against recorded hashes.

These files are single-line minified JSON as originally shipped. Five of them (`panda-media`, `panda-cast`, `panda-plan-library`, `panda-article-images`, `panda-seed-base`) also contain forms that any JSON tool rewrites even without pretty-printing, such as `0.0`, `100.0` or a space after `:`. Any of the following keeps the JSON valid but changes the output:

- pretty-printing or "Format Document";
- format-on-save or format-on-paste;
- adding a final newline;
- re-saving the file through `JSON.parse` / `JSON.stringify`.

## Rules

- **Do not reformat.** Edit values in place on the single line.
- **No trailing newline.** `assemble.mjs` stops with an error if a file ends with whitespace or a newline, or is not valid JSON.
- **Don't rename, add or remove files without updating `manifest.json` and the template marker together.** `assemble.mjs` stops with an error on a missing file, an unlisted file, a missing marker, or markers out of manifest order. Order is load order at runtime.
- After any edit, run `npm run assemble` and compare the printed sha256. A different hash is expected only for an intended content change, and that change also changes the public build.

## Editor protection in this repo

- **`.vscode/settings.json`** maps `src/data/panda-*.json` to plain text, so no JSON formatter (including Prettier) applies. It also turns off format-on-save, format-on-paste, final-newline insertion and whitespace trimming for plain text.
- **`.prettierignore`** excludes `src/data/`.

Other editors need the equivalent settings.

Readable, pretty-printed data files are possible, but they are a deliberate output change with a new baseline hash. See stage 2b in `PLAN.md`.
