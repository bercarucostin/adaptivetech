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
//     /studii-de-caz/                       RO case-study index
//     /en/case-studies/                     EN case-study index
//     /studii-de-caz/<slug>/                RO case study
//     /en/case-studies/<slug>/              EN case study
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

// The shared components. One definition each, injected into every page, so
// a page cannot quietly grow its own header or footer again.
const PARTIALS = path.join(SRC, 'partials');
const HEADER = fs.readFileSync(path.join(PARTIALS, 'header.html'), 'utf8').trimEnd();
const FOOTER = fs.readFileSync(path.join(PARTIALS, 'footer.html'), 'utf8').trimEnd();
const BASE_CSS = fs.readFileSync(path.join(PARTIALS, 'base.css'), 'utf8');
const HEADER_JS = fs.readFileSync(path.join(PARTIALS, 'header.js'), 'utf8').trimEnd();
// Page behaviour shared beyond the header: reveal-on-scroll, watermark theme,
// and the reduceMotion flag every page script reads. Same scope as the page's
// own script, so a page must not redeclare what this provides.
const PAGE_JS = fs.readFileSync(path.join(PARTIALS, 'page.js'), 'utf8').trimEnd();

// ── Cache busting by content hash.
//
// These files are cached hard at the edge and in the browser, and their
// URLs never changed when their contents did -- so a deploy did not reach
// anyone who had visited before, until someone purged Cloudflare by hand.
// Hashing the content into the query string makes the URL change exactly
// when the bytes change, and never otherwise: a deploy is a guaranteed
// cache miss, and an unchanged file keeps its cached copy.
//
// site.css matters most -- every page links it, so a stale copy leaves the
// whole site unstyled rather than merely out of date.
const crypto = require('crypto');
const version = (content) => crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
const SITE_CSS_V = version(BASE_CSS);

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
  '<title>Automatizare AI pentru IMM-uri — Adaptive Technologies</title>':
    '<title>Adaptive Technologies — AI Automation for Romanian SMEs</title>',

  '<meta name="description" content="Automatizăm sarcinile repetitive cu AI — echipa dumneavoastră face mai mult, fără să crească. Chatboți RAG, e-Factura, fluxuri n8n. Consultație gratuită." />':
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

// The case-study pages. Their bodies are bilingual by spans like every
// other master; only the head and the JSON-LD need a map.
const EN_CASES = {
  '<title>Studii de caz — Adaptive Technologies</title>':
    '<title>Case studies — Adaptive Technologies</title>',
  '<meta name="description" content="Două sisteme în producție la clienți din România: un asistent tehnic pe WhatsApp pentru Partner Corporation și o aplicație web cu agent AI pentru laboratorul dentar ZRSIO HEALTH." />':
    '<meta name="description" content="Two systems in production for Romanian clients: a WhatsApp technical assistant for Partner Corporation and a web app with an AI agent for the ZRSIO HEALTH dental lab." />',
  '<meta property="og:title" content="Studii de caz — Adaptive Technologies" />':
    '<meta property="og:title" content="Case studies — Adaptive Technologies" />',
  '<meta property="og:description" content="Ce am construit, pentru cine și cum funcționează — cu demonstrații interactive." />':
    '<meta property="og:description" content="What we built, for whom and how it works — with interactive demonstrations." />',
  '<meta property="og:url" content="https://adaptivetech.ro/studii-de-caz/" />':
    '<meta property="og:url" content="https://adaptivetech.ro/en/case-studies/" />',
  '<link rel="canonical" href="https://adaptivetech.ro/studii-de-caz/" />':
    '<link rel="canonical" href="https://adaptivetech.ro/en/case-studies/" />',
};

const EN_PARTNER = {
  '<title>Asistent tehnic pe WhatsApp pentru Partner Corporation — Studiu de caz</title>':
    '<title>A WhatsApp technical assistant for Partner Corporation — Case study</title>',
  '<meta name="description" content="Cum am construit pentru Partner Corporation SRL un asistent WhatsApp care răspunde tehnicienilor din manualele imprimantelor fiscale, cu sursa citată. RAG peste o colecție de documente tehnice." />':
    '<meta name="description" content="How we built a WhatsApp assistant for Partner Corporation SRL that answers technicians from the fiscal-printer manuals, with the source cited. RAG over a technical document collection." />',
  '<meta property="og:title" content="Asistent tehnic pe WhatsApp pentru Partner Corporation — Studiu de caz" />':
    '<meta property="og:title" content="A WhatsApp technical assistant for Partner Corporation — Case study" />',
  '<meta property="og:description" content="Un asistent care răspunde ca un inginer senior, din manualele companiei, cu sursa citată. În producție." />':
    '<meta property="og:description" content="An assistant that answers like a senior engineer, from the company’s own manuals, with the source cited. In production." />',
  '<meta property="og:url" content="https://adaptivetech.ro/studii-de-caz/partner-corporation/" />':
    '<meta property="og:url" content="https://adaptivetech.ro/en/case-studies/partner-corporation/" />',
  '<link rel="canonical" href="https://adaptivetech.ro/studii-de-caz/partner-corporation/" />':
    '<link rel="canonical" href="https://adaptivetech.ro/en/case-studies/partner-corporation/" />',
  '"name": "Asistent tehnic pe WhatsApp pentru Partner Corporation"':
    '"name": "A WhatsApp technical assistant for Partner Corporation"',
  '"description": "Studiu de caz: asistent WhatsApp bazat pe RAG peste manualele tehnice ale imprimantelor fiscale Partner, cu sursa citată la fiecare răspuns."':
    '"description": "Case study: a WhatsApp assistant built on RAG over the Partner fiscal-printer technical manuals, with the source cited on every answer."',
  '"inLanguage": "ro"': '"inLanguage": "en"',
};

const EN_ZRSIO = {
  '<title>Flowrise Dental — aplicație web cu agent AI pentru ZRSIO HEALTH — Studiu de caz</title>':
    '<title>Flowrise Dental — a web app with an AI agent for ZRSIO HEALTH — Case study</title>',
  '<meta name="description" content="Cum am construit Flowrise Dental pentru laboratorul ZRSIO HEALTH SRL: comenzi de lucru urmărite pe stări, roluri pentru tehnicieni și medici, și un agent AI care execută sarcini în aplicație." />':
    '<meta name="description" content="How we built Flowrise Dental for the ZRSIO HEALTH SRL lab: work orders tracked through statuses, roles for technicians and doctors, and an AI agent that carries out tasks inside the app." />',
  '<meta property="og:title" content="Flowrise Dental — aplicație web cu agent AI pentru ZRSIO HEALTH — Studiu de caz" />':
    '<meta property="og:title" content="Flowrise Dental — a web app with an AI agent for ZRSIO HEALTH — Case study" />',
  '<meta property="og:description" content="Un laborator dentar care își vede toate comenzile pe o singură tablă, cu un agent AI care preia sarcinile repetitive. În producție." />':
    '<meta property="og:description" content="A dental lab that sees every order on one board, with an AI agent taking the repetitive tasks. In production." />',
  '<meta property="og:url" content="https://adaptivetech.ro/studii-de-caz/zrsio-health/" />':
    '<meta property="og:url" content="https://adaptivetech.ro/en/case-studies/zrsio-health/" />',
  '<link rel="canonical" href="https://adaptivetech.ro/studii-de-caz/zrsio-health/" />':
    '<link rel="canonical" href="https://adaptivetech.ro/en/case-studies/zrsio-health/" />',
  '"name": "Flowrise Dental — aplicație web cu agent AI pentru ZRSIO HEALTH"':
    '"name": "Flowrise Dental — a web app with an AI agent for ZRSIO HEALTH"',
  '"description": "Studiu de caz: aplicație web pentru un laborator dentar, cu comenzi urmărite pe stări, roluri și un agent AI care execută sarcini."':
    '"description": "Case study: a web app for a dental lab, with work orders tracked through statuses, roles and an AI agent that carries out tasks."',
  '"inLanguage": "ro"': '"inLanguage": "en"',
};

const PAGES = [
  {
    master: 'index.html',
    changefreq: 'monthly',
    // Same-page anchors on the homepage; absolute from anywhere else.
    home: { ro: '', en: '' },
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
  },
  {
    master: 'politica-de-confidentialitate.html',
    changefreq: 'yearly',
    home: { ro: '/', en: '/en/' },
    priority: '0.3',
    variants: {
      ro: { out: 'politica-de-confidentialitate.html', url: ORIGIN + '/politica-de-confidentialitate.html' },
      en: { out: 'en/privacy-policy.html', url: ORIGIN + '/en/privacy-policy.html' },
    },
    text: { ro: {}, en: EN_PRIVACY },
  },
  {
    master: 'studii-de-caz/index.html',
    changefreq: 'monthly',
    home: { ro: '/', en: '/en/' },
    priority: '0.8',
    variants: {
      ro: { out: 'studii-de-caz/index.html', url: ORIGIN + '/studii-de-caz/' },
      en: { out: 'en/case-studies/index.html', url: ORIGIN + '/en/case-studies/' },
    },
    text: { ro: {}, en: EN_CASES },
  },
  {
    master: 'studii-de-caz/partner-corporation.html',
    changefreq: 'monthly',
    home: { ro: '/', en: '/en/' },
    priority: '0.8',
    variants: {
      ro: { out: 'studii-de-caz/partner-corporation/index.html', url: ORIGIN + '/studii-de-caz/partner-corporation/' },
      en: { out: 'en/case-studies/partner-corporation/index.html', url: ORIGIN + '/en/case-studies/partner-corporation/' },
    },
    text: { ro: {}, en: EN_PARTNER },
  },
  {
    master: 'studii-de-caz/zrsio-health.html',
    changefreq: 'monthly',
    home: { ro: '/', en: '/en/' },
    priority: '0.8',
    variants: {
      ro: { out: 'studii-de-caz/zrsio-health/index.html', url: ORIGIN + '/studii-de-caz/zrsio-health/' },
      en: { out: 'en/case-studies/zrsio-health/index.html', url: ORIGIN + '/en/case-studies/zrsio-health/' },
    },
    text: { ro: {}, en: EN_ZRSIO },
  },
];

// The case-study tree has a different slug per language, so pages reach it
// through a placeholder rather than a literal path.
const CASES = { ro: '/studii-de-caz/', en: '/en/case-studies/' };

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

  // ── 0. The shared components. Injected before anything else so their
  //    language spans and their links go through every later step exactly
  //    as the page's own markup does.
  sub('<!--@header-->', HEADER, 'header');
  sub('<!--@footer-->', FOOTER, 'footer');
  sub('<!--@script-->', HEADER_JS + '\n\n' + PAGE_JS, 'shared behaviour');

  // ── 0b. Placeholders. Filled after injection so a master can use them in
  //    its own body exactly as the partials do -- a case-study page links to
  //    its sibling with {{CASES}} and to the policy with {{PRIVACY}}, and gets
  //    the right language's URL without a per-page rewrite table.
  const fill = {
    '{{HOME}}': page.home[lang],
    '{{PRIVACY}}': lang === 'en' ? '/en/privacy-policy.html' : '/politica-de-confidentialitate.html',
    '{{CASES}}': CASES[lang],
  };
  for (const [k, v] of Object.entries(fill)) s = s.split(k).join(v);
  const unfilled = s.match(/\{\{[A-Z_]+\}\}/);
  if (unfilled) {
    console.error('[' + page.master + ' ' + lang + '] unknown placeholder ' + unfilled[0]);
    process.exit(1);
  }

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


  // ── 4. Per-language text, then the one EN link rewrite. The demo is NOT
  //    translated -- it is one bilingual app -- so it keeps its single URL
  //    and is handed the language instead: it used to read the choice from
  //    a localStorage key the split site no longer writes. The header links
  //    to it, so every page has at least one to rewrite.
  for (const [a, b] of Object.entries(page.text[lang] || {})) sub(a, b, 'text');
  if (lang === 'en') {
    if (!s.includes('href="/demo/"')) {
      console.error('[' + page.master + ' en] no demo link to rewrite');
      process.exit(1);
    }
    s = s.split('href="/demo/"').join('href="/demo/?lang=en"');
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

  // ── 5b. Version the shared stylesheet link.
  sub('<link rel="stylesheet" href="/assets/site.css" />',
      '<link rel="stylesheet" href="/assets/site.css?v=' + SITE_CSS_V + '" />', 'site.css version');

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
emit(path.join(OUT, 'assets', 'site.css'), BASE_CSS);

// ── The demo page. It is hand-maintained rather than generated from a
//    master, so only its asset query strings are rewritten -- everything
//    else in the file is left exactly as written.
const DEMO = path.join(OUT, 'demo');
if (fs.existsSync(DEMO)) {
  const indexPath = path.join(DEMO, 'index.html');
  let demoHtml = fs.readFileSync(indexPath, 'utf8');
  const before = demoHtml;
  const assets = [
    ['/assets/site.css', SITE_CSS_V],
    ['demo.css', version(fs.readFileSync(path.join(DEMO, 'demo.css'), 'utf8'))],
    ['demo.js', version(fs.readFileSync(path.join(DEMO, 'demo.js'), 'utf8'))],
  ];
  for (const [file, v] of assets) {
    // Matches the reference with or without an existing ?v=, so re-running
    // replaces the old hash rather than appending a second one.
    const re = new RegExp('("|\')' + file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?v=[a-f0-9]+)?\\1', 'g');
    const hits = demoHtml.match(re);
    if (!hits) { console.error('demo/index.html does not reference ' + file); process.exit(1); }
    demoHtml = demoHtml.replace(re, (m, q) => q + file + '?v=' + v + q);
  }
  emit(indexPath, demoHtml);
  console.log('  demo/index.html                   ' + (before === demoHtml ? 'asset versions unchanged' : 'asset versions stamped'));
}
console.log('  assets/site.css                   ' + (BASE_CSS.length/1024).toFixed(1) + ' KB');
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
