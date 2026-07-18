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
} from '../../vendor/three.module.min.js';
import { buildComposterMesh, disposeComposterMesh } from './composter3d.js';
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

// --- Day/night cycle (T18) ---------------------------------------------------
// Keyframes across the 24h clock, interpolated by the continuous game hour so the
// scene reads day → dusk → night → dawn. At 1× (1 game day = 1 real minute) the
// whole arc is perceivable within a minute (spec acceptance criterion). Values
// are purely visual — the sim's thermal cycle lives in js/sim/temperature.js; the
// only shared quantity is solarGain, sampled below for the sun patch.
//   sky   background + fog + hemisphere sky tint
//   sun   directional light colour        sunI/hemiI/ambI  light intensities
const DAY_CYCLE = [
  { h: 0, sky: 0x0a0e1a, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
  { h: 5, sky: 0x1b2440, sun: 0x40506e, sunI: 0.14, hemiI: 0.22, ambI: 0.12 },
  { h: 6.5, sky: 0xd98a5c, sun: 0xffb066, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
  { h: 9, sky: 0x9fb8cc, sun: 0xfff1d6, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
  { h: 12, sky: 0xaecfe0, sun: 0xfff6e2, sunI: 1.0, hemiI: 0.82, ambI: 0.3 },
  { h: 15, sky: 0x9fb8cc, sun: 0xfff0d0, sunI: 0.9, hemiI: 0.7, ambI: 0.25 },
  { h: 17.5, sky: 0xe0743c, sun: 0xff8a48, sunI: 0.55, hemiI: 0.45, ambI: 0.2 },
  { h: 19, sky: 0x2a2742, sun: 0x4a4668, sunI: 0.16, hemiI: 0.26, ambI: 0.13 },
  { h: 21, sky: 0x10152a, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.17, ambI: 0.1 },
  // Duplicate of h:0 so interpolation wraps cleanly through midnight.
  { h: 24, sky: 0x0a0e1a, sun: 0x2b3a5c, sunI: 0.1, hemiI: 0.16, ambI: 0.1 },
];

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

// Animated lights + sun patch, retained so applyDayNight() can drive them each
// frame without re-walking the scene graph.
/** @type {DirectionalLight|null} the sweeping "sun". */
let sunLight = null;
/** @type {HemisphereLight|null} sky/ground bounce. */
let hemiLight = null;
/** @type {AmbientLight|null} floor for shadowed faces. */
let ambientLight = null;
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

/**
 * Build the wall + floor + lights into the scene. Pure scene-graph assembly, no
 * renderer/DOM access, so it is trivial to extend in later tasks.
 * @param {Scene} target
 */
function buildScene(target) {
  target.background = new Color(SKY_COLOR);
  // A little distance fog softens the wall edges and reads as garage depth.
  target.fog = new Fog(SKY_COLOR, 14, 30);

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
  target.add(floor);

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
    }
    composterModelId = desiredId;
    if (desiredId) {
      composterGroup = buildComposterMesh(desiredId);
      if (composterGroup) scene.add(composterGroup);
    }
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
    sunLight.intensity = lerp(k0.sunI, k1.sunI, t);
    positionSun(hour);
  }
  if (hemiLight) {
    hemiLight.intensity = lerp(k0.hemiI, k1.hemiI, t);
    hemiLight.color.copy(_skyColor);
  }
  if (ambientLight) ambientLight.intensity = lerp(k0.ambI, k1.ambI, t);

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
  applyDayNight(continuousHour);
  renderer.render(scene, camera);
}

/**
 * Tear down the renderer and detach listeners. Not needed in the single-page
 * happy path (the scene lives for the page's lifetime) but keeps the module
 * self-contained and testable.
 */
export function disposeScene() {
  if (onWindowResize) globalThis.removeEventListener?.('resize', onWindowResize);
  onWindowResize = null;
  if (composterGroup) disposeComposterMesh(composterGroup);
  composterGroup = null;
  composterModelId = null;
  sunLight = null;
  hemiLight = null;
  ambientLight = null;
  sunPatchColors = null;
  sunPatchWallPos = null;
  renderer?.dispose?.();
  renderer = null;
  scene = null;
  camera = null;
  sceneCanvas = null;
  ready = false;
}
