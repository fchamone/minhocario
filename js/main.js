// Entry point and sole orchestrator between layers (sim / ui / render).
// For T1/I1 this is: detect + apply the active locale, fill the DOM with the
// active catalog's strings, and route between the four screens. Game-loop
// wiring, sim, and render layers arrive in later tasks.
//
// This is the browser layer, so it MAY use localStorage/navigator/document.
// All user-facing text still flows through the i18n runtime (js/strings.js).

import { t, setLang, resolveLang } from './strings.js';

/** @type {readonly string[]} valid screen ids in DOM `data-screen` order */
const SCREENS = ['home', 'shop', 'setup', 'game'];

/** localStorage key holding the language preference — never in the game save. */
const LANG_STORAGE_KEY = 'minhocario.lang';

/**
 * Read the persisted language preference, tolerating storage being unavailable.
 * @returns {string|null}
 */
function readStoredLang() {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist the language preference in its OWN key (never the game save),
 * tolerating storage being unavailable.
 * @param {string} tag
 */
function writeStoredLang(tag) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, tag);
  } catch {
    // Ignore — a blocked/full storage must not break language switching.
  }
}

/**
 * Fill every element carrying a `data-string="a.b.c"` attribute with its text
 * from the ACTIVE locale. Keeps all user-facing literals in the i18n layer.
 * Missing-key fallback to pt-BR (plus console.warn) lives in `t()`.
 */
function applyStrings() {
  document.title = t('appTitle');
  for (const el of document.querySelectorAll('[data-string]')) {
    el.textContent = t(el.getAttribute('data-string'));
  }
}

/**
 * Switch the active locale: update runtime state, persist the choice, reflect
 * it on `<html lang>`, and re-render every static `[data-string]` node. Exposed
 * on `window.setLang` so a language can be swapped from the devtools console.
 * @param {string} tag a supported canonical tag.
 */
function switchLang(tag) {
  const applied = setLang(tag);
  writeStoredLang(applied);
  document.documentElement.lang = applied;
  applyStrings();
  return applied;
}

/**
 * Show one screen and hide the rest.
 * @param {string} name one of SCREENS
 */
function showScreen(name) {
  if (!SCREENS.includes(name)) {
    console.warn(`Unknown screen: ${name}`);
    return;
  }
  for (const section of document.querySelectorAll('.screen')) {
    section.hidden = section.getAttribute('data-screen') !== name;
  }
}

/** Wire click handlers for anything carrying a `data-nav` attribute. */
function wireNavigation() {
  for (const el of document.querySelectorAll('[data-nav]')) {
    el.addEventListener('click', () => showScreen(el.getAttribute('data-nav')));
  }
}

function init() {
  // Resolve the locale from the persisted choice, then the browser, then pt-BR.
  const navLanguages = navigator.languages || [navigator.language];
  const lang = resolveLang(readStoredLang(), navLanguages);
  setLang(lang);
  document.documentElement.lang = lang;

  // Let a developer swap the chrome from the console: `setLang('en')`.
  window.setLang = switchLang;

  applyStrings();
  wireNavigation();
  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);
