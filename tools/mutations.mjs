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
    "if (drag === 'force') {\n      if (s.forcePoint) {", "if (drag === 'force') {\n      if (true) {"],
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
  ['scene.js', 'the run and rise digits trade places (the leg midpoints are swapped)',
    "{ text: String(detent.run),  x: hm.x, y: hm.y + (hSign > 0 ? 15 : -7), anchor: 'middle' },\n      { text: String(detent.rise), x: vm.x + vSign * 8, y: vm.y + 4,",
    "{ text: String(detent.run),  x: vm.x, y: vm.y + (hSign > 0 ? 15 : -7), anchor: 'middle' },\n      { text: String(detent.rise), x: hm.x + vSign * 8, y: hm.y + 4,"],
  ['scene.js', 'the hypotenuse digit is put on a leg',
    'x: hypMid.x + hn.x * 13, y: hypMid.y + hn.y * 13 + 4', 'x: hm.x + hn.x * 13, y: hm.y + hn.y * 13 + 4'],
  ['steps.js', 'the draw instruction scolds a student who has not drawn r yet',
    'return s.rTip && !d.rValid', 'return !d.rValid'],
  ['steps.js', 'the two predict instructions trade places',
    "return d.r.x === 0 && d.r.y === 0\n        ?", "return !(d.r.x === 0 && d.r.y === 0)\n        ?"],
  ['steps.js', 'the aim instruction loses its second sentence',
    ' It snaps to common angles.', ''],
  ['panel.js', 'the worked line prints the F_y operand unrounded',
    '${parenthesized(d.F.y)} −', '(${d.F.y}) −'],
  ['steps.js', 'every answer shows as picked before any prediction is made',
    'const picked = s.prediction === key;', 'const picked = s.prediction === key || s.prediction === null;'],
  ['steps.js', 'Back stays enabled on an empty board',
    'backDisabled: !s.forcePoint,', 'backDisabled: false,'],
  ['steps.js', 'New problem stays enabled on an empty board',
    'newProblemDisabled: !s.forcePoint,', 'newProblemDisabled: false,'],
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
  ['interact.js', 'pressing the beam or the force handle starts a lever-arm drag instead of aiming',
    "      setDrag('force');\n    } else if (action === 'pivot') {", "      setDrag('r');\n    } else if (action === 'pivot') {"],
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
  // --- URL presets: presets.js, and their hooks in interact.js, steps.js, app.js, the template, build.js
  ['presets.js', 'an absent parameter is read as present but empty',
    'if (raw === null) continue;', 'if (raw === undefined) continue;'],
  ['presets.js', 'the LAST duplicate parameter wins',
    'const raw = q.get(name);', 'const raw = q.getAll(name).pop() ?? null;'],
  ['presets.js', 'a one-number location gets y = 0.25 instead of 0',
    'parts.length === 2 ? parseNumber(parts[1]) : 0;', 'parts.length === 2 ? parseNumber(parts[1]) : 0.25;'],
  ['presets.js', 'pivot is read from the fp parameter',
    'const raw = q.get(name);', "const raw = q.get(name === 'pivot' ? 'fp' : name);"],
  ['presets.js', 'mag is read from the angle parameter',
    'const raw = q.get(name);', "const raw = q.get(name === 'mag' ? 'angle' : name);"],
  ['presets.js', 'the text is not trimmed',
    'const t = text.trim();', 'const t = text;'],
  ['presets.js', 'the number pattern loses its optional sign',
    'const NUMBER = /^[+-]?(', 'const NUMBER = /^('],
  ['presets.js', 'exponents are accepted as numbers',
    '(\\d+\\.?\\d*|\\.\\d+)$/;', '(\\d+\\.?\\d*|\\.\\d+)(e\\d+)?$/i;'],
  ['presets.js', 'a third coordinate is silently dropped',
    'if (parts.length > 2) return null;', ''],
  ['presets.js', 'a number too big for a double reaches the snapper as Infinity',
    'return Number.isFinite(n) ? n : null;', 'return n;'],
  ['presets.js', 'the ignored hint for a magnitude is shortened',
    "mag: 'use a number of newtons'", "mag: 'use a number'"],
  ['presets.js', 'the ignored note drops the text as given',
    '${name}=${raw} (${HINTS[name]})', '${name} (${HINTS[name]})'],
  ['presets.js', 'a location is not snapped',
    'const s = snapToGrid(v);', 'const s = v;'],
  ['presets.js', 'a location change is noted only when x changed',
    'if (s.x !== v.x || s.y !== v.y)', 'if (s.x !== v.x)'],
  ['presets.js', 'a location is noted even when snapping changed nothing',
    'if (s.x !== v.x || s.y !== v.y)', 'if (true)'],
  ['presets.js', 'the magnitude is not snapped',
    'const s = snapMagnitude(n);', 'const s = n;'],
  ['presets.js', 'a magnitude change is never noted',
    'if (s !== n) out.adjusted', 'if (false) out.adjusted'],
  ['presets.js', 'an angle is compared without wrapping at 360 degrees',
    'circDist(n, s) > ANGLE_TOL', 'Math.abs(n - s) > ANGLE_TOL'],
  ['presets.js', 'an angle must match its detent exactly to go unnoted',
    'const ANGLE_TOL = 0.01;', 'const ANGLE_TOL = 0;'],
  ['presets.js', 'the angle is not snapped',
    'const s = snapAngle(n);', 'const s = n;'],
  ['presets.js', 'the parameters are read in another order',
    "const ORDER = ['fp', 'mag', 'angle', 'pivot'];", "const ORDER = ['pivot', 'fp', 'mag', 'angle'];"],
  ['presets.js', 'describePresets prints the angle without its degree sign',
    'set.push(fmtAngle(p.angle));', 'set.push(fmt(p.angle));'],
  ['presets.js', 'coordinates are printed raw, not through fmt (an ASCII hyphen for minus)',
    'return `(${fmt(p.x)}, ${fmt(p.y)})`;', 'return `(${p.x}, ${p.y})`;'],
  ['presets.js', 'the set pieces are joined with a bare comma',
    "set.join(', ') : 'nothing set'", "set.join(',') : 'nothing set'"],
  ['presets.js', 'a link with nothing to say still prints a line',
    "if (!set.length && !p.adjusted.length && !p.ignored.length) return '';", "if (false) return '';"],
  ['presets.js', 'an all-ignored link loses its "nothing set"',
    "set.length ? set.join(', ') : 'nothing set'", "set.join(', ')"],
  ['presets.js', 'the adjusted notes are joined with commas',
    "p.adjusted.join('; ')", "p.adjusted.join(', ')"],
  ['presets.js', 'the Ignored sentence is never written',
    'if (p.ignored.length) text +=', 'if (false) text +='],
  ['presets.js', 'a magnitude is described even when it was not set',
    'if (p.mag !== null) set.push(', 'if (true) set.push('],
  ['presets.js', 'start never places the force point',
    'if (parsed.fp) state.setForcePoint(parsed.fp);', ''],
  ['presets.js', 'start completes the force when only one of mag and angle is given',
    'parsed.mag !== null && parsed.angle !== null', 'parsed.mag !== null || parsed.angle !== null'],
  ['presets.js', 'start treats an angle of 0 as absent',
    'parsed.mag !== null && parsed.angle !== null', 'parsed.mag && parsed.angle'],
  ['presets.js', 'settle ignores the drag in progress',
    "deriveStep(state.getState(), drag) !== 'pivot'", "deriveStep(state.getState(), null) !== 'pivot'"],
  ['presets.js', 'the pending pivot is not consumed when it is applied',
    '      pending = null;\n      state.setPivot(p);', '      state.setPivot(p);'],
  ['presets.js', 'settle spends the pivot as soon as there is a force point',
    "if (!pending || deriveStep(state.getState(), drag) !== 'pivot') return false;", 'if (!pending || !state.getState().forcePoint) return false;'],
  ['presets.js', 'the pending pivot has its x and y swapped',
    'let pending = parsed.pivot ? { x: parsed.pivot.x, y: parsed.pivot.y } : null;', 'let pending = parsed.pivot ? { x: parsed.pivot.y, y: parsed.pivot.x } : null;'],
  ['presets.js', 'clear leaves the locks in place',
    '      locks = { mag: null, angle: null };\n      pending = null;', '      pending = null;'],
  ['presets.js', 'clear leaves the pending pivot in place',
    '      locks = { mag: null, angle: null };\n      pending = null;', '      locks = { mag: null, angle: null };'],
  ['presets.js', 'clear leaves the "From the link" summary',
    "      summaryText = '';", ''],
  ['presets.js', 'clear writes through to the parsed link',
    "      pending = null;\n      summaryText = '';", "      pending = null;\n      parsed.mag = null;\n      summaryText = '';"],
  ['presets.js', 'getLocks hands out the live object',
    'getLocks: () => ({ mag: locks.mag, angle: locks.angle }),', 'getLocks: () => locks,'],
  ['presets.js', 'a too-short drag becomes a force once anything is locked',
    'if (aim === null) return null;', 'if (aim === null) return { mag: locks.mag ?? 10, angle: locks.angle ?? 0 };'],
  ['presets.js', 'a locked magnitude is ignored by lockAim',
    'mag: locks.mag ?? aim.mag', 'mag: aim.mag'],
  ['presets.js', 'a locked angle is ignored by lockAim',
    'angle: locks.angle ?? aim.angle', 'angle: aim.angle'],
  ['presets.js', 'a locked angle of 0 is lost by lockAim (|| for ??)',
    'angle: locks.angle ?? aim.angle', 'angle: locks.angle || aim.angle'],
  ['presets.js', 'an unlocked magnitude is replaced by 10 N',
    'mag: locks.mag ?? aim.mag', 'mag: locks.mag ?? 10'],
  ['presets.js', 'bothLocked is true when only one is locked',
    'locks.mag !== null && locks.angle !== null', 'locks.mag !== null || locks.angle !== null'],
  ['presets.js', 'bothLocked loses an angle of 0',
    'locks.mag !== null && locks.angle !== null', 'locks.mag !== null && locks.angle'],
  ['interact.js', 'a locked force is never completed by a press (both branches)',
    'if (hooks.completeLocked && hooks.completeLocked()) {', 'if (false) {'],
  ['interact.js', 'a locked force is not completed by pressing the force handle',
    'if (hooks.completeLocked && hooks.completeLocked()) {', "if (action === 'place' && hooks.completeLocked && hooks.completeLocked()) {"],
  ['interact.js', 'a locked force is not completed by a press on the beam',
    'if (hooks.completeLocked && hooks.completeLocked()) {', "if (action === 'aim' && hooks.completeLocked && hooks.completeLocked()) {"],
  ['interact.js', 'capture is not released after a press completes a locked force',
    "        svg.releasePointerCapture(e.pointerId);\n        dragPointerId = null;\n        return;\n      }\n      setDrag('force');",
    "        dragPointerId = null;\n        return;\n      }\n      setDrag('force');"],
  ['interact.js', 'the aim drag ignores the link\'s locks',
    'state.setForce(hooks.lockAim ? hooks.lockAim(aim) : aim);', 'state.setForce(aim);'],
  ['steps.js', 'the locked instruction\'s default is "locked" instead of "free"',
    'locks = { mag: null, angle: null }) {', 'locks = { mag: 0, angle: 0 }) {'],
  ['steps.js', 'a null lock counts as a lock in the aim instruction',
    'const magLocked = locks.mag !== null,', 'const magLocked = locks.mag !== undefined,'],
  ['steps.js', 'an angle lock of 0 counts as no lock in the aim instruction',
    'angleLocked = locks.angle !== null;', 'angleLocked = !!locks.angle;'],
  ['steps.js', 'the magnitude-locked and angle-locked aim texts swap',
    'if (magLocked) return', 'if (angleLocked) return'],
  ['steps.js', 'the angle in the aim instruction is not rounded',
    'fixed at ${fmt(locks.angle)}°', 'fixed at ${locks.angle}°'],
  ['steps.js', 'both locked still says "drag" in the aim step',
    'if (magLocked && angleLocked) return', 'if (false) return'],
  ['steps.js', 'the place instruction ignores the locks',
    'return locks.mag !== null && locks.angle !== null\n        ?', 'return false\n        ?'],
  ['steps.js', 'the place instruction fires when only one thing is locked',
    'return locks.mag !== null && locks.angle !== null', 'return locks.mag !== null || locks.angle !== null'],
  ['steps.js', 'the pivot instruction picks up the lock text',
    "return 'Click the beam to choose the pivot.';", "return locks.mag !== null ? 'Click the beam to choose the pivot. The link fixed the force.' : 'Click the beam to choose the pivot.';"],
  ['app.js', 'app.js looks the From-the-link line up under an id the template does not have',
    "document.getElementById('from-link')", "document.getElementById('fromlink')"],
  ['app.js', 'renderAll is the state subscriber again, so a stale render can overwrite a settled pivot',
    'state.subscribe(sync);', 'state.subscribe(renderAll);'],
  ['app.js', 'sync renders after settle changed the state (a stale outer render)',
    'if (presets.settle(state, drag)) return;', 'presets.settle(state, drag);'],
  ['app.js', 'New problem resets the state before it clears the presets',
    '  presets.clear();      // first: the reset below renders, and must render a blank problem\n  state.reset();', '  state.reset();\n  presets.clear();'],
  ['app.js', 'the render does not pass the locks to instruction()',
    'instruction(step, s, presets.getLocks())', 'instruction(step, s)'],
  ['app.js', 'the From-the-link line is never hidden',
    "els.fromLink.hidden = link === '';", 'els.fromLink.hidden = false;'],
  ['app.js', 'the From-the-link line never gets its text',
    'els.fromLink.textContent = link;', "els.fromLink.textContent = '';"],
  ['app.js', 'the interaction is not given the lockAim hook',
    '  lockAim: aim => presets.lockAim(aim),\n', ''],
  ['app.js', 'completeLocked completes a force even when only one thing is locked',
    '    if (!presets.bothLocked()) return false;\n', ''],
  ['app.js', 'the presets start after the subscription, not before',
    'presets.start(state);\nstate.subscribe(sync);', 'state.subscribe(sync);\npresets.start(state);'],
  ['app.js', 'a drag change renders directly, skipping the pivot settle',
    '    drag = kind;\n    sync();', '    drag = kind;\n    renderAll(state.getState());'],
  ['build.js', 'presets.js is left out of the inlined modules',
    "'steps.js', 'presets.js',", "'steps.js',"],
  ['index.template.html', 'the From-the-link line is not hidden at the start',
    'id="from-link" class="from-link" hidden', 'id="from-link" class="from-link"'],
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
