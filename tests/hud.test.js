import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatAmount, farmStatus } from '../js/ui/hud.js';

// --- formatTime: the clock reads as two-digit hours (AC: "00h") --------------

test('formatTime renders a zero-padded two-digit hour', () => {
  assert.equal(formatTime(0), '00h');
  assert.equal(formatTime(5), '05h');
  assert.equal(formatTime(13), '13h');
  assert.equal(formatTime(23), '23h');
});

test('formatTime wraps and floors defensively', () => {
  assert.equal(formatTime(24), '00h'); // wraps past a day
  assert.equal(formatTime(9.7), '09h'); // floors a fractional (continuous) hour
});

// --- formatAmount: score/money display as whole numbers ----------------------

test('formatAmount rounds to a whole number', () => {
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(12), '12');
  assert.equal(formatAmount(12.7), '13');
  assert.equal(formatAmount(199.4), '199');
});

test('formatAmount coerces a non-finite amount to 0', () => {
  assert.equal(formatAmount(NaN), '0');
  assert.equal(formatAmount(undefined), '0');
  assert.equal(formatAmount(Infinity), '0');
});

// --- farmStatus: HUD status tracks the sim state (localized key path) ---------

const baseFarm = {
  composterId: 'tier2', // humusCapacity 12, leachateCapacity 6
  colonyAlive: true,
  humus: 0,
  leachate: 0,
  score: 0,
  day: 1,
  hour: 0,
};

test('a healthy farm reads as OK', () => {
  assert.equal(farmStatus(baseFarm), 'game.statusOk');
});

test('a dead colony is surfaced', () => {
  assert.equal(farmStatus({ ...baseFarm, colonyAlive: false }), 'game.statusColonyDead');
});

test('a full humus tray is surfaced (§2.8 processing halt)', () => {
  assert.equal(farmStatus({ ...baseFarm, humus: 12 }), 'game.statusTrayFull');
});

test('a full leachate tank is surfaced (§2.8 backup)', () => {
  assert.equal(farmStatus({ ...baseFarm, leachate: 6 }), 'game.statusTankFull');
});

test('colony death outranks a full tray', () => {
  assert.equal(
    farmStatus({ ...baseFarm, colonyAlive: false, humus: 12 }),
    'game.statusColonyDead',
  );
});

test('a full tray outranks a full tank', () => {
  assert.equal(farmStatus({ ...baseFarm, humus: 12, leachate: 6 }), 'game.statusTrayFull');
});

test('farmStatus tolerates a missing farm / unknown composter', () => {
  assert.equal(farmStatus(null), 'game.statusOk');
  assert.equal(farmStatus({ ...baseFarm, composterId: 'nope' }), 'game.statusOk');
});
