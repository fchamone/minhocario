# Minhocário — Release Checklist (v1 / CP9, re-audited at C-0003 V20)

> The ship gate. Source: spec §6 (testing strategy) + the acceptance criteria
> (spec §"Acceptance criteria"). This file separates what the build **verifies
> automatically** (green in local runs) from the **human gates** that require a
> person at a real browser.
>
> **Two gates, not one.** v1's gate was **CP9, signed off 2026-07-20** (record in
> `tasks/todo.md`). Everything the player looks at has been rebuilt since, by
> C-0003 — six stylesheets, an embedded webfont, an icon sprite, a three-column
> game screen, ACES tone mapping, textures, shadows. So §B is written twice: what
> CP9 walked, and what **CPV5** — C-0003's ship gate — still owes.
>
> **Applies to:** `main` at the C-0003 V20 commit. Balance constants locked at
> T21; behaviour described in `docs/game-reference.md`.

---

## A. Verified automatically — green now

Re-runnable at any time, and **now actually re-run**: every claim in this section
that used to be a one-time manual sweep is a test in `tests/release.test.js`.
That change is the point of V20. The previous version of this file asserted "48
import specifiers resolve", "no external URLs" and "no hardcoded UI literals" on
the strength of an audit performed once at T22/T23, and nothing had re-checked
them across two projects' worth of commits.

- [x] **Full suite green** — `node --test tests/*.test.js` → **418 pass / 0 fail**.
      (Run the `tests/*.test.js` glob, not the bare `tests/` dir — the latter
      fails on Node ≥ 24.) Covers every §6 bullet: population pipeline +
      stall/lagged recovery, mortality triggers, temperature/`solarGain`, food
      queue, per-model production, both overflow chains, scoring (age multiplier
      + reset + monotonic), economy (auto-sell/trade-in/migration), and save
      round-trip + migration.
- [x] **Determinism** — every test seeds the RNG; same seed + actions ⇒ same
      state. **Guarded:** `js/sim/` contains no `Math.random` in code
      (`tests/release.test.js`, comments stripped — `rng.js` names it in the very
      comment forbidding it, which is why a raw grep was never the instrument).
- [x] **Sim purity** — `js/sim/` imports nothing outside itself and references no
      browser global. Guarded, not assumed: this is a CLAUDE.md non-negotiable
      that until V20 had no test at all.
- [x] **i18n key-parity** — `tests/i18n.test.js`: pt-BR / en / es have identical
      key sets; `resolveLang` detection matrix passes.
- [x] **Food-labeling guard** — `tests/i18n.test.js`: the add-waste food list
      carries **zero** suitability signal in all three locales.
      `tests/icons.test.js` extends the same discipline to the 14 food icons (one
      canvas, one frame, one stroke weight, `currentColor`/`none` only).
      `docs/game-reference.md` §4 lists foods in catalog order with raw numbers
      only — no verdicts.
- [x] **No hardcoded UI literals** — every user-facing string flows through `t()`.
      Guarded by the accented-literal walker in `tests/release.test.js`: pt-BR
      copy is diacritic-dense, so a hardcoded string almost certainly carries one.
      The cheap half of the T22 audit, but it cannot go stale; the expensive half
      is the key-parity suite above.
- [x] **Offline after first load, statically** — no `fetch`/`XHR`/`WebSocket`/
      `sendBeacon`/`importScripts`/`serviceWorker` anywhere in the first-party
      layer; the webfont is a `data:` URI and its OFL text ships beside it.
- [x] **The vendored Three.js is inert on the network** — exactly two `http(s)`
      strings: the pinned-version provenance **comment** and the
      `http://www.w3.org/1999/xhtml` namespace constant `createElementNS` needs.
      The `fetch(` inside the bundle lives in loader classes; the claim has never
      been that it is absent but that nothing constructs a loader, so **that** is
      what is now tested — no first-party module may import a `*Loader`.
- [x] **Ship set is decided, not assumed** — every top-level path is classified
      ship/exclude with a reason. A new root directory now fails the suite instead
      of silently shipping or silently 404ing.
- [x] **Deploy dry run — cold serve, 2026-07-21** (see §C.3): the pruned copy
      served over HTTP and every URL a browser would load requested against it —
      `index.html`, six stylesheets, and the ES-module graph walked from
      `js/main.js` **through the served bytes**, so a file present locally but
      absent from the upload appears as the 404 it would be. **34 URLs, 1.2 MB,
      zero 404s.** Five excluded paths confirmed unreachable
      (`tests/`, `tasks/`, `docs/`, `DESIGN.md`, `CLAUDE.md`).

### A.1 The five inert `http` strings, inventoried

A grep for `http` over the ship set returns five hits and **none is a request**.
The previous version of this file documented only the two inside Three.js; V7 and
V8 added three more and the claim was never updated. Classified by whether the URL
sits in a *fetching position* (`url()`, `@import`, `src=`, `href=`, `fetch(`):

| Where | String | Why it is inert |
|---|---|---|
| `index.html` sprite | `http://www.w3.org/2000/svg` | XML namespace; never dereferenced |
| `js/ui/icons.js` | `http://www.w3.org/2000/svg` | same, for `createElementNS` |
| `vendor/three.module.min.js` | `http://www.w3.org/1999/xhtml` | same |
| `vendor/three.module.min.js` | `https://cdn.jsdelivr.net/npm/three@0.170.0/…` | provenance comment (pinned version) |
| `css/font.css` | `https://github.com/google/fonts/…/ibmplexsans` | provenance comment (font source) |

---

## B. Human gates — manual playtest (per spec §6)

Run the whole list on a **desktop** browser and on **one mobile** browser, against
the pruned deploy copy served cold (§C), so the test matches what ships.

### B.0 State of the two gates

- [x] **CP9 (v1) — signed off 2026-07-20.** The full list below was walked on
      desktop and one mobile browser at the v1 build, and the scoring/save freeze
      in §D activated on that sign-off.
- [ ] **CPV5 (C-0003) — OWED.** C-0003 rebuilt every surface CP9 looked at, so
      CP9's walk does not carry forward. What CPV1–CPV4 already covered is listed
      in `tasks/todo-c0003-visual-redesign.md` and is **not** repeated here; what
      remains is §B.8.

### B.1 Boot & platform
- [ ] Opens and runs from a plain static file server with **zero build step** —
      no console errors, no 404s in the Network tab.
- [ ] **Desktop:** 3D scene renders (garage wall + ground + the composter mesh).
- [ ] **Mobile (one browser):** the **desktop-only notice** appears and the game
      does not boot. ~~same scene renders; layout is usable; touch works~~ —
      withdrawn 2026-07-21, see §B.8 and the spec §6 amendment.

### B.2 Visuals (spec acceptance criterion)
- [ ] Day/night is **perceivable at 1×** within ~1 real minute (dawn→day→dusk→night).
- [ ] The **sun patch** sweeps the wall and vanishes at night; a composter in vs.
      out of the patch at midday shows the matching temperature delta in the
      internals panel (sim/visual agreement — same `solarGain`).
- [ ] **X-ray toggle** reveals internals and **never pauses/perturbs the sim** —
      the day counter keeps advancing.

### B.3 Every action (spec §6: "each action works incl. drag-move")
- [ ] Add waste (unlabeled list, ≥ 0.25 L), Add sawdust, Buy worm pack (50/100/200),
      Drain, Harvest (shows score gain), Open shop, X-ray, Restart.
- [ ] **Wall-position slider** moves placement and shifts midday temperature in
      the sunny region.
- [ ] **Drag-move via 3D raycast** moves the composter; slider follows and vice
      versa; works under touch; releasing outside the canvas doesn't wedge the drag.

### B.4 Full loop + persistence (spec acceptance criterion)
- [ ] Complete loop: **buy → set up → simulate days → feed → drain → harvest →
      sell (auto) → upgrade → score updates → persists after closing/reopening
      the browser.** Reload resumes at the exact saved hour (no catch-up ticks).
- [ ] **Speeds** 0.25×/0.5×/1×/5×/20× and Pause all take effect; hiding the tab
      freezes the clock.
- [ ] Restart shows the pt-BR confirmation, **freezes** the old ranking row, and
      starts a new entry; home top-10 order is correct.

### B.5 Each failure chain reachable **at 20×** (spec §2.8)
- [ ] **Leachate overflow** — never drain → tank fills → bedding re-saturates →
      over-wetness mortality.
- [ ] **Humus overflow** — never harvest → tray full halts processing → stranded
      queue rots → toxicity mortality.
- [ ] **Overfeeding** — dump a large fresh mass → fermentation heat spikes temp →
      overheat mortality.
- [ ] **Only unsuitable food** — reproduction stalls first, then toxicity mortality.

### B.6 Offline after first load
- [ ] Load once, then go offline (DevTools "Offline" or airplane mode) and reload
      — the game runs fully with **no network requests** and no missing assets.
- [ ] **The webfont specifically.** It is embedded as a `data:` URI (35 KB
      base64) and §A proves no sheet fetches a font file, but the failure mode is
      a silent fallback to a system face rather than an error. Confirm the offline
      reload still renders in IBM Plex Sans and that **no font request appears in
      the Network tab**.

### B.7 i18n
- [ ] Home language selector switches Português / English / Español immediately;
      the choice persists across reload in its own `minhocario.lang` key and does
      **not** modify or invalidate an existing save; `<html lang>` tracks it.
- [ ] Human review of the **en/es copy** on every built screen.

### B.8 C-0003 additions — what CPV5 owes beyond CP9

- [ ] **The desktop-only gate, on a real phone.** *(Supersedes the mobile walk.
      Maintainer decision 2026-07-21: the game is desktop-only — spec §6 amended,
      and the reasoning is in `js/ui/platform.js`.)* On an actual Android and/or
      iOS browser: the notice appears, it is **in the player's language**, and
      **`#app` is not merely hidden — nothing boots**. Confirm in DevTools that
      **no WebGL context is created and Three.js never runs a frame**; the CSS
      alone would leave a phone paying for a scene behind a wall, which is
      precisely what the JS half of the gate exists to prevent.
- [ ] **iPadOS specifically.** It reports itself as macOS, so it is the case a
      user-agent blocklist would have missed and the capability rule is chosen to
      catch. If any device is going to slip through, it is this one.
- [ ] **A touchscreen laptop must NOT be blocked.** The rule is `coarse AND
      no-hover`, so a Windows touch laptop with a mouse should play normally.
      This is the false-positive direction, and it is the one a player would
      report as "the game refuses to run".
- [ ] **A narrow desktop window still plays.** V20's stacking breakpoint
      (`max-width: 899px`) is **kept** and now serves this case rather than
      phones: a half-screen desktop window is not touch-primary, so it is not
      gated, and without the breakpoint it would hit the same zero-width-canvas
      bug V20 fixed. Resize a desktop window below 900px and confirm the bands
      stack and the canvas keeps real area — with the readouts panel **collapsed
      as well as open** (the narrow rule repeats the `:has()` selector because
      that selector carries an ID and would otherwise outrank it; a test asserts
      the column counts agree, only a browser shows the result).
- [ ] **The three-column desktop layout is unchanged** by the breakpoint at
      ≥900px — a regression here would be the fix eating the layout it protects.
- [ ] Anything CPV1–CPV4 left open. Per those entries, nothing is outstanding:
      the 3D matrix, the 14-food clustering check, the drag re-walk, the sub-grid
      widths and the shadow perf gate are all closed.

---

## C. Deploy = FTP upload (no build step)

**Deploy is literally an FTP upload of the project folder** — no build, no
bundler, no `npm install` at runtime.

### C.1 Files uploaded (ship set)
Include: `index.html`, `css/`, `js/`, `vendor/`. **35 files, ~1.2 MB**, of which
`vendor/three.module.min.js` is ~680 KB and the embedded webfont ~48 KB of
`css/font.css`.

**`css/IBMPlexSans-OFL.txt` must be uploaded**, not pruned as documentation. The
SIL Open Font License requires its text to accompany redistributed font software,
and `css/font.css` redistributes IBM Plex Sans as an embedded `data:` URI. It is
the one `.txt` in the ship set and it is there for licence compliance.

Exclude: `tests/`, `tasks/`, `docs/`, `.harn/`, `.claude/`, `.git/`, `DESIGN.md`,
`CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore`, `.nojekyll`. The last five are
repo metadata, never referenced by `index.html`, and harmless if they tag along.

`DESIGN.md` (C-0003 / V4) is excluded **deliberately** rather than incidentally:
it records the art direction and the icon rules, and it names the food-icon
anti-spoiler discipline — which means it names the mechanic the food list is
built to hide.

**This partition is now enforced.** `tests/release.test.js` fails if any
top-level path is neither shipped nor excluded-with-a-reason, so a new directory
gets a deploy decision instead of a coin flip.

### C.2 `docs/` exclusion decision (DECIDED: **exclude**)
`docs/game-reference.md` is a maintainer reference, never referenced by
`index.html`, and it enumerates per-food effect numbers, lethal thresholds and
failure-chain triggers. It states **no** suitability verdicts, but shipping it
would still hand players a mechanics **spoiler sheet** the game intends them to
discover through play. Excluded from the upload; kept in the repo.

### C.3 Dry run performed — 2026-07-21 (V20)
A pruned copy was built and **served cold over HTTP**, then every URL a browser
would load was requested against it: `index.html`, the six stylesheets, and the
ES-module graph walked from `js/main.js` *through the served bytes*, so a file
present locally but missing from the upload shows up as the 404 it would be.

Result: **34 URLs, 1179 KB, zero 404s**; the five excluded paths spot-checked all
returned 404; `index.html` served byte-identical to the repo; the webfont
confirmed embedded in the *served* CSS (35 KB base64) rather than fetched; and no
external URL in a fetching position (the five inert strings are inventoried in
§A.1). `npx serve` was unavailable offline, so a throwaway Node static server was
used — it serves the pruned tree and nothing else, which is exactly the property
under test.

**Human step remaining:** serve that copy and walk §B on desktop *and* a phone,
then perform the real FTP upload.

---

## D. Post-signoff freeze — ACTIVE since CP9 (2026-07-20)

These are **frozen**. Changing them requires asking the user first (spec §7); they
break comparability of existing local rankings.

- [x] **Scoring formula** (§2.10 / `js/sim/scoring.js`:
      `points += liters × 10 × (1 + colonyAgeDays/30)`) — frozen. Ask first.
- [x] **Save schema** (`{ v: 1, profile, farm, ranking }` in `js/storage.js`,
      incl. the frozen ranking record shape) — frozen; any later change ships
      **with a migration**, never a silent discard. Ask first.
- [x] Also ask-first: adding any runtime dependency beyond vendored Three.js,
      introducing a backend / third-party service (phase-2 global ranking starts
      only on explicit request), or adding a build step / toolchain.

> The language preference (`minhocario.lang`) lives **outside** the save schema
> and is **exempt** — switching language never touches a save.

### D.1 Freeze verification for CPV5 — mechanical, re-runnable

CPV5 must confirm explicitly that both are untouched since the freeze. Do not
read the diff; ask git, which cannot forget a file:

```
git log --oneline 612aacb..HEAD -- js/sim js/storage.js   # 612aacb = the CP9 freeze commit
```

**Empty output as of V20** — *no commit has touched `js/sim/` or `js/storage.js`
since CP9*. The whole of C-0003 is CSS, markup, the UI layer, the render layer,
the i18n catalogs and tests.

---

## Sign-off

- [x] **CP9** — v1 ship gate, signed off 2026-07-20. §D activated.
- [ ] **CPV5** — C-0003 ship gate. Requires §B.8 (the mobile walk above all) plus
      §B.1–B.7 on the redesigned build, and the §D.1 freeze check re-run.
      *(Leave unchecked until a human has walked it.)*
