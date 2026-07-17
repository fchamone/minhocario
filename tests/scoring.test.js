import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePoints,
  applyHarvestScore,
  POINTS_PER_LITER,
  AGE_BONUS_DAYS,
} from '../js/sim/scoring.js';

// --- frozen formula: points = liters × 10 × (1 + age/30) (§2.10) ------------

test('scorePoints matches the frozen formula on known inputs', () => {
  // 5 L harvested from a 30-day colony: 5 × 10 × (1 + 30/30) = 100
  assert.equal(scorePoints(5, 30), 100);
  // age 0 -> plain ×1 multiplier
  assert.equal(scorePoints(5, 0), 50);
  // age 60 -> ×3
  assert.equal(scorePoints(2, 60), 2 * 10 * 3);
  // zero harvest earns zero regardless of age
  assert.equal(scorePoints(0, 100), 0);
  // and it tracks the exported constants exactly
  assert.equal(scorePoints(3, 15), 3 * POINTS_PER_LITER * (1 + 15 / AGE_BONUS_DAYS));
});

test('scorePoints floors negative / NaN inputs to zero (scoring can only add)', () => {
  assert.equal(scorePoints(-5, 30), 0, 'negative liters -> 0');
  assert.equal(scorePoints(5, -30), 5 * POINTS_PER_LITER, 'negative age -> ×1 multiplier');
  assert.equal(scorePoints(NaN, 30), 0, 'NaN liters -> 0');
});

// --- the multiplier resets when the colony dies and is repopulated ----------

test('the age multiplier resets to ×1 after colony death (age 0)', () => {
  // The same harvest, from a mature 30-day colony vs a freshly-repopulated one.
  const mature = scorePoints(4, 30);
  const reborn = scorePoints(4, 0);
  assert.equal(mature, 80, 'a 30-day colony scores ×2');
  assert.equal(reborn, 40, 'an age-0 colony scores ×1');
  assert.equal(reborn, mature / 2, 'death (age reset) halves the same harvest');
});

// --- applyHarvestScore is monotonic (§2.10 "score never decreases") ---------

test('applyHarvestScore adds the harvest points and does not mutate the input', () => {
  const base = { colonyAgeDays: 30, score: 100 };
  const next = applyHarvestScore(base, 5);
  assert.equal(next.score, 200, 'score += 5 × 10 × 2 = 100');
  assert.equal(base.score, 100, 'input state not mutated');
});

test('score is non-decreasing across a harvest sequence (incl. death + idle)', () => {
  // Harvests at varying ages, including a zero-liter idle harvest and an age-0
  // rebirth after a colony death. The banked score must never step down.
  const harvests = [
    { liters: 3, age: 5 },
    { liters: 0, age: 12 }, // idle harvest: no humus -> no gain, no drop
    { liters: 7, age: 40 },
    { liters: 2, age: 0 }, // colony died and was repopulated: age reset
    { liters: 5, age: 3 },
  ];
  let s = { colonyAgeDays: 0, score: 0 };
  let prev = s.score;
  for (const h of harvests) {
    s = applyHarvestScore({ ...s, colonyAgeDays: h.age }, h.liters);
    assert.ok(s.score >= prev, `score never decreases: ${s.score} >= ${prev}`);
    prev = s.score;
  }
  assert.ok(s.score > 0, 'the sequence accrued points');
});
