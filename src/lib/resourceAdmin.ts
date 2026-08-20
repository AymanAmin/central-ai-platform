import { functionsBaseUrl, supabase } from './supabase'

export async function resourceAdmin<T=Record<string,unknown>>(body:Record<string,unknown>):Promise<T>{
  const {data:{session}}=await supabase.auth.getSession()
  if(!session)throw new Error('Not authenticated')
  const response=await fetch(`${functionsBaseUrl}/resource-admin`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body)})
  const payload=await response.json() as T&{error?:string;detail?:string}
  if(!response.ok)throw new Error(payload.detail??payload.error??`HTTP ${response.status}`)
  return payload
}
