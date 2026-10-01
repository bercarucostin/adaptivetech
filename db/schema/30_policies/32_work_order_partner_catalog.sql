DROP TRIGGER IF EXISTS work_order_partner_catalog_guard ON public.lab_work_orders;
CREATE TRIGGER work_order_partner_catalog_guard
BEFORE INSERT OR UPDATE OF nume_partener, lab_organization_id ON public.lab_work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_work_order_partner_catalog();
