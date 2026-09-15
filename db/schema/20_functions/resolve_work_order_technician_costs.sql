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

-- The return shape gains billing_mode, so replace the prior five-column
-- function before recreating it.
DROP FUNCTION IF EXISTS public.resolve_work_order_technician_costs(uuid,bigint,text,text);

-- One row per saved work type and billing mode. Quantity comes from the same
-- frozen billing scope used by partner prices.
CREATE OR REPLACE FUNCTION public.resolve_work_order_technician_costs(
    p_lab uuid,
    p_work_order_id bigint,
    p_stage text,
    p_technician_name text
)
RETURNS TABLE (
    work_type text,
    billing_mode text,
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
    SELECT scope.work_type,
           scope.billing_mode,
           scope.quantity,
           tc.cost AS unit_cost,
           CASE WHEN tc.cost IS NULL THEN NULL ELSE round(tc.cost * scope.quantity, 2) END AS amount,
           CASE WHEN tc.cost IS NULL THEN 'missing' ELSE 'catalog' END AS cost_source
    FROM public.work_order_billing_scope(p_lab,p_work_order_id) scope
    LEFT JOIN LATERAL (
        SELECT public.resolve_technician_unit_cost(
            p_lab,p_technician_name,scope.work_type,p_stage
        ) AS cost
    ) tc ON true
    ORDER BY scope.work_type,scope.billing_mode
$$;

REVOKE ALL ON FUNCTION public.resolve_work_order_technician_costs(uuid,bigint,text,text) FROM public,authenticated;
