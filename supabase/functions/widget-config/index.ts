import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient } from '../_shared/runtime.ts'

const headers={
  'content-type':'application/json; charset=utf-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,OPTIONS',
  'access-control-allow-headers':'content-type,x-client-info',
  'cache-control':'public, max-age=60, stale-while-revalidate=300',
}
const send=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{status,headers})

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
  if(req.method!=='GET')return send({success:false,error:'method_not_allowed'},405)
  const admin=createAdminClient();const url=new URL(req.url);const key=url.searchParams.get('key');const directory=url.searchParams.get('directory')==='1'
  try{
    if(directory){
      const widgets=await admin.from('web_chat_widgets').select('public_key,organization_id,title_ar,title_en,primary_color').eq('is_active',true).eq('public_test_enabled',true).order('created_at',{ascending:true}).limit(100)
      if(widgets.error)throw widgets.error
      const orgIds=[...new Set((widgets.data??[]).map(row=>row.organization_id))]
      const organizations=orgIds.length?await admin.from('organizations').select('id,name_ar,name_en,default_language').in('id',orgIds).eq('is_active',true):{data:[],error:null}
      if(organizations.error)throw organizations.error
      const orgMap=new Map((organizations.data??[]).map(row=>[row.id,row]))
      const items=(widgets.data??[]).map(widget=>{const org=orgMap.get(widget.organization_id);if(!org)return null;return{key:widget.public_key,organization:{nameAr:org.name_ar,nameEn:org.name_en,defaultLanguage:org.default_language},titleAr:widget.title_ar,titleEn:widget.title_en,primaryColor:widget.primary_color}}).filter(Boolean)
      return send({success:true,items})
    }
    if(!key||!/^ai_widget_[A-Za-z0-9_-]{24,}$/.test(key))return send({success:false,error:'invalid_widget_key'},400)
    const widget=await admin.from('web_chat_widgets').select('id,organization_id,prompt_profile_id,name,public_key,title_ar,title_en,welcome_ar,welcome_en,placeholder_ar,placeholder_en,suggestions_ar,suggestions_en,primary_color,position,public_test_enabled,is_active').eq('public_key',key).maybeSingle()
    if(widget.error||!widget.data||!widget.data.is_active)return send({success:false,error:'widget_not_found'},404)
    const [organization,prompt,agent]=await Promise.all([
      admin.from('organizations').select('name_ar,name_en,default_language,is_active').eq('id',widget.data.organization_id).single(),
      widget.data.prompt_profile_id?admin.from('prompt_profiles').select('name').eq('id',widget.data.prompt_profile_id).maybeSingle():Promise.resolve({data:null,error:null}),
      admin.from('organization_agents').select('voice_enabled,max_voice_seconds').eq('organization_id',widget.data.organization_id).maybeSingle(),
    ])
    if(organization.error||!organization.data?.is_active)return send({success:false,error:'organization_unavailable'},404)
    if(agent.error)throw agent.error
    return send({success:true,widget:{key:widget.data.public_key,name:widget.data.name,titleAr:widget.data.title_ar,titleEn:widget.data.title_en,welcomeAr:widget.data.welcome_ar,welcomeEn:widget.data.welcome_en,placeholderAr:widget.data.placeholder_ar,placeholderEn:widget.data.placeholder_en,suggestionsAr:widget.data.suggestions_ar,suggestionsEn:widget.data.suggestions_en,primaryColor:widget.data.primary_color,position:widget.data.position,publicTestEnabled:widget.data.public_test_enabled,agentName:prompt.data?.name??null,voiceEnabled:Boolean(agent.data?.voice_enabled),maxVoiceSeconds:Number(agent.data?.max_voice_seconds??120),organization:{nameAr:organization.data.name_ar,nameEn:organization.data.name_en,defaultLanguage:organization.data.default_language}}})
  }catch(error){return send({success:false,error:'widget_config_failed',detail:error instanceof Error?error.message:undefined},500)}
})
