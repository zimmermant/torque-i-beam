import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, derive, PREDICTIONS } from '../src/state.js';
import { components } from '../src/physics.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const T = Math.atan2(4, 3) * 180 / Math.PI;

// A state with force point (1, 0), a 50 N force at 53.13 deg, pivot at (-1, 0.25).
function built() {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setForce({ mag: 50, angle: T });
  st.setPivot({ x: -1, y: 0.25 });
  return st;
}

test('a fresh state holds nothing', () => {
  assert.deepStrictEqual(createState().getState(),
    { forcePoint: null, force: null, pivot: null, rTip: null, prediction: null });
});

test('inputs go through their snappers: grid, detent, whole newtons', () => {
  const st = createState();
  st.setForcePoint({ x: 1.13, y: 0.04 });
  assert.deepStrictEqual(st.getState().forcePoint, { x: 1.25, y: 0 });
  st.setForce({ mag: 37.4, angle: 44 });
  assert.deepStrictEqual(st.getState().force, { mag: 37, angle: 45 });
});

test('getState returns copies, so a caller cannot reach into the state', () => {
  const st = built();
  const a = st.getState();
  a.forcePoint.x = 99; a.force.mag = 99; a.pivot.y = 99;
  const b = st.getState();
  assert.strictEqual(b.forcePoint.x, 1);
  assert.strictEqual(b.force.mag, 50);
  assert.strictEqual(b.pivot.y, 0.25);
});

// Mutation: deleting the notify() in any one setter fails one of these.
test('every setter notifies exactly once on change and not at all on a no-op', () => {
  const st = createState();
  let n = 0;
  st.subscribe(() => { n++; });
  const steps = [
    () => st.setForcePoint({ x: 1, y: 0 }),
    () => st.setForce({ mag: 50, angle: T }),
    () => st.setPivot({ x: -1, y: 0 }),
    () => st.setRTip({ x: 1.05, y: 0 }),
    () => st.setPrediction('ccw'),
    () => st.back(),
    () => st.sameForceNewPivot(),
    () => st.reset()
  ];
  for (const [i, fn] of steps.entries()) {
    const before = n;
    fn();
    assert.strictEqual(n, before + 1, `step ${i} notified ${n - before} times`);
  }
  const before = n;
  st.reset(); st.back(); st.sameForceNewPivot();            // all no-ops on an empty state
  st.setForcePoint({ x: 1, y: 0 }); st.setForcePoint({ x: 1.05, y: 0.02 });   // 2nd lands on the same cell
  assert.strictEqual(n, before + 1, 'no-ops must not notify');
});

test('moving the force point restarts everything downstream', () => {
  const st = built();
  st.setRTip({ x: 1, y: 0 });
  st.setPrediction('ccw');
  st.setForcePoint({ x: 2, y: 0 });
  assert.deepStrictEqual(st.getState(),
    { forcePoint: { x: 2, y: 0 }, force: null, pivot: null, rTip: null, prediction: null });
});

test('a pivot cannot be set before a force exists', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setPivot({ x: 0, y: 0 });
  assert.strictEqual(st.getState().pivot, null);
});

test('moving the pivot clears r and the prediction', () => {
  const st = built();
  st.setRTip({ x: 1, y: 0 });
  st.setPrediction('cw');
  st.setPivot({ x: -2, y: 0 });
  const s = st.getState();
  assert.strictEqual(s.rTip, null);
  assert.strictEqual(s.prediction, null);
});

// Mutation: dropping the auto-set (nextTip = null always) leaves the student
// stuck with no way to draw a zero-length r.
test('a pivot on the force point\'s grid point sets r itself: r = 0 and valid', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setForce({ mag: 50, angle: 90 });
  st.setPivot({ x: 1.04, y: -0.03 });                         // snaps to (1, 0)
  const s = st.getState();
  assert.deepStrictEqual(s.rTip, { x: 1, y: 0 });
  const d = derive(s);
  assert.deepStrictEqual(d.r, { x: 0, y: 0 });
  assert.ok(d.rValid);
  assert.strictEqual(d.tau, 0);
  assert.strictEqual(d.truth, 'zero');
  assert.ok(!Object.is(d.r.x, -0) && !Object.is(d.r.y, -0));
});

// Mutation: R_SNAP_M * 2 (0.24) or R_SNAP_M / 2 (0.06) moves the boundary.
// The force point sits at the origin so the gap below is EXACTLY representable;
// at (1, 0) the sum 1 + 0.12 is not exactly 1.12 and the boundary blurs by 1e-16.
test('r snaps to the force point at exactly 0.12 m and not beyond', () => {
  const edge = (gap) => {
    const st = createState();
    st.setForcePoint({ x: 0, y: 0 });
    st.setForce({ mag: 50, angle: T });
    st.setPivot({ x: -1, y: 0.25 });
    st.setRTip({ x: gap, y: 0 });
    return derive(st.getState());
  };
  assert.ok(edge(0.12).rValid, 'at the radius it snaps');
  assert.ok(edge(0.119).rValid);
  assert.ok(!edge(0.121).rValid, 'just past the radius it does not');
  assert.ok(!edge(0.24).rValid);
  const inside = edge(0.1);
  assert.deepStrictEqual(inside.r, { x: 1, y: -0.25 }, 'a snapped r is forcePoint - pivot exactly');
  const outside = edge(0.3);
  assert.ok(near(outside.r.x, 1.3) && near(outside.r.y, -0.25), 'an unsnapped r is the raw tip');
});

test('an invalid r has no torque and locks the prediction', () => {
  const st = built();
  st.setRTip({ x: 1.5, y: 0 });
  const d = derive(st.getState());
  assert.ok(!d.rValid);
  assert.strictEqual(d.tau, null);
  assert.strictEqual(d.truth, null);
  st.setPrediction('ccw');
  assert.strictEqual(st.getState().prediction, null, 'a locked prediction must be ignored');
});

test('setPrediction accepts exactly the three answers and nothing else', () => {
  assert.deepStrictEqual(PREDICTIONS, ['cw', 'ccw', 'zero']);
  const st = built();
  st.setRTip({ x: 1, y: 0 });
  for (const bad of ['up', '', 'CW', 1, undefined]) {
    st.setPrediction(bad);
    assert.strictEqual(st.getState().prediction, null, `accepted ${String(bad)}`);
  }
  for (const p of PREDICTIONS) {
    st.setPrediction(p);
    assert.strictEqual(st.getState().prediction, p);
  }
});

// Mutation: swapping the verdict logic so 'cw' and 'ccw' trade places.
test('the verdict follows r x F: push up on the right of the pivot is counterclockwise', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setForce({ mag: 40, angle: 90 });
  st.setPivot({ x: 0, y: 0 });
  st.setRTip({ x: 1, y: 0 });
  st.setPrediction('ccw');
  const d = derive(st.getState());
  assert.strictEqual(d.tau, 40);
  assert.strictEqual(d.truth, 'ccw');
  assert.strictEqual(d.correct, true);
  st.setPrediction('cw');
  assert.strictEqual(derive(st.getState()).correct, false);
});

test('the same force with the pivot on the other side flips the sign', () => {
  const st = createState();
  st.setForcePoint({ x: -1, y: 0 });
  st.setForce({ mag: 40, angle: 90 });
  st.setPivot({ x: 0, y: 0 });
  st.setRTip({ x: -1, y: 0 });
  assert.strictEqual(derive(st.getState()).truth, 'cw');
});

test('a force along the beam through the pivot line gives zero torque', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setForce({ mag: 40, angle: 0 });
  st.setPivot({ x: -1, y: 0 });
  st.setRTip({ x: 1, y: 0 });
  const d = derive(st.getState());
  assert.strictEqual(d.truth, 'zero');
  assert.ok(!Object.is(d.tau, -0));
});

test('derive of an empty or partial state is all nulls and never throws', () => {
  const empty = derive(createState().getState());
  assert.deepStrictEqual(empty, { F: null, r: null, rValid: false, tau: null, truth: null, correct: null });
  const st = createState();
  st.setForcePoint({ x: 0, y: 0 });
  st.setForce({ mag: 20, angle: 0 });
  const d = derive(st.getState());
  assert.deepStrictEqual(d.F, components(20, 0));
  assert.strictEqual(d.r, null);
});

test('back removes the most recent input, one at a time', () => {
  const st = built();
  st.setRTip({ x: 1, y: 0 });
  st.setPrediction('cw');
  const seen = [];
  for (let i = 0; i < 6; i++) { seen.push(JSON.stringify(st.getState())); st.back(); }
  const s = st.getState();
  assert.deepStrictEqual(s, { forcePoint: null, force: null, pivot: null, rTip: null, prediction: null });
  const states = seen.map(x => JSON.parse(x));
  assert.ok(states[0].prediction && states[1].rTip && states[2].pivot && states[3].force && states[4].forcePoint);
  assert.ok(!states[1].prediction && !states[2].rTip && !states[3].pivot && !states[4].force);
});

test('back from an auto-r pivot removes the pivot too, so the student is not stranded', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 });
  st.setForce({ mag: 50, angle: 90 });
  st.setPivot({ x: 1, y: 0 });
  st.back();
  const s = st.getState();
  assert.strictEqual(s.pivot, null);
  assert.strictEqual(s.rTip, null);
  assert.ok(s.force, 'the force survives');
});

test('sameForceNewPivot keeps the force and clears the rest', () => {
  const st = built();
  st.setRTip({ x: 1, y: 0 });
  st.setPrediction('ccw');
  st.sameForceNewPivot();
  const s = st.getState();
  assert.ok(s.forcePoint && s.force);
  assert.strictEqual(s.pivot, null);
  assert.strictEqual(s.rTip, null);
  assert.strictEqual(s.prediction, null);
});

test('unsubscribe stops notifications', () => {
  const st = createState();
  let n = 0;
  const off = st.subscribe(() => { n++; });
  st.setForcePoint({ x: 0, y: 0 });
  off();
  st.setForcePoint({ x: 1, y: 0 });
  assert.strictEqual(n, 1);
});
