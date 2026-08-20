import { useEffect, useState } from 'react'
import type { Profile } from '../types/domain'
import { signOut } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { canAccessPage, type PageKey } from '../lib/permissions'

type NavItem = { key: PageKey; label: string }
type NavGroup = { label: string; items: NavItem[] }

export function AdminLayout({profile,page,onNavigate,children}:{profile:Profile;page:string;onNavigate:(p:string)=>void;children:React.ReactNode}){
  const { tr, valueLabel, dir } = useI18n()
  const [menuOpen,setMenuOpen]=useState(false)
  const allGroups:NavGroup[]=[
    {
      label:tr('مساحة العمل','Workspace'),
      items:[
        {key:'dashboard',label:tr('لوحة التحكم','Dashboard')},
        {key:'setup',label:tr('معالج التهيئة','Setup Wizard')},
      ],
    },
    {
      label:tr('الإدارة والربط','Administration & API'),
      items:[
        {key:'organizations',label:tr('الجهات','Organizations')},
        {key:'users',label:tr('المستخدمون','Users')},
        {key:'api-clients',label:tr('عملاء واجهة API','API Clients')},
        {key:'integration',label:tr('دليل الربط','Integration Guide')},
      ],
    },
    {
      label:tr('المعرفة والذكاء','Knowledge & AI'),
      items:[
        {key:'knowledge',label:tr('المعرفة','Knowledge')},
        {key:'playground',label:tr('مختبر الذكاء الاصطناعي','AI Playground')},
        {key:'ai-settings',label:tr('إعدادات الذكاء الاصطناعي','AI Settings')},
        {key:'prompts',label:tr('التوجيهات','Prompts')},
        {key:'tools',label:tr('أدوات الوكيل','Agent Tools')},
      ],
    },
    {
      label:tr('خدمة العملاء','Customer Service'),
      items:[
        {key:'customers',label:tr('العملاء','Customers')},
        {key:'conversations',label:tr('المحادثات','Conversations')},
        {key:'handoff',label:tr('التحويل البشري','Human Handoff')},
      ],
    },
    {
      label:tr('المراقبة','Observability'),
      items:[
        {key:'usage',label:tr('الاستخدام والتكلفة','Usage & Cost')},
        {key:'audit',label:tr('سجل التدقيق','Audit Log')},
      ],
    },
  ]
  const groups=allGroups
    .map(group=>({...group,items:group.items.filter(item=>canAccessPage(profile.role,item.key))}))
    .filter(group=>group.items.length>0)

  useEffect(()=>{
    if(!menuOpen)return
    const previousOverflow=document.body.style.overflow
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setMenuOpen(false)}
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',onKeyDown)
    return()=>{
      document.body.style.overflow=previousOverflow
      document.removeEventListener('keydown',onKeyDown)
    }
  },[menuOpen])

  const navigate=(key:PageKey)=>{
    onNavigate(key)
    setMenuOpen(false)
  }

  return <div className={`shell${menuOpen?' menu-open':''}`} dir={dir}>
    <button
      className="mobile-menu-toggle"
      type="button"
      aria-label={tr('فتح القائمة الجانبية','Open side menu')}
      aria-controls="app-sidebar"
      aria-expanded={menuOpen}
      onClick={()=>setMenuOpen(true)}
    >
      <span className="menu-glyph" aria-hidden="true"><i/><i/><i/></span>
      <span>{tr('القائمة','Menu')}</span>
    </button>

    <button
      className={`sidebar-backdrop${menuOpen?' visible':''}`}
      type="button"
      aria-label={tr('إغلاق القائمة','Close menu')}
      tabIndex={menuOpen?0:-1}
      onClick={()=>setMenuOpen(false)}
    />

    <aside id="app-sidebar" className={`sidebar${menuOpen?' open':''}`} aria-label={tr('القائمة الرئيسية','Main navigation')}>
      <div className="sidebar-header">
        <div className="brand" aria-label="Central AI Platform">
          <span className="brand-signal" aria-hidden="true"><i/><i/><i/></span>
          <span className="brand-copy"><strong>Central AI</strong><small>{tr('منصة التحكم','Control Plane')}</small></span>
        </div>
        <button className="sidebar-close" type="button" aria-label={tr('إغلاق القائمة','Close menu')} onClick={()=>setMenuOpen(false)}>×</button>
      </div>

      <div className="scope-chip">
        <span className="scope-pulse" aria-hidden="true"/>
        <span>{profile.role==='SUPER_ADMIN'?tr('نطاق جميع الجهات','All organizations'):tr('نطاق الجهة','Organization scope')}</span>
      </div>

      <nav>{groups.map(group=><div className="nav-group" key={group.label}>
        <div className="nav-label">{group.label}</div>
        <div className="nav-items">{group.items.map(item=><button key={item.key} className={page===item.key?'active':''} aria-current={page===item.key?'page':undefined} onClick={()=>navigate(item.key)}><span>{item.label}</span><span className="nav-indicator" aria-hidden="true"/></button>)}</div>
      </div>)}</nav>

      <div className="sidebar-footer">
        <LanguageSwitcher compact/>
        <div className="profile-block"><span className="profile-avatar" aria-hidden="true">{profile.full_name.trim().charAt(0).toUpperCase()||'A'}</span><div><strong>{profile.full_name}</strong><small>{valueLabel(profile.role)}</small></div></div>
        <button className="ghost" onClick={()=>void signOut()}>{tr('تسجيل الخروج','Sign out')}</button>
      </div>
    </aside>

    <div className="workspace">
      <div className="workspace-bar">
        <div className="workspace-title"><span className="workspace-mark" aria-hidden="true"/>Central AI Platform</div>
        <div className="workspace-model"><span>{tr('النموذج','Model')}</span><strong>Gemini Flash-Lite</strong></div>
      </div>
      <main className="main">{children}</main>
    </div>
  </div>
}
