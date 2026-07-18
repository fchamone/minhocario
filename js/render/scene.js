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
} from '../../vendor/three.module.min.js';
import { buildComposterMesh, disposeComposterMesh } from './composter3d.js';

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

// --- Colors (static daytime look for T16; T18 animates these) ----------------
const SKY_COLOR = 0x9fb8cc;
const WALL_COLOR = 0x8f949c;
const FLOOR_COLOR = 0x5b4a37;

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
  // shape, and a touch of ambient so shadowed faces never go fully black. T18
  // will animate the directional light + background across the day/night cycle.
  const hemi = new HemisphereLight(SKY_COLOR, FLOOR_COLOR, 0.7);
  target.add(hemi);

  const sun = new DirectionalLight(0xfff2d8, 0.9);
  sun.position.set(5, 8, 6);
  sun.name = 'sun';
  target.add(sun);

  target.add(new AmbientLight(0xffffff, 0.25));
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
 * Render one frame for the given sim state. Called from the main.js rAF loop.
 * Draws the wall + floor, plus the composter mesh placed at `state.wallPosition`
 * (rebuilt live on upgrade). `continuousHour` is accepted for the day/night pass
 * (T18). No-op if the scene is not ready.
 * @param {import('../sim/engine.js').FarmState|null} state current farm state
 * @param {number} [_continuousHour] fractional game hour (0..24) for day/night
 */
export function renderState(state, _continuousHour = 0) {
  if (!ready || !renderer || !scene || !camera) return;
  syncComposter(state);
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
  renderer?.dispose?.();
  renderer = null;
  scene = null;
  camera = null;
  sceneCanvas = null;
  ready = false;
}
