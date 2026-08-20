import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'
import { Card, Empty, FieldHint, PageHeader } from '../../components/Ui'
import type { Organization,Profile } from '../../types/domain'
import { useI18n, type AppLanguage } from '../../lib/i18n'

export function Organizations({profile}:{profile:Profile}){
  const {tr,valueLabel}=useI18n()
  const [rows,setRows]=useState<Organization[]>([])
  const [nameAr,setNameAr]=useState('')
  const [nameEn,setNameEn]=useState('')
  const [code,setCode]=useState('')
  const [defaultLanguage,setDefaultLanguage]=useState<AppLanguage>('ar')
  const [error,setError]=useState('')

  const load=async()=>{const {data,error}=await supabase.from('organizations').select('*').order('created_at',{ascending:false});if(error)setError(error.message);else setRows((data??[]) as Organization[])}
  useEffect(()=>{void load()},[])

  const create=async(e:React.FormEvent)=>{
    e.preventDefault();setError('')
    try{await adminApi({action:'create_organization',nameAr:nameAr.trim(),nameEn:nameEn.trim(),code,defaultLanguage});setNameAr('');setNameEn('');setCode('');await load()}
    catch(cause){setError(cause instanceof Error?cause.message:tr('تعذر إنشاء الجهة.','Unable to create organization.'))}
  }

  return <>
    <PageHeader title={tr('الجهات','Organizations')} description={tr('أنشئ الجهات التي تستخدم المنصة مع عزل كامل للبيانات والإعدادات لكل جهة.','Create organizations that use the platform with complete isolation of data and settings.')}/>
    {profile.role==='SUPER_ADMIN'&&<Card>
      <form className="grid-form" onSubmit={create}>
        <label>{tr('اسم الجهة بالعربية','Organization name in Arabic')}
          <input required placeholder={tr('مثال: مدارس الواحة','Example: Waha Schools')} value={nameAr} onChange={e=>setNameAr(e.target.value)}/>
        </label>
        <label>{tr('اسم الجهة بالإنجليزية','Organization name in English')}
          <input required placeholder="Waha Schools" value={nameEn} onChange={e=>setNameEn(e.target.value)}/>
        </label>
        <label>{tr('كود الجهة','Organization code')}
          <input required dir="ltr" placeholder="WAHA_SCHOOLS" value={code} onChange={e=>setCode(e.target.value)}/>
          <FieldHint>{tr('معرف تقني ثابت بدون مسافات، ويُفضّل ألا يتغير بعد بدء الربط.', 'A stable technical identifier without spaces; avoid changing it after integrations begin.')}</FieldHint>
        </label>
        <label>{tr('اللغة الافتراضية','Default language')}
          <select value={defaultLanguage} onChange={e=>setDefaultLanguage(e.target.value as AppLanguage)}><option value="ar">{tr('العربية','Arabic')}</option><option value="en">{tr('الإنجليزية','English')}</option></select>
          <FieldHint>{tr('تُستخدم عندما لا يرسل النظام الخارجي لغة العميل صراحةً.', 'Used when the external system does not explicitly provide the customer language.')}</FieldHint>
        </label>
        <button>{tr('إنشاء الجهة','Create organization')}</button>
      </form>
      {error&&<p className="error-text">{error}</p>}
    </Card>}
    <Card>
      {rows.length===0?<Empty>{tr('لا توجد جهات بعد.','No organizations yet.')}</Empty>:<table><thead><tr><th>{tr('الاسم العربي','Arabic name')}</th><th>{tr('الاسم الإنجليزي','English name')}</th><th>{tr('الكود','Code')}</th><th>{tr('اللغة الافتراضية','Default language')}</th><th>{tr('الحالة','Status')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.name_ar}</td><td>{r.name_en??'—'}</td><td><code>{r.code}</code></td><td>{valueLabel(r.default_language)}</td><td>{r.is_active?tr('نشطة','Active'):tr('متوقفة','Inactive')}</td></tr>)}</tbody></table>}
    </Card>
  </>
}
