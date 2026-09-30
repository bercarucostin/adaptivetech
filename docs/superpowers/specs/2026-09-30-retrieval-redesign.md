# Retrieval redesign: measured, not guessed

Date: 2026-09-30. Supersedes the retrieval half of
`2026-09-30-scope-aware-retrieval-design.md` (the optimizer's `scope`, the product-free
queries and the `USER'S PRODUCT` line). The folder classification (`kb_folders`, filled by
ingestion) stays: the new search uses it.

## Why

"cum adaug sertar la partner 200" got a Partner 600 answer. Tracing the execution showed
the optimizer had rewritten the question into English, the keyword search (every word must
match) returned nothing, and the search never used the product. Rather than patch each
symptom, we built an evaluation set and measured.

## How it was measured

`evaluation/questions.json`: 74 questions, each with the chunks that answer it, written as
SQL selectors so the set survives re-ingestion.

- 10 shared-doc topics with no product, 7 of those with a product named
- 17 product-specific questions and 8 exact-term questions (error codes, tool and file names)
- 5 product-less questions whose answer differs per product, and 3 follow-ups
- 24 real questions taken from `n8n_chat_histories`

`evaluation/retrieval-eval.js` replays retrieval variants against the live `documents`
table (read-only) and reports hit@5, hit@15 (the 15 chunks the answer model sees), MRR,
own-product and shared-doc hits.

## What we found

| Variant | hit@15 | MRR | real questions hit@15 |
|---|---|---|---|
| Production until now: optimizer + hybrid search, every keyword must match | 93% | 0.66 | 92% |
| Keyword search alone, every word must match | 10% | 0.08 | — |
| Keyword search alone, any word | 86% | 0.57 | — |
| Semantic search, question as typed | 97% | 0.83 | 92% |
| **Shipped** (below) | **99%** | **0.85** | **96%** |
| Shipped, with an unrelated earlier message added to every question | 96% | 0.79 | 92% |

- **The optimizer hurt.** It stripped product names (by design) and sometimes translated
  to English. Product-named questions fell to 82% hit@15 and MRR 0.41. The chunk labels
  and embedding titles carry the folder name, so a product name left in the query is
  what pulls that product's chunks up.
- **The keyword branch added nothing.** "Every word" almost never matched. "Any word" and
  lower weights (20%, 35%) all lowered MRR, even on error codes and file names. Diacritic
  folding made no measurable difference.
- **Follow-ups need the previous message, but prepending it always is dangerous.** It
  fixes "Dar P300?" and "partner 200 am", but an unrelated earlier message dropped hit@15
  to 84%. Fusing the two rankings keeps the gain and most of the robustness.
- **A named product can crowd out shared documentation.** "touch evo … interfata GPRS"
  filled 14 of 15 slots with Touch EVO chunks. Reserving slots for shared folders fixed it.

## The shipped design

`lib/semantic-search.js` (hybrid-search-tool) and `lib/retrieval-context.js` (agent):

1. No optimizer. `Build Search Request` sends the question as typed, plus the previous user
   message followed by the question (`context_query`) when there is history.
2. `hybrid-search-tool` embeds both in one `batchEmbedContents` call and runs `SEARCH_SQL`:
   - two semantic rankings of 50, fused by reciprocal rank at 0.7 (question) and 0.3
     (with context);
   - the top 15, whose last 3 places go to the best `kb_folders.kind = 'shared'` chunks not
     already present, ranked the same 0.7 / 0.3 way. No shared slots when a filter is passed.
3. Both answer prompts get the folder rule from `folderRule(kb_folders)`. The product
   comes from the question or the conversation, with no separate product line.
4. The fallback agent's knowledge-base tool keeps product names in its queries.

`hybrid_search()` and the `fts` column stay in the database, unused, so the keyword
branch can be measured again.

## Known data gaps (not retrieval problems)

- The Partner 200 user manual was extracted without most of its content: its sections
  5.3/5.4 are empty headings, and it has no interface or sales sections. Questions on those
  topics can only be answered from other models' manuals.
- `DOCUMENTATIE COMUNA` has no document about connecting a cash drawer. Each model's
  "Interfețe" section or spec sheet covers it.

## Re-running

```
npm install --prefix evaluation pg
EVAL_DB_CONFIG=<pg json> GEMINI_KEY_FILE=<file> ANTHROPIC_KEY_FILE=<file> \
  node evaluation/retrieval-eval.js run shipped prod
node evaluation/retrieval-eval.js detail shipped      # per-question ranks
node evaluation/retrieval-eval.js check               # the answer chunks per question
```

Add a question whenever a real one is answered badly; keep the answer selectors checked
against the corpus with `check`.
