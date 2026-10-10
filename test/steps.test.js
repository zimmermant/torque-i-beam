import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { STEPS, STEP_LABELS, deriveStep, instruction, controlsView } from '../src/steps.js';

const T = Math.atan2(4, 3) * 180 / Math.PI;

function at(fn) {
  const st = createState();
  fn(st);
  return st.getState();
}

// Mutation: dropping the drag override makes the step flip to 'pivot' the
// instant a force exists, mid-gesture.
test('deriveStep walks place -> aim -> pivot -> draw -> predict -> reveal', () => {
  const s0 = at(() => {});
  const s1 = at(st => st.setForcePoint({ x: 1, y: 0 }));
  const s2 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); });
  const s3 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); st.setPivot({ x: -1, y: 0 }); });
  const s4 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); });
  const s5 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('ccw'); });
  assert.deepStrictEqual(
    [s0, s1, s2, s3, s4, s5].map(s => deriveStep(s, null)),
    ['place', 'aim', 'pivot', 'draw', 'predict', 'reveal']);
  assert.deepStrictEqual(STEPS, ['place', 'aim', 'pivot', 'draw', 'predict', 'reveal']);
  for (const k of STEPS) assert.ok(STEP_LABELS[k], `no label for ${k}`);
});

test('while a drag is in progress the step does not move on', () => {
  const s2 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); });
  assert.strictEqual(deriveStep(s2, null), 'pivot');
  assert.strictEqual(deriveStep(s2, 'force'), 'aim');
  const s4 = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); });
  assert.strictEqual(deriveStep(s4, null), 'predict');
  assert.strictEqual(deriveStep(s4, 'r'), 'draw');
});

test('an r that misses the force point keeps the step at draw', () => {
  const s = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1.6, y: 0 }); });
  assert.strictEqual(deriveStep(s, null), 'draw');
  assert.match(instruction('draw', s), /r should end where the force acts/);
});

test('a pivot on the force point skips the draw step', () => {
  const s = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: 90 }); st.setPivot({ x: 1, y: 0 }); });
  assert.strictEqual(deriveStep(s, null), 'predict');
  assert.match(instruction('predict', s), /r = 0/);
});

test('the step is derived from the data: every back() lands on the step before', () => {
  const st = createState();
  st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 50, angle: T });
  st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('cw');
  const walk = [];
  for (let i = 0; i < 5; i++) { walk.push(deriveStep(st.getState(), null)); st.back(); }
  assert.deepStrictEqual(walk, ['reveal', 'predict', 'draw', 'pivot', 'aim']);
});

test('every step has an instruction, and the reveal quotes the real torque and sense', () => {
  const win = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 40, angle: 90 }); st.setPivot({ x: 0, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('ccw'); });
  assert.match(instruction('reveal', win), /^Correct\. The torque is 40 N·m, so the beam turns counterclockwise\.$/);
  const lose = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 40, angle: 90 }); st.setPivot({ x: 0, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('cw'); });
  assert.match(instruction('reveal', lose), /^Not quite\. The torque is 40 N·m, so the beam turns counterclockwise\.$/);
  const cwCase = at(st => { st.setForcePoint({ x: -1, y: 0 }); st.setForce({ mag: 40, angle: 90 }); st.setPivot({ x: 0, y: 0 }); st.setRTip({ x: -1, y: 0 }); st.setPrediction('cw'); });
  assert.match(instruction('reveal', cwCase), /−40 N·m, so the beam turns clockwise/);
  const zero = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 40, angle: 0 }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('zero'); });
  assert.match(instruction('reveal', zero), /^Correct\. The torque is 0 N·m, so the beam does not rotate\.$/);
  for (const k of ['place', 'aim', 'pivot']) assert.ok(instruction(k, win).length > 10);
  assert.strictEqual(instruction('nonsense', win), '');
});

// --- controlsView: the UI half of "which answers are live, which is right, what is hidden" ---
const KEYS = ['cw', 'ccw', 'zero'];
// One state per step. Force 40 N up at (1, 0), pivot (0, 0): a counterclockwise torque.
function stateFor(step, prediction = 'ccw') {
  return at(st => {
    if (step === 'place') return;
    st.setForcePoint({ x: 1, y: 0 });
    if (step === 'aim') return;
    st.setForce({ mag: 40, angle: 90 });
    if (step === 'pivot') return;
    st.setPivot({ x: 0, y: 0 });
    if (step === 'draw') return;
    st.setRTip({ x: 1, y: 0 });
    if (step === 'predict') return;
    st.setPrediction(prediction);
  });
}
const flags = a => ({ selected: a.selected, right: a.right, wrong: a.wrong });

// Mutation: answers enabled outside the predict step (e.g. `disabled: step === 'reveal'`).
test('controlsView: the answers are live in the predict step and in no other', () => {
  for (const step of STEPS) {
    const s = stateFor(step);
    assert.strictEqual(deriveStep(s, null), step, `the fixture really is in ${step}`);
    const v = controlsView(s, step);
    assert.deepStrictEqual(Object.keys(v.answers), KEYS);
    for (const k of KEYS) assert.strictEqual(v.answers[k].disabled, step !== 'predict', `${k} in ${step}`);
  }
});

// Mutation: right and wrong swapped.
test('controlsView: in the reveal only the picked answer is marked, right when it is right and wrong when it is wrong', () => {
  const right = controlsView(stateFor('reveal', 'ccw'), 'reveal').answers;
  assert.deepStrictEqual(flags(right.ccw), { selected: true, right: true, wrong: false });
  for (const k of ['cw', 'zero']) assert.deepStrictEqual(flags(right[k]), { selected: false, right: false, wrong: false });
  const wrong = controlsView(stateFor('reveal', 'cw'), 'reveal').answers;
  assert.deepStrictEqual(flags(wrong.cw), { selected: true, right: false, wrong: true });
  for (const k of ['ccw', 'zero']) assert.deepStrictEqual(flags(wrong[k]), { selected: false, right: false, wrong: false });
  const zero = controlsView(stateFor('reveal', 'zero'), 'reveal').answers;
  assert.deepStrictEqual(flags(zero.zero), { selected: true, right: false, wrong: true }, 'tau is not 0');
});

test('controlsView: before a prediction nothing is selected, right or wrong', () => {
  for (const step of ['place', 'aim', 'pivot', 'draw', 'predict']) {
    for (const k of KEYS) {
      assert.deepStrictEqual(flags(controlsView(stateFor(step), step).answers[k]), { selected: false, right: false, wrong: false }, `${k} in ${step}`);
    }
  }
});

test('controlsView: Back and New problem are disabled on the empty board and live once a force point exists', () => {
  const empty = controlsView(stateFor('place'), 'place');
  assert.strictEqual(empty.backDisabled, true);
  assert.strictEqual(empty.newProblemDisabled, true);
  for (const step of ['aim', 'pivot', 'draw', 'predict', 'reveal']) {
    const v = controlsView(stateFor(step), step);
    assert.strictEqual(v.backDisabled, false, step);
    assert.strictEqual(v.newProblemDisabled, false, step);
  }
});

// Mutation: sameForceHidden always false.
test('controlsView: "Same force, new pivot" is shown in the reveal only', () => {
  for (const step of STEPS) assert.strictEqual(controlsView(stateFor(step), step).sameForceHidden, step !== 'reveal', step);
});

// Mutation: Replay shown for a zero torque (it would do nothing: a zero torque has no swing).
test('controlsView: Replay is shown in the reveal for a torque, and never when there is no swing to replay', () => {
  for (const step of STEPS) {
    assert.strictEqual(controlsView(stateFor(step), step).replayHidden, step !== 'reveal', step);
  }
  // Force along the beam, r along the beam: tau = 0.
  const zero = at(st => { st.setForcePoint({ x: 1, y: 0 }); st.setForce({ mag: 40, angle: 0 }); st.setPivot({ x: -1, y: 0 }); st.setRTip({ x: 1, y: 0 }); st.setPrediction('zero'); });
  assert.strictEqual(deriveStep(zero, null), 'reveal');
  assert.strictEqual(controlsView(zero, 'reveal').replayHidden, true);
  assert.strictEqual(controlsView(zero, 'reveal').sameForceHidden, false, 'a new pivot is still on offer');
  assert.deepStrictEqual(flags(controlsView(zero, 'reveal').answers.zero), { selected: true, right: true, wrong: false });
});
