import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
const source=stripTypeScriptTypes(readFileSync(process.env.EDGE_SOURCE_PATH||'db/edge-functions/authorize-work-order-file/index.ts','utf8').replace(/^import[^\n]+\n/,''));

function setup(orderPatch={},role='Lab Partner'){
  const state={signs:0,deletes:0,files:[{id:'file',legacy_work_order_id:7,bucket_name:'work-order-files',object_path:'work-orders/7/scan.stl',original_file_name:'scan.stl',file_size_bytes:1024}]};
  const tables={profiles:[{id:'user',active:true,username:'partner',display_name:'Partner',legacy_user_id:'partner',legacy_partner_name:'Partner'}],
    organizations:[{id:'lab',slug:'flowrise-dental-lab',name:'Flowrise Dental',organization_type:'lab'}],
    organization_memberships:[{organization_id:'lab',user_id:'user',role,status:'active'}],
    lab_partner_user_links:[{lab_organization_id:'lab',user_id:'user',partner_id:'partner'}],
    lab_partners:[{id:'partner',lab_organization_id:'lab',active:true,name:'Partner'}],
    lab_work_orders:[{id:7,lab_organization_id:'lab',partner_id:'partner',nume_partener:'Partner',status:'Not Started',locked:false,archived_at:null,status_model:'Not Started',status_modelare:'Not Started',status_cer_fin:'Not Started',...orderPatch}],
    work_order_files:state.files};
  const client={rpc:async()=>({data:true,error:null}),from(table){
    const filters=[];let inserted=null,remove=false;
    const data=()=>{
      if(inserted){const row={id:'uploaded',...inserted};state.files.push(row);return [row];}
      const rows=(tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));
      if(remove){for(const row of rows)state.files.splice(state.files.indexOf(row),1);return [];}
      return rows;
    };
    return {select(){return this;},eq(key,value){filters.push([key,value]);return this;},order(){return this;},insert(value){inserted=value;return this;},delete(){remove=true;return this;},
      maybeSingle:async()=>({data:data()[0]||null,error:null}),single:async()=>({data:data()[0]||null,error:null}),then(done){return Promise.resolve({data:data(),error:null}).then(done);}};
  },storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://fixture.invalid/download'},error:null}),createSignedUploadUrl:async()=>{state.signs++;return {data:{token:'upload'},error:null};},remove:async()=>{state.deletes++;return {error:null};}})}};
  let handler;
  const context={Request,Response,console,crypto:{randomUUID},createClient:(_,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})}}:client,
    Deno:{serve(fn){handler=fn;},env:{get:key=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}[key])}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {state,request:action=>handler(new Request('https://fixture.invalid/authorize',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({action,work_order_id:7,file_id:'file',file_name:'new.stl',file_size:1024,mime_type:'application/octet-stream'})}))};
}

test('locked, started and archived partner orders reject file mutations while retaining downloads',async()=>{
  for(const patch of [{locked:true},{status:'Started'},{status:'Finished'},{status_model:'Started'},{archived_at:'2030-10-05T12:00Z'}]){
    const c=setup(patch);
    for(const action of ['upload','delete'])assert.equal((await c.request(action)).status,403,JSON.stringify({patch,action}));
    assert.equal((await c.request('list')).status,200);assert.equal((await c.request('download')).status,200);
    assert.equal(c.state.signs,0);assert.equal(c.state.deletes,0);assert.equal(c.state.files.length,1);
  }
});
test('unstarted partner orders accept attachments and management retains its file access',async()=>{
  for(const [patch,role] of [[{},'Lab Partner'],[{status:'Started',locked:true},'Admin'],[{status:'Started',locked:true},'Manager']]){
    const c=setup(patch,role);
    assert.equal((await c.request('upload')).status,200);assert.equal(c.state.files.length,2);
    assert.equal((await c.request('delete')).status,200);assert.equal(c.state.deletes,1);assert.equal(c.state.files.length,1);
  }
});
test('partner cannot list or mutate another partner order',async()=>{
  const c=setup({partner_id:'different-partner'});
  for(const action of ['list','download','upload','delete'])assert.equal((await c.request(action)).status,403);
  assert.equal(c.state.signs,0);assert.equal(c.state.files.length,1);
});
