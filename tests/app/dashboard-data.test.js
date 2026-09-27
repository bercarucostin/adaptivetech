const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={Date,Intl,AbortController};
vm.createContext(context);
const file='website/app/dashboard-data.js';
if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
const api=()=>{assert.ok(context.DashboardData,'dashboard data controller exists');return context.DashboardData;};
const plain=value=>JSON.parse(JSON.stringify(value));

test('90 calendar days includes today in Bucharest, including DST',()=>{
  assert.deepEqual(plain(api().defaultRange(new Date('2026-03-29T21:30:00Z'))),{receptionDateFrom:'2025-12-31',receptionDateTo:'2026-03-30',deadlineFrom:'',deadlineTo:''});
});
test('historical ranges and explicitly cleared bounds reach the server',()=>{
  assert.deepEqual(plain(api().dateFilters({receptionDateFrom:'',receptionDateTo:'',deadlineFrom:'2020-01-01',deadlineTo:'2020-01-31'})),{
    reception_from:null,reception_to:null,deadline_from:'2020-01-01',deadline_to:'2020-01-31'
  });
  assert.throws(()=>api().dateFilters({deadlineFrom:'2026-02-02',deadlineTo:'2026-02-01'}),/interval/i);
  assert.throws(()=>api().dateFilters({receptionDateFrom:'2026-02-30'}),/dat/i);
});
test('only the latest request may replace the displayed page',async()=>{
  const resolves=[];
  const data=api().create(()=>new Promise(resolve=>resolves.push(resolve)));
  const first=data.load({p_offset:0});
  const second=data.load({p_offset:100});
  resolves[1]({rows:[{id:101}],total:201,summary:{count:201}});
  assert.equal((await second).rows[0].id,101);
  resolves[0]({rows:[{id:1}],total:201});
  assert.equal(await first,null);
});
test('logout invalidates pending requests and malformed responses fail visibly',async()=>{
  let resolve;
  const data=api().create(()=>new Promise(r=>resolve=r));
  const pending=data.load({});data.invalidate();resolve({rows:[],total:0});
  assert.equal(await pending,null);
  await assert.rejects(api().create(async()=>({rows:[{id:1}],total:0})).load({}),/răspuns/i);
});
test('full export reads bounded pages, retains filters and never changes current page',async()=>{
  const calls=[];const all=Array.from({length:405},(_,id)=>({id:id+1}));
  const data=api().create(async args=>{
    calls.push(args);return {rows:all.slice(args.p_offset,args.p_offset+args.p_limit),total:405,summary:{count:405}};
  });
  const result=await data.exportRows({p_lab_organization_id:'lab',p_filters:{deadline_from:'2020-01-01'}});
  assert.equal(result.length,405);assert.equal(calls.length,3);
  assert.ok(calls.every(call=>call.p_limit===200&&call.p_filters.deadline_from==='2020-01-01'));
});
test('export fails on truncation, duplicates, dataset change and excessive volume',async()=>{
  await assert.rejects(api().create(async()=>({rows:[],total:3})).exportRows({}),/incomplet/i);
  const duplicates=Array.from({length:200},()=>({id:1}));
  await assert.rejects(api().create(async()=>({rows:duplicates,total:201})).exportRows({}),/modificat/i);
  await assert.rejects(api().create(async()=>({rows:[],total:10001})).exportRows({}),/10000/);
});
