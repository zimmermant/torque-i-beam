// Mutation check. Each row breaks ONE thing in ONE source file, runs the whole
// suite, and requires it to FAIL. A test claiming a mutation it does not catch
// is a test that cannot fail.
//
//   node tools/mutations.mjs              every mutation must be caught
//   node tools/mutations.mjs --coverage   ALSO list every test that NO mutation makes fail
//                                         (a test with no demonstrated teeth);
//                                         add --strict to exit 1 if there is any
//
// A row is REJECTED (and the run fails) if it is not a real behavioural mutation:
//   - the mutated file must still PARSE (a syntax error makes every test fail trivially);
//   - no test FILE may fail to load (same reason);
//   - it may fail at most MAX_FAILING tests (a blunt mutation that breaks everything covers
//     every test and proves nothing).
// A row's file is a src/ file name, or 'build.js' for the build script.
//
// The source file is always restored, even if a run throws.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FAILING = 12;

const MUTATIONS = [
  ['physics.js', 'drop the quadrant mirrors for 30/45/60',
    'for (const a of [base, 180 - base, 180 + base, 360 - base]) {', 'for (const a of [base, 180 - base]) {'],
  ['physics.js', 'circDist does not wrap round the circle',
    'return d > 180 ? 360 - d : d;', 'return d;'],
  ['physics.js', 'components use raw trig at the axes',
    "if (d && d.kind === 'axis') {", 'if (false) {'],
  ['physics.js', 'components use raw trig at the 3-4-5 detents',
    "} else if (d && d.kind === 'triple') {", '} else if (false) {'],
  ['physics.js', 'torqueZ swaps its two products',
    'return r.x * F.y - r.y * F.x + 0;', 'return r.y * F.x - r.x * F.y + 0;'],
  ['physics.js', 'TAU_EPS is zero',
    'export const TAU_EPS = 1e-9;', 'export const TAU_EPS = 0;'],
  ['physics.js', 'ccw and cw trade places',
    "return tau > 0 ? 'ccw' : 'cw';", "return tau > 0 ? 'cw' : 'ccw';"],
  ['format.js', 'fmt prints toFixed directly (negative zero, trailing zeros)',
    'const s = String(Number(n.toFixed(dp)));', 'const s = n.toFixed(dp);'],
  ['format.js', 'vecText takes its sign from the unrounded y',
    'const ry = Number(v.y.toFixed(2));', 'const ry = v.y;'],
  ['geometry.js', 'toPx does not flip y',
    'y: ORIGIN_PX.y - p.y * PX_PER_M', 'y: ORIGIN_PX.y + p.y * PX_PER_M'],
  ['geometry.js', 'a click aims a force (AIM_MIN_PX = 0)',
    'export const AIM_MIN_PX = 12;', 'export const AIM_MIN_PX = 0;'],
  ['geometry.js', 'no hit margin',
    'export const HIT_MARGIN_M = 0.05;', 'export const HIT_MARGIN_M = 0;'],
  ['state.js', 'setPivot never notifies',
    '    pivot = v;\n    rTip = nextTip;\n    prediction = null;\n    notify();', '    pivot = v;\n    rTip = nextTip;\n    prediction = null;'],
  ['state.js', 'a pivot on the force point does not set r',
    'const nextTip = samePoint(v, forcePoint) ? copyPoint(forcePoint) : null;', 'const nextTip = null;'],
  ['geometry.js', 'R_SNAP_M doubled',
    'export const R_SNAP_M = 0.12;', 'export const R_SNAP_M = 0.24;'],
  ['state.js', 'a locked prediction is accepted',
    'if (p !== null && !derive(getState()).rValid) return;', ''],
  ['steps.js', 'the drag override is dropped',
    "if (drag === 'force' || !s.force) return 'aim';", "if (!s.force) return 'aim';"],
  ['panel.js', 'the torque is shown before the reveal',
    "if (step !== 'reveal') return card(", "if (false) return card("],
  ['scene.js', 'a ccw torque swings the beam clockwise',
    "if (truth === 'ccw') return -SWING_DEG;", "if (truth === 'ccw') return SWING_DEG;"],
  ['scene.js', 'the swing restarts on every render',
    "return step === 'reveal' && prevStep !== 'reveal';", "return step === 'reveal';"],
  ['scene.js', 'the 3-4-5 glyph is flipped vertically',
    'y: -detent.sy * detent.rise / detent.hyp', 'y: detent.sy * detent.rise / detent.hyp'],
  ['scene.js', 'pickLabel always takes the first candidate',
    'return scored.find(c => c.clear >= CLEAR_GOOD && !c.onBeam) ||', 'return scored[0] || scored.find(c => c.clear >= CLEAR_GOOD && !c.onBeam) ||'],
  ['scene.js', 'pickGlyph always takes the first candidate',
    'const good = scored.find(c => c.clear >= GLYPH_CLEAR_GOOD);', 'const good = scored[0];'],
  ['scene.js', 'the glyph\'s digits are not obstacles for the labels',
    "for (const l of glyph.labels) around.boxes.push(labelBox(l.x, l.y, 16, l.anchor));", ''],
  ['scene.js', 'the torque arc is not an obstacle for the labels',
    'const around = { segments: [...arcSegs], boxes: [], beam: beamBox };', 'const around = { segments: [], boxes: [], beam: beamBox };'],
  ['interact.js', 'a drag is latched even if pointer capture fails',
    'if (!tryCapture(svg, e.pointerId)) return;        // no capture, no drag', 'tryCapture(svg, e.pointerId);'],
  ['interact.js', 'a press on the beam is honoured after r is drawn',
    "if (step === 'pivot' || step === 'draw') return 'pivot';\n  return 'none';", "return 'pivot';"],
  ['physics.js', 'a 30-degree detent is moved to 32, crowding the 3-4-5 angle',
    'for (const base of [30, 45, 60]) {', 'for (const base of [32, 45, 60]) {'],
  ['physics.js', 'snapAngle returns the detent angle rounded to a tenth of a degree',
    'return best.angle;', 'return Math.round(best.angle * 10) / 10;'],
  ['physics.js', 'snapMagnitude has no upper clamp',
    'return Math.min(MAG_MAX, Math.max(MAG_MIN, Math.round(m)));', 'return Math.max(MAG_MIN, Math.round(m));'],
  ['physics.js', 'components forget to convert degrees to radians for y in the general case',
    'y = mag * Math.sin(angle * DEG);', 'y = mag * Math.sin(angle);'],
  ['physics.js', 'the 3-4-5 detents use the run for the vertical component',
    'y = d.sy * (mag * d.rise) / d.hyp;', 'y = d.sy * (mag * d.run) / d.hyp;'],
  ['physics.js', 'polar reports the raw atan2 angle (negative below the x axis)',
    'normalizeAngle(Math.atan2(v.y, v.x) / DEG)', 'Math.atan2(v.y, v.x) / DEG'],
  ['physics.js', 'detentAt accepts anything within a degree',
    'if (circDist(d.angle, angle) < 1e-9) return d;', 'if (circDist(d.angle, angle) < 1) return d;'],
  ['physics.js', 'torqueZ lets negative zero through',
    ' - r.y * F.x + 0;', ' - r.y * F.x;'],
  ['format.js', 'fmt lets NaN and Infinity through to toFixed',
    ' || !Number.isFinite(n)) return', ') return'],
  ['format.js', 'fmtAngle prints a degree sign after a missing angle',
    "return a === null || a === undefined ? '—' : `${fmt(a)}°`;", 'return `${fmt(a)}°`;'],
  ['geometry.js', 'hitBeam looks only at half the half-depth, so the flange corners are lost',
    'BEAM.depth / 2 + HIT_MARGIN_M', 'BEAM.depth / 4 + HIT_MARGIN_M'],
  ['geometry.js', 'hitBeam does not take the absolute value of y',
    'Math.abs(w.y) <= BEAM.depth', 'w.y <= BEAM.depth'],
  ['geometry.js', 'snapToGrid does not clamp y to the beam',
    'const y = clampTo(Math.round(w.y / GRID) * GRID, -hy, hy);', 'const y = Math.round(w.y / GRID) * GRID;'],
  ['geometry.js', 'snapToGrid lets negative zero through',
    'return { x: x + 0, y: y + 0 };', 'return { x, y };'],
  ['geometry.js', 'the web is too short to meet the top flange',
    'y0: -hy + f, y1: hy - f }', 'y0: -hy + f, y1: hy - 2 * f }'],
  ['geometry.js', 'the aim angle is read from the origin, not the force point',
    'angle: snapAngle(Math.atan2(dy, dx) / DEG)', 'angle: snapAngle(Math.atan2(world.y, world.x) / DEG)'],
  ['geometry.js', 'the aim angle is not snapped to a detent',
    'angle: snapAngle(Math.atan2(dy, dx) / DEG)', 'angle: Math.atan2(dy, dx) / DEG'],
  ['geometry.js', 'arrows are drawn at 2 px per newton',
    'export const FORCE_PX_PER_N = 1.6;', 'export const FORCE_PX_PER_N = 2;'],
  ['geometry.js', 'a drag of any length moves the tip of r',
    'export const R_DRAG_MIN_PX = 6;', 'export const R_DRAG_MIN_PX = 0;'],
  ['state.js', 'a fresh state starts with a pivot at the centre of the beam',
    'let pivot = null;', 'let pivot = { x: 0, y: 0 };'],
  ['state.js', 'setForce stores the raw magnitude instead of whole newtons',
    'const v = f === null ? null : { mag: snapMagnitude(f.mag), angle: snapAngle(f.angle) };', 'const v = f === null ? null : { mag: f.mag, angle: snapAngle(f.angle) };'],
  ['state.js', 'getState hands out the live force object',
    'force: force === null ? null : { mag: force.mag, angle: force.angle },', 'force,'],
  ['state.js', 'moving the force point leaves the pivot in place',
    '    forcePoint = v;\n    force = null;\n    pivot = null;\n', '    forcePoint = v;\n    force = null;\n'],
  ['state.js', 'a pivot is accepted before any force exists',
    'if (!forcePoint || !force) return;', 'if (!forcePoint) return;'],
  ['state.js', 'moving the pivot keeps the prediction',
    '    pivot = v;\n    rTip = nextTip;\n    prediction = null;\n', '    pivot = v;\n    rTip = nextTip;\n'],
  ['state.js', 'setPrediction accepts any string, not just the three answers',
    'if (p !== null && !PREDICTIONS.includes(p)) return;', ''],
  ['state.js', 'derive reports a missing r as the zero vector',
    'let r = null;', 'let r = { x: 0, y: 0 };'],
  ['state.js', 'back undoes the prediction and r together',
    'if (prediction !== null) prediction = null;', 'if (prediction !== null) { prediction = null; rTip = null; }'],
  ['state.js', 'back from an auto-r pivot leaves the pivot behind',
    'if (auto) pivot = null;', ''],
  ['state.js', 'sameForceNewPivot also drops the force',
    'if (pivot === null && rTip === null && prediction === null) return;\n    pivot = null;', 'if (pivot === null && rTip === null && prediction === null) return;\n    force = null;\n    pivot = null;'],
  ['state.js', 'sameForceNewPivot leaves the old r tip',
    'function sameForceNewPivot() {\n    if (pivot === null && rTip === null && prediction === null) return;\n    pivot = null;\n    rTip = null;', 'function sameForceNewPivot() {\n    if (pivot === null && rTip === null && prediction === null) return;\n    pivot = null;'],
  ['state.js', 'unsubscribe does not remove the subscriber',
    'return () => { subscribers = subscribers.filter(f => f !== fn); };', 'return () => {};'],
  ['state.js', 'derive lets negative zero through in r',
    'r = { x: tip.x - s.pivot.x + 0, y: tip.y - s.pivot.y + 0 };', 'r = { x: tip.x - s.pivot.x, y: tip.y - s.pivot.y };'],
  ['state.js', 'setForce notifies even when nothing changed',
    'if (!forcePoint || sameForce(v, force)) return;', 'if (!forcePoint) return;'],
  ['state.js', 'setRTip notifies even when nothing changed',
    'if (samePoint(v, rTip)) return;', ''],
  ['state.js', 'setPrediction notifies even when the answer is unchanged',
    'if (p === prediction) return;', ''],
  ['state.js', 'changing the force keeps the old prediction',
    'prediction = null;                 // a changed force invalidates the verdict it was judged against', '']
];

const TEST_FILES = readdirSync(join(root, 'test')).filter(f => f.endsWith('.test.js')).sort();

function runFile(f) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, ['--test', join(root, 'test', f)], { cwd: root });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', () => resolve({ f, out }));
  });
}

// Run every test file in parallel; return the failing test ids and every test id.
async function runSuite() {
  const results = await Promise.all(TEST_FILES.map(runFile));
  const failing = [], all = [];
  for (const { f, out } of results) {
    for (const m of out.matchAll(/^(not )?ok \d+ - (.*)$/gm)) {
      const id = `${f} :: ${m[2]}`;
      all.push(id);
      if (m[1]) failing.push(id);
    }
  }
  return { failing, all };
}

const coverage = process.argv.includes('--coverage');
const strict = process.argv.includes('--strict');
let bad = 0;
const everFailed = new Set();
for (const [file, what, find, replace] of MUTATIONS) {
  const path = file === 'build.js' ? join(root, 'build.js') : join(root, 'src', file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(find)) { console.log(`?? CANNOT APPLY  ${file}: ${what}  (pattern not found)`); bad++; continue; }
  if (original.replace(find, replace) === original) { console.log(`?? NO-OP         ${file}: ${what}  (the replacement changes nothing)`); bad++; continue; }
  try {
    writeFileSync(path, original.replace(find, replace));
    const parse = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (parse.status !== 0) { console.log(`?? DOES NOT PARSE ${file}: ${what}`); bad++; continue; }
    const { failing } = await runSuite();
    const fileLevel = failing.filter(id => / :: test\/.*\.test\.js$/.test(id));
    if (fileLevel.length) { console.log(`?? BREAKS LOADING ${file}: ${what}  (${fileLevel.join(', ')})`); bad++; continue; }
    if (failing.length > MAX_FAILING) { console.log(`?? TOO BLUNT     ${String(failing.length).padStart(3)} failing  ${file}: ${what}  (limit ${MAX_FAILING})`); bad++; continue; }
    failing.forEach(id => everFailed.add(id));
    const ok = failing.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'caught ' : 'MISSED '} ${String(failing.length).padStart(3)} failing  ${file}: ${what}`);
  } finally {
    writeFileSync(path, original);
  }
}
const base = await runSuite();
console.log(`\nbaseline after restore: ${base.failing.length} failing of ${base.all.length} tests`);
let uncovered = [];
if (coverage) {
  uncovered = base.all.filter(id => !everFailed.has(id));
  console.log(`\n${base.all.length - uncovered.length} of ${base.all.length} tests are made to fail by at least one mutation.`);
  if (uncovered.length) {
    console.log(`${uncovered.length} test(s) that NO mutation makes fail:`);
    for (const id of uncovered) console.log(`   ${id}`);
  }
}
if (bad || base.failing.length !== 0) { console.log(`${bad} mutation(s) not caught`); process.exit(1); }
console.log(`all ${MUTATIONS.length} mutations caught`);
if (strict && uncovered.length) process.exit(1);
