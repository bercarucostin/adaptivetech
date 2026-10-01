import test from 'node:test';import assert from 'node:assert/strict';
import {readDiskUsage,storageQuota} from '../../db/edge-functions/admin-storage-cleanup/metrics.mjs';
test('disk uses actual capacity and availability and timestamp',async()=>{
 const out=await readDiskUsage({projectRef:'abcdefghijklmnopqrst',token:'secret',fetch:async(url,opts)=>{assert.equal(url,'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/disk/util');assert.equal(opts.headers.Authorization,'Bearer secret');return new Response(JSON.stringify({timestamp:'2026-10-01T10:00:00Z',metrics:{fs_size_bytes:1000,fs_used_bytes:600,fs_avail_bytes:350}}));}});
 assert.deepEqual(out,{available:true,used_bytes:'600',available_bytes:'350',total_bytes:'1000',measured_at:'2026-10-01T10:00:00Z'});
});
test('missing credential and upstream errors never invent free space',async()=>{
 assert.equal((await readDiskUsage({projectRef:'abcdefghijklmnopqrst',token:''})).available,false);
 for(const status of [401,429,500]){const out=await readDiskUsage({projectRef:'abcdefghijklmnopqrst',token:'secret',fetch:async()=>new Response('secret upstream body',{status})});assert.equal(out.available,false);assert.ok(!JSON.stringify(out).includes('secret'));}
 const bad=await readDiskUsage({projectRef:'abcdefghijklmnopqrst',token:'secret',fetch:async()=>new Response(JSON.stringify({metrics:{fs_size_bytes:0,fs_used_bytes:-2,fs_avail_bytes:100}}))});assert.equal(bad.available,false);
 assert.equal((await readDiskUsage({projectRef:'bad/ref',token:'secret'})).available,false);
});
test('quota is server-side decimal bytes and rejects invalid configuration',()=>{assert.equal(storageQuota(''),'100000000000');assert.equal(storageQuota('200000000000'),'200000000000');assert.throws(()=>storageQuota('-1'));assert.throws(()=>storageQuota('1.5'));});
