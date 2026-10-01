"""Build an offline browser regression fixture using real app scripts and fake RPCs.
Run from repo root; output path defaults to /tmp/dashboard-browser.html.
No production network, accounts, or data are used.
"""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[2]
app = root / 'website/app'
html = (app / 'index.html').read_text()
html = re.sub(r'<script src="https://cdn[^"\n]+"></script>', '', html)
html = html.replace('<script src="supabase-config.js"></script>', '')
html = re.sub(r'(src|href)="([^":]+\.(?:js|css|jpg))(\?[^" ]*)?"',
              lambda m: f'{m[1]}="{(app/m[2]).as_uri()}"', html)
prelude = '''<script>
window.fixtureErrors=[];window.onerror=(message)=>fixtureErrors.push(String(message));
window.onunhandledrejection=e=>fixtureErrors.push(String(e.reason));
window.alert=message=>{if(!String(message).startsWith('Run this folder'))fixtureErrors.push(String(message));};
window.fetch=()=>Promise.reject(new Error('Unexpected network request'));
localStorage.clear();sessionStorage.clear();
window.FLOWRISE_SUPABASE={enabled:false};window.FLOWRISE_RUNTIME={legacyModules:{adminUsers:false}};
</script>'''
html = html.replace('<script src="'+(app/'login-security.js').as_uri()+'">',prelude+'<script src="'+(app/'login-security.js').as_uri()+'">')
test = r'''<script>
(async()=>{
const checks=[];const check=(value,message)=>{if(!value)throw new Error(message);checks.push(message);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,250));
const calls=[];
try{
 auth={user:{User_ID:'test-user',Role:'Admin',Name:'Test',Technician_Name:'Ana'},permissions:new Proxy({},{get:()=>true})};authEpoch++;
 labOrganizationId='test-lab';resolveLabOrganizationId=async()=>labOrganizationId;
 const today=DashboardData.defaultRange().receptionDateTo;
 const all=Array.from({length:305},(_,n)=>({id:305-n,deadline:today,data_receptie:today,status:'Started',nume_pacient:'Pacient test '+(305-n),nume_partener:'Clinică test',work_types:['Coroană'],work_type_summary:'Coroană',element_count:1,items:[{tooth_number:11,work_type:'Coroană',quantity:1}],list_price:100,final_price:90,discount:10,tehnician_model:'Ana',cost_model:15,status_model:'Started',salary_stages:[]}));
 sbRpc=async(name,args)=>{
   if(name!=='get_work_orders_page')throw new Error('Unexpected RPC '+name);
   calls.push(args);
   const old=args.p_filters.deadline_from==='2020-01-01';
   const list=old?all.slice(0,3).map(row=>({...row,deadline:'2020-01-05',data_receptie:'2019-12-20'})):all;
   return {rows:list.slice(args.p_offset,args.p_offset+args.p_limit),total:list.length,summary:{count:list.length,elements:list.length,final_price:list.length*90},facets:{partners:['Clinică test'],work_types:['Coroană','Punte']}};
 };
 loginScreen.classList.add('hidden');appShell.classList.remove('hidden');
 render();await tick();
 check(orders.length===100,'first page has 100 rows');
 check(content.querySelector('.dashboard-server-summary').textContent.includes('305'),'summary covers all 305 rows');
 check(calls[0].p_filters.reception_from&&calls[0].p_filters.reception_to,'default dates sent to server');
 content.querySelector('[data-dashboard-page="next"]').click();await tick();
 check(calls.at(-1).p_offset===100&&orders[0].id===205,'next page is fetched from server');
 content.querySelector('[data-dashboard-days="all"]').click();await tick();
 const input=content.querySelector('[data-date-range-key="deadlineFrom"]');input.value='2020-01-01';input.dispatchEvent(new Event('change',{bubbles:true}));await tick();
 check(calls.at(-1).p_filters.reception_from===null&&calls.at(-1).p_filters.deadline_from==='2020-01-01','delivery history loaded with reception limit removed');
 check(orders.length===3&&content.textContent.includes('Pacient test'),'historical rows render');
 loadOlderBtn.click();await tick();check(orders.length===100&&calls.at(-1).p_filters.deadline_from===null,'90 day reset clears delivery range');
 currentView='partners';render();await tick();check(content.querySelector('.dashboard-server-summary').textContent.includes('305'),'partner total covers all pages');
 currentView='workorders';render();await tick();
 const exported={document:document.implementation.createHTMLDocument('Report'),focus(){},print(){},close(){}};
 window.open=()=>exported;
 document.querySelector('#workOrdersPdfBtn,#mobileWorkOrdersPdfBtn').click();await tick();
 check(exported.document.querySelectorAll('tbody tr').length===305,'PDF includes all 305 rows, not one page');
 check(orders.length===100,'export does not replace the displayed page');
 auth.user.Role='Technician';auth.user.Technician_Name='Ana';authEpoch++;currentView='patients';render();await tick();
 check(Array.from(content.querySelector('[data-patient-report-filter="workType"]').options).some(option=>option.value==='Punte'),'technician work-type choices include values outside current page');
 auth.user.Role='Admin';authEpoch++;currentView='workorders';render();await tick();
 check(document.documentElement.scrollWidth<=window.innerWidth,'page fits viewport without horizontal overflow');
 check(!fixtureErrors.length,'no browser errors: '+fixtureErrors.join('; '));
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL';checks.push(String(error.stack||error));}
const result=document.createElement('pre');result.id='browser-test-results';result.textContent=checks.join('\n');document.body.append(result);
})();
</script>'''
html = html.replace('</body>', test+'</body>')
destination=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/dashboard-browser.html')
destination.write_text(html)
print(destination)
