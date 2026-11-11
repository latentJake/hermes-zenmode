# Roadmap

Directions, in rough order. None of this is a promise; it is what the code and the known limits
point at.

## Next

| | What | Why |
|---|---|---|
| **Status-dot canary** | A check that reads the installed app's `SessionStatusDot` and fails when the classes Zed Mode reads no longer match | Today an app update can silently drop *unread* and *process running* from the ordering ([compatibility](compatibility.md)). Asking Hermes for a supported read of a session's dot state would remove the dependency altogether |
| **Project and profile filter** | A small store for the selected profile and project, so the stack can show one project's conversations or one agent's | The stack is one list today; with many profiles and projects it needs a filter that never moves the card you're on |
| **Send to a non-live chat** | Resume a stored conversation so it can take a message from Zed Mode, instead of "Open in Hermes & send" | The most common reason to leave Zed Mode |
| **Thread header facts** | Loaded tools, context size and working folder in the held thread's header, from data the cards already fetch | The card shows what a session made; the thread should show what it has loaded |
| **Prompt chips** | Attachments in a prompt (`@file:`, `@folder:`, `@url:`) shown as chips instead of raw text | Reads better in cards and threads |
| **Demo mode** | Zed Mode pointed at a dummy world inside the real app, read-only | A safe way to show and test it without real conversations |

## Later

- A **control row** above the stack (profiles and projects as bubbles) and the same as a toolbar
  while holding.
- **Head tracking** to drive the stack's viewpoint from a pose stream.
- Verification on **Windows and Linux**, and on Hermes versions after 0.23.0.
- A theme route that gives the *native* conversation some of this depth, rather than Zed Mode
  rebuilding a thread.

## Not planned

- Replacing the classic conversation view. Zed Mode layers on top and keeps classic Hermes one
  keypress away.
- Automatic approvals, deleting or archiving conversations, or anything that acts without your
  explicit click.
