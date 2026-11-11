# Quick start

## Before you start

- The **Hermes desktop app**, v0.23.0 or newer (desktop plugins aren't loaded by the CLI or web
  dashboard alone).
- `git` and `python3`. `node` is only needed to run the checks yourself.
- macOS is the tested platform ([compatibility](compatibility.md)).

## Install

There are two ways. Pick one; don't use both on the same Hermes.

### With the Hermes CLI

```bash
hermes plugins install latentJake/hermes-zenmode
hermes plugins enable zedmode
```

`install` clones the repo into `~/.hermes/plugins/zedmode` and warns that it is a custom
(unreviewed) source, which is expected for a plugin installed straight from GitHub. `enable` adds
`zedmode` to `plugins.enabled` so the Python half can run. The desktop app copies the `desktop/`
half into `~/.hermes/desktop-plugins/zedmode` by itself.

### From a clone

```bash
git clone https://github.com/latentJake/hermes-zenmode.git
cd hermes-zenmode
./scripts/install.sh
```

This links Hermes to your checkout, so edits and `git pull` show up straight away. `install.sh` is
a script you run by hand. It does three things, and nothing else:

| Step | Result |
|---|---|
| Links `desktop/` to `~/.hermes/desktop-plugins/zedmode` | The app loads `plugin.js` (the UI) |
| Links the repo to `~/.hermes/plugins/zedmode` | The gateway finds `dashboard/plugin_api.py` (pins and stored transcripts) |
| Adds `- zedmode` under `plugins.enabled` in `~/.hermes/config.yaml` | Allows that Python to run. Your previous file is saved as `config.yaml.bak-zedmode` |

Options:

| Flag | Effect |
|---|---|
| `--copy` | Copy the desktop half instead of linking it (a frozen copy, independent of the repo) |
| `--no-backend` | UI only. Live conversations work; pins and non-live transcripts say "Backend off" |

Honour `HERMES_HOME` if your Hermes lives somewhere other than `~/.hermes`.

## First run

1. In Hermes: **⌘K → Reload desktop plugins** (it usually picks the plugin up by itself within
   seconds).
2. Press **⌘⌥Z**, or click the **layers icon** in the titlebar (left of Settings / Layout / HUD).
3. You'll see one stack of your conversations. Try:
   - **↑ / ↓** to walk it, or scroll.
   - **⇧⏎** on a card to **hold** it: the conversation opens beside the stack. **⇧⏎** again brings
     it to the foreground.
   - **i** to start typing a reply in the held conversation; **⏎** sends, **⇧⏎** adds a line.
   - **Esc** to step back, one level at a time. Esc from the bare stack returns to classic Hermes.

The full key list is in [keybinds.md](keybinds.md).

## Troubleshooting

| You see | Do this |
|---|---|
| No Zed Mode icon or command after install | **Capabilities → Plugins** → make sure **Zed Mode** is on; then **⌘K → Reload desktop plugins**. A load error appears as a toast and in `~/.hermes/logs/desktop.log` |
| "Backend off", no pins | **Capabilities → Plugins → Rescan**, or quit and reopen Hermes. Check `zedmode` is under `plugins.enabled` in `~/.hermes/config.yaml` |
| A non-live conversation says its transcript needs the backend | The gateway hasn't loaded the plugin's backend yet. The thread offers **Restart gateway**; this interrupts any reply in progress |
| ⌘⌥Z does nothing | Another app may own the shortcut. Rebind it in Hermes settings (it is registered as "Zed Mode: Toggle"), or use the titlebar icon or ⌘K |
| The model menu offers a model that then fails | The reason appears under the model pill (usually a provider that isn't connected); **Connect provider…** opens Settings → Providers |
| A conversation won't take a message | It isn't live. Zed Mode keeps your text; use **Open** to continue it in Hermes |

## Update

With the CLI: `hermes plugins update zedmode`.

From a clone with the default link, `git pull` is the update. The app reloads `plugin.js` when it
changes; the backend reloads `zed_backend.py` on the next request. With `--copy`, run
`./scripts/install.sh --copy` again.

## Uninstall

With the CLI: `hermes plugins remove zedmode`.

From a clone:

```bash
./scripts/uninstall.sh
```

This removes the two links and takes `- zedmode` out of `plugins.enabled` (again saving a
backup). Then **⌘K → Reload desktop plugins**. Your Hermes data is never touched.
Zed Mode's own settings (tuning, presets) live in the app's plugin storage, and its card cache is
`~/.hermes/plugin-data/zedmode/cache.db`; both are left behind harmlessly and can be deleted.
