# Spec C-0002 — Multi-language support (pt-BR / English / Español)

**Status:** Refined and approved for implementation
**Extends:** `.harn/devy/changes/C-0001-worm-farm-simulator/spec.md`
**Date:** 2026-07-17 (interview forks resolved 2026-07-17)
**Build context:** C-0001 is **in flight** — T1–T5 complete (`tasks/plan.md`, `tasks/todo.md`). This is a mid-build extension, not a greenfield change.

---

## 1. Objective

Make Minhocário playable in three languages — **Brazilian Portuguese (`pt-BR`)**, **English (`en`)**, and **Spanish (`es`)** — with the language **selectable on the initial (home) page**. The change reuses the i18n seam already established in C-0001 (T1): user-facing text lives in `js/strings.js` and reaches the DOM through `data-string="a.b.c"` attributes filled by `js/main.js`. `pt-BR` remains the **reference/source locale**; `en` and `es` mirror its exact key shape.

**Target users:** unchanged from C-0001 (casual players, composting enthusiasts) — now reachable beyond Portuguese speakers.

### Resolved design forks (interview)

1. **First-load default:** **auto-detect from the browser**, falling back to `pt-BR`. If the `navigator.language` primary subtag is `pt`/`en`/`es`, open in that language; anything else opens in `pt-BR`.
2. **Where switchable:** **home page only.** Language is chosen on the initial screen and is **fixed once a farm is running** (until the player returns home). No in-game language control in this change.
3. **Translation reach:** **everything** — UI chrome plus composter, worm, and food **display names**. Worm **scientific (Latin) names stay Latin** in all languages. The food list stays **unlabeled** (no suitable/harmful hint, grouping, or ordering signal) in **every** language.
4. **Nickname generator:** **stays pt-BR-flavored** in all languages (e.g. `MinhocaVeloz42`). Its word lists are *not* part of the translatable catalog. Explicitly deferred; may be revisited later.

### Acceptance criteria

- The home page shows a **language selector** (native names: `Português` / `English` / `Español`); selecting one switches all visible UI **immediately**.
- A first-time visitor whose browser is Spanish or English opens in that language; any other locale opens in `pt-BR`.
- The choice **persists across reloads** in its **own `localStorage` key**, and switching language **never alters or invalidates an existing game save**.
- All three catalogs pass a **key-parity test**; every composter/worm/food `id` has a localized name in all three locales; food entries expose **only** a name (no suitability field).
- Worm **scientific names render in Latin** in all three languages.
- **Nicknames remain pt-BR-flavored** regardless of the active language.
- `document.documentElement.lang` reflects the active locale.
- Grep audit finds **zero** hardcoded user-facing literals outside `js/strings.js` / `js/i18n/`.

### Out of scope

- A 4th language, or changing the canonical tags, after ship (**ask first**).
- In-game (mid-farm) language switching — deferred; home-only per fork 2.
- Localizing the nickname generator — deferred per fork 4.
- Locale-specific number/date/currency formatting via `Intl` — the game uses plain integers with unit labels from the catalog; no `Intl` dependency.
- RTL layout — none of the three locales require it.

---

## 2. Design decisions (resolved)

### 2.1 Supported locales & canonical tags

| Tag | Native name (selector label) | Role |
|---|---|---|
| `pt-BR` | Português | **Reference/source** — all keys authored here first |
| `en` | English | Mirror of the reference shape |
| `es` | Español | Mirror of the reference shape |

`appTitle` is the proper noun **"Minhocário"** — identical in every locale.

### 2.2 Detection & default (pure, testable)

A pure function `resolveLang(storedTag, navigatorLanguages)` decides the active locale:

1. If `storedTag` is a supported tag → use it (explicit choice wins).
2. Else scan `navigatorLanguages` (array; `navigator.languages` or `[navigator.language]`); for each, take the **primary subtag** and map `pt → pt-BR`, `en → en`, `es → es`; first match wins.
3. Else fall back to **`pt-BR`**.

The function takes raw values (no `navigator`/`localStorage` access) so it is unit-testable under Node. `main.js` reads the browser values and passes them in.

### 2.3 Persistence — separate from the game save

Language is a **device/UI preference, not game state**. It lives in its **own `localStorage` key** (`minhocario.lang`), completely independent of the versioned save `{ v: 1, ... }`.

- Written **only on explicit user selection**. If the key is absent, the language is re-detected each load (so the game follows the browser until the player makes a choice).
- **Does not touch the save schema** — this deliberately avoids the C-0001 "ask first before changing the save schema" boundary and keeps language switching orthogonal to save migrations.
- `localStorage` only, never cookies (C-0001 rule holds).

### 2.4 Where the language is switchable

- The **home screen** carries the selector (three native-name controls or a `<select>`). Its own labels are language-neutral native names, so they need no translation.
- Selecting a language: `setLang(tag)` → persist the key → update `document.documentElement.lang` → **re-render** all static `[data-string]` nodes and rebuild the home screen's dynamic content (ranking rows, nickname).
- Because language is **fixed after leaving home** (fork 2), the shop/setup/game screens simply read the active locale when they are built on entry — no deep hot-swap machinery is required.

### 2.5 Catalog structure

`js/strings.js` becomes the **i18n runtime** (preserving it as the single import site that CLAUDE.md mandates):

```
js/
├── strings.js          # i18n runtime — the ONLY module UI imports for text.
│                       #   State: active locale. API: t(path), setLang(tag),
│                       #   getLang(), SUPPORTED_LANGS, resolveLang(stored, navLangs).
│                       #   Imports the three catalogs below.
└── i18n/
    ├── pt-BR.js        # reference catalog (every key) — existing literals move here verbatim
    ├── en.js           # English catalog — identical nested shape
    └── es.js           # Spanish catalog — identical nested shape
```

- Consumers call **`t('home.play')`** (dotted path against the active catalog). `main.js`'s `applyStrings()` uses the same resolver for `data-string` nodes.
- **Missing-key fallback:** if a key is absent in the active catalog, `t()` falls back to the `pt-BR` value and `console.warn`s the key. UI never renders blank because a translation is incomplete.
- Catalog modules are **pure data, DOM-free, Node-importable** — the same testability contract as `js/sim/`.

### 2.6 Game-content display names (translate everything; Latin kept)

The C-0001 hard boundary holds: **`js/sim/` catalogs stay pure, English-`id`'d, and carry no user-facing display text.**

- Display names live in the string catalogs, keyed by the sim `id`:
  - `catalog.composters[id] = { name, desc }`
  - `catalog.worms[id] = { name, desc }`
  - `catalog.foods[id] = { name }`   ← **name only**
- The worm **scientific name** (e.g. *Eisenia fetida*) is **language-neutral reference data**, not UI copy → it stays in `js/sim/worms.js` as a `latin` field and renders next to the translated common name in every locale.
- **Foods expose only a name** in every locale — no `suitable`/`harmful` flag, no category, no ordering hint. The discovery mechanic (C-0001 §2.7) survives translation intact.

### 2.7 Nickname generator (pt-BR only)

The adjective + animal + number word lists stay **Portuguese** regardless of the active UI language and are **not** part of the translatable catalog — they belong with the home nickname logic (C-0001 T10), not the i18n catalogs. Generated nicknames are stored on the profile and displayed identically across all locales.

### 2.8 `<html lang>` and title

`setLang` sets `document.documentElement.lang` to the active BCP-47 tag (`pt-BR` / `en` / `es`). `index.html` ships with `lang="pt-BR"`; the runtime overrides it after detection. `document.title` continues to come from `appTitle` ("Minhocário", identical across locales).

---

## 3. Commands

Unchanged from C-0001 (no build step, static, ES modules).

| Task | Command |
|------|---------|
| Run locally | `npx serve .` **or** `python -m http.server 8000` |
| Run tests | `node --test tests/` (Node ≥ v24: `node --test tests/*.test.js`) |
| Deploy | FTP-upload the project folder (minus `tests/`, `.harn/`, `.claude/`) — **`js/i18n/` ships** |

New test file: `tests/i18n.test.js`. No new runtime dependency; no toolchain change.

---

## 4. Project structure (delta over C-0001 §4)

```
js/
├── strings.js          # CHANGED: pt-BR object → i18n runtime (state + t/setLang/getLang/resolveLang)
├── i18n/               # NEW: one catalog module per locale, identical shape
│   ├── pt-BR.js        #   reference (existing literals relocated here, unchanged)
│   ├── en.js
│   └── es.js
├── main.js             # CHANGED: applyStrings() reads the active catalog; detect+setLang on init
└── ui/home.js          # (T10) hosts the language selector + pt-BR nickname word lists
tests/
└── i18n.test.js        # NEW: catalog parity + resolveLang detection matrix
```

Everything else in C-0001 §4 is unchanged. `js/sim/` gains only a `latin` data field on worm species (§2.6) — no display strings.

---

## 5. Code style (delta over C-0001 §5)

- Every UI string still flows through `js/strings.js` — now via **`t(path)`** against the active locale. Components never read a locale object directly.
- **`pt-BR` is the reference.** New keys are authored in `pt-BR.js` first; `en.js` and `es.js` must mirror the **exact** key shape (enforced by the parity test).
- Code identifiers and comments stay **English**; Latin scientific names are **data**, not UI.
- i18n catalog modules are pure/DOM-free/Node-importable (same contract as `js/sim/`).
- No `Intl`/formatting library; plain integer rendering with unit labels from the catalog.

---

## 6. Testing strategy (delta over C-0001 §6)

New suite `tests/i18n.test.js` (pure, no browser globals):

- **Key parity:** the three catalogs have **identical key sets** — no missing keys, no extra keys, no empty string values, in any locale.
- **Catalog coverage:** every `id` exported by `js/sim/composters.js`, `js/sim/worms.js`, and `js/sim/foods.js` has a corresponding localized `name` (and `desc` where applicable) in **all three** locales.
- **Food-labeling guard:** every `catalog.foods[id]` entry exposes **only** a `name` — the test asserts no suitability/category/ordering field leaks into the food strings in any locale.
- **`resolveLang` matrix:** stored-tag-wins; `pt`/`pt-PT`/`pt-BR` → `pt-BR`; `en-US`/`en` → `en`; `es-419`/`es-ES` → `es`; unknown (`fr`, `de`, `''`, `undefined`) → `pt-BR`; empty `navigatorLanguages` → `pt-BR`.

The C-0001 sim-purity test contract is unchanged; these catalogs qualify under the same "Node-importable, no browser globals" rule.

**Manual checklist additions (per release):** switch each language on home and confirm every screen's chrome + catalog names translate; browser-locale detection on a fresh profile; language choice survives reload and does **not** disturb an in-progress save; nicknames stay pt-BR; `<html lang>` updates.

---

## 7. Integration with the in-flight C-0001 build

Because C-0001 is mid-build (T1–T5 done, T6 next), this change lands partly as a **refactor of shipped code (T1)** and partly by making the **not-yet-built UI tasks i18n-native** (near-zero retrofit cost). Proposed work items (to be slotted by `/devy:plan` into `tasks/plan.md` / `tasks/todo.md`):

- **I1 — i18n runtime refactor (do this next, before more UI is written).** Restructure `js/strings.js` into the runtime + `js/i18n/{pt-BR,en,es}.js`; move existing pt-BR literals into `pt-BR.js` **verbatim**; add `t()`, `setLang`, `getLang`, `resolveLang`, `SUPPORTED_LANGS`, and pt-BR missing-key fallback; update `main.js` `applyStrings()` to use the active catalog and to detect + apply the locale on init and set `<html lang>`. Add `tests/i18n.test.js` (parity + `resolveLang`). **Files:** `js/strings.js`, `js/i18n/*`, `js/main.js`, `tests/i18n.test.js`.
- **I2 — Home language selector (lands with T10).** Native-name selector on the home screen; `setLang` → persist `minhocario.lang` → re-render `[data-string]` + rebuild ranking/nickname. **Files:** `js/ui/home.js`, `index.html`, `css/style.css`, `js/i18n/*`.
- **I3 — Catalog display-name namespaces (land with each owning task's UI consumer).** Add `catalog.composters/worms/foods` name/desc entries across all three locales for the ids from T3 (composters, built), T4 (foods, built), T5 (worms, built); add the `latin` field to `js/sim/worms.js`. **Files:** `js/i18n/*`, `js/sim/worms.js`.

**Downstream awareness (a constraint, not an extra task):** the pending UI tasks — **T10** (home), **T11** (shop), **T12** (setup), **T13** (HUD/speed), **T14** (actions + x-ray panel), **T15** (lifecycle), **T20** (3D x-ray) — must pull all copy via `t()` and all model/species/food names via the `catalog.*` namespaces from the start. **T22**'s audit extends to also assert catalog parity and the food-labeling guard.

**Recommended ordering:** I1 immediately (small, and it keeps every subsequent screen i18n-native); the worm slice of I3 can land now that T5 is done; the rest of I3 with each screen that first renders those names; I2 with T10.

---

## 8. Boundaries (delta over C-0001 §7)

### Always
- Route **every** UI string through `js/strings.js` / `t()`; keep `pt-BR` as the reference and mirror its exact key shape in `en`/`es`.
- Keep `js/sim/` pure — **no display names in sim catalogs**. The worm `latin` field is language-neutral data (allowed).
- Never label foods by suitability in **any** locale (C-0001 rule, now cross-language).
- Store the language preference in its **own `localStorage` key**, never in the save schema, never in cookies.
- Keep all translations **static and self-contained** — no CDN, no network fetch for locale data.

### Ask first
- Adding an i18n/formatting library or an `Intl`-heavy dependency (none needed).
- Adding a **4th language** or changing the canonical tags after ship.
- Storing the language **inside the save schema** (would couple it to save migrations).
- **Localizing the nickname generator** (explicitly deferred; currently pt-BR only).

### Never
- Never hardcode user-facing text in components (C-0001 rule).
- Never ship a locale with missing keys **silently** — the parity test gates it and the runtime falls back to `pt-BR` with a `console.warn`.
- Never add tracking/analytics or external calls to deliver translations.
