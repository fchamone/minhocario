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
import { readFileSync } from 'node:fs';

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
  SHADOW_SIZE,
  shadowAlpha,
  paintContactShadow,
  buildContactShadowTexture,
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
    // Upper bound on how far scene.js has to lift an albedo to cancel the grain.
    // A tripwire, not a proof: the real constraint is that the LIFTED albedo stays
    // under 1.0 in linear space, and the albedo constants live in scene.js. Today
    // the widest lift is soil's 1.39x on a very dark brown, landing at 0.05 — three
    // orders of margin. A retune that pushed a grain past this bound would be the
    // point at which that margin needs checking rather than assuming, so it stops
    // here and asks instead of silently pushing a bright surface toward clipping.
    assert.ok(
      mean > 0.7,
      `${name}: grain mean ${mean.toFixed(4)} needs a ${(1 / mean).toFixed(2)}x albedo lift to ` +
        'cancel. Check the lifted albedo still lands below 1.0 in linear space before raising this.',
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

// --- Contact shadow (V16) ----------------------------------------------------

test('the contact shadow falls to exactly zero at its edge', () => {
  // The plane is square and the shadow is round, so any alpha surviving to the
  // rim draws that square's outline on the garage floor. "Close to zero" is not
  // enough — 1/255 is still a visible rectangle against a matte floor.
  assert.equal(shadowAlpha(1), 0, 'alpha at the rim');
  assert.equal(shadowAlpha(1.4), 0, 'alpha past the rim (the plane corners)');
  assert.equal(shadowAlpha(0), 1, 'alpha at the centre');
  for (let r = 0; r < 1; r += 0.05) {
    assert.ok(shadowAlpha(r) > shadowAlpha(r + 0.05), `alpha must decrease across r=${r.toFixed(2)}`);
  }
});

test('the painted contact shadow is black with a clean transparent border', () => {
  const image = { data: new Uint8ClampedArray(SHADOW_SIZE * SHADOW_SIZE * 4) };
  paintContactShadow(image);

  const alphaAt = (x, y) => image.data[(y * SHADOW_SIZE + x) * 4 + 3];
  const last = SHADOW_SIZE - 1;
  for (let i = 0; i < SHADOW_SIZE; i += 1) {
    for (const [x, y] of [[i, 0], [i, last], [0, i], [last, i]]) {
      assert.equal(alphaAt(x, y), 0, `border texel (${x},${y}) is not fully transparent`);
    }
  }
  // ...and the corners, which sit at r ≈ 1.41 and are the furthest out.
  assert.equal(alphaAt(0, 0), 0, 'corner texel');

  const mid = Math.floor(SHADOW_SIZE / 2);
  assert.ok(alphaAt(mid, mid) > 240, `centre should be near-opaque, got ${alphaAt(mid, mid)}`);

  for (let i = 0; i < SHADOW_SIZE * SHADOW_SIZE; i += 1) {
    const [r, g, b] = image.data.slice(i * 4, i * 4 + 3);
    assert.ok(r === 0 && g === 0 && b === 0, `texel ${i} is not black (${r},${g},${b})`);
  }
});

test('each contact shadow owns its texture rather than sharing one', () => {
  // The blob is parented to composterGroup, so disposeComposterMesh frees it on
  // every model swap — including its textures, as of V15. A shared/cached texture
  // would therefore be DEAD after the first upgrade, and every later blob would
  // sample a disposed texture. Two calls must not hand back the same object.
  const a = buildContactShadowTexture(stubCanvas());
  const b = buildContactShadowTexture(stubCanvas());
  assert.ok(a && b, 'no texture built');
  assert.notEqual(a, b, 'contact shadow textures are shared — the first upgrade disposes them all');
  assert.equal(a.colorSpace, SRGBColorSpace, 'bound to a map slot, so it declares sRGB');
});

test('a missing canvas leaves the contact shadow out rather than throwing', () => {
  assert.equal(buildContactShadowTexture(null), null);
  assert.equal(buildContactShadowTexture({ getContext: () => null }), null);
});

// --- How scene.js consumes them ----------------------------------------------
// Static source reads, the pattern this project already uses where the runtime is
// out of reach (tests/markup.test.js, tests/css.test.js). `buildScene` needs a
// WebGL context, so nothing here can be exercised — but the two ways this wiring
// goes wrong are both silent and both permanent, so they are worth a tripwire
// even a weak one: an uncompensated map darkens the whole garage, and a texture
// nobody frees is the leak V15 was partly written to close.

const SCENE_SRC = readFileSync(new URL('../js/render/scene.js', import.meta.url), 'utf8');

test('scene.js compensates every grain map by its measured mean', () => {
  assert.match(
    SCENE_SRC,
    /multiplyScalar\(1 \/ grainMean\(/,
    'scene.js attaches grain maps without dividing the albedo by grainMean — every ' +
      'dressed surface is 5-13% darker, which reads as an exposure shift under V14’s ' +
      'tone curve rather than as the texture change it is.',
  );
});

test('scene.js compensates the wall by the mean measured off its composite', () => {
  // The same obligation as above, for the one surface grainMean cannot serve. The
  // wall's map is grain x mural x feather x headroom, so its mean is measured
  // rather than derived — and WALL_BASE_LEVEL alone darkens it by a third, so
  // forgetting this division is not a subtle 5-13% shift but a visibly dim garage.
  assert.match(
    SCENE_SRC,
    /multiplyScalar\(1 \/ built\.linearMean\)/,
    'scene.js dresses the wall without dividing its albedo by the measured mean of the ' +
      'composited map — the wall would render markedly darker than the floor beside it.',
  );
  // Set, not multiplied in place: successive murals would otherwise compound the
  // division and the wall would brighten a little with every farm.
  assert.match(
    SCENE_SRC,
    /material\.color\.set\(WALL_COLOR\)\.multiplyScalar/,
    'the wall albedo must be re-derived from WALL_COLOR on each dressing, or the ' +
      'compensation compounds across mural swaps.',
  );
});

/**
 * Map assignments in scene.js that are deliberately NOT albedo compensation, each
 * listed with the argument for it. An allowlist rather than a widened pattern, on
 * the `css.test.js` precedent: a new textured surface should have to justify
 * itself here, not slip through a rule that quietly got looser.
 *
 * V16's contact shadow is the first entry, and it fired this guard on arrival —
 * which is the guard working. It is exempt because `grainMean` compensation
 * applies to an albedo multiplied into a LIT surface, and the blob is an unlit
 * `MeshBasicMaterial` carrying black with an alpha falloff. There is no albedo to
 * preserve; the map is the shadow's shape, not its brightness.
 */
const SANCTIONED_MAPS = [
  'map: texture,', // V16 contact shadow — unlit MeshBasicMaterial, black + alpha
];

/**
 * Map assignments that ARE albedo on a lit surface, and ARE compensated — just
 * not by `grainMean()`.
 *
 * V21's wall is the first and, so far, only one. It could not join
 * SANCTIONED_MAPS: that list means "there is no albedo here to preserve", and
 * writing the wall into it would put a false statement in the codebase to buy a
 * green test. The wall's map is a COMPOSITE — grain, mural, feather and headroom —
 * whose mean no formula predicts, so it is measured off the finished pixels
 * instead (murals.js `buildWallTexture`) and divided out in `dressWall`.
 *
 * The exemption is CONDITIONAL on that division still being there, checked below.
 * An unconditional entry here would be indistinguishable from deleting the guard
 * for the largest surface on screen.
 */
const MEASURED_MAPS = [
  'wallMesh.material.map = built.texture;', // V21 wall — compensated by linearMean
];

test('scene.js routes every textured surface through the one compensating builder', () => {
  // The realistic regression is not removing the division — it is adding a fourth
  // textured surface next to the three and assigning `.map` directly, which skips
  // the compensation for that surface alone. That is harder to spot than a global
  // shift, because only one surface moves.
  const outside = SCENE_SRC
    // Drop the builder itself; it is the sanctioned place to assign a map.
    // `\r?\n`, not `\n`: this repo's working tree is mixed (js/main.js and
    // js/sim/engine.js are CRLF today) and core.autocrlf is on, so a plain `\n}\n`
    // silently fails to strip the function the moment scene.js is checked out on
    // Windows — and the test then reports surfaceMaterial's OWN assignment as the
    // violation, which is a genuinely baffling place to start debugging.
    .replace(/function surfaceMaterial[\s\S]*?\r?\n}\r?\n/, '')
    .split('\n')
    // Any `<something>map =` or `map:` assignment, on any object and in any slot
    // (`normalMap`, `roughnessMap`, …). Written this wide after a narrower version
    // matched only a bare `map` and let a planted `extra.map = grain.soil` through
    // — the exact regression the test is for. `.map(` never matches, since a call
    // is followed by `(` rather than `:` or `=`.
    .filter((line) => /(?:^|[\s.])[a-zA-Z]*[Mm]ap\s*[:=](?!=)/.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .filter((line) => !SANCTIONED_MAPS.includes(line.trim()))
    // The measured-mean route is only an exemption while the division it names is
    // actually present — otherwise this list would be a way to silently drop the
    // largest surface on screen out of the guard.
    .filter(
      (line) =>
        !(MEASURED_MAPS.includes(line.trim()) && /multiplyScalar\(1 \/ built\.linearMean\)/.test(SCENE_SRC)),
    );

  assert.deepEqual(
    outside,
    [],
    'a texture map is assigned in scene.js outside surfaceMaterial(), so it skips the ' +
      'grainMean compensation and that surface alone shifts brightness. If it is genuinely ' +
      'not an albedo map (an unlit overlay, a data map), add it to SANCTIONED_MAPS with the reason.',
  );
});

test('scene.js frees the surface grain on teardown', () => {
  // The wall, floor and soil are scene-ROOT meshes; disposeComposterMesh never
  // traverses them, so these three textures have no other owner.
  const dispose = SCENE_SRC.slice(SCENE_SRC.indexOf('export function disposeScene'));
  assert.match(
    dispose,
    /disposeSurfaceTextures\(\)/,
    'disposeScene does not free the surface textures — nothing else owns them.',
  );
});

test('a missing canvas degrades to no texture, not to a throw', () => {
  // The render layer's graceful-degradation discipline: no canvas API (Node, a
  // hostile browser) leaves the materials untextured, exactly as they were
  // before V15, rather than taking the scene down.
  assert.equal(buildSurfaceTexture('wall', null), null);
  assert.equal(buildSurfaceTexture('wall', { getContext: () => null }), null);
});
