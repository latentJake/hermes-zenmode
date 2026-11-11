# Design

Zed Mode treats the screen as a window you look *through*: your conversations sit in one
stack that recedes into it, and the one that needs you is at the front. These are the rules
the interface follows, so anything added later should follow them too.

## Rules

1. **Layer on top, never replace.** No patching app source, no forking Hermes.
   Plugins, panes and directives only. The 2D app is always one gesture away.
2. **Depth carries meaning.** Distance into the screen = how little it needs you. The front
   card is the most urgent thing; each step back matters less right now; past the pins it is
   simply older. Inside a thread, the prompt sits in front and the agent's work a little behind
   it. Don't add depth just for decoration.
3. **Different things look different.** A card says what state it is in before you read it: an
   edge colour (red failed, amber needs you, green unread, dashed for a process still running),
   the app's running arc while it works, an accent top edge for a pin, and the state named in
   its title strip. The colours and the arc are the app's own, so nothing has to be learned twice.
4. **One stack, ordered like an inbox.** Zed Mode opens on the front of a single stack: failed, needs
   you, working, process running, unread, pinned, then everything else. A clean slate shows
   your pins. No index page, no quadrants, no second view.
5. **Prompts are chapters.** A user's input is the landmark: sticky at the top of its chapter,
   a tick on the rail, the unit you navigate by (↑↓).
6. **The theme owns colour.** Only theme variables (`var(--ui-*)`); `check.sh` fails on hex or
   `rgb()`. The stack should look right in every Hermes theme without changes.
7. **Native chrome, honest content.** A card's top strip carries the app's own status dot, its
   title and its state, so a card further back still reads like a window's title bar. Real
   titles and previews, never placeholders.
8. **Keyboard first, pointer welcome.** ↑ goes deeper and ↓ closer; j k / ⇥ / Enter all work; the wheel is
   rate-limited (220 ms per card).
9. **Motion is short and eased.** `.45s cubic-bezier(.2,.8,.2,1)`: cards settle, they don't bounce.
10. **Quiet by default.** Match the native conversation: no panels behind tool steps or replies;
   text position and depth do the work. Only your prompt gets a surface.
11. **Nothing changes unless you ask, in the place you asked.** Everything that changes state is a
   direct, visible action of yours: sending a prompt or image, answering an approval or question
   (always with the request shown above the button), renaming a chat, starting or branching a
   chat, switching a live chat's model or effort, stopping an agent, or restarting the gateway
   (offered only when the backend isn't loaded). It never deletes or archives sessions, never
   answers anything automatically, and the backend is strictly read-only.

## Tunables

Every number that shapes the feel is a live dial; see [tuning.md](tuning.md).

## Future work

Head tracking (a pose stream could drive `perspective-origin`), a metadata callout line,
scroll detents with haptics, and type to filter. Zed Mode deliberately has no glass effects of
its own: it follows the Hermes app's design system.
