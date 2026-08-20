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
export const resetPassword=(email:string)=>supabase.auth.resetPasswordForEmail(email,{ redirectTo: `${location.origin}${location.pathname}#reset-password` })
export const updatePassword=(password:string)=>supabase.auth.updateUser({ password })
