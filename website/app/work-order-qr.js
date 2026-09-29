(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/qrcode-generator-2.0.4.js'));
  else root.WorkOrderQR=factory(root.qrcode);
})(globalThis,function(qrcode){
  'use strict';
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  function valid(value){if(!uuid.test(String(value)))throw new Error('Codul QR nu este valid.');return String(value).toLowerCase();}
  return {
    token(hash){const p=new URLSearchParams(String(hash).replace(/^#/,''));return p.has('work-order')?valid(p.get('work-order')):null;},
    link(token,base){const u=new URL(base);if(!['https:','http:'].includes(u.protocol))throw new Error('Adresă nevalidă.');u.username='';u.password='';u.search='';u.hash='work-order='+valid(token);return u.href;},
    svg(url){const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();return qr.createSvgTag({cellSize:4,margin:16,scalable:true});}
  };
});
