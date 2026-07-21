// Procedural surface textures (V15).
//
// BROWSER/render layer: may use Three.js and (for the canvas half) the DOM. Under
// Node the pure half still imports and runs — deliberately, because that is where
// every number in this file is checked. No image assets, no addons: the grain is
// generated at init from a seeded RNG, exactly like the rest of the project's
// "fully static and self-contained" discipline.
//
// WHY: untextured planes under a tone curve still read as planes. V14 gave the
// scene a filmic highlight rolloff, but a flat 12x4.5 rectangle of one albedo has
// nothing for that curve to act on. This is what makes V14 legible.
//
// The grain is deliberately faint. It is a SURFACE cue (plaster, concrete, packed
// earth), not decoration — the art direction's "warm, matte, faceted toy diorama"
// wants the eye to read material, not pattern.

import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
} from '../../vendor/three.module.min.js';
import { createRng } from '../sim/rng.js';

/**
 * Edge length of every generated texture, in texels. Square so one `repeat`
 * scalar pair fully describes the mapping.
 *
 * 256 is sized against the actual on-screen density rather than picked as a round
 * number: the camera frames very nearly the whole 12-unit wall, so at a typical
 * ~900px canvas the wall runs about 75 screen pixels per world unit. At
 * TILE_WORLD_SIZE = 2 this gives 128 texels per world unit — comfortably above
 * the screen rate, so the grain never reads as blocky, and far below the point
 * where the memory would matter (3 textures x 256^2 x RGBA = 768KB).
 */
export const NOISE_SIZE = 256;

/**
 * World units covered by one repetition of the grain. Every surface's `repeat`
 * derives from this and its own world size, so all three read at ONE consistent
 * physical scale — a floor whose grain is twice the wall's reads as a different
 * material at a different distance, which is precisely the diorama illusion this
 * is meant to support.
 */
export const TILE_WORLD_SIZE = 2;

/**
 * The three surfaces, keyed by the mesh they dress.
 *
 * `world` is the mesh's real size in world units and is what `repeat` is derived
 * from. It duplicates scene.js's geometry constants, and that duplication is the
 * point: `tests/textures.test.js` asserts the two agree, so resizing the garage
 * without rescaling the grain fails a test instead of silently shipping a wall
 * whose plaster is the wrong size.
 *
 * `lattice` is the coarsest noise cell count across one tile; `octaves` adds
 * detail at 2x and 4x that. `grainMin` is the darkest the grain multiplies an
 * albedo by (the brightest is always 1.0) — so it sets the amplitude, and a
 * bigger spread reads as a rougher material.
 *
 * The three `grainMin` values are the one judgement in this file, and they are
 * set CONSERVATIVELY on purpose. Read them in linear space, not as they look:
 * sRGB 0.92 is a linear 0.83, so the wall's grain already varies its albedo by
 * 17%, the floor's by 25% and the soil's by 36%. A first pass set them a step
 * stronger and described the result as "faint" in the same breath — the numbers
 * said 25/36/49%, which is mottling, not a surface cue. Nothing in this repo can
 * see them, so they start where the intent and the arithmetic agree and the
 * 3D visual matrix decides whether to push them. Raising one is a single edit:
 * `grainMean` re-measures and scene.js's compensation follows automatically.
 */
export const SURFACES = {
  // Garage wall: plaster. The finest and faintest of the three — it is the
  // largest area on screen and the backdrop for the sun patch, so pattern here
  // would compete with the one gradient that carries information.
  //
  // The wall is the one surface that does NOT ship as a tiling texture (see
  // TILED_SURFACES). Its grain is sampled into the full-wall canvas that carries
  // the mural instead — but its parameters stay here, in one table with the other
  // two, because "one physical grain scale across all three surfaces" is the rule
  // they exist to hold and moving one out is how that rule quietly stops applying.
  wall: { seed: 0x7a11, world: [12, 4.5], lattice: 10, octaves: 3, grainMin: 0.92 },
  // Garage floor: concrete. Coarser and a touch stronger than the wall; it is
  // seen at a grazing angle, which compresses the grain vertically, so a wall
  // amplitude would nearly vanish here.
  floor: { seed: 0xc0c2, world: [12, 8], lattice: 7, octaves: 3, grainMin: 0.88 },
  // Packed earth in cross-section (buried x-ray only). The coarsest and
  // strongest: this one is meant to read as clods rather than as a finish.
  //
  // DEVIATION from the plan, which says "PlaneGeometry already has UVs, so only
  // `repeat` needs setting". The soil is a BoxGeometry, not a plane. Its six
  // faces each carry 0..1 UVs but span three DIFFERENT world sizes — top 12x8,
  // front 12x2.2, side 2.2x8 — and a single `repeat` pair cannot be correct for
  // more than one of them. Both the top and the front face are in frame during
  // the buried x-ray (the camera sits at z=9, outside the floor's z span, so the
  // front face shows below the floor's leading edge — see scene.js's soilMesh
  // note). Sized to the TOP face, which is the cutaway surface the x-ray exists
  // to show and by far the larger of the two; the front face's grain is stretched
  // ~3.6x vertically as a result. That sliver is the only place it shows, and the
  // alternative — splitting the box into per-face materials — buys a barely
  // visible strip at the cost of six materials to build and free.
  soil: { seed: 0x501a, world: [12, 8], lattice: 5, octaves: 2, grainMin: 0.82 },
};

/**
 * sRGB transfer function, decode direction. The canvas stores 8-bit sRGB and the
 * texture is tagged SRGBColorSpace, so this is exactly what the GPU applies
 * before the grain multiplies an albedo — which makes it the right space to
 * measure the grain's mean in (see {@link grainMean}).
 * @param {number} c channel value in [0, 1], sRGB-encoded
 * @returns {number} linear value in [0, 1]
 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Smoothstep — the interpolant that makes value noise look like a surface. */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * One tileable octave of value noise: an `lattice` x `lattice` grid of seeded
 * random values, bilinearly interpolated with a smoothstep falloff.
 *
 * Tiling is the whole trick, and it is one character: the lattice is indexed
 * MODULO `lattice`, so the cell to the right of the last one is the first one.
 * The field is therefore continuous across its own edge and `RepeatWrapping` has
 * nothing to seam. Without the modulo the two edges sample unrelated lattice
 * values and every tile boundary becomes a visible line — on a floor repeating 4x
 * that is 3 hard creases across the garage.
 * @param {Float32Array} out accumulator, length size*size
 * @param {number} size edge length in texels
 * @param {number} lattice noise cells across one tile
 * @param {number} amplitude weight of this octave
 * @param {{next: () => number}} rng seeded source
 */
function addOctave(out, size, lattice, amplitude, rng) {
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rng.next();

  const at = (cx, cy) => grid[(((cy % lattice) + lattice) % lattice) * lattice + (((cx % lattice) + lattice) % lattice)];

  for (let y = 0; y < size; y += 1) {
    const v = (y / size) * lattice;
    const cy = Math.floor(v);
    const fy = smoothstep(v - cy);
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * lattice;
      const cx = Math.floor(u);
      const fx = smoothstep(u - cx);
      const top = at(cx, cy) + (at(cx + 1, cy) - at(cx, cy)) * fx;
      const bottom = at(cx, cy + 1) + (at(cx + 1, cy + 1) - at(cx, cy + 1)) * fx;
      out[y * size + x] += (top + (bottom - top) * fy) * amplitude;
    }
  }
}

/**
 * Generate a surface's grain field: fractal value noise in [0, 1], seamlessly
 * tileable. Pure and deterministic — the same name always yields the same field,
 * on any machine, which is what lets the tests below assert its properties
 * instead of eyeballing a canvas.
 * @param {keyof typeof SURFACES} name
 * @returns {Float32Array} length NOISE_SIZE^2, values in [0, 1]
 */
export function noiseField(name) {
  const surface = SURFACES[name];
  if (!surface) return null;
  const { seed, lattice, octaves } = surface;
  const rng = createRng(seed);
  const field = new Float32Array(NOISE_SIZE * NOISE_SIZE);

  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o += 1) {
    addOctave(field, NOISE_SIZE, lattice * 2 ** o, amplitude, rng);
    total += amplitude;
    amplitude /= 2;
  }
  for (let i = 0; i < field.length; i += 1) field[i] /= total;
  return field;
}

/**
 * The 8-bit grey a field value becomes, as the canvas stores it. Quantising here
 * rather than at paint time means {@link grainMean} measures exactly what the GPU
 * will sample, not an idealised version of it.
 * @param {number} v field value in [0, 1]
 * @param {number} grainMin darkest multiplier
 * @returns {number} 0..255
 */
function grainByte(v, grainMin) {
  return Math.round((grainMin + (1 - grainMin) * v) * 255);
}

/**
 * Mean of an RGBA byte buffer in LINEAR space, read off the red channel.
 *
 * The buffer half of {@link grainMean}, and it exists for the same reason: a
 * colour map MULTIPLIES albedo, so whatever its mean is, the surface is darkened
 * by that factor and the albedo has to be divided back out. `grainMean` can work
 * from the noise field because a grain is nothing but the field; the wall's map
 * is a COMPOSITE (grain, mural, feather, headroom) whose mean no formula predicts,
 * so it has to be measured from the finished pixels instead.
 *
 * Red channel only: everything this module paints is greyscale, and the assertion
 * that it stays greyscale is cheaper to make in a test than to re-derive per texel.
 * @param {Uint8ClampedArray|number[]} data RGBA bytes
 * @returns {number} mean linear multiplier in (0, 1]
 */
export function linearMeanOf(data) {
  if (!data || data.length < 4) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += srgbToLinear(data[i] / 255);
    n += 1;
  }
  return n > 0 ? sum / n : 1;
}

/**
 * Mean of a surface's grain in LINEAR space — i.e. the factor by which dressing
 * that surface would darken it.
 *
 * This exists because of a trap the plan does not mention. A colour `map`
 * MULTIPLIES the material's albedo, and a grain that ramps up to 1.0 necessarily
 * averages below it, so simply attaching these textures would darken the wall,
 * floor and soil by 14%, 19% and 28% respectively — far more than the ramps look
 * like they should, because the mean has to be taken in LINEAR space and sRGB
 * compresses the darks (a 0.88 sRGB floor is only 0.75 linear). Measuring this in
 * sRGB would under-compensate every surface and leave a residual shift behind.
 * That is not a texture change, it is a LIGHTING change:
 * it would land as an apparent exposure shift on top of V14's ACES curve — whose
 * visual matrix is still owed and unwalked. V14 went to some length to leave that
 * matrix exactly one variable to judge (the curve and its exposure); shipping an
 * uncompensated albedo drop underneath it would quietly hand the reviewer two.
 *
 * So scene.js divides each surface's albedo by this before attaching the map, and
 * the mean radiance is unchanged. The number is MEASURED from the generated field
 * rather than typed, so it cannot drift when a grainMin or a seed is retuned —
 * the V14 lesson about two representations of the same brightness, one of them
 * hidden in a constant.
 * @param {keyof typeof SURFACES} name
 * @returns {number} mean linear multiplier in (0, 1]
 */
export function grainMean(name) {
  const surface = SURFACES[name];
  const field = noiseField(name);
  if (!field) return 1;
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    sum += srgbToLinear(grainByte(field[i], surface.grainMin) / 255);
  }
  return sum / field.length;
}

/**
 * How many times a surface's grain repeats across it, derived from its world size
 * so every surface shares ONE physical grain scale.
 * @param {keyof typeof SURFACES} name
 * @returns {{x: number, y: number}|null}
 */
export function grainRepeat(name) {
  const surface = SURFACES[name];
  if (!surface) return null;
  return {
    x: surface.world[0] / TILE_WORLD_SIZE,
    y: surface.world[1] / TILE_WORLD_SIZE,
  };
}

/**
 * Write a surface's grain into an ImageData-shaped buffer as opaque greyscale.
 * Separated from the canvas so the pixel maths is testable under Node with a
 * plain object — the canvas is a sink, not a participant.
 * @param {{data: Uint8ClampedArray}} imageData target, length NOISE_SIZE^2 * 4
 * @param {keyof typeof SURFACES} name
 */
export function paintGrain(imageData, name) {
  const surface = SURFACES[name];
  if (!surface) return;
  const field = noiseField(name);
  const { data } = imageData;
  for (let i = 0; i < field.length; i += 1) {
    const g = grainByte(field[i], surface.grainMin);
    data[i * 4] = g;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = g;
    data[i * 4 + 3] = 255;
  }
}

/**
 * Build one surface's CanvasTexture onto a caller-supplied canvas.
 *
 * The canvas is a parameter rather than created here so the tests can hand in a
 * stub and assert the REAL texture wiring — colour space, wrapping and repeat are
 * all silent when wrong (a missing colour space washes the scene out, a missing
 * wrap mode clamps the grain into a smear at one edge), and a static source read
 * would only prove the lines exist, not that they land on the texture.
 * @param {keyof typeof SURFACES} name
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas sized NOISE_SIZE square
 * @returns {CanvasTexture|null}
 */
export function buildSurfaceTexture(name, canvas) {
  const surface = SURFACES[name];
  if (!surface || !canvas) return null;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);
  paintGrain(imageData, name);
  ctx.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  // The classic washed-out-everything bug, and the one the plan singles out: a
  // COLOUR map must declare SRGBColorSpace so Three decodes it before lighting.
  // (A roughness or bump map would have to stay NoColorSpace for the same reason
  // in reverse — it carries data, not colour. All three of these are colour.)
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const repeat = grainRepeat(name);
  texture.repeat.set(repeat.x, repeat.y);
  texture.name = `grain:${name}`;
  return texture;
}

// --- The wall canvas (V21) ---------------------------------------------------
// The wall stops being a tiling surface, because a mural does not tile. Instead
// it gets ONE canvas at the wall's own aspect, into which the same grain is
// sampled at the same physical scale and the mural is composited (js/render/
// murals.js). The other two surfaces are untouched and still tile.

/**
 * The wall canvas, in texels. Chosen so that BOTH axes land on exactly
 * {@link WALL_TILE_TEXELS} per grain tile — 1152/6 = 432/2.25 = 192 — which is
 * what keeps the grain isotropic and at V15's one physical scale. Pick a size
 * that does not divide evenly and the plaster silently stretches on one axis.
 *
 * 1152/12 = 96 texels per world unit. The camera frames very nearly the whole
 * 12-unit wall, so at a typical ~900px canvas the wall runs about 75 screen
 * pixels per world unit (see NOISE_SIZE) — 96 stays above that, so neither the
 * grain nor the mural resolves as blocky. It is BELOW the 128/unit the old
 * tiling wall achieved, which is the real cost of this change and is affordable
 * precisely because 128 was already well past what the screen can show.
 */
export const WALL_TEX_WIDTH = 1152;
export const WALL_TEX_HEIGHT = 432;
/** Texels per grain tile on the wall canvas — the same 2 world units as ever. */
export const WALL_TILE_TEXELS = WALL_TEX_WIDTH / (SURFACES.wall.world[0] / TILE_WORLD_SIZE);

/**
 * Headroom. The wall base is painted at this fraction of its natural level so
 * the mural's brightest passages have somewhere to go instead of clipping at 255.
 *
 * It is FREE, and that is the non-obvious part: scene.js divides the material's
 * albedo by the map's MEASURED linear mean, and scaling every texel by a constant
 * scales that mean by the same constant, so it divides straight back out. The
 * wall's mean radiance is identical at any headroom — all this buys is 8-bit
 * range for the mural to swing in without the highlights flattening.
 *
 * 0.66 puts the composite's extremes at roughly 0.35..0.94 of full scale for the
 * strongest mural, so nothing clips at either end and ~150 of the 256 levels are
 * in use.
 */
export const WALL_BASE_LEVEL = 0.66;

/**
 * Bilinearly sample a tileable noise field at fractional lattice coordinates,
 * wrapping on both axes.
 *
 * Bilinear rather than nearest because the wall canvas resamples the 256-texel
 * grain tile down to 192, a non-integer 4:3 ratio — nearest would drop every
 * fourth sample on a fixed grid and lay a faint regular pattern over a field
 * whose entire job is to look irregular.
 * @param {Float32Array} field NOISE_SIZE square
 * @param {number} fx
 * @param {number} fy
 * @returns {number}
 */
function sampleField(field, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (xx, yy) => {
    const wx = ((xx % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
    const wy = ((yy % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
    return field[wy * NOISE_SIZE + wx];
  };
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

/**
 * The painted base, kept so it is computed once per page rather than once per
 * wall build. See {@link paintWallBase}.
 * @type {Uint8ClampedArray|null}
 */
let wallBaseCache = null;

/**
 * Paint the wall's plaster into a full-wall RGBA buffer: the same grain as ever,
 * sampled at the same 2-world-unit scale, scaled by {@link WALL_BASE_LEVEL}.
 *
 * This is the wall WITHOUT a mural, and it is deliberately the same code path the
 * mural build starts from — so "the mural failed to load" and "the first frame
 * before it arrives" both render exactly the pre-V21 wall rather than a second,
 * separately-maintained fallback that nothing ever looks at.
 *
 * CACHED, because the wall is 1152x432 and this loop measures ~27 ms — an order
 * of magnitude past the "few milliseconds of noise at init" the three tiling
 * grains cost, and it would otherwise run TWICE per farm load (once bare, once
 * when the mural arrives) plus again on every mural swap. The result depends only
 * on constants in this file, so it can never go stale; the copy is a ~2 MB memcpy
 * and lands under a millisecond. Freed by disposeSurfaceTextures with everything
 * else this module owns.
 * @param {{data: Uint8ClampedArray}} imageData target, WALL_TEX_WIDTH*HEIGHT*4
 */
export function paintWallBase(imageData) {
  if (wallBaseCache) {
    imageData.data.set(wallBaseCache);
    return;
  }

  const field = noiseField('wall');
  const { grainMin } = SURFACES.wall;
  const { data } = imageData;
  const scale = NOISE_SIZE / WALL_TILE_TEXELS;

  for (let y = 0; y < WALL_TEX_HEIGHT; y += 1) {
    for (let x = 0; x < WALL_TEX_WIDTH; x += 1) {
      const v = sampleField(field, x * scale, y * scale);
      const g = Math.round((grainMin + (1 - grainMin) * v) * WALL_BASE_LEVEL * 255);
      const i = (y * WALL_TEX_WIDTH + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  wallBaseCache = Uint8ClampedArray.from(data);
}

// --- Contact shadow (V16) ----------------------------------------------------

/**
 * Edge length of the contact-shadow blob texture. Far smaller than the surface
 * grain: it is a smooth radial falloff with no detail in it, drawn over a patch
 * of floor roughly one world unit across, so more texels would buy nothing.
 */
export const SHADOW_SIZE = 128;

/**
 * Alpha falloff of the contact shadow, from the centre of the blob outward.
 *
 * Reaches EXACTLY zero at r = 1 (and beyond), which is load-bearing rather than
 * tidy: the blob is a square plane, so any alpha left at the edge draws that
 * square's outline on the floor as a faint rectangle. A radial gradient that
 * merely gets close to zero is one of the few ways this feature looks obviously
 * wrong, and it is invisible in the generating code.
 * @param {number} r normalised distance from the centre, 0..∞
 * @returns {number} alpha in [0, 1]
 */
export function shadowAlpha(r) {
  if (r >= 1) return 0;
  const falloff = 1 - r * r;
  return falloff * falloff;
}

/**
 * Write the contact-shadow blob into an ImageData-shaped buffer: black, with the
 * radial alpha falloff above. Pure, so the falloff is testable without a canvas.
 * @param {{data: Uint8ClampedArray}} imageData length SHADOW_SIZE^2 * 4
 */
export function paintContactShadow(imageData) {
  const { data } = imageData;
  const c = (SHADOW_SIZE - 1) / 2;
  for (let y = 0; y < SHADOW_SIZE; y += 1) {
    for (let x = 0; x < SHADOW_SIZE; x += 1) {
      const i = (y * SHADOW_SIZE + x) * 4;
      const r = Math.hypot(x - c, y - c) / c;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(shadowAlpha(r) * 255);
    }
  }
}

/**
 * Build a contact-shadow texture. Deliberately NOT cached, unlike the three
 * surfaces — and that is a direct consequence of the ownership rule V15 set up.
 *
 * The blob is parented to `composterGroup`, so `disposeComposterMesh` frees it on
 * every model swap — including, as of V15, its textures. A cached texture shared
 * across model builds would therefore be DISPOSED by the first upgrade and every
 * blob after it would sample a dead texture. The plan asks for both "one soft
 * radial-gradient CanvasTexture" and "disposed including its texture"; those two
 * are only compatible if each blob owns its own. A 128² gradient costs about a
 * millisecond and is built once per upgrade, which is rare — so the cheap thing
 * and the correct thing are the same thing here.
 * @param {HTMLCanvasElement|OffscreenCanvas|null} [canvas] defaults to a fresh one
 * @returns {CanvasTexture|null}
 */
export function buildContactShadowTexture(canvas = createShadowCanvas()) {
  if (!canvas) return null;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(SHADOW_SIZE, SHADOW_SIZE);
  paintContactShadow(imageData);
  ctx.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  // Bound to a `map` slot, so it declares sRGB like every other colour map here.
  // The RGB is pure black, which is invariant under the transfer either way, and
  // alpha is never colour-managed — so this is for uniformity of the rule rather
  // than for correctness. Stated because the opposite mistake (tagging a DATA map
  // sRGB) is the one the plan warns about, and silence here would read as a slip.
  texture.colorSpace = SRGBColorSpace;
  texture.name = 'contactShadow';
  return texture;
}

/** Cached textures, so re-entering the game screen does not regenerate them. */
let cache = null;

/**
 * Create an offscreen canvas, or null where neither canvas API exists (Node, and
 * any browser hostile enough to lack both). Returning null is the graceful path
 * the whole render layer uses: scene.js simply leaves the materials untextured,
 * which is precisely how they looked before V15.
 *
 * Exported since V21 so murals.js can raise its own scratch canvases without a
 * second copy of the OffscreenCanvas/document fallback — there is exactly one
 * place in this project that decides how a canvas comes into being.
 * @param {number} width
 * @param {number} [height=width]
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
export function createCanvas(width = NOISE_SIZE, height = width) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** A SHADOW_SIZE-square canvas, or null where no canvas API exists. */
function createShadowCanvas() {
  return createCanvas(SHADOW_SIZE);
}

/**
 * Which surfaces ship as a repeating texture.
 *
 * The wall is absent, and its absence is the V21 change: a mural does not tile,
 * so the wall is painted once at its own aspect by {@link paintWallBase} instead.
 * Building its tiling texture anyway would cost a 256-square canvas and its VRAM
 * for a map nothing samples — and would leave two representations of the wall's
 * plaster, which is exactly the shape V14 and V15 each got bitten by.
 */
export const TILED_SURFACES = ['floor', 'soil'];

/**
 * The tiling surface textures, generated once and cached. A few milliseconds of
 * noise at init; nothing per frame.
 * @returns {{floor: CanvasTexture|null, soil: CanvasTexture|null}}
 */
export function surfaceTextures() {
  if (cache) return cache;
  cache = {};
  for (const name of TILED_SURFACES) {
    cache[name] = buildSurfaceTexture(name, createCanvas());
  }
  return cache;
}

/**
 * Free the cached textures. Called from disposeScene — the wall, floor and soil
 * are scene-ROOT meshes that disposeComposterMesh never reaches, so without this
 * they are the one thing in the render layer with no owner at teardown.
 */
export function disposeSurfaceTextures() {
  // The wall base is a plain buffer rather than a GPU texture, so it has nothing
  // to dispose — but it is ~2 MB held by this module, and leaving it behind would
  // make "textures.js owns nothing after teardown" false by exactly one object.
  wallBaseCache = null;
  if (!cache) return;
  for (const texture of Object.values(cache)) texture?.dispose?.();
  cache = null;
}
