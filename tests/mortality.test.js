import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpecies,
  reproductionFactor,
  mortalityRate,
  populationStep,
  carryingCapacity,
} from '../js/sim/worms.js';
import { getComposter } from '../js/sim/composters.js';
import { createRng } from '../js/sim/rng.js';

const IDEAL = { moisture: 0.6, ph: 7, toxicity: 0, temperature: 22 };
const BIG = 1e6;

function evolve(pop, env, species, cap, rng, n) {
  for (let i = 0; i < n; i++) pop = populationStep(pop, env, species, cap, rng);
  return pop;
}

const total = (p) => p.cocoons + p.juveniles + p.adults;

// --- each stressor independently kills --------------------------------------

test('toxicity alone collapses a colony', () => {
  const species = getSpecies('californiana');
  const env = { ...IDEAL, toxicity: 0.5 };
  const end = evolve({ cocoons: 0, juveniles: 0, adults: 100 }, env, species, BIG, createRng(1), 140);
  assert.ok(total(end) < 10, `colony collapses under toxicity: ${total(end)}`);
});

test('dryness alone collapses a colony', () => {
  const species = getSpecies('californiana');
  const env = { ...IDEAL, moisture: 0.1 };
  const end = evolve({ cocoons: 0, juveniles: 0, adults: 100 }, env, species, BIG, createRng(1), 140);
  assert.ok(total(end) < 10, `colony collapses when too dry: ${total(end)}`);
});

test('overheating alone collapses a colony', () => {
  const species = getSpecies('californiana');
  const env = { ...IDEAL, temperature: 42 };
  const end = evolve({ cocoons: 0, juveniles: 0, adults: 100 }, env, species, BIG, createRng(1), 140);
  assert.ok(total(end) < 10, `colony collapses when overheated: ${total(end)}`);
});

test('overpopulation culls back toward carrying capacity (self-limiting)', () => {
  const species = getSpecies('californiana');
  const cap = carryingCapacity(getComposter('electric')); // capacity * density
  assert.ok(cap > 0);
  const start = { cocoons: 0, juveniles: 0, adults: Math.round(cap * 3) };
  const end = evolve(start, IDEAL, species, cap, createRng(1), 160);
  assert.ok(end.adults < cap * 2.2, `overpopulation is culled down: ${end.adults} vs cap ${cap}`);
  assert.ok(end.adults > 0, 'overpopulation is self-limiting, not a wipeout');
});

// --- species temperature divergence -----------------------------------------

test('Gigante-Africana dies in the cold where Vermelha-da-Califórnia survives', () => {
  const afr = getSpecies('africana');
  const cal = getSpecies('californiana');
  const cold = { ...IDEAL, temperature: 8 };

  // the rates already tell the story
  assert.ok(mortalityRate(cold, afr, 100, BIG) > 0, 'africana suffers cold mortality');
  assert.equal(mortalityRate(cold, cal, 100, BIG), 0, 'californiana tolerates the cold');

  const afrEnd = evolve({ cocoons: 0, juveniles: 0, adults: 100 }, cold, afr, BIG, createRng(1), 140);
  const calEnd = evolve({ cocoons: 0, juveniles: 0, adults: 100 }, cold, cal, BIG, createRng(1), 140);
  assert.ok(afrEnd.adults < 40, `africana dies off in the cold: ${afrEnd.adults}`);
  assert.ok(calEnd.adults >= 100, `californiana holds through the cold: ${calEnd.adults}`);
});

// --- graded response confirmed for a second variable ------------------------

test('drying stalls reproduction before it becomes lethal', () => {
  const species = getSpecies('californiana');
  const stalled = { ...IDEAL, moisture: 0.3 }; // just outside the band
  assert.equal(reproductionFactor(stalled, species, 50, BIG), 0);
  assert.equal(mortalityRate(stalled, species, 50, BIG), 0);
  const lethal = { ...IDEAL, moisture: 0.1 }; // far outside the band
  assert.ok(mortalityRate(lethal, species, 50, BIG) > 0);
});
