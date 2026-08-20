import { useState } from 'react'
import { functionsBaseUrl,supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
interface Result{answer?:string;intent?:string;confidence?:number;sources?:Array<{documentId:string;page:number|null;similarity:number;preview:string}>;usage?:Record<string,number>;latencyMs?:number;error?:string}
export function Playground(){
  const {tr}=useI18n()
  const [organizationId,setOrganizationId]=useState('')
  const [knowledgeBaseId,setKnowledgeBaseId]=useState('')
  const [question,setQuestion]=useState('')
  const [result,setResult]=useState<Result|null>(null)
  const [loading,setLoading]=useState(false)
  const run=async(e:React.FormEvent)=>{
    e.preventDefault();setLoading(true)
    try{
      const {data:{session}}=await supabase.auth.getSession()
      if(!session){setResult({error:tr('غير مسجل الدخول','Not authenticated')});return}
      const res=await fetch(`${functionsBaseUrl}/playground`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({organizationId,knowledgeBaseId:knowledgeBaseId||null,question})})
      setResult(await res.json() as Result)
    } finally { setLoading(false) }
  }
  return <><PageHeader title="AI Playground" description={tr('وضع اختبار بدون حفظ محادثة.','Test mode without saving a conversation.')}/><div className="split"><Card><form className="stack" onSubmit={run}><input required placeholder={tr('معرف الجهة UUID','Organization UUID')} value={organizationId} onChange={e=>setOrganizationId(e.target.value)}/><input placeholder={tr('معرف قاعدة المعرفة UUID (اختياري)','Knowledge Base UUID (optional)')} value={knowledgeBaseId} onChange={e=>setKnowledgeBaseId(e.target.value)}/><textarea required rows={7} placeholder={tr('السؤال','Question')} value={question} onChange={e=>setQuestion(e.target.value)}/><button disabled={loading}>{loading?tr('جارٍ الاختبار…','Testing…'):tr('اختبار','Test')}</button></form></Card><Card><h2>{tr('التشخيص','Diagnostics')}</h2>{result&&<><pre className="answer">{result.answer??result.error}</pre><p>{tr('النية','Intent')}: {result.intent??'—'} · {tr('الثقة','Confidence')}: {result.confidence??'—'} · {tr('الزمن','Latency')}: {result.latencyMs??'—'} ms</p><div>{result.sources?.map((s,i)=><div className="source" key={`${s.documentId}-${i}`}><strong>{tr('النتيجة','Top')} {i+1}: {s.similarity.toFixed(3)}</strong><small>{s.documentId} · {tr('صفحة','page')} {s.page??'—'}</small><p>{s.preview}</p></div>)}</div></>}</Card></div></>}
