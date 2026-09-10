const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(`db/schema/${name}`, 'utf8');
test('canonical table definitions have no scalar scope or clinical material', () => {
  assert.doesNotMatch(read('10_tables/15_lab_work_orders.sql'), /\b(?:tip_lucrare|nr_elemente|snapshot_unit_price)\b/);
  assert.doesNotMatch(read('10_tables/11_lab_patient_cases.sql'), /\b(?:tip_lucrare|material)\b/);
});
test('role writers require tooth items and create them before costs', () => {
  for (const name of ['create_work_order','create_technician_work_order','update_doctor_work_order','save_my_work_order_case','update_management_work_order_v188']) {
    const sql = read(`20_functions/${name}.sql`);
    assert.match(sql, /p_items jsonb/i, name);
    assert.doesNotMatch(sql, /\bp_(?:tip_lucrare|nr_elemente|material)\b/i, name);
    assert.match(sql, /replace_work_order_items/i, name);
  }
  const sql = read('20_functions/create_technician_work_order.sql');
  assert.ok(sql.indexOf('replace_work_order_items') < sql.indexOf('sync_work_order_stage_assignment'));
});
test('read models derive item scope and never use a general price', () => {
  for (const name of ['get_my_work_orders','get_my_work_orders_v188','get_my_production']) {
    const sql = read(`20_functions/${name}.sql`);
    for (const field of ['items','work_types','work_type_summary','element_count']) assert.match(sql,new RegExp(`\\b${field}\\b`),name);
    assert.doesNotMatch(sql,/\b(?:tip_lucrare|nr_elemente|snapshot_unit_price)\b/);
  }
});
test('cost lines use only items and preserve scope-change audit history', () => {
  const sql = read('20_functions/sync_work_order_stage_assignment.sql');
  assert.doesNotMatch(sql, /v_order\.(?:nr_elemente|tip_lucrare)/);
  assert.match(read('20_functions/replace_work_order_items.sql'), /scope_change/);
});
test('cutover deletes dependencies and enforces a deferred item invariant', () => {
  const path = 'db/schema/60_per_tooth_work_order_cutover.sql';
  assert.ok(fs.existsSync(path), 'cutover migration exists');
  const sql = fs.readFileSync(path,'utf8');
  assert.match(sql,/delete from public\.technician_payments/i);
  assert.match(sql,/delete from public\.lab_work_order_assignment_cost_lines/i);
  assert.match(sql,/deferrable initially deferred/i);
  assert.match(read('apply.sql'),/60_per_tooth_work_order_cutover.sql/);
});
