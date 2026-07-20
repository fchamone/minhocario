import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_CYCLE } from '../js/render/scene.js';

/**
 * Guards over the day/night lighting table and the x-ray palette's tone-mapping
 * opt-outs. Both became necessary in V14, which introduced ACES tone mapping and
 * deleted the structural safeguards that used to make these properties hold on
 * their own.
 *
 * The render layer imports fine under Node — geometry and plain data need no
 * WebGL — which is the same exception tests/composter3d.test.js already relies
 * on. Nothing here touches a renderer, a canvas or the DOM.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// --- The night floor is now authored, not structural -------------------------
// Before V14 every keyframe went through `litIntensity(curve, floor)`, which
// added a per-light LIGHT_FLOOR on top of the authored value. That floor was the
// documented reason the bin stays readable at midnight: no authored number could
// darken the scene past it, because the floor was added after the fact.
//
// V14 folded floor and gain into the table and deleted litIntensity, so the
// values are now physical units authored directly. That is the right shape — one
// number per light per hour, no hidden remap — but it means the night floor is
// no longer enforced by anything. A later "let's make midnight moodier" edit is
// one keyframe away from a bin nobody can read, and the AC for that
// ("dawn/noon/dusk/midnight all read correctly") is an eyeball check that cannot
// fail in CI.
//
// These are the exact effective values the pre-V14 floor+gain produced at the
// darkest keyframes, so the invariant is preserved at the number it always had
// rather than at a fresh guess.
const NIGHT_FLOOR = { amb: 0.49, total: 1.45 };

test('no keyframe darkens the scene past the night floor', () => {
  for (const k of DAY_CYCLE) {
    const total = k.sunI + k.hemiI + k.ambI;

    assert.ok(
      k.ambI >= NIGHT_FLOOR.amb,
      `h=${k.h} sets ambient to ${k.ambI}, below the ${NIGHT_FLOOR.amb} floor. ` +
        'Ambient is the only light that reaches every surface regardless of the ' +
        "sun's angle, so it is what keeps the bin readable at night.",
    );
    assert.ok(
      total >= NIGHT_FLOOR.total,
      `h=${k.h} totals ${total.toFixed(3)} across the three lights, below the ` +
        `${NIGHT_FLOOR.total} floor that kept midnight legible before V14 folded ` +
        'LIGHT_FLOOR into this table.',
    );
  }
});

// --- V14's fold changed no light intensity (RETIRES on the first re-tune) ----
// V14 does two things at once: it folds LIGHT_FLOOR/LIGHT_GAIN into the table,
// and it adds an ACES curve. Only the second is meant to be visible. Proving the
// first is a no-op is what lets the day/night matrix judge ONE variable instead
// of guessing which of two changes moved a keyframe — the same reason V2a proved
// its token migration against a frozen baseline before V2b retuned by eye.
//
// This is a one-time equivalence check, exactly like that one, and it retires
// the same way: the AC invites re-tuning the table against the curve, and the
// first such edit SHOULD fail this test. Delete it then — do not "fix" it by
// updating the numbers below, which would leave a test that proves nothing.
const PRE_V14 = {
  floor: { sun: 0.12, hemi: 0.35, amb: 0.3 },
  gain: 1.9,
  // The authored legacy-era curve, verbatim from before the fold.
  curve: [
    { h: 0, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
    { h: 5, sunI: 0.14, hemiI: 0.22, ambI: 0.12 },
    { h: 6.5, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
    { h: 9, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
    { h: 12, sunI: 1.0, hemiI: 0.82, ambI: 0.3 },
    { h: 15, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
    { h: 17.5, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
    { h: 19, sunI: 0.16, hemiI: 0.26, ambI: 0.13 },
    { h: 21, sunI: 0.1, hemiI: 0.17, ambI: 0.1 },
    { h: 24, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
  ],
};

test('folding LIGHT_FLOOR/LIGHT_GAIN into the table changed no intensity', () => {
  assert.equal(DAY_CYCLE.length, PRE_V14.curve.length, 'no keyframe added or dropped');

  const lights = [
    ['sunI', 'sun'],
    ['hemiI', 'hemi'],
    ['ambI', 'amb'],
  ];

  for (const [i, old] of PRE_V14.curve.entries()) {
    const now = DAY_CYCLE[i];
    assert.equal(now.h, old.h, `keyframe ${i} changed hour`);

    for (const [field, light] of lights) {
      // The old litIntensity(): floor + GAIN * curve.
      const expected = PRE_V14.floor[light] + PRE_V14.gain * old[field];
      assert.ok(
        Math.abs(now[field] - expected) < 1e-9,
        `h=${old.h} ${field} is ${now[field]}, but the pre-V14 pipeline produced ` +
          `${expected} (${PRE_V14.floor[light]} + ${PRE_V14.gain} x ${old[field]}). ` +
          'If this is a deliberate re-tune against the ACES curve, DELETE this ' +
          'test rather than updating the numbers — it exists to prove the fold ' +
          'was invisible, and it has no meaning once the table is authored by eye.',
      );
    }
  }
});

// --- The table itself stays well-formed --------------------------------------
// V14 retyped all ten keyframes by hand. These are the ways that goes wrong
// without producing an error: an hour out of order (sampleDayCycle scans for a
// bracketing pair and silently falls back to the first/last keyframe if it finds
// none), or a midnight wrap that no longer matches, which makes the cycle jump
// at exactly the moment it should be seamless.

test('the day cycle spans a full day in ascending order', () => {
  assert.equal(DAY_CYCLE[0].h, 0, 'the table must start at hour 0');
  assert.equal(DAY_CYCLE.at(-1).h, 24, 'and run to hour 24 so interpolation wraps');

  for (let i = 1; i < DAY_CYCLE.length; i += 1) {
    assert.ok(
      DAY_CYCLE[i].h > DAY_CYCLE[i - 1].h,
      `keyframe ${i} (h=${DAY_CYCLE[i].h}) does not come after h=${DAY_CYCLE[i - 1].h} — ` +
        'sampleDayCycle scans for a bracketing pair and silently uses the ' +
        'first/last keyframe when it finds none, so an out-of-order hour freezes ' +
        'a stretch of the day instead of throwing',
    );
  }
});

test('midnight wraps cleanly', () => {
  const first = DAY_CYCLE[0];
  const last = DAY_CYCLE.at(-1);

  for (const field of ['sky', 'sun', 'sunI', 'hemiI', 'ambI']) {
    assert.equal(
      last[field],
      first[field],
      `h=24 ${field} must equal h=0 ${field}, or the cycle jumps at midnight — ` +
        'the h=24 row exists only so interpolation wraps through it seamlessly',
    );
  }
});

// --- The x-ray palette opts out of tone mapping as a SET ---------------------
// The internals are deliberately lifted "well above realistic compost browns"
// because no light reaches inside the shell — they are the one thing the player
// opened the x-ray to read. ACES compresses exactly those values, so V14 opts
// them out of tone mapping entirely.
//
// The catch is that they only work as a calibrated SET. `solidMaterial()` covers
// the worms, humus and food chunks, but the leachate liquid is built inline with
// its own material (it stays translucent so the tank reads as wet). Opting out
// the helper alone leaves that one material tone-mapped while everything beside
// it is not — the amber shifts relative to the humus it pools under, which is a
// worse failure than compressing all of them together would have been.
//
// So the rule is about the set, not about one function: anything self-lit in
// this file opts out, or the palette stops agreeing with itself.

/**
 * Every `new MeshStandardMaterial({ ... })` literal in a source, brace-balanced.
 * @param {string} source
 * @returns {string[]} the option-object text of each construction
 */
function standardMaterialLiterals(source) {
  const literals = [];
  const OPEN = 'new MeshStandardMaterial({';

  for (let at = source.indexOf(OPEN); at !== -1; at = source.indexOf(OPEN, at + 1)) {
    let depth = 0;
    let i = at + OPEN.length - 1;
    const start = i;

    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    literals.push(source.slice(start, i + 1));
  }

  return literals;
}

test('every self-lit x-ray material opts out of tone mapping', () => {
  const source = read('../js/render/xray.js');
  const literals = standardMaterialLiterals(source);

  assert.ok(literals.length >= 2, 'xray.js should build more than one material');

  const emissive = literals.filter((l) => /\bemissive\s*:/.test(l));
  assert.ok(
    emissive.length >= 2,
    'the x-ray palette is emissive by design — expected the helper AND the ' +
      'inline leachate material, so this test cannot pass by finding only one',
  );

  for (const literal of emissive) {
    assert.match(
      literal,
      /\btoneMapped\s*:\s*false\b/,
      'an emissive x-ray material does not set `toneMapped: false`. The palette ' +
        'is hand-calibrated as a SET, so one member going through the ACES curve ' +
        `while the rest do not shifts it relative to its neighbours:\n${literal}`,
    );
  }
});

test('the material-literal walker actually detects a violation', () => {
  // Guards the guard (the V6 lesson): prove it finds a material the obvious
  // regex would miss — one built inline rather than through the shared helper,
  // which is exactly how the leachate material escaped the plan's mitigation.
  const planted = `
    function solidMaterial(c) {
      return new MeshStandardMaterial({ color: c, emissive: c, toneMapped: false });
    }
    const liquid = new MeshStandardMaterial({
      color: LEACHATE, emissive: LEACHATE, opacity: 0.72,
    });
  `;
  const found = standardMaterialLiterals(planted);
  assert.equal(found.length, 2, 'both constructions must be seen');
  assert.equal(found.filter((l) => /\btoneMapped\s*:\s*false\b/.test(l)).length, 1);

  // Nested braces must not end the literal early.
  const nested = 'new MeshStandardMaterial({ a: { b: 1 }, emissive: 2 })';
  assert.match(standardMaterialLiterals(nested)[0], /emissive/);
});
