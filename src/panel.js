import { derive } from './state.js';
import { polar, detentAt } from './physics.js';
import { fmt, fmtAngle, vecText, parenthesized, K_HAT } from './format.js';

// The side panel as a pure string, so a test can check it without a DOM.
// Every number is built from derive() and formatted by fmt(), which is the only
// place a value is rounded. Nothing interpolated here is user text, so there is
// nothing to escape.
function row(label, value, cls) {
  return `<div class="row${cls ? ' ' + cls : ''}"><span class="k">${label}</span>` +
         `<span class="v">${value}</span></div>`;
}

function card(title, rows, extra) {
  return `<section class="card${extra ? ' ' + extra : ''}"><h3>${title}</h3>${rows.join('')}</section>`;
}

function point(p) {
  return p ? `(${fmt(p.x)}, ${fmt(p.y)}) m` : '—';
}

function forceCard(s, d) {
  const triple = s.force ? detentAt(s.force.angle) : null;
  const badge = triple && triple.kind === 'triple'
    ? ' <span class="badge">3-4-5</span>' : '';
  return card('Force <b>F</b>', [
    row('|F|', s.force ? `${fmt(s.force.mag)} N` : '—'),
    row('&theta;<sub>F</sub>', (s.force ? fmtAngle(s.force.angle) : '—') + badge),
    row('F', d.F ? vecText(d.F, 'N') : '—'),
    row('Applied at', point(s.forcePoint))
  ]);
}

function pivotCard(s) {
  return card('Pivot', [row('Pivot at', point(s.pivot))]);
}

function leverCard(s, d) {
  const p = d.r ? polar(d.r) : null;
  let status = '—';
  let cls = '';
  if (s.rTip && d.rValid) {
    status = d.r.x === 0 && d.r.y === 0
      ? 'r = 0: the pivot is at the force point'
      : 'ends at the force point';
    cls = 'ok';
  } else if (s.rTip) {
    status = 'not at the force point yet';
    cls = 'warn';
  }
  return card('Lever arm <b>r</b>', [
    row('|r|', p ? `${fmt(p.mag)} m` : '—'),
    row('&theta;<sub>r</sub>', p ? fmtAngle(p.angle) : '—'),
    row('r', d.r ? vecText(d.r, 'm') : '—'),
    row('Status', status, cls)
  ], !d.rValid && s.rTip ? 'card--warn' : '');
}

const SENSE_TEXT = {
  ccw: 'counterclockwise (out of the page)',
  cw: 'clockwise (into the page)',
  zero: 'no rotation'
};
const ANSWER_TEXT = { ccw: 'counterclockwise (+)', cw: 'clockwise (−)', zero: 'neither (τ = 0)' };

function torqueCard(s, d, step) {
  if (step !== 'reveal') return card('Torque <b>&tau;</b>', [row('&tau;', '?')]);
  const calc = `<div class="calc">` +
    `<div>&tau; = r<sub>x</sub>F<sub>y</sub> − r<sub>y</sub>F<sub>x</sub></div>` +
    `<div>= ${parenthesized(d.r.x)}·${parenthesized(d.F.y)} − ${parenthesized(d.r.y)}·${parenthesized(d.F.x)}</div>` +
    `<div>= ${fmt(d.tau)} N·m</div>` +
    `<div class="calc-k">&tau; = ${fmt(d.tau)} ${K_HAT} N·m</div></div>`;
  const rows = [
    calc,
    row('Sense', SENSE_TEXT[d.truth]),
    row('Your prediction', `${ANSWER_TEXT[s.prediction]} — ${d.correct ? 'correct' : 'not quite'}`, d.correct ? 'ok' : 'warn')
  ];
  rows.push(`<p class="note">Numbers are rounded to two decimals for display; the verdict uses the unrounded values.</p>`);
  return card('Torque <b>&tau;</b>', rows, 'card--result');
}

export function panelHtml(s, step) {
  const d = derive(s);
  return forceCard(s, d) + pivotCard(s) + leverCard(s, d) + torqueCard(s, d, step);
}

export function createPanel(node) {
  function render(s, step) {
    node.innerHTML = panelHtml(s, step);
  }
  return { render };
}
