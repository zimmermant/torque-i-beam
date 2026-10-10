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
| `steps.js` | The current step, its instruction, and `controlsView` (which controls are enabled, marked or hidden), derived from the data. |
| `panel.js` | The side panel, as a pure string. |
| `scene.js` | A pure `layoutScene`, the SVG drawing, and the swing. |
| `interact.js` | Pointer handling. `decidePress` is pure. |
| `app.js` | The wiring: builds the state, scene, panel and pointer handling, and applies `controlsView` on every change. Verified in the browser. |

## Rules this codebase keeps

- **Derive, never store.** Only `forcePoint`, `force`, `pivot`, `rTip` and `prediction` are stored.
- **Round only at display**, through `fmt`. Never print `-0`.
- **Pointer capture is confirmed before a drag is latched.**
- **One shared scope after inlining**, so top-level names must be unique (the build fails on a duplicate).
- **Every test has a named mutation it catches**, and `tools/mutations.mjs` proves it. A check that reads the code's own obstacle list cannot notice what is missing from that list, so such checks measure independently.
- **Label placement is measured in a real browser**, not eyeballed.
