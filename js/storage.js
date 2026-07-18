// Versioned save/load for the single game slot. The persisted payload follows
// the spec §2.11 schema:
//
//   { v: 1, profile: { nickname, wallet }, farm: { ...FarmState }, ranking: [ ... ] }
//
// Two hard rules from the spec drive this module:
//   1. Version the format and MIGRATE old saves on load — never silently discard
//      a player's save (a corrupt or newer-than-us payload is surfaced, not
//      overwritten).
//   2. The whole payload is plain JSON — the farm carries its serialized RNG
//      state (js/sim/rng.js), so a round-trip resumes the exact same sequence.
//
// The storage BACKEND is injectable: the browser passes `localStorage`; tests
// (and any non-browser caller) pass an in-memory stub via `createMemoryBackend`.
// This module is therefore Node-importable and has no hard dependency on any
// browser global.
//
// The language preference lives in its OWN localStorage key (minhocario.lang,
// see js/strings.js / spec C-0002) and is deliberately NOT part of this save.

/** localStorage key holding the single JSON-encoded save slot. */
export const SAVE_KEY = 'minhocario.save';

/** Current save-format version. Bump + register a migration to evolve it. */
export const CURRENT_VERSION = 1;

/**
 * Result status returned by {@link load}. The UI (T10) branches on these and
 * prompts (never auto-discards) on CORRUPT / FUTURE.
 * @readonly
 * @enum {string}
 */
export const LOAD_STATUS = Object.freeze({
  OK: 'ok', // parsed + migrated to the current version
  EMPTY: 'empty', // no save present in this slot
  CORRUPT: 'corrupt', // stored bytes are not valid JSON / not an object
  FUTURE: 'future', // written by a newer client (v > CURRENT_VERSION)
});

/**
 * A minimal Web-Storage-shaped backend (a subset of the `Storage` interface).
 * @typedef {object} StorageBackend
 * @property {(key: string) => (string|null)} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

/**
 * Migration registry: `MIGRATIONS[n]` upgrades a version-`n` payload to the
 * shape of version `n+1`. {@link migrate} applies them in sequence, so evolving
 * the format is one entry per step with no gaps.
 * @type {Record<number, (payload: any) => object>}
 */
const MIGRATIONS = {
  // v0 → v1. The pre-versioned prototype stored the player fields FLAT at the
  // top level ({ nickname, wallet, farm }) with no ranking list. v1 nests the
  // player fields under `profile` and introduces `ranking`. Reshape losslessly;
  // this also exercises the migration mechanism end-to-end (proved in tests).
  0: (v0) => ({
    profile: {
      nickname: v0.nickname ?? null,
      wallet: typeof v0.wallet === 'number' ? v0.wallet : 0,
    },
    farm: v0.farm ?? null,
    ranking: Array.isArray(v0.ranking) ? v0.ranking : [],
  }),
};

/**
 * The browser's `localStorage` when available, else `null` (e.g. under Node).
 * Callers that omit an explicit backend get this; a `null` backend degrades to
 * a no-op that reports an empty slot rather than throwing.
 * @returns {StorageBackend|null}
 */
function defaultBackend() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

/**
 * Build an in-memory backend implementing the {@link StorageBackend} contract.
 * Used by tests and any non-browser caller.
 * @param {Record<string,string>} [initial] seed key→value entries.
 * @returns {StorageBackend}
 */
export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/**
 * The version of a parsed payload. A payload with no numeric `v` is the
 * pre-versioned prototype and counts as version 0.
 * @param {any} payload
 * @returns {number}
 */
function versionOf(payload) {
  return payload && typeof payload.v === 'number' ? payload.v : 0;
}

/**
 * Bring a parsed payload up to {@link CURRENT_VERSION} by applying registered
 * migrations in order, stamping each intermediate `v`. A current-version
 * payload is returned unchanged. Throws if an intermediate migration is missing
 * (a registry gap — a programming error, not a bad save).
 * @param {any} payload a parsed save object.
 * @returns {object} the payload at the current version.
 */
export function migrate(payload) {
  let current = payload;
  let version = versionOf(current);
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new Error(`No migration registered from save version ${version}`);
    }
    version += 1;
    current = { ...step(current), v: version };
  }
  return current;
}

/**
 * Read the save slot. NEVER discards or rewrites: a corrupt or future-version
 * save is reported (LOAD_STATUS) with the offending value handed back so the UI
 * can prompt. An older-version save is migrated in memory and returned as OK
 * (the upgrade is persisted later by a normal autosave, not here — load stays
 * side-effect-free and testable).
 * @param {StorageBackend|null} [backend] defaults to browser localStorage.
 * @returns {{status: string, save?: object, raw?: string}}
 */
export function load(backend = defaultBackend()) {
  if (!backend) return { status: LOAD_STATUS.EMPTY };

  const raw = backend.getItem(SAVE_KEY);
  if (raw == null) return { status: LOAD_STATUS.EMPTY };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: LOAD_STATUS.CORRUPT, raw };
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: LOAD_STATUS.CORRUPT, raw };
  }

  if (versionOf(parsed) > CURRENT_VERSION) {
    // Newer client wrote this; we can't understand it. Surface, don't touch.
    return { status: LOAD_STATUS.FUTURE, save: parsed, raw };
  }

  try {
    return { status: LOAD_STATUS.OK, save: migrate(parsed) };
  } catch (err) {
    return { status: LOAD_STATUS.CORRUPT, raw, error: String(err) };
  }
}

/**
 * Write the save slot. Stamps the payload with {@link CURRENT_VERSION}.
 *
 * To honor "never silently discard a player's save", `save` refuses (ok:false)
 * to overwrite an existing slot that is a FUTURE-version or CORRUPT save unless
 * `force` is set — the caller (T10) prompts the player first. A write failure
 * (quota / disabled storage) is reported rather than thrown.
 * @param {object} payload the save object (profile/farm/ranking).
 * @param {StorageBackend|null} [backend] defaults to browser localStorage.
 * @param {{force?: boolean}} [opts]
 * @returns {{ok: boolean, reason?: string}}
 */
export function save(payload, backend = defaultBackend(), opts = {}) {
  if (!backend) return { ok: false, reason: 'no-backend' };
  const { force = false } = opts;

  if (!force) {
    const existing = backend.getItem(SAVE_KEY);
    if (existing != null) {
      let parsed;
      try {
        parsed = JSON.parse(existing);
      } catch {
        return { ok: false, reason: 'corrupt' }; // don't clobber a corrupt save
      }
      if (versionOf(parsed) > CURRENT_VERSION) {
        return { ok: false, reason: 'future' }; // don't clobber a newer save
      }
    }
  }

  const stamped = { ...payload, v: CURRENT_VERSION };
  try {
    backend.setItem(SAVE_KEY, JSON.stringify(stamped));
  } catch (err) {
    return { ok: false, reason: 'write-failed', error: String(err) };
  }
  return { ok: true };
}
