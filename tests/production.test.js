import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  tick,
  addFood,
  harvestHumus,
  drainLeachate,
  buyWormPack,
  absoluteTick,
} from '../js/sim/engine.js';
import { COMPOSTERS, getComposter } from '../js/sim/composters.js';
import { carryingCapacity, RATION_TICKS } from '../js/sim/worms.js';
import { createRng } from '../js/sim/rng.js';

// Build a farm with a live colony and a directly-seeded food queue. The queue is
// set on the state (bypassing addFood's capacity clamp) so identical inputs can
// be fed to composters of different sizes for the ordering test.
function farm(overrides = {}) {
  const base = createInitialFarmState({
    seed: 1,
    composterId: 'electric',
    speciesId: 'californiana',
  });
  return {
    ...base,
    population: { cocoons: 0, juveniles: 0, adults: 1000 },
    ...overrides,
  };
}

function entry(foodId, liters, addedAtTick = 0) {
  return { foodId, liters, addedAtTick };
}

const queueVolume = (s) => s.queue.reduce((sum, e) => sum + e.liters, 0);

/** Advance n ticks with a fresh RNG seeded from the state's own rngState. */
function run(state, n) {
  const rng = createRng(state.rngState);
  for (let i = 0; i < n; i++) state = tick(state, rng);
  return state;
}

// --- oldest-first consumption + removal ------------------------------------

test('worms consume the oldest queue entry first and remove it when depleted', () => {
  // A tiny oldest entry plus a large fresh one: one tick should finish the old
  // entry (removing it) and only nibble the new one.
  //
  // The oldest entry is sized against the bin's THROUGHPUT CEILING, not against
  // the head-count: 3000 worms in the 20 L electric bin is 3x carrying capacity,
  // so this colony is hard-capped at capacity x speed x THROUGHPUT_CAP_PER_LITER
  // = 20 x 1.7 x 0.014 = 0.476 L/tick no matter how many worms are stacked in
  // there. 0.3 L clears in one tick with margin; the old 0.5 L did not.
  const s = farm({
    population: { cocoons: 0, juveniles: 0, adults: 3000 },
    queue: [entry('vegetableScraps', 0.3, 0), entry('vegetableScraps', 100, 1)],
  });
  const before = queueVolume(s);
  const s1 = run(s, 1);

  assert.equal(s1.queue.length, 1, 'the depleted oldest entry is removed');
  assert.equal(s1.queue[0].addedAtTick, 1, 'the surviving entry is the newer one');
  assert.ok(s1.queue[0].liters < 100, 'the newer entry was partially eaten');
  assert.ok(queueVolume(s1) < before, 'total queue volume dropped by what was eaten');
  assert.ok(s1.humus > 0, 'eaten food produced humus');
  assert.equal(s.queue.length, 2, 'input state was not mutated');
});

test('a single small entry is fully consumed and the queue empties', () => {
  // 5000 adults in the 20 L electric bin is FIVE TIMES its carrying capacity —
  // a deliberately absurd colony, here to show that "absurdly many worms" does
  // not translate into absurd throughput. The bin's working face allows
  // 20 x 1.7 x 0.014 = 0.476 L/tick, so this over-stuffed colony clears a 0.3 L
  // scrap in one tick and no more; sizing the entry at the old 0.5 L would now be
  // asserting throughput the ceiling explicitly forbids.
  const c = getComposter('electric');
  const ceiling = c.capacity * c.speed * 0.014; // species.speed = 1 (californiana)
  assert.ok(0.3 < ceiling, `the entry is inside one tick of ceiling throughput (${ceiling.toFixed(3)} L)`);

  const s = farm({
    population: { cocoons: 0, juveniles: 0, adults: 5000 },
    queue: [entry('vegetableScraps', 0.3, 0)],
  });
  const s1 = run(s, 1);
  assert.equal(s1.queue.length, 0, 'the only entry is fully eaten and removed');

  // And the ceiling really is what bound it: a colony a fifth the size, still
  // over capacity, eats exactly the same amount from a queue it cannot exhaust.
  const eaten = (adults) => {
    const f = farm({ population: { cocoons: 0, juveniles: 0, adults }, queue: [entry('vegetableScraps', 500, 0)] });
    return 500 - queueVolume(run(f, 1));
  };
  assert.ok(
    Math.abs(eaten(5000) - eaten(1000)) < 1e-9,
    'five times the worms buys no extra throughput once the face is saturated',
  );
});

// --- production converts eaten food into humus + leachate ------------------

test('eaten volume converts to humus and leachate at the composter rates', () => {
  const c = getComposter('electric');
  const s = farm({ queue: [entry('vegetableScraps', 100, 0)] });
  const s1 = run(s, 1);
  const eaten = 100 - queueVolume(s1);
  assert.ok(eaten > 0);
  assert.ok(Math.abs(s1.humus - eaten * c.humusRate) < 1e-9, 'humus = eaten x humusRate');
  assert.ok(
    Math.abs(s1.leachate - eaten * c.leachateRate) < 1e-9,
    'leachate = eaten x leachateRate',
  );
});

// --- per-model humus output ordering tracks the catalog --------------------

test('per-model humus output ordering matches humusRate x speed', () => {
  // Feed a comparable population + queue to every composter for one tick and
  // collect humus per model; ordering must track composter.speed x humusRate.
  //
  // The head-count is UNDER-STOCKED on purpose. Eating is capped by the bin's
  // working face (THROUGHPUT_CAP_PER_LITER, engine.js) and that face scales with
  // capacity, so a colony large enough to saturate the 20 L electric bin is only
  // a fifth of a colony in the 100 L eco bin: at the old 1000 worms electric was
  // the ONLY model being throttled, and it ranked below eco for that reason alone
  // rather than on speed x humusRate. 400 worms sits below every model's ceiling
  // (the tightest is electric's 0.476 L/tick against a 0.34 L/tick demand), so all
  // six are on their linear branch and the ordering claim is tested in isolation.
  // Note a proportional stocking would NOT fix this — it puts capacity back into
  // the product and inverts the same pair the other way.
  const humusById = {};
  const productById = {};
  for (const c of COMPOSTERS) {
    const s = farm({
      composterId: c.id,
      population: { cocoons: 0, juveniles: 0, adults: 400 },
      queue: [entry('vegetableScraps', 100, 0)],
    });
    const s1 = run(s, 1);
    humusById[c.id] = s1.humus;
    productById[c.id] = c.speed * c.humusRate;
    assert.ok(s1.humus < c.humusCapacity, `${c.id} did not hit its tray cap`);
  }

  const byHumus = [...COMPOSTERS.map((c) => c.id)].sort(
    (a, b) => humusById[a] - humusById[b],
  );
  const byProduct = [...COMPOSTERS.map((c) => c.id)].sort(
    (a, b) => productById[a] - productById[b],
  );
  assert.deepEqual(byHumus, byProduct, 'humus ordering follows humusRate x speed');

  // and a concrete pair: the fast eco tray out-produces the slow 2-tier
  assert.ok(humusById.eco > humusById.tier2, 'eco out-produces tier2');
});

// --- consumption scales with population and species speed ------------------

test('consumption scales with the active worm population', () => {
  const few = farm({
    population: { cocoons: 0, juveniles: 0, adults: 500 },
    queue: [entry('vegetableScraps', 100, 0)],
  });
  const many = farm({
    population: { cocoons: 0, juveniles: 0, adults: 1500 },
    queue: [entry('vegetableScraps', 100, 0)],
  });
  const eatenFew = 100 - queueVolume(run(few, 1));
  const eatenMany = 100 - queueVolume(run(many, 1));
  assert.ok(eatenMany > eatenFew, `more worms eat more: ${eatenMany} vs ${eatenFew}`);
});

test('a faster-eating species processes more of the queue', () => {
  const slow = farm({ speciesId: 'californiana', queue: [entry('vegetableScraps', 100, 0)] });
  const fast = farm({ speciesId: 'africana', queue: [entry('vegetableScraps', 100, 0)] });
  const eatenSlow = 100 - queueVolume(run(slow, 1));
  const eatenFast = 100 - queueVolume(run(fast, 1));
  assert.ok(eatenFast > eatenSlow, `africana out-eats californiana: ${eatenFast} vs ${eatenSlow}`);
});

test('an empty or dead colony consumes nothing', () => {
  const dead = farm({
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    queue: [entry('vegetableScraps', 10, 0)],
  });
  const s1 = run(dead, 1);
  assert.equal(queueVolume(s1), 10, 'no worms -> queue untouched');
  assert.equal(s1.humus, 0, 'no worms -> no humus');
  assert.equal(s1.leachate, 0, 'no worms -> no leachate');
});

// --- throughput ceiling ----------------------------------------------------

test('per-tick eating is capped near carrying capacity', () => {
  // Eating used to be unbounded and linear in population, so demand grew with
  // capacity x DENSITY while the UI's largest portion grew with capacity alone —
  // a packed bin drained any feedable meal within seconds of real time.
  const cap = carryingCapacity(getComposter('eco'));
  const eatenIn1Tick = (active) => {
    const s = farm({
      composterId: 'eco',
      population: { cocoons: 0, juveniles: 0, adults: active },
      // Far more food than any ceiling could touch, so the queue never limits.
      queue: [entry('vegetableScraps', 5000, 0)],
    });
    return 5000 - queueVolume(run(s, 1));
  };

  // The ceiling is REAL: doubling an already-saturated colony must not buy any
  // extra throughput. (Below the cap this same comparison would roughly double.)
  const at2x = eatenIn1Tick(cap * 2);
  const at4x = eatenIn1Tick(cap * 4);
  assert.ok(at2x > 0, 'a saturated colony still eats');
  assert.ok(
    Math.abs(at4x - at2x) < 1e-9,
    `throughput stops growing with population: ${at2x} vs ${at4x} L/tick`,
  );
});

// --- the cap is mirrored into the HUNGER measurement, not just into eating ---
//
// This is the highest-risk invariant of the throughput ceiling: `ration`
// (engine.js) and the actual eating must call the SAME capped throughput. If
// `demand` stayed on the uncapped linear expression while eating was capped, a
// throttled colony would measure itself against food it is not even allowed to
// eat, read as permanently underfed however full the bin is, and hold the
// reproduction brake (worms.js RATION_TICKS) down forever — settling at a
// silently different equilibrium.
//
// A one-tick VOLUME assertion cannot see this, and the previous version of this
// guard (`eatenIn1Tick * RATION_TICKS <= composter.capacity`) did not: `ration`
// only feeds reproduction on SUBSEQUENT ticks and has no effect at all on the
// same tick's eating, so any assertion about liters eaten in one tick is a pure
// function of THROUGHPUT_CAP_PER_LITER and is blind to how `demand` is computed.
// Reverting engine.js's `demand` to the uncapped expression left that assertion
// green. `ration` is internal to tick() and not exported, so the only honest way
// to observe it is through its consequence: LAYING.
//
// The setup is a differential run. Two identical colonies sit over the
// throughput ceiling; both are fed a standing queue that never runs out, and the
// only difference is how full the bin is:
//   - the TEST bin holds just over one CAPPED larder — more food than the colony
//     can physically eat in RATION_TICKS, but less than its uncapped linear
//     demand would ask for;
//   - the CONTROL bin holds a full UNCAPPED larder, which reads as well fed
//     under either implementation.
// Correct (shared, capped) implementation: both read ration = 1, so laying is
// identical and the two trajectories match tick for tick. Uncapped `demand`: the
// test bin reads as partly starved, its laying is throttled, and it ends the run
// with a visibly smaller colony. Everything else — env, bin, seed, food — is held
// in comfort so hunger is the only variable in play.

test('a bin holding a full CAPPED larder breeds like one holding a full uncapped larder', () => {
  const c = getComposter('eco');
  const species = 'californiana';
  // 90% of carrying capacity: no crowding stress at the start, but well past the
  // throughput knee (the ceiling engages at 56% of capacity), so the colony is
  // genuinely capped and capped demand < linear demand.
  const START_ADULTS = Math.round(carryingCapacity(c) * 0.9);
  const TICKS = 300; // > HATCH_TICKS + MATURE_TICKS, so the cohort pipeline responds

  // Comfort bands with margin on every variable, so neither run is ever judged on
  // anything but hunger. Temperature is pinned low because the standing queue
  // ferments: the larger CONTROL queue runs the bin a few degrees warmer, and a
  // higher pin would push it over californiana's 30 °C ceiling and contaminate
  // the comparison with a temperature difference.
  const COMFORT = { moisture: 0.55, ph: 7, toxicity: 0, temperature: 13 };
  // Eggshells: the only zero-moisture, zero-toxicity food in the catalog and the
  // coolest-fermenting one, so the two different queue VOLUMES perturb the bin as
  // little as possible.
  const FOOD = 'eggshells';

  const base = (adults) =>
    farm({
      composterId: 'eco',
      speciesId: species,
      wallPosition: 0.05, // shade: keep the solar term out of it
      env: { ...COMFORT },
      population: { cocoons: 0, juveniles: 0, adults },
    });

  // Liters actually eaten in one tick, with an inexhaustible queue.
  const eatenIn1Tick = (adults) => {
    const s = { ...base(adults), queue: [entry(FOOD, 5000, 0)] };
    return 5000 - queueVolume(run(s, 1));
  };

  // Both demand figures measured from the engine itself, not from constants:
  // `capped` is what the over-cap colony may eat per tick; `uncapped` is what the
  // linear term alone would ask for, extrapolated from a colony below the knee
  // (1000 worms, where eating is still purely linear in population).
  const capped = eatenIn1Tick(START_ADULTS);
  const uncapped = (eatenIn1Tick(1000) / 1000) * START_ADULTS;
  assert.ok(
    capped < uncapped - 1e-9,
    `the colony must be over the ceiling for this test to mean anything: ${capped} vs ${uncapped} L/tick`,
  );

  const standingTest = capped * RATION_TICKS * 1.1;
  const standingControl = uncapped * RATION_TICKS * 1.05;
  assert.ok(
    standingTest > capped * RATION_TICKS && standingTest < uncapped * RATION_TICKS,
    `the test larder covers capped demand but not uncapped demand (${standingTest.toFixed(1)} L)`,
  );
  assert.ok(
    standingControl <= c.capacity,
    `an uncapped larder must still fit in the bin (${standingControl.toFixed(1)} of ${c.capacity} L)`,
  );

  // Run with the bin held at a fixed standing volume and the environment reset to
  // comfort each tick: the queue is the experiment, everything else is held still.
  // Humus and leachate are emptied every tick so neither overflow chain (tray-full
  // halt, tank spill) can interfere.
  const growFor = (standing) => {
    let s = base(START_ADULTS);
    const rng = createRng(s.rngState);
    let maxTemp = -Infinity;
    let minTemp = Infinity;
    for (let i = 0; i < TICKS; i++) {
      s = {
        ...s,
        env: { ...COMFORT },
        humus: 0,
        leachate: 0,
        queue: [entry(FOOD, standing, absoluteTick(s))],
      };
      s = tick(s, rng);
      maxTemp = Math.max(maxTemp, s.env.temperature);
      minTemp = Math.min(minTemp, s.env.temperature);
    }
    return { population: s.population, maxTemp, minTemp };
  };

  const leanBin = growFor(standingTest);
  const fullBin = growFor(standingControl);

  // Guard the controls themselves: if a future retune of the temperature model
  // pushed either run out of californiana's 10..30 °C band, the comparison below
  // would be measuring temperature rather than hunger, and this reports that
  // rather than failing mysteriously.
  for (const [name, r] of [['test', leanBin], ['control', fullBin]]) {
    assert.ok(
      r.minTemp > 10 && r.maxTemp < 30,
      `the ${name} bin must stay inside the temperature comfort band (${r.minTemp.toFixed(1)}..${r.maxTemp.toFixed(1)} °C)`,
    );
  }

  // Sanity: the scenario has to actually breed, or "identical" would be trivial.
  const total = (p) => p.cocoons + p.juveniles + p.adults;
  assert.ok(
    total(leanBin.population) > START_ADULTS * 1.5,
    `a well-fed colony in comfort must grow (${total(leanBin.population)} from ${START_ADULTS})`,
  );

  // THE GUARD. Same seed, same everything but bin fullness — and under a shared
  // capped demand both bins read as a full larder, so the trajectories match
  // exactly. With an uncapped `demand` the test bin reads as ~2/3 fed and falls
  // measurably behind.
  assert.deepEqual(
    leanBin.population,
    fullBin.population,
    `a bin holding a full CAPPED larder must breed exactly like one holding a full uncapped larder — ` +
      `${total(leanBin.population)} vs ${total(fullBin.population)} worms means the hunger ration is ` +
      `being measured against demand the colony is not allowed to eat (engine.js: \`demand\` must ` +
      `call eatingThroughput, the same capped figure eating uses)`,
  );
});

// --- determinism -----------------------------------------------------------

test('production replays identically per seed and stays JSON-serializable', () => {
  const build = () =>
    farm({
      population: { cocoons: 4, juveniles: 12, adults: 800 },
      queue: [entry('vegetableScraps', 50, 0), entry('coffeeGrounds', 30, 2)],
    });
  const a = run(build(), 20);
  const b = run(build(), 20);
  assert.deepEqual(a, b, 'same seed + same actions -> identical state');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state round-trips through JSON');
});

// --- The electric composter earns its price (retuned after CP6 / T21) --------
// It has the SMALLEST bin in the catalog (population ceiling 1000), so it can
// never win on colony size — measured at CP6 it was actually out-earned by the
// 100-coin tier2. Its premium is throughput per worm instead: it eats fastest
// and converts the largest share into humus. (T21 also cut its price 350 -> 200
// so this efficiency reads as a sensible upgrade rather than a coins/day trap;
// price is not exercised here — see tests/balance.test.js + tasks/t21-balance.md.)
//
// Note speed alone is a poor lever (faster eating starves the colony, so 2.7x
// the speed bought only 16% more output); humusRate is what scales output
// without raising food demand. These lock the OUTCOME, not the constants.

test('electric converts a given meal into more humus than any other model', () => {
  // Same colony, same food, different bins: electric must top the table on
  // humus produced per unit eaten (speed x humusRate).
  const product = (c) => c.speed * c.humusRate;
  const electric = getComposter('electric');
  for (const c of COMPOSTERS) {
    if (c.id === 'electric') continue;
    assert.ok(
      product(electric) > product(c),
      `electric (${product(electric).toFixed(2)}) must out-convert ${c.id} (${product(c).toFixed(2)})`,
    );
  }
});

test('electric out-produces the cheaper tier2 despite a much smaller colony', () => {
  // The claim that matters, measured rather than derived: run both bins well-fed
  // for 30 days and compare humus actually harvested. Electric fields roughly a
  // third of tier2's worms (its bin is smaller, so it sustains a smaller larder
  // and therefore a smaller colony) and must still finish ahead.
  const runFor = (composterId) => {
    const c = getComposter(composterId);
    let s = createInitialFarmState({
      seed: 21,
      composterId,
      speciesId: 'californiana',
      wallPosition: 0.05, // shade: isolate production from the solar term
    });
    ({ state: s } = buyWormPack(s, 100000, 'californiana', 50));
    const rng = createRng(s.rngState);
    let humus = 0;
    for (let d = 0; d < 30; d++) {
      for (let h = 0; h < 24; h++) {
        const queued = s.queue.reduce((a, e) => a + e.liters, 0);
        if (queued < c.capacity * 0.5) s = addFood(s, 'vegetableScraps', c.capacity * 0.07);
        s = tick(s, rng);
        if (h === 20) {
          const h2 = harvestHumus(s);
          humus += h2.harvested;
          s = drainLeachate(h2.state).state;
        }
      }
    }
    const pop = s.population.cocoons + s.population.juveniles + s.population.adults;
    return { humus, pop };
  };

  const electric = runFor('electric');
  const tier2 = runFor('tier2');

  assert.ok(
    electric.pop < tier2.pop,
    `electric fields the smaller colony (${Math.round(electric.pop)} vs ${Math.round(tier2.pop)})`,
  );
  assert.ok(
    electric.humus > tier2.humus,
    `electric must still out-produce tier2: ${electric.humus.toFixed(1)} vs ${tier2.humus.toFixed(1)} L`,
  );
});

test('no model claims to output more than it consumes', () => {
  // Conservation guard: raising electric's humusRate must not push humus +
  // leachate past what the worms actually ate.
  for (const c of COMPOSTERS) {
    assert.ok(
      c.humusRate + c.leachateRate <= 1,
      `${c.id} outputs ${(c.humusRate + c.leachateRate).toFixed(2)} per unit eaten`,
    );
  }
});
