import { functionsBaseUrl, supabase } from './supabase'

export async function sendSupportMessage(conversationId:string,text:string){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session)throw new Error('Not authenticated')
  const response=await fetch(`${functionsBaseUrl}/support-message`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({conversationId,text})})
  const payload=await response.json() as {success?:boolean;error?:string;detail?:string;messageId?:string}
  if(!response.ok)throw new Error(payload.detail??payload.error??`HTTP ${response.status}`)
  return payload
}
