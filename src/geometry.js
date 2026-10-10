import { DEG, snapAngle, snapMagnitude } from './physics.js';

// Everything that knows the beam's SHAPE, and the only place the y axis is
// flipped. Every other module works in world coordinates: metres, y up, origin
// at the beam's centre. Every constant below was checked by the sweeps in
// test/geometry.test.js and test/scene.test.js.
export const VB = { w: 960, h: 560 };
export const PX_PER_M = 100;
export const ORIGIN_PX = { x: 480, y: 280 };
export const BEAM = { length: 5, depth: 0.5, flange: 0.08 };
export const GRID = 0.25;
export const FORCE_PX_PER_N = 1.6;
export const R_SNAP_M = 0.12;
export const AIM_MIN_PX = 12;
export const R_DRAG_MIN_PX = 6;
export const HIT_MARGIN_M = 0.05;

export function clampTo(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function toPx(p) {
  return { x: ORIGIN_PX.x + p.x * PX_PER_M, y: ORIGIN_PX.y - p.y * PX_PER_M };
}

export function toWorld(px) {
  return { x: (px.x - ORIGIN_PX.x) / PX_PER_M, y: (ORIGIN_PX.y - px.y) / PX_PER_M };
}

// The whole bounding rectangle, not the I-beam outline, so the gaps beside the
// web stay clickable -- plus a 5px margin, so a press on the beam's outer edge
// (where the grid's top and bottom rows live) is never lost to a pixel of error.
export function hitBeam(w) {
  return Math.abs(w.x) <= BEAM.length / 2 + HIT_MARGIN_M &&
         Math.abs(w.y) <= BEAM.depth / 2 + HIT_MARGIN_M;
}

// Force point and pivot live on a 0.25 m grid, three rows (top flange, web,
// bottom flange), so every r component is a multiple of 0.25 and the numbers
// stay clean.
export function snapToGrid(w) {
  const hx = BEAM.length / 2, hy = BEAM.depth / 2;
  const x = clampTo(Math.round(w.x / GRID) * GRID, -hx, hx);
  const y = clampTo(Math.round(w.y / GRID) * GRID, -hy, hy);
  return { x: x + 0, y: y + 0 };
}

// The beam as three rectangles in world metres: top flange, web, bottom flange.
export function beamRects() {
  const hx = BEAM.length / 2, hy = BEAM.depth / 2, f = BEAM.flange;
  return [
    { role: 'flange', x0: -hx, x1: hx, y0: hy - f, y1: hy },
    { role: 'web',    x0: -hx, x1: hx, y0: -hy + f, y1: hy - f },
    { role: 'flange', x0: -hx, x1: hx, y0: -hy, y1: -hy + f }
  ];
}

// Turn a pointer position into a force, or null if the drag is too short to
// count as aiming (a plain click leaves the point placed and unaimed).
export function aimFromPointer(forcePoint, world) {
  const dx = world.x - forcePoint.x, dy = world.y - forcePoint.y;
  const distPx = Math.hypot(dx, dy) * PX_PER_M;
  if (distPx < AIM_MIN_PX) return null;
  return {
    mag: snapMagnitude(distPx / FORCE_PX_PER_N),
    angle: snapAngle(Math.atan2(dy, dx) / DEG)
  };
}

// The dragged tip of r, or null if the drag is too short to count. Pointer
// capture keeps delivering moves outside the svg, so the pointer is first
// clamped to the viewBox inset by 12 px: the tip (and the handle on it) always
// stays where it can be seen and grabbed.
export function leverTipFromPointer(pivot, world) {
  const lo = toWorld({ x: 12, y: VB.h - 12 }), hi = toWorld({ x: VB.w - 12, y: 12 });
  const w = { x: clampTo(world.x, lo.x, hi.x), y: clampTo(world.y, lo.y, hi.y) };
  const distPx = Math.hypot(w.x - pivot.x, w.y - pivot.y) * PX_PER_M;
  if (distPx < R_DRAG_MIN_PX) return null;
  return { x: w.x, y: w.y };
}
