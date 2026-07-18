// Entry point and sole orchestrator between layers (sim / ui / render).
// For T1/I1 this is: detect + apply the active locale, fill the DOM with the
// active catalog's strings, and route between the four screens. Game-loop
// wiring, sim, and render layers arrive in later tasks.
//
// This is the browser layer, so it MAY use localStorage/navigator/document.
// All user-facing text still flows through the i18n runtime (js/strings.js).

import { t, setLang, resolveLang } from './strings.js';
import { initHome } from './ui/home.js';
import { initShop } from './ui/shop.js';
import { load } from './storage.js';
import { STARTING_WALLET } from './sim/engine.js';

/** @type {readonly string[]} valid screen ids in DOM `data-screen` order */
const SCREENS = ['home', 'shop', 'setup', 'game'];

// The new-farm draft carried shop → setup. The composter choice is NOT persisted
// until the farm is actually created and saved at setup (T12); this keeps an
// abandoned purchase from mutating the save or the wallet.
const newFarmDraft = { composterId: null };

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
 * Coins currently on the player profile, read fresh from the save. Falls back to
 * the starting wallet if there is no save yet (initHome creates one on first
 * visit, so this fallback is only a safety net).
 * @returns {number}
 */
function currentWallet() {
  const result = load();
  return result.save?.profile?.wallet ?? STARTING_WALLET;
}

/** Render the shop for a first purchase and route Buy → setup with the choice. */
function renderShop() {
  initShop({
    wallet: currentWallet(),
    onBuy: (composterId) => {
      newFarmDraft.composterId = composterId;
      showScreen('setup');
    },
  });
}

/** Per-screen render hooks, run each time a screen becomes visible. */
const SCREEN_ENTER = {
  shop: renderShop,
};

/**
 * Show one screen and hide the rest, running its enter hook (if any).
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
  SCREEN_ENTER[name]?.();
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

  // Home screen: nickname (generate/persist/reroll), local ranking, and
  // Play (new farm → shop) vs Continue (resume saved farm → game) routing.
  initHome({
    onPlay: () => showScreen('shop'),
    onContinue: () => showScreen('game'),
  });

  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);
