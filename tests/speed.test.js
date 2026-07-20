import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPEEDS,
  DEFAULT_SPEED,
  MS_PER_TICK,
  TICKS_PER_DAY,
  isValidSpeed,
  drainTicks,
  PAUSED,
  isSelectableSpeed,
  clockForColony,
} from '../js/ui/speed.js';

// --- catalog of speeds (spec §2 — 0.25×/0.5×/1×/5×/20×) ----------------------

test('SPEEDS are the five spec multipliers and 1× is the default', () => {
  assert.deepEqual(SPEEDS, [0.25, 0.5, 1, 5, 20]);
  assert.equal(DEFAULT_SPEED, 1);
  assert.ok(SPEEDS.includes(DEFAULT_SPEED));
});

test('isValidSpeed accepts catalog speeds and rejects everything else', () => {
  for (const s of SPEEDS) assert.equal(isValidSpeed(s), true);
  for (const bad of [0, -1, 2, 10, 'fast', null, undefined, NaN]) {
    assert.equal(isValidSpeed(bad), false);
  }
});

// --- the bar's buttons agree with the catalog --------------------------------
// initSpeed reads Number(btn.dataset.speed) and bails on anything isSelectableSpeed
// rejects. That is the right guard at runtime and a silent one in practice: a
// typo'd or retired data-speed leaves a button that looks live, highlights
// nothing and does nothing, with no error anywhere. The bar is hand-written in
// index.html, so nothing else connects the two lists.

test('every [data-speed] button in index.html is a speed the control accepts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const declared = [...html.matchAll(/\bdata-speed="([^"]*)"/g)].map((m) => m[1]);

  assert.equal(
    declared.length,
    SPEEDS.length + 1,
    'the bar should offer the five spec multipliers plus pause',
  );

  for (const raw of declared) {
    assert.ok(
      isSelectableSpeed(Number(raw)),
      `data-speed="${raw}" is neither a catalog multiplier nor pause — initSpeed ` +
        'will ignore the click and the button will look live but do nothing',
    );
  }

  // ...and the other direction: every multiplier is actually reachable.
  const offered = new Set(declared.map(Number));
  for (const speed of [...SPEEDS, PAUSED]) {
    assert.ok(offered.has(speed), `${speed}× is in the catalog but has no button`);
  }
});

// --- tick-rate timing (AC: a game day ≈ 60 s at 1×, ≈ 3 s at 20×) ------------

test('the base tick rate makes a game day last 60 s at 1×', () => {
  // 2.5 s/tick × 24 ticks = 60 s (AC). TICKS_PER_DAY matches the engine clock.
  assert.equal(MS_PER_TICK, 2500);
  assert.equal(TICKS_PER_DAY, 24);
  assert.equal(MS_PER_TICK * TICKS_PER_DAY, 60000);
});

test('a full real-time day drains exactly one game day of ticks at 1×', () => {
  const { ticks, remainderMs } = drainTicks(60000, 1);
  assert.equal(ticks, TICKS_PER_DAY);
  assert.equal(remainderMs, 0);
});

test('at 20× a game day worth of ticks drains in ≈ 3 s', () => {
  // 60000 ms / 20 = 3000 ms of real time for 24 ticks.
  const { ticks, remainderMs } = drainTicks(3000, 20);
  assert.equal(ticks, TICKS_PER_DAY);
  assert.equal(remainderMs, 0);
});

test('speed only scales the timer — it is the sole per-speed knob', () => {
  // Same real ms, different speeds → proportionally more ticks.
  assert.equal(drainTicks(10000, 0.25).ticks, 1); // 10 s/tick at 0.25×
  assert.equal(drainTicks(10000, 0.5).ticks, 2); // 5 s/tick
  assert.equal(drainTicks(10000, 1).ticks, 4); // 2.5 s/tick
  assert.equal(drainTicks(10000, 5).ticks, 20);
  assert.equal(drainTicks(10000, 20).ticks, 80);
});

// --- accumulator semantics (drift-free: the remainder carries forward) --------

test('a sub-tick accumulation fires no tick and carries the whole remainder', () => {
  const { ticks, remainderMs } = drainTicks(2400, 1);
  assert.equal(ticks, 0);
  assert.equal(remainderMs, 2400);
});

test('drain keeps the sub-tick leftover so time never drifts', () => {
  const { ticks, remainderMs } = drainTicks(2 * MS_PER_TICK + 100, 1);
  assert.equal(ticks, 2);
  assert.equal(remainderMs, 100);
});

test('an empty or non-positive accumulator drains nothing', () => {
  assert.deepEqual(drainTicks(0, 1), { ticks: 0, remainderMs: 0, fraction: 0 });
  assert.deepEqual(drainTicks(-500, 1), { ticks: 0, remainderMs: 0, fraction: 0 });
  // a non-positive speed cannot advance the clock
  assert.equal(drainTicks(9999, 0).ticks, 0);
});

// --- continuous-clock fraction (exposed for the render layer, T18) -----------

test('fraction is the sub-tick progress toward the next hour, in [0, 1)', () => {
  // half of one effective tick at 20× (125 ms/tick) → fraction 0.5, no tick yet.
  const half = drainTicks(62.5, 20);
  assert.equal(half.ticks, 0);
  assert.ok(Math.abs(half.fraction - 0.5) < 1e-9);
  // exactly on a tick boundary → fraction resets to 0.
  assert.equal(drainTicks(MS_PER_TICK, 1).fraction, 0);
});

// --- backlog cap (no catch-up spiral after a stall) --------------------------

test('maxTicks caps a huge backlog and drops the excess (no catch-up)', () => {
  const { ticks, remainderMs } = drainTicks(1_000_000, 20, { maxTicks: 5 });
  assert.equal(ticks, 5);
  assert.equal(remainderMs, 0, 'the un-run backlog is discarded, not carried');
});

// --- Pause (a distinct control, not a sixth multiplier) ----------------------
// The spec lists five multipliers, so PAUSED stays OUT of SPEEDS and out of
// isValidSpeed; the bottom bar offers it alongside them via isSelectableSpeed.

test('PAUSED is zero and is not one of the spec multipliers', () => {
  assert.equal(PAUSED, 0);
  assert.equal(SPEEDS.includes(PAUSED), false);
  assert.equal(isValidSpeed(PAUSED), false);
});

test('isSelectableSpeed accepts the multipliers AND pause', () => {
  for (const s of SPEEDS) assert.equal(isSelectableSpeed(s), true);
  assert.equal(isSelectableSpeed(PAUSED), true);
  for (const bad of [-1, 2, 10, 'fast', null, undefined, NaN]) {
    assert.equal(isSelectableSpeed(bad), false);
  }
});

test('a paused clock drains no ticks however long the tab runs', () => {
  assert.deepEqual(drainTicks(60000, PAUSED), { ticks: 0, remainderMs: 0, fraction: 0 });
  assert.deepEqual(drainTicks(1_000_000, PAUSED), { ticks: 0, remainderMs: 0, fraction: 0 });
});

test('pause banks no backlog, so resuming does not burst-simulate', () => {
  // The frame loop feeds remainderMs back in; pause must return 0 so a long
  // pause cannot be reinterpreted as a pile of ticks the moment speed resumes.
  const paused = drainTicks(500_000, PAUSED);
  assert.equal(paused.remainderMs, 0);
  assert.equal(drainTicks(paused.remainderMs, 1).ticks, 0);
});

// --- Colony death stops the clock (T15 follow-up) ----------------------------
// A dead colony produces nothing, so letting the clock run just burns game days.
// The rule: pause on the death transition, restore the previous speed when the
// colony is revived, and never act except on a transition.

test('clockForColony pauses the clock when the colony dies', () => {
  const next = clockForColony({ alive: false, wasAlive: true, speed: 5, resumeSpeed: 1 });
  assert.equal(next.speed, PAUSED);
  assert.equal(next.resumeSpeed, 5, 'the speed at death is what we resume to');
});

test('clockForColony restores the pre-death speed when the colony revives', () => {
  const next = clockForColony({ alive: true, wasAlive: false, speed: PAUSED, resumeSpeed: 20 });
  assert.equal(next.speed, 20);
});

test('clockForColony never records PAUSED as the speed to resume to', () => {
  // Dying while already paused must not strand the player at 0× after reviving.
  const next = clockForColony({ alive: false, wasAlive: true, speed: PAUSED, resumeSpeed: 5 });
  assert.equal(next.speed, PAUSED);
  assert.notEqual(next.resumeSpeed, PAUSED);
  assert.equal(next.resumeSpeed, DEFAULT_SPEED);
});

test('clockForColony leaves a steady state alone', () => {
  // No transition → the player's own speed choice is never overridden.
  const running = { alive: true, wasAlive: true, speed: 20, resumeSpeed: 1 };
  assert.deepEqual(clockForColony(running), { speed: 20, resumeSpeed: 1 });

  const stillDead = { alive: false, wasAlive: false, speed: 5, resumeSpeed: 1 };
  assert.deepEqual(clockForColony(stillDead), { speed: 5, resumeSpeed: 1 });
});

test('clockForColony lets the player resume time on a still-dead colony', () => {
  // Un-pausing a dead colony is allowed (the env keeps evolving); the rule only
  // fires on transitions, so the manual choice sticks.
  const next = clockForColony({ alive: false, wasAlive: false, speed: 1, resumeSpeed: 1 });
  assert.equal(next.speed, 1);
});
