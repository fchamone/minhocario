// Wall murals (V21) — one public-domain painting on the garage wall per farm.
//
// BROWSER/render layer: the selection and compositing maths below are pure and
// run under Node (which is where every number in this file is checked); only the
// image decode and the canvas at the bottom need a browser.
//
// WHY a mural at all: the wall is the largest thing on screen and it was blank.
// Giving each farm its own painting makes a new game feel like a new place, at
// the cost of one texture build per farm and nothing per frame.
//
// THREE RULES THIS FILE EXISTS TO HOLD, all of them DESIGN.md's:
//
//   1. The bin stays the ONE saturated object on stage. Every mural is a single
//      tonal channel — there is no colour here to compete with it, by
//      construction rather than by restraint.
//   2. Nothing may change scene brightness while pretending to add detail. The
//      mural's deviation is zero-mean, and whatever residual survives is MEASURED
//      off the finished pixels and divided back out of the albedo (scene.js).
//   3. The murals must not read as two families. They are normalised to one
//      contrast budget when they are prepared, the same discipline that keeps the
//      14 food icons at one optical weight — see DESIGN.md, "Wall murals".

import {
  WALL_TEX_WIDTH,
  WALL_TEX_HEIGHT,
  paintWallBase,
  linearMeanOf,
  createCanvas,
} from './textures.js';
import { CanvasTexture, SRGBColorSpace } from '../../vendor/three.module.min.js';

/** Directory the prepared murals ship in, relative to index.html. */
export const MURAL_DIR = 'assets/murals/';

/**
 * The catalog. `id` is both the identity and the filename stem.
 *
 * Every artist here died more than 70 years ago, which clears Brazil's term as
 * well as the US and EU — the provenance and the licence reasoning for each work
 * live in `assets/murals/CREDITS.txt`, which ships with them. There are no
 * dimensions and no brightness figures in this table ON PURPOSE: both are read
 * from the decoded image at runtime, so re-preparing an asset at a different size
 * or tone cannot desynchronise it from a number typed here.
 */
export const MURALS = [
  { id: 'gleaners' },
  { id: 'great-wave' },
  { id: 'harvesters' },
  { id: 'o-violeiro' },
  { id: 'rhinoceros' },
  { id: 'starry-night' },
  { id: 'sudden-shower' },
  { id: 'vitruvian-man' },
];

/**
 * Which mural a given farm key selects. Pure hash, no state.
 *
 * Modelled on `hotSideFromSeed` in js/sim/engine.js, for its reasons: hashing
 * keeps the choice deterministic (same farm ⇒ same mural, across reloads,
 * forever) while leaving the farm's RNG stream untouched — drawing from `Rng`
 * here would advance `rngState` and shift every seeded scenario in the suite. It
 * also means the save format gains NOTHING, which matters: the schema is frozen
 * post-CP9.
 *
 * The mixing constant is DELIBERATELY NOT `hotSideFromSeed`'s 0x6d2b79f5. Reusing
 * it would make these two derived properties the same random variable — the mural
 * index's low bit would BE the hot side, so (say) every Great Wave farm would
 * have its warm end on the same side of the garage forever. Nothing would look
 * broken; the garage would just be quietly less varied than it claims.
 * @param {number} key a stable per-farm number (see {@link muralOf})
 * @returns {{id: string}} an entry of {@link MURALS}
 */
export function muralFromSeed(key) {
  let t = ((key >>> 0) + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return MURALS[((t ^ (t >>> 14)) >>> 0) % MURALS.length];
}

/**
 * The mural a farm carries, read defensively off its state.
 *
 * Keyed on `createdAt`, and the choice of field is the whole correctness of this
 * feature. `FarmState` HAS NO `seed`: the constructor takes one, but it survives
 * only as `rngState`, which then advances on every tick. So there are exactly two
 * candidates, and one of them is a trap:
 *
 *   - `rngState` would re-roll the painting as the RNG is drawn — the wall would
 *     change mid-game, on the ticks where the population step happened to draw.
 *   - `createdAt` is stamped once when the farm is created and never written
 *     again, which is precisely why `hotSideOf` in js/sim/engine.js already uses
 *     it as ITS stable fallback. Same field, same reasoning, one precedent.
 *
 * Defaults to 0 rather than refusing, so a farm created without a timestamp (the
 * engine's own default, and any save predating the field) still gets a defined,
 * stable mural instead of flipping between loads — the `hotSideOf` discipline.
 * @param {{createdAt?: number}|null} state
 * @returns {{id: string}} an entry of {@link MURALS}
 */
export function muralOf(state) {
  return muralFromSeed(state?.createdAt ?? 0);
}

/** Path a mural's prepared image ships at. @param {{id: string}} mural */
export function muralPath(mural) {
  return `${MURAL_DIR}${mural.id}.webp`;
}

// --- Placement ---------------------------------------------------------------

/**
 * The box a mural is fitted inside, in wall texels: 9 x 3.6 world units at the
 * wall canvas's 96 texels per unit, centred on the wall.
 *
 * Height is the binding constraint for all eight works and that is intentional.
 * Paintings run about 4:5 to 3:2; the wall is 2.67:1. Fitting to WIDTH would
 * either stretch them or make a portrait work taller than the wall, so every
 * mural is fitted to the box and keeps its own aspect — it occupies PART of the
 * wall, the way a real mural does, rather than becoming wallpaper.
 *
 * 3.6 of the wall's 4.5 units leaves ~0.45 units of plaster above and below —
 * enough for the edge feather to complete against bare wall rather than running
 * off the top. The width bound only ever binds for a work wider than 2.5:1, and
 * exists so one does not silently run off the ends.
 *
 * **Raising this alone does nothing.** `muralLayout` never enlarges an image, so
 * the box is an upper bound and the prepared assets are what actually set the
 * size — they ship at exactly this height. Growing the mural means re-running the
 * prep step (DESIGN.md, "Wall murals") and changing this together; changing only
 * one of the two silently leaves the murals at their old size, or upscales
 * nothing and wastes the bytes.
 */
export const MURAL_BOX_WIDTH = 864;
export const MURAL_BOX_HEIGHT = 346;

/**
 * Texels over which the mural fades out at its own edge.
 *
 * The feather is not decoration. A mural composited with a hard edge draws its
 * own RECTANGLE on the plaster — the eye finds the straight line long before it
 * finds the painting, and the wall reads as having a poster stuck to it. Same
 * failure the contact shadow's radial falloff is built to avoid (textures.js,
 * `shadowAlpha`), and the same fix: reach EXACTLY zero at the boundary.
 */
export const MURAL_FEATHER = 28;

/**
 * How hard the mural modulates the plaster. The ONE taste knob in this file —
 * every other number here is measured or derived, exactly as
 * TONE_MAPPING_EXPOSURE is the only judgement in the lighting table.
 *
 * The prepared murals carry a standard deviation of 38/255, so at 0.85 the wall's
 * albedo swings roughly +/-13% over most of the mural and about +/-40% at the
 * extremes — clearly a painting, still plainly a wall. Raising it past ~1.2 puts
 * the composite into the clip that WALL_BASE_LEVEL's headroom is sized for.
 */
export const MURAL_STRENGTH = 0.85;

/**
 * The largest upward deviation a PREPARED mural can present: its brightest texel
 * (1.0) minus its mean, and the preparation step normalises every mural's mean to
 * mid-grey. So 0.5.
 *
 * This is the coupling that makes {@link WALL_BASE_LEVEL}'s headroom sufficient,
 * and it is stated here because it is otherwise invisible: the budget is
 * `WALL_BASE_LEVEL * (1 + MURAL_STRENGTH * MURAL_MAX_DEVIATION) <= 1`, asserted in
 * tests/murals.test.js, and it holds ONLY because the assets are mean-normalised.
 * Drop in a file that is mostly dark with a small bright highlight and its mean
 * falls, its peak deviation rises past this, and the highlight clips.
 *
 * Clipping is graceful — the composite clamps, so the result is a flattened
 * highlight rather than an artefact — but it is still a mural that does not look
 * like the others, which is the one thing this file's discipline exists to
 * prevent. Prepare assets with the recorded step (DESIGN.md, "Wall murals").
 */
export const MURAL_MAX_DEVIATION = 0.5;

/**
 * Where a mural of the given pixel size lands on the wall canvas: contain-fitted
 * into the box and centred. Never enlarges — an asset smaller than the box is a
 * prepared asset that wanted to be that size, and upscaling it would only blur it.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
export function muralLayout(imageWidth, imageHeight) {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  const fit = Math.min(MURAL_BOX_WIDTH / imageWidth, MURAL_BOX_HEIGHT / imageHeight, 1);
  const width = Math.round(imageWidth * fit);
  const height = Math.round(imageHeight * fit);
  return {
    x: Math.round((WALL_TEX_WIDTH - width) / 2),
    y: Math.round((WALL_TEX_HEIGHT - height) / 2),
    width,
    height,
  };
}

/**
 * The feather weight at a point inside a mural's rect: 1 well inside, ramping to
 * exactly 0 at the edge, smoothstepped so the ramp itself does not read as a
 * band. Coordinates are relative to the rect.
 * @param {number} x 0..width
 * @param {number} y 0..height
 * @param {{width: number, height: number}} layout
 * @returns {number} 0..1
 */
export function featherAt(x, y, layout) {
  // Clamped to the greatest edge distance the rect actually CONTAINS, so a mural
  // narrower than 2*MURAL_FEATHER still reaches full strength at its centre. Note
  // the -1: the deepest texel of a 16-wide rect sits 7.5 from an edge, not 8, so
  // a margin of width/2 would leave a small mural permanently short of full
  // strength — visible only as "that one mural is fainter than the others".
  const margin = Math.max(
    1,
    Math.min(MURAL_FEATHER, Math.floor((layout.width - 1) / 2), Math.floor((layout.height - 1) / 2)),
  );
  const edge = Math.min(x, y, layout.width - 1 - x, layout.height - 1 - y);
  if (edge <= 0) return 0;
  const t = Math.min(1, edge / margin);
  return t * t * (3 - 2 * t);
}

/**
 * Composite a mural into an already-painted wall base, in place.
 *
 * The blend is `base * (1 + STRENGTH * feather * (luma - mean))`:
 *
 *  - MULTIPLICATIVE, so the mural modulates the plaster rather than replacing it
 *    — the grain still reads through the painting, which is most of what makes it
 *    look painted ON something.
 *  - ZERO-MEAN, so it is a redistribution rather than a brightness change. This is
 *    the structural half of DESIGN.md's "nothing may change scene brightness while
 *    pretending to add detail"; the measured half is in {@link buildWallTexture}.
 *
 * Both the deviation and the multiply are taken in the texture's own ENCODED
 * space, not in linear. That is a deliberate departure from the rule V15 states
 * for grain AMPLITUDE, and it is worth being explicit about: the two rules are
 * about different things. Linear is the right space to judge how strong a uniform
 * grain is, and it is the only correct space to measure MEAN RADIANCE in — which
 * is why the compensation below is linear and always will be. But a painting's
 * tonal structure is not a uniform field. Its values cluster around mid-grey,
 * where linear space is violently asymmetric: sRGB 0.5 is linear 0.216, so a
 * zero-mean deviation taken there runs -0.22 down and +0.78 up, and the highlights
 * would tear away while the shadows barely moved. Encoded space is where the
 * asset was normalised and where its light and dark halves are symmetric, so it
 * is where the SHAPE is applied. Radiance is then corrected exactly, in linear,
 * from the finished pixels.
 * @param {{data: Uint8ClampedArray}} wall the wall base, WALL_TEX_WIDTH*HEIGHT*4
 * @param {{data: Uint8ClampedArray}} mural RGBA of the mural at its layout size
 * @param {{x: number, y: number, width: number, height: number}} layout
 */
export function compositeMural(wall, mural, layout) {
  if (!wall?.data || !mural?.data || !layout) return;
  const src = mural.data;
  const dst = wall.data;
  const count = layout.width * layout.height;
  if (src.length < count * 4) return;

  // Measured, never assumed: the prepared assets aim at a mid-grey mean, but a
  // re-prepped or hand-dropped file need not hit it, and a deviation taken around
  // an assumed 0.5 would then carry a DC offset straight into the wall.
  let sum = 0;
  for (let i = 0; i < count; i += 1) sum += src[i * 4];
  const mean = sum / count / 255;

  for (let row = 0; row < layout.height; row += 1) {
    const wy = layout.y + row;
    if (wy < 0 || wy >= WALL_TEX_HEIGHT) continue;
    for (let col = 0; col < layout.width; col += 1) {
      const wx = layout.x + col;
      if (wx < 0 || wx >= WALL_TEX_WIDTH) continue;

      const weight = featherAt(col, row, layout);
      if (weight <= 0) continue;

      const luma = src[(row * layout.width + col) * 4] / 255;
      const factor = 1 + MURAL_STRENGTH * weight * (luma - mean);

      const di = (wy * WALL_TEX_WIDTH + wx) * 4;
      const value = Math.max(0, Math.min(255, Math.round(dst[di] * factor)));
      dst[di] = value;
      dst[di + 1] = value;
      dst[di + 2] = value;
    }
  }
}

// --- Browser half ------------------------------------------------------------

/**
 * Decode a mural's image file.
 *
 * Deliberately `Image`, not a Three.js loader: `tests/release.test.js` forbids
 * importing any `*Loader`, because the loaders are the one part of the vendored
 * bundle that calls `fetch()` and this game must stay offline-capable. Resolves
 * to null on any failure — a missing or corrupt file leaves the wall as plain
 * plaster, which is exactly the pre-V21 wall rather than a broken one.
 * @param {{id: string}} mural
 * @returns {Promise<HTMLImageElement|null>}
 */
export function loadMuralImage(mural) {
  if (!mural || typeof Image !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn(`Mural "${mural.id}" could not be loaded; the wall stays plain.`);
      resolve(null);
    };
    img.src = muralPath(mural);
  });
}

/**
 * Rasterise a decoded mural into an RGBA buffer at its layout size.
 * @param {CanvasImageSource} image
 * @param {{width: number, height: number}} layout
 * @returns {{data: Uint8ClampedArray}|null}
 */
function rasteriseMural(image, layout) {
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, layout.width, layout.height);
  return ctx.getImageData(0, 0, layout.width, layout.height);
}

/**
 * Build the wall's texture, with a mural composited in when one is supplied.
 *
 * Returns the measured linear mean alongside it, because the caller cannot do its
 * job without it: a colour map multiplies albedo, so scene.js has to divide this
 * back out or the wall simply gets darker. Handing back a texture whose
 * compensation factor the caller has to remember to ask for separately is how
 * that step gets skipped.
 * @param {CanvasImageSource|null} image a decoded mural, or null for bare plaster
 * @param {HTMLCanvasElement|OffscreenCanvas|null} [canvas] defaults to a fresh one
 * @returns {{texture: CanvasTexture, linearMean: number}|null}
 */
export function buildWallTexture(image, canvas = createCanvas(WALL_TEX_WIDTH, WALL_TEX_HEIGHT)) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(WALL_TEX_WIDTH, WALL_TEX_HEIGHT);
  paintWallBase(imageData);

  if (image) {
    const layout = muralLayout(image.width, image.height);
    const mural = layout && rasteriseMural(image, layout);
    if (mural) compositeMural(imageData, mural, layout);
  }

  ctx.putImageData(imageData, 0, 0);

  const texture = new CanvasTexture(canvas);
  // A COLOUR map, so it declares sRGB — the same rule every other map in this
  // project follows, and the classic washed-out-everything bug when it is missing.
  texture.colorSpace = SRGBColorSpace;
  // No wrap mode and no repeat: this canvas covers the wall exactly once. That is
  // the whole difference between it and the three tiling grains.
  texture.name = 'wall';
  return { texture, linearMean: linearMeanOf(imageData.data) };
}
