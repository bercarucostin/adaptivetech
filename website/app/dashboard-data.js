/* Bounded reads shared by the dashboard and explicit full exports. */
(function(root){
  'use strict';
  function dayInBucharest(now){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=type=>parts.find(part=>part.type===type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function defaultRange(now=new Date()){
    const today=dayInBucharest(now),start=new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate()-89);
    return {receptionDateFrom:start.toISOString().slice(0,10),receptionDateTo:today,deadlineFrom:'',deadlineTo:''};
  }
  function dateFilters(range={}){
    const result={};
    for(const [field,key] of [['receptionDate','reception'],['deadline','deadline']]){
      const from=range[`${field}From`]||null,to=range[`${field}To`]||null;
      for(const value of [from,to])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw new Error('Dată invalidă.');
      if(from&&to&&from>to)throw new Error('Începutul intervalului trebuie să fie înaintea sfârșitului.');
      result[`${key}_from`]=from;result[`${key}_to`]=to;
    }
    return result;
  }
  function validatePage(page){
    if(!page||!Array.isArray(page.rows)||!Number.isSafeInteger(page.total)||page.total<page.rows.length||page.rows.length>200)throw new Error('Răspuns invalid la încărcarea lucrărilor.');
    return page;
  }
  function create(fetchPage){
    let generation=0;
    return {
      invalidate(){generation++;},
      async load(args){
        const request=++generation;
        try{
          const result=validatePage(await fetchPage(args));
          return request===generation?result:null;
        }catch(error){if(request!==generation)return null;throw error;}
      },
      async exportRows(args,{isCurrent=()=>true,onProgress=()=>{}}={}){
        const rows=[],seen=new Set();let total=null;
        while(total===null||rows.length<total){
          if(!isCurrent())throw new Error('Export anulat: selecția sau sesiunea s-a schimbat.');
          const page=validatePage(await fetchPage({...args,p_limit:200,p_offset:rows.length}));
          if(!isCurrent())throw new Error('Export anulat: selecția sau sesiunea s-a schimbat.');
          if(page.total>10000)throw new Error('Exportul este limitat la 10000 de lucrări. Restrânge intervalul.');
          if(total!==null&&page.total!==total)throw new Error('Datele s-au modificat în timpul exportului. Reîncearcă.');
          total=page.total;
          if(total>rows.length&&!page.rows.length)throw new Error('Export incomplet. Reîncearcă.');
          for(const row of page.rows){
            const id=String(row.id);
            if(seen.has(id))throw new Error('Datele s-au modificat în timpul exportului. Reîncearcă.');
            seen.add(id);rows.push(row);
          }
          onProgress(rows.length,total);
        }
        if(rows.length!==total)throw new Error('Export incomplet. Reîncearcă.');
        return rows;
      }
    };
  }
  root.DashboardData={defaultRange,dateFilters,create};
})(globalThis);
