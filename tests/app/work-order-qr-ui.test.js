const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const WorkOrderQR=require('../../website/app/work-order-qr.js');
const token='af835f72-889e-4fcb-b6ad-b99ae84125ee';
function fixture({auth=true,row={id:7},delayed=false}={}){
 const calls=[];let resolve;
 const pending=delayed?new Promise(r=>{resolve=r;}):null;
 const context={WorkOrderQR,URL,location:{hash:'#work-order='+token,pathname:'/',search:'',href:'https://example.test/'},history:{replaceState(){calls.push('history');}},auth:auth?{user:{User_ID:'u'}}:null,authEpoch:1,orders:[{id:1}],requestContextValid:(epoch)=>epoch===context.authEpoch,resolveLabOrganizationId:async()=> 'lab',sbRpc:async(name,args)=>{calls.push([name,args]);return delayed?pending:row;},dashboardMapRow:r=>r,editOrder:async id=>calls.push(['edit',id]),modalBackdrop:{classList:{contains:()=>false}},alert:message=>calls.push(['alert',message]),showLoading(){},hideLoading(){},window:{addEventListener(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('website/app/work-order-qr-ui.js','utf8'),context);
 return {context,calls,resolve,run:()=>vm.runInContext('openScannedWorkOrder()',context)};
}
test('unauthenticated scan stays pending until login',async()=>{const f=fixture({auth:false});await f.run();assert.equal(f.calls.length,0);f.context.auth={user:{User_ID:'u'}};await f.run();assert.ok(f.calls.some(c=>c[0]==='edit'&&c[1]===7));});
test('scan opens only authorized returned record without changing dashboard filters; modal cleanup removes temporary row',async()=>{const f=fixture();await f.run();assert.equal(f.context.orders.length,2);assert.deepEqual(f.calls.filter(c=>c[0]==='edit'),[['edit',7]]);vm.runInContext('closeScannedWorkOrder()',f.context);assert.deepEqual(f.context.orders,[{id:1}]);});
test('unauthorized or missing result never opens modal',async()=>{const f=fixture({row:null});await f.run();assert.equal(f.context.orders.length,1);assert.ok(!f.calls.some(c=>c[0]==='edit'));assert.ok(f.calls.some(c=>c[0]==='alert'));});
test('logout during request cannot open stale data',async()=>{const f=fixture({delayed:true});const p=f.run();await Promise.resolve();await Promise.resolve();f.context.authEpoch++;f.resolve({id:7});await p;assert.ok(!f.calls.some(c=>c[0]==='edit'));assert.equal(f.context.orders.length,1);});
