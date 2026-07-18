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
import { initSetup } from './ui/setup.js';
import { updateHud } from './ui/hud.js';
import { initSpeed, drainTicks, DEFAULT_SPEED } from './ui/speed.js';
import { load, save, LOAD_STATUS } from './storage.js';
import {
  STARTING_WALLET,
  createInitialFarmState,
  beddingEnv,
  buyWormPack,
  addFood,
  tick,
} from './sim/engine.js';
import { createRng } from './sim/rng.js';
import { getComposter } from './sim/composters.js';

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

/** A random 32-bit RNG seed for a new farm (entropy — UI layer, not the sim). */
function randomSeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * Turn the setup choices into a day-1 farm and persist it, then open the game.
 * This is where the deferred shop purchase is charged: the composter price and
 * the first 50-worm pack are both deducted here, so an abandoned setup never
 * touched the wallet. The chosen bedding mix sets the initial moisture/pH; the
 * first waste seeds the queue.
 * @param {{speciesId: string, bedding: import('./sim/engine.js').BeddingMix,
 *   firstWasteId: string, firstWasteLiters: number, wallPosition: number}} values
 */
function createFarmFromSetup(values) {
  const loaded = load();
  const prior = loaded.status === LOAD_STATUS.OK ? loaded.save : null;
  const nickname = prior?.profile?.nickname ?? '';
  const ranking = prior?.ranking ?? [];

  const composterId = newFarmDraft.composterId;
  const composter = getComposter(composterId);
  let wallet = prior?.profile?.wallet ?? STARTING_WALLET;
  if (composter) wallet -= composter.price; // pay for the composter (deferred from the shop)

  let farm = createInitialFarmState({
    seed: randomSeed(),
    composterId,
    speciesId: values.speciesId,
    wallPosition: values.wallPosition,
    env: beddingEnv(values.bedding),
  });

  // Seed the first colony (50 worms of the chosen species) — pays the pack price.
  const buy = buyWormPack(farm, wallet, values.speciesId, 50);
  if (buy.ok) {
    farm = buy.state;
    wallet = buy.wallet;
  }

  // Add the first waste (addFood enforces the min portion and bin capacity).
  if (values.firstWasteId) farm = addFood(farm, values.firstWasteId, values.firstWasteLiters);

  save({ v: 1, profile: { nickname, wallet }, farm, ranking });
  newFarmDraft.composterId = null;
  showScreen('game');
}

/** Render the guided setup form and route Confirm → farm created + saved. */
function renderSetup() {
  initSetup({ onConfirm: createFarmFromSetup });
}

// --- Game loop (T13) --------------------------------------------------------
//
// An accumulator-based clock decoupled from the render frame rate: each animation
// frame banks the real elapsed time and `drainTicks` converts it into whole game
// hours at the current speed (js/ui/speed.js). Speed scales ONLY the timer. The
// loop pauses when the tab is hidden (the clock freezes — no catch-up on return),
// and autosaves on the day boundary, on hide, and when leaving the game screen.

/** Clamp a single frame's elapsed time so a long stall can't burst the clock. */
const MAX_FRAME_MS = 250;
/** Hard ceiling on ticks simulated in one frame (backlog guard, no spiral). */
const MAX_TICKS_PER_FRAME = 100;

/** @type {import('./sim/engine.js').FarmState|null} the live farm, or null. */
let gameFarm = null;
/** @type {{nickname: string, wallet: number}|null} the player profile in play. */
let gameProfile = null;
/** @type {object[]} the ranking list, carried through so autosaves preserve it. */
let gameRanking = [];
/** Active speed multiplier (js/ui/speed.js). */
let gameSpeed = DEFAULT_SPEED;
/** Real ms banked but not yet converted to whole ticks. */
let accumulatorMs = 0;
/** Timestamp of the previous frame, or null to start a fresh delta. */
let lastFrameTs = null;
/** requestAnimationFrame handle for the running loop, or null when stopped. */
let rafId = null;
/** Whether the loop is currently ticking. */
let loopRunning = false;
/** The screen currently shown, so the router can run its teardown hook on exit. */
let currentScreen = null;
/**
 * Continuous (fractional) game hour: `hour + sub-tick fraction`. The render layer
 * (T18 day/night) samples this for smooth interpolation between whole ticks.
 * Exposed on `window.getContinuousHour` alongside the `window.setLang` dev hook.
 */
let continuousHour = 0;

/** Persist the live farm under the current profile/ranking (autosave). */
function persistGame() {
  if (!gameFarm || !gameProfile) return;
  save({ v: 1, profile: gameProfile, farm: gameFarm, ranking: gameRanking });
}

/** One animation frame: bank elapsed time, drain whole ticks, repaint the HUD. */
function frame(now) {
  if (!loopRunning) return;
  if (lastFrameTs == null) lastFrameTs = now;
  let delta = now - lastFrameTs;
  lastFrameTs = now;
  if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS; // absorb a stall / throttle
  if (delta < 0) delta = 0;
  accumulatorMs += delta;

  const drain = drainTicks(accumulatorMs, gameSpeed, { maxTicks: MAX_TICKS_PER_FRAME });
  accumulatorMs = drain.remainderMs;

  if (drain.ticks > 0 && gameFarm) {
    const startDay = gameFarm.day;
    for (let i = 0; i < drain.ticks; i++) {
      const rng = createRng(gameFarm.rngState);
      gameFarm = tick(gameFarm, rng);
    }
    updateHud(gameFarm, gameProfile?.wallet ?? 0);
    if (gameFarm.day !== startDay) persistGame(); // autosave on the day boundary
  }

  if (gameFarm) continuousHour = gameFarm.hour + drain.fraction;
  rafId = requestAnimationFrame(frame);
}

/** Start the clock (idempotent). Resets the delta so no elapsed gap is caught up. */
function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  lastFrameTs = null;
  rafId = requestAnimationFrame(frame);
}

/** Stop the clock, freezing the game hour where it stands. */
function stopLoop() {
  loopRunning = false;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}

/**
 * Enter the game screen: load the saved farm and start ticking. With no playable
 * farm (e.g. dev-nav jumped straight here) the HUD shows neutral defaults and the
 * clock stays stopped.
 */
function startGame() {
  const result = load();
  if (result.status !== LOAD_STATUS.OK || !result.save.farm) {
    gameFarm = null;
    updateHud(null, currentWallet());
    return;
  }
  gameFarm = result.save.farm;
  gameProfile = result.save.profile ?? { nickname: '', wallet: STARTING_WALLET };
  gameRanking = result.save.ranking ?? [];
  accumulatorMs = 0;
  continuousHour = gameFarm.hour;
  updateHud(gameFarm, gameProfile.wallet);
  startLoop();
}

/** Leave the game screen: stop the clock and capture the latest state. */
function stopGame() {
  stopLoop();
  persistGame();
}

/** Change speed: only the timer scales. Drop the sub-tick backlog so a jump to a
 * faster speed can't reinterpret it as a burst of ticks. */
function onSpeedChange(speed) {
  gameSpeed = speed;
  accumulatorMs = 0;
}

/** Freeze the clock and save when the tab is hidden; resume when it returns. */
function onVisibilityChange() {
  if (document.hidden) {
    stopLoop();
    persistGame();
  } else if (currentScreen === 'game' && gameFarm) {
    startLoop();
  }
}

/** Per-screen render hooks, run each time a screen becomes visible. */
const SCREEN_ENTER = {
  shop: renderShop,
  setup: renderSetup,
  game: startGame,
};

/** Per-screen teardown hooks, run when a screen is left. */
const SCREEN_EXIT = {
  game: stopGame,
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
  if (currentScreen && currentScreen !== name) SCREEN_EXIT[currentScreen]?.();
  for (const section of document.querySelectorAll('.screen')) {
    section.hidden = section.getAttribute('data-screen') !== name;
  }
  currentScreen = name;
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
  // Continuous game hour for the render layer's day/night interpolation (T18);
  // readable from devtools too.
  window.getContinuousHour = () => continuousHour;

  applyStrings();
  wireNavigation();

  // Bottom speed bar → adjust the tick timer; freeze/resume + autosave on tab
  // visibility changes (killing the tab persists the exact game hour, no catch-up).
  initSpeed({ initialSpeed: gameSpeed, onSpeedChange });
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Home screen: nickname (generate/persist/reroll), local ranking, and
  // Play (new farm → shop) vs Continue (resume saved farm → game) routing.
  initHome({
    onPlay: () => showScreen('shop'),
    onContinue: () => showScreen('game'),
  });

  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);
