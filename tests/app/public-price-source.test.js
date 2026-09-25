const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPriceList}=require('../../website/shared/price-list-source.js');

const doc=(title)=>({schema:1,currency:'lei',groups:[{title,rows:[]}]});
const okFetch=(body)=>()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(body)});
const storage=(initial)=>{
 const map=new Map(initial?Object.entries(initial):[]);
 return {getItem:(k)=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:(k)=>map.delete(k),map};
};
const collect=()=>{const seen=[];return {fn:(d)=>seen.push(d),seen};};

test('a fresh visitor renders what the network returns and caches it',async()=>{
 const shown=collect(),failed=collect(),store=storage();
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v1',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Net'));
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(failed.seen,[]);
 assert.deepEqual(JSON.parse(store.map.get('flowrise_public_prices_v1')).document,doc('Net'));
});

test('a returning visitor sees the cache first, then the change',async()=>{
 const shown=collect(),store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v2',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:collect().fn});
 assert.deepEqual(shown.seen,[doc('Cached'),doc('Net')]);
});

test('an unchanged document does not re-render',async()=>{
 const shown=collect(),store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Same')})});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v3',document:doc('Same')}]),storage:store,onDocument:shown.fn,onUnavailable:collect().fn});
 assert.deepEqual(shown.seen,[doc('Same')]);
});

test('a stale cache is served when the network is down',async()=>{
 const shown=collect(),failed=collect();
 const store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 const got=await loadPriceList({url:'u',key:'k',fetch:()=>Promise.reject(new Error('offline')),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Cached'));
 assert.deepEqual(shown.seen,[doc('Cached')]);
 assert.deepEqual(failed.seen.length,0);
});

test('a first visit with no network reports unavailable and does not throw',async()=>{
 const shown=collect(),failed=collect();
 const got=await loadPriceList({url:'u',key:'k',fetch:()=>Promise.reject(new Error('offline')),storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.equal(got,null);
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('a non-200 response is a failure, not a document',async()=>{
 const shown=collect(),failed=collect();
 const fetchImpl=()=>Promise.resolve({ok:false,status:503,json:()=>Promise.reject(new Error('not json'))});
 await loadPriceList({url:'u',key:'k',fetch:fetchImpl,storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('an empty result is a failure, not an empty page',async()=>{
 const shown=collect(),failed=collect();
 await loadPriceList({url:'u',key:'k',fetch:okFetch([]),storage:storage(),onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[]);
 assert.equal(failed.seen.length,1);
});

test('a corrupt cache is ignored rather than rendered',async()=>{
 const shown=collect(),failed=collect();
 const store=storage({flowrise_public_prices_v1:'{not json'});
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v4',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[doc('Net')]);
});

test('storage that throws does not take the page down',async()=>{
 const shown=collect(),failed=collect();
 const hostile={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');},removeItem(){throw new Error('blocked');}};
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v5',document:doc('Net')}]),storage:hostile,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Net'));
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(failed.seen,[]);
});

test('the request asks only for the current list',async()=>{
 const calls=[];
 const fetchImpl=(url,init)=>{calls.push([url,init]);return okFetch([{id:'v6',document:doc('Net')}])();};
 await loadPriceList({url:'https://x.supabase.co/rest/v1/public_price_lists?select=id,document&is_current=eq.true&limit=1',key:'pub-key',fetch:fetchImpl,storage:storage(),onDocument:()=>{},onUnavailable:()=>{}});
 assert.match(calls[0][0],/is_current=eq\.true/);
 assert.equal(calls[0][1].headers.apikey,'pub-key');
});

test('a throwing onDocument on the cache path does not throw and the network document still renders',async()=>{
 let rendered=[];
 const onDoc=(d)=>{if(d.groups[0].title==='Cached')throw new Error('cache render');rendered.push(d);};
 const store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v7',document:doc('Net')}]),storage:store,onDocument:onDoc,onUnavailable:()=>{}});
 assert.deepEqual(got,doc('Net'));
 assert.deepEqual(rendered,[doc('Net')]);
});

test('a throwing onDocument with no cache calls onUnavailable once and resolves',async()=>{
 const failed=collect();
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v8',document:doc('Net')}]),storage:storage(),onDocument:()=>{throw new Error('render broke');},onUnavailable:failed.fn});
 assert.equal(failed.seen.length,1);
 assert.deepEqual(failed.seen[0].message,'The price list could not be rendered');
});

test('a throwing onUnavailable does not reject the returned promise',async()=>{
 const got=await loadPriceList({url:'u',key:'k',fetch:()=>Promise.reject(new Error('offline')),storage:storage(),onDocument:()=>{},onUnavailable:()=>{throw new Error('fallback broke');}});
 assert.equal(got,null);
});

test('a cached entry whose document.groups is a string is treated as no cache and is removed',async()=>{
 const store=storage({flowrise_public_prices_v1:JSON.stringify({document:{schema:1,currency:'lei',groups:'should-be-array'}})});
 const shown=collect(),failed=collect();
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v9',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(JSON.parse(store.map.get('flowrise_public_prices_v1')).document,doc('Net'));
});

test('a cached entry that is not valid JSON is removed from storage',async()=>{
 const store=storage({flowrise_public_prices_v1:'{not json'});
 const shown=collect(),failed=collect();
 await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v10',document:doc('Net')}]),storage:store,onDocument:shown.fn,onUnavailable:failed.fn});
 assert.deepEqual(shown.seen,[doc('Net')]);
 assert.deepEqual(JSON.parse(store.map.get('flowrise_public_prices_v1')).document,doc('Net'));
});

test('when the cache render throws and the network render succeeds, onUnavailable is never called',async()=>{
 const failed=collect();
 const store=storage({flowrise_public_prices_v1:JSON.stringify({document:doc('Cached')})});
 const got=await loadPriceList({url:'u',key:'k',fetch:okFetch([{id:'v11',document:doc('Net')}]),storage:store,onDocument:(d)=>{if(d.groups[0].title==='Cached')throw new Error('cache');},onUnavailable:failed.fn});
 assert.deepEqual(got,doc('Net'));
 assert.equal(failed.seen.length,0);
});
