# Minhocário v1 — Release Checklist (T23 / CP9)

> The ship gate for v1. Source: spec §6 (testing strategy) + the acceptance
> criteria (spec §"Acceptance criteria"). This file separates what the build
> **verifies automatically** (green in CI-equivalent local runs) from the
> **CP9 human gates** that require a person at a real browser. CP9 stays
> unchecked until a human signs off.
>
> **Applies to:** `master` at the T23 release commit (after T21b docs + T22
> polish). Balance constants locked at T21; behavior described in
> `docs/game-reference.md`.

---

## A. Verified automatically — green now

These need no human and are re-runnable at any time. All pass at the T23 commit.

- [x] **Full sim suite green** — `node --test tests/*.test.js` → **222 pass / 0 fail**.
      (Run the `tests/*.test.js` glob, not the bare `tests/` dir — the latter
      fails on this Node version; see MEMORY.) Covers every §6 bullet:
      population pipeline + stall/lagged recovery, mortality triggers,
      temperature/`solarGain`, food queue, per-model production, both overflow
      chains, scoring (age multiplier + reset + monotonic), economy
      (auto-sell/trade-in/migration), and save round-trip + migration.
- [x] **Determinism** — every test seeds the RNG; same seed + actions ⇒ same
      state. No `Math.random` in `js/sim/` (only a comment reference in
      `js/sim/rng.js`).
- [x] **i18n key-parity** — `tests/i18n.test.js`: pt-BR / en / es have identical
      key sets; `resolveLang` detection matrix passes.
- [x] **Food-labeling guard** — `tests/i18n.test.js`: the add-waste food list
      carries **zero** suitability signal (no label/group/order hint) in all
      three locales. `docs/game-reference.md` §4 lists foods in catalog order
      with raw numbers only — no verdicts.
- [x] **No hardcoded UI literals** — every user-facing string flows through
      `t()` / the `catalog.*` namespaces; none in `js/ui/*` or `js/main.js`
      (T22 audit).
- [x] **Deploy dry-run — static verification** (see §C): all 48 runtime ES-module
      import specifiers resolve **inside** the pruned copy; every `index.html`
      reference (the five `css/*.css` sheets, `js/main.js`) exists; **no** runtime external
      URLs and **no** `fetch`/`XHR`/`WebSocket`/`sendBeacon` reachable. The two
      `http(s)` strings inside vendored Three.js are (1) the pinned-version
      provenance **comment** header and (2) the `http://www.w3.org/1999/xhtml`
      XML namespace constant used by `createElementNS` — a DOM operation, not a
      network fetch. The `fetch(` present in Three.js lives only in loader
      classes the app never imports (we build meshes from primitives), so it
      never executes.

---

## B. CP9 human gates — manual playtest (per spec §6)

Run the **whole list twice**: once on a **desktop** browser, once on **one
mobile** browser. Serve the pruned deploy copy cold (see §C) so the test matches
what ships, not the dev tree.

### B.1 Boot & platform
- [ ] Opens and runs from a plain static file server (`npx serve <deploy-copy>`)
      with **zero build step** — no console errors, no 404s in the Network tab.
- [ ] **Desktop:** 3D scene renders (garage wall + ground + the composter mesh).
- [ ] **Mobile (one browser):** same scene renders; layout is usable; touch works.

### B.2 Visuals (spec acceptance criterion)
- [ ] Day/night is **perceivable at 1×** within ~1 real minute (dawn→day→dusk→night).
- [ ] The **sun patch** sweeps the wall and vanishes at night; a composter in vs.
      out of the patch at midday shows the matching temperature delta in the
      internals panel (sim/visual agreement — same `solarGain`).
- [ ] **X-ray toggle** reveals internals (fill volumes, worm hints, queue) and
      **never pauses/perturbs the sim** — the day counter keeps advancing.

### B.3 Every action (spec §6: "each action works incl. drag-move")
- [ ] Add waste (unlabeled list, ≥ 0.25 L), Add sawdust, Buy worm pack (50/100/200),
      Drain, Harvest (shows score gain), Open shop, X-ray, Restart.
- [ ] **Wall-position slider** moves placement and shifts midday temperature in
      the sunny region.
- [ ] **Drag-move via 3D raycast** moves the composter; slider follows and vice
      versa (bidirectional sync); works under touch; releasing outside the canvas
      doesn't wedge the drag.

### B.4 Full loop + persistence (spec acceptance criterion)
- [ ] Complete loop: **buy → set up → simulate days → feed → drain → harvest →
      sell (auto) → upgrade → score updates → persists after closing/reopening
      the browser.** Reload resumes at the exact saved hour (no catch-up ticks).
- [ ] **Speeds** 0.25×/0.5×/1×/5×/20× and Pause all take effect; hiding the tab
      freezes the clock.
- [ ] Restart shows the pt-BR confirmation, **freezes** the old ranking row, and
      starts a new entry; home top-10 order is correct.

### B.5 Each failure chain reachable **at 20×** (spec §2.8)
Reach each by pure neglect/bad choices; confirm the internals panel + HUD status
narrate the decline into the terminal colony-dead state (per
`docs/game-reference.md` §8):
- [ ] **Leachate overflow** — never drain → tank fills → bedding re-saturates →
      over-wetness mortality.
- [ ] **Humus overflow** — never harvest → tray full halts processing → stranded
      queue rots → toxicity mortality.
- [ ] **Overfeeding** — dump a large fresh mass → fermentation heat spikes temp
      (worse in the sun / low-insulation model) → overheat mortality.
- [ ] **Only unsuitable food** — feed only high-toxicity items → reproduction
      stalls first, then toxicity mortality.

### B.6 Offline after first load
- [ ] Load once, then go offline (DevTools "Offline" or airplane mode) and
      reload — the game runs fully with **no network requests** and no missing
      assets. (Three.js is vendored; there is no CDN or catch-up fetch.)

### B.7 i18n (CP-i18n human copy review is still open)
- [ ] Home language selector switches Português / English / Español immediately;
      the choice persists across reload in its own `minhocario.lang` key and does
      **not** modify or invalidate an existing save; `<html lang>` tracks it.
- [ ] Human review of the **en/es copy** on every built screen (pending
      CP-i18n) — pt-BR is the reference; en/es must read naturally.

---

## C. Deploy = FTP upload (no build step)

**Deploy is literally an FTP upload of the project folder** — there is no build,
no bundler, no `npm install` at runtime. Upload the pruned set to shared hosting
and the game is live.

### C.1 Files uploaded (ship set)
Include: `index.html`, `css/`, `js/`, `vendor/`.
Exclude from the upload: `tests/`, `.harn/`, `.claude/`, `tasks/`, `docs/`,
`.git/`. (Practically also skip `CLAUDE.md` and `.gitignore` — repo metadata,
never referenced by `index.html`; harmless if they tag along.)

### C.2 `docs/` exclusion decision (the plan left this open — DECIDED: **exclude**)
`docs/game-reference.md` is a **developer/maintainer** reference, never referenced
by `index.html`, and it enumerates per-food effect numbers, lethal thresholds,
and the failure-chain triggers. Although it states **no** suitability verdicts
(it can't become a good/bad food table), shipping it to the live site would still
hand players a mechanics **spoiler sheet** the game intends them to discover
through play. It is therefore **excluded from the FTP upload** alongside
`tests/`/`tasks/`. It stays in the repo for maintainers.

### C.3 Dry-run performed
A pruned copy (minus `tests/`, `.harn/`, `.claude/`, `tasks/`, `docs/`, `.git`)
was built and statically verified — see §A last bullet. It runs cold with no
404s and is offline-safe. **Human step remaining:** serve that copy and walk
§B once more to confirm identical behavior to the dev tree, then perform the real
FTP upload.

---

## D. Post-signoff freeze (activated at CP9 human sign-off)

Once CP9 is signed off, the following are **frozen** — changing them requires
asking the user first (spec §7 "Ask first"; they break comparability of existing
local rankings):

- [ ] **Scoring formula** (§2.10 / `js/sim/scoring.js`:
      `points += liters × 10 × (1 + colonyAgeDays/30)`) — frozen. Ask first.
- [ ] **Save schema** (`{ v: 1, profile, farm, ranking }` in `js/storage.js`,
      incl. the frozen ranking record shape) — frozen; any later change ships
      **with a migration**, never a silent discard. Ask first.
- [ ] Also ask-first (unchanged from spec §7): adding any runtime dependency
      beyond vendored Three.js, introducing a backend / third-party service
      (phase-2 global ranking starts only on explicit request), or adding a
      build step / toolchain.

> The language preference (`minhocario.lang`) lives **outside** the save schema
> and is **exempt** from this freeze — switching language never touches a save.

---

## CP9 sign-off

- [ ] **CP9** — human sign-off vs the spec acceptance criteria (§B complete on
      desktop + one mobile browser). On sign-off, activate §D and mark T23 done.
      *(Leave unchecked until a human has run §B end-to-end.)*
