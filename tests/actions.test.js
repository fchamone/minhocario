import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foodChoices,
  portionValid,
  gauge,
  internalsSnapshot,
  QUEUE_PREVIEW_LIMIT,
} from '../js/ui/actions.js';
import { FOODS } from '../js/sim/foods.js';
import { MIN_PORTION_LITERS, createInitialFarmState, addFood } from '../js/sim/engine.js';
import { getComposter } from '../js/sim/composters.js';
import { getSpecies, carryingCapacity } from '../js/sim/worms.js';
import { setLang } from '../js/strings.js';

// --- The add-waste list carries ZERO suitability signal (spec §2.7) ----------
// This is the review item called out in the plan for T14: discovery is the
// gameplay, so the list may not label, group, or reorder by suitability.

test('foodChoices exposes only an id and a display name', () => {
  for (const choice of foodChoices()) {
    assert.deepEqual(
      Object.keys(choice).sort(),
      ['id', 'name'],
      `food ${choice.id} leaks a field beyond id/name`,
    );
  }
});

test('foodChoices preserves the interleaved catalog order', () => {
  assert.deepEqual(
    foodChoices().map((c) => c.id),
    FOODS.map((f) => f.id),
  );
});

test('foodChoices covers every catalog food in every locale, with no labels', () => {
  // A suitability hint would most likely creep in as a parenthetical or a
  // marker glued onto the translated name.
  for (const tag of ['pt-BR', 'en', 'es']) {
    setLang(tag);
    const choices = foodChoices();
    assert.equal(choices.length, FOODS.length);
    for (const choice of choices) {
      assert.equal(typeof choice.name, 'string');
      assert.ok(choice.name.length > 0, `${choice.id} has no name in ${tag}`);
      assert.doesNotMatch(choice.name, /[(\[*!✓✗×]/, `${choice.id} name is annotated in ${tag}`);
    }
  }
  setLang('pt-BR');
});

// --- Portion validation mirrors the engine's minimum (§2.7) ------------------

test('portionValid enforces the engine minimum portion', () => {
  assert.equal(portionValid(MIN_PORTION_LITERS), true);
  assert.equal(portionValid(1), true);
  assert.equal(portionValid(MIN_PORTION_LITERS - 0.01), false);
  assert.equal(portionValid(0), false);
  assert.equal(portionValid(-1), false);
});

test('portionValid rejects non-numeric input', () => {
  assert.equal(portionValid(NaN), false);
  assert.equal(portionValid(undefined), false);
  assert.equal(portionValid('1'), false);
});

// --- gauge: an env variable positioned against its comfort band --------------

const domain = { min: 0, max: 10 };
const band = { min: 4, max: 6 };

test('gauge marks a value inside the comfort band as ok', () => {
  const g = gauge(5, band, domain);
  assert.equal(g.ok, true);
  assert.equal(g.value, 5);
  assert.equal(g.ratio, 0.5);
});

test('gauge marks values outside the band as not ok, on both sides', () => {
  assert.equal(gauge(3.9, band, domain).ok, false);
  assert.equal(gauge(6.1, band, domain).ok, false);
  assert.equal(gauge(4, band, domain).ok, true); // band edges are comfortable
  assert.equal(gauge(6, band, domain).ok, true);
});

test('gauge reports the band as a fraction of the display domain', () => {
  const g = gauge(5, band, domain);
  assert.equal(g.bandStart, 0.4);
  assert.equal(g.bandEnd, 0.6);
});

test('gauge clamps the ratio to the display domain', () => {
  assert.equal(gauge(-5, band, domain).ratio, 0);
  assert.equal(gauge(99, band, domain).ratio, 1);
});

test('gauge tolerates a degenerate domain without dividing by zero', () => {
  const g = gauge(5, band, { min: 3, max: 3 });
  assert.ok(Number.isFinite(g.ratio));
});

// --- internalsSnapshot: the x-ray data panel's whole model -------------------

/** A farm with a known composter, species, and a couple of queued foods. */
function sampleFarm() {
  let farm = createInitialFarmState({
    seed: 7,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.5,
  });
  farm = { ...farm, population: { cocoons: 12, juveniles: 30, adults: 58 } };
  farm = addFood(farm, 'fruitPeels', 1);
  farm = { ...farm, day: 3 }; // age the first entry by two game days
  farm = addFood(farm, 'meat', 0.5);
  return { ...farm, humus: 3, leachate: 1.5 };
}

test('internalsSnapshot returns null without a farm', () => {
  assert.equal(internalsSnapshot(null), null);
  assert.equal(internalsSnapshot(undefined), null);
});

test('internalsSnapshot reports population by stage plus the total', () => {
  const snap = internalsSnapshot(sampleFarm());
  assert.equal(snap.population.cocoons, 12);
  assert.equal(snap.population.juveniles, 30);
  assert.equal(snap.population.adults, 58);
  assert.equal(snap.population.total, 100);
});

test('internalsSnapshot reports the colony against its carrying capacity', () => {
  const snap = internalsSnapshot(sampleFarm());
  assert.equal(snap.population.capacity, carryingCapacity(getComposter('tier2')));
});

test('internalsSnapshot gauges every env variable against the species bands', () => {
  const farm = sampleFarm();
  const species = getSpecies('californiana');
  const snap = internalsSnapshot(farm);

  assert.equal(snap.env.moisture.value, farm.env.moisture);
  assert.equal(snap.env.moisture.band.min, species.moistureComfort.min);
  assert.equal(snap.env.moisture.band.max, species.moistureComfort.max);

  assert.equal(snap.env.temperature.value, farm.env.temperature);
  assert.equal(snap.env.temperature.band.min, species.tempComfort.min);
  assert.equal(snap.env.temperature.band.max, species.tempComfort.max);

  assert.equal(snap.env.ph.value, farm.env.ph);
  assert.equal(snap.env.toxicity.value, farm.env.toxicity);
});

test('internalsSnapshot flags an env variable that leaves its comfort band', () => {
  const farm = sampleFarm();
  const dry = { ...farm, env: { ...farm.env, moisture: 0.05 } };
  assert.equal(internalsSnapshot(dry).env.moisture.ok, false);
  assert.equal(internalsSnapshot(farm).env.moisture.ok, true);
});

test('internalsSnapshot flags accumulated toxicity as out of band', () => {
  const farm = sampleFarm();
  const toxic = { ...farm, env: { ...farm.env, toxicity: 0.6 } };
  assert.equal(internalsSnapshot(toxic).env.toxicity.ok, false);
  assert.equal(internalsSnapshot(farm).env.toxicity.ok, true);
});

test('internalsSnapshot lists the queue newest-first with age and progress', () => {
  const snap = internalsSnapshot(sampleFarm());
  assert.equal(snap.queue.length, 2);
  assert.equal(snap.queue[0].foodId, 'meat'); // newest first
  assert.equal(snap.queue[1].foodId, 'fruitPeels');
  // The older entry has decomposed further.
  assert.ok(snap.queue[1].ageTicks > snap.queue[0].ageTicks);
  assert.ok(snap.queue[1].decomposed > snap.queue[0].decomposed);
  assert.ok(snap.queue[1].decomposed <= 1);
});

test('internalsSnapshot caps the queue preview and counts what it hid', () => {
  let farm = createInitialFarmState({
    seed: 1,
    composterId: 'tier4', // roomy enough for many portions
    speciesId: 'californiana',
  });
  const total = QUEUE_PREVIEW_LIMIT + 3;
  for (let i = 0; i < total; i++) farm = addFood(farm, 'vegetableScraps', 0.25);

  const snap = internalsSnapshot(farm);
  assert.equal(snap.queue.length, QUEUE_PREVIEW_LIMIT);
  assert.equal(snap.queueHidden, total - QUEUE_PREVIEW_LIMIT);
});

test('internalsSnapshot reports humus and leachate fill against capacity', () => {
  const composter = getComposter('tier2');
  const snap = internalsSnapshot(sampleFarm());

  assert.equal(snap.humus.liters, 3);
  assert.equal(snap.humus.capacity, composter.humusCapacity);
  assert.equal(snap.humus.fill, 3 / composter.humusCapacity);
  assert.equal(snap.humus.full, false);

  assert.equal(snap.leachate.liters, 1.5);
  assert.equal(snap.leachate.capacity, composter.leachateCapacity);
  assert.equal(snap.leachate.fill, 1.5 / composter.leachateCapacity);
});

test('internalsSnapshot marks a full tray and a full tank', () => {
  const composter = getComposter('tier2');
  const farm = {
    ...sampleFarm(),
    humus: composter.humusCapacity,
    leachate: composter.leachateCapacity,
  };
  const snap = internalsSnapshot(farm);
  assert.equal(snap.humus.full, true);
  assert.equal(snap.humus.fill, 1);
  assert.equal(snap.leachate.full, true);
  assert.equal(snap.leachate.fill, 1);
});

test('internalsSnapshot tolerates a farm with no composter or species yet', () => {
  const bare = createInitialFarmState({ seed: 1 });
  const snap = internalsSnapshot(bare);
  assert.equal(snap.population.total, 0);
  assert.equal(snap.humus.capacity, 0);
  assert.equal(snap.humus.fill, 0);
  assert.equal(snap.queue.length, 0);
  assert.ok(Number.isFinite(snap.env.moisture.ratio));
});
