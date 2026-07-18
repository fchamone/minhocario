import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getFood,
  listFoods,
  decompositionFraction,
  queueDynamics,
  DECOMP_TICKS,
} from '../js/sim/foods.js';
import {
  createInitialFarmState,
  tick,
  addFood,
  addSawdust,
  absoluteTick,
  MIN_PORTION_LITERS,
  SAWDUST_TOX_PER_LITER,
} from '../js/sim/engine.js';
import { getComposter } from '../js/sim/composters.js';
import { createRng } from '../js/sim/rng.js';

/** Advance a state n ticks with a fresh RNG seeded from its own rngState. */
function run(state, n) {
  const rng = createRng(state.rngState);
  for (let i = 0; i < n; i++) state = tick(state, rng);
  return state;
}

// --- catalog -----------------------------------------------------------------

test('food catalog has 14 items, each with numeric effect fields', () => {
  const foods = listFoods();
  assert.equal(foods.length, 14);
  for (const f of foods) {
    assert.equal(typeof f.id, 'string');
    for (const field of ['moisture', 'ph', 'toxicity', 'heat']) {
      assert.equal(typeof f[field], 'number', `${f.id}.${field} should be a number`);
    }
  }
});

test('food data shape carries NO suitability flag (discovery is gameplay)', () => {
  // The add-waste list deliberately mixes suitable and unsuitable foods without
  // labeling which is which — a suitability flag in the data would leak it.
  const banned = [
    'suitable', 'unsuitable', 'harmful', 'safe', 'unsafe',
    'good', 'bad', 'forbidden', 'allowed', 'toxic',
  ];
  for (const f of listFoods()) {
    for (const key of banned) {
      assert.ok(!(key in f), `food ${f.id} must not carry a suitability flag: "${key}"`);
    }
  }
});

test('catalog order carries no suitability signal — it is not a strict alternation', () => {
  // The add-waste UI renders foods in raw catalog order (§2.7), so a *perfectly*
  // regular good/bad pattern would leak suitability by position: with strict
  // alternation, a food's index parity predicts whether it is harmful. Discovery
  // is the gameplay, so the order must stay an irregular mix — at least one pair
  // of neighbours must share the same suitability, breaking any parity pattern.
  const harmful = listFoods().map((f) => f.toxicity > 0);
  const strictlyAlternating = harmful.every((h, i) => i === 0 || h !== harmful[i - 1]);
  assert.ok(
    !strictlyAlternating,
    'FOODS must not alternate suitable/harmful by index — that leaks suitability by position',
  );
});

test('getFood returns the model by id and null for an unknown id', () => {
  assert.equal(getFood('meat').id, 'meat');
  assert.equal(getFood('nope'), null);
  assert.equal(getFood(null), null);
});

// --- addFood: queue mechanics ------------------------------------------------

test('addFood appends a {foodId, liters, addedAtTick} entry stamped at the current tick', () => {
  let s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  s = run(s, 5); // advance to absolute tick 5
  const at = absoluteTick(s);
  const s2 = addFood(s, 'vegetableScraps', 2);
  assert.equal(s2.queue.length, 1);
  assert.deepEqual(s2.queue[0], { foodId: 'vegetableScraps', liters: 2, addedAtTick: at });
  assert.equal(s.queue.length, 0, 'input state not mutated');
});

test('addFood rejects an unknown food and a sub-minimum portion', () => {
  const s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  assert.equal(addFood(s, 'nope', 1).queue.length, 0);
  assert.equal(addFood(s, 'vegetableScraps', 0.1).queue.length, 0);
  assert.equal(addFood(s, 'vegetableScraps', MIN_PORTION_LITERS).queue.length, 1);
});

test('addFood is capacity-bounded: the queue never exceeds composter capacity', () => {
  const cap = getComposter('tier2').capacity;
  let s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  s = addFood(s, 'vegetableScraps', cap - 2);
  s = addFood(s, 'vegetableScraps', 10); // would overflow -> clamped to remaining
  const total = s.queue.reduce((a, e) => a + e.liters, 0);
  assert.ok(total <= cap + 1e-9, `queue total ${total} within capacity ${cap}`);
  // once full, a further add is rejected
  const full = addFood(s, 'vegetableScraps', 5);
  assert.equal(full.queue.length, s.queue.length);
});

// --- gradual effect release --------------------------------------------------

test('food effects release gradually over many ticks, not in a single jump', () => {
  let s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  s = addFood(s, 'pumpkinGuts', 5); // a wet food
  const m0 = s.env.moisture;

  const rng = createRng(s.rngState);
  const trace = [];
  for (let i = 0; i < 6; i++) {
    s = tick(s, rng);
    trace.push(s.env.moisture);
  }
  for (let i = 1; i < trace.length; i++) {
    assert.ok(trace[i] > trace[i - 1], `moisture keeps rising as food decomposes (tick ${i})`);
  }
  const afterOne = trace[0] - m0;

  // fully decompose from scratch and compare the total effect
  let full = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  full = addFood(full, 'pumpkinGuts', 5);
  full = run(full, DECOMP_TICKS);
  const total = full.env.moisture - m0;
  assert.ok(afterOne < total * 0.5, 'a single tick releases well under half the total effect');
});

// --- pH: citrus acidifies then drifts back -----------------------------------

test('citrus pushes pH acidic, then it drifts back toward neutral once spent', () => {
  let s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  s = addFood(s, 'citrus', 6);

  const rng = createRng(s.rngState);
  let trough = Infinity;
  for (let i = 0; i < DECOMP_TICKS; i++) {
    s = tick(s, rng);
    trough = Math.min(trough, s.env.ph);
  }
  assert.ok(trough < 6.5, `citrus acidifies below neutral: trough ${trough}`);

  for (let i = 0; i < 96; i++) s = tick(s, rng); // food spent -> drift home
  assert.ok(s.env.ph > trough + 0.2, `pH recovers toward neutral: ${s.env.ph} vs trough ${trough}`);
  assert.ok(Math.abs(s.env.ph - 7) < Math.abs(trough - 7), 'pH ends nearer neutral than the trough');
});

// --- toxicity persists far longer than a pH deviation ------------------------

test('meat toxicity persists much longer than citrus pH deviation recovers', () => {
  const SPAN = 4 * 24;

  let citrus = addFood(createInitialFarmState({ seed: 1, composterId: 'tier2' }), 'citrus', 6);
  const rc = createRng(citrus.rngState);
  for (let i = 0; i < DECOMP_TICKS; i++) citrus = tick(citrus, rc);
  const phTrough = citrus.env.ph;
  for (let i = 0; i < SPAN; i++) citrus = tick(citrus, rc);
  const phRecoveredFrac = (citrus.env.ph - phTrough) / (7 - phTrough);

  let meat = addFood(createInitialFarmState({ seed: 1, composterId: 'tier2' }), 'meat', 4);
  const rm = createRng(meat.rngState);
  for (let i = 0; i < DECOMP_TICKS; i++) meat = tick(meat, rm);
  const toxPeak = meat.env.toxicity;
  assert.ok(toxPeak > 0.2, `meat raises toxicity: ${toxPeak}`);
  for (let i = 0; i < SPAN; i++) meat = tick(meat, rm);
  const toxDecayedFrac = (toxPeak - meat.env.toxicity) / toxPeak;

  assert.ok(phRecoveredFrac > 0.5, `pH mostly recovered: ${phRecoveredFrac}`);
  assert.ok(toxDecayedFrac < 0.2, `toxicity barely decays: ${toxDecayedFrac}`);
  assert.ok(phRecoveredFrac > toxDecayedFrac, 'pH recovers faster than toxicity decays');
});

// --- sawdust dries the bin ---------------------------------------------------

test('addSawdust reduces moisture deterministically and clamps at zero', () => {
  const base = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  const wet = { ...base, env: { ...base.env, moisture: 0.6 } };

  const a = addSawdust(wet, 3);
  const b = addSawdust(wet, 3);
  assert.equal(a.env.moisture, b.env.moisture, 'same input -> same output (no RNG)');
  assert.ok(a.env.moisture < 0.6, 'moisture reduced');
  assert.equal(a.queue.length, 0, 'sawdust does not enter the food queue');

  const dry = addSawdust({ ...base, env: { ...base.env, moisture: 0.02 } }, 100);
  assert.equal(dry.env.moisture, 0, 'moisture clamps at zero');
});

// --- sawdust also scrubs toxicity -------------------------------------------

test('addSawdust scrubs toxicity deterministically and clamps at zero', () => {
  const base = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  const toxic = { ...base, env: { ...base.env, moisture: 0.6, toxicity: 0.5 } };

  const a = addSawdust(toxic, 3);
  const b = addSawdust(toxic, 3);
  assert.equal(a.env.toxicity, b.env.toxicity, 'same input -> same output (no RNG)');
  assert.ok(a.env.toxicity < 0.5, 'toxicity reduced');
  assert.equal(
    a.env.toxicity,
    0.5 - SAWDUST_TOX_PER_LITER * 3,
    'scrub is exactly the per-liter rate x liters',
  );

  // More sawdust scrubs more — the lever scales with the dose.
  assert.ok(addSawdust(toxic, 6).env.toxicity < a.env.toxicity, 'a bigger dose scrubs more');

  // addSawdust writes env directly, bypassing tick()'s clamps — so it must floor
  // toxicity itself. A negative value would leak straight into the UI gauge,
  // which is drawn on a 0..1 domain.
  const clean = addSawdust({ ...base, env: { ...base.env, toxicity: 0.01 } }, 100);
  assert.equal(clean.env.toxicity, 0, 'toxicity clamps at zero, never negative');
  const spotless = addSawdust(base, 50);
  assert.equal(spotless.env.toxicity, 0, 'sawdust on an already-clean bin is inert, not negative');
});

// --- remediating foods (negative toxicity) -----------------------------------

test('eggshells and coffee grounds pull accumulated toxicity back down', () => {
  // Both carry a negative per-liter toxicity, so they scrub as they decompose.
  // This is emergent from their catalog numbers alone — nothing labels them.
  for (const foodId of ['eggshells', 'coffeeGrounds']) {
    const base = createInitialFarmState({ seed: 1, composterId: 'tier2' });
    const dirty = { ...base, env: { ...base.env, toxicity: 0.5 } };

    const treated = run(addFood(dirty, foodId, 4), DECOMP_TICKS);
    const untreated = run(dirty, DECOMP_TICKS);

    assert.ok(
      treated.env.toxicity < untreated.env.toxicity,
      `${foodId} beats passive decay: ${treated.env.toxicity} vs ${untreated.env.toxicity}`,
    );
    assert.ok(
      untreated.env.toxicity - treated.env.toxicity > 0.05,
      `${foodId} scrubs a clearly visible amount: ${untreated.env.toxicity - treated.env.toxicity}`,
    );
  }
});

test('a remediator is inert in a clean bin — it cannot bank negative headroom', () => {
  // The engine clamps toxicity at 0, so feeding eggshells into a clean bin buys
  // nothing against a future bad feeding. Remediation only pays when there is
  // something to remediate.
  const base = createInitialFarmState({ seed: 1, composterId: 'tier2' });

  const prepped = run(addFood(base, 'eggshells', 8), DECOMP_TICKS);
  assert.equal(prepped.env.toxicity, 0, 'toxicity stays pinned at the clamp, never negative');

  const afterMeat = run(addFood(prepped, 'meat', 4), DECOMP_TICKS);
  const plain = run(addFood(base, 'meat', 4), DECOMP_TICKS);
  assert.ok(
    Math.abs(afterMeat.env.toxicity - plain.env.toxicity) < 1e-9,
    'pre-loading eggshells gives no head start against a later toxic feeding',
  );
});

test('a remediator roughly offsets a toxic feeding at its catalog ratio', () => {
  // meat +0.15/L against eggshells -0.05/L => ~3 L of eggshells per liter of
  // meat. Fed together, the pair should very nearly cancel.
  //
  // Pinned to `tier2`, the bin the environment model is calibrated against
  // (BIN_REFERENCE_CAPACITY, js/sim/engine.js). Since T25 the env variables are
  // CONCENTRATIONS — a food's load is divided by the bin volume — so the absolute
  // magnitude assertion below is only meaningful against a known capacity. It ran
  // on `tier4` before, where a liter of meat now registers at half strength.
  const base = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  const dirty = { ...base, env: { ...base.env, toxicity: 0.3 } };

  let s = addFood(dirty, 'meat', 2);
  s = addFood(s, 'eggshells', 6);
  const together = run(s, DECOMP_TICKS);
  const meatOnly = run(addFood(dirty, 'meat', 2), DECOMP_TICKS);

  assert.ok(meatOnly.env.toxicity > 0.5, `meat alone drives toxicity up: ${meatOnly.env.toxicity}`);
  assert.ok(
    Math.abs(together.env.toxicity - 0.3) < 0.05,
    `the pair roughly cancels near the starting 0.3: ${together.env.toxicity}`,
  );

  // The RATIO is bin-independent even though the magnitudes are not: dilution
  // scales the toxic load and the remediating load by the same factor, so the
  // cancellation has to hold in the largest bin too. This is the property that
  // keeps remediation a usable lever after an upgrade.
  const bigBase = createInitialFarmState({ seed: 1, composterId: 'eco' });
  const bigDirty = { ...bigBase, env: { ...bigBase.env, toxicity: 0.3 } };
  let big = addFood(bigDirty, 'meat', 2);
  big = addFood(big, 'eggshells', 6);
  const bigTogether = run(big, DECOMP_TICKS);
  assert.ok(
    Math.abs(bigTogether.env.toxicity - 0.3) < 0.05,
    `the pair cancels in a large bin as well: ${bigTogether.env.toxicity}`,
  );
});

// --- fermentation heat wired to real fresh mass ------------------------------

test('fresh food heat mass shrinks as entries decompose and reaches zero when fully broken down', () => {
  let s = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  s = addFood(s, 'meat', 5);
  const t = absoluteTick(s);

  const now = queueDynamics(s.queue, t, t).freshHeatMass;
  const later = queueDynamics(s.queue, t, t + 10).freshHeatMass;
  const gone = queueDynamics(s.queue, t, t + DECOMP_TICKS).freshHeatMass;
  assert.ok(now > 0);
  assert.ok(later < now, 'fresh mass shrinks as food decomposes');
  assert.ok(gone <= 1e-9, 'no fresh mass once fully decomposed');

  // meat ferments hotter than the same volume of a cool carbon bedding food
  let cardboard = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  cardboard = addFood(cardboard, 'wetCardboard', 5);
  const cool = queueDynamics(cardboard.queue, t, t).freshHeatMass;
  assert.ok(now > cool, 'meat ferments hotter than wet cardboard');
});

test('fresh food raises bin temperature via fermentation heat wired into tick', () => {
  const base = createInitialFarmState({ seed: 1, composterId: 'tier2', wallPosition: 0 });

  let empty = tick(base, createRng(base.rngState));

  const fed0 = addFood(base, 'meat', 8);
  let fed = tick(fed0, createRng(fed0.rngState));

  assert.ok(fed.env.temperature > empty.env.temperature, 'fresh mass heats the bin');
});

// --- determinism -------------------------------------------------------------

test('the same feeding sequence replays to an identical state (deterministic)', () => {
  function play() {
    let s = createInitialFarmState({ seed: 7, composterId: 'tier4' });
    s = addFood(s, 'citrus', 3);
    s = run(s, 10);
    s = addFood(s, 'meat', 2);
    s = addSawdust(s, 4);
    s = run(s, 10);
    return s;
  }
  assert.deepEqual(play(), play());
  // and the whole state stays JSON-serializable after actions + ticks
  const s = play();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
