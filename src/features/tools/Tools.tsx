import { useEffect,useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { resourceAdmin } from '../../lib/resourceAdmin'
import { supabase } from '../../lib/supabase'
import { Badge, Card, Empty, FieldHint, Modal, PageHeader, PanelHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import type { Organization } from '../../types/domain'
import { ToolParameterEditor } from './ToolParameterEditor'
import { parseToolParameters,validateToolParameters,type ToolParameter } from './toolSchema'

interface Tool{id:string;organization_id:string;name:string;code:string;description:string|null;method:'GET'|'POST';endpoint_url:string;auth_type:string|null;request_schema:Record<string,unknown>;is_read_only:boolean;requires_verification:boolean;requires_human_approval:boolean;timeout_seconds:number;is_active:boolean}
type AuthType='none'|'bearer'|'api_key'|'basic'

const examplesHeader='أمثلة لعبارات العميل / Customer examples:'
const guidanceSeparator=`\n\n${examplesHeader}\n`
const cleanExamples=(value:string)=>value.split(/\r?\n/).map(item=>item.trim().replace(/^[-•]\s*/, '')).filter(Boolean).slice(0,12)
const encodeGuidance=(usage:string,examples:string)=>{
  const cleanUsage=usage.trim()
  const rows=cleanExamples(examples)
  return rows.length?`${cleanUsage}${guidanceSeparator}${rows.map(item=>`- ${item}`).join('\n')}`:cleanUsage
}
const decodeGuidance=(description:string|null)=>{
  const value=description?.trim()??''
  const marker=value.indexOf(guidanceSeparator)
  if(marker<0)return{usage:value,examples:''}
  return{usage:value.slice(0,marker).trim(),examples:value.slice(marker+guidanceSeparator.length).split(/\r?\n/).map(item=>item.trim().replace(/^[-•]\s*/, '')).filter(Boolean).join('\n')}
}

export function Tools(){
  const {tr,valueLabel}=useI18n()
  const [rows,setRows]=useState<Tool[]>([])
  const [orgs,setOrgs]=useState<Organization[]>([])
  const [msg,setMsg]=useState('')
  const [form,setForm]=useState({organization_id:'',name:'',code:'',usage:'',examples:'',method:'GET' as 'GET'|'POST',endpoint_url:'',auth_type:'none' as AuthType,credential:'',header:'X-API-Key',username:'',password:'',is_read_only:true,requires_verification:false,requires_human_approval:false})
  const [parameters,setParameters]=useState<ToolParameter[]>([])
  const [editing,setEditing]=useState<Tool|null>(null)
  const [editName,setEditName]=useState('')
  const [editUsage,setEditUsage]=useState('')
  const [editExamples,setEditExamples]=useState('')
  const [editMethod,setEditMethod]=useState<'GET'|'POST'>('GET')
  const [editUrl,setEditUrl]=useState('')
  const [editAuth,setEditAuth]=useState<AuthType>('none')
  const [editVerify,setEditVerify]=useState(false)
  const [editApproval,setEditApproval]=useState(false)
  const [editTimeout,setEditTimeout]=useState(10)
  const [editUsername,setEditUsername]=useState('')
  const [editPassword,setEditPassword]=useState('')
  const [editParameters,setEditParameters]=useState<ToolParameter[]>([])

  const load=async()=>{
    const [toolsResult,organizationsResult]=await Promise.all([
      supabase.from('agent_tools_safe').select('*').order('created_at',{ascending:false}),
      supabase.from('organizations').select('*').eq('is_active',true).order('name_ar'),
    ])
    setRows((toolsResult.data??[]) as Tool[])
    const organizationRows=(organizationsResult.data??[]) as Organization[];setOrgs(organizationRows)
    setForm(current=>current.organization_id||organizationRows.length!==1?current:{...current,organization_id:organizationRows[0].id})
  }
  useEffect(()=>{void load()},[])

  const parameterError=(code:string)=>code==='too_many_tool_parameters'?tr('الحد الأقصى 12 متغيرًا للأداة.','A tool can have at most 12 variables.')
    :code==='invalid_tool_parameter_key'?tr('اسم المتغير يجب أن يبدأ بحرف إنجليزي ويحتوي حروفًا أو أرقامًا أو underscore فقط.','Variable keys must start with an English letter and contain only letters, numbers, or underscore.')
    :code==='duplicate_tool_parameter_key'?tr('لا يمكن تكرار اسم المتغير داخل الأداة.','Variable keys must be unique within a tool.')
    :tr('اكتب اسمًا عربيًا وإنجليزيًا لكل متغير.','Provide Arabic and English labels for every variable.')
  const validateGuidance=(usage:string,examples:string)=>{
    if(!usage.trim())return tr('اكتب متى يجب على الوكيل استخدام هذه الأداة حتى يستطيع اختيار الـ endpoint الصحيح.','Describe when the agent should use this tool so it can choose the correct endpoint.')
    if(usage.trim().length>2000)return tr('وصف الاستخدام طويل جدًا. الحد الأقصى 2000 حرف.','Usage description is too long. Maximum is 2000 characters.')
    const items=cleanExamples(examples)
    if(items.some(item=>item.length>240))return tr('كل مثال يجب ألا يتجاوز 240 حرفًا.','Each example must be 240 characters or less.')
    return''
  }
  const saveGuidance=async(toolId:string,usage:string,examples:string)=>{
    const description=encodeGuidance(usage,examples)
    const {error}=await supabase.rpc('set_agent_tool_guidance',{p_tool_id:toolId,p_description:description})
    if(error)throw new Error(error.message)
  }

  const create=async(event:React.FormEvent)=>{
    event.preventDefault();setMsg('')
    const schemaError=validateToolParameters(parameters);if(schemaError){setMsg(parameterError(schemaError));return}
    const guidanceError=validateGuidance(form.usage,form.examples);if(guidanceError){setMsg(guidanceError);return}
    if(!form.is_read_only){setMsg(tr('في النسخة الحالية يجب أن تكون الأداة للقراءة فقط.','In the current MVP, tools must be read-only.'));return}
    if(form.auth_type==='basic'&&(!form.username.trim()||!form.password)){setMsg(tr('أدخل اسم المستخدم وكلمة المرور للمصادقة Basic Auth.','Enter username and password for Basic Auth.'));return}
    if(form.auth_type==='basic'&&form.username.includes(':')){setMsg(tr('اسم مستخدم Basic Auth لا يمكن أن يحتوي على نقطتين رأسيتين (:).','Basic Auth username cannot contain a colon (:).'));return}
    const toolSecret=form.auth_type==='bearer'?{token:form.credential}:form.auth_type==='api_key'?{header:form.header,value:form.credential}:form.auth_type==='basic'?{username:form.username.trim(),password:form.password}:undefined
    try{
      const created=await adminApi<{tool:{id:string}}>({action:'create_agent_tool',organizationId:form.organization_id,tool:{name:form.name,code:form.code,method:form.method,endpointUrl:form.endpoint_url,authType:form.auth_type,requestSchema:{parameters},responseSchema:{},isReadOnly:true,requiresVerification:form.requires_verification,requiresHumanApproval:form.requires_human_approval,timeoutSeconds:10},toolSecret})
      try{await saveGuidance(created.tool.id,form.usage,form.examples)}catch(error){try{await resourceAdmin({action:'delete_tool',id:created.tool.id})}catch{/* Best effort rollback for a new tool without executions. */}throw error}
      setMsg(tr('تم إنشاء الأداة وحفظ وصف الاستخدام والأمثلة والمتغيرات وبيانات الاعتماد بأمان.','Tool, routing guidance, examples, variables, and credentials were saved securely.'))
      setForm(current=>({...current,name:'',code:'',usage:'',examples:'',endpoint_url:'',credential:'',username:'',password:''}));setParameters([]);await load()
    }catch(error){setMsg(error instanceof Error?error.message:tr('تعذر إنشاء الأداة.','Unable to create tool.'))}
  }
  const openEdit=(row:Tool)=>{
    const guidance=decodeGuidance(row.description)
    setEditing(row);setEditName(row.name);setEditUsage(guidance.usage);setEditExamples(guidance.examples);setEditMethod(row.method);setEditUrl(row.endpoint_url);setEditAuth((row.auth_type??'none') as AuthType);setEditVerify(row.requires_verification);setEditApproval(row.requires_human_approval);setEditTimeout(row.timeout_seconds);setEditUsername('');setEditPassword('');setEditParameters(parseToolParameters(row.request_schema))
  }
  const save=async(e:React.FormEvent)=>{
    e.preventDefault();if(!editing)return
    const schemaError=validateToolParameters(editParameters);if(schemaError){setMsg(parameterError(schemaError));return}
    const guidanceError=validateGuidance(editUsage,editExamples);if(guidanceError){setMsg(guidanceError);return}
    try{
      if(editAuth==='basic'&&editUsername.includes(':'))throw new Error(tr('اسم مستخدم Basic Auth لا يمكن أن يحتوي على نقطتين رأسيتين (:).','Basic Auth username cannot contain a colon (:).'))
      const switchingToBasic=editAuth==='basic'&&editing.auth_type!=='basic'
      const updatingBasic=editAuth==='basic'&&(editUsername.trim().length>0||editPassword.length>0)
      if((switchingToBasic||updatingBasic)&&(!editUsername.trim()||!editPassword))throw new Error(tr('أدخل اسم المستخدم وكلمة المرور معًا لـ Basic Auth.','Provide both username and password for Basic Auth.'))
      const toolSecret=editAuth==='basic'&&(switchingToBasic||updatingBasic)?{username:editUsername.trim(),password:editPassword}:undefined
      await resourceAdmin({action:'update_tool',id:editing.id,name:editName,method:editMethod,endpointUrl:editUrl,authType:editAuth,requestSchema:{parameters:editParameters},requiresVerification:editVerify,requiresHumanApproval:editApproval,timeoutSeconds:editTimeout,toolSecret})
      await saveGuidance(editing.id,editUsage,editExamples)
      setMsg(tr('تم حفظ تعديلات الأداة ووصف الاستخدام والأمثلة.','Tool settings, routing guidance, and examples saved.'));setEditing(null);await load()
    }catch(error){setMsg(error instanceof Error?error.message:tr('تعذر تعديل الأداة.','Unable to update tool.'))}
  }
  const toggle=async(row:Tool)=>{if(row.is_active&&!confirm(tr('تعطيل الأداة يمنع الوكيل من استخدامها. متابعة؟','Disabling the tool prevents the agent from using it. Continue?')))return;try{await resourceAdmin({action:'set_tool_active',id:row.id,isActive:!row.is_active});setMsg(tr(row.is_active?'تم تعطيل الأداة.':'تم تفعيل الأداة.',row.is_active?'Tool disabled.':'Tool enabled.'));await load()}catch(error){setMsg(error instanceof Error?error.message:tr('تعذر تغيير حالة الأداة.','Unable to change tool status.'))}}
  const remove=async(row:Tool)=>{if(!confirm(tr('حذف الأداة نهائيًا؟ إذا كان لها سجل تنفيذ فسيُرفض الحذف ويجب تعطيلها بدلًا من ذلك.','Permanently delete this tool? If it has execution history, deletion will be blocked and you should disable it instead.')))return;try{await resourceAdmin({action:'delete_tool',id:row.id});setMsg(tr('تم حذف الأداة.','Tool deleted.'));await load()}catch(error){setMsg(error instanceof Error?error.message:tr('تعذر حذف الأداة.','Unable to delete tool.'))}}

  return <div className="screen screen-tools">
    <PageHeader title={tr('أدوات الوكيل','Agent Tools')} description={tr('عرّف متى تستخدم كل أداة، أعط الوكيل أمثلة لعبارات العميل، ثم حدد الـ endpoint والمتغيرات المطلوبة.','Describe when each tool applies, give the agent customer phrase examples, then define the endpoint and required variables.')}/>
    <Card className="form-panel tool-builder"><PanelHeader title={tr('تعريف أداة جديدة','Define a new tool')} description={tr('وصف الاستخدام والأمثلة هما ما يساعدان النموذج على اختيار الأداة الصحيحة عندما توجد عدة endpoints متشابهة.','Usage guidance and examples help the model choose the correct tool when several similar endpoints exist.')} meta={<Badge tone="good">{tr('قراءة فقط','Read only')}</Badge>}/><form className="tool-form" onSubmit={create}>
      <label>{tr('الجهة','Organization')}<select required value={form.organization_id} onChange={e=>setForm({...form,organization_id:e.target.value})}><option value="">{tr('اختر الجهة','Select organization')}</option>{orgs.map(org=><option key={org.id} value={org.id}>{org.name_ar} / {org.name_en??org.code}</option>)}</select></label>
      <label>{tr('اسم الأداة','Tool name')}<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
      <label className="span-2">{tr('متى يستخدم الوكيل هذه الأداة؟','When should the agent use this tool?')}<textarea required maxLength={2000} value={form.usage} onChange={e=>setForm({...form,usage:e.target.value})} placeholder={tr('مثال: تستخدم عند سؤال المريض عن موعد محجوز مسبقًا. لا تستخدم لحجز موعد جديد أو إلغاء موعد.','Example: Use when the patient asks about an existing booked appointment. Do not use for creating or cancelling appointments.')}/><FieldHint>{tr('يصل هذا الوصف إلى نموذج الذكاء مع اسم الأداة حتى يميز بينها وبين الأدوات الأخرى.','This guidance is sent to the AI with the tool name so it can distinguish it from other tools.')}</FieldHint></label>
      <label className="span-2">{tr('أمثلة لعبارات العميل','Customer phrase examples')}<textarea maxLength={3000} value={form.examples} onChange={e=>setForm({...form,examples:e.target.value})} placeholder={tr('متى موعدي؟\nاحتاج استعلم عن موعدي\nوش وقت موعدي القادم؟','When is my appointment?\nCheck my appointment\nWhat time is my next appointment?')}/><FieldHint>{tr('مثال واحد في كل سطر، بحد أقصى 12 مثالًا. يمكن المزج بين العربية والإنجليزية.','One example per line, up to 12 examples. Arabic and English may be mixed.')}</FieldHint></label>
      <label>{tr('الكود','Code')}<input required dir="ltr" value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="GET_APPLICATION_STATUS"/></label>
      <label>{tr('طريقة الطلب','Request method')}<select value={form.method} onChange={e=>setForm({...form,method:e.target.value as 'GET'|'POST'})}><option>GET</option><option>POST</option></select></label>
      <label className="tool-endpoint-field">{tr('رابط نقطة الاتصال','Endpoint URL')}<input required type="url" dir="ltr" value={form.endpoint_url} onChange={e=>setForm({...form,endpoint_url:e.target.value})} placeholder="https://api.example.com/status"/></label>
      <label>{tr('نوع المصادقة','Authentication type')}<select value={form.auth_type} onChange={e=>setForm({...form,auth_type:e.target.value as AuthType})}><option value="none">{tr('بدون مصادقة','No authentication')}</option><option value="bearer">Bearer</option><option value="api_key">API Key</option><option value="basic">Basic Auth</option></select></label>
      {form.auth_type==='api_key'&&<label>{tr('اسم ترويسة المفتاح','API key header')}<input dir="ltr" value={form.header} onChange={e=>setForm({...form,header:e.target.value})}/></label>}
      {form.auth_type==='basic'&&<><label>{tr('اسم المستخدم','Username')}<input required autoComplete="off" dir="ltr" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label className="tool-credential-field">{tr('كلمة المرور','Password')}<input required type="password" autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><FieldHint>{tr('يتم حفظ اسم المستخدم وكلمة المرور كسر واحد داخل Vault وإرسال Authorization: Basic وقت التنفيذ فقط.','Username and password are stored together in Vault and sent as Authorization: Basic only at execution time.')}</FieldHint></label></>}
      {(form.auth_type==='bearer'||form.auth_type==='api_key')&&<label className="tool-credential-field">{tr('بيانات الاعتماد','Credential')}<input required type="password" value={form.credential} onChange={e=>setForm({...form,credential:e.target.value})}/><FieldHint>{tr('تُحفظ في Vault ولا تظهر مرة أخرى.','Stored in Vault and not shown again.')}</FieldHint></label>}
      <ToolParameterEditor value={parameters} onChange={setParameters}/>
      <fieldset className="tool-policy-strip"><legend>{tr('سياسات التنفيذ','Execution policies')}</legend><label className="check-label"><span><strong>{tr('قراءة فقط','Read only')}</strong></span><input type="checkbox" checked={form.is_read_only} onChange={e=>setForm({...form,is_read_only:e.target.checked})}/></label><label className="check-label"><span><strong>{tr('تحقق العميل','Customer verification')}</strong></span><input type="checkbox" checked={form.requires_verification} onChange={e=>setForm({...form,requires_verification:e.target.checked})}/></label><label className="check-label"><span><strong>{tr('موافقة بشرية','Human approval')}</strong></span><input type="checkbox" checked={form.requires_human_approval} onChange={e=>setForm({...form,requires_human_approval:e.target.checked})}/></label></fieldset>
      <div className="form-submit-row"><button>{tr('إنشاء الأداة','Create tool')}</button></div>
    </form>{msg&&<div className="inline-feedback" role="status">{msg}</div>}</Card>

    <Card className="table-card data-panel"><PanelHeader title={tr('الأدوات المسجلة','Registered tools')} description={tr('يعتمد الوكيل على الاسم ووصف الاستخدام والأمثلة والمتغيرات لاختيار الأداة المناسبة بدون تخمين URL.','The agent uses the name, usage guidance, examples, and variables to choose the right tool without guessing a URL.')} meta={<Badge>{rows.length}</Badge>}/>{rows.length===0?<Empty>{tr('لا توجد أدوات.','No tools found.')}</Empty>:<table className="data-table"><thead><tr><th>{tr('الاسم','Name')}</th><th>{tr('الطريقة','Method')}</th><th>{tr('المتغيرات','Variables')}</th><th>{tr('نقطة الاتصال','Endpoint')}</th><th>{tr('المصادقة','Authentication')}</th><th>{tr('الحالة','Status')}</th><th className="actions-cell">{tr('الإجراءات','Actions')}</th></tr></thead><tbody>{rows.map(row=>{const parameterCount=parseToolParameters(row.request_schema).length;const guidance=decodeGuidance(row.description);return <tr key={row.id} className={row.is_active?'':'soft-disabled'}><td className="cell-primary"><div>{row.name}</div><small>{row.code}</small>{guidance.usage&&<small title={guidance.usage}>{guidance.usage.length>80?`${guidance.usage.slice(0,80)}…`:guidance.usage}</small>}</td><td><Badge>{row.method}</Badge></td><td><Badge tone={parameterCount?'good':undefined}>{parameterCount}</Badge></td><td><code>{row.endpoint_url}</code></td><td>{row.auth_type==='basic'?'Basic Auth':valueLabel(row.auth_type??'none')}</td><td><Badge tone={row.is_active?'good':'bad'}>{row.is_active?tr('نشطة','Active'):tr('متوقفة','Inactive')}</Badge></td><td className="actions-cell"><div className="row-actions"><button className="small ghost" onClick={()=>openEdit(row)}>{tr('تعديل','Edit')}</button><button className={`small ${row.is_active?'warning-action':'success-action'}`} onClick={()=>void toggle(row)}>{row.is_active?tr('تعطيل','Disable'):tr('تفعيل','Enable')}</button><button className="small danger-action" onClick={()=>void remove(row)}>{tr('حذف','Delete')}</button></div></td></tr>})}</tbody></table>}</Card>

    <Modal open={Boolean(editing)} onClose={()=>setEditing(null)} title={tr('تعديل أداة الوكيل','Edit agent tool')} description={tr('عدّل وصف الاستخدام والأمثلة والمتغيرات بدون كشف السر المحفوظ في Vault.','Edit routing guidance, examples, and variables without exposing the Vault secret.')}><form className="modal-grid" onSubmit={save}>
      <label>{tr('الاسم','Name')}<input required value={editName} onChange={e=>setEditName(e.target.value)}/></label><label>{tr('الطريقة','Method')}<select value={editMethod} onChange={e=>setEditMethod(e.target.value as 'GET'|'POST')}><option>GET</option><option>POST</option></select></label>
      <label className="span-2">{tr('متى يستخدم الوكيل هذه الأداة؟','When should the agent use this tool?')}<textarea required maxLength={2000} value={editUsage} onChange={e=>setEditUsage(e.target.value)}/></label>
      <label className="span-2">{tr('أمثلة لعبارات العميل','Customer phrase examples')}<textarea maxLength={3000} value={editExamples} onChange={e=>setEditExamples(e.target.value)}/><FieldHint>{tr('مثال واحد في كل سطر.','One example per line.')}</FieldHint></label>
      <label className="span-2">{tr('نقطة الاتصال','Endpoint URL')}<input required type="url" dir="ltr" value={editUrl} onChange={e=>setEditUrl(e.target.value)}/></label><label>{tr('المصادقة','Authentication')}<select value={editAuth} onChange={e=>setEditAuth(e.target.value as AuthType)}><option value="none">{tr('بدون','None')}</option><option value="bearer">Bearer</option><option value="api_key">API Key</option><option value="basic">Basic Auth</option></select></label><label>{tr('المهلة بالثواني','Timeout seconds')}<input type="number" min={1} max={30} value={editTimeout} onChange={e=>setEditTimeout(Number(e.target.value))}/></label>
      {editAuth==='basic'&&<><label>{tr('اسم مستخدم Basic Auth الجديد','New Basic Auth username')}<input dir="ltr" autoComplete="off" value={editUsername} onChange={e=>setEditUsername(e.target.value)} placeholder={editing?.auth_type==='basic'?tr('اتركه فارغًا للاحتفاظ بالحالي','Leave blank to keep current'):''}/></label><label>{tr('كلمة مرور Basic Auth الجديدة','New Basic Auth password')}<input type="password" autoComplete="new-password" value={editPassword} onChange={e=>setEditPassword(e.target.value)} placeholder={editing?.auth_type==='basic'?tr('اتركها فارغة للاحتفاظ بالحالية','Leave blank to keep current'):''}/></label></>}
      <ToolParameterEditor value={editParameters} onChange={setEditParameters}/>
      <label className="check-label"><span>{tr('يتطلب تحقق العميل','Requires verification')}</span><input type="checkbox" checked={editVerify} onChange={e=>setEditVerify(e.target.checked)}/></label><label className="check-label"><span>{tr('يتطلب موافقة بشرية','Requires human approval')}</span><input type="checkbox" checked={editApproval} onChange={e=>setEditApproval(e.target.checked)}/></label>
      <div className="form-actions span-2"><button>{tr('حفظ التعديلات','Save changes')}</button><button type="button" className="ghost" onClick={()=>setEditing(null)}>{tr('إلغاء','Cancel')}</button></div>
    </form></Modal>
  </div>
}
