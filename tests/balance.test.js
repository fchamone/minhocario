import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  hotSideFromSeed,
  hotSideOf,
  tick,
  addFood,
  addSawdust,
  harvestHumus,
  drainLeachate,
  harvestAndSell,
  drainAndSell,
  buyWormPack,
  SAWDUST_DRY_PER_LITER,
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
const MOIST_DRY_LETHAL = 0.4 - 2 * 0.06; // moistureComfort.min - LETHAL_RATIO * MOISTURE_STALL

// --- GOOD CARE: a tended beginner colony thrives for a full season ----------

test('GOOD CARE: californiana survives >= 60 game days with net population growth', () => {
  // The natural beginner setup: the cheapest open tray (tier2), the forgiving
  // Vermelha-da-Califórnia, and a lightly-shaded wall position (0.3) that dodges
  // the midday sun patch. The keeper keeps food in the bin, dries it with sawdust
  // when moisture climbs, and harvests + drains once a day.
  //
  // Feeding is RESPONSIVE (top the queue up when it runs low), not a flat ration:
  // a real keeper feeds a growing colony more, and a fixed 1 L/day was actually
  // modelling slow starvation — at CP3 it let the colony breed to 2700 worms on
  // food for ~100, then crash to a single survivor. The old end-state assertion
  // (`endPop > startPop * 2`) passed anyway by catching the rebound tail, so the
  // run is now checked at EVERY step: `minPop` below asserts the colony never
  // dips beneath where it started. That floor is the real claim of this test —
  // "survives and grows" must mean the whole season, not just its last day.
  let s = createInitialFarmState({
    seed: 42,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.3,
    // Orientation PINNED rather than left to the seed's coin flip. `hotSide`
    // decides which end of the wall is warm, so without this a scenario's whole
    // thermal character would flip silently if its seed ever changed. 0 = the
    // warm end is position 0, which puts 0.3 on the WARM half (+1.2 °C): this
    // season is a real thermal test, not a stroll in the cold corner.
    hotSide: 0,
  });
  let wallet = 200;
  ({ state: s, wallet } = buyWormPack(s, wallet, 'californiana', 50));
  const startPop = total(s.population);
  assert.equal(startPop, 50, 'starts with a 50-worm pack as adults');

  const rng = createRng(s.rngState);
  const DAYS = 65;
  const binCapacity = getComposter('tier2').capacity;
  let maxMoisture = 0;
  let minMoisture = 1;
  let maxTemp = 0;
  let minPop = startPop;
  for (let d = 0; d < DAYS; d++) {
    for (let h = 0; h < 24; h++) {
      // Top up twice a day toward a quarter-full bin — enough standing food to
      // keep the colony fed as it grows, well short of an overfeeding dump.
      if ((h === 8 || h === 18) && queueVolume(s) < binCapacity * 0.25) {
        s = addFood(s, 'vegetableScraps', 1.5);
      }
      s = tick(s, rng);
      maxMoisture = Math.max(maxMoisture, s.env.moisture);
      minMoisture = Math.min(minMoisture, s.env.moisture);
      maxTemp = Math.max(maxTemp, s.env.temperature);
      minPop = Math.min(minPop, total(s.population));
      // Dose sawdust to land moisture back on 0.55. Solved against the real
      // constant, never a re-inlined copy of it — otherwise retuning the sawdust
      // strength silently changes the moisture this scenario actually holds, and
      // the population/score bounds below would be measuring a different farm.
      if (s.env.moisture > 0.7) {
        s = addSawdust(s, (s.env.moisture - 0.55) / SAWDUST_DRY_PER_LITER); // keep it in band
      }
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
  // Lock: the tuned constants settle this run at a food-supported size, not a
  // marginal survival and not a runaway boom. The window brackets the measured
  // 2034 so any constant edit that materially shifts the carrying/breeding balance
  // (either starving it down or letting it explode) trips this test.
  //
  // Re-measured from 1463 to 2034 when THROUGHPUT_CAP_PER_LITER was tuned to
  // 0.014. That is not slack — it is the cap's second-order effect, and it is the
  // reason the assertion below it exists. `ration` is queue / demand, and the cap
  // lowers DEMAND, so the same standing queue reads as a fuller larder and the
  // hunger brake on laying releases: a slower-eating colony breeds to a LARGER
  // equilibrium, not a smaller one.
  assert.ok(
    endPop > 1750 && endPop < 2250,
    `settles at a food-supported size (measured ~2034): ${endPop}`,
  );
  // ...and it must still be FOOD that is doing the limiting. Past roughly
  // active/carryingCapacity = 1.5 (worms.js OVERPOP_STALL) crowding alone stalls
  // laying, at which point the hunger brake is inert and the colony would pin to
  // the same ceiling no matter how it were fed — undoing the CP3 boom-bust fix
  // this scenario exists to defend. Measured 1.31. A lower throughput cap walks
  // straight into that wall (0.012 measured 1.53), so this is the assertion that
  // actually bounds how far the cap may be turned down.
  const endActive = s.population.juveniles + s.population.adults;
  const crowding = endActive / carryingCapacity(getComposter('tier2'));
  assert.ok(
    crowding < 1.5,
    `the equilibrium is food-limited, not crowding-pinned (measured 1.31): ${crowding.toFixed(2)}`,
  );
  // The colony never crashed on the way: no boom-bust hidden by the end state.
  assert.ok(
    minPop >= startPop,
    `population never dipped below its starting size: min ${minPop} vs start ${startPop}`,
  );
  // Good care never let the environment run into lethal territory. T21 tightens
  // these from the bare lethal thresholds to the actual tuned envelope so the
  // well-tended run's comfort margin is itself locked — a hotter sun patch or
  // wetter food shows up here long before it turns lethal.
  //
  // maxTemp re-measured at 32.96 when the wall gradient landed (was 31.76): this
  // season sits at position 0.3 on the WARM half, so it now carries +1.2 °C of
  // placement all day. The bound moved 33 -> 34 to restore a real margin — at 33
  // it was passing by 0.04 °C, which is a tripwire, not a guard. The claim it
  // makes is unchanged and is the point of the test: good care stays FAR from
  // the 38 °C lethal line even on the warm side of the garage.
  assert.ok(maxMoisture < MOIST_LETHAL, `moisture stayed sub-lethal: max ${maxMoisture.toFixed(3)}`);
  assert.ok(maxMoisture < 0.75, `good care held moisture in band (measured 0.710): max ${maxMoisture.toFixed(3)}`);
  assert.ok(maxTemp < TEMP_LETHAL, `temperature stayed sub-lethal: max ${maxTemp.toFixed(2)}`);
  assert.ok(maxTemp < 34, `good care held temperature well below lethal (measured 32.96): max ${maxTemp.toFixed(2)}`);
  assert.ok(minMoisture > MOIST_DRY_LETHAL, `bedding never dried into lethal territory: min ${minMoisture.toFixed(3)}`);
  assert.ok(minMoisture > 0.45, `bedding stayed comfortably moist (measured 0.500): min ${minMoisture.toFixed(3)}`);
  // Tending the bin (harvesting humus) earned score — idling would have earned
  // none. T21 puts a real floor on it (measured 1962.8) so a scoring/economy
  // regression that quietly zeroes the season's yield is caught here too.
  assert.ok(s.score > 0, `harvesting humus accrued score: ${s.score.toFixed(1)}`);
  assert.ok(s.score > 1500, `a tended season banks substantial score (measured ~1963): ${s.score.toFixed(1)}`);
});

// --- §2.8 neglect chain 1: leachate overflow -> saturation -> mortality ------

test('NEGLECT (leachate): never draining saturates the bedding and kills the colony', () => {
  // Ordinary use of the bin — modest portions of a normal, non-toxic wet food,
  // topped up as they are worked through — with the ONE act of neglect being that
  // the tap is never opened. The tank fills, percolation has nowhere to drain to,
  // and the bedding saturates to a lethal moisture level. Harvest every tick and
  // keep the wall shaded so neither the humus/rot chain nor fermentation heat
  // confounds it — saturation is the only lethal factor (asserted: temperature
  // and toxicity both stay sub-lethal throughout).
  //
  // The portions are deliberately SMALL and continuous rather than large dumps: a
  // bin stuffed to capacity in a few sittings ends up holding mostly inert,
  // fully-decomposed matter that releases no more water, so the bedding dries
  // back into the survivable band and a remnant colony rides out the flood
  // forever. Steady feeding keeps genuinely fresh food in the bin, which is both
  // what a real keeper does and what keeps the chain terminal.
  // T21 lock: measured terminal day is 13. BOUND_DAYS tightened 30 -> 16 and a
  // lower bound added below, so the chain is pinned to a ~10-16 day window — fast
  // enough to reach at 20x in one session, but still a genuine slow-neglect death
  // (not an instant one). ~39 s of wall-clock at 20x.
  const BOUND_DAYS = 16;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
    hotSide: 0, // pinned: warm end is position 0, so 0.2 sits on the warm half (+1.8 °C)
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let sawSpike = false;
  let maxTemp = 0;
  let maxTox = 0;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (queueVolume(s) < 6 && h % 2 === 0) s = addFood(s, 'vegetableScraps', 1);
      s = tick(s, rng);
      s = harvestHumus(s).state; // keep the tray clear; NEVER drain the tank
      if (s.env.moisture >= MOIST_LETHAL) sawSpike = true;
      maxTemp = Math.max(maxTemp, s.env.temperature);
      maxTox = Math.max(maxTox, s.env.toxicity);
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(sawSpike, 'the never-drained bin saturated the bedding to a lethal moisture level');
  assert.ok(maxTemp < TEMP_LETHAL, `heat stayed sub-lethal — this death is saturation, not fermentation: max ${maxTemp.toFixed(2)}`);
  assert.ok(maxTox < 0.1, `toxicity stayed sub-lethal — vegetable scraps are non-toxic: max ${maxTox.toFixed(3)}`);
  assert.ok(dieDay >= 10, `not an instant death — saturation builds over days (measured 13): died day ${dieDay}`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 2: humus overflow -> tray full -> rot -> mortality ---

test('NEGLECT (humus): never harvesting fills the tray, halts processing, and rots the queue toxic', () => {
  // Feed a normal, non-toxic food and DRAIN each tick. Draining keeps room in the
  // tank, so percolation holds the bedding at field capacity — moisture sits
  // steady in the comfort band (asserted below at BOTH edges) and neither
  // moisture chain can confound this. The only lethal factor left is the toxicity
  // of the stranded queue rotting anaerobically once the never-harvested tray
  // fills and processing halts. (This used to feed zero-moisture eggshells to
  // isolate the tank; with nothing replenishing the bedding that bin now just
  // dries out and dies of the §2.8 drying chain before the tray ever fills — so
  // the faithful isolation is a moist food plus a drained tank.)
  // T21 lock: measured terminal day is 16. BOUND_DAYS tightened 35 -> 22 with a
  // lower bound below, pinning the rot chain to a ~12-22 day window (~48 s at 20x).
  const BOUND_DAYS = 22;
  const trayCap = getComposter('tier2').humusCapacity;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
    hotSide: 0, // pinned: warm end is position 0, so 0.2 sits on the warm half (+1.8 °C)
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let halted = false;
  let minMoisture = 1;
  let maxMoisture = 0;
  let maxTox = 0;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      // Keep the tray fed until it fills with a stranded remainder, then stop.
      if (s.humus < trayCap - 0.5 && queueVolume(s) < 22 && h % 2 === 0) s = addFood(s, 'vegetableScraps', 3);
      s = tick(s, rng);
      s = drainLeachate(s).state; // isolate from the leachate chain; NEVER harvest
      if (s.humus >= trayCap - 1e-6) halted = true;
      minMoisture = Math.min(minMoisture, s.env.moisture);
      maxMoisture = Math.max(maxMoisture, s.env.moisture);
      maxTox = Math.max(maxTox, s.env.toxicity);
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(halted, 'the never-harvested tray filled and processing halted');
  assert.ok(maxTox > 0.4, `stranded queue rotted toxic: max ${maxTox.toFixed(3)}`);
  // Moisture stayed inside the band at BOTH edges: neither saturation nor drying
  // contributed — this death is the rot chain alone.
  assert.ok(maxMoisture < MOIST_LETHAL, `moisture stayed sub-lethal wet: max ${maxMoisture.toFixed(3)}`);
  assert.ok(minMoisture > MOIST_DRY_LETHAL, `moisture stayed sub-lethal dry: min ${minMoisture.toFixed(3)}`);
  assert.ok(dieDay >= 12, `the tray must fill and the queue rot first — not instant (measured 16): died day ${dieDay}`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 3: overfeeding -> fermentation heat -> mortality -----

test('NEGLECT (overfeeding): chronic fresh dumps ferment the bin to a lethal temperature', () => {
  // Chronic overfeeding of a LARGE bin (eco) in the sun patch (wallPosition 0.5).
  // Sustained daytime dumps keep a big, still-fermenting fresh mass, and a bin
  // this size holds that fermentation heat through the cold night, so the
  // temperature stays lethal rather than cooling off and letting a heat-hardened
  // remnant survive (a small open tray cools overnight and never fully dies).
  // Harvest + drain each tick so the tray/tank chains don't do the killing;
  // fermentation heat reaches the lethal threshold first.
  // T21 lock: measured terminal day is 3 (a big sunny bin crammed daily cooks
  // almost at once). BOUND_DAYS tightened 15 -> 8 with a lower bound below.
  const BOUND_DAYS = 8;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'eco',
    speciesId: 'californiana',
    wallPosition: 0.5,
    // Mid-wall: the gradient contributes nothing here, so this chain stays a
    // pure test of fermentation heat. Pinned so it stays that way by intent.
    hotSide: 0,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let maxTemp = 0;
  let tempLethalDay = -1;
  let moistLethalDay = -1;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      if (h >= 8 && h <= 16) s = addFood(s, 'coffeeGrounds', 15); // overfeed all daytime
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
  assert.ok(dieDay >= 2, `fermentation still takes a day to build (measured 3): died day ${dieDay}`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 4: only-unsuitable food -> toxicity -> mortality -----

test('NEGLECT (only unsuitable food): feeding only toxic foods poisons the colony', () => {
  // Feed nothing but the unsuitable foods (meat/dairy/oil/salt). They release
  // toxicity as they decompose faster than it decays; harvest + drain each tick so
  // neither overflow chain confounds this — toxicity alone stalls reproduction and
  // then kills. (The foods carry no label; only their emergent effect is toxic.)
  // T21 lock: measured terminal day is 5. BOUND_DAYS tightened 20 -> 10 with a
  // lower bound below, so toxicity has to accumulate over several days first.
  const BOUND_DAYS = 10;
  const toxicFoods = ['meat', 'dairy', 'oilyFood', 'saltyLeftovers'];
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.2,
    hotSide: 0, // pinned: warm end is position 0, so 0.2 sits on the warm half (+1.8 °C)
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
  assert.ok(dieDay >= 3, `toxicity accumulates over several days first (measured 5): died day ${dieDay}`);
  assert.ok(dieDay <= BOUND_DAYS, `terminal within the bound of ${BOUND_DAYS} days: died day ${dieDay}`);
  assert.equal(s.colonyAlive, false, 'colonyAlive flipped to false');
  assert.equal(total(s.population), 0, 'population reached zero');
});

// --- §2.8 neglect chain 5: no feeding + heat -> bedding dries out -> mortality ---

test('NEGLECT (drying): a hot, unfed bin evaporates the bedding to a lethal dryness', () => {
  // The mirror image of the leachate chain: never add food OR sawdust, and leave
  // the bin baking in the sun patch (wallPosition 0.5). With no food moisture to
  // replenish it, passive evaporation — which climbs with temperature — draws the
  // bedding down past the DRY edge of the comfort band until dryness turns lethal.
  // Harvest + drain each tick so nothing else can confound it; heat stays
  // sub-lethal, so dryness (not overheating) is what kills.
  // T21 lock: measured terminal day is 11. BOUND_DAYS tightened 30 -> 16 with a
  // lower bound below — the sun-baked bin has to evaporate down over ~a week first.
  const BOUND_DAYS = 16;
  let s = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.5,
    // Mid-wall is the gradient's neutral point, so this chain is unaffected by
    // the orientation either way — pinned only so that stays true by intent.
    hotSide: 0,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  const rng = createRng(s.rngState);

  let dieDay = -1;
  let minMoisture = 1;
  let maxTemp = 0;
  for (let d = 0; d < BOUND_DAYS && dieDay < 0; d++) {
    for (let h = 0; h < 24; h++) {
      s = tick(s, rng); // never feed, never add sawdust
      s = harvestHumus(s).state;
      s = drainLeachate(s).state;
      minMoisture = Math.min(minMoisture, s.env.moisture);
      maxTemp = Math.max(maxTemp, s.env.temperature);
    }
    if (isDead(s)) dieDay = s.day;
  }

  assert.ok(minMoisture < MOIST_DRY_LETHAL, `the bedding dried past the lethal-dry edge: min ${minMoisture.toFixed(3)}`);
  assert.ok(maxTemp < TEMP_LETHAL, `heat stayed sub-lethal — this death is dryness, not overheating: max ${maxTemp.toFixed(2)}`);
  assert.ok(dieDay >= 8, `evaporation draws the bedding down over ~a week first (measured 11): died day ${dieDay}`);
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

  // Moisture AND temperature are pinned each tick so weather (and the
  // fermentation heat of the standing larder below) cannot perturb the pipeline
  // measurement; the larder keeps the colony fed so that HUNGER is never the
  // limiter either — this test isolates the cocoon->adult delay, and every other
  // brake on laying has to be held flat for that reading to mean anything.
  const hold = (st, moisture) => ({
    ...st,
    env: { ...st.env, moisture, temperature: 22 },
  });
  const feed = (st) => (queueVolume(st) < 8 ? addFood(st, 'vegetableScraps', 4) : st);
  const step = (st, moisture, r) => tick(hold(feed(st), moisture), r);
  const COMFORT = 0.6; // inside the moisture band
  const STALL = 0.3; // ~0.1 below the band: stress ~1.67 -> laying stalled, no dying

  // 1) Grow a full pipeline: cocoons, juveniles, and adults all present.
  for (let i = 0; i < 180; i++) { s = step(s, COMFORT, rng); }
  const grown = s.population;
  assert.ok(grown.cocoons > 0 && grown.juveniles > 0 && grown.adults > 0, 'a full pipeline grew');
  assert.ok(total(grown) < cap, 'colony stays well under carrying capacity (crowding is not the limiter)');

  // 2) Stall laying long enough to drain the pipeline into the adult stage.
  for (let i = 0; i < 260; i++) { s = step(s, STALL, rng); }
  assert.ok(s.population.cocoons <= 3 && s.population.juveniles <= 12, `pipeline drained: c=${s.population.cocoons} j=${s.population.juveniles}`);
  const adultsAtRestore = s.population.adults;
  const stalled = s;

  // 3) Fix conditions and measure adult recovery at several horizons. Each measure
  // branches from the same stalled state with its own RNG (deterministic).
  const recover = (ticks) => {
    let t = stalled;
    const r = createRng(stalled.rngState);
    for (let i = 0; i < ticks; i++) { t = step(t, COMFORT, r); }
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

// --- Placement decides HOW overfeeding kills (retuned after CP6) -------------
// Same mistake, two failure signatures. Before the retune the sun was too weak
// to matter and a crammed bin ALWAYS drowned, which contradicted §2.8's stated
// overfeeding chain. Now: in the sun the bin cooks first, in the shade it
// saturates first. This is the executable form of that design decision.

/**
 * Cram a tier2 bin daily at a wall position; report which threshold fires first.
 * `hotSide: 1` throughout, so position 0 is the COLD end — the scenarios below
 * call it "the shade" and it must actually be cold, not merely sunless. (Left to
 * the seed, seed 5 rolls a warm position 0 and the shade case would quietly be
 * the WARMEST placement on the wall while still being named shade.)
 */
function overfeedAt(wallPosition) {
  let s = createInitialFarmState({
    seed: 5,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition,
    hotSide: 1,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 50));
  const rng = createRng(s.rngState);
  let maxTemp = 0;
  let tempLethalDay = -1;
  let moistLethalDay = -1;
  let dieDay = -1;
  for (let d = 0; d < 25 && dieDay < 0; d++) {
    for (let i = 0; i < 12; i++) s = addFood(s, 'vegetableScraps', 4); // cram it
    for (let h = 0; h < 24; h++) {
      s = tick(s, rng);
      maxTemp = Math.max(maxTemp, s.env.temperature);
      if (tempLethalDay < 0 && s.env.temperature >= TEMP_LETHAL) tempLethalDay = s.day;
      if (moistLethalDay < 0 && s.env.moisture >= MOIST_LETHAL) moistLethalDay = s.day;
    }
    if (isDead(s)) dieDay = s.day;
  }
  return { maxTemp, tempLethalDay, moistLethalDay, dieDay };
}

test('OVERFEEDING in the sun cooks the bin before it drowns', () => {
  const sun = overfeedAt(0.5);
  assert.ok(sun.tempLethalDay > 0, `heat turned lethal (max ${sun.maxTemp.toFixed(1)} °C)`);
  assert.ok(
    sun.moistLethalDay < 0 || sun.tempLethalDay <= sun.moistLethalDay,
    `heat first in the sun (temp@${sun.tempLethalDay} vs moist@${sun.moistLethalDay})`,
  );
  assert.ok(sun.dieDay > 0, 'the colony reached a terminal state');
});

test('OVERFEEDING in the shade drowns the bin without ever cooking it', () => {
  const shade = overfeedAt(0);
  assert.ok(shade.moistLethalDay > 0, 'saturation turned lethal');
  assert.equal(shade.tempLethalDay, -1, `never overheats in the shade (max ${shade.maxTemp.toFixed(1)} °C)`);
  assert.ok(shade.maxTemp < TEMP_LETHAL, 'peak stays below the lethal temperature');
  assert.ok(shade.dieDay > 0, 'the colony reached a terminal state');
});

test('the same mistake produces DIFFERENT failure signatures by placement', () => {
  // The point of the mechanic: where you put the bin changes how it fails.
  const sun = overfeedAt(0.5);
  const shade = overfeedAt(0);
  assert.ok(sun.maxTemp > shade.maxTemp + 5, 'the sunny bin runs markedly hotter');
});

// --- The wall has a warm end and a cold end ---------------------------------
// The sun patch sweeps and is symmetric about mid-wall, so before the gradient
// the two ENDS were thermally identical by construction and placement was a
// one-dimensional "in the sun or not". `positionBias` gives the room the axis it
// actually has. These lock the mechanic as a real, felt difference rather than a
// decorative one — the failure mode this replaces was a lever so small it sat
// inside the noise (see the SOLAR_MAX note in js/sim/temperature.js).

/** Mean/min/max bin temperature for an UNFED bin left at a wall position. */
function bareBinTemps(wallPosition, hotSide) {
  let s = createInitialFarmState({
    seed: 5,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition,
    hotSide,
  });
  const rng = createRng(s.rngState);
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < 12; d++) {
    for (let h = 0; h < 24; h++) {
      s = tick(s, rng);
      // Skip the warm-up from the 20 °C initial state; sample settled days only.
      if (d >= 4) {
        sum += s.env.temperature;
        n += 1;
        min = Math.min(min, s.env.temperature);
        max = Math.max(max, s.env.temperature);
      }
    }
  }
  return { mean: sum / n, min, max };
}

test('the warm end runs markedly warmer than the cold end, all day and all night', () => {
  const warm = bareBinTemps(1, 1);
  const cold = bareBinTemps(0, 1);

  // No food, so this is placement alone — fermentation heat cannot be credited
  // for any of the difference.
  const spread = warm.mean - cold.mean;
  assert.ok(
    spread >= 4,
    `placement moves the daily mean by a felt amount: ${spread.toFixed(2)} °C`,
  );
  // Unlike the sun, the gradient does not clock off at dusk — this is the half of
  // the mechanic solarGain structurally cannot provide.
  assert.ok(
    warm.min > cold.min + 3,
    `the warm end is still warmer at its NIGHT trough: ${warm.min.toFixed(1)} vs ${cold.min.toFixed(1)}`,
  );
});

test('which end is warm is a per-farm roll, and mirrors exactly when it flips', () => {
  // Same position, opposite orientation: the effect must reverse cleanly, or the
  // "learn your garage" premise breaks (a player who identifies the warm corner
  // must be able to trust it for the rest of the run).
  const endIsWarm = bareBinTemps(1, 1).mean;
  const endIsCold = bareBinTemps(1, 0).mean;
  assert.ok(
    endIsWarm > endIsCold + 4,
    `orientation flips the same spot from warm to cold: ${endIsWarm.toFixed(1)} vs ${endIsCold.toFixed(1)}`,
  );
  // Mid-wall is the pivot: neutral under either orientation.
  const midA = bareBinTemps(0.5, 1).mean;
  const midB = bareBinTemps(0.5, 0).mean;
  assert.ok(Math.abs(midA - midB) < 1e-9, 'mid-wall is orientation-independent');
});

test('a save written before the gradient existed gets a STABLE garage', () => {
  // Legacy saves carry no `hotSide`. They must resolve to one fixed orientation
  // for the rest of the run — an orientation that drifted would swing the bin's
  // target by up to 2 x POSITION_BIAS_MAX with no cause the player could see.
  //
  // The trap this guards: `rngState` is the obvious thing to derive a fallback
  // from, and it is WRONG, because `tick` writes the advanced RNG state back on
  // every tick that draws. Anchoring to the immutable `createdAt` is what makes
  // this hold. Asserted against a mutating rngState so the unsound version fails.
  let s = createInitialFarmState({
    seed: 42,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 1,
    createdAt: 1234,
  });
  ({ state: s } = buyWormPack(s, 1000, 'californiana', 200));
  delete s.hotSide; // as an old save would deserialize

  const first = hotSideOf(s);
  const rng = createRng(s.rngState);
  for (let i = 0; i < 300; i++) {
    s = tick(s, rng);
    delete s.hotSide; // the field never appears in a legacy farm
    assert.equal(hotSideOf(s), first, `orientation drifted at tick ${i}`);
  }
  // Same farm, RNG state deliberately mangled: still the same garage.
  assert.equal(hotSideOf({ ...s, rngState: 999999 }), first);
});

test('a fresh farm rolls its warm end from the seed and keeps it', () => {
  // Deterministic per seed (so a save reloads into the same garage)...
  assert.equal(hotSideFromSeed(42), hotSideFromSeed(42));
  const farm = createInitialFarmState({ seed: 42, composterId: 'tier2' });
  assert.equal(farm.hotSide, hotSideFromSeed(42));
  assert.ok(farm.hotSide === 0 || farm.hotSide === 1);

  // ...but not the same for every seed, or every garage would be identical.
  const sides = new Set();
  for (let seed = 0; seed < 64; seed++) sides.add(hotSideFromSeed(seed));
  assert.equal(sides.size, 2, 'both orientations occur across seeds');
});

// --- T21-3: the electric composter is priced as a specialist, not a trap ------
// At 350 (through CP6) the electric bin was a trap: flagship price, yet out-earned
// on raw coins/day by cheaper, larger bins (capacity gates the colony and its
// humusRate is already at the conservation bound, so it cannot close that gap on
// output). T21 cut it to 200 — a modest premium over tier3 that reads as "the
// cheapest efficient regulated bin" and a sensible first upgrade from tier2. This
// locks that decision: reverting toward the old flagship price (> tier4) fails.
// Rationale + measurements: tasks/t21-balance.md.

test('electric is priced as a mid-tier specialist premium, not a flagship trap', () => {
  const electric = getComposter('electric').price;
  const tier2 = getComposter('tier2').price;
  const tier3 = getComposter('tier3').price;
  const tier4 = getComposter('tier4').price;
  const eco = getComposter('eco').price;
  assert.ok(electric > tier2, `costs more than the entry bin it upgrades from: ${electric} > ${tier2}`);
  assert.ok(electric > tier3, `a premium over tier3 for its efficiency + regulation: ${electric} > ${tier3}`);
  assert.ok(
    electric <= tier4,
    `NOT priced as a flagship — must not exceed the tier4 output bin (this fails at the old 350): ${electric} <= ${tier4}`,
  );
  assert.ok(electric < eco, `still below the largest bin: ${electric} < ${eco}`);
});

// --- T21-4: no wall position rescues Gigante-Africana; only electric can ------
// Spec §2.9 says the Gigante-Africana "pairs with the sun spot or the electric
// composter". The sun-spot half is a spec erratum (documented in
// tasks/t21-balance.md, spec left untouched per the task): africana's binding
// constraint is the COLD NIGHT (comfort floor 20 °C), and solarGain is 0 at night
// by construction (§2.6), so no wall position lifts the night trough by sunlight.
// Only the actively-heated electric bin holds the night in band. (Lowering
// passive tempResponse to carry daytime heat overnight was rejected: it needs
// tempResponse ~0.05, which also caps the midday peak at ~24 °C and would break
// the overfeeding-in-the-sun and placement-signature chains above — see
// tasks/t21-balance.md.)
//
// REVISED when the hot-end/cold-end gradient landed. `positionBias` DOES apply at
// night — unlike the sun, it is a property of the room, not of daylight — so the
// old form of this test ("the night trough barely moves with placement") is no
// longer true and has been replaced. The finding it protected is unchanged and is
// now asserted more directly: the warm end lifts the night trough but NOT far
// enough to reach africana's floor, so buying regulation remains the only real
// answer. That gap is the true ceiling on POSITION_BIAS_MAX — if a future retune
// ever let the warm corner clear 20 °C at night, it would quietly delete the
// electric composter's reason to exist, and this test is what catches it.

/** Min night-time bin temperature for a tended africana colony over days 5-20. */
function africanaNightTrough(composterId, wallPosition, hotSide = 1) {
  const cap = getComposter(composterId).capacity;
  let s = createInitialFarmState({
    seed: 11,
    composterId,
    speciesId: 'africana',
    wallPosition,
    hotSide,
  });
  let wallet = 1e6;
  ({ state: s, wallet } = buyWormPack(s, wallet, 'africana', 200));
  const rng = createRng(s.rngState);
  let minNight = Infinity;
  for (let d = 0; d < 20; d++) {
    for (let h = 0; h < 24; h++) {
      if ((h === 8 || h === 18) && queueVolume(s) < cap * 0.25) s = addFood(s, 'vegetableScraps', cap * 0.06);
      s = tick(s, rng);
      if (s.env.moisture > 0.7) s = addSawdust(s, (s.env.moisture - 0.55) / SAWDUST_DRY_PER_LITER);
      if (h === 20) {
        ({ state: s, wallet } = harvestAndSell(s, wallet));
        ({ state: s, wallet } = drainAndSell(s, wallet));
      }
      // Skip the warm-up from the 20 °C initial state; sample settled nights only.
      if (d >= 5 && (h < 6 || h >= 20)) minNight = Math.min(minNight, s.env.temperature);
    }
  }
  return minNight;
}

test('no wall position rescues africana from cold nights — only the electric bin can', () => {
  const floor = getSpecies('africana').tempComfort.min; // 20 °C
  // hotSide 1 ⇒ position 1 is the warm end, position 0 the cold one.
  const warmEnd = africanaNightTrough('tier2', 1.0, 1);
  const coldEnd = africanaNightTrough('tier2', 0.0, 1);
  const electric = africanaNightTrough('electric', 1.0, 1);

  // The BEST passive placement available — the warm corner — still leaves the
  // colony below its floor every night. This is the load-bearing assertion: it
  // is what stops the gradient from becoming a cheap substitute for regulation.
  assert.ok(
    warmEnd < floor,
    `even the warm end drops below africana's floor at night: ${warmEnd.toFixed(1)} < ${floor}`,
  );
  // The gradient is nonetheless a real, legible effect at night — the half of the
  // placement mechanic the sun cannot provide, and the reason a player can feel
  // the difference between the two ends after dark.
  assert.ok(
    warmEnd > coldEnd,
    `the warm end is genuinely warmer at night than the cold end: ${warmEnd.toFixed(1)} > ${coldEnd.toFixed(1)}`,
  );
  // The electric bin's active regulation is the genuine remedy: it holds the
  // night in band.
  assert.ok(electric >= floor, `only the electric bin keeps africana's night in band: ${electric.toFixed(1)} >= ${floor}`);
});
