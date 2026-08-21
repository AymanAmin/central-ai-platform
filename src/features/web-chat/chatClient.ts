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
export interface WidgetHistoryMessage{
  id:string
  role:'assistant'|'user'
  text:string
  createdAt:string
  source:'ai'|'human'|'customer'
  agentName:string|null
  actions:Array<Record<string,unknown>>
}
export interface WidgetSyncResponse{
  success:boolean
  exists:boolean
  conversationId:string
  status:string
  humanTakeover:boolean
  assignedUserId?:string|null
  messages:WidgetHistoryMessage[]
}
export interface WidgetSession{
  visitorId:string
  conversationId:string
  hasExistingConversation:boolean
  reset:()=>string
  adopt:(conversationId:string)=>string
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
export async function syncWidgetConversation(key:string,input:{visitorId:string;conversationId:string}){
  const response=await fetch(`${functionsBaseUrl}/widget-sync`,{method:'POST',headers:{'content-type':'application/json','x-widget-key':key},body:JSON.stringify(input),cache:'no-store'})
  return readJson<WidgetSyncResponse>(response)
}

const safeLocalStorage=()=>{try{return window.localStorage}catch{return null}}
const safeSessionStorage=()=>{try{return window.sessionStorage}catch{return null}}
export function widgetSession(key:string):WidgetSession{
  const local=safeLocalStorage(),legacy=safeSessionStorage()
  const visitorKey=`central-ai:${key}:visitor`,conversationKey=`central-ai:${key}:conversation`
  let visitorId=local?.getItem(visitorKey)??''
  if(!visitorId){visitorId=crypto.randomUUID();local?.setItem(visitorKey,visitorId)}
  let storedConversation=local?.getItem(conversationKey)??''
  if(!storedConversation){storedConversation=legacy?.getItem(conversationKey)??'';if(storedConversation)local?.setItem(conversationKey,storedConversation)}
  let conversationId=storedConversation
  if(!conversationId){conversationId=crypto.randomUUID();local?.setItem(conversationKey,conversationId)}
  return{
    visitorId,
    conversationId,
    hasExistingConversation:Boolean(storedConversation),
    reset:()=>{const next=crypto.randomUUID();local?.setItem(conversationKey,next);return next},
    adopt:(next:string)=>{if(next)local?.setItem(conversationKey,next);return next},
  }
}
