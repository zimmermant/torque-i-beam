import { snapToGrid } from './geometry.js';
import { snapMagnitude, snapAngle, circDist } from './physics.js';
import { fmt, fmtAngle } from './format.js';
import { deriveStep } from './steps.js';

// Optional URL parameters that preset a problem:
//   fp=x[,y]  force location (m)     mag=N  force magnitude (N)
//   angle=deg force direction        pivot=x[,y]  pivot location (m)
// Presets are UI-layer configuration held OUTSIDE the state: the state keeps its five inputs.
// Every value goes through the same snapping as a click or a drag, and a change is reported.

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;      // no exponent, no hex, no empty
const ANGLE_TOL = 0.01;                          // degrees: typing 53.13 for the 3-4-5 detent is not a change
const ORDER = ['fp', 'mag', 'angle', 'pivot'];
const HINTS = {
  fp: 'use x,y in metres', mag: 'use a number of newtons',
  angle: 'use degrees', pivot: 'use x,y in metres'
};

function parseNumber(text) {
  const t = text.trim();
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;          // 400 digits overflow to Infinity
}

// "x" or "x,y"; y omitted means 0.
function parseLocation(text) {
  const parts = text.split(',');
  if (parts.length > 2) return null;
  const x = parseNumber(parts[0]);
  const y = parts.length === 2 ? parseNumber(parts[1]) : 0;
  return x === null || y === null ? null : { x, y };
}

function locText(p) {
  return `(${fmt(p.x)}, ${fmt(p.y)})`;
}

// Each reader returns false when the text does not parse; otherwise it stores the snapped value
// in out[name] and, if snapping changed it, a note in out.adjusted.
function readLocation(name, text, out) {
  const v = parseLocation(text);
  if (v === null) return false;
  const s = snapToGrid(v);
  out[name] = s;
  if (s.x !== v.x || s.y !== v.y) out.adjusted.push(`${name} ${locText(v)} → ${locText(s)}`);
  return true;
}

function readMag(name, text, out) {
  const n = parseNumber(text);
  if (n === null) return false;
  const s = snapMagnitude(n);
  out.mag = s;
  if (s !== n) out.adjusted.push(`mag ${fmt(n)} → ${fmt(s)}`);
  return true;
}

function readAngle(name, text, out) {
  const n = parseNumber(text);
  if (n === null) return false;
  const s = snapAngle(n);
  out.angle = s;
  if (circDist(n, s) > ANGLE_TOL) out.adjusted.push(`angle ${fmt(n)} → ${fmt(s)}`);
  return true;
}

const READERS = { fp: readLocation, mag: readMag, angle: readAngle, pivot: readLocation };

export function parsePresets(search) {
  const q = new URLSearchParams(search || '');
  const out = { fp: null, mag: null, angle: null, pivot: null, adjusted: [], ignored: [] };
  for (const name of ORDER) {
    const raw = q.get(name);                      // the first duplicate wins; a missing key is null
    if (raw === null) continue;
    if (!READERS[name](name, raw, out)) out.ignored.push(`${name}=${raw} (${HINTS[name]})`);
  }
  return out;
}

export function describePresets(p) {
  const set = [];
  if (p.fp) set.push(`force at ${locText(p.fp)} m`);
  if (p.mag !== null) set.push(`${fmt(p.mag)} N`);
  if (p.angle !== null) set.push(fmtAngle(p.angle));
  if (p.pivot) set.push(`pivot at ${locText(p.pivot)} m`);
  if (!set.length && !p.adjusted.length && !p.ignored.length) return '';
  let text = `From the link: ${set.length ? set.join(', ') : 'nothing set'}.`;
  if (p.adjusted.length) text += ` Adjusted: ${p.adjusted.join('; ')}.`;
  if (p.ignored.length) text += ` Ignored: ${p.ignored.join('; ')}.`;
  return text;
}

// The controller app.js holds. `parsed` is never written to: the locks, the pending pivot and the
// summary are this closure's own copies.
export function createPresets(parsed) {
  let locks = { mag: parsed.mag, angle: parsed.angle };
  let pending = parsed.pivot ? { x: parsed.pivot.x, y: parsed.pivot.y } : null;
  let summaryText = describePresets(parsed);

  return {
    getLocks: () => ({ mag: locks.mag, angle: locks.angle }),
    bothLocked: () => locks.mag !== null && locks.angle !== null,
    summary: () => summaryText,

    // Load-time presets. The pivot is NOT applied here: it waits for settle().
    start(state) {
      if (parsed.fp) state.setForcePoint(parsed.fp);
      if (parsed.fp && parsed.mag !== null && parsed.angle !== null) {
        state.setForce({ mag: parsed.mag, angle: parsed.angle });
      }
    },

    // Apply the pending pivot once, at the moment the derived step is 'pivot' (force point and force
    // exist, no pivot) and no drag is in progress: mid-drag, a short wobble would un-aim the force
    // and clear it. Returns true when it changed the state (that change notifies, and the caller's
    // subscriber renders the result).
    settle(state, drag) {
      if (!pending || deriveStep(state.getState(), drag) !== 'pivot') return false;
      const p = pending;
      pending = null;
      state.setPivot(p);
      return true;
    },

    // New problem: a fully normal blank problem. Reloading the link restores the setup.
    clear() {
      locks = { mag: null, angle: null };
      pending = null;
      summaryText = '';
    },

    // `aim` is aimFromPointer's result. A too-short drag (null) stays "not aimed".
    lockAim(aim) {
      if (aim === null) return null;
      return { mag: locks.mag ?? aim.mag, angle: locks.angle ?? aim.angle };
    }
  };
}
