const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
function setup(){
 const c={Date,Intl,setTimeout,clearTimeout,console,auth:{user:{User_ID:'u',Technician_Name:'Ana'}},authEpoch:1,currentView:'workorders',labOrganizationId:'lab',viewDateRanges:{},hideOldOrders:false,workFilters:{},workQuickFilters:{},workSort:{key:'id',dir:'desc'},techFilters:{},techSort:{key:'id',dir:'desc'},patientSort:{key:'deadline',dir:'asc'},partnerReportFilters:{},patientReportFilters:{},technicianReportFilters:{},isTechnician:()=>false,isManagement:()=>true,mapSupabaseOrder:r=>({...r}),num:Number,nullableMoney:v=>v==null?null:Number(v),sbRpc:async()=>({rows:[],total:0}),orders:[],technicianSalaryRows:[],workOrderScope:{},updateDatasetScope:()=>{},requestContextValid:()=>true,resolveLabOrganizationId:async()=>'lab',document:{querySelector:()=>null,activeElement:null}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('website/app/dashboard-data.js','utf8'),c);
 if(fs.existsSync('website/app/dashboard-ui.js'))vm.runInContext(fs.readFileSync('website/app/dashboard-ui.js','utf8'),c);
 assert.equal(typeof c.dashboardRequestFilters,'function','dashboard UI integration exists');return c;
}
test('all scopes have independent default dates and forward historical filters',()=>{
 const c=setup();let f=c.dashboardRequestFilters('workorders');assert.ok(f.reception_from);assert.ok(f.reception_to);
 c.viewDateRanges.workorders={receptionDateFrom:'',receptionDateTo:'',deadlineFrom:'2019-01-01',deadlineTo:'2019-12-31'};
 f=c.dashboardRequestFilters('workorders');assert.equal(f.reception_from,null);assert.equal(f.deadline_from,'2019-01-01');
 assert.ok(c.dashboardRequestFilters('patients').reception_from);
});
test('global filters, search and ordering are sent to SQL before pagination',()=>{
 const c=setup();c.workQuickFilters={partner:'Clinic',status:'Started',workType:'Crown'};c.workFilters={patient:'Ioana',elements:'>=4',mobileSearch:'23'};
 const f=c.dashboardRequestFilters('workorders');assert.equal(f.partner,'Clinic');assert.equal(f.search,'23');assert.equal(f.columns.elements,'>=4');assert.equal(f.columns.patient,'Ioana');assert.equal(f.sort_key,'id');
});
test('technician salary is mapped from bounded response, preserving unknown amounts',()=>{
 const c=setup();c.isTechnician=()=>true;
 const row=c.dashboardMapRow({id:1,salary_stages:[{stage_key:'model',stage_label:'Model',amount:null,payment_status:'Not Paid'}]});
 assert.equal(row.salaryStages[0].amount,null);assert.equal(row.ownCost,null);
});
test('unknown prices remain unknown and cannot produce a concrete total',()=>{
 const c=setup();
 assert.equal(c.dashboardMapRow({id:1,list_price:null,final_price:null}).finalPrice,null);
 assert.equal(c.dashboardMapRow({id:2,list_price:100,final_price:90}).finalPrice,90);
 assert.equal(c.dashboardPriceTotal([{finalPrice:90},{finalPrice:null}]),null);
 assert.equal(c.dashboardPriceTotal([{finalPrice:90},{finalPrice:10}]),100);
});
test('production prioritizes delivery dates and limits operational roles to displayed statuses',()=>{
 const c=setup();c.isTechnician=()=>true;c.isDoctor=()=>false;c.isDashboard=()=>false;
 const f=c.dashboardRequestFilters('production');
 assert.equal(f.sort_key,'deadline');assert.equal(f.sort_dir,'asc');
 assert.deepEqual(Array.from(f.status_in),['Not Started','Started','Finished','Shipped']);
});
