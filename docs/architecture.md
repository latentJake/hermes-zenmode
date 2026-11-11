# Architecture

How Zen Mode works, for someone reading or changing the code. Written for **0.19.0**; read it
next to `desktop/plugin.js` and `dashboard/zed_backend.py`. What it depends on in Hermes, and how
each dependency fails, is in [compatibility.md](compatibility.md).

## Two halves, two processes

```
┌─ Hermes desktop app (Electron renderer) ─────────────────────────────────────────────┐
│  desktop/plugin.js          loaded from ~/.hermes/desktop-plugins/zen-mode        │
│    register(ctx): titlebar tool · #/zen-mode page · sidebar entry · ⌘K · ⌘⌥Z      │
│                   ::zen-mode{} directive · Settings → Plugins → Zen Mode      │
│    ZedView: one stack of every conversation, most urgent first                        │
│             ⇧⏎ hold → the stack steps aside, a Thread floats in beside it             │
│                                                                                       │
│        host.request / host.onEvent                 ctx.rest('/zed', …)                │
│        (JSON-RPC + event stream)                   (HTTP; the app adds ?profile=…)    │
└──────────────┬───────────────────────────────────────┬────────────────────────────────┘
               ▼                                       ▼
┌─ Hermes gateway (Python, long-lived, a separate process) ────────────────────────────┐
│  RPC: session.list / active_list / history / create / branch* / title / interrupt     │
│       prompt.submit · image.attach_bytes · file.attach · config.set · …               │
│  events: message.start/delta/complete · tool.start/complete · session.info            │
│                                                                                       │
│  /api/plugins/zen-mode/<name>                                                     │
│    dashboard/plugin_api.py   imported ONCE, then a stable dispatcher                  │
│      └─ dashboard/zed_backend.py   re-imported whenever its mtime changes             │
│           read-only: SessionDB → ~/.hermes/state.db                                   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The UI half runs in the app and talks to the gateway the way the app's own screens do. The data
half runs **inside the gateway**, which is why it can use Hermes' own `SessionDB` and why it
survives app restarts.

## Files

| File | Job |
|---|---|
| `desktop/plugin.js` | All the UI: registration, attention states, the stack, threads, composer, edit cards, the tuning panel, and the CSS (a template string) |
| `dashboard/plugin_api.py` | A small, stable dispatcher: `GET /{name}` → `zed_backend.route_<name>(**query)` |
| `dashboard/zed_backend.py` | The data routes (below) |
| `dashboard/manifest.json` | Tells the gateway where the backend is (`tab.hidden`, so the web dashboard gets no tab) |
| `plugin.yaml` | Manifest for `hermes plugins validate` and the catalog |
| `tests/` | The UI harness, the backend test, fixtures, the dummy world |
| `scripts/` | `install`, `uninstall`, `check`, `test`, `promote` |

## The UI half

`plugin.js` is organised in bands; search for the `// ──` headers.

1. **Tune.** The feel-dials live in one `TUNE` table, held in a tiny external store (`tune`,
   `setTune`, `useTune`). They reach CSS as `--hz-*` variables on the Zen Mode root, and hot JS paths
   read `tune.x` directly. Persisted as a diff from defaults in the plugin's storage.
   See [tuning.md](tuning.md).
2. **Enter / exit.** Zen Mode is a **route** (`#/zen-mode`), not an overlay. Entering remembers the
   hash you came from; leaving navigates back. A short eased transition runs first (a dial; off
   with reduced motion). Zen Mode always opens on the front of the stack.
3. **Data hooks**, all through the app's shared React Query client, so the page, the directive and
   every thread share one cache entry per key:

   | Hook | Source | Poll |
   |---|---|---|
   | `useLive` | RPC `session.active_list` (live id, stored id, status, last active, model) | 3 s |
   | `useAllSessions` | RPC `session.list` | 15 s |
   | pins | REST `/zed` | 15 s |
   | card facts | REST `/glance` (cached by the backend) | 20 s |
   | `useSession(id, liveId)` | **live:** RPC `session.history` → `historyToTurns`. **stored:** REST `/session` | 2.5 s working · 8 s live · 20 s stored |
   | `useLiveStream(liveId)` | `host.onEvent('*')` filtered to the live id: text deltas, tool starts, completion | push |
   | pending requests | RPC `session.events.since` → `open_requests`, for cards that are waiting | 2.5 s |

   Both transcript feeds are normalised to `{ total_turns, turns: [{ user, steps, assistant }] }`.
4. **Attention states.** What the stack is ordered by. `DotProbe` renders the app's own
   `SessionStatusDot` for every conversation in a hidden box and reads each dot's classes back
   (a `MutationObserver` keeps it current), so unread / working / needs-input / process-running
   always match the sidebar. *Failed* comes from gateway events collected from plugin load.
   `stateOf(row, live)` reduces everything to one of: failed, needs, working, background, unread,
   pinned, rest.
5. **The stack** (`Stage`, `renderCard`). Only the cards near the front are in the DOM. Each card's
   transform comes from its distance `r` to the selected card (`translate3d`, brightness, an extra
   rise past where the curve starts); the CSS transition is the animation system, including when
   the order changes (cards are keyed by conversation id). Free scrolling adds an offset that
   returns to zero when you stop.
6. **ZedView.** Builds one list (sessions + pins + live sessions), sorts by state then recency, and
   keeps the selection **by id**, so the card you are on never moves when the order changes.
   `held = { id, open, full }` is the floating thread; `half` says which side the keys act on.
   Placement is a transform clamped from the measured pane (`ResizeObserver`); below a width
   threshold a held thread fills the pane instead of sitting beside the stack.
7. **Threads** (`useThread`, `Thread`, `Rail`, `Composer`). One hook owns data, scroll, the current
   chapter (one user prompt plus everything until the next) and a small keyboard API Zen Mode drives.
   Performance rules that matter: chapters are memoised with stable callbacks; scroll is measured
   at most once per frame using layout offsets and a binary search. Break these and scrolling
   jitters.
8. **Composer.** The **+** menu adds `@file:`, `@folder:` and `@url:` references, joined at the top
   of the prompt. Images are staged with `image.attach_bytes` on the live session, and a send that
   carries images always goes straight to `prompt.submit` on that session with
   `attachments: [{ path, mime }]`. Other sends try, in order: the chat's own composer
   (`host.composer.submit`), then `prompt.submit` for a live session; a chat that isn't live keeps
   your text and offers an explicit **Open in Hermes & send**. **Stop** calls `session.interrupt`.
9. **Model pill.** The app's real `ModelCatalogMenu`, given an owner-routed `model.options` request
   (so it lists what that session can use). A pick follows the native protocol: paint at once,
   `config.set model "<m> --provider <p> --session"`, then **confirm** (the app's confirm dialog
   with the owner's message), **deferred** (picked mid-turn), or **rolled back** with the reason.
   `session.info` events are the source of truth. The reason comes from the backend's `/resolve`.
10. **Edit cards** (`DiffStep`). Edit tools return JSON with a unified diff. It is parsed into
    rows and highlighted by rendering a fenced code block through the app's own
    `MessageTextContent` (Shiki), tinting the `.line` rows with generated CSS. If no `.line` rows
    appear within 1.5 s it falls back to plain tinted rows.
11. **Actions on your behalf**, each one a click or keypress of yours, each the same gateway call
    the app makes: answer an approval (`approval.respond`) or question (`clarify.lock`); rename
    (`session.title`); new chat (`session.create`, with a folder as `cwd`); branch
    (`session.branch` with `through_message_id`, `session.branch_whole`, `session.branch_stored`).
12. **Registration** (`export default { register }`): one `registerMany`, the failure listener, the
    titlebar tool (re-registered on `hashchange` to swap its icon) and the settings page. `ctx`
    disposes everything on disable or reload.

## The data half

`plugin_api.py` is imported **once** by the gateway and kept until the gateway restarts, so it only
dispatches and re-imports `zed_backend.py` when that file's mtime changes. A broken edit keeps
serving the last good module.

| Route | Returns |
|---|---|
| `/health` | version check |
| `/zed` | pinned conversations (the sidebar's own pins) |
| `/session?id=` | a stored transcript as chapters, with edit diffs joined to their tool calls; text is clipped (4 k prompt, 6 k step, 20 k diff, last 80 steps per turn) |
| `/glance?ids=` | what a card shows: facts from the session row in one query, transcript-derived facts (latest prompts, files touched, diff size, active time) from a cache keyed by the session's revision |
| `/resolve`, `/usable` | Hermes' own model resolver's verdict, to explain a refusal and to keep unusable providers out of the menu |

Rules the backend keeps:

- **Read-only.** Hermes' databases are opened with `mode=ro` plus `PRAGMA query_only` and bound
  parameters; a test proves a write is refused. All writes the plugin performs go through the
  gateway's own RPC. The only file the backend writes is its own cache,
  `$HERMES_HOME/plugin-data/zen-mode/cache.db`.
- **Use what Hermes stores.** Listings come from `SessionDB.list_sessions_rich`, the sidebar's own
  query, so branches, compression segments and pins match.
- **Routes accept only the parameters they declare.** The app appends its own (e.g. `profile`) to
  every plugin REST call; `_route()` drops the rest.

## The rules a desktop plugin lives under

| Rule | Why | If ignored |
|---|---|---|
| File at `~/.hermes/desktop-plugins/<id>/plugin.js`; folder name equals `id` | That's what the app scans | Never appears |
| Plain ESM, **no JSX syntax** (`jsx()` / `jsxs()`) | Loaded uncompiled | Parse error toast |
| Imports only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime` | Import allowlist | "unsupported import" toast |
| Colours only through `var(--ui-*)` | Follows every theme | Looks wrong in other themes |
| Clean up global listeners (`ctx.addEventListener`, effect cleanups) | Modules can't unload; hot reload stacks copies | Duplicate handlers |
| Never leave `plugin.js` half-edited | It hot-reloads on every save | The app keeps an old or broken version |
| No lone layout pane | Closing a plugin's only pane disables the whole plugin | The titlebar toggle disappears |

`scripts/check.sh` enforces the first four; `scripts/promote.sh` is how a change is swapped in
safely. See [development.md](development.md).
