# Agent reliability hardening — design

Date: 2026-08-05
Scope: [workflows/agent.json](../../../workflows/agent.json) only

## Context

The WhatsApp support agent works and has produced no known user-visible failures. This change is
hardening by inspection, not incident response — which sets the posture: make the smallest set of
changes that remove real hazards, and add no machinery for problems that have not been observed.

Reading the 48-node workflow surfaced three hazards. Two are live enough to act on now, given that
the Supabase instance backing this system has been unstable and was the subject of a week of
remediation.

1. **Persistence runs before delivery.** The tail is
   `Prepare Memory Rows → Save Memory4 → Format Reply → Send User Reply`. A Postgres failure at
   `Save Memory4` aborts the request *after* the LLM has produced a good answer but *before* the user
   receives it. The customer pays for the call and gets a generic error.

2. **Seven external calls run without retries.** `Retrieve Docs`, `Load Chat History`,
   `Send User Reply`, `Save Memory4`, `Save Conversation`, `Send Escalation WhatsApp1` and
   `Email Support Team` have neither `retryOnFail` nor `onError`. Any transient blip becomes a failed
   request. (`Optimize Query`, `Primary Answer` and the media nodes already retry.)

3. **A knowledge-base outage is indistinguishable from any other crash.** When `Retrieve Docs` fails,
   the error workflow sends a generic message. The user cannot tell a transient outage from a broken
   bot.

### Deliberately out of scope

Webhook idempotency, retrieval tuning, cost/latency, and version control. In particular, no dedup
guard is added: no duplicate reply has ever been observed, and n8n's WhatsApp trigger is believed to
acknowledge the webhook before processing, which would mean Meta never retries into a re-run. That
belief is untested. If it is later disproved, idempotency becomes its own spec rather than
speculative machinery bolted onto this one.

## Design

### 1. Delivery before persistence

Rewire the tail so the user is served before anything is recorded:

| | Order |
|---|---|
| Now | `Prepare Memory Rows → Save Memory4 → Format Reply → Send User Reply → Save Conversation` |
| After | `Prepare Memory Rows → Format Reply → Send User Reply → Save Conversation → Save Memory4` |

`Format Reply & Detect Escalation1` already reads `$('Prepare Memory Rows').first().json` by node
name rather than from its immediate input, so removing `Save Memory4` from in front of it changes
nothing for it. Its fan-out to `Needs Human Support?1` and `Send User Reply` is unchanged.

**`Save Memory4` must have its expressions rewritten.** It currently reads `$json.session_id`,
`$json.wa_question_id`, `$json.from`, `$json.human_message`, `$json.ai_message` from its direct
input. Once it sits after `Save Conversation`, `$json` is a Postgres result. Each becomes
`$('Prepare Memory Rows').first().json.<field>` — the same pattern `Format Reply` uses.

`Save Conversation` stays immediately after `Send User Reply` so its `$json.messages[0].id` still
resolves to the WhatsApp send response, and takes `onError: continueRegularOutput` so that a failure
writing the message-link row cannot block the chat-history write behind it. Chat history is the more
valuable of the two: losing it degrades the next turn's context, whereas the link row only feeds
reaction mapping.

Net effect: a Supabase failure costs a memory row instead of the answer.

### 2. Retry coverage

Add `retryOnFail` to the seven nodes listed above.

`Load Chat History` additionally takes `onError: continueRegularOutput`. No change to `Build Prompt`
is needed — it already guards with `if (!msg || !msg.content) continue`, so the error item n8n emits
is skipped and the conversation proceeds with no history rather than failing. Verify this rather than
assume it; it is the one place where a node setting depends on downstream code tolerating it.

### 3. Knowledge base unavailable

`Retrieve Docs` takes `onError: continueErrorOutput`, adding a second output routed to a WhatsApp
send carrying a fixed Romanian + English "temporarily unavailable, please try again shortly" message.

**This is not the same as retrieval returning nothing.** `"No relevant documentation found."` is a
legitimate result: it already flows through the `Failed?` node into the `AI Agent1` fallback, which
can search again using its own Knowledge Base tool. Routing empty results to an outage message would
fire on the common case — a question the knowledge base genuinely cannot answer — and would be a
worse error than the one being fixed. The two paths must stay separate.

The message is fixed text, not translated. Language detection happens inside the LLM call, which is
downstream of the failure; adding an LLM call to a path that is already failing adds a second point
of failure. Romanian plus English matches the deployment — the ingestion prompts are Romanian and
`GENERIC_TIMEZONE` is `Europe/Bucharest`.

## Verification

There is no test framework in this repo, so verification is manual and works by deliberately
breaking things — each check should fail in the specific way predicted, not merely "still work".

1. **Reorder holds under DB failure.** Point the Postgres credential at an unreachable host, send a
   message. Expect: the reply arrives; only the memory write fails. This is the entire point of the
   change and must be tested by actually breaking the database, not by inspection.
2. **Unavailable branch fires.** Deactivate the hybrid-search sub-workflow, send a message. Expect
   the bilingual notice, not the generic error-workflow message.
3. **No-results path is unaffected.** Ask something genuinely absent from the knowledge base. Expect
   the normal agent-fallback answer — *not* the outage notice. This guards the most likely regression.
4. **History degrades cleanly.** Break only `Load Chat History`. Expect a normal answer, and
   specifically not a reply claiming the bot has no memory of the conversation (system prompt rules
   forbid that phrasing, so its appearance would indicate the error item reached the model).
5. **Restore all credentials** and send one normal message end to end, confirming reply, memory row,
   and message-link row all land.
