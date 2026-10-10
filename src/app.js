import { createState } from './state.js';
import { STEPS, STEP_LABELS, deriveStep, instruction, controlsView } from './steps.js';
import { createScene } from './scene.js';
import { createPanel } from './panel.js';
import { createInteraction } from './interact.js';

const state = createState();
let drag = null;

const els = {
  scene: document.getElementById('scene-svg'),
  panel: document.getElementById('panel'),
  steps: document.getElementById('steps'),
  instruction: document.getElementById('instruction'),
  answers: Array.from(document.querySelectorAll('[data-answer]')),
  back: document.getElementById('back'),
  newProblem: document.getElementById('new-problem'),
  replay: document.getElementById('replay'),
  sameForce: document.getElementById('same-force')
};

const scene = createScene(els.scene);
const panel = createPanel(els.panel);
createInteraction(els.scene, state, {
  onDrag: kind => {
    drag = kind;
    renderAll(state.getState());
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
  const t = instruction(step, s);                     // inside an aria-live region: only touch it when it changes
  if (els.instruction.textContent !== t) els.instruction.textContent = t;

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
els.newProblem.addEventListener('click', () => state.reset());
els.sameForce.addEventListener('click', () => state.sameForceNewPivot());
els.replay.addEventListener('click', () => scene.replay());

state.subscribe(renderAll);
renderAll(state.getState());

export { state, els, renderAll };
