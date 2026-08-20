import { useEffect, useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'

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
  const [rows, setRows] = useState<Tool[]>([])
  const [form, setForm] = useState({
    organization_id: '',
    name: '',
    code: '',
    method: 'GET',
    endpoint_url: '',
    auth_type: 'none' as AuthType,
    credential: '',
    header: 'X-API-Key',
    is_read_only: true,
    requires_verification: false,
    requires_human_approval: false,
  })
  const [msg, setMsg] = useState('')

  const load = async () => {
    const result = await supabase.from('agent_tools_safe').select('*').order('created_at', { ascending: false })
    setRows((result.data ?? []) as Tool[])
  }

  useEffect(() => { void load() }, [])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setMsg('')
    if (!form.is_read_only) {
      setMsg('في MVP يجب أن تكون الأداة Read-only. فعّل Read only أولًا.')
      return
    }
    const toolSecret = form.auth_type === 'bearer'
      ? { token: form.credential }
      : form.auth_type === 'api_key'
        ? { header: form.header, value: form.credential }
        : undefined
    try {
      const result = await adminApi<{ success: boolean; error?: string }>({
        action: 'create_agent_tool',
        organizationId: form.organization_id,
        tool: {
          name: form.name,
          code: form.code,
          method: form.method,
          endpointUrl: form.endpoint_url,
          authType: form.auth_type,
          requestSchema: {},
          responseSchema: {},
          isReadOnly: true,
          requiresVerification: form.requires_verification,
          requiresHumanApproval: form.requires_human_approval,
          timeoutSeconds: 10,
        },
        toolSecret,
      })
      if (!result.success) throw new Error(result.error ?? 'تعذر إنشاء الأداة.')
      setMsg('تم إنشاء الأداة وحفظ بيانات الاعتماد في Supabase Vault.')
      setForm(current => ({ ...current, name: '', code: '', endpoint_url: '', credential: '' }))
      await load()
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'تعذر إنشاء الأداة.')
    }
  }

  return <>
    <PageHeader title="Agent Tools" description="MVP: HTTP GET/POST، URLs معرفة مسبقًا، Read-only فقط، والأسرار محفوظة في Supabase Vault." />
    <Card>
      <form className="grid-form" onSubmit={create}>
        <input required placeholder="Organization UUID" value={form.organization_id} onChange={e => setForm({ ...form, organization_id: e.target.value })} />
        <input required placeholder="Tool name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <input required placeholder="CODE" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option>GET</option><option>POST</option></select>
        <input required type="url" placeholder="https://api.example.com/status" value={form.endpoint_url} onChange={e => setForm({ ...form, endpoint_url: e.target.value })} />
        <select value={form.auth_type} onChange={e => setForm({ ...form, auth_type: e.target.value as AuthType })}>
          <option value="none">No authentication</option>
          <option value="bearer">Bearer token</option>
          <option value="api_key">API key header</option>
        </select>
        {form.auth_type === 'api_key' && <input required placeholder="Header name" value={form.header} onChange={e => setForm({ ...form, header: e.target.value })} />}
        {form.auth_type !== 'none' && <input required type="password" autoComplete="new-password" placeholder="Credential — stored in Vault" value={form.credential} onChange={e => setForm({ ...form, credential: e.target.value })} />}
        <label><input type="checkbox" checked={form.is_read_only} onChange={e => setForm({ ...form, is_read_only: e.target.checked })} /> Read only (required in MVP)</label>
        <label><input type="checkbox" checked={form.requires_verification} onChange={e => setForm({ ...form, requires_verification: e.target.checked })} /> Verification required</label>
        <label><input type="checkbox" checked={form.requires_human_approval} onChange={e => setForm({ ...form, requires_human_approval: e.target.checked })} /> Human approval required</label>
        <button>إنشاء</button>
      </form>
      {msg && <p>{msg}</p>}
    </Card>
    <Card>{rows.length === 0 ? <Empty>لا توجد أدوات.</Empty> : <table><thead><tr><th>الاسم</th><th>Method</th><th>Endpoint</th><th>Auth</th><th>Read only</th><th>Verification</th><th>الحالة</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}<small> {row.code}</small></td><td>{row.method}</td><td><code>{row.endpoint_url}</code></td><td>{row.auth_type ?? 'none'}</td><td>{row.is_read_only ? 'نعم' : 'لا'}</td><td>{row.requires_verification ? 'نعم' : 'لا'}</td><td>{row.is_active ? 'نشطة' : 'متوقفة'}</td></tr>)}</tbody></table>}</Card>
  </>
}
