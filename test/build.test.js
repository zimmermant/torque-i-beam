import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strip, scanForDuplicates, main } from '../build.js';

// build.js only calls main() when it is the program node was invoked on (see
// its guard at the bottom), so importing it here to reach `strip` does not
// trigger a real build. These pin strip()'s two rewrites -- import/export
// removal and export-keyword stripping -- as a pure function, independent of
// the file system.

test('a single-line relative import is removed', () => {
  const src = "import { el, clear } from './svg.js';\nconst x = 1;\n";
  const out = strip(src);
  assert.ok(!out.includes('import'), out);
  assert.ok(out.includes('const x = 1;'));
});

test('a multi-line relative import is removed', () => {
  const src =
    "import { tipPosition, constraintLine,\n" +
    "         RAMP_MIN, RAMP_MAX } from './physics.js';\n" +
    "const y = 2;\n";
  const out = strip(src);
  assert.ok(!out.includes('import'), out);
  assert.ok(!out.includes('RAMP_MIN'), 'the wrapped second line must be dropped too');
  assert.ok(out.includes('const y = 2;'));
});

test('a single-line export { ... } block is removed', () => {
  const src = 'const a = 1;\nexport { a, b };\nconst c = 2;\n';
  const out = strip(src);
  assert.ok(!out.includes('export'), out);
  assert.ok(out.includes('const a = 1;'));
  assert.ok(out.includes('const c = 2;'));
});

test('export function / export const keep their declaration but lose the keyword', () => {
  const src = 'export function foo() {}\nexport const bar = 1;\n';
  const out = strip(src);
  assert.ok(!/\bexport\b/.test(out), out);
  assert.ok(out.includes('function foo() {}'));
  assert.ok(out.includes('const bar = 1;'));
});

// scanForDuplicates is the build's actual name-collision guard, run once per
// module against a Map shared across the whole build. These pin its four
// load-bearing behaviours.

test('a genuine cross-module duplicate throws and names both files', () => {
  const seen = new Map();
  scanForDuplicates('export const FOO = 1;\n', 'a.js', seen);
  assert.throws(
    () => scanForDuplicates('export function FOO() {}\n', 'b.js', seen),
    /Duplicate top-level name "FOO" in b\.js; already declared in a\.js/
  );
});

test('a column-0 destructuring declaration throws', () => {
  const seen = new Map();
  assert.throws(
    () => scanForDuplicates('export const { a, b } = obj;\n', 'weird.js', seen),
    /destructuring/i
  );
  assert.throws(
    () => scanForDuplicates('const [first] = list;\n', 'weird2.js', new Map()),
    /destructuring/i
  );
});

test('a multi-declarator statement throws, naming the file and the fix', () => {
  const seen = new Map();
  assert.throws(
    () => scanForDuplicates(
      'export const VB = { w: 480, h: 380 }, PAD = 0.12;\n', 'triangle.js', seen),
    /triangle\.js/
  );
  assert.throws(
    () => scanForDuplicates(
      'export const VB = { w: 480, h: 380 }, PAD = 0.12;\n', 'triangle.js', new Map()),
    /one name per statement/
  );
  // A single declarator whose initializer merely CONTAINS commas -- inside an
  // object literal, an array, a call's argument list, or a trailing comment --
  // must not be mistaken for a second declarator.
  assert.doesNotThrow(() =>
    scanForDuplicates('export const COLORS = { t1: \'a\', t2: \'b\' };\n', 'svg.js', new Map()));
  assert.doesNotThrow(() =>
    scanForDuplicates('export const MODULES = [\'a.js\', \'b.js\'];\n', 'build.js', new Map()));
  assert.doesNotThrow(() =>
    scanForDuplicates('export const R = Math.hypot(A, B);\n', 'scene.js', new Map()));
  assert.doesNotThrow(() =>
    scanForDuplicates(
      'export const CONTACT_D = 250;  // ball contact, measured along the ramp\n',
      'scene.js', new Map()));
});

test('an ordinary indented function-local const does NOT throw -- the column-0 ' +
     'anchoring that lets a module\'s inner name legally shadow another module\'s top-level one',
  () => {
    const seen = new Map();
    const code = [
      'export function createTriangle(svg) {',
      '  function render(s) {',
      '    const px = (x, y) => ({ x: x, y: y });',
      '    return px(1, 2);',
      '  }',
      '  return { render };',
      '}'
    ].join('\n');
    assert.doesNotThrow(() => scanForDuplicates(code, 'triangle.js', seen));
    // the indented `const px` must never have been registered as a top-level name
    assert.ok(!seen.has('px'));
  });

test('a top-level px in one module and a function-local px in another do not collide', () => {
  const seen = new Map();
  const fbdSrc = [
    'export function px(x, y) {',
    '  return { x, y };',
    '}'
  ].join('\n');
  scanForDuplicates(fbdSrc, 'fbd.js', seen);
  assert.equal(seen.get('px'), 'fbd.js');

  const triangleSrc = [
    'export function createTriangle(svg) {',
    '  function render(s) {',
    '    const px = (x, y) => ({ x: x, y: y });',
    '    return px(1, 2);',
    '  }',
    '  return { render };',
    '}'
  ].join('\n');
  assert.doesNotThrow(() =>
    scanForDuplicates(triangleSrc, 'triangle.js', seen));
});

// No committed test ever ran main() itself -- everything above exercises its
// helper functions. Build twice into scratch directories OUTSIDE the repo (main()
// takes an optional outDir for exactly this) and compare the bytes, so the
// committed dist/torque_i_beam.html is never touched by the test suite.
test('main() builds a byte-reproducible bundle, without touching the committed dist/', () => {
  const dirA = mkdtempSync(join(tmpdir(), 'torque-i-beam-build-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'torque-i-beam-build-b-'));
  try {
    main(dirA);
    main(dirB);
    const a = readFileSync(join(dirA, 'torque_i_beam.html'));
    const b = readFileSync(join(dirB, 'torque_i_beam.html'));
    assert.ok(a.length > 1000, `built file looks too small: ${a.length} bytes`);
    assert.deepStrictEqual(a, b, 'two builds of the same source must be byte-identical');
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

// A module that is in src/ but not in build.js's MODULES list is silently missing from the shipped
// page (its functions are undefined at run time). The list is read from the directory here, not
// from the build's own list, so a forgotten module cannot hide.
test('main() inlines every src/*.js module', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const modules = readdirSync(join(here, '..', 'src')).filter(f => f.endsWith('.js')).sort();
  assert.ok(modules.includes('presets.js'), 'the directory listing found the new module');
  const dir = mkdtempSync(join(tmpdir(), 'torque-i-beam-build-c-'));
  try {
    main(dir);
    const html = readFileSync(join(dir, 'torque_i_beam.html'), 'utf8');
    for (const m of modules) assert.ok(html.includes(`// ===== ${m} =====`), `${m} is missing from the built page`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
