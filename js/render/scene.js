// Three.js render layer — the minimal scene (T16).
//
// This is the BROWSER/render layer: it may touch the DOM and Three.js. It reads
// sim state but never mutates it (the hard boundary — only js/main.js orchestrates
// between layers). Three.js is the single vendored runtime dependency, imported
// ONLY via a relative path so the game stays fully static and offline-capable.
//
// Scope for T16: a fixed camera framing a garage wall + ground plane with basic
// lighting, mounted on the game screen's canvas, plus a `renderState()` frame API
// and window-resize handling. Procedural composter meshes (T17), day/night
// lighting driven by `continuousHour` + the sun patch (T18), drag-move (T19), and
// the 3D x-ray (T20) build on top of this scaffold. The public API is shaped now
// so those tasks extend it without reworking the mount/loop wiring in main.js.
//
// GRACEFUL DEGRADATION: if WebGL context creation fails, `initScene()` returns
// false and every other entry point becomes a no-op, so the DOM-only game keeps
// working (spec: the slider is the mandated fallback for placement).

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  Fog,
  HemisphereLight,
  DirectionalLight,
  AmbientLight,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  Float32BufferAttribute,
  DynamicDrawUsage,
  AdditiveBlending,
  Raycaster,
  Vector2,
  Vector3,
  Plane,
} from '../../vendor/three.module.min.js';
import { buildComposterMesh, disposeComposterMesh } from './composter3d.js';
import {
  buildXrayInternals,
  updateXrayInternals,
  setShellTransparency,
  setMaterialFade,
} from './xray.js';
// The ONE sim import the plan sanctions for the render layer: the SAME pure
// function the temperature model uses for heat (§2.6). Sampling it here to draw
// the sun patch means the visible bright region and the simulated warm spot are
// literally the same function — they cannot drift.
import { solarGain } from '../sim/temperature.js';

// --- Scene geometry contract -------------------------------------------------
// The garage wall runs along the world X axis; the composter's continuous
// `wallPosition ∈ [0, 1]` maps across its usable span. Exported so the composter
// mesh (T17), the sun patch (T18), and drag-move (T19) share ONE mapping and
// cannot drift from each other.

/** Full width of the garage wall in world units. */
export const WALL_WIDTH = 12;
/** Height of the garage wall in world units. */
export const WALL_HEIGHT = 4.5;
/** Depth of the ground plane (wall at z=0 out toward the camera). */
export const FLOOR_DEPTH = 8;
/**
 * Top face of the soil volume, a hair BELOW the ground plane at y=0 so the two
 * coplanar surfaces cannot z-fight while the floor is faded over it.
 */
const SOIL_TOP_Y = -0.02;
/**
 * Thickness of the soil volume. The deepest thing buried in it is the buried
 * model's drum, which bottoms out at y ≈ -1.44, so 2.2 clears it with margin —
 * the cross-section must never end above the bin it is meant to embed.
 */
const SOIL_DEPTH = 2.2;
/**
 * Fraction of the wall width the composter may occupy — leaves a margin at each
 * end so a bin at position 0 or 1 still sits fully on the wall rather than
 * hanging off the corner.
 */
const USABLE_SPAN = 0.8;

/**
 * Map a sim `wallPosition ∈ [0, 1]` to a world-space X coordinate along the wall.
 * 0 → far left, 0.5 → centre, 1 → far right. Shared by every render module so
 * placement visuals agree with the slider and with each other.
 * @param {number} wallPosition 0..1
 * @returns {number} world X
 */
export function wallPositionToWorldX(wallPosition) {
  const clamped = Math.min(1, Math.max(0, wallPosition));
  return (clamped - 0.5) * WALL_WIDTH * USABLE_SPAN;
}

/**
 * Inverse of {@link wallPositionToWorldX}: map a world-space X on the wall back to
 * a sim `wallPosition`. Used to colour the sun patch (each wall column samples
 * `solarGain` at ITS position) and available to drag-move (T19) for the reverse
 * raycast→position map. NOT clamped — points in the end margins fall outside
 * [0,1], where `solarGain` naturally reads ~0, so the patch fades off the corners.
 * @param {number} worldX world X along the wall
 * @returns {number} wallPosition (may fall slightly outside 0..1 in the margins)
 */
export function worldXToWallPosition(worldX) {
  return worldX / (WALL_WIDTH * USABLE_SPAN) + 0.5;
}

// --- Colors (T18 animates the sky/light per the day/night cycle) --------------
// SKY_COLOR is only the seed value for the background/fog/hemisphere; applyDayNight
// overwrites them every frame from the DAY_CYCLE keyframes below. The wall and
// floor keep fixed albedo and simply darken/warm with the scene lighting.
const SKY_COLOR = 0x9fb8cc;
const WALL_COLOR = 0x8f949c;
const FLOOR_COLOR = 0x5b4a37;
// Packed earth seen in CROSS-SECTION through the faded floor (see applyXray). A
// darker, desaturated FLOOR_COLOR: same earth, but reading as the shaded inside
// of the ground rather than as more of the lit surface — if it matched
// FLOOR_COLOR the cutaway would look like a second floor, not a section cut.
const SOIL_COLOR = 0x373028;

// --- Day/night cycle (T18) ---------------------------------------------------
// Keyframes across the 24h clock, interpolated by the continuous game hour so the
// scene reads day → dusk → night → dawn. At 1× (1 game day = 1 real minute) the
// whole arc is perceivable within a minute (spec acceptance criterion). Values
// are purely visual — the sim's thermal cycle lives in js/sim/temperature.js; the
// only shared quantity is solarGain, sampled below for the sun patch.
//   sky   background + fog + hemisphere sky tint
//   sun   directional light colour        sunI/hemiI/ambI  light intensities
const DAY_CYCLE = [
  { h: 0, sky: 0x1c2740, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
  { h: 5, sky: 0x1b2440, sun: 0x40506e, sunI: 0.14, hemiI: 0.22, ambI: 0.12 },
  { h: 6.5, sky: 0xd98a5c, sun: 0xffb066, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
  { h: 9, sky: 0x9fb8cc, sun: 0xfff1d6, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
  { h: 12, sky: 0xaecfe0, sun: 0xfff6e2, sunI: 1.0, hemiI: 0.82, ambI: 0.3 },
  { h: 15, sky: 0x9fb8cc, sun: 0xfff0d0, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
  { h: 17.5, sky: 0xe0743c, sun: 0xff8a48, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
  { h: 19, sky: 0x2a2742, sun: 0x4a4668, sunI: 0.16, hemiI: 0.26, ambI: 0.13 },
  { h: 21, sky: 0x1a2338, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.17, ambI: 0.1 },
  // Duplicate of h:0 so interpolation wraps cleanly through midnight.
  { h: 24, sky: 0x1c2740, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
];

// Exposure correction for the vendored Three r170, which uses the post-r155
// physically-correct light units (`useLegacyLights` was removed in r165). The
// DAY_CYCLE intensities above are authored in legacy-era numbers and render far
// too dim under r170, so every intensity is remapped as `floor + GAIN * curve`
// before it reaches a light.
//
// The FLOOR is what keeps the bin readable at midnight; the GAIN preserves the
// authored day/night SHAPE on top of it. Deliberately a floor-lift rather than a
// flat multiply: a pure multiply would leave night proportionally as black as it
// is now. Ambient runs 0.10 -> 0.49 at night and 0.30 -> 0.87 at noon, so the
// day/night ratio compresses from 3.0x to ~1.8x — dimmer at night, never black.
// Scene-wide the totals go 0.36 -> 1.45 at midnight and 2.12 -> 4.80 at noon,
// leaving night 3.3x darker than noon.
//
// Why these values are safe rather than merely brighter: pre-r155 Three scaled
// these light types by PI internally, so an authored 1.0 already MEANT ~3.14.
// Measured against that original intent, every daytime value here still lands
// BELOW it (noon sun 64%, hemi 74%, ambient 92%) — this restores brightness the
// renderer upgrade silently took away, it does not add new, so midday cannot
// clip to flat white and no tone-mapping curve is needed. Only the night end is
// pushed past the old intent (ambient 156%), which is the deliberate floor.
// These two constants are the only brightness knobs; tune them by eye.
const LIGHT_FLOOR = { sun: 0.12, hemi: 0.35, amb: 0.3 };
const LIGHT_GAIN = 1.9;

// Directional-light arc: the "sun" rises on the left, peaks overhead at noon, and
// sets on the right — matching the sun patch, which sweeps wallPosition 0 → 1.
const SUN_ARC_X = 7; // horizontal travel each side of centre (world units)
const SUN_ARC_Y = 9; // extra height at solar noon
const SUN_Z = 6; // fixed depth toward the camera so the wall front stays lit
const VISUAL_SUNRISE = 6; // must match temperature.js SUNRISE_HOUR for patch sync
const VISUAL_SUNSET = 18; // must match temperature.js SUNSET_HOUR

// --- Sun patch (T18) ---------------------------------------------------------
// A warm additive overlay on the wall whose per-column brightness IS solarGain at
// that column's wallPosition. Additive means shade (gain 0, incl. all night) adds
// nothing, so the patch simply appears and sweeps during the day and vanishes at
// night — no separate on/off logic. Normalised by the function's own peak so it
// auto-tracks any future SOLAR_MAX change (SOLAR_MAX is private to the sim).
const WALL_SEGMENTS = 64; // horizontal columns — smooth gradient across the wall
const SUN_PATCH_STRENGTH = 0.6; // additive gain at the function's peak
const SUN_TINT_R = 1.0;
const SUN_TINT_G = 0.82;
const SUN_TINT_B = 0.5;
/** Global maximum of solarGain (peak is noon at wallPosition 0.5); guards ÷0. */
const SOLAR_PEAK = solarGain(0.5, 12) || 1;

// --- Module singleton --------------------------------------------------------
// One renderer/scene/camera per page. Kept module-private; the exported functions
// are the only surface. `ready` gates every operation so a WebGL failure (or a
// call before init) is a silent no-op rather than a thrown error that would take
// the DOM game down with it.

/** @type {WebGLRenderer|null} */
let renderer = null;
/** @type {Scene|null} */
let scene = null;
/** @type {PerspectiveCamera|null} */
let camera = null;
/** @type {HTMLCanvasElement|null} */
let sceneCanvas = null;
/** Whether the scene initialized successfully and may be rendered. */
let ready = false;
/** Bound resize handler, retained so it can be removed on dispose. */
let onWindowResize = null;
/**
 * The live composter mesh group (T17) and the catalog id it was built from. The
 * mesh is rebuilt only when the id changes, so a mid-farm upgrade swaps the model
 * live while plain re-renders just reposition it.
 * @type {import('three').Group|null}
 */
let composterGroup = null;
/** @type {string|null} */
let composterModelId = null;

// --- X-ray view (T20) --------------------------------------------------------
// A render-only toggle: it makes the composter shell translucent and reveals a
// stylized internals overlay (js/render/xray.js) that tracks the live levels. It
// NEVER touches the sim — the clock keeps advancing while it is on. State lives
// module-side so renderState can refresh the overlay every frame and a mid-farm
// upgrade re-applies it to the new mesh.

/**
 * Ground-plane opacity while x-raying the BURIED model (see applyXray). Kept far
 * higher than the shell's 0.1: the floor is a single flat plane crossed once per
 * ray, not a stack of walls/rims/lid, so it never compounds — and at ~0.25 it
 * still reads as ground (the bin keeps standing on something) while the drum
 * below it stays legible.
 *
 * The cutaway is TWO parts, and both are required. Fading the floor only makes it
 * see-through; what a ray finds behind it is the second part — the opaque
 * {@link SOIL_COLOR} volume filling the space under the floor (see buildScene and
 * the soilMesh gate in applyXray). Without that volume every ray that misses the
 * sunken drum would fall through to `scene.background`, which applyDayNight drives
 * to the live SKY colour: in daylight the floor would read as a quarter-strength
 * brown wash over open sky and the bin would appear to float. Fade + soil together
 * are what make this a soil cutaway rather than a hole in the garage.
 */
const FLOOR_XRAY_OPACITY = 0.25;

/** Whether the x-ray view is currently on. */
let xrayActive = false;
/**
 * The internals overlay, added as a CHILD of composterGroup so it inherits the
 * wall-position transform (and is disposed with the group on upgrade/teardown).
 * @type {import('three').Group|null}
 */
let xrayOverlay = null;

// Animated lights + sun patch, retained so applyDayNight() can drive them each
// frame without re-walking the scene graph.
/** @type {DirectionalLight|null} the sweeping "sun". */
let sunLight = null;
/** @type {HemisphereLight|null} sky/ground bounce. */
let hemiLight = null;
/** @type {AmbientLight|null} floor for shadowed faces. */
let ambientLight = null;
/**
 * The ground plane, retained so applyXray() can fade it into a soil cutaway for
 * the buried model. It is a scene-ROOT sibling of composterGroup — NOT one of its
 * children — so setShellTransparency's traversal can never reach it; without this
 * handle the x-ray would leave it writing depth at y=0 over the sunken drum.
 * @type {import('three').Mesh|null}
 */
let floorMesh = null;
/**
 * The opaque earth volume under the floor — what the faded floor actually reveals
 * (see FLOOR_XRAY_OPACITY). Retained so applyXray() can gate its visibility on the
 * EXACT condition that fades the floor. That gate is load-bearing, not tidiness:
 * the camera sits at z=9, outside the floor's z range [0, 8], so the box's near
 * face would otherwise poke into frame below the floor's front edge during normal
 * play. Hidden at construction; only the buried x-ray ever shows it.
 * @type {import('three').Mesh|null}
 */
let soilMesh = null;
/** @type {import('three').BufferAttribute|null} the sun patch's per-vertex colours. */
let sunPatchColors = null;
/**
 * Precomputed sim `wallPosition` for each sun-patch vertex (derived once from its
 * world X), so per-frame updates only sample solarGain and write colours.
 * @type {Float32Array|null}
 */
let sunPatchWallPos = null;

// Reusable colour scratch objects — applyDayNight runs every frame, so these
// avoid per-frame allocations.
const _skyColor = new Color();
const _sunColor = new Color();
const _lerpTmp = new Color();

/**
 * Gap (world units) between the garage wall (z=0) and the composter's back face,
 * so the bin stands a little in front of the wall on the floor. The mesh is built
 * with its back at local z=0, so this is applied as the group's z position.
 */
const BIN_WALL_GAP = 0.5;

// --- Drag-move state (T19) ---------------------------------------------------
// Pointer-driven placement: grab the composter mesh with a raycast, then drag it
// along a wall-aligned plane. The clamped wallPosition is handed back to main.js
// through `onDragMove` — the SAME action the actions-panel slider dispatches — so
// autosave, state, and the slider stay in lockstep (bidirectional sync).

/** @type {Raycaster|null} lazily created when drag-move is enabled. */
let raycaster = null;
/** Pointer position in normalized device coords, reused each raycast. */
const _pointerNdc = new Vector2();
/** Plane normal (faces the camera, so the drag plane is parallel to the wall). */
const _planeNormal = new Vector3(0, 0, 1);
/** The wall-aligned drag plane; reset through the grab point on each pointerdown. */
const _dragPlane = new Plane(_planeNormal.clone(), -BIN_WALL_GAP);
/** Scratch vector for the ray↔plane intersection, reused each move. */
const _dragHit = new Vector3();
/** Whether pointer listeners are installed (enableDragMove is idempotent). */
let dragEnabled = false;
/** @type {((position: number) => void)|null} sink for the dragged wallPosition. */
let onDragMove = null;
/** Whether a grab is currently in progress. */
let dragging = false;
/** The pointerId that owns the active drag (ignore other pointers mid-drag). */
let dragPointerId = null;
/**
 * World-X gap between the composter's origin and the grabbed surface point, so the
 * exact point the player grabbed stays pinned under the cursor during the drag.
 */
let dragGrabOffsetX = 0;
/** Retained bound listeners, so disposeScene can detach them. */
let dragListeners = null;

/**
 * Build the wall + floor + lights into the scene. Pure scene-graph assembly, no
 * renderer/DOM access, so it is trivial to extend in later tasks.
 * @param {Scene} target
 */
function buildScene(target) {
  target.background = new Color(SKY_COLOR);
  // A little distance fog softens the wall edges and reads as garage depth. The
  // near plane must stay BEYOND the subject: the camera sits at z=9 and the wall
  // at z=0, so a near of 14 was fogging the wall and bin themselves — pulling
  // them toward the (at night, near-black) sky colour. Starting at 22 keeps the
  // depth cue for the far edges while leaving the composter unfogged.
  target.fog = new Fog(SKY_COLOR, 22, 45);

  // Garage wall: a vertical plane at z=0, its base on the ground, facing +z
  // (toward the camera). A thin box would also work; a plane keeps it cheap.
  const wall = new Mesh(
    new PlaneGeometry(WALL_WIDTH, WALL_HEIGHT),
    new MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95, metalness: 0 }),
  );
  wall.position.set(0, WALL_HEIGHT / 2, 0);
  wall.name = 'garageWall';
  target.add(wall);

  // Sun patch: a warm additive overlay a hair in front of the wall, subdivided
  // horizontally so its per-column brightness can trace solarGain across the
  // wall. Colours start black (adds nothing); applyDayNight fills them per frame.
  const patchGeom = new PlaneGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_SEGMENTS, 1);
  const posAttr = patchGeom.getAttribute('position');
  const vertexCount = posAttr.count;
  sunPatchWallPos = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i += 1) {
    sunPatchWallPos[i] = worldXToWallPosition(posAttr.getX(i));
  }
  const colorAttr = new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3);
  colorAttr.setUsage(DynamicDrawUsage);
  patchGeom.setAttribute('color', colorAttr);
  sunPatchColors = colorAttr;

  const patch = new Mesh(
    patchGeom,
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  patch.position.set(0, WALL_HEIGHT / 2, 0.02);
  patch.name = 'sunPatch';
  target.add(patch);

  // Ground plane: lies flat (rotated so its normal points up), extending from the
  // wall (z=0) out toward the camera.
  const floor = new Mesh(
    new PlaneGeometry(WALL_WIDTH, FLOOR_DEPTH),
    new MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, FLOOR_DEPTH / 2);
  floor.name = 'garageFloor';
  floorMesh = floor; // retained like the lights below — see applyXray (soil cutaway)
  target.add(floor);

  // Soil volume: an opaque block of earth filling the space UNDER the floor, so
  // the buried x-ray's faded floor reveals ground rather than the sky background
  // (see FLOOR_XRAY_OPACITY). Sized to the floor's own footprint in x/z, with its
  // top face SOIL_TOP_Y below the plane to avoid z-fighting with it, and deep
  // enough to bottom out past the buried drum (drum bottom y ≈ -1.44, its x-ray
  // cavity yMin ≈ -1.32) so no ray that hits the bin's depth range escapes below
  // the earth. Starts hidden — applyXray is the ONLY thing that ever shows it.
  const soil = new Mesh(
    new BoxGeometry(WALL_WIDTH, SOIL_DEPTH, FLOOR_DEPTH),
    new MeshStandardMaterial({ color: SOIL_COLOR, roughness: 1, metalness: 0 }),
  );
  soil.position.set(0, SOIL_TOP_Y - SOIL_DEPTH / 2, FLOOR_DEPTH / 2);
  soil.name = 'garageSoil';
  soil.visible = false;
  soilMesh = soil;
  target.add(soil);

  // Lighting: hemisphere for soft sky/ground bounce, a directional "sun" for
  // shape, and a touch of ambient so shadowed faces never go fully black. All
  // three are retained module-side so applyDayNight (T18) animates their colour,
  // intensity, and (for the sun) direction across the day/night cycle. The seed
  // values here are the daytime look; the first frame overwrites them.
  hemiLight = new HemisphereLight(SKY_COLOR, FLOOR_COLOR, 0.7);
  target.add(hemiLight);

  sunLight = new DirectionalLight(0xfff2d8, 0.9);
  sunLight.position.set(5, 8, 6);
  sunLight.name = 'sun';
  target.add(sunLight);

  ambientLight = new AmbientLight(0xffffff, 0.25);
  target.add(ambientLight);
}

/**
 * Initialize the render layer onto a canvas. Safe to call once; a second call is
 * ignored while a scene is live. Returns false (and leaves the game DOM-only) if
 * WebGL is unavailable or context creation throws.
 * @param {HTMLCanvasElement} canvas the mounted game-screen canvas
 * @returns {boolean} true if the scene is ready to render
 */
export function initScene(canvas) {
  if (ready) return true;
  if (!canvas) return false;

  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    // No WebGL (blocked, headless, or unsupported) — degrade to the DOM game.
    console.warn('WebGL unavailable; 3D scene disabled.', err);
    renderer = null;
    return false;
  }

  // Guard against a null context slipping through without throwing.
  if (!renderer || (typeof renderer.getContext === 'function' && !renderer.getContext())) {
    console.warn('WebGL context could not be created; 3D scene disabled.');
    renderer = null;
    return false;
  }

  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

  scene = new Scene();
  camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 3.2, 9);
  camera.lookAt(0, 1.6, 2);

  buildScene(scene);
  sceneCanvas = canvas;
  ready = true;

  // Size to the canvas now and on every window resize. The game screen may be
  // hidden at init (zero-sized canvas); resizeScene() re-measures on entry.
  resizeScene();
  onWindowResize = () => resizeScene();
  globalThis.addEventListener?.('resize', onWindowResize);

  return true;
}

/** @returns {boolean} whether the scene initialized and may be rendered. */
export function isSceneReady() {
  return ready;
}

/**
 * Match the renderer + camera to the canvas's current CSS pixel size. Called on
 * window resize and whenever the game screen becomes visible (the canvas has no
 * layout size while its screen is hidden). No-op until a real size is available.
 */
export function resizeScene() {
  if (!ready || !renderer || !camera || !sceneCanvas) return;
  const width = sceneCanvas.clientWidth;
  const height = sceneCanvas.clientHeight;
  if (width === 0 || height === 0) return; // hidden screen — nothing to size yet
  // updateStyle=false: CSS (width/height:100%) owns the display size; we only set
  // the drawing-buffer resolution.
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

/**
 * Reconcile the composter mesh with the current sim state (T17): build/swap the
 * model when `composterId` changes, dispose the old one, and place the group at
 * `wallPosition` along the wall. Called every frame from renderState; cheap when
 * nothing changed (a Vector3 write).
 * @param {import('../sim/engine.js').FarmState|null} state
 */
function syncComposter(state) {
  if (!scene) return;
  const desiredId = state && typeof state.composterId === 'string' ? state.composterId : null;

  if (desiredId !== composterModelId) {
    if (composterGroup) {
      disposeComposterMesh(composterGroup);
      composterGroup = null;
      // The overlay was a child of the old group, so it was just disposed too.
      xrayOverlay = null;
    }
    composterModelId = desiredId;
    if (desiredId) {
      composterGroup = buildComposterMesh(desiredId);
      if (composterGroup) scene.add(composterGroup);
    }
    // Re-apply the x-ray to the freshly built mesh so an upgrade stays x-rayed.
    if (xrayActive) applyXray();
  }

  if (composterGroup) {
    const wallPosition =
      state && typeof state.wallPosition === 'number' ? state.wallPosition : 0.5;
    composterGroup.position.set(wallPositionToWorldX(wallPosition), 0, BIN_WALL_GAP);
  }
}

/**
 * Locate the two DAY_CYCLE keyframes bracketing an hour and the 0..1 blend
 * between them. The clock is wrapped into [0, 24) first; the h:24 duplicate makes
 * the late-night segment (21→24) interpolate cleanly back to midnight.
 * @param {number} hour continuous game hour
 * @returns {{k0: typeof DAY_CYCLE[number], k1: typeof DAY_CYCLE[number], t: number}}
 */
function sampleDayCycle(hour) {
  const hr = ((hour % 24) + 24) % 24;
  let k0 = DAY_CYCLE[0];
  let k1 = DAY_CYCLE[DAY_CYCLE.length - 1];
  for (let i = 0; i < DAY_CYCLE.length - 1; i += 1) {
    if (hr >= DAY_CYCLE[i].h && hr <= DAY_CYCLE[i + 1].h) {
      k0 = DAY_CYCLE[i];
      k1 = DAY_CYCLE[i + 1];
      break;
    }
  }
  const span = k1.h - k0.h || 1;
  return { k0, k1, t: Math.min(1, Math.max(0, (hr - k0.h) / span)) };
}

/** Linear scalar interpolation. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map an authored DAY_CYCLE intensity onto the r170 physical light scale: lift it
 * by a per-light floor so night never bottoms out to black, then apply the global
 * gain so the authored day/night shape survives on top of the floor. See the
 * LIGHT_FLOOR/LIGHT_GAIN comment for why this is a floor-lift, not a multiply.
 * @param {number} curveValue interpolated DAY_CYCLE intensity
 * @param {number} floor the light's LIGHT_FLOOR entry
 * @returns {number} intensity to hand to the light
 */
function litIntensity(curveValue, floor) {
  return floor + LIGHT_GAIN * curveValue;
}

/**
 * Sweep the directional light along its daytime arc: low on the left at sunrise,
 * high overhead at noon, low on the right at sunset. At night it parks at an end
 * (intensity is near-zero there anyway). Direction matches the sun patch, which
 * sweeps wallPosition 0 → 1 left → right.
 * @param {number} hour continuous game hour
 */
function positionSun(hour) {
  if (!sunLight) return;
  const frac = Math.min(1, Math.max(0, (hour - VISUAL_SUNRISE) / (VISUAL_SUNSET - VISUAL_SUNRISE)));
  const elevation = Math.sin(Math.PI * frac); // 0 at the horizon, 1 at noon
  sunLight.position.set((frac - 0.5) * 2 * SUN_ARC_X, 1.2 + elevation * SUN_ARC_Y, SUN_Z);
}

/**
 * Repaint the sun patch: each wall column's warm additive colour is its own
 * `solarGain(position, hour)`, normalised by the function's peak. Zero gain
 * (shade, and all night) writes black, which adds nothing — so the patch sweeps
 * during the day and disappears at night with no separate toggle.
 * @param {number} hour continuous game hour
 */
function updateSunPatch(hour) {
  if (!sunPatchColors || !sunPatchWallPos) return;
  const colors = sunPatchColors.array;
  for (let i = 0; i < sunPatchWallPos.length; i += 1) {
    const s = (SUN_PATCH_STRENGTH * solarGain(sunPatchWallPos[i], hour)) / SOLAR_PEAK;
    colors[i * 3] = SUN_TINT_R * s;
    colors[i * 3 + 1] = SUN_TINT_G * s;
    colors[i * 3 + 2] = SUN_TINT_B * s;
  }
  sunPatchColors.needsUpdate = true;
}

/**
 * Drive the whole day/night look from the continuous game hour: sky/fog colour,
 * the three light intensities, the sun's colour + direction, and the sun patch.
 * Called once per rendered frame so the transition is smooth between discrete
 * sim ticks (the sim stays hourly; only the visuals interpolate — §2.3).
 * @param {number} hour continuous game hour (0..24)
 */
function applyDayNight(hour) {
  if (!scene) return;
  const { k0, k1, t } = sampleDayCycle(hour);

  // Sky drives the background, the fog colour, and the hemisphere's sky tint.
  _skyColor.set(k0.sky).lerp(_lerpTmp.set(k1.sky), t);
  if (scene.background?.isColor) scene.background.copy(_skyColor);
  if (scene.fog) scene.fog.color.copy(_skyColor);

  if (sunLight) {
    sunLight.color.copy(_sunColor.set(k0.sun).lerp(_lerpTmp.set(k1.sun), t));
    sunLight.intensity = litIntensity(lerp(k0.sunI, k1.sunI, t), LIGHT_FLOOR.sun);
    positionSun(hour);
  }
  if (hemiLight) {
    hemiLight.intensity = litIntensity(lerp(k0.hemiI, k1.hemiI, t), LIGHT_FLOOR.hemi);
    hemiLight.color.copy(_skyColor);
  }
  if (ambientLight) {
    ambientLight.intensity = litIntensity(lerp(k0.ambI, k1.ambI, t), LIGHT_FLOOR.amb);
  }

  updateSunPatch(hour);
}

/**
 * Render one frame for the given sim state. Called from the main.js rAF loop.
 * Draws the wall + floor + composter mesh (placed at `state.wallPosition`,
 * rebuilt live on upgrade) and applies the day/night lighting + sun patch for
 * `continuousHour`. No-op if the scene is not ready.
 * @param {import('../sim/engine.js').FarmState|null} state current farm state
 * @param {number} [continuousHour] fractional game hour (0..24) for day/night
 */
export function renderState(state, continuousHour = 0) {
  if (!ready || !renderer || !scene || !camera) return;
  syncComposter(state);
  // Refresh the x-ray internals from the live state every frame while it is on,
  // so fill volumes track drain/harvest and worm/queue hints stay current — a
  // read-only view, so this never perturbs the sim.
  if (xrayActive && xrayOverlay) updateXrayInternals(xrayOverlay, state);
  applyDayNight(continuousHour);
  renderer.render(scene, camera);
}

/**
 * Reconcile the scene with the x-ray state: translucent shell + a visible
 * internals overlay (built lazily on first use) when on; opaque shell + hidden
 * overlay when off, plus the buried model's soil cutaway below. Safe to call with
 * no composter yet, and idempotent — syncComposter re-runs it on every model
 * change so the reconciliation is always full, never incremental.
 */
function applyXray() {
  // Soil cutaway — the buried model ONLY. Its drum lives at y ∈ [-1.44, 0.06] and
  // its cavity at y ∈ [-1.32, 0.04], so ~97% of what the x-ray exposes is BELOW
  // the ground plane. That plane is a scene-root sibling of composterGroup, so
  // setShellTransparency's traversal never touches it and it would keep writing
  // depth at y=0 right over the revealed internals. Fading it here is what makes
  // the buried x-ray show anything at all.
  //
  // The other five models sit entirely ABOVE ground, where the floor occludes
  // nothing of theirs — fading it for them would only dissolve the ground the bin
  // visibly stands on, so this is gated on the model id and not merely on
  // xrayActive. Because the condition is re-evaluated in full (never toggled
  // incrementally), every transition reconciles on its own: x-ray off restores an
  // opaque floor, and switching buried → tier3 with the x-ray still ON un-fades it.
  const cutaway = xrayActive && composterModelId === 'buried';
  setMaterialFade(floorMesh, cutaway, {
    opacity: FLOOR_XRAY_OPACITY,
    depthWrite: false, // must not occlude the sunken drum it is drawn in front of
  });
  // The soil volume behind the fade — shown on the EXACT same condition, never
  // independently. Nothing else in the module touches `visible`, so the earth
  // block simply does not exist outside the buried x-ray; it must not be left
  // relying on the floor to hide it, since the camera (z=9) sits outside the
  // floor's z span and would see the block's near face under the front edge.
  if (soilMesh) soilMesh.visible = cutaway;

  if (!composterGroup) return;
  setShellTransparency(composterGroup, xrayActive);
  if (xrayActive) {
    if (!xrayOverlay) {
      xrayOverlay = buildXrayInternals(composterModelId);
      if (xrayOverlay) composterGroup.add(xrayOverlay);
    }
    if (xrayOverlay) xrayOverlay.visible = true;
  } else if (xrayOverlay) {
    xrayOverlay.visible = false;
  }
}

/**
 * Toggle the 3D x-ray view (T20). main.js wires this to the SAME action-panel
 * toggle that shows the DOM internals panel, so the numeric and visual layers
 * move together. Purely a render switch — it never pauses or perturbs the sim. A
 * no-op (returns false) when the scene is not ready, so the DOM-only game and its
 * internals panel keep working without WebGL.
 * @param {boolean} active
 * @returns {boolean} whether the x-ray is now on
 */
export function setXrayView(active) {
  if (!ready) return false;
  xrayActive = Boolean(active);
  applyXray();
  return xrayActive;
}

// --- Drag-move (T19) ---------------------------------------------------------
// Raycast the composter to grab it, then drag along a wall-aligned plane. Uses
// Pointer Events (mouse + touch + pen through one API) and pointer capture so a
// release outside the canvas still ends the drag rather than wedging it.

/**
 * Convert a pointer event's client coords to normalized device coords within the
 * canvas (both axes in [-1, 1], y up). Returns the reused scratch vector.
 * @param {PointerEvent} event
 * @returns {Vector2}
 */
function pointerToNdc(event) {
  const rect = sceneCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    _pointerNdc.set(0, 0);
    return _pointerNdc;
  }
  _pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return _pointerNdc;
}

/**
 * Raycast the composter group under a pointer event. Returns the nearest
 * intersection, or null when the pointer is not over the mesh (or there is none).
 * @param {PointerEvent} event
 * @returns {import('three').Intersection|null}
 */
function raycastComposter(event) {
  if (!raycaster || !camera || !composterGroup) return null;
  camera.updateMatrixWorld();
  composterGroup.updateMatrixWorld(true);
  raycaster.setFromCamera(pointerToNdc(event), camera);
  const hits = raycaster.intersectObject(composterGroup, true);
  return hits.length > 0 ? hits[0] : null;
}

/**
 * Begin a drag if the pointer went down on the composter. Anchors a wall-aligned
 * plane through the grabbed point and records the grab offset so that point stays
 * under the cursor. Empty-space clicks are ignored (not a grab).
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  if (!ready || dragging || !composterGroup) return;
  const hit = raycastComposter(event);
  if (!hit) return;

  dragging = true;
  dragPointerId = event.pointerId;
  // Plane parallel to the wall, through the grabbed surface point; the offset
  // pins that point under the cursor as it moves horizontally.
  _dragPlane.setFromNormalAndCoplanarPoint(_planeNormal, hit.point);
  dragGrabOffsetX = composterGroup.position.x - hit.point.x;

  sceneCanvas.style.cursor = 'grabbing';
  // Pointer capture keeps move/up flowing to the canvas even outside its bounds,
  // so leaving the canvas mid-drag never wedges the grab (spec: release-outside).
  try {
    sceneCanvas.setPointerCapture(event.pointerId);
  } catch {
    // Capture unsupported/failed — the window-level safety net still ends the drag.
  }
  event.preventDefault();
}

/**
 * While dragging, map the pointer onto the drag plane and dispatch the clamped
 * wallPosition. When not dragging, show a grab-cursor affordance over the mesh.
 * @param {PointerEvent} event
 */
function onPointerMove(event) {
  if (!ready) return;

  if (dragging && event.pointerId === dragPointerId) {
    raycaster.setFromCamera(pointerToNdc(event), camera);
    const point = raycaster.ray.intersectPlane(_dragPlane, _dragHit);
    if (!point) return; // ray parallel to / behind the plane — ignore this move
    const worldX = point.x + dragGrabOffsetX;
    const position = Math.min(1, Math.max(0, worldXToWallPosition(worldX)));
    onDragMove?.(position);
    event.preventDefault();
    return;
  }

  // Hover affordance: 'grab' over the composter, default cursor elsewhere. Only
  // when idle, so a second pointer can't flip the 'grabbing' cursor mid-drag.
  if (!dragging && composterGroup) {
    sceneCanvas.style.cursor = raycastComposter(event) ? 'grab' : '';
  }
}

/**
 * End the active drag: release pointer capture and restore the hover cursor. A
 * no-op for a pointer that does not own the drag, so stray up/cancel events (or
 * the window-level safety net firing after the canvas already handled it) are
 * harmless.
 * @param {PointerEvent} [event]
 */
function endDrag(event) {
  if (!dragging) return;
  if (event && event.pointerId !== dragPointerId) return;
  dragging = false;
  dragPointerId = null;
  if (event && sceneCanvas) {
    try {
      sceneCanvas.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing captured (or already released) — safe to ignore.
    }
  }
  if (sceneCanvas) {
    sceneCanvas.style.cursor = event && raycastComposter(event) ? 'grab' : '';
  }
}

/**
 * Turn on pointer drag-move, routing each dragged wallPosition to `onWallPositionChange`
 * (main.js wires this to the SAME action the slider dispatches, keeping autosave,
 * state, and the slider in sync). Idempotent: safe to call on every game-screen
 * entry — listeners are installed once and only the callback is refreshed.
 * @param {(position: number) => void} onWallPositionChange sink for wallPosition 0..1
 * @returns {boolean} whether drag-move is active (false if the scene is not ready)
 */
export function enableDragMove(onWallPositionChange) {
  if (!ready || !sceneCanvas) return false;
  onDragMove = typeof onWallPositionChange === 'function' ? onWallPositionChange : null;
  if (dragEnabled) return true;

  raycaster = new Raycaster();
  // Pointer Events cover mouse, touch, and pen; touch-action:none lets a touch
  // drag the bin instead of scrolling/zooming the page.
  sceneCanvas.style.touchAction = 'none';

  const down = (e) => onPointerDown(e);
  const move = (e) => onPointerMove(e);
  const up = (e) => endDrag(e);
  sceneCanvas.addEventListener('pointerdown', down);
  sceneCanvas.addEventListener('pointermove', move);
  sceneCanvas.addEventListener('pointerup', up);
  sceneCanvas.addEventListener('pointercancel', up);
  sceneCanvas.addEventListener('lostpointercapture', up);
  // Safety net: a release ANYWHERE ends the drag, so a pointerup outside the
  // canvas can never leave the grab stuck even if pointer capture was refused.
  globalThis.addEventListener?.('pointerup', up);
  globalThis.addEventListener?.('pointercancel', up);

  dragListeners = { down, move, up };
  dragEnabled = true;
  return true;
}

/**
 * Tear down the renderer and detach listeners. Not needed in the single-page
 * happy path (the scene lives for the page's lifetime) but keeps the module
 * self-contained and testable.
 */
export function disposeScene() {
  if (onWindowResize) globalThis.removeEventListener?.('resize', onWindowResize);
  onWindowResize = null;
  if (dragEnabled && dragListeners) {
    if (sceneCanvas) {
      sceneCanvas.removeEventListener('pointerdown', dragListeners.down);
      sceneCanvas.removeEventListener('pointermove', dragListeners.move);
      sceneCanvas.removeEventListener('pointerup', dragListeners.up);
      sceneCanvas.removeEventListener('pointercancel', dragListeners.up);
      sceneCanvas.removeEventListener('lostpointercapture', dragListeners.up);
    }
    globalThis.removeEventListener?.('pointerup', dragListeners.up);
    globalThis.removeEventListener?.('pointercancel', dragListeners.up);
  }
  dragEnabled = false;
  dragListeners = null;
  onDragMove = null;
  dragging = false;
  dragPointerId = null;
  raycaster = null;
  if (composterGroup) disposeComposterMesh(composterGroup);
  composterGroup = null;
  composterModelId = null;
  // The overlay was a child of composterGroup, so it was freed above; just reset.
  xrayOverlay = null;
  xrayActive = false;
  sunLight = null;
  hemiLight = null;
  ambientLight = null;
  floorMesh = null;
  soilMesh = null;
  sunPatchColors = null;
  sunPatchWallPos = null;
  renderer?.dispose?.();
  renderer = null;
  scene = null;
  camera = null;
  sceneCanvas = null;
  ready = false;
}
