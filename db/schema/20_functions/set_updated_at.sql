-- Flowrise Supabase function: public.set_updated_at()
-- Generated from the Supabase schema snapshot dated 2026-09-04.
-- The complete CREATE OR REPLACE FUNCTION definition follows.

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at=now();
  return new;
end;
$function$
;

-- Security definer: False
-- Return type: trigger
-- Identity arguments: 
