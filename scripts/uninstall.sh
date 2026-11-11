#!/usr/bin/env bash
# Remove Zen Mode from Hermes. Leaves this repo untouched.
set -euo pipefail
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
rm -rf "$HERMES_HOME/desktop-plugins/zen-mode" "$HERMES_HOME/plugins/zen-mode"
CONFIG="$HERMES_HOME/config.yaml"
if grep -qE '^\s*-\s*zen-mode\s*$' "$CONFIG" 2>/dev/null; then
  cp "$CONFIG" "$CONFIG.bak-zen-mode"
  grep -vE '^\s*-\s*zen-mode\s*$' "$CONFIG.bak-zen-mode" > "$CONFIG"
  echo "✓ Removed zen-mode from plugins.enabled (backup: $CONFIG.bak-zen-mode)"
fi
echo "✓ Removed. In the app: ⌘K → Reload desktop plugins."
