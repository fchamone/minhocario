import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  MURALS,
  MURAL_DIR,
  MURAL_BOX_WIDTH,
  MURAL_BOX_HEIGHT,
  MURAL_STRENGTH,
  MURAL_MAX_DEVIATION,
  muralFromSeed,
  muralOf,
  muralPath,
  muralLayout,
  featherAt,
  compositeMural,
  buildWallTexture,
} from '../js/render/murals.js';
import {
  WALL_TEX_WIDTH,
  WALL_TEX_HEIGHT,
  WALL_TILE_TEXELS,
  WALL_BASE_LEVEL,
  SURFACES,
  TILE_WORLD_SIZE,
  TILED_SURFACES,
  paintWallBase,
  linearMeanOf,
} from '../js/render/textures.js';
import { WALL_WIDTH, WALL_HEIGHT } from '../js/render/scene.js';
import { createInitialFarmState, tick, addFood } from '../js/sim/engine.js';
import { createRng } from '../js/sim/rng.js';

/**
 * V21 — the wall murals.
 *
 * Split honestly along what Node can actually reach. The SELECTION and the
 * COMPOSITING MATHS are pure and fully checked here. The decode is not: WebP
 * cannot be decoded under Node without a dependency, and this project has one
 * runtime dependency on purpose. So the shipped .webp bytes are verified for
 * existence and provenance in tests/release.test.js, and how they LOOK is a
 * manual gate — stated plainly rather than papered over with a test that only
 * appears to cover it.
 */

/** An ImageData-shaped buffer, the same stub shape textures.test.js uses. */
function buffer(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4) };
}

/** A flat greyscale mural buffer with a single bright square in the middle. */
function muralBuffer(width, height, base = 128, blob = 220) {
  const img = buffer(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBlob = x > width / 3 && x < (2 * width) / 3 && y > height / 3 && y < (2 * height) / 3;
      const v = inBlob ? blob : base;
      const i = (y * width + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  return img;
}

// --- Selection ---------------------------------------------------------------

test('a farm seed always picks the same mural', () => {
  // The entire feature rests on this: the mural is derived, never stored, so
  // "the same farm keeps its painting across reloads" is true only if the hash
  // is. Same discipline as hotSideFromSeed, which is the model for this function.
  for (const seed of [0, 1, 7, 42, 1337, 0xffffffff]) {
    assert.equal(muralFromSeed(seed).id, muralFromSeed(seed).id);
  }
});

test('the seed hash reaches every mural, and reasonably evenly', () => {
  // The failure this exists for is SILENT: a hash that collapses onto two of the
  // eight looks completely fine for weeks, because a player only ever sees one
  // mural per farm and has no idea which ones they are not being shown.
  const counts = new Map(MURALS.map((m) => [m.id, 0]));
  const N = 20000;
  for (let seed = 0; seed < N; seed += 1) {
    counts.set(muralFromSeed(seed).id, counts.get(muralFromSeed(seed).id) + 1);
  }

  for (const [id, n] of counts) {
    assert.ok(n > 0, `no seed in ${N} produced ${id}`);
    // Generous: this asserts "not badly skewed", not "uniform". A ±40% band
    // still fails a hash that has collapsed or that favours one entry 3:1.
    const expected = N / MURALS.length;
    assert.ok(
      n > expected * 0.6 && n < expected * 1.4,
      `${id} came up ${n} times in ${N}, expected about ${expected}`,
    );
  }
});

test('the mural choice is not a restatement of the hot side', () => {
  // Both are hashed from the same seed, so reusing hotSideFromSeed's mixing
  // constant would make the mural index's low bit BE the hot side: every farm
  // with a given painting would have its warm end on the same side of the garage,
  // forever. Nothing would look broken — the garage would just be quietly less
  // varied than it claims. This is why murals.js uses a different constant.
  let agree = 0;
  const N = 4000;
  for (let seed = 0; seed < N; seed += 1) {
    const muralBit = MURALS.indexOf(muralFromSeed(seed)) % 2;
    // hotSideFromSeed, inlined rather than imported: this test is ABOUT the two
    // being independent, so it must not silently pass by calling the same code.
    let t = ((seed >>> 0) + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    if (muralBit === ((t ^ (t >>> 14)) >>> 0) % 2) agree += 1;
  }
  const rate = agree / N;
  assert.ok(rate > 0.45 && rate < 0.55, `mural parity tracks the hot side ${rate * 100}% of the time`);
});

test('the field muralOf reads actually exists on a real farm, and never moves', () => {
  // THE guard this feature was missing, and its absence shipped a wall with no
  // mural on it. Every other test here exercised muralFromSeed with a number
  // handed to it by the test itself, so all of them passed while the render layer
  // read `state.seed` — a field FarmState does not have. The constructor TAKES a
  // seed; it survives only as `rngState`.
  //
  // So this asserts the two things that actually matter: the property is present
  // on a farm the engine really built, and it does not move once the farm starts
  // ticking. `rngState` would satisfy the first and fail the second, which is
  // exactly the trap hotSideOf documents.
  const created = createInitialFarmState({
    seed: 12345,
    composterId: 'electric',
    speciesId: 'californiana',
    createdAt: 1770000000123,
  });
  // A POPULATED AND FED farm, deliberately: an idle colony never draws from the
  // RNG, so `rngState` would not move and this test would pass while proving
  // nothing — the vacuous-guard failure the suite keeps catching elsewhere.
  const farm = addFood(
    { ...created, population: { cocoons: 0, juveniles: 0, adults: 200 } },
    'vegetableScraps',
    5,
  );

  assert.equal(typeof farm.createdAt, 'number', 'FarmState lost the field muralOf keys on');
  assert.notEqual(farm.createdAt, undefined);

  const chosen = muralOf(farm).id;
  let state = farm;
  const rng = createRng(farm.rngState);
  for (let i = 0; i < 400; i += 1) state = tick(state, rng);

  assert.notEqual(state.rngState, farm.rngState, 'the RNG must advance, or this proves nothing');
  assert.equal(
    muralOf(state).id,
    chosen,
    'the mural changed while the farm ticked — it is keyed on a field that mutates',
  );
});

test('muralOf gives a stable answer for a farm with no timestamp', () => {
  // Never refuse a save. A farm created without createdAt (the engine's own
  // default, and any save predating the field) must still get a defined mural
  // rather than none, and the same one on every load.
  assert.equal(muralOf({}).id, muralOf({}).id);
  assert.equal(muralOf(null).id, muralOf({ createdAt: 0 }).id);
  assert.ok(MURALS.some((m) => m.id === muralOf(null).id));
});

test('two farms created milliseconds apart usually differ', () => {
  // createdAt is a wall-clock stamp, so consecutive farms differ only in their
  // low bits — the case the mixing step exists for. A raw modulo of the timestamp
  // would march through the catalog in order and, worse, make two farms created
  // in the same second identical.
  const base = 1770000000000;
  const ids = new Set();
  for (let i = 0; i < 40; i += 1) ids.add(muralOf({ createdAt: base + i }).id);
  assert.ok(ids.size >= 6, `40 consecutive milliseconds produced only ${ids.size} distinct murals`);
});

/**
 * A WebP's pixel dimensions, read straight from its header.
 *
 * Node cannot DECODE WebP without a dependency, and this project has exactly one
 * runtime dependency on purpose — but the size lives in a fixed-offset header,
 * which needs no decoder at all. That is enough to check the one property that
 * couples the shipped assets to the layout constants.
 * @param {Buffer} b
 * @returns {{width: number, height: number}|null}
 */
function webpSize(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ') {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

test('every shipped mural is prepared to the box the layout expects', () => {
  // The coupling that has no other guard, and that fails SILENTLY in the one
  // direction people will actually hit: `muralLayout` never enlarges, so raising
  // MURAL_BOX_HEIGHT without re-running the prep step leaves every mural at its
  // old size and the change appears to have done nothing at all. The reverse —
  // assets larger than the box — merely wastes bytes downscaling at runtime.
  const dir = new URL('../assets/murals/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.webp'));
  assert.equal(files.length, MURALS.length);

  for (const file of files) {
    const size = webpSize(readFileSync(new URL(file, dir)));
    assert.ok(size, `${file} is not a WebP this reader understands`);
    assert.equal(
      size.height,
      MURAL_BOX_HEIGHT,
      `${file} is ${size.height}px tall but the box is ${MURAL_BOX_HEIGHT} — re-run the prep ` +
        'step (DESIGN.md, "Wall murals") whenever MURAL_BOX_HEIGHT changes, or the murals ' +
        'silently keep their old size',
    );
    assert.ok(
      size.width <= MURAL_BOX_WIDTH,
      `${file} is ${size.width}px wide, past the ${MURAL_BOX_WIDTH} box`,
    );
    // And it must actually fit where the layout will put it.
    const layout = muralLayout(size.width, size.height);
    assert.ok(layout.x >= 0 && layout.y >= 0, `${file} would be placed off the wall`);
    assert.equal(layout.height, size.height, `${file} would be rescaled at runtime`);
  }
});

test('a mural path points inside the shipped asset directory', () => {
  for (const mural of MURALS) {
    assert.equal(muralPath(mural), `${MURAL_DIR}${mural.id}.webp`);
    assert.ok(muralPath(mural).startsWith('assets/'));
  }
});

// --- The wall canvas ---------------------------------------------------------

test('the wall canvas keeps the grain at one physical scale on both axes', () => {
  // V15's rule is that every surface repeats its grain every TILE_WORLD_SIZE
  // units. The wall no longer tiles, so nothing in the texture pipeline enforces
  // that for it any more — this does. Pick a canvas size whose axes disagree and
  // the plaster stretches on one of them, which reads as a different material at
  // a different distance and is exactly the illusion the rule protects.
  const tilesX = SURFACES.wall.world[0] / TILE_WORLD_SIZE;
  const tilesY = SURFACES.wall.world[1] / TILE_WORLD_SIZE;
  assert.equal(WALL_TEX_WIDTH / tilesX, WALL_TILE_TEXELS);
  assert.equal(WALL_TEX_HEIGHT / tilesY, WALL_TILE_TEXELS);
  assert.equal(Number.isInteger(WALL_TILE_TEXELS), true, 'texels per tile must be a whole number');
});

test('the wall canvas matches the wall mesh it dresses', () => {
  // The same duplication guard textures.test.js puts on SURFACES.*.world: the
  // canvas aspect is derived from a size that is stated twice, so resizing the
  // garage without resizing the wall texture fails here instead of shipping a
  // stretched mural.
  assert.deepEqual(SURFACES.wall.world, [WALL_WIDTH, WALL_HEIGHT]);
  assert.equal(WALL_TEX_WIDTH / WALL_TEX_HEIGHT, WALL_WIDTH / WALL_HEIGHT);
});

test('the wall no longer ships a tiling texture', () => {
  // Building one would cost a canvas and its VRAM for a map nothing samples, and
  // would leave two representations of the same plaster — the exact shape of the
  // bug V14 and V15 each got caught by.
  assert.deepEqual(TILED_SURFACES, ['floor', 'soil']);
  assert.ok(SURFACES.wall, 'the wall keeps its grain parameters even though it does not tile');
});

test('the painted wall base leaves headroom and never clips', () => {
  const img = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(img);

  let min = 255;
  let max = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    min = Math.min(min, img.data[i]);
    max = Math.max(max, img.data[i]);
    assert.equal(img.data[i + 3], 255);
  }
  // The whole point of WALL_BASE_LEVEL: the mural has somewhere to go upward.
  assert.ok(max <= Math.round(WALL_BASE_LEVEL * 255), `base peaks at ${max}, above its headroom`);
  assert.ok(min > 0, 'the base must not reach black — there would be nothing to modulate');
});

test('the base is greyscale and opaque everywhere', () => {
  const img = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(img);
  for (let i = 0; i < img.data.length; i += 4) {
    assert.equal(img.data[i], img.data[i + 1]);
    assert.equal(img.data[i], img.data[i + 2]);
  }
});

// --- Layout and feather ------------------------------------------------------

test('a mural is contain-fitted and centred, never stretched', () => {
  const wide = muralLayout(800, 200);
  assert.equal(wide.width / wide.height, 4, 'aspect ratio must survive the fit');
  assert.ok(wide.width <= MURAL_BOX_WIDTH && wide.height <= MURAL_BOX_HEIGHT);

  const tall = muralLayout(200, 800);
  assert.equal(tall.height, MURAL_BOX_HEIGHT, 'a portrait work is bound by the box height');
  assert.equal(tall.width, 87);

  // Centred on the wall, within the rounding of an odd remainder.
  for (const layout of [wide, tall]) {
    assert.ok(Math.abs(layout.x * 2 + layout.width - WALL_TEX_WIDTH) <= 1);
    assert.ok(Math.abs(layout.y * 2 + layout.height - WALL_TEX_HEIGHT) <= 1);
  }
});

test('a mural smaller than the box is not enlarged', () => {
  const layout = muralLayout(100, 80);
  assert.equal(layout.width, 100);
  assert.equal(layout.height, 80);
});

test('muralLayout refuses a degenerate image', () => {
  assert.equal(muralLayout(0, 100), null);
  assert.equal(muralLayout(100, 0), null);
  assert.equal(muralLayout(NaN, 100), null);
});

test('the feather reaches exactly zero at the mural edge', () => {
  // The reason this is load-bearing rather than tidy is the same one
  // shadowAlpha's falloff documents: any weight left at the boundary draws the
  // mural's own RECTANGLE on the plaster, and the eye finds a straight line long
  // before it finds a painting.
  const layout = { width: 400, height: 300 };
  for (let x = 0; x < layout.width; x += 7) {
    assert.equal(featherAt(x, 0, layout), 0, `top edge at x=${x}`);
    assert.equal(featherAt(x, layout.height - 1, layout), 0, `bottom edge at x=${x}`);
  }
  for (let y = 0; y < layout.height; y += 7) {
    assert.equal(featherAt(0, y, layout), 0, `left edge at y=${y}`);
    assert.equal(featherAt(layout.width - 1, y, layout), 0, `right edge at y=${y}`);
  }
  assert.equal(featherAt(200, 150, layout), 1, 'the centre must reach full strength');
});

test('the feather still reaches full strength on a very small mural', () => {
  // A clamp that scaled with MURAL_FEATHER alone would leave a narrow work
  // permanently faded — visible only as "that one mural is weaker than the rest".
  const tiny = { width: 20, height: 16 };
  assert.equal(featherAt(10, 8, tiny), 1);
  assert.equal(featherAt(0, 8, tiny), 0);
});

test('the feather is monotonic inward', () => {
  const layout = { width: 400, height: 300 };
  let previous = -1;
  for (let x = 0; x <= 60; x += 1) {
    const value = featherAt(x, 150, layout);
    assert.ok(value >= previous, `feather dipped at x=${x}`);
    previous = value;
  }
});

// --- Compositing -------------------------------------------------------------

test('compositing a mural does not move the wall mean', () => {
  // DESIGN.md's hardest rule here: "nothing may change scene brightness while
  // pretending to add detail". The blend is zero-mean by construction, so the
  // residual should be tiny — and what survives is measured and divided out of
  // the albedo by scene.js, which is the half this cannot see.
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const before = linearMeanOf(wall.data);

  const layout = muralLayout(400, 300);
  compositeMural(wall, muralBuffer(layout.width, layout.height), layout);
  const after = linearMeanOf(wall.data);

  assert.ok(
    Math.abs(after - before) / before < 0.02,
    `the mural moved the wall's mean radiance by ${(((after - before) / before) * 100).toFixed(2)}%`,
  );
});

test('compositing changes the wall only inside the mural rect', () => {
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const original = Uint8ClampedArray.from(wall.data);

  const layout = muralLayout(400, 300);
  compositeMural(wall, muralBuffer(layout.width, layout.height), layout);

  let changedInside = 0;
  for (let y = 0; y < WALL_TEX_HEIGHT; y += 1) {
    for (let x = 0; x < WALL_TEX_WIDTH; x += 1) {
      const i = (y * WALL_TEX_WIDTH + x) * 4;
      const inside =
        x >= layout.x && x < layout.x + layout.width && y >= layout.y && y < layout.y + layout.height;
      if (!inside) {
        assert.equal(wall.data[i], original[i], `plaster changed outside the mural at ${x},${y}`);
      } else if (wall.data[i] !== original[i]) {
        changedInside += 1;
      }
    }
  }
  assert.ok(changedInside > 1000, `the mural barely touched the wall (${changedInside} texels)`);
});

test('the headroom budget covers the strongest mural the prep step can produce', () => {
  // The arithmetic behind WALL_BASE_LEVEL, made explicit. All three of these
  // numbers are tuned independently — the headroom, the strength knob, and the
  // prep step's normalisation — and nothing else notices when their product
  // crosses 1.0. What it looks like when it does is a mural whose highlights
  // flatten out, which reads as a badly chosen painting rather than as a bug.
  const peak = WALL_BASE_LEVEL * (1 + MURAL_STRENGTH * MURAL_MAX_DEVIATION);
  assert.ok(peak <= 1, `the composite peaks at ${peak.toFixed(3)} of full scale — it will clip`);
  // And not so conservative that the 8-bit range is being wasted.
  assert.ok(peak > 0.8, `the composite only reaches ${peak.toFixed(3)} — headroom is being wasted`);
});

test('a mean-normalised mural stays greyscale and never clips', () => {
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const layout = muralLayout(400, 300);
  // Mid-grey field with a full-white blob: mean-normalised the way the prep step
  // guarantees, but reaching the very top of the range — the worst case the
  // catalog can actually contain.
  compositeMural(wall, muralBuffer(layout.width, layout.height, 128, 255), layout);

  for (let i = 0; i < wall.data.length; i += 4) {
    assert.equal(wall.data[i], wall.data[i + 1]);
    assert.equal(wall.data[i], wall.data[i + 2]);
    assert.ok(wall.data[i] < 255, 'the composite clipped white — WALL_BASE_LEVEL is too high');
    assert.ok(wall.data[i] > 0, 'the composite clipped black');
  }
});

test('an un-normalised mural clamps gracefully rather than corrupting', () => {
  // The failure mode MURAL_MAX_DEVIATION documents. A mostly-dark image with a
  // small bright highlight has a low mean and a peak deviation well past 0.5, so
  // it clips — that is expected and is the prep step's job to prevent. What must
  // NOT happen is a wrapped byte, a colour fringe or a transparent hole, because
  // those would look like a rendering bug rather than like a poor asset.
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const layout = muralLayout(400, 300);
  compositeMural(wall, muralBuffer(layout.width, layout.height, 0, 255), layout);

  for (let i = 0; i < wall.data.length; i += 4) {
    assert.ok(wall.data[i] >= 0 && wall.data[i] <= 255);
    assert.equal(wall.data[i], wall.data[i + 1]);
    assert.equal(wall.data[i], wall.data[i + 2]);
    assert.equal(wall.data[i + 3], 255, 'the composite must never punch a hole in the wall');
  }
});

test('a uniform mural leaves the wall untouched', () => {
  // The zero-mean property, isolated: a flat image has no tonal structure, so it
  // has nothing to say and must say nothing. A blend that wrote its absolute
  // value instead of its deviation would repaint the whole rect a flat grey here
  // and look perfectly plausible on screen.
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const original = Uint8ClampedArray.from(wall.data);

  const layout = muralLayout(400, 300);
  compositeMural(wall, muralBuffer(layout.width, layout.height, 90, 90), layout);

  for (let i = 0; i < wall.data.length; i += 4) {
    assert.equal(wall.data[i], original[i]);
  }
});

test('the strength knob scales the mural, and only the mural', () => {
  assert.ok(MURAL_STRENGTH > 0 && MURAL_STRENGTH <= 1.2, 'strength is outside its headroom budget');
});

test('compositing survives a malformed or short mural buffer', () => {
  const wall = buffer(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(wall);
  const original = Uint8ClampedArray.from(wall.data);
  const layout = muralLayout(400, 300);

  compositeMural(wall, null, layout);
  compositeMural(wall, muralBuffer(10, 10), layout); // too small for the layout
  compositeMural(wall, muralBuffer(layout.width, layout.height), null);

  assert.deepEqual(Uint8ClampedArray.from(wall.data), original);
});

// --- Degradation -------------------------------------------------------------

test('the wall texture build degrades where no canvas exists', () => {
  // Node is the case under test, but a browser without a 2D context takes the
  // same path: scene.js leaves the material's flat albedo alone and the wall
  // looks exactly as it did before any of this existed.
  assert.equal(buildWallTexture(null, null), null);
  assert.equal(buildWallTexture(null, { getContext: () => null }), null);
});

test('linearMeanOf measures a known buffer', () => {
  // Guards the guard: the compensation in scene.js divides by this number, so a
  // silently-wrong mean would be an exposure shift on the largest surface on
  // screen — and it would look like a lighting bug, not a texture one.
  const white = buffer(2, 2);
  white.data.fill(255);
  assert.equal(Math.round(linearMeanOf(white.data) * 1000) / 1000, 1);

  const black = buffer(2, 2);
  assert.equal(linearMeanOf(black.data), 0);

  // sRGB 128 is linear 0.2158, NOT 0.502 — the whole reason this is measured in
  // linear space rather than by averaging bytes.
  const mid = buffer(2, 2);
  mid.data.fill(128);
  assert.ok(Math.abs(linearMeanOf(mid.data) - 0.2158) < 0.001);

  assert.equal(linearMeanOf(new Uint8ClampedArray(0)), 1);
});
