import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, derive } from '../src/state.js';
import { DETENTS, components, snapAngle, MAG_MIN, MAG_MAX } from '../src/physics.js';
import { fmt, vecText, I_HAT, J_HAT, K_HAT } from '../src/format.js';
import { panelHtml } from '../src/panel.js';
import { deriveStep } from '../src/steps.js';

const T = Math.atan2(4, 3) * 180 / Math.PI;

function build(fp, force, pivot, tip, prediction) {
  const st = createState();
  if (fp) st.setForcePoint(fp);
  if (force) st.setForce(force);
  if (pivot) st.setPivot(pivot);
  if (tip) st.setRTip(tip);
  if (prediction) st.setPrediction(prediction);
  return st.getState();
}
const html = (s, step) => panelHtml(s, step === undefined ? deriveStep(s, null) : step);

test('an empty state shows a dash for every quantity and "?" for the torque', () => {
  const h = html(build());
  assert.ok(h.includes('—'));
  assert.ok(h.includes('<span class="v">?</span>'));
  assert.ok(!h.includes('NaN') && !h.includes('undefined') && !h.includes('null'));
  assert.strictEqual((h.match(/<section class="card/g) || []).length, 4);
});

test('the force card quotes magnitude, angle and the i-hat / j-hat vector', () => {
  const h = html(build({ x: 1, y: 0 }, { mag: 50, angle: T }));
  assert.ok(h.includes('50 N'));
  assert.ok(h.includes('53.13°'));
  assert.ok(h.includes(`30 ${I_HAT} + 40 ${J_HAT} N`), 'the 3-4-5 force must read exactly 30 i + 40 j');
  assert.ok(h.includes('(1, 0) m'));
  assert.ok(h.includes('class="badge">3-4-5<'), 'a 3-4-5 angle earns the badge');
});

test('a non-3-4-5 angle has no badge', () => {
  const h = html(build({ x: 1, y: 0 }, { mag: 50, angle: 45 }));
  assert.ok(!h.includes('badge'));
});

test('the lever card quotes |r|, theta_r and r, and says whether r reaches the force', () => {
  const ok = html(build({ x: 1, y: 0 }, { mag: 50, angle: 90 }, { x: -1, y: 0.25 }, { x: 1, y: 0 }));
  assert.ok(ok.includes(`2 ${I_HAT} − 0.25 ${J_HAT} m`), ok);
  assert.ok(ok.includes('ends at the force point'));
  assert.ok(ok.includes('class="row ok"'));
  assert.ok(ok.includes('<span class="k">|r|</span><span class="v">2.02 m</span>'), '|r| row');
  assert.ok(ok.includes('<span class="k">&theta;<sub>r</sub></span><span class="v">352.87\u00b0</span>'), 'theta_r row');
  assert.ok(!ok.includes('card--warn'), 'a valid r must not warn');
  const bad = html(build({ x: 1, y: 0 }, { mag: 50, angle: 90 }, { x: -1, y: 0 }, { x: 1.6, y: 0 }));
  assert.ok(bad.includes('not at the force point yet'));
  assert.ok(bad.includes('card--warn'));
});

test('r = 0 has no angle and says so', () => {
  const h = html(build({ x: 1, y: 0 }, { mag: 50, angle: 90 }, { x: 1, y: 0 }));
  assert.ok(h.includes('r = 0: the pivot is at the force point'));
  assert.ok(h.includes('<span class="k">&theta;<sub>r</sub></span><span class="v">—</span>'));
});

// Mutation: printing before the reveal (step !== 'reveal' check removed) shows
// the answer to a student who has not yet predicted.
test('the torque stays hidden until the reveal', () => {
  const s = build({ x: 1, y: 0 }, { mag: 40, angle: 90 }, { x: 0, y: 0 }, { x: 1, y: 0 });
  for (const step of ['place', 'aim', 'pivot', 'draw', 'predict']) {
    const h = panelHtml(s, step);
    assert.ok(h.includes('<span class="v">?</span>'), step);
    assert.ok(!h.includes(K_HAT), `${step} leaked the answer`);
  }
});

test('the reveal shows the worked cross product with the real numbers', () => {
  const s = build({ x: 1, y: 0 }, { mag: 40, angle: 90 }, { x: 0, y: 0 }, { x: 1, y: 0 }, 'ccw');
  const h = panelHtml(s, 'reveal');
  assert.ok(h.includes('r<sub>x</sub>F<sub>y</sub> − r<sub>y</sub>F<sub>x</sub>'));
  assert.ok(h.includes('= (1)·(40) − (0)·(0)'), h);
  assert.ok(h.includes('= 40 N·m'));
  assert.ok(h.includes(`40 ${K_HAT} N·m`));
  assert.ok(h.includes('counterclockwise (out of the page)'));
  assert.ok(h.includes('correct'));
  assert.ok(h.includes('rounded to two decimals'));
});

test('a negative torque is written with a true minus and goes into the page', () => {
  const s = build({ x: -1, y: 0 }, { mag: 40, angle: 90 }, { x: 0, y: 0 }, { x: -1, y: 0 }, 'ccw');
  const h = panelHtml(s, 'reveal');
  assert.ok(h.includes(`−40 ${K_HAT} N·m`));
  assert.ok(h.includes('clockwise (into the page)'));
  assert.ok(h.includes('not quite'));
  assert.ok(!h.includes('-40') && !h.includes('-0'), 'ASCII minus leaked into the panel');
});

test('zero torque reads 0, never -0, and says there is no rotation', () => {
  const s = build({ x: 1, y: 0 }, { mag: 40, angle: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 }, 'zero');
  const h = panelHtml(s, 'reveal');
  assert.ok(h.includes(`0 ${K_HAT} N·m`));
  assert.ok(h.includes('no rotation'));
  assert.ok(!/-0\b|−0\b/.test(h.replace(/− /g, '')), 'a negative zero printed');
});

// The worked arithmetic prints rounded components, so multiplying the printed
// numbers need not reproduce the printed result exactly. Sweep every reachable
// state and measure how far apart they can be; the note under the worked
// arithmetic is only honest if this stays small, and the verdict is only safe
// if it can never be big enough to change the sign.
// Measured worst case over every state: 0.0273 N.m (a 45-degree, 19 N force, r = (-5, 0.5)).
test('the printed arithmetic closes to within 0.03 N.m, and never flips the sign', () => {
  const round2 = v => Number(v.toFixed(2));
  let worst = 0;
  const ys = [-0.5, -0.25, 0, 0.25, 0.5];
  for (const dtn of DETENTS) {
    for (let m = MAG_MIN; m <= MAG_MAX; m++) {
      const F = components(m, dtn.angle);
      for (let i = -20; i <= 20; i++) for (const ry of ys) {
        const r = { x: i * 0.25, y: ry };
        const tau = r.x * F.y - r.y * F.x;
        const printed = round2(r.x) * round2(F.y) - round2(r.y) * round2(F.x);
        worst = Math.max(worst, Math.abs(printed - tau));
        if (Math.abs(tau) > 1e-9) assert.strictEqual(Math.sign(printed), Math.sign(tau), 'sign flipped');
      }
    }
  }
  assert.ok(worst < 0.03, `printed arithmetic is off by ${worst}`);
});

// The panel-level twin of the test above: it reads the numbers the PANEL PRINTS.
// Mutation: printing the components at 1 decimal, printing them unrounded, or
// swapping the two products in the worked line each change the printed operands,
// so the product of what is on screen no longer lands within 0.031 of the printed
// result. Measured worst case over these 2,304 states: 0.0300 N.m (45 degrees,
// 19 N, r = (-5, 0.5)); the printed result is itself rounded, which is why this
// bound is 0.031 and the physics-level one is 0.03.
test('the arithmetic the panel PRINTS closes to within 0.031 N.m of the result it prints, and never flips the sign', () => {
  const num = str => Number(str.replace('\u2212', '-'));
  const CALC = /<div>= \(([^)]*)\)\u00b7\(([^)]*)\) \u2212 \(([^)]*)\)\u00b7\(([^)]*)\)<\/div>/;
  const RESULT = /<div>= ([^<]*) N\u00b7m<\/div>/;
  const fps = [{ x: -2.5, y: 0.25 }, { x: 2.5, y: -0.25 }, { x: 0, y: 0 }, { x: 1.25, y: 0.25 }];
  const pivs = [{ x: 2.5, y: -0.25 }, { x: -2.5, y: 0.25 }, { x: 0, y: 0 }, { x: -1.25, y: -0.25 }, { x: 1.25, y: 0.25 }];
  let worst = 0, n = 0;
  for (const dtn of DETENTS) for (const mag of [10, 19, 37, 55, 82, 100]) for (const fp of fps) for (const pv of pivs) {
    if (fp.x === pv.x && fp.y === pv.y) continue;
    const s = build(fp, { mag, angle: dtn.angle }, pv, fp, 'cw');
    const h = panelHtml(s, 'reveal');
    const calc = CALC.exec(h), result = RESULT.exec(h);
    assert.ok(calc && result, `could not find the worked line @ ${dtn.angle} ${mag}`);
    const [rx, fy, ry, fx] = calc.slice(1).map(num);
    const product = rx * fy - ry * fx, printed = num(result[1]);
    worst = Math.max(worst, Math.abs(product - printed));
    if (Math.abs(printed) > 1e-9) assert.strictEqual(Math.sign(product), Math.sign(printed), 'sign flipped');
    n++;
  }
  assert.ok(n > 2000, `the sweep was too small: ${n}`);
  assert.ok(worst < 0.031, `the printed arithmetic is off by ${worst}`);
});

// Mutation: printing the result line from anything but fmt(derive().tau) -- for
// example fmt(tau) of a recomputed or rounded value -- or the F / r vector lines
// from anything but vecText(derive().F / .r).
test('the panel, the derive() result and the formatters all quote the same torque', () => {
  for (const ang of [0, 30, 45, 90, 143.13010235415598, 270]) {
    for (const mag of [10, 37, 100]) {
      const s = build({ x: 1.5, y: 0.25 }, { mag, angle: snapAngle(ang) }, { x: -0.5, y: 0 }, { x: 1.5, y: 0.25 }, 'cw');
      const d = derive(s);
      const h = panelHtml(s, 'reveal');
      assert.ok(h.includes(`= ${fmt(d.tau)} N·m`), `tau at ${ang}, ${mag}`);
      assert.ok(h.includes(vecText(d.F, 'N')));
      assert.ok(h.includes(vecText(d.r, 'm')));
    }
  }
});

test('no panel state ever prints NaN, undefined, null or Infinity', () => {
  const cases = [
    build(),
    build({ x: 1, y: 0 }),
    build({ x: 1, y: 0 }, { mag: 50, angle: 90 }),
    build({ x: 1, y: 0 }, { mag: 50, angle: 90 }, { x: 0, y: 0 }),
    build({ x: 1, y: 0 }, { mag: 50, angle: 90 }, { x: 0, y: 0 }, { x: 3, y: 0 })
  ];
  for (const s of cases) for (const step of ['place', 'aim', 'pivot', 'draw', 'predict']) {
    const h = panelHtml(s, step);
    assert.ok(!/NaN|undefined|null|Infinity/.test(h), `${step}: ${h.slice(0, 80)}`);
  }
});
