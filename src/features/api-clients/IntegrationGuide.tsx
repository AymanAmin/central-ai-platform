import { useEffect,useMemo,useState } from 'react'
import { Badge,Card,Empty,PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { codeLabel,codeLanguages,integrationEndpoint,integrationSnippet,scalarValue,type CodeLanguage } from './integrationSnippets'

type VariableRow={id:string;key:string;value:string}
type ApiClientOption={id:string;name:string;code:string;api_key_prefix:string;organization_id:string;is_active:boolean;capabilities:string[]|null}
type TestEnvelope={success:boolean;requestOk?:boolean;upstreamStatus?:number;latencyMs?:number;response?:unknown;error?:string;previewMode?:string;apiClient?:{id:string;name:string;code:string}}

const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`
const safeJson=(value:unknown)=>JSON.stringify(value,null,2)

async function invocationErrorMessage(error:unknown,fallback:string){
  if(!(error instanceof Error))return fallback
  const context=(error as Error&{context?:Response}).context
  if(context){
    try{
      const payload=await context.clone().json() as {error?:string;detail?:string}
      if(payload?.error)return payload.detail?`${payload.error}: ${payload.detail}`:payload.error
    }catch{/* Fall through to the SDK message. */}
  }
  return error.message||fallback
}

export function IntegrationGuide(){
  const {language,tr}=useI18n()
  const [clients,setClients]=useState<ApiClientOption[]>([])
  const [selectedClientId,setSelectedClientId]=useState('')
  const [clientsLoading,setClientsLoading]=useState(true)
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

  useEffect(()=>{
    let cancelled=false
    setClientsLoading(true)
    void supabase.from('api_clients').select('id,name,code,api_key_prefix,organization_id,is_active,capabilities').eq('is_active',true).order('name').then(({data,error:loadError})=>{
      if(cancelled)return
      if(loadError){setError(loadError.message);setClients([]);setSelectedClientId('');setClientsLoading(false);return}
      const options=(data??[]) as ApiClientOption[]
      setClients(options)
      setSelectedClientId(current=>current&&options.some(item=>item.id===current)?current:(options[0]?.id??''))
      setClientsLoading(false)
    })
    return()=>{cancelled=true}
  },[])

  const selectedClient=clients.find(item=>item.id===selectedClientId)??null
  const context=useMemo(()=>Object.fromEntries(variables.map(row=>[row.key.trim(),scalarValue(row.value)]).filter(([key])=>Boolean(key))),[variables])
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
  const generated=useMemo(()=>integrationSnippet(codeLanguage,payload),[codeLanguage,payload])
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
    if(!selectedClientId){setError(tr('اختر عميل API قبل تشغيل الاختبار.','Choose an API client before running the test.'));return}
    if(!customerId.trim()||!conversationId.trim()||!messageId.trim()||!messageText.trim()){setError(tr('أكمل الحقول المطلوبة قبل الاختبار.','Complete the required fields before testing.'));return}
    setBusy(true)
    try{
      const invocation=await supabase.functions.invoke<TestEnvelope>('integration-test',{body:{apiClientId:selectedClientId,payload}})
      if(invocation.error)throw new Error(await invocationErrorMessage(invocation.error,tr('فشل اختبار الربط.','Integration test failed.')))
      if(!invocation.data?.success)throw new Error(invocation.data?.error??'integration_test_failed')
      setResult(invocation.data)
    }catch(err){setError(err instanceof Error?err.message:tr('فشل اختبار الربط.','Integration test failed.'))}
    finally{setBusy(false)}
  }

  return <div className="integration-guide">
    <PageHeader title={tr('دليل الربط واختبار API','Integration Guide & API Tester')} description={tr('عدّل الطلب، أضف متغيرات context، نفّذ معاينة آمنة داخل المنصة، ثم انسخ مثال الربط باللغة التي يستخدمها فريقك.','Edit the request, add context variables, run a safe in-platform preview, then copy an integration example in your team’s language.')}/>

    <div className="integration-summary">
      <Card><span>01</span><strong>{tr('كوّن الطلب','Build request')}</strong><small>{tr('عدّل العميل والمحادثة والرسالة والمتغيرات.','Edit customer, conversation, message, and variables.')}</small></Card>
      <Card><span>02</span><strong>{tr('اختبر دون كشف المفتاح','Preview without exposing keys')}</strong><small>{tr('اختر عميل API؛ لا تحتاج إلى نسخ المفتاح السري داخل الشاشة.','Select an API client; no secret key needs to be pasted into the screen.')}</small></Card>
      <Card><span>03</span><strong>{tr('انسخ اللغة المناسبة','Copy your language')}</strong><small>{tr('cURL وJavaScript وPython وPHP وC#.','cURL, JavaScript, Python, PHP, and C#.')}</small></Card>
    </div>

    <div className="integration-workbench">
      <Card className="integration-builder">
        <div className="integration-section-head"><div><span>{tr('طلب تجريبي','Test request')}</span><h2>{tr('متغيرات الإرسال','Request variables')}</h2><p>{tr('المعاينة تستخدم إعدادات الذكاء والمعرفة الفعلية للجهة بدون إنشاء محادثة إنتاجية أو الحاجة للمفتاح الكامل.','The preview uses the organization’s real AI and knowledge settings without creating a production conversation or requiring the full API key.')}</p></div><Badge>{requestLanguage.toUpperCase()}</Badge></div>
        <div className="integration-endpoint"><span>{tr('نقطة الاتصال الفعلية','Production endpoint')}</span><code>{integrationEndpoint}</code></div>

        <div className="integration-form-grid">
          <label className="span-2"><span>{tr('عميل API المستخدم في المعاينة','API client used for preview')}</span><select value={selectedClientId} disabled={clientsLoading||clients.length===0} onChange={e=>{setSelectedClientId(e.target.value);setResult(null);setError('')}}><option value="">{clientsLoading?tr('جارٍ تحميل العملاء…','Loading API clients…'):tr('اختر عميل API…','Choose an API client…')}</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name} · {client.code} · {client.api_key_prefix}…</option>)}</select><small>{tr('يتم التحقق من صلاحياتك والجهة على الخادم. المفتاح السري لا يُسترجع ولا يُعرض ولا يُدوّر.','Your role and organization are verified on the server. The secret key is never retrieved, shown, or rotated.')}</small></label>
          {selectedClient&&<div className="span-2 notice">{tr(`المعاينة مرتبطة بـ ${selectedClient.name}. أمثلة الكود أدناه تستخدم مفتاحًا وهميًا لأن النظام الحقيقي يتطلب مفتاح ai_live_ الكامل.`,`Previewing as ${selectedClient.name}. The code samples below keep a placeholder because production calls require the full ai_live_ key.`)}</div>}
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

        <div className="integration-actions"><button type="button" onClick={()=>void run()} disabled={busy||clientsLoading||!selectedClientId}>{busy?tr('جارٍ تنفيذ المعاينة…','Running preview…'):tr('تشغيل المعاينة','Run preview')}</button><button type="button" className="ghost" onClick={regenerate}>{tr('توليد IDs جديدة','Generate new IDs')}</button></div>
        {error&&<div className="notice error" role="alert">{error}</div>}
      </Card>

      <Card className="integration-code-card">
        <div className="integration-section-head"><div><span>{tr('كود جاهز','Ready-to-use code')}</span><h2>{tr('شكل الإرسال','Request example')}</h2><p>{tr('هذه أمثلة الإنتاج الفعلية. استبدل المفتاح الوهمي بالمفتاح الكامل في بيئتك الآمنة.','These are real production examples. Replace the placeholder with the full key in your secure environment.')}</p></div></div>
        <div className="integration-code-tabs" role="tablist">{codeLanguages.map(item=><button type="button" role="tab" aria-selected={codeLanguage===item} className={codeLanguage===item?'active':''} onClick={()=>setCodeLanguage(item)} key={item}>{codeLabel[item]}</button>)}</div>
        <div className="integration-code-block"><div><span>{codeLabel[codeLanguage]}</span><button type="button" onClick={()=>void copy()}>{copied?tr('تم النسخ','Copied'):tr('نسخ','Copy')}</button></div><pre dir="ltr"><code>{generated}</code></pre></div>
        <details className="integration-json-preview"><summary>{tr('عرض JSON النهائي','View final JSON')}</summary><pre dir="ltr">{safeJson(payload)}</pre></details>
      </Card>
    </div>

    <Card className="integration-result-card">
      <div className="integration-section-head"><div><span>{tr('نتيجة المعاينة','Preview result')}</span><h2>{tr('شكل استجابة Central AI','Central AI response shape')}</h2><p>{tr('اعرض شكل القيم المتوقع للنظام الخارجي مع HTTP Status وزمن التنفيذ، دون إنشاء محادثة حقيقية من أداة الاختبار.','Inspect the response shape expected by an external system, including HTTP status and latency, without creating a real conversation from the tester.')}</p></div>{result&&<Badge tone={result.requestOk?'good':'bad'}>{result.requestOk?tr('نجحت المعاينة','Preview OK'):tr('فشلت المعاينة','Preview failed')}</Badge>}</div>
      {!result?<Empty>{tr('شغّل المعاينة لعرض الاستجابة هنا.','Run the preview to see the response here.')}</Empty>:<>
        <div className="integration-result-metrics"><div><span>HTTP</span><strong>{result.upstreamStatus??'—'}</strong></div><div><span>{tr('الزمن','Latency')}</span><strong>{result.latencyMs!=null?`${result.latencyMs} ms`:'—'}</strong></div><div><span>{tr('الحالة','Status')}</span><strong>{result.requestOk?tr('ناجح','Success'):tr('خطأ','Error')}</strong></div></div>
        <div className="integration-result-table-wrap"><table className="data-table integration-result-table"><thead><tr><th>{tr('الحقل','Field')}</th><th>{tr('القيمة','Value')}</th></tr></thead><tbody>{responseRows.map(([key,value])=><tr key={key}><td><code>{key}</code></td><td>{value}</td></tr>)}</tbody></table></div>
        <details className="integration-json-preview" open><summary>{tr('الاستجابة الخام JSON','Raw JSON response')}</summary><pre dir="ltr">{safeJson(result.response)}</pre></details>
      </>}
    </Card>
  </div>
}
