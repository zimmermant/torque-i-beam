import { createState } from './state.js';
import { STEPS, STEP_LABELS, deriveStep, instruction, controlsView } from './steps.js';
import { createScene } from './scene.js';
import { createPanel } from './panel.js';
import { createInteraction } from './interact.js';
import { parsePresets, createPresets } from './presets.js';

const state = createState();
const presets = createPresets(parsePresets(window.location.search));   // optional URL presets; see README
let drag = null;

const els = {
  scene: document.getElementById('scene-svg'),
  panel: document.getElementById('panel'),
  steps: document.getElementById('steps'),
  instruction: document.getElementById('instruction'),
  fromLink: document.getElementById('from-link'),
  answers: Array.from(document.querySelectorAll('[data-answer]')),
  back: document.getElementById('back'),
  newProblem: document.getElementById('new-problem'),
  replay: document.getElementById('replay'),
  sameForce: document.getElementById('same-force')
};

const scene = createScene(els.scene);
const panel = createPanel(els.panel);

// The only state subscriber. A pending pivot from the link is applied once the step reaches 'pivot'
// with no drag in progress; that change notifies and re-enters here, and THAT call renders. The outer
// call must not render too: its snapshot is stale, and drawing it last would overwrite the newer one.
function sync() {
  if (presets.settle(state, drag)) return;   // settle changed the state; that change calls sync again, which renders
  renderAll(state.getState());
}

createInteraction(els.scene, state, {
  onDrag: kind => {
    drag = kind;
    sync();
  },
  lockAim: aim => presets.lockAim(aim),
  // Both size and direction fixed by the link: the press that has a force point completes the force.
  completeLocked: () => {
    if (!presets.bothLocked()) return false;
    const L = presets.getLocks();
    const s = state.getState();
    if (!s.forcePoint) return false;
    state.setForce({ mag: L.mag, angle: L.angle });
    return true;
  }
});

const stepItems = STEPS.map(key => {
  const li = document.createElement('li');
  li.textContent = STEP_LABELS[key];
  els.steps.appendChild(li);
  return li;
});

function renderAll(s) {
  const step = deriveStep(s, drag);
  scene.render(s, { step, drag });
  panel.render(s, step);
  const t = instruction(step, s, presets.getLocks());                   // inside an aria-live region: only touch it when it changes
  if (els.instruction.textContent !== t) els.instruction.textContent = t;
  const link = presets.summary();
  if (els.fromLink.textContent !== link) els.fromLink.textContent = link;
  els.fromLink.hidden = link === '';

  const at = STEPS.indexOf(step);
  stepItems.forEach((li, i) => {
    li.className = i < at ? 'is-done' : i === at ? 'is-current' : 'is-next';
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });

  const v = controlsView(s, step);
  for (const b of els.answers) {
    const a = v.answers[b.dataset.answer];
    b.disabled = a.disabled;
    b.classList.toggle('is-selected', a.selected);
    b.classList.toggle('is-right', a.right);
    b.classList.toggle('is-wrong', a.wrong);
    b.setAttribute('aria-pressed', String(a.selected));
  }
  els.back.disabled = v.backDisabled;
  els.newProblem.disabled = v.newProblemDisabled;
  els.replay.hidden = v.replayHidden;
  els.sameForce.hidden = v.sameForceHidden;
}

for (const b of els.answers) b.addEventListener('click', () => state.setPrediction(b.dataset.answer));
els.back.addEventListener('click', () => state.back());
els.newProblem.addEventListener('click', () => {
  presets.clear();      // first: the reset below renders, and must render a blank problem
  state.reset();
});
els.sameForce.addEventListener('click', () => state.sameForceNewPivot());
els.replay.addEventListener('click', () => scene.replay());

presets.start(state);
state.subscribe(sync);
sync();

export { state, els, renderAll };
