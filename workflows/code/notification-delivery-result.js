// n8n Code node, Run Once for Each Item; linked item survives HTTP response replacement.
const source=$('Prepare email').item.json;
const response=$json;
const status=Number(response.statusCode||0);
let outcome='uncertain',messageId=null;
if(status>=200&&status<300&&typeof response.body?.id==='string'&&response.body.id){
 outcome='sent';messageId=response.body.id;
}else if(status===429){
 // Google explicitly rejected the request; retry later, bounded by SQL attempt count.
 outcome='retry';
}else if(status>=400&&status<500){
 outcome='failed';
}
// Network failures and 5xx can occur after acceptance. Keep for manual reconciliation.
return {json:{id:source.id,lease_token:source.lease_token,outcome,message_id:messageId}};
