# Keys and mouse

Keys work **outside text fields**. Inside a text box, ⏎ and the usual editing keys behave as
you'd expect, and Zen Mode's single-letter keys are ignored. Shortcuts are written for macOS. The
open/close shortcut registers as **Ctrl+Alt+Z** elsewhere, and **⌘⏎** also accepts **Ctrl+⏎**.

## Everywhere

| Key | Does |
|---|---|
| **⌘⌥Z** | Open / close Zen Mode. Rebindable in Hermes settings as "Zen Mode: Toggle" |
| **⌘K → Zen Mode: Toggle** | The same, from the command palette |
| **`** | Open / close the tuning panel (see [tuning](tuning.md)) |

## On the stack (nothing held)

| Key | Does |
|---|---|
| **↑** / **k** / **⇥** | One card deeper (older, less urgent) |
| **↓** / **j** / **⇧⇥** | One card closer |
| **Home** | Back to the front of the stack |
| **⇧⏎** or **space** | **Hold** the front card |
| **⌘⏎** | Open the front card in classic Hermes, in a **new tab** |
| **i** or **/** | Hold the front card and put the caret in its composer |
| **r** | Rename the front card (works while that chat is live) |
| **a** | Jump to the next conversation that wants you (failed, needs you, unread); wraps |
| **⇧Y** | Approve the front card's pending request **once** |
| **⇧N** | Deny the front card's pending request |
| **esc** | Exit Zen Mode, back to where you were |

Plain **⏎ does nothing** here, on purpose: it is left for typing. To open a conversation in place
in classic Hermes, use the **Open** button or double-click its card.

**⇧Y / ⇧N** only act when the front card is showing a pending request, and the request (what
and the exact command) is always on the card above the buttons. They are shifted so a stray
keypress can't approve anything.

## Holding a conversation

Two halves: the **stack** (left) and the **thread** (right). **← / →** (or **h / l**) pick which
half the keys act on. Walking the stack while holding makes the thread follow the card you stop on.

| Key | Does |
|---|---|
| **↑ / ↓** (**k / j**) | Thread half: previous / next **prompt**. Stack half: walk the stack |
| **↓** on the last prompt | Jump to the very end of the agent's reply (↑ returns to that prompt) |
| **← / →** | Switch half. **←** from the foreground steps back beside the stack |
| **⇧⏎** | Bring the thread to the **foreground** (the stack falls away); again: back beside the stack |
| **space** | Put it back (release the hold) |
| **esc** | One level back: foreground → beside the stack → just the stack → exit Zen Mode |
| **⌘⏎** | Open this conversation in classic Hermes, in a new tab |
| **i** or **/** | Write in the conversation |
| **a** | Next conversation that wants you; the held thread follows |

In a pane **narrower than 860 px** (adjustable: Tune → Hold → *Side by side from*) a held
thread already fills the pane, so **⇧⏎, esc and ←** all go straight back to the stack.

## In the composer

| Key | Does |
|---|---|
| **⏎** | Send |
| **⇧⏎** | New line |
| **esc** | Leave the text box (keys go back to Zen Mode) |
| **⌘V** | Paste: an image from the clipboard is attached to the live chat; text pastes as text |

The **+** menu offers Files…, Folder…, Images…, Paste image, URL… (the URL box takes **⏎** to add,
**esc** to cancel) and prompt snippets. Files and images need a **live** chat; folders and URLs work
anywhere. **Stop** replaces Send while the agent is working and your draft is empty.

## Mouse

| Action | Does |
|---|---|
| Scroll over the stack | Walk it; the cards follow your fingers and settle on the nearest card |
| Point at a card behind the front | It lifts toward you |
| Click a card behind the front | Select it |
| Click the front card | **Hold** it |
| Double-click a card | Open it in classic Hermes, in place |
| ⌘-click / ⌘-double-click | Open in a new tab |
| **Open** (thread header) | Open in classic Hermes, in place |
| Drag the grip (⠿) on the front card | Place the stack; double-click the grip to reset |
| A state chip above the stack | Jump to the first card in that state |
| Round **+** (top left) | New chat: pick the open workspace, a folder you've worked in, or none |
| **Branch** (thread header) / icon on a prompt | Copy the conversation, whole or up to that prompt, into a new one |
| Prompt rail tick (right edge of a thread) | Hover to read the prompt; click to jump |
| Model pill (composer) | On a live chat: open the model menu for that session. On a chat that isn't live it only shows the model |

## Inline (`::zen-mode{}`)

When the agent writes the directive on its own line, a compact copy of the stack renders in the
message. In that mode **esc**, rename, the tuning panel and placement are off, and holding
opens the conversation in classic Hermes instead.
