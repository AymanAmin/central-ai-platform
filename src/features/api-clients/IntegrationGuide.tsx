import { useEffect,useMemo,useState } from 'react'
import { Badge,Card,Empty,PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import {
  codeLabel,
  codeLanguages,
  integrationEndpoint,
  integrationSnippet,
  scalarValue,
  voiceIntegrationEndpoint,
  voiceIntegrationSnippet,
  type CodeLanguage,
} from './integrationSnippets'

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
  const [voiceCodeLanguage,setVoiceCodeLanguage]=useState<CodeLanguage>('curl')
  const [copied,setCopied]=useState(false)
  const [voiceCopied,setVoiceCopied]=useState(false)
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
  const generatedVoice=useMemo(()=>voiceIntegrationSnippet(voiceCodeLanguage,{
    channel:channel.trim()||'voice',
    customerExternalId:customerId.trim(),
    customerName:customerName.trim()||undefined,
    customerPhone:customerPhone.trim()||undefined,
    customerEmail:customerEmail.trim()||undefined,
    conversationExternalId:conversationId.trim(),
    messageExternalId:messageId.trim(),
    language:requestLanguage,
    durationMs:12000,
    context,
  }),[voiceCodeLanguage,channel,customerId,customerName,customerPhone,customerEmail,conversationId,messageId,requestLanguage,context])
  const voiceResponseExample=useMemo(()=>({
    success:true,
    conversationId:'CONV-001',
    status:'completed',
    answer:language==='ar'?'يمكنك التقديم من خلال بوابة القبول.':'You can apply through the admission portal.',
    transcript:language==='ar'?'السلام عليكم، كيف أقدم؟':'Hello, how do I apply?',
    intent:'admission',
    confidence:0.91,
    usage:{inputTokens:820,outputTokens:65,estimatedCost:0.00012},
    voice:{durationMs:12000,mimeType:'audio/mp4'},
    voiceStored:true,
    voiceReply:{url:'https://signed-url.example/audio.wav',mimeType:'audio/wav',durationMs:5300},
  }),[language])
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
  const copyVoice=async()=>{await navigator.clipboard.writeText(generatedVoice);setVoiceCopied(true);window.setTimeout(()=>setVoiceCopied(false),1600)}
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
    <PageHeader title={tr('دليل الربط واختبار API','Integration Guide & API Tester')} description={tr('استخدم نفس عميل API للنص والصوت، تعرّف على طريقة احتساب الاستهلاك، جرّب الطلب النصي بأمان، ثم انسخ مثال الربط المناسب لفريقك.','Use the same API client for text and voice, understand how usage is counted, safely preview a text request, then copy the integration example your team needs.')}/>

    <div className="integration-summary">
      <Card><span>01</span><strong>{tr('كوّن الطلب','Build request')}</strong><small>{tr('حدّد العميل والمحادثة والرسالة وcontext.','Set customer, conversation, message, and context.')}</small></Card>
      <Card><span>02</span><strong>{tr('اختر نصًا أو صوتًا','Choose text or voice')}</strong><small>{tr('استخدم /chat للنص و/voice-message للصوت.','Use /chat for text and /voice-message for audio.')}</small></Card>
      <Card><span>03</span><strong>{tr('راقب الاستهلاك','Track usage')}</strong><small>{tr('تُسجّل العمليات والتوكنات والتكلفة لكل جهة وعميل API.','Operations, tokens, and cost are logged per organization and API client.')}</small></Card>
    </div>

    <Card className="integration-result-card">
      <div className="integration-section-head"><div><span>{tr('الاستهلاك والتكلفة','Usage & cost')}</span><h2>{tr('متى يتم احتساب الاستهلاك؟','When is usage counted?')}</h2><p>{tr('الربط الخارجي يستخدم نفس مسار المعالجة الفعلي للمنصة؛ لذلك تُسجّل كل عملية AI في usage_logs وتظهر ضمن تقارير الاستهلاك والتكلفة.','External API calls use the platform’s real processing path, so every AI operation is written to usage_logs and appears in usage and cost reports.')}</p></div><Badge>usage_logs</Badge></div>
      <div className="integration-result-metrics">
        <div><span>{tr('رسالة نصية عادية','Normal text')}</span><strong>Embedding + Chat</strong></div>
        <div><span>{tr('رسالة صوتية','Voice message')}</span><strong>Transcription + Chat</strong></div>
        <div><span>{tr('رد صوتي مفعّل','Voice reply enabled')}</span><strong>+ TTS</strong></div>
      </div>
      <div className="notice">{tr('لا يتم استدعاء Chat AI للتحيات السريعة أو FAQ المباشر. كما أن إعادة نفس messageExternalId تعيد النتيجة السابقة بدل استدعاء AI مرة أخرى؛ وفي الصوت لا تتم إعادة التفريغ الصوتي للرسالة المكررة.','Chat AI is not called for greeting fast-path or direct FAQ answers. Reusing the same messageExternalId returns the existing result instead of calling AI again; duplicate voice messages are not transcribed again.')}</div>
      <details className="integration-json-preview"><summary>{tr('ما الذي يُحسب في الرسالة الصوتية؟','What is counted for a voice message?')}</summary><pre dir="ltr">{`voice_transcription  -> speech to text\nembedding            -> knowledge search query\nchat                 -> AI answer\nvoice_tts            -> only when a voice reply is generated`}</pre></details>
    </Card>

    <div className="integration-workbench">
      <Card className="integration-builder">
        <div className="integration-section-head"><div><span>{tr('طلب نصي تجريبي','Text test request')}</span><h2>{tr('متغيرات الإرسال','Request variables')}</h2><p>{tr('المعاينة تستخدم إعدادات الذكاء والمعرفة الفعلية للجهة بدون إنشاء محادثة إنتاجية أو الحاجة للمفتاح الكامل.','The preview uses the organization’s real AI and knowledge settings without creating a production conversation or requiring the full API key.')}</p></div><Badge>{requestLanguage.toUpperCase()}</Badge></div>
        <div className="integration-endpoint"><span>{tr('نقطة اتصال النص','Text endpoint')}</span><code>{integrationEndpoint}</code></div>

        <div className="integration-form-grid">
          <label className="span-2"><span>{tr('عميل API المستخدم في المعاينة','API client used for preview')}</span><select value={selectedClientId} disabled={clientsLoading||clients.length===0} onChange={e=>{setSelectedClientId(e.target.value);setResult(null);setError('')}}><option value="">{clientsLoading?tr('جارٍ تحميل العملاء…','Loading API clients…'):tr('اختر عميل API…','Choose an API client…')}</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name} · {client.code} · {client.api_key_prefix}…</option>)}</select><small>{tr('يتم التحقق من صلاحياتك والجهة على الخادم. المفتاح السري لا يُسترجع ولا يُعرض ولا يُدوّر.','Your role and organization are verified on the server. The secret key is never retrieved, shown, or rotated.')}</small></label>
          {selectedClient&&<div className="span-2 notice">{tr(`المعاينة مرتبطة بـ ${selectedClient.name}. أمثلة الكود أدناه تستخدم مفتاحًا وهميًا لأن الاستدعاء الحقيقي يتطلب مفتاح ai_live_ الكامل.`,`Previewing as ${selectedClient.name}. The code samples below use a placeholder because real calls require the full ai_live_ key.`)}</div>}
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
        <div className="integration-section-head"><div><span>{tr('كود النص','Text code')}</span><h2>{tr('مثال /chat','/chat example')}</h2><p>{tr('هذه أمثلة إنتاج فعلية. استبدل المفتاح الوهمي بالمفتاح الكامل داخل خادمك أو بيئة أسرارك، وليس داخل JavaScript عام في المتصفح.','These are real production examples. Replace the placeholder with the full key in your server or secret environment, not public browser JavaScript.')}</p></div></div>
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

    <div className="integration-workbench">
      <Card className="integration-builder">
        <div className="integration-section-head"><div><span>{tr('الرسائل الصوتية','Voice messages')}</span><h2>{tr('إرسال مقطع صوتي عبر API','Send an audio clip through the API')}</h2><p>{tr('أرسل الملف إلى voice-message بصيغة multipart/form-data. المنصة تفرّغ الصوت إلى نص ثم تمرر النص تلقائيًا إلى نفس محرك المحادثة والذاكرة وRAG.','Send the file to voice-message as multipart/form-data. The platform transcribes the audio, then automatically passes the transcript through the same chat, memory, and RAG pipeline.')}</p></div><Badge>multipart/form-data</Badge></div>
        <div className="integration-endpoint"><span>{tr('نقطة اتصال الصوت','Voice endpoint')}</span><code>{voiceIntegrationEndpoint}</code></div>
        <div className="integration-result-metrics">
          <div><span>{tr('أقصى حجم للملف','Maximum file size')}</span><strong>8 MB</strong></div>
          <div><span>{tr('المدة الافتراضية القصوى','Default max duration')}</span><strong>120 sec</strong></div>
          <div><span>{tr('الصيغ المدعومة','Supported formats')}</span><strong>WebM · OGG · WAV · MP3 · AAC · FLAC · M4A</strong></div>
        </div>
        <div className="integration-result-table-wrap"><table className="data-table integration-result-table"><thead><tr><th>{tr('الحقل','Field')}</th><th>{tr('طريقة الاستخدام','How to use it')}</th></tr></thead><tbody>
          <tr><td><code>audio</code></td><td>{tr('ملف الصوت نفسه. حقل multipart إلزامي.','The audio file itself. Required multipart field.')}</td></tr>
          <tr><td><code>durationMs</code></td><td>{tr('مدة المقطع بالمللي ثانية، مثال 12000 لمقطع 12 ثانية.','Clip duration in milliseconds; for example, 12000 for 12 seconds.')}</td></tr>
          <tr><td><code>customerExternalId</code></td><td>{tr('المعرّف الثابت للعميل في نظامك.','Stable customer identifier in your system.')}</td></tr>
          <tr><td><code>conversationExternalId</code></td><td>{tr('استخدم نفس القيمة للرسائل التابعة لنفس المحادثة حتى تستمر الذاكرة.','Reuse the same value for messages in the same conversation so memory continues.')}</td></tr>
          <tr><td><code>messageExternalId</code></td><td>{tr('معرّف فريد لكل رسالة. إعادة نفس القيمة تمنع احتساب الرسالة ومعالجتها مرة أخرى.','Unique per message. Reusing it prevents the message from being processed and charged again.')}</td></tr>
          <tr><td><code>channel</code></td><td>{tr('مثل whatsapp أو website أو mobile.','For example whatsapp, website, or mobile.')}</td></tr>
          <tr><td><code>language</code></td><td>{tr('اختياري كإشارة للتفريغ: ar أو en.','Optional transcription hint: ar or en.')}</td></tr>
          <tr><td><code>contextJson</code></td><td>{tr('JSON نصي لإرسال verifiedCustomer أو أي سياق إضافي.','JSON string for verifiedCustomer or any additional context.')}</td></tr>
        </tbody></table></div>
        <div className="notice">{tr('لا ترسل History كامل. يكفي أن تحافظ على conversationExternalId؛ المنصة تسترجع الملخص والرسائل الأخيرة بنفسها. استخدم نفس مفتاح ai_live_ الذي يملك صلاحية chat.','Do not send the full history. Keep the same conversationExternalId and the platform retrieves summaries and recent messages itself. Use the same ai_live_ key with chat capability.')}</div>
        <details className="integration-json-preview"><summary>{tr('أوضاع الرد الصوتي','Voice reply modes')}</summary><pre dir="ltr">{`text_only       -> voice input is understood, response stays text\nvoice_for_voice -> voice input receives a generated voice reply\nalways_voice     -> eligible replies are generated as voice`}</pre></details>
        <details className="integration-json-preview"><summary>{tr('مثال استجابة رسالة صوتية','Example voice response')}</summary><pre dir="ltr">{safeJson(voiceResponseExample)}</pre></details>
      </Card>

      <Card className="integration-code-card">
        <div className="integration-section-head"><div><span>{tr('كود الصوت','Voice code')}</span><h2>{tr('مثال /voice-message','/voice-message example')}</h2><p>{tr('المثال يستخدم voice.m4a بمدة 12 ثانية ويأخذ معرفات العميل والمحادثة الحالية من النموذج أعلاه. غيّر الملف والمدة قبل الاستخدام الفعلي.','The example uses a 12-second voice.m4a file and reuses the customer and conversation identifiers above. Replace the file and duration for production use.')}</p></div></div>
        <div className="integration-code-tabs" role="tablist">{codeLanguages.map(item=><button type="button" role="tab" aria-selected={voiceCodeLanguage===item} className={voiceCodeLanguage===item?'active':''} onClick={()=>setVoiceCodeLanguage(item)} key={item}>{codeLabel[item]}</button>)}</div>
        <div className="integration-code-block"><div><span>{codeLabel[voiceCodeLanguage]}</span><button type="button" onClick={()=>void copyVoice()}>{voiceCopied?tr('تم النسخ','Copied'):tr('نسخ','Copy')}</button></div><pre dir="ltr"><code>{generatedVoice}</code></pre></div>
      </Card>
    </div>
  </div>
}
