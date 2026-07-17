import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  tick,
  addFood,
  addSawdust,
  harvestHumus,
  drainLeachate,
  harvestAndSell,
  drainAndSell,
  buyWormPack,
} from '../js/sim/engine.js';
import { getComposter } from '../js/sim/composters.js';
import { getSpecies, carryingCapacity, HATCH_TICKS, MATURE_TICKS } from '../js/sim/worms.js';
import { createRng } from '../js/sim/rng.js';

// Balance harness (T8): whole-farm scenarios driven through tick() + the engine
// actions, all deterministic per seed. These lock the FEEL of the tuned sim, not
// its exact numbers: a well-tended beginner colony thrives for a season, while
// each of the four §2.8 neglect chains drives itself to a terminal state within a
// bounded number of game days, and a drained pipeline recovers only after the
// realistic cocoon->adult lag.

const total = (p) => p.cocoons + p.juveniles + p.adults;
const queueVolume = (s) => s.queue.reduce((a, e) => a + e.liters, 0);
const isDead = (s) => !s.colonyAlive || total(s.population) === 0;

/** Californiana lethal thresholds (comfort band edge + LETHAL_RATIO x stall span). */
const TEMP_LETHAL = 30 + 2 * 4; // tempComfort.max + LETHAL_RATIO * TEMP_STALL
const MOIST_LETHAL = 0.85 + 2 * 0.06; // moistureComfort.max + LETHAL_RATIO * MOISTURE_STALL

// --- GOOD CARE: a tended beginner colony thrives for a full season ----------

test('GOOD CARE: californiana survives >= 60 game days with net population growth', () => {
  // The natural beginner setup: the cheapest open tray (tier2), the forgiving
  // Vermelha-da-Califórnia, and a lightly-shaded wall position (0.3) that dodges
  // the midday sun patch. The keeper feeds suitable scraps in moderation, dries
  // the bin with sawdust when it climbs, and harvests + drains once a day.
  let s = createInitialFarmState({
    seed: 42,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.3,
  });
  let wallet = 200;
  ({ state: s, wallet } = buyWormPack(s, wallet, 'californiana', 50));
  const startPop = total(s.population);
  assert.equal(startPop, 50, 'starts with a 50-worm pack as adults');

  const rng = createRng(s.rngState);
  const DAYS = 65;
  let maxMoisture = 0;
  let maxTemp = 0;
  for (let d = 0; d < DAYS; d++) {
    for (let h = 0; h < 24; h++) {
      if (h === 8 || h === 18) s = addFood(s, 'vegetableScraps', 0.5); // moderate feeding
      s = tick(s, rng);
      maxMoisture = Math.max(maxMoisture, s.env.moisture);
      maxTemp = Math.max(maxTemp, s.env.temperature);
      if (s.env.moisture > 0.7) s = addSawdust(s, (s.env.moisture - 0.55) / 0.03); // keep it in band
      if (h === 20) {
        ({ state: s, wallet } = harvestAndSell(s, wallet)); // score + coins
        ({ state: s, wallet } = drainAndSell(s, wallet));
      }
    }
    assert.ok(s.colonyAlive, `colony stays alive through good care (day ${s.day})`);
  }

  assert.ok(s.day >= 60, `survives at least 60 game days: reached day ${s.day}`);
  assert.ok(s.colonyAlive, 'colony is still alive at the end of the season');
  const endPop = total(s.population);
  assert.ok(endPop > startPop, `net population GROWTH: ${startPop} -> ${endPop}`);
  assert.ok(endPop > startPop * 2, `growth is substantial, not marginal: ${endPop}`);
  // Good care never let the environment run into lethal territory.
  assert.ok(maxMoisture < MOIST_LETHAL, `moisture stayed sub-lethal: max ${maxMoisture.toFixed(3)}`);
  assert.ok(maxTemp < TEMP_LETHAL, `temperature stayed sub-lethal: max ${maxTemp.toFixed(2)}`);
  // Tending the bin (harvesting humus) earned score — idling would have earned none.
  assert.ok(s.score > 0, `harvesting humus accrued score: ${s.score.toFixed(1)}`);
});

// --- §2.8 neglect chain 1: leachate overflow -> saturation -> mortality ------

test('NEGLECT (leachate): never draining saturates the bedding and kills the colony', () => {
  // Feed a moisture-NEUTRAL food (eggshells) and harvest every tick, so the ONLY
  // thing that can move moisture is leachate backing up out of a never-drained
  // tank. Once the tank overflows it re-saturates the bedding; moisture climbs to
  // saturation and turns lethal.
  const BOUND_DAYS = 45;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let sawSpike = false;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (queueVolume(s) < 20 && h % 3 === 0) s = addFood(s, 'eggshells', 5);
      s = tick(s, rng);
      s = harvestHumus(s).state; // keep the tray clear; NEVER drain the tank
      if (s.env.moisture >= MOIST_LETHAL) sawSpike = true;
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(sawSpike, 'the undrained tank re-saturated the bedding to a lethal moisture level');
  assert.ok(dieDay > 0, `the colony reached a terminal state (day ${dieDay})`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 2: humus overflow -> tray full -> rot -> mortality ---

test('NEGLECT (humus): never harvesting fills the tray, halts processing, and rots the queue toxic', () => {
  // Feed eggshells (zero moisture, zero own-toxicity) and DRAIN each tick, so the
  // moisture/leachate chain cannot confound this: the only lethal factor is the
  // toxicity of the stranded queue rotting anaerobically once the never-harvested
  // tray fills and processing halts.
  const BOUND_DAYS = 35;
  const trayCap = getComposter('tier2').humusCapacity;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let halted = false;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      // Keep the tray fed until it fills with a stranded remainder, then stop.
      if (s.humus < trayCap - 0.5 && queueVolume(s) < 22 && h % 2 === 0) s = addFood(s, 'eggshells', 3);
      s = tick(s, rng);
      s = drainLeachate(s).state; // isolate from the leachate chain; NEVER harvest
      if (s.humus >= trayCap - 1e-6) halted = true;
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(halted, 'the never-harvested tray filled and processing halted');
  assert.ok(s.env.moisture < MOIST_LETHAL, 'moisture stayed sub-lethal — this death is the rot chain, not saturation');
  assert.ok(dieDay > 0, `the colony reached a terminal state (day ${dieDay})`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 3: overfeeding -> fermentation heat -> mortality -----

test('NEGLECT (overfeeding): chronic fresh dumps ferment the bin to a lethal temperature', () => {
  // Worst case per §2.8: a poorly-insulated open tray (tier2) in the sun patch
  // (wallPosition 0.5). Sustained daytime dumps of fresh food keep the hot,
  // still-fermenting mass topped up; harvest + drain each tick so the tray/tank
  // never confound the HEAT mechanism. coffeeGrounds are used (low moisture) so
  // fermentation heat, not saturation, is the first factor to turn lethal.
  const BOUND_DAYS = 20;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.5,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let maxTemp = 0;
  let tempLethalDay = -1;
  let moistLethalDay = -1;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (h >= 8 && h <= 16) s = addFood(s, 'coffeeGrounds', 8); // overfeed all daytime
      s = tick(s, rng);
      s = harvestHumus(s).state;
      s = drainLeachate(s).state;
      maxTemp = Math.max(maxTemp, s.env.temperature);
      if (tempLethalDay < 0 && s.env.temperature >= TEMP_LETHAL) tempLethalDay = s.day;
      if (moistLethalDay < 0 && s.env.moisture >= MOIST_LETHAL) moistLethalDay = s.day;
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(maxTemp >= TEMP_LETHAL, `fermentation heat drove the bin to a lethal temperature: max ${maxTemp.toFixed(2)}`);
  assert.ok(tempLethalDay > 0, 'temperature crossed the lethal threshold');
  assert.ok(
    moistLethalDay < 0 || tempLethalDay <= moistLethalDay,
    `heat turned lethal no later than moisture (temp@${tempLethalDay} vs moist@${moistLethalDay})`,
  );
  assert.ok(dieDay > 0, `the colony reached a terminal state (day ${dieDay})`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 4: only-unsuitable food -> toxicity -> mortality -----

test('NEGLECT (only unsuitable food): feeding only toxic foods poisons the colony', () => {
  // Feed nothing but the unsuitable foods (meat/dairy/oil/salt). They release
  // toxicity as they decompose faster than it decays; harvest + drain each tick so
  // neither overflow chain confounds this — toxicity alone stalls reproduction and
  // then kills. (The foods carry no label; only their emergent effect is toxic.)
  const BOUND_DAYS = 20;
  const toxicFoods = ['meat', 'dairy', 'oilyFood', 'saltyLeftovers'];
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let maxTox = 0;
  let i = 0;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (queueVolume(s) < 6 && h % 4 === 0) {
        s = addFood(s, toxicFoods[i % toxicFoods.length], 2);
        i += 1;
      }
      s = tick(s, rng);
      s = harvestHumus(s).state;
      s = drainLeachate(s).state;
      maxTox = Math.max(maxTox, s.env.toxicity);
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(maxTox > 0.4, `toxicity climbed into lethal territory: max ${maxTox.toFixed(3)}`);
  assert.ok(dieDay > 0, `the colony reached a terminal state (day ${dieDay})`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- stall-then-recovery: recovery lags by the cocoon->adult pipeline delay --

test('RECOVERY LAG: a drained pipeline refills only after the hatch + maturation delay', () => {
  // Grow a full cohort pipeline, stall laying by letting the bin dry into the
  // stall band (no mortality), then fix it and watch adults recover. Because a
  // freshly-laid cocoon must hatch (HATCH_TICKS) AND then mature (MATURE_TICKS)
  // before it counts as an adult, adult recovery in the first hatch window is only
  // a small fraction of the recovery over the full pipeline delay — it is NOT
  // instant. Moisture is held at a fixed level each tick to isolate the population
  // pipeline from weather noise; every cohort flow still runs through tick(). A
  // roomy tier4 (carrying capacity 3000) keeps crowding from limiting recovery.
  const species = getSpecies('californiana');
  const cap = carryingCapacity(getComposter('tier4'));
  let s = createInitialFarmState({
    seed: 3,
    composterId: 'tier4',
    speciesId: 'californiana',
    wallPosition: 0,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 50));
  const rng = createRng(s.rngState);

  const hold = (st, moisture) => ({ ...st, env: { ...st.env, moisture } });
  const COMFORT = 0.6; // inside the moisture band
  const STALL = 0.3; // ~0.1 below the band: stress ~1.67 -> laying stalled, no dying

  // 1) Grow a full pipeline: cocoons, juveniles, and adults all present.
  for (let i = 0; i < 180; i++) { s = hold(s, COMFORT); s = tick(s, rng); }
  const grown = s.population;
  assert.ok(grown.cocoons > 0 && grown.juveniles > 0 && grown.adults > 0, 'a full pipeline grew');
  assert.ok(total(grown) < cap, 'colony stays well under carrying capacity (crowding is not the limiter)');

  // 2) Stall laying long enough to drain the pipeline into the adult stage.
  for (let i = 0; i < 260; i++) { s = hold(s, STALL); s = tick(s, rng); }
  assert.ok(s.population.cocoons <= 3 && s.population.juveniles <= 12, `pipeline drained: c=${s.population.cocoons} j=${s.population.juveniles}`);
  const adultsAtRestore = s.population.adults;
  const stalled = s;

  // 3) Fix conditions and measure adult recovery at several horizons. Each measure
  // branches from the same stalled state with its own RNG (deterministic).
  const recover = (ticks) => {
    let t = stalled;
    const r = createRng(stalled.rngState);
    for (let i = 0; i < ticks; i++) { t = hold(t, COMFORT); t = tick(t, r); }
    return t;
  };

  // Laying resumes right away once conditions are good.
  assert.ok(recover(10).population.cocoons > 0, 'laying resumes within a few ticks of the fix');

  const earlyGain = recover(HATCH_TICKS).population.adults - adultsAtRestore;
  const midGain = recover(HATCH_TICKS + MATURE_TICKS).population.adults - adultsAtRestore;

  // Recovery is real by the pipeline delay, but throttled in the first hatch window
  // (mirrors the unit-level lag in population.test.js, now end-to-end through tick).
  assert.ok(midGain > 20, `adults meaningfully recover after the pipeline refills: +${midGain}`);
  assert.ok(
    earlyGain < midGain * 0.34,
    `early recovery is throttled by the hatch+mature delay: +${earlyGain} vs +${midGain} over the full delay`,
  );
});
