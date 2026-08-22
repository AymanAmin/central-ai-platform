import { supabase } from './supabase'
import type { Profile } from '../types/domain'

export async function getProfile(userId:string):Promise<Profile|null>{
  const { data, error } = await supabase.from('profiles').select('id,organization_id,full_name,email,role,is_active').eq('id',userId).maybeSingle()
  if (error) throw error
  return data as Profile | null
}
export const signIn=(email:string,password:string)=>supabase.auth.signInWithPassword({ email, password })
export const signUp=(email:string,password:string)=>supabase.auth.signUp({ email, password })
export const signOut=()=>supabase.auth.signOut()

const configuredAppUrl=import.meta.env.VITE_APP_URL?.trim()
const appBaseUrl=()=>{
  const value=configuredAppUrl||`${location.origin}${import.meta.env.BASE_URL}`
  return value.endsWith('/')?value:`${value}/`
}

export const resetPassword=(email:string)=>supabase.auth.resetPasswordForEmail(email,{ redirectTo: `${appBaseUrl()}#reset-password` })
export const updatePassword=(password:string)=>supabase.auth.updateUser({ password })

async function establishRecoverySession(){
  const params=new URLSearchParams(location.hash.slice(1))
  if(params.get('type')==='recovery'){
    const accessToken=params.get('access_token')
    const refreshToken=params.get('refresh_token')
    if(!accessToken||!refreshToken)throw new Error('Password recovery link is incomplete or expired. Request a new reset link.')
    const {data,error}=await supabase.auth.setSession({access_token:accessToken,refresh_token:refreshToken})
    if(error)throw error
    if(!data.session)throw new Error('Password recovery session could not be established. Request a new reset link.')
    history.replaceState(null,'',`${location.pathname}#reset-password`)
    return
  }
  const {data,error}=await supabase.auth.getSession()
  if(error)throw error
  if(!data.session)throw new Error('Password recovery session is missing or expired. Request a new reset link.')
}

export const updateRecoveryPassword=async(password:string)=>{
  await establishRecoverySession()
  return supabase.auth.updateUser({password})
}
