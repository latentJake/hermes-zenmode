#!/usr/bin/env bash
# Safely replace desktop/plugin.js with a candidate file.
# The app hot-reloads desktop/plugin.js on every save (it's symlinked into ~/.hermes), so a
# half-edited file goes live instantly and the app falls back to the previous version with a
# load error. Edit a copy instead, then:  ./scripts/promote.sh path/to/candidate.js
# It checks syntax + the import allowlist + colours, runs the behaviour test against the
# candidate, and only then swaps it in with one atomic rename.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CAND="${1:?usage: promote.sh <candidate plugin.js>}"
T="$REPO/desktop/.plugin.js.next"

cp "$CAND" "${TMPDIR:-/tmp}/zen-mode-cand.mjs"
node --check "${TMPDIR:-/tmp}/zen-mode-cand.mjs"
if grep -E "^import .* from ['\"]" "$CAND" | grep -vqE "from ['\"](@hermes/plugin-sdk|react|react/jsx-runtime)['\"]"; then
  echo "✗ disallowed import"; exit 1
fi
if grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(" "$CAND"; then echo "✗ hardcoded colour"; exit 1; fi
PLUGIN="$CAND" "$REPO/scripts/test.sh" | tail -1 | grep -q "all passed" || { echo "✗ behaviour test failed: PLUGIN=$CAND ./scripts/test.sh"; exit 1; }

cp "$CAND" "$T" && mv -f "$T" "$REPO/desktop/plugin.js"   # same directory → atomic rename
echo "✓ promoted → desktop/plugin.js (the app reloads it now)"
