#!/bin/sh
# Build the Zotero plugin (.xpi) into dist/
set -e
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist
OUT="dist/zotero-claude-bridge-$VERSION.xpi"
rm -f "$OUT"
zip -q -X -r "$OUT" manifest.json bootstrap.js prefs.js icon.svg src LICENSE
echo "Built $OUT"
# updates.json lets Zotero auto-update the plugin from GitHub Releases
cat > dist/updates.json <<JSON
{
  "addons": {
    "claude-bridge@zotero-claude-bridge": {
      "updates": [
        {
          "version": "$VERSION",
          "update_link": "https://github.com/ChanglinWu/zotero-claude-bridge/releases/download/v$VERSION/zotero-claude-bridge-$VERSION.xpi",
          "update_hash": "sha256:$(shasum -a 256 "$OUT" | cut -d' ' -f1)",
          "applications": { "zotero": { "strict_min_version": "6.999" } }
        }
      ]
    }
  }
}
JSON
# Local install snippet with the real path (dist/ is not committed)
sed "s#/path/to/zotero-claude-bridge-x.y.z.xpi#$PWD/$OUT#" scripts/install_via_run_javascript.js > dist/install_snippet.js
