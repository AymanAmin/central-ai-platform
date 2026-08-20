import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'
import { Card, Empty, FieldHint, PageHeader } from '../../components/Ui'
import type { ApiClient, Organization, Profile } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

export function ApiClients({profile}:{profile:Profile}){
  const {tr}=useI18n()
  const [rows,setRows]=useState<ApiClient[]>([])
  const [orgs,setOrgs]=useState<Organization[]>([])
  const [organizationId,setOrganizationId]=useState(profile.organization_id??'')
  const [name,setName]=useState('')
  const [code,setCode]=useState('')
  const [rateLimit,setRateLimit]=useState(60)
  const [shownKey,setShownKey]=useState('')
  const [error,setError]=useState('')

  const load=async()=>{
    const [c,o]=await Promise.all([
      supabase.from('api_clients_safe').select('*').order('created_at',{ascending:false}),
      supabase.from('organizations').select('*'),
    ])
    setRows((c.data??[]) as ApiClient[])
    setOrgs((o.data??[]) as Organization[])
  }

  useEffect(()=>{void load()},[])

  const create=async(e:React.FormEvent)=>{
    e.preventDefault()
    setError('')
    try{
      const r=await adminApi<{apiKey:string}>({action:'create_api_client',organizationId,name,code,capabilities:['chat'],rateLimitPerMinute:rateLimit})
      setShownKey(r.apiKey)
      setName('')
      setCode('')
      await load()
    }catch(err){setError(err instanceof Error?err.message:tr('تعذر إنشاء عميل API','Unable to create API client'))}
  }

  const rotate=async(id:string)=>{
    if(!confirm(tr('سيتم إلغاء المفتاح السابق فورًا. متابعة؟','The previous key will be revoked immediately. Continue?')))return
    const r=await adminApi<{apiKey:string}>({action:'rotate_api_key',apiClientId:id})
    setShownKey(r.apiKey)
    await load()
  }

  return <>
    <PageHeader title={tr('عملاء واجهة API','API Clients')} description={tr('أنشئ بيانات اتصال آمنة للأنظمة الخارجية. يظهر المفتاح مرة واحدة فقط ولا يُحفظ بصورته الأصلية.','Create secure credentials for external systems. Keys are shown once and are never stored in plaintext.')}/>
    <Card>
      <form className="grid-form" onSubmit={create}>
        {profile.role==='SUPER_ADMIN'&&<label>{tr('الجهة','Organization')}
          <select required value={organizationId} onChange={e=>setOrganizationId(e.target.value)}><option value="">{tr('اختر الجهة','Select organization')}</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name_ar} / {o.name_en}</option>)}</select>
        </label>}
        <label>{tr('اسم الاتصال','Client name')}
          <input required placeholder={tr('مثال: موقع الجهة','Example: Organization website')} value={name} onChange={e=>setName(e.target.value)}/>
          <FieldHint>{tr('اسم واضح يعرّف النظام الذي سيستخدم المفتاح.', 'A clear name identifying the system that will use this key.')}</FieldHint>
        </label>
        <label>{tr('الكود','Code')}
          <input required dir="ltr" placeholder="WAHA_WEBSITE" value={code} onChange={e=>setCode(e.target.value)}/>
          <FieldHint>{tr('معرف تقني ثابت بدون مسافات، مثل WAHA_WEBSITE.','A stable technical identifier without spaces, such as WAHA_WEBSITE.')}</FieldHint>
        </label>
        <label>{tr('الحد الأقصى للطلبات في الدقيقة','Requests per minute')}
          <input required type="number" min={1} max={10000} value={rateLimit} onChange={e=>setRateLimit(Number(e.target.value))}/>
          <FieldHint>{tr('يحمي الخدمة من الاندفاع المفاجئ أو الاستخدام غير الطبيعي. القيمة الافتراضية 60.', 'Protects the service from bursts or abnormal usage. The default is 60.')}</FieldHint>
        </label>
        <button>{tr('إنشاء عميل API','Create API Client')}</button>
      </form>
      {error&&<p className="error-text">{error}</p>}
      {shownKey&&<div className="secret-once"><strong>{tr('انسخ المفتاح الآن — لن يظهر مرة أخرى','Copy the key now — it will not be shown again')}</strong><code>{shownKey}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(shownKey)}>{tr('نسخ','Copy')}</button></div>}
    </Card>
    <Card>
      {rows.length===0?<Empty>{tr('لا يوجد عملاء API.','No API clients found.')}</Empty>:<table><thead><tr><th>{tr('الاسم','Name')}</th><th>{tr('الكود','Code')}</th><th>{tr('بادئة المفتاح','Key prefix')}</th><th>{tr('حد الطلبات','Rate limit')}</th><th>{tr('الحالة','Status')}</th><th>{tr('إجراء','Action')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.code}</td><td><code>{r.api_key_prefix}</code></td><td>{tr(`${r.rate_limit_per_minute} طلب/دقيقة`,`${r.rate_limit_per_minute} req/min`)}</td><td>{r.is_active?tr('نشط','Active'):tr('متوقف','Inactive')}</td><td><button className="small" onClick={()=>void rotate(r.id)}>{tr('تدوير المفتاح','Rotate key')}</button></td></tr>)}</tbody></table>}
    </Card>
  </>
}
