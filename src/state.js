import { snapAngle, snapMagnitude, components, torqueZ, classify } from './physics.js';
import { snapToGrid, R_SNAP_M } from './geometry.js';

// The ONLY stored state is these five inputs. Everything else -- the force's
// components, the snapped r, whether it is valid, the torque, the verdict, and
// even which step the student is on -- is derived on read, so no two panels can
// disagree and the step can never drift out of sync with the data.
function samePoint(a, b) {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

function sameForce(a, b) {
  if (a === null || b === null) return a === b;
  return a.mag === b.mag && a.angle === b.angle;
}

function copyPoint(p) {
  return p === null ? null : { x: p.x, y: p.y };
}

export const PREDICTIONS = ['cw', 'ccw', 'zero'];

// Pure. Takes the stored inputs, returns everything computed from them.
//   r is the vector from the pivot to the force point, or -- when the dragged
//   tip is not within R_SNAP_M of the force point -- to the raw tip, flagged
//   invalid so the prediction stays locked.
export function derive(s) {
  const F = s.force ? components(s.force.mag, s.force.angle) : null;
  let r = null;
  let rValid = false;
  if (s.pivot && s.rTip && s.forcePoint) {
    const gap = Math.hypot(s.rTip.x - s.forcePoint.x, s.rTip.y - s.forcePoint.y);
    rValid = gap <= R_SNAP_M;
    const tip = rValid ? s.forcePoint : s.rTip;
    r = { x: tip.x - s.pivot.x + 0, y: tip.y - s.pivot.y + 0 };
  }
  const tau = rValid && F ? torqueZ(r, F) : null;
  const truth = tau === null ? null : classify(tau);
  const correct = truth !== null && s.prediction !== null ? s.prediction === truth : null;
  return { F, r, rValid, tau, truth, correct };
}

export function createState() {
  let forcePoint = null;
  let force = null;
  let pivot = null;
  let rTip = null;
  let prediction = null;
  let subscribers = [];

  function getState() {
    return {
      forcePoint: copyPoint(forcePoint),
      force: force === null ? null : { mag: force.mag, angle: force.angle },
      pivot: copyPoint(pivot),
      rTip: copyPoint(rTip),
      prediction
    };
  }

  function notify() {
    const snapshot = getState();
    for (const fn of subscribers.slice()) fn(snapshot);
  }

  // Moving the force point restarts everything downstream of it.
  function setForcePoint(world) {
    const v = snapToGrid(world);
    if (samePoint(v, forcePoint)) return;
    forcePoint = v;
    force = null;
    pivot = null;
    rTip = null;
    prediction = null;
    notify();
  }

  // null un-aims the force (a drag that came back below the minimum length).
  function setForce(f) {
    const v = f === null ? null : { mag: snapMagnitude(f.mag), angle: snapAngle(f.angle) };
    if (!forcePoint || sameForce(v, force)) return;
    force = v;
    notify();
  }

  // A pivot on the force point's own grid point makes r zero by construction,
  // so the state sets the tip itself and the student goes straight to predict.
  function setPivot(world) {
    if (!forcePoint || !force) return;
    const v = snapToGrid(world);
    const nextTip = samePoint(v, forcePoint) ? copyPoint(forcePoint) : null;
    if (samePoint(v, pivot) && samePoint(nextTip, rTip) && prediction === null) return;
    pivot = v;
    rTip = nextTip;
    prediction = null;
    notify();
  }

  function setRTip(world) {
    if (!pivot) return;
    const v = world === null ? null : { x: world.x, y: world.y };
    if (samePoint(v, rTip)) return;
    rTip = v;
    prediction = null;
    notify();
  }

  // Locked until r is valid; one of the three answers.
  function setPrediction(p) {
    if (p !== null && !PREDICTIONS.includes(p)) return;
    if (p !== null && !derive(getState()).rValid) return;
    if (p === prediction) return;
    prediction = p;
    notify();
  }

  // Clear the most recent input. A pivot placed on the force point carries its
  // own auto-set tip, so both go together.
  function back() {
    if (prediction !== null) prediction = null;
    else if (rTip !== null) {
      const auto = samePoint(pivot, forcePoint);
      rTip = null;
      if (auto) pivot = null;
    }
    else if (pivot !== null) pivot = null;
    else if (force !== null) force = null;
    else if (forcePoint !== null) forcePoint = null;
    else return;
    notify();
  }

  function sameForceNewPivot() {
    if (pivot === null && rTip === null && prediction === null) return;
    pivot = null;
    rTip = null;
    prediction = null;
    notify();
  }

  function reset() {
    if (!forcePoint && !force && !pivot && !rTip && !prediction) return;
    forcePoint = null;
    force = null;
    pivot = null;
    rTip = null;
    prediction = null;
    notify();
  }

  function subscribe(fn) {
    subscribers.push(fn);
    return () => { subscribers = subscribers.filter(f => f !== fn); };
  }

  return {
    getState, setForcePoint, setForce, setPivot, setRTip, setPrediction,
    back, sameForceNewPivot, reset, subscribe
  };
}
