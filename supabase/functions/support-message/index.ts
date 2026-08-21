import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json, preflight } from '../_shared/runtime.ts'

type AppRole='SUPER_ADMIN'|'ORGANIZATION_ADMIN'|'KNOWLEDGE_MANAGER'|'SUPPORT_AGENT'|'VIEWER'
interface Body{conversationId?:string;text?:string}
const clean=(value:string|undefined,max:number)=>value?.trim().slice(0,max)??''

Deno.serve(async(req:Request)=>{
  const cors=preflight(req);if(cors)return cors
  if(req.method!=='POST')return json({success:false,error:'method_not_allowed'},405)
  const admin=createAdminClient()
  try{
    const auth=req.headers.get('authorization')
    if(!auth?.startsWith('Bearer '))return json({success:false,error:'unauthorized'},401)
    const userResult=await admin.auth.getUser(auth.slice(7))
    if(userResult.error||!userResult.data.user)return json({success:false,error:'unauthorized'},401)
    const actorResult=await admin.from('profiles').select('id,organization_id,role,is_active,full_name').eq('id',userResult.data.user.id).single()
    const actor=actorResult.data as {id:string;organization_id:string|null;role:AppRole;is_active:boolean;full_name:string}|null
    if(actorResult.error||!actor?.is_active||!['SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'].includes(actor.role))return json({success:false,error:'forbidden'},403)

    const body=await req.json() as Body
    const conversationId=clean(body.conversationId,80),text=clean(body.text,4000)
    if(!conversationId||!text)return json({success:false,error:'conversation_and_text_required'},400)

    const conversationResult=await admin.from('conversations').select('id,organization_id,status,human_takeover,assigned_user_id').eq('id',conversationId).single()
    const conversation=conversationResult.data
    if(conversationResult.error||!conversation)return json({success:false,error:'conversation_not_found'},404)
    if(actor.role!=='SUPER_ADMIN'&&conversation.organization_id!==actor.organization_id)return json({success:false,error:'organization_forbidden'},403)
    if(!conversation.human_takeover||conversation.status!=='human_assigned'||!conversation.assigned_user_id)return json({success:false,error:'conversation_not_assigned'},409)
    if(actor.role==='SUPPORT_AGENT'&&conversation.assigned_user_id!==actor.id)return json({success:false,error:'conversation_assigned_to_another_agent'},403)

    const now=new Date().toISOString()
    const inserted=await admin.from('messages').insert({
      organization_id:conversation.organization_id,
      conversation_id:conversation.id,
      role:'assistant',
      direction:'outbound',
      message_type:'text',
      content:text,
      content_json:{source:'human',agentId:actor.id,agentName:actor.full_name},
      requires_human:false,
      provider:'human',
      model:'support-agent',
    }).select('id,created_at').single()
    if(inserted.error||!inserted.data)return json({success:false,error:'support_message_failed',detail:inserted.error?.message},400)

    const updated=await admin.from('conversations').update({last_message_at:now}).eq('id',conversation.id)
    if(updated.error)return json({success:false,error:'conversation_update_failed',detail:updated.error.message},400)
    await admin.from('audit_logs').insert({organization_id:conversation.organization_id,user_id:actor.id,action:'Send Human Reply',entity_type:'conversation',entity_id:conversation.id,metadata:{messageId:inserted.data.id}})
    return json({success:true,messageId:inserted.data.id,createdAt:inserted.data.created_at})
  }catch(error){return json({success:false,error:error instanceof Error?error.message:'support_message_failed'},500)}
})
