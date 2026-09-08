// Builds the public site from the bilingual masters in site-src/.
//
// WHY THIS EXISTS
//
// The site used to serve both languages from one URL, switching them with CSS
// (`html[lang="en"] [data-ro] { display: none }`). A person saw one language;
// a crawler saw both, interleaved, and indexed the result -- the homepage read
// as "Lucrați mai inteligent.Nu mai mult. Work smarter.Not more." Hidden text
// is still text to a parser, and there was no way to rank for either language
// cleanly, no way to point a Romanian searcher at Romanian copy, and nothing
// for hreflang to point at.
//
// So each language now gets a real URL and a document containing only that
// language:
//
//     /                                     RO homepage
//     /en/                                  EN homepage
//     /politica-de-confidentialitate.html   RO privacy policy
//     /en/privacy-policy.html               EN privacy policy
//
// The masters in site-src/ stay bilingual and are the ONLY files to edit.
// Everything under website/ that this script names is generated -- see the
// banner it stamps into each one. Note that site-src/ sits outside website/
// deliberately: the Dockerfile copies website/ wholesale, so a master left in
// there would be publicly fetchable and would compete with the real pages as
// duplicate bilingual content.
//
// Run after editing a master:  node tools/build-site.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'site-src');
const OUT = path.join(__dirname, '..', 'website');
const ORIGIN = 'https://adaptivetech.ro';

// --check builds everything in memory and compares it to what is on disk,
// writing nothing and failing if they differ. That is the guard against the
// likeliest mistake here: editing a master, forgetting to rebuild, and
// deploying HTML that no longer matches its source.
const CHECK = process.argv.includes('--check');
const stale = [];

function emit(dest, content) {
  if (CHECK) {
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (current !== content) stale.push(path.relative(OUT, dest));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

// ── The English side of each master. Every key is matched EXACTLY and must
//    appear exactly once, so a reworded master fails the build loudly instead
//    of quietly shipping a half-translated page.
const EN_INDEX = {
  '<title>Adaptive Technologies — Automatizare AI pentru IMM-uri din România</title>':
    '<title>Adaptive Technologies — AI Automation for Romanian SMEs</title>',

  '<meta name="description" content="Automatizăm sarcinile repetitive cu AI, ca echipa dumneavoastră să facă mai mult — fără să crească. Chatboți RAG, e-Factura, fluxuri n8n. Consultație gratuită de 60 min." />':
    '<meta name="description" content="We automate repetitive work with AI so your team can do more without growing. RAG chatbots, e-Factura, n8n workflows. Free 60-minute consultation." />',

  '<meta name="keywords" content="automatizare procese România, AI România, chatbot WhatsApp, RAG, n8n, e-Factura, automatizare facturi, IMM" />':
    '<meta name="keywords" content="business process automation Romania, AI Romania, WhatsApp chatbot, RAG, n8n, e-Factura, invoice automation, SME" />',

  '<meta property="og:title" content="Adaptive Technologies — Lucrați mai inteligent. Nu mai mult." />':
    '<meta property="og:title" content="Adaptive Technologies — Work smarter. Not more." />',

  '<meta property="og:description" content="Automatizare AI practică pentru IMM-uri din România. Vedeți un demo funcțional gratuit înainte de orice angajament." />':
    '<meta property="og:description" content="Practical AI automation for Romanian SMEs. See a working demo, free, before any commitment." />',

  '<meta property="og:url" content="https://adaptivetech.ro/" />':
    '<meta property="og:url" content="https://adaptivetech.ro/en/" />',

  '<link rel="canonical" href="https://adaptivetech.ro/" />':
    '<link rel="canonical" href="https://adaptivetech.ro/en/" />',

  // ── JSON-LD. The ProfessionalService @id stays identical on both pages: it
  //    is one company, and the shared @id is what tells a consumer these are
  //    two descriptions of the same entity rather than two organisations.
  '"description": "Automatizare AI și fluxuri de lucru pentru IMM-uri din România."':
    '"description": "AI automation and workflow engineering for small and medium businesses in Romania."',

  '"automatizare procese de business"': '"business process automation"',
  '"inteligență artificială aplicată"': '"applied artificial intelligence"',
  '"integrări API"': '"API integrations"',

  '"name": "Servicii de automatizare și AI"': '"name": "Automation and AI services"',

  '"name": "Câștiguri Rapide"': '"name": "Quick Wins"',
  '"description": "Automatizări pe o singură sarcină, cu rezultat vizibil din prima săptămână — fără să atingem sistemele existente."':
    '"description": "Single-task automations with visible results from week one — without touching your existing systems."',

  '"name": "Fluxuri de Proces"': '"name": "Process Flows"',
  '"description": "Fluxuri multi-pas care conectează instrumentele și departamentele, capăt la capăt."':
    '"description": "Multi-step workflows that connect your tools and departments, end to end."',

  '"name": "Inteligență AI"': '"name": "AI Intelligence"',
  '"description": "AI aplicat pe documentele și bazele dumneavoastră de date — răspunde cu surse citate. Chatboți RAG, interogări în limbaj natural."':
    '"description": "AI applied to your documents and databases — it answers with cited sources. RAG chatbots, natural-language queries."',

  '"name": "AI Avansat"': '"name": "Advanced AI"',
  '"description": "Modele construite pentru provocări specifice — predicții, computer vision, sisteme AI personalizate."':
    '"description": "Models built for specific challenges — forecasting, computer vision, custom AI systems."',
};

const EN_PRIVACY = {
  '<title>Politica de Confidențialitate — Adaptive Technologies</title>':
    '<title>Privacy Policy — Adaptive Technologies</title>',

  '<meta name="description" content="Ce date colectăm, cui le trimitem, cât timp le păstrăm și ce drepturi aveți — pentru site-ul Adaptive Technologies și demo-ul RAG." />':
    '<meta name="description" content="What data we collect, who we send it to, how long we keep it and what rights you have — for the Adaptive Technologies site and the RAG demo." />',

  '<meta property="og:title" content="Politica de Confidențialitate — Adaptive Technologies" />':
    '<meta property="og:title" content="Privacy Policy — Adaptive Technologies" />',

  '<meta property="og:url" content="https://adaptivetech.ro/politica-de-confidentialitate.html" />':
    '<meta property="og:url" content="https://adaptivetech.ro/en/privacy-policy.html" />',

  '<link rel="canonical" href="https://adaptivetech.ro/politica-de-confidentialitate.html" />':
    '<link rel="canonical" href="https://adaptivetech.ro/en/privacy-policy.html" />',
};

const PAGES = [
  {
    master: 'index.html',
    changefreq: 'monthly',
    priority: '1.0',
    variants: {
      ro: { out: 'index.html', url: ORIGIN + '/' },
      en: { out: 'en/index.html', url: ORIGIN + '/en/' },
    },
    text: {
      ro: {
        '<textarea id="f-msg" name="message"></textarea>':
          '<textarea id="f-msg" name="message" placeholder="Pe scurt: ce proces vă consumă cel mai mult timp?"></textarea>',
      },
      en: Object.assign({
        '<textarea id="f-msg" name="message"></textarea>':
          '<textarea id="f-msg" name="message" placeholder="In short: which process eats up most of your time?"></textarea>',
      }, EN_INDEX),
    },
    // Root-relative links that must point into the EN tree. The demo is NOT
    // translated -- it is one bilingual app -- so it keeps its single URL and
    // is handed the language instead: it used to read the choice from a
    // localStorage key the split site no longer writes.
    linksEn: {
      '/demo/': '/demo/?lang=en',
      '/politica-de-confidentialitate.html': '/en/privacy-policy.html',
    },
  },
  {
    master: 'politica-de-confidentialitate.html',
    changefreq: 'yearly',
    priority: '0.3',
    variants: {
      ro: { out: 'politica-de-confidentialitate.html', url: ORIGIN + '/politica-de-confidentialitate.html' },
      en: { out: 'en/privacy-policy.html', url: ORIGIN + '/en/privacy-policy.html' },
    },
    text: { ro: {}, en: EN_PRIVACY },
    linksEn: {
      '/': '/en/',
      '/#contact': '/en/#contact',
      '/#cum-lucram': '/en/#cum-lucram',
      '/#demo': '/en/#demo',
      '/#despre': '/en/#despre',
      '/#solutii': '/en/#solutii',
      '/politica-de-confidentialitate.html': '/en/privacy-policy.html',
    },
  },
];

const LOCALE = { ro: 'ro_RO', en: 'en_US' };

function build(page, lang) {
  const master = fs.readFileSync(path.join(SRC, page.master), 'utf8');
  const EOL = master.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  let s = master;

  const sub = (a, b, why) => {
    const n = s.split(a).length - 1;
    if (n !== 1) {
      console.error('[' + page.master + ' ' + lang + '] ' + why + ': expected 1 match, found ' +
                    n + ' for\n  ' + a.slice(0, 100));
      process.exit(1);
    }
    s = s.split(a).join(b);
  };

  // ── 1. Drop the other language outright. Verified safe to do with a
  //    non-greedy match: no data-span in either master contains a nested
  //    <span> (tools/build-site.js is checked against that by the tests).
  //
  //    Trailing whitespace is deliberately NOT consumed. Where the two spans
  //    sit on one line separated by a space, eating it would weld the kept
  //    span onto the next word.
  const drop = lang === 'ro' ? 'en' : 'ro';
  const before = s.length;
  s = s.replace(new RegExp('<span data-' + drop + '\\b[^>]*>[\\s\\S]*?<\\/span>', 'g'), '');
  if (s.length === before) {
    console.error('[' + page.master + ' ' + lang + '] stripped no ' + drop + ' spans');
    process.exit(1);
  }

  // ── 2. html lang
  if (lang !== 'ro') sub('<html lang="ro">', '<html lang="' + lang + '">', 'html lang');


  // ── 4. Per-language text, then the EN link rewrites.
  for (const [a, b] of Object.entries(page.text[lang] || {})) sub(a, b, 'text');
  if (lang === 'en') {
    for (const [a, b] of Object.entries(page.linksEn)) {
      const n = s.split('href="' + a + '"').length - 1;
      if (n === 0) {
        console.error('[' + page.master + ' en] no link to rewrite: ' + a);
        process.exit(1);
      }
      s = s.split('href="' + a + '"').join('href="' + b + '"');
    }
    sub('<meta property="og:locale" content="ro_RO" />',
        '<meta property="og:locale" content="en_US" />', 'og:locale');
    if (s.includes('<meta property="og:locale:alternate" content="en_US" />')) {
      sub('<meta property="og:locale:alternate" content="en_US" />',
          '<meta property="og:locale:alternate" content="ro_RO" />', 'og:locale:alternate');
    }
  }

  // ── The toggle is injected AFTER the link rewrites above, not before.
  // Its RO link legitimately points into the RO tree -- that is the whole
  // point of it -- so building it earlier let the EN rewrite rules capture
  // it, and the EN privacy page offered "RO" as a link to itself.
  const link = (l) => '<a id="lang-' + l + '"' + (l === lang ? ' class="active"' : '') +
    ' href="' + page.variants[l].url.replace(ORIGIN, '') + '" hreflang="' + l + '"' +
    (l === lang ? ' aria-current="true"' : '') + '>' + l.toUpperCase() + '</a>';
  sub('<!--LANG-TOGGLE-->', link('ro') + EOL + '        ' + link('en'), 'lang toggle');

  // ── 5. hreflang. Every variant lists ALL variants including itself -- a
  //    reciprocal set is what makes Google trust the annotation. x-default
  //    goes to Romanian: this is a Romanian company selling in Romania, and
  //    that is the right landing for an unmatched locale.
  const alts = Object.entries(page.variants)
    .map(([l, v]) => '<link rel="alternate" hreflang="' + l + '" href="' + v.url + '" />')
    .concat('<link rel="alternate" hreflang="x-default" href="' + page.variants.ro.url + '" />')
    .join(EOL);
  sub('</head>', alts + EOL + '</head>', 'hreflang');

  // ── 6. Stamp it, so nobody edits the output and loses the change.
  const banner = '<!-- GENERATED by tools/build-site.js from site-src/' + page.master + ' — do not edit. -->';
  sub('<!DOCTYPE html>', '<!DOCTYPE html>' + EOL + banner, 'banner');

  const dest = path.join(OUT, page.variants[lang].out);
  emit(dest, s);

  const left = (s.match(new RegExp('data-' + drop + '\\b', 'g')) || []).length;
  console.log('  ' + page.variants[lang].out.padEnd(34) + lang +
    '  ' + (s.length / 1024).toFixed(0) + ' KB  (' + drop + ' refs left: ' + left + ')');
  return { url: page.variants[lang].url, lang, page };
}

console.log(CHECK ? 'checking website/ against site-src/' : 'building site from site-src/');
const built = [];
for (const page of PAGES) for (const lang of Object.keys(page.variants)) built.push(build(page, lang));

// ── The sitemap is generated from the same table that generated the pages, so
//    the two cannot drift. Each entry carries its alternates, which is how a
//    sitemap declares hreflang.
const XHTML = 'http://www.w3.org/1999/xhtml';
const today = new Date().toISOString().slice(0, 10);
const entries = built.map(({ url, page }) => {
  const alts = Object.entries(page.variants)
    .map(([l, v]) => '    <xhtml:link rel="alternate" hreflang="' + l + '" href="' + v.url + '" />')
    .concat('    <xhtml:link rel="alternate" hreflang="x-default" href="' + page.variants.ro.url + '" />')
    .join('\n');
  return '  <url>\n    <loc>' + url + '</loc>\n' + alts +
    '\n    <lastmod>' + today + '</lastmod>\n' +
    '    <changefreq>' + page.changefreq + '</changefreq>\n' +
    '    <priority>' + page.priority + '</priority>\n  </url>';
}).join('\n');

emit(path.join(OUT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!-- GENERATED by tools/build-site.js - do not edit.\n' +
  '     /demo/ is deliberately absent: it carries <meta name="robots" content="noindex">,\n' +
  '     and listing a noindex URL in a sitemap is a contradiction Search Console reports. -->\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="' + XHTML + '">\n' +
  entries + '\n</urlset>\n');
console.log('  sitemap.xml                       ' + built.length + ' urls');

if (CHECK) {
  if (stale.length) {
    console.error(''+stale.length + ' file(s) out of date with site-src/:');
    for (const f of stale) console.error('  ' + f);
    console.error('run: node tools/build-site.js');
    process.exit(1);
  }
  console.log('website/ is up to date with site-src/');
}
