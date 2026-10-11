import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VB } from '../src/geometry.js';
import { PREDICTIONS } from '../src/state.js';

// index.template.html hard-codes the scene's viewBox because a template cannot
// import a JS constant, and app.js looks up its elements by id. These read the raw
// sources and make the two sides agree.
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'src', 'index.template.html'), 'utf8');
const appJs = readFileSync(join(here, '..', 'src', 'app.js'), 'utf8');

// Mutation: change the template's viewBox to "0 0 961 560".
test('the scene viewBox matches geometry.js VB', () => {
  assert.match(html, new RegExp(`id="scene-svg"[^>]*viewBox="0 0 ${VB.w} ${VB.h}"`));
});

// Mutation: rename any id in the template (e.g. id="back" -> id="go-back").
test('every id app.js looks up exists in the template', () => {
  const ids = [...appJs.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(ids.length >= 8, `found only ${ids.length} getElementById calls`);
  for (const id of ids) assert.match(html, new RegExp(`id="${id}"`), `template has no id="${id}"`);
});

test('there is a prediction button for each answer the state accepts, and no other', () => {
  const answers = [...html.matchAll(/data-answer="([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(answers.sort(), [...PREDICTIONS].sort());
});

test('the three answers are worded as the spec words them', () => {
  assert.match(html, /Clockwise \(&minus;\)/);
  assert.match(html, /Counterclockwise \(\+\)/);
  assert.match(html, /Neither \(&tau; = 0\)/);
});

test('Replay and Same force, new pivot start hidden: they belong to the reveal only', () => {
  assert.match(html, /id="replay" hidden/);
  assert.match(html, /id="same-force" hidden/);
});

test('the page declares both inline markers the build replaces, and loads nothing external', () => {
  assert.ok(html.includes('<!--INLINE_CSS-->') && html.includes('<!--INLINE_JS-->'));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|https?:\/\//.test(html));
});

// Mutation: remove `hidden` from the new line, or move it above the instruction.
test('the "From the link" line exists, starts hidden, and sits right after the instruction', () => {
  assert.match(html, /<p id="instruction"[^>]*><\/p>\s*<p id="from-link" class="from-link" hidden><\/p>/);
});

// app.js has no DOM-free test, so its URL-preset wiring is pinned as text (the behaviour itself is
// checked in the real page). Each mutation swaps one wiring line.
// Mutation: state.subscribe(renderAll) comes back, so a pivot settled mid-notification is drawn
// over by the older, stale render.
test('app.js: sync is the only subscriber, it settles before it renders, and start runs first', () => {
  assert.match(appJs, /function sync\(\) \{\s*if \(presets\.settle\(state, drag\)\) return;[^\n]*\n\s*renderAll\(state\.getState\(\)\);\s*\}/);
  assert.match(appJs, /presets\.start\(state\);\s*state\.subscribe\(sync\);\s*sync\(\);/);
  assert.ok(!/state\.subscribe\(renderAll\)/.test(appJs));
  assert.strictEqual((appJs.match(/state\.subscribe\(/g) || []).length, 1, 'one subscriber');
  assert.match(appJs, /onDrag: kind => \{\s*drag = kind;\s*sync\(\);/);
});

// Mutation: reset first, clear second. The reset renders the old summary, and the clear that
// follows does not re-render, so "From the link" would stay on a blank problem.
test('app.js: New problem clears the presets BEFORE it resets the state', () => {
  assert.match(appJs, /els\.newProblem\.addEventListener\('click', \(\) => \{\s*presets\.clear\(\);[^\n]*\n\s*state\.reset\(\);\s*\}\);/);
});

// Mutations: the locks are not handed to instruction(); the summary line is never shown or never
// hidden; the interaction is not given the two hooks.
test('app.js: the render passes the locks and the summary, and the interaction gets both hooks', () => {
  assert.match(appJs, /instruction\(step, s, presets\.getLocks\(\)\)/);
  assert.match(appJs, /els\.fromLink\.textContent = link;/);
  assert.match(appJs, /els\.fromLink\.hidden = link === '';/);
  assert.match(appJs, /createPresets\(parsePresets\(window\.location\.search\)\)/);
  assert.match(appJs, /lockAim: aim => presets\.lockAim\(aim\)/);
  assert.match(appJs, /completeLocked: \(\) => \{\s*if \(!presets\.bothLocked\(\)\) return false;/);
});
