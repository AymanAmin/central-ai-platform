import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'

export const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}})
export const getSupabaseSecretKey=():string=>{const raw=Deno.env.get('SUPABASE_SECRET_KEYS');if(raw){const keys=JSON.parse(raw) as Record<string,string>;if(keys.default)return keys.default}const legacy=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!legacy)throw new Error('supabase_secret_missing');return legacy}
export const createAdminClient=():SupabaseClient=>{const url=Deno.env.get('SUPABASE_URL');if(!url)throw new Error('supabase_url_missing');return createClient(url,getSupabaseSecretKey(),{auth:{persistSession:false,autoRefreshToken:false}})}
export const normalizeText=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim()
export const detectLanguage=(text:string,preferred?:string|null):'ar'|'en'=>preferred==='en'?'en':preferred==='ar'?'ar':/[\u0600-\u06FF]/.test(text)?'ar':'en'
export const isGreeting=(text:string)=>/^(السلام علىكم|وعليكم السلام|مرحبا|مرحبا بك|اهلا|اهلىن|هلا|hello|hi|hey|good morning|good evening|شكرا|thanks|thank you)$/i.test(normalizeText(text))
export const requestsHuman=(text:string)=>/(ابي|ابغى|اريد|اود).{0,12}(موظف|خدمه العملاء)|\b(human|agent|representative|support person)\b/i.test(normalizeText(text))
export const vectorLiteral=(vector:number[])=>`[${vector.join(',')}]`
export const sha256=async(value:string):Promise<string>=>{const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}
