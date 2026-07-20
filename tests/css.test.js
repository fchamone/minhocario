import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The five stylesheets, in the exact cascade order index.html must link them.
 * motion.css is last so its `prefers-reduced-motion` blanket override and the
 * T22 transition rules keep winning without `!important`.
 */
const SHEETS = ['tokens.css', 'base.css', 'components.css', 'screens.css', 'motion.css'];

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const readSheet = (name) => read(`../css/${name}`);

// --- A minimal CSS block parser --------------------------------------------
// Not a general-purpose parser: it only needs to survive this project's CSS,
// which is plain rules plus @media / @keyframes. It flattens every leaf block
// to a normalized `context selector{decls}` string so two stylesheets can be
// compared as multisets of rules regardless of how they are split across files.

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** Normalize a declaration body: trim each declaration, drop empties. */
const normalizeDecls = (body) =>
  body
    .split(';')
    .map(squash)
    .filter(Boolean)
    .join(';');

/**
 * Flatten CSS into normalized leaf blocks, prefixing nested blocks with their
 * at-rule prelude (so `@media x { .a {} }` becomes `@media x .a{...}`).
 * @param {string} css
 * @param {string} [prefix]
 * @returns {string[]}
 */
function parseBlocks(css, prefix = '') {
  const blocks = [];
  let buf = '';
  let i = 0;

  while (i < css.length) {
    const ch = css[i];

    if (ch !== '{') {
      buf += ch;
      i += 1;
      continue;
    }

    // Walk to the brace that closes this one.
    let depth = 1;
    let j = i + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      if (depth === 0) break;
      j += 1;
    }

    const selector = squash(buf);
    const body = css.slice(i + 1, j);
    const context = prefix ? `${prefix} ${selector}` : selector;

    if (body.includes('{')) blocks.push(...parseBlocks(body, context));
    else blocks.push(`${context}{${normalizeDecls(body)}}`);

    buf = '';
    i = j + 1;
  }

  return blocks;
}

// --- var() resolution -------------------------------------------------------
// Resolving down to literals is what lets a test reason about what a rule
// actually renders, rather than about the text someone typed.

/** Collect `--name: value` pairs from every :root block. @returns {Map<string,string>} */
function tokenMap(css) {
  const tokens = new Map();
  for (const block of parseBlocks(stripComments(css))) {
    if (!block.startsWith(':root{')) continue;
    const body = block.slice(block.indexOf('{') + 1, -1);
    for (const decl of body.split(';')) {
      const at = decl.indexOf(':');
      if (at === -1) continue;
      const name = decl.slice(0, at).trim();
      if (name.startsWith('--')) tokens.set(name, decl.slice(at + 1).trim());
    }
  }
  return tokens;
}

/** Substitute var(--x) until no references remain. Tokens may reference tokens. */
function resolveVars(text, tokens) {
  let out = text;
  for (let pass = 0; pass < 10 && out.includes('var('); pass += 1) {
    out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name) =>
      tokens.has(name) ? tokens.get(name) : whole,
    );
  }
  return out;
}

/**
 * Applied (non-:root) rule blocks, fully resolved to literal values.
 * :root itself is excluded: the token layer is an implementation detail, and
 * comparing definitions would only prove the two files declare the same
 * variables — which is exactly what V2a is allowed to change.
 */
function appliedBlocks(css) {
  const tokens = tokenMap(css);
  return parseBlocks(stripComments(css))
    .filter((block) => !block.startsWith(':root{'))
    .map((block) => resolveVars(block, tokens))
    .sort();
}

// --- Structure: the five-file split is real and ordered ---------------------

test('index.html links exactly the five stylesheets in cascade order', () => {
  const html = read('../index.html');
  const linked = [...html.matchAll(/<link[^>]+href="css\/([^"]+)"/g)].map((m) => m[1]);

  assert.deepEqual(
    linked,
    SHEETS,
    'index.html is the source of truth for cascade order; motion.css must stay last',
  );
});

test('no stylesheet uses @import', () => {
  for (const name of SHEETS) {
    // Comments are stripped first: every file's header states the rule in prose.
    assert.doesNotMatch(
      stripComments(readSheet(name)),
      /@import/,
      `${name} uses @import, which serialises round trips — use a <link> in index.html`,
    );
  }
});

// --- Token hygiene ----------------------------------------------------------
// V1 and V2a were guarded by a resolved-equivalence test against a frozen copy
// of the pre-token stylesheet: it proved neither refactor changed a single
// computed value. V2b retunes token values by design, so that test and its
// fixture were retired there — its final output is preserved as a
// property-level diff in tasks/v2b-computed-value-diff.md.
//
// What survives is the part that stays true forever: tokens must resolve, and
// colours must live in exactly one file.

test('no var() reference survives resolution against tokens.css', () => {
  const current = appliedBlocks(SHEETS.map(readSheet).join('\n'));
  const dangling = current.filter((block) => block.includes('var('));

  assert.deepEqual(
    dangling,
    [],
    'a var() referenced a token that tokens.css does not define',
  );
});

test('every token referenced anywhere is defined in tokens.css specifically', () => {
  const defined = new Set(tokenMap(readSheet('tokens.css')).keys());

  for (const name of SHEETS) {
    const referenced = [
      ...stripComments(readSheet(name)).matchAll(/var\(\s*(--[\w-]+)\s*\)/g),
    ].map((m) => m[1]);

    for (const token of referenced) {
      assert.ok(
        defined.has(token),
        `${name} references ${token}, which is not defined in tokens.css — ` +
          'tokens must have exactly one home, or the layer decays',
      );
    }
  }
});

// The token layer is enforced, not offered. Without this, a colour system is a
// suggestion that decays back into literals one "just this once" at a time.
test('no colour literal appears outside tokens.css', () => {
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g;

  for (const name of SHEETS.filter((n) => n !== 'tokens.css')) {
    const found = [...stripComments(readSheet(name)).matchAll(COLOUR)].map((m) => m[0]);

    assert.deepEqual(
      found,
      [],
      `${name} carries colour literals (${found.join(', ')}) — define them in tokens.css`,
    );
  }
});
