-- role_permissions — table, constraints and indexes
-- Generated from the Supabase snapshot dated 2026-09-04.
-- Every statement is idempotent, so the file is safe to re-run.

-- Flowrise Supabase schema split: public.role_permissions
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- Review dependency order before running on an empty database.

CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "role" text NOT NULL,
    "work_order_scope" text NOT NULL,
    "can_view_work_orders" boolean NOT NULL DEFAULT false,
    "can_view_production" boolean NOT NULL DEFAULT false,
    "can_view_partners" boolean NOT NULL DEFAULT false,
    "can_view_technicians" boolean NOT NULL DEFAULT false,
    "can_create_work_orders" boolean NOT NULL DEFAULT false,
    "can_edit_all_work_orders" boolean NOT NULL DEFAULT false,
    "can_edit_own_stage_status" boolean NOT NULL DEFAULT false,
    "can_assign_technicians" boolean NOT NULL DEFAULT false,
    "can_view_client_pricing" boolean NOT NULL DEFAULT false,
    "can_view_other_technician_costs" boolean NOT NULL DEFAULT false,
    "can_view_own_technician_cost" boolean NOT NULL DEFAULT false,
    "can_edit_payment_status" boolean NOT NULL DEFAULT false,
    "can_edit_global_status" boolean NOT NULL DEFAULT false,
    "can_access_backend" boolean NOT NULL DEFAULT false,
    "ai_flow" text,
    "active" boolean NOT NULL DEFAULT true,
    "can_edit_partner_work_orders" boolean NOT NULL DEFAULT false,
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_pkey' AND conrelid = 'public.role_permissions'::regclass) THEN
        ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY (role);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_pkey ON public.role_permissions USING btree (role);
