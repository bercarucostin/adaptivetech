-- Bounded dashboard read. The materialized date/role scope precedes item and cost work.
-- Absent reception boundaries default to today-89/today in Europe/Bucharest;
-- explicit JSON null disables each boundary. All date endpoints are inclusive.
-- Facets use date/role/hide-old/maximum-id scope before text/column selections.
-- Summary covers every filtered row, independent of LIMIT/OFFSET. Unknown prices
-- or authorized stage amounts keep the corresponding financial total NULL.
-- v188 row fields retain their existing masks. salary_stages adds only the
-- current technician's assignment history (the legacy get_my_salary shape).
-- selected_technician_cost is management's chosen technician amount or the
-- current technician's own active assignments; other roles always receive NULL.
-- Nonempty unsupported column filters and invalid sorts are rejected.
-- maximum_id can anchor a multi-request export against later inserts; it is
-- not a transactional snapshot of edits/deletions between requests.
CREATE OR REPLACE FUNCTION public.get_work_orders_page(p_lab_organization_id uuid,p_filters jsonb DEFAULT '{}'::jsonb,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $function$
DECLARE
 mg boolean:=public.is_lab_management(p_lab_organization_id);
 dash boolean:=public.is_lab_dashboard(p_lab_organization_id);
 tech boolean:=public.is_lab_technician(p_lab_organization_id);
 doc boolean:=public.is_connected_doctor_for_lab(p_lab_organization_id);
 tech_name text:=lower(trim(coalesce(public.current_technician_name(),'')));
 today date:=(now() AT TIME ZONE 'Europe/Bucharest')::date;
 rf date; rt date; df date; dt date; uf date; ut date;
 k text; val text; pair text[]; columns_map jsonb:='{"id": "id", "status": "status", "patient": "nume_pacient", "partner": "nume_partener", "contract": "contract", "workType": "work_type_summary", "elements": "element_count", "listPrice": "list_price", "discount": "discount", "finalPrice": "final_price", "modelTech": "tehnician_model", "statusModel": "status_model", "modelingTech": "tehnician1_modelare", "statusModeling": "status_modelare", "ceramicTech": "tehnician2_cer_fin", "statusCerFin": "status_cer_fin", "deadline": "deadline", "receptionDate": "reception_date", "lastUpdate": "updated_at", "ownCost": "own_cost", "selectedCost": "selected_technician_cost", "stages": "own_stages"}'::jsonb;
 sort_col text; sort_dir text; predicates text:='true'; result jsonb;
 numeric_keys text[]:=ARRAY['id','elements','listPrice','discount','finalPrice','ownCost','selectedCost'];
 match text[];
BEGIN
 IF NOT coalesce(mg OR dash OR tech OR doc,false) THEN RAISE EXCEPTION 'Access denied'; END IF;
 p_filters:=coalesce(p_filters,'{}'::jsonb);
 IF jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'Filters must be an object'; END IF;
 IF coalesce(p_filters->>'technician','')<>'' AND NOT coalesce(mg OR tech OR dash,false) THEN RAISE EXCEPTION 'Access denied'; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Invalid pagination'; END IF;
 p_limit:=least(p_limit,200);
 FOREACH k IN ARRAY ARRAY['reception_from','reception_to','deadline_from','deadline_to','last_update_from','last_update_to'] LOOP
  val:=p_filters->>k;
  IF val IS NOT NULL THEN
   IF val !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid date for %',k; END IF;
   PERFORM val::date;
  END IF;
 END LOOP;
 rf:=CASE WHEN p_filters?'reception_from' THEN (p_filters->>'reception_from')::date ELSE today-89 END;
 rt:=CASE WHEN p_filters?'reception_to' THEN (p_filters->>'reception_to')::date ELSE today END;
 df:=(p_filters->>'deadline_from')::date; dt:=(p_filters->>'deadline_to')::date;
 uf:=(p_filters->>'last_update_from')::date; ut:=(p_filters->>'last_update_to')::date;
 IF rf>rt OR df>dt OR uf>ut THEN RAISE EXCEPTION 'Date range is reversed'; END IF;
 IF p_filters?'hide_old' AND jsonb_typeof(p_filters->'hide_old') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'hide_old must be boolean'; END IF;
 IF p_filters?'status_in' AND jsonb_typeof(p_filters->'status_in')<>'array' THEN RAISE EXCEPTION 'status_in must be an array'; END IF;
 IF p_filters?'maximum_id' THEN PERFORM (p_filters->>'maximum_id')::bigint; END IF;
 sort_col:=columns_map->>coalesce(p_filters->>'sort_key','id');
 sort_dir:=lower(coalesce(p_filters->>'sort_dir','desc'));
 IF sort_col IS NULL OR sort_dir NOT IN ('asc','desc') THEN RAISE EXCEPTION 'Invalid sort'; END IF;
 IF p_filters?'columns' AND jsonb_typeof(p_filters->'columns')<>'object' THEN RAISE EXCEPTION 'columns must be an object'; END IF;
 FOR k,val IN SELECT key,value FROM jsonb_each_text(coalesce(p_filters->'columns','{}'::jsonb)) LOOP
  IF coalesce(trim(val),'')='' THEN CONTINUE; END IF;
  IF NOT columns_map?k THEN RAISE EXCEPTION 'Unsupported column filter: %',k; END IF;
  match:=regexp_match(trim(val),'^(>=|<=|>|<|=)\s*(-?\d+(\.\d+)?)$');
  IF k=ANY(numeric_keys) AND match IS NOT NULL THEN
   predicates:=predicates||format(' AND coalesce(%I,0) %s %L::numeric',columns_map->>k,match[1],match[2]);
  ELSE
   predicates:=predicates||format(' AND strpos(lower(coalesce(%I::text,'''') ),lower(%L))>0',columns_map->>k,trim(val));
  END IF;
 END LOOP;
 EXECUTE format($query$
 WITH base AS MATERIALIZED (
  SELECT wo.* FROM public.lab_work_orders wo
  WHERE wo.lab_organization_id=$1 AND wo.archived_at IS NULL
   AND ($3 OR $4 OR ($5 AND $7 IN (lower(trim(coalesce(wo.tehnician_model,''))),lower(trim(coalesce(wo.tehnician1_modelare,''))),lower(trim(coalesce(wo.tehnician2_cer_fin,'')))) ) OR ($6 AND public.doctor_matches_partner(wo.nume_partener)))
   AND ($8 IS NULL OR coalesce(wo.data_receptie,wo.created_at)>=($8::timestamp AT TIME ZONE 'Europe/Bucharest'))
   AND ($9 IS NULL OR coalesce(wo.data_receptie,wo.created_at)<(($9+1)::timestamp AT TIME ZONE 'Europe/Bucharest'))
   AND ($10 IS NULL OR wo.deadline >= $10) AND ($11 IS NULL OR wo.deadline <= $11)
   AND ($12 IS NULL OR wo.updated_at>=($12::timestamp AT TIME ZONE 'Europe/Bucharest'))
   AND ($13 IS NULL OR wo.updated_at<(($13+1)::timestamp AT TIME ZONE 'Europe/Bucharest'))
   AND (NOT coalesce(($2->>'hide_old')::boolean,false) OR NOT coalesce(wo.deadline<$14 AND wo.status IN ('Finished','Shipped','List Sent','Paid'),false))
   AND (NOT $2?'status_in' OR wo.status IN (SELECT jsonb_array_elements_text($2->'status_in')))
   AND ($2->>'maximum_id' IS NULL OR wo.id<=($2->>'maximum_id')::bigint)
 ), clinical AS MATERIALIZED (
  SELECT b.*,i.work_types,i.work_type_summary,i.element_count FROM base b
  CROSS JOIN LATERAL (
   SELECT coalesce(array_agg(t.work_type ORDER BY t.first_tooth,t.work_type),ARRAY[]::text[]) work_types,
    string_agg(t.work_type,' / ' ORDER BY t.first_tooth,t.work_type) work_type_summary,coalesce(sum(t.n),0) element_count
   FROM (SELECT work_type,min(tooth_number) first_tooth,count(*) n FROM public.lab_work_order_items WHERE lab_organization_id=$1 AND work_order_id=b.id GROUP BY work_type) t
  ) i
 ), selected AS MATERIALIZED (
  SELECT * FROM clinical b WHERE
   (coalesce($2->>'status','')='' OR b.status=$2->>'status')
   AND (coalesce($2->>'partner','')='' OR b.nume_partener=$2->>'partner')
   AND (coalesce($2->>'patient','')='' OR strpos(lower(coalesce(b.nume_pacient,'')),lower($2->>'patient'))>0)
   AND (coalesce($2->>'work_type','')='' OR ($2->>'work_type')=ANY(b.work_types))
   AND (coalesce($2->>'technician','')='' OR lower(trim($2->>'technician')) IN (lower(trim(b.tehnician_model)),lower(trim(b.tehnician1_modelare)),lower(trim(b.tehnician2_cer_fin))))
   AND (coalesce($2->>'search','')='' OR strpos(lower(concat_ws(' ',b.id,b.nume_pacient,b.nume_partener,b.status,b.work_type_summary)),lower($2->>'search'))>0)
 ), masked AS MATERIALIZED (
  SELECT b.id,
   b.deadline,
   b.status,
   b.nume_pacient,
   b.nume_partener,
   b.data_receptie,
   b.locked,
   b.status_model,
   b.status_modelare,
   b.status_cer_fin,
   b.created_at,
   b.updated_at,
   b.model_not_applicable,
   b.modelare_not_applicable,
   b.cer_fin_not_applicable,
   CASE WHEN $3 OR $4 OR $5 THEN b.tehnician_model END tehnician_model,
   CASE WHEN $3 OR $4 OR $5 THEN b.tehnician1_modelare END tehnician1_modelare,
   CASE WHEN $3 OR $4 OR $5 THEN b.tehnician2_cer_fin END tehnician2_cer_fin,
   CASE WHEN $3 THEN b.contract END contract,
   CASE WHEN $3 THEN b.discount END discount,
   CASE WHEN $3 THEN b.created_by_user_id END created_by_user_id,
   CASE WHEN $3 THEN b.updated_by_user_id END updated_by_user_id,
   b.work_types,b.work_type_summary,b.element_count,coalesce(b.data_receptie,b.created_at) reception_date,
   CASE WHEN $3 OR $6 THEN b.snapshot_list_price END list_price,
   CASE WHEN $3 OR $6 THEN b.snapshot_final_price END final_price,
   CASE WHEN $3 THEN costs.cost_model END cost_model,
   CASE WHEN $3 THEN costs.cost_modelare END cost_modelare,
   CASE WHEN $3 THEN costs.cost_cer_fin END cost_cer_fin,
   costs.cost_model own_cost_model,costs.cost_modelare own_cost_modelare,costs.cost_cer_fin own_cost_cer_fin,
   salary.own_cost,salary.own_stages,
   costs.selected_technician_cost,costs.unknown_model,costs.unknown_modelare,costs.unknown_cer_fin,costs.unknown_selected
  FROM selected b
  CROSS JOIN LATERAL (
   SELECT coalesce(bool_or(amount IS NULL) FILTER(WHERE stage_key='model'),false) unknown_model,
    coalesce(bool_or(amount IS NULL) FILTER(WHERE stage_key='modelare'),false) unknown_modelare,
    coalesce(bool_or(amount IS NULL) FILTER(WHERE stage_key='cer_fin'),false) unknown_cer_fin,
    coalesce(bool_or(amount IS NULL) FILTER(WHERE chosen),false) unknown_selected,
    CASE WHEN bool_and(amount IS NOT NULL) FILTER(WHERE stage_key='model') THEN sum(amount) FILTER(WHERE stage_key='model') END cost_model,
    CASE WHEN bool_and(amount IS NOT NULL) FILTER(WHERE stage_key='modelare') THEN sum(amount) FILTER(WHERE stage_key='modelare') END cost_modelare,
    CASE WHEN bool_and(amount IS NOT NULL) FILTER(WHERE stage_key='cer_fin') THEN sum(amount) FILTER(WHERE stage_key='cer_fin') END cost_cer_fin,
    CASE WHEN bool_and(amount IS NOT NULL) FILTER(WHERE chosen) THEN sum(amount) FILTER(WHERE chosen) END selected_technician_cost
   FROM (SELECT a.stage_key,public.assignment_agreed_amount(a.id) amount,
    ($5 AND NOT $3 OR lower(trim(a.technician_name))=lower(trim($2->>'technician'))) chosen
    FROM public.lab_work_order_stage_assignments a WHERE a.lab_organization_id=$1 AND a.work_order_id=b.id AND a.ended_at IS NULL
     AND ($3 OR ($5 AND (a.technician_user_id=auth.uid() OR (a.technician_user_id IS NULL AND lower(trim(a.technician_name))=$7))))) amounts
  ) costs
  CROSS JOIN LATERAL (
   SELECT CASE WHEN $5 THEN CASE WHEN count(*)=0 THEN 0 WHEN bool_and(amount IS NOT NULL) THEN sum(amount) END END own_cost,
    string_agg(concat_ws(' ',stage_label,stage_status,payment_status),' ' ORDER BY started_at DESC) own_stages
   FROM (
    SELECT public.assignment_agreed_amount(a.id) amount,a.started_at,
     CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer / Fin' END stage_label,
     CASE a.stage_key WHEN 'model' THEN coalesce(b.status_model,'Not Started') WHEN 'modelare' THEN coalesce(b.status_modelare,'Not Started') ELSE coalesce(b.status_cer_fin,'Not Started') END stage_status,
     CASE WHEN ($2->>'sort_key'='stages' OR coalesce($2->'columns'->>'stages','')<>'') THEN
      CASE WHEN public.assignment_agreed_amount(a.id) IS NOT NULL AND coalesce((SELECT sum(amount) FROM public.technician_payments WHERE assignment_id=a.id),0)>=public.assignment_agreed_amount(a.id) THEN 'Paid' ELSE 'Not Paid' END END payment_status
    FROM public.lab_work_order_stage_assignments a
    WHERE $5 AND a.lab_organization_id=$1 AND a.work_order_id=b.id
     AND (a.technician_user_id=auth.uid() OR (a.technician_user_id IS NULL AND lower(trim(a.technician_name))=$7))
   ) mine
  ) salary
 ), filtered AS MATERIALIZED (SELECT * FROM masked WHERE %s),
 page AS MATERIALIZED (SELECT * FROM filtered ORDER BY %I %s NULLS LAST,id DESC LIMIT $15 OFFSET $16),
 details AS (
  SELECT to_jsonb(p)-'own_cost_model'-'own_cost_modelare'-'own_cost_cer_fin'-'reception_date'-'unknown_model'-'unknown_modelare'-'unknown_cer_fin'-'unknown_selected'-'own_stages'
   ||jsonb_build_object('items',scope.items,
    'paid_model',CASE WHEN $3 THEN public.work_order_stage_payment_status($1,p.id,'model') END,
    'paid_modelare',CASE WHEN $3 THEN public.work_order_stage_payment_status($1,p.id,'modelare') END,
    'paid_cer_fin',CASE WHEN $3 THEN public.work_order_stage_payment_status($1,p.id,'cer_fin') END,
    'salary_stages',CASE WHEN $5 THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'work_order_id',a.work_order_id,'stage_key',CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer_Fin' END,
      'stage_label',CASE a.stage_key WHEN 'model' THEN 'Model' WHEN 'modelare' THEN 'Modelare' ELSE 'Cer / Fin' END,
      'stage_status',CASE a.stage_key WHEN 'model' THEN coalesce(p.status_model,'Not Started') WHEN 'modelare' THEN coalesce(p.status_modelare,'Not Started') ELSE coalesce(p.status_cer_fin,'Not Started') END,
      'payment_status',CASE WHEN public.assignment_agreed_amount(a.id) IS NOT NULL AND coalesce((SELECT sum(amount) FROM public.technician_payments WHERE assignment_id=a.id),0)>=public.assignment_agreed_amount(a.id) THEN 'Paid' ELSE 'Not Paid' END,
      'unit_cost',a.unit_cost,'amount',public.assignment_agreed_amount(a.id)) ORDER BY a.started_at DESC),'[]'::jsonb)
     FROM public.lab_work_order_stage_assignments a WHERE a.lab_organization_id=$1 AND a.work_order_id=p.id
      AND (a.technician_user_id=auth.uid() OR (a.technician_user_id IS NULL AND lower(trim(a.technician_name))=$7))) ELSE '[]'::jsonb END) row,
   p.id,p.%I sort_value
  FROM page p CROSS JOIN LATERAL public.work_order_item_scope($1,p.id,false) scope
 ) SELECT jsonb_build_object(
  'rows',coalesce((SELECT jsonb_agg(row ORDER BY sort_value %s NULLS LAST,id DESC) FROM details),'[]'::jsonb),
  'total',(SELECT count(*) FROM filtered),
  'summary',(SELECT jsonb_build_object('count',count(*),'elements',coalesce(sum(element_count),0),
   'list_price',CASE WHEN $3 OR $6 THEN CASE WHEN count(*)=0 THEN 0 WHEN bool_and(list_price IS NOT NULL) THEN sum(list_price) END END,'final_price',CASE WHEN $3 OR $6 THEN CASE WHEN count(*)=0 THEN 0 WHEN bool_and(final_price IS NOT NULL) THEN sum(final_price) END END,
   'cost_model',CASE WHEN $3 OR $5 THEN CASE WHEN count(*)=0 THEN 0 WHEN NOT bool_or(unknown_model) THEN coalesce(sum(coalesce(own_cost_model,0)),0) END END,
   'cost_modelare',CASE WHEN $3 OR $5 THEN CASE WHEN count(*)=0 THEN 0 WHEN NOT bool_or(unknown_modelare) THEN coalesce(sum(coalesce(own_cost_modelare,0)),0) END END,
   'cost_cer_fin',CASE WHEN $3 OR $5 THEN CASE WHEN count(*)=0 THEN 0 WHEN NOT bool_or(unknown_cer_fin) THEN coalesce(sum(coalesce(own_cost_cer_fin,0)),0) END END,
   'technician_cost',CASE WHEN $5 AND NOT $3 THEN CASE WHEN count(*)=0 THEN 0 WHEN bool_and(own_cost IS NOT NULL) THEN sum(own_cost) END
    WHEN $3 THEN CASE WHEN count(*)=0 THEN 0 WHEN NOT bool_or(unknown_selected) THEN sum(selected_technician_cost) END END,
   'partners',count(DISTINCT nullif(nume_partener,'')),'patients',count(DISTINCT nullif(nume_pacient,''))) FROM filtered),
  'facets',jsonb_build_object(
   'statuses',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT status v FROM clinical WHERE coalesce(status,'')<>'') x),'[]'::jsonb),
   'partners',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT nume_partener v FROM clinical WHERE coalesce(nume_partener,'')<>'') x),'[]'::jsonb),
   'work_types',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT unnest(work_types) v FROM clinical) x),'[]'::jsonb)))
 $query$,predicates,sort_col,sort_dir,sort_col,sort_dir)
 INTO result USING p_lab_organization_id,p_filters,mg,dash,tech,doc,tech_name,rf,rt,df,dt,uf,ut,today,p_limit,p_offset;
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_work_orders_page(uuid,jsonb,integer,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_work_orders_page(uuid,jsonb,integer,integer) TO authenticated;
