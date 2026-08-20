import { useEffect, useMemo, useState } from 'react'
import { functionsBaseUrl,supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import type { KnowledgeBase, Organization, Profile } from '../../types/domain'

interface Result{answer?:string;intent?:string;confidence?:number;sources?:Array<{documentId:string;page:number|null;similarity:number;preview:string}>;usage?:Record<string,number>;latencyMs?:number;error?:string}
const selectedOrgStorageKey='central-ai-setup-org'

export function Playground({profile}:{profile:Profile}){
  const {tr}=useI18n()
  const [orgs,setOrgs]=useState<Organization[]>([])
  const [bases,setBases]=useState<KnowledgeBase[]>([])
  const [organizationId,setOrganizationId]=useState(()=>profile.organization_id??localStorage.getItem(selectedOrgStorageKey)??'')
  const [knowledgeBaseId,setKnowledgeBaseId]=useState('')
  const [question,setQuestion]=useState('')
  const [result,setResult]=useState<Result|null>(null)
  const [loading,setLoading]=useState(false)
  const [loadError,setLoadError]=useState('')

  useEffect(()=>{void(async()=>{
    const [organizations,basesResult]=await Promise.all([
      supabase.from('organizations').select('*').eq('is_active',true).order('created_at',{ascending:true}),
      supabase.from('knowledge_bases').select('*').eq('is_active',true).order('created_at',{ascending:true}),
    ])
    if(organizations.error||basesResult.error){setLoadError(organizations.error?.message??basesResult.error?.message??tr('تعذر تحميل الخيارات.','Unable to load options.'));return}
    const organizationRows=(organizations.data??[]) as Organization[]
    setOrgs(organizationRows)
    setBases((basesResult.data??[]) as KnowledgeBase[])
    if(!organizationId&&organizationRows.length===1)setOrganizationId(organizationRows[0].id)
  })()},[tr,organizationId])

  useEffect(()=>{
    if(organizationId)localStorage.setItem(selectedOrgStorageKey,organizationId)
    setKnowledgeBaseId(current=>bases.some(base=>base.id===current&&base.organization_id===organizationId)?current:'')
  },[organizationId,bases])

  const visibleBases=useMemo(()=>bases.filter(base=>base.organization_id===organizationId),[bases,organizationId])

  const run=async(e:React.FormEvent)=>{
    e.preventDefault();setLoading(true);setResult(null)
    try{
      const {data:{session}}=await supabase.auth.getSession()
      if(!session){setResult({error:tr('غير مسجل الدخول','Not authenticated')});return}
      const res=await fetch(`${functionsBaseUrl}/playground`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({organizationId,knowledgeBaseId:knowledgeBaseId||null,question})})
      setResult(await res.json() as Result)
    } catch(error) {
      setResult({error:error instanceof Error?error.message:tr('تعذر تنفيذ الاختبار.','Unable to run the test.')})
    } finally { setLoading(false) }
  }

  return <><PageHeader title="AI Playground" description={tr('وضع اختبار بدون حفظ محادثة أو إنشاء عميل وهمي.','Test mode without persisting a conversation or creating a fake customer.')}/><div className="split"><Card><form className="stack" onSubmit={run}>{profile.role==='SUPER_ADMIN'?<label>{tr('الجهة','Organization')}<select required value={organizationId} onChange={e=>setOrganizationId(e.target.value)}><option value="">{tr('اختر الجهة','Select organization')}</option>{orgs.map(org=><option key={org.id} value={org.id}>{org.name_ar} / {org.name_en??org.code}</option>)}</select></label>:<input type="hidden" value={organizationId}/>}<label>{tr('قاعدة المعرفة','Knowledge base')}<select value={knowledgeBaseId} onChange={e=>setKnowledgeBaseId(e.target.value)} disabled={!organizationId}><option value="">{tr('كل قواعد المعرفة النشطة','All active knowledge bases')}</option>{visibleBases.map(base=><option key={base.id} value={base.id}>{base.name}</option>)}</select></label><textarea required rows={7} placeholder={tr('اكتب سؤالًا حقيقيًا لاختبار Gemini وRAG','Ask a real question to test Gemini and RAG')} value={question} onChange={e=>setQuestion(e.target.value)}/><button disabled={loading||!organizationId}>{loading?tr('جارٍ الاختبار…','Testing…'):tr('اختبار','Test')}</button>{loadError&&<p className="error-text">{loadError}</p>}</form></Card><Card><h2>{tr('التشخيص','Diagnostics')}</h2>{result?<><pre className="answer">{result.answer??result.error}</pre><p>{tr('النية','Intent')}: {result.intent??'—'} · {tr('الثقة','Confidence')}: {result.confidence??'—'} · {tr('الزمن','Latency')}: {result.latencyMs??'—'} ms</p><div>{result.sources?.map((s,i)=><div className="source" key={`${s.documentId}-${i}`}><strong>{tr('النتيجة','Top')} {i+1}: {s.similarity.toFixed(3)}</strong><small>{s.documentId} · {tr('صفحة','page')} {s.page??'—'}</small><p>{s.preview}</p></div>)}</div></>:<p>{tr('ستظهر هنا الإجابة والمصادر والثقة والزمن بعد الاختبار.','The answer, sources, confidence, and latency will appear here after the test.')}</p>}</Card></div></>}
