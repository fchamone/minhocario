// Setup screen: the guided preparation before a farm starts — pick a species,
// tune the (pre-filled) bedding mix, choose the first waste from the unlabeled
// list, and place the composter on the wall. Confirming hands the gathered
// choices to `onConfirm`; main.js turns them into a farm and saves it.
//
// Layering: a UI module. Display copy comes through the i18n runtime; the
// species/food catalogs and the guided bedding amounts come from the pure sim
// layer. The bedding mix → moisture/pH math lives in the sim (`beddingEnv`,
// engine-tested) — this module only reads the numbers off the form. `document`
// is touched only inside these functions.
//
// The first-waste list carries NO suitability hint (§2.7): names only, in raw
// catalog order, with no grouping or labels — discovery is the gameplay.

import { t } from '../strings.js';
import { listSpecies } from '../sim/worms.js';
import { listFoods } from '../sim/foods.js';
import { MIN_PORTION_LITERS, RECOMMENDED_BEDDING } from '../sim/engine.js';

/** Default first-waste portion, in liters (a friendly starting amount). */
const DEFAULT_FIRST_WASTE_LITERS = 1;

/** The three bedding components, paired with their string keys, in mix order. */
const BEDDING_FIELDS = [
  { key: 'sawdust', label: 'setup.beddingSawdust' },
  { key: 'peels', label: 'setup.beddingPeels' },
  { key: 'cardboard', label: 'setup.beddingCardboard' },
];

/** Callback invoked with the gathered choices on confirm. @type {?Function} */
let confirmHandler = null;

/**
 * Render the species radio list into `container`. The first species is selected
 * by default. Each row shows the localized name, the Latin (neutral) name, the
 * archetype description, and the pack price.
 * @param {HTMLElement} container
 */
function renderSpecies(container) {
  container.replaceChildren();
  listSpecies().forEach((species, i) => {
    const label = document.createElement('label');
    label.className = 'setup-species';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'species';
    radio.value = species.id;
    if (i === 0) radio.checked = true;

    const body = document.createElement('span');
    body.className = 'setup-species__body';

    const name = document.createElement('strong');
    name.textContent = t(`worms.${species.id}.name`);

    const latin = document.createElement('em');
    latin.className = 'setup-species__latin';
    latin.textContent = species.latin;

    const desc = document.createElement('span');
    desc.className = 'setup-species__desc';
    desc.textContent = t(`worms.${species.id}.desc`);

    const price = document.createElement('span');
    price.className = 'setup-species__price';
    price.textContent = `${species.price} ${t('common.coins')}`;

    body.append(name, latin, desc, price);
    label.append(radio, body);
    container.appendChild(label);
  });
}

/**
 * Render the three bedding-amount inputs, pre-filled with the guided mix.
 * @param {HTMLElement} container
 */
function renderBedding(container) {
  container.replaceChildren();
  for (const { key, label } of BEDDING_FIELDS) {
    const row = document.createElement('label');
    row.className = 'setup-bedding__row';

    const caption = document.createElement('span');
    caption.textContent = `${t(label)} (${t('common.liters')})`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.5';
    input.value = String(RECOMMENDED_BEDDING[key]);
    input.dataset.bedding = key;

    row.append(caption, input);
    container.appendChild(row);
  }
}

/**
 * Render the first-waste picker: a name-only select over the raw food catalog
 * (no suitability signal) plus an amount input.
 * @param {HTMLElement} container
 */
function renderWaste(container) {
  container.replaceChildren();

  const select = document.createElement('select');
  select.id = 'setup-waste-food';
  for (const food of listFoods()) {
    const option = document.createElement('option');
    option.value = food.id;
    option.textContent = t(`foods.${food.id}.name`);
    select.appendChild(option);
  }

  const amountRow = document.createElement('label');
  amountRow.className = 'setup-waste__amount';
  const amountCaption = document.createElement('span');
  amountCaption.textContent = `${t('setup.amountLabel')} (${t('common.liters')})`;
  const amount = document.createElement('input');
  amount.type = 'number';
  amount.id = 'setup-waste-liters';
  amount.min = String(MIN_PORTION_LITERS);
  amount.step = '0.25';
  amount.value = String(DEFAULT_FIRST_WASTE_LITERS);
  amountRow.append(amountCaption, amount);

  container.append(select, amountRow);
}

/**
 * Read the current form values into the shape `onConfirm` expects.
 * @returns {{speciesId: string, bedding: import('../sim/engine.js').BeddingMix,
 *   firstWasteId: string, firstWasteLiters: number, wallPosition: number}}
 */
function gatherValues() {
  const checked = document.querySelector('input[name="species"]:checked');
  const speciesId = checked ? checked.value : listSpecies()[0].id;

  const bedding = {};
  for (const { key } of BEDDING_FIELDS) {
    const input = document.querySelector(`input[data-bedding="${key}"]`);
    const n = input ? parseFloat(input.value) : NaN;
    bedding[key] = Number.isFinite(n) && n > 0 ? n : 0;
  }

  const foodSel = document.getElementById('setup-waste-food');
  const litersEl = document.getElementById('setup-waste-liters');
  const firstWasteId = foodSel ? foodSel.value : null;
  const liters = litersEl ? parseFloat(litersEl.value) : NaN;
  const firstWasteLiters = Number.isFinite(liters) ? liters : DEFAULT_FIRST_WASTE_LITERS;

  const placement = document.getElementById('setup-placement');
  const wallPosition = placement ? parseFloat(placement.value) : 0.5;

  return { speciesId, bedding, firstWasteId, firstWasteLiters, wallPosition };
}

/**
 * (Re)render the setup form and wire the confirm submit. Re-entering the screen
 * re-populates the dynamic fields and refreshes the confirm callback; the form's
 * submit listener is attached exactly once (guarded) so it never stacks.
 * @param {{onConfirm: (values: object) => void}} deps
 */
export function initSetup({ onConfirm }) {
  confirmHandler = onConfirm;

  const species = document.getElementById('setup-species');
  const bedding = document.getElementById('setup-bedding');
  const waste = document.getElementById('setup-waste');
  const form = document.getElementById('setup-form');
  if (species) renderSpecies(species);
  if (bedding) renderBedding(bedding);
  if (waste) renderWaste(waste);

  if (form && !form.dataset.wired) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      confirmHandler?.(gatherValues());
    });
    form.dataset.wired = '1';
  }
}
