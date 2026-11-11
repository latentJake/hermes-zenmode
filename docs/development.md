# Development

## Layout

See [architecture.md](architecture.md) for what each file does. The pieces you touch most:
`desktop/plugin.js` (the UI), `dashboard/zed_backend.py` (the data), `tests/` and `scripts/`.

## The loop

The app **hot-reloads `desktop/plugin.js` on every save** (the installer symlinks it), so a
half-written file goes live instantly. Don't edit it in place in several steps. Edit a copy, then
promote it:

```bash
cp desktop/plugin.js /tmp/candidate.js      # edit /tmp/candidate.js
./scripts/promote.sh /tmp/candidate.js      # checks + tests, then one atomic rename into place
```

`promote.sh` refuses to swap if any of these fail:

| Check | What |
|---|---|
| Syntax | `node --check` on the candidate |
| Imports | Only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` |
| Colours | No hex / `rgb()` literals (theme variables only) |
| Behaviour | The full headless test suite run against the candidate (`PLUGIN=<file> ./scripts/test.sh`) |

The backend is the opposite: edit `dashboard/zed_backend.py` and save. `plugin_api.py` re-imports it
on the next request, and a broken edit keeps serving the last good version. No restart.

## Tests

```bash
./scripts/check.sh    # static: syntax, imports, colours, id, backend against your state.db
./scripts/test.sh     # backend test (real dispatcher, FastAPI TestClient) + UI harness
```

| Suite | What it is |
|---|---|
| `tests/backend_test.py` | The real dispatcher and backend, called the way the app calls them (with `?profile=…`); proves read-only access and the cache |
| `tests/harness.mjs` + `fake-sdk.mjs` | The real `plugin.js` with the app's own React 19 / React Query, in jsdom, against a **fake** of the SDK. Fixtures come from your real `state.db` (`tests/make_fixtures.py`) |
| `tests/world.mjs` | A dummy world of agents in every state, shared with the demo kit |

Know what this does **not** cover: jsdom has no layout, 3D or motion, and the SDK is faked, so the
suite proves the plugin's logic, not how it looks or that Hermes still matches the fake. Anything
visual is checked by hand in the app; see the checklist below.

`test.sh` needs a Hermes install with its web build present (it borrows React from there) and skips
itself with a message otherwise; `promote.sh` treats a skipped run as a failure, so it needs that
environment too. One timing-sensitive check can fail occasionally on a busy machine;
re-run before assuming a regression.

## Checked by hand in the app

Before calling a change done, look at it in Hermes. The list that matters:

- ⌘⌥Z opens the stack; pins at the front on a quiet day
- A working chat wears the app's running arc
- A chat waiting on approval shows amber and the command with its choices; approving something
  harmless (`ls`) lets it continue, Deny stops it
- Unread and process-running cards sit where the sidebar's dots say
- ⇧⏎ holds; ⇧⏎ again brings it forward; Esc steps back each level
- An image sent from the composer reaches the model (ask what it sees)
- **+** → Files…, Folder…, URL… attach; the model menu switches a live chat; Stop works
- **New chat** and **Branch** create real sessions (use a throwaway chat)
- Resize the pane narrow and wide with a thread held

## Writing your own desktop plugin from this one

Zen Mode is a working example of a desktop plugin with a Python backend. To start your own:

1. **Copy** the repo and `rm -rf .git`. Rename in four places and keep them identical: the `ID`
   constant in `desktop/plugin.js`, the folder name used by `scripts/install.sh` and
   `uninstall.sh`, the id check in `scripts/check.sh`, and the `hstk-` CSS prefix (styles are
   global inside the app). Update `plugin.yaml` and `dashboard/manifest.json`.
2. **Choose your data**:

   | Source | Call |
   |---|---|
   | Hermes gateway RPC | `host.request(method, params)` |
   | Live app state | `useValue(host.state.x)` |
   | Live events | `ctx.onEvent(type, fn)` |
   | Your own Python | `ctx.rest('/path')` (a `plugin_api.py` under `dashboard/`, enabled in `plugins.enabled`) |
   | A folder the user grants | `ctx.files.requestFolder()` |

3. **Choose where it shows up**: a page (`ROUTES_AREA`), a titlebar button, a palette command, a
   keybind, an inline directive, a settings page. Avoid a lone layout pane: closing a plugin's only
   pane disables the whole plugin.
4. **Keep the loop above**: edit a copy, promote it.

Lessons baked into this repo that apply to any such plugin:

- The gateway imports a plugin's `plugin_api.py` once and keeps it until the gateway restarts
  (a separate process; quitting the desktop app doesn't restart it). Keep that file a stable
  dispatcher and put the logic in a module it re-imports on change.
- The app adds `?profile=…` (and may add more) to every plugin REST call. Accept only the query
  parameters a route declares.
- Read a **live** session through `session.history` and its event stream rather than the database;
  use the database only for sessions that aren't live.
- Everything you lean on that isn't in the SDK docs belongs in a compatibility table with a
  fallback ([example](compatibility.md)).

## Where the authoritative docs are

| Need | Where |
|---|---|
| The desktop plugin SDK | Hermes' `website/docs/developer-guide/desktop-plugin-sdk.md`, and every export in `apps/desktop/src/sdk/index.ts` |
| RPC methods | Hermes' `tui_gateway/methods_*.py` |
| A real plugin with a backend | Hermes' kanban plugin (`apps/desktop/src/plugins/kanban/`, `plugins/kanban/dashboard/plugin_api.py`) |
| Online | https://hermes-agent.nousresearch.com/docs |
