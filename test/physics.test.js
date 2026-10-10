import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEG, MAG_MIN, MAG_MAX, TAU_EPS, DETENTS, normalizeAngle, circDist, detentAt,
  snapAngle, snapMagnitude, components, polar, torqueZ, classify
} from '../src/physics.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

// Mutation: dropping the 'mirror into every quadrant' loop for 30/45/60, or the
// triple mirrors, shrinks the list below 24 and fails the count and the table.
test('there are exactly 24 distinct detents covering every quadrant', () => {
  assert.strictEqual(DETENTS.length, 24);
  const angles = DETENTS.map(d => d.angle);
  assert.strictEqual(new Set(angles.map(a => a.toFixed(6))).size, 24, 'duplicates');
  const expected = [0, 30, 36.8699, 45, 53.1301, 60, 90, 120, 126.8699, 135, 143.1301, 150,
    180, 210, 216.8699, 225, 233.1301, 240, 270, 300, 306.8699, 315, 323.1301, 330];
  expected.forEach((e, i) => assert.ok(near(DETENTS[i].angle, e, 1e-3),
    `detent ${i} is ${DETENTS[i].angle}, expected ${e}`));
  for (const q of [0, 90, 180, 270]) {
    const inQuadrant = angles.filter(a => a > q && a < q + 90);
    assert.strictEqual(inQuadrant.length, 5, `quadrant starting at ${q}`);
  }
});

test('the detents are never closer than 6.87 degrees, so snapping is unambiguous', () => {
  const a = DETENTS.map(d => d.angle);
  for (let i = 0; i < a.length; i++) {
    const gap = (a[(i + 1) % a.length] - a[i] + 360) % 360;
    assert.ok(gap > 6.86, `gap after ${a[i]} is ${gap}`);
  }
});

// Mutation: using Math.abs(a - b) without wrapping makes 359 snap to 330
// (distance 29) instead of 0 (distance 1).
test('snapAngle goes the short way round, across 360 -> 0', () => {
  assert.strictEqual(snapAngle(359), 0);
  assert.strictEqual(snapAngle(-1), 0);
  assert.strictEqual(snapAngle(361), 0);
  assert.strictEqual(snapAngle(-45), 315);
  assert.strictEqual(snapAngle(29), 30);
  assert.ok(near(snapAngle(50), Math.atan2(4, 3) / DEG), '50 is nearer 53.13 than 45');
  assert.strictEqual(snapAngle(NaN), 0);
});

test('snapAngle returns every detent for an input exactly on it', () => {
  for (const d of DETENTS) assert.strictEqual(snapAngle(d.angle), d.angle);
});

test('snapMagnitude rounds to whole newtons and clamps to 10..100', () => {
  assert.strictEqual(snapMagnitude(37.4), 37);
  assert.strictEqual(snapMagnitude(37.5), 38);
  assert.strictEqual(snapMagnitude(3), MAG_MIN);
  assert.strictEqual(snapMagnitude(500), MAG_MAX);
  assert.strictEqual(snapMagnitude(NaN), MAG_MIN);
});

// Mutation: using raw Math.cos/Math.sin at 90 makes x = 3.06e-15, which is
// !== 0.
// Mutation: deleting the trailing "+ 0" in components() leaves -1 * 0 = -0 at 180 and 270 degrees.
test('components are EXACT at the axes', () => {
  assert.deepStrictEqual(components(50, 0),   { x: 50, y: 0 });
  assert.deepStrictEqual(components(50, 90),  { x: 0, y: 50 });
  assert.deepStrictEqual(components(50, 180), { x: -50, y: 0 });
  assert.deepStrictEqual(components(50, 270), { x: 0, y: -50 });
  for (const a of [0, 90, 180, 270]) {
    const c = components(37, a);
    assert.ok(!Object.is(c.x, -0) && !Object.is(c.y, -0), `negative zero at ${a}`);
  }
  for (const a of [0, 90, 180, 270]) {
    const c = components(0, a);
    assert.ok(!Object.is(c.x, -0) && !Object.is(c.y, -0), `negative zero at ${a} with mag 0`);
    assert.deepStrictEqual(c.x, 0);
    assert.deepStrictEqual(c.y, 0);
  }
});

// Mutation: computing m * Math.cos(53.13 deg) gives 30.000000000000004.
test('components are EXACT at the 3-4-5 detents when the magnitude is a multiple of 5', () => {
  const t = Math.atan2(4, 3) / DEG;
  assert.deepStrictEqual(components(50, t), { x: 30, y: 40 });
  assert.deepStrictEqual(components(50, 180 - t), { x: -30, y: 40 });
  assert.deepStrictEqual(components(50, 180 + t), { x: -30, y: -40 });
  assert.deepStrictEqual(components(50, 360 - t), { x: 30, y: -40 });
  const u = Math.atan2(3, 4) / DEG;
  assert.deepStrictEqual(components(100, u), { x: 80, y: 60 });
});

test('components agree with plain trigonometry at every detent and magnitude', () => {
  for (const d of DETENTS) {
    for (let m = MAG_MIN; m <= MAG_MAX; m += 9) {
      const c = components(m, d.angle);
      assert.ok(near(c.x, m * Math.cos(d.angle * DEG), 1e-9), `x at ${d.angle}, ${m}`);
      assert.ok(near(c.y, m * Math.sin(d.angle * DEG), 1e-9), `y at ${d.angle}, ${m}`);
    }
  }
});

test('polar gives magnitude and a [0,360) angle, and no angle for a zero vector', () => {
  assert.deepStrictEqual(polar({ x: 0, y: 0 }), { mag: 0, angle: null });
  assert.ok(near(polar({ x: 3, y: 4 }).mag, 5));
  assert.ok(near(polar({ x: 3, y: 4 }).angle, Math.atan2(4, 3) / DEG));
  assert.ok(near(polar({ x: -1, y: -1 }).angle, 225));
  assert.strictEqual(polar({ x: 1, y: 0 }).angle, 0);
  assert.ok(near(polar({ x: 0, y: -2 }).angle, 270));
});

test('normalizeAngle and circDist behave across the wrap', () => {
  assert.strictEqual(normalizeAngle(-90), 270);
  assert.strictEqual(normalizeAngle(360), 0);
  assert.ok(!Object.is(normalizeAngle(-0), -0));
  assert.strictEqual(circDist(350, 10), 20);
  assert.strictEqual(circDist(10, 350), 20);
  assert.strictEqual(circDist(0, 180), 180);
});

test('detentAt finds a detent only when the angle is exactly on one', () => {
  assert.strictEqual(detentAt(45).kind, 'standard');
  assert.strictEqual(detentAt(90).kind, 'axis');
  assert.strictEqual(detentAt(Math.atan2(4, 3) / DEG).kind, 'triple');
  assert.strictEqual(detentAt(45.001), null);
  assert.strictEqual(detentAt(405).angle, 45);
});

// Mutation: swapping the two products (r.y * F.x - r.x * F.y) flips every sign.
test('torqueZ is r_x F_y - r_y F_x, checked against a hand-built determinant', () => {
  assert.strictEqual(torqueZ({ x: 1, y: 0 }, { x: 0, y: 10 }), 10);      // push up at +x: ccw
  assert.strictEqual(torqueZ({ x: 1, y: 0 }, { x: 0, y: -10 }), -10);    // push down at +x: cw
  assert.strictEqual(torqueZ({ x: -2, y: 0 }, { x: 0, y: 10 }), -20);    // push up at -x: cw
  assert.strictEqual(torqueZ({ x: 0, y: 1 }, { x: 10, y: 0 }), -10);     // push right at +y: cw
  assert.strictEqual(torqueZ({ x: 0, y: 1 }, { x: -10, y: 0 }), 10);     // push left at +y: ccw
  for (let rx = -2; rx <= 2; rx += 0.5) for (let ry = -1; ry <= 1; ry += 0.5)
    for (let fx = -30; fx <= 30; fx += 15) for (let fy = -30; fy <= 30; fy += 15) {
      const det = rx * fy - fx * ry;
      assert.ok(near(torqueZ({ x: rx, y: ry }, { x: fx, y: fy }), det));
    }
});

test('torqueZ never returns negative zero', () => {
  assert.ok(!Object.is(torqueZ({ x: 0, y: 0 }, { x: 5, y: -5 }), -0));
  assert.ok(!Object.is(torqueZ({ x: 1, y: 0 }, { x: -3, y: 0 }), -0));
});

// Mutation: TAU_EPS = 0 makes classify(0) read 'cw' (0 > 0 is false), and makes
// the ~1e-14 residue of the 45-degree trig cases read as ccw/cw too.
test('classify: zero below TAU_EPS, signed above it', () => {
  assert.strictEqual(TAU_EPS, 1e-9);
  assert.strictEqual(classify(0), 'zero');
  assert.strictEqual(classify(3.06e-15), 'zero');
  assert.strictEqual(classify(-2.2e-14), 'zero');
  assert.strictEqual(classify(0.335), 'ccw');
  assert.strictEqual(classify(-0.335), 'cw');
  assert.strictEqual(classify(TAU_EPS * 1.01), 'ccw');
  assert.strictEqual(classify(-TAU_EPS * 1.01), 'cw');
});

// The sweep that justifies TAU_EPS. Every reachable torque is r x F with r
// components on a 0.25 m grid (x in [-5, 5], y in [-0.5, 0.5]) and F any
// detent at any whole magnitude in 10..100.
test('every reachable torque is either < 1e-12 or > 0.3: the tolerance cannot misclassify', () => {
  let maxZero = 0, minReal = Infinity, nZero = 0;
  const ys = [-0.5, -0.25, 0, 0.25, 0.5];
  for (const d of DETENTS) {
    for (let m = MAG_MIN; m <= MAG_MAX; m++) {
      const F = components(m, d.angle);
      for (let i = -20; i <= 20; i++) for (const ry of ys) {
        const t = Math.abs(torqueZ({ x: i * 0.25, y: ry }, F));
        if (t < TAU_EPS) { nZero++; maxZero = Math.max(maxZero, t); }
        else minReal = Math.min(minReal, t);
      }
    }
  }
  assert.ok(nZero > 0, 'the sweep found no zero-torque states at all');
  assert.ok(maxZero < 1e-12, `a zero-torque state has |tau| = ${maxZero}`);
  assert.ok(minReal > 0.3, `a real torque is as small as ${minReal}`);
});
