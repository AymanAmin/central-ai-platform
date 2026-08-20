import { useEffect, useState } from 'react'
import { Card, PageHeader } from '../../components/Ui'
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
    <PageHeader title={tr('إعدادات الذكاء الاصطناعي', 'AI Settings')} />

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
          </label>
          <small>{tr('لا يتم عرض المفتاح الحالي أو حفظه في المتصفح. يُرسل عبر HTTPS ويُخزن مشفرًا في Supabase Vault.', 'The current key is never displayed or stored in the browser. It is sent over HTTPS and encrypted in Supabase Vault.')}</small>
          <div className="form-actions">
            <button type="submit" disabled={providerBusy || !providerSecret.trim()}>{tr('حفظ المفتاح', 'Save API key')}</button>
            <button type="button" className="ghost" disabled={providerBusy || !provider.configured} onClick={() => void testProvider()}>{tr('اختبار الاتصال', 'Test connection')}</button>
          </div>
        </form>
      </> : <p>{tr('جاري تحميل إعدادات المزود…', 'Loading provider settings…')}</p>}
      {providerMsg && <p>{providerMsg}</p>}
    </Card>}

    {profile.role === 'SUPER_ADMIN' && <Card>
      <select value={orgId} onChange={e => setOrgId(e.target.value)}>
        <option value="">{tr('اختر الجهة', 'Select organization')}</option>
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name_ar} / {o.name_en}</option>)}
      </select>
    </Card>}

    {s && <Card>
      <div className="settings-grid">
        <label><span>{tr('المعرفة فقط', 'Knowledge only')}</span><input type="checkbox" checked={s.knowledge_only} onChange={e => setS({ ...s, knowledge_only: e.target.checked })} /></label>
        <label><span>{tr('السماح بالمعرفة العامة', 'Allow general knowledge')}</span><input type="checkbox" checked={s.allow_general_knowledge} onChange={e => setS({ ...s, allow_general_knowledge: e.target.checked })} /></label>
        <label>{tr('عدد النتائج المسترجعة', 'Top K')}<input type="number" value={s.rag_top_k} onChange={e => setS({ ...s, rag_top_k: Number(e.target.value) })} /></label>
        <label>{tr('الحد الأدنى للتشابه', 'Min similarity')}<input type="number" step="0.01" value={s.min_similarity} onChange={e => setS({ ...s, min_similarity: Number(e.target.value) })} /></label>
        <label>{tr('الرسائل الحديثة', 'Recent messages')}<input type="number" value={s.recent_messages_count} onChange={e => setS({ ...s, recent_messages_count: Number(e.target.value) })} /></label>
        <label>{tr('حد إنشاء الملخص', 'Summary threshold')}<input type="number" value={s.summarize_after_count} onChange={e => setS({ ...s, summarize_after_count: Number(e.target.value) })} /></label>
        <label>{tr('الحد الأقصى للمخرجات', 'Max output')}<input type="number" value={s.max_output_tokens} onChange={e => setS({ ...s, max_output_tokens: Number(e.target.value) })} /></label>
        <label>{tr('حد التحويل البشري', 'Handoff threshold')}<input type="number" step="0.01" value={s.human_handoff_threshold} onChange={e => setS({ ...s, human_handoff_threshold: Number(e.target.value) })} /></label>
      </div>
      <button onClick={() => void save()}>{tr('حفظ', 'Save')}</button>
      {msg && <p>{msg}</p>}
    </Card>}
  </>
}
