import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

type JsonObject=Record<string,unknown>
interface Body{visitorId?:string;conversationId?:string;limit?:number;before?:string}
interface AudioMeta{message_id:string;audio_source:string;storage_path:string|null;mime_type:string;duration_ms:number|null;original_audio_stored:boolean;generation_provider:string|null;generation_voice:string|null;created_at:string;url?:string|null}
const PENDING_TTS_WINDOW_MS=120_000
const DEFAULT_PAGE_SIZE=20
const MAX_PAGE_SIZE=50
const PAGINATION_BUFFER=8
const clean=(value:string|undefined,max:number)=>value?.trim().slice(0,max)??''
const normalizeAssistantText=(value:string)=>value.replace(/\\r\\n/g,'\n').replace(/\\n/g,'\n').replace(/\\t/g,' ').replace(/\*\*([^*\n]+)\*\*/g,'$1').replace(/__([^_\n]+)__/g,'$1').replace(/`([^`\n]+)`/g,'$1').replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm,'').replace(/^[ \t]*[-*][ \t]+/gm,'• ').replace(/\n{3,}/g,'\n\n').trim()
const headers=(origin:string)=>({'content-type':'application/json; charset=utf-8','access-control-allow-origin':origin||'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-widget-key','access-control-max-age':'600','vary':'Origin','cache-control':'no-store'})
const send=(origin:string,payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers:headers(origin)})
const pageSize=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(5,Math.min(MAX_PAGE_SIZE,Math.floor(value))):DEFAULT_PAGE_SIZE
const validBefore=(value:string)=>!value||Number.isFinite(Date.parse(value))

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
    const visitorId=clean(body.visitorId,160),conversationId=clean(body.conversationId,160),before=clean(body.before,64)
    const limit=pageSize(body.limit)
    if(!visitorId||!conversationId||!validBefore(before))return send(origin,{success:false,error:'invalid_request'},400)

    const empty={success:true,exists:false,conversationId,status:'new',humanTakeover:false,messages:[],hasMore:false,nextBefore:null}
    const customerResult=await admin.from('customers').select('id').eq('organization_id',widget.organization_id).eq('external_customer_id',`web:${widget.id}:${visitorId}`).maybeSingle()
    if(customerResult.error)return send(origin,{success:false,error:'customer_lookup_failed'},500)
    if(!customerResult.data)return send(origin,empty)

    const selectConversation='id,status,human_takeover,assigned_user_id,external_conversation_id'
    const exact=await admin.from('conversations').select(selectConversation).eq('organization_id',widget.organization_id).eq('customer_id',customerResult.data.id).eq('external_conversation_id',`web:${widget.id}:${conversationId}`).maybeSingle()
    if(exact.error)return send(origin,{success:false,error:'conversation_lookup_failed'},500)
    let conversation=exact.data
    if(!conversation){
      const latest=await admin.from('conversations').select(selectConversation).eq('organization_id',widget.organization_id).eq('customer_id',customerResult.data.id).order('last_message_at',{ascending:false}).limit(1).maybeSingle()
      if(latest.error)return send(origin,{success:false,error:'conversation_lookup_failed'},500)
      conversation=latest.data
    }
    if(!conversation)return send(origin,empty)

    const prefix=`web:${widget.id}:`
    const resumedConversationId=conversation.external_conversation_id.startsWith(prefix)?conversation.external_conversation_id.slice(prefix.length):conversationId
    let messageQuery=admin.from('messages').select('id,role,direction,message_type,content,content_json,created_at').eq('organization_id',widget.organization_id).eq('conversation_id',conversation.id).in('role',['user','assistant'])
    if(before)messageQuery=messageQuery.lt('created_at',before)
    const fetchLimit=limit+PAGINATION_BUFFER+1
    const messageResult=await messageQuery.order('created_at',{ascending:false}).limit(fetchLimit)
    if(messageResult.error)return send(origin,{success:false,error:'message_lookup_failed'},500)
    const rows=(messageResult.data??[]).filter(row=>typeof row.content==='string'&&row.content.length>0)
    const ids=rows.map(row=>row.id)
    const audioByMessage=new Map<string,AudioMeta>()
    const pendingTtsMessageIds=new Set<string>()
    if(ids.length){
      const attachmentResult=await admin.from('message_attachments').select('message_id,audio_source,storage_path,mime_type,duration_ms,original_audio_stored,generation_provider,generation_voice,created_at').eq('organization_id',widget.organization_id).eq('conversation_id',conversation.id).in('message_id',ids)
      if(attachmentResult.error)return send(origin,{success:false,error:'attachment_lookup_failed'},500)
      const attachments=attachmentResult.data??[]
      const now=Date.now()
      attachments.forEach(row=>{
        if(row.audio_source!=='assistant_tts'||row.generation_provider!=='pending')return
        const createdAt=Date.parse(row.created_at)
        if(Number.isFinite(createdAt)&&now-createdAt<=PENDING_TTS_WINDOW_MS)pendingTtsMessageIds.add(row.message_id)
      })
      const readyAttachments=attachments.filter(row=>row.generation_provider!=='pending')
      await Promise.all(readyAttachments.map(async row=>{
        const audio={...row,url:null} as AudioMeta
        if(row.storage_path){
          const signed=await admin.storage.from('chat-media').createSignedUrl(row.storage_path,300)
          if(!signed.error&&signed.data?.signedUrl)audio.url=signed.data.signedUrl
        }
        audioByMessage.set(row.message_id,audio)
      }))
    }
    const visibleDescending=rows.filter(row=>!(row.role==='assistant'&&pendingTtsMessageIds.has(row.id)))
    const selectedDescending=visibleDescending.slice(0,limit)
    const hasMore=visibleDescending.length>limit||rows.length===fetchLimit
    const oldestSelected=selectedDescending[selectedDescending.length-1]
    const messages=selectedDescending.reverse().map(row=>{
      const contentJson=(row.content_json??{}) as JsonObject
      const source=contentJson.source==='human'?'human':row.role==='user'?'customer':'ai'
      const audio=audioByMessage.get(row.id)
      const text=source==='ai'?normalizeAssistantText(row.content):row.content
      return{id:row.id,role:row.role==='user'?'user':'assistant',text,createdAt:row.created_at,source,agentName:typeof contentJson.agentName==='string'?contentJson.agentName:null,actions:Array.isArray(contentJson.actions)?contentJson.actions:[],voiceInput:row.role==='user'&&row.message_type==='audio',audio:audio?{source:audio.audio_source,url:audio.url??null,mimeType:audio.mime_type,durationMs:Number(audio.duration_ms??0),stored:Boolean(audio.original_audio_stored),voiceName:audio.generation_voice}:null}
    })
    return send(origin,{success:true,exists:true,conversationId:resumedConversationId,status:conversation.status,humanTakeover:conversation.human_takeover,assignedUserId:conversation.assigned_user_id,messages,hasMore,nextBefore:hasMore&&oldestSelected?oldestSelected.created_at:null})
  }catch(error){return send(origin,{success:false,error:'widget_sync_failed',detail:error instanceof Error?error.message:undefined},500)}
})
