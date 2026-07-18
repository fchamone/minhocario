// Speed control (the game-screen bottom bar) plus the tick-timer math it drives.
// Speed and tick-rate are one concern: the speed multiplier ONLY scales the
// timer (spec §2 — same sim, faster clock), so the pure accumulator helpers live
// here alongside the DOM control, mirroring how shop.js co-locates its pure
// `affordability` with `initShop`.
//
// Layering: a UI module. The pure helpers (SPEEDS, isValidSpeed, drainTicks) are
// Node-testable and touch no DOM; `initSpeed` is the only DOM function.

/** The five speed multipliers, in bottom-bar order (spec §2). */
export const SPEEDS = [0.25, 0.5, 1, 5, 20];

/** The multiplier a fresh game runs at. */
export const DEFAULT_SPEED = 1;

/** Game hours in a day — matches the engine clock (24 ticks = 1 day). */
export const TICKS_PER_DAY = 24;

/**
 * Real milliseconds per tick at 1× speed. 2.5 s/tick × 24 ticks = 60 s per game
 * day (AC); at 20× a day drains in 3 s. Speed divides this, nothing else does.
 */
export const MS_PER_TICK = 2500;

/**
 * Whether `speed` is one of the catalog multipliers.
 * @param {*} speed
 * @returns {boolean}
 */
export function isValidSpeed(speed) {
  return SPEEDS.includes(speed);
}

/**
 * The outcome of draining accumulated real time into whole game ticks.
 * @typedef {object} DrainResult
 * @property {number} ticks      whole ticks to run this frame
 * @property {number} remainderMs sub-tick real ms to carry into the next frame
 * @property {number} fraction   progress toward the next tick, in [0, 1)
 */

/**
 * Convert accumulated real milliseconds into whole game ticks at a given speed.
 * The tick length is `MS_PER_TICK / speed`, so a higher speed produces more ticks
 * from the same elapsed time (speed scales ONLY the timer). The sub-tick leftover
 * is returned as `remainderMs` and MUST be fed back next frame so the clock never
 * drifts. `fraction` is that leftover as a share of one tick — the continuous
 * clock the render layer samples for smooth day/night (T18).
 *
 * A backlog cap (`maxTicks`) guards against a catch-up spiral after a long stall:
 * beyond the cap the excess time is DROPPED (remainder → 0), never simulated in a
 * burst. Pure and deterministic — no timers, no globals.
 * @param {number} accumulatedMs real ms banked since the last drain
 * @param {number} speed a positive multiplier (typically from SPEEDS)
 * @param {{msPerTick?: number, maxTicks?: number}} [opts]
 * @returns {DrainResult}
 */
export function drainTicks(accumulatedMs, speed, opts = {}) {
  const { msPerTick = MS_PER_TICK, maxTicks = Infinity } = opts;
  if (!(accumulatedMs > 0) || !(speed > 0)) {
    return { ticks: 0, remainderMs: 0, fraction: 0 };
  }

  const effective = msPerTick / speed; // real ms per game hour at this speed
  let ticks = Math.floor(accumulatedMs / effective);
  let remainderMs = accumulatedMs - ticks * effective;

  if (ticks > maxTicks) {
    ticks = maxTicks;
    remainderMs = 0; // drop the un-run backlog — no catch-up burst
  }

  return { ticks, remainderMs, fraction: remainderMs / effective };
}

/**
 * Wire the bottom speed bar: highlight the active multiplier and report clicks.
 * The handler is attached once per button (guarded) so re-entering the game
 * screen never stacks listeners; the active-state paint runs every call.
 * @param {object} [deps]
 * @param {number} [deps.initialSpeed=DEFAULT_SPEED] the multiplier to mark active
 * @param {(speed: number) => void} [deps.onSpeedChange] invoked with a valid speed
 */
export function initSpeed({ initialSpeed = DEFAULT_SPEED, onSpeedChange } = {}) {
  const bar = document.getElementById('speed');
  if (!bar) return;
  const buttons = bar.querySelectorAll('[data-speed]');

  const paintActive = (active) => {
    for (const btn of buttons) {
      btn.classList.toggle('is-active', Number(btn.dataset.speed) === active);
    }
  };
  paintActive(initialSpeed);

  for (const btn of buttons) {
    if (btn.dataset.wired) continue;
    btn.addEventListener('click', () => {
      const speed = Number(btn.dataset.speed);
      if (!isValidSpeed(speed)) return;
      paintActive(speed);
      onSpeedChange?.(speed);
    });
    btn.dataset.wired = '1';
  }
}
