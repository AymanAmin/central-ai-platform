import { useEffect, useMemo, useState } from 'react'
import { Card, FieldHint, PageHeader } from '../../components/Ui'
import { adminApi } from '../../lib/adminApi'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { Organization, Profile } from '../../types/domain'

interface Settings {
  organization_id: string
  knowledge_only: boolean
  allow_general_knowledge: boolean
  rag_top_k: number
  min_similarity: number
  recent_messages_count: number
  summarize_after_count: number
  max_output_tokens: number
  human_handoff_threshold: number
  daily_message_limit: number | null
  monthly_message_limit: number | null
}

interface ProviderSetting {
  id: string
  provider: string
  chat_model: string
  embedding_model: string
  is_default: boolean
}

interface ProviderTestResult {
  provider: string
  model: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

const nullableNumber = (value: string) => value === '' ? null : Number(value)

const providerLabel = (provider: string) => {
  if (provider === 'gemini') return 'Google Gemini'
  if (provider === 'openrouter') return 'OpenRouter'
  if (provider === 'openai') return 'OpenAI'
  return provider
}

export function AiSettings({ profile }: { profile: Profile }) {
  const { tr } = useI18n()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState(profile.organization_id ?? '')
  const [s, setS] = useState<Settings | null>(null)
  const [msg, setMsg] = useState('')
  const [providers, setProviders] = useState<ProviderSetting[]>([])
  const [providerId, setProviderId] = useState('')
  const [providerSecret, setProviderSecret] = useState('')
  const [providerMsg, setProviderMsg] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)

  const selectedProvider = useMemo(() => providers.find(item => item.id === providerId) ?? providers.find(item => item.is_default) ?? null, [providers, providerId])

  useEffect(() => {
    void supabase.from('organizations').select('*').then(r => setOrgs((r.data ?? []) as Organization[]))
  }, [])

  useEffect(() => {
    if (!orgId) {
      setS(null)
      return
    }
    void supabase.from('organization_settings').select('*').eq('organization_id', orgId).maybeSingle().then(r => setS(r.data as Settings | null))
  }, [orgId])

  const loadProviders = async () => {
    const result = await supabase
      .from('ai_provider_settings')
      .select('id,provider,chat_model,embedding_model,is_default')
      .is('organization_id', null)
      .eq('is_active', true)
      .order('provider')
    if (result.error) {
      setProviderMsg(result.error.message)
      return
    }
    const next = (result.data ?? []) as ProviderSetting[]
    setProviders(next)
    setProviderId(current => current && next.some(item => item.id === current) ? current : (next.find(item => item.is_default)?.id ?? next[0]?.id ?? ''))
  }

  useEffect(() => {
    if (profile.role !== 'SUPER_ADMIN') return
    void loadProviders()
  }, [profile.role])

  const saveProviderSecret = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedProvider || !providerSecret.trim()) return
    setProviderBusy(true)
    setProviderMsg('')
    try {
      await adminApi({ action: 'set_ai_provider_secret', providerSettingId: selectedProvider.id, providerSecret })
      setProviderSecret('')
      setProviderMsg(tr(`تم حفظ مفتاح ${providerLabel(selectedProvider.provider)} بأمان داخل Supabase Vault.`, `${providerLabel(selectedProvider.provider)} API key was stored securely in Supabase Vault.`))
    } catch (error) {
      setProviderMsg(error instanceof Error ? error.message : tr('تعذر حفظ المفتاح.', 'Unable to save the API key.'))
    } finally {
      setProviderBusy(false)
    }
  }

  const testProvider = async (activateAfterTest = false) => {
    if (!selectedProvider) return
    setProviderBusy(true)
    setProviderMsg('')
    try {
      const result = await adminApi<ProviderTestResult>({ action: 'test_ai_provider', providerSettingId: selectedProvider.id })
      if (activateAfterTest && !selectedProvider.is_default) {
        const previousDefault = providers.find(item => item.is_default)
        const disable = await supabase.from('ai_provider_settings').update({ is_default: false }).is('organization_id', null).neq('id', selectedProvider.id)
        if (disable.error) throw disable.error
        const enable = await supabase.from('ai_provider_settings').update({ is_default: true }).eq('id', selectedProvider.id).is('organization_id', null)
        if (enable.error) {
          if (previousDefault) await supabase.from('ai_provider_settings').update({ is_default: true }).eq('id', previousDefault.id)
          throw enable.error
        }
        await loadProviders()
        setProviderMsg(tr(`تم اختبار ${providerLabel(result.provider)} وتفعيله كمزوّد افتراضي خلال ${result.latencyMs} مللي ثانية.`, `${providerLabel(result.provider)} was tested and activated as the default provider in ${result.latencyMs} ms.`))
      } else {
        setProviderMsg(tr(`الاتصال ناجح عبر ${result.model} خلال ${result.latencyMs} مللي ثانية.`, `Connection succeeded with ${result.model} in ${result.latencyMs} ms.`))
      }
    } catch (error) {
      setProviderMsg(error instanceof Error ? error.message : tr('فشل اختبار الاتصال.', 'Provider connection test failed.'))
    } finally {
      setProviderBusy(false)
    }
  }

  const save = async () => {
    if (!s) return
    const { error } = await supabase.from('organization_settings').update(s).eq('organization_id', s.organization_id)
    setMsg(error?.message ?? tr('تم الحفظ.', 'Saved.'))
  }

  return <>
    <PageHeader
      title={tr('إعدادات الذكاء الاصطناعي', 'AI Settings')}
      description={tr('تحكم في مزود الذكاء الاصطناعي والاسترجاع والذاكرة وحدود التكلفة والتحويل البشري لكل جهة.', 'Control the AI provider, retrieval, memory, cost limits, and human handoff for each organization.')}
    />

    {profile.role === 'SUPER_ADMIN' && <Card>
      <div className="section-heading">
        <div>
          <h2>{tr('مزود الذكاء الاصطناعي', 'AI Provider')}</h2>
          <p>{tr('يمكن تجهيز أي مزود واختباره بأمان، ولا يتغير المزود الافتراضي إلا بعد نجاح الاختبار والتفعيل الصريح.', 'Providers can be configured and tested safely; the default changes only after a successful test and explicit activation.')}</p>
        </div>
        {providers.find(item => item.is_default) && <span className="status-badge success">{tr('الافتراضي', 'Default')}: {providerLabel(providers.find(item => item.is_default)!.provider)}</span>}
      </div>

      {providers.length ? <>
        <div className="settings-grid">
          <label>{tr('المزود الذي تريد إدارته', 'Provider to manage')}
            <select value={selectedProvider?.id ?? ''} onChange={e => { setProviderId(e.target.value); setProviderSecret(''); setProviderMsg('') }}>
              {providers.map(item => <option key={item.id} value={item.id}>{providerLabel(item.provider)}{item.is_default ? tr(' — الافتراضي', ' — default') : ''}</option>)}
            </select>
          </label>
          <label>{tr('نموذج المحادثة', 'Chat model')}<input value={selectedProvider?.chat_model ?? ''} readOnly /></label>
          <label>{tr('نموذج التضمين', 'Embedding model')}<input value={selectedProvider?.embedding_model ?? ''} readOnly /></label>
        </div>

        {selectedProvider?.provider === 'openrouter' && <div className="notice">
          {tr('OpenRouter مضبوط على openrouter/free للمحادثة. التضمين يستخدم text-embedding-3-small بأبعاد 1536 للحفاظ على توافق RAG؛ لذلك المحادثة المجانية لا تعني أن التضمين بلا تكلفة.', 'OpenRouter uses openrouter/free for chat. Embeddings use text-embedding-3-small at 1536 dimensions to keep RAG compatible, so free chat does not mean embeddings are cost-free.')}
        </div>}

        <form className="stack" onSubmit={saveProviderSecret} style={{ marginTop: 12 }}>
          <label>{tr(`مفتاح ${providerLabel(selectedProvider?.provider ?? '')} API`, `${providerLabel(selectedProvider?.provider ?? '')} API key`)}
            <input
              type="password"
              autoComplete="new-password"
              value={providerSecret}
              onChange={e => setProviderSecret(e.target.value)}
              placeholder={selectedProvider?.provider === 'openrouter' ? 'sk-or-v1-…' : selectedProvider?.provider === 'gemini' ? 'AIza…' : tr('أدخل المفتاح الجديد', 'Enter a new API key')}
            />
            <FieldHint>{tr('يُرسل المفتاح عبر HTTPS إلى الخادم ويُخزن مشفرًا داخل Supabase Vault، ولا تتم إعادة عرضه.', 'The key is sent over HTTPS to the server, encrypted in Supabase Vault, and never displayed again.')}</FieldHint>
          </label>
          <div className="form-actions">
            <button type="submit" disabled={providerBusy || !providerSecret.trim()}>{tr('حفظ المفتاح', 'Save API key')}</button>
            <button type="button" className="ghost" disabled={providerBusy || !selectedProvider} onClick={() => void testProvider(false)}>{tr('اختبار الاتصال', 'Test connection')}</button>
            {!selectedProvider?.is_default && <button type="button" disabled={providerBusy || !selectedProvider} onClick={() => void testProvider(true)}>{tr('اختبار وتفعيل', 'Test & activate')}</button>}
          </div>
        </form>
      </> : <p>{tr('جارٍ تحميل إعدادات المزود…', 'Loading provider settings…')}</p>}
      {providerMsg && <p>{providerMsg}</p>}
    </Card>}

    {profile.role === 'SUPER_ADMIN' && <Card>
      <label>{tr('الجهة التي تريد تعديل إعداداتها', 'Organization to configure')}
        <select value={orgId} onChange={e => setOrgId(e.target.value)}>
          <option value="">{tr('اختر الجهة', 'Select organization')}</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name_ar} / {o.name_en}</option>)}
        </select>
        <FieldHint>{tr('كل جهة تحتفظ بإعدادات مستقلة ولا تتأثر الجهات الأخرى بهذه التغييرات.', 'Each organization keeps independent settings; other organizations are not affected.')}</FieldHint>
      </label>
    </Card>}

    {s && <Card>
      <div className="settings-grid">
        <label>
          <span>{tr('الاعتماد على المعرفة فقط', 'Knowledge only')}</span>
          <input type="checkbox" checked={s.knowledge_only} onChange={e => setS({ ...s, knowledge_only: e.target.checked })} />
          <FieldHint>{tr('عند تفعيله لا يجيب المساعد عن معلومات مؤسسية غير موجودة في قاعدة المعرفة.', 'When enabled, the assistant avoids answering organization-specific facts that are not in the knowledge base.')}</FieldHint>
        </label>
        <label>
          <span>{tr('السماح بالمعرفة العامة', 'Allow general knowledge')}</span>
          <input type="checkbox" checked={s.allow_general_knowledge} onChange={e => setS({ ...s, allow_general_knowledge: e.target.checked })} />
          <FieldHint>{tr('يسمح للنموذج باستخدام معلومات عامة عند عدم تعارضها مع سياسة الجهة.', 'Allows the model to use general knowledge when it does not conflict with organization policy.')}</FieldHint>
        </label>
        <label>{tr('عدد نتائج المعرفة', 'Knowledge results (Top K)')}
          <input type="number" min={1} max={8} value={s.rag_top_k} onChange={e => setS({ ...s, rag_top_k: Number(e.target.value) })} />
          <FieldHint>{tr('عدد المقاطع الأكثر صلة التي تُرسل للنموذج. القيمة المقترحة 4 للحفاظ على الدقة والتكلفة.', 'Number of most relevant chunks sent to the model. A value of 4 is recommended for accuracy and cost.')}</FieldHint>
        </label>
        <label>{tr('الحد الأدنى للتشابه', 'Minimum similarity')}
          <input type="number" min={0} max={1} step="0.01" value={s.min_similarity} onChange={e => setS({ ...s, min_similarity: Number(e.target.value) })} />
          <FieldHint>{tr('قيمة من 0 إلى 1. النتائج الأقل من هذا الحد لا تدخل في سياق الإجابة.', 'A value from 0 to 1. Retrieval results below this score are excluded from the answer context.')}</FieldHint>
        </label>
        <label>{tr('الرسائل الحديثة المحفوظة في السياق', 'Recent messages in context')}
          <input type="number" min={2} max={20} value={s.recent_messages_count} onChange={e => setS({ ...s, recent_messages_count: Number(e.target.value) })} />
          <FieldHint>{tr('عدد آخر الرسائل التي يقرأها النموذج مع ملخص المحادثة. القيمة الافتراضية المناسبة 6.', 'How many recent messages the model reads with the conversation summary. A good default is 6.')}</FieldHint>
        </label>
        <label>{tr('بدء تلخيص المحادثة بعد', 'Start summarizing after')}
          <input type="number" min={8} max={100} value={s.summarize_after_count} onChange={e => setS({ ...s, summarize_after_count: Number(e.target.value) })} />
          <FieldHint>{tr('عدد الرسائل الذي بعده يبدأ إنشاء ملخص لتقليل حجم السياق والتكلفة.', 'Message count after which a summary starts reducing context size and cost.')}</FieldHint>
        </label>
        <label>{tr('الحد الأقصى لرموز الإجابة', 'Maximum output tokens')}
          <input type="number" min={64} max={4096} value={s.max_output_tokens} onChange={e => setS({ ...s, max_output_tokens: Number(e.target.value) })} />
          <FieldHint>{tr('حد أقصى لطول رد النموذج. خفضه يجعل الردود أقصر ويقلل التكلفة.', 'Maximum model response length. Lower values keep answers shorter and reduce cost.')}</FieldHint>
        </label>
        <label>{tr('حد الثقة للتحويل البشري', 'Human handoff threshold')}
          <input type="number" min={0} max={1} step="0.01" value={s.human_handoff_threshold} onChange={e => setS({ ...s, human_handoff_threshold: Number(e.target.value) })} />
          <FieldHint>{tr('إذا انخفضت الثقة عن هذه القيمة يمكن تحويل المحادثة إلى موظف. مثال مناسب: 0.60.', 'If confidence falls below this value, the conversation can be handed to a person. A common value is 0.60.')}</FieldHint>
        </label>
        <label>{tr('حد الرسائل اليومي', 'Daily message limit')}
          <input type="number" min={1} value={s.daily_message_limit ?? ''} placeholder={tr('بدون حد', 'No limit')} onChange={e => setS({ ...s, daily_message_limit: nullableNumber(e.target.value) })} />
          <FieldHint>{tr('اتركه فارغًا إذا لم ترغب بوضع حد يومي لهذه الجهة.', 'Leave empty if this organization should not have a daily message limit.')}</FieldHint>
        </label>
        <label>{tr('حد الرسائل الشهري', 'Monthly message limit')}
          <input type="number" min={1} value={s.monthly_message_limit ?? ''} placeholder={tr('بدون حد', 'No limit')} onChange={e => setS({ ...s, monthly_message_limit: nullableNumber(e.target.value) })} />
          <FieldHint>{tr('يساعد على منع تجاوز ميزانية الرسائل خلال الشهر.', 'Helps prevent the organization from exceeding its monthly message budget.')}</FieldHint>
        </label>
      </div>
      <button onClick={() => void save()}>{tr('حفظ الإعدادات', 'Save settings')}</button>
      {msg && <p>{msg}</p>}
    </Card>}
  </>
}
