// Desktop-only gate.
//
// A maintainer decision, taken 2026-07-21: the game refuses to run on a
// touch-primary device rather than shipping a phone experience. It replaces the
// spec §6 mobile acceptance criterion, and that swap is recorded in
// `tasks/release-checklist.md` rather than left for a later reader to infer.
//
// Detection is by CAPABILITY, not by user agent. `(pointer: coarse) and
// (hover: none)` describes the thing actually being excluded — a device whose
// primary input is a finger — and it gets iPadOS right (which reports itself as
// macOS) while leaving touchscreen laptops alone (they have a mouse, so they
// report a fine pointer and hover). A UA blocklist gets both of those wrong and
// goes stale besides.
//
// The predicate takes `matchMedia` as a parameter, so it is exercised here with
// stubs under Node — the same shape `js/storage.js` uses for localStorage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TOUCH_ONLY_QUERY, isTouchPrimary } from '../js/ui/platform.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A matchMedia stub that answers `matches` for exactly `query`. */
const stubMatchMedia = (matching) => (query) => ({ matches: query === matching, media: query });

test('a touch-primary device is detected', () => {
  assert.equal(isTouchPrimary(stubMatchMedia(TOUCH_ONLY_QUERY)), true);
});

test('a device with a fine pointer or hover is not', () => {
  // The touchscreen laptop case: touch is present, but so is a mouse, so the
  // query does not match and the player is left alone. This is the whole reason
  // the rule is `coarse AND no-hover` rather than "has touch".
  assert.equal(isTouchPrimary(stubMatchMedia('(min-width: 1600px)')), false);
});

test('an absent or broken matchMedia does NOT lock the player out', () => {
  // Fail OPEN. A browser too old for matchMedia is far likelier to be an odd
  // desktop than a phone, and the cost of guessing wrong in this direction is a
  // slightly awkward layout; guessing wrong in the other direction is a blank
  // wall on a machine that could have played fine.
  assert.equal(isTouchPrimary(undefined), false);
  assert.equal(isTouchPrimary(null), false);
  assert.equal(
    isTouchPrimary(() => {
      throw new Error('matchMedia exploded');
    }),
    false,
  );
  assert.equal(isTouchPrimary(() => null), false);
});

test('the query names both halves of the rule', () => {
  assert.match(TOUCH_ONLY_QUERY, /pointer:\s*coarse/);
  assert.match(TOUCH_ONLY_QUERY, /hover:\s*none/);
  assert.ok(
    !/android|iphone|ipad|mobile/i.test(TOUCH_ONLY_QUERY),
    'detection must stay capability-based — no user-agent sniffing',
  );
});

// --- The two representations of one rule must agree --------------------------

test('the CSS media query is character-for-character the JS query', () => {
  // The trap this exists for: the gate is enforced TWICE — CSS paints the notice
  // and hides the app, JS refuses to boot the scene. If the two drift, the
  // failure is silent in both directions. A CSS query looser than the JS one
  // shows a "desktop only" wall to someone the game would have booted for; a JS
  // query looser than the CSS one boots a WebGL scene behind a notice the player
  // cannot see past. Neither throws.
  const screens = read('../css/screens.css');
  const declared = [...screens.matchAll(/@media\s*(\([^{]*?\))\s*\{/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter((q) => /pointer|hover/.test(q));

  assert.equal(
    declared.length,
    1,
    `expected exactly one touch-primary media query in screens.css, found ${declared.length}`,
  );
  assert.equal(
    declared[0],
    TOUCH_ONLY_QUERY.replace(/\s+/g, ' ').trim(),
    'css/screens.css and js/ui/platform.js state the same rule twice — keep them identical',
  );
});

test('the gate paints the notice and hides the app in the same rule', () => {
  const screens = read('../css/screens.css');
  const at = screens.search(/@media\s*\([^{]*pointer[^{]*\{/);
  assert.notEqual(at, -1, 'no touch-primary media query in screens.css');

  // Balance braces to take exactly the media block, not "the rest of the file".
  const open = screens.indexOf('{', at);
  let depth = 1;
  let i = open + 1;
  while (i < screens.length && depth > 0) {
    if (screens[i] === '{') depth += 1;
    else if (screens[i] === '}') depth -= 1;
    i += 1;
  }
  const block = screens.slice(open + 1, i - 1);

  assert.match(block, /#desktop-only/, 'the gate does not reveal the notice');
  assert.match(block, /#app/, 'the gate does not hide the app');
});

test('the notice is hidden by default, outside the gate', () => {
  // Otherwise every desktop player sees it too — and the media query would then
  // be doing nothing at all, which no other test would notice.
  const screens = read('../css/screens.css');
  const before = screens.slice(0, screens.search(/@media\s*\([^{]*pointer/));
  assert.match(
    before,
    /#desktop-only\s*\{[^}]*display:\s*none/,
    '#desktop-only must default to display: none and be revealed only by the gate',
  );
});

// --- Markup and boot ----------------------------------------------------------

test('the notice sits outside #app, so hiding the app cannot hide it', () => {
  const html = read('../index.html');
  const notice = html.indexOf('id="desktop-only"');
  const appOpen = html.indexOf('<main id="app"');
  const appClose = html.indexOf('</main>');

  assert.notEqual(notice, -1, 'index.html carries no #desktop-only notice');
  assert.ok(
    notice < appOpen || notice > appClose,
    'the notice is inside <main id="app">, which the gate hides — it would hide itself too',
  );
  assert.ok(
    !/id="desktop-only"[^>]*class="[^"]*\bscreen\b/.test(html),
    'the notice must not be a .screen — showScreen() would fight the gate for it',
  );
});

test('every string in the notice comes from the catalog', () => {
  const html = read('../index.html');
  const block = html.slice(html.indexOf('id="desktop-only"'));
  const section = block.slice(0, block.indexOf('</section>'));

  const keys = [...section.matchAll(/data-string="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 2, 'the notice should carry a title and an explanation');
  for (const key of keys) {
    assert.match(key, /^desktopOnly\./, `unexpected key in the notice: ${key}`);
  }
});

test('boot refuses to start the scene on a touch-primary device', () => {
  // The CSS alone would leave a phone downloading Three.js and spinning up a
  // WebGL context behind a notice it cannot see past. Asserted by source read:
  // init() runs against a real DOM and cannot be called under Node.
  const main = read('../js/main.js');
  const init = main.slice(main.indexOf('function init()'));

  const guard = init.search(/isTouchPrimary\s*\(/);
  const scene = init.search(/initScene\s*\(|showScreen\s*\(/);

  assert.notEqual(guard, -1, 'init() does not consult isTouchPrimary');
  assert.notEqual(scene, -1, 'init() no longer starts a screen or a scene');
  assert.ok(
    guard < scene,
    'the touch-primary check must come BEFORE anything boots, or the phone pays ' +
      'for a scene it will never be shown',
  );
});
