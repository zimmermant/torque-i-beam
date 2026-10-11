import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAG_MIN, MAG_MAX, DETENTS, components } from '../src/physics.js';
import {
  VB, PX_PER_M, ORIGIN_PX, BEAM, GRID, FORCE_PX_PER_N, R_SNAP_M, AIM_MIN_PX, R_DRAG_MIN_PX,
  toPx, toWorld, hitBeam, snapToGrid, beamRects, aimFromPointer, leverTipFromPointer
} from '../src/geometry.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

test('the constants are pinned to the values the spec was checked against', () => {
  assert.deepStrictEqual(VB, { w: 960, h: 560 });
  assert.strictEqual(PX_PER_M, 100);
  assert.deepStrictEqual(ORIGIN_PX, { x: 480, y: 280 });
  assert.strictEqual(BEAM.length, 5);
  assert.strictEqual(BEAM.depth, 0.5);
  assert.strictEqual(GRID, 0.25);
  assert.strictEqual(FORCE_PX_PER_N, 1.6);
  assert.strictEqual(R_SNAP_M, 0.12);
  assert.strictEqual(AIM_MIN_PX, 12);
  assert.strictEqual(R_DRAG_MIN_PX, 6);
});

// Mutation: dropping the sign flip in toPx's y makes +y point DOWN the screen.
test('toPx flips y, and toWorld is its exact inverse', () => {
  assert.deepStrictEqual(toPx({ x: 0, y: 0 }), { x: 480, y: 280 });
  assert.deepStrictEqual(toPx({ x: 1, y: 0.25 }), { x: 580, y: 255 });
  assert.deepStrictEqual(toPx({ x: -2.5, y: -0.25 }), { x: 230, y: 305 });
  for (let x = -2.5; x <= 2.5; x += 0.25) for (const y of [-0.25, 0, 0.25]) {
    const back = toWorld(toPx({ x, y }));
    assert.ok(near(back.x, x) && near(back.y, y), `round trip at ${x},${y}`);
  }
});

test('hitBeam accepts the whole bounding rectangle, corners included', () => {
  assert.ok(hitBeam({ x: 0, y: 0 }));
  assert.ok(hitBeam({ x: 2.5, y: 0.25 }));
  assert.ok(hitBeam({ x: -2.5, y: -0.25 }));
  assert.ok(!hitBeam({ x: 3, y: 0 }));
  assert.ok(!hitBeam({ x: 0, y: 0.4 }));
  assert.ok(!hitBeam({ x: 0, y: -0.4 }));
});

test('snapToGrid lands on 0.25 m in x, on three rows in y, and stays on the beam', () => {
  assert.deepStrictEqual(snapToGrid({ x: 1.13, y: 0.04 }), { x: 1.25, y: 0 });
  assert.deepStrictEqual(snapToGrid({ x: -0.9, y: 0.2 }), { x: -1, y: 0.25 });
  assert.deepStrictEqual(snapToGrid({ x: 9, y: 9 }), { x: 2.5, y: 0.25 });
  assert.deepStrictEqual(snapToGrid({ x: -9, y: -9 }), { x: -2.5, y: -0.25 });
  for (let x = -2.6; x <= 2.6; x += 0.07) for (let y = -0.3; y <= 0.3; y += 0.03) {
    const g = snapToGrid({ x, y });
    assert.ok(near(g.x / GRID, Math.round(g.x / GRID)), `x off grid: ${g.x}`);
    assert.ok([-0.25, 0, 0.25].some(v => near(g.y, v)), `y off row: ${g.y}`);
    assert.ok(hitBeam(g), 'snapped point left the beam');
  }
});

test('snapToGrid never returns negative zero', () => {
  const g = snapToGrid({ x: -0.05, y: -0.04 });
  assert.ok(!Object.is(g.x, -0) && !Object.is(g.y, -0));
});

test('beamRects tile the beam exactly: flange, web, flange, no gap and no overlap', () => {
  const [top, web, bottom] = beamRects();
  assert.ok(near(top.y1, 0.25) && near(top.y0, web.y1));
  assert.ok(near(web.y0, bottom.y1) && near(bottom.y0, -0.25));
  for (const r of [top, web, bottom]) assert.ok(near(r.x0, -2.5) && near(r.x1, 2.5));
});

// Mutation: setting AIM_MIN_PX to 0 makes a plain click aim a force.
test('aimFromPointer: a short drag is a click, a long one yields a snapped force', () => {
  const fp = { x: 0, y: 0 };
  assert.strictEqual(aimFromPointer(fp, { x: 0.05, y: 0.05 }), null);
  assert.strictEqual(aimFromPointer(fp, { x: 0.11, y: 0 }), null);          // 11 px < 12
  assert.deepStrictEqual(aimFromPointer(fp, { x: 0.5, y: 0 }), { mag: 31, angle: 0 });   // 50 px / 1.6
  assert.deepStrictEqual(aimFromPointer(fp, { x: 0, y: 1 }), { mag: 63, angle: 90 });
  assert.deepStrictEqual(aimFromPointer(fp, { x: 0.12, y: 0 }), { mag: MAG_MIN, angle: 0 });  // 12 px -> 7.5 -> clamp 10
  assert.strictEqual(aimFromPointer(fp, { x: 5, y: 0 }).mag, MAG_MAX);
});

test('aimFromPointer reads the angle from the force point, not the origin', () => {
  const fp = { x: 1, y: 0.25 };
  assert.strictEqual(aimFromPointer(fp, { x: 1, y: 1.25 }).angle, 90);
  assert.strictEqual(aimFromPointer(fp, { x: 0, y: 0.25 + 1e-9 + 0.5 - 0.5 }).angle, 180);
  assert.strictEqual(aimFromPointer(fp, { x: 1.7, y: 0.95 }).angle, 45);
});

test('every aim lands on a detent, whatever the pointer does', () => {
  const fp = { x: 0, y: 0 };
  const angles = new Set(DETENTS.map(d => d.angle));
  for (let a = 0; a < 360; a += 3) for (const len of [0.2, 0.7, 1.4]) {
    const aim = aimFromPointer(fp, { x: len * Math.cos(a * Math.PI / 180), y: len * Math.sin(a * Math.PI / 180) });
    assert.ok(angles.has(aim.angle), `angle ${aim.angle} is not a detent`);
    assert.ok(Number.isInteger(aim.mag) && aim.mag >= MAG_MIN && aim.mag <= MAG_MAX);
  }
});

test('the longest and shortest arrows fit the scene', () => {
  assert.ok(near(MAG_MAX * FORCE_PX_PER_N, 160));
  assert.ok(near(MAG_MIN * FORCE_PX_PER_N, 16));
  // A force at the beam's right end pointing right stays inside the viewBox
  const end = toPx({ x: 2.5, y: 0 });
  assert.ok(end.x + 160 + 40 <= VB.w, 'arrow plus label margin leaves the right edge');
  const f = components(MAG_MAX, 90);
  assert.ok(toPx({ x: 0, y: 0.25 }).y - f.y * FORCE_PX_PER_N >= 40, 'tallest arrow leaves the top');
});

test('leverTipFromPointer ignores a drag shorter than 6 px', () => {
  const pivot = { x: 1, y: 0 };
  assert.strictEqual(leverTipFromPointer(pivot, { x: 1.05, y: 0 }), null);
  assert.deepStrictEqual(leverTipFromPointer(pivot, { x: 1.06, y: 0 }), { x: 1.06, y: 0 });
});

// Mutation: dropping the clamp in leverTipFromPointer lets the tip, and the handle the
// instruction tells the student to drag, end up off the canvas.
test('leverTipFromPointer clamps the tip to the viewBox inset by 12 px', () => {
  const pivot = { x: -1, y: 0 };
  const lo = toWorld({ x: 12, y: VB.h - 12 }), hi = toWorld({ x: VB.w - 12, y: 12 });
  assert.ok(lo.y < hi.y && lo.x < hi.x, 'toWorld flips y, so lo is the bottom-left corner');
  const up = leverTipFromPointer(pivot, { x: 0, y: 5 });
  assert.ok(up.y <= hi.y + 1e-9, `y ${up.y} above the top limit ${hi.y}`);
  assert.ok(near(up.y, hi.y) && near(up.x, 0));
  const px = toPx(up);
  assert.ok(px.x >= 12 && px.x <= VB.w - 12 && px.y >= 12 && px.y <= VB.h - 12, 'inside the viewBox');
  const down = leverTipFromPointer(pivot, { x: 0, y: -9 });
  assert.ok(near(down.y, lo.y) && toPx(down).y <= VB.h - 12 + 1e-9);
  const right = leverTipFromPointer(pivot, { x: 99, y: 0 });
  assert.ok(near(right.x, hi.x) && near(right.y, 0), 'x clamped on the right');
  const left = leverTipFromPointer(pivot, { x: -99, y: 0 });
  assert.ok(near(left.x, lo.x), 'x clamped on the left');
  // A normal in-canvas tip is returned unchanged.
  assert.deepStrictEqual(leverTipFromPointer(pivot, { x: 1.5, y: 0.25 }), { x: 1.5, y: 0.25 });
  assert.deepStrictEqual(leverTipFromPointer(pivot, { x: -2.5, y: -0.25 }), { x: -2.5, y: -0.25 });
});

test('the 6 px short-drag rule is applied to the clamped point', () => {
  const hi = toWorld({ x: VB.w - 12, y: 12 });
  const edge = { x: hi.x - 0.02, y: 0 };                               // a pivot 2 px inside the clamp limit
  assert.strictEqual(leverTipFromPointer(edge, { x: hi.x + 0.5, y: 0 }), null, 'clamped to 2 px from the pivot: too short');
  assert.strictEqual(leverTipFromPointer({ x: 1, y: 0 }, { x: 1.05, y: 0 }), null);
});

// Mutation: HIT_MARGIN_M = 0 rejects a press 4 px outside the beam's top edge,
// and any pointer noise on the edge rows (y = +/-0.25) itself.
test('hitBeam forgives a press within 5 px of the beam, and not beyond', () => {
  assert.ok(hitBeam({ x: 0, y: 0.25 + 1e-12 }), 'float noise on the top edge');
  assert.ok(hitBeam({ x: 0, y: 0.29 }), '4 px above the top edge');
  assert.ok(hitBeam({ x: 2.54, y: 0 }), '4 px past the right end');
  assert.ok(!hitBeam({ x: 0, y: 0.31 }), '6 px above is a miss');
  assert.ok(!hitBeam({ x: -2.56, y: 0 }), '6 px past the left end is a miss');
});
