import test from 'node:test';
import assert from 'node:assert/strict';
import { statsSnapshot } from '../js/ui/stats.js';
import { createInitialFarmState, addFood } from '../js/sim/engine.js';
import { getComposter } from '../js/sim/composters.js';
import { carryingCapacity } from '../js/sim/worms.js';
import { scorePoints, POINTS_PER_LITER, AGE_BONUS_DAYS } from '../js/sim/scoring.js';

/**
 * A farm on a known composter with known contents, so every assertion below can
 * be written as an exact number rather than a range.
 * @param {object} [over] fields to override on the base farm
 */
function farmWith(over = {}) {
  const base = createInitialFarmState({
    seed: 7,
    composterId: 'tier2', // 30 L bin, 12 L humus tray, 6 L leachate tank
    speciesId: 'californiana',
  });
  return { ...base, ...over };
}

// --- Shape / derivation ------------------------------------------------------

test('statsSnapshot reports the score and the run clock straight off the farm', () => {
  const snap = statsSnapshot(farmWith({ score: 1234.4, day: 17 }), 250);
  assert.equal(snap.score, 1234.4);
  assert.equal(snap.day, 17);
  assert.equal(snap.wallet, 250);
});

test('statsSnapshot reads population by stage and the bin carrying capacity', () => {
  const farm = farmWith({ population: { cocoons: 40, juveniles: 120, adults: 300 } });
  const snap = statsSnapshot(farm, 0);
  assert.equal(snap.population.cocoons, 40);
  assert.equal(snap.population.juveniles, 120);
  assert.equal(snap.population.adults, 300);
  assert.equal(snap.population.total, 460);
  assert.equal(snap.population.capacity, carryingCapacity(getComposter('tier2')));
  assert.equal(snap.population.capacity, 1500); // 30 L × 50 worms/L
});

test('statsSnapshot measures tray and tank against the composter caps', () => {
  const snap = statsSnapshot(farmWith({ humus: 3, leachate: 1.5 }), 0);
  assert.equal(snap.humus.liters, 3);
  assert.equal(snap.humus.capacity, 12);
  assert.equal(snap.humus.fill, 0.25);
  assert.equal(snap.humus.full, false);
  assert.equal(snap.leachate.capacity, 6);
  assert.equal(snap.leachate.fill, 0.25);
});

test('a tray/tank at capacity reads as full', () => {
  const snap = statsSnapshot(farmWith({ humus: 12, leachate: 6 }), 0);
  assert.equal(snap.humus.full, true);
  assert.equal(snap.humus.fill, 1);
  assert.equal(snap.leachate.full, true);
});

test('an over-capacity level clamps its fill to 1 rather than overflowing the bar', () => {
  const snap = statsSnapshot(farmWith({ humus: 99 }), 0);
  assert.equal(snap.humus.fill, 1);
  assert.equal(snap.humus.full, true);
});

test('queuedLiters sums every decomposing entry', () => {
  let farm = farmWith();
  farm = addFood(farm, 'fruitPeels', 2);
  farm = addFood(farm, 'coffeeGrounds', 1.5);
  const snap = statsSnapshot(farm, 0);
  assert.ok(farm.queue.length >= 2, 'the fixture should have queued both foods');
  assert.equal(snap.queuedLiters, farm.queue.reduce((sum, e) => sum + e.liters, 0));
  assert.equal(snap.queuedLiters, 3.5);
});

test('an empty queue sums to zero', () => {
  assert.equal(statsSnapshot(farmWith(), 0).queuedLiters, 0);
});

// --- The frozen scoring formula ---------------------------------------------
// These lock the panel to js/sim/scoring.js: it must PREDICT a harvest, never
// re-derive one. If the (frozen) formula ever moved, these fail rather than the
// panel quietly disagreeing with the score the player actually banks.

test('the age multiplier is 1 + colonyAgeDays / AGE_BONUS_DAYS', () => {
  assert.equal(statsSnapshot(farmWith({ colonyAgeDays: 0 }), 0).ageMultiplier, 1);
  assert.equal(statsSnapshot(farmWith({ colonyAgeDays: AGE_BONUS_DAYS }), 0).ageMultiplier, 2);
  assert.equal(statsSnapshot(farmWith({ colonyAgeDays: 15 }), 0).ageMultiplier, 1.5);
  assert.equal(statsSnapshot(farmWith({ colonyAgeDays: 90 }), 0).ageMultiplier, 4);
});

test('the reported colony age is the farm value, shown beside the multiplier', () => {
  const snap = statsSnapshot(farmWith({ colonyAgeDays: 12.5 }), 0);
  assert.equal(snap.colonyAgeDays, 12.5);
});

test('a negative colony age is floored exactly as scorePoints floors it', () => {
  // A hand-edited/corrupt save can carry a negative age. scoring.js floors it to
  // 0, so the panel must too — otherwise it renders "×0.00 · −30 days" beside a
  // prediction the sim computed at ×1, which is the drift this module exists to
  // make impossible. `num()` passes negative finite numbers through untouched,
  // so this is NOT covered by the NaN/Infinity case below.
  const snap = statsSnapshot(farmWith({ colonyAgeDays: -30, humus: 5 }), 0);
  assert.equal(snap.colonyAgeDays, 0, 'a negative age must report as 0, never as −30');
  assert.equal(snap.ageMultiplier, 1, 'the multiplier can never drop below ×1');
  assert.equal(snap.nextHarvestPoints, scorePoints(5, -30));
  assert.equal(snap.nextHarvestPoints, 5 * POINTS_PER_LITER);
});

test('the multiplier and the prediction agree for every age, corrupt ones included', () => {
  // The invariant: nextHarvestPoints === liters × POINTS_PER_LITER × multiplier.
  for (const age of [-999, -30, -0.5, 0, 7, 12.5, 30, 90, NaN, Infinity, -Infinity, undefined]) {
    const snap = statsSnapshot(farmWith({ colonyAgeDays: age, humus: 5 }), 0);
    assert.equal(
      snap.nextHarvestPoints,
      5 * POINTS_PER_LITER * snap.ageMultiplier,
      `age=${age}: the shown multiplier must explain the shown prediction`,
    );
    assert.ok(snap.ageMultiplier >= 1, `age=${age}: multiplier fell below ×1`);
    assert.ok(snap.colonyAgeDays >= 0, `age=${age}: reported a negative age`);
  }
});

test('nextHarvestPoints equals scorePoints(humus, colonyAgeDays)', () => {
  for (const [humus, age] of [
    [0, 0],
    [4, 0],
    [4, 30],
    [7.25, 13.5],
    [12, 90],
  ]) {
    const snap = statsSnapshot(farmWith({ humus, colonyAgeDays: age }), 0);
    assert.equal(
      snap.nextHarvestPoints,
      scorePoints(humus, age),
      `humus=${humus} age=${age} must match the frozen formula`,
    );
  }
});

test('nextHarvestPoints spells out to liters × POINTS_PER_LITER × multiplier', () => {
  const snap = statsSnapshot(farmWith({ humus: 5, colonyAgeDays: 30 }), 0);
  assert.equal(snap.nextHarvestPoints, 5 * POINTS_PER_LITER * 2);
  assert.equal(snap.nextHarvestPoints, 100);
});

test('an empty tray predicts zero points regardless of age', () => {
  const snap = statsSnapshot(farmWith({ humus: 0, colonyAgeDays: 200 }), 0);
  assert.equal(snap.nextHarvestPoints, 0);
});

// --- Edge states -------------------------------------------------------------

test('statsSnapshot returns null for a missing farm', () => {
  assert.equal(statsSnapshot(null, 100), null);
  assert.equal(statsSnapshot(undefined, 100), null);
});

test('a dead colony still reports, with the multiplier back at ×1', () => {
  // The engine resets colonyAgeDays on death; banked score survives (§2.10).
  const snap = statsSnapshot(
    farmWith({ colonyAlive: false, colonyAgeDays: 0, score: 880, humus: 4 }),
    0,
  );
  assert.equal(snap.colonyAlive, false);
  assert.equal(snap.ageMultiplier, 1);
  assert.equal(snap.score, 880);
  // The tray is still there and still harvestable — just at no age bonus.
  assert.equal(snap.nextHarvestPoints, 4 * POINTS_PER_LITER);
});

test('a live colony reports colonyAlive true', () => {
  assert.equal(statsSnapshot(farmWith(), 0).colonyAlive, true);
});

test('an unknown/absent composter degrades to zero capacities instead of throwing', () => {
  for (const composterId of [null, 'no-such-bin']) {
    const snap = statsSnapshot(farmWith({ composterId, humus: 2, leachate: 1 }), 0);
    assert.equal(snap.humus.capacity, 0);
    assert.equal(snap.humus.fill, 0);
    assert.equal(snap.humus.full, false, 'an unknown cap must never read as "full"');
    assert.equal(snap.leachate.capacity, 0);
    assert.equal(snap.population.capacity, 0);
    // The score half of the panel does not depend on the bin at all.
    assert.equal(snap.humus.liters, 2);
    assert.equal(snap.nextHarvestPoints, scorePoints(2, 0));
  }
});

test('corrupt/absent numeric fields floor to 0 rather than leaking NaN', () => {
  const snap = statsSnapshot(
    {
      ...farmWith(),
      score: undefined,
      day: NaN,
      humus: undefined,
      leachate: null,
      colonyAgeDays: Infinity,
      population: undefined,
      queue: undefined,
    },
    undefined,
  );
  for (const value of [
    snap.score,
    snap.day,
    snap.wallet,
    snap.colonyAgeDays,
    snap.ageMultiplier,
    snap.nextHarvestPoints,
    snap.humus.liters,
    snap.humus.fill,
    snap.leachate.liters,
    snap.queuedLiters,
    snap.population.total,
  ]) {
    assert.equal(Number.isFinite(value), true, 'every reported number must be finite');
  }
  assert.equal(snap.ageMultiplier, 1);
  assert.equal(snap.nextHarvestPoints, 0);
});

// --- Purity ------------------------------------------------------------------

test('statsSnapshot does not mutate the farm it inspects', () => {
  let farm = farmWith({ humus: 3, colonyAgeDays: 10, score: 42 });
  farm = addFood(farm, 'fruitPeels', 1);
  const before = JSON.stringify(farm);
  statsSnapshot(farm, 500);
  assert.equal(JSON.stringify(farm), before);
});

test('statsSnapshot is deterministic — same input, same numbers', () => {
  const farm = farmWith({ humus: 6, colonyAgeDays: 21, score: 90 });
  assert.deepEqual(statsSnapshot(farm, 33), statsSnapshot(farm, 33));
});
