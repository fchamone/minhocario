import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { ptBR } from '../js/i18n/pt-BR.js';
import { en } from '../js/i18n/en.js';
import { es } from '../js/i18n/es.js';

/**
 * The SEO metadata, as guards.
 *
 * This page states the same few sentences in five places — <title>, the meta
 * description, two OpenGraph tags and the JSON-LD node — and then states them a
 * SIXTH time in js/i18n/pt-BR.js, because applyStrings() rewrites the first two
 * per locale and a crawler that runs no JS has to find them in the served bytes
 * anyway. That duplication is deliberate and it is unavoidable, but it is
 * exactly the shape this project has been bitten by before (T25's hand-copied
 * THROUGHPUT_CAP_PER_LITER): a constant transcribed by hand goes stale, and
 * nothing notices, because nothing re-reads it.
 *
 * Nothing here is visible while developing, either. A description that has
 * drifted from the catalog looks perfect in the browser — the JS copy wins on
 * screen — and is wrong only in the search result, months later, where no one is
 * looking. So the transcription is checked rather than trusted.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../index.html');

/** The canonical origin, stated once here and asserted everywhere it appears. */
const ORIGIN = 'https://minhocario.fchamone.com/';
/** The root domain the credit link and the JSON-LD author both point at. */
const ROOT_DOMAIN = 'https://fchamone.com/';

/** @param {RegExp} re @param {string} what @returns {string} the first capture */
function capture(re, what) {
  const m = html.match(re);
  assert.ok(m, `index.html carries no ${what} — the regex found nothing to check`);
  return m[1];
}

const metaContent = (name) =>
  capture(new RegExp(`<meta name="${name}" content="([^"]+)"`), `meta[name=${name}]`);
const ogContent = (property) =>
  capture(new RegExp(`<meta property="${property}" content="([^"]+)"`), property);

/** The JSON-LD block, parsed. @returns {object} */
function jsonLd() {
  const raw = capture(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    'JSON-LD block',
  );
  try {
    return JSON.parse(raw);
  } catch (err) {
    assert.fail(`the JSON-LD block is not valid JSON — every consumer skips it silently: ${err}`);
  }
}

// --- The transcription ------------------------------------------------------

test('the static title and description match the pt-BR catalog exactly', () => {
  // The two applyStrings() overwrites at runtime. If these drift, a crawler and
  // a player are told two different things about the same page, and the version
  // a human can see is the one that is right.
  assert.equal(
    capture(/<title>([^<]+)<\/title>/, '<title>'),
    ptBR.meta.title,
    'index.html\'s <title> has drifted from ptBR.meta.title — js/main.js overwrites it ' +
      'with the catalog value, so the static one is what a crawler gets and nothing else reads',
  );
  assert.equal(
    metaContent('description'),
    ptBR.meta.description,
    'index.html\'s meta description has drifted from ptBR.meta.description',
  );
});

test('every restatement of the description says the same thing', () => {
  // OpenGraph and JSON-LD are NOT rewritten by applyStrings() — no scraper waits
  // for a module graph — so these are the copies that can rot unnoticed.
  const description = ptBR.meta.description;
  assert.equal(ogContent('og:description'), description, 'og:description has drifted');
  assert.equal(jsonLd().description, description, 'the JSON-LD description has drifted');
  assert.equal(ogContent('og:title'), ptBR.meta.title, 'og:title has drifted');
});

test('the description stays inside what a search result will show', () => {
  // Google truncates around 160 characters and a link preview around the same.
  // Not a hard rule anywhere, which is why it is written down here: past this,
  // the last clause of the sentence is decoration.
  const { length } = ptBR.meta.description;
  assert.ok(
    length >= 70 && length <= 160,
    `the pt-BR description is ${length} characters — aim for 70-160, or the result ` +
      'is either thin or cut off mid-sentence',
  );
  assert.ok(
    ptBR.meta.title.length <= 60,
    `the pt-BR title is ${ptBR.meta.title.length} characters — past ~60 it is truncated`,
  );
});

test('every locale carries its OWN title and description', () => {
  // Parity (tests/i18n.test.js) proves the keys exist in all three catalogs. It
  // cannot prove they were translated rather than pasted — and `appTitle` being
  // deliberately identical in all three is the precedent that makes a pasted
  // description look intentional. A search engine indexing the English render
  // with a Portuguese description is a real failure and an invisible one.
  for (const [tag, catalog] of [['en', en], ['es', es]]) {
    assert.notEqual(
      catalog.meta.description,
      ptBR.meta.description,
      `${tag}'s meta.description is the pt-BR string verbatim — it was never translated`,
    );
    assert.notEqual(
      catalog.meta.title,
      ptBR.meta.title,
      `${tag}'s meta.title is the pt-BR string verbatim — it was never translated`,
    );
    assert.ok(
      catalog.meta.title.includes('Minhocário'),
      `${tag}'s meta.title dropped the wordmark — the brand belongs in every locale's title`,
    );
  }
});

/**
 * Pixel dimensions of a PNG or JPEG, read from the file's own header rather
 * than trusted from the markup — the point is to catch the markup lying.
 *
 * PNG is trivial: the IHDR chunk is always first, so width and height are
 * big-endian uint32s at fixed offsets 16 and 20. JPEG has no fixed layout and
 * must be walked segment by segment to the start-of-frame marker, which is the
 * only one carrying the dimensions.
 *
 * @param {Buffer} buf
 * @returns {{width: number, height: number}|null} null if it is neither format.
 */
function imageSize(buf) {
  if (buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.readUInt16BE(0) !== 0xffd8) return null; // not a JPEG SOI

  let i = 2;
  // `<=` and -9, not `<`: the widest read below is buf[i + 8], so i may legally
  // reach length - 9. Getting this wrong is invisible on any real JPEG, whose
  // scan data trails far past the frame header — it only bites a file that ENDS
  // at one, which is exactly what the synthetic fixture below is.
  while (i <= buf.length - 9) {
    if (buf[i] !== 0xff) {
      i += 1; // fill byte or padding — resync on the next marker
      continue;
    }
    const marker = buf[i + 1];
    // SOF0-SOF15 carry the frame dimensions. C4 (Huffman tables), C8 (JPEG
    // extensions) and CC (arithmetic coding conditioning) share the range and
    // are NOT frame headers — reading dimensions out of one gives nonsense.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2); // skip this segment by its own length
  }
  return null;
}

test('the image-header reader agrees with itself across both formats', () => {
  // The JPEG walk is fiddly enough to be worth proving on a known input, and the
  // guard above would pass just as happily if this returned garbage for both the
  // file and... no, it compares against the markup. But a reader that returned
  // null would fail loudly, while one that mis-parsed SOF could return a
  // plausible-looking wrong number. Minimal synthetic headers, hand-built.
  const png = Buffer.alloc(24);
  png.write('\x89PNG', 0, 'binary');
  png.writeUInt32BE(1200, 16);
  png.writeUInt32BE(630, 20);
  assert.deepEqual(imageSize(png), { width: 1200, height: 630 });

  // SOI, then a DHT segment (0xC4 — in the SOF range but not a frame header,
  // the exact byte a naive reader trips on), then the real SOF0.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0]),
  ]);
  assert.deepEqual(imageSize(jpeg), { width: 1200, height: 630 });

  assert.equal(imageSize(Buffer.from('not an image at all')), null);
});

// --- The origin -------------------------------------------------------------

test('canonical, og:url and the JSON-LD url all name the one origin', () => {
  // The same files are served from fchamone.github.io/minhocario/ as well. These
  // absolute URLs are what make that copy point home instead of competing with
  // it — a relative canonical would make each copy declare itself canonical.
  assert.equal(capture(/<link rel="canonical" href="([^"]+)"/, 'canonical link'), ORIGIN);
  assert.equal(ogContent('og:url'), ORIGIN);
  assert.equal(jsonLd().url, ORIGIN);
});

test('the sitemap and robots.txt agree with the canonical origin', () => {
  // Three files naming the same host, none of which imports the others. The
  // failure is quiet in a specific way: a sitemap listing a URL that does not
  // match the canonical is simply ignored, and Search Console reports success.
  const sitemap = read('../sitemap.xml');
  const robots = read('../robots.txt');

  const loc = sitemap.match(/<loc>([^<]+)<\/loc>/);
  assert.ok(loc, 'sitemap.xml carries no <loc>');
  assert.equal(loc[1], ORIGIN, 'the sitemap lists a URL that is not the canonical one');

  const sitemapLine = robots.match(/^Sitemap:\s*(\S+)$/m);
  assert.ok(sitemapLine, 'robots.txt does not point at the sitemap');
  assert.equal(sitemapLine[1], `${ORIGIN}sitemap.xml`);

  assert.match(robots, /^User-agent:\s*\*$/m, 'robots.txt has no wildcard user-agent group');
  assert.match(robots, /^Allow:\s*\/$/m, 'robots.txt does not allow the site itself');
  assert.doesNotMatch(
    robots,
    /^Disallow:\s*\/$/m,
    'robots.txt disallows the whole site — this is the one-character typo that ' +
      'delists everything, and it looks almost exactly like the Disallow above it',
  );
});

test('the og:image resolves to a file that actually ships', () => {
  // Every other asset reference in index.html is relative, and
  // tests/release.test.js walks those. og:image cannot be relative — scrapers
  // require an absolute URL — and that test filters absolute URLs out, so this
  // one path is unguarded there by construction. Nothing on the page renders it
  // either: a broken og:image looks perfect in a browser and shows up only as a
  // blank card in someone else's WhatsApp.
  const url = ogContent('og:image');
  assert.ok(url.startsWith(ORIGIN), `og:image must be absolute and on the canonical origin: ${url}`);

  const rel = url.slice(ORIGIN.length);
  const file = new URL(`../${rel}`, import.meta.url);
  assert.ok(existsSync(file), `og:image points at ${rel}, which does not exist in the repo`);

  // Declared dimensions are a hint scrapers lay the card out against before the
  // image arrives; wrong ones reserve the wrong box and the preview jumps.
  const bytes = readFileSync(file);
  const size = imageSize(bytes);
  assert.ok(size, `${rel} is neither a PNG nor a JPEG`);
  assert.equal(size.width, Number(ogContent('og:image:width')), 'og:image:width is wrong');
  assert.equal(size.height, Number(ogContent('og:image:height')), 'og:image:height is wrong');

  // WhatsApp gives up on a large preview and renders NO image rather than a
  // compressed one — which, for a game shared in Brazil, is the platform that
  // decides whether the card exists at all. ~300 KB is its commonly-cited
  // ceiling. A screenshot of the 3D scene busts it as a PNG and comes in at
  // roughly a third of it as a JPEG, which is the whole reason for the format.
  assert.ok(
    bytes.length <= 300 * 1024,
    `${rel} is ${Math.round(bytes.length / 1024)} KB — over ~300 KB some scrapers drop ` +
      'the preview entirely. Re-encode as JPEG rather than raising this number',
  );
});

test('the credit link and the JSON-LD author point at the same root domain', () => {
  // Two halves of one claim: the visible link a reader follows, and the
  // machine-readable statement that the two domains are the same person. If they
  // disagree, the entity association is the half that silently stops working.
  assert.equal(jsonLd().author.url, ROOT_DOMAIN, 'the JSON-LD author.url has drifted');
  assert.equal(jsonLd().author.name, 'Fabiano Chamone');

  const links = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 2, `expected the credit link on home AND on the notice, found ${links.length}`);
  for (const href of links) {
    assert.equal(href, ROOT_DOMAIN, `unexpected outbound link: ${href}`);
  }
});

test('theme-color matches the surface the page actually paints', () => {
  // The one colour literal outside tokens.css. It has to be an attribute value,
  // and tests/css.test.js reads stylesheets only — so nothing there can see this
  // pairing, and retuning --surface-0 would leave the browser chrome painted the
  // old colour with no test and no visible seam on the developer's own machine.
  const tokens = read('../css/tokens.css');
  const surface0 = tokens.match(/--surface-0:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(surface0, 'tokens.css no longer defines --surface-0 as a hex literal');

  assert.equal(
    metaContent('theme-color').toLowerCase(),
    surface0[1].toLowerCase(),
    'index.html\'s theme-color has drifted from --surface-0 in css/tokens.css',
  );
});

test('applyStrings rewrites both document-level strings on a language switch', () => {
  // Asserted by source read: applyStrings() needs a DOM and cannot run here.
  // The static tags in <head> are pt-BR, so an English player keeps a Portuguese
  // description unless this function replaces both — and the tab title is the
  // half a person would notice, which is why the description is the half that
  // silently would not get fixed.
  const main = read('../js/main.js');
  const fn = main.slice(main.indexOf('function applyStrings()'));
  const body = fn.slice(0, fn.indexOf('\n}'));

  assert.match(body, /document\.title\s*=\s*t\('meta\.title'\)/, 'applyStrings no longer sets the title');
  assert.match(body, /t\('meta\.description'\)/, 'applyStrings no longer rewrites the meta description');
  assert.match(
    body,
    /meta\[name="description"\]/,
    'applyStrings no longer selects the description tag — it must match the one in index.html',
  );
});
