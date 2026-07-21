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

// --- The internals sub-grid actually has room to be a sub-grid ---------------
// V13 densifies the readouts column by letting its groups sit side by side at
// wide viewports: `repeat(auto-fit, minmax(220px, 1fr))`. auto-fit is silent
// when it cannot fit a second column — it just lays out one, at every width, on
// every monitor. Nothing throws and nothing looks broken; the density pass
// simply does not happen, and the only way to notice is to have expected it.
//
// The trap is that the two numbers live in different rules in different files:
// the sub-grid's column minimum here, and the width of the track it sits in
// over in the game-screen grid. V13 as originally specified had exactly this
// bug — a 220px minimum inside a track capped at 340px, which can never fit
// two columns. So the arithmetic is asserted rather than eyeballed.

/** First declaration of `prop` inside the first rule matching `selectorPattern`. */
function declIn(css, selectorPattern, prop) {
  const block = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`).exec(stripComments(css));
  if (!block) return null;
  const decl = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;}]+)`).exec(block[1]);
  return decl ? squash(decl[1]) : null;
}

test('the wide-viewport readouts track can actually fit two sub-grid columns', () => {
  const tokens = tokenMap(readSheet('tokens.css'));
  const screens = readSheet('screens.css');
  const components = readSheet('components.css');

  /** Resolve a token-bearing length to a plain number of px. */
  const px = (value) => {
    const n = /(-?\d+(?:\.\d+)?)px/.exec(resolveVars(value, tokens));
    assert.ok(n, `expected a px length, got \`${value}\``);
    return Number(n[1]);
  };

  const columns = declIn(screens, '#internals-body', 'grid-template-columns');
  assert.ok(columns, 'screens.css should lay #internals-body out as a grid');
  const colMin = px(/minmax\(\s*([^,]+),/.exec(columns)[1]);
  const gap = px(declIn(screens, '#internals-body', 'gap'));

  // The panel's own horizontal padding eats into the track twice over.
  const padding = px(declIn(components, '\\.internals', 'padding').split(/\s+/).pop());

  // The widened track lives behind the wide-viewport media query. Everything
  // after that marker is the wide layout, so the tail is the right place to look.
  const wide = screens.slice(screens.indexOf('@media (min-width: 1600px)'));
  assert.ok(wide, 'screens.css should widen the readouts track at wide viewports');
  const track = declIn(wide, '\\.screen--game', 'grid-template-columns');
  const trackMax = px(/minmax\([^,]+,\s*([^)]+)\)/.exec(track)[1]);

  const available = trackMax - 2 * padding;
  const needed = 2 * colMin + gap;

  assert.ok(
    available >= needed,
    `the readouts track is ${trackMax}px at wide viewports, leaving ${available}px ` +
      `of content width, but two ${colMin}px sub-grid columns plus a ${gap}px gap ` +
      `need ${needed}px. auto-fit will silently lay out ONE column at every ` +
      'width, so the density pass never happens — widen the track or lower the ' +
      'column minimum.',
  );
});

// --- The game screen fits a phone ------------------------------------------
// V20's audit finding, and the one thing in this project that a green suite,
// four desktop checkpoints and a careful diff read all missed together.
//
// V12 replaced the v1 layout (`1fr 260px`, whose stage had no floor and simply
// shrank) with three tracks carrying FIXED minimums. A grid track never shrinks
// below its minmax minimum, so 280 + 260 is a hard 540px floor: under that the
// page overflows horizontally AND the stage — `minmax(0, 1fr)`, correctly
// floorless — resolves to zero width. No 3D scene at all, which is the spec's
// mobile acceptance criterion failing outright.
//
// Nothing warned. It is not a parse error, the desktop layout it was designed
// for is fine, and CPV1–CPV4 were all walked on desktop. `<meta name="viewport"
// content="width=device-width">` means there is no scale-down rescue either.

/** Split a `grid-template-columns` value into tracks, keeping `minmax(a, b)` whole. */
function trackList(columns) {
  return columns.split(/\s+(?![^(]*\))/).filter(Boolean);
}

/** Total width the track list demands before anything is allowed to shrink. */
function trackFloor(columns) {
  let total = 0;
  for (const track of trackList(columns)) {
    // `minmax(A, B)` floors at A; `auto`, `1fr` and `minmax(0, 1fr)` floor at 0.
    const minmax = /^minmax\(\s*([^,]+),/.exec(track);
    const value = minmax ? minmax[1] : track;
    const px = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
    total += px ? Number(px[1]) : 0;
  }
  return total;
}

test('the track-floor arithmetic matches how grid actually sizes tracks', () => {
  // Guards the guard, because every number below comes out of it.
  assert.equal(trackFloor('minmax(280px, 340px) minmax(0, 1fr) minmax(260px, 320px)'), 540);
  assert.equal(trackFloor('auto minmax(0, 1fr) minmax(260px, 320px)'), 260);
  assert.equal(trackFloor('minmax(0, 1fr)'), 0);
  assert.equal(trackFloor('1fr 260px'), 260); // the v1 layout, which fitted a phone
});

test('the game screen fits the narrowest phone, panel open or collapsed', () => {
  // 360px is the narrowest viewport still in real use (Galaxy A-series and the
  // small-Android floor); an iPhone SE is 375 and a modern iPhone 390. If the
  // layout clears 360 it clears all of them.
  const PHONE = 360;
  const screens = stripComments(readSheet('screens.css'));

  // Every `.screen--game` column declaration, with the media context it sits in.
  // Source order matters and so does the `:has()` variant: `:has()` takes the
  // specificity of its argument, so `.screen--game:has(#internals:not([open]))`
  // carries an ID and BEATS a plain `.screen--game` inside any media query. A
  // narrow-viewport rule that forgets it fixes the layout only while the panel
  // is open — the exact silent-degradation trap V13 documented in the opposite
  // direction.
  // Split into media contexts first (an @media body nests braces, so one flat
  // rule regex over the whole sheet cannot see inside it), then read each rule's
  // full selector LIST. Both halves were learned by getting them wrong: the
  // first draft of this parser matched only a selector sitting immediately after
  // `@media (...) {` and only a single selector before `{`, so it silently
  // failed to see the very rule that fixes this — a guard that cannot see the
  // fix reports the bug forever, which is the same vacuity trap in a new coat.
  const contexts = [];
  let rest = '';
  for (let i = 0; i < screens.length; ) {
    const at = screens.indexOf('@media', i);
    if (at === -1) {
      rest += screens.slice(i);
      break;
    }
    rest += screens.slice(i, at);
    const open = screens.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    while (j < screens.length && depth > 0) {
      if (screens[j] === '{') depth += 1;
      else if (screens[j] === '}') depth -= 1;
      j += 1;
    }
    contexts.push({ media: squash(screens.slice(at + 6, open)), body: screens.slice(open + 1, j - 1) });
    i = j;
  }
  contexts.unshift({ media: null, body: rest });

  const rules = [];
  for (const { media, body } of contexts) {
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const columns = /(?:^|;)\s*grid-template-columns\s*:\s*([^;}]+)/.exec(m[2]);
      const areas = /(?:^|;)\s*grid-template-areas\s*:\s*([^;}]+)/.exec(m[2]);
      if (!columns && !areas) continue;
      for (const selector of m[1].split(',').map(squash)) {
        if (!/^\.screen--game(:has\(.*\))?$/.test(selector)) continue;
        rules.push({
          media,
          selector,
          collapsed: selector.includes(':has'),
          columns: columns ? squash(columns[1]) : null,
          // Column count of the named grid: the tokens in one quoted row.
          areaColumns: areas ? (/'([^']*)'/.exec(areas[1])?.[1] ?? '').trim().split(/\s+/).length : null,
        });
      }
    }
  }
  assert.ok(rules.length > 0, 'no .screen--game grid-template-columns found');

  /** Does this rule's media context apply at `width`? */
  const applies = (media, width) => {
    if (!media) return true;
    const min = /min-width:\s*(\d+)px/.exec(media);
    const max = /max-width:\s*(\d+)px/.exec(media);
    if (min && width < Number(min[1])) return false;
    if (max && width > Number(max[1])) return false;
    return true;
  };

  /**
   * The rule that wins for `prop` in the given panel state: `:has()` carries an
   * ID and outranks a plain `.screen--game`; otherwise later source order wins.
   * A media query contributes no specificity at all.
   */
  const winnerFor = (prop, collapsed) => {
    const candidates = rules.filter(
      (r) => r[prop] != null && applies(r.media, PHONE) && (collapsed || !r.collapsed),
    );
    if (collapsed) {
      const byId = candidates.filter((r) => r.collapsed);
      if (byId.length > 0) return byId.at(-1);
    }
    return candidates.at(-1);
  };

  for (const collapsed of [false, true]) {
    const winner = winnerFor('columns', collapsed);
    assert.ok(winner, 'no rule applies at phone width');

    // The two halves of one grid must agree on how many columns there are. This
    // is what a narrow rule that forgets the `:has()` variant actually breaks —
    // NOT the width: `auto minmax(0,1fr) minmax(260px,320px)` floors at 260 and
    // fits a phone fine. What happens instead is that the collapsed rule wins
    // for `grid-template-columns` (three tracks) while the narrow rule still
    // wins for `grid-template-areas` (one), so every named area lands in the
    // first track and the other two sit empty. Nothing overflows, nothing
    // throws, and the screen is wrecked — a mismatch that only a real browser
    // or this line will ever report.
    const areaWinner = winnerFor('areaColumns', collapsed);
    if (areaWinner) {
      assert.equal(
        trackList(winner.columns).length,
        areaWinner.areaColumns,
        `at ${PHONE}px with the panel ${collapsed ? 'collapsed' : 'open'}, ` +
          `\`${winner.selector}\` declares ${trackList(winner.columns).length} column(s) ` +
          `(\`${winner.columns}\`) while \`${areaWinner.selector}\` names ` +
          `${areaWinner.areaColumns} — the named areas all collapse into the first ` +
          'track. A narrow-viewport rule must cover the `:has()` collapse variant ' +
          'too: that selector carries an ID and outranks a plain .screen--game, ' +
          'and a media query adds no specificity.',
      );
    }

    const floor = trackFloor(winner.columns);
    assert.ok(
      floor <= PHONE,
      `at ${PHONE}px with the readouts panel ${collapsed ? 'collapsed' : 'open'}, ` +
        `\`${winner.selector}\` demands ${floor}px of fixed track ` +
        `(\`${winner.columns}\`). Grid never shrinks a track below its minmax ` +
        'minimum, so the page overflows sideways and the stage — floorless by ' +
        'design — collapses to zero width: no 3D scene, which is the spec §6 ' +
        'mobile criterion. Add a narrow-viewport rule that stacks the columns, ' +
        'and make it cover the :has() collapse variant too (that selector carries ' +
        'an ID and outranks a plain .screen--game inside a media query).',
    );
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
