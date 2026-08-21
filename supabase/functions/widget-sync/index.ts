import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

type JsonObject=Record<string,unknown>
interface Body{visitorId?:string;conversationId?:string}
const clean=(value:string|undefined,max:number)=>value?.trim().slice(0,max)??''
const headers=(origin:string)=>({'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-widget-key','access-control-max-age':'600','vary':'Origin','cache-control':'no-store'})
const send=(origin:string,payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:headers(origin)})

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')??''
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)})
  if(req.method!=='POST')return send(origin,{success:false,error:'method_not_allowed'},405)
  const publicKey=clean(req.headers.get('x-widget-key')??undefined,160)
  if(!/^ai_widget_[A-Za-z0-9_-]{24,}$/.test(publicKey))return send(origin,{success:false,error:'invalid_widget_key'},401)
  if(!origin)return send(origin,{success:false,error:'widget_origin_required'},403)
  const admin=createAdminClient()
  try{
    const widgetResult=await admin.from('web_chat_widgets').select('id,organization_id,allowed_origins,is_active').eq('public_key',publicKey).maybeSingle()
    const widget=widgetResult.data
    if(widgetResult.error||!widget?.is_active)return send(origin,{success:false,error:'widget_not_found'},404)
    const allowed=Array.isArray(widget.allowed_origins)?widget.allowed_origins.filter((value):value is string=>typeof value==='string'):[]
    if(!allowed.includes(origin))return send(origin,{success:false,error:'widget_origin_not_allowed'},403)
    const body=await req.json() as Body
    const visitorId=clean(body.visitorId,160),conversationId=clean(body.conversationId,160)
    if(!visitorId||!conversationId)return send(origin,{success:false,error:'invalid_request'},400)

    const customerResult=await admin.from('customers').select('id').eq('organization_id',widget.organization_id).eq('external_customer_id',`web:${widget.id}:${visitorId}`).maybeSingle()
    if(customerResult.error)return send(origin,{success:false,error:'customer_lookup_failed'},500)
    if(!customerResult.data)return send(origin,{success:true,exists:false,conversationId,status:'new',humanTakeover:false,messages:[]})

    const selectConversation='id,status,human_takeover,assigned_user_id,external_conversation_id'
    const exact=await admin.from('conversations').select(selectConversation).eq('organization_id',widget.organization_id).eq('customer_id',customerResult.data.id).eq('external_conversation_id',`web:${widget.id}:${conversationId}`).maybeSingle()
    if(exact.error)return send(origin,{success:false,error:'conversation_lookup_failed'},500)
    let conversation=exact.data
    if(!conversation){
      const latest=await admin.from('conversations').select(selectConversation).eq('organization_id',widget.organization_id).eq('customer_id',customerResult.data.id).order('last_message_at',{ascending:false}).limit(1).maybeSingle()
      if(latest.error)return send(origin,{success:false,error:'conversation_lookup_failed'},500)
      conversation=latest.data
    }
    if(!conversation)return send(origin,{success:true,exists:false,conversationId,status:'new',humanTakeover:false,messages:[]})

    const prefix=`web:${widget.id}:`
    const resumedConversationId=conversation.external_conversation_id.startsWith(prefix)?conversation.external_conversation_id.slice(prefix.length):conversationId
    const messageResult=await admin.from('messages').select('id,role,direction,content,content_json,created_at').eq('organization_id',widget.organization_id).eq('conversation_id',conversation.id).in('role',['user','assistant']).order('created_at',{ascending:true}).limit(200)
    if(messageResult.error)return send(origin,{success:false,error:'message_lookup_failed'},500)
    const messages=(messageResult.data??[]).filter(row=>typeof row.content==='string'&&row.content.length>0).map(row=>{
      const contentJson=(row.content_json??{}) as JsonObject
      const source=contentJson.source==='human'?'human':row.role==='user'?'customer':'ai'
      return{id:row.id,role:row.role==='user'?'user':'assistant',text:row.content,createdAt:row.created_at,source,agentName:typeof contentJson.agentName==='string'?contentJson.agentName:null,actions:Array.isArray(contentJson.actions)?contentJson.actions:[]}
    })
    return send(origin,{success:true,exists:true,conversationId:resumedConversationId,status:conversation.status,humanTakeover:conversation.human_takeover,assignedUserId:conversation.assigned_user_id,messages})
  }catch(error){return send(origin,{success:false,error:'widget_sync_failed',detail:error instanceof Error?error.message:undefined},500)}
})
