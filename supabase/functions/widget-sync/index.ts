import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

type JsonObject=Record<string,unknown>
interface Body{visitorId?:string;conversationId?:string}
type AttachmentRow={message_id:string;kind:'audio'|'tts';bucket:string|null;storage_path:string|null;original_audio_stored:boolean;duration_ms:number|null;voice_name:string|null;language:string|null}
const clean=(value:string|undefined,max:number)=>value?.trim().slice(0,max)??''
const headers=(origin:string)=>({'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-widget-key','access-control-max-age':'600','vary':'Origin','cache-control':'no-store'})
const send=(origin:string,payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:headers(origin)})
const asObject=(value:unknown):JsonObject=>value&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:{}

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
    const rows=(messageResult.data??[]).filter(row=>typeof row.content==='string'&&row.content.length>0)
    const messageIds=rows.map(row=>row.id)
    let attachmentRows:AttachmentRow[]=[]
    if(messageIds.length){
      const attachments=await admin.from('message_attachments').select('message_id,kind,bucket,storage_path,original_audio_stored,duration_ms,voice_name,language').eq('organization_id',widget.organization_id).in('message_id',messageIds)
      if(attachments.error)return send(origin,{success:false,error:'attachment_lookup_failed'},500)
      attachmentRows=(attachments.data??[]) as AttachmentRow[]
    }
    const mediaByMessage=new Map<string,{kind:'audio'|'tts';stored:boolean;durationMs:number|null;voiceName:string|null;language:string|null;audioUrl:string|null}>()
    await Promise.all(attachmentRows.map(async attachment=>{
      let audioUrl:string|null=null
      if(attachment.original_audio_stored&&attachment.bucket&&attachment.storage_path){
        const signed=await admin.storage.from(attachment.bucket).createSignedUrl(attachment.storage_path,900)
        if(!signed.error)audioUrl=signed.data.signedUrl
      }
      mediaByMessage.set(attachment.message_id,{kind:attachment.kind,stored:Boolean(attachment.original_audio_stored),durationMs:attachment.duration_ms,voiceName:attachment.voice_name,language:attachment.language,audioUrl})
    }))
    const messages=rows.map(row=>{
      const contentJson=asObject(row.content_json),context=asObject(contentJson.context),voiceContext=asObject(context.voice),source=contentJson.source==='human'?'human':row.role==='user'?'customer':'ai',media=mediaByMessage.get(row.id)
      const voiceDerived=row.role==='user'&&(Object.keys(voiceContext).length>0||media?.kind==='audio'||row.content.startsWith('🎙 '))
      const audioLanguage=media?.language==='en'?'en':media?.language==='ar'?'ar':null
      return{id:row.id,role:row.role==='user'?'user':'assistant',text:row.content,createdAt:row.created_at,source,agentName:typeof contentJson.agentName==='string'?contentJson.agentName:null,actions:Array.isArray(contentJson.actions)?contentJson.actions:[],voiceDerived,audioUrl:media?.audioUrl??null,audioKind:media?.kind??null,audioStored:media?.stored??false,audioDurationMs:media?.durationMs??null,voiceName:media?.voiceName??null,audioLanguage}
    })
    return send(origin,{success:true,exists:true,conversationId:resumedConversationId,status:conversation.status,humanTakeover:conversation.human_takeover,assignedUserId:conversation.assigned_user_id,messages})
  }catch(error){return send(origin,{success:false,error:'widget_sync_failed',detail:error instanceof Error?error.message:undefined},500)}
})
