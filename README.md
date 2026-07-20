# Minhocário

A browser-based vermicomposting simulator. Buy a composter, stock it with worms and
bedding, then keep an endless worm farm alive day after day — feeding it, draining
leachate, harvesting humus, and sliding the bin along the garage wall to chase or
escape the sun.

**▶ [Play it](https://fchamone.github.io/minhocario/)** — no install, no account, runs
entirely in your browser. Available in Português, English and Español.

## The game

You start with a nickname and just enough coins for the smallest composter, a pack of
worms and some bedding. From there it's yours to run.

Six composter models — electric, 2/3/4-tier stacks, buried, and eco — differ in
capacity, processing speed, humus and leachate output, and how well they hold
temperature against the outside air. Three worm species — *Eisenia fetida*, *Eudrilus
eugeniae* and *Perionyx excavatus* — differ in price, breeding rate, appetite, and the
temperature and moisture bands they stay comfortable in.

Each game day you decide what to feed the colony, when to drain, when to harvest, and
where on the wall the bin should sit. A sun patch sweeps that wall through the day and
the wall itself has a warm end and a cool end, so placement is a real temperature lever.
An x-ray view opens the bin up live: population by life stage, moisture, pH, toxicity,
temperature, what's still being digested, and how full the humus and leachate trays are.

Neglect has consequences, and all of them are reachable. Worms can die. Reproduction can
stall out completely. Trays overflow and halt production. A bin can be overfed into
overheating. Feeding is where most of the learning happens — the waste list is
deliberately unlabelled, and working out what a healthy bin actually wants is the game.

A dead colony isn't a dead save: add a fresh pack and the same farm keeps going, though
the colony-age multiplier restarts from zero. Score rewards production and longevity
together — you earn it by harvesting, and each harvest is worth more the older the
colony behind it. Your top ten farms are ranked locally in the browser.

## Run it locally

No build step, no `npm install`, no bundler. It's a static site — but it does need a
real HTTP server, because ES modules don't load over `file://`:

```bash
npx serve .
# or
python -m http.server 8000
```

Append `?dev=1` to the URL for the developer scaffolding (screen-jump nav and a
`window.setLang` console hook). It's opt-in per session; `?dev=0` clears it.

## Tests

Node is needed only for tests — never at runtime.

```bash
node --test tests/*.test.js
```

The glob matters: the bare `tests/` directory form fails on Node ≥ 24. Tests cover
`js/sim/` exclusively, which is what keeps that layer honest.

## Architecture

A single-page app. `index.html` holds every screen as a DOM section; `js/main.js` does
screen routing and wires the game loop. Three layers sit behind a hard boundary:

| Layer | Contents | Rule |
|---|---|---|
| `js/sim/` | `engine.js`, `temperature.js`, `scoring.js`, `rng.js`, and the `composters` / `worms` / `foods` catalogs | Pure. No DOM, no Three.js, no browser globals. Importable and testable under Node. |
| `js/ui/` | home, shop, setup, hud, actions, speed, stats | DOM only. Reads sim state. |
| `js/render/` | Three.js scene, day/night lighting, per-model composter meshes, x-ray | Rendering only. Reads sim state. |

Only `js/main.js` orchestrates between them. Two cross-cutting modules: `js/strings.js`
with `js/i18n/` holds every user-facing string, and `js/storage.js` owns persistence.

The engine is a pure `tick(state, rng) → state`. All randomness flows through a seeded
RNG that serializes with the save, so the same seed and the same actions always produce
the same farm — and a reloaded game resumes the exact RNG sequence it left off on.

Saves go to `localStorage` (never cookies) in a versioned format that migrates forward
on load. There are no accounts, no backend, and no tracking or analytics of any kind.

## Deploy

Upload the folder. That's the whole pipeline — the site is fully static and
self-contained, works offline after first load, and makes no external network calls.
`tests/`, `tasks/` and `.harn/` can be left out of a production upload.

The live build above is served from GitHub Pages off `main`.

## Documentation

- [`docs/game-reference.md`](docs/game-reference.md) — full mechanics and constants, in English
- [`docs/game-reference-pt.md`](docs/game-reference-pt.md) — the same document in pt-BR

Both are transcribed from `js/sim/` and kept as a matched pair.

## Acknowledgements

[Three.js](https://threejs.org/) r170, MIT licensed, vendored in `vendor/` as the only
runtime dependency.

## License

MIT — see [LICENSE](LICENSE).
