// Composter catalog. PURE data module (no DOM/Three.js). Six models, smallest
// appliance -> largest, per spec §2. All numbers are FIRST-PASS values meant for
// review at CP1 and tuning at T8/T21 — structural relationships (electric
// regulates, buried is stable, larger = more capacity/price) are what matter.
//
// Fields:
//   capacity          total bin volume (L) — bounds the food queue (T4/§2.7)
//   humusCapacity     humus tray max (L) — overflow chain (T6/§2.8)
//   leachateCapacity  leachate tank max (L) — overflow chain (T6/§2.8)
//   speed             processing-speed multiplier for consumption (T6)
//   humusRate         fraction of consumed food converted to humus (T6)
//   leachateRate      fraction of consumed food converted to leachate (T6)
//   tempResponse      0..1 fraction of the gap to the target closed per tick;
//                     high = tracks ambient closely, low = thermally stable (T3)
//   regulation        0..1 active pull of the target toward IDEAL_TEMP; electric
//                     high (heated appliance), passive models 0 (T3)
//   price             purchase cost in coins (economy T7)

/**
 * @typedef {object} Composter
 * @property {string} id
 * @property {number} capacity
 * @property {number} humusCapacity
 * @property {number} leachateCapacity
 * @property {number} speed
 * @property {number} humusRate
 * @property {number} leachateRate
 * @property {number} tempResponse
 * @property {number} regulation
 * @property {number} price
 */

/** @type {readonly Composter[]} shop display order: appliance -> largest */
export const COMPOSTERS = [
  {
    id: 'electric',
    capacity: 20,
    humusCapacity: 8,
    leachateCapacity: 4,
    speed: 1.1,
    humusRate: 0.55,
    leachateRate: 0.2,
    tempResponse: 0.5,
    regulation: 0.9, // heated appliance: actively holds near ideal (its premium)
    price: 350,
  },
  {
    id: 'tier2',
    capacity: 30,
    humusCapacity: 12,
    leachateCapacity: 6,
    speed: 0.8,
    humusRate: 0.5,
    leachateRate: 0.18,
    tempResponse: 0.6, // open tray: tracks ambient closely
    regulation: 0,
    price: 100,
  },
  {
    id: 'tier3',
    capacity: 45,
    humusCapacity: 18,
    leachateCapacity: 9,
    speed: 1.0,
    humusRate: 0.52,
    leachateRate: 0.2,
    tempResponse: 0.45,
    regulation: 0,
    price: 180,
  },
  {
    id: 'tier4',
    capacity: 60,
    humusCapacity: 24,
    leachateCapacity: 12,
    speed: 1.2,
    humusRate: 0.55,
    leachateRate: 0.22,
    tempResponse: 0.35, // more mass -> more thermal inertia
    regulation: 0,
    price: 280,
  },
  {
    id: 'buried',
    capacity: 80,
    humusCapacity: 32,
    leachateCapacity: 16,
    speed: 1.0,
    humusRate: 0.58,
    leachateRate: 0.15, // underground: retains moisture, less runoff
    tempResponse: 0.12, // underground: very thermally stable
    regulation: 0,
    price: 300,
  },
  {
    id: 'eco',
    capacity: 100,
    humusCapacity: 40,
    leachateCapacity: 20,
    speed: 1.4,
    humusRate: 0.6,
    leachateRate: 0.22,
    tempResponse: 0.3,
    regulation: 0.05, // bulky mass gives slight passive buffering
    price: 450,
  },
];

const BY_ID = new Map(COMPOSTERS.map((c) => [c.id, c]));

/**
 * Look up a composter model by id.
 * @param {string|null} id
 * @returns {Composter|null}
 */
export function getComposter(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * All composter models in shop display order.
 * @returns {readonly Composter[]}
 */
export function listComposters() {
  return COMPOSTERS;
}
