import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'
import { normalizeToolRequestSchema } from '../_shared/tool-schema.ts'

type AppRole='SUPER_ADMIN'|'ORGANIZATION_ADMIN'|'KNOWLEDGE_MANAGER'|'SUPPORT_AGENT'|'VIEWER'
type ConversationStatus='open'|'waiting_customer'|'waiting_human'|'human_assigned'|'closed'|'archived'
type HandoffReason='customer_requested'|'low_confidence'|'complaint'|'payment_issue'|'sensitive_request'|'tool_failed'|'manual'|'policy'
type Action='update_user'|'set_user_active'|'delete_user'|'update_api_client'|'delete_api_client'|'update_tool'|'set_tool_active'|'delete_tool'|'update_customer'|'delete_customer'|'set_conversation_status'|'request_handoff'|'take_conversation'|'resume_ai'|'claim_handoff'|'resolve_handoff'|'cancel_handoff'
type ToolAuth='none'|'bearer'|'api_key'|'basic'
interface Body{action?:Action;id?:string;organizationId?:string|null;fullName?:string;userRole?:AppRole;name?:string;rateLimitPerMinute?:number;endpointUrl?:string;method?:'GET'|'POST';authType?:ToolAuth;toolSecret?:Record<string,unknown>;requestSchema?:Record<string,unknown>;requiresVerification?:boolean;requiresHumanApproval?:boolean;timeoutSeconds?:number;isActive?:boolean;displayName?:string|null;phone?:string|null;email?:string|null;language?:string|null;status?:ConversationStatus;reason?:HandoffReason;notes?:string}
const clean=(value:string|undefined,max=240)=>value?.trim().slice(0,max)??''
const validToolSecret=(authType:ToolAuth,secret:Record<string,unknown>|undefined)=>{
  if(authType==='none')return true
  if(!secret)return false
  if(authType==='bearer')return typeof secret.token==='string'&&secret.token.length>0&&secret.token.length<=4096
  if(authType==='api_key')return typeof secret.header==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(secret.header)&&typeof secret.value==='string'&&secret.value.length>0&&secret.value.length<=4096
  return typeof secret.username==='string'&&secret.username.length>0&&secret.username.length<=256&&!secret.username.includes(':')&&typeof secret.password==='string'&&secret.password.length>0&&secret.password.length<=2048
}
const handoffReasons:HandoffReason[]=['customer_requested','low_confidence','complaint','payment_issue','sensitive_request','tool_failed','manual','policy']
const activeHandoffStatuses=['waiting','assigned']

Deno.serve(async(req:Request)=>{
  const cors=preflight(req);if(cors)return cors
  if(req.method!=='POST')return json({success:false,error:'method_not_allowed'},405)
  const admin=createAdminClient()
  try{
    const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({success:false,error:'unauthorized'},401)
    const userResult=await admin.auth.getUser(auth.slice(7));if(userResult.error||!userResult.data.user)return json({success:false,error:'unauthorized'},401)
    const actorResult=await admin.from('profiles').select('id,organization_id,role,is_active').eq('id',userResult.data.user.id).single()
    const actor=actorResult.data as {id:string;organization_id:string|null;role:AppRole;is_active:boolean}|null
    if(actorResult.error||!actor?.is_active||actor.role==='VIEWER')return json({success:false,error:'forbidden'},403)
    const body=await req.json() as Body;if(!body.action||!body.id)return json({success:false,error:'action_and_id_required'},400)
    const allowed=(roles:AppRole[])=>roles.includes(actor.role)
    const assertOrg=(org:string|null,roles:AppRole[])=>{if(!allowed(roles))throw new Error('forbidden');if(actor.role!=='SUPER_ADMIN'&&org!==actor.organization_id)throw new Error('organization_forbidden')}
    const audit=async(action:string,type:string,id:string,org:string|null,metadata:Record<string,unknown>={})=>{await admin.from('audit_logs').insert({organization_id:org,user_id:actor.id,action,entity_type:type,entity_id:id,metadata})}

    if(['update_user','set_user_active','delete_user'].includes(body.action)){
      if(!allowed(['SUPER_ADMIN','ORGANIZATION_ADMIN']))return json({success:false,error:'forbidden'},403)
      const result=await admin.from('profiles').select('id,organization_id,role,full_name,email,is_active').eq('id',body.id).single();const target=result.data as {id:string;organization_id:string|null;role:AppRole;full_name:string;email:string;is_active:boolean}|null
      if(result.error||!target)return json({success:false,error:'user_not_found'},404)
      if(actor.role!=='SUPER_ADMIN'&&(target.organization_id!==actor.organization_id||target.role==='SUPER_ADMIN'))return json({success:false,error:'forbidden'},403)
      const protectLastSuper=async()=>{if(target.role!=='SUPER_ADMIN')return;const count=await admin.from('profiles').select('id',{count:'exact',head:true}).eq('role','SUPER_ADMIN').eq('is_active',true);if((count.count??0)<=1)throw new Error('last_super_admin')}
      if(body.action==='update_user'){
        const nextRole=body.userRole??target.role;if(actor.role!=='SUPER_ADMIN'&&nextRole==='SUPER_ADMIN')return json({success:false,error:'forbidden'},403)
        if(target.role==='SUPER_ADMIN'&&nextRole!=='SUPER_ADMIN')await protectLastSuper()
        const nextOrg=nextRole==='SUPER_ADMIN'?null:(actor.role==='SUPER_ADMIN'?(body.organizationId??target.organization_id):actor.organization_id)
        if(nextRole!=='SUPER_ADMIN'&&!nextOrg)return json({success:false,error:'organization_required'},400)
        const update=await admin.from('profiles').update({full_name:clean(body.fullName)||target.full_name,role:nextRole,organization_id:nextOrg}).eq('id',body.id)
        if(update.error)return json({success:false,error:'user_update_failed',detail:update.error.message},400)
        await audit('Update User','profile',body.id,nextOrg,{role:nextRole});return json({success:true})
      }
      if(body.id===actor.id)return json({success:false,error:'cannot_modify_own_access'},409)
      if(body.action==='set_user_active'){
        if(typeof body.isActive!=='boolean')return json({success:false,error:'is_active_required'},400);if(!body.isActive)await protectLastSuper()
        const update=await admin.from('profiles').update({is_active:body.isActive}).eq('id',body.id);if(update.error)return json({success:false,error:'user_status_failed',detail:update.error.message},400)
        await audit(body.isActive?'Enable User':'Disable User','profile',body.id,target.organization_id,{email:target.email});return json({success:true,isActive:body.isActive})
      }
      await protectLastSuper();await audit('Delete User','profile',body.id,target.organization_id,{email:target.email});const deleted=await admin.auth.admin.deleteUser(body.id);if(deleted.error)return json({success:false,error:'user_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(['update_api_client','delete_api_client'].includes(body.action)){
      const result=await admin.from('api_clients').select('id,organization_id,name,code').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'api_client_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN'])
      if(body.action==='update_api_client'){
        const rate=Math.min(10000,Math.max(1,Math.round(body.rateLimitPerMinute??60)));const update=await admin.from('api_clients').update({name:clean(body.name)||result.data.name,rate_limit_per_minute:rate}).eq('id',body.id);if(update.error)return json({success:false,error:'api_client_update_failed',detail:update.error.message},400);await audit('Update API Client','api_client',body.id,result.data.organization_id,{rate});return json({success:true})
      }
      await audit('Delete API Client','api_client',body.id,result.data.organization_id,{code:result.data.code});const deleted=await admin.from('api_clients').delete().eq('id',body.id);if(deleted.error)return json({success:false,error:'api_client_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(['update_tool','set_tool_active','delete_tool'].includes(body.action)){
      const result=await admin.from('agent_tools').select('id,organization_id,name,code,is_active,method,endpoint_url,auth_type,request_schema,requires_verification,requires_human_approval,timeout_seconds').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'tool_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN'])
      if(body.action==='update_tool'){
        let endpoint:URL;try{endpoint=new URL(clean(body.endpointUrl,2048))}catch{return json({success:false,error:'invalid_tool_url'},400)}if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)return json({success:false,error:'invalid_tool_url'},400)
        const previousAuth=(result.data.auth_type??'none') as ToolAuth;const nextAuth=body.authType??previousAuth
        if(!['none','bearer','api_key','basic'].includes(nextAuth))return json({success:false,error:'unsupported_tool_auth_type'},400)
        const changingAuth=nextAuth!==previousAuth
        if(changingAuth&&nextAuth!=='none'&&!body.toolSecret)return json({success:false,error:'tool_credentials_required_for_auth_change'},400)
        if(body.toolSecret&&!validToolSecret(nextAuth,body.toolSecret))return json({success:false,error:'invalid_tool_credentials'},400)
        let requestSchema
        try{requestSchema=body.requestSchema===undefined?normalizeToolRequestSchema(result.data.request_schema):normalizeToolRequestSchema(body.requestSchema)}catch(error){return json({success:false,error:error instanceof Error?error.message:'invalid_tool_request_schema'},400)}
        const next={name:clean(body.name)||result.data.name,method:body.method??result.data.method,endpoint_url:endpoint.toString(),auth_type:nextAuth,request_schema:requestSchema,requires_verification:body.requiresVerification??result.data.requires_verification,requires_human_approval:body.requiresHumanApproval??result.data.requires_human_approval,timeout_seconds:Math.min(30,Math.max(1,Math.round(body.timeoutSeconds??result.data.timeout_seconds)))}
        const update=await admin.from('agent_tools').update(next).eq('id',body.id);if(update.error)return json({success:false,error:'tool_update_failed',detail:update.error.message},400)
        if(body.toolSecret&&nextAuth!=='none'){
          const stored=await admin.rpc('set_agent_tool_secret',{p_tool_id:body.id,p_secret:body.toolSecret})
          if(stored.error){await admin.from('agent_tools').update({name:result.data.name,method:result.data.method,endpoint_url:result.data.endpoint_url,auth_type:result.data.auth_type,request_schema:result.data.request_schema,requires_verification:result.data.requires_verification,requires_human_approval:result.data.requires_human_approval,timeout_seconds:result.data.timeout_seconds}).eq('id',body.id);return json({success:false,error:'tool_secret_store_failed',detail:stored.error.message},500)}
        }
        await audit('Update Tool','agent_tool',body.id,result.data.organization_id,{code:result.data.code,authType:nextAuth,credentialsUpdated:Boolean(body.toolSecret),parameterCount:requestSchema.parameters.length});return json({success:true})
      }
      if(body.action==='set_tool_active'){
        if(typeof body.isActive!=='boolean')return json({success:false,error:'is_active_required'},400);const update=await admin.from('agent_tools').update({is_active:body.isActive}).eq('id',body.id);if(update.error)return json({success:false,error:'tool_status_failed',detail:update.error.message},400);await audit(body.isActive?'Enable Tool':'Disable Tool','agent_tool',body.id,result.data.organization_id);return json({success:true})
      }
      const executions=await admin.from('tool_executions').select('id',{count:'exact',head:true}).eq('tool_id',body.id);if((executions.count??0)>0)return json({success:false,error:'tool_has_execution_history',detail:'Disable the tool to preserve execution history.'},409)
      await audit('Delete Tool','agent_tool',body.id,result.data.organization_id,{code:result.data.code});const deleted=await admin.from('agent_tools').delete().eq('id',body.id);if(deleted.error)return json({success:false,error:'api_client_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(['update_customer','delete_customer'].includes(body.action)){
      const result=await admin.from('customers').select('id,organization_id,external_customer_id').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'customer_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      if(body.action==='update_customer'){
        const update=await admin.from('customers').update({display_name:clean(body.displayName??undefined)||null,phone:clean(body.phone??undefined,80)||null,email:clean(body.email??undefined)||null,language:body.language??null}).eq('id',body.id);if(update.error)return json({success:false,error:'customer_update_failed',detail:update.error.message},400);await audit('Update Customer','customer',body.id,result.data.organization_id);return json({success:true})
      }
      const conversations=await admin.from('conversations').select('id',{count:'exact',head:true}).eq('customer_id',body.id);if((conversations.count??0)>0)return json({success:false,error:'customer_has_conversations',detail:'Customers with conversation history cannot be deleted.'},409)
      await audit('Delete Customer','customer',body.id,result.data.organization_id,{externalCustomerId:result.data.external_customer_id});const deleted=await admin.from('customers').delete().eq('id',body.id);if(deleted.error)return json({success:false,error:'customer_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(['request_handoff','take_conversation','resume_ai'].includes(body.action)){
      const result=await admin.from('conversations').select('id,organization_id,status,human_takeover,assigned_user_id').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'conversation_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      if(['closed','archived'].includes(result.data.status))return json({success:false,error:'conversation_not_active'},409)
      const now=new Date().toISOString()
      if(body.action==='request_handoff'){
        const reason=body.reason??'manual';if(!handoffReasons.includes(reason))return json({success:false,error:'invalid_handoff_reason'},400)
        const active=await admin.from('handoff_requests').select('id,status').eq('conversation_id',body.id).in('status',activeHandoffStatuses).limit(1)
        if(active.error)return json({success:false,error:'handoff_lookup_failed',detail:active.error.message},400)
        const existing=active.data?.[0]
        if(!existing){const created=await admin.from('handoff_requests').insert({organization_id:result.data.organization_id,conversation_id:body.id,reason,requested_by:actor.id,status:'waiting',notes:clean(body.notes,1000)||null});if(created.error)return json({success:false,error:'handoff_create_failed',detail:created.error.message},400)}
        if(!existing||existing.status==='waiting'){const update=await admin.from('conversations').update({human_takeover:true,status:'waiting_human',assigned_user_id:null}).eq('id',body.id);if(update.error)return json({success:false,error:'conversation_handoff_failed',detail:update.error.message},400)}
        await audit('Request Human Handoff','conversation',body.id,result.data.organization_id,{reason,reused:Boolean(existing)});return json({success:true,status:existing?.status??'waiting'})
      }
      if(body.action==='take_conversation'){
        const active=await admin.from('handoff_requests').select('id,status').eq('conversation_id',body.id).in('status',activeHandoffStatuses).limit(1);if(active.error)return json({success:false,error:'handoff_lookup_failed',detail:active.error.message},400)
        const existing=active.data?.[0]
        if(existing){const assigned=await admin.from('handoff_requests').update({status:'assigned',assigned_user_id:actor.id,assigned_at:now}).eq('id',existing.id);if(assigned.error)return json({success:false,error:'handoff_assign_failed',detail:assigned.error.message},400)}
        else{const created=await admin.from('handoff_requests').insert({organization_id:result.data.organization_id,conversation_id:body.id,reason:'manual',requested_by:actor.id,status:'assigned',assigned_user_id:actor.id,assigned_at:now});if(created.error)return json({success:false,error:'handoff_create_failed',detail:created.error.message},400)}
        const update=await admin.from('conversations').update({human_takeover:true,status:'human_assigned',assigned_user_id:actor.id,closed_at:null}).eq('id',body.id);if(update.error)return json({success:false,error:'conversation_takeover_failed',detail:update.error.message},400)
        await audit('Human Takeover','conversation',body.id,result.data.organization_id);return json({success:true,status:'human_assigned'})
      }
      const resolved=await admin.from('handoff_requests').update({status:'resolved',resolved_at:now}).eq('conversation_id',body.id).in('status',activeHandoffStatuses);if(resolved.error)return json({success:false,error:'handoff_resolve_failed',detail:resolved.error.message},400)
      const update=await admin.from('conversations').update({human_takeover:false,status:'open',assigned_user_id:null,closed_at:null}).eq('id',body.id);if(update.error)return json({success:false,error:'conversation_resume_failed',detail:update.error.message},400)
      await audit('Resume AI','conversation',body.id,result.data.organization_id);return json({success:true,status:'open'})
    }

    if(['claim_handoff','resolve_handoff','cancel_handoff'].includes(body.action)){
      const result=await admin.from('handoff_requests').select('id,organization_id,conversation_id,status,assigned_user_id').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'handoff_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      const now=new Date().toISOString()
      if(body.action==='claim_handoff'){
        if(result.data.status==='assigned'&&result.data.assigned_user_id===actor.id)return json({success:true,status:'assigned'})
        if(result.data.status!=='waiting')return json({success:false,error:'handoff_not_waiting'},409)
        const request=await admin.from('handoff_requests').update({status:'assigned',assigned_user_id:actor.id,assigned_at:now}).eq('id',body.id).eq('status','waiting');if(request.error)return json({success:false,error:'handoff_assign_failed',detail:request.error.message},400)
        const conversation=await admin.from('conversations').update({human_takeover:true,status:'human_assigned',assigned_user_id:actor.id}).eq('id',result.data.conversation_id);if(conversation.error)return json({success:false,error:'conversation_takeover_failed',detail:conversation.error.message},400)
        await audit('Claim Handoff','handoff_request',body.id,result.data.organization_id,{conversationId:result.data.conversation_id});return json({success:true,status:'assigned'})
      }
      if(!activeHandoffStatuses.includes(result.data.status))return json({success:false,error:'handoff_not_active'},409)
      const nextStatus=body.action==='resolve_handoff'?'resolved':'cancelled'
      const request=await admin.from('handoff_requests').update({status:nextStatus,resolved_at:now}).eq('id',body.id);if(request.error)return json({success:false,error:'handoff_update_failed',detail:request.error.message},400)
      const conversation=await admin.from('conversations').update({human_takeover:false,status:'open',assigned_user_id:null,closed_at:null}).eq('id',result.data.conversation_id);if(conversation.error)return json({success:false,error:'conversation_resume_failed',detail:conversation.error.message},400)
      await audit(body.action==='resolve_handoff'?'Resolve Handoff':'Cancel Handoff','handoff_request',body.id,result.data.organization_id,{conversationId:result.data.conversation_id});return json({success:true,status:nextStatus})
    }

    if(body.action==='set_conversation_status'){
      const result=await admin.from('conversations').select('id,organization_id,status,human_takeover').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'conversation_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      if(!body.status||!['open','waiting_customer','closed','archived'].includes(body.status))return json({success:false,error:'invalid_status'},400)
      const now=new Date().toISOString();const terminal=['closed','archived'].includes(body.status)
      const patch={status:body.status,closed_at:terminal?now:null,human_takeover:false,assigned_user_id:null}
      const update=await admin.from('conversations').update(patch).eq('id',body.id);if(update.error)return json({success:false,error:'conversation_status_failed',detail:update.error.message},400)
      const resolved=await admin.from('handoff_requests').update({status:'resolved',resolved_at:now}).eq('conversation_id',body.id).in('status',activeHandoffStatuses);if(resolved.error)return json({success:false,error:'handoff_resolve_failed',detail:resolved.error.message},400)
      const actionName=body.status==='closed'?'Close Conversation':body.status==='archived'?'Archive Conversation':body.status==='waiting_customer'?'Wait For Customer':'Reopen Conversation'
      await audit(actionName,'conversation',body.id,result.data.organization_id);return json({success:true,status:body.status})
    }

    return json({success:false,error:'unsupported_action'},400)
  }catch(error){const message=error instanceof Error?error.message:'unknown_error';const status=['forbidden','organization_forbidden'].includes(message)?403:['last_super_admin','cannot_modify_own_access'].includes(message)?409:500;return json({success:false,error:message},status)}
})
