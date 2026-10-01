import test from 'node:test';import assert from 'node:assert/strict';
import {storageQuota} from '../../db/edge-functions/admin-storage-cleanup/metrics.mjs';
test('quota is server-side decimal bytes and rejects invalid configuration',()=>{assert.equal(storageQuota(''),'100000000000');assert.equal(storageQuota('200000000000'),'200000000000');assert.throws(()=>storageQuota('-1'));assert.throws(()=>storageQuota('1.5'));});
