import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNickname,
  topRanking,
  rankingEntry,
  displayRanking,
  freezeRun,
} from '../js/ui/home.js';
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

// --- Run lifecycle: the ranking (T15) ----------------------------------------
//
// Design note: the stored `ranking` holds ONLY frozen (finished) runs. The live
// run is derived from `save.farm` at render time, so a running farm needs no
// per-tick ranking write and no farm-identity field in the save schema — the
// live row simply IS the current farm, and restarting is what freezes it.

test('rankingEntry summarizes a farm as a ranking row', () => {
  const farm = { score: 123.4, day: 7 };
  assert.deepEqual(rankingEntry(farm, 'MinhocaVeloz42'), {
    nickname: 'MinhocaVeloz42',
    score: 123,
    daysSurvived: 7,
  });
});

test('rankingEntry tolerates a missing nickname or farm fields', () => {
  assert.deepEqual(rankingEntry({}, undefined), {
    nickname: '',
    score: 0,
    daysSurvived: 0,
  });
});

test('displayRanking merges the LIVE farm in with the frozen runs', () => {
  const save = {
    profile: { nickname: 'Live' },
    farm: { score: 500, day: 3 },
    ranking: [{ nickname: 'Old', score: 900, daysSurvived: 20 }],
  };
  const rows = displayRanking(save);
  assert.deepEqual(rows.map((r) => r.nickname), ['Old', 'Live']);
  assert.equal(rows[1].score, 500, 'the live run appears without being persisted');
});

test('displayRanking tracks the live score as it climbs (high-water by monotonicity)', () => {
  const base = { profile: { nickname: 'Live' }, ranking: [] };
  const early = displayRanking({ ...base, farm: { score: 10, day: 1 } });
  const later = displayRanking({ ...base, farm: { score: 250, day: 9 } });
  assert.equal(early[0].score, 10);
  assert.equal(later[0].score, 250);
  assert.equal(later[0].daysSurvived, 9);
});

test('displayRanking shows only frozen rows when no farm is running', () => {
  const save = { profile: { nickname: 'N' }, farm: null, ranking: [{ nickname: 'Old', score: 5 }] };
  assert.deepEqual(displayRanking(save).map((r) => r.nickname), ['Old']);
});

test('displayRanking is empty for a fresh profile', () => {
  assert.deepEqual(displayRanking({ profile: { nickname: 'N' }, farm: null, ranking: [] }), []);
  assert.deepEqual(displayRanking(null), []);
});

test('freezeRun turns the live farm into a permanent ranking row', () => {
  const save = {
    profile: { nickname: 'Runner', wallet: 50 },
    farm: { score: 400, day: 12 },
    ranking: [{ nickname: 'Old', score: 900, daysSurvived: 20 }],
  };
  const frozen = freezeRun(save);

  assert.equal(frozen.farm, null, 'the run is over — no live farm remains');
  assert.equal(frozen.ranking.length, 2);
  assert.deepEqual(frozen.ranking[1], { nickname: 'Runner', score: 400, daysSurvived: 12 });
  assert.equal(frozen.profile.nickname, 'Runner', 'the player identity survives a restart');
});

test('freezeRun does not mutate the save it is given', () => {
  const save = { profile: { nickname: 'R' }, farm: { score: 1, day: 1 }, ranking: [] };
  const snapshot = JSON.parse(JSON.stringify(save));
  freezeRun(save);
  assert.deepEqual(save, snapshot);
});

test('freezeRun is a no-op when there is no run to freeze', () => {
  const save = { profile: { nickname: 'R' }, farm: null, ranking: [] };
  assert.equal(freezeRun(save), save);
});

test('a frozen row stops moving while the next run climbs past it', () => {
  // The AC: restarting freezes the old row, and the new run ranks separately.
  let save = {
    profile: { nickname: 'R' },
    farm: { score: 100, day: 5 },
    ranking: [],
  };
  save = freezeRun(save);
  save = { ...save, farm: { score: 800, day: 2 } }; // a new run, already ahead

  const rows = displayRanking(save);
  assert.equal(rows.length, 2, 'both runs are listed');
  assert.deepEqual(rows.map((r) => r.score), [800, 100]);
  assert.equal(save.ranking.length, 1, 'only the finished run is persisted');
});
