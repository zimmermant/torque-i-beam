// Zero-dependency inliner. Modules are concatenated into one scope, so the build
// FAILS on duplicate top-level names rather than silently shadowing them.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'src');

// Dependency order. app.js runs last because it touches the DOM immediately.
const MODULES = [
  'svg.js', 'app.js'
];

// Anchored at column 0 on purpose. Every top-level declaration in src/ starts
// there, and matching leading whitespace too would flag ordinary function-local
// `const`s as collisions and fail the build for no reason.
const DECL = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

// E1: a column-0 const/let/var immediately destructured (`const { a } = …` or
// `const [a] = …`) declares a name (or names) that DECL above cannot extract.
// Rather than let it through unnoticed -- the exact failure this whole
// mechanism exists to prevent -- treat it as a hard build error so a human
// names it explicitly instead of it silently shadowing in the shipped bundle.
const DESTRUCTURE = /^(?:export\s+)?(?:const|let|var)\s+[\[{]/;

// E5: a column-0 const/let/var whose declared name starts an identifier (so
// it is not the DESTRUCTURE case above). DECL only ever captures the FIRST
// declarator of a statement, so `export const VB = {...}, PAD = 0.12;`
// registers VB and silently drops PAD -- exactly the failure this whole
// mechanism exists to prevent. Combined with hasTopLevelComma below, this
// hard-fails any column-0 statement that declares more than one name.
const MULTI_DECL = /^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$]/;

// True if `line` contains a comma outside of any string literal and outside
// any (), [] or {} nesting -- i.e. a comma that separates top-level
// declarators (`a = 1, b = 2`) rather than one inside an object/array literal
// or a function call's argument list (both of which sit at depth > 0).
function hasTopLevelComma(line) {
  let depth = 0, quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i++; continue; }        // skip escaped char, incl. escaped quote
      if (c === quote) quote = null;
      continue;
    }
    // A trailing `//` comment (this codebase's only comment style at top
    // level) is not code -- e.g. "export const CONTACT_D = 250; // a, b" must
    // not count the comma in its comment as a second declarator.
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) return true;
  }
  return false;
}

export function strip(code) {
  // Drop relative imports as whole statements rather than line-by-line: fbd.js's
  // import of physics.js wraps its named list onto a second line, and a
  // per-line filter never sees "from" on the opening line, so the statement
  // (and the syntax error it leaves behind) survives. [^;]* cannot cross the
  // statement's own semicolon, so this still can't run away into later code.
  code = code.replace(/^\s*import\s[^;]*from\s+['"]\.\/[^'"]+['"]\s*;?[ \t]*$/gm, '');
  return code.split('\n')
    .filter(l => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(l))
    .map(l => l.replace(/^(\s*)export\s+(function|const|let|var|class)\s/, '$1$2 '))
    .join('\n');
}

// Scans one module's source line by line, registering each column-0 declared
// name into `seen` (shared across modules), and throws on a duplicate name or
// on a destructuring declaration DECL cannot name. Exported for E4/testing.
export function scanForDuplicates(code, moduleName, seen) {
  for (const line of code.split('\n')) {
    if (DESTRUCTURE.test(line)) {
      throw new Error(
        `Top-level destructuring declaration in ${moduleName} cannot be checked ` +
        `for name collisions: "${line.trim()}". Rewrite it as a named ` +
        `const/let/var so the duplicate-name detector can see the name(s).`);
    }
    if (MULTI_DECL.test(line) && hasTopLevelComma(line)) {
      throw new Error(
        `Multi-declarator top-level declaration in ${moduleName} cannot be fully ` +
        `checked for name collisions: "${line.trim()}". DECL only names the ` +
        `first declarator, so later ones would go unregistered. Split it into ` +
        `one name per statement so the duplicate-name detector can see every name.`);
    }
    const hit = DECL.exec(line);
    if (hit) {
      const name = hit[1];
      if (seen.has(name)) {
        throw new Error(
          `Duplicate top-level name "${name}" in ${moduleName}; already declared in ${seen.get(name)}. ` +
          `All modules share one scope after inlining, so names must be unique.`);
      }
      seen.set(name, moduleName);
    }
  }
  return seen;
}

// outDir lets a test point the build at a scratch directory outside the repo
// (see test/build.test.js) instead of always writing into the committed
// dist/. The real CLI invocation at the bottom of this file calls main() with
// no argument, which keeps writing to dist/ exactly as before.
export function main(outDir) {
  const seen = new Map();
  const parts = [];
  for (const m of MODULES) {
    const code = readFileSync(join(SRC, m), 'utf8');
    scanForDuplicates(code, m, seen);
    parts.push(`// ===== ${m} =====\n` + strip(code));
  }

  const js = `(function () {\n"use strict";\n${parts.join('\n')}\n})();`;

  // E3: every assertion below is a regex over text, while strip() does two
  // non-trivial rewrites. Actually parsing the assembled bundle turns an entire
  // class of stripping bugs into a loud build failure instead of a silently
  // broken shipped file.
  try {
    new Script(js);
  } catch (err) {
    throw new Error(
      `Build failed: the assembled bundle does not parse as JavaScript.\n  - ${err.message}`);
  }

  const css = readFileSync(join(SRC, 'styles.css'), 'utf8');

  let html = readFileSync(join(SRC, 'index.template.html'), 'utf8');
  if (!html.includes('<!--INLINE_CSS-->') || !html.includes('<!--INLINE_JS-->')) {
    throw new Error('index.template.html is missing one of its inline markers');
  }
  // E2: a plain string replacement pattern expands $&, $`, $', $$ and $n
  // sequences found in the REPLACEMENT text. A function replacement is spliced
  // in verbatim instead, so a `$&` anywhere in styles.css or any module can no
  // longer silently corrupt the bundle.
  html = html.replace('<!--INLINE_CSS-->', () => `<style>\n${css}\n</style>`)
             .replace('<!--INLINE_JS-->', () => `<script>\n${js}\n</script>`);

  // Build-time assertions: the artifact must be genuinely self-contained.
  const problems = [];
  if (/^\s*import\s/m.test(js)) problems.push('an import statement survived');
  if (/^\s*export\s/m.test(js)) problems.push('an export statement survived');
  // svg.js declares NS = 'http://www.w3.org/2000/svg', the XML namespace string
  // required by document.createElementNS — a fixed identifier, never fetched
  // over the network. It is excluded here so it doesn't false-positive against
  // this check; a genuine externally-loaded URL (CDN script, web font, <img
  // src>) anywhere else in the bundle still fails the build.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  if (/https?:\/\//.test(html.split(SVG_NS).join(''))) problems.push('an external URL is present');
  if (/<script[^>]+src=/.test(html)) problems.push('an external script tag is present');
  if (/<link[^>]+href=/.test(html)) problems.push('an external stylesheet is present');
  if (html.length > 250_000) problems.push(`output is ${html.length} bytes, over the 250 KB budget`);
  if (problems.length) throw new Error('Build failed:\n  - ' + problems.join('\n  - '));

  const dir = outDir || join(root, 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'torque_i_beam.html'), html);
  const label = outDir ? join(outDir, 'torque_i_beam.html') : 'dist/torque_i_beam.html';
  console.log(`built ${label}  (${html.length} bytes, ${MODULES.length} modules)`);
}

// E4: run only when this file is the program node was invoked on, so importing
// build.js from a test (to reach `strip`) doesn't also perform a real build.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
