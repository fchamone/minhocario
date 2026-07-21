// Teardown ownership guards (V20).
//
// Carried into V20 as an open item from V15: `disposeScene` frees the composter
// group (via disposeComposterMesh), the three grain textures (via
// disposeSurfaceTextures) and the renderer — but NOT the geometries and
// materials of the scene-ROOT meshes it built itself: the wall, the floor, the
// soil block, the sun patch and V17's sky backdrop. Five meshes with no owner at
// teardown, under a JSDoc claiming a tidy one.
//
// Not a leak in the single-page happy path — the scene lives as long as the page
// — which is exactly why it survived five tasks. It is still the render layer's
// only unowned allocation, and the fix belongs in the release audit rather than
// in a comment admitting it.
//
// `disposeRootMeshes` takes any Object3D, so the protocol is exercised with real
// Three objects under Node, the same split tests/shadows.test.js uses: behaviour
// where geometry alone can prove it, a source read where the renderer would be
// needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  Group,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  DirectionalLight,
  Texture,
} from '../vendor/three.module.min.js';
import { disposeRootMeshes } from '../js/render/scene.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const SCENE_SRC = read('../js/render/scene.js');

/** A mesh that records whether its geometry and material were disposed. */
function trackedMesh(name) {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial();
  const freed = { geometry: false, material: false };
  geometry.addEventListener('dispose', () => {
    freed.geometry = true;
  });
  material.addEventListener('dispose', () => {
    freed.material = true;
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return { mesh, freed };
}

test('the root teardown frees the geometry and material of every mesh it reaches', () => {
  const root = new Group();
  const wall = trackedMesh('garageWall');
  const backdrop = trackedMesh('skyBackdrop');
  // Nested, because the sun patch and the soil are siblings today but nothing
  // stops a future surface from arriving inside a wrapper group.
  const nest = new Group();
  const soil = trackedMesh('garageSoil');
  nest.add(soil.mesh);
  root.add(wall.mesh, backdrop.mesh, nest);

  disposeRootMeshes(root);

  for (const [name, tracked] of [['wall', wall], ['backdrop', backdrop], ['soil', soil]]) {
    assert.equal(tracked.freed.geometry, true, `${name} geometry was not freed`);
    assert.equal(tracked.freed.material, true, `${name} material was not freed`);
  }
});

test('the root teardown frees every material of a multi-material mesh', () => {
  // The soil block is the one root mesh whose faces have ever been argued about
  // (V15's DEVIATION weighed per-face materials against one stretched repeat).
  // If that argument is ever revisited, a material array must not free only its
  // first entry — the same shape disposeComposterMesh already handles.
  const root = new Group();
  const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
  const freed = materials.map(() => false);
  materials.forEach((material, i) => {
    material.addEventListener('dispose', () => {
      freed[i] = true;
    });
  });
  root.add(new Mesh(new BoxGeometry(1, 1, 1), materials));

  disposeRootMeshes(root);

  assert.deepEqual(freed, [true, true]);
});

test('the root teardown leaves textures to the cache that owns them', () => {
  // Deliberate, and the reason this is not just a call to disposeComposterMesh:
  // the grain maps are shared and CACHED (textures.js). disposeSurfaceTextures
  // frees them AND nulls the cache, so a rebuilt scene regenerates. Freeing them
  // from here instead would leave the cache holding disposed textures — every
  // surface after the first teardown dressed in a dead map, with nothing to
  // report it.
  const root = new Group();
  const map = new Texture();
  let mapFreed = false;
  map.addEventListener('dispose', () => {
    mapFreed = true;
  });
  const material = new MeshStandardMaterial();
  material.map = map;
  root.add(new Mesh(new BoxGeometry(1, 1, 1), material));

  disposeRootMeshes(root);

  assert.equal(mapFreed, false, 'the shared grain cache owns the maps, not the mesh walk');
});

test('the root teardown ignores lights and tolerates an absent scene', () => {
  const root = new Group();
  root.add(new DirectionalLight(0xffffff, 1));
  const light = new DirectionalLight(0xffffff, 1);
  root.add(light.target); // V19 parents this; it is an Object3D with no geometry

  assert.doesNotThrow(() => disposeRootMeshes(root));
  // disposeScene can run before initScene ever did (a screen change during a
  // failed boot), and a teardown that throws leaves every listener attached.
  assert.doesNotThrow(() => disposeRootMeshes(null));
});

test('disposeScene frees the scene root before it drops its reference', () => {
  // Ordering, and the failure is silent: `disposeRootMeshes(scene)` after
  // `scene = null` walks nothing, frees nothing, throws nothing and reads
  // correctly in a diff.
  const body = SCENE_SRC.slice(SCENE_SRC.indexOf('export function disposeScene'));
  const call = body.indexOf('disposeRootMeshes(');
  const drop = body.search(/\bscene\s*=\s*null/);

  assert.notEqual(call, -1, 'disposeScene does not free the scene-root meshes');
  assert.notEqual(drop, -1, 'disposeScene no longer drops the scene reference');
  assert.ok(
    call < drop,
    'disposeScene calls disposeRootMeshes after nulling `scene`, so it walks nothing',
  );
});
