import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'

type AppRole='SUPER_ADMIN'|'ORGANIZATION_ADMIN'|'KNOWLEDGE_MANAGER'|'SUPPORT_AGENT'|'VIEWER'
type Action='update_user'|'set_user_active'|'delete_user'|'update_api_client'|'delete_api_client'|'update_tool'|'set_tool_active'|'delete_tool'|'update_customer'|'delete_customer'|'set_conversation_status'
interface Body{action?:Action;id?:string;organizationId?:string|null;fullName?:string;userRole?:AppRole;name?:string;rateLimitPerMinute?:number;endpointUrl?:string;method?:'GET'|'POST';authType?:string;requiresVerification?:boolean;requiresHumanApproval?:boolean;timeoutSeconds?:number;isActive?:boolean;displayName?:string|null;phone?:string|null;email?:string|null;language?:string|null;status?:'open'|'closed'}
const clean=(value:string|undefined,max=240)=>value?.trim().slice(0,max)??''

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
      const result=await admin.from('agent_tools').select('id,organization_id,name,code,is_active').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'tool_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN'])
      if(body.action==='update_tool'){
        let endpoint:URL;try{endpoint=new URL(clean(body.endpointUrl,2048))}catch{return json({success:false,error:'invalid_tool_url'},400)}if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)return json({success:false,error:'invalid_tool_url'},400)
        const update=await admin.from('agent_tools').update({name:clean(body.name)||result.data.name,method:body.method??'GET',endpoint_url:endpoint.toString(),auth_type:body.authType??'none',requires_verification:body.requiresVerification??false,requires_human_approval:body.requiresHumanApproval??false,timeout_seconds:Math.min(30,Math.max(1,Math.round(body.timeoutSeconds??10)))}).eq('id',body.id)
        if(update.error)return json({success:false,error:'tool_update_failed',detail:update.error.message},400);await audit('Update Tool','agent_tool',body.id,result.data.organization_id,{code:result.data.code});return json({success:true})
      }
      if(body.action==='set_tool_active'){
        if(typeof body.isActive!=='boolean')return json({success:false,error:'is_active_required'},400);const update=await admin.from('agent_tools').update({is_active:body.isActive}).eq('id',body.id);if(update.error)return json({success:false,error:'tool_status_failed',detail:update.error.message},400);await audit(body.isActive?'Enable Tool':'Disable Tool','agent_tool',body.id,result.data.organization_id);return json({success:true})
      }
      const executions=await admin.from('tool_executions').select('id',{count:'exact',head:true}).eq('tool_id',body.id);if((executions.count??0)>0)return json({success:false,error:'tool_has_execution_history',detail:'Disable the tool to preserve execution history.'},409)
      await audit('Delete Tool','agent_tool',body.id,result.data.organization_id,{code:result.data.code});const deleted=await admin.from('agent_tools').delete().eq('id',body.id);if(deleted.error)return json({success:false,error:'tool_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(['update_customer','delete_customer'].includes(body.action)){
      const result=await admin.from('customers').select('id,organization_id,external_customer_id').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'customer_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      if(body.action==='update_customer'){
        const update=await admin.from('customers').update({display_name:clean(body.displayName??undefined)||null,phone:clean(body.phone??undefined,80)||null,email:clean(body.email??undefined)||null,language:body.language??null}).eq('id',body.id);if(update.error)return json({success:false,error:'customer_update_failed',detail:update.error.message},400);await audit('Update Customer','customer',body.id,result.data.organization_id);return json({success:true})
      }
      const conversations=await admin.from('conversations').select('id',{count:'exact',head:true}).eq('customer_id',body.id);if((conversations.count??0)>0)return json({success:false,error:'customer_has_conversations',detail:'Customers with conversation history cannot be deleted.'},409)
      await audit('Delete Customer','customer',body.id,result.data.organization_id,{externalCustomerId:result.data.external_customer_id});const deleted=await admin.from('customers').delete().eq('id',body.id);if(deleted.error)return json({success:false,error:'customer_delete_failed',detail:deleted.error.message},400);return json({success:true})
    }

    if(body.action==='set_conversation_status'){
      const result=await admin.from('conversations').select('id,organization_id,status,human_takeover').eq('id',body.id).single();if(result.error||!result.data)return json({success:false,error:'conversation_not_found'},404);assertOrg(result.data.organization_id,['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'])
      if(!body.status||!['open','closed'].includes(body.status))return json({success:false,error:'invalid_status'},400)
      const patch=body.status==='closed'?{status:'closed',closed_at:new Date().toISOString(),human_takeover:false}:{status:'open',closed_at:null}
      const update=await admin.from('conversations').update(patch).eq('id',body.id);if(update.error)return json({success:false,error:'conversation_status_failed',detail:update.error.message},400);await audit(body.status==='closed'?'Close Conversation':'Reopen Conversation','conversation',body.id,result.data.organization_id);return json({success:true,status:body.status})
    }

    return json({success:false,error:'unsupported_action'},400)
  }catch(error){const message=error instanceof Error?error.message:'unknown_error';const status=['forbidden','organization_forbidden'].includes(message)?403:['last_super_admin','cannot_modify_own_access'].includes(message)?409:500;return json({success:false,error:message},status)}
})
