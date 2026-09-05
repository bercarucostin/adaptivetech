-- Stores the emoji reaction a user placed on a WhatsApp message, plus the AI's
-- interpretation of that reaction (positive/negative accuracy signal).
-- Upserted by agent.json "Save Memory2" (ON CONFLICT (wa_message_id)) and cleared by
-- "Save Memory3" when a reaction is removed; consumed by the "AI_Whisper" feedback flow.
create table public.wa_reaction_links (
  wa_message_id text not null,
  wa_reaction text null,
  wa_ai_interpretation_context text null,
  created_at timestamp with time zone not null default now(),
  constraint wa_reaction_links_pkey primary key (wa_message_id)
) TABLESPACE pg_default;
