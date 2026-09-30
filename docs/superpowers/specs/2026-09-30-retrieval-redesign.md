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
   - three rankings of 50, fused by reciprocal rank: the question alone (0.63, or 0.9
     without history), the question with context (0.27), and an any-word keyword search
     on the question with diacritics removed on both sides (0.1);
   - the top 20, whose last places (up to 3) go to the best `kb_folders.kind = 'shared'`
     chunks not already present, ranked 0.7 / 0.3 by distance to the two vectors, but only
     if a shared chunk is at most 0.03 farther than the farthest chunk already in the list.
     No shared slots when a filter is passed.
3. Both answer prompts get the folder rule from `folderRule(kb_folders)`. The product
   comes from the question or the conversation, with no separate product line.
4. The fallback agent's knowledge-base tool keeps product names in its queries.

The keyword branch computes the folded `to_tsvector` per row at query time (a sequential
scan, fine at ~460 chunks). If the corpus grows by an order of magnitude, add a stored
folded tsvector column with a GIN index. `hybrid_search()` and the `fts` column are unused.

## Follow-up: shared slots only when relevant

The first version always filled 3 shared slots. In production, "cum pun si eu un sertar la
p300" got firmware, Bluetooth and certificate docs in them. The set then got questions
whose answer needs several facts, e.g. a drawer needs the interface line, the adapter
cable section and the service menu's TEST SERTAR. A new metric, complete@15, counts the
questions where every fact is in the top 15.

| Shared slots | hit@15 | shared@15 | complete@15 | with unrelated history: shared@15 / complete@15 |
|---|---|---|---|---|
| none | 97% | 93% | 56% | — |
| always 3 | 99% | 100% | 56% | 100% / 56% |
| margin 0.02 | 99% | 100% | 67% | 96% / 56% |
| **margin 0.03 (shipped)** | **99%** | **100%** | **67%** | **100% / 56%** |

Not fixed, and not caused by the slots: for the Partner 300 drawer the adapter cable ranks
21st and TEST SERTAR 25th, below "cash in/out of the drawer" sections.

## Follow-up: keyword branch and a 20-chunk list

The set grew to 92 questions: 9 multi-fact questions from other topics (motherboard, SD
journal card, GPRS and Wi-Fi to ANAF, fiscalization) and the last 6 production answers,
checked against the documents (2 right, 2 partly right, 2 wrong; every wrong or partial
answer lacked a needed chunk in the retrieved list).

An earlier comparison of keyword weights was wrong: the harness ran the keyword-only
ranking with an integer weight, SQL divided integers, every score was 0, and the keyword
list came out in chunk-id order. Fixed (weights are always written with decimals, and a
test forbids integer weights in `SEARCH_SQL`); the numbers below are the corrected ones.

| Design (92 questions) | found in list | MRR | all facts found | with unrelated history: all facts |
|---|---|---|---|---|
| old optimizer, hybrid AND | 91% | 0.60 | 29% | — |
| semantic, 15 | 97% | 0.82 | 57% | 43% |
| keyword 0.1 / 0.2 / 0.3, 15 | 97 / 97 / 96% | 0.80 / 0.78 / 0.76 | 57 / 57 / 52% | — |
| semantic, 20 | 97% | 0.82 | 62% | 52% |
| **keyword 0.1, 20 (shipped)** | **97%** | **0.80** | **67%** | **62%** |
| keyword 0.2, 20 | 97% | 0.78 | 67% | 62% |
| keyword 0.3, 20 | 97% | 0.76 | 71% | 67% |

Keyword 0.1 with 20 chunks loses no answer, keeps exact terms (error codes, file names)
ranked first (MRR 1.00; 0.92 at weight 0.2), and loses nothing on the non-drawer
multi-fact questions (67%, the same as semantic). Weight 0.3 completes more drawer
answers but drops the other multi-fact questions to 56%.

Still open, and not fixable by either search: answers whose second fact sits in a chapter
the first one only points to ("vezi capitolul 5"), and vague follow-ups ("si dupa ce am
montat-o?") that carry no topic of their own.

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
