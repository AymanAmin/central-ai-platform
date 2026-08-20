import type { Profile } from '../types/domain'
import { signOut } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

export function AdminLayout({profile,page,onNavigate,children}:{profile:Profile;page:string;onNavigate:(p:string)=>void;children:React.ReactNode}){
  const { tr, valueLabel, dir } = useI18n()
  const items=[
    ['dashboard',tr('لوحة التحكم','Dashboard')],['organizations',tr('الجهات','Organizations')],['users',tr('المستخدمون','Users')],['api-clients','API Clients'],['integration',tr('دليل الربط','Integration Guide')],['knowledge',tr('المعرفة','Knowledge')],['playground','AI Playground'],['ai-settings',tr('إعدادات الذكاء الاصطناعي','AI Settings')],['prompts',tr('التوجيهات','Prompts')],['tools',tr('أدوات الوكيل','Agent Tools')],['customers',tr('العملاء','Customers')],['conversations',tr('المحادثات','Conversations')],['handoff',tr('التحويل البشري','Human Handoff')],['usage',tr('الاستخدام والتكلفة','Usage & Cost')],['audit',tr('سجل التدقيق','Audit Log')]
  ]
  return <div className="shell" dir={dir}><aside className="sidebar"><div className="brand"><strong>Central AI</strong><span>Platform</span></div><LanguageSwitcher compact/><nav>{items.map(([key,label])=><button key={key} className={page===key?'active':''} onClick={()=>onNavigate(key)}>{label}</button>)}</nav><div className="sidebar-footer"><div>{profile.full_name}</div><small>{valueLabel(profile.role)}</small><button className="ghost" onClick={()=>void signOut()}>{tr('تسجيل الخروج','Sign out')}</button></div></aside><main className="main">{children}</main></div>
}
