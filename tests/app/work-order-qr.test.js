const test=require('node:test');
const assert=require('node:assert/strict');
const qr=require('../../website/app/work-order-qr.js');
const token='af835f72-889e-4fcb-b6ad-b99ae84125ee';
test('QR URL contains only origin, app path and opaque token',()=>{
 assert.equal(qr.link(token,'https://app.example/index.html?patient=secret#other'),'https://app.example/index.html#work-order='+token);
 assert.throws(()=>qr.link('123','https://app.example/'));
 assert.throws(()=>qr.link(token,'javascript:alert(1)'));
});
test('scanned token is validated without interpreting other fragments',()=>{
 assert.equal(qr.token('#work-order='+token),token);
 assert.equal(qr.token('#access_token=abc'),null);
 assert.throws(()=>qr.token('#work-order=123'));
});
test('QR is an embedded vector with four-module quiet zone and no remote image',()=>{
 const svg=qr.svg(qr.link(token,'https://app.example/'));
 assert.match(svg,/<svg/);assert.match(svg,/viewBox=/);
 assert.ok(!svg.includes('<image'));assert.ok(!svg.includes('<script'));
});
