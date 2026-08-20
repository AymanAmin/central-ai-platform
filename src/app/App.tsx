import { useEffect,useMemo,useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { AdminLayout } from '../layouts/AdminLayout'
import { signIn,signUp,resetPassword,updatePassword } from '../lib/auth'
import { adminApi } from '../lib/adminApi'
import { Dashboard } from '../features/dashboard/Dashboard'
import { Organizations } from '../features/organizations/Organizations'
import { Users } from '../features/users/Users'
import { ApiClients } from '../features/api-clients/ApiClients'
import { IntegrationGuide } from '../features/api-clients/IntegrationGuide'
import { Knowledge } from '../features/knowledge/Knowledge'
import { Conversations } from '../features/conversations/Conversations'
import { Customers } from '../features/customers/Customers'
import { Handoff } from '../features/handoff/Handoff'
import { AiSettings } from '../features/ai-settings/AiSettings'
import { Prompts } from '../features/prompts/Prompts'
import { Tools } from '../features/tools/Tools'
import { Usage } from '../features/usage/Usage'
import { Audit } from '../features/audit/Audit'
import { Playground } from '../features/playground/Playground'
import { Card, Spinner } from '../components/Ui'

function AuthScreen({mode,onDone}:{mode:'login'|'reset-password';onDone:()=>void}){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{if(mode==='reset-password'){const {error}=await updatePassword(password);if(error)throw error;setMessage('تم تحديث كلمة المرور.');onDone()}else{const {error}=await signIn(email,password);if(error)throw error}}catch(err){setMessage(err instanceof Error?err.message:'تعذر إكمال العملية')}finally{setBusy(false)}}
 const forgot=async()=>{if(!email){setMessage('أدخل البريد أولًا.');return}const {error}=await resetPassword(email);setMessage(error?.message??'تم إرسال رابط الاستعادة.')}
 return <div className="auth-page" dir="rtl"><Card className="auth-card"><div className="brand center"><strong>Central AI</strong><span>Platform</span></div><h1>{mode==='reset-password'?'تعيين كلمة المرور':'تسجيل الدخول'}</h1><form className="stack" onSubmit={submit}>{mode==='login'&&<input required type="email" placeholder="البريد الإلكتروني" value={email} onChange={e=>setEmail(e.target.value)}/>}<input required type="password" minLength={8} placeholder="كلمة المرور" value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>{busy?'جارٍ التنفيذ…':mode==='login'?'دخول':'حفظ كلمة المرور'}</button></form>{mode==='login'&&<button className="link" onClick={()=>void forgot()}>نسيت كلمة المرور؟</button>}{message&&<p>{message}</p>}</Card></div>}

function Bootstrap({refresh}:{refresh:()=>Promise<void>}){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [fullName,setFullName]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const create=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{const {data,error}=await signUp(email,password);if(error)throw error;if(!data.user)throw new Error('لم يتم إنشاء المستخدم.');if(!data.session){setMessage('تم إنشاء الحساب. إذا كان تأكيد البريد مفعّلًا، أكّد البريد ثم سجل الدخول لإكمال Bootstrap.');return}await adminApi({action:'bootstrap_super_admin',fullName});await refresh()}catch(err){setMessage(err instanceof Error?err.message:'تعذر إنشاء المدير الأول')}finally{setBusy(false)}}
 return <div className="auth-page" dir="rtl"><Card className="auth-card"><h1>إنشاء Super Admin الأول</h1><p>هذه الشاشة تعمل مرة واحدة فقط عندما لا يوجد أي Profile في النظام.</p><form className="stack" onSubmit={create}><input required placeholder="الاسم الكامل" value={fullName} onChange={e=>setFullName(e.target.value)}/><input required type="email" placeholder="البريد" value={email} onChange={e=>setEmail(e.target.value)}/><input required minLength={8} type="password" placeholder="كلمة المرور" value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>{busy?'جارٍ الإنشاء…':'إنشاء Super Admin'}</button></form>{message&&<p>{message}</p>}</Card></div>}

export function App(){const {user,profile,loading,refresh}=useAuth();const [page,setPage]=useState(()=>location.hash.replace('#','')||'dashboard');const [bootstrapPossible,setBootstrapPossible]=useState(false)
 useEffect(()=>{const handler=()=>setPage(location.hash.replace('#','')||'dashboard');addEventListener('hashchange',handler);return()=>removeEventListener('hashchange',handler)},[])
 useEffect(()=>{if(user&&!profile){void adminApi<{canBootstrap:boolean}>({action:'bootstrap_status'}).then(r=>setBootstrapPossible(r.canBootstrap)).catch(()=>setBootstrapPossible(false))}},[user,profile])
 const navigate=(p:string)=>{location.hash=p;setPage(p)};const view=useMemo(()=>{if(!profile)return null;switch(page){case'organizations':return <Organizations profile={profile}/>;case'users':return <Users profile={profile}/>;case'api-clients':return <ApiClients profile={profile}/>;case'integration':return <IntegrationGuide/>;case'knowledge':return <Knowledge profile={profile}/>;case'playground':return <Playground/>;case'ai-settings':return <AiSettings profile={profile}/>;case'prompts':return <Prompts/>;case'tools':return <Tools/>;case'customers':return <Customers/>;case'conversations':return <Conversations/>;case'handoff':return <Handoff/>;case'usage':return <Usage/>;case'audit':return <Audit/>;default:return <Dashboard profile={profile}/>}},[page,profile])
 if(loading)return <div className="center-screen"><Spinner/></div>;if(location.hash==='#reset-password')return <AuthScreen mode="reset-password" onDone={()=>navigate('dashboard')}/>;if(!user)return <AuthScreen mode="login" onDone={()=>undefined}/>;if(!profile&&bootstrapPossible)return <Bootstrap refresh={refresh}/>;if(!profile)return <div className="auth-page" dir="rtl"><Card className="auth-card"><h1>الحساب غير مهيأ</h1><p>المستخدم مسجل في Auth لكن لا يوجد Profile مصرح له. اطلب من Super Admin إرسال دعوة أو تعيين الدور.</p></Card></div>;return <AdminLayout profile={profile} page={page} onNavigate={navigate}>{view}</AdminLayout>}
