import { createState, derive } from './state.js';
import { STEPS, STEP_LABELS, deriveStep, instruction } from './steps.js';
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
  const d = derive(s);
  scene.render(s, { step, drag });
  panel.render(s, step);
  els.instruction.textContent = instruction(step, s);

  const at = STEPS.indexOf(step);
  stepItems.forEach((li, i) => {
    li.className = i < at ? 'is-done' : i === at ? 'is-current' : 'is-next';
    if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });

  for (const b of els.answers) {
    const picked = s.prediction === b.dataset.answer;
    b.disabled = step !== 'predict';
    b.classList.toggle('is-selected', picked);
    b.classList.toggle('is-right', picked && d.correct === true);
    b.classList.toggle('is-wrong', picked && d.correct === false);
    b.setAttribute('aria-pressed', String(picked));
  }
  const empty = !s.forcePoint;
  els.back.disabled = empty;
  els.newProblem.disabled = empty;
  els.replay.hidden = step !== 'reveal';
  els.sameForce.hidden = step !== 'reveal';
}

for (const b of els.answers) b.addEventListener('click', () => state.setPrediction(b.dataset.answer));
els.back.addEventListener('click', () => state.back());
els.newProblem.addEventListener('click', () => state.reset());
els.sameForce.addEventListener('click', () => state.sameForceNewPivot());
els.replay.addEventListener('click', () => scene.replay());

state.subscribe(renderAll);
renderAll(state.getState());

export { state, els, renderAll };
