import { useEffect,useMemo,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'
import type { UsageLog } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

export function Usage(){
  const {tr,formatDate,valueLabel}=useI18n()
  const [rows,setRows]=useState<UsageLog[]>([])
  useEffect(()=>{void supabase.from('usage_logs').select('*').order('created_at',{ascending:false}).limit(500).then(r=>setRows((r.data??[]) as UsageLog[]))},[])
  const totals=useMemo(()=>rows.reduce((a,r)=>({input:a.input+r.input_tokens,output:a.output+r.output_tokens,embed:a.embed+r.embedding_tokens,cost:a.cost+Number(r.estimated_cost)}),{input:0,output:0,embed:0,cost:0}),[rows])

  return <>
    <PageHeader title={tr('الاستخدام والتكلفة','Usage & Cost')} description={tr('راجع استهلاك الرموز والتكلفة والعمليات المسجلة لفهم أين تُصرف ميزانية الذكاء الاصطناعي.','Review token usage, cost, and logged operations to understand where AI budget is being spent.')}/>
    <div className="stats">
      <Card><span>{tr('رموز الإدخال','Input tokens')}</span><strong>{totals.input}</strong></Card>
      <Card><span>{tr('رموز الإخراج','Output tokens')}</span><strong>{totals.output}</strong></Card>
      <Card><span>{tr('رموز التضمين','Embedding tokens')}</span><strong>{totals.embed}</strong></Card>
      <Card><span>{tr('التكلفة التقديرية','Estimated cost')}</span><strong>${totals.cost.toFixed(4)}</strong></Card>
    </div>
    <Card>
      {rows.length===0?<Empty>{tr('لا يوجد استخدام مسجل بعد.','No usage has been recorded yet.')}</Empty>:<table><thead><tr><th>{tr('العملية','Operation')}</th><th>{tr('المزود','Provider')}</th><th>{tr('النموذج','Model')}</th><th>{tr('إجمالي الرموز','Total tokens')}</th><th>{tr('التكلفة','Cost')}</th><th>{tr('التاريخ','Date')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{valueLabel(r.operation)}</td><td>{valueLabel(r.provider)}</td><td>{r.model??'—'}</td><td>{r.input_tokens+r.output_tokens+r.embedding_tokens}</td><td>${Number(r.estimated_cost).toFixed(6)}</td><td>{formatDate(r.created_at)}</td></tr>)}</tbody></table>}
    </Card>
  </>
}
