#!/usr/bin/env bash
# Headless behaviour test: real plugin.js + real backend data + the app's own React, in jsdom.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
NM="$HERMES_HOME/hermes-agent/.build/webapp-workspace/node_modules"
PY="$HERMES_HOME/hermes-agent/venv/bin/python"
[ -d "$NM/react" ] || { echo "skipped: no Hermes webapp build at $NM"; exit 0; }

T="${TMPDIR:-/tmp}/zen-mode-test"
rm -rf "$T"; mkdir -p "$T/node_modules/@hermes/plugin-sdk" "$T/node_modules/@tanstack"
for m in react react-dom scheduler jsdom; do ln -s "$NM/$m" "$T/node_modules/$m"; done
ln -s "$NM/@tanstack/react-query" "$T/node_modules/@tanstack/react-query"
ln -s "$NM/@tanstack/query-core" "$T/node_modules/@tanstack/query-core"
cp "$REPO/tests/fake-sdk.mjs" "$T/node_modules/@hermes/plugin-sdk/index.mjs"
echo '{"name":"@hermes/plugin-sdk","type":"module","exports":"./index.mjs"}' > "$T/node_modules/@hermes/plugin-sdk/package.json"
cp "${PLUGIN:-$REPO/desktop/plugin.js}" "$T/plugin.mjs"   # PLUGIN=… tests a candidate before it goes live
cp "$REPO/tests/harness.mjs" "$T/harness.mjs"
cp "$REPO/tests/world.mjs" "$T/world.mjs"

"$PY" "$REPO/tests/backend_test.py"   # the real dispatcher, called the way the app calls it
"$PY" "$REPO/tests/make_fixtures.py" "$T/fixtures.json"
cd "$T" && FIXTURES="$T/fixtures.json" NODE_PATH="$T/node_modules" node harness.mjs
