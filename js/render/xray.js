// 3D x-ray view (T20).
//
// BROWSER/render layer: may use Three.js. When the x-ray toggle (js/ui/actions.js
// → main.js → scene.js) is on, the composter SHELL is swapped to a translucent
// material and this module reveals a stylized picture of the bin's insides:
//
//   - leachate + humus FILL VOLUMES that track farm.leachate / farm.humus live
//     (they rise on production and drop the instant the player drains/harvests);
//   - INSTANCED worm-population hints, one instanced mesh per stage (cocoons,
//     juveniles, adults), whose visible count scales with each stage's headcount;
//   - FOOD-QUEUE chunks — a small pool of blocks near the top, sized by portion
//     and tinted by decomposition, newest first.
//
// It is a pure VIEW over sim state: it only READS the farm (a plain JSON object)
// and never mutates it, so toggling the x-ray on/off — or updating it every frame
// — can never pause or perturb the simulation (the day counter keeps advancing;
// a T20 acceptance criterion). The DOM internals panel (T14) remains the numeric
// layer alongside this visual one.
//
// The internals are built ONCE per composter model as a child Group of the
// composter mesh (so they inherit its wall-position transform and drag-move for
// free) and are simply shown/hidden with the toggle; per-frame updates only move,
// scale, recolour, and re-count existing objects — no geometry is rebuilt while
// the clock runs. Disposal rides along with the composter group (scene.js's
// disposeComposterMesh traverses children), so an upgrade or teardown frees them.

import {
  Group,
  Mesh,
  InstancedMesh,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  Matrix4,
  Quaternion,
  Euler,
  Vector3,
  Color,
} from '../../vendor/three.module.min.js';
import { composterCavity } from './composter3d.js';
import { getComposter } from '../sim/composters.js';
// Pure sim reads (leaf catalog + pure helper), the same discipline scene.js uses
// for solarGain and composter3d.js uses for getComposter — so a food chunk's tint
// follows the SAME decomposition curve the sim runs, and can never drift from it.
import { decompositionFraction } from '../sim/foods.js';

// --- Tunables ---------------------------------------------------------------

/** Shell opacity while the x-ray is on (translucent, non-occluding). */
// Kept low on purpose: the shell colours are dark, and at each pixel the ray can
// cross the front wall AND a rim AND the lid, so the veil STACKS over whatever it
// covers. Every extra point of opacity darkens the internals multiple times over.
const SHELL_OPACITY = 0.1;

/** Vertical share of the cavity given to each stacked fill zone (bottom → up). */
const LEACHATE_ZONE = 0.22; // liquid pooling at the very bottom
const HUMUS_ZONE = 0.34; // processed castings above the liquid
// The remaining height (worm/bedding zone + a fresh-food band at the top) hosts
// the worm hints and food chunks.

/** Instanced worm hint cap per stage — a readable hint, not a literal count. */
const MAX_WORM_INSTANCES = 40;
/** Headcount at which a stage shows half its instance cap (saturating curve). */
const WORM_HALF_POP = 120;

/** Food-queue chunks shown in 3D (newest first); matches the DOM panel's feel. */
const MAX_CHUNKS = 6;

// Flat palette for the internals (opaque, so they read through the faint shell).
// Values are lifted well above "realistic" compost browns: these sit INSIDE a
// shadowed bin, behind a translucent shell, and are the one thing the player
// opened the x-ray to read. Relative hues are preserved so the stacked zones stay
// distinguishable from each other.
const LEACHATE_COLOR = 0xb8893f; // tea/amber liquid
const HUMUS_COLOR = 0x6b4f30; // castings brown — fills the largest zone
const COCOON_COLOR = 0xf0e6c0; // pale lemon-shaped cocoons
const JUVENILE_COLOR = 0xe0a5a5; // small pinkish worms
const ADULT_COLOR = 0xd4503c; // larger red worms
const FOOD_FRESH = new Color(0x9ed455); // bright green-yellow scraps
const FOOD_ROTTEN = new Color(0x8a6a3d); // brown, fully broken down

// --- Small helpers ----------------------------------------------------------

/** Clamp to [0, 1]. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Tiny deterministic PRNG (mulberry32) for STABLE internal layout. Render-only
 * entropy — never the sim RNG — used once at build time so worm/chunk positions
 * stay put across frames instead of jittering. (js/sim/ must never use this; the
 * render layer may.)
 * @param {number} seed
 * @returns {() => number} next float in [0, 1)
 */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flat-shaded opaque material for a solid internal (worms, humus).
 *
 * Self-lit on purpose. These meshes sit inside the bin cavity, where the only
 * strong light (the directional sun) rakes the OUTSIDE of the shell and never
 * reaches them — so lit-only materials left the internals nearly black at night,
 * exactly when the player opens the x-ray to read them. Emissive makes each zone
 * carry its own colour regardless of the hour, and `fog: false` stops the fog
 * washing them toward the sky colour (the sun patch opts out the same way).
 * Emissive is kept partial, not 1.0, so flat-shaded facets still catch some
 * scene light and the volumes keep their shape instead of reading as flat decals.
 */
function solidMaterial(color) {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    fog: false,
  });
}

/**
 * Map a stage headcount to a visible instance count via a saturating curve, so a
 * few worms already register and a large colony fills the cap without exploding
 * the instance budget.
 * @param {number} pop
 * @returns {number} 0..MAX_WORM_INSTANCES
 */
function hintCount(pop) {
  if (!(pop > 0)) return 0;
  const n = Math.round((MAX_WORM_INSTANCES * pop) / (pop + WORM_HALF_POP));
  return Math.min(MAX_WORM_INSTANCES, Math.max(1, n));
}

/** Absolute tick of a farm state — mirrors engine.absoluteTick without importing
 *  the whole engine into the render layer (farm is a plain state object). */
function absoluteTickOf(farm) {
  return (farm.day - 1) * 24 + farm.hour;
}

// --- Worm hint instancing ----------------------------------------------------

/**
 * Build one instanced-mesh worm hint for a stage: `MAX_WORM_INSTANCES` copies of
 * a small primitive scattered (deterministically) through the worm band of the
 * cavity, with the render count starting at 0. Per frame only `.count` changes.
 * @param {{yMin:number, yMax:number, width:number, depth:number, z:number}} cavity
 * @param {import('three').BufferGeometry} geometry
 * @param {number} color
 * @param {number} seed layout seed (distinct per stage so stages don't overlap 1:1)
 * @returns {InstancedMesh}
 */
function buildWormHint(cavity, geometry, color, seed) {
  const mesh = new InstancedMesh(geometry, solidMaterial(color), MAX_WORM_INSTANCES);
  mesh.userData.xrayPart = true; // excluded from the shell-transparency sweep
  mesh.count = 0;
  // An InstancedMesh's default bounding sphere is a single instance at the origin,
  // so instances scattered off-centre can be wrongly culled when the bin sits at a
  // wall extreme. These are tiny and few — just never cull them.
  mesh.frustumCulled = false;

  const rng = makeRng(seed);
  const height = cavity.yMax - cavity.yMin;
  const bandLo = cavity.yMin + height * 0.26;
  const bandHi = cavity.yMin + height * 0.86;
  const halfW = (cavity.width * 0.78) / 2;
  const halfD = (cavity.depth * 0.7) / 2;

  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const euler = new Euler();
  const one = new Vector3(1, 1, 1);
  for (let i = 0; i < MAX_WORM_INSTANCES; i += 1) {
    pos.set(
      (rng() * 2 - 1) * halfW,
      bandLo + rng() * (bandHi - bandLo),
      cavity.z + (rng() * 2 - 1) * halfD,
    );
    euler.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    quat.setFromEuler(euler);
    m.compose(pos, quat, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// --- Public API --------------------------------------------------------------

/**
 * Build the x-ray internals overlay for a composter model: a child Group holding
 * the leachate/humus fill boxes, three instanced worm hints, and a pool of food
 * chunks. Everything starts empty/zero; {@link updateXrayInternals} drives it from
 * live state. Returns null for an unknown/absent model (no cavity to fill).
 *
 * Add the returned group as a CHILD of the composter mesh so it inherits the
 * wall-position transform; scene.js's disposeComposterMesh frees it on upgrade.
 * @param {string|null} composterId catalog id (js/sim/composters.js)
 * @returns {Group|null}
 */
export function buildXrayInternals(composterId) {
  const cavity = composterCavity(composterId);
  if (!cavity) return null;

  const group = new Group();
  group.name = `xray:${composterId}`;
  group.userData.xrayPart = true;

  // Fill volumes: unit boxes scaled/positioned each frame (see updateXrayInternals).
  const leachateFill = new Mesh(
    new BoxGeometry(1, 1, 1),
    // Its own material rather than solidMaterial(): the liquid stays translucent
    // so the tank reads as wet. Emissive/fog match solidMaterial for the same
    // reason — it pools at the bottom of the cavity, the least-lit spot of all,
    // and being transparent it also picks up whatever dark thing is behind it.
    new MeshStandardMaterial({
      color: LEACHATE_COLOR,
      emissive: LEACHATE_COLOR,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      fog: false,
    }),
  );
  leachateFill.userData.xrayPart = true;
  leachateFill.visible = false;

  const humusFill = new Mesh(new BoxGeometry(1, 1, 1), solidMaterial(HUMUS_COLOR));
  humusFill.userData.xrayPart = true;
  humusFill.visible = false;

  // Worm hints: one instanced mesh per stage, distinct primitive + seed.
  const cocoons = buildWormHint(cavity, new SphereGeometry(0.04, 6, 4), COCOON_COLOR, 0x1a2b3c);
  const juveniles = buildWormHint(
    cavity,
    new CylinderGeometry(0.02, 0.02, 0.12, 5),
    JUVENILE_COLOR,
    0x4d5e6f,
  );
  const adults = buildWormHint(
    cavity,
    new CylinderGeometry(0.028, 0.028, 0.22, 5),
    ADULT_COLOR,
    0x778899,
  );

  // Food chunks: a fixed pool of independently-coloured blocks, hidden until used.
  const chunks = [];
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const chunk = new Mesh(new BoxGeometry(1, 1, 1), solidMaterial(FOOD_FRESH.getHex()));
    chunk.userData.xrayPart = true;
    chunk.visible = false;
    chunks.push(chunk);
    group.add(chunk);
  }

  group.add(leachateFill, humusFill, cocoons, juveniles, adults);
  group.userData.xray = { cavity, leachateFill, humusFill, cocoons, juveniles, adults, chunks };
  return group;
}

/**
 * Drive the overlay from the live farm state — called every rendered frame while
 * the x-ray is on. Reads only; scales the fill volumes to the current
 * humus/leachate levels, re-counts the worm hints, and lays out the newest food
 * chunks. A no-op for a malformed overlay or a null farm.
 * @param {Group|null} overlay a group from {@link buildXrayInternals}
 * @param {import('../sim/engine.js').FarmState|null} farm live state (read-only)
 */
export function updateXrayInternals(overlay, farm) {
  const data = overlay?.userData?.xray;
  if (!data || !farm) return;
  const { cavity, leachateFill, humusFill, cocoons, juveniles, adults, chunks } = data;
  const composter = getComposter(farm.composterId);
  const height = cavity.yMax - cavity.yMin;

  // Leachate liquid: bottom zone, height ∝ tank fill.
  const leachateCap = composter ? composter.leachateCapacity : 0;
  const leachateFrac = leachateCap > 0 ? clamp01(farm.leachate / leachateCap) : 0;
  setFillBox(leachateFill, cavity, cavity.yMin, height * LEACHATE_ZONE, leachateFrac);

  // Humus castings: the zone just above the liquid, height ∝ tray fill.
  const humusCap = composter ? composter.humusCapacity : 0;
  const humusFrac = humusCap > 0 ? clamp01(farm.humus / humusCap) : 0;
  setFillBox(humusFill, cavity, cavity.yMin + height * LEACHATE_ZONE, height * HUMUS_ZONE, humusFrac);

  // Worm hints: render only as many instances as each stage's headcount warrants.
  const pop = farm.population || { cocoons: 0, juveniles: 0, adults: 0 };
  cocoons.count = hintCount(pop.cocoons);
  juveniles.count = hintCount(pop.juveniles);
  adults.count = hintCount(pop.adults);

  updateChunks(chunks, cavity, farm);
}

/**
 * Scale a unit fill box to a fraction of its zone and sit it on the zone floor, or
 * hide it when effectively empty (a zero-height box would render as a sliver).
 * @param {Mesh} mesh
 * @param {{width:number, depth:number, z:number}} cavity
 * @param {number} floorY zone bottom in local Y
 * @param {number} zoneHeight full height of the zone
 * @param {number} frac 0..1 fill
 */
function setFillBox(mesh, cavity, floorY, zoneHeight, frac) {
  const h = frac * zoneHeight;
  if (h < 1e-3) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.scale.set(cavity.width * 0.9, h, cavity.depth * 0.9);
  mesh.position.set(0, floorY + h / 2, cavity.z);
}

/**
 * Lay out the food-queue chunk pool from the newest entries: size by portion,
 * spread across the top band, tint by decomposition (fresh green → rotten brown).
 * Extra pool slots are hidden.
 * @param {Mesh[]} chunks
 * @param {{yMin:number, yMax:number, width:number, z:number}} cavity
 * @param {import('../sim/engine.js').FarmState} farm
 */
function updateChunks(chunks, cavity, farm) {
  const height = cavity.yMax - cavity.yMin;
  const topY = cavity.yMin + height * 0.82;
  const spread = cavity.width * 0.62;
  const now = absoluteTickOf(farm);
  // Newest first (the queue is stored oldest-first for consumption), capped.
  const recent = farm.queue.slice(-MAX_CHUNKS).reverse();

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const entry = recent[i];
    if (!entry) {
      chunk.visible = false;
      continue;
    }
    chunk.visible = true;
    const size = Math.min(0.34, 0.12 + entry.liters * 0.045);
    chunk.scale.setScalar(size);
    const n = recent.length;
    const x = n > 1 ? (i / (n - 1) - 0.5) * spread : 0;
    chunk.position.set(x, topY + (i % 2) * 0.07, cavity.z);
    const decomp = clamp01(decompositionFraction(now - entry.addedAtTick));
    chunk.material.color.copy(FOOD_FRESH).lerp(FOOD_ROTTEN, decomp);
    // solidMaterial ties emissive to the colour it was built with, so the glow
    // has to track the fresh → rotten tint too; otherwise a fully broken-down
    // chunk keeps glowing fresh-green over its brown albedo.
    chunk.material.emissive.copy(chunk.material.color);
  }
}

/**
 * Fade ONE mesh to/from a non-occluding translucent state, remembering its
 * original look so the restore is exact.
 *
 * This is the single stash/restore mechanism for the whole x-ray: turning the
 * fade ON snapshots `{transparent, opacity, depthWrite}` into
 * `material.userData.xrayOrig` (only if not already stashed, so repeated ON
 * calls can never overwrite the snapshot with already-faded values), and turning
 * it OFF copies that snapshot back and drops it. Idempotent in both directions,
 * and a no-op when a material was never faded — so callers may reconcile every
 * frame or on every state change without bookkeeping of their own.
 *
 * Everything the x-ray hides behind — the composter shell (see
 * {@link setShellTransparency}) and the garage floor over the buried model's
 * sunken drum (scene.js) — goes through HERE rather than reimplementing the
 * save/restore, so no path can restore a partial or stale original.
 * @param {import('three').Object3D|null|undefined} mesh target (non-meshes are ignored)
 * @param {boolean} active true → faded, false → restore the stashed original
 * @param {{opacity?: number, depthWrite?: boolean}} [opts] fade look; `opacity`
 *   defaults to {@link SHELL_OPACITY} and `depthWrite` to false (non-occluding)
 */
export function setMaterialFade(mesh, active, opts = {}) {
  if (!mesh || !mesh.isMesh) return;
  const opacity = opts.opacity === undefined ? SHELL_OPACITY : opts.opacity;
  const depthWrite = opts.depthWrite === undefined ? false : opts.depthWrite;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (!material) continue;
    if (active) {
      if (material.userData.xrayOrig === undefined) {
        material.userData.xrayOrig = {
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        };
      }
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = depthWrite; // false → let whatever is behind show through
      material.needsUpdate = true;
    } else if (material.userData.xrayOrig) {
      const orig = material.userData.xrayOrig;
      material.transparent = orig.transparent;
      material.opacity = orig.opacity;
      material.depthWrite = orig.depthWrite;
      material.needsUpdate = true;
      delete material.userData.xrayOrig;
    }
  }
}

/**
 * Swap a composter shell to/from its translucent x-ray material. Walks the group's
 * shell meshes (skipping the internals overlay, which is tagged `xrayPart`) and
 * hands each one to {@link setMaterialFade}, so turning the x-ray OFF restores the
 * exact opaque look. Idempotent in both directions.
 * @param {Group|null} group the composter mesh group
 * @param {boolean} active true → translucent shell, false → restore
 */
export function setShellTransparency(group, active) {
  if (!group) return;
  group.traverse((obj) => {
    if (!obj.isMesh || obj.userData.xrayPart) return;
    setMaterialFade(obj, active, { opacity: SHELL_OPACITY, depthWrite: false });
  });
}
