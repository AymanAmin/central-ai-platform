import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'

export type VoiceReplyMode='text_only'|'voice_on_voice'|'always_voice'
export interface TtsSettings{
  voiceReplyMode:VoiceReplyMode
  provider:'gemini'
  model:string
  voiceAr:string
  voiceEn:string
  includedMonthlyTtsMinutes:number|null
  monthlyAiCostLimitUsd:number|null
}

const MAX_TTS_AUDIO_BYTES=8*1024*1024
const DEFAULT_TTS_RATE=24000
const TTS_CHANNELS=1
const TTS_SAMPLE_WIDTH=2
const allowedVoices=new Set([
  'Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede','Callirrhoe','Autonoe',
  'Enceladus','Iapetus','Umbriel','Algieba','Despina','Erinome','Algenib','Rasalgethi',
  'Laomedeia','Achernar','Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi',
  'Vindemiatrix','Sadachbia','Sadaltager','Sulafat',
])
const monthStart=()=>new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)).toISOString()
const cleanModel=(value:string)=>value.trim().replace(/^models\//,'').slice(0,180)
const safeVoice=(value:string,fallback:string)=>allowedVoices.has(value)?value:fallback

function base64Bytes(value:string){
  const binary=atob(value),bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  return bytes
}
function concatBytes(parts:Uint8Array[]){
  const total=parts.reduce((sum,part)=>sum+part.length,0),result=new Uint8Array(total)
  let offset=0
  for(const part of parts){result.set(part,offset);offset+=part.length}
  return result
}
function pcmRate(mimeType:string|undefined){
  const normalized=(mimeType??'').toLowerCase()
  if(normalized&&!normalized.includes('l16')&&!normalized.includes('pcm'))throw new Error(`tts_audio_format_unsupported:${normalized.slice(0,80)}`)
  const match=normalized.match(/rate=(\d{4,6})/),rate=match?Number(match[1]):DEFAULT_TTS_RATE
  if(!Number.isFinite(rate)||rate<8000||rate>96000)throw new Error('tts_audio_rate_invalid')
  return rate
}
function wavFromPcm(pcm:Uint8Array,rate:number,channels=TTS_CHANNELS,sampleWidth=TTS_SAMPLE_WIDTH){
  const headerSize=44,buffer=new ArrayBuffer(headerSize+pcm.length),view=new DataView(buffer),bytes=new Uint8Array(buffer)
  const write=(offset:number,text:string)=>{for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i)}
  write(0,'RIFF');view.setUint32(4,36+pcm.length,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true)
  view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*sampleWidth,true);view.setUint16(32,channels*sampleWidth,true)
  view.setUint16(34,sampleWidth*8,true);write(36,'data');view.setUint32(40,pcm.length,true);bytes.set(pcm,44)
  return bytes
}

async function providerSecret(admin:SupabaseClient){
  const setting=await admin.from('ai_provider_settings').select('id').is('organization_id',null).eq('provider','gemini').eq('is_active',true).order('is_default',{ascending:false}).order('updated_at',{ascending:false}).limit(1).maybeSingle()
  if(setting.error)throw setting.error
  if(!setting.data)throw new Error('tts_provider_not_configured:gemini')
  const secret=await admin.rpc('get_ai_provider_secret',{p_provider_setting_id:setting.data.id})
  if(secret.error)throw secret.error
  if(typeof secret.data!=='string'||!secret.data.trim())throw new Error('tts_provider_secret_missing:gemini')
  return secret.data.trim()
}

export async function resolveTtsSettings(admin:SupabaseClient,organizationId:string):Promise<TtsSettings>{
  const result=await admin.from('organization_agents').select('voice_reply_mode,tts_provider,tts_model,tts_voice_ar,tts_voice_en,included_monthly_tts_minutes,monthly_ai_cost_limit_usd').eq('organization_id',organizationId).maybeSingle()
  if(result.error)throw result.error
  const row=result.data
  const mode:VoiceReplyMode=row?.voice_reply_mode==='always_voice'?'always_voice':row?.voice_reply_mode==='voice_on_voice'?'voice_on_voice':'text_only'
  return{
    voiceReplyMode:mode,
    provider:'gemini',
    model:cleanModel(row?.tts_model??'gemini-2.5-flash-preview-tts'),
    voiceAr:safeVoice(row?.tts_voice_ar??'Sulafat','Sulafat'),
    voiceEn:safeVoice(row?.tts_voice_en??'Achird','Achird'),
    includedMonthlyTtsMinutes:row?.included_monthly_tts_minutes==null?null:Number(row.included_monthly_tts_minutes),
    monthlyAiCostLimitUsd:row?.monthly_ai_cost_limit_usd==null?null:Number(row.monthly_ai_cost_limit_usd),
  }
}

export const shouldGenerateVoiceReply=(settings:TtsSettings,inputWasVoice:boolean)=>settings.voiceReplyMode==='always_voice'||(settings.voiceReplyMode==='voice_on_voice'&&inputWasVoice)

async function assertTtsQuota(admin:SupabaseClient,organizationId:string,settings:TtsSettings){
  const start=monthStart()
  const [ttsRows,costRows]=await Promise.all([
    settings.includedMonthlyTtsMinutes==null?Promise.resolve({data:[],error:null}):admin.from('message_attachments').select('duration_ms').eq('organization_id',organizationId).eq('kind','tts').gte('created_at',start),
    settings.monthlyAiCostLimitUsd==null?Promise.resolve({data:[],error:null}):admin.from('usage_logs').select('estimated_cost').eq('organization_id',organizationId).gte('created_at',start),
  ])
  if(ttsRows.error)throw ttsRows.error
  if(costRows.error)throw costRows.error
  if(settings.includedMonthlyTtsMinutes!=null){
    const usedMs=(ttsRows.data??[]).reduce((sum,row)=>sum+Number(row.duration_ms??0),0)
    if(usedMs>=settings.includedMonthlyTtsMinutes*60000)throw new Error('tts_monthly_limit_exceeded')
  }
  if(settings.monthlyAiCostLimitUsd!=null){
    const usedCost=(costRows.data??[]).reduce((sum,row)=>sum+Number(row.estimated_cost??0),0)
    if(usedCost>=settings.monthlyAiCostLimitUsd)throw new Error('ai_cost_limit_exceeded')
  }
}

async function estimateCost(admin:SupabaseClient,model:string,inputTokens:number,outputTokens:number){
  const price=await admin.from('model_pricing').select('input_cost_per_million,output_cost_per_million').eq('provider','gemini').eq('model',model).eq('is_active',true).lte('effective_from',new Date().toISOString().slice(0,10)).order('effective_from',{ascending:false}).limit(1).maybeSingle()
  if(price.error)throw price.error
  return inputTokens/1_000_000*Number(price.data?.input_cost_per_million??0)+outputTokens/1_000_000*Number(price.data?.output_cost_per_million??0)
}

async function synthesize(admin:SupabaseClient,settings:TtsSettings,text:string,language:'ar'|'en'){
  const secret=await providerSecret(admin),voice=language==='ar'?settings.voiceAr:settings.voiceEn
  const instruction=language==='ar'
    ?`اقرأ النص التالي كما هو دون ترجمة أو إضافة أو حذف. تحدث بالعربية بلهجة سعودية طبيعية وواضحة ومهنية ومناسبة لخدمة العملاء. اجعل الإيقاع هادئًا وودودًا، وانطق الأسماء والأرقام والروابط بدقة. النص:\n${text}`
    :`Read the following text exactly without translating, adding, or removing information. Use natural, clear, friendly professional English. Any natural English accent is acceptable. Pronounce names, numbers, and URLs carefully. Text:\n${text}`
  const started=performance.now()
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,{
    method:'POST',headers:{'content-type':'application/json','x-goog-api-key':secret},
    body:JSON.stringify({contents:[{parts:[{text:instruction}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}}),
    signal:AbortSignal.timeout(45000),
  })
  const payload=await response.json() as {candidates?:Array<{content?:{parts?:Array<{inlineData?:{data?:string;mimeType?:string}}>} }>;usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number};error?:{message?:string}}
  if(!response.ok)throw new Error(`tts_generation_failed:${payload.error?.message??response.status}`)
  const audioParts=(payload.candidates?.[0]?.content?.parts??[]).filter(part=>Boolean(part.inlineData?.data))
  if(!audioParts.length)throw new Error('tts_generation_empty')
  const rate=pcmRate(audioParts[0]?.inlineData?.mimeType),pcm=concatBytes(audioParts.map(part=>base64Bytes(part.inlineData!.data!))),wav=wavFromPcm(pcm,rate)
  if(wav.length>MAX_TTS_AUDIO_BYTES)throw new Error('tts_audio_too_large')
  const durationMs=Math.max(1,Math.round(pcm.length/(rate*TTS_CHANNELS*TTS_SAMPLE_WIDTH)*1000))
  const inputTokens=Number(payload.usageMetadata?.promptTokenCount??0),outputTokens=Number(payload.usageMetadata?.candidatesTokenCount??0)
  const estimatedCost=await estimateCost(admin,settings.model,inputTokens,outputTokens)
  return{wav,durationMs,inputTokens,outputTokens,estimatedCost,latencyMs:Math.round(performance.now()-started),voice}
}

export async function generateVoiceReplyForExternalMessage(admin:SupabaseClient,organizationId:string,externalMessageId:string,inputWasVoice:boolean,languageHint:'ar'|'en'){
  const settings=await resolveTtsSettings(admin,organizationId)
  if(!shouldGenerateVoiceReply(settings,inputWasVoice))return{generated:false,reason:'disabled'} as const
  await assertTtsQuota(admin,organizationId,settings)

  const inbound=await admin.from('messages').select('id,conversation_id').eq('organization_id',organizationId).eq('external_message_id',externalMessageId).maybeSingle()
  if(inbound.error)throw inbound.error
  if(!inbound.data)return{generated:false,reason:'inbound_missing'} as const
  const assistant=await admin.from('messages').select('id,content,language').eq('organization_id',organizationId).eq('conversation_id',inbound.data.conversation_id).eq('role','assistant').contains('content_json',{requestMessageId:inbound.data.id}).order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(assistant.error)throw assistant.error
  const text=assistant.data?.content?.trim()??''
  if(!assistant.data||!text)return{generated:false,reason:'assistant_missing'} as const

  const existing=await admin.from('message_attachments').select('id,storage_path').eq('organization_id',organizationId).eq('message_id',assistant.data.id).eq('kind','tts').maybeSingle()
  if(existing.error)throw existing.error
  if(existing.data)return{generated:false,reason:'already_exists'} as const

  const language:'ar'|'en'=assistant.data.language==='en'?'en':assistant.data.language==='ar'?'ar':languageHint
  const result=await synthesize(admin,settings,text.slice(0,6000),language)
  if(settings.includedMonthlyTtsMinutes!=null){
    const start=monthStart(),rows=await admin.from('message_attachments').select('duration_ms').eq('organization_id',organizationId).eq('kind','tts').gte('created_at',start)
    if(rows.error)throw rows.error
    const usedMs=(rows.data??[]).reduce((sum,row)=>sum+Number(row.duration_ms??0),0)
    if(usedMs+result.durationMs>settings.includedMonthlyTtsMinutes*60000)throw new Error('tts_monthly_limit_exceeded')
  }

  const now=new Date(),storagePath=`${organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/tts/${crypto.randomUUID()}.wav`
  const upload=await admin.storage.from('chat-media').upload(storagePath,result.wav,{contentType:'audio/wav',upsert:false,cacheControl:'0'})
  if(upload.error)throw upload.error
  try{
    const attachment=await admin.from('message_attachments').insert({
      organization_id:organizationId,conversation_id:inbound.data.conversation_id,message_id:assistant.data.id,kind:'tts',bucket:'chat-media',storage_path:storagePath,original_audio_stored:true,
      mime_type:'audio/wav',byte_size:result.wav.length,duration_ms:result.durationMs,transcript:text,generation_provider:'gemini',generation_model:settings.model,voice_name:result.voice,language,
      input_tokens:result.inputTokens,output_tokens:result.outputTokens,estimated_cost:result.estimatedCost,
    })
    if(attachment.error){if(attachment.error.code==='23505'){await admin.storage.from('chat-media').remove([storagePath]);return{generated:false,reason:'already_exists'} as const}throw attachment.error}
    const usage=await admin.from('usage_logs').insert({organization_id:organizationId,conversation_id:inbound.data.conversation_id,message_id:assistant.data.id,operation:'voice_synthesis',provider:'gemini',model:settings.model,input_tokens:result.inputTokens,output_tokens:result.outputTokens,estimated_cost:result.estimatedCost,latency_ms:result.latencyMs})
    if(usage.error)console.error('tts_usage_log_failed',usage.error.message)
    return{generated:true,durationMs:result.durationMs,voice:result.voice,language} as const
  }catch(error){await admin.storage.from('chat-media').remove([storagePath]);throw error}
}
