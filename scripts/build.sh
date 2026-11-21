#!/usr/bin/env bash
# Build release zips for Firefox (MV2, manifest.json) and Chrome (MV3,
# platform/chrome/manifest.json) from the same source files.
#   dist/free_dictionary_lookup-<version>.zip         -> addons.mozilla.org
#   dist/free_dictionary_lookup-chrome-<version>.zip  -> Chrome Web Store
#   dist/chrome/                                      -> "Load unpacked" in Chrome
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(background.js content.js shared.js popup icons)

ff_version=$(jq -r .version manifest.json)
cr_version=$(jq -r .version platform/chrome/manifest.json)
if [[ "$ff_version" != "$cr_version" ]]; then
  echo "Version mismatch: manifest.json=$ff_version platform/chrome/manifest.json=$cr_version" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist/firefox dist/chrome
cp -r "${FILES[@]}" manifest.json dist/firefox/
cp -r "${FILES[@]}" dist/chrome/
cp platform/chrome/manifest.json dist/chrome/manifest.json

npx --yes web-ext lint --source-dir dist/firefox
(cd dist/firefox && zip -qr -X "../free_dictionary_lookup-$ff_version.zip" .)
(cd dist/chrome && zip -qr -X "../free_dictionary_lookup-chrome-$cr_version.zip" .)
rm -rf dist/firefox
ls -1 dist
