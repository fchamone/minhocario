import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The stylesheets, in the exact cascade order index.html must link them.
 * motion.css is last so its `prefers-reduced-motion` blanket override and the
 * T22 transition rules keep winning without `!important`. tokens.css and
 * font.css declare resources and select nothing, so they lead harmlessly.
 */
const SHEETS = [
  'tokens.css',
  'font.css',
  'base.css',
  'components.css',
  'screens.css',
  'motion.css',
];

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

test('index.html links exactly the expected stylesheets, in cascade order', () => {
  const html = read('../index.html');
  const linked = [...html.matchAll(/<link[^>]+href="css\/([^"]+\.css)"/g)].map((m) => m[1]);

  assert.deepEqual(
    linked,
    SHEETS,
    'index.html is the source of truth for cascade order; motion.css must stay last',
  );
});

// "Fully static and self-contained: no CDN, no external network calls, works
// offline after first load" is a project non-negotiable. The embedded webfont is
// the first thing that could quietly violate it — a stray src fallback pointing
// at a foundry or Google Fonts would work in dev and break offline.
test('no stylesheet references an external URL', () => {
  for (const name of SHEETS) {
    const css = stripComments(readSheet(name));
    const external = [...css.matchAll(/url\(\s*['"]?(?!data:)([^'")]+)['"]?\s*\)/g)]
      .map((m) => m[1].trim())
      .filter((u) => /^(https?:)?\/\//.test(u) || /^[\w.-]+\.(com|net|org|io)\b/.test(u));

    assert.deepEqual(
      external,
      [],
      `${name} points at ${external.join(', ')} — the game must work offline; ` +
        'embed the asset as a data: URI instead',
    );
  }
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

// --- Contrast ---------------------------------------------------------------
// Colours that carry TEXT have a contrast floor; fills and borders do not. That
// distinction is why the state tiers split into --state-*/--state-*-ink:
// #c0563f is a good alarm colour and a bad on-dark text colour (2.7:1 in the
// stats box). Only the ink half is checked here — asserting AA on a gauge
// marker would be meaningless and would force the alarm to wash out.
//
// This exists because the failure it catches is invisible to every other test
// and easy to miss by eye: --ink-faint was first drafted at #7d8f78 and shipped
// nowhere, because this measurement caught it at 4.36:1.

/** WCAG 2.1 relative luminance. @param {string} hex @returns {number} */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every text colour clears WCAG AA on every surface it can sit on', () => {
  const tokens = tokenMap(readSheet('tokens.css'));
  const resolved = (name) => resolveVars(`var(${name})`, tokens);

  // Each text colour is checked against the surfaces it ACTUALLY sits on, not
  // against all of them. A blanket list is wrong in both directions: it would
  // fail --ink-faint for a pairing that never occurs, and it would silently
  // stop covering an ink the day it appears somewhere new.
  //
  // Fills and borders (--state-warn, --state-alert) are deliberately absent —
  // they carry no text and have no contrast floor.
  //
  // --surface-3 appears nowhere yet. When Phase B gives it a user, every ink
  // placed on it must be added here; note --ink-faint is only 3.5:1 against it,
  // so that pairing needs one of the two to move.
  //
  // The internals panel's real background is --surface-1-alpha (92% --surface-1
  // over the 3D stage). --surface-1 is the right proxy: the stage behind it is
  // comparably dark, and the 8% bleed cannot move the ratio meaningfully.
  const INK_SURFACES = {
    '--ink': ['--surface-0', '--surface-1', '--surface-2'],
    '--ink-dim': ['--surface-0', '--surface-1', '--surface-2'],
    // Only .internals__empty (over --surface-1) and .ranking__empty (--surface-0).
    '--ink-faint': ['--surface-0', '--surface-1'],
    '--accent': ['--surface-0', '--surface-1', '--surface-2'],
    '--state-warn-ink': ['--surface-0', '--surface-1', '--surface-2'],
    '--state-alert-ink': ['--surface-0', '--surface-1', '--surface-2'],
  };

  for (const [ink, surfaces] of Object.entries(INK_SURFACES)) {
    for (const surface of surfaces) {
      const ratio = contrast(resolved(ink), resolved(surface));
      assert.ok(
        ratio >= 4.5,
        `${ink} on ${surface} is ${ratio.toFixed(2)}:1 — below WCAG AA (4.5). ` +
          'Lighten the ink, or if this pairing never actually occurs, narrow ' +
          'its surface list above and say why.',
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
