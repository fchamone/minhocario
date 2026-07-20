// Render-layer geometry tests (V6).
//
// The one exception to the "tests cover js/sim/* only" rule, and it earns it:
// `composterCavity` and the mesh builders used to carry hand-synchronised copies
// of the same structural numbers, linked only by `// see buildElectric` comments.
// Nothing caught drift between them, and drift is silent — the x-ray internals
// simply render outside the shell they are supposed to be inside. `structureOf`
// now feeds both, and these tests hold that invariant geometrically rather than
// by convention.
//
// Three.js core imports cleanly under Node (geometry needs no WebGL context), so
// this runs in the normal suite with no browser and no new dependency.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Box3, Mesh, BoxGeometry, MeshStandardMaterial, Texture } from '../vendor/three.module.min.js';
import { buildComposterMesh, composterCavity, disposeComposterMesh } from '../js/render/composter3d.js';
import { COMPOSTERS } from '../js/sim/composters.js';

/** Every catalog id, read from the sim so a new model cannot skip these tests. */
const IDS = COMPOSTERS.map((c) => c.id);

/**
 * The cavity descriptor as an axis-aligned Box3, matching how xray.js lays the
 * internals out: centred on x=0 and z=`z`, spanning [yMin, yMax].
 */
function cavityBox(cav) {
  return new Box3(
    { x: -cav.width / 2, y: cav.yMin, z: cav.z - cav.depth / 2 },
    { x: cav.width / 2, y: cav.yMax, z: cav.z + cav.depth / 2 },
  );
}

test('every catalog model builds a mesh and a cavity', () => {
  assert.ok(IDS.length === 6, `expected 6 catalog models, got ${IDS.length}`);
  for (const id of IDS) {
    const mesh = buildComposterMesh(id);
    assert.ok(mesh, `${id}: no mesh built`);
    assert.ok(composterCavity(id), `${id}: no cavity`);
    disposeComposterMesh(mesh);
  }
});

/**
 * Bounding box of the meshes that ENCLOSE the cavity (tagged `userData.shellBody`
 * by the builders), not of the whole group. Measuring against the whole group is
 * near-vacuous — the lid and vent stack keep that box large enough to swallow
 * almost any drift. Verified: halving the electric body height passes the
 * whole-group check and fails this one.
 */
function bodyBox(group) {
  const box = new Box3();
  let found = 0;
  group.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.shellBody) return;
    found += 1;
    box.union(new Box3().setFromObject(obj));
  });
  return { box, found };
}

test('every model tags the body meshes that enclose its cavity', () => {
  for (const id of IDS) {
    const mesh = buildComposterMesh(id);
    const { found } = bodyBox(mesh);
    assert.ok(found > 0, `${id}: no mesh tagged with userData.shellBody — the containment test below would be vacuous`);
    disposeComposterMesh(mesh);
  }
});

test('every cavity sits inside the body that encloses it', () => {
  for (const id of IDS) {
    const mesh = buildComposterMesh(id);
    const { box } = bodyBox(mesh);
    const cav = cavityBox(composterCavity(id));

    assert.ok(
      box.containsBox(cav),
      `${id}: x-ray cavity escapes the enclosing body — cavity ` +
        `${JSON.stringify(cav.min)}..${JSON.stringify(cav.max)} vs body ` +
        `${JSON.stringify(box.min)}..${JSON.stringify(box.max)}. ` +
        'A builder dimension changed without structureOf following it.',
    );
    disposeComposterMesh(mesh);
  }
});

test('every cavity is a non-degenerate volume', () => {
  for (const id of IDS) {
    const cav = composterCavity(id);
    assert.ok(cav.yMax > cav.yMin, `${id}: cavity has no height (yMin ${cav.yMin} >= yMax ${cav.yMax})`);
    assert.ok(cav.width > 0, `${id}: cavity width ${cav.width} is not positive`);
    assert.ok(cav.depth > 0, `${id}: cavity depth ${cav.depth} is not positive`);
  }
});

test('a bigger catalog capacity yields a bigger cavity', () => {
  // The catalog is the single source of truth for mesh size (baseDims), so the
  // ordering must survive any future retune of the composter catalog.
  const byCapacity = [...COMPOSTERS].sort((a, b) => a.capacity - b.capacity);
  const volumes = byCapacity.map((c) => {
    const cav = composterCavity(c.id);
    return cav.width * cav.depth * (cav.yMax - cav.yMin);
  });
  const smallest = volumes[0];
  const largest = volumes[volumes.length - 1];
  assert.ok(
    largest > smallest,
    `expected the largest-capacity model to have the roomier cavity (${largest} vs ${smallest})`,
  );
});

test('the buried model is the one cavity that sits below ground', () => {
  // xray.js relies on this: it is why scene.js fades the floor into a soil
  // cutaway for this model and only this model.
  for (const id of IDS) {
    const cav = composterCavity(id);
    if (id === 'buried') assert.ok(cav.yMin < 0, 'buried cavity should sit below y=0');
    else assert.ok(cav.yMin >= 0, `${id}: only the buried model may sit below y=0 (yMin ${cav.yMin})`);
  }
});

// --- Texture disposal (V15) --------------------------------------------------
// `disposeComposterMesh` freed geometry and material but NOT the textures hanging
// off the material, so every model swap leaked whatever maps its materials
// carried. The composter builders use flat colours today, so nothing leaks YET —
// which is exactly why this needs a test rather than a browser memory check:
// there is currently no way to SEE the bug, and the first builder to take a map
// (V18's lathe silhouettes, or any later surfacing pass) would start leaking with
// nothing failing. The tests plant the maps the builders do not have.

/**
 * A Texture that records its own disposal. Three's `Texture.dispose()` dispatches
 * a 'dispose' event — that is the disposal, so listening for it tests the real
 * contract rather than a stub of it.
 */
function spyTexture() {
  const texture = new Texture();
  texture.userData.disposed = false;
  texture.addEventListener('dispose', () => {
    texture.userData.disposed = true;
  });
  return texture;
}

test('disposing a mesh frees the textures on its materials, not just the material', () => {
  const group = buildComposterMesh('electric');
  const planted = [];
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    // Two different slots: `map` is the one the plan names, `roughnessMap` proves
    // the fix is not a special case for that single property. A surfacing pass
    // adds both at once, and disposing only `map` leaks half of it silently.
    obj.material.map = spyTexture();
    obj.material.roughnessMap = spyTexture();
    planted.push(obj.material.map, obj.material.roughnessMap);
  });
  assert.ok(planted.length > 0, 'no material found to plant a texture on');

  disposeComposterMesh(group);

  const leaked = planted.filter((t) => !t.userData.disposed);
  assert.equal(
    leaked.length,
    0,
    `${leaked.length}/${planted.length} textures survived disposeComposterMesh — ` +
      'every model swap leaks them.',
  );
});

test('texture disposal reaches materials held in an array', () => {
  // BoxGeometry supports a per-face material array; a builder that ever uses one
  // would otherwise slip past a fix written only for the single-material case.
  const group = buildComposterMesh('electric');
  const a = new MeshStandardMaterial();
  const b = new MeshStandardMaterial();
  a.map = spyTexture();
  b.map = spyTexture();
  const multi = new Mesh(new BoxGeometry(1, 1, 1), [a, b]);
  group.add(multi);

  disposeComposterMesh(group);

  assert.ok(a.map.userData.disposed, 'texture on the first array material leaked');
  assert.ok(b.map.userData.disposed, 'texture on the second array material leaked');
});

test('an unknown or null id yields neither mesh nor cavity', () => {
  for (const id of [null, undefined, '', 'nope']) {
    assert.equal(buildComposterMesh(id), null, `buildComposterMesh(${JSON.stringify(id)})`);
    assert.equal(composterCavity(id), null, `composterCavity(${JSON.stringify(id)})`);
  }
});
