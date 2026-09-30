'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Embed Request" and "Build Search SQL" Code
// nodes in workflows/hybrid-search-tool.json; SEARCH_SQL is the query of its
// "Run Semantic Search" node. tests/search-workflow.test.js fails if they drift.
//
// Retrieval, as measured by evaluation/ (see docs/superpowers/specs/
// 2026-09-30-retrieval-redesign.md). Three rankings fused by reciprocal rank:
// - semantic, the question alone, and the question plus the previous user message
//   (CONTEXT_WEIGHT of the semantic share), so follow-ups like "Dar P300?" find
//   their topic without an unrelated earlier message taking over;
// - keyword, any word of the question with diacritics removed on both sides
//   (KEYWORD_WEIGHT). It finds the second fact of an answer the vector search
//   ranks too low (the drawer's TEST SERTAR, a Z report's menu); on its own list
//   of 15 it pushed answers out, so the list is SEARCH_K = 20.
// Then up to SHARED_SLOTS of the last places go to the best chunks from shared
// folders (kb_folders.kind = 'shared') that are not already in the list and are
// about as relevant as it (SHARED_MARGIN), so a named product's manuals cannot
// push relevant shared documentation out, and irrelevant shared docs take no room.

const EMBED_DIMS = 1536;
const SEARCH_K = 20;           // chunks the answer model receives
const SEARCH_POOL = 50;        // candidates per ranking before fusion
const SEARCH_RRF_K = 50;
const CONTEXT_WEIGHT = 0.3;    // share of the semantic weight for question-plus-previous-message
const KEYWORD_WEIGHT = 0.1;    // weight of the keyword ranking; semantic gets the rest
const SHARED_SLOTS = 3;
const FOLD_FROM = 'ăâîșşțţĂÂÎȘŞȚŢ';
const FOLD_TO = 'aaissttAAISSTT';
// A shared chunk takes a slot only if its distance is at most the farthest chunk
// already in the list plus this margin; null = always fill the slots. Always
// filling them pushed useful product chunks out (a drawer question lost its
// TEST SERTAR chunk to firmware and Bluetooth docs).
const SHARED_MARGIN = 0.03;

function embedPart(text) {
  return {
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: String(text || '') }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: EMBED_DIMS,
  };
}

// The batchEmbedContents body: the question, then the question with context if any.
function embedRequest(query, contextQuery) {
  const requests = [embedPart(query)];
  if (contextQuery) requests.push(embedPart(contextQuery));
  return { requests };
}

// gemini-embedding-001 only returns unit vectors at 3072 dims; at 1536 we normalize.
function toVector(values) {
  if (!Array.isArray(values)) throw new Error('Embedding failed: no values');
  if (values.length !== EMBED_DIMS) {
    throw new Error('Query embedding is ' + values.length + ' dims, expected ' + EMBED_DIMS +
      ' - check outputDimensionality in the embed request.');
  }
  const norm = Math.sqrt(values.reduce((s, x) => s + x * x, 0));
  return '[' + (norm > 0 ? values.map((x) => x / norm) : values).join(',') + ']';
}

// websearch_to_tsquery input matching any word of the question: diacritics removed,
// punctuation dropped, single letters and the operator word "or" left out.
function keywordQuery(text) {
  let folded = '';
  for (const ch of String(text || '')) {
    const i = FOLD_FROM.indexOf(ch);
    folded += i >= 0 ? FOLD_TO[i] : ch;
  }
  return folded.split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && w.toLowerCase() !== 'or')
    .join(' or ');
}

// The four parameters of SEARCH_SQL from the batchEmbedContents answer and the question.
function searchParams(embeddings, filter, question) {
  if (!Array.isArray(embeddings) || !embeddings.length) {
    throw new Error('Embedding failed: ' + String(JSON.stringify(embeddings)).slice(0, 300));
  }
  let f = filter || '{}';
  if (typeof f !== 'string') f = JSON.stringify(f);
  return {
    vector: toVector(embeddings[0].values),
    context_vector: embeddings[1] ? toVector(embeddings[1].values) : '',
    filter: f.trim() || '{}',
    keywords: keywordQuery(question),
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

// $1 question vector, $2 context vector or '', $3 metadata filter (jsonb, '{}' = none),
// $4 keyword query ('' matches nothing). Shared slots are only kept when there is no filter.
function buildSearchSql({ sharedMargin }) {
  const semantic = 1 - KEYWORD_WEIGHT;
  const alone = round(semantic * (1 - CONTEXT_WEIGHT));
  const withContext = round(semantic * CONTEXT_WEIGHT);
  const dist = (alias) => `${1 - CONTEXT_WEIGHT} * (${alias}.embedding <=> p.v) + ${CONTEXT_WEIGHT} * (${alias}.embedding <=> coalesce(p.cv, p.v))`;
  const cutoff = sharedMargin === null || sharedMargin === undefined ? '' : `
cutoff as (
  select max(${dist('d')}) as worst
  from top t
  join documents d on d.id = t.id
  cross join params p
),`;
  const cutoffTest = cutoff ? `
  where dist <= (select worst from cutoff) + ${sharedMargin}` : '';
  return `with params as (
  select $1::vector(1536) as v,
         nullif($2, '')::vector(1536) as cv,
         coalesce(nullif($3, ''), '{}')::jsonb as filter,
         websearch_to_tsquery('romanian', $4) as q
),
alone as (
  select id, row_number() over (order by dist, id) as rk
  from (select d.id, d.embedding <=> p.v as dist
        from documents d, params p
        where p.filter = '{}'::jsonb or d.metadata @> p.filter
        order by d.embedding <=> p.v, d.id
        limit ${SEARCH_POOL}) s
),
with_context as (
  select id, row_number() over (order by dist, id) as rk
  from (select d.id, d.embedding <=> p.cv as dist
        from documents d, params p
        where p.cv is not null and (p.filter = '{}'::jsonb or d.metadata @> p.filter)
        order by d.embedding <=> p.cv, d.id
        limit ${SEARCH_POOL}) s
),
keyword as (
  select id, row_number() over (order by score desc, id) as rk
  from (select d.id, ts_rank(to_tsvector('romanian', translate(d.content, '${FOLD_FROM}', '${FOLD_TO}')), p.q) as score
        from documents d, params p
        where (p.filter = '{}'::jsonb or d.metadata @> p.filter)
          and to_tsvector('romanian', translate(d.content, '${FOLD_FROM}', '${FOLD_TO}')) @@ p.q
        order by score desc, d.id
        limit ${SEARCH_POOL}) s
),
fused as (
  select coalesce(a.id, c.id, w.id) as id,
         coalesce((case when p.cv is null then ${semantic} else ${alone} end) / (${SEARCH_RRF_K} + a.rk), 0)
         + coalesce(${withContext} / (${SEARCH_RRF_K} + c.rk), 0)
         + coalesce(${KEYWORD_WEIGHT} / (${SEARCH_RRF_K} + w.rk), 0) as score
  from alone a
  full outer join with_context c on c.id = a.id
  full outer join keyword w on w.id = coalesce(a.id, c.id)
  cross join params p
),
top as (
  select id, row_number() over (order by score desc, id) as pos
  from fused
  order by score desc, id
  limit ${SEARCH_K}
),${cutoff}
shared as (
  select id, row_number() over (order by dist, id) as rk
  from (select d.id, ${dist('d')} as dist
        from documents d
        join kb_folders k on k.folder = d.metadata->>'folder' and k.kind = 'shared'
        cross join params p
        where p.filter = '{}'::jsonb
          and d.id not in (select id from top)
        order by dist, d.id
        limit ${SHARED_SLOTS}) s${cutoffTest}
),
picked as (
  select id, pos from top where pos <= ${SEARCH_K} - (select count(*) from shared)
  union all
  select id, ${SEARCH_K} - (select count(*) from shared) + rk from shared
)
select d.id, d.content, d.metadata, pk.pos as rank
from picked pk
join documents d on d.id = pk.id
order by pk.pos`;
}

const SEARCH_SQL = buildSearchSql({ sharedMargin: SHARED_MARGIN });
// ---8<--- SHARED END ---8<---

module.exports = {
  embedRequest, searchParams, keywordQuery, buildSearchSql, SEARCH_SQL,
  EMBED_DIMS, SEARCH_K, SEARCH_POOL, SEARCH_RRF_K, CONTEXT_WEIGHT, KEYWORD_WEIGHT, SHARED_SLOTS, SHARED_MARGIN,
};
