'use strict';
// Retrieval evaluation harness. Runs every question in eval/questions.json
// through one or more retrieval variants against the live documents table
// (read-only) and reports hit rates per question group.
//
//   node eval/retrieval-eval.js check                 resolve gold selectors, list the chunks
//   node eval/retrieval-eval.js run [variant ...]     score variants (default: all)
//   node eval/retrieval-eval.js detail <variant>      per-question ranks for one variant
//
// Environment:
//   EVAL_DB_CONFIG       path to a JSON file with pg Client options (required)
//   GEMINI_KEY_FILE      path to a file holding a Gemini API key (semantic branch)
//   ANTHROPIC_KEY_FILE   path to a file holding an Anthropic API key (optimizer variants)
// Embeddings and optimizer answers are cached in eval/.cache/.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { buildOptimizerRequest, parseOptimizedQuery, historyFromRows } = require('../lib/retrieval-scope.js');

const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, '.cache');
const K = 15;          // chunks the answer model receives (hybrid-search-tool: match_count 15)
const POOL = 50;       // candidates per branch (hybrid_search: greatest(n*4, 50))
const RRF_K = 50;
const FOLD_FROM = 'ăâîșşțţĂÂÎȘŞȚŢ';
const FOLD_TO = 'aaissttAAISSTT';

// ---------------------------------------------------------------- variants
// query:  'raw' = the question as typed; 'optimizer' = Optimize Query's rewrite;
//         'raw+prev' = the question plus the previous user message.
// lex:    'and' = websearch_to_tsquery as today (every word must match); 'or' = any word.
// fold:   strip Romanian diacritics on both sides before matching.
// scope:  where the product comes from: null (unused), 'oracle' (the labelled product),
//         'optimizer' (the rewrite's scope).
// mode:   how a known product shapes the results (see retrieve()).
const VARIANTS = {
  'prod':                { query: 'optimizer', lex: 'and', fold: false },
  'raw':                 { query: 'raw',       lex: 'and', fold: false },
  'raw-or':              { query: 'raw',       lex: 'or',  fold: false },
  'raw-or-fold':         { query: 'raw',       lex: 'or',  fold: true },
  'opt-or-fold':         { query: 'optimizer', lex: 'or',  fold: true },
  'rawprev-or-fold':     { query: 'raw+prev',  lex: 'or',  fold: true },
  'sem-raw':             { query: 'raw',       lex: 'none' },
  'sem-opt':             { query: 'optimizer', lex: 'none' },
  'sem-rawprev':         { query: 'raw+prev',  lex: 'none' },
  // Candidates for the new design: no optimizer, the question plus the previous user message.
  // reserve: slots kept for the best chunks from shared folders (searched on their own).
  // cap:     most chunks any one folder may take.
  // wFts:    weight of the keyword branch in the fusion (semantic weight is 1 - wFts).
  'new-sem':             { query: 'raw+prev',  lex: 'none' },
  'new-sem-res3':        { query: 'raw+prev',  lex: 'none', reserve: 3 },
  'new-sem-res2':        { query: 'raw+prev',  lex: 'none', reserve: 2 },
  'new-sem-cap8':        { query: 'raw+prev',  lex: 'none', cap: 8 },
  'new-or20-res3':       { query: 'raw+prev',  lex: 'or',  fold: true, wFts: 0.2, reserve: 3 },
  'new-or35-res3':       { query: 'raw+prev',  lex: 'or',  fold: true, wFts: 0.35, reserve: 3 },
  'new-or20':            { query: 'raw+prev',  lex: 'or',  fold: true, wFts: 0.2 },
  // Robustness: questions without history get an unrelated earlier message (noise).
  // 'raw+prev' always prepends it; 'raw+prev-short' only when the question has <= 6 words.
  'noise-prev-res3':     { query: 'raw+prev',       lex: 'none', reserve: 3, noise: true },
  'noise-short-res3':    { query: 'raw+prev-short', lex: 'none', reserve: 3, noise: true },
  'new-short-res3':      { query: 'raw+prev-short', lex: 'none', reserve: 3 },
  // Two semantic searches, the question alone and the question with the previous user
  // message, fused by reciprocal rank (dual = weight of the question-with-history ranking).
  'dual30-res3':         { query: 'raw', dual: 0.3, lex: 'none', reserve: 3 },
  'dual40-res3':         { query: 'raw', dual: 0.4, lex: 'none', reserve: 3 },
  'dual50-res3':         { query: 'raw', dual: 0.5, lex: 'none', reserve: 3 },
  'noise-dual30-res3':   { query: 'raw', dual: 0.3, lex: 'none', reserve: 3, noise: true },
  'noise-dual40-res3':   { query: 'raw', dual: 0.4, lex: 'none', reserve: 3, noise: true },
  'noise-dual50-res3':   { query: 'raw', dual: 0.5, lex: 'none', reserve: 3, noise: true },
  'noise-sem-raw-res3':  { query: 'raw', lex: 'none', reserve: 3, noise: true },
  'lex-and':             { query: 'raw',       lex: 'and', fold: false, sem: false },
  'lex-or':              { query: 'raw',       lex: 'or',  fold: false, sem: false },
  'lex-or-fold':         { query: 'raw',       lex: 'or',  fold: true,  sem: false },
};

// ---------------------------------------------------------------- helpers
function readKey(envName) {
  const file = process.env[envName];
  if (!file) return null;
  // The key is the first whitespace-separated token; anything after it (a label) is ignored.
  return fs.readFileSync(file, 'utf8').trim().split(/\s+/)[0];
}

function fold(s) {
  let out = '';
  for (const ch of String(s)) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out;
}

// websearch_to_tsquery input where any word may match.
function anyWord(text) {
  const words = String(text).replace(/["()\-:|&!<>]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  return words.join(' or ');
}

function cacheGet(kind, key) {
  const f = path.join(CACHE_DIR, kind, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : undefined;
}

function cachePut(kind, key, value) {
  const dir = path.join(CACHE_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, crypto.createHash('sha1').update(key).digest('hex') + '.json'), JSON.stringify(value));
  return value;
}

async function embed(text) {
  const cached = cacheGet('embed', text);
  if (cached) return cached;
  const key = readKey('GEMINI_KEY_FILE');
  if (!key) throw new Error('GEMINI_KEY_FILE is not set: semantic variants need query embeddings');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: 1536 }),
  });
  const json = await res.json();
  if (!json.embedding) throw new Error('embedding failed: ' + JSON.stringify(json).slice(0, 300));
  const v = json.embedding.values;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return cachePut('embed', text, v.map((x) => x / norm));
}

async function optimize(q, folders) {
  const history = historyFromRows([...(q.history || [])].reverse().map((m) =>
    ({ message: { type: m.role === 'user' ? 'human' : 'ai', content: m.content } })));
  const request = buildOptimizerRequest(q.question, history, folders);
  const cacheKey = JSON.stringify(request);
  let raw = cacheGet('optimizer', cacheKey);
  if (raw === undefined) {
    const key = readKey('ANTHROPIC_KEY_FILE');
    if (!key) throw new Error('ANTHROPIC_KEY_FILE is not set: optimizer variants need the Anthropic API');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(request),
    });
    const json = await res.json();
    if (!json.content) throw new Error('optimizer failed: ' + JSON.stringify(json).slice(0, 300));
    raw = cachePut('optimizer', cacheKey, json.content[0].text);
  }
  return parseOptimizedQuery(raw, q.question, folders);
}

// ---------------------------------------------------------------- database
async function withDb(fn) {
  const cfgFile = process.env.EVAL_DB_CONFIG;
  if (!cfgFile) throw new Error('EVAL_DB_CONFIG is not set');
  const client = new Client(JSON.parse(fs.readFileSync(cfgFile, 'utf8')));
  await client.connect();
  try {
    await client.query('begin transaction read only');
    return await fn(client);
  } finally {
    try { await client.query('rollback'); } catch (_) { /* connection may be gone */ }
    await client.end();
  }
}

async function loadFolders(db) {
  const r = await db.query(`
    select d.folder, coalesce(k.kind, 'product') as kind
    from (select distinct metadata->>'folder' as folder from documents
          where metadata->>'source' = 'knowledge_base' and coalesce(metadata->>'folder', '') <> '') d
    left join kb_folders k using (folder)
    order by 1`);
  return r.rows;
}

async function resolveGold(db, q) {
  const out = new Map();
  for (const sel of q.gold) {
    const r = await db.query(`
      select id, metadata->>'folder' as folder, metadata->>'original_file_name' as file,
             metadata->>'section_heading' as heading
      from documents
      where metadata->>'source' = 'knowledge_base'
        and metadata->>'folder' ilike $1
        and coalesce(metadata->>'original_file_name', '') ilike $2
        and coalesce(metadata->>'section_heading', '') ilike $3
        and content ilike $4`,
      [sel.folder, sel.file || '%', sel.heading || '%', sel.content || '%']);
    for (const row of r.rows) out.set(row.id, Object.assign({ role: sel.role }, row));
  }
  return out;
}

// One hybrid search, the same RRF fusion as db/hybrid_search.sql, with the
// variant's switches. Returns [{ id, folder }] best first, up to `limit`.
async function search(db, { lexText, embedding, lex, fold: doFold, folders, limit, wFts = 0.5 }) {
  const wSem = 1 - wFts;
  // lex 'none': an empty tsquery matches nothing, leaving the semantic branch alone.
  const tsInput = lex === 'none' ? '' : (lex === 'or' ? anyWord(lexText) : lexText);
  const r = await db.query(`
    with docs as (
      select id, metadata->>'folder' as folder, embedding,
             case when $3 then to_tsvector('romanian', translate(content, $6, $7)) else fts end as fts
      from documents
      where $4::text[] is null or metadata->>'folder' = any($4::text[])
    ),
    tsq as (select websearch_to_tsquery('romanian', $1) as q),
    semantic as (
      select id, row_number() over (order by dist, id) as rank_ix
      from (select id, embedding <=> $2::vector as dist from docs where $2::vector is not null
            order by embedding <=> $2::vector limit $5) s
    ),
    full_text as (
      select id, row_number() over (order by score desc, id) as rank_ix
      from (select d.id, ts_rank(d.fts, tsq.q) as score from docs d, tsq where d.fts @@ tsq.q
            order by ts_rank(d.fts, tsq.q) desc, d.id limit $5) f
    ),
    fused as (
      select coalesce(s.id, f.id) as id,
             coalesce(${wSem} / (${RRF_K} + s.rank_ix), 0) + coalesce(${wFts} / (${RRF_K} + f.rank_ix), 0) as score,
             f.id is not null as lexical_hit
      from semantic s full outer join full_text f on f.id = s.id
    )
    select fu.id, d.folder, fu.score, fu.lexical_hit
    from fused fu join docs d on d.id = fu.id
    order by fu.score desc, fu.id
    limit $8`,
    [doFold ? fold(tsInput) : tsInput, embedding ? '[' + embedding.join(',') + ']' : null, !!doFold,
      folders || null, POOL, FOLD_FROM, FOLD_TO, limit]);
  return r.rows;
}

async function retrieve(db, q, variant, ctx) {
  let text = q.question;
  let scope = null;
  if (variant.query === 'optimizer' || variant.scope === 'optimizer') {
    const o = await optimize(q, ctx.folders);
    if (variant.query === 'optimizer') text = null;
    scope = o.scope;
    ctx.optimized = o;
  }
  if (variant.query === 'raw+prev' || variant.query === 'raw+prev-short') {
    let history = q.history || [];
    if (variant.noise && !history.length) history = [{ role: 'user', content: ctx.unrelated }];
    const prev = [...history].reverse().find((m) => m.role === 'user');
    const short = q.question.split(/\s+/).filter(Boolean).length <= 6;
    if (prev && (variant.query === 'raw+prev' || short)) text = prev.content + ' ' + q.question;
  }
  if (variant.scope === 'oracle') scope = q.product;
  const semanticText = text === null ? ctx.optimized.query : text;
  const lexText = text === null ? ctx.optimized.lexical : text;
  const embedding = variant.sem === false ? null : await embed(semanticText);
  const base = { lexText, embedding, lex: variant.lex, fold: variant.fold, wFts: variant.wFts };
  let rows;
  if (variant.cap) {
    // Walk a longer list and skip chunks once their folder has `cap` of them.
    const perFolder = {};
    rows = [];
    for (const r of await search(db, Object.assign({}, base, { limit: 100 }))) {
      perFolder[r.folder] = (perFolder[r.folder] || 0) + 1;
      if (perFolder[r.folder] <= variant.cap) rows.push(r);
      if (rows.length === K) break;
    }
  } else if (variant.dual) {
    let history = q.history || [];
    if (variant.noise && !history.length) history = [{ role: 'user', content: ctx.unrelated }];
    const prev = [...history].reverse().find((m) => m.role === 'user');
    if (!prev) {
      rows = await search(db, Object.assign({}, base, { limit: K }));
    } else {
      const alone = await search(db, Object.assign({}, base, { limit: POOL }));
      const withPrev = await search(db, Object.assign({}, base, { embedding: await embed(prev.content + ' ' + q.question), limit: POOL }));
      const fused = new Map();
      const add = (list, w) => list.forEach((r, i) => {
        const cur = fused.get(r.id) || { id: r.id, folder: r.folder, score: 0 };
        cur.score += w / (RRF_K + i + 1);
        fused.set(r.id, cur);
      });
      add(alone, 1 - variant.dual);
      add(withPrev, variant.dual);
      rows = [...fused.values()].sort((a, b) => b.score - a.score || a.id - b.id).slice(0, K);
    }
  } else {
    rows = await search(db, Object.assign({}, base, { limit: K }));
  }
  if (variant.reserve) {
    // The best shared-folder chunks, searched on their own, take the last slots
    // unless they are already in the list.
    const shared = ctx.folders.filter((f) => f.kind === 'shared').map((f) => f.folder);
    const best = (await search(db, Object.assign({}, base, { folders: shared, limit: variant.reserve })))
      .filter((s) => !rows.some((r) => r.id === s.id));
    rows = rows.slice(0, K - best.length).concat(best);
  }
  return { rows, scope, lexText, semanticText };
}

// ---------------------------------------------------------------- scoring
function score(q, gold, rows) {
  const ids = rows.map((r) => r.id);
  const rankOf = (pred) => { const i = ids.findIndex((id) => gold.has(id) && pred(gold.get(id))); return i < 0 ? null : i + 1; };
  const first = rankOf(() => true);
  const own = q.product ? rankOf((g) => g.folder === q.product) : null;
  const shared = rankOf((g) => g.role === 'shared');
  const goldFolders = new Set([...gold.values()].map((g) => g.folder));
  const hitFolders = new Set(rows.filter((r) => gold.has(r.id)).map((r) => r.folder));
  return {
    hit5: first !== null && first <= 5,
    hit15: first !== null,
    rr: first ? 1 / first : 0,
    first,
    hasOwn: !!q.product && [...gold.values()].some((g) => g.folder === q.product),
    own15: own !== null,
    hasShared: [...gold.values()].some((g) => g.role === 'shared'),
    shared15: shared !== null,
    coverage: goldFolders.size ? hitFolders.size / goldFolders.size : 0,
    ownCount: q.product ? rows.filter((r) => r.folder === q.product).length : null,
  };
}

function group(q) {
  if (q.id.startsWith('SP')) return 'shared, product named';
  if (q.id.startsWith('S')) return 'shared, no product';
  if (q.id.startsWith('P')) return 'product named';
  if (q.id.startsWith('M')) return 'no product, differs';
  if (q.id.startsWith('L')) return 'exact terms';
  if (q.id.startsWith('R')) return 'real (from chat history)';
  return 'follow-up';
}

function pct(n, d) { return d ? Math.round((100 * n) / d) + '%' : '-'; }

function summarize(name, results) {
  const groups = {};
  for (const r of results) (groups[group(r.q)] = groups[group(r.q)] || []).push(r);
  groups.ALL = results;
  const lines = [];
  for (const [g, rs] of Object.entries(groups)) {
    const s = rs.map((r) => r.s);
    const own = s.filter((x) => x.hasOwn);
    const shared = s.filter((x) => x.hasShared);
    const multi = rs.filter((r) => r.q.kind === 'multi').map((r) => r.s.coverage);
    lines.push({
      variant: name, group: g, n: rs.length,
      'hit@5': pct(s.filter((x) => x.hit5).length, s.length),
      'hit@15': pct(s.filter((x) => x.hit15).length, s.length),
      MRR: (s.reduce((a, x) => a + x.rr, 0) / s.length).toFixed(2),
      'own product@15': pct(own.filter((x) => x.own15).length, own.length),
      'shared@15': pct(shared.filter((x) => x.shared15).length, shared.length),
      'multi coverage': multi.length ? Math.round((100 * multi.reduce((a, x) => a + x, 0)) / multi.length) + '%' : '-',
    });
  }
  return lines;
}

// ---------------------------------------------------------------- commands
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { questions } = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
  await withDb(async (db) => {
    const folders = await loadFolders(db);
    const golds = new Map();
    for (const q of questions) golds.set(q.id, await resolveGold(db, q));

    if (cmd === 'check') {
      for (const q of questions) {
        const g = [...golds.get(q.id).values()];
        console.log(q.id.padEnd(4), (g.length ? '' : 'NO GOLD  ') + q.question);
        for (const c of g) console.log('       ' + c.id, c.role.padEnd(7), '[' + c.folder + ']', c.file, '—', c.heading);
      }
      return;
    }

    const names = cmd === 'detail' ? args.slice(0, 1) : (args.length ? args : Object.keys(VARIANTS));
    const table = [];
    for (const name of names) {
      const variant = VARIANTS[name];
      if (!variant) throw new Error('unknown variant ' + name);
      const results = [];
      for (const [i, q] of questions.entries()) {
        // For the noise variants: a question from elsewhere in the set, on another topic.
        const ctx = { folders, unrelated: questions[(i + 17) % questions.length].question };
        const out = await retrieve(db, q, variant, ctx);
        results.push({ q, s: score(q, golds.get(q.id), out.rows), out, ctx });
      }
      if (cmd === 'detail') {
        for (const r of results) {
          const folderCounts = {};
          for (const row of r.out.rows) folderCounts[row.folder] = (folderCounts[row.folder] || 0) + 1;
          const lexHits = r.out.rows.filter((x) => x.lexical_hit).length;
          console.log((r.s.hit15 ? 'ok  ' : 'MISS') + ' ' + r.q.id.padEnd(4) + ' first=' + String(r.s.first).padEnd(4) +
            ' own=' + String(r.s.ownCount).padEnd(4) + ' lexicalHits=' + String(lexHits).padEnd(3) + r.q.question);
          if (r.ctx.optimized) console.log('       optimizer: ' + JSON.stringify(r.ctx.optimized));
          console.log('       folders: ' + JSON.stringify(folderCounts));
        }
      }
      table.push(...summarize(name, results));
    }
    console.table(table);
  });
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
