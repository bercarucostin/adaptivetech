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

test('the seed migration is idempotent by construction',()=>{
 assert.match(sql,/where not exists/i,'re-running the migration must not insert a second version');
});
