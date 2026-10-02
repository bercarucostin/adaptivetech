const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('website/app/app.js','utf8');
function setup(management=true){
 const fields={manualSupplementAmount:{value:'50'},manualSupplementReason:{value:'Transport'},priceBreakdown:{innerHTML:''}};
 const context=vm.createContext({$:id=>fields[id],isManagement:()=>management,num:value=>Number(value)||0,
 normalizeBillingMode:String,billingModeLabel:String,billingScopeLabel:String,escapeHtml:value=>String(value??'').replaceAll('<','&lt;'),money:n=>`${n} RON`,
 listPrice:{value:0},finalPrice:{value:0},priceHint:{textContent:'',classList:{remove(){},add(){}}},setFormContractValue(){},orderId:{value:7}});
 const start=source.indexOf('let manualSupplementDirty=');
 if(start>=0)vm.runInContext(source.slice(start,source.indexOf('async function loadSavedWorkOrderPriceLines',start)),context);
 else vm.runInContext(source.slice(source.indexOf('function renderToothPriceBreakdown'),source.indexOf('async function loadSavedWorkOrderPriceLines')),context);
 return {fields,context};
}
test('manual supplement preview adds once after discount and displays the escaped reason',()=>{
 const {fields,context}=setup();
 context.result={saved:true,list_price:200,discount:10,final_price:230,manual_supplement:50,manual_supplement_reason:'Transport',lines:[{work_type:'Coroana',quantity:1,unit_price:200,subtotal:200,matched:true}]};
 vm.runInContext('renderToothPriceBreakdown(result)',context);assert.equal(context.finalPrice.value,230);
 fields.manualSupplementAmount.value='75';fields.manualSupplementReason.value='<Transport>';
 vm.runInContext('manualSupplementDirty=true;renderToothPriceBreakdown(result)',context);
 assert.equal(context.finalPrice.value,255);assert.match(fields.priceBreakdown.innerHTML,/&lt;Transport>/);
 vm.runInContext('renderToothPriceBreakdown(result)',context);assert.equal(context.finalPrice.value,255);
});
test('supplement validation requires finite nonnegative amount and explanation for a positive amount',()=>{
 const {fields,context}=setup();
 assert.equal(vm.runInContext('readManualSupplementFields().amount',context),50);
 for(const value of ['-1','Infinity','NaN','abc']){fields.manualSupplementAmount.value=value;assert.throws(()=>vm.runInContext('readManualSupplementFields()',context));}
 fields.manualSupplementAmount.value='50';fields.manualSupplementReason.value=' ';assert.throws(()=>vm.runInContext('readManualSupplementFields()',context));
 fields.manualSupplementAmount.value='0';assert.equal(vm.runInContext('readManualSupplementFields().amount',context),0);
});
test('Doctor price display includes the saved fee but cannot change it from hidden controls',()=>{
 const {context}=setup(false);context.result={saved:true,list_price:200,final_price:230,manual_supplement:50,manual_supplement_reason:'Curier',lines:[{work_type:'Coroana',quantity:1,unit_price:200,subtotal:200,matched:true}]};
 vm.runInContext('renderToothPriceBreakdown(result)',context);assert.equal(context.finalPrice.value,230);
});
