# Free Dictionary Lookup (Firefox & Chrome Extension)

Select any English word on any webpage and instantly see its meaning,
pronunciation, examples, and more — in a clean popup right next to your
selection. A toolbar popup lets you type a word directly, too.

Powered by the free, no-API-key
[Free Dictionary API](https://dictionaryapi.dev).

## Features

- **Select to lookup** — double-click or select a word (mouse or Shift+arrows);
  a popup appears next to the selection with definitions grouped by part of
  speech, example sentences, phonetic transcription, and an audio
  pronunciation button.
- **Right-click lookup** — select a word, right-click and choose
  *Look up “word”*. Works everywhere, including Firefox's built-in PDF
  viewer, where extensions can't show the selection popup.
- **Toolbar popup** — click the extension icon to type and look up a word
  manually.
- **Smart filtering** — sentences, numbers, code, and other non-words are
  ignored; short phrases (up to 5 words) are supported.
- **Caching** — lookups are cached in memory and in `storage.local`
  (bounded, ~150 entries), so repeated lookups are instant and survive
  browser restarts.
- **Shadow DOM popup** — page styles can never break the popup.
- **Dark mode** support (follows the browser's color scheme).

## Privacy

The extension collects **no data** and has no analytics. The only network
request is the selected word sent to `dictionaryapi.dev` to fetch its
definition. Nothing is stored anywhere except a local cache of definitions
on your own machine.

## Project structure

```
manifest.json        Firefox MV2 manifest (desktop + Android)
platform/chrome/     Chrome MV3 manifest (same source files)
scripts/build.sh     Builds dist/*.zip for both stores
shared.js            Word normalization + DOM renderer (used by all contexts)
background.js        Fetches definitions, manages the cache
content.js           Selection detection + shadow-DOM popup on pages
popup/               Toolbar popup (HTML/CSS/JS)
icons/               Extension icons
dist/                Built, submission-ready zip (generated)
```

## Try it locally (temporary install)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` in this folder
4. Open any article, double-click a word — the definition popup appears.

Temporary add-ons are removed when Firefox closes. For permanent local
installs across a team, use an [unlisted signed
build](https://addons.mozilla.org/developers/) (see below).

## Development

```bash
# Lint (same validation AMO runs on submission)
npx web-ext lint --source-dir .

# Run in a clean Firefox profile with the extension loaded
npx web-ext run --source-dir .

# Build both store zips into dist/ (Firefox MV2 + Chrome MV3)
./scripts/build.sh
```

## Publishing to addons.mozilla.org (AMO)

The submission-ready package is `dist/free_dictionary_lookup-1.0.3.zip`.

### Option A — List publicly on AMO (recommended)

1. Create a (free) developer account at
   <https://addons.mozilla.org/developers/>.
2. Go to **Submit a New Add-on** → *On this site*.
3. Upload `dist/free_dictionary_lookup-1.0.3.zip`.
4. Fill in the listing (name, summary, and the icon `icons/512.png`).
   Suggested privacy disclosure for the questionnaire: *"The extension sends
   the word the user selects (or types) to dictionaryapi.dev to fetch its
   definition. No other data is collected, transmitted, or stored."*
5. Submit. Mozilla runs automated validation (this package already passes
   `web-ext lint` with 0 errors/warnings) and a quick human review — simple
   dictionary extensions are typically approved within hours to a couple of
   days.

### Option B — Self-distribute a signed build (unlisted)

For a signed `.xpi` you can host yourself or share by link:

1. On <https://addons.mozilla.org/developers/> open **Manage API Keys** and
   generate a key/secret pair.
2. Run:

   ```bash
   npx web-ext sign \
     --source-dir . \
     --api-key YOUR_API_KEY \
     --api-secret YOUR_API_SECRET \
     --channel unlisted \
     --artifacts-dir dist
   ```

3. Distribute the resulting signed `.xpi`; users install it once and it
   persists (unlike temporary add-ons).

### Notes for publishing

- The add-on ID (`{91926569-c212-45f9-839a-53fea5acd6fe}`) is set in
  `manifest.json`; keep it stable across versions.
- To release an update: bump `version` in `manifest.json`, rebuild, and
  upload the new zip on the add-on's *Manage Versions* page.
- Update `homepage_url` in `manifest.json` if you publish the source
  (e.g., to GitHub).

## License

MIT

## Chrome

The same source runs in Chrome via `platform/chrome/manifest.json` (MV3,
service-worker background). Keep its `version` in sync with `manifest.json`;
`scripts/build.sh` refuses to build if they differ.

- Try locally: `chrome://extensions` → enable **Developer mode** →
  **Load unpacked** → pick `dist/chrome/`.
- Publish: upload `dist/free_dictionary_lookup-chrome-<version>.zip` in the
  [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole).
