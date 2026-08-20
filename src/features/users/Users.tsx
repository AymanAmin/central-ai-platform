import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'
import { Badge, Card, Empty, FieldHint, PageHeader, PanelHeader } from '../../components/Ui'
import type { AppRole,Organization,Profile } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

export function Users({profile}:{profile:Profile}){
  const {tr,valueLabel}=useI18n()
  const [users,setUsers]=useState<Profile[]>([])
  const [orgs,setOrgs]=useState<Organization[]>([])
  const [email,setEmail]=useState('')
  const [fullName,setFullName]=useState('')
  const [role,setRole]=useState<AppRole>('ORGANIZATION_ADMIN')
  const [organizationId,setOrganizationId]=useState(profile.organization_id??'')
  const [message,setMessage]=useState('')

  const load=async()=>{
    const [u,o]=await Promise.all([
      supabase.from('profiles').select('*').order('created_at',{ascending:false}),
      supabase.from('organizations').select('*').order('name_ar'),
    ])
    setUsers((u.data??[]) as Profile[])
    setOrgs((o.data??[]) as Organization[])
  }

  useEffect(()=>{void load()},[])

  const invite=async(e:React.FormEvent)=>{
    e.preventDefault();setMessage('')
    try{
      await adminApi({action:'invite_user',email,fullName,userRole:role,organizationId:role==='SUPER_ADMIN'?null:organizationId})
      setMessage(tr('تم إرسال الدعوة.','Invitation sent.'))
      setEmail('')
      setFullName('')
      await load()
    }catch(err){setMessage(err instanceof Error?err.message:tr('تعذر إرسال الدعوة','Unable to send invitation'))}
  }

  return <div className="screen screen-users">
    <PageHeader title={tr('المستخدمون','Users')} description={tr('ادعُ المستخدمين وحدد دور كل مستخدم ونطاق الجهة التي يمكنه الوصول إليها.','Invite users and define each user’s role and organization access scope.')}/>

    <div className="admin-split">
      <Card className="form-panel">
        <PanelHeader
          title={tr('دعوة مستخدم جديد','Invite a new user')}
          description={tr('أدخل بيانات الحساب ثم حدّد الصلاحية والجهة قبل إرسال الدعوة.','Enter the account details, then choose the role and organization before sending the invitation.')}
          meta={<span className="panel-index">01</span>}
        />
        <form className="grid-form compact-form" onSubmit={invite}>
          <label>{tr('الاسم الكامل','Full name')}
            <input required placeholder={tr('اسم المستخدم كما سيظهر في النظام','User name as shown in the system')} value={fullName} onChange={e=>setFullName(e.target.value)}/>
          </label>
          <label>{tr('البريد الإلكتروني','Email address')}
            <input required type="email" dir="ltr" placeholder="email@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>
            <FieldHint>{tr('تُرسل الدعوة إلى هذا البريد ويُستخدم لاحقًا لتسجيل الدخول.', 'The invitation is sent to this address and is later used to sign in.')}</FieldHint>
          </label>
          <label>{tr('الدور والصلاحيات','Role and permissions')}
            <select value={role} onChange={e=>setRole(e.target.value as AppRole)}>
              {profile.role==='SUPER_ADMIN'&&<option value="SUPER_ADMIN">{valueLabel('SUPER_ADMIN')}</option>}
              <option value="ORGANIZATION_ADMIN">{valueLabel('ORGANIZATION_ADMIN')}</option>
              <option value="KNOWLEDGE_MANAGER">{valueLabel('KNOWLEDGE_MANAGER')}</option>
              <option value="SUPPORT_AGENT">{valueLabel('SUPPORT_AGENT')}</option>
              <option value="VIEWER">{valueLabel('VIEWER')}</option>
            </select>
            <FieldHint>{tr('الدور يحدد ما يستطيع المستخدم عرضه أو تعديله داخل المنصة.', 'The role controls what the user can view or change in the platform.')}</FieldHint>
          </label>
          {role!=='SUPER_ADMIN'&&<label>{tr('الجهة المسموح بها','Allowed organization')}
            <select required value={organizationId} onChange={e=>setOrganizationId(e.target.value)}>
              <option value="">{tr('اختر الجهة','Select organization')}</option>
              {orgs.map(o=><option key={o.id} value={o.id}>{o.name_ar} / {o.name_en}</option>)}
            </select>
            <FieldHint>{tr('لن يتمكن المستخدم من قراءة بيانات جهة أخرى بفضل سياسات عزل البيانات.', 'Data-isolation policies prevent this user from reading another organization’s data.')}</FieldHint>
          </label>}
          <div className="form-submit-row">
            <button>{tr('إرسال الدعوة','Send invitation')}</button>
          </div>
        </form>
        {message&&<div className="inline-feedback" role="status">{message}</div>}
      </Card>

      <Card className="table-card data-panel">
        <PanelHeader
          title={tr('الحسابات الحالية','Current accounts')}
          description={tr('راجع المستخدمين وأدوارهم وحالة الوصول الحالية.','Review users, their roles, and current access status.')}
          meta={<Badge>{tr(`${users.length} مستخدم`,`${users.length} users`)}</Badge>}
        />
        {users.length===0?<Empty>{tr('لا يوجد مستخدمون.','No users found.')}</Empty>:<table className="data-table"><thead><tr><th>{tr('الاسم','Name')}</th><th>{tr('البريد','Email')}</th><th>{tr('الدور','Role')}</th><th>{tr('الحالة','Status')}</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td className="cell-primary">{u.full_name}</td><td dir="ltr">{u.email}</td><td>{valueLabel(u.role)}</td><td><Badge tone={u.is_active?'good':'bad'}>{u.is_active?tr('نشط','Active'):tr('متوقف','Inactive')}</Badge></td></tr>)}</tbody></table>}
      </Card>
    </div>
  </div>
}
