const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('website/app/app.js', 'utf8');

function setup() {
  const ctx = {
    partnerCatalog: [{name:'Clinica A',active:true},{name:'Clinica B',active:false}],
    escapeHtml: value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
  };
  vm.createContext(ctx);
  const start = app.indexOf('function partnerOptionsHtml(');
  if (start !== -1) vm.runInContext(app.slice(start, app.indexOf('function populateFormOptions(', start)), ctx);
  return ctx;
}

test('new work orders offer active configured partners only', () => {
  const ctx = setup();
  assert.equal(typeof ctx.partnerOptionsHtml, 'function');
  const html = ctx.partnerOptionsHtml();
  assert.match(html, /value="Clinica A"/);
  assert.doesNotMatch(html, /Clinica B/);
  assert.match(html, /value=""/);
});

test('existing inactive and historical partners remain selected without entering new names', () => {
  const ctx = setup();
  assert.equal(typeof ctx.partnerOptionsHtml, 'function');
  assert.match(ctx.partnerOptionsHtml('Clinica B'), /value="Clinica B" selected/);
  assert.match(ctx.partnerOptionsHtml('Partener istoric'), /value="Partener istoric" selected/);
  assert.doesNotMatch(ctx.partnerOptionsHtml(), /Partener istoric/);
});

test('configured partner names are escaped in option values and labels', () => {
  const ctx = setup();
  assert.equal(typeof ctx.partnerOptionsHtml, 'function');
  ctx.partnerCatalog = [{name:'<Clinica "A">',active:true}];
  assert.doesNotMatch(ctx.partnerOptionsHtml(), /<Clinica/);
  assert.match(ctx.partnerOptionsHtml(), /&lt;Clinica &quot;A&quot;>/);
});

test('Admin tab renders configured partners and activation controls', () => {
  const ctx = setup();
  Object.assign(ctx, {
    isAdmin:()=>true, pageTitle:{},pageSubtitle:{},content:{},
    normalize:value=>String(value||'').toLowerCase(),
    adminConfigData:{prices:[],technicianCosts:[],workTypes:[],users:[],roles:[]},
    adminConfigTab:'partners',adminConfigSearch:'',selectedAdminContract:'',selectedAdminTechnician:'',selectedAdminUser:'',
    document:{querySelectorAll:()=>[]},$:()=>null
  });
  vm.runInContext(app.slice(app.indexOf('function renderAdminConfig(){'),app.indexOf('function adminDeleteSelectedContract(){')),ctx);
  ctx.renderAdminConfig();
  assert.match(ctx.content.innerHTML,/data-admin-tab="partners"/);
  assert.match(ctx.content.innerHTML,/Clinica A/);
  assert.match(ctx.content.innerHTML,/Clinica B/);
  assert.match(ctx.content.innerHTML,/Dezactivează/);
  assert.match(ctx.content.innerHTML,/Activează/);
});

function mutationSetup(isAdmin=true) {
  const writes=[];
  const ctx={resolveLabOrganizationId:async()=>'lab-a',isAdmin:()=>isAdmin,partnerCatalog:[{id:'partner-a',name:'Clinica A',active:true}],
    supabaseClient:{from:table=>({
      insert:async row=>{writes.push({table,row});return {error:null};},
      update:row=>{const entry={table,row,filters:[]};writes.push(entry);const chain={
        eq:(key,value)=>{entry.filters.push([key,value]);return chain;},select:()=>chain,single:async()=>({error:null})};return chain;}
    })}};
  vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('async function supabaseAdminMutation('),app.indexOf('adminConfigRequest=async function(entity,action,data={}){')),ctx);
  return {ctx,writes};
}

test('Admin creates a trimmed active partner in the current laboratory',async()=>{
  const {ctx,writes}=mutationSetup();
  await ctx.supabaseAdminMutation('partner','create',{Name:'  Clinica Nouă  '});
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{table:'lab_partners',row:{lab_organization_id:'lab-a',name:'Clinica Nouă',active:true}}]);
});

test('activation is scoped by both laboratory and partner ID and preserves the name',async()=>{
  const {ctx,writes}=mutationSetup();
  await ctx.supabaseAdminMutation('partner','update',{ID:'partner-a',Active:false});
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].filters)),[['lab_organization_id','lab-a'],['id','partner-a']]);
  assert.equal(writes[0].row.active,false);
  assert.equal(Object.hasOwn(writes[0].row,'name'),false);
});

test('non-Admin cannot mutate the catalog and blank names do not write',async()=>{
  const nonAdmin=mutationSetup(false);
  await assert.rejects(nonAdmin.ctx.supabaseAdminMutation('partner','create',{Name:'Clinica Nouă'}),/Admin access required/);
  assert.equal(nonAdmin.writes.length,0);
  const admin=mutationSetup();
  await assert.rejects(admin.ctx.supabaseAdminMutation('partner','create',{Name:'  '}),/Numele partenerului/);
  assert.equal(admin.writes.length,0);
});
