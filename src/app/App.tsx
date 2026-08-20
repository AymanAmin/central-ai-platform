import { useEffect,useMemo,useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { AdminLayout } from '../layouts/AdminLayout'
import { signIn,signUp,resetPassword,updatePassword } from '../lib/auth'
import { adminApi } from '../lib/adminApi'
import { Dashboard } from '../features/dashboard/Dashboard'
import { SetupWizard } from '../features/setup/SetupWizard'
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
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useI18n } from '../lib/i18n'

function AuthScreen({mode,onDone}:{mode:'login'|'reset-password';onDone:()=>void}){const {tr,dir,valueLabel}=useI18n();const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{if(mode==='reset-password'){const {error}=await updatePassword(password);if(error)throw error;setMessage(tr('تم تحديث كلمة المرور.','Password updated.'));onDone()}else{const {error}=await signIn(email,password);if(error)throw error}}catch(err){setMessage(err instanceof Error?valueLabel(err.message):tr('تعذر إكمال العملية','Unable to complete the operation'))}finally{setBusy(false)}}
 const forgot=async()=>{if(!email){setMessage(tr('أدخل البريد أولًا.','Enter your email first.'));return}const {error}=await resetPassword(email);setMessage(error?.message??tr('تم إرسال رابط الاستعادة.','Password reset link sent.'))}
 return <div className="auth-page" dir={dir}><div className="auth-language"><LanguageSwitcher/></div><Card className="auth-card"><div className="brand center"><strong>Central AI</strong><span>Platform</span></div><h1>{mode==='reset-password'?tr('تعيين كلمة المرور','Set password'):tr('تسجيل الدخول','Sign in')}</h1><form className="stack" onSubmit={submit}>{mode==='login'&&<input required type="email" autoComplete="email" placeholder={tr('البريد الإلكتروني','Email address')} value={email} onChange={e=>setEmail(e.target.value)}/>}<input required type="password" minLength={8} autoComplete={mode==='login'?'current-password':'new-password'} placeholder={tr('كلمة المرور','Password')} value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>{busy?tr('جارٍ التنفيذ…','Working…'):mode==='login'?tr('دخول','Sign in'):tr('حفظ كلمة المرور','Save password')}</button></form>{mode==='login'&&<button className="link" onClick={()=>void forgot()}>{tr('نسيت كلمة المرور؟','Forgot password?')}</button>}{message&&<p>{message}</p>}</Card></div>}

function Bootstrap({refresh}:{refresh:()=>Promise<void>}){const {tr,dir}=useI18n();const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [fullName,setFullName]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 const create=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setMessage('');try{const {data,error}=await signUp(email,password);if(error)throw error;if(!data.user)throw new Error(tr('لم يتم إنشاء المستخدم.','User was not created.'));if(!data.session){setMessage(tr('تم إنشاء الحساب. إذا كان تأكيد البريد مفعّلًا، أكّد البريد ثم سجل الدخول لإكمال التهيئة.','Account created. If email confirmation is enabled, confirm the email then sign in to finish setup.'));return}await adminApi({action:'bootstrap_super_admin',fullName});await refresh()}catch(err){setMessage(err instanceof Error?err.message:tr('تعذر إنشاء المدير الأول','Unable to create the first administrator'))}finally{setBusy(false)}}
 return <div className="auth-page" dir={dir}><div className="auth-language"><LanguageSwitcher/></div><Card className="auth-card"><h1>{tr('إنشاء أول مدير عام','Create the first Super Admin')}</h1><p>{tr('تعمل هذه الشاشة مرة واحدة فقط عندما لا يوجد أي ملف مستخدم في النظام.','This screen is available only once when the system has no user profiles.')}</p><form className="stack" onSubmit={create}><input required placeholder={tr('الاسم الكامل','Full name')} value={fullName} onChange={e=>setFullName(e.target.value)}/><input required type="email" placeholder={tr('البريد الإلكتروني','Email address')} value={email} onChange={e=>setEmail(e.target.value)}/><input required minLength={8} type="password" placeholder={tr('كلمة المرور','Password')} value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>{busy?tr('جارٍ الإنشاء…','Creating…'):tr('إنشاء المدير العام','Create Super Admin')}</button></form>{message&&<p>{message}</p>}</Card></div>}

export function App(){const {tr,dir}=useI18n();const {user,profile,loading,refresh}=useAuth();const [page,setPage]=useState(()=>location.hash.replace('#','')||'dashboard');const [bootstrapPossible,setBootstrapPossible]=useState(false)
 useEffect(()=>{const handler=()=>setPage(location.hash.replace('#','')||'dashboard');addEventListener('hashchange',handler);return()=>removeEventListener('hashchange',handler)},[])
 useEffect(()=>{if(user&&!profile){void adminApi<{canBootstrap:boolean}>({action:'bootstrap_status'}).then(r=>setBootstrapPossible(r.canBootstrap)).catch(()=>setBootstrapPossible(false))}},[user,profile])
 const navigate=(p:string)=>{location.hash=p;setPage(p)};const view=useMemo(()=>{if(!profile)return null;switch(page){case'setup':return profile.role==='SUPER_ADMIN'?<SetupWizard profile={profile} onNavigate={navigate}/>:<Dashboard profile={profile}/>;case'organizations':return <Organizations profile={profile}/>;case'users':return <Users profile={profile}/>;case'api-clients':return <ApiClients profile={profile}/>;case'integration':return <IntegrationGuide/>;case'knowledge':return <Knowledge profile={profile}/>;case'playground':return <Playground profile={profile}/>;case'ai-settings':return <AiSettings profile={profile}/>;case'prompts':return <Prompts/>;case'tools':return <Tools/>;case'customers':return <Customers/>;case'conversations':return <Conversations/>;case'handoff':return <Handoff/>;case'usage':return <Usage/>;case'audit':return <Audit/>;default:return <Dashboard profile={profile}/>}},[page,profile])
 if(loading)return <div className="center-screen"><Spinner/></div>;if(location.hash==='#reset-password')return <AuthScreen mode="reset-password" onDone={()=>navigate('dashboard')}/>;if(!user)return <AuthScreen mode="login" onDone={()=>undefined}/>;if(!profile&&bootstrapPossible)return <Bootstrap refresh={refresh}/>;if(!profile)return <div className="auth-page" dir={dir}><div className="auth-language"><LanguageSwitcher/></div><Card className="auth-card"><h1>{tr('الحساب غير مهيأ','Account not configured')}</h1><p>{tr('المستخدم مسجل في نظام الدخول لكن لا يوجد ملف مستخدم مصرح له. اطلب من المدير العام إرسال دعوة أو تعيين الدور.','The user exists in authentication but has no authorized profile. Ask a Super Admin to send an invitation or assign a role.')}</p></Card></div>;return <AdminLayout profile={profile} page={page} onNavigate={navigate}>{view}</AdminLayout>}
