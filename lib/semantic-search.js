'use strict';

// ---8<--- SHARED START ---8<---
// Copied verbatim into the "Build Embed Request" and "Build Search SQL" Code
// nodes in workflows/hybrid-search-tool.json; SEARCH_SQL is the query of its
// "Run Semantic Search" node. tests/search-workflow.test.js fails if they drift.
//
// Retrieval, as measured by evaluation/ (see docs/superpowers/specs/
// 2026-09-30-retrieval-redesign.md):
// - semantic only: the keyword branch lowered the ranking at every weight tried;
// - the question alone, fused with the question plus the previous user message
//   (weight CONTEXT_WEIGHT), so follow-ups like "Dar P300?" find their topic
//   without an unrelated earlier message taking over;
// - the last SHARED_SLOTS places go to the best chunks from shared folders
//   (kb_folders.kind = 'shared') that are not already in the list, so a named
//   product's manuals cannot push shared documentation out.

const EMBED_DIMS = 1536;
const SEARCH_K = 15;           // chunks the answer model receives
const SEARCH_POOL = 50;        // candidates per ranking before fusion
const SEARCH_RRF_K = 50;
const CONTEXT_WEIGHT = 0.3;    // weight of the question-plus-previous-message ranking
const SHARED_SLOTS = 3;

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

// The three parameters of SEARCH_SQL from the batchEmbedContents answer.
function searchParams(embeddings, filter) {
  if (!Array.isArray(embeddings) || !embeddings.length) {
    throw new Error('Embedding failed: ' + String(JSON.stringify(embeddings)).slice(0, 300));
  }
  let f = filter || '{}';
  if (typeof f !== 'string') f = JSON.stringify(f);
  return {
    vector: toVector(embeddings[0].values),
    context_vector: embeddings[1] ? toVector(embeddings[1].values) : '',
    filter: f.trim() || '{}',
  };
}

// $1 question vector, $2 context vector or '', $3 metadata filter (jsonb, '{}' = none).
// Shared slots are only kept when there is no filter.
const SEARCH_SQL = `with params as (
  select $1::vector(1536) as v,
         nullif($2, '')::vector(1536) as cv,
         coalesce(nullif($3, ''), '{}')::jsonb as filter
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
fused as (
  select coalesce(a.id, c.id) as id,
         coalesce(${1 - CONTEXT_WEIGHT} / (${SEARCH_RRF_K} + a.rk), 0)
         + coalesce(${CONTEXT_WEIGHT} / (${SEARCH_RRF_K} + c.rk), 0) as score
  from alone a full outer join with_context c on c.id = a.id
),
top as (
  select id, row_number() over (order by score desc, id) as pos
  from fused
  order by score desc, id
  limit ${SEARCH_K}
),
shared as (
  select id, row_number() over (order by dist, id) as rk
  from (select d.id,
               ${1 - CONTEXT_WEIGHT} * (d.embedding <=> p.v) + ${CONTEXT_WEIGHT} * (d.embedding <=> coalesce(p.cv, p.v)) as dist
        from documents d
        join kb_folders k on k.folder = d.metadata->>'folder' and k.kind = 'shared'
        cross join params p
        where p.filter = '{}'::jsonb
          and d.id not in (select id from top)
        order by dist, d.id
        limit ${SHARED_SLOTS}) s
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
// ---8<--- SHARED END ---8<---

module.exports = {
  embedRequest, searchParams, SEARCH_SQL,
  EMBED_DIMS, SEARCH_K, SEARCH_POOL, SEARCH_RRF_K, CONTEXT_WEIGHT, SHARED_SLOTS,
};
