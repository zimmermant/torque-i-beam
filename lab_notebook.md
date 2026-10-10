# Lab Notebook

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
