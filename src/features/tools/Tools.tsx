import { useEffect, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'
import { Card, Empty, FieldHint, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import type { Organization } from '../../types/domain'

interface Tool {
  id: string
  organization_id: string
  name: string
  code: string
  method: string
  endpoint_url: string
  auth_type: string | null
  is_read_only: boolean
  requires_verification: boolean
  requires_human_approval: boolean
  is_active: boolean
}

type AuthType = 'none' | 'bearer' | 'api_key'

export function Tools() {
  const {tr,valueLabel}=useI18n()
  const [rows, setRows] = useState<Tool[]>([])
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [form, setForm] = useState({
    organization_id: '', name: '', code: '', method: 'GET', endpoint_url: '', auth_type: 'none' as AuthType,
    credential: '', header: 'X-API-Key', is_read_only: true, requires_verification: false, requires_human_approval: false,
  })
  const [msg, setMsg] = useState('')

  const load = async () => {
    const [toolsResult, organizationsResult] = await Promise.all([
      supabase.from('agent_tools_safe').select('*').order('created_at', { ascending: false }),
      supabase.from('organizations').select('*').eq('is_active', true).order('name_ar'),
    ])
    setRows((toolsResult.data ?? []) as Tool[])
    const organizationRows = (organizationsResult.data ?? []) as Organization[]
    setOrgs(organizationRows)
    setForm(current => current.organization_id || organizationRows.length !== 1 ? current : { ...current, organization_id: organizationRows[0].id })
  }

  useEffect(() => { void load() }, [])

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setMsg('')
    if (!form.is_read_only) { setMsg(tr('في النسخة الحالية يجب أن تكون الأداة للقراءة فقط. فعّل خيار القراءة فقط أولًا.','In the current MVP, tools must be read-only. Enable Read only first.')); return }
    const toolSecret = form.auth_type === 'bearer' ? { token: form.credential } : form.auth_type === 'api_key' ? { header: form.header, value: form.credential } : undefined
    try {
      const result = await adminApi<{ success: boolean; error?: string }>({
        action: 'create_agent_tool', organizationId: form.organization_id,
        tool: { name: form.name, code: form.code, method: form.method, endpointUrl: form.endpoint_url, authType: form.auth_type, requestSchema: {}, responseSchema: {}, isReadOnly: true, requiresVerification: form.requires_verification, requiresHumanApproval: form.requires_human_approval, timeoutSeconds: 10 },
        toolSecret,
      })
      if (!result.success) throw new Error(result.error ?? tr('تعذر إنشاء الأداة.','Unable to create tool.'))
      setMsg(tr('تم إنشاء الأداة وحفظ بيانات الاعتماد في Supabase Vault.','Tool created and credentials stored in Supabase Vault.'))
      setForm(current => ({ ...current, name: '', code: '', endpoint_url: '', credential: '' }))
      await load()
    } catch (error) { setMsg(error instanceof Error ? error.message : tr('تعذر إنشاء الأداة.','Unable to create tool.')) }
  }

  return <>
    <PageHeader title={tr('أدوات الوكيل','Agent Tools')} description={tr('اربط المساعد بواجهات بيانات حية محددة مسبقًا. الأدوات للقراءة فقط في النسخة الحالية، والأسرار محفوظة في Supabase Vault.','Connect the assistant to predefined live-data APIs. Tools are read-only in the current MVP and secrets are stored in Supabase Vault.')} />
    <Card>
      <form className="grid-form" onSubmit={create}>
        <label>{tr('الجهة','Organization')}
          <select required value={form.organization_id} onChange={e => setForm({ ...form, organization_id: e.target.value })}>
            <option value="">{tr('اختر الجهة','Select organization')}</option>
            {orgs.map(org => <option key={org.id} value={org.id}>{org.name_ar} / {org.name_en ?? org.code}</option>)}
          </select>
          <FieldHint>{tr('لا يمكن للأداة الوصول إلى بيانات جهة أخرى.', 'The tool cannot be used across another organization’s data.')}</FieldHint>
        </label>
        <label>{tr('اسم الأداة','Tool name')}
          <input required placeholder={tr('مثال: حالة طلب القبول','Example: Admission application status')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>{tr('الكود','Code')}
          <input required dir="ltr" placeholder="GET_APPLICATION_STATUS" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          <FieldHint>{tr('معرف تقني ثابت يستخدمه الوكيل لاختيار الأداة.', 'A stable technical identifier the agent uses to select the tool.')}</FieldHint>
        </label>
        <label>{tr('طريقة الطلب','Request method')}
          <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option>GET</option><option>POST</option></select>
          <FieldHint>{tr('استخدم GET للقراءة البسيطة وPOST عندما تتطلب الواجهة جسم طلب JSON.', 'Use GET for simple reads and POST when the API requires a JSON request body.')}</FieldHint>
        </label>
        <label>{tr('رابط نقطة الاتصال','Endpoint URL')}
          <input required type="url" dir="ltr" placeholder="https://api.example.com/status" value={form.endpoint_url} onChange={e => setForm({ ...form, endpoint_url: e.target.value })} />
          <FieldHint>{tr('هذا هو الرابط الوحيد الذي يُسمح للأداة باستدعائه؛ النموذج لا يرسل روابط من عنده.', 'This is the only URL the tool may call; the model cannot supply arbitrary URLs.')}</FieldHint>
        </label>
        <label>{tr('نوع المصادقة','Authentication type')}
          <select value={form.auth_type} onChange={e => setForm({ ...form, auth_type: e.target.value as AuthType })}>
            <option value="none">{tr('بدون مصادقة','No authentication')}</option>
            <option value="bearer">{tr('رمز Bearer','Bearer token')}</option>
            <option value="api_key">{tr('مفتاح API في ترويسة الطلب','API key header')}</option>
          </select>
        </label>
        {form.auth_type === 'api_key' && <label>{tr('اسم ترويسة المفتاح','API key header name')}
          <input required dir="ltr" placeholder="X-API-Key" value={form.header} onChange={e => setForm({ ...form, header: e.target.value })} />
        </label>}
        {form.auth_type !== 'none' && <label>{tr('بيانات الاعتماد','Credential')}
          <input required type="password" autoComplete="new-password" placeholder={tr('تُحفظ مشفرة في Vault','Stored encrypted in Vault')} value={form.credential} onChange={e => setForm({ ...form, credential: e.target.value })} />
          <FieldHint>{tr('لا تُخزن بيانات الاعتماد في React أو قاعدة بيانات عامة.', 'Credentials are not stored in React or a public database table.')}</FieldHint>
        </label>}
        <label className="check-label"><input type="checkbox" checked={form.is_read_only} onChange={e => setForm({ ...form, is_read_only: e.target.checked })} /> {tr('قراءة فقط — إلزامي حاليًا','Read only — currently required')}</label>
        <label className="check-label"><input type="checkbox" checked={form.requires_verification} onChange={e => setForm({ ...form, requires_verification: e.target.checked })} /> {tr('يتطلب عميلًا متحققًا منه','Verified customer required')}</label>
        <label className="check-label"><input type="checkbox" checked={form.requires_human_approval} onChange={e => setForm({ ...form, requires_human_approval: e.target.checked })} /> {tr('يتطلب موافقة بشرية','Human approval required')}</label>
        <button>{tr('إنشاء الأداة','Create tool')}</button>
      </form>
      {msg && <p>{msg}</p>}
    </Card>
    <Card>
      {rows.length === 0 ? <Empty>{tr('لا توجد أدوات.','No tools found.')}</Empty> : <table><thead><tr><th>{tr('الاسم','Name')}</th><th>{tr('الطريقة','Method')}</th><th>{tr('نقطة الاتصال','Endpoint')}</th><th>{tr('المصادقة','Authentication')}</th><th>{tr('قراءة فقط','Read only')}</th><th>{tr('التحقق','Verification')}</th><th>{tr('الحالة','Status')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}<small> {row.code}</small></td><td>{row.method}</td><td><code>{row.endpoint_url}</code></td><td>{valueLabel(row.auth_type ?? 'none')}</td><td>{row.is_read_only ? tr('نعم','Yes') : tr('لا','No')}</td><td>{row.requires_verification ? tr('نعم','Yes') : tr('لا','No')}</td><td>{row.is_active ? tr('نشطة','Active') : tr('متوقفة','Inactive')}</td></tr>)}</tbody></table>}
    </Card>
  </>
}
