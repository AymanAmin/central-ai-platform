import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, PageHeader } from '../../components/Ui'
import type { Profile } from '../../types/domain'

type Stats={organizations:number;messages:number;conversations:number;handoffs:number;documents:number;cost:number}
export function Dashboard({profile}:{profile:Profile}){const [stats,setStats]=useState<Stats>({organizations:0,messages:0,conversations:0,handoffs:0,documents:0,cost:0})
 useEffect(()=>{void(async()=>{const orgFilter=profile.role==='SUPER_ADMIN'?null:profile.organization_id; const q=<T extends {eq:(a:string,b:string)=>T}>(x:T)=>orgFilter?x.eq('organization_id',orgFilter):x
 const [o,m,c,h,d,u]=await Promise.all([supabase.from('organizations').select('id',{count:'exact',head:true}),q(supabase.from('messages').select('id',{count:'exact',head:true})),q(supabase.from('conversations').select('id',{count:'exact',head:true}).neq('status','closed')),q(supabase.from('handoff_requests').select('id',{count:'exact',head:true}).in('status',['waiting','assigned'])),q(supabase.from('knowledge_documents').select('id',{count:'exact',head:true})),q(supabase.from('usage_logs').select('estimated_cost'))]);setStats({organizations:o.count??0,messages:m.count??0,conversations:c.count??0,handoffs:h.count??0,documents:d.count??0,cost:(u.data??[]).reduce((s,r)=>s+Number(r.estimated_cost??0),0)})})()},[profile])
 const cards=[['الجهات',stats.organizations],['الرسائل',stats.messages],['المحادثات النشطة',stats.conversations],['بانتظار موظف',stats.handoffs],['مستندات المعرفة',stats.documents],['التكلفة التقديرية',`$${stats.cost.toFixed(4)}`]]
 return <><PageHeader title="لوحة التحكم" description="ملخص حالة المنصة والاستخدام الحالي."/><div className="stats">{cards.map(([label,value])=><Card key={String(label)}><span>{label}</span><strong>{value}</strong></Card>)}</div></>}
