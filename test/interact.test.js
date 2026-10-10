import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { deriveStep } from '../src/steps.js';
import { toPx } from '../src/geometry.js';
import { decidePress, tryCapture, createInteraction } from '../src/interact.js';

// --- decidePress: every row of the table -----------------------------------
const ON = { x: 0, y: 0 };
const OFF = { x: 0, y: 2 };

test('decidePress: the whole table', () => {
  const rows = [
    // step      handle    world  expected
    ['place',   null,     ON,    'place'],
    ['place',   null,     OFF,   'none'],
    ['aim',     'force',  ON,    'aim'],
    ['aim',     null,     ON,    'place'],      // pressing the beam elsewhere moves the force point
    ['aim',     null,     OFF,   'none'],
    ['pivot',   null,     ON,    'pivot'],
    ['pivot',   'force',  ON,    'pivot'],      // the force handle sits ON the beam; it is just a beam press here
    ['pivot',   null,     OFF,   'none'],
    ['draw',    'pivot',  ON,    'draw'],
    ['draw',    'rtip',   ON,    'draw'],
    ['draw',    null,     ON,    'pivot'],      // pressing the beam elsewhere moves the pivot
    ['draw',    'pivot',  OFF,   'draw'],       // a handle press does not need the beam under it
    ['predict', null,     ON,    'none'],
    ['predict', 'pivot',  ON,    'none'],
    ['reveal',  null,     ON,    'none'],
    ['reveal',  'force',  ON,    'none']
  ];
  for (const [step, handle, world, want] of rows) {
    assert.strictEqual(decidePress({ step, handle, world }), want, `${step} / ${handle} / ${JSON.stringify(world)}`);
  }
});

// Mutation: letting 'predict' fall through to 'pivot' lets a stray click on the
// beam silently destroy the student's r.
test('after r is drawn, a press on the beam can change nothing until Back or New problem', () => {
  for (const step of ['predict', 'reveal']) {
    assert.strictEqual(decidePress({ step, handle: null, world: ON }), 'none');
  }
});

// --- tryCapture -------------------------------------------------------------
test('tryCapture reports success, and failure instead of throwing', () => {
  const ok = { setPointerCapture() {} };
  const bad = { setPointerCapture() { throw new Error('NotFoundError'); } };
  assert.strictEqual(tryCapture(ok, 1), true);
  assert.strictEqual(tryCapture(bad, 1), false);
});

// --- createInteraction, driven through a fake svg ----------------------------
// The fake maps client coordinates straight to viewBox units (identity), so an
// event at toPx(world) lands exactly on that world point.
function fakeSvg({ captureThrows = false } = {}) {
  const handlers = {};
  const svg = {
    held: new Set(),
    captureCalls: 0,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }; },
    getScreenCTM() { return { inverse() { return {}; } }; },
    setPointerCapture(id) { svg.captureCalls++; if (captureThrows) throw new Error('NotFoundError'); svg.held.add(id); },
    releasePointerCapture(id) { svg.held.delete(id); },
    hasPointerCapture(id) { return svg.held.has(id); }
  };
  const fire = (type, world, extra = {}) => {
    const px = toPx(world);
    const e = { type, clientX: px.x, clientY: px.y, pointerId: 1, button: 0,
                target: { closest: () => (extra.handle ? { getAttribute: () => extra.handle } : null) },
                preventDefault() {}, ...extra };
    for (const fn of handlers[type] || []) fn(e);
  };
  return { svg, fire };
}

function rig(opts) {
  const state = createState();
  const { svg, fire } = fakeSvg(opts);
  const drags = [];
  const it = createInteraction(svg, state, { onDrag: k => drags.push(k) });
  return { state, svg, fire, drags, it };
}

test('one press-drag-release on the beam places a force point and aims the force', () => {
  const { state, svg, fire, drags, it } = rig();
  fire('pointerdown', { x: 1, y: 0 });
  assert.strictEqual(it.getDrag(), 'force');
  assert.deepStrictEqual(state.getState().forcePoint, { x: 1, y: 0 });
  assert.ok(svg.held.has(1), 'capture was taken');
  fire('pointermove', { x: 1, y: 0.4 });
  fire('pointermove', { x: 1, y: 0.8 });                       // 80 px up = 50 N at 90 deg
  assert.deepStrictEqual(state.getState().force, { mag: 50, angle: 90 });
  fire('pointerup', { x: 1, y: 0.8 });
  assert.strictEqual(it.getDrag(), null);
  assert.ok(!svg.held.has(1), 'capture was released');
  assert.deepStrictEqual(drags, ['force', null]);
  assert.strictEqual(deriveStep(state.getState(), null), 'pivot');
});

// Mutation: latching `drag` before tryCapture -- a throwing capture would then
// leave a live drag the pointerup can never end.
test('if pointer capture fails, NO drag starts and nothing changes', () => {
  const { state, fire, drags, it } = rig({ captureThrows: true });
  fire('pointerdown', { x: 1, y: 0 });
  assert.strictEqual(it.getDrag(), null);
  assert.deepStrictEqual(drags, []);
  assert.deepStrictEqual(state.getState().forcePoint, null);
  fire('pointermove', { x: 1, y: 0.8 });                       // a bare move must do nothing
  assert.deepStrictEqual(state.getState().force, null);
});

test('a click without a drag leaves the point placed and the force unaimed', () => {
  const { state, fire, it } = rig();
  fire('pointerdown', { x: 1, y: 0 });
  fire('pointerup', { x: 1, y: 0 });
  assert.deepStrictEqual(state.getState().forcePoint, { x: 1, y: 0 });
  assert.strictEqual(state.getState().force, null);
  assert.strictEqual(deriveStep(state.getState(), null), 'aim');
  assert.strictEqual(it.getDrag(), null);
});

test('a drag that comes back to the start un-aims the force', () => {
  const { state, fire } = rig();
  fire('pointerdown', { x: 1, y: 0 });
  fire('pointermove', { x: 1, y: 0.8 });
  assert.ok(state.getState().force);
  fire('pointermove', { x: 1.02, y: 0.02 });
  assert.strictEqual(state.getState().force, null);
});

test('after a click, pressing the force-point handle aims it', () => {
  const { state, fire, it } = rig();
  fire('pointerdown', { x: 1, y: 0 }); fire('pointerup', { x: 1, y: 0 });
  fire('pointerdown', { x: 1, y: 0 }, { handle: 'force' });
  assert.strictEqual(it.getDrag(), 'force');
  fire('pointermove', { x: 1.5, y: 0 });
  fire('pointerup', { x: 1.5, y: 0 });
  assert.strictEqual(state.getState().force.angle, 0);
});

test('pressing the beam elsewhere during aim moves the force point', () => {
  const { state, fire } = rig();
  fire('pointerdown', { x: 1, y: 0 }); fire('pointerup', { x: 1, y: 0 });
  fire('pointerdown', { x: -1, y: 0.25 }); fire('pointerup', { x: -1, y: 0.25 });
  assert.deepStrictEqual(state.getState().forcePoint, { x: -1, y: 0.25 });
});

function throughForce(r) {
  r.fire('pointerdown', { x: 1, y: 0 });
  r.fire('pointermove', { x: 1, y: 0.8 });
  r.fire('pointerup', { x: 1, y: 0.8 });
}

test('a press on the beam then a drag to the force point sets the pivot and draws r in one gesture', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: -1, y: 0 });
  assert.strictEqual(r.it.getDrag(), 'r');
  r.fire('pointermove', { x: 0, y: 0 });
  r.fire('pointermove', { x: 1, y: 0 });
  r.fire('pointerup', { x: 1, y: 0 });
  assert.deepStrictEqual(r.state.getState().pivot, { x: -1, y: 0 });
  assert.strictEqual(deriveStep(r.state.getState(), null), 'predict');
});

test('a pivot on the force point has nothing to draw: no drag, capture released', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: 1, y: 0 });
  assert.strictEqual(r.it.getDrag(), null);
  assert.ok(!r.svg.held.has(1), 'capture must be released when there is no drag');
  assert.strictEqual(deriveStep(r.state.getState(), null), 'predict');
});

test('a drag that stops short of the force point leaves r invalid and the step at draw', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: -1, y: 0 });
  r.fire('pointermove', { x: -0.2, y: 0 });
  r.fire('pointerup', { x: -0.2, y: 0 });
  assert.strictEqual(deriveStep(r.state.getState(), null), 'draw');
  r.fire('pointerdown', { x: -0.2, y: 0 }, { handle: 'rtip' });     // grab the tip and finish the job
  r.fire('pointermove', { x: 1.05, y: 0.02 });
  r.fire('pointerup', { x: 1.05, y: 0.02 });
  assert.strictEqual(deriveStep(r.state.getState(), null), 'predict');
});

test('presses on the beam are ignored once r is valid', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: -1, y: 0 }); r.fire('pointermove', { x: 1, y: 0 }); r.fire('pointerup', { x: 1, y: 0 });
  const before = JSON.stringify(r.state.getState());
  r.fire('pointerdown', { x: 0.5, y: 0.25 });
  assert.strictEqual(r.it.getDrag(), null);
  assert.strictEqual(JSON.stringify(r.state.getState()), before);
  assert.strictEqual(r.svg.captureCalls, 2, 'two presses took capture (force, pivot); the ignored third must not');
});

test('right and middle buttons never start a drag', () => {
  for (const button of [1, 2]) {
    const r = rig();
    r.fire('pointerdown', { x: 1, y: 0 }, { button });
    assert.strictEqual(r.it.getDrag(), null);
    assert.strictEqual(r.state.getState().forcePoint, null);
  }
});

test('pointercancel ends a drag exactly like pointerup', () => {
  const r = rig();
  r.fire('pointerdown', { x: 1, y: 0 });
  r.fire('pointercancel', { x: 1, y: 0 });
  assert.strictEqual(r.it.getDrag(), null);
  assert.ok(!r.svg.held.has(1));
});

test('a move from some OTHER pointer does not steer the drag', () => {
  const r = rig();
  r.fire('pointerdown', { x: 1, y: 0 });
  r.fire('pointermove', { x: 1, y: 0.8 }, { pointerId: 2 });
  assert.strictEqual(r.state.getState().force, null);
  r.fire('pointerup', { x: 1, y: 0 }, { pointerId: 2 });
  assert.strictEqual(r.it.getDrag(), 'force', 'another pointer cannot end it either');
});

// Mutation: deleting the `drag !== null && e.pointerId !== dragPointerId` guard in pointerdown
// lets a second pointer's press take the drag over: it moves the force point, takes capture,
// and overwrites dragPointerId, so pointer 1's moves and release are then ignored.
test('a second pointer pressing the beam mid-drag cannot take the drag over', () => {
  const r = rig();
  r.fire('pointerdown', { x: 1, y: 0 });                          // pointer 1 starts aiming
  r.fire('pointerdown', { x: -1, y: 0.25 }, { pointerId: 2 });    // a second finger lands on the beam
  assert.strictEqual(r.svg.captureCalls, 1, 'the second press must not even take capture');
  assert.deepStrictEqual(r.state.getState().forcePoint, { x: 1, y: 0 }, 'the second press moved the force point');
  r.fire('pointermove', { x: 1, y: 0.8 });                        // pointer 1 is still in charge
  assert.deepStrictEqual(r.state.getState().force, { mag: 50, angle: 90 });
  r.fire('pointerup', { x: 1, y: 0.8 });
  assert.strictEqual(r.it.getDrag(), null);
});

// Mutation: the same guard. Without it, a second press on the force point's own grid cell takes
// the auto-r branch, which releases capture and returns with `drag` still 'r' and dragPointerId
// null: pointer 1's release is then ignored and the drag is stranded.
test('a second pointer pressing the force point mid-r-drag cannot strand the drag', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: -1, y: 0 });                         // pointer 1 starts drawing r
  assert.strictEqual(r.it.getDrag(), 'r');
  r.fire('pointerdown', { x: 1, y: 0 }, { pointerId: 2 });        // pointer 2 presses the force point's cell
  assert.strictEqual(r.it.getDrag(), 'r', 'the first drag is still live');
  assert.ok(r.svg.held.has(1), "pointer 1's capture must survive");
  r.fire('pointermove', { x: 1, y: 0 });
  r.fire('pointerup', { x: 1, y: 0 });
  assert.strictEqual(r.it.getDrag(), null, 'the drag must end when pointer 1 lifts');
  assert.strictEqual(deriveStep(r.state.getState(), null), 'predict');
});

// The same pointer pressing again is NOT a second finger: it starts afresh.
test('the same pointer pressing again while a drag is live starts afresh', () => {
  const r = rig();
  r.fire('pointerdown', { x: 1, y: 0 });
  r.fire('pointerdown', { x: -1, y: 0.25 });                      // same pointer id (1)
  assert.deepStrictEqual(r.state.getState().forcePoint, { x: -1, y: 0.25 });
  r.fire('pointerup', { x: -1, y: 0.25 });
  assert.strictEqual(r.it.getDrag(), null);
});

// Mutation: removing the forcePoint guard in pointermove. New problem (or a second finger on the
// keyboard) empties the state mid-aim; every further move would throw "reading 'x'" of null.
test('a New problem during an aim drag: later moves are harmless and the release still ends the drag', () => {
  const r = rig();
  r.fire('pointerdown', { x: 1, y: 0 });
  assert.strictEqual(r.it.getDrag(), 'force');
  r.state.reset();
  assert.strictEqual(r.state.getState().forcePoint, null);
  r.fire('pointermove', { x: 1, y: 0.8 });                        // must not throw
  r.fire('pointermove', { x: 1.5, y: 0.8 });
  assert.strictEqual(r.state.getState().force, null, 'nothing to aim');
  r.fire('pointerup', { x: 1.5, y: 0.8 });
  assert.strictEqual(r.it.getDrag(), null);
  assert.ok(!r.svg.held.has(1), 'capture was released');
});

// Mutation: removing the pivot guard in pointermove, same failure for the r drag after Back.
test('Back during an r drag: later moves are harmless and the release still ends the drag', () => {
  const r = rig();
  throughForce(r);
  r.fire('pointerdown', { x: -1, y: 0 });
  assert.strictEqual(r.it.getDrag(), 'r');
  r.state.back();                                                 // the pivot is removed
  assert.strictEqual(r.state.getState().pivot, null);
  r.fire('pointermove', { x: 0, y: 0.25 });                       // must not throw
  r.fire('pointermove', { x: 0.5, y: 0.25 });
  assert.strictEqual(r.state.getState().rTip, null, 'nothing to draw from');
  r.fire('pointerup', { x: 0.5, y: 0.25 });
  assert.strictEqual(r.it.getDrag(), null);
});
