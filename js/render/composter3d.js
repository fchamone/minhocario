// Procedural composter meshes (T17).
//
// BROWSER/render layer: may use Three.js. Builds a low-poly mesh for each of the
// six catalog models (js/sim/composters.js) from primitive geometry (boxes +
// cylinders) with flat colors, plus the contact-shadow blob that grounds it
// (V16). No addons and no image assets — self-contained and offline-safe like
// the rest of the render layer; the blob's one texture is generated procedurally
// by js/render/textures.js.
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
// the ground, and the floor plane occludes the sunken part from the camera —
// which is exactly the in-ground read we want. The x-ray is the one exception:
// scene.js's applyXray fades that floor plane to a translucent soil cutaway while
// x-raying THIS model, since otherwise it would hide everything the x-ray reveals.
//
// Silhouettes are intentionally distinct so an upgrade reads at a glance:
//   electric        appliance body + control panel + power light + vent stack
//   tier2/3/4       stacked trays — the TRAY COUNT equals the tier (2/3/4)
//   buried          in-ground drum, only a raised collar + domed lid show
//   eco             the largest: a peaked barrel/drum on feet with a front hatch

import {
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  LatheGeometry,
  ExtrudeGeometry,
  Shape,
  Vector2,
  MeshStandardMaterial,
  MeshBasicMaterial,
} from '../../vendor/three.module.min.js';
import { getComposter } from '../sim/composters.js';
import { buildContactShadowTexture } from './textures.js';

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

/**
 * Segment count for every lathe (V18). Inside the plan's mandated 8–12: enough to
 * read as round at this camera distance, few enough that `flatShading: true`
 * still facets the surface. A smooth lathe breaks the art direction more than it
 * helps — `DESIGN.md` states the low segment count as an identity, not a shortcut.
 *
 * MUST BE A MULTIPLE OF 4, which is not an aesthetic choice. A lathe places
 * vertices at `j * 2π / N`, so its bounding box only reaches the profile's full
 * radius on a ground axis if some vertex lands on that axis. N = 12 puts vertices
 * at 0°/90°/180°/270° and spans exactly `2 * radius` on both. N = 10 does not:
 * its widest vertex is at 72°, so the model is only `1.902 * radius` across in X
 * while `composterFootprint` still reports `2 * radius` — and the contact shadow
 * silently stops matching the silhouette it is cast by. This was the value first
 * written here, and the footprint test caught it.
 */
export const LATHE_SEGMENTS = 12;

/**
 * Add a surface of revolution about the Y axis (V18).
 *
 * The profile is a list of `[radius, y]` pairs read bottom-to-top. Two points at
 * the same y with different radii make a flat annulus; a run ending at radius 0
 * caps the shape. Nothing here may exceed the model's structural radius — see
 * {@link LATHE_SEGMENTS} for why the bounding box is load-bearing.
 * @param {Group} group
 * @param {Array<[number, number]>} profile [radius, y] pairs, bottom to top
 * @param {[number, number, number]} pos [x, y, z] origin of the profile's frame
 * @param {number} color
 * @returns {Mesh}
 */
function addLathe(group, profile, pos, color) {
  const points = profile.map(([radius, y]) => new Vector2(radius, y));
  const mesh = new Mesh(new LatheGeometry(points, LATHE_SEGMENTS), makeMaterial(color));
  mesh.position.set(pos[0], pos[1], pos[2]);
  group.add(mesh);
  return mesh;
}

/**
 * A rounded rectangle in the XY plane, for the extruded tray rims (V18).
 * @param {number} width
 * @param {number} depth
 * @param {number} radius corner radius, clamped to fit
 * @returns {Shape}
 */
function roundedRectShape(width, depth, radius) {
  const w = width / 2;
  const d = depth / 2;
  const r = Math.min(radius, w, d);
  const shape = new Shape();
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);
  return shape;
}

/**
 * Add an extruded rounded-rectangle slab, lying flat (thickness along Y) — the
 * tray rims and lids (V18). `pos` is the CENTRE, matching {@link addBox}, so the
 * call sites keep the coordinates they already had.
 *
 * `curveSegments: 2` keeps the corners faceted rather than smooth, for the same
 * reason the lathes stay at 12 segments.
 * @param {Group} group
 * @param {[number, number, number]} size [w, thickness, d]
 * @param {[number, number, number]} pos [x, y, z] centre
 * @param {number} color
 * @param {number} [radius] corner radius
 * @returns {Mesh}
 */
function addRim(group, size, pos, color, radius = 0.07) {
  const [width, thickness, depth] = size;
  const geometry = new ExtrudeGeometry(roundedRectShape(width, depth, radius), {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 2,
  });
  // Extrude runs along +Z in the shape's own frame; lay it flat so the thickness
  // becomes Y, then recentre so `pos` means the centre like every other helper.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -thickness / 2, 0);
  const mesh = new Mesh(geometry, makeMaterial(color));
  mesh.position.set(pos[0], pos[1], pos[2]);
  group.add(mesh);
  return mesh;
}

/**
 * Tag the mesh (or meshes) that physically ENCLOSE the x-ray cavity — the body
 * shell, not the lids, rims, legs or trim that only extend the silhouette.
 *
 * This is what `tests/composter3d.test.js` measures the cavity against. Checking
 * against the group's overall bounding box is near-vacuous: the lid and vent
 * stack alone keep it large enough to satisfy almost any drift. Tagging the
 * enclosing volume explicitly is what makes the containment test able to fail.
 * @param {...Mesh} meshes
 */
function markBody(...meshes) {
  for (const mesh of meshes) mesh.userData.shellBody = true;
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

/**
 * Structural dimensions for one model, in the composter group's LOCAL frame.
 *
 * SINGLE SOURCE OF TRUTH for the shell's load-bearing measurements: the builder
 * below and `composterCavity` both read this, so the x-ray fill volumes cannot
 * drift away from the silhouette they are supposed to sit inside. These numbers
 * used to be written out twice — once in each builder and again in the matching
 * `composterCavity` branch — linked only by `// see buildElectric` comments and
 * guarded by no test at all, so any silhouette edit silently misplaced the x-ray
 * internals. Change a dimension here and both sides follow.
 * @param {{kind: string, trays?: number}} spec entry from MODEL_SPEC
 * @param {{width: number, depth: number}} dims footprint from baseDims
 * @returns {object|null} kind-specific structural dims, or null for an unknown kind
 */
function structureOf(spec, dims) {
  const w = dims.width;
  const d = dims.depth;

  switch (spec.kind) {
    case 'electric': {
      const footH = 0.1;
      const bodyH = 1.5;
      return { w, d, zc: d / 2, footH, bodyH, topY: footH + bodyH };
    }
    case 'tray': {
      const legH = 0.34;
      const baseH = 0.42;
      const trayH = 0.42;
      const trays = spec.trays;
      const trayBottom = legH + baseH;
      return { w, d, zc: d / 2, legH, baseH, trayH, trays, trayBottom, lidY: trayBottom + trays * trayH };
    }
    case 'buried': {
      // `top` is where the sunken drum breaks the ground plane; the body hangs
      // `underH` below it, which is why the cavity is mostly at negative y.
      const r = w * 0.45;
      return { r, zc: r, underH: 1.5, top: 0.06 };
    }
    case 'eco': {
      const r = w * 0.5;
      const legH = 0.16;
      const bodyH = 1.7;
      return { r, zc: r, legH, bodyH, topY: legH + bodyH };
    }
    default:
      return null;
  }
}

// --- Model builders ----------------------------------------------------------

/** Heated appliance: distinct machine silhouette (panel, light, vent stack). */
function buildElectric(group, s) {
  const { w, d, zc, footH, bodyH, topY } = s;

  addLegs(group, w, d, footH, 0.14, APPLIANCE_DARK);
  markBody(addBox(group, [w, bodyH, d], [0, footH + bodyH / 2, zc], APPLIANCE_BODY));

  // Front control panel + a glowing power light.
  addBox(group, [w * 0.7, 0.42, 0.05], [0, footH + bodyH * 0.7, d + 0.02], APPLIANCE_DARK);
  addBox(group, [0.1, 0.1, 0.06], [w * 0.22, footH + bodyH * 0.78, d + 0.05], POWER_LIGHT, POWER_LIGHT);

  // Lid, a lid handle, and a vent stack that breaks the boxy silhouette.
  addBox(group, [w + 0.06, 0.16, d + 0.06], [0, topY + 0.08, zc], APPLIANCE_DARK);
  addBox(group, [w * 0.4, 0.06, 0.1], [0, topY + 0.19, d * 0.82], APPLIANCE_DARK);
  addCyl(group, 0.09, 0.09, 0.34, [w * 0.26, topY + 0.16 + 0.17, zc], APPLIANCE_DARK, 6);
}

/** Stacked-tray composter: `spec.trays` visible tiers over a collector + spigot. */
function buildTrayStack(group, s, spec) {
  const { w, d, zc, legH, baseH, trayH, trays, trayBottom, lidY } = s;

  addLegs(group, w, d, legH, 0.12, RIM_DARK);

  // Collector base (holds leachate) with a front drain spigot.
  markBody(addBox(group, [w * 0.9, baseH, d * 0.92], [0, legH + baseH / 2, zc], spec.body));
  const spigot = addCyl(group, 0.05, 0.05, 0.2, [0, legH + 0.12, d + 0.03], SPIGOT, 6);
  spigot.rotation.x = Math.PI / 2;

  // The stack: one box per tray, each capped by a darker rim line so the tier
  // count is unmistakable.
  // Rims are EXTRUDED rounded rectangles rather than boxes (V18) — a moulded
  // plastic rim has a radius on it, and at this camera distance that rounding is
  // most of what separates "stacked trays" from "stacked cubes". They sit
  // slightly proud of the trays and are deliberately NOT body-tagged, so they
  // extend the silhouette without widening the model's footprint.
  for (let i = 0; i < trays; i += 1) {
    const cy = trayBottom + i * trayH + trayH / 2;
    markBody(addBox(group, [w, trayH, d], [0, cy, zc], spec.body));
    addRim(group, [w + 0.05, 0.07, d + 0.05], [0, trayBottom + (i + 1) * trayH - 0.02, zc], RIM_DARK);
  }

  // Lid + handle.
  addRim(group, [w + 0.08, 0.16, d + 0.08], [0, lidY + 0.08, zc], RIM_DARK, 0.1);
  addRim(group, [w * 0.3, 0.08, 0.12], [0, lidY + 0.2, zc], RIM_DARK, 0.04);
}

/**
 * In-ground bin: the drum sinks below y=0; only a collar + domed lid show.
 *
 * DEVIATION (V18): the plan asks for "one lathe replaces three cylinders". Three
 * lathes replace three cylinders instead, because the three parts carry three
 * DIFFERENT colours — a dark sunken drum, a tan collar at ground level, an olive
 * dome — and one lathe is one material. Merging them would have collapsed the
 * colour break at the ground line, which is the main thing that reads "this bin
 * is in the ground" at a glance, and that read is this task's own acceptance
 * criterion. The geometry win is kept and put where it matters: each part now has
 * a shape a cylinder cannot express — a capped drum, a flared collar, and a
 * genuinely curved dome in place of the truncated cone.
 */
function buildBuried(group, s) {
  const { r, zc, underH, top } = s;
  const bottom = top - underH;

  // Sunken drum, capped at the bottom so the x-ray cutaway shows a closed vessel
  // rather than an open pipe.
  markBody(addLathe(group, [
    [0, bottom],
    [r, bottom],
    [r, top],
  ], [0, 0, zc], BURIED_BODY));

  // Collar at the surface, flaring outward toward its lip.
  addLathe(group, [
    [r, top],
    [r * 1.06, top + 0.06],
    [r * 1.06, 0.18],
  ], [0, 0, zc], BURIED_RIM);

  // Domed lid — curved, not a truncated cone.
  addLathe(group, [
    [r * 1.0, 0.18],
    [r * 0.94, 0.28],
    [r * 0.74, 0.38],
    [r * 0.42, 0.46],
    [0, 0.5],
  ], [0, 0, zc], BURIED_LID);

  addBox(group, [0.16, 0.08, 0.16], [0, 0.52, zc], BURIED_RIM);
}

/** Largest model: a peaked barrel/drum on feet with a front access hatch. */
function buildEco(group, s) {
  const { r, zc, legH, bodyH, topY } = s;

  // Feet around the drum base.
  const xs = [-r * 0.6, r * 0.6];
  const zs = [r - r * 0.6, r + r * 0.6];
  for (const x of xs) for (const z of zs) addBox(group, [0.16, legH, 0.16], [x, legH / 2, z], ECO_DARK);

  // Ribbed barrel (V18): a lathe whose profile steps in and out, so the drum
  // reads as corrugated rather than as a plain tube.
  //
  // The ribs cut INWARD from the barrel's structural radius, never outward. A
  // lathe's bounding box is exactly 2 x its widest profile radius, and
  // `composterFootprint` reports 2r for this model — so a rib bulging past r
  // would widen the real silhouette while the contact shadow kept the old size,
  // and nothing on screen would look wrong enough to notice. Grooves read as
  // ribbing just as well and keep the two in agreement.
  const RIBS = 5;
  const profile = [[0, legH], [r, legH]];
  for (let i = 1; i <= RIBS; i += 1) {
    profile.push([r * 0.93, legH + ((i - 0.5) * bodyH) / RIBS]);
    profile.push([r, legH + (i * bodyH) / RIBS]);
  }
  profile.push([0, topY]);
  markBody(addLathe(group, profile, [0, 0, zc], ECO_BODY));

  // Front hatch door.
  addBox(group, [r * 0.8, bodyH * 0.4, 0.1], [0, legH + bodyH * 0.4, zc + r * 0.86], ECO_DARK);
  // Lid rim + a peaked cone lid (the gabled top is the eco's tell).
  addCyl(group, r * 1.05, r * 1.05, 0.16, [0, topY + 0.08, zc], ECO_DARK, 8);
  addCyl(group, r * 0.15, r * 1.0, 0.45, [0, topY + 0.16 + 0.22, zc], ECO_DARK, 8);
}

// --- Contact shadow (V16) ----------------------------------------------------
// The cheapest fix in Phase D for the "bin floats" read, and deliberately ahead
// of real shadow maps (V19): one blended plane, one draw call, zero per-frame
// work, nothing to measure and nothing to gate. If V19 is dropped at its perf
// gate, this is what keeps the bin grounded.
//
// DEVIATION: the plan files this under js/render/{scene,textures}.js. It lives
// here instead, because everything about it is a property of the MODEL — it is
// sized from the model's footprint, parented to the model's group, and freed with
// the model. Building it here also puts it where a test can reach it with a real
// Raycaster, which is what caught the grab-target problem noted below; from
// scene.js the same claims could only have been asserted by reading source.

/** Height above the floor. Enough to beat z-fighting, far too little to see. */
const SHADOW_LIFT = 0.01;
/**
 * How far the blob spreads past the bin's footprint. The alpha falls to zero at
 * the plane's edge, so the *visible* core is a good deal smaller than the plane —
 * a spread of 1 would read as a shadow tucked strictly under the bin, which is
 * what an object welded to the floor looks like rather than one resting on it.
 */
const SHADOW_SPREAD = 1.6;
/** Peak darkness under the bin's centre. */
const SHADOW_STRENGTH = 0.42;

/**
 * Add the contact-shadow blob to a composter group. No-op for the buried model
 * (no footprint) and where no canvas exists, both of which arrive as a null.
 * @param {Group} group
 * @param {string} composterId
 */
function addContactShadow(group, composterId) {
  const footprint = composterFootprint(composterId);
  if (!footprint) return;

  const texture = buildContactShadowTexture();
  if (!texture) return; // no canvas — degrade to no shadow, as the surfaces do

  const blob = new Mesh(
    new PlaneGeometry(footprint.width * SHADOW_SPREAD, footprint.depth * SHADOW_SPREAD),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: SHADOW_STRENGTH,
      // Must not write depth: a blended plane lying on the floor that wrote depth
      // would punch a hole in whatever is drawn after it — including the bin's
      // own legs, which stand inside its radius.
      depthWrite: false,
      fog: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2; // lie flat, facing up
  blob.position.set(0, SHADOW_LIFT, footprint.z);
  blob.name = 'contactShadow';

  // Skipped by setShellTransparency's traversal. Not cosmetic: without the tag
  // the x-ray fades the shadow to 0.1 alongside the shell, and a bin that loses
  // its contact shadow the moment you look inside it goes straight back to
  // floating — in the one view where the floating read is most obvious.
  blob.userData.xrayPart = true;

  // Not pickable. `raycastComposter` intersects composterGroup RECURSIVELY, so
  // without this the blob silently becomes part of the drag grab target: the bin
  // could be grabbed by clicking bare floor up to 1.6x its own footprint away,
  // and the hover cursor would show 'grab' over apparently empty ground. That is
  // a change to an interaction built in T19 and re-verified at V12, made by a
  // decoration that has no business being in the hit test.
  blob.raycast = () => {};

  group.add(blob);
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

  const s = structureOf(spec, baseDims(composter.capacity));
  if (!s) return null;

  const group = new Group();
  group.name = `composter:${composterId}`;

  switch (spec.kind) {
    case 'electric':
      buildElectric(group, s);
      break;
    case 'tray':
      buildTrayStack(group, s, spec);
      break;
    case 'buried':
      buildBuried(group, s);
      break;
    case 'eco':
      buildEco(group, s);
      break;
    default:
      return null;
  }
  addContactShadow(group, composterId);
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
 * cavity sits mostly below y=0, matching the sunken drum. Nearly all of it is
 * therefore behind the ground plane, so scene.js's applyXray fades that plane
 * into a soil cutaway whenever the buried model is x-rayed — without it, the
 * floor would write depth at y=0 and hide this cavity's contents entirely.
 * @param {string|null} composterId catalog id (js/sim/composters.js)
 * @returns {{yMin: number, yMax: number, width: number, depth: number, z: number}|null}
 */
export function composterCavity(composterId) {
  const composter = composterId ? getComposter(composterId) : null;
  const spec = composterId ? MODEL_SPEC[composterId] : null;
  if (!composter || !spec) return null;

  const s = structureOf(spec, baseDims(composter.capacity));
  if (!s) return null;

  switch (spec.kind) {
    case 'electric':
      // Inset into the appliance body.
      return { yMin: s.footH + 0.12, yMax: s.topY - 0.12, width: s.w * 0.82, depth: s.d * 0.82, z: s.zc };
    case 'tray':
      // Collector base up through the last tray.
      return { yMin: s.legH + 0.04, yMax: s.lidY - 0.05, width: s.w * 0.82, depth: s.d * 0.82, z: s.zc };
    case 'buried':
      // Sunken drum, mostly below y=0.
      return { yMin: s.top - s.underH + 0.12, yMax: 0.04, width: s.r * 1.7, depth: s.r * 1.7, z: s.zc };
    case 'eco':
      // Drum on short feet.
      return { yMin: s.legH + 0.12, yMax: s.topY - 0.12, width: s.r * 1.7, depth: s.r * 1.7, z: s.zc };
    default:
      return null;
  }
}

/**
 * Ground footprint of a model's body, in the composter group's LOCAL frame (V16).
 *
 * Read from the SAME `structureOf` the builders and `composterCavity` use, so the
 * contact shadow tracks the silhouette it is cast by and cannot drift from it —
 * the discipline V6 established after the cavity dimensions had been maintained
 * by hand in two places. A blob sized independently would come apart the first
 * time a model's proportions changed, and the failure is silent: a shadow that is
 * merely the wrong size still looks like a shadow.
 *
 * Returns null for the BURIED model, which is sunk into the ground and has no
 * contact with the floor to shade. That null is the whole "skip for buried" rule,
 * expressed where the geometry is known rather than as a conditional at the call
 * site.
 * @param {string|null} composterId catalog id (js/sim/composters.js)
 * @returns {{width: number, depth: number, z: number}|null}
 */
export function composterFootprint(composterId) {
  const composter = composterId ? getComposter(composterId) : null;
  const spec = composterId ? MODEL_SPEC[composterId] : null;
  if (!composter || !spec) return null;

  const s = structureOf(spec, baseDims(composter.capacity));
  if (!s) return null;

  switch (spec.kind) {
    case 'electric':
    case 'tray':
      return { width: s.w, depth: s.d, z: s.zc };
    case 'eco':
      return { width: s.r * 2, depth: s.r * 2, z: s.zc };
    case 'buried':
      return null; // sunk into the ground — nothing rests on the floor
    default:
      return null;
  }
}

/**
 * Free a material AND every texture hanging off it (V15).
 *
 * `Material.dispose()` does NOT free the material's textures — Three deliberately
 * leaves that to the caller, because one texture is routinely shared by several
 * materials and disposing it with the first of them would break the rest. Here
 * nothing is shared: every builder constructs its own materials, so the material
 * is the texture's only owner and freeing them together is correct.
 *
 * Walked generically rather than as `material.map`: a surfacing pass sets several
 * slots at once (`map` + `roughnessMap` + `normalMap`), and a fix written for the
 * one property the plan happened to name would leak the rest with nothing
 * failing. Anything on the material that says it is a texture gets freed.
 * @param {import('three').Material|null|undefined} material
 */
function disposeMaterial(material) {
  if (!material) return;
  for (const value of Object.values(material)) {
    if (value?.isTexture) value.dispose();
  }
  material.dispose?.();
}

/**
 * Free every geometry + material + texture under a composter group and detach it
 * from its parent. Called on upgrade (T17) before building the replacement mesh so
 * swapping models does not leak GPU resources.
 *
 * The composter builders use flat colours and carry no textures today, so this
 * leaks nothing yet — the texture handling is here because V15 is the task that
 * makes textures a normal thing in the render layer, and the leak it would cause
 * is invisible until it has been growing for a while. `tests/composter3d.test.js`
 * plants the maps the builders do not have, so the guard is not vacuous.
 * @param {Group|null} group
 */
export function disposeComposterMesh(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose?.();
    const material = obj.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
  group.parent?.remove(group);
}
