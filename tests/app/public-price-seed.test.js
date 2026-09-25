const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'../..');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/public-price-list-v1.json'),'utf8'));
const sql=fs.readFileSync(path.join(root,'db/migrations/20260925_public_price_list_seed.sql'),'utf8');

test('the seed migration embeds exactly the fixture document',()=>{
 const match=sql.match(/\$seed\$([\s\S]*?)\$seed\$/);
 assert.ok(match,'the migration must carry the document in a $seed$ dollar-quoted literal');
 assert.deepEqual(JSON.parse(match[1]),fixture);
});

test('the seed migration will not insert a second version',()=>{
 assert.match(sql,/not exists\s*\(\s*select 1\s+from public\.public_price_lists/i,
  'the insert must be guarded by a NOT EXISTS check against the price list table');
});

test('the seed migration inserts nothing when the lab cannot be resolved',()=>{
 assert.match(sql,/get_flowrise_lab_id\(\)\s+is not null/i,
  'lab_organization_id is NOT NULL, so an unresolved lab must no-op rather than raise');
});
