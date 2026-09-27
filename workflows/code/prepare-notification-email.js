// n8n Code node, Run Once for Each Item. Only vetted queue fields enter the email.
const row=$json;
if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(row.recipient_email||''))throw new Error('Invalid recipient address');
if(!/^[a-f0-9-]{36}$/.test(row.id||'')||!/^\d+$/.test(String(row.work_order_id)))throw new Error('Invalid notification identifiers');
const stages={model:'Model',modelare:'Modelare',cer_fin:'Ceramică / Finisare'};
const statuses={'Not Started':'Neînceput','Started':'În lucru','Finished':'Finalizat'};
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let title,detail;
if(row.event_kind==='new_work_order'){
 title=`Lucrare nouă #${row.work_order_id}`;detail='O lucrare nouă este disponibilă în aplicație.';
}else if(row.event_kind==='assignment'&&stages[row.stage_key]){
 title=`Lucrare asignată #${row.work_order_id}`;detail=`Ți-a fost asignată etapa <strong>${stages[row.stage_key]}</strong>.`;
}else if(row.event_kind==='stage_status'&&stages[row.stage_key]){
 title=`Lucrare #${row.work_order_id} — ${stages[row.stage_key]}`;
 detail=`Statusul etapei <strong>${stages[row.stage_key]}</strong> s-a modificat: <strong>${escape(statuses[row.old_status]||row.old_status)}</strong> → <strong>${escape(statuses[row.new_status]||row.new_status)}</strong>.`;
}else throw new Error('Unsupported notification event');
const html=`<!doctype html><html lang="ro"><body style="font-family:Arial,sans-serif;background:#faf8f4;padding:24px;color:#3c3326"><div style="max-width:560px;margin:auto;background:white;border:1px solid #e3dccf;border-radius:16px;padding:28px"><p style="color:#927027;font-size:13px;letter-spacing:2px">FLOWRISE DENTAL</p><h2>${escape(title)}</h2><p style="line-height:1.7">${detail}</p><p style="margin:28px 0"><a href="https://app.flowrisedental.ro/" style="background:#a57212;color:white;text-decoration:none;padding:12px 18px;border-radius:8px">Deschide aplicația</a></p><p style="font-size:12px;color:#786e60">Poți modifica aceste notificări din contul tău, la „Notificări email”. Acesta este un mesaj automat.</p></div></body></html>`;
const encoded=Buffer.from(html,'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
const mime=[
 'From: Flowrise Dental <app@flowrisedental.ro>',
 `To: ${row.recipient_email}`,
 `Subject: =?UTF-8?B?${Buffer.from(title,'utf8').toString('base64')}?=`,
 `Message-ID: <${row.id}@flowrisedental.ro>`,
 'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',encoded
].join('\r\n');
return {json:{id:row.id,lease_token:row.lease_token,raw:Buffer.from(mime,'utf8').toString('base64url')}};
