// i18n runtime — the ONLY module UI imports for text (see CLAUDE.md / spec
// C-0002). Holds the active-locale state and resolves dotted keys against the
// active catalog, falling back to the pt-BR reference on a missing key. Pure and
// Node-safe: NO DOM, NO browser globals. `main.js` reads browser values
// (localStorage/navigator) and feeds them into `resolveLang`.

import { ptBR, NICKNAME_ANIMALS, NICKNAME_ADJECTIVES } from './i18n/pt-BR.js';
import { en } from './i18n/en.js';
import { es } from './i18n/es.js';

// Nickname word banks — pt-BR-flavored and language-independent (spec C-0002),
// re-exported here so UI imports ALL text from this single entry point.
export { NICKNAME_ANIMALS, NICKNAME_ADJECTIVES };

/** Reference locale — authored first, used as the missing-key fallback. */
const REFERENCE_LANG = 'pt-BR';

/**
 * All locale catalogs, keyed by canonical BCP-47 tag. Exposed so tests and the
 * parity check can reach every catalog.
 * @type {Record<string, object>}
 */
export const CATALOGS = {
  'pt-BR': ptBR,
  en,
  es,
};

/** Supported canonical tags, in preference order. @type {readonly string[]} */
export const SUPPORTED_LANGS = ['pt-BR', 'en', 'es'];

/** Native display names for the language selector. @type {Record<string,string>} */
export const LANG_NAMES = {
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
};

/** Active locale (module state); starts at the reference locale. */
let activeLang = REFERENCE_LANG;

/**
 * Return the catalog object for a supported tag (or undefined).
 * @param {string} tag
 * @returns {object|undefined}
 */
export function getCatalog(tag) {
  return CATALOGS[tag];
}

/**
 * @returns {string} the active locale tag.
 */
export function getLang() {
  return activeLang;
}

/**
 * Set the active locale. Unsupported tags are ignored (the active locale is
 * left unchanged).
 * @param {string} tag a canonical BCP-47 tag from SUPPORTED_LANGS.
 * @returns {string} the resulting active locale.
 */
export function setLang(tag) {
  if (SUPPORTED_LANGS.includes(tag)) {
    activeLang = tag;
  }
  return activeLang;
}

/**
 * Resolve a dotted key path against a catalog object.
 * @param {object} catalog
 * @param {string} path e.g. "home.play"
 * @returns {string|undefined}
 */
function resolvePath(catalog, path) {
  return path.split('.').reduce(
    (node, key) => (node == null ? undefined : node[key]),
    /** @type {*} */ (catalog),
  );
}

/**
 * Resolve a dotted key against the ACTIVE catalog. Falls back to the pt-BR
 * reference (with a console.warn) when the key is missing in the active locale,
 * so the UI never renders blank because a translation is incomplete. If the key
 * is absent everywhere, the key path itself is returned as a last resort.
 * @param {string} path e.g. "home.play"
 * @returns {string}
 */
export function t(path) {
  const active = resolvePath(CATALOGS[activeLang], path);
  if (typeof active === 'string') {
    return active;
  }
  const fallback = resolvePath(CATALOGS[REFERENCE_LANG], path);
  if (typeof fallback === 'string') {
    console.warn(`Missing i18n key "${path}" for locale "${activeLang}"`);
    return fallback;
  }
  console.warn(`Missing i18n key "${path}" in all locales`);
  return path;
}

/**
 * Decide the active locale from a stored preference and the browser's language
 * list — pure, so it is unit-testable under Node (no navigator/localStorage
 * access; `main.js` passes the raw values in).
 *
 * 1. If `storedTag` is a supported tag → use it (an explicit choice wins).
 * 2. Else scan `navigatorLanguages`; for each, take the PRIMARY subtag and map
 *    pt → pt-BR, en → en, es → es; the first match wins.
 * 3. Else fall back to pt-BR.
 *
 * @param {string|null|undefined} storedTag the persisted `minhocario.lang`.
 * @param {readonly string[]|string|null|undefined} navigatorLanguages
 *   `navigator.languages` (or `[navigator.language]`).
 * @returns {string} a supported canonical tag.
 */
export function resolveLang(storedTag, navigatorLanguages) {
  if (SUPPORTED_LANGS.includes(storedTag)) {
    return storedTag;
  }
  /** @type {Record<string,string>} primary subtag → canonical tag */
  const primaryMap = { pt: 'pt-BR', en: 'en', es: 'es' };
  const list = Array.isArray(navigatorLanguages) ? navigatorLanguages : [];
  for (const lang of list) {
    if (typeof lang !== 'string' || lang === '') continue;
    const primary = lang.toLowerCase().split('-')[0];
    if (primaryMap[primary]) {
      return primaryMap[primary];
    }
  }
  return REFERENCE_LANG;
}
