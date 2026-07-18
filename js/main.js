// Entry point and sole orchestrator between layers (sim / ui / render).
// For T1/I1 this is: detect + apply the active locale, fill the DOM with the
// active catalog's strings, and route between the four screens. Game-loop
// wiring, sim, and render layers arrive in later tasks.
//
// This is the browser layer, so it MAY use localStorage/navigator/document.
// All user-facing text still flows through the i18n runtime (js/strings.js).

import { t, setLang, resolveLang } from './strings.js';
import { initHome, freezeRun } from './ui/home.js';
import { initShop } from './ui/shop.js';
import { initSetup } from './ui/setup.js';
import { updateHud } from './ui/hud.js';
import { initActions, updateActions, showFeedback } from './ui/actions.js';
import { updateStats } from './ui/stats.js';
import {
  initSpeed,
  drainTicks,
  paintSpeed,
  clockForColony,
  DEFAULT_SPEED,
} from './ui/speed.js';
import { load, save, LOAD_STATUS } from './storage.js';
import { initScene, renderState, resizeScene, enableDragMove, setXrayView } from './render/scene.js';
import {
  STARTING_WALLET,
  createInitialFarmState,
  beddingEnv,
  buyWormPack,
  addFood,
  addSawdust,
  harvestAndSell,
  drainAndSell,
  migrateToComposter,
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

/**
 * Start a NEW game: reset the run while keeping the player's identity and
 * history. The wallet returns to STARTING_WALLET and the farm is cleared, but
 * the nickname and ranking survive — otherwise a second playthrough inherits the
 * previous run's depleted wallet and no composter is affordable.
 *
 * A corrupt/future save is never overwritten (spec §2.11) — we just route to the
 * shop and leave the stored bytes alone, mirroring `js/ui/home.js`.
 *
 * The confirmation prompt and freezing the finished run into the ranking are
 * T15; this is the minimal reset that makes a new game playable.
 */
function startNewGame() {
  const loaded = load();
  const resettable = loaded.status === LOAD_STATUS.OK || loaded.status === LOAD_STATUS.EMPTY;

  if (resettable) {
    const prior = loaded.status === LOAD_STATUS.OK ? loaded.save : null;
    save({
      v: 1,
      profile: {
        nickname: prior?.profile?.nickname ?? '',
        wallet: STARTING_WALLET,
      },
      farm: null,
      ranking: prior?.ranking ?? [],
    });
  }

  // Drop the live farm BEFORE routing: showScreen runs the game screen's exit
  // hook (stopGame → persistGame) after this point, which would otherwise write
  // the old farm straight back over the fresh save. persistGame no-ops on null.
  gameFarm = null;
  gameProfile = null;
  newFarmDraft.composterId = null;

  showScreen('shop');
}

/**
 * Render the shop in whichever mode applies: a FIRST purchase (no live farm →
 * pick a model, then setup) or a MID-FARM upgrade (a farm is running → migrate
 * it to the chosen model at the trade-in price, §2.2).
 */
function renderShop() {
  const upgrading = gameFarm != null;
  initShop({
    wallet: upgrading ? gameProfile?.wallet ?? 0 : currentWallet(),
    currentComposterId: upgrading ? gameFarm.composterId : null,
    onBuy: (composterId) => {
      if (upgrading) {
        upgradeComposter(composterId);
      } else {
        newFarmDraft.composterId = composterId;
        showScreen('setup');
      }
    },
  });
}

/**
 * Migrate the live farm into a new composter and return to the game. The engine
 * carries the colony, food queue, bedding, and colony age across, auto-sells the
 * old bin's contents, and applies the 50% trade-in — so the only thing to report
 * is the net wallet change.
 * @param {string} composterId the model to move into
 */
function upgradeComposter(composterId) {
  if (!gameFarm || !gameProfile) return;

  const before = gameProfile.wallet;
  const result = migrateToComposter(gameFarm, before, composterId);
  if (!result.ok) {
    // The shop already disables unaffordable models; this covers the edge where
    // the wallet changed underneath (e.g. a purchase in another tab).
    showFeedback(t('game.upgradeRejected'), true);
    return;
  }

  gameFarm = result.state;
  gameProfile = { ...gameProfile, wallet: result.wallet };
  persistGame();
  showScreen('game');

  // Reported AFTER the screen switch: entering the game repaints, and would
  // otherwise leave the summary competing with a stale feedback line.
  const delta = Math.round(result.wallet - before);
  showFeedback(
    `${t('game.upgraded')}: ${t(`composters.${composterId}.name`)} · ` +
      `${delta >= 0 ? '+' : ''}${delta} ${t('common.coins')}`,
  );
}

/**
 * End the running farm and start a fresh one. The finished run is frozen into
 * the ranking FIRST (§2.1 — its final score becomes a permanent row) and only
 * then is the wallet/farm reset. A corrupt or future save is left untouched, so
 * nothing is frozen and nothing is written.
 */
function restartRun() {
  const loaded = load();
  const stored = loaded.status === LOAD_STATUS.OK ? loaded.save : null;
  if (stored && gameFarm) {
    // Freeze from the LIVE state, not the last autosave, so the row reflects the
    // score at the moment the player restarted.
    save(freezeRun({ ...stored, profile: gameProfile ?? stored.profile, farm: gameFarm }));
  }
  startNewGame();
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
  const composterId = newFarmDraft.composterId;
  const composter = getComposter(composterId);
  // No composter chosen (setup reached without a purchase) — a farm without a
  // bin is not a valid game state, so send the player back to the shop rather
  // than persisting one. Guards the dev-nav shortcut into setup.
  if (!composter) {
    showScreen('shop');
    return;
  }

  const loaded = load();
  const prior = loaded.status === LOAD_STATUS.OK ? loaded.save : null;
  const nickname = prior?.profile?.nickname ?? '';
  const ranking = prior?.ranking ?? [];

  let wallet = prior?.profile?.wallet ?? STARTING_WALLET;
  wallet -= composter.price; // pay for the composter (deferred from the shop)

  let farm = createInitialFarmState({
    seed: randomSeed(),
    composterId,
    speciesId: values.speciesId,
    wallPosition: values.wallPosition,
    env: beddingEnv(values.bedding),
    // Injected here, not read inside the sim, so the engine stays clock-free.
    createdAt: Date.now(),
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
  initSetup({
    onConfirm: createFarmFromSetup,
    capacity: getComposter(newFarmDraft.composterId)?.capacity,
  });
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
/** Colony-alive at the last UI sync, so `syncColonyClock` sees transitions. */
let lastColonyAlive = true;
/** Speed to restore once a dead colony is repopulated. */
let speedBeforeColonyDeath = DEFAULT_SPEED;
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

// --- Render layer (T16) ------------------------------------------------------
// The 3D scene is initialized lazily on first game-screen entry (the canvas has
// no layout size while its screen is hidden) and attempted exactly once: if WebGL
// is unavailable the game stays fully playable DOM-only, and we never retry/re-warn.

/** True once we've tried to init the scene (whether or not it succeeded). */
let sceneAttempted = false;
/** True only if WebGL is up and the scene may be rendered. */
let sceneEnabled = false;

/**
 * Mount the 3D scene onto the game-screen canvas the first time it's needed.
 * Idempotent and failure-tolerant: a missing canvas or WebGL failure leaves
 * `sceneEnabled` false and the DOM game untouched.
 * @returns {boolean} whether the scene is available to render
 */
function ensureScene() {
  if (sceneAttempted) return sceneEnabled;
  sceneAttempted = true;
  const canvas = document.getElementById('scene-canvas');
  sceneEnabled = canvas ? initScene(canvas) : false;
  return sceneEnabled;
}

/** Persist the live farm under the current profile/ranking (autosave). */
function persistGame() {
  if (!gameFarm || !gameProfile) return;
  save({ v: 1, profile: gameProfile, farm: gameFarm, ranking: gameRanking });
}

/** Repaint everything that reads the live state: HUD + actions/internals/stats. */
function refreshGameUi() {
  syncColonyClock();
  updateHud(gameFarm, gameProfile?.wallet ?? 0);
  updateActions(gameFarm);
  // The wallet lives on the profile, not the farm, so the stats box takes it the
  // same way the HUD does. Called from here (not from the tick loop) so the box
  // repaints on player actions too, not only on the clock.
  updateStats(gameFarm, gameProfile?.wallet ?? 0);
}

/**
 * Stop the clock when the colony dies and restart it when the colony is revived
 * (§2.1 — a dead colony produces nothing, so running time just burns days). The
 * decision itself is the pure `clockForColony`; this only owns the state and the
 * repaint. Called from every UI refresh, so it catches a death mid-tick and a
 * revival from the worm-pack purchase alike.
 */
function syncColonyClock() {
  const alive = gameFarm ? gameFarm.colonyAlive !== false : true;
  const next = clockForColony({
    alive,
    wasAlive: lastColonyAlive,
    speed: gameSpeed,
    resumeSpeed: speedBeforeColonyDeath,
  });
  lastColonyAlive = alive;
  speedBeforeColonyDeath = next.resumeSpeed;
  if (next.speed !== gameSpeed) applySpeed(next.speed);
}

/** Set the clock speed and reflect it in the bottom bar. */
function applySpeed(speed) {
  gameSpeed = speed;
  accumulatorMs = 0; // drop the sub-tick backlog so a speed jump can't burst
  paintSpeed(speed);
}

/**
 * Commit a player action: autosave (T13 — "autosave on every action") and
 * repaint immediately, so the effect is visible without waiting for a tick.
 */
function commitAction() {
  persistGame();
  refreshGameUi();
}

// --- Player actions (T14) ----------------------------------------------------
//
// Each handler applies one pure engine action to the live farm, reports the
// outcome through the actions panel's feedback line, then commits. The engine
// returns the SAME state object when it rejects an action, so an identity check
// is how the UI distinguishes "rejected" from "applied" without duplicating the
// engine's rules here.

/** Add a waste portion to the queue; rejected when the bin has no room. */
function onAddWaste(foodId, liters) {
  if (!gameFarm) return;
  const next = addFood(gameFarm, foodId, liters);
  if (next === gameFarm) {
    showFeedback(t('game.wasteRejected'), true);
    return;
  }
  gameFarm = next;
  showFeedback(t('game.wasteAdded'));
  commitAction();
}

/** Add sawdust: dries the bedding and scrubs some toxicity (engine.js). */
function onAddSawdust(liters) {
  if (!gameFarm) return;
  gameFarm = addSawdust(gameFarm, liters);
  showFeedback(t('game.sawdustAdded'));
  commitAction();
}

/** Buy a worm pack for the farm's species, paying from the profile wallet. */
function onBuyWorms(packSize) {
  if (!gameFarm || !gameProfile) return;
  const result = buyWormPack(gameFarm, gameProfile.wallet, gameFarm.speciesId, packSize);
  if (!result.ok) {
    showFeedback(t('game.cannotAffordWorms'), true);
    return;
  }
  gameFarm = result.state;
  gameProfile = { ...gameProfile, wallet: result.wallet };
  showFeedback(t('game.wormsBought'));
  commitAction();
}

/** Drain the leachate tank and auto-sell it (coins, no score). */
function onDrain() {
  if (!gameFarm || !gameProfile) return;
  const result = drainAndSell(gameFarm, gameProfile.wallet);
  if (result.drained <= 0) {
    showFeedback(t('game.nothingToDrain'), true);
    return;
  }
  gameFarm = result.state;
  gameProfile = { ...gameProfile, wallet: result.wallet };
  showFeedback(
    `${t('game.drained')}: ${formatVolume(result.drained)} · +${Math.round(result.coins)} ${t('common.coins')}`,
  );
  commitAction();
}

/** Harvest the humus tray, auto-sell it, and bank the age-scaled score. */
function onHarvest() {
  if (!gameFarm || !gameProfile) return;
  const result = harvestAndSell(gameFarm, gameProfile.wallet);
  if (result.harvested <= 0) {
    showFeedback(t('game.nothingToHarvest'), true);
    return;
  }
  gameFarm = result.state;
  gameProfile = { ...gameProfile, wallet: result.wallet };
  showFeedback(
    `${t('game.harvested')}: ${formatVolume(result.harvested)} · ` +
      `+${Math.round(result.coins)} ${t('common.coins')} · ` +
      `+${Math.round(result.points)} ${t('common.points')}`,
  );
  commitAction();
}

/** Move the composter along the wall (0..1) — changes its sun exposure (§2.3). */
function onMove(position) {
  if (!gameFarm) return;
  gameFarm = { ...gameFarm, wallPosition: position };
  commitAction();
}

/** Format a liter volume for a feedback line: at most two decimals. */
function formatVolume(liters) {
  return `${Math.round(liters * 100) / 100} ${t('common.liters')}`;
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
    refreshGameUi();
    if (gameFarm.day !== startDay) persistGame(); // autosave on the day boundary
  }

  if (gameFarm) continuousHour = gameFarm.hour + drain.fraction;

  // Render every animation frame (decoupled from the discrete tick rate) so the
  // scene stays smooth and live even while the clock is paused. renderState is a
  // no-op when WebGL is unavailable, so this is safe regardless of sceneEnabled.
  renderState(gameFarm, continuousHour);

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
  // Mount + size the 3D scene now that its canvas is visible. Sizing must happen
  // on entry because the canvas has no layout size while the screen is hidden.
  if (ensureScene()) {
    resizeScene();
    // Drag-move (T19): grabbing the composter in 3D dispatches through the SAME
    // onMove action as the slider, so both controls and the autosave stay in
    // sync. Idempotent — listeners are installed once across game-screen entries.
    enableDragMove(onMove);
  }

  const result = load();
  if (result.status !== LOAD_STATUS.OK || !result.save.farm) {
    gameFarm = null;
    updateHud(null, currentWallet());
    renderState(gameFarm, continuousHour); // wall + floor even with no farm
    return;
  }
  gameFarm = result.save.farm;
  gameProfile = result.save.profile ?? { nickname: '', wallet: STARTING_WALLET };
  gameRanking = result.save.ranking ?? [];
  accumulatorMs = 0;
  continuousHour = gameFarm.hour;
  // Assume alive so that loading a save whose colony is already dead registers
  // as a transition and stops the clock straight away.
  lastColonyAlive = true;
  refreshGameUi();
  renderState(gameFarm, continuousHour); // immediate paint before the first tick
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
  applySpeed(speed);
  // A manual speed change is also the player's new "resume" speed, so reviving a
  // colony later returns them to what they last chose rather than to whatever
  // they were running at when it died.
  if (speed !== 0) speedBeforeColonyDeath = speed;
  // Pause is a clock stop, not a screen exit: the rAF loop keeps running (so the
  // render layer stays live for T18) but `drainTicks` yields no ticks at speed 0.
  // Persist here so quitting while paused resumes at the exact paused hour.
  persistGame();
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

/**
 * Render the home screen: re-reads the save on every entry, so Continue reflects
 * a farm created since page load and the ranking/nickname stay current.
 */
function renderHome() {
  initHome({
    onPlay: startNewGame,
    onContinue: () => showScreen('game'),
    onSwitchLang: switchLang,
  });
}

/** Per-screen render hooks, run each time a screen becomes visible. */
const SCREEN_ENTER = {
  home: renderHome,
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

/**
 * DEV ONLY — top up the wallet so mid-game flows (notably the upgrade shop) can
 * be exercised without first playing out the economy. Lives on the temporary
 * dev-nav bar and is removed with it before release (T23).
 * @param {number} [amount]
 */
function devAddCoins(amount = 500) {
  if (gameProfile) {
    gameProfile = { ...gameProfile, wallet: gameProfile.wallet + amount };
    persistGame();
    refreshGameUi();
  } else {
    const loaded = load();
    if (loaded.status !== LOAD_STATUS.OK) return; // never touch a corrupt/future save
    const stored = loaded.save;
    save({
      ...stored,
      profile: { ...stored.profile, wallet: (stored.profile?.wallet ?? 0) + amount },
    });
  }
  // Repaint whatever screen is showing so the new balance is visible at once
  // (the shop reads the wallet on entry).
  if (currentScreen !== 'game') SCREEN_ENTER[currentScreen]?.();
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
  document.getElementById('dev-coins')?.addEventListener('click', () => devAddCoins());

  // Bottom speed bar → adjust the tick timer; freeze/resume + autosave on tab
  // visibility changes (killing the tab persists the exact game hour, no catch-up).
  initSpeed({ initialSpeed: gameSpeed, onSpeedChange });
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Actions panel: buttons dispatch back into the handlers above, which are the
  // only place the live farm is mutated outside the tick loop. Wired once — the
  // game screen's DOM is static, so re-entering it does not re-bind listeners.
  initActions({
    getFarm: () => gameFarm,
    getWallet: () => gameProfile?.wallet ?? 0,
    onAddWaste,
    onAddSawdust,
    onBuyWorms,
    onDrain,
    onHarvest,
    onMove,
    onRestart: restartRun,
    // X-ray toggle drives the 3D view ONLY: swap the composter shell to
    // translucent and reveal the internals overlay (render-only, never touches
    // the sim). A no-op when WebGL is unavailable — the DOM internals panel is
    // independent of this and stays readable either way.
    onToggleXray: (active) => setXrayView(active),
  });

  // Home screen — nickname (generate/persist/reroll), local ranking, and
  // Play (new farm → shop) vs Continue (resume saved farm → game) routing — is
  // rendered by its SCREEN_ENTER hook, which showScreen fires here.
  showScreen('home');
}

document.addEventListener('DOMContentLoaded', init);
