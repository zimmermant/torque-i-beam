import { derive } from './state.js';
import { fmt } from './format.js';

export const STEPS = ['place', 'aim', 'pivot', 'draw', 'predict', 'reveal'];
export const STEP_LABELS = {
  place: 'Place force', aim: 'Aim force', pivot: 'Pivot',
  draw: 'Lever arm r', predict: 'Predict', reveal: 'Result'
};

// Which step the student is on, derived from which inputs exist. `drag` is the
// transient gesture in progress ('force', 'r' or null): while dragging, the
// step stays put even though the value being dragged already exists, so the
// instruction does not flip mid-gesture.
export function deriveStep(s, drag) {
  if (!s.forcePoint) return 'place';
  if (drag === 'force' || !s.force) return 'aim';
  if (!s.pivot) return 'pivot';
  if (drag === 'r') return 'draw';
  if (!s.rTip || !derive(s).rValid) return 'draw';
  if (!s.prediction) return 'predict';
  return 'reveal';
}

const TURN_WORD = { ccw: 'counterclockwise', cw: 'clockwise' };

export function instruction(step, s) {
  const d = derive(s);
  switch (step) {
    case 'place':
      return 'Click the beam where the force acts.';
    case 'aim':
      return 'Drag away from that point to set the force\'s direction and size. It snaps to common angles.';
    case 'pivot':
      return 'Click the beam to choose the pivot.';
    case 'draw':
      return s.rTip && !d.rValid
        ? 'r should end where the force acts — drag its tip onto the force point.'
        : 'Drag from the pivot to the force point to draw the lever arm r.';
    case 'predict':
      return d.r.x === 0 && d.r.y === 0
        ? 'The pivot is at the force point, so r = 0 and τ = 0. Predict the rotation.'
        : 'Will the beam turn clockwise (−), counterclockwise (+), or not at all?';
    case 'reveal': {
      const verdict = d.correct ? 'Correct.' : 'Not quite.';
      return d.truth === 'zero'
        ? `${verdict} The torque is 0 N·m, so the beam does not rotate.`
        : `${verdict} The torque is ${fmt(d.tau)} N·m, so the beam turns ${TURN_WORD[d.truth]}.`;
    }
    default:
      return '';
  }
}
