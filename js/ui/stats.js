// Score-detail / statistics box for the game screen.
//
// The HUD shows the score as a single number; this panel shows WHAT MOVES IT.
// The §2.10 formula (`liters × 10 × (1 + age/30)`) couples production with
// longevity, and neither half of that is legible from a bare score: a player
// cannot tell whether harvesting now is worth more than harvesting in ten days,
// nor that restarting throws the multiplier away. So the box surfaces the
// multiplier, the age feeding it, and what the tray would pay if harvested this
// instant — the three numbers the frozen formula is made of.
//
// PLACEMENT: this lives in the `.actions` SIDEBAR COLUMN, not as a `.stage`
// overlay. `.actions` is already a scrolling flex column, so the box just joins
// the flow; a second absolutely-positioned overlay would compete with the x-ray
// internals panel for the same right-hand edge (and `internalsSide`'s dodge
// logic only knows how to avoid the composter, not a sibling panel).
//
// Layering: a UI module, mirroring the internalsSnapshot/updateInternals split
// in actions.js — `statsSnapshot` is pure and Node-tested, `updateStats` is the
// only function that touches `document`.
//
// STATE: derived ENTIRELY from today's FarmState plus the wallet (which lives on
// the save profile, not the farm). No new state fields, no save-schema change.

import { t } from '../strings.js';
import { getComposter } from '../sim/composters.js';
import { carryingCapacity } from '../sim/worms.js';
import { scorePoints, POINTS_PER_LITER } from '../sim/scoring.js';
import { formatAmount } from './hud.js';
import {
  buildStat,
  buildFillBar,
  buildGroup,
  fillOf,
  formatLiters,
} from './components.js';

// --- Pure helpers (Node-tested) ---------------------------------------------

/**
 * Coerce a possibly-absent/corrupt numeric field to a usable number. A migrated
 * or hand-edited save can carry `undefined`/NaN here, and a NaN would propagate
 * straight into a style attribute and a displayed value; floor it to 0 instead.
 * @param {*} n
 * @returns {number}
 */
function num(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * The complete data model behind the statistics box: the score and everything
 * that drives it, plus the colony/bin totals worth watching between harvests.
 * Pure — a snapshot, so rendering it never perturbs the sim.
 *
 * BOTH scoring numbers come out of the FROZEN `scorePoints` rather than being
 * re-derived here — the multiplier by asking it what one liter is worth. Nothing
 * about the formula (including how it clamps a corrupt age) is restated in this
 * module, so the predicted value can never drift from what a harvest pays, and
 * the multiplier can never contradict the prediction printed beside it.
 *
 * `nextHarvestPoints` is what harvesting RIGHT NOW would bank: the whole tray at
 * today's multiplier. It is a live prediction, not a promise — waiting grows
 * both the tray and the multiplier, which is exactly the trade-off the box is
 * there to make visible.
 *
 * @param {import('../sim/engine.js').FarmState|null|undefined} farm
 * @param {number} [wallet=0] coins on the player profile (not on FarmState)
 * @returns {object|null} null when there is no farm to inspect
 */
export function statsSnapshot(farm, wallet = 0) {
  if (!farm) return null;

  // An unknown/absent composterId (no bin chosen yet, or a catalog entry retired
  // between saves) leaves every capacity at 0 rather than throwing — the box
  // still shows score, age, and population.
  const composter = getComposter(farm.composterId);
  const population = farm.population ?? {};
  const cocoons = num(population.cocoons);
  const juveniles = num(population.juveniles);
  const adults = num(population.adults);

  // A dead colony has had its age reset by the engine, so the multiplier reads
  // ×1 here for free — no special case needed. `colonyAlive` is still reported so
  // the panel can mark the prediction as frozen: nothing is being produced.
  //
  // `scorePoints` floors a negative age to 0 before applying the multiplier, so
  // the reported age is floored the same way: what the panel shows is the age the
  // NEXT HARVEST WILL ACTUALLY BE PAID AT, not the raw field. `num()` only rejects
  // NaN/Infinity, and a hand-edited save carrying `colonyAgeDays: -30` would
  // otherwise render "×0.00 · −30 dias" beside a prediction computed at ×1.
  const colonyAgeDays = Math.max(0, num(farm.colonyAgeDays));
  const humus = num(farm.humus);

  return {
    score: num(farm.score),
    nextHarvestPoints: scorePoints(humus, colonyAgeDays),
    // Read OUT OF the frozen formula (one liter's worth of points, stripped of
    // the per-liter rate) rather than re-derived from AGE_BONUS_DAYS. Whatever
    // clamping scoring.js applies is inherited for free, so the multiplier and
    // the prediction beside it cannot disagree even on a corrupt save.
    ageMultiplier: scorePoints(1, colonyAgeDays) / POINTS_PER_LITER,
    colonyAgeDays,
    colonyAlive: farm.colonyAlive !== false,
    day: num(farm.day),
    wallet: num(wallet),
    population: {
      cocoons,
      juveniles,
      adults,
      total: cocoons + juveniles + adults,
      capacity: carryingCapacity(composter),
    },
    humus: fillOf(humus, composter ? composter.humusCapacity : 0),
    leachate: fillOf(num(farm.leachate), composter ? composter.leachateCapacity : 0),
    // Everything still decomposing, as one number: the food the tray has not
    // been paid for yet. Individual entries are the internals panel's job.
    queuedLiters: (farm.queue ?? []).reduce((sum, entry) => sum + num(entry?.liters), 0),
  };
}

// --- DOM (not unit-tested) ---------------------------------------------------
// The readout primitives this box renders with — buildStat, buildFillBar,
// buildGroup and formatLiters — live in components.js, shared with the internals
// panel. `buildFillBar` in particular used to be a near-identical unmerged
// sibling of the internals panel's banded gauge builder.

/**
 * The last state handed to `updateStats`, kept so re-opening a collapsed box can
 * repaint immediately. Without it, expanding the box while the clock is paused
 * would show whatever was there before it was collapsed (or nothing at all)
 * until the next tick or player action — which reads as a broken panel.
 */
let lastPaint = { farm: null, wallet: 0 };

/** True once the collapse/expand listener is attached (attach exactly once). */
let toggleWired = false;

/**
 * Repaint the statistics box from the current state. Cheap enough to call on
 * every tick; a no-op when the box is absent or the player has collapsed it
 * (a closed `<details>` renders nothing worth building).
 * @param {import('../sim/engine.js').FarmState|null} farm
 * @param {number} wallet coins on the player profile
 */
export function updateStats(farm, wallet) {
  const box = document.getElementById('stats');
  if (!box) return;

  lastPaint = { farm, wallet };
  if (!toggleWired) {
    toggleWired = true;
    box.addEventListener('toggle', () => updateStats(lastPaint.farm, lastPaint.wallet));
  }
  if (!box.open) return;

  const body = document.getElementById('stats-body');
  if (!body) return;

  const snap = statsSnapshot(farm, wallet);
  if (!snap) {
    body.replaceChildren();
    return;
  }

  // Score group: the running total, what the tray is worth today, the multiplier
  // driving that, and the two clocks. The clocks are DIFFERENT QUANTITIES and
  // deliberately both shown: the multiplier row carries the COLONY's age (reset
  // on death/repopulate), `statsFarmDays` carries the FARM's age (the run, which
  // survives a colony death). Labelled apart so a repopulated farm reading
  // "×1.00 · 0 dias" above "41 dias desta fazenda" reads as two clocks rather
  // than as a broken multiplier.
  const multiplier = buildStat(
    'game.statsAgeMultiplier',
    `×${snap.ageMultiplier.toFixed(2)} · ${Math.floor(snap.colonyAgeDays)} ${t('game.statsDays')}`,
  );
  const nextHarvest = buildStat(
    'game.statsNextHarvest',
    `${formatAmount(snap.nextHarvestPoints)} ${t('common.points')}`,
  );

  const score = buildGroup(
    'stats',
    'game.statsScoreTitle',
    buildStat('game.hudScore', formatAmount(snap.score)),
    nextHarvest,
    multiplier,
    buildStat('game.statsFarmDays', `${formatAmount(snap.day)} ${t('game.statsDays')}`),
    buildStat('game.hudMoney', `${formatAmount(snap.wallet)} ${t('common.coins')}`),
  );

  const pop = buildGroup(
    'stats',
    'game.popTitle',
    buildStat('game.popCocoons', formatAmount(snap.population.cocoons)),
    buildStat('game.popJuveniles', formatAmount(snap.population.juveniles)),
    buildStat('game.popAdults', formatAmount(snap.population.adults)),
    buildStat(
      'game.popTotal',
      `${formatAmount(snap.population.total)} / ${formatAmount(snap.population.capacity)}`,
    ),
  );

  const bin = buildGroup(
    'stats',
    'game.tanksTitle',
    buildFillBar(
      'game.humusLabel',
      snap.humus,
      `${formatLiters(snap.humus.liters)} / ${formatLiters(snap.humus.capacity)}`,
    ),
    buildFillBar(
      'game.leachateLabel',
      snap.leachate,
      `${formatLiters(snap.leachate.liters)} / ${formatLiters(snap.leachate.capacity)}`,
    ),
    buildStat('game.statsQueued', formatLiters(snap.queuedLiters)),
  );

  body.replaceChildren(score, pop, bin);
}
