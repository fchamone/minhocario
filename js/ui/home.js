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
 * Paint the ranking table body from a save's ranking list, toggling the pt-BR
 * empty-state message when there are no farms yet.
 * @param {HTMLElement} tbody   the <tbody> to fill
 * @param {HTMLElement} emptyEl the empty-state paragraph
 * @param {Array<object>} ranking
 */
function renderRanking(tbody, emptyEl, ranking) {
  const rows = topRanking(ranking);
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
  if (rankingBody) renderRanking(rankingBody, rankingEmpty, current.ranking);

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
