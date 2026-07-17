import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpecies,
  listSpecies,
  reproductionFactor,
  mortalityRate,
  populationStep,
  HATCH_TICKS,
  MATURE_TICKS,
} from '../js/sim/worms.js';
import { createRng } from '../js/sim/rng.js';

const IDEAL = { moisture: 0.6, ph: 7, toxicity: 0, temperature: 22 };
const BIG = 1e6; // effectively unbounded carrying capacity

function evolve(pop, env, species, cap, rng, n) {
  for (let i = 0; i < n; i++) pop = populationStep(pop, env, species, cap, rng);
  return pop;
}

// --- species catalog ---------------------------------------------------------

test('species catalog has 3 mechanically distinct species (§2.9)', () => {
  assert.equal(listSpecies().length, 3);
  const cal = getSpecies('californiana');
  const afr = getSpecies('africana');
  const azul = getSpecies('azul');
  assert.ok(cal && afr && azul, 'all three species resolve');
  assert.equal(getSpecies('nope'), null);

  // Gigante-Africana: fastest eater.
  assert.ok(afr.speed > cal.speed && afr.speed > azul.speed, 'africana eats fastest');
  // Minhoca-Azul: fastest reproduction.
  assert.ok(azul.reproduction > cal.reproduction && azul.reproduction > afr.reproduction, 'azul breeds fastest');
  // Minhoca-Azul: narrowest moisture band.
  const width = (s) => s.moistureComfort.max - s.moistureComfort.min;
  assert.ok(width(azul) < width(cal) && width(azul) < width(afr), 'azul has the narrowest moisture band');
  // Gigante-Africana: least cold-tolerant (highest comfort floor).
  assert.ok(afr.tempComfort.min > cal.tempComfort.min, 'africana is the most cold-sensitive');
});

// --- growth ------------------------------------------------------------------

test('ideal conditions grow all three cohort stages', () => {
  const species = getSpecies('californiana');
  const rng = createRng(1);
  const start = { cocoons: 0, juveniles: 0, adults: 50 };
  const end = evolve(start, IDEAL, species, BIG, rng, 240);
  assert.ok(end.cocoons > 0, `cocoons grew: ${end.cocoons}`);
  assert.ok(end.juveniles > 0, `juveniles grew: ${end.juveniles}`);
  assert.ok(end.adults > 50, `adults grew: ${end.adults}`);
});

// --- graded response: stall before mortality ---------------------------------

test('reproduction stalls to zero before mortality sets in', () => {
  const species = getSpecies('californiana');
  // moderately outside the toxicity comfort band -> laying stalled, no dying yet
  const stalled = { ...IDEAL, toxicity: 0.25 };
  assert.equal(reproductionFactor(stalled, species, 50, BIG), 0, 'laying stalled');
  assert.equal(mortalityRate(stalled, species, 50, BIG), 0, 'no mortality yet');
  // much worse -> now mortality rises
  const lethal = { ...IDEAL, toxicity: 0.5 };
  assert.equal(reproductionFactor(lethal, species, 50, BIG), 0);
  assert.ok(mortalityRate(lethal, species, 50, BIG) > 0, 'mortality rises when far outside the band');
});

// --- lagged recovery ---------------------------------------------------------

test('recovery lags by the empty-pipeline delay after conditions are fixed', () => {
  const species = getSpecies('californiana');
  // grow a full pipeline (cocoons + juveniles + adults present)
  let pop = evolve({ cocoons: 0, juveniles: 0, adults: 40 }, IDEAL, species, BIG, createRng(2), 220);
  assert.ok(pop.cocoons > 0 && pop.juveniles > 0, 'pipeline is full before the stall');

  // stall laying (no dying) long enough to drain the pipeline into adults
  const stalled = { ...IDEAL, toxicity: 0.25 };
  pop = evolve(pop, stalled, species, BIG, createRng(2), 700);
  assert.ok(pop.cocoons <= 3 && pop.juveniles <= 3, `pipeline drained: c=${pop.cocoons} j=${pop.juveniles}`);
  const adultsAtRestore = pop.adults;

  // restore ideal conditions: laying resumes right away...
  assert.ok(evolve(pop, IDEAL, species, BIG, createRng(3), 5).cocoons > 0, 'laying resumes quickly');
  // ...but new adults only appear after the full hatch + maturation delay, so
  // adult recovery in the first hatch window is a small fraction of the eventual.
  const earlyGain = evolve(pop, IDEAL, species, BIG, createRng(3), HATCH_TICKS).adults - adultsAtRestore;
  const lateGain =
    evolve(pop, IDEAL, species, BIG, createRng(3), HATCH_TICKS + MATURE_TICKS + 60).adults - adultsAtRestore;
  assert.ok(lateGain > 5, `adults recover after the pipeline refills: +${lateGain}`);
  assert.ok(earlyGain < lateGain * 0.34, `early recovery is throttled by the delay: +${earlyGain} vs +${lateGain}`);
});

// --- determinism (RNG now in play) ------------------------------------------

test('populationStep is deterministic per seed and diverges across seeds', () => {
  const species = getSpecies('californiana');
  const start = { cocoons: 5, juveniles: 8, adults: 33 }; // fractional flows -> RNG draws
  const a = evolve(start, IDEAL, species, BIG, createRng(10), 100);
  const b = evolve(start, IDEAL, species, BIG, createRng(10), 100);
  const c = evolve(start, IDEAL, species, BIG, createRng(11), 100);
  assert.deepEqual(a, b, 'same seed -> identical evolution');
  assert.notDeepEqual(a, c, 'different seed -> divergent evolution');
});
