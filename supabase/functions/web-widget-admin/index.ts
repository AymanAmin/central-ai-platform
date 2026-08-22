import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'

type AppRole='SUPER_ADMIN'|'ORGANIZATION_ADMIN'|'KNOWLEDGE_MANAGER'|'SUPPORT_AGENT'|'VIEWER'
type Position='bottom_right'|'bottom_left'
type Action='create'|'update'|'set_active'
type JsonObject=Record<string,unknown>
type IntakeKey='firstName'|'lastName'|'phone'|'email'|'question'
interface Body{
  action?:Action
  id?:string
  organizationId?:string
  name?:string
  promptProfileId?:string|null
  knowledgeBaseId?:string|null
  titleAr?:string
  titleEn?:string
  welcomeAr?:string
  welcomeEn?:string
  placeholderAr?:string
  placeholderEn?:string
  suggestionsAr?:string[]
  suggestionsEn?:string[]
  primaryColor?:string
  position?:Position
  allowedOrigins?:string[]
  publicTestEnabled?:boolean
  rateLimitPerMinute?:number
  intakeFields?:unknown
  isActive?:boolean
}

const intakeKeys:IntakeKey[]=['firstName','lastName','phone','email','question']
const defaultIntake=()=>Object.fromEntries(intakeKeys.map(key=>[key,{visible:true,required:false}]))
const normalizeIntake=(value:unknown)=>{
  if(value===undefined)return defaultIntake()
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_widget_intake_fields')
  const source=value as JsonObject
  const unknown=Object.keys(source).filter(key=>!intakeKeys.includes(key as IntakeKey));if(unknown.length)throw new Error('invalid_widget_intake_fields')
  const result=defaultIntake() as Record<IntakeKey,{visible:boolean;required:boolean}>
  for(const key of intakeKeys){
    const raw=source[key];if(raw===undefined)continue
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_widget_intake_fields')
    const row=raw as JsonObject
    if(row.visible!==undefined&&typeof row.visible!=='boolean')throw new Error('invalid_widget_intake_fields')
    if(row.required!==undefined&&typeof row.required!=='boolean')throw new Error('invalid_widget_intake_fields')
    const visible=row.visible===undefined?true:row.visible
    result[key]={visible,required:visible&&row.required===true}
  }
  return result
}
const clean=(value:string|undefined,max=500)=>value?.trim().slice(0,max)??''
const randomToken=(bytes=24)=>{
  const value=new Uint8Array(bytes);crypto.getRandomValues(value)
  let binary='';for(const byte of value)binary+=String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
const sha256=async(value:string)=>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
}
const normalizeOrigins=(values:string[]|undefined)=>{
  const result:string[]=[]
  for(const raw of values??[]){
    const value=raw.trim();if(!value)continue
    let url:URL;try{url=new URL(value)}catch{throw new Error('invalid_widget_origin')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid_widget_origin')
    if(!result.includes(url.origin))result.push(url.origin)
    if(result.length>20)throw new Error('too_many_widget_origins')
  }
  return result
}
const normalizeSuggestions=(values:string[]|undefined)=>{
  const result=(values??[]).map(value=>clean(value,120)).filter(Boolean)
  if(result.length>6)throw new Error('too_many_widget_suggestions')
  return result
}
const widgetCapabilities=['chat','select_prompt_profile','select_knowledge_base','use_read_tools']

Deno.serve(async(req:Request)=>{
  const cors=preflight(req);if(cors)return cors
  if(req.method!=='POST')return json({success:false,error:'method_not_allowed'},405)
  const admin=createAdminClient()
  try{
    const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({success:false,error:'unauthorized'},401)
    const userResult=await admin.auth.getUser(auth.slice(7));if(userResult.error||!userResult.data.user)return json({success:false,error:'unauthorized'},401)
    const actorResult=await admin.from('profiles').select('id,organization_id,role,is_active').eq('id',userResult.data.user.id).single()
    const actor=actorResult.data as {id:string;organization_id:string|null;role:AppRole;is_active:boolean}|null
    if(actorResult.error||!actor?.is_active||!['SUPER_ADMIN','ORGANIZATION_ADMIN'].includes(actor.role))return json({success:false,error:'forbidden'},403)
    const body=await req.json() as Body
    if(!body.action)return json({success:false,error:'action_required'},400)
    const audit=async(action:string,id:string,org:string,metadata:Record<string,unknown>={})=>{await admin.from('audit_logs').insert({organization_id:org,user_id:actor.id,action,entity_type:'web_chat_widget',entity_id:id,metadata})}
    const assertOrg=(org:string)=>{if(actor.role!=='SUPER_ADMIN'&&org!==actor.organization_id)throw new Error('organization_forbidden')}
    const validateScope=async(org:string,promptId:string|null,kbId:string|null)=>{
      if(promptId){const prompt=await admin.from('prompt_profiles').select('id').eq('id',promptId).eq('organization_id',org).eq('is_active',true).maybeSingle();if(prompt.error||!prompt.data)throw new Error('widget_prompt_not_found')}
      if(kbId){const kb=await admin.from('knowledge_bases').select('id').eq('id',kbId).eq('organization_id',org).eq('is_active',true).maybeSingle();if(kb.error||!kb.data)throw new Error('widget_knowledge_base_not_found')}
    }

    if(body.action==='create'){
      const org=body.organizationId??actor.organization_id;if(!org)return json({success:false,error:'organization_required'},400);assertOrg(org)
      const organization=await admin.from('organizations').select('id,is_active').eq('id',org).single();if(organization.error||!organization.data?.is_active)return json({success:false,error:'organization_not_found_or_inactive'},404)
      const name=clean(body.name,120);if(!name)return json({success:false,error:'widget_name_required'},400)
      const promptId=body.promptProfileId??null,kbId=body.knowledgeBaseId??null;await validateScope(org,promptId,kbId)
      const origins=normalizeOrigins(body.allowedOrigins);const suggestionsAr=normalizeSuggestions(body.suggestionsAr),suggestionsEn=normalizeSuggestions(body.suggestionsEn);const intakeFields=normalizeIntake(body.intakeFields)
      const color=clean(body.primaryColor,7)||'#167D74';if(!/^#[0-9A-Fa-f]{6}$/.test(color))return json({success:false,error:'invalid_widget_color'},400)
      const position:Position=body.position==='bottom_left'?'bottom_left':'bottom_right'
      const rate=Math.min(300,Math.max(5,Math.round(body.rateLimitPerMinute??30)))
      const widgetId=crypto.randomUUID();const publicKey=`ai_widget_${randomToken(24)}`;const internalKey=`ai_live_${randomToken(32)}`
      const apiClientId=crypto.randomUUID();const code=`WIDGET_${widgetId.replace(/-/g,'').slice(0,18).toUpperCase()}`
      const hash=await sha256(internalKey)
      const apiClient=await admin.from('api_clients').insert({id:apiClientId,organization_id:org,name:`Widget · ${name}`,code,api_key_hash:hash,api_key_prefix:internalKey.slice(0,16),is_active:true,rate_limit_per_minute:rate,capabilities:widgetCapabilities,allowed_ips:[]})
      if(apiClient.error)return json({success:false,error:'widget_api_client_create_failed',detail:apiClient.error.message},400)
      const secret=await admin.rpc('create_web_widget_api_key',{p_widget_id:widgetId,p_secret:internalKey})
      if(secret.error||typeof secret.data!=='string'){await admin.from('api_clients').delete().eq('id',apiClientId);return json({success:false,error:'widget_secret_store_failed',detail:secret.error?.message},500)}
      const row={id:widgetId,organization_id:org,api_client_id:apiClientId,prompt_profile_id:promptId,knowledge_base_id:kbId,name,public_key:publicKey,api_key_vault_ref:secret.data,title_ar:clean(body.titleAr,120)||'المساعد الذكي',title_en:clean(body.titleEn,120)||'AI Assistant',welcome_ar:clean(body.welcomeAr,600)||'مرحبًا، كيف يمكنني مساعدتك؟',welcome_en:clean(body.welcomeEn,600)||'Hello, how can I help you?',placeholder_ar:clean(body.placeholderAr,120)||'اكتب رسالتك…',placeholder_en:clean(body.placeholderEn,120)||'Type your message…',suggestions_ar:suggestionsAr,suggestions_en:suggestionsEn,primary_color:color,position,allowed_origins:origins,public_test_enabled:body.publicTestEnabled===true,intake_fields:intakeFields,is_active:true,created_by:actor.id}
      const created=await admin.from('web_chat_widgets').insert(row).select('id,public_key').single()
      if(created.error){await admin.rpc('delete_web_widget_api_key',{p_ref:secret.data});await admin.from('api_clients').delete().eq('id',apiClientId);return json({success:false,error:'widget_create_failed',detail:created.error.message},400)}
      await audit('Create Web Chat Widget',widgetId,org,{apiClientId,promptProfileId:promptId,knowledgeBaseId:kbId,publicTestEnabled:row.public_test_enabled,intakeFields})
      return json({success:true,id:widgetId,publicKey})
    }

    if(!body.id)return json({success:false,error:'id_required'},400)
    const existingResult=await admin.from('web_chat_widgets').select('*').eq('id',body.id).single();const existing=existingResult.data
    if(existingResult.error||!existing)return json({success:false,error:'widget_not_found'},404)
    assertOrg(existing.organization_id)

    if(body.action==='set_active'){
      if(typeof body.isActive!=='boolean')return json({success:false,error:'is_active_required'},400)
      const [widgetUpdate,clientUpdate]=await Promise.all([admin.from('web_chat_widgets').update({is_active:body.isActive}).eq('id',body.id),admin.from('api_clients').update({is_active:body.isActive}).eq('id',existing.api_client_id)])
      if(widgetUpdate.error||clientUpdate.error)return json({success:false,error:'widget_status_failed',detail:widgetUpdate.error?.message??clientUpdate.error?.message},400)
      await audit(body.isActive?'Enable Web Chat Widget':'Disable Web Chat Widget',body.id,existing.organization_id)
      return json({success:true,isActive:body.isActive})
    }

    if(body.action==='update'){
      const promptId=body.promptProfileId===undefined?existing.prompt_profile_id:body.promptProfileId
      const kbId=body.knowledgeBaseId===undefined?existing.knowledge_base_id:body.knowledgeBaseId
      await validateScope(existing.organization_id,promptId,kbId)
      const origins=body.allowedOrigins===undefined?existing.allowed_origins:normalizeOrigins(body.allowedOrigins)
      const suggestionsAr=body.suggestionsAr===undefined?existing.suggestions_ar:normalizeSuggestions(body.suggestionsAr)
      const suggestionsEn=body.suggestionsEn===undefined?existing.suggestions_en:normalizeSuggestions(body.suggestionsEn)
      const intakeFields=body.intakeFields===undefined?normalizeIntake(existing.intake_fields):normalizeIntake(body.intakeFields)
      const color=body.primaryColor===undefined?existing.primary_color:clean(body.primaryColor,7);if(!/^#[0-9A-Fa-f]{6}$/.test(color))return json({success:false,error:'invalid_widget_color'},400)
      const name=body.name===undefined?existing.name:clean(body.name,120);if(!name)return json({success:false,error:'widget_name_required'},400)
      const patch={name,prompt_profile_id:promptId,knowledge_base_id:kbId,title_ar:body.titleAr===undefined?existing.title_ar:clean(body.titleAr,120),title_en:body.titleEn===undefined?existing.title_en:clean(body.titleEn,120),welcome_ar:body.welcomeAr===undefined?existing.welcome_ar:clean(body.welcomeAr,600),welcome_en:body.welcomeEn===undefined?existing.welcome_en:clean(body.welcomeEn,600),placeholder_ar:body.placeholderAr===undefined?existing.placeholder_ar:clean(body.placeholderAr,120),placeholder_en:body.placeholderEn===undefined?existing.placeholder_en:clean(body.placeholderEn,120),suggestions_ar:suggestionsAr,suggestions_en:suggestionsEn,primary_color:color,position:body.position??existing.position,allowed_origins:origins,public_test_enabled:body.publicTestEnabled??existing.public_test_enabled,intake_fields:intakeFields}
      const rate=body.rateLimitPerMinute===undefined?null:Math.min(300,Math.max(5,Math.round(body.rateLimitPerMinute)))
      const widgetUpdate=await admin.from('web_chat_widgets').update(patch).eq('id',body.id);if(widgetUpdate.error)return json({success:false,error:'widget_update_failed',detail:widgetUpdate.error.message},400)
      const client=await admin.from('api_clients').select('capabilities').eq('id',existing.api_client_id).single()
      if(client.error)return json({success:false,error:'widget_api_client_update_failed',detail:client.error.message},400)
      const currentCapabilities=Array.isArray(client.data?.capabilities)?client.data.capabilities.filter((value):value is string=>typeof value==='string'):[]
      const clientPatch:Record<string,unknown>={name:`Widget · ${name}`,capabilities:[...new Set([...currentCapabilities,...widgetCapabilities])]};if(rate!==null)clientPatch.rate_limit_per_minute=rate
      const clientUpdate=await admin.from('api_clients').update(clientPatch).eq('id',existing.api_client_id);if(clientUpdate.error)return json({success:false,error:'widget_api_client_update_failed',detail:clientUpdate.error.message},400)
      await audit('Update Web Chat Widget',body.id,existing.organization_id,{promptProfileId:promptId,knowledgeBaseId:kbId,publicTestEnabled:patch.public_test_enabled,intakeFields})
      return json({success:true})
    }

    return json({success:false,error:'unsupported_action'},400)
  }catch(error){const message=error instanceof Error?error.message:'unknown_error';const status=['forbidden','organization_forbidden'].includes(message)?403:['widget_prompt_not_found','widget_knowledge_base_not_found'].includes(message)?404:400;return json({success:false,error:message},status)}
})
