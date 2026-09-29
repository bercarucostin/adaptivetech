(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SpreadsheetImport=factory();})(globalThis,function(){
  'use strict';
  const key=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  function prepare(kind,info){
    const definitions={prices:{ID:['id'],Contract:['contract'],Tip_Lucrare:['tiplucrare'],Pret:['pret','price']},types:{ID:['id'],Tip_Lucrare:['tiplucrare'],Active:['active'],Billing_Mode:['billingmode']},costs:{Source_Row_No:['sourcerowno'],ID:['id','legacyid'],Tehnician:['tehnician','technician'],Tip_Lucrare:['tiplucrare'],Etapa:['etapa','stage'],Cost:['cost']}};
    const def=definitions[kind];if(!def)throw new Error('Secțiune necunoscută.');
    const required={prices:['Contract','Tip_Lucrare','Pret'],types:['Tip_Lucrare'],costs:['Tehnician','Tip_Lucrare','Etapa','Cost']}[kind];
    const errors=[],columns={},seen=new Set();
    for(const h of info.headers){const name=Object.keys(def).find(n=>def[n].includes(key(h)));if(!name)errors.push(`Coloană necunoscută: ${h}.`);else if(columns[name])errors.push(`Coloană duplicată: ${name}.`);else columns[name]=h;}
    for(const h of required)if(!columns[h])errors.push(`Lipsește coloana ${h}.`);
    if(!info.rows.length)errors.push('Fișierul nu conține rânduri.');
    if(info.rows.length>10000)errors.push('Maximum 10000 de rânduri per import.');
    const rows=info.rows.map((raw,i)=>{
      const get=n=>String(raw[columns[n]]??'').trim(),fail=msg=>errors.push(`Rândul ${info.rowNumbers?.[i]??i+2}: ${msg}`);
      const number=(name,optional=false)=>{let s=get(name).replace(/\s/g,'');if(!s&&optional)return '';if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else s=s.replace(',','.');const n=Number(s);if(!s||!/^\d+(?:\.\d+)?$/.test(s)||!Number.isFinite(n)||n<0)fail(`${name} trebuie să fie un număr pozitiv sau zero.`);return n;};
      for(const name of required.filter(n=>!['Pret','Cost'].includes(n)))if(!get(name))fail(`${name} este obligatoriu.`);
      let row,id=get(kind==='costs'?'Source_Row_No':'ID');
      if(id&&kind!=='prices'){if(!/^\d+$/.test(id)||BigInt(id)>(kind==='types'?9223372036854775807n:2147483647n))fail('Identificator numeric nevalid.');else id=BigInt(id).toString();}
      if(id){if(seen.has(id))fail(`Identificator duplicat: ${id}.`);seen.add(id);}
      if(kind==='prices')row={id,contract:get('Contract'),tip_lucrare:get('Tip_Lucrare'),pret:number('Pret')};
      else if(kind==='costs')row={source_row_no:id,legacy_id:get('ID'),tehnician:get('Tehnician'),tip_lucrare:get('Tip_Lucrare'),etapa:get('Etapa'),cost:number('Cost',true)};
      else{const active=get('Active').toLowerCase()||'true',billing=get('Billing_Mode').toLowerCase()||'per_tooth';if(!['true','false','1','0','yes','no','da','nu','active','inactive'].includes(active))fail('Active trebuie să fie true sau false.');if(!['per_tooth','per_arch','per_piece'].includes(billing))fail('Billing_Mode trebuie să fie per_tooth, per_arch sau per_piece.');row={id,tip_lucrare:get('Tip_Lucrare'),active:['false','0','no','nu','inactive'].includes(active)?'false':'true',billing_mode:billing};}
      return row;
    });return {rows,errors};
  }return {prepare};
});
