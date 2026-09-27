import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function setup(turnstile) {
 const window={turnstile};const scripts=[];
 const document={createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}};
 const context={window,document,setTimeout,clearTimeout,Promise};
 assert.ok(fs.existsSync('website/app/login-security.js'),'CAPTCHA controller exists');
 vm.runInNewContext(fs.readFileSync('website/app/login-security.js','utf8'),context);
 return {window,scripts};
}
test('CAPTCHA token resets, expires and errors fail closed',async()=>{
 let callbacks,resets=0;
 const {window}=setup({render:(_,o)=>{callbacks=o;return 1;},reset:()=>resets++});
 const c=window.LoginSecurity.create({siteKey:'key',container:{}});
 await c.load();assert.equal(c.getToken(),'');
 callbacks.callback('token');assert.equal(c.getToken(),'token');
 callbacks['expired-callback']();assert.equal(c.getToken(),'');
 callbacks.callback('token');c.reset();assert.equal(c.getToken(),'');assert.equal(resets,1);
 callbacks['error-callback']();assert.equal(c.state.ready,false);assert.ok(c.state.error);
});
test('missing config and blocked loader surface actionable errors',async()=>{
 const {window,scripts}=setup();const missing=window.LoginSecurity.create({container:{}});await missing.load();assert.ok(missing.state.error);
 const c=window.LoginSecurity.create({siteKey:'key',container:{}});const loading=c.load();scripts[0].onerror();await loading;assert.equal(c.getToken(),'');assert.match(c.state.error,/reîncarcă/i);
});
