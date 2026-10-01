export function storageQuota(value){
 const text=String(value||'100000000000');if(!/^\d{1,19}$/.test(text)||BigInt(text)<=0n||BigInt(text)>9223372036854775807n)throw new Error('Invalid Storage quota configuration');return BigInt(text).toString();
}
function bytes(value){if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Invalid metrics');const text=String(value);if(!/^\d{1,19}$/.test(text))throw new Error('Invalid metrics');return BigInt(text);}
export async function readDiskUsage({projectRef,token,fetch=globalThis.fetch}){
 if(!token)return {available:false,reason:'Configurează tokenul pentru măsurarea discului.'};
 if(!/^[a-z0-9]{20}$/.test(String(projectRef||'')))return {available:false,reason:'Referința proiectului nu este configurată corect.'};
 try{
  const response=await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/disk/util`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return {available:false,reason:response.status===401||response.status===403?'Tokenul nu are acces la măsurarea discului.':'Măsurarea discului nu este disponibilă momentan.'};
  const data=await response.json(),m=data.metrics||{};const total=bytes(m.fs_size_bytes),used=bytes(m.fs_used_bytes),free=bytes(m.fs_avail_bytes);
  if(total<=0n||used>total||free>total||used+free>total||!Number.isFinite(Date.parse(data.timestamp)))throw new Error('Invalid metrics');
  return {available:true,used_bytes:used.toString(),available_bytes:free.toString(),total_bytes:total.toString(),measured_at:data.timestamp};
 }catch{return {available:false,reason:'Măsurarea discului nu este disponibilă momentan.'};}
}
