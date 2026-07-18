// Home screen: nickname generation/reroll/persistence, the local top-10 ranking
// table, and Play (new) vs Continue (resumable save) routing.
//
// Layering: this is a UI module. It reads/writes the game save through the
// cross-cutting `storage.js` and pulls ALL text through the i18n runtime
// (`strings.js`) — never a hardcoded literal. It touches `document` ONLY inside
// the DOM functions, so the module stays importable under Node and its two pure
// helpers (buildNickname / topRanking) are unit-tested there.

import { t, NICKNAME_ANIMALS, NICKNAME_ADJECTIVES } from '../strings.js';
import { load, save, LOAD_STATUS } from '../storage.js';
import { STARTING_WALLET } from '../sim/engine.js';

/** How many farms the local ranking table shows (spec §1 — top 10). */
export const RANKING_LIMIT = 10;

/**
 * Compose a random nickname like the spec's "MinhocaVeloz42": an animal, a
 * gender-invariant adjective, and a two-digit number. Pure — the randomness is
 * injected so the result is deterministic under test.
 * @param {() => number} [rand=Math.random] a source of floats in [0, 1).
 * @returns {string}
 */
export function buildNickname(rand = Math.random) {
  const animal = NICKNAME_ANIMALS[Math.floor(rand() * NICKNAME_ANIMALS.length)];
  const adjective = NICKNAME_ADJECTIVES[Math.floor(rand() * NICKNAME_ADJECTIVES.length)];
  const number = 10 + Math.floor(rand() * 90); // 10..99 — always two digits
  return `${animal}${adjective}${number}`;
}

/**
 * The ranking entries to display: the highest scores first, capped at `limit`.
 * Pure and non-mutating (spec §2.1 — one entry per farm, monotonic score).
 * @param {Array<{score:number}>|null|undefined} entries
 * @param {number} [limit=RANKING_LIMIT]
 * @returns {Array<object>}
 */
export function topRanking(entries, limit = RANKING_LIMIT) {
  if (!Array.isArray(entries)) return [];
  return [...entries].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Summarize a farm as a ranking row.
 *
 * The field set is fixed by spec §2.1 — `{nickname, score, composterId,
 * daysSurvived, createdAt}` — because this record IS the payload a phase-2
 * ranking backend would ingest. Do not add or drop fields here without
 * revisiting that contract. Pure.
 * @param {{score?: number, day?: number, composterId?: string|null,
 *   createdAt?: number|null}|null} farm
 * @param {string|null|undefined} nickname
 * @returns {{nickname: string, score: number, composterId: string|null,
 *   daysSurvived: number, createdAt: number|null}}
 */
export function rankingEntry(farm, nickname) {
  return {
    nickname: nickname ?? '',
    score: Math.round(farm?.score ?? 0),
    composterId: farm?.composterId ?? null,
    daysSurvived: farm?.day ?? 0,
    createdAt: farm?.createdAt ?? null,
  };
}

/**
 * The ranking rows to display for a save: the FROZEN runs plus the run that is
 * currently live.
 *
 * The stored `ranking` holds finished runs only; the live run is derived from
 * `save.farm` here, at render time. That keeps the ranking honest with no
 * per-tick bookkeeping and no farm-identity field in the save schema — the live
 * row simply *is* the current farm, and `freezeRun` is what makes it permanent.
 * Because the sim's score is monotonic (§2.10), the derived row is already a
 * high-water mark. Pure.
 * @param {object|null|undefined} save a v1 save payload
 * @param {number} [limit=RANKING_LIMIT]
 * @returns {Array<object>}
 */
export function displayRanking(save, limit = RANKING_LIMIT) {
  const frozen = Array.isArray(save?.ranking) ? save.ranking : [];
  const live = save?.farm ? [rankingEntry(save.farm, save.profile?.nickname)] : [];
  return topRanking([...frozen, ...live], limit);
}

/**
 * End the current run: freeze its live row into the persisted ranking and clear
 * the farm. The player's identity, wallet, and past rows survive — only the run
 * ends (spec §2.1: restarting freezes the finished farm's entry and starts a new
 * one). Pure and non-mutating; a no-op when no run is in progress.
 * @param {object|null} save a v1 save payload
 * @returns {object|null} a new save with the run frozen
 */
export function freezeRun(save) {
  if (!save || !save.farm) return save;
  return {
    ...save,
    ranking: [...(save.ranking ?? []), rankingEntry(save.farm, save.profile?.nickname)],
    farm: null,
  };
}

/**
 * Paint the ranking table body from a save's ranking list, toggling the pt-BR
 * empty-state message when there are no farms yet.
 * Takes the whole save (not just its ranking list) so the LIVE run is listed
 * alongside the frozen ones — the ranking updates as the current farm scores.
 * @param {HTMLElement} tbody   the <tbody> to fill
 * @param {HTMLElement} emptyEl the empty-state paragraph
 * @param {object|null} save    a v1 save payload
 */
function renderRanking(tbody, emptyEl, save) {
  const rows = displayRanking(save);
  tbody.replaceChildren();
  for (const entry of rows) {
    const tr = document.createElement('tr');
    for (const value of [entry.nickname, entry.score, entry.daysSurvived]) {
      const td = document.createElement('td');
      td.textContent = value == null ? '—' : String(value);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  const empty = rows.length === 0;
  if (emptyEl) emptyEl.hidden = !empty;
  const table = tbody.closest('table');
  if (table) table.hidden = empty;
}

/**
 * A fresh, farmless profile save (spec §2.11 schema). The wallet starts at the
 * economy's STARTING_WALLET (§2.2); the farm is created later at setup (T12).
 * @param {string} nickname
 * @returns {object} a v1 save payload
 */
function freshProfileSave(nickname) {
  return {
    v: 1,
    profile: { nickname, wallet: STARTING_WALLET },
    farm: null,
    ranking: [],
  };
}

// --- Screen state ------------------------------------------------------------
//
// Home is re-entered every time the router shows it (not just at page load), so
// the working save lives at module scope: the listeners below are wired ONCE and
// read `current` from here. Keeping the state in a closure instead would leave
// already-attached handlers bound to a stale save after a re-entry.

/** @type {object|null} the working save, refreshed on every screen entry. */
let current = null;
/**
 * Whether reroll/updates may be persisted. False for corrupt/future saves, which
 * we must not clobber (spec §2.11 — never silently discard).
 */
let canPersist = true;
/** The storage backend in play, captured so once-wired handlers persist through it. */
let activeBackend;
/** Whether the DOM listeners have been attached (they are wired exactly once). */
let wired = false;

/**
 * Load the save and repaint the screen: nickname, ranking, and Continue
 * visibility. Safe to call on every screen entry — it only reads and paints.
 * @param {import('../storage.js').StorageBackend} [backend]
 */
function refreshHome(backend) {
  const nicknameEl = document.getElementById('home-nickname');
  const continueBtn = document.getElementById('btn-continue');
  const noticeEl = document.getElementById('home-notice');
  const rankingBody = document.getElementById('ranking-body');
  const rankingEmpty = document.getElementById('ranking-empty');

  const result = load(backend);
  canPersist = true;

  if (result.status === LOAD_STATUS.OK) {
    current = result.save;
    if (!current.profile || typeof current.profile.nickname !== 'string') {
      // A save missing its profile (e.g. a partial migration) — mint one.
      current = { ...current, profile: { nickname: buildNickname(), wallet: STARTING_WALLET } };
      save(current, backend);
    }
  } else if (result.status === LOAD_STATUS.EMPTY) {
    current = freshProfileSave(buildNickname());
    save(current, backend); // persist the first-visit nickname
  } else {
    // CORRUPT or FUTURE — do not touch the stored bytes.
    canPersist = false;
    current = freshProfileSave(buildNickname());
    if (noticeEl) {
      noticeEl.textContent =
        result.status === LOAD_STATUS.FUTURE ? t('storage.futureBody') : t('storage.corruptBody');
      noticeEl.hidden = false;
    }
  }

  if (nicknameEl) nicknameEl.textContent = current.profile.nickname;
  if (rankingBody) renderRanking(rankingBody, rankingEmpty, current);

  // Continue only makes sense once a farm exists (created at setup, T12).
  const hasFarm = result.status === LOAD_STATUS.OK && current.farm != null;
  if (continueBtn) continueBtn.hidden = !hasFarm;
}

/**
 * Initialize/refresh the home screen against the persisted save. First visit
 * generates and persists a nickname; a returning visit restores it. A corrupt or
 * newer-than-us save is never overwritten — it surfaces a localized notice and
 * the screen runs on an in-memory (unpersisted) nickname instead.
 *
 * Called on EVERY entry to the home screen: the save is re-read and repainted
 * each time (so Continue reflects a farm created since page load), while the DOM
 * listeners are attached only on the first call.
 * @param {object} [deps]
 * @param {() => void} [deps.onPlay]     start a new farm (route to the shop)
 * @param {() => void} [deps.onContinue] resume the saved farm (route to game)
 * @param {import('../storage.js').StorageBackend} [deps.backend]
 *   storage backend (defaults to browser localStorage inside storage.js).
 */
export function initHome({ onPlay, onContinue, backend } = {}) {
  activeBackend = backend;
  refreshHome(backend);

  if (wired) return;
  wired = true;

  const nicknameEl = document.getElementById('home-nickname');
  const rerollBtn = document.getElementById('btn-reroll');
  const playBtn = document.getElementById('btn-play');
  const continueBtn = document.getElementById('btn-continue');

  if (rerollBtn) {
    rerollBtn.addEventListener('click', () => {
      current = { ...current, profile: { ...current.profile, nickname: buildNickname() } };
      if (nicknameEl) nicknameEl.textContent = current.profile.nickname;
      if (canPersist) save(current, activeBackend);
    });
  }
  if (playBtn && onPlay) playBtn.addEventListener('click', () => onPlay());
  if (continueBtn && onContinue) continueBtn.addEventListener('click', () => onContinue());
}
