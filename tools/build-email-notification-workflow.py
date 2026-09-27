"""Build the importable workflow from versioned Code node sources."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
nodes=[]
def node(name,kind,version,parameters,x,**extra):
    nodes.append(dict(id=name.lower().replace(' ','-'),name=name,type='n8n-nodes-base.'+kind,typeVersion=version,position=[x,0],parameters=parameters,**extra))
node('Every minute','scheduleTrigger',1.2,{'rule':{'interval':[{'field':'minutes','minutesInterval':1}]}},0)
node('Manual test','manualTrigger',1,{},0)
nodes[-1]['position']=[0,200]
node('Claim notifications','postgres',2.6,{'operation':'executeQuery','query':'SELECT * FROM public.claim_email_notifications(10);','options':{}},240)
node('Prepare email','code',2,{'mode':'runOnceForEachItem','jsCode':(root/'workflows/code/prepare-notification-email.js').read_text()},480)
node('Send with Gmail','httpRequest',4.4,{
 'method':'POST','url':'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
 'authentication':'predefinedCredentialType','nodeCredentialType':'gmailOAuth2',
 'sendBody':True,'specifyBody':'json','jsonBody':'={{ { raw: $json.raw } }}',
 'options':{'timeout':30000,'batching':{'batch':{'batchSize':1,'batchInterval':1000}},'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'json'}}}
},720,retryOnFail=False,onError='continueRegularOutput')
node('Classify delivery','code',2,{'mode':'runOnceForEachItem','jsCode':(root/'workflows/code/notification-delivery-result.js').read_text()},960)
node('Record delivery','postgres',2.6,{'operation':'executeQuery','query':'SELECT public.finish_email_notification($1::uuid,$2::uuid,$3::text,$4::text);','options':{'queryBatching':'independently','queryReplacement':'={{ [$json.id, $json.lease_token, $json.outcome, $json.message_id] }}'}},1200)
node('Setup','stickyNote',1,{'content':'## Before activation\n1. Apply 20260927_email_notifications.sql.\n2. Select the Supabase Postgres credential in both SQL nodes.\n3. Enable Gmail API and create Gmail OAuth2 credential for contact@flowrisedental.ro. Select it in Send with Gmail.\n4. Configure app@flowrisedental.ro in Gmail Send mail as.\n5. Enable preferences for a test user; create a test order and run manually.\n6. Verify queue states and Gmail delivery, then activate.\n\nTen notifications per minute. Only HTTP 429 is retried (max 5 attempts). 5xx/timeouts become uncertain; check Sent mail before replay. Inspect failed/uncertain states in Supabase. Never retry a whole send execution blindly. No patient data in email.','height':410,'width':510},400)
nodes[-1]['position']=[400,250]
connections={}
for source,target in [('Every minute','Claim notifications'),('Manual test','Claim notifications'),('Claim notifications','Prepare email'),('Prepare email','Send with Gmail'),('Send with Gmail','Classify delivery'),('Classify delivery','Record delivery')]:
    connections[source]={'main':[[{'node':target,'type':'main','index':0}]]}
workflow={'name':'Flowrise Dental - Email Notifications','nodes':nodes,'connections':connections,'active':False,'settings':{'executionOrder':'v1','timezone':'Europe/Bucharest','executionTimeout':600,'saveDataSuccessExecution':'none','saveDataErrorExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False},'pinData':{}}
(root/'workflows/Flowrise Dental - Email Notifications.json').write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
