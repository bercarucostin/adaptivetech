(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/xlsx-0.20.3.full.min.js'));
  else root.SpreadsheetIO=factory(root.XLSX);
})(globalThis,function(XLSX){
  'use strict';
  const MAX_ROWS=10000,MAX_COLUMNS=30;
  function table(grid,rowNumbers){
    if(!grid.length)throw new Error('Fișierul este gol.');
    const headers=grid[0].map(v=>String(v??'').trim());
    const canonical=headers.map(h=>h.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''));
    if(headers.length<2||headers.length>MAX_COLUMNS||canonical.some(h=>!h)||new Set(canonical).size!==headers.length)throw new Error('Antetele trebuie să fie completate, unice și pe primul rând (maximum 30 de coloane).');
    const rows=[],numbers=[];
    grid.slice(1).forEach((r,i)=>{
      if(r.every(v=>String(v??'').trim()===''))return;
      if(r.length>headers.length)throw new Error(`Rândul ${rowNumbers[i+1]} are mai multe coloane decât antetul.`);
      rows.push(Object.fromEntries(headers.map((h,c)=>[h,r[c]??''])));numbers.push(rowNumbers[i+1]);
    });
    if(rows.length>MAX_ROWS)throw new Error('Maximum 10000 de rânduri per import.');
    return {headers,rows,rowNumbers:numbers};
  }
  function readCsv(text){
    let source=String(text).replace(/^\ufeff/,''),delimiter;
    const hint=source.match(/^sep=([;,\t])\r?\n/i);let line=1;
    if(hint){delimiter=hint[1];source=source.slice(hint[0].length);line=2;}
    if(!delimiter){
      const first=source.split(/\r?\n/).find(v=>v.trim())||'';
      delimiter=[',',';','\t'].map(d=>{let quoted=false,n=0;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&first[i]===d)n++;}return {d,n};}).sort((a,b)=>b.n-a.n)[0].d;
    }
    const grid=[],numbers=[];let row=[],field='',quoted=false,closed=false,start=line;
    const endField=()=>{row.push(field);field='';closed=false;};
    const endRow=()=>{endField();if(row.some(v=>v.trim())){grid.push(row);numbers.push(start);}row=[];start=line+1;if(grid.length>MAX_ROWS+1)throw new Error('Maximum 10000 de rânduri per import.');};
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=c;if(c==='\n')line++;}continue;}
      if(c===delimiter){endField();continue;}
      if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;endRow();line++;continue;}
      if(closed)throw new Error(`Rândul ${line}: text după ghilimeaua de închidere.`);
      if(c==='"'){if(field)throw new Error(`Rândul ${line}: ghilimele nevalide.`);quoted=true;}else field+=c;
    }
    if(quoted)throw new Error(`Rândul ${start}: ghilimele neînchise.`);
    endRow();return {...table(grid,numbers),delimiter};
  }
  function readXlsx(bytes){
    if(new Uint8Array(bytes)[0]!==0x50||new Uint8Array(bytes)[1]!==0x4b)throw new Error('Fișierul nu este un document .xlsx valid.');
    const wb=XLSX.read(bytes,{type:'array',cellDates:false,cellNF:true,cellFormula:true,sheetRows:MAX_ROWS+2});
    if(wb.SheetNames.length!==1)throw new Error('Importă un fișier cu o singură foaie de date.');
    const ws=wb.Sheets[wb.SheetNames[0]];
    if(!ws['!ref'])throw new Error('Foaia este goală.');
    const range=XLSX.utils.decode_range(ws['!fullref']||ws['!ref']);
    if(range.e.r>MAX_ROWS||range.e.c>=MAX_COLUMNS)throw new Error('Maximum 10000 de rânduri și 30 de coloane per import.');
    const grid=[];
    for(let r=0;r<=range.e.r;r++){
      const row=[];
      for(let c=0;c<=range.e.c;c++){
        const address=XLSX.utils.encode_cell({r,c}),cell=ws[address];let value=cell?.v??'';
        if(cell?.f||cell?.F)throw new Error(`Celula ${address}: formulele nu se importă. Copiază și lipește doar valorile în Excel.`);
        if(cell?.t==='e'||cell?.t==='d'||(cell?.t==='n'&&XLSX.SSF.is_date(cell.z||'')))throw new Error(`Celula ${address}: valoare sau format incompatibil cu această configurație.`);
        const header=String(grid[0]?.[c]||'');
        if(cell?.t==='n'&&/^(id|sourcerowno|legacyid)$/.test(header.toLowerCase().replace(/[^a-z]/g,''))){
          if(!Number.isSafeInteger(value))throw new Error(`Celula ${address}: identificatorul trebuie păstrat ca text, nu număr.`);
          value=/^0+$/.test(cell.z||'')?XLSX.utils.format_cell(cell):String(value);
        }
        row.push(value);
      }
      grid.push(row);
    }
    return {...table(grid,grid.map((_,i)=>i+1)),delimiter:'xlsx'};
  }
  function write(dataset){
    if(dataset.rows.length>MAX_ROWS)throw new Error('Maximum 10000 de rânduri per export.');
    const grid=[dataset.headers,...dataset.rows.map(row=>row.map((value,i)=>{
      if(value===null||value===undefined||value==='')return '';
      if(['Pret','Cost'].includes(dataset.headers[i])){const n=Number(value);if(!Number.isFinite(n))throw new Error('Valoare numerică nevalidă la export.');return n;}
      return String(value);
    }))];
    const ws=XLSX.utils.aoa_to_sheet(grid);
    ws['!cols']=dataset.headers.map(h=>({wch:h==='Tip_Lucrare'?36:h==='Contract'||h==='Tehnician'?28:20}));
    ws['!autofilter']={ref:ws['!ref']};
    for(let r=1;r<grid.length;r++)for(let c=0;c<dataset.headers.length;c++){
      const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell)cell.z=cell.t==='n'?'0.00':'@';
    }
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Date');
    return XLSX.write(wb,{type:'array',bookType:'xlsx',compression:true});
  }
  return {readCsv,readXlsx,write};
});
