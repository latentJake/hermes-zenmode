# Compatibility

## Supported

| | |
|---|---|
| **Hermes** | `requires_hermes: ">=0.23.0"`. Developed and tested on **v0.23.0** (the only version it has been run against). Newer versions are untested. |
| **Platform** | **macOS**. Nothing has been run on Windows or Linux. The SDK is cross-platform and the shortcut registers as Ctrl+Alt+Z there, but treat it as unverified. |
| **Surface** | The Hermes **desktop app** (Electron). The CLI, TUI and web dashboard don't load desktop plugins. |
| **Profiles** | Works with the active profile. The backend resolves the Hermes home through Hermes' own helper, so it follows the profile the gateway is running. Multi-profile setups are untested. |
| **Browsers / remote gateways** | Untested. The plugin assumes the desktop app talking to a local gateway. |

If you run it on something else, treat what you see as a bug report, not a promise.

## What we depend on

Hermes is a moving target. This table is the honest list of what Zen Mode relies on and how firm each
piece is. The further right, the more likely a Hermes update can break it.

| Documented SDK (stable) | Exported but undocumented (soft) | Not part of the SDK; read from the app's source (fragile) |
|---|---|---|
| `host.request`, `host.onEvent`, `host.navigate`, `host.openSession`, `host.newChat`, `host.restartGateway`, `host.notify` | `MessageTextContent`, `SessionStatusDot`, `ackStoredSessionId` | the area `'titleBar.tools.right'` (a native titlebar button; the documented `titleBar.right` slot hides the app's own buttons on plugin pages) |
| `useQuery`, `useValue`, `haptic`, `relativeTime`, `Codicon` | `ModelCatalogMenu`, `ModelMenuCloseContext`, `DropdownMenu*`, `ConfirmDialog` | RPC names and payloads: `session.active_list`, `session.history`, `session.create`, `session.branch*`, `session.title`, `session.events.since`, `prompt.submit`, `image.attach_bytes`, `file.attach`, `session.interrupt`, `config.set`, `model.options`, `approval.respond`, `clarify.lock` |
| `ctx.register*`, `ctx.rest`, `ctx.storage`, `ctx.registerSettingsPage`, `ctx.files`, `ctx.os` | `composerSurfaceRing`, `composerInputBacking`, `GHOST_ICON_BTN`, `PRIMARY_ICON_BTN` | event types and payload fields: `message.delta.payload.text`, `tool.start.payload.context`, `session.info` |
| `ROUTES_AREA`, `PALETTE_AREA`, `KEYBINDS_AREA`, `SIDEBAR_NAV_AREA`, `TRANSCRIPT_DIRECTIVE_AREA` | | **the class names `SessionStatusDot` paints with** (`bg-amber-500`, `bg-(--ui-success)`, …), read by `DotProbe` to know unread / process-running |
| | | Shiki's `code > .line` DOM inside `MessageTextContent`; the `--ui-diff-*` variable names; the edit tools' result JSON (`{ diff }`) and tool names |
| | | the backend's one private call, `hermes_cli.model_switch.switch_model` (to explain a refusal), and `SessionDB.list_sessions_rich` |

## What you'd see if one breaks

| If this changes | Zen Mode does | Visible? |
|---|---|---|
| `plugin.js` can't load | The app keeps the previous version and shows a toast | Yes |
| The backend isn't enabled or loaded | Pins missing (a note says so); non-live threads offer **Restart gateway** | Yes |
| A backend route errors | The thread shows the error text | Yes |
| An RPC is renamed or its payload changes | That action fails with the gateway's message ("Could not rename", "Could not branch", …); reading falls back to the stored transcript | Yes |
| `SessionStatusDot` is restyled | `DotProbe` reads every dot as idle. Needs-you and working still come from the live list; **unread and process-running silently drop out of the ordering** | **No**: nothing announces it |
| A turn fails while the app is closed | Not shown as failed (failures come from live events) | No |
| A live session id disappears between polls | Falls back to the stored transcript | Yes |
| An undocumented component is missing | A boundary shows plain text or a plain label instead (diff colours, markdown, model menu) | Yes |
| `switch_model` moves or changes | The model refusal shows the gateway's short reason; the menu lists the catalog unfiltered | Mostly |

## Checking a new Hermes version

There is no automated canary yet. After updating Hermes, in the app:

1. **⌘K → Reload desktop plugins**; no error toast.
2. Open Zen Mode: pins appear (backend), and conversations show.
3. A chat that is **working** wears the running arc; a chat that finished while you were elsewhere
   shows as **unread**; a chat with a dev server still running shows **process running**. These
   three depend on the status dot and are the first to go quietly.
4. Hold a live conversation: text streams, an edit shows a coloured diff, and the model menu opens.
5. Trigger an approval on something harmless (`ls`) and answer it from the card.

Run `./scripts/test.sh` too, but note it tests against a fake of the SDK: it proves the plugin's
logic, not that Hermes still matches the fake.

## Reporting a break

Include your Hermes version (`hermes --version`), the toast text or the relevant lines of
`~/.hermes/logs/desktop.log` and `errors.log`, and which row above it matches.
