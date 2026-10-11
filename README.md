# Torque on an I-beam

A teaching simulation. A student places a force on an I-beam, chooses a pivot, draws the lever arm **r**, and predicts whether the beam will turn clockwise, counterclockwise, or not at all. The app then shows the verdict, the worked cross product `τ = r_x F_y − r_y F_x`, and the beam turning about the pivot.

Open `dist/torque_i_beam.html` in any browser. It is one self-contained file: no server, no network.

## The flow

1. **Place and aim the force.** Press on the beam, drag, release. The direction snaps to one of 24 common angles (0, 30, 45, 60, 90 and their mirrors, plus the 3-4-5 angles 36.87° and 53.13°); the size snaps to whole newtons, 10–100 N. A small black triangle appears when the force sits on a 3-4-5 angle.
2. **Choose the pivot.** Press on the beam. (Pressing and dragging in one go also starts the lever arm.)
3. **Draw r.** Drag from the pivot to where the force acts. Within 12 cm of the force point it snaps on; short of that it is drawn dashed amber and the prediction stays locked.
4. **Predict:** clockwise (−), counterclockwise (+), or neither (τ = 0).
5. **Result.** Replay the swing, keep the force and try a new pivot, or start a new problem. **Back** undoes the last input at any time.

Conventions: metres, newtons, y up, angles counterclockwise from +x, counterclockwise torque positive. The beam's own weight and gravity are ignored.

## Presetting a problem from the link

Add optional query parameters to the page's address to start a problem part-way set up. Any combination works; anything you leave out behaves exactly as usual.

| Parameter | Meaning | Accepted text |
|---|---|---|
| `fp` | force location, metres | `x` or `x,y` (y omitted means 0) |
| `mag` | force magnitude, newtons | a number |
| `angle` | force direction, degrees counterclockwise from +x | a number |
| `pivot` | pivot location, metres | `x` or `x,y` (y omitted means 0) |

Numbers are plain decimals (`-1`, `+2.5`, `.5`; no exponents, no hex). The page prints negative numbers with a real minus sign (−), and a number copied from the screen with that sign is accepted too. A value that does not parse is ignored, as if it were absent (the "From the link" line echoes at most its first 40 characters). If a parameter is repeated, the first one counts. Unknown parameters are ignored.

Values are **snapped exactly as a click or drag would snap them**: locations to the 0.25 m grid and onto the beam, the magnitude to whole newtons between 10 and 100, the angle to the nearest of the 24 directions. A "From the link" line under the instruction lists what was set, what snapping changed (for example `mag 500 → 100`) and what was ignored.

- **`fp`** places the force point when the page loads.
- **`mag` and `angle` are locked** for that problem. The student's aim drag chooses only what is not locked (distance sets the size, direction sets the angle; a drag under 12 px still means "not aimed"). If both are locked, the force is complete as soon as it has a point: at load when `fp` is given, otherwise one press on the beam (no drag) places the point and applies the force. After **Back**, pressing the force point applies it again.
- **`pivot`** is applied once, when the student reaches the pivot step (so it waits for a complete force, and is never applied in the middle of a drag). It never presets r: the student still draws it. A pivot on the force point goes straight to the prediction, as it does when clicked.
- Presets apply **once**. Back, "Same force, new pivot" and moving the force point never re-apply them. **New problem** clears the locks and the "From the link" line and gives a fully ordinary blank problem; reloading the link restores the setup.

Examples (the query string is kept for a `file://` page as well as a served one):

```
torque_i_beam.html?fp=1.5,0&mag=50&angle=90&pivot=-1,0     # a finished setup: just draw r and predict
torque_i_beam.html?mag=50                                  # any force point, any direction, always 50 N
torque_i_beam.html?angle=45&pivot=0                        # student sets the point and the size
```

## Develop

```bash
export NODE=/opt/homebrew/Cellar/node@22/22.23.2_1/bin/node   # Homebrew's `node` is broken on this machine
$NODE --test test/*.test.js        # always a glob: `node --test test/` misreports here
$NODE build.js                     # writes dist/torque_i_beam.html
$NODE tools/mutations.mjs          # breaks one thing at a time; the suite must fail each time
                                   # (runs on a temporary copy, never your files; takes about 10 minutes)
```

To check the real page, serve the repo root (`python3 -m http.server 8742 --bind 127.0.0.1`), open `http://127.0.0.1:8742/dist/torque_i_beam.html`, and load `tools/browser-harness.js` (see its header). It drives the real pointer handlers and measures real label boxes against the arrows, the triangle, the torque arc, the beam and the viewBox.

## Layout

| Module | Job |
|---|---|
| `physics.js` | The 24 detents, snapping, exact components, `torqueZ`, `classify`. |
| `format.js` | The only place a number is rounded for display. |
| `svg.js` | `el` / `clear` / `text` / `clientToSvg`, and the colour palette. |
| `geometry.js` | The beam, the 0.25 m grid, the world <-> screen conversion (`toPx` / `toWorld`, where y is flipped), hit-testing. A few drawing helpers in `scene.js` (`arrowPx`, `tripleGlyph`, `torqueArc`) also work in screen coordinates and flip y themselves. |
| `state.js` | Five stored inputs; everything else is `derive()`d. |
| `presets.js` | URL presets: `parsePresets` (parse and snap `fp`, `mag`, `angle`, `pivot`), `describePresets`, and `createPresets` (the locks and the pending pivot, held outside the state). |
| `steps.js` | The current step, its instruction (worded for locked values), and `controlsView` (which controls are enabled, marked or hidden), derived from the data. |
| `panel.js` | The side panel, as a pure string. |
| `scene.js` | A pure `layoutScene`, the SVG drawing, and the swing. |
| `interact.js` | Pointer handling. `decidePress` is pure. Two optional hooks (`lockAim`, `completeLocked`) let a link fix the force's size and direction. |
| `app.js` | The wiring: builds the state, scene, panel and pointer handling, and applies `controlsView` on every change. Verified in the browser. |

## Rules this codebase keeps

- **Derive, never store.** Only `forcePoint`, `force`, `pivot`, `rTip` and `prediction` are stored.
- **Round only at display**, through `fmt`. Never print `-0`.
- **Pointer capture is confirmed before a drag is latched.**
- **One shared scope after inlining**, so top-level names must be unique (the build fails on a duplicate).
- **Every test has a named mutation it catches**, and `tools/mutations.mjs` proves it. A check that reads the code's own obstacle list cannot notice what is missing from that list, so such checks measure independently.
- **Label placement is measured in a real browser**, not eyeballed.
