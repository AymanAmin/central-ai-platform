import { Card, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'

export function IntegrationGuide(){const {language,tr}=useI18n();const endpoint='https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat';const name=language==='ar'?'محمد':'John';const question=language==='ar'?'كم الرسوم؟':'What are the fees?';const request=`curl -X POST '${endpoint}' \\
  -H 'Authorization: Bearer ai_live_xxx' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "channel":"whatsapp",
    "customer":{"externalId":"966500000000","name":"${name}","language":"${language}"},
    "conversation":{"externalId":"WA-966500000000"},
    "message":{"externalId":"wamid-001","type":"text","text":"${question}"},
    "context":{}
  }'`;return <><PageHeader title={tr('دليل الربط','Integration Guide')} description={tr('Central AI لا ترسل WhatsApp؛ النظام الخارجي يرسل الطلب ويستهلك استجابة JSON.','Central AI does not send WhatsApp messages; the external system sends the request and consumes the JSON response.')}/><Card><h2>Endpoint</h2><code>{endpoint}</code><h2>Authorization</h2><pre>Authorization: Bearer ai_live_xxxxxxxxx</pre><h2>cURL</h2><pre>{request}</pre></Card></>}
