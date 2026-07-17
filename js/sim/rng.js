// Seeded pseudo-random number generator for the simulation.
// PURE module: no DOM, no browser globals. All simulation randomness MUST flow
// through an instance of this — never Math.random() inside js/sim/ (see CLAUDE.md).
//
// Algorithm: mulberry32 — a fast 32-bit generator whose whole internal state is
// a single unsigned integer, so it serializes into the farm state and resuming
// from a saved state continues the exact same sequence (deterministic save/load).

/**
 * @typedef {object} Rng
 * @property {number} state serializable uint32 internal state
 * @property {() => number} next next float in [0, 1)
 */

/**
 * Create a seeded RNG.
 * @param {number} seed initial 32-bit state (any integer; coerced to uint32)
 * @returns {Rng}
 */
export function createRng(seed) {
  return {
    state: seed >>> 0,
    next() {
      this.state = (this.state + 0x6d2b79f5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
