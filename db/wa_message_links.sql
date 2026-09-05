-- Links a user's inbound WhatsApp question message to the bot's outbound answer message.
-- Written by agent.json "Save Conversation" after a reply is sent, and joined in the
-- reaction/expert-feedback flow ("AI_Whisper") to resolve which message a reaction targets.
create table public.wa_message_links (
  id bigserial not null,
  wa_question_id text not null,
  wa_answer_id text null,
  created_at timestamp with time zone not null default now(),
  constraint wa_message_links_pkey primary key (id),
  constraint wa_message_links_wa_question_id_key unique (wa_question_id)
) TABLESPACE pg_default;

create index if not exists wa_message_links_wa_answer_id_idx
  on public.wa_message_links using btree (wa_answer_id) TABLESPACE pg_default;
