import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '/tmp/tooth-pglite/package/dist/index.js');

test('commercial orders require commercial lines and clinical orders retain their tooth invariant', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated;
      CREATE TABLE lab_work_orders(lab_organization_id uuid,id bigint,order_origin text,archived_at timestamptz);
      CREATE TABLE lab_work_order_items(lab_organization_id uuid,work_order_id bigint);
      CREATE TABLE lab_partner_work_order_items(lab_organization_id uuid,work_order_id bigint);`);
    const migration = readFileSync(new URL('../../db/migrations/20261001_lab_partner_orders.sql', import.meta.url), 'utf8');
    await db.exec(migration.slice(migration.lastIndexOf('CREATE OR REPLACE FUNCTION public.enforce_work_order_has_items()')));
    await db.exec(`CREATE CONSTRAINT TRIGGER work_order_has_items AFTER INSERT OR UPDATE ON lab_work_orders
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_work_order_has_items();`);
    const lab = '00000000-0000-0000-0000-000000000001';
    await db.exec(`BEGIN;
      INSERT INTO lab_work_orders VALUES ('${lab}',1,'lab_partner',NULL);
      INSERT INTO lab_partner_work_order_items VALUES ('${lab}',1);
      COMMIT;`);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM lab_work_orders')).rows[0].n, 1);
    for (const sql of [
      `INSERT INTO lab_work_orders VALUES ('${lab}',2,'lab_partner',NULL)`,
      `INSERT INTO lab_work_orders VALUES ('${lab}',3,'doctor',NULL)`,
      `DELETE FROM lab_partner_work_order_items WHERE work_order_id=1`
    ]) {
      await assert.rejects(db.exec(`BEGIN; ${sql}; COMMIT;`), /requires at least one/);
      await db.exec('ROLLBACK;');
    }
    await db.exec(`BEGIN;
      INSERT INTO lab_work_orders VALUES ('${lab}',4,'doctor',NULL);
      INSERT INTO lab_work_order_items VALUES ('${lab}',4);
      COMMIT;`);
  } finally { await db.close(); }
});
