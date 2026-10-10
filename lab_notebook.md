# Lab Notebook

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
