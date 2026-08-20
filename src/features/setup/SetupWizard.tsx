import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, PageHeader } from '../../components/Ui'
import { adminApi } from '../../lib/adminApi'
import { useI18n } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import type { Organization, Profile } from '../../types/domain'

interface ProviderStatus {
  providerSettingId: string
  provider: string
  chatModel: string
  embeddingModel: string
  configured: boolean
}

type OrgChecks = {
  settings: boolean
  knowledgeBases: number
  readyDocuments: number
  faqs: number
  apiClients: number
}

const selectedOrgStorageKey = 'central-ai-setup-org'

export function SetupWizard({ profile, onNavigate }: { profile: Profile; onNavigate: (page: string) => void }) {
  const { tr } = useI18n()
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [organizationId, setOrganizationId] = useState(() => localStorage.getItem(selectedOrgStorageKey) ?? '')
  const [checks, setChecks] = useState<OrgChecks>({ settings: false, knowledgeBases: 0, readyDocuments: 0, faqs: 0, apiClients: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [providerResult, organizationsResult] = await Promise.all([
        adminApi<ProviderStatus>({ action: 'ai_provider_status' }),
        supabase.from('organizations').select('*').eq('is_active', true).order('created_at', { ascending: true }),
      ])
      if (organizationsResult.error) throw organizationsResult.error
      const organizations = (organizationsResult.data ?? []) as Organization[]
      setProvider(providerResult)
      setOrgs(organizations)
      const stored = localStorage.getItem(selectedOrgStorageKey)
      const resolved = stored && organizations.some(org => org.id === stored) ? stored : organizations[0]?.id ?? ''
      setOrganizationId(current => organizations.some(org => org.id === current) ? current : resolved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('تعذر تحميل حالة التهيئة.', 'Unable to load setup status.'))
    } finally {
      setLoading(false)
    }
  }, [tr])

  const loadOrganizationChecks = useCallback(async (orgId: string) => {
    if (!orgId) {
      setChecks({ settings: false, knowledgeBases: 0, readyDocuments: 0, faqs: 0, apiClients: 0 })
      return
    }
    const [settings, bases, docs, faqs, clients] = await Promise.all([
      supabase.from('organization_settings').select('organization_id', { count: 'exact', head: true }).eq('organization_id', orgId),
      supabase.from('knowledge_bases').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      supabase.from('knowledge_documents').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true).eq('processing_status', 'ready'),
      supabase.from('knowledge_faq').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      supabase.from('api_clients_safe').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
    ])
    const firstError = [settings, bases, docs, faqs, clients].find(result => result.error)?.error
    if (firstError) {
      setError(firstError.message)
      return
    }
    setChecks({
      settings: (settings.count ?? 0) > 0,
      knowledgeBases: bases.count ?? 0,
      readyDocuments: docs.count ?? 0,
      faqs: faqs.count ?? 0,
      apiClients: clients.count ?? 0,
    })
  }, [])

  useEffect(() => {
    if (profile.role === 'SUPER_ADMIN') void loadBase()
  }, [profile.role, loadBase])

  useEffect(() => {
    if (!organizationId) return
    localStorage.setItem(selectedOrgStorageKey, organizationId)
    void loadOrganizationChecks(organizationId)
  }, [organizationId, loadOrganizationChecks])

  const hasOrganization = orgs.length > 0 && Boolean(organizationId)
  const hasKnowledge = checks.knowledgeBases > 0 && (checks.readyDocuments > 0 || checks.faqs > 0)
  const coreSteps = useMemo(() => [
    { key: 'provider', done: Boolean(provider?.configured), title: tr('ربط Gemini', 'Connect Gemini'), detail: provider?.configured ? `${provider.provider} · ${provider.chatModel}` : tr('أضف مفتاح Gemini API داخل Vault واختبر الاتصال.', 'Store the Gemini API key in Vault and test the connection.'), page: 'ai-settings' },
    { key: 'organization', done: hasOrganization, title: tr('إنشاء جهة', 'Create organization'), detail: hasOrganization ? tr('تم اختيار جهة نشطة.', 'An active organization is selected.') : tr('أنشئ أول جهة وحدد الاسم واللغة الافتراضية.', 'Create the first organization and choose its default language.'), page: 'organizations' },
    { key: 'settings', done: hasOrganization && checks.settings, title: tr('إعدادات الجهة', 'Organization settings'), detail: checks.settings ? tr('سجل إعدادات الجهة موجود.', 'Organization settings are initialized.') : tr('أكمل إعدادات RAG والذاكرة والتحويل البشري.', 'Configure RAG, memory, and human handoff settings.'), page: 'ai-settings' },
    { key: 'knowledge', done: hasKnowledge, title: tr('تجهيز المعرفة', 'Prepare knowledge'), detail: tr(`${checks.knowledgeBases} قاعدة · ${checks.readyDocuments} مستند جاهز · ${checks.faqs} FAQ`, `${checks.knowledgeBases} bases · ${checks.readyDocuments} ready documents · ${checks.faqs} FAQs`), page: 'knowledge' },
    { key: 'client', done: checks.apiClients > 0, title: tr('إنشاء API Client', 'Create API Client'), detail: tr(`${checks.apiClients} عميل API نشط`, `${checks.apiClients} active API clients`), page: 'api-clients' },
  ], [provider, hasOrganization, checks, hasKnowledge, tr])

  const completed = coreSteps.filter(step => step.done).length
  const readyToTest = completed === coreSteps.length

  if (profile.role !== 'SUPER_ADMIN') return <Card>{tr('معالج التهيئة متاح للمدير العام فقط.', 'The setup wizard is available to Super Admins only.')}</Card>

  return <>
    <PageHeader
      title={tr('معالج تهيئة المنصة', 'Platform Setup Wizard')}
      description={tr('حالة مباشرة مبنية على البيانات الفعلية. لا يتم اعتبار أي خطوة مكتملة إلا عند تحقق متطلباتها.', 'Live readiness based on real platform data. A step is complete only when its requirement is actually satisfied.')}
      actions={<button type="button" onClick={() => void loadBase()} disabled={loading}>{tr('تحديث الحالة', 'Refresh status')}</button>}
    />

    <Card>
      <div className="stack">
        <strong>{tr(`اكتمل ${completed} من ${coreSteps.length}`, `${completed} of ${coreSteps.length} complete`)}</strong>
        <progress value={completed} max={coreSteps.length} style={{ width: '100%' }} />
        {orgs.length > 0 && <label>{tr('الجهة التي يتم تجهيزها', 'Organization being configured')}
          <select value={organizationId} onChange={event => setOrganizationId(event.target.value)}>
            {orgs.map(org => <option key={org.id} value={org.id}>{org.name_ar} / {org.name_en ?? org.code}</option>)}
          </select>
        </label>}
        {error && <div className="notice error">{error}</div>}
      </div>
    </Card>

    <div className="stats">
      {coreSteps.map((step, index) => <Card key={step.key}>
        <span>{tr(`الخطوة ${index + 1}`, `Step ${index + 1}`)} · {step.done ? tr('مكتملة', 'Complete') : tr('مطلوبة', 'Required')}</span>
        <strong style={{ fontSize: '1.15rem' }}>{step.done ? '✓ ' : ''}{step.title}</strong>
        <p>{step.detail}</p>
        <button type="button" className={step.done ? 'small ghost' : 'small'} onClick={() => onNavigate(step.page)}>{step.done ? tr('مراجعة', 'Review') : tr('إكمال الخطوة', 'Complete step')}</button>
      </Card>)}
    </div>

    <Card>
      <h2>{tr('الاختبار النهائي', 'Final test')}</h2>
      {readyToTest ? <>
        <div className="notice success">{tr('المتطلبات الأساسية جاهزة. نفّذ سؤالًا حقيقيًا في AI Playground ثم استخدم API Client لاختبار /chat.', 'Core requirements are ready. Run a real question in AI Playground, then use the API Client to test /chat.')}</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button type="button" onClick={() => onNavigate('playground')}>{tr('فتح AI Playground', 'Open AI Playground')}</button>
          <button type="button" className="ghost" onClick={() => onNavigate('integration')}>{tr('فتح دليل الربط', 'Open integration guide')}</button>
        </div>
      </> : <div className="notice">{tr('أكمل الخطوات المطلوبة أعلاه قبل الاختبار النهائي.', 'Complete the required steps above before the final test.')}</div>}
    </Card>
  </>
}
