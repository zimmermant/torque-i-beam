# Lab Notebook

## 2026-10-10 — The build, executed: nine tasks by subagents, verified in a browser (not merged, not published)

### Summary

Executed `docs/superpowers/plans/2026-10-10-torque-i-beam.md` on branch `feat/initial-build` (31 commits ahead of `main` at the time of writing; 19 of them at the first verified build, `67b7d46`) with `ccpm-superpowers` / `superpowers:subagent-driven-development`: Tasks 1-9 each by a fresh **haiku** implementer and each reviewed by a **sonnet** reviewer (fix rounds resumed the implementer; every round ended with a scoped re-review); Task 10 (verification) by me as coordinator, which needs the Browser pane. Result:

- **FINAL: 148 tests**, all passing. (At the first verified build it was 136: the plan said 125 and review rounds added 11, state +7, panel +1, interact +3; the post-review fix wave added 12 more. See 'Fix wave' below.)
- **FINAL: 124 mutation rows** in `tools/mutations.mjs`; `node tools/mutations.mjs --coverage --strict` reports **148 of 148 tests are made to fail by at least one mutation**, exit 0. (At the first verified build: 108 rows, 136 of 136.) A full run takes about 10 minutes and now works on a temporary copy of the repo.
- `dist/torque_i_beam.html`, **FINAL 52,258 bytes on disk** (build.js reports 52,208, which counts UTF-16 code units), byte-reproducible. (At the first verified build: 50,096 on disk; the plan said 49,542 before review rounds added code.)
- Browser sweeps at the verified scene scale (646 px wide, viewport 1024x768): **1,080** force states, **5,040** states with a lever arm (all 5,040 valid, 0 missed), **864** revealed states: **zero** label/hit violations; the rotated beam stays at least 101.7 px inside the panel. **Re-run on the final build after the fix wave: zero again** (same three sweeps, same scale).
- Real-mouse checks (below): all pass.
- **What the tests do not reach:** `src/app.js` wiring and `scene.js`'s `draw()` and swing animation are verified only in the browser (everything else has unit tests), except `renderAll`'s control state, which is now covered through the pure `controlsView`.
- The full SDD ledger, with every ruling and deferred minor, is committed at `docs/superpowers/sdd-ledger-torque-i-beam.md`; the mutation audit report and the raw coverage run are `docs/superpowers/mutation-audit-report.md` and `docs/superpowers/mutation-coverage-run.txt`.
- **Not merged and not published.** Both need the user's explicit go-ahead.

### Decisions made and why

- **Cheapest tier for implementers, standard for reviewers, strongest for the whole-branch review.** The plan supplied complete verified code, so implementing was transcription plus test runs. The tier held: a haiku implementer transcribed an 800-line pair of files exactly.
- **Byte-compare every task to the verified reference, and hand implementers SHA-256s.** Three haiku reports misstated things (line counts; a mutation run that was not real; a "syntax error" used to justify changing a typographic apostrophe to ASCII). After that I compared every task's files to the reference before review, and from Task 7 on gave each implementer the expected hashes to self-check. No transcription drift after that.
- **Reviews are not rubber stamps: 7 of 9 tasks needed a fix round**, almost all in the *tests I had written into the plan*: a negative-zero test that could never fail (T2); a state machine with untested no-op guards and a stale-prediction hole (T5, fixed in code: `setForce` now clears the prediction and, on un-aim, the pivot and r); a panel test that never called the panel (T7); a "blocked" glyph test where every candidate scored 0, and a layout sweep that read the layout's own obstacle list (T8); a second finger hijacking a drag (T9, one-line guard). Where I fixed a test I proved the fix first in a scratch copy and delivered it as a finished file with a SHA-256.
- **Ruled, not fixed:** a throwing `state` subscriber starving later ones (T5): the app has one subscriber and swallowing a render error would hide bugs. **Cost if wrong:** a second subscriber added later could be starved.
- **"Every test has a named mutation it catches" had to be proved, not asserted.** My claim "all 27 mutations caught" was true but only 61 of 136 tests were failed by any of them. A sonnet worker added 78 rows (tool code only); I hardened the runner first so rows cannot game coverage (must parse, must not break test loading, must not be a no-op, at most 12 tests failing per row).

- **Fix wave after the whole-branch review** (commits `239d29e`..`787226b` and a final rows/coverage commit): the mutation tool now works on a temporary copy; the r tip is clamped to the viewBox; `pointermove` is guarded against Back / New problem mid-drag; `controlsView` makes the control state testable and hides Replay for a zero torque; digit-to-leg, exact instruction texts and the control state are now tested; overlays no longer steal hover. Final numbers: **148 tests**, **124 mutation rows**, `--coverage --strict` reports **148 of 148 tests made to fail by at least one mutation**, exit 0 (`docs/superpowers/mutation-coverage-run.txt`); `dist` is rebuilt (52,258 bytes on disk). The first full run found two new `controlsView` tests with no mutation, so rows were added for them.

### Problems encountered and how they were resolved

- **False alarm from a collapsed Browser pane.** The first sweep reported 24 + 75 label "violations", all one kind (a glyph digit 1.7-2.7 px from its own triangle). The pane was hidden (`innerWidth` 0) so the scene rendered 208 px wide; `getBBox` text metrics differ at that scale. At the verified 646 px the same build showed zero (worst own-glyph gap 3.1 px, exactly as before). Fixed the tool, not the threshold: `H.install()` now refuses to run under 600 px.
- **Animation cannot be checked in a hidden pane**: `requestAnimationFrame` never fires there, and the harness forces reduced motion, which skips the animation entirely, so my first "swing" check proved nothing. Re-ran with `requestAnimationFrame` shimmed by a 16 ms timer (the app's own loop runs unchanged): the swing eases 0 -> -18 degrees (counterclockwise) and settles exactly; Replay restarts it; New problem mid-swing resets the pose and nothing moves afterwards.
- **Stale screenshots look like bugs.** A screenshot taken straight after a drag showed the previous step ("Aim force") while the DOM already said "pivot". Read state from the DOM after a short wait; do not trust a screenshot taken in the same breath as the input. This is also the likeliest explanation of the one-off half-way r drag seen during prototyping: not reproduced in 8 fresh-load runs (5 earlier, 3 now), event logs always down / two moves / up.
- **The mutation runner's own parse guard rejected the HTML template rows** (Node cannot `--check` an `.html`). Fixed: the guard applies to JavaScript only.

### Real-mouse checks (Task 10, step 5)

a) press-drag-up: theta_F 90 degrees, F = 0 i + 48 j N, step advances to pivot. b) 3-4-5 drag: 53.13 degrees, badge, black triangle 3-4-5 beside the arrow, 71 N, F = 42.6 i + 56.8 j. c) r stopped short: dashed amber, amber lever card, the exact instruction, answer buttons disabled. d) tip dragged onto the force point: r = -1.75 i m, "ends at the force point", buttons enabled. e) Back undid one input (r, not the pivot). f) pivot on the force point: straight to predict, "r = 0 ...", theta_r a dash. g) force along the beam: exactly 0 N.m, no swing, no arc, `0 k-hat`, never `-0`. h) wrong prediction: "Not quite. The torque is -99.4 N.m ... clockwise", chosen button red, beam swings clockwise with a ghost outline, worked arithmetic (-1.75)(56.8) = -99.4. i) swing lifecycle (above). j) beam hover turns the web blue and darkens the flanges; disabled buttons visibly greyed. Narrow screen (375 px): one column, panel below the scene, no horizontal overflow.

### Open questions / next steps

- **Whole-branch review (strongest model) and `finishing-a-development-branch`** come next; merging and publishing need the user's go-ahead.
- Deferred minors are in the ledger. The ones worth a decision: (1) `pointermove` throws a TypeError if Back / New problem fires mid-drag (latent; guard with `if (!s.forcePoint)` / `if (!s.pivot)`); (2) `lostpointercapture` and `endDrag` idempotence are untested; (3) `panelHtml(s,'reveal')` throws on a state without a valid r and a prediction (safe only because callers derive the step from the same snapshot); (4) the scene is pointer-only (spec non-goal) and the handle hit circles are about 8 px radius on a 375 px phone; (5) the instruction text is rewritten every render inside an `aria-live` region; (6) focus is lost when Replay / Same force are hidden or Back is disabled while focused.
- Tests the mutation audit found **weaker than their names** (all still caught by some mutation): the physics-level "printed arithmetic closes to within 0.03" test never calls the panel (the panel-level twin is the real check; its comment overclaims that it catches *unrounded* operands, which it does not); the glyph "40 px" test compares against the imported constant; the `rtip` handle press in an integration test would still pass if treated as a new pivot; the `fmt` null/undefined guards are redundant (equivalent mutants). `fmt(2.675) === '2.67'` is claimed to pin `toFixed` over `Math.round` but does not.
- The own-glyph label gap threshold (3 px) sits 0.1 px under the measured worst (3.1 px): that is a narrow margin, not a comfortable one.
- Not decided: whether the force arrow should rotate with the beam on reveal (it stays put, with a ghost outline of the beam).

## 2026-10-10 — Implementation plan written from a verified prototype

### Summary

Wrote `docs/superpowers/plans/2026-10-10-torque-i-beam.md` (ten tasks, 4,335 lines) for the approved spec. The plan was generated from a **working prototype** built and verified in a scratch directory first, so every code block in it has already been run: 125 unit tests, 27 mutations (all caught), a byte-reproducible 49,542-byte build, and three browser sweeps over 6,984 states with zero label or hit violations. The plan was then **replayed literally** into a fresh directory (each file from its code block, in order; each `MODULES` edit applied) and checked: every "watch it fail" step fails, every checkpoint's pass count matches the plan's Expected line (10, 25, 29, 41, 60, 66, 78, 103, 125), the final tree is byte-identical to the prototype, and all 27 mutations are caught on the replayed copy. No product code exists in this repo yet; the plan awaits Todd's review and go-ahead to execute.

### Decisions made and why

- **Prototype first, plan second.** Most defects in the two earlier apps' builds originated in plan text I wrote, not in implementer work (wrong tolerances, vacuous mutation proofs, labels placed on lines). Writing the code first and pasting verified code into the plan removes that whole class. The tasks are therefore transcription plus test runs, which is why the cheapest model tier is enough for implementers.
- **Seven rulings against the spec** (R1-R7 in the plan): drop `rSnapped` (identical to `rValid`); one "New problem" button instead of Reset + New problem; no SVG subscript machinery (no SVG label has a subscript); a 5 px margin on the beam's hit region; labels chosen from candidates against the real obstacles; Back from an auto-r pivot removes both; a reusable browser harness and mutation checker.
- **Task 10 is run by the coordinator, not dispatched**, because it needs the Browser pane and judgement about what it shows.
- **Execution method:** the user asked for `ccpm-superpowers`, i.e. a single coordinator dispatching implementers and reviewers via `subagent-driven-development`; tiers cheap / standard / strong as in the plan's execution notes. CCPM is tracked locally in `.claude/epics/torque-i-beam/handoff.yaml` (git-ignored); nothing is synced to GitHub.

### Problems encountered and how they were resolved

- **Presses on the beam's outer edge row were lost** (the grid's y = +/-0.25 rows and x = +/-2.5 ends lie exactly on the hit boundary; 336 of 444 states failed to set a force in a first check). Fixed with a 5 px hit margin; pinned by a test.
- **Fixed label offsets collided in dense states** (131 overlaps in 5,040 states, then 42 in 864 revealed states): a force pointing back along r, a short r beside the 3-4-5 triangle, labels near the torque arc. Fixed by choosing each label and the triangle from candidates, first clear and off the beam, with the beam only a preference.
- **A mutation was uncaught because the logic lived inside DOM-bound `draw()`.** Extracted a pure `layoutScene` so the placement can be swept in Node.
- **I deleted the glyph's digit boxes as "unneeded" because no test failed, and the browser sweep then found 33 overlaps.** The Node sweep could not see them: it measured clearance only against the obstacle list the code itself used. Restored, and the test now measures label-to-digit gaps independently of that list. Lesson: *a check that reads the code's own list cannot notice what is missing from it; "no test failed" can mean "the test is blind".*
- A boundary test failed at `1 + 0.12` (not exactly `1.12` in floating point); moved the force point to the origin so the gap is exactly representable.
- One real-mouse r drag, the very first interaction after a fresh page load, stopped halfway (the tool sends only two intermediate moves). Five identical repeats, with an event log, were all complete. Not reproduced; recorded as a probable tool artifact and made an explicit check in Task 10, step 7.

### Open questions / next steps

- Todd to review the plan and confirm execution (subagent-driven via ccpm-superpowers, recommended: the plan is ten sequential tasks that all edit one `MODULES` list, and a shipped mistake would be a wrong torque sign shown to a student).
- Then: create branch `feat/initial-build`, execute Tasks 1-9, run Task 10 myself, whole-branch review on the strongest model, and stop before merging or publishing (both need Todd's explicit go-ahead).
- Out of scope and unchanged: keyboard operation of the drag steps; whether the force arrow should rotate with the beam on reveal (it stays put, with a ghost of the beam).

## 2026-10-10 — Brainstorm and design spec: torque on an I-beam

### Summary

New app, third sibling of `ball_on_ramp_statics` and `crate_over_pulley_statics`: a guided torque demonstration on an I-beam seen from the side. A student places a force, aims it (snapped angle, whole-newton magnitude), picks a pivot, draws the lever-arm vector r, predicts clockwise / counterclockwise / neither, then sees the verdict, the worked cross product and the beam rotating. Brainstormed with Todd and written up as
`docs/superpowers/specs/2026-10-10-torque-i-beam-design.md`. No code exists yet; the spec is awaiting Todd's review, after which the plan is written
(`superpowers:writing-plans`) and executed via `ccpm-superpowers` (CCPM local, no GitHub sync).

### Decisions made and why

- **Classified architectural** (new project, no existing flow), so: questions, approaches, sectioned design, written spec, then plan.
- **r is freely drawn, snaps to the force point when close, flagged invalid otherwise** (Todd chose free drawing; the snap-when-close rule is the recommended handling of the mismatch it creates). Free drawing alone would let a student compute a torque for a geometry the beam does not have.
- **Reveal = verdict + worked cross product + beam rotates.** Todd's wording was "the effects of a single torque"; this shows the math and the physical effect.
- **Beam drawn as a long horizontal side view**, not the cross-section, so lever arms have room to be read.
- **Snap angles:** 0/90/180/270, 30, 45, 60 and 3-4-5 angles (36.87°, 53.13°), mirrored into all quadrants. Todd's "20" was a typo for 30 (asked and confirmed).
- **Zero torque needs a third answer.** A force along the beam's axis through the pivot line gives τ = 0, so the prediction offers "Neither (τ = 0)" as well as CW and CCW.
- **A tolerance, not exact components, protects the verdict.** Swept all 447,720 reachable states (24 detents x 91 magnitudes x 41 x 5 lever-arm components): every real zero is below 2.2e-14 N·m, the smallest real torque is 0.335 N·m, so `TAU_EPS = 1e-9` cannot misclassify. Exact components at 0/90/180/270 and (m·3/5, m·4/5) at the 3-4-5 detents are kept for tidy displayed numbers only. In conversation I first described exactness as part of the safeguard; the sweep showed the tolerance alone is sufficient.
- **Single-gesture flow** (press, drag, release does place + aim in one go; a click then a separate drag also works) to minimise clicks, per Todd's standing preference.
- **Inherited rules** from the earlier apps: derive-never-store, round only at display, capture-before-latch pointer handling (a bug found in both siblings), real subscripts via `<tspan>`/`<sub>`, mutation-proof tests, measured label placement.

### Problems encountered and how they were resolved

- Spec self-review found that "pivot within the snap radius of the force point" is meaningless once both snap to a 0.25 m grid (different grid points are at least 0.25 m apart, over twice the 0.12 m radius). Reworded to "same grid point" and specified that setting such a pivot also sets `rTip`.

### Open questions / next steps

- Todd to review the spec, in particular §11 (nine assumptions of mine: grid snapping, always-snap with no free angles, 10-100 N whole newtons, 5 m x 0.5 m beam, the Neither button, the 3-4-5 triangle glyph, the +/-18 degree swing with Replay, the k-hat form of torque, whole-rectangle hit-testing).
- After approval: write the implementation plan, set up the CCPM epic (`.claude/epics/torque-i-beam/`, handoff.yaml), execute with tiered subagents, whole-branch review, then publish only on Todd's go-ahead.
