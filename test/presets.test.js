import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresets, describePresets, createPresets } from '../src/presets.js';
import { createState } from '../src/state.js';
import { deriveStep } from '../src/steps.js';
import { snapAngle } from '../src/physics.js';

const EMPTY = { fp: null, mag: null, angle: null, pivot: null, adjusted: [], ignored: [] };
const parse = (...pairs) => parsePresets('?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'));
function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}

// --- parsePresets ------------------------------------------------------------
// Mutation: an absent parameter is read as present-but-empty (`raw === undefined`
// instead of `raw === null` -- URLSearchParams.get returns null for a missing key), so
// every link would report four ignored parameters.
test('parsePresets: no link, no search, an empty search and a bare "?" all mean nothing is set', () => {
  for (const search of [undefined, null, '', '?']) assert.deepStrictEqual(parsePresets(search), EMPTY, String(search));
  assert.deepStrictEqual(parsePresets('?unrelated=1&x=2'), EMPTY, 'unknown parameters are ignored silently');
});

// Mutations: a one-number location gets y = 0.25 instead of 0; pivot read from the fp
// parameter; mag read from the angle parameter.
test('parsePresets: each parameter on its own, with and without the leading "?"', () => {
  assert.deepStrictEqual(parsePresets('?fp=1.5'), { ...EMPTY, fp: { x: 1.5, y: 0 } });
  assert.deepStrictEqual(parsePresets('fp=1.5,0.25'), { ...EMPTY, fp: { x: 1.5, y: 0.25 } });
  assert.deepStrictEqual(parsePresets('?pivot=-1'), { ...EMPTY, pivot: { x: -1, y: 0 } });
  assert.deepStrictEqual(parsePresets('?pivot=-1,-0.25'), { ...EMPTY, pivot: { x: -1, y: -0.25 } });
  assert.deepStrictEqual(parsePresets('?mag=50'), { ...EMPTY, mag: 50 });
  assert.deepStrictEqual(parsePresets('?angle=90'), { ...EMPTY, angle: 90 });
  assert.deepStrictEqual(parsePresets('?fp=1&mag=50&angle=0&pivot=2'),
    { ...EMPTY, fp: { x: 1, y: 0 }, mag: 50, angle: 0, pivot: { x: 2, y: 0 } });
});

// Mutations: the text is not trimmed; the number pattern loses its optional sign.
test('parsePresets: whitespace is trimmed, and signs, decimals and a bare ".5" or "5." are numbers', () => {
  assert.deepStrictEqual(parse(['fp', ' 1.5 , -0.25 ']), { ...EMPTY, fp: { x: 1.5, y: -0.25 } });
  assert.deepStrictEqual(parse(['pivot', '+2,.25']), { ...EMPTY, pivot: { x: 2, y: 0.25 } });
  assert.deepStrictEqual(parse(['pivot', '-.5,-.25']), { ...EMPTY, pivot: { x: -0.5, y: -0.25 } });
  assert.deepStrictEqual(parse(['pivot', '2.,0.']), { ...EMPTY, pivot: { x: 2, y: 0 } });
  assert.strictEqual(parse(['mag', ' +40 ']).mag, 40);
  assert.strictEqual(parse(['angle', '-45']).angle, 315);
});

// Mutations: exponents are accepted; a third coordinate is dropped instead of refused; the
// ignored text for each parameter is wrong; an overflowing number reaches the snapper
// (Infinity would snap to 10 N).
test('parsePresets: every invalid form is ignored, with the exact text and the field left null', () => {
  const BAD = ['', 'abc', '1,2,3', '1,', ',1', 'Infinity', 'NaN', '1e3', '0x10', '--1', ' ', '9'.repeat(400)];
  const HINT = { fp: 'use x,y in metres', pivot: 'use x,y in metres', mag: 'use a number of newtons', angle: 'use degrees' };
  for (const key of ['fp', 'mag', 'angle', 'pivot']) {
    for (const raw of BAD) {
      const p = parse([key, raw]);
      assert.strictEqual(p[key], null, `${key}=${JSON.stringify(raw)} must leave ${key} null`);
      assert.deepStrictEqual(p.ignored, [`${key}=${raw} (${HINT[key]})`], `${key}=${JSON.stringify(raw)}`);
      assert.deepStrictEqual(p.adjusted, []);
    }
  }
  // the others in a link keep working
  const mixed = parsePresets('?fp=abc&mag=50&angle=x1');
  assert.deepStrictEqual(mixed, { ...EMPTY, mag: 50, ignored: ['fp=abc (use x,y in metres)', 'angle=x1 (use degrees)'] });
});

// Mutation: the LAST duplicate wins (getAll(...).pop()).
test('parsePresets: with a parameter repeated, the first one wins, even when it is the invalid one', () => {
  assert.strictEqual(parsePresets('?mag=40&mag=60').mag, 40);
  const p = parsePresets('?mag=abc&mag=60');
  assert.strictEqual(p.mag, null);
  assert.deepStrictEqual(p.ignored, ['mag=abc (use a number of newtons)']);
});

// Mutations: locations are not snapped; only x is compared when deciding whether to
// note an adjustment; a note is written even when nothing changed.
test('parsePresets: locations are snapped like a click and every change is noted', () => {
  const a = parsePresets('?fp=1.1,0');
  assert.deepStrictEqual(a.fp, { x: 1, y: 0 });
  assert.deepStrictEqual(a.adjusted, ['fp (1.1, 0) → (1, 0)']);
  const b = parsePresets('?pivot=9,9');                       // off the beam: clamped on
  assert.deepStrictEqual(b.pivot, { x: 2.5, y: 0.25 });
  assert.deepStrictEqual(b.adjusted, ['pivot (9, 9) → (2.5, 0.25)']);
  const c = parsePresets('?fp=1.5,0.3');                      // only y changes
  assert.deepStrictEqual(c.fp, { x: 1.5, y: 0.25 });
  assert.deepStrictEqual(c.adjusted, ['fp (1.5, 0.3) → (1.5, 0.25)']);
  const d = parsePresets('?pivot=1.1');                       // one number: y defaults to 0 in the "before"
  assert.deepStrictEqual(d.adjusted, ['pivot (1.1, 0) → (1, 0)']);
  const e = parsePresets('?pivot=-9,-9');                     // the real minus sign
  assert.deepStrictEqual(e.adjusted, ['pivot (−9, −9) → (−2.5, −0.25)']);
  for (const clean of ['?fp=1.5,0', '?fp=-2.5,-0.25', '?pivot=0', '?pivot=-0,-0']) {
    assert.deepStrictEqual(parsePresets(clean).adjusted, [], clean);
  }
});

// Mutations: the magnitude is not snapped (500 stays 500); the note is not written; a
// whole-newton value is noted anyway.
test('parsePresets: a magnitude snaps to whole newtons between 10 and 100, and says so', () => {
  const cases = [['500', 100, 'mag 500 → 100'], ['5', 10, 'mag 5 → 10'], ['37.4', 37, 'mag 37.4 → 37'],
                 ['-20', 10, 'mag −20 → 10']];
  for (const [text, want, note] of cases) {
    const p = parse(['mag', text]);
    assert.strictEqual(p.mag, want, text);
    assert.deepStrictEqual(p.adjusted, [note], text);
  }
  for (const text of ['50', '50.0', '10', '100']) assert.deepStrictEqual(parse(['mag', text]).adjusted, [], text);
});

// Mutations: the angle is compared without wrapping at 360 (so -45, 360 and 405 are
// noted); the tolerance is exact equality (so 53.13 is noted); the note is not written.
test('parsePresets: an angle snaps to a detent; one typed on a detent (mod 360, to 0.01 degrees) is not noted', () => {
  const p = parse(['angle', '47']);
  assert.strictEqual(p.angle, 45);
  assert.deepStrictEqual(p.adjusted, ['angle 47 → 45']);
  assert.deepStrictEqual(parse(['angle', '53.2']).adjusted, ['angle 53.2 → 53.13']);
  const want = { '53.13': snapAngle(53.13), '-45': 315, '360': 0, '405': 45, '0': 0, '90': 90, '36.87': snapAngle(36.87), '-360': 0 };
  for (const [text, angle] of Object.entries(want)) {
    const q = parse(['angle', text]);
    assert.strictEqual(q.angle, angle, text);
    assert.deepStrictEqual(q.adjusted, [], `${text} is on a detent: no note`);
  }
  assert.ok(Math.abs(parse(['angle', '53.13']).angle - 53.1301) < 1e-4, 'the 3-4-5 detent itself, not 53.13');
});

// Mutation: the parameters are processed in another order (e.g. pivot first).
test('parsePresets: notes follow the order fp, mag, angle, pivot', () => {
  const p = parsePresets('?pivot=9,9&angle=47&mag=500&fp=1.1,0&x=1');
  assert.deepStrictEqual(p.adjusted, ['fp (1.1, 0) → (1, 0)', 'mag 500 → 100', 'angle 47 → 45', 'pivot (9, 9) → (2.5, 0.25)']);
  const q = parsePresets('?pivot=a&angle=b&mag=c&fp=d');
  assert.deepStrictEqual(q.ignored, ['fp=d (use x,y in metres)', 'mag=c (use a number of newtons)', 'angle=b (use degrees)', 'pivot=a (use x,y in metres)']);
});

// --- describePresets -----------------------------------------------------------
// Mutations: the angle prints without its degree sign; coordinates print through String()
// (ASCII hyphen); the pieces are joined without the space.
test('describePresets: a full set reads as the spec words it, with the real minus sign', () => {
  assert.strictEqual(describePresets(parsePresets('?fp=1.5,0&mag=50&angle=90&pivot=-1,0')),
    'From the link: force at (1.5, 0) m, 50 N, 90°, pivot at (−1, 0) m.');
  assert.strictEqual(describePresets(parsePresets('?angle=53.13')), 'From the link: 53.13°.');
});

// Mutation: the pieces that were not set are printed anyway (as dashes or 'undefined').
test('describePresets: a partial set names only what was set', () => {
  assert.strictEqual(describePresets(parsePresets('?mag=50')), 'From the link: 50 N.');
  assert.strictEqual(describePresets(parsePresets('?pivot=-1')), 'From the link: pivot at (−1, 0) m.');
  assert.strictEqual(describePresets(parsePresets('?fp=2,0.25&angle=0')), 'From the link: force at (2, 0.25) m, 0°.');
});

// Mutations: the empty case says "nothing set" instead of printing nothing; the
// only-ignored sentence loses its "nothing set".
test('describePresets: empty when there is nothing to say; "nothing set" when everything was ignored', () => {
  assert.strictEqual(describePresets(parsePresets('')), '');
  assert.strictEqual(describePresets(parsePresets('?foo=bar')), '');
  assert.strictEqual(describePresets(parsePresets('?fp=abc')), 'From the link: nothing set. Ignored: fp=abc (use x,y in metres).');
  assert.strictEqual(describePresets(parsePresets('?fp=abc&mag=')),
    'From the link: nothing set. Ignored: fp=abc (use x,y in metres); mag= (use a number of newtons).');
});

// Mutation: the adjusted and ignored lists are joined with ', ' instead of '; '.
test('describePresets: the Adjusted and Ignored sentences, together and alone', () => {
  assert.strictEqual(describePresets(parsePresets('?mag=500')), 'From the link: 100 N. Adjusted: mag 500 → 100.');
  assert.strictEqual(describePresets(parsePresets('?fp=1.1,0&angle=47')),
    'From the link: force at (1, 0) m, 45°. Adjusted: fp (1.1, 0) → (1, 0); angle 47 → 45.');
  assert.strictEqual(describePresets(parsePresets('?mag=500&pivot=x&angle=y')),
    'From the link: 100 N. Adjusted: mag 500 → 100. Ignored: angle=y (use degrees); pivot=x (use x,y in metres).');
});

// Mutation: coordinates are printed from the raw number, so -0 would show as "-0".
test('describePresets: a coordinate that snaps to zero prints 0, never -0', () => {
  const p = parsePresets('?pivot=-0.01,-0.01&fp=-0');
  assert.deepStrictEqual(p.pivot, { x: 0, y: 0 });
  assert.ok(Object.is(p.pivot.x, 0) && Object.is(p.pivot.y, 0), 'positive zero');
  assert.ok(Object.is(p.fp.x, 0), 'fp=-0 is positive zero too');
  const text = describePresets(p);
  const setPart = text.split(' Adjusted')[0];                  // the note legitimately quotes the typed -0.01
  assert.ok(!setPart.includes('-0') && !setPart.includes('−0'), setPart);
  assert.strictEqual(text, 'From the link: force at (0, 0) m, pivot at (0, 0) m. Adjusted: pivot (−0.01, −0.01) → (0, 0).');
});

// --- createPresets -------------------------------------------------------------
const FULL = '?fp=1,0&mag=50&angle=90&pivot=-1,0';
function started(search) {
  const state = createState();
  const presets = createPresets(parsePresets(search));
  presets.start(state);
  return { state, presets };
}

// Mutation: start never places the force point.
test('createPresets: an fp alone places the force point and leaves the force to the student', () => {
  const { state, presets } = started('?fp=1.5,0.25');
  assert.deepStrictEqual(state.getState().forcePoint, { x: 1.5, y: 0.25 });
  assert.strictEqual(state.getState().force, null);
  assert.strictEqual(deriveStep(state.getState(), null), 'aim');
  assert.deepStrictEqual(presets.getLocks(), { mag: null, angle: null });
});

// Mutations: start completes the force when only ONE of mag and angle is present (|| for &&);
// start treats an angle of 0 as absent (a truthiness test instead of !== null).
test('createPresets: fp with both mag and angle completes the force at load; with one of them it does not', () => {
  const both = started('?fp=1,0&mag=50&angle=90');
  assert.deepStrictEqual(both.state.getState().force, { mag: 50, angle: 90 });
  assert.strictEqual(deriveStep(both.state.getState(), null), 'pivot');
  const zero = started('?fp=1,0&mag=50&angle=0');
  assert.deepStrictEqual(zero.state.getState().force, { mag: 50, angle: 0 }, 'angle 0 is a real angle');
  for (const one of ['?fp=1,0&mag=50', '?fp=1,0&angle=90']) {
    const r = started(one);
    assert.strictEqual(r.state.getState().force, null, one);
    assert.strictEqual(deriveStep(r.state.getState(), null), 'aim', one);
  }
  const noFp = started('?mag=50&angle=90');
  assert.strictEqual(noFp.state.getState().forcePoint, null, 'a force with no point cannot be placed');
  assert.strictEqual(deriveStep(noFp.state.getState(), null), 'place');
});

// Mutations: settle ignores the drag (the pivot would land mid-aim); the pending pivot is
// not consumed (it would come back after Back); settle applies the pivot when there is only a
// force point (setPivot refuses, and the pivot is lost for good).
test('createPresets: the pivot waits for a complete force and no drag, lands once, and is never re-applied', () => {
  const state = createState();
  const presets = createPresets(parsePresets('?pivot=-1,0'));
  presets.start(state);
  assert.strictEqual(presets.settle(state, null), false, 'no force point yet');
  state.setForcePoint({ x: 1, y: 0 });
  assert.strictEqual(presets.settle(state, null), false, 'no force yet');
  state.setForce({ mag: 50, angle: 90 });
  assert.strictEqual(presets.settle(state, 'force'), false, 'the force is complete but a drag is in progress');
  assert.strictEqual(state.getState().pivot, null);
  assert.strictEqual(presets.settle(state, null), true);
  assert.deepStrictEqual(state.getState().pivot, { x: -1, y: 0 });
  assert.strictEqual(deriveStep(state.getState(), null), 'draw');
  assert.strictEqual(presets.settle(state, null), false, 'applied exactly once');
  state.back();                                               // removes the pivot
  assert.strictEqual(state.getState().pivot, null);
  assert.strictEqual(presets.settle(state, null), false, 'Back must not bring the pivot back');
  assert.strictEqual(state.getState().pivot, null);
  state.setPivot({ x: 2, y: 0 });
  state.sameForceNewPivot();
  assert.strictEqual(presets.settle(state, null), false, 'Same force, new pivot must not re-apply it');
  assert.strictEqual(state.getState().pivot, null);
});

// Mutation: settle applies the pivot with no force (checks the force point only): the pivot is
// then lost, because setPivot refuses it.
test('createPresets: a full link is a finished setup at load: the pivot lands where the link said', () => {
  const { state, presets } = started(FULL);
  assert.strictEqual(deriveStep(state.getState(), null), 'pivot', 'before settle: pivot pending');
  assert.strictEqual(presets.settle(state, null), true);
  assert.deepStrictEqual(state.getState().pivot, { x: -1, y: 0 });
  assert.strictEqual(deriveStep(state.getState(), null), 'draw');
  assert.strictEqual(state.getState().rTip, null, 'r is never preset');
});

test('createPresets: a pivot on the force point\'s own cell makes r zero and goes straight to predict', () => {
  const { state, presets } = started('?fp=1,0&mag=50&angle=90&pivot=1,0');
  presets.settle(state, null);
  assert.deepStrictEqual(state.getState().rTip, { x: 1, y: 0 });
  assert.strictEqual(deriveStep(state.getState(), null), 'predict');
});

// Mutation: the pending pivot is not consumed. A subscriber that settles on every change (as
// app.js's sync does) would then re-apply it for every later complete force.
// (Setting the pivot BEFORE consuming it is an equivalent mutant: setPivot moves the step off
// 'pivot', so a nested settle cannot apply it twice. No row is claimed for that order.)
test('createPresets: a subscriber that settles on every change applies the pivot once, never for a later force', () => {
  const state = createState();
  const presets = createPresets(parsePresets(FULL));
  presets.start(state);
  let pivots = 0, last = null;
  state.subscribe(s => { if (s.pivot && !last) pivots++; last = s.pivot; presets.settle(state, null); });
  state.setForcePoint({ x: 0, y: 0 });                        // moving the point: everything downstream restarts
  state.setForce({ mag: 20, angle: 0 });                      // the pivot lands here (step 'pivot')
  assert.strictEqual(pivots, 1);
  state.setForcePoint({ x: 1, y: 0 });                        // the point moves: pivot cleared ...
  state.setForce({ mag: 20, angle: 0 });                      // ... and a new complete force
  assert.strictEqual(state.getState().pivot, null, 'a link\'s pivot is not re-applied for a later force');
  assert.strictEqual(pivots, 1);
});

// Mutations: clear leaves the locks; clear leaves the pending pivot; clear leaves the summary.
test('createPresets: clear() drops the locks, the pending pivot and the summary', () => {
  const { state, presets } = started('?fp=1,0&mag=50&angle=90&pivot=-1,0&q=1');
  assert.deepStrictEqual(presets.getLocks(), { mag: 50, angle: 90 });
  assert.strictEqual(presets.bothLocked(), true);
  assert.strictEqual(presets.summary(), 'From the link: force at (1, 0) m, 50 N, 90°, pivot at (−1, 0) m.');
  presets.clear();
  assert.deepStrictEqual(presets.getLocks(), { mag: null, angle: null });
  assert.strictEqual(presets.bothLocked(), false);
  assert.strictEqual(presets.summary(), '');
  assert.strictEqual(presets.settle(state, null), false, 'the pending pivot is gone');
  assert.strictEqual(state.getState().pivot, null);
});

// Mutations: clear writes through to the parsed link (a frozen object throws); getLocks hands out
// the live object.
test('createPresets: the parsed link is never mutated, and getLocks returns a fresh object each time', () => {
  const parsed = deepFreeze(parsePresets(FULL));
  const copy = JSON.parse(JSON.stringify(parsed));
  const presets = createPresets(parsed);
  const state = createState();
  presets.start(state);
  presets.settle(state, null);
  presets.lockAim({ mag: 20, angle: 30 });
  const a = presets.getLocks();
  a.mag = 999;
  assert.deepStrictEqual(presets.getLocks(), { mag: 50, angle: 90 }, 'a caller cannot change the locks');
  presets.clear();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed)), copy);
});

// Mutations: a locked magnitude or angle is ignored; a too-short drag (null) turns into the locks;
// the locks are applied with || so an angle of 0 is lost; the caller's object is mutated.
test('createPresets: lockAim keeps the locked part of an aim, and a short drag stays "not aimed"', () => {
  const aim = deepFreeze({ mag: 80, angle: 30 });
  const lockAim = search => createPresets(parsePresets(search)).lockAim;
  assert.strictEqual(lockAim('?mag=50')(null), null);
  assert.strictEqual(lockAim('')(null), null);
  assert.strictEqual(lockAim('?mag=50&angle=90')(null), null, 'even with both locked');
  assert.deepStrictEqual(lockAim('')(aim), { mag: 80, angle: 30 });
  assert.deepStrictEqual(lockAim('?mag=50')(aim), { mag: 50, angle: 30 }, 'mag locked keeps the drag\'s angle');
  assert.deepStrictEqual(lockAim('?angle=90')(aim), { mag: 80, angle: 90 }, 'angle locked keeps the drag\'s magnitude');
  assert.deepStrictEqual(lockAim('?angle=0')(aim), { mag: 80, angle: 0 }, 'a locked angle of 0 is a lock');
  assert.deepStrictEqual(lockAim('?mag=50&angle=90')(aim), { mag: 50, angle: 90 });
  assert.deepStrictEqual(aim, { mag: 80, angle: 30 }, 'not mutated');
});

// Mutations: bothLocked is true when only one is locked (||); an angle lock of 0 counts as no lock.
test('createPresets: bothLocked needs both, and an angle of 0 counts', () => {
  const both = s => createPresets(parsePresets(s)).bothLocked();
  assert.strictEqual(both(''), false);
  assert.strictEqual(both('?mag=50'), false);
  assert.strictEqual(both('?angle=90'), false);
  assert.strictEqual(both('?fp=1,0&pivot=0'), false);
  assert.strictEqual(both('?mag=50&angle=90'), true);
  assert.strictEqual(both('?mag=50&angle=0'), true);
  assert.deepStrictEqual(createPresets(parsePresets('?angle=0')).getLocks(), { mag: null, angle: 0 });
});
