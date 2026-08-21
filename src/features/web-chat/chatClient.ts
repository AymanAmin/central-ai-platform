import { functionsBaseUrl } from '../../lib/supabase'

export interface WidgetDirectoryItem{
  key:string
  organization:{nameAr:string;nameEn:string|null;defaultLanguage:string}
  titleAr:string
  titleEn:string
  primaryColor:string
}
export interface WidgetPublicConfig{
  key:string
  name:string
  titleAr:string
  titleEn:string
  welcomeAr:string
  welcomeEn:string
  placeholderAr:string
  placeholderEn:string
  suggestionsAr:string[]
  suggestionsEn:string[]
  primaryColor:string
  position:'bottom_right'|'bottom_left'
  publicTestEnabled:boolean
  agentName:string|null
  organization:{nameAr:string;nameEn:string|null;defaultLanguage:string}
}
export interface WidgetChatResponse{
  success:boolean
  conversationId:string|null
  status:string
  answer:string
  language:string
  intent:string|null
  confidence:number|null
  requiresHuman:boolean
  humanHandoffReason:string|null
  actions:Array<Record<string,unknown>>
}

type ApiError={success?:boolean;error?:string;detail?:string}

async function readJson<T>(response:Response):Promise<T>{
  const payload=await response.json() as T&ApiError
  if(!response.ok)throw new Error(payload.detail??payload.error??`HTTP ${response.status}`)
  return payload
}

export async function loadWidgetDirectory(){
  const response=await fetch(`${functionsBaseUrl}/widget-config?directory=1`,{headers:{accept:'application/json'}})
  const payload=await readJson<{success:boolean;items:WidgetDirectoryItem[]}>(response)
  return payload.items
}
export async function loadWidgetConfig(key:string){
  const response=await fetch(`${functionsBaseUrl}/widget-config?key=${encodeURIComponent(key)}`,{headers:{accept:'application/json'}})
  const payload=await readJson<{success:boolean;widget:WidgetPublicConfig}>(response)
  return payload.widget
}
export async function sendWidgetMessage(key:string,input:{visitorId:string;conversationId:string;messageId:string;text:string;language:'ar'|'en';customer?:{name?:string;email?:string;phone?:string}}){
  const response=await fetch(`${functionsBaseUrl}/widget-chat`,{method:'POST',headers:{'content-type':'application/json','x-widget-key':key},body:JSON.stringify(input)})
  return readJson<WidgetChatResponse>(response)
}

const safeStorage=(type:'local'|'session')=>{
  try{return type==='local'?window.localStorage:window.sessionStorage}catch{return null}
}
export function widgetSession(key:string){
  const local=safeStorage('local'),session=safeStorage('session')
  const visitorKey=`central-ai:${key}:visitor`,conversationKey=`central-ai:${key}:conversation`
  let visitorId=local?.getItem(visitorKey)??'';if(!visitorId){visitorId=crypto.randomUUID();local?.setItem(visitorKey,visitorId)}
  let conversationId=session?.getItem(conversationKey)??'';if(!conversationId){conversationId=crypto.randomUUID();session?.setItem(conversationKey,conversationId)}
  return{visitorId,conversationId,reset:()=>{const next=crypto.randomUUID();session?.setItem(conversationKey,next);return next}}
}
