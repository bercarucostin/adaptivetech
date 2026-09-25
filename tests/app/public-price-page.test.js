const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../../website/site/index.html'),'utf8');

// The last inline <script>...</script> block is the loader; the two <script src>
// tags above it have no body, so filtering out empty matches finds it.
const inlineScripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(m=>m[1]).filter(s=>s.trim().length>0);
const loaderSrc=inlineScripts[inlineScripts.length-1];

function makeElement(id){
 return {
  id,className:'',textContent:'',children:[],attributes:{'aria-busy':'true'},
  appendChild(child){this.children.push(child);return child;},
  removeAttribute(name){delete this.attributes[name];}
 };
}

// Runs the loader script exactly as extracted from the page, against a stub DOM.
// withModules=false leaves window.PriceList/PriceListSource undefined, simulating
// one of the two <script src> files failing to load on the cPanel upload.
function runLoader(withModules){
 const priceEl=makeElement('priceList');
 const yEl=makeElement('y');
 const elements={priceList:priceEl,y:yEl};
 const created=[];
 const calls={};
 const documentStub={
  getElementById:(id)=>elements[id],
  createElement:(tag)=>{
   const el={tag,className:'',textContent:'',children:[],appendChild(child){this.children.push(child);return child;}};
   created.push(el);
   return el;
  }
 };
 const sandbox={document:documentStub,localStorage:{},fetch:function(){}};
 sandbox.window=sandbox;
 if(withModules){
  sandbox.window.PriceList={
   priceListTree:(doc)=>({doc}),
   mount:(tree,container)=>{container.mounted=tree;}
  };
  sandbox.window.PriceListSource={
   loadPriceList:(opts)=>{calls.loadPriceList=opts;}
  };
 }
 const ctx=vm.createContext(sandbox);
 vm.runInContext(loaderSrc,ctx);
 return {priceEl,yEl,calls,created};
}

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

test('a missing shared script falls back to the phone number instead of throwing',()=>{
 const {priceEl}=runLoader(false);
 assert.equal(priceEl.children.length,1,'exactly one fallback node should be appended');
 assert.match(priceEl.children[0].textContent,/0766 494 063/);
 assert.equal('aria-busy' in priceEl.attributes,false,'aria-busy should be cleared even on the fallback path');
});

test('with both shared scripts present the loader calls PriceListSource with the current-list query',()=>{
 const {calls}=runLoader(true);
 assert.ok(calls.loadPriceList,'PriceListSource.loadPriceList should have been called');
 assert.match(calls.loadPriceList.url,/is_current=eq\.true/);
 assert.equal(typeof calls.loadPriceList.onUnavailable,'function');
});
