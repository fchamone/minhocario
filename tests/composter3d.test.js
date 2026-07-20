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

import {
  Box3,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  Texture,
  Raycaster,
  Vector3,
  Vector2,
  LatheGeometry,
  ExtrudeGeometry,
} from '../vendor/three.module.min.js';
import {
  buildComposterMesh,
  composterCavity,
  composterFootprint,
  disposeComposterMesh,
  LATHE_SEGMENTS,
} from '../js/render/composter3d.js';
import { COMPOSTERS } from '../js/sim/composters.js';

/** Every catalog id, read from the sim so a new model cannot skip these tests. */
const IDS = COMPOSTERS.map((c) => c.id);

// The contact shadow (V16) needs a 2D canvas, which Node has none of — so
// `textures.js` correctly degrades to no shadow here and the blob would be
// invisible to every test below. Standing up the smallest possible OffscreenCanvas
// exercises the REAL path (`createCanvas` feature-detects at call time, not at
// import), rather than adding a test-only parameter to the production API.
globalThis.OffscreenCanvas = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
    };
  }
};

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

// --- Contact-shadow footprint (V16) ------------------------------------------
// Same drift hazard as the cavity, and the same fix: `composterFootprint` reads
// `structureOf` rather than restating the body's dimensions. A shadow of the
// wrong size is not a visible bug — it still looks like a shadow — so nothing
// but a test can notice when a silhouette moves and the blob does not follow.
// V18 reshapes two of these models, which is exactly when this earns its keep.

test('every above-ground model has a footprint, and the buried one has none', () => {
  for (const id of IDS) {
    const footprint = composterFootprint(id);
    if (id === 'buried') {
      assert.equal(footprint, null, 'the buried model is sunk — nothing rests on the floor to shade');
    } else {
      assert.ok(footprint, `${id}: no footprint`);
      assert.ok(footprint.width > 0 && footprint.depth > 0, `${id}: degenerate footprint`);
    }
  }
});

test('every footprint matches the ground extent of the body that stands on it', () => {
  // Measured against the same `shellBody` meshes the cavity test uses. This is
  // what ties the blob to the silhouette: reshape a body and the footprint must
  // move with it or the shadow sits under the wrong outline.
  for (const id of IDS) {
    const footprint = composterFootprint(id);
    if (!footprint) continue;
    const mesh = buildComposterMesh(id);
    const { box } = bodyBox(mesh);

    const tolerance = 1e-6;
    assert.ok(
      Math.abs(box.max.x - box.min.x - footprint.width) < tolerance,
      `${id}: footprint width ${footprint.width} vs body ${box.max.x - box.min.x}`,
    );
    assert.ok(
      Math.abs(box.max.z - box.min.z - footprint.depth) < tolerance,
      `${id}: footprint depth ${footprint.depth} vs body ${box.max.z - box.min.z}`,
    );
    assert.ok(
      Math.abs((box.max.z + box.min.z) / 2 - footprint.z) < tolerance,
      `${id}: footprint centre z ${footprint.z} vs body ${(box.max.z + box.min.z) / 2}`,
    );
    disposeComposterMesh(mesh);
  }
});

test('every footprint covers the cavity it encloses', () => {
  // A weaker but independent check that survives a builder swapping which meshes
  // it tags: whatever the body is, the interior must fit on the ground it stands on.
  for (const id of IDS) {
    const footprint = composterFootprint(id);
    if (!footprint) continue;
    const cav = composterCavity(id);
    assert.ok(footprint.width >= cav.width, `${id}: footprint narrower than its cavity`);
    assert.ok(footprint.depth >= cav.depth, `${id}: footprint shallower than its cavity`);
  }
});

test('an unknown id yields no footprint', () => {
  for (const id of [null, undefined, '', 'nope']) {
    assert.equal(composterFootprint(id), null, `composterFootprint(${JSON.stringify(id)})`);
  }
});

// --- Lathe / extrude silhouettes (V18) ---------------------------------------

test('the lathe segment count reaches full radius on both ground axes', () => {
  // Not an aesthetic constant. A lathe puts vertices at j * 2pi / N, so its
  // bounding box only reaches the profile radius on a ground axis if a vertex
  // lands there — which needs N divisible by 4. At N = 10 (the value first
  // shipped here) the widest vertex sits at 72 degrees, so the eco barrel was
  // 1.902r across in X while composterFootprint reported 2r, and the contact
  // shadow quietly stopped matching the silhouette. Asserted directly so the
  // next segment-count tweak fails with the reason rather than with arithmetic.
  assert.equal(LATHE_SEGMENTS % 4, 0, `LATHE_SEGMENTS ${LATHE_SEGMENTS} is not a multiple of 4`);
  assert.ok(LATHE_SEGMENTS >= 8 && LATHE_SEGMENTS <= 12, 'the art direction mandates 8-12 segments');

  const geometry = new LatheGeometry([new Vector2(1, 0), new Vector2(1, 2)], LATHE_SEGMENTS);
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  assert.ok(Math.abs(max.x - min.x - 2) < 1e-6, `X span ${max.x - min.x} is not 2r`);
  assert.ok(Math.abs(max.z - min.z - 2) < 1e-6, `Z span ${max.z - min.z} is not 2r`);
});

/** Count meshes under a group whose geometry is of the given constructor. */
function countGeometry(group, Ctor) {
  let n = 0;
  group.traverse((obj) => {
    if (obj.isMesh && obj.geometry instanceof Ctor) n += 1;
  });
  return n;
}

test('the models that V18 reshaped actually use lathes and extrusions', () => {
  // Without this, reverting a builder to primitives is invisible: the cavity and
  // footprint tests pass either way, since both were written to survive the
  // reshape rather than to require it.
  // Labelled explicitly: the vendored Three is minified, so `Ctor.name` reads
  // "hu" or "Ku" and a failure message built from it says nothing.
  const expectations = [
    ['eco', LatheGeometry, 'LatheGeometry', 1],
    ['buried', LatheGeometry, 'LatheGeometry', 3],
    ['tier2', ExtrudeGeometry, 'ExtrudeGeometry', 4],
    ['tier3', ExtrudeGeometry, 'ExtrudeGeometry', 5],
    ['tier4', ExtrudeGeometry, 'ExtrudeGeometry', 6],
  ];
  for (const [id, Ctor, label, atLeast] of expectations) {
    const mesh = buildComposterMesh(id);
    const found = countGeometry(mesh, Ctor);
    assert.ok(found >= atLeast, `${id}: expected at least ${atLeast} ${label} meshes, found ${found}`);
    disposeComposterMesh(mesh);
  }
});

test('the tray tiers still read their tier count in geometry', () => {
  // The AC's "tier counts visible". V18 rewrote the loop that builds them, and a
  // tier that quietly lost a tray would still pass every dimensional test here —
  // the trays are stacked, so the cavity and footprint stay plausible.
  for (const [id, trays] of [['tier2', 2], ['tier3', 3], ['tier4', 4]]) {
    const mesh = buildComposterMesh(id);
    let bodies = 0;
    mesh.traverse((obj) => {
      if (obj.isMesh && obj.userData.shellBody) bodies += 1;
    });
    // One collector base plus one box per tray.
    assert.equal(bodies, trays + 1, `${id}: expected ${trays} trays over a collector base`);
    disposeComposterMesh(mesh);
  }
});

test('every model surface stays flat-shaded', () => {
  // `flatShading: true` is a stated identity in DESIGN.md, not a default that
  // happens to be on. A lathe or extrusion built with a bare material would go
  // smooth and read as a different, glossier project — and only on the models
  // V18 touched, which is the hardest kind of inconsistency to spot.
  for (const id of IDS) {
    const mesh = buildComposterMesh(id);
    mesh.traverse((obj) => {
      if (!obj.isMesh || obj.name === 'contactShadow') return;
      assert.equal(obj.material.flatShading, true, `${id}: a ${obj.geometry.type} is smooth-shaded`);
    });
    disposeComposterMesh(mesh);
  }
});

// --- The contact-shadow blob itself (V16) ------------------------------------

/** The blob under a built group, or null. */
function shadowOf(group) {
  let found = null;
  group.traverse((obj) => {
    if (obj.name === 'contactShadow') found = obj;
  });
  return found;
}

test('every above-ground model carries a contact shadow, and buried carries none', () => {
  for (const id of IDS) {
    const mesh = buildComposterMesh(id);
    const blob = shadowOf(mesh);
    if (id === 'buried') assert.equal(blob, null, 'the sunken model has no floor contact to shade');
    else assert.ok(blob, `${id}: no contact shadow`);
    disposeComposterMesh(mesh);
  }
});

test('the contact shadow lies flat on the floor, spread past the footprint', () => {
  for (const id of IDS.filter((i) => i !== 'buried')) {
    const mesh = buildComposterMesh(id);
    const blob = shadowOf(mesh);
    const footprint = composterFootprint(id);

    assert.ok(blob.position.y > 0, `${id}: shadow must sit above the floor, not in it`);
    assert.ok(blob.position.y < 0.05, `${id}: shadow floats at y=${blob.position.y}`);
    assert.equal(blob.position.z, footprint.z, `${id}: shadow not centred on the footprint`);

    const box = new Box3().setFromObject(blob);
    assert.ok(
      box.max.x - box.min.x > footprint.width,
      `${id}: shadow is not wider than the bin it grounds`,
    );
    assert.ok(
      box.max.z - box.min.z > footprint.depth,
      `${id}: shadow is not deeper than the bin it grounds`,
    );
    disposeComposterMesh(mesh);
  }
});

test('the contact shadow is excluded from the x-ray transparency sweep', () => {
  // setShellTransparency skips anything tagged xrayPart. Without the tag the
  // shadow fades to 0.1 with the shell, so the bin floats in exactly the view
  // where floating reads worst.
  for (const id of IDS.filter((i) => i !== 'buried')) {
    const mesh = buildComposterMesh(id);
    assert.equal(shadowOf(mesh).userData.xrayPart, true, `${id}: shadow not tagged xrayPart`);
    disposeComposterMesh(mesh);
  }
});

test('the contact shadow is not part of the drag grab target', () => {
  // The real check, with the real Raycaster the drag uses. `raycastComposter`
  // intersects composterGroup recursively, so a pickable blob would let the bin
  // be grabbed from bare floor well outside its own outline — a silent change to
  // an interaction built in T19 and re-verified at V12.
  for (const id of IDS.filter((i) => i !== 'buried')) {
    const mesh = buildComposterMesh(id);
    mesh.updateMatrixWorld(true);
    const footprint = composterFootprint(id);

    // Straight down onto floor that only the blob covers: outside the bin's
    // footprint, inside the blob's 1.6x spread.
    const x = (footprint.width / 2) * 1.3;
    const ray = new Raycaster(new Vector3(x, 5, footprint.z), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(mesh, true);

    assert.deepEqual(
      hits.map((h) => h.object.name),
      [],
      `${id}: the contact shadow is pickable, so clicking empty floor grabs the bin`,
    );
    disposeComposterMesh(mesh);
  }
});

test('the contact shadow raycast exclusion is not vacuous', () => {
  // Companion to the test above: prove that ray WOULD hit the blob if it were
  // pickable. Without this, a blob accidentally positioned outside the ray's path
  // would make the exclusion test pass for the wrong reason — the V6 lesson.
  const mesh = buildComposterMesh('electric');
  mesh.updateMatrixWorld(true);
  const footprint = composterFootprint('electric');
  const blob = shadowOf(mesh);
  delete blob.raycast; // restore the default Mesh.raycast

  const x = (footprint.width / 2) * 1.3;
  const ray = new Raycaster(new Vector3(x, 5, footprint.z), new Vector3(0, -1, 0));
  const hits = ray.intersectObject(mesh, true);

  assert.deepEqual(
    hits.map((h) => h.object.name),
    ['contactShadow'],
    'the probe ray does not actually cross the blob, so the exclusion test proves nothing',
  );
  disposeComposterMesh(mesh);
});

test('disposing a model frees its contact shadow texture', () => {
  // The blob's texture is built fresh per model precisely so this is safe; a
  // shared one would be dead for every model after the first upgrade.
  const mesh = buildComposterMesh('electric');
  const texture = shadowOf(mesh).material.map;
  let disposed = false;
  texture.addEventListener('dispose', () => {
    disposed = true;
  });

  disposeComposterMesh(mesh);
  assert.ok(disposed, 'the contact shadow texture leaks on every model swap');
});

test('two builds of the same model do not share a shadow texture', () => {
  const a = buildComposterMesh('electric');
  const b = buildComposterMesh('electric');
  assert.notEqual(
    shadowOf(a).material.map,
    shadowOf(b).material.map,
    'shadow textures are shared, so disposing one model kills the others',
  );
  disposeComposterMesh(a);
  disposeComposterMesh(b);
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
