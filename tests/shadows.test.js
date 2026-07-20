// Shadow-map guards (V19).
//
// The plan calls the x-ray interaction the risky part, and it is the part that is
// genuinely testable here: `setShellTransparency` works on any Object3D tree, so
// the stash/restore protocol can be exercised with real meshes under Node. The
// renderer-side wiring (shadowMap type, autoUpdate, the light's target parenting)
// needs a WebGL context, so it is guarded by source reads — the same split the
// rest of this project uses, and stated rather than blurred.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from '../vendor/three.module.min.js';
import { setShellTransparency } from '../js/render/xray.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const SCENE_SRC = read('../js/render/scene.js');

/** A shell mesh, optionally tagged as an x-ray internal. */
function shellMesh(name, { castShadow = true, xrayPart = false } = {}) {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  mesh.name = name;
  mesh.castShadow = castShadow;
  if (xrayPart) mesh.userData.xrayPart = true;
  return mesh;
}

// --- The x-ray castShadow protocol -------------------------------------------

test('x-raying a shell stops it casting a shadow', () => {
  // The bug this exists to prevent: the shadow pass renders DEPTH ONLY and
  // ignores material opacity, so a shell faded to 0.1 alpha keeps casting a
  // fully opaque shadow. Without this, x-raying a bin leaves a solid black slab
  // on the floor next to a bin you can see straight through.
  const group = new Group();
  const shell = shellMesh('body');
  group.add(shell);

  setShellTransparency(group, true);
  assert.equal(shell.castShadow, false, 'a transparent shell still casts a solid shadow');
});

test('turning the x-ray off restores each mesh to the value it actually had', () => {
  // The trap in the naive fix: restoring everything to `true`. Meshes that were
  // deliberately non-casting (the contact-shadow blob, any future decoration)
  // would start casting after the first x-ray toggle, and only after one — which
  // is exactly the kind of state-dependent bug nobody reproduces on demand.
  const group = new Group();
  const caster = shellMesh('body', { castShadow: true });
  const nonCaster = shellMesh('decor', { castShadow: false });
  group.add(caster, nonCaster);

  setShellTransparency(group, true);
  setShellTransparency(group, false);

  assert.equal(caster.castShadow, true, 'a caster did not get its shadow back');
  assert.equal(nonCaster.castShadow, false, 'a non-caster started casting after an x-ray toggle');
});

test('repeated x-ray toggles cannot corrupt the stashed value', () => {
  // Matches setMaterialFade's contract: ON twice must not overwrite the snapshot
  // with an already-suppressed value, or the shadow never comes back.
  const group = new Group();
  const shell = shellMesh('body');
  group.add(shell);

  for (let i = 0; i < 3; i += 1) setShellTransparency(group, true);
  for (let i = 0; i < 3; i += 1) setShellTransparency(group, false);
  assert.equal(shell.castShadow, true, 'the shadow was lost across repeated toggles');

  // ...and a full cycle repeated, since applyXray reconciles rather than toggles.
  setShellTransparency(group, true);
  assert.equal(shell.castShadow, false);
  setShellTransparency(group, false);
  assert.equal(shell.castShadow, true);
});

test('the internals overlay is never touched by the shadow protocol', () => {
  // It is skipped by the `xrayPart` check, so it never casts in the first place —
  // and must not acquire a stashed value it would later restore from.
  const group = new Group();
  const internals = shellMesh('internals', { castShadow: false, xrayPart: true });
  group.add(internals);

  setShellTransparency(group, true);
  assert.equal(internals.castShadow, false);
  assert.equal(internals.userData.xrayCastShadow, undefined, 'the overlay was stashed');
});

test('the mesh-level stash lives apart from the material-level one, deliberately', () => {
  // `castShadow` is a property of the MESH, not the material, so it cannot travel
  // through setMaterialFade — whose JSDoc otherwise claims to be the single
  // stash/restore mechanism. The two keys must not collide, and the split is
  // documented in xray.js rather than left to be rediscovered.
  const src = read('../js/render/xray.js');
  assert.match(src, /xrayCastShadow/, 'the mesh-level stash key is missing');
  assert.match(src, /castShadow` is a property of the \*\*Mesh\*\*/, 'the split is undocumented');
});

// --- Renderer-side wiring (source guards) ------------------------------------

test('the sun light target is added to the scene graph', () => {
  // Three only updates matrixWorld for objects reachable from the scene root, so
  // an unparented target is a documented no-op. It happened to work until now
  // only because it sat at the origin with an identity matrix. V19 moves it every
  // frame to keep the shadow camera tight around the bin — without this line that
  // retarget silently does nothing, the shadow camera stays centred on the world
  // origin, and shadows fade out toward the ends of the slider.
  assert.match(
    SCENE_SRC,
    /target\.add\(sunLight\.target\)/,
    'sunLight.target is never parented, so re-targeting it is a no-op',
  );
});

test('the shadow map is refreshed manually, not every frame', () => {
  // The sun moves every frame, so Three would re-render the shadow map every
  // frame — which IS the cost the perf gate is about. Throttling was not on the
  // plan's mitigation list and is the middle option between full cost and
  // dropping the feature.
  assert.match(SCENE_SRC, /shadowMap\.autoUpdate = false/, 'shadow map still auto-updates');
  assert.match(SCENE_SRC, /shadowMap\.needsUpdate = due/, 'nothing ever refreshes the shadow map');
});

test('everything that must not cast a shadow is excluded by name', () => {
  // Each of these would be a distinct visible bug: the sun patch is a flat
  // overlay a hair off the wall and would cast a full-wall slab onto it; the soil
  // volume encloses the buried bin and would shadow it from the inside; the sky
  // backdrop and the contact blob are not solids at all.
  const block = SCENE_SRC.slice(
    SCENE_SRC.indexOf('function applyShadowFlags'),
    SCENE_SRC.indexOf('// --- Frame instrumentation'),
  );
  for (const name of ['sunPatch', 'garageSoil', 'skyBackdrop', 'contactShadow']) {
    assert.ok(block.includes(`'${name}'`), `${name} is not excluded from casting shadows`);
  }
});

test('shadows can be turned off in the same session, or the gate is unanswerable', () => {
  // The plan's gate is "more than 2 ms per frame", which is a DELTA. A delta needs
  // two measurements on the same hardware in the same session, so an A/B switch is
  // not a convenience here — without it the gate cannot be evaluated at all.
  assert.match(SCENE_SRC, /shadows/i, 'no shadow flag');
  assert.match(
    SCENE_SRC,
    /get\('shadows'\)/,
    'no ?shadows= override, so the perf gate cannot be measured as a delta',
  );
  assert.match(SCENE_SRC, /export function renderStats/, 'no frame-time instrument to measure with');
});

test('the perf readout is wired to a real element and carries no translatable copy', () => {
  // Dev-only scaffolding: digits plus the unit symbols ms/fps, so it needs no
  // strings.js key and the three locale catalogs stay untouched — the same
  // exemption the rest of the dev nav's non-copy earns.
  const html = read('../index.html');
  const main = read('../js/main.js');
  assert.match(html, /id="dev-perf"/, 'the readout element is missing from index.html');
  assert.match(main, /getElementById\('dev-perf'\)/, 'main.js never binds the readout');
  assert.match(main, /renderStats\(\)/, 'main.js never reads the render stats');
});
