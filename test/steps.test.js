import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { STEPS, STEP_LABELS, deriveStep, instruction } from '../src/steps.js';

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
