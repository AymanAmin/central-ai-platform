import { useEffect, useState } from 'react'
import type { Profile } from '../types/domain'
import { signOut } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

export function AdminLayout({profile,page,onNavigate,children}:{profile:Profile;page:string;onNavigate:(p:string)=>void;children:React.ReactNode}){
  const { tr, valueLabel, dir } = useI18n()
  const [menuOpen,setMenuOpen]=useState(false)
  const items=[
    ['dashboard',tr('لوحة التحكم','Dashboard')],
    ...(profile.role==='SUPER_ADMIN'?[["setup",tr('معالج التهيئة','Setup Wizard')]]:[]),
    ['organizations',tr('الجهات','Organizations')],['users',tr('المستخدمون','Users')],['api-clients','API Clients'],['integration',tr('دليل الربط','Integration Guide')],['knowledge',tr('المعرفة','Knowledge')],['playground','AI Playground'],['ai-settings',tr('إعدادات الذكاء الاصطناعي','AI Settings')],['prompts',tr('التوجيهات','Prompts')],['tools',tr('أدوات الوكيل','Agent Tools')],['customers',tr('العملاء','Customers')],['conversations',tr('المحادثات','Conversations')],['handoff',tr('التحويل البشري','Human Handoff')],['usage',tr('الاستخدام والتكلفة','Usage & Cost')],['audit',tr('سجل التدقيق','Audit Log')]
  ]

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

  const navigate=(key:string)=>{
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
      <span aria-hidden="true">☰</span>
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
        <div className="brand"><strong>Central AI</strong><span>Platform</span></div>
        <button className="sidebar-close" type="button" aria-label={tr('إغلاق القائمة','Close menu')} onClick={()=>setMenuOpen(false)}>×</button>
      </div>
      <LanguageSwitcher compact/>
      <nav>{items.map(([key,label])=><button key={key} className={page===key?'active':''} aria-current={page===key?'page':undefined} onClick={()=>navigate(key)}>{label}</button>)}</nav>
      <div className="sidebar-footer"><div>{profile.full_name}</div><small>{valueLabel(profile.role)}</small><button className="ghost" onClick={()=>void signOut()}>{tr('تسجيل الخروج','Sign out')}</button></div>
    </aside>

    <main className="main">{children}</main>
  </div>
}
