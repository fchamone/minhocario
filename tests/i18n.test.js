import test from 'node:test';
import assert from 'node:assert/strict';
import {
  t,
  setLang,
  getLang,
  resolveLang,
  getCatalog,
  SUPPORTED_LANGS,
  LANG_NAMES,
  CATALOGS,
} from '../js/strings.js';

/**
 * Collect every leaf key path (dotted) of a nested plain object.
 * @param {object} obj
 * @param {string} [prefix]
 * @returns {string[]}
 */
function leafPaths(obj, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...leafPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

// --- Catalog parity -------------------------------------------------------

test('SUPPORTED_LANGS lists the three canonical tags', () => {
  assert.deepEqual(SUPPORTED_LANGS, ['pt-BR', 'en', 'es']);
});

test('LANG_NAMES exposes native display names', () => {
  assert.equal(LANG_NAMES['pt-BR'], 'Português');
  assert.equal(LANG_NAMES.en, 'English');
  assert.equal(LANG_NAMES.es, 'Español');
});

test('the three catalogs have identical key sets', () => {
  const reference = leafPaths(CATALOGS['pt-BR']);
  for (const tag of ['en', 'es']) {
    const other = leafPaths(CATALOGS[tag]);
    const missing = reference.filter((k) => !other.includes(k));
    const extra = other.filter((k) => !reference.includes(k));
    assert.deepEqual(
      missing,
      [],
      `${tag} is missing keys: ${missing.join(', ')}`,
    );
    assert.deepEqual(extra, [], `${tag} has extra keys: ${extra.join(', ')}`);
  }
});

test('no catalog has empty string values', () => {
  for (const tag of SUPPORTED_LANGS) {
    for (const path of leafPaths(CATALOGS[tag])) {
      const value = path
        .split('.')
        .reduce((node, key) => node[key], CATALOGS[tag]);
      assert.equal(
        typeof value,
        'string',
        `${tag}.${path} should be a string`,
      );
      assert.notEqual(value.trim(), '', `${tag}.${path} is empty`);
    }
  }
});

test('appTitle is identical across all locales', () => {
  assert.equal(CATALOGS['pt-BR'].appTitle, 'Minhocário');
  assert.equal(CATALOGS.en.appTitle, 'Minhocário');
  assert.equal(CATALOGS.es.appTitle, 'Minhocário');
});

// --- resolveLang matrix ---------------------------------------------------

test('resolveLang: a supported stored tag wins', () => {
  assert.equal(resolveLang('en', ['pt-BR']), 'en');
  assert.equal(resolveLang('es', ['en-US']), 'es');
  assert.equal(resolveLang('pt-BR', ['en']), 'pt-BR');
});

test('resolveLang: an unsupported stored tag falls through to navigator', () => {
  assert.equal(resolveLang('fr', ['en-US']), 'en');
  assert.equal(resolveLang('de', ['es-ES']), 'es');
  assert.equal(resolveLang(null, ['pt-PT']), 'pt-BR');
});

test('resolveLang: primary-subtag mapping from navigator', () => {
  assert.equal(resolveLang(null, ['pt']), 'pt-BR');
  assert.equal(resolveLang(null, ['pt-PT']), 'pt-BR');
  assert.equal(resolveLang(null, ['pt-BR']), 'pt-BR');
  assert.equal(resolveLang(null, ['en-US']), 'en');
  assert.equal(resolveLang(null, ['en']), 'en');
  assert.equal(resolveLang(null, ['es-419']), 'es');
  assert.equal(resolveLang(null, ['es-ES']), 'es');
});

test('resolveLang: first matching navigator language wins', () => {
  assert.equal(resolveLang(null, ['fr', 'en-US', 'es']), 'en');
  assert.equal(resolveLang(null, ['de-DE', 'es-ES', 'en']), 'es');
});

test('resolveLang: unknown/empty navigator + no stored => pt-BR', () => {
  assert.equal(resolveLang(null, ['fr']), 'pt-BR');
  assert.equal(resolveLang(null, ['de', 'ja']), 'pt-BR');
  assert.equal(resolveLang(null, []), 'pt-BR');
  assert.equal(resolveLang(undefined, undefined), 'pt-BR');
  assert.equal(resolveLang('', ''), 'pt-BR');
});

// --- t() / setLang / getLang ----------------------------------------------

test('default active locale renders pt-BR', () => {
  setLang('pt-BR');
  assert.equal(getLang(), 'pt-BR');
  assert.equal(t('home.play'), 'Jogar');
  assert.equal(t('appTitle'), 'Minhocário');
});

test('setLang switches the active locale', () => {
  setLang('en');
  assert.equal(getLang(), 'en');
  assert.equal(t('home.play'), 'Play');
  setLang('es');
  assert.equal(getLang(), 'es');
  assert.equal(t('home.play'), 'Jugar');
  setLang('pt-BR');
});

test('setLang ignores unsupported tags', () => {
  setLang('pt-BR');
  setLang('fr');
  assert.equal(getLang(), 'pt-BR');
  setLang('xx-YY');
  assert.equal(getLang(), 'pt-BR');
});

test('getCatalog returns the catalog for a tag', () => {
  assert.equal(getCatalog('en'), CATALOGS.en);
  assert.equal(getCatalog('es'), CATALOGS.es);
});

test('t() falls back to pt-BR and warns for a missing key', () => {
  // Synthetically remove a key from the en catalog.
  const original = CATALOGS.en.home.play;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    delete CATALOGS.en.home.play;
    setLang('en');
    assert.equal(t('home.play'), CATALOGS['pt-BR'].home.play);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /home\.play/);
  } finally {
    CATALOGS.en.home.play = original;
    console.warn = realWarn;
    setLang('pt-BR');
  }
});

test('t() returns the key path when missing in every catalog', () => {
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    setLang('pt-BR');
    assert.equal(t('does.not.exist'), 'does.not.exist');
  } finally {
    console.warn = realWarn;
  }
});
