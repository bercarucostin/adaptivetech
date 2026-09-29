const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('website/app/app.js','utf8');
function setup({mode='MERGE',errors=[],invalidate=false}={}){
 const calls=[];let valid=true;
 const ctx={isAdmin:()=>true,authEpoch:1,auth:{user:{User_ID:'admin'}},requestContextValid:()=>valid,
 SpreadsheetUI:{read:async()=>({rows:[{}]}),preview:async()=>{calls.push('preview');if(invalidate)valid=false;return mode;}},
 SpreadsheetImport:{prepare:()=>({rows:[{id:'001',pret:12.5}],errors})},sbRpc:async(name,args)=>{calls.push({name,args});return {imported_rows:1};},
 loadAll:async()=>{},renderAdminConfig:()=>{},setConnection:()=>{},showLoading:()=>{},hideLoading:()=>{},alert:()=>{},currentView:''};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('let adminSpreadsheetImportBusy=false;'),source.indexOf('window.uploadAdminCsv=uploadAdminCsv;')),ctx);
 return {ctx,calls};
}
test('import waits for preview and submits normalized values to existing RPC',async()=>{const {ctx,calls}=setup();await ctx.uploadAdminCsv('prices',{name:'p.xlsx'});assert.equal(calls[0],'preview');assert.equal(calls[1].name,'admin_bulk_config_import');assert.equal(calls[1].args.p_rows[0].id,'001');assert.equal(calls[1].args.p_mode,'MERGE');});
for(const [name,options] of [['cancelled',{mode:null}],['invalid',{errors:['bad row']}],['session changed',{invalidate:true}]])test(`${name} preview does not save`,async()=>{const {ctx,calls}=setup(options);await ctx.uploadAdminCsv('prices',{name:'p.xlsx'});assert.equal(calls.length,1);});
test('CSV export quotes semicolons so text does not split into extra columns',()=>{const ctx={};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function csvEscape('),source.indexOf('function downloadTextFile(')),ctx);assert.equal(ctx.csvEscape('A;B'),'"A;B"');});
