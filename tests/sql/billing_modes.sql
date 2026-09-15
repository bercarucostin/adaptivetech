-- Run after db/schema/apply.sql against a disposable Supabase database.
-- Canonical unit scenarios are transaction-local and require no fixture rows.
begin;

do $$
declare
    v_units jsonb;
begin
    select jsonb_agg(to_jsonb(u) order by u.billing_scope)
      into v_units
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"crown"},{"tooth_number":31,"work_type":"CROWN"}]'::jsonb,
        '[{"work_type":"Crown","billing_mode":"per_tooth"}]'::jsonb
    ) u;
    if jsonb_array_length(v_units) <> 3
       or (select array_agg(x->>'billing_scope' order by x->>'billing_scope')
           from jsonb_array_elements(v_units) x) <> array['tooth:11','tooth:12','tooth:31'] then
        raise exception 'per_tooth must return one stable unit for each configured tooth: %', v_units;
    end if;
end $$;

do $$
declare
    v_upper integer;
    v_both integer;
begin
    select count(*) into v_upper
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":28,"work_type":"bridge"}]'::jsonb,
        '[{"work_type":"BRIDGE","billing_mode":"per_arch"}]'::jsonb
    );
    select count(*) into v_both
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Bridge"},{"tooth_number":28,"work_type":"bridge"},{"tooth_number":31,"work_type":"BRIDGE"}]'::jsonb,
        '[{"work_type":"Bridge","billing_mode":"per_arch"}]'::jsonb
    );
    if v_upper <> 1 or v_both <> 2 then
        raise exception 'per_arch must return one unit per involved arch: upper %, both %', v_upper, v_both;
    end if;
end $$;

do $$
declare
    v_piece integer;
begin
    select count(*) into v_piece
    from public.derive_billing_units(
        '[{"tooth_number":11,"work_type":"Denture"},{"tooth_number":41,"work_type":"denture"}]'::jsonb,
        '[{"work_type":"DENTURE","billing_mode":"per_piece"}]'::jsonb
    );
    if v_piece <> 1 then
        raise exception 'per_piece must return one unit across both arches: %', v_piece;
    end if;
end $$;

do $$
declare
    v_items jsonb := '[{"tooth_number":11,"work_type":"Crown"},{"tooth_number":12,"work_type":"Crown"},{"tooth_number":31,"work_type":"Bridge"},{"tooth_number":32,"work_type":"Bridge"},{"tooth_number":21,"work_type":"Denture"},{"tooth_number":41,"work_type":"Denture"}]'::jsonb;
    v_units integer;
    v_elements integer;
begin
    select count(*) into v_units
    from public.derive_billing_units(
        v_items,
        '[{"work_type":"Crown","billing_mode":"per_tooth"},{"work_type":"Bridge","billing_mode":"per_arch"},{"work_type":"Denture","billing_mode":"per_piece"}]'::jsonb
    );
    select jsonb_array_length(v_items) into v_elements;
    if v_units <> 4 or v_elements <> 6 then
        raise exception 'mixed modes must derive independently while preserving clinical element_count: units %, elements %', v_units, v_elements;
    end if;
end $$;

rollback;
