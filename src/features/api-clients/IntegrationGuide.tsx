import { useMemo,useState } from 'react'
import { Badge,Card,Empty,PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'

type CodeLanguage='curl'|'javascript'|'python'|'php'|'csharp'
type VariableRow={id:string;key:string;value:string}
type TestEnvelope={success:boolean;requestOk?:boolean;upstreamStatus?:number;latencyMs?:number;response?:unknown;error?:string}

const endpoint='https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat'
const codeLanguages:CodeLanguage[]=['curl','javascript','python','php','csharp']
const codeLabel:Record<CodeLanguage,string>={curl:'cURL',javascript:'JavaScript',python:'Python',php:'PHP',csharp:'C#'}
const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`
const safeJson=(value:unknown)=>JSON.stringify(value,null,2)
const shellSingleQuote=(value:string)=>value.replace(/'/g,"'\"'\"'")
const scalar=(value:string):unknown=>{const clean=value.trim();if(clean==='true')return true;if(clean==='false')return false;if(clean==='null')return null;if(clean!==''&&Number.isFinite(Number(clean)))return Number(clean);if((clean.startsWith('{')&&clean.endsWith('}'))||(clean.startsWith('[')&&clean.endsWith(']'))){try{return JSON.parse(clean)}catch{/* keep as text */}}return value}

function snippet(language:CodeLanguage,payload:Record<string,unknown>){
  const body=safeJson(payload)
  if(language==='curl')return `curl -X POST '${endpoint}' \\
  -H 'Authorization: Bearer ai_live_YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  --data '${shellSingleQuote(body)}'`
  if(language==='javascript')return `const response = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ai_live_YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${body}),
})

const result = await response.json()
console.log(result)`
  if(language==='python')return `import requests

payload = ${body.replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnull\b/g,'None')}
response = requests.post(
    '${endpoint}',
    headers={
        'Authorization': 'Bearer ai_live_YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json=payload,
    timeout=60,
)
print(response.json())`
  if(language==='php')return `<?php
$payload = ${body};
$ch = curl_init('${endpoint}');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ai_live_YOUR_API_KEY',
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode($payload),
]);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`
  return `using System.Net.Http.Headers;
using System.Text;

using var client = new HttpClient();
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", "ai_live_YOUR_API_KEY");

var json = """
${body}
""";
var response = await client.PostAsync(
    "${endpoint}",
    new StringContent(json, Encoding.UTF8, "application/json")
);
Console.WriteLine(await response.Content.ReadAsStringAsync());`
}

export function IntegrationGuide(){
  const {language,tr}=useI18n()
  const [apiKey,setApiKey]=useState('')
  const [showKey,setShowKey]=useState(false)
  const [channel,setChannel]=useState('whatsapp')
  const [customerId,setCustomerId]=useState('966500000000')
  const [customerName,setCustomerName]=useState(language==='ar'?'محمد':'John')
  const [customerPhone,setCustomerPhone]=useState('')
  const [customerEmail,setCustomerEmail]=useState('')
  const [requestLanguage,setRequestLanguage]=useState<'ar'|'en'>(language==='ar'?'ar':'en')
  const [conversationId,setConversationId]=useState(()=>id('conversation'))
  const [messageId,setMessageId]=useState(()=>id('message'))
  const [messageText,setMessageText]=useState(language==='ar'?'كم الرسوم؟':'What are the fees?')
  const [variables,setVariables]=useState<VariableRow[]>([{id:crypto.randomUUID(),key:'source',value:'integration-guide'}])
  const [codeLanguage,setCodeLanguage]=useState<CodeLanguage>('curl')
  const [copied,setCopied]=useState(false)
  const [busy,setBusy]=useState(false)
  const [result,setResult]=useState<TestEnvelope|null>(null)
  const [error,setError]=useState('')

  const context=useMemo(()=>Object.fromEntries(variables.map(row=>[row.key.trim(),scalar(row.value)]).filter(([key])=>Boolean(key))),[variables])
  const payload=useMemo(()=>({
    channel:channel.trim()||'web',
    customer:{
      externalId:customerId.trim(),
      name:customerName.trim()||undefined,
      phone:customerPhone.trim()||undefined,
      email:customerEmail.trim()||undefined,
      language:requestLanguage,
    },
    conversation:{externalId:conversationId.trim()},
    message:{externalId:messageId.trim(),type:'text',text:messageText.trim()},
    context,
  }),[channel,customerId,customerName,customerPhone,customerEmail,requestLanguage,conversationId,messageId,messageText,context])
  const generated=useMemo(()=>snippet(codeLanguage,payload),[codeLanguage,payload])
  const responseRows=useMemo(()=>{
    if(!result||result.response==null)return [] as Array<[string,string]>
    if(typeof result.response!=='object'||Array.isArray(result.response))return [['response',String(result.response)]]
    return Object.entries(result.response as Record<string,unknown>).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)] as [string,string])
  },[result])

  const regenerate=()=>{setConversationId(id('conversation'));setMessageId(id('message'));setResult(null);setError('')}
  const addVariable=()=>setVariables(rows=>[...rows,{id:crypto.randomUUID(),key:'',value:''}])
  const updateVariable=(rowId:string,field:'key'|'value',value:string)=>setVariables(rows=>rows.map(row=>row.id===rowId?{...row,[field]:value}:row))
  const removeVariable=(rowId:string)=>setVariables(rows=>rows.filter(row=>row.id!==rowId))
  const copy=async()=>{await navigator.clipboard.writeText(generated);setCopied(true);window.setTimeout(()=>setCopied(false),1600)}
  const run=async()=>{
    setError('');setResult(null)
    if(!apiKey.trim().startsWith('ai_live_')){setError(tr('أدخل مفتاح API صحيحًا يبدأ بـ ai_live_.','Enter a valid API key starting with ai_live_.'));return}
    if(!customerId.trim()||!conversationId.trim()||!messageId.trim()||!messageText.trim()){setError(tr('أكمل الحقول المطلوبة قبل الاختبار.','Complete the required fields before testing.'));return}
    setBusy(true)
    try{
      const invocation=await supabase.functions.invoke<TestEnvelope>('integration-test',{body:{apiKey:apiKey.trim(),payload}})
      if(invocation.error)throw invocation.error
      if(!invocation.data?.success)throw new Error(invocation.data?.error??'integration_test_failed')
      setResult(invocation.data)
    }catch(err){setError(err instanceof Error?err.message:tr('فشل اختبار الربط.','Integration test failed.'))}
    finally{setBusy(false)}
  }

  return <div className="integration-guide">
    <PageHeader title={tr('دليل الربط واختبار API','Integration Guide & API Tester')} description={tr('عدّل الطلب، أضف متغيرات context، نفّذ تجربة حقيقية، ثم انسخ مثال الربط باللغة التي يستخدمها فريقك.','Edit the request, add context variables, run a real test, then copy an integration example in your team’s language.')}/>

    <div className="integration-summary">
      <Card><span>01</span><strong>{tr('كوّن الطلب','Build request')}</strong><small>{tr('عدّل العميل والمحادثة والرسالة والمتغيرات.','Edit customer, conversation, message, and variables.')}</small></Card>
      <Card><span>02</span><strong>{tr('اختبر بأمان','Test securely')}</strong><small>{tr('المفتاح لا يُحفظ ولا يظهر داخل أمثلة الكود.','The key is not stored or exposed in code samples.')}</small></Card>
      <Card><span>03</span><strong>{tr('انسخ اللغة المناسبة','Copy your language')}</strong><small>{tr('cURL وJavaScript وPython وPHP وC#.','cURL, JavaScript, Python, PHP, and C#.')}</small></Card>
    </div>

    <div className="integration-workbench">
      <Card className="integration-builder">
        <div className="integration-section-head"><div><span>{tr('طلب تجريبي','Test request')}</span><h2>{tr('متغيرات الإرسال','Request variables')}</h2><p>{tr('الاختبار ينفذ نفس عقد /chat المستخدم في الربط الحقيقي.','The test executes the same /chat contract used by a real integration.')}</p></div><Badge>{requestLanguage.toUpperCase()}</Badge></div>

        <div className="integration-endpoint"><span>{tr('نقطة الاتصال','Endpoint')}</span><code>{endpoint}</code></div>

        <div className="integration-form-grid">
          <label className="span-2"><span>{tr('مفتاح API للاختبار','API key for testing')}</span><div className="integration-secret"><input type={showKey?'text':'password'} autoComplete="off" spellCheck={false} value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="ai_live_…"/><button type="button" onClick={()=>setShowKey(v=>!v)}>{showKey?tr('إخفاء','Hide'):tr('إظهار','Show')}</button></div><small>{tr('يُرسل إلى وظيفة اختبار آمنة ولا يُخزن في قاعدة البيانات أو الكود المعروض.','Sent to a secure test function and never stored in the database or shown in generated code.')}</small></label>
          <label><span>{tr('القناة','Channel')}</span><input value={channel} onChange={e=>setChannel(e.target.value)} placeholder="whatsapp"/></label>
          <label><span>{tr('لغة العميل','Customer language')}</span><select value={requestLanguage} onChange={e=>setRequestLanguage(e.target.value as 'ar'|'en')}><option value="ar">العربية — ar</option><option value="en">English — en</option></select></label>
          <label><span>{tr('معرّف العميل','Customer externalId')}</span><input dir="ltr" value={customerId} onChange={e=>setCustomerId(e.target.value)}/></label>
          <label><span>{tr('اسم العميل','Customer name')}</span><input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label>
          <label><span>{tr('الجوال — اختياري','Phone — optional')}</span><input dir="ltr" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)} placeholder="+966…"/></label>
          <label><span>{tr('البريد — اختياري','Email — optional')}</span><input dir="ltr" type="email" value={customerEmail} onChange={e=>setCustomerEmail(e.target.value)} placeholder="name@example.com"/></label>
          <label><span>{tr('معرّف المحادثة','Conversation externalId')}</span><input dir="ltr" value={conversationId} onChange={e=>setConversationId(e.target.value)}/></label>
          <label><span>{tr('معرّف الرسالة','Message externalId')}</span><input dir="ltr" value={messageId} onChange={e=>setMessageId(e.target.value)}/></label>
          <label className="span-2"><span>{tr('نص الرسالة','Message text')}</span><textarea rows={4} value={messageText} onChange={e=>setMessageText(e.target.value)}/></label>
        </div>

        <div className="integration-variables">
          <div className="integration-variable-title"><div><strong>{tr('متغيرات Context','Context variables')}</strong><small>{tr('يمكن إضافة أي key/value يحتاجه التكامل. JSON والأرقام والقيم المنطقية تُفهم تلقائيًا.','Add any key/value your integration needs. JSON, numbers, and booleans are detected automatically.')}</small></div><button type="button" className="ghost" onClick={addVariable}>＋ {tr('إضافة متغير','Add variable')}</button></div>
          {variables.length===0?<Empty>{tr('لا توجد متغيرات إضافية.','No extra variables.')}</Empty>:<div className="integration-variable-list">{variables.map(row=><div className="integration-variable-row" key={row.id}><input dir="ltr" aria-label={tr('اسم المتغير','Variable name')} placeholder="key" value={row.key} onChange={e=>updateVariable(row.id,'key',e.target.value)}/><input aria-label={tr('قيمة المتغير','Variable value')} placeholder={tr('القيمة','value')} value={row.value} onChange={e=>updateVariable(row.id,'value',e.target.value)}/><button type="button" className="ghost danger" onClick={()=>removeVariable(row.id)} aria-label={tr('حذف المتغير','Remove variable')}>×</button></div>)}</div>}
        </div>

        <div className="integration-actions"><button type="button" onClick={()=>void run()} disabled={busy}>{busy?tr('جارٍ تنفيذ الطلب…','Running request…'):tr('تشغيل الاختبار','Run test')}</button><button type="button" className="ghost" onClick={regenerate}>{tr('توليد IDs جديدة','Generate new IDs')}</button></div>
        {error&&<div className="notice error" role="alert">{error}</div>}
      </Card>

      <Card className="integration-code-card">
        <div className="integration-section-head"><div><span>{tr('كود جاهز','Ready-to-use code')}</span><h2>{tr('شكل الإرسال','Request example')}</h2><p>{tr('المفتاح الحقيقي لا يظهر هنا؛ استبدل القيمة الوهمية في بيئتك الآمنة.','Your real key is never shown here; replace the placeholder in your secure environment.')}</p></div></div>
        <div className="integration-code-tabs" role="tablist">{codeLanguages.map(item=><button type="button" role="tab" aria-selected={codeLanguage===item} className={codeLanguage===item?'active':''} onClick={()=>setCodeLanguage(item)} key={item}>{codeLabel[item]}</button>)}</div>
        <div className="integration-code-block"><div><span>{codeLabel[codeLanguage]}</span><button type="button" onClick={()=>void copy()}>{copied?tr('تم النسخ','Copied'):tr('نسخ','Copy')}</button></div><pre dir="ltr"><code>{generated}</code></pre></div>
        <details className="integration-json-preview"><summary>{tr('عرض JSON النهائي','View final JSON')}</summary><pre dir="ltr">{safeJson(payload)}</pre></details>
      </Card>
    </div>

    <Card className="integration-result-card">
      <div className="integration-section-head"><div><span>{tr('نتيجة التنفيذ','Execution result')}</span><h2>{tr('استجابة Central AI','Central AI response')}</h2><p>{tr('اعرض القيم كما سيستلمها النظام الخارجي، مع HTTP Status وزمن التنفيذ.','See the values exactly as an external system receives them, including HTTP status and latency.')}</p></div>{result&&<Badge tone={result.requestOk?'good':'bad'}>{result.requestOk?tr('نجح الطلب','Request OK'):tr('رفض الطلب','Request failed')}</Badge>}</div>
      {!result?<Empty>{tr('شغّل الاختبار لعرض الاستجابة هنا.','Run the test to see the response here.')}</Empty>:<>
        <div className="integration-result-metrics"><div><span>HTTP</span><strong>{result.upstreamStatus??'—'}</strong></div><div><span>{tr('الزمن','Latency')}</span><strong>{result.latencyMs!=null?`${result.latencyMs} ms`:'—'}</strong></div><div><span>{tr('الحالة','Status')}</span><strong>{result.requestOk?tr('ناجح','Success'):tr('خطأ','Error')}</strong></div></div>
        <div className="integration-result-table-wrap"><table className="data-table integration-result-table"><thead><tr><th>{tr('الحقل','Field')}</th><th>{tr('القيمة','Value')}</th></tr></thead><tbody>{responseRows.map(([key,value])=><tr key={key}><td><code>{key}</code></td><td>{value}</td></tr>)}</tbody></table></div>
        <details className="integration-json-preview" open><summary>{tr('الاستجابة الخام JSON','Raw JSON response')}</summary><pre dir="ltr">{safeJson(result.response)}</pre></details>
      </>}
    </Card>
  </div>
}
