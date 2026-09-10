-- Canonical catalog lookup shared by assignment creation and scope adjustments.
CREATE OR REPLACE FUNCTION public.resolve_technician_unit_cost(
    p_lab uuid,
    p_technician_name text,
    p_work_type text,
    p_stage text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tc.cost
    FROM public.lab_technician_costs tc
    WHERE tc.lab_organization_id = p_lab
      AND regexp_replace(lower(trim(tc.tehnician)), '[[:space:]]+', ' ', 'g')
          = regexp_replace(lower(trim(p_technician_name)), '[[:space:]]+', ' ', 'g')
      AND regexp_replace(lower(trim(tc.tip_lucrare)), '[[:space:]]+', ' ', 'g')
          = regexp_replace(lower(trim(p_work_type)), '[[:space:]]+', ' ', 'g')
      AND CASE lower(trim(p_stage))
          WHEN 'model' THEN regexp_replace(lower(coalesce(tc.etapa,'')), '[^a-z0-9]', '', 'g') = 'model'
          WHEN 'modelare' THEN regexp_replace(lower(coalesce(tc.etapa,'')), '[^a-z0-9]', '', 'g') = 'modelare'
          WHEN 'cer_fin' THEN regexp_replace(lower(coalesce(tc.etapa,'')), '[^a-z0-9]', '', 'g')
              IN ('cerfin','ceramicafinisare','ceramicfinisare')
          ELSE false
      END
    ORDER BY tc.source_row_no
    LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_technician_unit_cost(uuid,text,text,text) FROM public,authenticated;

-- One row per selected work type. Quantity is the number of configured teeth
-- carrying that type; amount is the frozen technician cost for the stage.
CREATE OR REPLACE FUNCTION public.resolve_work_order_technician_costs(
    p_lab uuid,
    p_work_order_id bigint,
    p_stage text,
    p_technician_name text
)
RETURNS TABLE (
    work_type text,
    quantity numeric,
    unit_cost numeric,
    amount numeric,
    cost_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH normalized_scope AS (
        SELECT i.work_type,i.quantity,
               regexp_replace(lower(trim(i.work_type)), '[[:space:]]+', ' ', 'g') AS work_type_key
        FROM public.lab_work_order_items i
        WHERE i.lab_organization_id = p_lab
          AND i.work_order_id = p_work_order_id
    ), scope AS (
        SELECT min(work_type) AS work_type,work_type_key,sum(quantity)::numeric AS quantity
        FROM normalized_scope
        GROUP BY work_type_key
    )
    SELECT scope.work_type,
           scope.quantity,
           tc.cost AS unit_cost,
           CASE WHEN tc.cost IS NULL THEN NULL ELSE round(tc.cost * scope.quantity, 2) END AS amount,
           CASE WHEN tc.cost IS NULL THEN 'missing' ELSE 'catalog' END AS cost_source
    FROM scope
    LEFT JOIN LATERAL (
        SELECT public.resolve_technician_unit_cost(
            p_lab,p_technician_name,scope.work_type,p_stage
        ) AS cost
    ) tc ON true
    ORDER BY scope.work_type
$$;

REVOKE ALL ON FUNCTION public.resolve_work_order_technician_costs(uuid,bigint,text,text) FROM public,authenticated;
