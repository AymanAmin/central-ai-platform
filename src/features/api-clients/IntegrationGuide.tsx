import { Card, PageHeader } from '../../components/Ui'
export function IntegrationGuide(){const endpoint='https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat';const request=`curl -X POST '${endpoint}' \\
  -H 'Authorization: Bearer ai_live_xxx' \\
  -H 'Content-Type: application/json' \\
  -d '{\n    "channel":"whatsapp",\n    "customer":{"externalId":"966500000000","name":"محمد"},\n    "conversation":{"externalId":"WA-966500000000"},\n    "message":{"externalId":"wamid-001","type":"text","text":"كم الرسوم؟"},\n    "context":{}\n  }'`;return <><PageHeader title="دليل الربط" description="Central AI لا ترسل WhatsApp؛ النظام الخارجي يرسل الطلب ويستهلك JSON Response."/><Card><h2>Endpoint</h2><code>{endpoint}</code><h2>Authorization</h2><pre>Authorization: Bearer ai_live_xxxxxxxxx</pre><h2>cURL</h2><pre>{request}</pre></Card></>}
