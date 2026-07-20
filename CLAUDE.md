# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Minhocário — a browser-based vermicomposting (worm farm) simulator game. Fully static site (upload via FTP = deploy), no build step, no npm install, no bundler. The full spec is at `.harn/devy/changes/C-0001-worm-farm-simulator/spec.md` — read it before implementing features; it defines v1 scope, acceptance criteria, and out-of-scope items (notably: global ranking/backend is phase 2 and starts only when explicitly requested).

## Commands

| Task | Command |
|------|---------|
| Run locally | `npx serve .` or `python -m http.server 8000` (ES modules don't load via `file://`) |
| Run all tests | `node --test tests/*.test.js` (the bare `tests/` directory form fails on Node ≥ v24) |
| Run a single test file | `node --test tests/<file>.test.js` |
| Deploy | FTP-upload the project folder (minus `tests/`, `.harn/`) — no build step |

Node is needed only for tests. There are no runtime dependencies other than the vendored Three.js in `vendor/` (version pinned in a comment header).

## Development workflow

- Develop **directly on `main`** — this project does **not** use git worktrees. Commit straight to `main` (or a short-lived branch merged back promptly) and keep history linear. `main` is also what GitHub Pages serves.
- No build step and no toolchain: edits to `index.html` / `css/` / `js/` are the deliverable. Deploy = FTP-upload the project folder (minus `tests/`, `.harn/`, `.claude/`).

## Architecture

Single-page app: `index.html` holds all screens as DOM sections (home/shop/setup/game); `js/main.js` does screen routing and game-loop wiring.

Three layers with a **hard boundary**:

- `js/sim/` — **pure simulation engine**: no DOM, no Three.js, no browser globals. Must be importable and testable under Node. Core is `engine.js` (`tick(state, rng)` → new state); catalogs live in `composters.js`, `worms.js`, `foods.js`; plus `scoring.js` and `rng.js` (seeded RNG).
- `js/ui/` — DOM screens/controls (home, shop, setup, hud, actions, speed). Reads sim state.
- `js/render/` — Three.js layer (scene with day/night lighting, per-model composter meshes, x-ray view). Reads sim state.

Only `js/main.js` orchestrates between layers. Tests (`tests/`, using `node:test` + `node:assert`) cover `js/sim/*`, `js/storage.js` and the i18n catalogs. One deliberate exception: `tests/composter3d.test.js` covers `js/render/composter3d.js`, because its mesh builders and `composterCavity` share structural dimensions whose drift is otherwise silent (the x-ray internals just render outside the shell). Three.js core imports fine under Node — geometry needs no WebGL — so render-layer *geometry* is testable; anything needing a renderer, a canvas or the DOM is not.

Cross-cutting modules: `js/strings.js` (ALL pt-BR user-facing strings — single source for future i18n) and `js/storage.js` (localStorage save/load, versioned save format `{ v: 1, ... }` with migrations).

## Rules (from the spec — non-negotiable)

- Keep `js/sim/` free of DOM/Three.js/browser imports. Sim state is a plain JSON-serializable object.
- All simulation randomness goes through the seeded RNG passed into `tick()` — never `Math.random()` inside `js/sim/`. Every test seeds the RNG; same seed + same actions ⇒ same state.
- Every UI string goes through `strings.js` in pt-BR — never hardcode UI text in components. Code identifiers and comments are in English.
- Version the save format and migrate old saves on load; never silently discard a player's save.
- Fully static and self-contained: no CDN, no external network calls, works offline after first load.
- `localStorage` only for game state — never cookies. No login/accounts in v1.
- The add-waste food list deliberately mixes suitable and unsuitable foods **without labeling which is which** — discovery is gameplay; never label them. This applies to `docs/` too — the reference docs describe each food's raw numbers in catalog order and never rank or judge them.
- No tracking/analytics.
- `docs/game-reference.md` (English) and `docs/game-reference-pt.md` (pt-BR) are a **matched pair** — same structure, same numbers, different prose language. Update both in the same commit or neither. Constants are transcribed from `js/sim/*` **after** a balance retune settles, never edited in one file alone.
- Never re-derive a sim formula outside `js/sim/` — import it. A hand-copied `THROUGHPUT_CAP_PER_LITER` in a test went stale against the engine and silently inverted the invariant it was written to guard (see T25). Export a function and call it.

**Ask the user first before:** adding any runtime dependency beyond vendored Three.js, introducing a backend or third-party service, changing the scoring formula or save schema after v1 ships, or adding a build step/toolchain.

## Code style

- Vanilla ES modules for modern evergreen browsers; no transpilation, no polyfills.
- JSDoc type annotations (`@param`/`@returns`/`@typedef`) on all `js/sim/` public functions.
- `const` by default; small focused modules; plain objects + functions over classes where they suffice.
