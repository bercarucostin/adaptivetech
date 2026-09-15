-- Internal clinical read model. The compatibility flag is retained for callers,
-- but commercial values are available only through get_work_order_price_lines().
CREATE OR REPLACE FUNCTION public.work_order_item_scope(p_lab uuid,p_order bigint,p_include_prices boolean DEFAULT false)
RETURNS TABLE(items jsonb,work_types text[],work_type_summary text,element_count numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT coalesce((SELECT jsonb_agg(
        jsonb_build_object('tooth_number',i.tooth_number,'work_type',i.work_type,'quantity',i.quantity)
        ORDER BY i.tooth_number)
        FROM public.lab_work_order_items i WHERE i.lab_organization_id=p_lab AND i.work_order_id=p_order),'[]'::jsonb),
        coalesce((SELECT array_agg(t.work_type ORDER BY t.first_tooth,t.work_type) FROM
            (SELECT work_type,min(tooth_number) first_tooth FROM public.lab_work_order_items
             WHERE lab_organization_id=p_lab AND work_order_id=p_order GROUP BY work_type) t),ARRAY[]::text[]),
        (SELECT string_agg(t.work_type,' / ' ORDER BY t.first_tooth,t.work_type) FROM
            (SELECT work_type,min(tooth_number) first_tooth FROM public.lab_work_order_items
             WHERE lab_organization_id=p_lab AND work_order_id=p_order GROUP BY work_type) t),
        coalesce((SELECT count(*) FROM public.lab_work_order_items WHERE lab_organization_id=p_lab AND work_order_id=p_order),0)
$$;
REVOKE ALL ON FUNCTION public.work_order_item_scope(uuid,bigint,boolean) FROM public,authenticated;
