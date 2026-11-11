#!/usr/bin/env bash
# Remove Zed Mode from Hermes. Leaves this repo untouched.
set -euo pipefail
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
rm -rf "$HERMES_HOME/desktop-plugins/zedmode" "$HERMES_HOME/plugins/zedmode"
CONFIG="$HERMES_HOME/config.yaml"
if grep -qE '^\s*-\s*zedmode\s*$' "$CONFIG" 2>/dev/null; then
  cp "$CONFIG" "$CONFIG.bak-zedmode"
  grep -vE '^\s*-\s*zedmode\s*$' "$CONFIG.bak-zedmode" > "$CONFIG"
  echo "✓ Removed zedmode from plugins.enabled (backup: $CONFIG.bak-zedmode)"
fi
echo "✓ Removed. In the app: ⌘K → Reload desktop plugins."
