// Core simulation engine. PURE module: no DOM, no Three.js, no browser globals.
// `tick(state, rng)` advances the farm by one game hour and returns a NEW state.
//
// The full FarmState shape is defined here as a JSDoc typedef; later tasks fill
// in the currently-stubbed subsystems (food queue, population, production,
// scoring). As of T3 tick advances the clock and updates bin temperature.

import { getComposter } from './composters.js';
import { getFood, queueDynamics, decompositionFraction, DECOMP_TICKS } from './foods.js';
import { getSpecies, carryingCapacity, populationStep, RATION_TICKS } from './worms.js';
import {
  ambientTemperature,
  solarGain,
  positionBias,
  fermentationHeat,
  blendTemperature,
} from './temperature.js';
import { scorePoints, applyHarvestScore } from './scoring.js';

/** Smallest waste portion the player may add, in liters (§2.7). */
export const MIN_PORTION_LITERS = 0.25;

// Bin volume the whole model is calibrated against: `tier2`, the beginner tray
// (js/sim/composters.js). Both capacity-relative expressions below — the
// environment dilution and the throughput falloff — are anchored here, which is
// what makes them affordable: `tier2` carries four of the five locked §2.8 chain
// scenarios and the entire good-care envelope (tests/balance.test.js), and at the
// anchor both factors are exactly 1, so every one of those runs is bit-identical.
// Anchoring against raw capacity instead would rewrite every balance bound in the
// project. The UI portion ladder shares this constant (js/ui/actions.js) so the
// sim and the ladder can never drift onto two different anchors.
export const BIN_REFERENCE_CAPACITY = 30;

// --- Volume normalisation (T25) ---------------------------------------------
// moisture/pH/toxicity are INTENSIVE state: concentrations in the bedding, not
// totals. The food queue, though, contributes EXTENSIVE amounts — queueDynamics
// (js/sim/foods.js) multiplies each food's per-liter numbers by its liters, which
// is correct for "what this queue releases" but is not yet a concentration.
// Dividing by the bin volume is the missing unit conversion.
//
// It became load-bearing when the UI portion ladder started scaling with capacity
// (clicks-to-fill is a constant 8 on every bin, js/ui/actions.js). That made the
// INPUT scale linearly with capacity while the state variable did not scale at
// all, so the same "top rung" click meant very different things per bin: measured
// on a mid-life colony, one click moved moisture +0.284 on tier2 (landing 0.784,
// inside californiana's band) but +0.425 on eco (landing 0.925 — past the 0.85
// comfort max and close to the 0.97 lethal line). Same action, same species, one
// upgrade apart. Feeding a big bin now reads like feeding a small one.
//
// The balance suite could not catch this: its scenarios feed a FLAT 1.5 L
// regardless of composter, so they never exercise the ladder that creates the
// asymmetry. Same blind spot as T24 (pacing) — the harness locks outcomes on the
// bins it scripts, not the ones the player actually upgrades into.
//
// APPLIED to everything dosed in liters against a per-liter strength — the food
// queue AND `addSawdust`. Sawdust has the identical unit problem, and exempting
// it would have made the drying/scrubbing lever stronger with every upgrade.
//
// NOT applied to fermentation heat (`dyn.freshHeatMass`): heat is genuinely a
// property of the fermenting MASS rather than its concentration, and diluting it
// would weaken the eco overfeeding-heat chain that §2.8 requires to stay lethal
// (tests/balance.test.js locks it at 2-8 days). Nor to EVAP_COEF, which is a rate
// on the concentration itself rather than a dose, so it is already intensive.
// Nor to the setup bedding mix (`beddingEnv`), which is a volume-weighted average
// and therefore intensive by construction.
//
// CLAMPED AT 1 — it dilutes large bins and never concentrates small ones. The
// unclamped ratio would multiply the 20 L electric bin by 1.5, which is tempting
// (less bedding to absorb the same spill, and it flatters the bin's "small and
// unforgiving" identity) but was MEASURED as a real defect, not added character:
// in the electric-vs-tier2 economic scenario (tests/production.test.js), which
// deliberately never doses sawdust, electric saturated to moisture 1.0 and spent
// 44% of a 30-day run outside the comfort band, collapsing its colony to 262
// worms against tier2's 2736 and losing the T21-3 invariant that electric must
// out-earn the cheaper tray at its 200-coin price.
//
// The asymmetry is principled rather than a fudge. Bins LARGER than the anchor
// were over-concentrated by the old absolute formula — that is the bug being
// fixed. Bins at or below the anchor were never the problem: the absolute model
// was tuned around them, so pushing them further concentrated introduces a NEW
// defect instead of correcting an old one. Clamping keeps this change a strict
// relaxation for large bins, with exactly zero effect at or below the reference.
/**
 * The bin's volume-normalisation factor: how strongly a liter of food registers
 * on the intensive env variables, relative to the calibrated `tier2` tray.
 * @param {import('./composters.js').Composter|null} composter
 * @returns {number} 1 at or below the reference capacity, < 1 for larger bins
 */
function envDilution(composter) {
  if (!composter) return 1;
  return Math.min(1, BIN_REFERENCE_CAPACITY / composter.capacity);
}

// Bin-environment dynamics constants (§2.5). First-pass; tuned at T8/T21.
const NEUTRAL_PH = 7; // pH the bin eases back toward when nothing pushes it
const PH_DRIFT_RATE = 0.02; // fraction of the gap to neutral closed per tick
const TOX_DECAY_RATE = 0.001; // per-tick toxicity decay — deliberately very slow

// Sawdust is the player's ACTIVE remediation lever, against both moisture and
// toxicity. Exported because the balance scenarios dose sawdust by solving for a
// target moisture — they must divide by the real constant rather than re-inline
// it, or a retune here silently changes what those scenarios actually test.
//
// The toxicity scrub is deliberately rate-limited by the drying: you cannot
// spam sawdust to clean a bin without pulling moisture out of the comfort band,
// so it stays the fine adjustment and the remediating foods (js/sim/foods.js)
// carry the weight of a real cleanup. Passive TOX_DECAY_RATE alone takes ~58
// game days to bring a lethal 0.4 back inside the comfort band, which left the
// player nothing to DO about a poisoned bin; these two levers are the answer.
export const SAWDUST_DRY_PER_LITER = 0.04; // moisture removed per liter of sawdust
export const SAWDUST_TOX_PER_LITER = 0.01; // toxicity removed per liter of sawdust

// Passive evaporation (§2.5): a warm bin loses moisture to the air every tick.
// Without this, moisture is a ONE-WAY ratchet — only food and leachate backup
// raise it, only sawdust lowers it — so an untended bin can never dry out on its
// own and the "too dry" failure state (§2.8) is unreachable by neglect.
//
// Evaporation is TEMPERATURE-GATED: negligible at room temperature, climbing only
// as the bin heats past EVAP_THRESHOLD. This mirrors real drying (evaporation rises
// steeply with temperature) and, crucially, means a cool shaded bin barely dries —
// so a hot, sun-baked or neglected bin dries into lethal territory while a
// well-placed, well-fed bin holds its moisture. First-pass; tuned at T8/T21.
const EVAP_THRESHOLD = 24; // °C below which passive drying is negligible
const EVAP_COEF = 0.0006; // per-tick moisture lost per °C above the threshold

// Production / consumption / overflow constants (§2.6, §2.8). First-pass; tuned
// at T8. The eating throughput of the colony per tick is
//   activeWorms × species.speed × composter.speed × CONSUMPTION_PER_WORM
// so a bigger, faster colony in a faster composter processes more food, and
// per-model humus output tracks composter.speed × composter.humusRate.
const CONSUMPTION_PER_WORM = 0.0005; // liters of food a single active worm eats per tick

// Throughput ceiling (§2.6). The linear term above is unbounded in population,
// but the bin is not: worms eat at the food/bedding INTERFACE, and that interface
// is a property of the box, not of how many worms are stacked inside it. Without
// a ceiling, demand grows with capacity × DENSITY (50 worms/L, worms.js) while
// the largest portion the UI can serve grows with capacity ALONE — a full 'eco'
// bin demanded ~84 L/game-day against a 14 L maximum click, so at 5× speed a
// freshly fed bin emptied within seconds of real time and the player could never
// keep up by hand.
//
// Expressed PER LITER of bin capacity it is deliberately non-binding for small
// and mid colonies — those stay purely linear, and feeding still visibly matters
// — and bites only as the colony approaches carrying capacity, which is exactly
// where the runaway lived.
//
// It scales by BOTH speed traits, for the same reason the linear term does. Read
// the ceiling as "only so many worms fit at the working face": the box bounds HOW
// MANY worms can be at the interface (capacity × THROUGHPUT_CAP_PER_LITER /
// CONSUMPTION_PER_WORM = 28 worms/L against DENSITY 50, so the cap engages at 56%
// of carrying capacity), while the species and the model still set how fast each
// of those worms works. Dropping species.speed from the ceiling — as the
// first-pass formula did — made every species eat identically once the cap bound,
// which silently erased africana's defining trait for any mature colony and broke
// the species-ordering test. The two speed traits belong on both terms.
//
// VALUE (measured; 0.02 was an untested first pass). Swept 0.008..0.02 against
// three probes, and TWO opposing walls bracket the answer:
//
//   UPPER wall — pacing, the reason the cap exists. A max-size portion at full
//   carrying capacity in the fastest pairing (africana in the electric bin) is
//   gone in 3.5 real seconds at 5× under 0.02, which is the "devoured in a couple
//   of seconds" complaint verbatim. 0.014 stretches that to 5.0 s, and the
//   beginner default (californiana/tier2, a 10 L portion) from 10.4 s to 14.9 s.
//
//   LOWER wall — the hunger brake. Capping demand also caps the DENOMINATOR of
//   `ration`, so a slower cap makes the same standing queue read as a fuller
//   larder and REPRODUCTION SPEEDS UP. In the good-care season the equilibrium
//   climbs 1508 -> 1739 (0.016) -> 2034 (0.014) -> 2253 (0.013) -> 2307 (0.012),
//   and at 0.012 it stops moving: the colony has pinned against the CROWDING
//   stall (active/carryingCapacity >= 1.5, worms.js OVERPOP_STALL) and the food
//   brake is no longer binding at all. That would undo the CP3 boom-bust fix —
//   "the colony settles at a food-supported size" — so anything <= 0.013 is out.
//
// 0.014 is the slowest value on the food-limited side of that knee, landing at
// active/cap = 1.31 with real margin to the 1.5 stall.
//
// WHAT THE CAP COSTS (re-measured at the T24 review; the original claim here —
// "stays inside the DECOMP_TICKS = 48 wastage budget, a 1.3× slowdown against the
// ~2× budget" — was UNSUPPORTED and has been withdrawn, see below). Entries older
// than DECOMP_TICKS = 48 are dropped with NO humus and NO leachate credit, so
// braking eating can push food past its window and convert the economy from
// "worms process food" into "food rots unpaid". Whether that can happen at all is
// closed form: an entry only ages out when the 48-tick eating budget cannot cover
// the standing stock, i.e. when
//
//     fill > DECOMP_TICKS × binThroughputCeiling(composter, species) / capacity
//
// This USED to reduce to `48 × K × composter.speed × species.speed`, with capacity
// cancelling out entirely. T25 made the ceiling sublinear in capacity
// (CAPACITY_THROUGHPUT_FALLOFF), so capacity no longer cancels and the threshold
// carries a `(BIN_REFERENCE_CAPACITY / capacity) ** ALPHA` factor — bigger bins
// now cross into unpaid rot at a slightly LOWER fill than they used to. Ask
// `binThroughputCeiling` rather than re-deriving the reduced form; it is stale.
//
// Re-measured at T25 with californiana (pop pinned at carrying capacity, bin held
// at a fixed fill, 30 days). The closed form predicts the leak/no-leak boundary
// exactly in all 18 model x fill cases:
//
//   model     threshold   dropped @100%   dropped @75%   dropped @50%
//   electric  >1 (never)       0.0%           0.0%           0.0%
//   tier2       0.538         44.7%          27.1%           0.0%
//   tier3       0.632         35.3%          14.9%           0.0%
//   tier4       0.727         26.1%           2.9%           0.0%
//   buried      0.580         40.5%          21.6%           0.0%
//   eco         0.785         20.4%           0.0%           0.0%
//
// tier2 is unchanged from the T24 measurement (0.538 / 44.7% / 27.1%), as it must
// be — it is the anchor, where both T25 factors are exactly 1.
//
// So the cost is FILL-DEPENDENT, negligible low down and substantial at the top:
//
//   - Low-to-moderate fill: free. The good-care season tops the bin toward a
//     QUARTER full, under every threshold above, so capped and uncapped runs are
//     indistinguishable — added/eaten/dropped identical at 195.0 / 183.8 / 11.3 L,
//     humus 91.6 vs 91.9 L, wallet 1326 vs 1329 — and the banked score barely
//     moves (1962.8 -> 1957.6). That scenario is supply-limited, not throughput-
//     limited: the cap changes the PACE of eating, not the total eaten.
//
//   - High fill: a large share of fed waste rots unpaid — the table above. The
//     T25 falloff moved the non-anchor models: at full fill tier3 went 31.4% ->
//     35.3%, buried 31.4% -> 40.5%, tier4 18.4% -> 26.1% and eco 5.6% -> 20.4%,
//     because a lower ceiling clears the standing stock more slowly. tier2 is
//     unchanged at 44.7%. Bigger bins are no longer near-immune to this, which is
//     the intended shape: their size advantage now carries a real upkeep cost.
//
// WHY THE ORIGINAL HALF-FILL PROBE COULD NOT SEE THIS — do not re-run it and
// conclude the cap is cheap. It held the bin at HALF capacity, which is below the
// leak threshold of EVERY model in the catalog (the lowest is tier2's 0.538), so
// it was structurally incapable of producing a single dropped liter at any K the
// lower wall above left admissible: half fill only begins to leak below K ≈
// 0.0130, and K <= 0.013 was already excluded by the crowding-stall knee. It also
// let the population float rather than pinning it at carrying capacity, so it
// compared against a linear branch only 1.33× above the ceiling; at carrying
// capacity the true tier2 ratio is 1.79×. And the "~2× budget" framing was wrong
// in kind: the budget is not a slowdown ratio at all, it is the fill inequality
// above. Any re-probe must run at high fill with the population pinned.
//
// IS THIS A DEFECT? No — the BEHAVIOUR is coherent and is being kept. Surplus food
// rotting in an overstuffed bin is precisely the §2.8 overfeeding chain, and the
// dropped liters are not silently free: they sit in the queue for their full 48
// ticks loading moisture, pH and toxicity through queueDynamics, so overfeeding
// still bites exactly as the spec intends. Coin income in supply-limited play is
// untouched (measured above), because humus is throughput-capped either way. Two
// things WERE wrong: (a) the justification above was asserted without evidence
// that could support it, now corrected; and (b) the player gets NO feedback that
// fed waste is expiring uneaten, so a bin held near full quietly pays less per
// liter fed with nothing in the UI to say so. (b) is an open follow-up recorded
// in tasks/t21-balance.md (T24) — it is a UI gap, not a constant to retune.
export const THROUGHPUT_CAP_PER_LITER = 0.014; // liters/tick eaten per liter of bin capacity

// --- Diminishing returns on bin size (T25) ----------------------------------
// The ceiling above is per-liter-of-capacity, so a bigger bin turned over
// proportionally more food — and since the catalog ALSO gives larger models a
// higher `speed` and `humusRate`, and carryingCapacity is linear in capacity,
// upgrading improved every axis at once. A mature `eco` out-produced `tier2` by
// ~2.1x per liter of capacity and ~7x in absolute terms. Upgrading should pay,
// but not compound like that.
//
// This bends the ceiling sublinear in capacity: the working face grows more
// slowly than the box does, which is the same "only so many worms fit at the
// interface" reading the ceiling already has — a bin twice the volume does not
// get twice the usable surface. Anchored at BIN_REFERENCE_CAPACITY, so `tier2` is
// exactly unchanged and only the models around it move:
//
//   electric 1.063 | tier2 1.000 | tier3 0.941 | tier4 0.901 | buried 0.863 | eco 0.835
//
// Deliberately gentle (the ask was "a little smaller"), and it touches the
// CEILING only, never the linear branch — so the early game, and the rule that
// more worms process more food, are untouched. carryingCapacity stays linear in
// capacity too: this is about production rate, not colony size.
//
// COST, accepted knowingly: the DECOMP_TICKS wastage threshold documented above
// is no longer closed-form in the way it was. It used to be
//     fill > 48 × K × composter.speed × species.speed        (capacity CANCELS)
// and with the falloff the capacity no longer cancels:
//     fill > 48 × K × speed × species.speed × (30/capacity) ** ALPHA
// so bigger bins now cross into unpaid rot at a slightly LOWER fill. The
// per-model thresholds quoted above are re-measured against this form.
const CAPACITY_THROUGHPUT_FALLOFF = 0.15;

// Tray-full chain (§2.8): once the humus tray is full processing halts; the
// undrained queue then rots anaerobically, raising toxicity in proportion to the
// stranded food volume each tick.
const ROT_RATE = 0.0002; // toxicity added per liter of stranded queue per tick

// Tank-full chain (§2.8): leachate produced past the tank's capacity re-saturates
// the bedding — this fraction of each overflowed liter is added to moisture.
const LEACHATE_SPILL_TO_MOISTURE = 0.05;

// Percolation (§2.5/§2.8): gravity drains bedding water into the leachate tank
// whenever the bedding is wetter than it can hold, and only while the tank has
// room. This is the bin's main water OUT-path (evaporation only matters when
// hot), so draining the tank is what keeps a well-fed bin in its moisture band.
const FIELD_CAPACITY = 0.75; // moisture the bedding holds against gravity
const PERCOLATION_RATE = 0.3; // fraction of the excess that drains per tick
const MOISTURE_TO_LEACHATE_LITERS = 8; // liters of leachate per 1.0 moisture unit

// Numerical slack for "depleted"/"full" comparisons on floating-point volumes.
const EPS = 1e-9;

/** Clamp to [0, 1]. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Clamp to [lo, hi]. */
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Liters of food the colony can eat this tick: linear in the active population
 * and both speed traits, but capped by what the bin's working surface can turn
 * over (see THROUGHPUT_CAP_PER_LITER).
 *
 * BOTH the `ration` hunger measurement and the actual eating MUST call this —
 * the sharing is load-bearing, not a tidiness refactor. `ration` is the fraction
 * of the colony's demand the standing queue covers, and it brakes laying via
 * RATION_TICKS (worms.js). If demand stayed uncapped while eating was capped, a
 * throttled colony would compute a demand it is not even allowed to eat, read as
 * permanently underfed no matter how full the bin, hold the reproduction brake
 * down forever, and settle at a silently different equilibrium — with every test
 * still green, because nothing asserts on `ration` directly. Keep them one call.
 *
 * @param {number} active juveniles + adults (cocoons do not eat)
 * @param {import('./worms.js').Species} species
 * @param {import('./composters.js').Composter} composter
 * @returns {number} liters of food consumable this tick
 */
function eatingThroughput(active, species, composter) {
  const linear = active * species.speed * composter.speed * CONSUMPTION_PER_WORM;
  return Math.min(linear, binThroughputCeiling(composter, species));
}

/**
 * The most food a full bin can turn over in one tick, however many worms are in
 * it — the ceiling term of `eatingThroughput`, exported so the UI and the tests
 * can ask the engine instead of re-deriving the formula. That re-derivation is
 * not hypothetical: `tests/actions.test.js` carried a hand-copied
 * `THROUGHPUT_CAP_PER_LITER = 0.02` against the engine's 0.014 from the moment
 * the constant was tuned, and the stale copy silently inverted the invariant it
 * was written to guard. One exported function, no mirrors.
 * @param {import('./composters.js').Composter} composter
 * @param {import('./worms.js').Species} species
 * @returns {number} liters per tick
 */
export function binThroughputCeiling(composter, species) {
  // Sublinear in capacity: the working face grows more slowly than the box.
  const falloff =
    (BIN_REFERENCE_CAPACITY / composter.capacity) ** CAPACITY_THROUGHPUT_FALLOFF;
  return (
    composter.capacity *
    falloff *
    composter.speed *
    species.speed *
    THROUGHPUT_CAP_PER_LITER
  );
}

/**
 * A single food item decomposing in the bin.
 * @typedef {object} FoodEntry
 * @property {string} foodId    catalog id (js/sim/foods.js)
 * @property {number} liters    portion volume in liters
 * @property {number} addedAtTick absolute tick index when it was added
 */

/**
 * Three-stage worm cohort counts (§2.4). Stubbed at zero until T5.
 * @typedef {object} Population
 * @property {number} cocoons
 * @property {number} juveniles
 * @property {number} adults
 */

/**
 * Bin-wide environment variables (§2.5); each has a comfort band. Stubbed at
 * neutral defaults until T3/T4 drive them.
 * @typedef {object} BinEnv
 * @property {number} moisture    0..1 water fraction
 * @property {number} ph          0..14
 * @property {number} toxicity    0..1 accumulated, decays slowly
 * @property {number} temperature degrees Celsius
 */

/**
 * The complete, JSON-serializable simulation state. Stored under `farm` in the
 * versioned save (js/storage.js). Contains only plain JSON types so it
 * round-trips losslessly and stays deterministic across save/load.
 * @typedef {object} FarmState
 * @property {number} day           game day, starts at 1
 * @property {number} hour          hour of day, 0..23
 * @property {number} rngState      serializable RNG state (js/sim/rng.js)
 * @property {string|null} composterId chosen composter model (catalog id)
 * @property {string|null} speciesId   chosen worm species (catalog id)
 * @property {number} wallPosition  position along the garage wall, 0..1
 * @property {number} hotSide       which END of the wall is the warm one: 1 =
 *   position 1, 0 = position 0. Rolled once per farm from the seed (see
 *   `hotSideFromSeed`) and fixed for the run, so the player can learn THIS
 *   garage. Read through `hotSideOf` so pre-existing saves without the field
 *   still resolve to a defined orientation.
 * @property {Population} population
 * @property {BinEnv} env
 * @property {FoodEntry[]} queue    food items decomposing, oldest first
 * @property {number} humus         humus accrued in the tray (liters)
 * @property {number} leachate      leachate accrued in the tank (liters)
 * @property {number} colonyAgeDays days since the current colony started
 * @property {boolean} colonyAlive  false once the population hits zero
 * @property {number} score         live score (couples output and colony age)
 * @property {number} createdAt     wall-clock ms when the farm was created; part
 *   of the frozen ranking record (§2.1). INJECTED by the orchestrator — the sim
 *   never reads the clock, so it stays pure and deterministic under test.
 */

// Guided bedding mix -> initial bin environment (setup, §2.3). The mix is three
// components; the starting moisture/pH is their volume-weighted blend. Values
// are FIRST-PASS: sawdust is dry & mildly acidic, fruit peels wet & acidic, wet
// cardboard wet & near-neutral — so more sawdust dries the bin, more peels
// acidify it, more cardboard wets it.
//
// NOTE: bedding sawdust carries no toxicity term, unlike the `addSawdust`
// action. That divergence is deliberate, not an oversight — bedding is mixed
// once at setup, when toxicity is 0 by definition, so a scrub term here could
// only ever be a no-op.
const BEDDING_COMPONENTS = {
  sawdust: { moisture: 0.15, ph: 6.2 },
  peels: { moisture: 0.85, ph: 5.0 },
  cardboard: { moisture: 0.8, ph: 7.2 },
};

/**
 * Guided (pre-filled) bedding amounts in liters — tuned so the blend lands
 * moisture/pH inside every species' comfort band (locked by the engine test).
 */
export const RECOMMENDED_BEDDING = { sawdust: 1.5, peels: 1, cardboard: 2.5 };

/**
 * A bedding mix, in liters per component.
 * @typedef {object} BeddingMix
 * @property {number} sawdust   dry, mildly acidic
 * @property {number} peels     fruit peels/husks — wet, acidic
 * @property {number} cardboard wet cardboard — wet, near-neutral
 */

/**
 * Initial bin moisture and pH from a bedding mix: the volume-weighted blend of
 * the component characteristics. An empty mix returns neutral defaults. Pure.
 * @param {BeddingMix} mix
 * @returns {{moisture: number, ph: number}}
 */
export function beddingEnv(mix) {
  let total = 0;
  let moisture = 0;
  let ph = 0;
  for (const [key, comp] of Object.entries(BEDDING_COMPONENTS)) {
    const liters = mix && mix[key] > 0 ? mix[key] : 0;
    total += liters;
    moisture += liters * comp.moisture;
    ph += liters * comp.ph;
  }
  if (total <= 0) return { moisture: 0.5, ph: 7 };
  return { moisture: clamp01(moisture / total), ph: clamp(ph / total, 0, 14) };
}

/**
 * Which end of the wall is the warm one, derived from the farm's seed.
 *
 * Deliberately does NOT draw from the farm's `Rng`. Consuming a value here would
 * advance `rngState` by one step before the first tick, which would shift every
 * seeded sequence in the suite — the balance, population and mortality scenarios
 * all assert on outcomes for a fixed seed, and every one of them would move for
 * a reason that has nothing to do with what they test.
 *
 * Hashing the seed instead keeps determinism (same seed ⇒ same garage) while
 * leaving the RNG stream untouched. The randomness the player experiences comes
 * from the seed itself, which `randomSeed()` in js/main.js draws fresh per farm.
 *
 * The mixing step is mulberry32's (js/sim/rng.js) applied once to a COPY: the
 * low bit of a raw seed is a poor coin flip, since consecutive seeds would
 * alternate sides in lockstep.
 * @param {number} seed
 * @returns {number} 1 (position 1 is hot) or 0 (position 0 is hot)
 */
export function hotSideFromSeed(seed) {
  let t = ((seed >>> 0) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) % 2;
}

/**
 * Read a farm's hot end defensively. Saves written before the gradient existed
 * carry no `hotSide`, and rather than refuse them (never silently discard a
 * player's save) they resolve to a defined orientation, so an old farm gains a
 * garage that is stable from then on instead of flipping between loads.
 *
 * The fallback is derived from `createdAt`, which is stamped once when the farm
 * is created and never written again. It deliberately is NOT derived from
 * `rngState`: that field advances as the RNG is drawn (see the bottom of `tick`),
 * so a legacy save would have re-rolled which end of its garage was warm on the
 * ticks where the population step happened to draw — the bin's temperature would
 * lurch by up to 2 x POSITION_BIAS_MAX with no cause the player could observe.
 * @param {FarmState} state
 * @returns {number} 1 or 0
 */
export function hotSideOf(state) {
  const raw = state?.hotSide;
  if (raw === 0 || raw === 1) return raw;
  return hotSideFromSeed(state?.createdAt ?? 0);
}

/**
 * @typedef {object} InitialFarmOptions
 * @property {number} [seed=1]           RNG seed (orchestrator supplies entropy)
 * @property {string|null} [composterId=null]
 * @property {string|null} [speciesId=null]
 * @property {number} [wallPosition=0.5]
 * @property {number} [hotSide]          override which end is warm (1 or 0).
 *   Defaults to `hotSideFromSeed(seed)`. Tests pin it so a scenario's thermal
 *   character does not depend on the seed's coin flip.
 * @property {Partial<BinEnv>|null} [env=null] initial env override (e.g. from
 *   beddingEnv) merged over the neutral defaults; unset fields keep defaults.
 * @property {number} [createdAt=0] wall-clock ms the farm was created at. The
 *   caller supplies it (`Date.now()` in the browser) so the sim reads no clock.
 */

/**
 * Build a fresh farm at day 1, hour 0 with all subsystems at their defaults.
 * @param {InitialFarmOptions} [opts]
 * @returns {FarmState}
 */
export function createInitialFarmState(opts = {}) {
  const {
    seed = 1,
    composterId = null,
    speciesId = null,
    wallPosition = 0.5,
    hotSide = hotSideFromSeed(seed),
    env = null,
    createdAt = 0,
  } = opts;

  const baseEnv = { moisture: 0.5, ph: 7, toxicity: 0, temperature: 20 };

  return {
    day: 1,
    hour: 0,
    rngState: seed >>> 0,
    composterId,
    speciesId,
    wallPosition,
    hotSide: hotSide === 0 ? 0 : 1,
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    env: env ? { ...baseEnv, ...env } : baseEnv,
    queue: [],
    humus: 0,
    leachate: 0,
    colonyAgeDays: 0,
    colonyAlive: true,
    score: 0,
    createdAt,
  };
}

/**
 * The absolute tick index for a farm's current clock (day 1 hour 0 = tick 0).
 * Used to stamp food entries and reason about elapsed time.
 * @param {FarmState} state
 * @returns {number}
 */
export function absoluteTick(state) {
  return (state.day - 1) * 24 + state.hour;
}

/**
 * Add a waste portion to the food queue. Rejects unknown foods and portions
 * below MIN_PORTION_LITERS (returns the input state unchanged). The queue is
 * bounded by the composter's capacity: an over-capacity add is clamped to the
 * remaining space, or rejected if less than a minimum portion remains.
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @param {string} foodId catalog id (js/sim/foods.js)
 * @param {number} liters requested portion volume
 * @returns {FarmState}
 */
export function addFood(state, foodId, liters) {
  if (!getFood(foodId)) return state;
  if (!(liters >= MIN_PORTION_LITERS)) return state; // also rejects NaN/negatives

  const composter = getComposter(state.composterId);
  const capacity = composter ? composter.capacity : 0;
  const used = state.queue.reduce((sum, e) => sum + e.liters, 0);
  const remaining = capacity - used;
  if (remaining < MIN_PORTION_LITERS) return state; // bin is full

  const portion = Math.min(liters, remaining);
  const entry = { foodId, liters: portion, addedAtTick: absoluteTick(state) };
  return { ...state, queue: [...state.queue, entry] };
}

/**
 * Add sawdust to dry the bin AND scrub some accumulated toxicity (§2.5). Both
 * effects are deterministic and immediate — sawdust does not enter the food
 * queue, so unlike a food it releases nothing gradually. Ignores a non-positive
 * amount.
 *
 * Both results are clamped here rather than left to the tick: this writes `env`
 * directly, so it never passes through the clamps in `tick`. Without the
 * toxicity clamp, sawdust on an already-clean bin would drive `env.toxicity`
 * negative and that would surface in the UI's internals gauge, which is drawn on
 * a 0..1 domain.
 *
 * VOLUME-NORMALISED like the food queue (`envDilution`), and for the same reason:
 * a dose is given in LITERS against per-liter strengths, so it is an extensive
 * amount landing on an intensive variable. Exempting it would have quietly made
 * sawdust a stronger lever with every upgrade — the UI already scales the click
 * with capacity (0.5 L on tier2, 1.75 L on eco), so an undiluted dose would dry a
 * big bin in roughly a third of the clicks the anchor bin needs, and hand over
 * the toxicity scrub at the same discount. Diluting both keeps the food/sawdust
 * ratio the calibration was tuned around identical on every model.
 * @param {FarmState} state
 * @param {number} liters sawdust volume added
 * @returns {FarmState}
 */
export function addSawdust(state, liters) {
  if (!(liters > 0)) return state;
  const dilution = envDilution(getComposter(state.composterId));
  const moisture = clamp01(state.env.moisture - SAWDUST_DRY_PER_LITER * liters * dilution);
  const toxicity = clamp01(state.env.toxicity - SAWDUST_TOX_PER_LITER * liters * dilution);
  return { ...state, env: { ...state.env, moisture, toxicity } };
}

/**
 * Result of a container-emptying action. Unlike addFood/addSawdust (which return
 * a bare FarmState), drain/harvest also surface the volume removed so the economy
 * layer (T7 auto-sell/scoring) can price it. Pure — no RNG.
 * @typedef {object} DrainResult
 * @property {FarmState} state   new state with the tank emptied
 * @property {number} drained    liters of leachate removed
 */

/**
 * @typedef {object} HarvestResult
 * @property {FarmState} state   new state with the humus tray emptied
 * @property {number} harvested  liters of humus removed
 */

/**
 * Drain the leachate tank: empties it instantly and fully (leachate -> 0),
 * relieving the moisture pressure of a full tank (§2.7 — "instant, empties
 * fully"). Returns the new state plus the volume drained (for T7 auto-sell).
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @returns {DrainResult}
 */
export function drainLeachate(state) {
  const drained = state.leachate;
  return { state: { ...state, leachate: 0 }, drained };
}

/**
 * Harvest the humus tray: empties it at any time (humus -> 0), which re-enables
 * processing after a tray-full halt (§2.8). Returns the new state plus the volume
 * harvested — T7 scoring consumes `harvested` for the age-multiplied points.
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @returns {HarvestResult}
 */
export function harvestHumus(state) {
  const harvested = state.humus;
  return { state: { ...state, humus: 0 }, harvested };
}

/**
 * Advance the simulation by one game hour and return a NEW FarmState. Does not
 * mutate the input. The caller must construct `rng` from `state.rngState` (so
 * the sequence resumes correctly after save/load); tick threads the RNG's
 * advanced state back into the returned state.
 * @param {FarmState} state
 * @param {import('./rng.js').Rng} rng
 * @returns {FarmState}
 */
export function tick(state, rng) {
  let hour = state.hour + 1;
  let day = state.day;
  let dayRolled = false;
  if (hour >= 24) {
    hour = 0;
    day += 1;
    dayRolled = true;
  }

  const prevTick = absoluteTick(state);
  const newTick = prevTick + 1;

  // Food queue decomposition releases moisture/pH/toxicity gradually and yields
  // the still-fresh mass that drives fermentation heat (§2.5, §2.7).
  const dyn = queueDynamics(state.queue, prevTick, newTick);

  const composter = getComposter(state.composterId);
  const species = getSpecies(state.speciesId);
  // Converts the queue's EXTENSIVE contributions (liters x per-liter numbers)
  // into the INTENSIVE concentrations the env variables actually are. Applied in
  // one place, at the env computation below, so no contributing term can be
  // silently left on the wrong unit.
  const dilution = envDilution(composter);

  // Worm consumption, production, and the two overflow chains (§2.6, §2.8).
  // Consumption uses the PRE-tick population (order-independent from the cohort
  // step below) and is fully deterministic — no RNG. A dead/empty colony or a
  // full humus tray means no worm-driven processing this tick — but the overflow
  // chains (leachate spill, anaerobic rot) below keep running regardless, since
  // rot is decay, not production (§2.1 "production stops" on colony death).
  let queue = state.queue;
  let humus = state.humus;
  let leachate = state.leachate;
  let spillMoisture = 0; // leachate re-saturating the bedding (tank-full chain)
  let rotToxicity = 0; // stranded food rotting anaerobically (tray-full chain)
  let eatenMoisture = 0; // water in consumed food, released into the bedding
  // Fraction of the colony's food requirement standing in the bin this tick; it
  // brakes laying in populationStep (see worms.js RATION_TICKS). A farm with no
  // composter or no species has no colony to feed, so it stays fully fed (1).
  let ration = 1;

  if (composter) {
    const active = state.population.juveniles + state.population.adults;
    const trayFull = humus >= composter.humusCapacity - EPS;

    // Measured BEFORE this tick's eating, against the same throughput formula
    // used to consume: how many ticks of demand the standing queue covers.
    if (species && active > 0) {
      const demand = eatingThroughput(active, species, composter);
      const standing = queue.reduce((sum, e) => sum + e.liters, 0);
      ration = demand > 0 ? clamp01(standing / (demand * RATION_TICKS)) : 1;
    }

    // A dead colony (colonyAlive === false) never produces; its population is
    // already zero so `active > 0` also gates this, but the flag makes the
    // "colony-dead ⇒ no consumption/humus/leachate" rule (§2.1) explicit.
    if (species && active > 0 && !trayFull && state.colonyAlive) {
      // Same throughput the `ration` demand above was measured against.
      let toEat = eatingThroughput(active, species, composter);
      let eaten = 0;
      const nextQueue = [];
      for (const entry of queue) {
        if (toEat <= EPS) {
          nextQueue.push(entry);
          continue;
        }
        let eatenHere;
        if (entry.liters <= toEat + EPS) {
          // Oldest entry fully consumed -> removed from the queue.
          eatenHere = entry.liters;
          toEat -= entry.liters;
        } else {
          // Partially eaten -> keep the remainder in place.
          eatenHere = toEat;
          nextQueue.push({ ...entry, liters: entry.liters - toEat });
          toEat = 0;
        }
        eaten += eatenHere;
        // Water in EATEN food still enters the bin — worms process it into moist
        // castings, they do not evaporate it. Only the share that had not already
        // seeped out through decomposition is credited, so each liter of food
        // releases its moisture exactly once whether it rots in place or is eaten.
        // Without this the bin leaked water: a hungry colony consumed food within
        // a tick or two of it landing, so almost none of that moisture ever
        // reached the bedding, and evaporation dried a well-fed farm to death
        // (the CP3 crash). The bin's real water sink is draining the leachate.
        const food = getFood(entry.foodId);
        if (food) {
          const undecomposed = 1 - decompositionFraction(newTick - entry.addedAtTick);
          eatenMoisture += food.moisture * eatenHere * Math.max(0, undecomposed);
        }
      }
      // Fully decomposed food leaves the queue — an active colony works it into
      // the bedding, so it stops occupying bin capacity. It yields no humus:
      // humus is what worms MAKE (§2.6), and crediting un-eaten matter would pay
      // the player for neglect. Gated on the same condition as consumption, so
      // when processing halts (tray full) or the colony is gone the matter
      // strands and rots instead — the §2.8 tray chain is driven by exactly that
      // stranded volume.
      //
      // Without this, decomposed matter sat in the queue forever once there were
      // too few worms left to eat it: it permanently blocked bin capacity (so no
      // fresh waste could be added), released no more moisture, and produced no
      // more fermentation heat. A crashed colony could then always rebound, which
      // turned the leachate and overfeeding chains into endless limit cycles
      // instead of reaching the terminal state §2.8 requires.
      queue = nextQueue.filter((e) => newTick - e.addedAtTick < DECOMP_TICKS);
      // Eaten volume converts to humus and leachate at the composter's rates.
      humus += eaten * composter.humusRate;
      leachate += eaten * composter.leachateRate;
    }

    // Tank-full chain: leachate past capacity re-saturates the bedding (moisture
    // spike) and the tank clamps at capacity — the spike happens ONLY here.
    if (leachate > composter.leachateCapacity) {
      spillMoisture = (leachate - composter.leachateCapacity) * LEACHATE_SPILL_TO_MOISTURE;
      leachate = composter.leachateCapacity;
    }

    // Tray-full chain: humus clamps at capacity; while the tray is full the
    // undrained queue rots anaerobically and climbs toxicity over time.
    if (humus > composter.humusCapacity) humus = composter.humusCapacity;
    if (trayFull) {
      const stranded = queue.reduce((sum, e) => sum + e.liters, 0);
      rotToxicity = stranded * ROT_RATE;
    }
  }

  // Environment dynamics: moisture accrues (food releases it, leachate backup
  // spikes it) and is lost to passive evaporation (faster when warm) and sawdust;
  // pH eases back toward neutral then takes the food push; toxicity decays very
  // slowly then takes the food load plus any rot. Evaporation uses the pre-tick
  // temperature (the warmth the bin carried into this hour).
  //
  // The food load `dyn.toxicity` is SIGNED — the remediating foods carry a
  // negative per-liter toxicity, so a queue full of them subtracts here. That
  // plus `addSawdust` are the only paths that remove toxicity faster than
  // TOX_DECAY_RATE; the clamp below is what keeps a clean bin pinned at zero.
  // Every queue-sourced term is volume-normalised (see envDilution); evaporation
  // is not, because it already acts on the concentration scale.
  const evaporation = EVAP_COEF * Math.max(0, state.env.temperature - EVAP_THRESHOLD);
  let moisture = clamp01(
    state.env.moisture +
      (dyn.moisture + eatenMoisture + spillMoisture) * dilution -
      evaporation,
  );

  // Percolation (§2.8, the leachate chain): bedding water above field capacity
  // drains down into the leachate tank — this is what the tank and its tap are
  // FOR, and it is the ONLY path water has out of a cool bin. It makes the
  // never-drain chain work as the spec describes it: keep draining and the
  // bedding is held at field capacity, let the tank fill and percolation backs up
  // with nowhere to go, so the bedding saturates to lethal. Before this the tank
  // was decorative — it never even reached capacity, and "saturation" deaths were
  // really just food water piling up with no drainage anywhere in the model.
  if (composter) {
    const room = composter.leachateCapacity - leachate;
    if (moisture > FIELD_CAPACITY && room > EPS) {
      const excess = (moisture - FIELD_CAPACITY) * PERCOLATION_RATE;
      const drained = Math.min(excess, room / MOISTURE_TO_LEACHATE_LITERS);
      moisture -= drained;
      leachate += drained * MOISTURE_TO_LEACHATE_LITERS;
    }
  }
  const ph = clamp(
    state.env.ph + (NEUTRAL_PH - state.env.ph) * PH_DRIFT_RATE + dyn.phPush * dilution,
    0,
    14,
  );
  const toxicity = clamp01(
    state.env.toxicity * (1 - TOX_DECAY_RATE) + (dyn.toxicity + rotToxicity) * dilution,
  );

  // Temperature: blend toward the environment target for the new hour. The two
  // positional terms are separate on purpose (see js/sim/temperature.js): the sun
  // sweeps and sleeps at night, the garage's own hot-end/cold-end gradient does
  // neither.
  const target =
    ambientTemperature(hour) +
    solarGain(state.wallPosition, hour) +
    positionBias(state.wallPosition, hotSideOf(state)) +
    fermentationHeat(dyn.freshHeatMass);
  const temperature = blendTemperature(state.env.temperature, target, composter);
  const env = { moisture, ph, toxicity, temperature };

  // Population: evolve the cohort pipeline against the new environment. Skipped
  // until a species is chosen (empty farm before setup); the RNG is only drawn
  // for fractional cohort flows, so an empty colony consumes no randomness.
  const population = species
    ? populationStep(state.population, env, species, carryingCapacity(composter), rng, ration)
    : state.population;

  // Colony lifecycle (§2.1). Age advances once per game-day rollover while the
  // colony lives; a dead colony is frozen at the age it reached. Death is a
  // TRANSITION detected here: a colony that HAD worms (pre-tick total > 0) and
  // now has none flips colonyAlive → false. An empty pre-setup farm (never had
  // worms) never makes that transition, so it stays "alive" until real worms are
  // added and only later lost. Repopulation (buyWormPack) resets the age to 0.
  const prevTotal =
    state.population.cocoons + state.population.juveniles + state.population.adults;
  const newTotal = population.cocoons + population.juveniles + population.adults;
  let colonyAlive = state.colonyAlive;
  let colonyAgeDays = state.colonyAgeDays;
  if (state.colonyAlive && dayRolled) colonyAgeDays += 1;
  if (state.colonyAlive && prevTotal > 0 && newTotal === 0) colonyAlive = false;

  return {
    ...state,
    day,
    hour,
    rngState: rng.state,
    env,
    population,
    queue,
    humus,
    leachate,
    colonyAgeDays,
    colonyAlive,
  };
}

// --- Economy (§2.2, §2.11) --------------------------------------------------
//
// PURE and deterministic — no RNG, no DOM. The wallet lives on the player
// PROFILE (save schema §2.11: `{ v, profile: { nickname, wallet }, farm, ... }`)
// so it survives farm restarts; it is NOT a FarmState field. Every economy
// function therefore takes an explicit `wallet` number and returns the updated
// one alongside the new farm state. All prices are FIRST-PASS (CP-review / T8
// tuning); the structural relationships are what matter and what the tests lock.

/** Auto-sell price of humus, per liter (§2.2 — humus is worth much more). */
export const HUMUS_PRICE_PER_LITER = 12;

/** Auto-sell price of leachate, per liter (§2.2 — a small bonus). */
export const LEACHATE_PRICE_PER_LITER = 2;

/** Worm pack sizes the shop sells (§2.2). */
export const WORM_PACK_SIZES = [50, 100, 200];

// New profiles start able to buy the cheapest composter (tier2 = 100) + a
// 50-worm pack of the cheapest species (californiana = 40) + bedding (FREE,
// §2.2), with a little slack. Minimum viable start is 140; 200 leaves 60 of
// slack. Asserted DYNAMICALLY against the catalogs in the tests, not hardcoded
// there — so retuning a catalog price only needs this constant revisited.
/** Coins a fresh player profile starts with (§2.2). */
export const STARTING_WALLET = 200;

// Larger packs cost proportionally more worms but earn a small, capped bulk
// discount (cheaper per worm). species.price is defined as the price of the
// base 50-worm pack; a pack of N worms costs price × (N/50) × discount.
const BULK_DISCOUNT_PER_STEP = 0.03; // per extra 50-worm step above the base pack

/**
 * Price of a worm pack. species.price is the base 50-worm pack price; the pack
 * scales by worm count (packSize/50) with a small bulk discount and is rounded
 * to whole coins. Unknown species or an unsupported pack size returns Infinity
 * (unaffordable), so a caller's `wallet >= price` guard rejects it.
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {number} price in coins, or Infinity if invalid
 */
export function wormPackPrice(speciesId, packSize) {
  const species = getSpecies(speciesId);
  if (!species || !WORM_PACK_SIZES.includes(packSize)) return Infinity;
  const steps = packSize / 50; // 1, 2, or 4
  const discount = Math.max(0.5, 1 - BULK_DISCOUNT_PER_STEP * (steps - 1));
  return Math.round(species.price * steps * discount);
}

/**
 * Coins earned auto-selling harvested humus (§2.2 — no inventory, instant sale).
 * @param {number} liters liters of humus sold (>= 0)
 * @returns {number} coins
 */
export function sellHumus(liters) {
  return (liters > 0 ? liters : 0) * HUMUS_PRICE_PER_LITER;
}

/**
 * Coins earned auto-selling drained leachate (§2.2 — a small bonus).
 * @param {number} liters liters of leachate sold (>= 0)
 * @returns {number} coins
 */
export function sellLeachate(liters) {
  return (liters > 0 ? liters : 0) * LEACHATE_PRICE_PER_LITER;
}

/**
 * Result of harvesting the humus tray and auto-selling it (§2.2, §2.10).
 * @typedef {object} HarvestSaleResult
 * @property {FarmState} state    tray emptied and score advanced
 * @property {number} wallet      wallet after crediting the sale
 * @property {number} harvested   liters of humus removed
 * @property {number} coins       coins credited for the humus
 * @property {number} points      score points the harvest added
 */

/**
 * Harvest the humus tray, auto-sell it into the wallet, and bank the age-scaled
 * score (§2.10). Combines harvestHumus + sellHumus + applyHarvestScore. The
 * points use the colony age at harvest time. Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @returns {HarvestSaleResult}
 */
export function harvestAndSell(state, wallet) {
  const { state: harvested, harvested: liters } = harvestHumus(state);
  const coins = sellHumus(liters);
  const points = scorePoints(liters, state.colonyAgeDays);
  const scored = applyHarvestScore(harvested, liters);
  return { state: scored, wallet: wallet + coins, harvested: liters, coins, points };
}

/**
 * Result of draining the leachate tank and auto-selling it (§2.2).
 * @typedef {object} DrainSaleResult
 * @property {FarmState} state   tank emptied
 * @property {number} wallet     wallet after crediting the sale
 * @property {number} drained    liters of leachate removed
 * @property {number} coins      coins credited for the leachate
 */

/**
 * Drain the leachate tank and auto-sell it into the wallet. Leachate earns coins
 * but NO score — only humus harvests score (§2.10). Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @returns {DrainSaleResult}
 */
export function drainAndSell(state, wallet) {
  const { state: drainedState, drained } = drainLeachate(state);
  const coins = sellLeachate(drained);
  return { state: drainedState, wallet: wallet + coins, drained, coins };
}

/**
 * Result of a wallet-spending action (buy / repopulate / migrate).
 * @typedef {object} PurchaseResult
 * @property {FarmState} state  new state (unchanged when ok === false)
 * @property {number} wallet    new wallet (unchanged when ok === false)
 * @property {boolean} ok       whether the purchase went through
 */

/**
 * Buy a worm pack and add the worms to the farm as ADULTS (§2.2). Rejects
 * (ok:false, state+wallet unchanged) on an unknown species, an unsupported pack
 * size, or an insufficient wallet. On success the price is deducted and the
 * worms are added; the pack's species becomes the farm's species (one species
 * per farm). If the colony was DEAD this repopulates the SAME farm (§2.1):
 * colonyAlive → true and colonyAgeDays → 0, while score/humus/leachate totals
 * are kept. Adding to a LIVE colony does NOT reset the age. Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {PurchaseResult}
 */
export function buyWormPack(state, wallet, speciesId, packSize) {
  const species = getSpecies(speciesId);
  if (!species || !WORM_PACK_SIZES.includes(packSize)) {
    return { state, wallet, ok: false };
  }
  const price = wormPackPrice(speciesId, packSize);
  if (!(wallet >= price)) return { state, wallet, ok: false };

  const wasDead = !state.colonyAlive;
  const next = {
    ...state,
    speciesId,
    population: { ...state.population, adults: state.population.adults + packSize },
    colonyAlive: true,
    // A dead colony repopulates as a fresh colony: age resets. A live one keeps
    // its accumulated age (restocking must not wipe the longevity multiplier).
    colonyAgeDays: wasDead ? 0 : state.colonyAgeDays,
  };
  return { state: next, wallet: wallet - price, ok: true };
}

/**
 * Repopulate the farm after a colony death (§2.1). Thin alias of buyWormPack —
 * a dead colony's purchase already resets colonyAlive/colonyAgeDays.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {PurchaseResult}
 */
export function repopulateColony(state, wallet, speciesId, packSize) {
  return buyWormPack(state, wallet, speciesId, packSize);
}

/**
 * Migrate the farm to a new composter model (§2.2 mid-farm upgrade). Rejects
 * (ok:false, unchanged) on an unknown or same model, or if the wallet cannot
 * cover the net cost `newPrice − 0.5 × oldPrice`. On success: the old bin's
 * humus + leachate are auto-sold into the wallet, a 50% trade-in of the OLD
 * composter is credited, the new price is deducted, and worms / food queue /
 * bedding (env) / colonyAgeDays / score / colonyAlive all carry across. Humus
 * and leachate start empty in the new bin (they were sold). If the new bin's
 * capacity is smaller, the carried queue is trimmed OLDEST-FIRST up to the new
 * capacity (truncating the straddling entry, discarding the newest overflow —
 * the oldest food is closest to becoming humus). One composter at a time. Pure
 * — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} newComposterId catalog id (js/sim/composters.js)
 * @returns {PurchaseResult}
 */
export function migrateToComposter(state, wallet, newComposterId) {
  const newComposter = getComposter(newComposterId);
  if (!newComposter || newComposterId === state.composterId) {
    return { state, wallet, ok: false };
  }

  const oldComposter = getComposter(state.composterId);
  const tradeIn = 0.5 * (oldComposter ? oldComposter.price : 0);
  const netCost = newComposter.price - tradeIn;
  if (!(wallet >= netCost)) return { state, wallet, ok: false };

  // Auto-sell whatever was in the old bin, then apply trade-in − new price.
  const saleCoins = sellHumus(state.humus) + sellLeachate(state.leachate);
  const newWallet = wallet + saleCoins + tradeIn - newComposter.price;

  // Trim the carried queue oldest-first to the new capacity if it is smaller.
  let queue = state.queue;
  const queued = queue.reduce((sum, e) => sum + e.liters, 0);
  if (queued > newComposter.capacity + EPS) {
    const trimmed = [];
    let room = newComposter.capacity;
    for (const e of queue) {
      if (room <= EPS) break;
      if (e.liters <= room + EPS) {
        trimmed.push(e);
        room -= e.liters;
      } else {
        trimmed.push({ ...e, liters: room });
        room = 0;
      }
    }
    queue = trimmed;
  }

  const next = {
    ...state,
    composterId: newComposterId,
    queue,
    humus: 0,
    leachate: 0,
  };
  return { state: next, wallet: newWallet, ok: true };
}
