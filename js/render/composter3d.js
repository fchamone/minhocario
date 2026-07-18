// Procedural composter meshes (T17).
//
// BROWSER/render layer: may use Three.js. Builds a low-poly mesh for each of the
// six catalog models (js/sim/composters.js) from primitive geometry (boxes +
// cylinders) with flat colors. No textures, no addons — self-contained and
// offline-safe like the rest of the render layer.
//
// The only sim import is the PURE composter catalog, read so mesh DIMENSIONS are
// DERIVED FROM CATALOG CAPACITY (bigger bin -> physically bigger mesh) — the same
// "sim is the single source of truth" discipline scene.js uses for solarGain.
//
// Each builder returns a THREE.Group whose local frame is: origin at the wall
// (back face near local z=0, body extending toward +z / the camera), footprint
// centred on x=0, and the bin standing on the ground plane at y=0. scene.js then
// positions the group at `state.wallPosition` along the wall. The buried model is
// the deliberate exception: its drum geometry extends BELOW y=0 so it sits into
// the ground (the opaque floor plane occludes the sunken part from the camera).
//
// Silhouettes are intentionally distinct so an upgrade reads at a glance:
//   electric        appliance body + control panel + power light + vent stack
//   tier2/3/4       stacked trays — the TRAY COUNT equals the tier (2/3/4)
//   buried          in-ground drum, only a raised collar + domed lid show
//   eco             the largest: a peaked barrel/drum on feet with a front hatch

import { Group, Mesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial } from '../../vendor/three.module.min.js';
import { getComposter } from '../sim/composters.js';

// --- Palette (flat colors) ---------------------------------------------------
const APPLIANCE_BODY = 0xe6e9ec;
const APPLIANCE_DARK = 0x30363d;
const POWER_LIGHT = 0x35d07f;
const RIM_DARK = 0x2b3038;
const SPIGOT = 0x1f232a;
const BURIED_BODY = 0x3a352d;
const BURIED_RIM = 0x715c3a;
const BURIED_LID = 0x5f7038;
const ECO_BODY = 0x2f5d38;
const ECO_DARK = 0x243f28;

/**
 * Visual spec per catalog id. `kind` selects the builder; tray models carry the
 * tray count and their body color (so the three tray tiers read as distinct
 * models, not just different heights).
 * @type {Record<string, {kind: string, trays?: number, body?: number}>}
 */
const MODEL_SPEC = {
  electric: { kind: 'electric' },
  tier2: { kind: 'tray', trays: 2, body: 0x2f8f4e },
  tier3: { kind: 'tray', trays: 3, body: 0x2f6f96 },
  tier4: { kind: 'tray', trays: 4, body: 0xb06a2e },
  buried: { kind: 'buried' },
  eco: { kind: 'eco' },
};

// --- Primitive helpers -------------------------------------------------------

/**
 * Flat-shaded standard material — faceted low-poly look that still responds to
 * the scene's day/night lighting (T18). `emissive` makes the power light glow.
 * @param {number} color hex color
 * @param {number} [emissive] hex emissive color (0 = none)
 * @returns {MeshStandardMaterial}
 */
function makeMaterial(color, emissive = 0) {
  return new MeshStandardMaterial({
    color,
    emissive,
    roughness: 0.85,
    metalness: 0.05,
    flatShading: true,
  });
}

/**
 * Add a box to a group.
 * @param {Group} group
 * @param {[number, number, number]} size [w, h, d]
 * @param {[number, number, number]} pos [x, y, z] centre
 * @param {number} color
 * @param {number} [emissive]
 * @returns {Mesh}
 */
function addBox(group, size, pos, color, emissive = 0) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), makeMaterial(color, emissive));
  mesh.position.set(pos[0], pos[1], pos[2]);
  group.add(mesh);
  return mesh;
}

/**
 * Add a (low-poly) cylinder/cone to a group. Axis is Y unless the caller rotates
 * the returned mesh.
 * @param {Group} group
 * @param {number} rTop
 * @param {number} rBottom
 * @param {number} height
 * @param {[number, number, number]} pos [x, y, z] centre
 * @param {number} color
 * @param {number} [segments]
 * @returns {Mesh}
 */
function addCyl(group, rTop, rBottom, height, pos, color, segments = 8) {
  const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, height, segments), makeMaterial(color));
  mesh.position.set(pos[0], pos[1], pos[2]);
  group.add(mesh);
  return mesh;
}

/** Four corner legs inside a [width × depth] footprint. */
function addLegs(group, width, depth, legH, legW, color) {
  const xs = [-width / 2 + legW * 0.7, width / 2 - legW * 0.7];
  const zs = [legW * 0.7, depth - legW * 0.7];
  for (const x of xs) for (const z of zs) addBox(group, [legW, legH, legW], [x, legH / 2, z], color);
}

/**
 * Footprint dimensions derived from catalog capacity: capacity 20 (electric) ->
 * smallest, capacity 100 (eco) -> largest. `t` is the normalized 0..1 size.
 * @param {number} capacity litres
 * @returns {{t: number, width: number, depth: number}}
 */
function baseDims(capacity) {
  const t = Math.min(1, Math.max(0, (capacity - 20) / 80));
  return { t, width: 1.1 + 1.2 * t, depth: 0.9 + 0.8 * t };
}

// --- Model builders ----------------------------------------------------------

/** Heated appliance: distinct machine silhouette (panel, light, vent stack). */
function buildElectric(group, dims) {
  const w = dims.width;
  const d = dims.depth;
  const zc = d / 2;
  const footH = 0.1;
  const bodyH = 1.5;
  const topY = footH + bodyH;

  addLegs(group, w, d, footH, 0.14, APPLIANCE_DARK);
  addBox(group, [w, bodyH, d], [0, footH + bodyH / 2, zc], APPLIANCE_BODY);

  // Front control panel + a glowing power light.
  addBox(group, [w * 0.7, 0.42, 0.05], [0, footH + bodyH * 0.7, d + 0.02], APPLIANCE_DARK);
  addBox(group, [0.1, 0.1, 0.06], [w * 0.22, footH + bodyH * 0.78, d + 0.05], POWER_LIGHT, POWER_LIGHT);

  // Lid, a lid handle, and a vent stack that breaks the boxy silhouette.
  addBox(group, [w + 0.06, 0.16, d + 0.06], [0, topY + 0.08, zc], APPLIANCE_DARK);
  addBox(group, [w * 0.4, 0.06, 0.1], [0, topY + 0.19, d * 0.82], APPLIANCE_DARK);
  addCyl(group, 0.09, 0.09, 0.34, [w * 0.26, topY + 0.16 + 0.17, zc], APPLIANCE_DARK, 6);
}

/** Stacked-tray composter: `spec.trays` visible tiers over a collector + spigot. */
function buildTrayStack(group, dims, spec) {
  const w = dims.width;
  const d = dims.depth;
  const zc = d / 2;
  const legH = 0.34;
  const baseH = 0.42;
  const trayH = 0.42;
  const trays = spec.trays;

  addLegs(group, w, d, legH, 0.12, RIM_DARK);

  // Collector base (holds leachate) with a front drain spigot.
  addBox(group, [w * 0.9, baseH, d * 0.92], [0, legH + baseH / 2, zc], spec.body);
  const spigot = addCyl(group, 0.05, 0.05, 0.2, [0, legH + 0.12, d + 0.03], SPIGOT, 6);
  spigot.rotation.x = Math.PI / 2;

  // The stack: one box per tray, each capped by a darker rim line so the tier
  // count is unmistakable.
  const trayBottom = legH + baseH;
  for (let i = 0; i < trays; i += 1) {
    const cy = trayBottom + i * trayH + trayH / 2;
    addBox(group, [w, trayH, d], [0, cy, zc], spec.body);
    addBox(group, [w + 0.05, 0.07, d + 0.05], [0, trayBottom + (i + 1) * trayH - 0.02, zc], RIM_DARK);
  }

  // Lid + handle.
  const lidY = trayBottom + trays * trayH;
  addBox(group, [w + 0.08, 0.16, d + 0.08], [0, lidY + 0.08, zc], RIM_DARK);
  addBox(group, [w * 0.3, 0.08, 0.12], [0, lidY + 0.2, zc], RIM_DARK);
}

/** In-ground bin: the drum sinks below y=0; only a collar + domed lid show. */
function buildBuried(group, dims) {
  const r = dims.width * 0.45;
  const zc = r;
  const underH = 1.5;

  // Drum, mostly below ground (top just breaks the surface).
  addCyl(group, r, r, underH, [0, 0.06 - underH / 2, zc], BURIED_BODY, 8);
  // Raised collar at the surface + a domed (truncated-cone) lid + handle.
  addCyl(group, r * 1.06, r * 1.06, 0.18, [0, 0.09, zc], BURIED_RIM, 8);
  addCyl(group, r * 0.55, r * 1.0, 0.24, [0, 0.3, zc], BURIED_LID, 8);
  addBox(group, [0.16, 0.08, 0.16], [0, 0.46, zc], BURIED_RIM);
}

/** Largest model: a peaked barrel/drum on feet with a front access hatch. */
function buildEco(group, dims) {
  const r = dims.width * 0.5;
  const zc = r;
  const legH = 0.16;
  const bodyH = 1.7;
  const topY = legH + bodyH;

  // Feet around the drum base.
  const xs = [-r * 0.6, r * 0.6];
  const zs = [r - r * 0.6, r + r * 0.6];
  for (const x of xs) for (const z of zs) addBox(group, [0.16, legH, 0.16], [x, legH / 2, z], ECO_DARK);

  addCyl(group, r, r, bodyH, [0, legH + bodyH / 2, zc], ECO_BODY, 8);
  // Front hatch door.
  addBox(group, [r * 0.8, bodyH * 0.4, 0.1], [0, legH + bodyH * 0.4, zc + r * 0.86], ECO_DARK);
  // Lid rim + a peaked cone lid (the gabled top is the eco's tell).
  addCyl(group, r * 1.05, r * 1.05, 0.16, [0, topY + 0.08, zc], ECO_DARK, 8);
  addCyl(group, r * 0.15, r * 1.0, 0.45, [0, topY + 0.16 + 0.22, zc], ECO_DARK, 8);
}

// --- Public API --------------------------------------------------------------

/**
 * Build the procedural mesh for a composter model. Returns null for an unknown
 * id (or null), so the caller can treat "no model yet" and "unknown model"
 * uniformly. Dimensions are derived from the model's catalog capacity.
 * @param {string|null} composterId catalog id (js/sim/composters.js)
 * @returns {Group|null} a ready-to-add scene group, base at local y=0
 */
export function buildComposterMesh(composterId) {
  const composter = composterId ? getComposter(composterId) : null;
  const spec = composterId ? MODEL_SPEC[composterId] : null;
  if (!composter || !spec) return null;

  const group = new Group();
  group.name = `composter:${composterId}`;
  const dims = baseDims(composter.capacity);

  switch (spec.kind) {
    case 'electric':
      buildElectric(group, dims);
      break;
    case 'tray':
      buildTrayStack(group, dims, spec);
      break;
    case 'buried':
      buildBuried(group, dims);
      break;
    case 'eco':
      buildEco(group, dims);
      break;
    default:
      return null;
  }
  return group;
}

/**
 * Interior fill region for the 3D x-ray overlay (T20), expressed in the composter
 * group's LOCAL frame: an upright box the stylized internals (leachate, humus,
 * worm hints, food chunks) are laid out inside. Derived from the SAME catalog
 * dims as the mesh, so the cavity always nests within the model's body and grows
 * with a larger bin — the "sim/catalog is the single source of truth" discipline
 * the rest of the render layer follows. Returns null for an unknown id.
 *
 * The box is centred on x=0 and z=`z`, spans [`yMin`, `yMax`] vertically, and is
 * `width` (x) by `depth` (z). The buried model is the deliberate exception: its
 * cavity sits mostly below y=0, matching the sunken drum (the opaque floor plane
 * then occludes the underground portion, just as it does the drum itself).
 * @param {string|null} composterId catalog id (js/sim/composters.js)
 * @returns {{yMin: number, yMax: number, width: number, depth: number, z: number}|null}
 */
export function composterCavity(composterId) {
  const composter = composterId ? getComposter(composterId) : null;
  const spec = composterId ? MODEL_SPEC[composterId] : null;
  if (!composter || !spec) return null;

  const dims = baseDims(composter.capacity);
  const w = dims.width;
  const d = dims.depth;

  switch (spec.kind) {
    case 'electric': {
      // Body: footH..footH+bodyH (see buildElectric).
      const footH = 0.1;
      const bodyH = 1.5;
      return { yMin: footH + 0.12, yMax: footH + bodyH - 0.12, width: w * 0.82, depth: d * 0.82, z: d / 2 };
    }
    case 'tray': {
      // Collector base up through the last tray (see buildTrayStack).
      const legH = 0.34;
      const baseH = 0.42;
      const trayH = 0.42;
      const top = legH + baseH + spec.trays * trayH;
      return { yMin: legH + 0.04, yMax: top - 0.05, width: w * 0.82, depth: d * 0.82, z: d / 2 };
    }
    case 'buried': {
      // Sunken drum, mostly below y=0 (see buildBuried).
      const r = w * 0.45;
      const underH = 1.5;
      return { yMin: 0.06 - underH + 0.12, yMax: 0.04, width: r * 1.7, depth: r * 1.7, z: r };
    }
    case 'eco': {
      // Drum on short feet (see buildEco).
      const r = w * 0.5;
      const legH = 0.16;
      const bodyH = 1.7;
      return { yMin: legH + 0.12, yMax: legH + bodyH - 0.12, width: r * 1.7, depth: r * 1.7, z: r };
    }
    default:
      return null;
  }
}

/**
 * Free every geometry + material under a composter group and detach it from its
 * parent. Called on upgrade (T17) before building the replacement mesh so
 * swapping models does not leak GPU resources.
 * @param {Group|null} group
 */
export function disposeComposterMesh(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose?.();
    const material = obj.material;
    if (Array.isArray(material)) material.forEach((m) => m?.dispose?.());
    else material?.dispose?.();
  });
  group.parent?.remove(group);
}
