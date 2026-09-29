/* Spreadsheet parsing runs locally in a disposable worker. */
window.SpreadsheetUI={
  job(message){return new Promise((resolve,reject)=>{
    const worker=new Worker('spreadsheet-worker.js?v=1');
    const finish=(error,result)=>{clearTimeout(timer);worker.terminate();error?reject(new Error(error)):resolve(result);};
    const timer=setTimeout(()=>finish('Procesarea a durat prea mult. Folosește un fișier mai mic.'),30000);
    worker.onmessage=e=>finish(e.data.error,e.data.result);
    worker.onerror=()=>finish('Nu pot procesa fișierul. Reîncarcă pagina și încearcă din nou.');
    worker.postMessage(message,message.bytes?[message.bytes]:[]);
  });},
  async read(file){
    if(file.size>10*1024*1024)throw new Error('Fișierul poate avea maximum 10 MB.');
    const extension=file.name.split('.').pop().toLowerCase();
    if(!['xlsx','csv','tsv'].includes(extension))throw new Error('Alege un fișier .xlsx, .csv sau .tsv.');
    const bytes=await file.arrayBuffer();
    if(extension==='xlsx')return this.job({action:'xlsx',bytes});
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Salvează fișierul ca Excel .xlsx sau CSV UTF-8 pentru a păstra diacriticele.');}
    return this.job({action:'csv',text});
  },
  preview({fileName,info,validation}){return new Promise(resolve=>{
    const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const dialog=document.createElement('dialog');dialog.className='spreadsheet-preview';dialog.setAttribute('aria-labelledby','spreadsheet-title');
    dialog.innerHTML=`<form method="dialog"><h2 id="spreadsheet-title">Verifică importul</h2><p>${esc(fileName)} · ${info.rows.length} rânduri</p><div class="spreadsheet-table"><table><thead><tr><th>Rând</th>${info.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${info.rows.slice(0,15).map((r,i)=>`<tr><td>${info.rowNumbers[i]}</td>${info.headers.map(h=>`<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>Previzualizare: primele 15 rânduri. Validarea verifică întregul fișier.</p>${validation.errors.length?`<div class="spreadsheet-errors" role="alert"><strong>${validation.errors.length} erori — corectează fișierul înainte de import.</strong><ul>${validation.errors.slice(0,50).map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>`:'<p>Fișier valid. Identificatorii existenți actualizează rândurile; identificatorii goi creează rânduri noi.</p>'}<label>Mod de import <select name="mode"><option value="MERGE">Adaugă / actualizează (MERGE)</option><option value="REPLACE">Înlocuiește secțiunea (REPLACE)</option></select></label><label class="spreadsheet-replace" hidden><input type="checkbox" name="replace">Confirm înlocuirea tuturor rândurilor existente din această secțiune.</label><div class="spreadsheet-actions"><button type="button" class="secondary-btn" data-cancel>Renunță</button><button class="primary-btn" type="submit">Importă ${info.rows.length} rânduri</button></div></form>`;
    const form=dialog.querySelector('form'),mode=form.elements.mode,confirm=form.elements.replace,submit=form.querySelector('[type=submit]');
    const update=()=>{dialog.querySelector('.spreadsheet-replace').hidden=mode.value!=='REPLACE';submit.disabled=!!validation.errors.length||(mode.value==='REPLACE'&&!confirm.checked);};
    let result=null;form.addEventListener('change',update);form.addEventListener('submit',e=>{if(submit.disabled){e.preventDefault();return;}result=mode.value;});
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});
    document.body.append(dialog);update();dialog.showModal();
  });}
};
