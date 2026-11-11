#!/usr/bin/env bash
# Sanity checks before you commit or reload. No network, no app needed.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

echo "• syntax"
cp "$REPO/desktop/plugin.js" "${TMPDIR:-/tmp}/zedmode-check.mjs"
node --check "${TMPDIR:-/tmp}/zedmode-check.mjs" && echo "  ok"

echo "• imports (disk plugins may only import @hermes/plugin-sdk, react, react/jsx-runtime)"
bad=$(grep -E "^import .* from ['\"]" "$REPO/desktop/plugin.js" | grep -vE "from ['\"](@hermes/plugin-sdk|react|react/jsx-runtime)['\"]" || true)
if [ -n "$bad" ]; then echo "  ✗ $bad"; fail=1; else echo "  ok"; fi

echo "• no hardcoded colours"
hex=$(grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(" "$REPO/desktop/plugin.js" || true)
if [ -n "$hex" ]; then echo "  ✗ $hex"; fail=1; else echo "  ok"; fi

echo "• id matches folder name used by install.sh"
grep -q "const ID = 'zedmode'" "$REPO/desktop/plugin.js" && echo "  ok" || { echo "  ✗ id changed"; fail=1; }

echo "• backend /zed runs against your real state.db"
AGENT="${HERMES_HOME:-$HOME/.hermes}/hermes-agent"
if [ -x "$AGENT/venv/bin/python" ]; then
  (cd "$REPO/dashboard" && "$AGENT/venv/bin/python" - "$AGENT" <<'PY') || fail=1
import sys, asyncio; sys.path[:0] = [sys.argv[1], "."]
import zed_backend as p
d = asyncio.run(p.zed())
print(f"  ok  pinned={len(d['pinned'])} recent={len(d['recent'])} folders={len(d['folders'])}")
PY
else
  echo "  skipped (no Hermes venv at $AGENT)"
fi

exit $fail
