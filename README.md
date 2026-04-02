# WhatsApp RAG Support Bot — n8n Linear Flow

A production-ready WhatsApp AI support bot built with [n8n](https://n8n.io), combining **Retrieval-Augmented Generation (RAG)**, **persistent conversation memory**, **image analysis**, and **human escalation** — all in a single linear workflow.

---

## Features

- **Text message handling** — Receives WhatsApp text messages and routes them through a full RAG pipeline
- **Image message handling** — Downloads, resizes, and analyses images using GPT-4o vision
- **Semantic RAG retrieval** — Queries a Supabase vector store using the user's actual question for contextually relevant documentation chunks
- **Persistent chat memory** — Stores and retrieves full conversation history per user via PostgreSQL
- **Synchronized prompt building** — A Merge node ensures both chat history and RAG results are ready before the prompt is assembled
- **Human escalation** — Detects `CODE_ESCALATE` in AI responses and emails the support team automatically
- **Product-aware responses** — Handles multiple product lines (e.g. Partner 200, Partner 600)
- **Multilingual** — Replies in the same language as the user

---

## Architecture

### Text Message Flow

```
WhatsApp Trigger
      │
      ▼
   If (text message?)
      │ YES
      ▼
  Edit Fields (extract: from, question, sessionId)
      │
      ├──────────────────────────────────┐
      ▼                                  ▼
Get Chat History (Postgres)     Supabase Vector Store (semantic search)
      │                                  │
      ▼                                  ▼
  Tag History (source=history)    Tag RAG (source=rag)
      │                                  │
      └──────────────┬───────────────────┘
                     ▼
            Merge History & RAG
                     │
                     ▼
             Build Prompt (Python)
             - Parses history items
             - Assembles RAG chunks
             - Constructs full prompt
                     │
                     ▼
               LLM Chain (gpt-4.1-mini)
                     │
                     ▼
             Save Memory (Postgres)
             - Saves human + AI turns
                     │
                     ▼
     Format Reply & Detect Escalation
                     │
                     ▼
          Needs Human Support? (IF)
           │                  │
           │ YES              │ NO
           ▼                  ▼
    Email Support Team   Prepare Final Message
           │                  │
           └────────┬─────────┘
                    ▼
             Send Message (WhatsApp)
```

### Image Message Flow

```
WhatsApp Trigger
      │
      ▼
   If (image message?)
      │ YES
      ├──────────────────────┐
      ▼                      ▼
Get Image URL (Graph API)  Set sessionID
      │                      │
      ▼                      │
Download Image Binary        │
      │                      │
      ▼                      │
  Resize Image (50%)         │
      │                      │
      └──────────┬───────────┘
                 ▼
        Merge ID and Image
                 │
                 ▼
        AI Agent - Image (gpt-4o)
        + Postgres Memory
        + Supabase RAG Tool
                 │
                 ▼
        Format Image Reply
                 │
                 ▼
     Prepare Final Message - Image
                 │
                 ▼
        Send Image Reply (WhatsApp)
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Workflow engine | [n8n](https://n8n.io) |
| WhatsApp API | Meta Cloud API (via n8n node) |
| LLM (text) | OpenAI `gpt-4.1-mini` |
| LLM (image) | OpenAI `gpt-4o` (vision) |
| Vector store | Supabase (pgvector) |
| Embeddings | OpenAI Embeddings |
| Chat memory | PostgreSQL (`n8n_chat_histories`) |
| Escalation | Gmail |

---

## Key Design Decisions

### Why a Merge node before Build Prompt?
In n8n, if two branches both connect to the same downstream node, that node fires **once per branch** — not once with both results combined. Without the Merge node, `Build Prompt` would execute twice: once with only history, once with only RAG chunks. The **Merge History & RAG** node synchronizes both branches so `Build Prompt` always has the full context.

### Why source-tagging (Tag History / Tag RAG)?
After merging, all items arrive in a single array. The `source` field (`history` or `rag`) lets the Python code in `Build Prompt` correctly separate history rows from RAG chunks without relying on item order or index position.

### Why is the Supabase prompt dynamic?
The original workflow used a static string as the Supabase vector search query. This has been fixed to use the user's actual message so semantic search returns genuinely relevant documentation.

### Why gpt-4o for images?
`gpt-4o` supports vision (multimodal input). The previously configured `gpt-5.2` model does not exist and would cause runtime errors.

---

## Database Schema

```sql
-- Chat history table
CREATE TABLE n8n_chat_histories (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  message     JSONB NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chat_histories_session ON n8n_chat_histories (session_id, created_at DESC);

-- Documents table (managed by Supabase + pgvector)
CREATE TABLE documents (
  id        BIGSERIAL PRIMARY KEY,
  content   TEXT,
  metadata  JSONB,
  embedding VECTOR(1536)
);

-- Required match function for vector search
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1536),
  match_count     INT DEFAULT 10
)
RETURNS TABLE (id BIGINT, content TEXT, metadata JSONB, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.content, d.metadata,
         1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

---

## Setup

### Prerequisites
- n8n instance (self-hosted or cloud)
- Meta Developer App with WhatsApp Cloud API access
- OpenAI API key
- Supabase project with pgvector enabled
- PostgreSQL database (can be same as Supabase)
- Gmail account (for escalation emails)

### Steps

1. **Import the workflow**
   - In n8n, go to **Workflows → Import**
   - Upload `WhatsApp Bot - Linear Flow.json`

2. **Configure credentials** in n8n:

   | Credential | Used by |
   |---|---|
   | WhatsApp OAuth (Trigger) | `WhatsApp Trigger1` |
   | WhatsApp API | `Send message`, `Send Image Reply` |
   | OpenAI API | All OpenAI nodes |
   | Supabase API | Both Supabase Vector Store nodes |
   | Postgres | `Get Chat History`, `Save Memory`, `Postgres Chat Memory3` |
   | Gmail OAuth2 | `Email Support Team` |

3. **Set your WhatsApp Phone Number ID**
   - Find it in your Meta Developer dashboard
   - Update the `phoneNumberId` field in both `Send message` and `Send Image Reply` nodes

4. **Update the escalation email**
   - In the `Email Support Team` node, update the `sendTo` field to your support team's address

5. **Replace the Bearer token**
   - In `Get Image URL` and `Download Image Binary`, replace the hardcoded `Bearer` token with your Meta access token
   - Store this as an n8n credential or environment variable rather than hardcoding it

6. **Populate your Supabase vector store**
   - Upload your technical documentation to the `documents` table
   - Use n8n's Supabase Vector Store node (insert mode) or a separate ingestion workflow
   - Aim for ~500 tokens per chunk for best retrieval quality

7. **Activate the workflow**

---

## Escalation Flow

When a user types something like *"I want to speak to a human"* or *"connect me to an agent"*, the LLM begins its reply with `CODE_ESCALATE`. The workflow then:

1. Strips `CODE_ESCALATE` from the reply before sending it to the user
2. Emails the support team with the user's phone number, original question, and the AI's response
3. Delivers the cleaned AI reply to the user as normal

---

## Prompt Rules

The `Build Prompt` node constructs a structured prompt with:

- Full conversation history (last 10 turns from Postgres)
- Top 10 semantically relevant documentation chunks from Supabase
- 12 behavioral rules covering: documentation-first answers, language matching, escalation detection, vague question handling, product-specific awareness, reply length limits, and professional tone

---

## Notes & Recommendations

- **Secure your tokens** — Move the hardcoded Meta Bearer token to an n8n HTTP Header Auth credential
- **Index your Postgres table** — Add an index on `(session_id, created_at DESC)` for fast history queries at scale
- **Monitor token usage** — `gpt-4o` is more expensive than `gpt-4.1-mini`; consider rate limiting for high-volume deployments
- **RAG chunk quality** — Answer quality depends on the documentation in Supabase; keep it clean, well-chunked (~500 tokens), and up to date

---

## License

Private — internal use only.