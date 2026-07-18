import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNickname, topRanking } from '../js/ui/home.js';
import { NICKNAME_ANIMALS, NICKNAME_ADJECTIVES } from '../js/strings.js';

// A deterministic stand-in for Math.random: returns the queued values in order
// (wrapping), so nickname composition is fully assertable.
function seqRand(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// --- buildNickname (pure; randomness injected) -------------------------------

test('buildNickname composes animal + adjective + a two-digit number', () => {
  // draws: animal index, adjective index, number offset — all 0 here.
  const nick = buildNickname(seqRand([0, 0, 0]));
  assert.equal(nick, `${NICKNAME_ANIMALS[0]}${NICKNAME_ADJECTIVES[0]}10`);
});

test('buildNickname selects words and number from the injected draws', () => {
  // last animal (draw ~1), first adjective (draw 0), number 10 + floor(.5×90)=55
  const rand = seqRand([0.999999, 0.0, 0.5]);
  const expected = `${NICKNAME_ANIMALS[NICKNAME_ANIMALS.length - 1]}${NICKNAME_ADJECTIVES[0]}55`;
  assert.equal(buildNickname(rand), expected);
});

test('buildNickname always matches Word+Word+2-digit shape (default Math.random)', () => {
  for (let i = 0; i < 25; i++) {
    assert.match(buildNickname(), /^\D+\d{2}$/);
  }
});

// --- topRanking (pure) -------------------------------------------------------

test('topRanking sorts by score descending and caps at the limit', () => {
  const entries = [
    { nickname: 'A', score: 10 },
    { nickname: 'B', score: 50 },
    { nickname: 'C', score: 30 },
  ];
  assert.deepEqual(topRanking(entries, 2).map((e) => e.nickname), ['B', 'C']);
});

test('topRanking defaults to a top-10 cap', () => {
  const entries = Array.from({ length: 15 }, (_, i) => ({ nickname: `N${i}`, score: i }));
  const top = topRanking(entries);
  assert.equal(top.length, 10);
  assert.equal(top[0].score, 14, 'highest score first');
  assert.equal(top[9].score, 5, 'tenth place is the 10th-highest');
});

test('topRanking does not mutate its input', () => {
  const entries = [
    { nickname: 'A', score: 1 },
    { nickname: 'B', score: 2 },
  ];
  const snapshot = JSON.parse(JSON.stringify(entries));
  topRanking(entries);
  assert.deepEqual(entries, snapshot);
});

test('topRanking tolerates an empty or missing list', () => {
  assert.deepEqual(topRanking([]), []);
  assert.deepEqual(topRanking(undefined), []);
  assert.deepEqual(topRanking(null), []);
});
