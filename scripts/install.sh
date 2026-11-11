#!/usr/bin/env bash
# Install Zed Mode into the Hermes desktop app.
#   ./scripts/install.sh               → link (dev mode: edits in this repo go live)
#   ./scripts/install.sh --copy        → frozen copy of the desktop half (backend stays linked)
#   ./scripts/install.sh --no-backend  → desktop half only (pins and non-live transcripts say "Backend off")
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
DESK="$HERMES_HOME/desktop-plugins/zedmode"
PKG="$HERMES_HOME/plugins/zedmode"
CONFIG="$HERMES_HOME/config.yaml"
COPY=0; BACKEND=1
for a in "$@"; do case "$a" in --copy) COPY=1;; --no-backend) BACKEND=0;; esac; done

[ -d "$HERMES_HOME" ] || { echo "No Hermes home at $HERMES_HOME. Is Hermes installed?"; exit 1; }
mkdir -p "$HERMES_HOME/desktop-plugins" "$HERMES_HOME/plugins"

# 1. Desktop half: the pane / page / titlebar toggle (desktop/plugin.js)
rm -rf "$DESK"
if [ $COPY = 1 ]; then cp -R "$REPO/desktop" "$DESK"; echo "✓ Copied desktop half → $DESK"
else ln -s "$REPO/desktop" "$DESK"; echo "✓ Linked desktop half → $DESK"; fi

# 2. Backend half: dashboard/plugin_api.py → /api/plugins/zedmode/zed
if [ $BACKEND = 1 ]; then
  rm -rf "$PKG"; ln -s "$REPO" "$PKG"
  echo "✓ Linked backend package → $PKG"
  # Python plugin code only runs when listed in plugins.enabled (a security gate).
  if grep -qE '^\s*-\s*zedmode\s*$' "$CONFIG" 2>/dev/null; then
    echo "✓ zedmode already in plugins.enabled"
  else
    cp "$CONFIG" "$CONFIG.bak-zedmode"
    python3 - "$CONFIG" <<'PY'
import sys, re
p = sys.argv[1]; lines = open(p).read().splitlines()
out, done = [], False
for i, l in enumerate(lines):
    out.append(l)
    if not done and l.strip() == "enabled:" and any(x.rstrip() == "plugins:" for x in lines[max(0, i - 3):i]):
        indent = re.match(r"\s*", l).group(0)
        out.append(f"{indent}  - zedmode"); done = True
if not done:
    if "plugins:" in (x.rstrip() for x in lines):
        sys.exit("plugins: block has no 'enabled:' list; add '  enabled:\\n    - zedmode' by hand")
    out += ["", "plugins:", "  enabled:", "    - zedmode"]
open(p, "w").write("\n".join(out) + "\n")
PY
    echo "✓ Added zedmode to plugins.enabled (backup: $CONFIG.bak-zedmode)"
  fi
fi


cat <<EOF

Next, in the Hermes desktop app:
  1. ⌘K → "Reload desktop plugins" (usually automatic within seconds)
  2. Click the layers icon in the titlebar (left of HUD), or press ⌘⌥Z
  3. Esc / the icon again / "Exit" → back to classic Hermes
If Zed Mode says "Backend off": Capabilities → Plugins → Rescan, or restart Hermes.
EOF
