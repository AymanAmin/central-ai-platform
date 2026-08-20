import { useEffect,useMemo,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge, Card, Empty, PageHeader, PanelHeader } from '../../components/Ui'
import type { UsageLog } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

export function Usage(){
  const {tr,formatDate,valueLabel}=useI18n()
  const [rows,setRows]=useState<UsageLog[]>([])
  useEffect(()=>{void supabase.from('usage_logs').select('*').order('created_at',{ascending:false}).limit(500).then(r=>setRows((r.data??[]) as UsageLog[]))},[])
  const totals=useMemo(()=>rows.reduce((a,r)=>({input:a.input+r.input_tokens,output:a.output+r.output_tokens,embed:a.embed+r.embedding_tokens,cost:a.cost+Number(r.estimated_cost)}),{input:0,output:0,embed:0,cost:0}),[rows])

  return <div className="screen screen-usage">
    <PageHeader title={tr('الاستخدام والتكلفة','Usage & Cost')} description={tr('راجع استهلاك الرموز والتكلفة والعمليات المسجلة لفهم أين تُصرف ميزانية الذكاء الاصطناعي.','Review token usage, cost, and logged operations to understand where AI budget is being spent.')}/>

    <div className="usage-metrics">
      <Card className="metric-card metric-1"><span className="metric-label">{tr('رموز الإدخال','Input tokens')}</span><strong>{totals.input.toLocaleString()}</strong><small>{tr('النص والسياق المرسل للنموذج','Text and context sent to the model')}</small></Card>
      <Card className="metric-card metric-2"><span className="metric-label">{tr('رموز الإخراج','Output tokens')}</span><strong>{totals.output.toLocaleString()}</strong><small>{tr('الإجابات التي أنشأها النموذج','Tokens generated in model responses')}</small></Card>
      <Card className="metric-card metric-3"><span className="metric-label">{tr('رموز التضمين','Embedding tokens')}</span><strong>{totals.embed.toLocaleString()}</strong><small>{tr('استهلاك تجهيز واسترجاع المعرفة','Knowledge embedding and retrieval usage')}</small></Card>
      <Card className="metric-card metric-4"><span className="metric-label">{tr('التكلفة التقديرية','Estimated cost')}</span><strong>${totals.cost.toFixed(4)}</strong><small>{tr('محسوبة من سجلات التسعير الحالية','Calculated from current pricing logs')}</small></Card>
    </div>

    <Card className="table-card usage-ledger">
      <PanelHeader
        title={tr('سجل الاستهلاك','Usage ledger')}
        description={tr('آخر 500 عملية مسجلة مع النموذج والمزود وإجمالي الرموز والتكلفة.','The latest 500 logged operations with model, provider, tokens, and cost.')}
        meta={<Badge>{tr(`${rows.length} عملية`,`${rows.length} operations`)}</Badge>}
      />
      {rows.length===0?<Empty>{tr('لا يوجد استخدام مسجل بعد.','No usage has been recorded yet.')}</Empty>:<table className="data-table"><thead><tr><th>{tr('العملية','Operation')}</th><th>{tr('المزود','Provider')}</th><th>{tr('النموذج','Model')}</th><th>{tr('إجمالي الرموز','Total tokens')}</th><th>{tr('التكلفة','Cost')}</th><th>{tr('التاريخ','Date')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td className="cell-primary">{valueLabel(r.operation)}</td><td><Badge>{valueLabel(r.provider)}</Badge></td><td><code>{r.model??'—'}</code></td><td>{(r.input_tokens+r.output_tokens+r.embedding_tokens).toLocaleString()}</td><td className="cost-cell">${Number(r.estimated_cost).toFixed(6)}</td><td>{formatDate(r.created_at)}</td></tr>)}</tbody></table>}
    </Card>
  </div>
}
