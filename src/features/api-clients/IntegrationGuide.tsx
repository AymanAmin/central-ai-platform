import { Card, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'

export function IntegrationGuide(){
  const {language,tr}=useI18n()
  const endpoint='https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat'
  const name=language==='ar'?'محمد':'John'
  const question=language==='ar'?'كم الرسوم؟':'What are the fees?'
  const request=`curl -X POST '${endpoint}' \\
  -H 'Authorization: Bearer ai_live_xxx' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "channel":"whatsapp",
    "customer":{"externalId":"966500000000","name":"${name}","language":"${language}"},
    "conversation":{"externalId":"WA-966500000000"},
    "message":{"externalId":"wamid-001","type":"text","text":"${question}"},
    "context":{}
  }'`

  return <>
    <PageHeader title={tr('دليل الربط','Integration Guide')} description={tr('ترسل المنصة الخارجية الطلب إلى Central AI وتستخدم استجابة JSON لإكمال الإجراء في القناة الأصلية.','The external platform sends the request to Central AI and uses the JSON response to complete the action in the original channel.')}/>
    <Card>
      <h2>{tr('نقطة الاتصال','Endpoint')}</h2>
      <code>{endpoint}</code>
      <h2>{tr('المصادقة','Authorization')}</h2>
      <pre>Authorization: Bearer ai_live_xxxxxxxxx</pre>
      <h2>{tr('مثال باستخدام cURL','cURL example')}</h2>
      <pre>{request}</pre>
    </Card>
  </>
}
