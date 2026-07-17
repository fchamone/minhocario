import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/sim/rng.js';

test('same seed produces an identical sequence', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('different seeds diverge', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('next() returns floats in [0, 1)', () => {
  const r = createRng(42);
  for (let i = 0; i < 5000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
  }
});

test('internal state is a serializable number', () => {
  const r = createRng(777);
  r.next();
  assert.equal(typeof r.state, 'number');
  assert.equal(JSON.parse(JSON.stringify(r.state)), r.state);
});

test('resuming from a saved state continues the exact sequence', () => {
  const r = createRng(777);
  for (let i = 0; i < 10; i++) r.next(); // advance mid-stream
  const saved = JSON.parse(JSON.stringify(r.state));
  const expected = Array.from({ length: 5 }, () => r.next());

  const resumed = createRng(saved);
  const actual = Array.from({ length: 5 }, () => resumed.next());
  assert.deepEqual(actual, expected);
});
