'use strict';
// The RO/EN split is a build step, and a build step that silently half-works
// is worse than none: a page that still carries both languages looks correct
// in a browser (the CSS that used to hide one language is gone, so you would
// SEE the duplication) but a page with a broken hreflang set, a canonical
// pointing at the wrong language, or a language link that leads to itself all
// look completely fine to a human and are wrong only to a crawler.
//
// So these assert the things you cannot see: reciprocity, self-consistency,
// and the two textual assumptions the stripper in tools/build-site.js relies
// on to be safe.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'site-src');
const SITE = path.join(__dirname, '..', 'website');

const PAGES = [
  { file: 'index.html', lang: 'ro', url: 'https://adaptivetech.ro/', pair: 'https://adaptivetech.ro/en/' },
  { file: 'en/index.html', lang: 'en', url: 'https://adaptivetech.ro/en/', pair: 'https://adaptivetech.ro/' },
  {
    file: 'politica-de-confidentialitate.html', lang: 'ro',
    url: 'https://adaptivetech.ro/politica-de-confidentialitate.html',
    pair: 'https://adaptivetech.ro/en/privacy-policy.html',
  },
  {
    file: 'en/privacy-policy.html', lang: 'en',
    url: 'https://adaptivetech.ro/en/privacy-policy.html',
    pair: 'https://adaptivetech.ro/politica-de-confidentialitate.html',
  },
  { file: 'studii-de-caz/index.html', lang: 'ro', url: 'https://adaptivetech.ro/studii-de-caz/', pair: 'https://adaptivetech.ro/en/case-studies/' },
  { file: 'en/case-studies/index.html', lang: 'en', url: 'https://adaptivetech.ro/en/case-studies/', pair: 'https://adaptivetech.ro/studii-de-caz/' },
  { file: 'studii-de-caz/partner-corporation/index.html', lang: 'ro', url: 'https://adaptivetech.ro/studii-de-caz/partner-corporation/', pair: 'https://adaptivetech.ro/en/case-studies/partner-corporation/' },
  { file: 'en/case-studies/partner-corporation/index.html', lang: 'en', url: 'https://adaptivetech.ro/en/case-studies/partner-corporation/', pair: 'https://adaptivetech.ro/studii-de-caz/partner-corporation/' },
  { file: 'studii-de-caz/zrsio-health/index.html', lang: 'ro', url: 'https://adaptivetech.ro/studii-de-caz/zrsio-health/', pair: 'https://adaptivetech.ro/en/case-studies/zrsio-health/' },
  { file: 'en/case-studies/zrsio-health/index.html', lang: 'en', url: 'https://adaptivetech.ro/en/case-studies/zrsio-health/', pair: 'https://adaptivetech.ro/studii-de-caz/zrsio-health/' },
];

const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');
const langToggle = (s) => (s.match(/<div class="lang-toggle"[\s\S]*?<\/div>/) || [''])[0];

for (const page of PAGES) {
  const other = page.lang === 'ro' ? 'en' : 'ro';

  test(page.file + ' carries only ' + page.lang, () => {
    const s = read(page.file);
    assert.ok(!s.includes('data-' + other),
      page.file + ' still contains data-' + other + ' -- both languages would be indexed');
    assert.match(s, new RegExp('<html lang="' + page.lang + '">'));
  });

  test(page.file + ' has no runtime language machinery left', () => {
    const s = read(page.file);
    // Each of these existing means the page is still trying to switch language
    // client-side, which is exactly what the split replaced.
    for (const ghost of ['setLang', 'adaptive-lang', '<!--LANG-TOGGLE-->']) {
      assert.ok(!s.includes(ghost), page.file + ' still contains ' + ghost);
    }
  });

  test(page.file + ' declares a reciprocal hreflang set', () => {
    const s = read(page.file);
    const alts = [...s.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)" \/>/g)]
      .map((m) => [m[1], m[2]]);
    const byLang = Object.fromEntries(alts);

    assert.strictEqual(alts.length, 3, 'expected ro, en and x-default');
    assert.strictEqual(byLang[page.lang], page.url, 'must point at itself for its own language');
    assert.strictEqual(byLang[other], page.pair, 'must point at its translation');
    // x-default sends unmatched locales to Romanian: a Romanian company
    // selling in Romania, so that is the right default landing.
    assert.strictEqual(byLang['x-default'], PAGES.find((p) => p.lang === 'ro' &&
      (p.pair === page.url || p.url === page.url)).url);

    const canonical = (s.match(/<link rel="canonical" href="([^"]+)" \/>/) || [])[1];
    assert.strictEqual(canonical, page.url, 'canonical must be self-referencing');
  });

  test(page.file + ' language switch points at the other language', () => {
    // The regression this guards: the toggle used to be injected BEFORE the
    // EN link rewrites, so the rewrite rules captured the toggle's own RO
    // link and the EN privacy page offered "RO" as a link to itself. Nothing
    // about that is visible on the page.
    const toggle = langToggle(read(page.file));
    assert.ok(toggle, 'no language toggle found');
    const hrefs = Object.fromEntries(
      [...toggle.matchAll(/id="lang-(ro|en)"[^>]*href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    assert.strictEqual(hrefs[page.lang], new URL(page.url).pathname, 'self link');
    assert.strictEqual(hrefs[other], new URL(page.pair).pathname, 'link to the translation');
    assert.notStrictEqual(hrefs.ro, hrefs.en, 'the two language links must differ');
  });

  test(page.file + ' is stamped as generated', () => {
    assert.match(read(page.file), /GENERATED by tools\/build-site\.js/);
  });
}

test('EN pages do not link back into the RO tree', () => {
  for (const page of PAGES.filter((p) => p.lang === 'en')) {
    const s = read(page.file);
    // The language toggle is excluded: linking to the RO page is its purpose.
    const body = s.replace(/<div class="lang-toggle"[\s\S]*?<\/div>/, '');
    // Anchors only. <link>/<img> pointing at /favicon.ico or /assets/... is a
    // shared site-wide asset, not a Romanian page -- this is about where the
    // reader can NAVIGATE to and land in the wrong language.
    for (const a of body.match(/<a\b[^>]*href="\/[^"]*"/g) || []) {
      const href = a.match(/href="([^"]*)"/)[1];
      // The demo is one bilingual app, not a translated page: it keeps its
      // single URL and is handed the language in the query string.
      if (href === '/demo/?lang=en') continue;
      assert.ok(href.startsWith('/en/'),
        page.file + ' links out of the EN tree: ' + href);
    }
  }
});

test('no built page uses a relative asset path', () => {
  // A relative href resolves against the DIRECTORY it is served from, so the
  // same markup that works at / breaks at /en/. The privacy page shipped an
  // apple-touch-icon as 'assets/png/...', which became /en/assets/png/... and
  // 404'd on the English build only. Nothing about that is visible on the page.
  for (const page of PAGES) {
    const s = read(page.file);
    const refs = s.match(/(?:href|src)="(?!https?:|\/|#|data:|mailto:)[^"]+"/g) || [];
    assert.deepStrictEqual(refs, [], page.file + ' has relative asset paths');
  }
});

test('sitemap lists exactly the built pages', () => {
  const xml = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(locs, PAGES.map((p) => p.url).sort());
  // The demo is noindex; listing it here would be a contradiction Search
  // Console reports as an error. Checked against the URLs, not the raw file --
  // the generated comment says the word /demo/ to explain its own absence.
  const urls = [...xml.matchAll(/(?:<loc>|href=")([^<"]+)/g)].map((m) => m[1]);
  assert.ok(!urls.some((u) => u.includes('/demo/')), 'a noindex URL must not be in the sitemap');
});

// ── The two assumptions tools/build-site.js relies on to strip a language
//    safely. Both hold today; either breaking would corrupt output silently,
//    so they are asserted against the MASTERS rather than the build.
for (const master of ['index.html', 'politica-de-confidentialitate.html']) {
  test(master + ': no language span contains a nested <span>', () => {
    // The stripper matches non-greedily to the first </span>. A nested span
    // would end the match early and leave orphan markup behind.
    const s = fs.readFileSync(path.join(SRC, master), 'utf8');
    const re = /<span data-(?:ro|en)\b[^>]*>([\s\S]*?)<\/span>/g;
    let m, nested = 0;
    while ((m = re.exec(s))) if (m[1].includes('<span')) nested++;
    assert.strictEqual(nested, 0);
  });

  test(master + ': no language span sits flush against text', () => {
    // The stripper deliberately does not consume surrounding whitespace, so a
    // span touching a letter on either side would weld two words together
    // when the other language is removed.
    const s = fs.readFileSync(path.join(SRC, master), 'utf8');
    const re = /<span data-(?:ro|en)\b[^>]*>[\s\S]*?<\/span>/g;
    let m; const flush = [];
    while ((m = re.exec(s))) {
      const before = s[m.index - 1] || '';
      const after = s[m.index + m[0].length] || '';
      if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) {
        flush.push(s.slice(m.index - 30, m.index + m[0].length + 30));
      }
    }
    assert.deepStrictEqual(flush, []);
  });
}

test('cross-page anchor links point at sections that exist', () => {
  // The privacy page linked to /#cum-lucram and /#despre for months. Neither
  // id exists on the homepage -- the sections are #proces and #de-ce-noi -- so
  // both silently dumped the visitor at the top of the page. A dead anchor
  // does not 404 and nothing in a link check catches it.
  const homes = { '': read('index.html'), '/en': read('en/index.html') };
  for (const page of PAGES) {
    const html = read(page.file);
    const prefix = page.lang === 'en' ? '/en' : '';
    for (const m of html.matchAll(/href="(\/(?:en\/)?)#([a-z-]+)"/g)) {
      const home = homes[m[1] === '/' ? '' : '/en'];
      assert.ok(home.includes('id="' + m[2] + '"'),
        page.file + ' links to #' + m[2] + ', which no homepage section defines');
    }
    // Same-page anchors on the homepage itself.
    if (page.file.endsWith('index.html')) {
      for (const m of html.matchAll(/href="#([a-z-]+)"/g)) {
        assert.ok(html.includes('id="' + m[1] + '"'),
          page.file + ' links to #' + m[1] + ', which it does not define');
      }
    }
    void prefix;
  }
});

test('partial comments do not terminate themselves', () => {
  // HTML comments do not nest. Both partials described their own injection
  // marker inside a comment, and the marker's closing bracket ended the
  // comment early -- so the rest of the sentence rendered as visible text
  // across the top of every page on the live site.
  for (const f of ['header.html', 'footer.html']) {
    const src = fs.readFileSync(path.join(SRC, 'partials', f), 'utf8');
    for (const c of src.match(/<!--[\s\S]*?-->/g) || []) {
      assert.ok(!c.slice(4, -3).includes('-->'),
        f + ' has a comment containing "-->", which closes it early');
    }
  }
});

test('no built page leaks partial prose as page content', () => {
  // The symptom of the above, checked from the other end: text that only
  // exists inside a partial's comment must never appear outside one.
  for (const page of PAGES) {
    const html = read(page.file);
    const visible = html.replace(/<!--[\s\S]*?-->/g, '');
    for (const giveaway of ['tools/build-site.js at the', 'Edit here, not in a page',
      'HTML comments do not nest']) {
      assert.ok(!visible.includes(giveaway),
        page.file + ' renders partial commentary as content: ' + giveaway);
    }
  }
});

test('no page overrides a shared component with an element selector', () => {
  // The class-based cleanup missed a bare `footer { }` on the privacy page,
  // which still applied to <footer class="site-bar"> and gave it 2.5rem of
  // extra padding and the wrong navy -- a footer visibly taller and a
  // different colour from the homepage's, out of one forgotten rule.
  for (const page of PAGES) {
    const html = read(page.file);
    const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    for (const el of ['footer', 'nav', 'header']) {
      // String.raw, because this pattern needs real backslashes: written as a
      // plain quoted string, "\s" collapses to the letter s and the guard
      // silently matches nothing -- which is how it passed the first time.
      assert.ok(!new RegExp(String.raw`(^|[};\s])${el}\s*\{`).test(inline),
        page.file + ' styles the bare <' + el + '> element, which overrides the shared component');
    }
  }
});

test('the demo carries the shared header and footer, in both languages', () => {
  // The demo was the one page not built from a master: it kept a private
  // top bar and a pasted copy of the footer, and the case-study dropdown
  // reached every page except it. It is built now, with both languages
  // left in place because it switches at runtime.
  const s = read('demo/index.html');
  assert.ok(s.includes('id="navCasesMenu"'), 'the shared header is missing');
  assert.strictEqual((s.match(/class="site-bar"/g) || []).length, 1, 'expected exactly one footer');
  assert.ok(!s.includes('demo__bar'), 'the private top bar is back');
  assert.ok(s.includes('data-ro') && s.includes('data-en'), 'both languages must be present');
  assert.match(s, /<button type="button" id="lang-ro"/, 'the toggle must be buttons, not links to other URLs');
  assert.ok(!s.includes('hreflang='), 'a single-URL page declares no hreflang');
  assert.match(s, /href="\/demo\/demo\.css\?v=[a-f0-9]{8}"/, 'demo.css is not versioned');
  const refs = s.match(/(?:href|src)="(?!https?:|\/|#|data:|mailto:)[^"]+"/g) || [];
  assert.deepStrictEqual(refs, [], 'the demo has relative asset paths');
});
