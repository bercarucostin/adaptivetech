"""Build the importable workflow from versioned Code node sources."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
nodes=[]
def node(name,kind,version,parameters,x,**extra):
    nodes.append(dict(id=name.lower().replace(' ','-'),name=name,type='n8n-nodes-base.'+kind,typeVersion=version,position=[x,0],parameters=parameters,**extra))
node('Hourly recovery','scheduleTrigger',1.2,{'rule':{'interval':[{'field':'hours','hoursInterval':1}]}},0)
node('Notification webhook','webhook',2,{'httpMethod':'POST','path':'flowrise-email-notifications','authentication':'headerAuth','responseMode':'onReceived','options':{}},0,webhookId='flowrise-email-notifications')
nodes[-1]['position']=[0,-200]
node('Manual test','manualTrigger',1,{},0)
nodes[-1]['position']=[0,200]
node('Claim notifications','postgres',2.6,{'operation':'executeQuery','query':'SELECT * FROM public.claim_email_notifications(10);','options':{}},240,executeOnce=True)
node('Prepare email','code',2,{'mode':'runOnceForEachItem','jsCode':(root/'workflows/code/prepare-notification-email.js').read_text()},480)
node('Send with Gmail','httpRequest',4.4,{
 'method':'POST','url':'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
 'authentication':'predefinedCredentialType','nodeCredentialType':'gmailOAuth2',
 'sendBody':True,'specifyBody':'json','jsonBody':'={{ { raw: $json.raw } }}',
 'options':{'timeout':30000,'batching':{'batch':{'batchSize':1,'batchInterval':1000}},'response':{'response':{'fullResponse':True,'neverError':True,'responseFormat':'json'}}}
},720,retryOnFail=False,onError='continueRegularOutput')
node('Classify delivery','code',2,{'mode':'runOnceForEachItem','jsCode':(root/'workflows/code/notification-delivery-result.js').read_text()},960)
node('Record delivery','postgres',2.6,{'operation':'executeQuery','query':'SELECT public.finish_email_notification($1::uuid,$2::uuid,$3::text,$4::text);','options':{'queryBatching':'independently','queryReplacement':'={{ [$json.id, $json.lease_token, $json.outcome, $json.message_id] }}'}},1200)
node('Next batch','code',2,{'mode':'runOnceForAllItems','jsCode':(root/'workflows/code/notification-next-batch.js').read_text()},1440)
node('Setup','stickyNote',1,{'content':'## Before activation\n1. Existing notification installation: apply 20261001_lab_partner_orders.sql before activation. New installation only: first apply 20260927_email_notifications.sql and 20260927_work_order_status_notifications.sql, then the Lab Partner migration with its prerequisites.\n2. Select the Supabase Postgres credential in both SQL nodes.\n3. Enable Gmail API and create Gmail OAuth2 credential for contact@flowrisedental.ro. Select it in Send with Gmail.\n4. Configure app@flowrisedental.ro in Gmail Send mail as.\n5. Enable preferences for a test user; test a new order, an overall status change, and approval/refusal notifications.\n6. Select Header Auth in Notification webhook (X-Flowrise-Webhook-Secret).\n7. Activate and configure a Supabase Database Webhook: INSERT only on public.email_notification_queue, POST to https://app.flowrisedental.ro/api/ai/flowrise-email-notifications with the same secret header.\n8. Disable the previous notification workflow before activating this replacement. See docs/email-notifications.md for testing.\n\nImmediate webhook plus hourly recovery. Batches of 10, at most 20 batches per execution. Empty claim stops processing. Remaining backlog waits for another webhook or hourly run. Only HTTP 429 is retried (max 5 attempts). 5xx/timeouts become uncertain; check Sent mail before replay. Inspect failed/uncertain states in Supabase. Never retry a whole send execution blindly. No patient data in email.','height':620,'width':510},400)
nodes[-1]['position']=[400,250]
connections={}
for source,target in [('Hourly recovery','Claim notifications'),('Notification webhook','Claim notifications'),('Manual test','Claim notifications'),('Claim notifications','Prepare email'),('Prepare email','Send with Gmail'),('Send with Gmail','Classify delivery'),('Classify delivery','Record delivery'),('Record delivery','Next batch'),('Next batch','Claim notifications')]:
    connections[source]={'main':[[{'node':target,'type':'main','index':0}]]}
workflow={'name':'Flowrise Dental - Email Notifications','nodes':nodes,'connections':connections,'active':False,'settings':{'executionOrder':'v1','timezone':'Europe/Bucharest','executionTimeout':600,'saveDataSuccessExecution':'none','saveDataErrorExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False},'pinData':{}}
(root/'workflows/Flowrise Dental - Email Notifications.json').write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
