import { useEffect,useMemo,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Badge,Card,Empty,PageHeader,PanelHeader } from '../../components/Ui'
import type { UsageLog } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

type BillingMode='free'|'paid'
type BillingSetting={provider:string;billing_mode:BillingMode;updated_at:string}

const providerLabel=(value:string)=>value==='gemini'?'Gemini':value==='openrouter'?'OpenRouter':value==='openai'?'OpenAI':value==='azure_openai'?'Azure OpenAI':value==='groq'?'Groq':value==='cloudflare'?'Cloudflare Workers AI':value==='azure'?'Azure Speech':value
const money=(value:number,digits=6)=>`$${value.toFixed(digits)}`

export function Usage(){
  const {tr,formatDate,valueLabel}=useI18n()
  const [rows,setRows]=useState<UsageLog[]>([])
  const [billing,setBilling]=useState<BillingSetting[]>([])
  const [canManageBilling,setCanManageBilling]=useState(false)
  const [billingBusy,setBillingBusy]=useState('')
  const [message,setMessage]=useState('')

  const load=async()=>{
    const [usageResult,billingResult,userResult]=await Promise.all([
      supabase.from('usage_logs').select('*').order('created_at',{ascending:false}).limit(500),
      supabase.from('provider_billing_settings').select('provider,billing_mode,updated_at').order('provider'),
      supabase.auth.getUser(),
    ])
    if(usageResult.error||billingResult.error){setMessage(usageResult.error?.message??billingResult.error?.message??'');return}
    setRows((usageResult.data??[]) as UsageLog[])
    setBilling((billingResult.data??[]) as BillingSetting[])
    const user=userResult.data.user
    if(!user){setCanManageBilling(false);return}
    const profile=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle()
    setCanManageBilling(profile.data?.role==='SUPER_ADMIN')
  }

  useEffect(()=>{void load()},[])

  const totals=useMemo(()=>rows.reduce((a,r)=>({
    input:a.input+r.input_tokens,
    output:a.output+r.output_tokens,
    embed:a.embed+r.embedding_tokens,
    actual:a.actual+Number(r.estimated_cost??0),
    commercial:a.commercial+Number(r.commercial_estimated_cost??r.estimated_cost??0),
  }),{input:0,output:0,embed:0,actual:0,commercial:0}),[rows])

  const updateBilling=async(provider:string,billingMode:BillingMode)=>{
    if(!canManageBilling)return
    setBillingBusy(provider);setMessage('')
    try{
      const result=await supabase.from('provider_billing_settings').update({billing_mode:billingMode}).eq('provider',provider)
      if(result.error)throw result.error
      setBilling(current=>current.map(row=>row.provider===provider?{...row,billing_mode:billingMode,updated_at:new Date().toISOString()}:row))
      setMessage(tr(`تم ضبط ${providerLabel(provider)} على ${billingMode==='free'?'الخطة المجانية':'الخطة المدفوعة'}. ينطبق ذلك على الاستخدام الجديد فقط.`,`Set ${providerLabel(provider)} to ${billingMode==='free'?'Free Tier':'Paid'}. This applies to new usage only.`))
    }catch(error){setMessage(error instanceof Error?error.message:tr('تعذر تحديث وضع الفوترة.','Unable to update billing mode.'))}
    finally{setBillingBusy('')}
  }

  return <div className="screen screen-usage">
    <PageHeader title={tr('الاستخدام والتكلفة','Usage & Cost')} description={tr('راقب الاستهلاك مع فصل التكلفة الفعلية على حساب المزود عن التكلفة التجارية التقديرية.','Track usage while separating actual provider-account spend from the commercial list-price estimate.')}/>

    <div className="usage-metrics">
      <Card className="metric-card metric-1"><span className="metric-label">{tr('رموز الإدخال','Input tokens')}</span><strong>{totals.input.toLocaleString()}</strong><small>{tr('النص والسياق المرسل للنموذج','Text and context sent to the model')}</small></Card>
      <Card className="metric-card metric-2"><span className="metric-label">{tr('رموز الإخراج','Output tokens')}</span><strong>{totals.output.toLocaleString()}</strong><small>{tr('الإجابات التي أنشأها النموذج','Tokens generated in model responses')}</small></Card>
      <Card className="metric-card metric-3"><span className="metric-label">{tr('التكلفة الفعلية','Actual cost')}</span><strong>{money(totals.actual,4)}</strong><small>{tr('هذه القيمة فقط تدخل في حدود الإنفاق','Only this value counts toward spend limits')}</small></Card>
      <Card className="metric-card metric-4"><span className="metric-label">{tr('التكلفة التجارية التقديرية','Commercial estimate')}</span><strong>{money(totals.commercial,4)}</strong><small>{tr('للمقارنة حتى عند استخدام Free Tier','For comparison even when using a Free Tier')}</small></Card>
    </div>

    <Card>
      <PanelHeader
        title={tr('وضع فوترة المزود','Provider billing mode')}
        description={tr('اضبط الوضع حسب حسابك الحقيقي لدى كل مزود. عند اختيار مجاني تصبح التكلفة الفعلية للاستخدام الجديد صفرًا، بينما تبقى التكلفة التجارية التقديرية ظاهرة للمقارنة.','Match this to your real account with each provider. Free Tier makes new usage actual cost zero while preserving the commercial estimate for comparison.')}
        meta={<Badge>{canManageBilling?tr('Super Admin','Super Admin'):tr('عرض فقط','Read only')}</Badge>}
      />
      <div className="notice">
        {tr('حدود Free Tier الخاصة بالمزود ما زالت مطبقة؛ تجاوزها قد يؤدي إلى رفض الطلب مثل 429. نماذج OpenRouter التي تنتهي بـ :free و openrouter/free تُعامل تلقائيًا كمجانية حتى لو كان وضع OpenRouter العام مدفوعًا.','Provider Free Tier rate limits still apply; exceeding them may reject requests such as with 429. OpenRouter models ending in :free and openrouter/free are always treated as free even if OpenRouter is generally set to Paid.')}
      </div>
      <div className="settings-grid" style={{marginTop:12}}>
        {billing.map(row=><label key={row.provider}>{providerLabel(row.provider)}
          <select value={row.billing_mode} disabled={!canManageBilling||billingBusy===row.provider} onChange={event=>void updateBilling(row.provider,event.target.value as BillingMode)}>
            <option value="free">{tr('مجاني — التكلفة الفعلية $0','Free Tier — actual cost $0')}</option>
            <option value="paid">{tr('مدفوع — احتساب السعر التجاري','Paid — use commercial pricing')}</option>
          </select>
        </label>)}
      </div>
      {message&&<p className="inline-feedback" role="status">{message}</p>}
    </Card>

    <Card className="table-card usage-ledger">
      <PanelHeader
        title={tr('سجل الاستهلاك','Usage ledger')}
        description={tr('آخر 500 عملية مع التكلفة الفعلية والتقدير التجاري ووضع الفوترة المسجل وقت العملية.','The latest 500 operations with actual cost, commercial estimate, and the billing-mode snapshot recorded for each operation.')}
        meta={<Badge>{tr(`${rows.length} عملية`,`${rows.length} operations`)}</Badge>}
      />
      {rows.length===0?<Empty>{tr('لا يوجد استخدام مسجل بعد.','No usage has been recorded yet.')}</Empty>:<table className="data-table"><thead><tr><th>{tr('العملية','Operation')}</th><th>{tr('المزود','Provider')}</th><th>{tr('النموذج','Model')}</th><th>{tr('إجمالي الرموز','Total tokens')}</th><th>{tr('التكلفة الفعلية','Actual cost')}</th><th>{tr('التقدير التجاري','Commercial estimate')}</th><th>{tr('الفوترة','Billing')}</th><th>{tr('التاريخ','Date')}</th></tr></thead><tbody>{rows.map(r=>{const mode=r.billing_mode??'paid',commercial=Number(r.commercial_estimated_cost??r.estimated_cost??0);return <tr key={r.id}><td className="cell-primary">{valueLabel(r.operation)}</td><td><Badge>{providerLabel(r.provider??'—')}</Badge></td><td><code>{r.model??'—'}</code></td><td>{(r.input_tokens+r.output_tokens+r.embedding_tokens).toLocaleString()}</td><td className="cost-cell">{money(Number(r.estimated_cost??0))}</td><td className="cost-cell">{money(commercial)}</td><td><Badge tone={mode==='free'?'good':'neutral'}>{mode==='free'?tr('مجاني','Free'):tr('مدفوع','Paid')}</Badge></td><td>{formatDate(r.created_at)}</td></tr>})}</tbody></table>}
    </Card>
  </div>
}
