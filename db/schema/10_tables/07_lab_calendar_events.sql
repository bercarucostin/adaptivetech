-- lab_calendar_events — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.lab_calendar_events
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."lab_calendar_events" (
    "lab_organization_id" uuid NOT NULL,
    "id" bigint NOT NULL DEFAULT nextval('lab_calendar_events_id_seq'::regclass),
    "title" text NOT NULL,
    "event_type" text,
    "description" text,
    "status" text,
    "created_by_user_id" text,
    "updated_by_user_id" text,
    "start_date" date NOT NULL,
    "end_date" date,
    "start_time" time,
    "created_at" timestamptz,
    "updated_at" timestamptz,
    "migrated_at" timestamptz NOT NULL DEFAULT now(),
    "calendar_scope" text NOT NULL DEFAULT 'shared'::text,
    "owner_user_id" uuid
);

ALTER TABLE "public"."lab_calendar_events" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_calendar_events_date_order_chk' AND conrelid = 'public.lab_calendar_events'::regclass) THEN
        ALTER TABLE "public"."lab_calendar_events" ADD CONSTRAINT "lab_calendar_events_date_order_chk" CHECK (end_date IS NULL OR end_date >= start_date);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_calendar_events_lab_organization_id_fkey' AND conrelid = 'public.lab_calendar_events'::regclass) THEN
        ALTER TABLE "public"."lab_calendar_events" ADD CONSTRAINT "lab_calendar_events_lab_organization_id_fkey" FOREIGN KEY (lab_organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_calendar_events_owner_user_id_fkey' AND conrelid = 'public.lab_calendar_events'::regclass) THEN
        ALTER TABLE "public"."lab_calendar_events" ADD CONSTRAINT "lab_calendar_events_owner_user_id_fkey" FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_calendar_events_pkey' AND conrelid = 'public.lab_calendar_events'::regclass) THEN
        ALTER TABLE "public"."lab_calendar_events" ADD CONSTRAINT "lab_calendar_events_pkey" PRIMARY KEY (lab_organization_id, id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lab_calendar_events_scope_chk' AND conrelid = 'public.lab_calendar_events'::regclass) THEN
        ALTER TABLE "public"."lab_calendar_events" ADD CONSTRAINT "lab_calendar_events_scope_chk" CHECK (calendar_scope = ANY (ARRAY['shared'::text, 'personal'::text]));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS lab_calendar_events_date_range_idx ON public.lab_calendar_events USING btree (lab_organization_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS lab_calendar_events_owner_idx ON public.lab_calendar_events USING btree (owner_user_id, start_date);

CREATE UNIQUE INDEX IF NOT EXISTS lab_calendar_events_pkey ON public.lab_calendar_events USING btree (lab_organization_id, id);

CREATE INDEX IF NOT EXISTS lab_calendar_events_scope_idx ON public.lab_calendar_events USING btree (lab_organization_id, calendar_scope, start_date);

CREATE INDEX IF NOT EXISTS lab_calendar_events_start_date_idx ON public.lab_calendar_events USING btree (lab_organization_id, start_date);

CREATE INDEX IF NOT EXISTS lab_calendar_events_status_idx ON public.lab_calendar_events USING btree (lab_organization_id, status);

CREATE INDEX IF NOT EXISTS lab_calendar_events_type_idx ON public.lab_calendar_events USING btree (lab_organization_id, event_type);
