// Procedural surface texture tests (V15).
//
// The second render-layer suite, and it earns its place the same way
// composter3d.test.js does: every failure mode here is SILENT. A non-tiling field
// puts hard creases across the floor, a wrong repeat renders the grain at the
// wrong physical size, a missing colour space washes the whole scene out, and an
// uncompensated grain mean darkens every surface — which would read as an
// exposure shift on top of V14's tone curve, whose visual matrix is still owed.
// None of those throw, and none are visible in a diff.
//
// The pure half of textures.js runs under Node by construction (the canvas is a
// sink, not a participant), so all of this is checkable without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RepeatWrapping, SRGBColorSpace } from '../vendor/three.module.min.js';
import {
  NOISE_SIZE,
  TILE_WORLD_SIZE,
  SURFACES,
  noiseField,
  grainMean,
  grainRepeat,
  paintGrain,
  buildSurfaceTexture,
} from '../js/render/textures.js';
import { WALL_WIDTH, WALL_HEIGHT, FLOOR_DEPTH } from '../js/render/scene.js';

const NAMES = Object.keys(SURFACES);

test('every surface is generated for a mesh scene.js actually builds', () => {
  assert.deepEqual(NAMES, ['wall', 'floor', 'soil']);
});

// --- The field ---------------------------------------------------------------

test('every field is fully populated and stays inside [0, 1]', () => {
  for (const name of NAMES) {
    const field = noiseField(name);
    assert.equal(field.length, NOISE_SIZE * NOISE_SIZE, `${name}: wrong field length`);
    for (let i = 0; i < field.length; i += 1) {
      assert.ok(
        field[i] >= 0 && field[i] <= 1,
        `${name}: field[${i}] = ${field[i]} is outside [0, 1] — the octave weights no longer normalise`,
      );
    }
  }
});

test('a field is deterministic — same name, same bytes', () => {
  // The whole no-image-assets approach rests on this: the grain is generated at
  // every load on every machine and must be the same grain each time, or the
  // scene the matrix was walked against is not the scene the player gets.
  for (const name of NAMES) {
    assert.deepEqual(noiseField(name), noiseField(name), `${name}: field is not reproducible`);
  }
});

test('the three surfaces are seeded differently', () => {
  // Same grain on wall, floor and soil would read as one continuous material
  // folded around the room — the exact opposite of the per-surface cue this is for.
  const seen = new Set(NAMES.map((n) => SURFACES[n].seed));
  assert.equal(seen.size, NAMES.length, 'two surfaces share a seed');
});

/**
 * Largest absolute step between two horizontally adjacent columns anywhere in the
 * interior — the yardstick a seam is measured against. A tiling field's wrap-around
 * step is just another interior step; a non-tiling one's is a cliff.
 */
function maxInteriorStepX(field) {
  let max = 0;
  for (let y = 0; y < NOISE_SIZE; y += 1) {
    for (let x = 0; x < NOISE_SIZE - 1; x += 1) {
      const d = Math.abs(field[y * NOISE_SIZE + x + 1] - field[y * NOISE_SIZE + x]);
      if (d > max) max = d;
    }
  }
  return max;
}

function maxInteriorStepY(field) {
  let max = 0;
  for (let y = 0; y < NOISE_SIZE - 1; y += 1) {
    for (let x = 0; x < NOISE_SIZE; x += 1) {
      const d = Math.abs(field[(y + 1) * NOISE_SIZE + x] - field[y * NOISE_SIZE + x]);
      if (d > max) max = d;
    }
  }
  return max;
}

test('every field tiles seamlessly in both axes', () => {
  // The AC's "no tiling seams", asserted rather than eyeballed. The floor repeats
  // 4x6 times, so a seam is not a subtle artifact — it is a grid of hard creases
  // across the garage, and it is the single most likely way this ships wrong.
  for (const name of NAMES) {
    const field = noiseField(name);
    const stepX = maxInteriorStepX(field);
    const stepY = maxInteriorStepY(field);

    for (let y = 0; y < NOISE_SIZE; y += 1) {
      const seam = Math.abs(field[y * NOISE_SIZE] - field[y * NOISE_SIZE + NOISE_SIZE - 1]);
      assert.ok(
        seam <= stepX,
        `${name}: vertical seam at row ${y} steps ${seam.toFixed(4)}, more than the largest ` +
          `interior step ${stepX.toFixed(4)} — the lattice is not being indexed modulo its size, ` +
          'so every tile boundary is a visible crease.',
      );
    }
    for (let x = 0; x < NOISE_SIZE; x += 1) {
      const seam = Math.abs(field[x] - field[(NOISE_SIZE - 1) * NOISE_SIZE + x]);
      assert.ok(
        seam <= stepY,
        `${name}: horizontal seam at column ${x} steps ${seam.toFixed(4)}, more than the largest ` +
          `interior step ${stepY.toFixed(4)}.`,
      );
    }
  }
});

test('a field actually varies — it is grain, not a flat plate', () => {
  // A field that collapsed to a constant would pass every check above, including
  // the seam test (trivially), and render as the untextured plane V15 exists to
  // replace. Nothing else here can fail on it.
  for (const name of NAMES) {
    const field = noiseField(name);
    let min = 1;
    let max = 0;
    for (let i = 0; i < field.length; i += 1) {
      if (field[i] < min) min = field[i];
      if (field[i] > max) max = field[i];
    }
    assert.ok(
      max - min > 0.5,
      `${name}: field spans only ${(max - min).toFixed(3)} — too flat to read as a surface`,
    );
  }
});

// --- Physical scale ----------------------------------------------------------

test('every surface world size matches the mesh scene.js builds for it', () => {
  // The binding that makes the duplication safe. These numbers exist twice on
  // purpose; resizing the garage without rescaling the grain fails here instead
  // of shipping a wall whose plaster is the wrong physical size — which looks
  // like a different material, not like a bug.
  assert.deepEqual(SURFACES.wall.world, [WALL_WIDTH, WALL_HEIGHT], 'wall');
  assert.deepEqual(SURFACES.floor.world, [WALL_WIDTH, FLOOR_DEPTH], 'floor');
  // The soil box is WALL_WIDTH x SOIL_DEPTH x FLOOR_DEPTH; its TOP face is the
  // cutaway surface the buried x-ray exists to show, and that is what the grain
  // is sized to. See the DEVIATION note in textures.js.
  assert.deepEqual(SURFACES.soil.world, [WALL_WIDTH, FLOOR_DEPTH], 'soil (top face)');
});

test('every surface repeats at one shared physical grain scale', () => {
  for (const name of NAMES) {
    const repeat = grainRepeat(name);
    const [w, h] = SURFACES[name].world;
    assert.equal(repeat.x, w / TILE_WORLD_SIZE, `${name}: repeat.x`);
    assert.equal(repeat.y, h / TILE_WORLD_SIZE, `${name}: repeat.y`);
    assert.ok(repeat.x > 1 && repeat.y > 1, `${name}: grain does not repeat at all`);
  }
});

// --- Albedo neutrality -------------------------------------------------------

test('every surface reports a grain mean below 1, so it MUST be compensated', () => {
  // Establishes that the trap is real before asserting the fix. A grain ramping
  // up to 1.0 necessarily averages below it, so attaching these maps uncompensated
  // darkens the surface — a lighting change dressed as a texture change.
  for (const name of NAMES) {
    const mean = grainMean(name);
    assert.ok(mean > 0 && mean < 1, `${name}: grain mean ${mean} is not a darkening factor`);
    assert.ok(
      mean < 0.97,
      `${name}: grain mean ${mean.toFixed(4)} is so close to 1 the grain must be invisible`,
    );
  }
});

test('grain mean is measured from the field, not from grainMin', () => {
  // grainMean must reflect the ACTUAL generated bytes in linear space. If it were
  // derived from grainMin alone (the obvious shortcut: (grainMin + 1) / 2) the
  // compensation would silently drift the moment a lattice or seed changed the
  // field's distribution, and the sRGB decode would be missing entirely.
  for (const name of NAMES) {
    const naive = (SURFACES[name].grainMin + 1) / 2;
    assert.notEqual(
      grainMean(name).toFixed(4),
      naive.toFixed(4),
      `${name}: grain mean equals the naive sRGB midpoint — the linear decode is missing`,
    );
  }
});

test('dividing an albedo by the grain mean restores its mean radiance', () => {
  // The property scene.js relies on: base / mean * grain averages back to base,
  // so V14's tuned surface brightness survives V15 untouched and its owed visual
  // matrix still has exactly one variable in it.
  for (const name of NAMES) {
    const mean = grainMean(name);
    const base = 0.276; // linear albedo of the garage wall, near enough for all three
    const field = noiseField(name);
    const { grainMin } = SURFACES[name];

    let sum = 0;
    for (let i = 0; i < field.length; i += 1) {
      const byte = Math.round((grainMin + (1 - grainMin) * field[i]) * 255) / 255;
      const linear = byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
      sum += (base / mean) * linear;
    }
    const dressed = sum / field.length;
    assert.ok(
      Math.abs(dressed - base) < 1e-9,
      `${name}: dressed mean radiance ${dressed} drifted from the undressed ${base}`,
    );
  }
});

// --- Texture wiring ----------------------------------------------------------

/**
 * The smallest thing that satisfies `buildSurfaceTexture`. A canvas is a sink
 * here, so a stub exercises the real code path — and lets the wiring assertions
 * below run under Node, where the alternative would be a static source read that
 * proves the lines exist but not that they reach the texture.
 */
function stubCanvas() {
  let stored = null;
  return {
    width: NOISE_SIZE,
    height: NOISE_SIZE,
    getContext: () => ({
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (imageData) => {
        stored = imageData;
      },
    }),
    painted: () => stored,
  };
}

test('a built texture declares sRGB, repeat wrapping, and its derived repeat', () => {
  for (const name of NAMES) {
    const texture = buildSurfaceTexture(name, stubCanvas());
    assert.ok(texture, `${name}: no texture built`);
    assert.equal(
      texture.colorSpace,
      SRGBColorSpace,
      `${name}: a COLOUR map without SRGBColorSpace — the classic washed-out-everything bug`,
    );
    assert.equal(texture.wrapS, RepeatWrapping, `${name}: wrapS`);
    assert.equal(texture.wrapT, RepeatWrapping, `${name}: wrapT`);
    const repeat = grainRepeat(name);
    assert.equal(texture.repeat.x, repeat.x, `${name}: repeat.x not applied to the texture`);
    assert.equal(texture.repeat.y, repeat.y, `${name}: repeat.y not applied to the texture`);
  }
});

test('building a texture paints the grain onto the canvas', () => {
  // Without this the wiring test above would pass on a blank canvas — a scene
  // rendered with a uniformly white map, which looks exactly like no map at all.
  const canvas = stubCanvas();
  buildSurfaceTexture('wall', canvas);
  const painted = canvas.painted();
  assert.ok(painted, 'putImageData was never called');

  const expected = { data: new Uint8ClampedArray(NOISE_SIZE * NOISE_SIZE * 4) };
  paintGrain(expected, 'wall');
  assert.deepEqual(painted.data, expected.data, 'the painted pixels are not the wall grain');
});

test('painted grain is opaque greyscale that spans its surface amplitude', () => {
  // The range half of this was added after the amplitude check alone was found to
  // PASS a paintGrain that wrote flat white — the V6 lesson landing again. A white
  // map is indistinguishable from no map, and it is worse than none here: grainMean
  // measures the field independently, so it would still report a darkening factor
  // and scene.js would BRIGHTEN every surface by 1/mean to compensate for grain
  // that is not there. Nothing else in this file can fail on that.
  for (const name of NAMES) {
    const image = { data: new Uint8ClampedArray(NOISE_SIZE * NOISE_SIZE * 4) };
    paintGrain(image, name);
    const floor = Math.floor(SURFACES[name].grainMin * 255);
    let min = 255;
    let max = 0;
    for (let i = 0; i < NOISE_SIZE * NOISE_SIZE; i += 1) {
      const [r, g, b, a] = image.data.slice(i * 4, i * 4 + 4);
      assert.ok(r === g && g === b, `${name}: texel ${i} is not grey (${r},${g},${b})`);
      assert.equal(a, 255, `${name}: texel ${i} is not opaque`);
      assert.ok(r >= floor && r <= 255, `${name}: texel ${i} value ${r} outside the grain ramp`);
      if (r < min) min = r;
      if (r > max) max = r;
    }
    const ramp = 255 - floor;
    assert.ok(
      max - min > ramp * 0.6,
      `${name}: painted texels span only ${max - min} of a ${ramp}-wide ramp (${min}..${max}) — ` +
        'the grain is nearly flat, which renders as no map at all while grainMean still ' +
        'reports a darkening factor for scene.js to compensate.',
    );
    assert.ok(max > 245, `${name}: grain never reaches the top of its ramp (max ${max})`);
  }
});

test('an unknown surface yields nothing rather than a broken texture', () => {
  for (const name of [null, undefined, '', 'ceiling']) {
    assert.equal(noiseField(name), null, `noiseField(${JSON.stringify(name)})`);
    assert.equal(grainRepeat(name), null, `grainRepeat(${JSON.stringify(name)})`);
    assert.equal(buildSurfaceTexture(name, stubCanvas()), null, `buildSurfaceTexture(${JSON.stringify(name)})`);
  }
});

test('a missing canvas degrades to no texture, not to a throw', () => {
  // The render layer's graceful-degradation discipline: no canvas API (Node, a
  // hostile browser) leaves the materials untextured, exactly as they were
  // before V15, rather than taking the scene down.
  assert.equal(buildSurfaceTexture('wall', null), null);
  assert.equal(buildSurfaceTexture('wall', { getContext: () => null }), null);
});
