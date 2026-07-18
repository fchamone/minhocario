// HUD (game-screen header): score, money, day, time, and a status line. The
// dynamic values are written by `updateHud`; the static labels are filled from
// the i18n catalog by main.js's applyStrings (they carry `data-string`).
//
// Layering: a UI module. It reads the sim state and the composter catalog (a
// pure lookup) and pulls the status text through the i18n runtime. The three
// pure helpers below (formatTime / formatAmount / farmStatus) are Node-tested;
// `updateHud` is the only DOM function.

import { t } from '../strings.js';
import { getComposter } from '../sim/composters.js';

/** Slack for "full" comparisons on floating-point volumes (matches engine EPS). */
const EPS = 1e-9;

/**
 * Format a game hour as a zero-padded two-digit clock like "00h" / "13h".
 * Floors a fractional (continuous) hour and wraps past a day defensively.
 * @param {number} hour 0..23 (fractional values are floored)
 * @returns {string}
 */
export function formatTime(hour) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return `${String(h).padStart(2, '0')}h`;
}

/**
 * Format a score/money amount as a whole number for the HUD. Non-finite inputs
 * (NaN/Infinity/undefined) render as "0" rather than leaking into the display.
 * @param {number} n
 * @returns {string}
 */
export function formatAmount(n) {
  return String(Math.round(Number.isFinite(n) ? n : 0));
}

/**
 * Derive the HUD status for a farm as a dotted i18n key path (so the caller does
 * `t(farmStatus(farm))`). Priority, most-urgent first: a dead colony, then a full
 * humus tray (processing halts, §2.8), then a full leachate tank (backup, §2.8),
 * else all-good. Later tasks (T14) layer environment warnings on top. Pure — the
 * composter lookup is a deterministic catalog read.
 * @param {import('../sim/engine.js').FarmState|null} farm
 * @returns {string} an i18n key path under `game.status*`
 */
export function farmStatus(farm) {
  if (!farm) return 'game.statusOk';
  if (!farm.colonyAlive) return 'game.statusColonyDead';

  const composter = getComposter(farm.composterId);
  if (composter) {
    if (farm.humus >= composter.humusCapacity - EPS) return 'game.statusTrayFull';
    if (farm.leachate >= composter.leachateCapacity - EPS) return 'game.statusTankFull';
  }
  return 'game.statusOk';
}

/**
 * Paint the HUD's dynamic fields from the current sim state and wallet. Money
 * lives on the player profile (not the farm), so it is passed in. Tolerates a
 * null farm (e.g. the game screen shown before a farm exists) by rendering
 * neutral defaults. DOM function — not unit-tested.
 * @param {import('../sim/engine.js').FarmState|null} farm
 * @param {number} wallet coins on the player profile
 */
export function updateHud(farm, wallet) {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set('hud-money', formatAmount(wallet));
  set('hud-score', formatAmount(farm ? farm.score : 0));
  set('hud-day', String(farm ? farm.day : 1));
  set('hud-time', formatTime(farm ? farm.hour : 0));

  const status = farmStatus(farm);
  set('hud-status', t(status));
  // Color the status when it is anything but all-good (dead colony / full tray /
  // full tank), so the edge state is obvious at a glance. Purely presentational —
  // the label text still comes from farmStatus/`t`.
  const statusEl = document.getElementById('hud-status');
  if (statusEl) statusEl.classList.toggle('hud__status--alert', status !== 'game.statusOk');
}
