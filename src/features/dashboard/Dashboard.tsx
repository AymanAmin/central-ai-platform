import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/Ui'
import type { Profile } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

type Stats={organizations:number;messages:number;conversations:number;handoffs:number;documents:number;cost:number}

export function Dashboard({profile}:{profile:Profile}){
  const {tr}=useI18n()
  const [stats,setStats]=useState<Stats>({organizations:0,messages:0,conversations:0,handoffs:0,documents:0,cost:0})

  useEffect(()=>{void(async()=>{
    const orgFilter=profile.role==='SUPER_ADMIN'?null:profile.organization_id

    const organizationsPromise=supabase.from('organizations').select('id',{count:'exact',head:true})
    const messagesBase=supabase.from('messages').select('id',{count:'exact',head:true})
    const conversationsBase=supabase.from('conversations').select('id',{count:'exact',head:true}).neq('status','closed')
    const handoffsBase=supabase.from('handoff_requests').select('id',{count:'exact',head:true}).in('status',['waiting','assigned'])
    const documentsBase=supabase.from('knowledge_documents').select('id',{count:'exact',head:true})
    const usageBase=supabase.from('usage_logs').select('estimated_cost')

    const messagesPromise=orgFilter?messagesBase.eq('organization_id',orgFilter):messagesBase
    const conversationsPromise=orgFilter?conversationsBase.eq('organization_id',orgFilter):conversationsBase
    const handoffsPromise=orgFilter?handoffsBase.eq('organization_id',orgFilter):handoffsBase
    const documentsPromise=orgFilter?documentsBase.eq('organization_id',orgFilter):documentsBase
    const usagePromise=orgFilter?usageBase.eq('organization_id',orgFilter):usageBase

    const [o,m,c,h,d,u]=await Promise.all([
      organizationsPromise,
      messagesPromise,
      conversationsPromise,
      handoffsPromise,
      documentsPromise,
      usagePromise,
    ])
    setStats({organizations:o.count??0,messages:m.count??0,conversations:c.count??0,handoffs:h.count??0,documents:d.count??0,cost:(u.data??[]).reduce((s,r)=>s+Number(r.estimated_cost??0),0)})
  })()},[profile])

  const cards=[
    [tr('الجهات','Organizations'),stats.organizations,tr('ضمن النطاق الحالي','Current scope')],
    [tr('الرسائل','Messages'),stats.messages,tr('إجمالي الرسائل المسجلة','Recorded messages')],
    [tr('المحادثات النشطة','Active conversations'),stats.conversations,tr('غير مغلقة','Not closed')],
    [tr('بانتظار موظف','Waiting for agent'),stats.handoffs,tr('طلبات التحويل المفتوحة','Open handoffs')],
    [tr('مستندات المعرفة','Knowledge documents'),stats.documents,tr('مصادر المعرفة المسجلة','Registered sources')],
    [tr('التكلفة الفعلية','Actual cost'),`$${stats.cost.toFixed(4)}`,tr('حسب وضع فوترة كل مزود','Based on each provider billing mode')],
  ] as const

  const route=[
    [tr('القنوات','Channels'),tr('موقع، CRM، واتساب، تطبيق','Web, CRM, WhatsApp, app')],
    ['Central AI',tr('عزل الجهات وذاكرة المحادثة','Tenant isolation + memory')],
    [tr('المعرفة والأدوات','Knowledge & tools'),tr('RAG وواجهات البيانات الحية','RAG + live data APIs')],
    ['Gemini Flash-Lite',tr('استجابة منظمة منخفضة التكلفة','Structured, cost-aware response')],
  ] as const

  return <>
    <PageHeader title={tr('لوحة التحكم','Dashboard')} description={tr('مركز تشغيل المنصة: الاستخدام، المعرفة، والتحويل البشري في نظرة واحدة.','Operate usage, knowledge, and human handoff from one clear view.')}/>

    <section className="platform-route" aria-label={tr('مسار معالجة الطلب','Request processing path')}>
      <div className="route-heading"><span>{tr('مسار الطلب','Request path')}</span><strong>{tr('من أي قناة إلى إجابة موثوقة','From any channel to a grounded answer')}</strong></div>
      <div className="route-grid">{route.map(([title,description],index)=><div className="route-step" key={title}>
        <span className="route-index">{String(index+1).padStart(2,'0')}</span>
        <div><strong>{title}</strong><small>{description}</small></div>
      </div>)}</div>
    </section>

    <div className="stats">{cards.map(([label,value,caption],index)=><Card className={`metric-card metric-${index+1}`} key={String(label)}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </Card>)}</div>
  </>
}
