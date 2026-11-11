# Tuning

Every number that shapes how Zen Mode feels (depth, curve, motion, where things sit) is a live dial.
Press **`** in Zen Mode, or click **Tune** in the header, or use **Settings → Plugins → Zen Mode**.
Changes apply immediately and are saved.

The defaults are a starting point, not a verdict: nothing here has been tuned across displays.

## Presets

Built in: **Default**, **Subtle**, **Deep**, **Mac stack** (cards face you
and each drifts up and a little sideways), **Wave**, **No depth**. Load one with a click.

Your own: set the dials, type a name, **Save**. Delete a preset with the **×** on its chip.
**Reset all** returns every dial to its default; double-click a single value to reset just that one.

## Share codes

**Copy code** puts a `zed1.…` string on the clipboard. It encodes only the dials that differ from
the defaults (base64 of a small JSON object), so it stays short and keeps working if new dials are
added later. Paste one into the box and **Apply** to load it. An invalid code is rejected without
changing anything; unknown keys and out-of-range values are dropped or clamped.

Dragging the grip on the stack writes the position dials too, so a placement you like is part of
the code.

## The dials

Defaults are the shipped values; ranges are what the slider allows.

### Stack

| Dial | Key | Default | Range |
|---|---|---|---|
| Cards in view | `depth` | 8 | 3 to 24 |
| Card depth step | `cardZ` | 90px | 0 to 200px |
| Card rise step | `cardY` | 30px | 0 to 60px |
| Curve starts at card | `arcAt` | 3 | 0 to 16 |
| Curve up | `arcUp` | 5px | 0 to 30px |
| Curve tilt (− toward you) | `arcTilt` | 0° | -20 to 20° |
| Back card tilt (− toward you) | `backTilt` | 0° | -30 to 30° |
| Sideways drift per card | `driftX` | 0px | -40 to 40px |
| Dim per card | `dim` | 0.08 | 0 to 0.2 |
| Stack perspective | `stackPersp` | 1300px | 500 to 3000px |
| Eye height | `eyeY` | 0% | -40 to 100% |


### Stack position

| Dial | Key | Default | Range |
|---|---|---|---|
| Size | `stackScale` | 1× | 0.5 to 1.4× |
| Left / right | `stackX` | 0% | -45 to 45% |
| Up / down | `stackY` | 0% | -40 to 30% |


### Hold

| Dial | Key | Default | Range |
|---|---|---|---|
| Stack size | `splitScale` | 0.72× | 0.4 to 1× |
| Stack shift left | `splitX` | -30% | -45 to 0% |
| Stack shift down | `splitY` | 0% | -30 to 30% |
| Focused margin | `fgInset` | 12px | 0 to 80px |
| Side by side from | `splitMin` | 860px | 400 to 1800px |


### Motion

| Dial | Key | Default | Range |
|---|---|---|---|
| Hold speed | `dive` | 520ms | 150 to 1500ms |
| Enter / exit speed | `zedMs` | 450ms | 0 to 950ms |
| Scroll per card | `scrollPx` | 110px | 30 to 400px |
| Hover lift | `hoverLift` | 16px | 0 to 60px |
| Needs-you bounce | `bounce` | 22px | 0 to 60px |


### Content

| Dial | Key | Default | Range |
|---|---|---|---|
| Diff preview lines | `diffLines` | 14 | 4 to 60 |

### Experimental

| Dial | Key | Default | Range |
|---|---|---|---|
| PAPER thread toggle | `paper` | 0 | 0 to 1 |
| Prompt lift | `lift` | 34px | 0 to 120px |
| Work depth | `work` | -30px | -160 to 0px |
| Perspective | `persp` | 1300px | 500 to 3000px |
| Scroll curve | `curve` | 14° | 0 to 40° |
| Pointer parallax | `parallax` | 14% | 0 to 40% |
| Parallax ease | `ease` | 0.14 | 0.02 to 0.5 |


"PAPER thread toggle" and the other Experimental dials belong to the parked 3D thread; turn the
toggle on to get a PAPER / FLAT switch on a held thread. It is off by default.

## Where the values live

- Saved in the app's plugin storage (`hermes.plugin.zen-mode.tune`, only the differences).
  Presets are stored beside it.
- The CSS reads each dial as `--hz-<key>` on the Zen Mode root; hot JavaScript paths read `tune.<key>`.
- To add a dial, add a row to the `TUNE` table at the top of `desktop/plugin.js`; it then appears in
  the panel, in presets and in share codes automatically.
