import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * V20 — the release audit, as re-runnable guards.
 *
 * `tasks/release-checklist.md` §A already CLAIMS all of this ("48 import
 * specifiers resolve inside the pruned copy", "no external URLs", "no hardcoded
 * UI literals"). Every one of those claims was produced by a one-time manual
 * sweep at T22/T23 and nothing has re-checked them since — across two whole
 * projects' worth of commits, including a webfont, an icon sprite, four new
 * render modules and a sixth stylesheet. A claim nothing re-runs is exactly the
 * shape this project keeps catching (V12's vacuous drag check, V13's one-column
 * sub-grid): green suite, ticked box, untrue statement.
 *
 * So the audit lives here instead. Everything below reads the sources — there is
 * no DOM, no browser and no server under `node --test` — and each guard was
 * broken deliberately before being trusted (the V6 discipline).
 */

const ROOT = new URL('../', import.meta.url);
const rootDir = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const abs = (rel) => path.join(rootDir, rel);

// --- The ship set -----------------------------------------------------------
// Source: tasks/release-checklist.md §C.1. Deploy is an FTP upload of these
// paths and nothing else.

const SHIP = ['index.html', 'css', 'js', 'vendor'];

/**
 * Everything deliberately left on the floor, with the reason it is not shipped.
 * Kept as a map rather than a list so the partition test below can print WHY a
 * path is excluded when it trips.
 */
const EXCLUDED = {
  'tests': 'test suite — never referenced by index.html',
  'tasks': 'planning record',
  'docs': 'maintainer reference; a mechanics spoiler sheet if shipped (§C.2)',
  '.harn': 'change-management scaffolding',
  '.claude': 'agent configuration',
  '.git': 'repository metadata',
  'DESIGN.md': 'maintainer doc; names the mechanic the food list hides (V4)',
  'CLAUDE.md': 'agent instructions',
  'README.md': 'repository front page',
  'LICENSE': 'repository metadata; the FONT licence ships separately, see below',
  '.gitignore': 'repository metadata',
  '.nojekyll': 'GitHub Pages directive; inert on the FTP host',
};

test('every top-level path is classified as shipped or excluded', () => {
  // The failure this catches: someone adds `assets/` or `sw.js` at the root and
  // the deploy set silently does not include it (a 404 in production) or the
  // exclusion list silently does not exclude it (a spoiler uploaded). Neither
  // shows up in any other test, and the FTP upload is performed by hand.
  const classified = new Set([...SHIP, ...Object.keys(EXCLUDED)]);
  const unclassified = readdirSync(rootDir).filter((entry) => !classified.has(entry));

  assert.deepEqual(
    unclassified,
    [],
    `unclassified top-level path(s): ${unclassified.join(', ')} — add each to SHIP ` +
      'or to EXCLUDED (with a reason) in tests/release.test.js AND to ' +
      'tasks/release-checklist.md §C.1, so the FTP upload set stays decided rather than assumed',
  );

  for (const shipped of SHIP) {
    assert.ok(existsSync(abs(shipped)), `ship-set path is missing from the repo: ${shipped}`);
  }
});

// --- Comment stripping ------------------------------------------------------
// Several audits below ask "does this token appear in the CODE", and this
// codebase comments heavily and in prose: `js/sim/rng.js` names `Math.random()`
// in the very comment forbidding it, and `js/sim/engine.js` uses the word
// "window" in a paragraph about eating budgets. Scanning raw text would report
// both, so every source-scanning guard here strips comments first.
//
// Safe because `js/` contains no regex literals at all (a regex holding `//` or
// `/*` is the one construct this misreads). If one ever lands, this stripper is
// what to fix — not the guard that then trips.

/**
 * Remove line and block comments, leaving string and template literals intact.
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += src[i];
          i += 1;
        }
        out += src[i];
        i += 1;
      }
      out += c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

test('the comment stripper keeps code and string literals and drops comments', () => {
  // Guards the guard: if this silently stripped nothing, three of the audits
  // below would pass on prose alone; if it silently stripped too much, they
  // would go vacuous. Both failures are invisible from a green line.
  assert.equal(stripComments('a; // Math.random()\nb;').trim(), 'a; \nb;');
  assert.equal(stripComments('a; /* Math.random() */ b;'), 'a;  b;');
  assert.equal(stripComments("const s = '// not a comment';"), "const s = '// not a comment';");
  assert.equal(stripComments('const s = "café"; // olá'), 'const s = "café"; ');
  assert.ok(stripComments(read('js/sim/rng.js')).includes('export function createRng'));
  assert.ok(!stripComments(read('js/sim/rng.js')).includes('never Math.random()'));
});

// --- Runtime source inventory -----------------------------------------------

/**
 * Every first-party `.js` file under `js/`, recursively. Excludes `vendor/`,
 * which is minified third-party code and is audited separately below.
 * @returns {Array<[string, string]>} [repo-relative path, source]
 */
function firstPartySources(dir = 'js') {
  const out = [];
  for (const entry of readdirSync(abs(dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(abs(rel)).isDirectory()) out.push(...firstPartySources(rel));
    else if (entry.endsWith('.js')) out.push([rel, read(`${rel}`)]);
  }
  return out;
}

/**
 * Static import/export specifiers in a source, comments stripped so that prose
 * like "inherited from 'applied'" is not mistaken for a module.
 * @param {string} src
 * @returns {string[]}
 */
function specifiersOf(src) {
  const code = stripComments(src);
  return [
    ...[...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bimport\s*(?:\(\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
}

/**
 * Walk the module graph from `js/main.js` — the one entry point index.html
 * loads — resolving every specifier against the filesystem.
 * @returns {{ files: Set<string>, problems: string[] }}
 */
function moduleGraph() {
  const files = new Set();
  const problems = [];
  const queue = ['js/main.js'];

  while (queue.length > 0) {
    const rel = queue.pop();
    if (files.has(rel)) continue;
    files.add(rel);

    if (!existsSync(abs(rel))) {
      problems.push(`${rel} does not exist — the pruned copy would 404 on it`);
      continue;
    }

    for (const spec of specifiersOf(read(`${rel}`))) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        problems.push(
          `${rel} imports "${spec}" — a bare or absolute specifier. Nothing resolves it ` +
            'without an import map, a bundler or a CDN, and all three are out of scope',
        );
        continue;
      }
      const target = path.posix.normalize(`${path.posix.dirname(rel)}/${spec}`);
      if (target.startsWith('..')) {
        problems.push(`${rel} imports "${spec}", which escapes the project root`);
        continue;
      }
      queue.push(target);
    }
  }

  return { files, problems };
}

test('every module reachable from js/main.js resolves inside the ship set', () => {
  const { files, problems } = moduleGraph();
  assert.deepEqual(problems, []);

  for (const rel of files) {
    const top = rel.split('/')[0];
    assert.ok(
      SHIP.includes(top),
      `${rel} is imported at runtime but sits outside the ship set — the FTP upload ` +
        'would leave it behind and the game would fail to boot',
    );
  }

  // Not a magic number to maintain: only a floor, so that a graph walk which
  // silently found nothing (a broken specifier regex, say) cannot pass.
  assert.ok(files.size >= 20, `module graph found only ${files.size} files`);
});

test('no first-party module ships without being reachable from the entry point', () => {
  // The opposite failure to the one above, and the likelier one here: a module
  // superseded and left in place still gets FTP-uploaded, still costs a
  // download, and still reads as live code to the next maintainer. V12 deleted
  // `internalsSide` rather than orphaning it precisely for this reason.
  const { files } = moduleGraph();
  const orphans = firstPartySources()
    .map(([rel]) => rel)
    .filter((rel) => !files.has(rel));

  assert.deepEqual(orphans, [], `unreachable module(s) in the ship set: ${orphans.join(', ')}`);
});

// --- index.html's own references --------------------------------------------

/** Local (non-fragment, non-data, non-external) href/src targets in index.html. */
function localRefs(html) {
  return [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !ref.startsWith('#') && !ref.startsWith('data:') && !/^[a-z]+:/i.test(ref));
}

test('every asset index.html references exists inside the ship set', () => {
  const refs = localRefs(read('index.html'));
  // Six stylesheets + the module entry point. A floor rather than an equality,
  // since css.test.js already pins the stylesheet list exactly.
  assert.ok(refs.length >= 7, `index.html references only ${refs.length} local assets`);

  for (const ref of refs) {
    assert.ok(existsSync(abs(ref)), `index.html references ${ref}, which does not exist`);
    assert.ok(
      SHIP.includes(ref.split('/')[0]),
      `index.html references ${ref}, which is outside the ship set — the pruned copy would 404`,
    );
  }
});

test('nothing the browser fetches points at an excluded path', () => {
  // The pruned copy is where this bites: a <link> to DESIGN.md or a url() into
  // docs/ works perfectly in the dev tree and 404s in production. HTML and CSS
  // only — JS comments name DESIGN.md and CLAUDE.md constantly, and should.
  const sheets = readdirSync(abs('css'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => [`css/${f}`, read(`css/${f}`)]);

  const cssRefs = sheets.flatMap(([rel, src]) =>
    [...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
      .map((m) => [rel, m[1]])
      .filter(([, ref]) => !ref.startsWith('data:')),
  );

  const htmlRefs = localRefs(read('index.html')).map((ref) => ['index.html', ref]);

  for (const [where, ref] of [...htmlRefs, ...cssRefs]) {
    const top = ref.replace(/^\.\//, '').split('/')[0];
    assert.ok(
      !(top in EXCLUDED),
      `${where} fetches ${ref}, which is excluded from the upload (${EXCLUDED[top]})`,
    );
  }
});

// --- Offline after first load -----------------------------------------------

const NETWORK_APIS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'importScripts',
  'serviceWorker',
];

test('no first-party module can reach the network', () => {
  // "Works offline after first load" is a spec non-negotiable and there is no
  // service worker to make it forgiving: the page has to be complete as served.
  for (const [rel, src] of firstPartySources()) {
    const code = stripComments(src);
    for (const api of NETWORK_APIS) {
      assert.ok(
        !code.includes(api),
        `${rel} uses ${api} — the game must be fully self-contained (spec §7)`,
      );
    }
  }
});

test('the vendored Three.js carries no reachable network call', () => {
  const vendor = read('vendor/three.module.min.js');

  // The checklist's standing claim, now checked rather than asserted in prose:
  // exactly two http(s) strings, and neither is a fetch target.
  const urls = [...vendor.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]);
  assert.deepEqual(
    [...new Set(urls)].sort(),
    [
      'http://www.w3.org/1999/xhtml',
      'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js',
    ],
    'vendor/three.module.min.js gained a URL beyond the pinned-version provenance comment ' +
      'and the XHTML namespace constant used by createElementNS',
  );

  // `fetch(` IS present in the bundle, inside loader classes. The claim has
  // never been that it is absent — it is that nothing constructs a loader, so
  // it never executes. That is the half worth testing, because it is the half
  // a future feature could break.
  const imported = new Set();
  for (const [, src] of firstPartySources()) {
    for (const m of stripComments(src).matchAll(
      /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*vendor\/three\.module\.min\.js['"]/g,
    )) {
      for (const name of m[1].split(',')) {
        const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
        if (trimmed) imported.add(trimmed);
      }
    }
  }
  assert.ok(imported.size > 0, 'no Three.js import found — the extraction regex has drifted');

  const loaders = [...imported].filter((name) => /Loader$/.test(name));
  assert.deepEqual(
    loaders,
    [],
    `the render layer imports ${loaders.join(', ')} — a Three.js loader is the one part of the ` +
      'bundle that calls fetch(), and importing one puts a network path back into a game that ' +
      'must run offline. Build meshes from primitives instead.',
  );
});

test('the webfont is embedded, and its licence ships with it', () => {
  const font = read('css/font.css');
  const sources = [...font.matchAll(/src:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(sources.length > 0, 'css/font.css declares no @font-face src');

  for (const src of sources) {
    for (const url of [...src.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((m) => m[1])) {
      assert.ok(
        url.startsWith('data:'),
        `css/font.css fetches ${url.slice(0, 60)} — the face must stay a data: URI or the ` +
          'first offline reload falls back to a system font',
      );
    }
  }

  // SIL OFL 1.1 requires its text to travel with redistributed font software,
  // and css/font.css redistributes IBM Plex Sans. This is the one .txt in the
  // ship set and it is there for licence compliance (V7).
  assert.ok(
    existsSync(abs('css/IBMPlexSans-OFL.txt')),
    'css/IBMPlexSans-OFL.txt is missing — the OFL requires it to ship alongside the embedded face',
  );
});

// --- T22 audits, re-run ------------------------------------------------------

test('js/sim/ contains no Math.random', () => {
  for (const [rel, src] of firstPartySources('js/sim')) {
    assert.ok(
      !stripComments(src).includes('Math.random'),
      `${rel} calls Math.random — all simulation randomness goes through the seeded RNG, or ` +
        'the same seed stops reproducing the same state (CLAUDE.md, spec §6 determinism)',
    );
  }
});

test('js/sim/ imports nothing outside itself and touches no browser global', () => {
  const BROWSER_GLOBALS = [
    'document',
    'window',
    'localStorage',
    'navigator',
    'globalThis',
    'requestAnimationFrame',
    'HTMLElement',
  ];

  for (const [rel, src] of firstPartySources('js/sim')) {
    const code = stripComments(src);

    for (const spec of specifiersOf(src)) {
      const target = path.posix.normalize(`${path.posix.dirname(rel)}/${spec}`);
      assert.ok(
        target.startsWith('js/sim/'),
        `${rel} imports ${spec} — js/sim/ must stay a pure engine, importable under Node ` +
          'with no DOM and no Three.js (CLAUDE.md)',
      );
    }

    for (const global of BROWSER_GLOBALS) {
      assert.ok(
        !new RegExp(`\\b${global}\\b`).test(code),
        `${rel} references ${global} — js/sim/ must run under Node with no browser present`,
      );
    }
  }
});

test('no user-facing pt-BR literal survives outside strings.js and js/i18n/', () => {
  // The T22 audit, mechanised. Portuguese copy is diacritic-dense, so a
  // hardcoded string is overwhelmingly likely to carry one — "Você", "está",
  // "não", "manutenção". It is not a complete proof (an unaccented literal
  // slips through), but it is the cheap half, it cannot go stale, and the
  // expensive half is the i18n key-parity suite that already exists.
  const ACCENTED = /[áéíóúàâêôãõçÁÉÍÓÚÀÂÊÔÃÕÇ]/;

  for (const [rel, src] of firstPartySources()) {
    if (rel === 'js/strings.js' || rel.startsWith('js/i18n/')) continue;
    const code = stripComments(src);
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      assert.ok(
        !ACCENTED.test(line),
        `${rel}:${i + 1} carries a pt-BR literal outside the string catalog — every ` +
          `user-facing string goes through t() (CLAUDE.md): ${line.trim().slice(0, 80)}`,
      );
    });
  }
});

test('the pt-BR literal walker actually detects a violation', () => {
  // Companion for the guard above, which passes today and would keep passing if
  // the stripper ever ate too much. Both halves matter: a planted literal must
  // trip, and the same text inside a comment must not.
  const ACCENTED = /[áéíóúàâêôãõçÁÉÍÓÚÀÂÊÔÃÕÇ]/;
  const planted = stripComments("el.textContent = 'Colônia morta';");
  assert.ok(ACCENTED.test(planted));

  const commented = stripComments("// Colônia morta\nel.textContent = t('game.dead');");
  assert.ok(!ACCENTED.test(commented));
});
