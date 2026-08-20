import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getProfile } from '../lib/auth'
import type { Profile } from '../types/domain'

export function useAuth(){
  const [user,setUser]=useState<User|null>(null); const [profile,setProfile]=useState<Profile|null>(null); const [loading,setLoading]=useState(true)
  useEffect(()=>{ let alive=true
    const load=async()=>{const {data}=await supabase.auth.getUser(); if(!alive)return; setUser(data.user); setProfile(data.user?await getProfile(data.user.id):null); setLoading(false)}
    void load(); const {data:listener}=supabase.auth.onAuthStateChange((_e,session)=>{void (async()=>{if(!alive)return;setUser(session?.user??null);setProfile(session?.user?await getProfile(session.user.id):null);setLoading(false)})()})
    return()=>{alive=false;listener.subscription.unsubscribe()}
  },[])
  return {user,profile,loading,refresh:async()=>{if(user)setProfile(await getProfile(user.id))}}
}
