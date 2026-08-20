import type { Profile } from '../types/domain'
import { signOut } from '../lib/auth'

const items=[['dashboard','لوحة التحكم'],['organizations','الجهات'],['users','المستخدمون'],['api-clients','API Clients'],['integration','دليل الربط'],['knowledge','المعرفة'],['playground','AI Playground'],['ai-settings','إعدادات AI'],['prompts','Prompts'],['tools','Agent Tools'],['customers','العملاء'],['conversations','المحادثات'],['handoff','التحويل البشري'],['usage','الاستخدام والتكلفة'],['audit','Audit']]
export function AdminLayout({profile,page,onNavigate,children}:{profile:Profile;page:string;onNavigate:(p:string)=>void;children:React.ReactNode}){
  return <div className="shell" dir="rtl"><aside className="sidebar"><div className="brand"><strong>Central AI</strong><span>Platform</span></div><nav>{items.map(([key,label])=><button key={key} className={page===key?'active':''} onClick={()=>onNavigate(key)}>{label}</button>)}</nav><div className="sidebar-footer"><div>{profile.full_name}</div><small>{profile.role}</small><button className="ghost" onClick={()=>void signOut()}>تسجيل الخروج</button></div></aside><main className="main">{children}</main></div>
}
