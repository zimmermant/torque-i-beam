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
// A row's file is a src/ file name (JavaScript, or index.template.html), or 'build.js'.
//
// The run takes about 10 minutes and works on a TEMPORARY COPY (src/, test/, build.js and
// package.json copied into the system temp directory). The real repository is never written,
// so an interrupted run (Ctrl-C) cannot leave a mutated source behind. The copy is removed
// at the end and on SIGINT / SIGTERM.
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'tib-mut-'));
const root = work;                       // every path below reads, writes and runs inside the copy
for (const f of ['src', 'test', 'build.js', 'package.json']) cpSync(join(repo, f), join(work, f), { recursive: true });
const cleanup = () => rmSync(work, { recursive: true, force: true });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
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
  ['geometry.js', 'leverTipFromPointer does not clamp the pointer to the viewBox',
    'const w = { x: clampTo(world.x, lo.x, hi.x), y: clampTo(world.y, lo.y, hi.y) };', 'const w = { x: world.x, y: world.y };'],
  ['interact.js', 'pointermove aims from a missing force point after New problem',
    "if (drag === 'force') { if (s.forcePoint) state.setForce(", "if (drag === 'force') { if (true) state.setForce("],
  ['interact.js', 'pointermove draws r from a missing pivot after Back',
    'else if (s.pivot) { state.setRTip(', 'else if (true) { state.setRTip('],
  ['steps.js', 'the answers are enabled in every step but the reveal',
    "disabled: step !== 'predict',", "disabled: step === 'reveal',"],
  ['steps.js', 'right and wrong are swapped on the picked answer',
    'right: picked && d.correct === true,\n      wrong: picked && d.correct === false', 'right: picked && d.correct === false,\n      wrong: picked && d.correct === true'],
  ['steps.js', 'Replay is offered for a zero torque, where there is no swing',
    "replayHidden: step !== 'reveal' || d.truth === 'zero',", "replayHidden: step !== 'reveal',"],
  ['steps.js', 'Same force, new pivot is never hidden',
    "sameForceHidden: step !== 'reveal'", 'sameForceHidden: false'],
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
    'prediction = null;                 // a changed force invalidates the verdict it was judged against', ''],
  ['steps.js', 'the predict step is skipped: the reveal comes as soon as r is valid',
    "if (!s.prediction) return 'predict';", ''],
  ['steps.js', 'an r that misses the force point still advances past the draw step',
    "if (!s.rTip || !derive(s).rValid) return 'draw';", "if (!s.rTip) return 'draw';"],
  ['panel.js', 'the worked result line rounds the torque to one decimal',
    '<div>= ${fmt(d.tau)} N·m</div>', '<div>= ${fmt(d.tau, 1)} N·m</div>'],
  ['physics.js', 'DEG is built from 3.1416 instead of Math.PI, so 45 degrees is not quite 45',
    'export const DEG = Math.PI / 180;', 'export const DEG = 3.1416 / 180;'],
  ['interact.js', 'tryCapture reports success when capture throws',
    'return false;', 'return true;'],
  ['interact.js', 'pointerup no longer ends a drag',
    "svg.addEventListener('pointerup', endDrag);", ''],
  ['interact.js', 'pointercancel no longer ends a drag',
    "svg.addEventListener('pointercancel', endDrag);", ''],
  ['interact.js', 'pressing the force handle starts a lever-arm drag instead of aiming',
    "} else if (action === 'aim') {\n      setDrag('force');", "} else if (action === 'aim') {\n      setDrag('r');"],
  ['interact.js', 'pressing the beam for a pivot starts aiming the force instead of drawing r',
    "      setDrag('r');\n    } else {", "      setDrag('force');\n    } else {"],
  ['interact.js', 'a right or middle click starts a drag',
    'if (e.button !== 0) return;', ''],
  ['interact.js', 'a move from any pointer steers the drag',
    'if (!drag || e.pointerId !== dragPointerId) return;\n    const world', 'if (!drag) return;\n    const world'],
  ['interact.js', 'a second pointer can take over a drag in progress',
    'if (drag !== null && e.pointerId !== dragPointerId) return;', ''],
  ['geometry.js', 'VB is one unit wider than the template\'s viewBox',
    'export const VB = { w: 960, h: 560 };', 'export const VB = { w: 961, h: 560 };'],
  ['app.js', 'app.js looks the Back button up under an id the template does not have',
    "document.getElementById('back')", "document.getElementById('go-back')"],
  ['state.js', 'a fourth answer is accepted that the page has no button for',
    "export const PREDICTIONS = ['cw', 'ccw', 'zero'];", "export const PREDICTIONS = ['cw', 'ccw', 'zero', 'unsure'];"],
  ['scene.js', 'easeOut is not clamped to [0, 1]',
    'const u = 1 - Math.min(1, Math.max(0, t));', 'const u = 1 - t;'],
  ['scene.js', 'the force arrow is drawn pointing down for a positive F_y',
    'y: from.y - F.y * FORCE_PX_PER_N', 'y: from.y + F.y * FORCE_PX_PER_N'],
  ['scene.js', 'the torque arc starts and ends at swapped angles',
    "const a0 = truth === 'ccw' ? 30 : 150;", "const a0 = truth === 'ccw' ? 150 : 30;"],
  ['scene.js', 'the torque arc\'s sweep flag is inverted',
    'const sweep = a1 > a0 ? 0 : 1;', 'const sweep = a1 > a0 ? 1 : 0;'],
  ['scene.js', 'arcSegments stops one segment short of the arc\'s end',
    'for (let i = 1; i <= n; i++) {', 'for (let i = 1; i < n; i++) {'],
  ['scene.js', 'the glyph\'s hypotenuse is 400 px instead of 40',
    'export const GLYPH_HYP_PX = 40;', 'export const GLYPH_HYP_PX = 400;'],
  ['scene.js', 'boxGap takes the smallest of the four separations, not the largest',
    'return Math.max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);', 'return Math.min(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1);'],
  ['scene.js', 'the F label\'s anchor is on the wrong side of its position',
    "anchor: vx > 0.3 ? 'start' : vx < -0.3 ? 'end' : 'middle' });", "anchor: vx > 0.3 ? 'end' : vx < -0.3 ? 'start' : 'middle' });"],
  ['scene.js', 'the r label\'s default offset is 26 px, not 36',
    'for (const off of [36, 26, 50, 64])', 'for (const off of [26, 36, 50, 64])'],
  ['scene.js', 'segSegDist measures to the infinite line, not the segment',
    'const t = Math.min(1, Math.max(0, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));', 'const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;'],
  ['scene.js', 'pickGlyph takes the LAST clear candidate, not the first',
    'const good = scored.find(c => c.clear >= GLYPH_CLEAR_GOOD);', 'const good = scored.filter(c => c.clear >= GLYPH_CLEAR_GOOD).pop();'],
  ['scene.js', 'every force gets a 3-4-5 glyph except the 3-4-5 ones',
    "detent && detent.kind === 'triple'", "detent && detent.kind !== 'triple'"],
  ['scene.js', 'a zero r still gets a lever-arm segment',
    '(d.r.x !== 0 || d.r.y !== 0)', 'true'],
  ['scene.js', 'an invalid r is drawn to the force point instead of the raw tip',
    'q: d.rValid ? toPx(s.forcePoint) : toPx(s.rTip) }', 'q: d.rValid ? toPx(s.rTip) : toPx(s.forcePoint) }'],
  ['build.js', 'the import-stripping regex loses its multiline flag',
    "$/gm, '');", "$/g, '');"],
  ['build.js', 'an import wrapped over two lines is no longer matched',
    '[^;]*from', '[^;\\n]*from'],
  ['build.js', 'export { ... } lines are no longer filtered out',
    ".filter(l => !/^\\s*export\\s*\\{[^}]*\\}\\s*;?\\s*$/.test(l))", ".filter(l => true)"],
  ['build.js', 'export const keeps its keyword',
    'export\\s+(function|const|let|var|class)\\s/', 'export\\s+(function|let|var|class)\\s/'],
  ['build.js', 'a cross-module duplicate is no longer detected',
    'if (seen.has(name)) {', 'if (false) {'],
  ['build.js', 'the duplicate error names the same module twice',
    'already declared in ${seen.get(name)}', 'already declared in ${moduleName}'],
  ['build.js', 'a column-0 destructuring declaration is no longer rejected',
    'if (DESTRUCTURE.test(line)) {', 'if (false) {'],
  ['build.js', 'a multi-declarator statement is no longer rejected',
    'if (MULTI_DECL.test(line) && hasTopLevelComma(line)) {', 'if (false) {'],
  ['build.js', 'hasTopLevelComma counts commas inside brackets',
    "else if (c === ',' && depth === 0) return true;", "else if (c === ',') return true;"],
  ['build.js', 'hasTopLevelComma reads the commas in a trailing comment',
    "if (c === '/' && line[i + 1] === '/') break;", ''],
  ['build.js', 'name scanning also registers indented function-locals',
    'const DECL = /^(?:export', 'const DECL = /^\\s*(?:export'],
  ['build.js', 'the output is stamped with a random build id',
    "writeFileSync(join(dir, 'torque_i_beam.html'), html);", "writeFileSync(join(dir, 'torque_i_beam.html'), html + '<!-- build ' + Math.random() + ' -->');"],
  // --- template.test.js: literal text in src/index.template.html (the parse check does not apply)
  ['index.template.html', 'the clockwise answer says "-" instead of the minus sign',
    'Clockwise (&minus;)', 'Clockwise (-)'],
  ['index.template.html', 'the Replay button is not hidden at the start',
    'id="replay" hidden', 'id="replay"'],
  ['index.template.html', 'the stylesheet is linked externally instead of inlined',
    '<!--INLINE_CSS-->', '<link rel="stylesheet" href="styles.css">']
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
    // Only JavaScript can be syntax-checked; a mutated HTML template is checked by the tests
    // that read it, and by the file-level-failure guard below.
    if (/\.(m?js)$/.test(file)) {
      const parse = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (parse.status !== 0) { console.log(`?? DOES NOT PARSE ${file}: ${what}`); bad++; continue; }
    }
    const { failing } = await runSuite();
    const fileLevel = failing.filter(id => / :: test\/.*\.test\.js$/.test(id));
    if (fileLevel.length) { console.log(`?? BREAKS LOADING ${file}: ${what}  (${fileLevel.join(', ')})`); bad++; continue; }
    if (failing.length > MAX_FAILING) { console.log(`?? TOO BLUNT     ${String(failing.length).padStart(3)} failing  ${file}: ${what}  (limit ${MAX_FAILING})`); bad++; continue; }
    failing.forEach(id => everFailed.add(id));
    const ok = failing.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'caught ' : 'MISSED '} ${String(failing.length).padStart(3)} failing  ${file}: ${what}`);
  } finally {
    writeFileSync(path, original);   // restores the copy between rows; the repo is never touched
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
cleanup();
if (bad || base.failing.length !== 0) { console.log(`${bad} mutation(s) not caught`); process.exit(1); }
console.log(`all ${MUTATIONS.length} mutations caught`);
if (strict && uncovered.length) process.exit(1);
