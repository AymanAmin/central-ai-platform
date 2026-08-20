import { useEffect, useState } from 'react'
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

interface ProviderStatus {
  providerSettingId: string
  provider: string
  chatModel: string
  embeddingModel: string
  configured: boolean
}

interface ProviderTestResult {
  provider: string
  model: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

const nullableNumber = (value: string) => value === '' ? null : Number(value)

export function AiSettings({ profile }: { profile: Profile }) {
  const { tr } = useI18n()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState(profile.organization_id ?? '')
  const [s, setS] = useState<Settings | null>(null)
  const [msg, setMsg] = useState('')
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [providerSecret, setProviderSecret] = useState('')
  const [providerMsg, setProviderMsg] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)

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

  useEffect(() => {
    if (profile.role !== 'SUPER_ADMIN') return
    void loadProviderStatus()
  }, [profile.role])

  const loadProviderStatus = async () => {
    try {
      const status = await adminApi<ProviderStatus>({ action: 'ai_provider_status' })
      setProvider(status)
    } catch (error) {
      setProviderMsg(error instanceof Error ? error.message : tr('تعذر قراءة حالة المزود.', 'Unable to load provider status.'))
    }
  }

  const saveProviderSecret = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!provider || !providerSecret.trim()) return
    setProviderBusy(true)
    setProviderMsg('')
    try {
      await adminApi({ action: 'set_ai_provider_secret', providerSettingId: provider.providerSettingId, providerSecret })
      setProviderSecret('')
      setProviderMsg(tr('تم حفظ مفتاح Gemini بأمان داخل Supabase Vault.', 'Gemini API key was stored securely in Supabase Vault.'))
      await loadProviderStatus()
    } catch (error) {
      setProviderMsg(error instanceof Error ? error.message : tr('تعذر حفظ المفتاح.', 'Unable to save the API key.'))
    } finally {
      setProviderBusy(false)
    }
  }

  const testProvider = async () => {
    if (!provider) return
    setProviderBusy(true)
    setProviderMsg('')
    try {
      const result = await adminApi<ProviderTestResult>({ action: 'test_ai_provider', providerSettingId: provider.providerSettingId })
      setProviderMsg(tr(`الاتصال ناجح عبر ${result.model} خلال ${result.latencyMs} مللي ثانية.`, `Connection succeeded with ${result.model} in ${result.latencyMs} ms.`))
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
      description={tr('تحكم في الاسترجاع والذاكرة وحدود التكلفة والتحويل البشري لكل جهة.', 'Control retrieval, memory, cost limits, and human handoff for each organization.')}
    />

    {profile.role === 'SUPER_ADMIN' && <Card>
      <h2>{tr('مزود الذكاء الاصطناعي', 'AI Provider')}</h2>
      {provider ? <>
        <div className="settings-grid">
          <label>{tr('المزود', 'Provider')}<input value={provider.provider} readOnly /></label>
          <label>{tr('نموذج المحادثة', 'Chat model')}<input value={provider.chatModel} readOnly /></label>
          <label>{tr('نموذج التضمين', 'Embedding model')}<input value={provider.embeddingModel} readOnly /></label>
        </div>
        <div className={`notice ${provider.configured ? 'success' : 'error'}`}>
          {provider.configured ? tr('مفتاح API مضبوط داخل Vault.', 'API key is configured in Vault.') : tr('مفتاح API غير مضبوط بعد.', 'API key is not configured yet.')}
        </div>
        <form className="stack" onSubmit={saveProviderSecret} style={{ marginTop: 12 }}>
          <label>{tr('مفتاح Gemini API', 'Gemini API key')}
            <input type="password" autoComplete="new-password" value={providerSecret} onChange={e => setProviderSecret(e.target.value)} placeholder={provider.configured ? tr('أدخل مفتاحًا جديدًا للاستبدال', 'Enter a new key to replace it') : 'AIza…'} />
            <FieldHint>{tr('يُستخدم المفتاح للاتصال بـGemini من الخادم فقط، ولا يظهر مرة أخرى بعد الحفظ.', 'The key is used server-side to call Gemini and is not displayed again after saving.')}</FieldHint>
          </label>
          <small>{tr('لا يتم عرض المفتاح الحالي أو حفظه في المتصفح. يُرسل عبر HTTPS ويُخزن مشفرًا في Supabase Vault.', 'The current key is never displayed or stored in the browser. It is sent over HTTPS and encrypted in Supabase Vault.')}</small>
          <div className="form-actions">
            <button type="submit" disabled={providerBusy || !providerSecret.trim()}>{tr('حفظ المفتاح', 'Save API key')}</button>
            <button type="button" className="ghost" disabled={providerBusy || !provider.configured} onClick={() => void testProvider()}>{tr('اختبار الاتصال', 'Test connection')}</button>
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
