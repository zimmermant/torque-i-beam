import { hitBeam, toWorld, aimFromPointer, leverTipFromPointer } from './geometry.js';
import { deriveStep } from './steps.js';
import { clientToSvg } from './svg.js';

// What a press does, decided from the step, the handle under the pointer (if any)
// and where it landed. Pure, so every row of the table can be tested.
//   'place' -> set the force point and start aiming
//   'aim'   -> start aiming from the existing force point
//   'pivot' -> set the pivot and start drawing r
//   'draw'  -> start drawing r from the existing pivot (or its dragged tip)
//   'none'  -> nothing; in particular, the predict and reveal steps ignore the beam
export function decidePress({ step, handle, world }) {
  if (handle === 'force' && step === 'aim') return 'aim';
  if ((handle === 'pivot' || handle === 'rtip') && step === 'draw') return 'draw';
  if (!hitBeam(world)) return 'none';
  if (step === 'place' || step === 'aim') return 'place';
  if (step === 'pivot' || step === 'draw') return 'pivot';
  return 'none';
}

// Capture must be confirmed BEFORE a drag is latched. If it throws, a latched
// drag would be live but uncaptured: a pointerup outside the svg would never
// reach us, and a bare mouse move would keep dragging with no button held.
export function tryCapture(svg, pointerId) {
  try {
    svg.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

export function createInteraction(svg, state, hooks) {
  let drag = null;
  let dragPointerId = null;

  function setDrag(kind) {
    drag = kind;
    hooks.onDrag(kind);
  }

  function endDrag(e) {
    if (!drag || e.pointerId !== dragPointerId) return;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    dragPointerId = null;
    setDrag(null);
  }

  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;                       // right and middle clicks never drag
    const handleEl = e.target.closest ? e.target.closest('[data-h]') : null;
    const world = toWorld(clientToSvg(svg, e.clientX, e.clientY));
    const step = deriveStep(state.getState(), drag);
    const action = decidePress({
      step, handle: handleEl ? handleEl.getAttribute('data-h') : null, world
    });
    if (action === 'none') return;
    if (!tryCapture(svg, e.pointerId)) return;        // no capture, no drag
    e.preventDefault();
    dragPointerId = e.pointerId;
    if (action === 'place') {
      state.setForcePoint(world);
      setDrag('force');
    } else if (action === 'aim') {
      setDrag('force');
    } else if (action === 'pivot') {
      state.setPivot(world);
      if (state.getState().rTip) {                    // pivot on the force point: r = 0, nothing to draw
        svg.releasePointerCapture(e.pointerId);
        dragPointerId = null;
        return;
      }
      setDrag('r');
    } else {
      setDrag('r');
    }
  });

  svg.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== dragPointerId) return;
    const world = toWorld(clientToSvg(svg, e.clientX, e.clientY));
    const s = state.getState();
    if (drag === 'force') state.setForce(aimFromPointer(s.forcePoint, world));
    else state.setRTip(leverTipFromPointer(s.pivot, world));
  });

  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);

  return { getDrag: () => drag };
}
