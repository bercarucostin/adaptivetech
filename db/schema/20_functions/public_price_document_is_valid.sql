-- Flowrise Supabase function: public.public_price_document_is_valid(p_document jsonb)
-- Structural validation for a published public price list. The browser editor
-- applies the same rules so an admin sees problems inline, but this is the
-- authority: it backs a CHECK constraint, so no client can store a document that
-- fails it.
--
-- IMMUTABLE because it reads nothing but its argument -- which is also what makes
-- it legal in a CHECK constraint.

CREATE OR REPLACE FUNCTION public.public_price_document_is_valid(p_document jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
    v_group jsonb;
    v_row jsonb;
    v_titles text[] := array[]::text[];
    v_title text;
    v_rows int := 0;
    v_amount numeric;
begin
    if p_document is null or jsonb_typeof(p_document) <> 'object' then return false; end if;
    -- The bound is the number 1, not the string "1"; jsonb equality distinguishes them.
    if p_document->'schema' is distinct from '1'::jsonb then return false; end if;

    -- currency: required string, 1..8 characters. `->>` returns text for any jsonb
    -- type (an object, array or number all serialize to some text), so the length
    -- check alone would accept a non-string; the type gate closes that.
    if jsonb_typeof(p_document->'currency') is distinct from 'string' then return false; end if;
    if coalesce(length(p_document->>'currency'), 0) not between 1 and 8 then return false; end if;

    -- the two notes may be absent entirely, but if present must be a string (or
    -- json null, which reads back as empty) and not long
    if p_document ? 'intro_note' then
        if jsonb_typeof(p_document->'intro_note') not in ('string', 'null') then return false; end if;
        if coalesce(length(p_document->>'intro_note'), 0) > 400 then return false; end if;
    end if;

    if p_document ? 'footnote' then
        if jsonb_typeof(p_document->'footnote') not in ('string', 'null') then return false; end if;
        if coalesce(length(p_document->>'footnote'), 0) > 400 then return false; end if;
    end if;

    -- A missing key makes `->` yield SQL NULL, so `jsonb_typeof(NULL) <> 'array'`
    -- is itself NULL -- and a NULL condition silently skips the branch instead
    -- of rejecting the document. `is distinct from` treats a missing key as a
    -- real mismatch, so it is rejected as intended.
    if jsonb_typeof(p_document->'groups') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_document->'groups') = 0 then return false; end if;

    for v_group in select jsonb_array_elements(p_document->'groups') loop
        if jsonb_typeof(v_group) <> 'object' then return false; end if;

        -- title: required string, 1..80 characters, unique within the document.
        if jsonb_typeof(v_group->'title') is distinct from 'string' then return false; end if;
        v_title := v_group->>'title';
        if coalesce(length(v_title), 0) not between 1 and 80 then return false; end if;
        if v_title = any (v_titles) then return false; end if;
        v_titles := v_titles || v_title;

        if jsonb_typeof(v_group->'rows') is distinct from 'array' then return false; end if;

        for v_row in select jsonb_array_elements(v_group->'rows') loop
            if jsonb_typeof(v_row) <> 'object' then return false; end if;

            v_rows := v_rows + 1;
            if v_rows > 200 then return false; end if;

            -- item: required string, 1..200 characters.
            if jsonb_typeof(v_row->'item') is distinct from 'string' then return false; end if;
            if coalesce(length(v_row->>'item'), 0) not between 1 and 200 then return false; end if;

            -- variant and row currency: optional, but if the key is present at all
            -- it must be a string of valid length -- an explicit null is rejected,
            -- matching the browser mirror and the editor, which deletes the key
            -- instead of ever writing null.
            if v_row ? 'variant' then
                if jsonb_typeof(v_row->'variant') <> 'string' then return false; end if;
                if coalesce(length(v_row->>'variant'), 0) not between 1 and 60 then return false; end if;
            end if;

            if v_row ? 'currency' then
                if jsonb_typeof(v_row->'currency') <> 'string' then return false; end if;
                if coalesce(length(v_row->>'currency'), 0) not between 1 and 8 then return false; end if;
            end if;

            if v_row ? 'footnote' and jsonb_typeof(v_row->'footnote') not in ('boolean', 'null') then
                return false;
            end if;

            if jsonb_typeof(v_row->'amount') is distinct from 'number' then return false; end if;
            v_amount := (v_row->>'amount')::numeric;
            if v_amount < 0 or v_amount > 1000000 then return false; end if;
            -- scale() reports the stored display scale, and jsonb preserves a
            -- literal's trailing zeros, so 1.500 would fail scale(v_amount) > 2
            -- even though it is a legitimate two-decimal price. Compare values
            -- instead, matching the browser's Math.round(amount*100) check.
            if v_amount <> round(v_amount, 2) then return false; end if;
        end loop;
    end loop;

    return true;
end;
$function$
;

-- Security definer: False
-- Return type: boolean
-- Identity arguments: p_document jsonb
