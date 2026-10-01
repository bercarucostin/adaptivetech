export function storageQuota(value){
 const text=String(value||'100000000000');if(!/^\d{1,19}$/.test(text)||BigInt(text)<=0n||BigInt(text)>9223372036854775807n)throw new Error('Invalid Storage quota configuration');return BigInt(text).toString();
}
