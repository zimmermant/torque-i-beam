import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETENTS, components } from '../src/physics.js';
import { toPx, ORIGIN_PX, VB } from '../src/geometry.js';
import {
  SWING_DEG, ARC_R, GLYPH_HYP_PX, swingTarget, easeOut, shouldStartSwing,
  arrowPx, torqueArc, arcSegments, tripleGlyph, glyphCandidates, glyphClear, pickGlyph, segSegDist, GLYPH_CLEAR_GOOD,
  layoutScene
} from '../src/scene.js';
import { createState } from '../src/state.js';
import { deriveStep } from '../src/steps.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const triples = DETENTS.filter(d => d.kind === 'triple');

// Mutation: returning +SWING_DEG for 'ccw' swings the beam the wrong way. SVG's
// y axis points down, so a positive rotation is CLOCKWISE on screen.
test('swingTarget turns ccw torques counterclockwise on screen (negative in SVG)', () => {
  assert.strictEqual(swingTarget('ccw'), -SWING_DEG);
  assert.strictEqual(swingTarget('cw'), SWING_DEG);
  assert.strictEqual(swingTarget('zero'), 0);
  assert.strictEqual(swingTarget(null), 0);
  assert.strictEqual(SWING_DEG, 18);
});

test('easeOut runs 0 -> 1 monotonically and clamps outside [0, 1]', () => {
  assert.strictEqual(easeOut(0), 0);
  assert.strictEqual(easeOut(1), 1);
  assert.strictEqual(easeOut(-3), 0);
  assert.strictEqual(easeOut(9), 1);
  let prev = -1;
  for (let t = 0; t <= 1; t += 0.05) { const v = easeOut(t); assert.ok(v >= prev); prev = v; }
});

// Mutation: dropping the prevStep test restarts the swing on every render.
test('the swing starts only on ENTERING the reveal, not on every render within it', () => {
  assert.strictEqual(shouldStartSwing('predict', 'reveal'), true);
  assert.strictEqual(shouldStartSwing(null, 'reveal'), true);
  assert.strictEqual(shouldStartSwing('reveal', 'reveal'), false);
  assert.strictEqual(shouldStartSwing('draw', 'predict'), false);
  assert.strictEqual(shouldStartSwing('reveal', 'predict'), false);
});

test('arrowPx draws the force at 1.6 px per newton with +y up the screen', () => {
  const { from, to } = arrowPx({ x: 1, y: 0 }, components(50, 90));
  assert.deepStrictEqual(from, { x: 580, y: 280 });
  assert.ok(near(to.x, 580) && near(to.y, 200), `${to.x},${to.y}`);
  const e = arrowPx({ x: 0, y: 0 }, components(100, 0));
  assert.ok(near(e.to.x - e.from.x, 160) && near(e.to.y, e.from.y));
});

test('torqueArc: ccw runs 30 -> 150 with the arrowhead at 150, cw the reverse, zero has none', () => {
  const c = { x: 400, y: 300 };
  const ccw = torqueArc(c, 'ccw'), cw = torqueArc(c, 'cw');
  assert.strictEqual(torqueArc(c, 'zero'), null);
  assert.strictEqual(torqueArc(c, null), null);
  for (const a of [ccw, cw]) {
    assert.ok(near(Math.hypot(a.start.x - c.x, a.start.y - c.y), ARC_R));
    assert.ok(near(Math.hypot(a.end.x - c.x, a.end.y - c.y), ARC_R));
  }
  assert.ok(ccw.end.x < c.x && cw.end.x > c.x, 'ccw ends on the left, cw on the right');
  assert.ok(ccw.start.y < c.y && cw.start.y < c.y, 'both arcs sit above the pivot');
  assert.strictEqual(ccw.sweep, 0);
  assert.strictEqual(cw.sweep, 1);
});

// The glyph must be the textbook triangle: hypotenuse parallel to the arrow,
// axis-aligned legs in the 3:4 ratio, fixed 40 px hypotenuse.
// Mutation: using +dir.y instead of -dir.y in the slope flips every triangle
// vertically; swapping run and rise swaps the leg labels.
test('every 3-4-5 glyph has a 40px hypotenuse parallel to its arrow and legs in the right ratio', () => {
  for (const d of triples) for (const mag of [10, 50, 100]) {
    const F = components(mag, d.angle);
    const { from, to } = arrowPx({ x: 0.5, y: 0 }, F);
    const g = tripleGlyph(from, to, d);
    const hx = g.b.x - g.a.x, hy = g.b.y - g.a.y;
    const ax = to.x - from.x, ay = to.y - from.y;
    assert.ok(near(Math.hypot(hx, hy), GLYPH_HYP_PX, 1e-9), `hyp length at ${d.angle}`);
    assert.ok(Math.abs(hx * ay - hy * ax) < 1e-6, `not parallel at ${d.angle}, ${mag}`);
    assert.ok(hx * ax + hy * ay > 0, `points the wrong way at ${d.angle}`);
    // axis-aligned legs meeting at v
    const legA = { x: g.v.x - g.a.x, y: g.v.y - g.a.y };
    const legB = { x: g.b.x - g.v.x, y: g.b.y - g.v.y };
    const horiz = Math.abs(legA.y) < 1e-9 ? legA : legB;
    const vert = Math.abs(legA.y) < 1e-9 ? legB : legA;
    assert.ok(Math.abs(horiz.y) < 1e-9 && Math.abs(vert.x) < 1e-9, 'legs are not axis-aligned');
    assert.ok(near(Math.abs(horiz.x) / Math.abs(vert.y), d.run / d.rise, 1e-9),
      `leg ratio ${Math.abs(horiz.x)}:${Math.abs(vert.y)} at ${d.angle}`);
    // the labels carry the real integers
    assert.deepStrictEqual(g.labels.map(l => l.text), [String(d.run), String(d.rise), String(d.hyp)]);
  }
});

// Which leg does each digit label? A digit beside the wrong leg is a wrong picture: the 4 on the
// 3-unit leg. Measured from the triangle's own vertices, not from the code that places the labels.
// Mutation: swapping the leg midpoints (hm / vm) that position the run and rise digits; moving the
// hypotenuse label onto a leg.
test('each 3-4-5 digit sits beside its own leg: run by the horizontal leg, rise by the vertical, hyp by the hypotenuse', () => {
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  for (const d of triples) for (const mag of [10, 50, 100]) for (const flip of [false, true]) {
    const { from, to } = arrowPx({ x: 0.5, y: 0.25 }, components(mag, d.angle));
    const g = tripleGlyph(from, to, d, { flip });
    const edges = [[g.a, g.b], [g.b, g.v], [g.v, g.a]];
    const where = `${d.angle} deg, ${mag} N, flip ${flip}`;
    const hLegs = edges.filter(([p, q]) => near(p.y, q.y) && !near(p.x, q.x));
    const vLegs = edges.filter(([p, q]) => near(p.x, q.x) && !near(p.y, q.y));
    assert.strictEqual(hLegs.length, 1, `one horizontal leg at ${where}`);
    assert.strictEqual(vLegs.length, 1, `one vertical leg at ${where}`);
    const hm = mid(...hLegs[0]), vm = mid(...vLegs[0]), ym = mid(g.a, g.b);
    // the horizontal leg is the run, the vertical leg is the rise
    assert.ok(near(Math.abs(hLegs[0][0].x - hLegs[0][1].x) / Math.abs(vLegs[0][0].y - vLegs[0][1].y), d.run / d.rise), `leg ratio at ${where}`);
    const label = text => g.labels.find(l => l.text === text);
    const run = label(String(d.run)), rise = label(String(d.rise)), hyp = label(String(d.hyp));
    assert.ok(run && rise && hyp, `three labels at ${where}`);
    assert.ok(dist(run, hm) < dist(run, vm), `the ${d.run} is not beside the horizontal leg at ${where}`);
    assert.ok(dist(rise, vm) < dist(rise, hm), `the ${d.rise} is not beside the vertical leg at ${where}`);
    assert.ok(dist(hyp, ym) < dist(hyp, hm) && dist(hyp, ym) < dist(hyp, vm), `the ${d.hyp} is not beside the hypotenuse at ${where}`);
  }
});

test('the glyph sits on the side of the arrow away from the beam, and clear of the arrow', () => {
  for (const d of triples) {
    const F = components(50, d.angle);
    const { from, to } = arrowPx({ x: 0, y: 0 }, F);
    const g = tripleGlyph(from, to, d);
    const c = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    assert.ok(Math.abs(c.y - ORIGIN_PX.y) >= Math.abs(mid.y - ORIGIN_PX.y) - 1e-9,
      `glyph is nearer the beam than its arrow at ${d.angle}`);
    // the right-angle vertex is the far one: farther from the arrow's line than the hypotenuse
    const ux = (to.x - from.x), uy = (to.y - from.y), len = Math.hypot(ux, uy);
    const dist = p => Math.abs((p.x - from.x) * uy - (p.y - from.y) * ux) / len;
    assert.ok(dist(g.v) > dist(g.a) - 1e-9 && dist(g.v) > dist(g.b) - 1e-9, 'vertex not on the far side');
  }
});

test('arcSegments follows the torque arc: n segments, every point on the circle, ends matching the arc', () => {
  const c = { x: 400, y: 300 };
  for (const truth of ['ccw', 'cw']) {
    const segs = arcSegments(c, truth, 12), arc = torqueArc(c, truth);
    assert.strictEqual(segs.length, 12);
    assert.ok(near(segs[0].p.x, arc.start.x) && near(segs[0].p.y, arc.start.y));
    assert.ok(near(segs[11].q.x, arc.end.x) && near(segs[11].q.y, arc.end.y));
    for (const sg of segs) for (const p of [sg.p, sg.q]) assert.ok(near(Math.hypot(p.x - c.x, p.y - c.y), ARC_R, 1e-9));
    for (let i = 1; i < segs.length; i++) assert.deepStrictEqual(segs[i].p, segs[i - 1].q, 'a gap in the polyline');
  }
  assert.deepStrictEqual(arcSegments(c, 'zero'), []);
});

test('every glyph and its labels fit inside the viewBox for a force at any grid point', () => {
  for (const d of triples) for (const mag of [10, 100]) {
    const F = components(mag, d.angle);
    for (let x = -2.5; x <= 2.5; x += 0.25) for (const y of [-0.25, 0, 0.25]) {
      const { from, to } = arrowPx({ x, y }, F);
      const g = tripleGlyph(from, to, d);
      for (const p of [g.a, g.b, g.v, ...g.labels]) {
        assert.ok(p.x > 8 && p.x < VB.w - 8 && p.y > 14 && p.y < VB.h - 8,
          `outside the viewBox: ${p.x},${p.y} (${d.angle}, ${mag}, ${x},${y})`);
      }
    }
  }
});

// --- label placement ---------------------------------------------------------
import {
  CLEAR_GOOD, boxSegDist, boxGap, labelBox, pickLabel,
  forceLabelCandidates, leverLabelCandidates
} from '../src/scene.js';

const NOTHING = { segments: [], boxes: [], beam: null };

test('boxSegDist and boxGap measure what their names say', () => {
  const b = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.ok(near(boxSegDist(b, { x: 20, y: 5 }, { x: 30, y: 5 }), 10, 1e-6));
  assert.ok(near(boxSegDist(b, { x: -5, y: 5 }, { x: 15, y: 5 }), 0));       // passes through
  assert.ok(near(boxGap(b, { x0: 15, y0: 0, x1: 25, y1: 10 }), 5));
  assert.ok(boxGap(b, { x0: 5, y0: 5, x1: 15, y1: 15 }) < 0, 'overlap is negative');
  const lb = labelBox(100, 50, 14, 'start');
  assert.ok(lb.x0 === 100 && lb.x1 === 114 && lb.y0 === 36 && lb.y1 === 55);
  assert.ok(labelBox(100, 50, 14, 'end').x1 === 100);
  assert.ok(labelBox(100, 50, 14, 'middle').x0 === 93);
});

test('the first force-label candidate sits just beyond the tip, anchored away from the arrow', () => {
  const right = forceLabelCandidates({ x: 0, y: 0 }, { x: 100, y: 0 })[0];
  assert.strictEqual(right.anchor, 'start'); assert.ok(right.x > 100);
  const left = forceLabelCandidates({ x: 0, y: 0 }, { x: -100, y: 0 })[0];
  assert.strictEqual(left.anchor, 'end'); assert.ok(left.x < -100);
  const up = forceLabelCandidates({ x: 0, y: 0 }, { x: 0, y: -100 })[0];
  assert.strictEqual(up.anchor, 'middle'); assert.ok(up.y < -100 + 10);
  assert.strictEqual(forceLabelCandidates({ x: 0, y: 0 }, { x: 50, y: 0 }).length, 14);
});

test('the first lever-label candidate is above the middle of r, 36 px off the line', () => {
  const c = leverLabelCandidates({ x: 300, y: 280 }, { x: 500, y: 280 })[0];
  assert.ok(near(c.x, 400) && near(c.y, 280 - 36 + 5), `${c.x},${c.y}`);
  const v = leverLabelCandidates({ x: 100, y: 0 }, { x: 100, y: 100 })[0];
  assert.ok(v.x > 100, 'a vertical r gets its label to the right');
  const flipped = leverLabelCandidates({ x: 500, y: 280 }, { x: 300, y: 280 })[0];
  assert.ok(flipped.y < 280, 'direction of travel does not move the label below');
});

// Mutation: returning candidates[0] unconditionally puts the label on the arrow.
test('pickLabel keeps the first candidate while it is clear, and moves when it is not', () => {
  const from = { x: 300, y: 280 }, to = { x: 500, y: 280 };
  const cands = leverLabelCandidates(from, to);
  assert.strictEqual(pickLabel(cands, NOTHING).x, cands[0].x, 'nothing in the way: the default wins');
  const arrow = { p: { x: 400, y: 280 }, q: { x: 400, y: 120 } };          // up through r's middle
  const p = pickLabel(cands, { segments: [arrow], boxes: [], beam: null });
  assert.ok(boxSegDist(labelBox(p.x, p.y, p.w, p.anchor), arrow.p, arrow.q) >= CLEAR_GOOD,
    'the label is still touching the arrow');
  assert.ok(p.clear >= CLEAR_GOOD);
});

// Mutation: treating the beam as a hard obstacle (clear = min(clear, gap to beam))
// makes the label pick a spot touching a line rather than sit on the beam.
test('the beam is only a preference: a label touches no line to stay off it', () => {
  const beam = { x0: 230, y0: 255, x1: 730, y1: 305 };
  const cands = [
    { x: 400, y: 280, w: 12, anchor: 'middle' },        // on the beam, nothing near
    { x: 400, y: 200, w: 12, anchor: 'middle' }         // off the beam, but a line runs through it
  ];
  const line = { p: { x: 380, y: 195 }, q: { x: 420, y: 195 } };
  const p = pickLabel(cands, { segments: [line], boxes: [], beam });
  assert.strictEqual(p.y, 280, 'chose the line over the beam');
  // with no line in the way, the off-beam candidate is preferred
  const q = pickLabel(cands, { segments: [], boxes: [], beam });
  assert.strictEqual(q.y, 200);
});

test('when every candidate is blocked, the one with the most room wins', () => {
  const cands = [{ x: 100, y: 100, w: 12, anchor: 'middle' }, { x: 200, y: 100, w: 12, anchor: 'middle' }];
  const wall = { p: { x: 100, y: 0 }, q: { x: 100, y: 200 } };           // through the first
  const p = pickLabel(cands, { segments: [wall], boxes: [], beam: null });
  assert.strictEqual(p.x, 200);
  const blockedBoth = pickLabel(cands, { segments: [wall, { p: { x: 200, y: 0 }, q: { x: 200, y: 108 } }], boxes: [], beam: null });
  assert.ok(blockedBoth.clear <= CLEAR_GOOD);
});

test('labels stay off other labels', () => {
  const from = { x: 300, y: 280 }, to = { x: 500, y: 280 };
  const blocker = labelBox(400, 249, 20, 'middle');                          // on the default spot
  const p = pickLabel(leverLabelCandidates(from, to), { segments: [], boxes: [blocker], beam: null });
  assert.ok(boxGap(labelBox(p.x, p.y, p.w, p.anchor), blocker) >= CLEAR_GOOD);
});

// --- glyph placement ----------------------------------------------------------
test('segSegDist measures the gap between two segments', () => {
  assert.ok(near(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), 5, 1e-6));
  assert.ok(segSegDist({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }) < 1e-6, 'crossing segments');
  assert.ok(near(segSegDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }), 10, 1e-6));
});

test('every glyph candidate is still the textbook triangle, wherever it sits', () => {
  for (const d of triples) {
    const { from, to } = arrowPx({ x: 0.5, y: 0 }, components(50, d.angle));
    const cands = glyphCandidates(from, to, d);
    assert.strictEqual(cands.length, 6);
    for (const g of cands) {
      const hx = g.b.x - g.a.x, hy = g.b.y - g.a.y, ax = to.x - from.x, ay = to.y - from.y;
      assert.ok(near(Math.hypot(hx, hy), GLYPH_HYP_PX), `hyp length at ${d.angle}`);
      assert.ok(Math.abs(hx * ay - hy * ax) < 1e-6, `not parallel at ${d.angle}`);
      assert.deepStrictEqual(g.labels.map(l => l.text), [String(d.run), String(d.rise), String(d.hyp)]);
    }
    const sides = new Set(cands.map(g => Math.sign((g.v.x - from.x) * (to.y - from.y) - (g.v.y - from.y) * (to.x - from.x))));
    assert.strictEqual(sides.size, 2, 'the candidates must cover both sides of the arrow');
  }
});

// Mutation: returning candidates[0] regardless leaves the triangle on the lever
// arm, which is what the browser sweep found in 131 of 5040 states.
test('pickGlyph moves the triangle off a lever arm that runs through its default spot', () => {
  const d = triples[0];
  const { from, to } = arrowPx({ x: 0, y: 0 }, components(50, d.angle));
  const cands = glyphCandidates(from, to, d);
  const first = cands[0];
  const cx = (first.a.x + first.b.x + first.v.x) / 3, cy = (first.a.y + first.b.y + first.v.y) / 3;
  const lever = { p: { x: cx - 120, y: cy }, q: { x: cx + 120, y: cy } };      // straight through the first candidate
  assert.ok(glyphClear(first, { segments: [lever], boxes: [] }) < GLYPH_CLEAR_GOOD, 'the setup must block the default');
  const picked = pickGlyph(cands, { segments: [lever], boxes: [] });
  assert.ok(picked !== first);
  assert.ok(glyphClear(picked, { segments: [lever], boxes: [] }) >= GLYPH_CLEAR_GOOD);
});

test('pickGlyph keeps the default while nothing is in the way', () => {
  const d = triples[1];
  const { from, to } = arrowPx({ x: 0, y: 0 }, components(50, d.angle));
  const cands = glyphCandidates(from, to, d);
  assert.strictEqual(pickGlyph(cands, { segments: [], boxes: [] }), cands[0]);
});

// Mutation: returning candidates[0] (or the last candidate, or ignoring clearance) in the
// fallback. The three candidates here are blocked by DIFFERENT amounts (0, 5 and 3 px), all
// under GLYPH_CLEAR_GOOD, and the best one is neither first nor last.
// (An earlier version blocked everything with a dense grid; every candidate then scored
// exactly 0, so a pickGlyph that always returned the first candidate passed.)
test('when every candidate is blocked, pickGlyph takes the one with the most room', () => {
  const tri = x => ({
    a: { x, y: 0 }, b: { x: x + 10, y: 0 }, v: { x, y: 10 },
    labels: [{ text: '3', x, y: -500, anchor: 'middle' }, { text: '4', x, y: -520, anchor: 'middle' },
             { text: '5', x, y: -540, anchor: 'middle' }]
  });
  const cands = [tri(0), tri(100), tri(200)];
  const wall = x => ({ p: { x, y: -50 }, q: { x, y: 50 } });
  const everything = { segments: [wall(0), wall(95), wall(197)], boxes: [] };
  const clears = cands.map(g => glyphClear(g, everything));
  assert.ok(near(clears[0], 0, 1e-6) && near(clears[1], 5, 1e-6) && near(clears[2], 3, 1e-6),
    `the setup must give clearances 0, 5, 3 but gave ${clears}`);
  assert.ok(clears.every(c => c < GLYPH_CLEAR_GOOD), 'the setup must block every candidate');
  assert.strictEqual(pickGlyph(cands, everything), cands[1]);
});

// --- layoutScene --------------------------------------------------------------
function laidOut(fp, mag, angle, pv, tip, prediction) {
  const st = createState();
  if (fp) st.setForcePoint(fp);
  if (mag) st.setForce({ mag, angle });
  if (pv) st.setPivot(pv);
  if (tip) st.setRTip(tip);
  if (prediction) st.setPrediction(prediction);
  const s = st.getState();
  const step = deriveStep(s, null);
  return { s, step, lay: layoutScene(s, step) };
}

test('layoutScene places only what exists', () => {
  const none = laidOut().lay;
  assert.strictEqual(none.arrow, null); assert.strictEqual(none.glyph, null);
  assert.strictEqual(none.leverSeg, null); assert.strictEqual(none.forceLabel, null);
  assert.strictEqual(none.leverLabel, null); assert.deepStrictEqual(none.arcSegs, []);

  const forceOnly = laidOut({ x: 1, y: 0 }, 50, 90).lay;
  assert.ok(forceOnly.arrow && forceOnly.forceLabel);
  assert.strictEqual(forceOnly.glyph, null, 'a 90 degree force has no 3-4-5 triangle');
  assert.strictEqual(forceOnly.leverSeg, null);

  const triple = laidOut({ x: 1, y: 0 }, 50, triples[0].angle).lay;
  assert.ok(triple.glyph, 'a 3-4-5 force gets its triangle');
});

test('layoutScene: r = 0 has no lever arm to draw, and an invalid r runs to the raw tip', () => {
  const zero = laidOut({ x: 1, y: 0 }, 50, 90, { x: 1, y: 0 }).lay;
  assert.strictEqual(zero.leverSeg, null);
  assert.strictEqual(zero.leverLabel, null);
  const bad = laidOut({ x: 1, y: 0 }, 50, 90, { x: -1, y: 0 }, { x: 0.3, y: 0.1 }).lay;
  assert.ok(bad.leverSeg);
  assert.ok(near(bad.leverSeg.q.x, toPx({ x: 0.3, y: 0.1 }).x) && near(bad.leverSeg.q.y, toPx({ x: 0.3, y: 0.1 }).y));
  const good = laidOut({ x: 1, y: 0 }, 50, 90, { x: -1, y: 0 }, { x: 1, y: 0 }).lay;
  assert.ok(near(good.leverSeg.q.x, toPx({ x: 1, y: 0 }).x), 'a valid r ends exactly on the force point');
});

test('the torque arc is laid out in the reveal and only there', () => {
  const predicting = laidOut({ x: 1, y: 0 }, 50, 90, { x: -1, y: 0 }, { x: 1, y: 0 });
  assert.strictEqual(predicting.step, 'predict');
  assert.deepStrictEqual(predicting.lay.arcSegs, []);
  const revealed = laidOut({ x: 1, y: 0 }, 50, 90, { x: -1, y: 0 }, { x: 1, y: 0 }, 'ccw');
  assert.strictEqual(revealed.step, 'reveal');
  assert.strictEqual(revealed.lay.arcSegs.length, 12);
  const noTorque = laidOut({ x: 1, y: 0 }, 50, 0, { x: -1, y: 0 }, { x: 1, y: 0 }, 'zero');
  assert.deepStrictEqual(noTorque.lay.arcSegs, [], 'zero torque has no sense of rotation to draw');
});

// The same sweep the browser harness runs, without a browser: every force
// detent, five force points, a spread of pivots, with and without the reveal.
// Measured over 18,864 states: the closest any label comes to anything is 5.07 px
// (F) and 6.55 px (r), and to the torque arc 6.03 px; the bar below is 4 px.
// The label-to-digit gaps are checked HERE, from the glyph's own labels, and not
// through the obstacle list the layout uses -- a check that reads the layout's own
// list cannot notice when something is missing from it. (Learned the hard way:
// deleting the digits from that list left every in-list clearance fine, and the
// browser sweep then found 33 overlaps.)
// Mutations: dropping the arc from the labels' obstacles takes the arc distance to
// 0 in the reveal states; dropping the glyph's digits takes a label-to-digit gap
// below zero.
test('layoutScene: no label comes within 4 px of any line, glyph, label or the torque arc', () => {
  const MIN = 4;
  const fps = [{ x: -2.5, y: 0.25 }, { x: -0.75, y: -0.25 }, { x: 1.25, y: 0 }, { x: 2.5, y: 0.25 }, { x: 0, y: 0 }];
  const pivs = [];
  for (const x of [-2.5, -1.75, -1, -0.25, 0, 0.5, 1.25, 2, 2.5]) for (const y of [-0.25, 0, 0.25]) pivs.push({ x, y });
  let states = 0, reveals = 0;
  for (const fp of fps) for (const d of DETENTS) for (const mag of [10, 100]) for (const pv of pivs) {
    if (pv.x === fp.x && pv.y === fp.y) continue;
    for (const prediction of [null, 'cw']) {
      const { step, lay } = laidOut(fp, mag, d.angle, pv, fp, prediction);
      states++;
      const tag = `fp(${fp.x},${fp.y}) a=${d.angle.toFixed(1)} m=${mag} piv(${pv.x},${pv.y}) ${step}`;
      for (const [name, lab] of [['F', lay.forceLabel], ['r', lay.leverLabel]]) {
        assert.ok(lab, `${name} label missing @ ${tag}`);
        assert.ok(lab.clear >= MIN, `${name} label is only ${lab.clear.toFixed(1)}px clear @ ${tag}`);
        const box = labelBox(lab.x, lab.y, lab.w, lab.anchor);
        for (const sg of lay.arcSegs) {
          assert.ok(boxSegDist(box, sg.p, sg.q) >= MIN, `${name} label touches the torque arc @ ${tag}`);
        }
        if (lay.glyph) {
          for (const l of lay.glyph.labels) {
            assert.ok(boxGap(box, labelBox(l.x, l.y, 16, l.anchor)) >= 2,
              `${name} label overlaps the triangle's ${l.text} @ ${tag}`);
          }
        }
        // Everything below is recomputed HERE, from the shapes layoutScene returned, and not
        // read back from the obstacle lists the layout used. Mutations: dropping the force
        // arrow, the lever segment, the glyph's edges, or the F label's box from the labels'
        // obstacle lists each leave lab.clear fine and break one of these.
        const arrowSeg = { p: lay.arrow.from, q: lay.arrow.to };
        assert.ok(boxSegDist(box, arrowSeg.p, arrowSeg.q) >= MIN, `${name} label touches the force arrow @ ${tag}`);
        if (lay.leverSeg && name === 'F') {
          assert.ok(boxSegDist(box, lay.leverSeg.p, lay.leverSeg.q) >= MIN, `F label touches the lever arm @ ${tag}`);
        }
        if (lay.glyph) {
          const g = lay.glyph;
          for (const e of [[g.a, g.b], [g.b, g.v], [g.v, g.a]]) {
            assert.ok(boxSegDist(box, e[0], e[1]) >= MIN, `${name} label touches the triangle @ ${tag}`);
          }
        }
      }
      // the two labels must not overlap each other
      assert.ok(boxGap(labelBox(lay.forceLabel.x, lay.forceLabel.y, lay.forceLabel.w, lay.forceLabel.anchor),
                       labelBox(lay.leverLabel.x, lay.leverLabel.y, lay.leverLabel.w, lay.leverLabel.anchor)) >= 2,
        `the F and r labels overlap @ ${tag}`);
      if (step === 'reveal') reveals++;
    }
  }
  assert.ok(states > 10000 && reveals > 5000, `the sweep was too small: ${states} states, ${reveals} reveals`);
});
