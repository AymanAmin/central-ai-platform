import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

type JsonObject=Record<string,unknown>
interface Body{
  mode?:'start'|'message'
  visitorId?:string
  conversationId?:string
  messageId?:string
  text?:string
  language?:string
  customer?:{firstName?:string;lastName?:string;name?:string;email?:string;phone?:string}
}

const clean=(value:string|undefined,max:number)=>value?.trim().slice(0,max)??''
const originHeaders=(origin:string)=>({
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':origin||'null',
  'access-control-allow-methods':'POST,OPTIONS',
  'access-control-allow-headers':'content-type,x-widget-key',
  'access-control-max-age':'600',
  'vary':'Origin',
  'cache-control':'no-store',
})
const send=(origin:string,payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:originHeaders(origin)})
const isObject=(value:unknown):value is JsonObject=>!!value&&typeof value==='object'&&!Array.isArray(value)

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')??''
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:originHeaders(origin)})
  if(req.method!=='POST')return send(origin,{success:false,error:'method_not_allowed'},405)
  const publicKey=clean(req.headers.get('x-widget-key')??undefined,160)
  if(!/^ai_widget_[A-Za-z0-9_-]{24,}$/.test(publicKey))return send(origin,{success:false,error:'invalid_widget_key'},401)
  if(!origin)return send(origin,{success:false,error:'widget_origin_required'},403)
  const admin=createAdminClient()
  try{
    const widgetResult=await admin.from('web_chat_widgets').select('id,organization_id,api_client_id,prompt_profile_id,knowledge_base_id,allowed_origins,is_active').eq('public_key',publicKey).maybeSingle()
    const widget=widgetResult.data
    if(widgetResult.error||!widget?.is_active)return send(origin,{success:false,error:'widget_not_found'},404)
    const allowed=Array.isArray(widget.allowed_origins)?widget.allowed_origins.filter((value):value is string=>typeof value==='string'):[]
    if(!allowed.includes(origin))return send(origin,{success:false,error:'widget_origin_not_allowed'},403)

    const body=await req.json() as Body
    const visitorId=clean(body.visitorId,160),conversationId=clean(body.conversationId,160)
    if(!visitorId||!conversationId)return send(origin,{success:false,error:'invalid_request'},400)
    const language=body.language==='en'?'en':'ar'
    const firstName=clean(body.customer?.firstName,100),lastName=clean(body.customer?.lastName,100)
    const suppliedName=clean(body.customer?.name,160)
    const displayName=suppliedName||[firstName,lastName].filter(Boolean).join(' ')
    const phone=clean(body.customer?.phone,80),email=clean(body.customer?.email,240)
    const externalCustomerId=`web:${widget.id}:${visitorId}`
    const externalConversationId=`web:${widget.id}:${conversationId}`
    const customerMetadata:JsonObject={widgetId:widget.id,sourceOrigin:origin}
    if(firstName)customerMetadata.firstName=firstName
    if(lastName)customerMetadata.lastName=lastName

    const resolveCustomer=async()=>{
      const existing=await admin.from('customers').select('id,display_name,phone,email,language,metadata').eq('organization_id',widget.organization_id).eq('external_customer_id',externalCustomerId).maybeSingle()
      if(existing.error)throw existing.error
      if(existing.data){
        const oldMetadata=isObject(existing.data.metadata)?existing.data.metadata:{}
        const update=await admin.from('customers').update({display_name:displayName||existing.data.display_name,phone:phone||existing.data.phone,email:email||existing.data.email,language,last_seen_at:new Date().toISOString(),metadata:{...oldMetadata,...customerMetadata}}).eq('id',existing.data.id)
        if(update.error)throw update.error
        return existing.data.id
      }
      const created=await admin.from('customers').insert({organization_id:widget.organization_id,external_customer_id:externalCustomerId,display_name:displayName||null,phone:phone||null,email:email||null,language,metadata:customerMetadata}).select('id').single()
      if(created.error||!created.data)throw created.error??new Error('customer_create_failed')
      return created.data.id
    }
    const resolveConversation=async(customerId:string)=>{
      const existing=await admin.from('conversations').select('id,status,human_takeover').eq('organization_id',widget.organization_id).eq('customer_id',customerId).eq('external_conversation_id',externalConversationId).maybeSingle()
      if(existing.error)throw existing.error
      if(existing.data){
        if(['closed','archived'].includes(existing.data.status)){
          const reopened=await admin.from('conversations').update({status:'open',closed_at:null,human_takeover:false,assigned_user_id:null}).eq('id',existing.data.id)
          if(reopened.error)throw reopened.error
          return{...existing.data,status:'open',human_takeover:false,existing:true}
        }
        return{...existing.data,existing:true}
      }
      const created=await admin.from('conversations').insert({organization_id:widget.organization_id,api_client_id:widget.api_client_id,customer_id:customerId,external_conversation_id:externalConversationId,channel:'website',metadata:{widgetId:widget.id,sourceOrigin:origin}}).select('id,status,human_takeover').single()
      if(created.error||!created.data)throw created.error??new Error('conversation_create_failed')
      return{...created.data,existing:false}
    }

    if(body.mode==='start'){
      const client=await admin.from('api_clients').select('is_active,rate_limit_per_minute').eq('id',widget.api_client_id).single()
      if(client.error||!client.data?.is_active)return send(origin,{success:false,error:'widget_backend_unavailable'},503)
      const rate=await admin.rpc('consume_api_rate_limit',{p_api_client_id:widget.api_client_id,p_limit:client.data.rate_limit_per_minute})
      if(rate.error)throw rate.error
      if(!rate.data)return send(origin,{success:false,error:'rate_limit_exceeded'},429)
      const customerId=await resolveCustomer();const conversation=await resolveConversation(customerId)
      return send(origin,{success:true,conversationId,status:conversation.status,existing:conversation.existing})
    }

    const messageId=clean(body.messageId,160),text=clean(body.text,4000)
    if(!messageId||!text)return send(origin,{success:false,error:'invalid_request'},400)
    const customerId=await resolveCustomer()
    const existingConversation=await resolveConversation(customerId)
    const externalMessageId=`web:${widget.id}:${messageId}`
    if(existingConversation.human_takeover){
      const now=new Date().toISOString()
      const inserted=await admin.from('messages').insert({organization_id:widget.organization_id,conversation_id:existingConversation.id,external_message_id:externalMessageId,role:'user',direction:'inbound',message_type:'text',content:text,content_json:{context:{widgetId:widget.id,sourceOrigin:origin,webWidget:true}},language})
      if(inserted.error&&inserted.error.code!=='23505')return send(origin,{success:false,error:'message_store_failed',detail:inserted.error.message},400)
      await Promise.all([
        admin.from('conversations').update({last_message_at:now}).eq('id',existingConversation.id),
        admin.from('api_clients').update({last_used_at:now}).eq('id',widget.api_client_id),
      ])
      return send(origin,{success:true,conversationId:existingConversation.id,status:'waiting_for_human',answer:'',language,intent:'human_support',confidence:1,requiresHuman:true,humanHandoffReason:'manual',actions:[],voiceReply:null})
    }

    const secret=await admin.rpc('get_web_widget_api_key',{p_widget_id:widget.id})
    if(secret.error||typeof secret.data!=='string'||!secret.data.startsWith('ai_live_'))return send(origin,{success:false,error:'widget_backend_unavailable'},503)
    const customer={externalId:externalCustomerId,name:displayName||undefined,email:email||null,phone:phone||undefined,language,metadata:customerMetadata}
    const context:JsonObject={widgetId:widget.id,sourceOrigin:origin,webWidget:true}
    if(widget.prompt_profile_id)context.promptProfileId=widget.prompt_profile_id
    if(widget.knowledge_base_id)context.knowledgeBaseId=widget.knowledge_base_id
    const chatResponse=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/chat`,{
      method:'POST',
      headers:{authorization:`Bearer ${secret.data}`,'content-type':'application/json'},
      body:JSON.stringify({channel:'website',customer,conversation:{externalId:externalConversationId,metadata:{widgetId:widget.id,sourceOrigin:origin}},message:{externalId:externalMessageId,type:'text',text},context}),
      signal:AbortSignal.timeout(45000),
    })
    const payload=await chatResponse.json() as JsonObject
    if(!chatResponse.ok)return send(origin,{success:false,error:typeof payload.error==='string'?payload.error:'chat_failed'},chatResponse.status)

    let voiceReply:unknown=null
    const voiceSettings=await admin.from('organization_agents').select('voice_enabled,voice_reply_mode').eq('organization_id',widget.organization_id).maybeSingle()
    if(!voiceSettings.error&&voiceSettings.data?.voice_enabled===true&&voiceSettings.data.voice_reply_mode==='always_voice'){
      try{
        const ttsResponse=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/tts-reply`,{method:'POST',headers:{authorization:`Bearer ${secret.data}`,'content-type':'application/json'},body:JSON.stringify({externalMessageId}),signal:AbortSignal.timeout(40000)})
        const ttsPayload=await ttsResponse.json().catch(()=>null) as JsonObject|null
        if(ttsResponse.ok&&ttsPayload?.generated===true)voiceReply=ttsPayload.audio??null
      }catch{/* Text reply remains available if TTS is unavailable. */}
    }
    return send(origin,{success:true,conversationId:payload.conversationId??null,status:payload.status??'completed',answer:payload.answer??'',language:payload.language??customer.language,intent:payload.intent??null,confidence:payload.confidence??null,requiresHuman:payload.requiresHuman??false,humanHandoffReason:payload.humanHandoffReason??null,actions:Array.isArray(payload.actions)?payload.actions:[],voiceReply})
  }catch(error){return send(origin,{success:false,error:'widget_chat_failed',detail:error instanceof Error?error.message:undefined},500)}
})
