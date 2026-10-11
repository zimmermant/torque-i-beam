export const DEG = Math.PI / 180;
export const MAG_MIN = 10;
export const MAG_MAX = 100;

// A torque smaller than this is "zero". Verified by sweep over every reachable
// state (test/physics.test.js): genuine zeros are below 2.2e-14 N.m and the
// smallest real torque is 0.335 N.m, so nothing sits anywhere near this line.
export const TAU_EPS = 1e-9;

export function normalizeAngle(deg) {
  return (((deg % 360) + 360) % 360) + 0;
}

// Shortest way round the circle between two angles, in [0, 180].
export function circDist(a, b) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > 180 ? 360 - d : d;
}

// The 24 directions a force can point: the four axes, 30/45/60 mirrored into
// every quadrant, and the two 3-4-5 angles (36.87, 53.13) likewise.
//   axis   -> ux, uy: the exact unit vector, so cos(90) = 6e-17 never appears
//   triple -> run, rise, hyp and the signs sx, sy of the quadrant, so the
//             components are (m*run)/hyp -- multiply first, then divide
function buildDetents() {
  const out = [];
  out.push({ angle: 0,   kind: 'axis', ux: 1,  uy: 0 });
  out.push({ angle: 90,  kind: 'axis', ux: 0,  uy: 1 });
  out.push({ angle: 180, kind: 'axis', ux: -1, uy: 0 });
  out.push({ angle: 270, kind: 'axis', ux: 0,  uy: -1 });
  for (const base of [30, 45, 60]) {
    for (const a of [base, 180 - base, 180 + base, 360 - base]) {
      out.push({ angle: a, kind: 'standard' });
    }
  }
  const triples = [
    { base: Math.atan2(3, 4) / DEG, run: 4, rise: 3 },   // 36.87 deg
    { base: Math.atan2(4, 3) / DEG, run: 3, rise: 4 }    // 53.13 deg
  ];
  for (const t of triples) {
    const shape = { kind: 'triple', run: t.run, rise: t.rise, hyp: 5 };
    out.push({ angle: t.base,       ...shape, sx: 1,  sy: 1 });
    out.push({ angle: 180 - t.base, ...shape, sx: -1, sy: 1 });
    out.push({ angle: 180 + t.base, ...shape, sx: -1, sy: -1 });
    out.push({ angle: 360 - t.base, ...shape, sx: 1,  sy: -1 });
  }
  return out.sort((a, b) => a.angle - b.angle);
}

export const DETENTS = buildDetents();

// The detent sitting exactly at this angle, or null. Exact (1e-9), not a
// tolerance: only snapAngle's output lands on a detent.
export function detentAt(angle) {
  for (const d of DETENTS) {
    if (circDist(d.angle, angle) < 1e-9) return d;
  }
  return null;
}

// Nearest detent, going the short way round the circle. On a tie the lower
// angle wins.
export function snapAngle(deg) {
  if (!Number.isFinite(deg)) return 0;
  let best = DETENTS[0];
  let bestDist = circDist(DETENTS[0].angle, deg);
  for (const d of DETENTS) {
    const dist = circDist(d.angle, deg);
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best.angle;
}

export function snapMagnitude(m) {
  if (!Number.isFinite(m)) return MAG_MIN;
  return Math.min(MAG_MAX, Math.max(MAG_MIN, Math.round(m)));
}

// Cartesian components of a force. Exact at the axes and at the 3-4-5 detents;
// the `+ 0` turns a negative zero into a plain zero.
export function components(mag, angle) {
  const d = detentAt(angle);
  let x, y;
  if (d && d.kind === 'axis') {
    x = d.ux * mag;
    y = d.uy * mag;
  } else if (d && d.kind === 'triple') {
    x = d.sx * (mag * d.run) / d.hyp;
    y = d.sy * (mag * d.rise) / d.hyp;
  } else {
    x = mag * Math.cos(angle * DEG);
    y = mag * Math.sin(angle * DEG);
  }
  return { x: x + 0, y: y + 0 };
}

// Magnitude and angle of a vector. A zero vector has no angle.
export function polar(v) {
  const mag = Math.hypot(v.x, v.y);
  return { mag, angle: mag === 0 ? null : normalizeAngle(Math.atan2(v.y, v.x) / DEG) };
}

// The k-hat component of r x F. Counterclockwise is positive.
export function torqueZ(r, F) {
  return r.x * F.y - r.y * F.x + 0;
}

export function classify(tau) {
  if (Math.abs(tau) < TAU_EPS) return 'zero';
  return tau > 0 ? 'ccw' : 'cw';
}
