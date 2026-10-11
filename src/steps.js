import { derive, PREDICTIONS } from './state.js';
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

// `locks` are the size and direction a link fixed (null = free); the default is today's wording.
export function instruction(step, s, locks = { mag: null, angle: null }) {
  const d = derive(s);
  switch (step) {
    case 'place':
      return locks.mag !== null && locks.angle !== null
        ? 'Click the beam where the force acts. The link fixes its size and direction.'
        : 'Click the beam where the force acts.';
    case 'aim': {
      const magLocked = locks.mag !== null, angleLocked = locks.angle !== null;
      if (magLocked && angleLocked) return 'Press the force point to apply the force. The link fixes its size and direction.';
      if (magLocked) return `Drag away from that point to set the force’s direction. Its size is fixed at ${fmt(locks.mag)} N.`;
      if (angleLocked) return `Drag away from that point to set the force’s size. Its direction is fixed at ${fmt(locks.angle)}°.`;
      return 'Drag away from that point to set the force’s direction and size. It snaps to common angles.';
    }
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

// Which controls are enabled, marked or hidden, for this state on this step. Pure, so every
// rule is tested; app.js only applies the fields.
//   - the three answers can be pressed only in the predict step;
//   - the picked answer is selected, and right or wrong once the torque is known;
//   - Back and New problem do nothing on an empty board, so they are disabled there;
//   - 'Same force, new pivot' exists only in the reveal; Replay too, but a zero torque has
//     no swing to replay, so there it stays hidden.
export function controlsView(s, step) {
  const d = derive(s);
  const answers = {};
  for (const key of PREDICTIONS) {
    const picked = s.prediction === key;
    answers[key] = {
      disabled: step !== 'predict',
      selected: picked,
      right: picked && d.correct === true,
      wrong: picked && d.correct === false
    };
  }
  return {
    answers,
    backDisabled: !s.forcePoint,
    newProblemDisabled: !s.forcePoint,
    replayHidden: step !== 'reveal' || d.truth === 'zero',
    sameForceHidden: step !== 'reveal'
  };
}
