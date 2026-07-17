// Entry point and sole orchestrator between layers (sim / ui / render).
// For T1 this is just: apply pt-BR strings to the DOM and route between the
// four screens. Game-loop wiring, sim, and render layers arrive in later tasks.

import { strings } from './strings.js';

/** @type {readonly string[]} valid screen ids in DOM `data-screen` order */
const SCREENS = ['home', 'shop', 'setup', 'game'];

/**
 * Resolve a dotted key path (e.g. "home.play") against the strings catalog.
 * @param {string} path
 * @returns {string|undefined}
 */
function resolveString(path) {
  return path.split('.').reduce(
    (node, key) => (node == null ? undefined : node[key]),
    /** @type {*} */ (strings),
  );
}

/**
 * Fill every element carrying a `data-string="a.b.c"` attribute with its
 * pt-BR text. Keeps all user-facing literals in strings.js.
 */
function applyStrings() {
  document.title = strings.appTitle;
  for (const el of document.querySelectorAll('[data-string]')) {
    const value = resolveString(el.getAttribute('data-string'));
    if (value === undefined) {
      // Surface missing keys loudly in dev rather than shipping blank UI.
      console.warn(`Missing string for key: ${el.getAttribute('data-string')}`);
      continue;
    }
    el.textContent = value;
  }
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
  applyStrings();
  wireNavigation();
  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);
