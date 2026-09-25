const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const {priceListTree,mount,formatAmount}=require('../../website/shared/price-list.js');

const root=path.join(__dirname,'../..');
const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/public-price-list-v1.json'),'utf8'));
const snapshot=fs.readFileSync(path.join(root,'tests/fixtures/public-prices-2026-09-25.html'),'utf8');

// For comparison only. The shipped renderer never builds markup; this walks the
// tree the way a browser would so the fixture can be asserted as a string.
function serialize(nodes){
 return nodes.map(n=>{
  if(n.text!==undefined)return n.text;
  const cls=n.cls?` class="${n.cls}"`:'';
  return `<${n.tag}${cls}>${serialize(n.children)}</${n.tag}>`;
 }).join('');
}
// Whitespace between two tags is formatting; whitespace inside a text run is content.
const normalize=s=>s.replace(/\s+/g,' ').replace(/>\s+</g,'><').trim();

// A DOM small enough to assert against: records how each node was created, so a
// test can prove text went through createTextNode and was never parsed as markup.
function fakeDocument(){
 const make=(tag)=>({tag,className:'',children:[],firstChild:null,
  appendChild(child){this.children.push(child);this.firstChild=this.children[0];return child;},
  removeChild(child){this.children=this.children.filter(c=>c!==child);this.firstChild=this.children[0]||null;return child;}});
 return {createElement:make,createTextNode:(text)=>({text}),make};
}

test('the seed document renders the price section as it stands today',()=>{
 assert.equal(normalize(serialize(priceListTree(seed))),normalize(snapshot));
});

test('a variant is separated from the item text by a space',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'Coroană',variant:'IVOCLAR',amount:1}]}]});
 const item=tree[0].children[1].children[0].children[0].children;
 assert.deepEqual(item.map(n=>n.text!==undefined?n.text:n.tag),['Coroană',' ','span']);
});

test('a footnote row carries the marker before the variant',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'PMMA',variant:'X',amount:1,footnote:true}]}]});
 const item=tree[0].children[1].children[0].children[0].children;
 assert.deepEqual(item.map(n=>n.text!==undefined?n.text:n.cls),['PMMA','ref',' ','variant']);
});

test('decimal amounts use a comma and integers stay bare',()=>{
 assert.equal(formatAmount(200),'200');
 assert.equal(formatAmount(199.5),'199,5');
 assert.equal(formatAmount(199.456),'199,46');
 assert.equal(formatAmount(0),'0');
});

test('a row currency overrides the list currency',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[{item:'X',amount:5,currency:'EUR'}]}]});
 const price=tree[0].children[1].children[0].children[2].children;
 assert.equal(price[0].text,'5');
 assert.equal(price[1].children[0].text,'EUR');
});

test('a group with no rows renders its heading and an empty list',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'În curând',rows:[]}]});
 assert.equal(tree.length,1);
 assert.equal(tree[0].children[0].children[0].text,'În curând');
 assert.deepEqual(tree[0].children[1].children,[]);
});

test('an absent note renders no paragraph',()=>{
 const tree=priceListTree({currency:'lei',groups:[{title:'G',rows:[]}]});
 assert.deepEqual(tree.map(n=>n.cls),['group']);
});

test('markup in an item name reaches the page as text, never as markup',()=>{
 const doc=fakeDocument();
 const container=doc.make('div');
 mount(priceListTree({currency:'lei',groups:[{title:'G & <b>',rows:[{item:'<script>alert(1)</script> & "x"',amount:1}]}]}),container,doc);
 const heading=container.children[0].children[0];
 const itemSpan=container.children[0].children[1].children[0].children[0];
 assert.equal(heading.children[0].text,'G & <b>');
 assert.equal(itemSpan.children[0].text,'<script>alert(1)</script> & "x"');
});

test('mount replaces whatever was in the container',()=>{
 const doc=fakeDocument();
 const container=doc.make('div');
 container.appendChild(doc.createTextNode('stale'));
 mount(priceListTree({currency:'lei',groups:[{title:'G',rows:[]}]}),container,doc);
 assert.equal(container.children.length,1);
 assert.equal(container.children[0].tag,'div');
});
