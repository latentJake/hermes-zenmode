# Changelog

Release notes for users. Versions before 0.10 were prototypes with a different design (a NOW view
with tiles and a LIBRARY of four stacks); they are summarised at the bottom. The detailed
build log, including what each step was and wasn't verified against, is in
[docs/archive/dev-log.md](docs/archive/dev-log.md).

Dates are 2026. "Verified" means checked by the automated suite unless it says it was seen in the app.

## 0.19.0: early beta (Nov 11)

- **New chat without leaving Zen Mode.** The round **+** asks where (the open workspace, a folder you've
  worked in, or none), creates the chat through the gateway call the app itself uses, and brings it
  up beside the stack with the caret in its composer. If the gateway refuses, Zen Mode says so and opens
  the app's own New session instead.
- Catalog manifest (`plugin.yaml`) and MIT licence added.
- Seen in the app (sandboxed Hermes, real gateway): picking a folder made a live chat held beside
  the stack; its first prompt ran and the card took its real title.

## 0.18: ⏎ is for typing, branching (Nov 11)

- **Plain ⏎ no longer opens anything** in Zen Mode. **Open** (or a double-click) opens a chat in classic
  Hermes; **⌘⏎** opens it in a new tab.
- Sending in a chat that **isn't live** keeps your text and says why, instead of throwing you into
  another view. **Open in Hermes & send** does it on request.
- **Branch** a conversation without leaving Zen Mode: the header button copies the whole chat; the icon
  on a prompt (live chats) copies everything up to that prompt's answer. Same calls as Hermes' own
  branch.

## 0.16 and 0.17: model selection, narrow panes, transitions (Nov 11)

- **Model switching follows the native protocol.** The pill shows provider · model · effort. A pick
  appears at once and is confirmed by the session; a guarded model asks through the app's confirm
  dialog with the owner's message; a pick made mid-turn says it applies after the turn; a refusal
  rolls back and shows the real reason (from Hermes' own resolver). **Connect provider…** opens
  Settings → Providers when the reason is a missing login.
- **The menu lists what that session can use** (the session's own catalog), and providers that
  can't resolve are left out and named in the footer.
- **A held thread fills the pane** when brought to the foreground, and in any pane narrower than a
  threshold (dial), following live resizes.
- **Entering and leaving Zen Mode is a short transition** (a dial; instant with reduced motion). A card's
  prompt list fades above its bottom row instead of running under it.

## 0.15: answer on the card (Nov 11)

- A conversation **waiting on an approval** shows the request: what the agent wants and the exact
  command, with the choices the gateway allows (Approve once, This session, Always, Deny). A
  **question with choices** shows its choices. A click answers that one request.
- **⇧Y / ⇧N** approve once / deny the front card's request. Shifted on purpose.
- There is never an approve button without its request shown above it.

## 0.14: a clean data layer, many agents (Nov 11)

- Hermes' database is opened read-only (twice over); card facts come from one batched call and are
  cached by the session's revision.
- **Waiting cards hop** like a Dock icon, hover lifts a card behind the front, **a** jumps to the next
  conversation that wants you (and the held thread follows).

## 0.10 to 0.13: one inbox-ordered stack (Nov 10)

- **Zen Mode is one stack**, ordered by what needs you: failed, needs you, working, process running,
  unread, pinned, the rest. State comes from the app's own status dot, so it agrees with the sidebar.
- **⇧⏎ holds** a card: the stack steps aside and the conversation floats in beside it. ⇧⏎ again
  brings it to the foreground; Esc steps back a level at a time.
- The composer's **+** menu is the native one (Files, Folder, Images, Paste image, URL, snippets).
  Images sent from Zen Mode now reach the model.
- The stack curves up past a certain card so a long history reads the same as a short one; it can
  be placed by dragging a grip; scrolling follows the gesture; cards show the latest prompts and
  what the session made; **r** renames a live chat.
- The 3D **PAPER** thread was parked behind an experimental dial.

## 0.9: edit cards and tuning (Nov 9–10)

- Edits show as compact diff cards in your theme's colours.
- **The tuning panel** (`` ` ``): live dials, presets and shareable `zed1.…` codes, also under
  Settings → Plugins → Zen Mode.
- Fixes: every backend call returned 400 after the app began adding `?profile=…` to plugin
  requests; a crash in the old TURNS view.

## 0.1 to 0.8: prototype (Nov 9)

A session-card widget became a desktop plugin with a titlebar toggle, a full page and an inline
directive; live conversations read from the gateway's own `session.history` and streamed from its
events; threads with sticky prompts and a prompt rail; the native composer parts, image paste, the
model menu, Stop; native-looking tool rows. This design (NOW tiles plus a LIBRARY) was replaced
by 0.10.
