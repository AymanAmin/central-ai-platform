import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'
import { generateVoiceReplyForExternalMessage } from '../_shared/tts.ts'

type JsonObject=Record<string,unknown>
interface Body{
  visitorId?:string
  conversationId?:string
  messageId?:string
  text?:string
  language?:string
  customer?:{name?:string;email?:string;phone?:string}
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
    const visitorId=clean(body.visitorId,160),conversationId=clean(body.conversationId,160),messageId=clean(body.messageId,160),text=clean(body.text,4000)
    if(!visitorId||!conversationId||!messageId||!text)return send(origin,{success:false,error:'invalid_request'},400)

    const language=body.language==='en'?'en':'ar'
    const externalCustomerId=`web:${widget.id}:${visitorId}`
    const externalConversationId=`web:${widget.id}:${conversationId}`
    const externalMessageId=`web:${widget.id}:${messageId}`
    const existingCustomer=await admin.from('customers').select('id').eq('organization_id',widget.organization_id).eq('external_customer_id',externalCustomerId).maybeSingle()
    if(existingCustomer.error)return send(origin,{success:false,error:'customer_lookup_failed'},500)
    if(existingCustomer.data){
      const existingConversation=await admin.from('conversations').select('id,status,human_takeover').eq('organization_id',widget.organization_id).eq('customer_id',existingCustomer.data.id).eq('external_conversation_id',externalConversationId).maybeSingle()
      if(existingConversation.error)return send(origin,{success:false,error:'conversation_lookup_failed'},500)
      if(existingConversation.data&&['closed','archived'].includes(existingConversation.data.status)){
        await admin.from('conversations').update({status:'open',closed_at:null,human_takeover:false,assigned_user_id:null}).eq('id',existingConversation.data.id)
      }else if(existingConversation.data?.human_takeover){
        const now=new Date().toISOString()
        const inserted=await admin.from('messages').insert({organization_id:widget.organization_id,conversation_id:existingConversation.data.id,external_message_id:externalMessageId,role:'user',direction:'inbound',message_type:'text',content:text,content_json:{context:{widgetId:widget.id,sourceOrigin:origin,webWidget:true}},language})
        if(inserted.error&&inserted.error.code!=='23505')return send(origin,{success:false,error:'message_store_failed',detail:inserted.error.message},400)
        await Promise.all([
          admin.from('conversations').update({last_message_at:now}).eq('id',existingConversation.data.id),
          admin.from('customers').update({display_name:clean(body.customer?.name,160)||undefined,email:clean(body.customer?.email,240)||undefined,phone:clean(body.customer?.phone,80)||undefined,language,last_seen_at:now}).eq('id',existingCustomer.data.id),
          admin.from('api_clients').update({last_used_at:now}).eq('id',widget.api_client_id),
        ])
        return send(origin,{success:true,conversationId:existingConversation.data.id,status:'waiting_for_human',answer:'',language,intent:'human_support',confidence:1,requiresHuman:true,humanHandoffReason:'manual',actions:[]})
      }
    }

    const secret=await admin.rpc('get_web_widget_api_key',{p_widget_id:widget.id})
    if(secret.error||typeof secret.data!=='string'||!secret.data.startsWith('ai_live_'))return send(origin,{success:false,error:'widget_backend_unavailable'},503)
    const customer={externalId:externalCustomerId,name:clean(body.customer?.name,160)||undefined,email:clean(body.customer?.email,240)||null,phone:clean(body.customer?.phone,80)||undefined,language,metadata:{widgetId:widget.id,sourceOrigin:origin}}
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
    EdgeRuntime.waitUntil(generateVoiceReplyForExternalMessage(admin,widget.organization_id,externalMessageId,false,language).catch(error=>console.error('tts_background_failed',error instanceof Error?error.message:error)))
    return send(origin,{success:true,conversationId:payload.conversationId??null,status:payload.status??'completed',answer:payload.answer??'',language:payload.language??customer.language,intent:payload.intent??null,confidence:payload.confidence??null,requiresHuman:payload.requiresHuman??false,humanHandoffReason:payload.humanHandoffReason??null,actions:Array.isArray(payload.actions)?payload.actions:[],voiceReplyQueued:true})
  }catch(error){return send(origin,{success:false,error:'widget_chat_failed',detail:error instanceof Error?error.message:undefined},500)}
})
