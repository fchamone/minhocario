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

// Each text colour is checked against the surfaces it ACTUALLY sits on, not
// against all of them. A blanket list is wrong in both directions: it would
// fail --ink-faint for a pairing that never occurs, and it would silently
// stop covering an ink the day it appears somewhere new.
//
// Fills and borders (--state-warn, --state-alert) are deliberately absent —
// they carry no text and have no contrast floor.
//
// The internals panel used to need a proxy here: as a stage overlay it was
// painted in a 92%-opaque --surface-1 and measured against the opaque step.
// V12 made it its own grid column, so it is painted in --surface-1 directly and
// the pairing is now measured rather than approximated.
//
// V10 gave --surface-3 its first users (the hovered species row and language
// button). Only three inks can reach it, and the two that CANNOT are the point
// of writing this down: --ink-faint measures 3.5:1 there and --state-alert-ink
// 4.3:1, so neither may be placed on --surface-3 without moving a value. That
// is why the shop card raises its border on hover instead of its fill — the
// "cannot afford" reason line is --state-alert-ink and would have failed here.
const INK_SURFACES = {
  '--ink': ['--surface-0', '--surface-1', '--surface-2', '--surface-3'],
  '--ink-dim': ['--surface-0', '--surface-1', '--surface-2', '--surface-3'],
  // Only .internals__empty (over --surface-1) and .ranking__empty (--surface-0).
  '--ink-faint': ['--surface-0', '--surface-1'],
  '--accent': ['--surface-0', '--surface-1', '--surface-2', '--surface-3'],
  '--state-warn-ink': ['--surface-0', '--surface-1', '--surface-2'],
  '--state-alert-ink': ['--surface-0', '--surface-1', '--surface-2'],
};

test('every text colour clears WCAG AA on every surface it can sit on', () => {
  const tokens = tokenMap(readSheet('tokens.css'));
  const resolved = (name) => resolveVars(`var(${name})`, tokens);

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

// The contrast map above is only as good as its coverage: it measures the
// pairings someone remembered to list. --surface-3 shipped in V2b with no user
// at all and sat unmeasured for four tasks precisely because nothing forced the
// question. This is what forces it — paint a surface anywhere and it must appear
// in INK_SURFACES, which means someone had to decide which inks may sit on it.
//
// Scoped to the four opaque steps on purpose: --scrim/--scrim-dim are backdrops
// that carry no text of their own, and --stage-sky sits behind a canvas.
test('every surface painted in the sheets is covered by the contrast map', () => {
  const measured = new Set(Object.values(INK_SURFACES).flat());

  for (const name of SHEETS) {
    const painted = [
      ...stripComments(readSheet(name)).matchAll(
        /background(?:-color)?\s*:\s*var\(\s*(--surface-\d)\s*\)/g,
      ),
    ].map((m) => m[1]);

    for (const surface of painted) {
      assert.ok(
        measured.has(surface),
        `${name} paints ${surface}, which no ink is measured against — add it to ` +
          'INK_SURFACES for every ink that can sit on it, or say why none can',
      );
    }
  }
});

// --- The spacing and type scales ---------------------------------------------
// The same argument as the colour rule, applied to the other two scales: a
// vocabulary nobody is held to decays back into literals. V10's AC ("all three
// screens on the token scale — no stray literals") is only a claim until
// something can fail on it.
//
// Deliberately narrow. It polices the properties the SCALES cover — box spacing
// and type size — and nothing else. Widths, heights, offsets, hairline borders
// and radii are the dimensions of specific components rather than steps on a
// ramp, and forcing them onto a 4px grid would be cargo-culting the rule instead
// of applying it. Negative values are exempt for the same reason: the spacing
// scale has no negative steps, so a negative margin is always a geometry nudge
// (`.gauge__marker` centring itself on its own position), never a missed token.

/** The px literals that are deliberate, each documented in DESIGN.md. */
const ALLOWED_LENGTHS = new Map([
  ['44px', 'dev-nav clearance in the HUD — measured off that bar, not a scale step'],
  ['56px', 'dev-nav clearance in .screen — same'],
]);

const SCALE_PROPERTIES = /(?:^|[;{])\s*((?:padding|margin)(?:-(?:top|right|bottom|left))?|(?:row-|column-)?gap|font-size)\s*:\s*([^;}]+)/g;

/**
 * Off-scale px/rem lengths in spacing/type declarations.
 * @param {string} css
 * @returns {string[]} `property: value` for each offending declaration
 */
function offScaleLengths(css) {
  const found = [];
  for (const [, property, value] of stripComments(css).matchAll(SCALE_PROPERTIES)) {
    for (const [literal] of value.matchAll(/(?<!-)\b\d+(?:\.\d+)?(?:px|rem)\b/g)) {
      if (!ALLOWED_LENGTHS.has(literal)) found.push(`${property}: ${value.trim()}`);
    }
  }
  return found;
}

test('every spacing and type length comes from the scale, not a literal', () => {
  for (const name of SHEETS.filter((n) => n !== 'tokens.css')) {
    assert.deepEqual(
      offScaleLengths(readSheet(name)),
      [],
      `${name} sizes with literals instead of --space-* / --text-* tokens`,
    );
  }
});

test('the off-scale length walker actually detects a violation', () => {
  // Guards the guard (the V6 lesson): every rule above passes trivially once
  // satisfied, so prove this one sees what it claims to police.
  assert.deepEqual(offScaleLengths('.a { padding: 13px; }'), ['padding: 13px']);
  assert.equal(offScaleLengths('.a { font-size: 0.9rem; }').length, 1);
  assert.equal(offScaleLengths('.a { gap: 6px var(--space-2); }').length, 1);

  // ...and prove it stays quiet on the four things it deliberately permits.
  assert.deepEqual(offScaleLengths('.a { padding: var(--space-3) var(--space-4); }'), []);
  assert.deepEqual(offScaleLengths('.a { margin-left: -1px; }'), [], 'negatives are geometry');
  assert.deepEqual(offScaleLengths('.a { padding-top: 44px; }'), [], 'documented clearance');
  assert.deepEqual(offScaleLengths('.a { width: 90px; height: 8px; border-radius: 2px; }'), []);
});

// --- Named grid areas resolve both ways --------------------------------------
// V12 moved the game screen onto a three-column named-area grid, which makes
// area names a new class of silent failure. `grid-area: readouts` against a
// template spelling it `readout` does not warn: the element is placed into an
// implicit track instead, so it still renders, just in the wrong place and at
// the wrong size — and on a screen where one of the regions is a WebGL canvas,
// "wrong size" reads as a stretched scene rather than as a CSS bug.
//
// Checked in both directions. An unused area name means the template reserves
// space for a region that no longer exists (an empty column), which is exactly
// what a half-finished layout edit leaves behind.

/**
 * Area names declared by `grid-template-areas`, and names claimed by
 * `grid-area`. The `.` placeholder is a deliberate empty cell, not a name.
 * @param {string} css
 * @returns {{declared: Set<string>, used: Set<string>}}
 */
function gridAreaNames(css) {
  const stripped = stripComments(css);
  const declared = new Set();
  const used = new Set();

  for (const [, value] of stripped.matchAll(/grid-template-areas\s*:\s*([^;}]+)/g)) {
    for (const [, row] of value.matchAll(/["']([^"']*)["']/g)) {
      for (const cell of row.split(/\s+/).filter(Boolean)) {
        if (cell !== '.') declared.add(cell);
      }
    }
  }

  for (const [, value] of stripped.matchAll(/(?:^|[;{])\s*grid-area\s*:\s*([^;}]+)/g)) {
    const name = squash(value);
    // The shorthand form (`grid-area: 1 / 2 / 3 / 4`) places by line, not name.
    if (/^[a-zA-Z][\w-]*$/.test(name)) used.add(name);
  }

  return { declared, used };
}

test('every grid-area name resolves to a declared template area, and vice versa', () => {
  // One sheet at a time: an area declared in screens.css and claimed from
  // components.css would be a cross-file coupling worth failing on anyway.
  for (const name of SHEETS) {
    const { declared, used } = gridAreaNames(readSheet(name));
    if (declared.size === 0 && used.size === 0) continue;

    for (const area of used) {
      assert.ok(
        declared.has(area),
        `${name}: \`grid-area: ${area}\` names no area in any grid-template-areas — ` +
          'the element lands in an implicit track instead, silently misplaced',
      );
    }
    for (const area of declared) {
      assert.ok(
        used.has(area),
        `${name}: grid-template-areas reserves \`${area}\`, which nothing claims — ` +
          'that is an empty track left by a half-finished layout edit',
      );
    }
  }
});

test('the grid-area walker actually detects a violation both ways', () => {
  // Guards the guard (the V6 lesson).
  const typo = ".g { grid-template-areas: 'hud hud' 'stage actions'; } .a { grid-area: action; }";
  const { declared, used } = gridAreaNames(typo);
  assert.ok(!declared.has('action') && used.has('action'), 'typo must be visible as unresolved');
  assert.ok(declared.has('actions') && !used.has('actions'), 'and as an unclaimed area');

  // The `.` placeholder is an empty cell, and the line-number shorthand is not a name.
  const fine = ".g { grid-template-areas: 'a .'; } .a { grid-area: a; } .b { grid-area: 1 / 2 / 3 / 4; }";
  const both = gridAreaNames(fine);
  assert.deepEqual([...both.declared], ['a']);
  assert.deepEqual([...both.used], ['a']);
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
