import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, Empty, FieldHint, Modal, PageHeader, PanelHeader, Spinner } from '../../components/Ui'
import { adminApi } from '../../lib/adminApi'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { Organization } from '../../types/domain'

type ProviderRow = { id: string; provider: string; chat_model: string; embedding_model: string; is_default: boolean }
type Agent = {
  organization_id: string
  agent_name: string
  plan_name: string
  chat_provider: string
  chat_model: string
  embedding_provider: string
  embedding_model: string
  fallback_provider: string | null
  fallback_model: string | null
  monthly_price: number
  billing_currency: 'SAR' | 'USD' | 'AED' | 'EUR'
  included_monthly_messages: number | null
  included_monthly_tokens: number | null
  monthly_ai_cost_limit_usd: number | null
  markup_percent: number
  notes: string | null
  is_active: boolean
  last_tested_at: string | null
  last_test_status: 'untested' | 'passed' | 'failed'
  last_test_latency_ms: number | null
  last_test_error: string | null
  updated_at: string
}
type Usage = { organization_id: string; customer_messages: number; total_tokens: number; estimated_cost_usd: number }
type AgentTestResult = { chatLatencyMs: number; embeddingLatencyMs: number; fallbackLatencyMs: number | null; latencyMs: number }

const providers = ['gemini', 'openrouter', 'openai'] as const
const providerLabel = (value: string) => value === 'gemini' ? 'Gemini' : value === 'openrouter' ? 'OpenRouter' : value === 'openai' ? 'OpenAI' : value
const nullableNumber = (value: string) => value.trim() === '' ? null : Number(value)
const formatCompact = (value: number) => new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
const runtimeSignature = (agent: Pick<Agent, 'chat_provider' | 'chat_model' | 'embedding_provider' | 'embedding_model' | 'fallback_provider' | 'fallback_model'>) => JSON.stringify([
  agent.chat_provider, agent.chat_model.trim(), agent.embedding_provider, agent.embedding_model.trim(), agent.fallback_provider ?? '', agent.fallback_model?.trim() ?? '',
])

export function OrganizationAgents() {
  const { tr } = useI18n()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [usage, setUsage] = useState<Usage[]>([])
  const [providerRows, setProviderRows] = useState<ProviderRow[]>([])
  const [editing, setEditing] = useState<Agent | null>(null)
  const [initialRuntime, setInitialRuntime] = useState('')
  const [testedRuntime, setTestedRuntime] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setMessage('')
    const [orgResult, agentResult, usageResult, providerResult] = await Promise.all([
      supabase.from('organizations').select('*').order('name_ar'),
      supabase.from('organization_agents').select('*').order('updated_at', { ascending: false }),
      supabase.from('organization_agent_monthly_usage').select('*'),
      supabase.from('ai_provider_settings').select('id,provider,chat_model,embedding_model,is_default').is('organization_id', null).eq('is_active', true).order('provider'),
    ])
    const error = orgResult.error ?? agentResult.error ?? usageResult.error ?? providerResult.error
    if (error) setMessage(error.message)
    setOrgs((orgResult.data ?? []) as Organization[])
    setAgents((agentResult.data ?? []).map(row => ({ ...row, monthly_price: Number(row.monthly_price), monthly_ai_cost_limit_usd: row.monthly_ai_cost_limit_usd == null ? null : Number(row.monthly_ai_cost_limit_usd), markup_percent: Number(row.markup_percent) })) as Agent[])
    setUsage((usageResult.data ?? []).map(row => ({ organization_id: row.organization_id, customer_messages: Number(row.customer_messages), total_tokens: Number(row.total_tokens), estimated_cost_usd: Number(row.estimated_cost_usd) })) as Usage[])
    setProviderRows((providerResult.data ?? []) as ProviderRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const orgById = useMemo(() => new Map(orgs.map(org => [org.id, org])), [orgs])
  const usageByOrg = useMemo(() => new Map(usage.map(row => [row.organization_id, row])), [usage])
  const availableProvider = (name: string) => providerRows.find(row => row.provider === name)
  const activeAgents = agents.filter(agent => agent.is_active).length
  const monthCost = usage.reduce((sum, row) => sum + row.estimated_cost_usd, 0)

  const openAgent = (agent: Agent) => {
    const copy = { ...agent }
    setEditing(copy)
    setInitialRuntime(runtimeSignature(copy))
    setTestedRuntime(agent.last_test_status === 'passed' ? runtimeSignature(copy) : '')
    setMessage('')
  }

  const patch = (values: Partial<Agent>) => setEditing(current => current ? { ...current, ...values } : current)
  const applyProviderDefault = (role: 'chat' | 'embedding' | 'fallback', provider: string) => {
    const known = availableProvider(provider)
    if (role === 'chat') patch({ chat_provider: provider, chat_model: known?.chat_model ?? '' })
    if (role === 'embedding') patch({ embedding_provider: provider, embedding_model: known?.embedding_model ?? '' })
    if (role === 'fallback') patch({ fallback_provider: provider || null, fallback_model: provider ? (known?.chat_model ?? '') : null })
  }

  const testRuntime = async () => {
    if (!editing) return
    setBusy(true)
    setMessage('')
    try {
      const result = await adminApi<AgentTestResult>({
        action: 'test_agent_runtime',
        organizationId: editing.organization_id,
        agent: {
          chatProvider: editing.chat_provider,
          chatModel: editing.chat_model,
          embeddingProvider: editing.embedding_provider,
          embeddingModel: editing.embedding_model,
          fallbackProvider: editing.fallback_provider,
          fallbackModel: editing.fallback_model,
        },
      })
      const signature = runtimeSignature(editing)
      setTestedRuntime(signature)
      patch({ last_test_status: 'passed', last_tested_at: new Date().toISOString(), last_test_latency_ms: result.latencyMs, last_test_error: null })
      setMessage(tr(`نجح اختبار الوكيل: المحادثة ${result.chatLatencyMs}ms، التضمين ${result.embeddingLatencyMs}ms${result.fallbackLatencyMs != null ? `، الاحتياط ${result.fallbackLatencyMs}ms` : ''}.`, `Agent test passed: chat ${result.chatLatencyMs}ms, embeddings ${result.embeddingLatencyMs}ms${result.fallbackLatencyMs != null ? `, fallback ${result.fallbackLatencyMs}ms` : ''}.`))
    } catch (error) {
      patch({ last_test_status: 'failed', last_tested_at: new Date().toISOString(), last_test_error: error instanceof Error ? error.message : 'test_failed' })
      setTestedRuntime('')
      setMessage(error instanceof Error ? error.message : tr('فشل اختبار الوكيل.', 'Agent test failed.'))
    } finally {
      setBusy(false)
    }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const currentSignature = runtimeSignature(editing)
    const runtimeChanged = currentSignature !== initialRuntime
    if (runtimeChanged && currentSignature !== testedRuntime) {
      setMessage(tr('اختبر إعدادات النموذج الجديدة بنجاح قبل الحفظ.', 'Test the changed model configuration successfully before saving.'))
      return
    }
    if (!editing.agent_name.trim() || !editing.plan_name.trim() || !editing.chat_model.trim() || !editing.embedding_model.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const payload = {
        ...editing,
        agent_name: editing.agent_name.trim(),
        plan_name: editing.plan_name.trim(),
        chat_model: editing.chat_model.trim(),
        embedding_model: editing.embedding_model.trim(),
        fallback_provider: editing.fallback_provider || null,
        fallback_model: editing.fallback_provider ? editing.fallback_model?.trim() || null : null,
        notes: editing.notes?.trim() || null,
        last_test_status: runtimeChanged ? 'passed' : editing.last_test_status,
        last_tested_at: runtimeChanged ? new Date().toISOString() : editing.last_tested_at,
        last_test_error: runtimeChanged ? null : editing.last_test_error,
      }
      const result = await supabase.from('organization_agents').upsert(payload, { onConflict: 'organization_id' })
      if (result.error) throw result.error
      setEditing(null)
      setMessage(tr('تم حفظ الوكيل والباقة. إذا تغيّر نموذج التضمين فسيعاد تجهيز معرفة الجهة تلقائيًا.', 'Agent and plan saved. If the embedding model changed, the organization knowledge will be re-indexed automatically.'))
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr('تعذر حفظ الوكيل.', 'Unable to save the agent.'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="agent-center"><Spinner /></div>

  return <div className="screen agent-plans-screen">
    <PageHeader
      title={tr('وكلاء الجهات والباقات', 'Organization Agents & Plans')}
      description={tr('خصص نموذج المحادثة ومسار المعرفة والاحتياط والسعر لكل جهة من نقطة تحكم واحدة، مع عزل كامل بين الجهات.', 'Assign chat models, knowledge embeddings, fallback, and commercial pricing per organization from one control plane with tenant isolation.')}
      actions={<button type="button" className="ghost" onClick={() => void load()}>{tr('تحديث البيانات', 'Refresh')}</button>}
    />

    <div className="agent-metric-grid">
      <Card className="agent-metric"><span>{tr('الجهات', 'Organizations')}</span><strong>{orgs.length}</strong><small>{tr('لكل جهة وكيل تشغيل مستقل', 'Each organization has an isolated runtime')}</small></Card>
      <Card className="agent-metric"><span>{tr('الوكلاء النشطون', 'Active agents')}</span><strong>{activeAgents}</strong><small>{tr('يمكن إيقاف الوكيل دون حذف إعداداته', 'Agents can be paused without deleting configuration')}</small></Card>
      <Card className="agent-metric"><span>{tr('تكلفة AI هذا الشهر', 'AI cost this month')}</span><strong>${monthCost.toFixed(2)}</strong><small>{tr('تكلفة المزود المقدرة قبل تسعير العميل', 'Estimated provider cost before customer pricing')}</small></Card>
      <Card className="agent-metric"><span>{tr('المزودون المجهزون', 'Configured provider slots')}</span><strong>{providerRows.length}</strong><small>{providerRows.map(row => providerLabel(row.provider)).join(' · ') || '—'}</small></Card>
    </div>

    <Card className="agent-board">
      <PanelHeader title={tr('خريطة تشغيل الجهات', 'Organization runtime map')} description={tr('المسار الظاهر هنا هو ما سيستخدمه العميل فعليًا؛ عند فشل نموذج المحادثة ينتقل النظام إلى الاحتياط دون تغيير قاعدة المعرفة.', 'This is the real customer runtime path; chat failures move to fallback without changing the knowledge vector space.')} meta={<Badge>{agents.length}</Badge>} />
      {agents.length === 0 ? <Empty>{tr('لا توجد إعدادات وكلاء بعد.', 'No organization agents are configured yet.')}</Empty> : <div className="agent-list">
        {agents.map(agent => {
          const org = orgById.get(agent.organization_id)
          const month = usageByOrg.get(agent.organization_id)
          const messageRatio = agent.included_monthly_messages ? Math.min(100, ((month?.customer_messages ?? 0) / agent.included_monthly_messages) * 100) : 0
          return <article className={`agent-row${agent.is_active ? '' : ' paused'}`} key={agent.organization_id}>
            <div className="agent-org-block">
              <div className="agent-status-line"><span className={`agent-live-dot${agent.is_active ? '' : ' off'}`} /><span>{agent.is_active ? tr('نشط', 'Active') : tr('متوقف', 'Paused')}</span></div>
              <h3>{org?.name_ar ?? agent.agent_name}</h3>
              <p>{org?.name_en ?? org?.code ?? '—'}</p>
              <span className="agent-name-tag">{agent.agent_name}</span>
            </div>

            <div className="agent-route" aria-label={tr('مسار الوكيل', 'Agent routing path')}>
              <div className="route-node primary"><span>{tr('محادثة', 'Chat')}</span><strong>{providerLabel(agent.chat_provider)}</strong><small>{agent.chat_model}</small></div>
              <span className="route-arrow" aria-hidden="true">→</span>
              <div className="route-node knowledge"><span>{tr('معرفة', 'Embedding')}</span><strong>{providerLabel(agent.embedding_provider)}</strong><small>{agent.embedding_model}</small></div>
              <span className="route-arrow" aria-hidden="true">→</span>
              <div className={`route-node fallback${agent.fallback_provider ? '' : ' muted'}`}><span>{tr('احتياط', 'Fallback')}</span><strong>{agent.fallback_provider ? providerLabel(agent.fallback_provider) : tr('غير مستخدم', 'Not used')}</strong><small>{agent.fallback_model ?? tr('المسار الأساسي فقط', 'Primary path only')}</small></div>
            </div>

            <div className="agent-commercial">
              <span className="plan-label">{agent.plan_name}</span>
              <strong>{agent.monthly_price.toLocaleString()} <small>{agent.billing_currency}/{tr('شهر', 'mo')}</small></strong>
              <div className="agent-usage-line"><span>{tr('رسائل الشهر', 'Messages this month')}</span><b>{formatCompact(month?.customer_messages ?? 0)}{agent.included_monthly_messages ? ` / ${formatCompact(agent.included_monthly_messages)}` : ''}</b></div>
              {agent.included_monthly_messages && <div className="agent-progress"><span style={{ width: `${messageRatio}%` }} /></div>}
              <div className="agent-cost-line"><span>{tr('تكلفة المزود', 'Provider cost')}</span><b>${(month?.estimated_cost_usd ?? 0).toFixed(2)}</b></div>
            </div>

            <div className="agent-row-actions">
              <Badge tone={agent.last_test_status === 'passed' ? 'good' : agent.last_test_status === 'failed' ? 'bad' : 'warn'}>{agent.last_test_status === 'passed' ? tr('مختبر', 'Tested') : agent.last_test_status === 'failed' ? tr('فشل الاختبار', 'Test failed') : tr('غير مختبر', 'Untested')}</Badge>
              <button type="button" onClick={() => openAgent(agent)}>{tr('إدارة الوكيل', 'Manage agent')}</button>
            </div>
          </article>
        })}
      </div>}
    </Card>

    {message && !editing && <div className="inline-feedback" role="status">{message}</div>}

    <Modal
      open={Boolean(editing)}
      onClose={() => setEditing(null)}
      title={tr('إدارة الوكيل والباقة', 'Manage agent & plan')}
      description={editing ? `${orgById.get(editing.organization_id)?.name_ar ?? ''} · ${orgById.get(editing.organization_id)?.code ?? ''}` : undefined}
    >
      {editing && <form className="agent-editor" onSubmit={save}>
        <section className="agent-editor-section">
          <div className="agent-editor-heading"><span>01</span><div><h3>{tr('هوية الوكيل', 'Agent identity')}</h3><p>{tr('الاسم يظهر كهوية تشغيل داخل التوجيهات والسجلات.', 'The name identifies this runtime in prompts and operations.')}</p></div></div>
          <div className="agent-form-grid two">
            <label>{tr('اسم الوكيل', 'Agent name')}<input required value={editing.agent_name} onChange={event => patch({ agent_name: event.target.value })} /></label>
            <label>{tr('حالة الوكيل', 'Agent status')}<select value={editing.is_active ? 'active' : 'paused'} onChange={event => patch({ is_active: event.target.value === 'active' })}><option value="active">{tr('نشط', 'Active')}</option><option value="paused">{tr('متوقف', 'Paused')}</option></select></label>
          </div>
        </section>

        <section className="agent-editor-section runtime-section">
          <div className="agent-editor-heading"><span>02</span><div><h3>{tr('مسار الذكاء الاصطناعي', 'AI runtime route')}</h3><p>{tr('تغيير نموذج المحادثة لا يعيد بناء المعرفة. تغيير نموذج التضمين يعيد فهرسة معرفة الجهة تلقائيًا.', 'Changing chat does not rebuild knowledge. Changing embeddings automatically re-indexes this organization’s knowledge.')}</p></div></div>
          <div className="agent-runtime-grid">
            <div className="runtime-column"><strong>{tr('المحادثة الأساسية', 'Primary chat')}</strong><label>{tr('المزود', 'Provider')}<select value={editing.chat_provider} onChange={event => applyProviderDefault('chat', event.target.value)}>{providers.map(value => <option key={value} value={value}>{providerLabel(value)}</option>)}</select></label><label>{tr('معرّف النموذج', 'Model ID')}<input required dir="ltr" value={editing.chat_model} onChange={event => patch({ chat_model: event.target.value })} placeholder="gemini-3.1-flash-lite" /></label></div>
            <div className="runtime-column"><strong>{tr('قاعدة المعرفة', 'Knowledge embeddings')}</strong><label>{tr('المزود', 'Provider')}<select value={editing.embedding_provider} onChange={event => applyProviderDefault('embedding', event.target.value)}>{providers.map(value => <option key={value} value={value}>{providerLabel(value)}</option>)}</select></label><label>{tr('معرّف التضمين', 'Embedding model ID')}<input required dir="ltr" value={editing.embedding_model} onChange={event => patch({ embedding_model: event.target.value })} placeholder="gemini-embedding-001" /></label></div>
            <div className="runtime-column"><strong>{tr('الاحتياط', 'Fallback')}</strong><label>{tr('المزود', 'Provider')}<select value={editing.fallback_provider ?? ''} onChange={event => applyProviderDefault('fallback', event.target.value)}><option value="">{tr('بدون احتياط', 'No fallback')}</option>{providers.map(value => <option key={value} value={value}>{providerLabel(value)}</option>)}</select></label><label>{tr('معرّف النموذج', 'Model ID')}<input dir="ltr" disabled={!editing.fallback_provider} value={editing.fallback_model ?? ''} onChange={event => patch({ fallback_model: event.target.value })} placeholder="gemini-3.1-flash-lite" /></label></div>
          </div>
          <div className="agent-test-bar"><div><strong>{tr('اختبار عقد التشغيل الحقيقي', 'Test the real runtime contract')}</strong><small>{tr('يفحص Structured JSON + Embedding 1536 + Fallback قبل اعتماد التغيير.', 'Checks Structured JSON + 1536 embeddings + fallback before accepting model changes.')}</small></div><button type="button" className="ghost" disabled={busy} onClick={() => void testRuntime()}>{busy ? tr('جارٍ الاختبار…', 'Testing…') : tr('اختبار الوكيل', 'Test agent')}</button></div>
        </section>

        <section className="agent-editor-section">
          <div className="agent-editor-heading"><span>03</span><div><h3>{tr('الباقة والتسعير', 'Plan & pricing')}</h3><p>{tr('هذه البيانات تجارية ولا تظهر لمسؤولي الجهة. تكلفة المزود تبقى مستقلة عن سعر البيع.', 'Commercial data is Super Admin only. Provider cost remains separate from customer price.')}</p></div></div>
          <div className="agent-form-grid three">
            <label>{tr('اسم الباقة', 'Plan name')}<input required value={editing.plan_name} onChange={event => patch({ plan_name: event.target.value })} /></label>
            <label>{tr('السعر الشهري', 'Monthly price')}<input type="number" min="0" step="0.01" value={editing.monthly_price} onChange={event => patch({ monthly_price: Number(event.target.value) })} /></label>
            <label>{tr('العملة', 'Currency')}<select value={editing.billing_currency} onChange={event => patch({ billing_currency: event.target.value as Agent['billing_currency'] })}><option>SAR</option><option>USD</option><option>AED</option><option>EUR</option></select></label>
            <label>{tr('الرسائل المشمولة شهريًا', 'Included monthly messages')}<input type="number" min="0" value={editing.included_monthly_messages ?? ''} onChange={event => patch({ included_monthly_messages: nullableNumber(event.target.value) })} /></label>
            <label>{tr('التوكنات المشمولة شهريًا', 'Included monthly tokens')}<input type="number" min="0" value={editing.included_monthly_tokens ?? ''} onChange={event => patch({ included_monthly_tokens: nullableNumber(event.target.value) })} /></label>
            <label>{tr('هامش التسعير %', 'Pricing markup %')}<input type="number" min="0" step="0.1" value={editing.markup_percent} onChange={event => patch({ markup_percent: Number(event.target.value) })} /></label>
            <label>{tr('سقف تكلفة AI الداخلي بالدولار', 'Internal AI cost cap (USD)')}<input type="number" min="0" step="0.01" value={editing.monthly_ai_cost_limit_usd ?? ''} onChange={event => patch({ monthly_ai_cost_limit_usd: nullableNumber(event.target.value) })} /><FieldHint>{tr('عند بلوغ هذا السقف يتوقف استهلاك AI للجهة ويتحول المسار للدعم البشري.', 'When reached, AI consumption stops for this organization and routes to human support.')}</FieldHint></label>
            <label className="span-2">{tr('ملاحظات تجارية داخلية', 'Internal commercial notes')}<textarea rows={3} value={editing.notes ?? ''} onChange={event => patch({ notes: event.target.value })} /></label>
          </div>
        </section>

        {message && <div className={`notice ${editing.last_test_status === 'failed' ? 'error' : ''}`} role="status">{message}</div>}
        <div className="agent-editor-actions"><button type="submit" disabled={busy}>{busy ? tr('جارٍ الحفظ…', 'Saving…') : tr('حفظ الوكيل والباقة', 'Save agent & plan')}</button><button type="button" className="ghost" onClick={() => setEditing(null)}>{tr('إلغاء', 'Cancel')}</button></div>
      </form>}
    </Modal>
  </div>
}
