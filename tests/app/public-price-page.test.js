const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync(path.join(__dirname,'../../website/site/index.html'),'utf8');

test('the hand-written price rows are gone',()=>{
 assert.equal(html.includes('<li class="row">'),false,'a hard-coded price row is still in the page');
 assert.equal(/<div class="group">/.test(html),false,'a hard-coded price group is still in the page');
});

test('the price section has a container for the rendered list',()=>{
 assert.match(html,/<div id="priceList"[^>]*><\/div>/);
 assert.match(html,/<h2>Prețuri<\/h2>/,'the static heading stays in the page');
});

test('the page loads the shared renderer and the source module',()=>{
 assert.match(html,/<script src="price-list\.js"><\/script>/);
 assert.match(html,/<script src="price-list-source\.js"><\/script>/);
});

test('the loader names the current list and the publishable key',()=>{
 assert.match(html,/is_current=eq\.true/);
 assert.match(html,/sb_publishable_/);
});

test('the unavailable message names the phone number',()=>{
 assert.match(html,/0766 494 063/);
});

test('the styles the renderer produces are still defined',()=>{
 for(const selector of ['.group','.list','.row','.item','.leader','.price','.note-top','.footnote','sup.ref']){
  assert.ok(html.includes(selector+' {')||html.includes(selector+'{'),`${selector} lost its styling`);
 }
});
