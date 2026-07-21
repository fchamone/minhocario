// Platform gate — the one place the game decides it will not run here.
//
// Maintainer decision, 2026-07-21: Minhocário is desktop-only. It is built for a
// large screen and for dragging the composter across the wall with a mouse, and
// the three-column game screen is laid out around that. Rather than ship a phone
// experience nobody would enjoy, a touch-primary device gets a plain notice and
// nothing else. This REPLACES the spec §6 mobile acceptance criterion; the swap
// is recorded in tasks/release-checklist.md.
//
// Detection is by CAPABILITY, deliberately, and never by user agent:
//
//   - `pointer: coarse` — the primary pointing device is imprecise (a finger).
//   - `hover: none`     — it cannot hover, so there is no mouse alongside it.
//
// Both together is the standard description of "phone or tablet". It gets right
// the two cases a UA blocklist gets wrong in opposite directions: **iPadOS**
// reports itself as macOS and would sail through a UA check, while a
// **touchscreen Windows laptop** would be wrongly blocked by one — here it has a
// mouse, so it hovers, so it plays. A UA list also goes stale as devices ship
// and is bypassed by "request desktop site"; this rule needs no maintenance.
//
// PURE except for the matchMedia function handed to it, which is why the
// predicate takes that as a parameter — the same shape js/storage.js uses for
// localStorage, and what lets tests/platform.test.js exercise it under Node.

/**
 * The media query, stated once. `css/screens.css` states it a second time —
 * unavoidably, since CSS paints the notice and JS declines to boot — and
 * tests/platform.test.js asserts the two are character-for-character identical.
 * If they drift the failure is silent both ways: a wall shown to someone the
 * game would have run for, or a WebGL scene booted behind a notice.
 */
export const TOUCH_ONLY_QUERY = '(pointer: coarse) and (hover: none)';

/**
 * Is this a device whose primary input is touch, with no pointer alongside it?
 *
 * Fails **open**. A browser without `matchMedia`, or one that throws on it, is
 * far likelier to be an unusual desktop than a phone, and the cost of guessing
 * wrong that way is an awkward layout — while guessing wrong the other way is a
 * blank wall on a machine that could have played fine.
 *
 * @param {((query: string) => {matches: boolean}|null)|null|undefined} matchMedia
 *   usually `globalThis.matchMedia`, bound or passed in by the caller.
 * @returns {boolean}
 */
export function isTouchPrimary(matchMedia) {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia(TOUCH_ONLY_QUERY)?.matches === true;
  } catch {
    return false;
  }
}
