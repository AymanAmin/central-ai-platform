import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, FieldHint, PageHeader } from '../../components/Ui'
import { useI18n, type AppLanguage } from '../../lib/i18n'
import type { Organization } from '../../types/domain'

interface Row{id:string;organization_id:string;name:string;system_prompt:string;default_language:string;is_default:boolean;is_active:boolean}

export function Prompts(){
  const {language,tr,valueLabel}=useI18n()
  const [rows,setRows]=useState<Row[]>([])
  const [orgs,setOrgs]=useState<Organization[]>([])
  const [name,setName]=useState('')
  const [prompt,setPrompt]=useState('')
  const [orgId,setOrgId]=useState('')
  const [promptLanguage,setPromptLanguage]=useState<AppLanguage>(language)

  const load=async()=>{
    const [promptsResult,organizationsResult]=await Promise.all([
      supabase.from('prompt_profiles').select('*').order('created_at',{ascending:false}),
      supabase.from('organizations').select('*').eq('is_active',true).order('name_ar'),
    ])
    setRows((promptsResult.data??[]) as Row[])
    const organizationRows=(organizationsResult.data??[]) as Organization[]
    setOrgs(organizationRows)
    if(!orgId&&organizationRows.length===1)setOrgId(organizationRows[0].id)
  }

  useEffect(()=>{void load()},[])

  const create=async(e:React.FormEvent)=>{
    e.preventDefault()
    const {error}=await supabase.from('prompt_profiles').insert({organization_id:orgId,name,system_prompt:prompt,default_language:promptLanguage,knowledge_only:true,allow_general_knowledge:false,is_default:true,is_active:true})
    if(!error){setPrompt('');setName('');await load()}
  }

  return <>
    <PageHeader title={tr('التوجيهات','Prompts')} description={tr('حدّد شخصية المساعد وقواعد الإجابة لكل جهة بدون تغيير كود التطبيق.','Define assistant behavior and answer rules for each organization without changing application code.')}/>
    <Card>
      <form className="stack" onSubmit={create}>
        <label>{tr('الجهة','Organization')}
          <select required value={orgId} onChange={e=>setOrgId(e.target.value)}>
            <option value="">{tr('اختر الجهة','Select organization')}</option>
            {orgs.map(org=><option key={org.id} value={org.id}>{org.name_ar} / {org.name_en??org.code}</option>)}
          </select>
          <FieldHint>{tr('يُطبّق التوجيه على الجهة المحددة فقط.', 'The prompt applies only to the selected organization.')}</FieldHint>
        </label>
        <label>{tr('اسم التوجيه','Prompt name')}
          <input required placeholder={tr('مثال: المساعد الافتراضي','Example: Default assistant')} value={name} onChange={e=>setName(e.target.value)}/>
        </label>
        <label>{tr('لغة التوجيه الافتراضية','Default prompt language')}
          <select value={promptLanguage} onChange={e=>setPromptLanguage(e.target.value as AppLanguage)}><option value="ar">{tr('العربية','Arabic')}</option><option value="en">{tr('الإنجليزية','English')}</option></select>
        </label>
        <label>{tr('تعليمات النظام','System instructions')}
          <textarea required rows={7} placeholder={tr('اكتب قواعد المساعد بوضوح: ما الذي يجيب عنه، ومتى يرفض التخمين، ومتى يحول لموظف.','Write clear assistant rules: what it answers, when it avoids guessing, and when it hands off to a person.')} value={prompt} onChange={e=>setPrompt(e.target.value)}/>
          <FieldHint>{tr('لا تضع مفاتيح API أو كلمات مرور أو أسرارًا داخل التوجيه.', 'Do not put API keys, passwords, or secrets inside the prompt.')}</FieldHint>
        </label>
        <button>{tr('إضافة التوجيه','Add prompt')}</button>
      </form>
    </Card>
    <Card>
      {rows.length===0?<Empty>{tr('لا توجد توجيهات.','No prompts found.')}</Empty>:rows.map(r=><div className="prompt-row" key={r.id}><strong>{r.name}</strong><small>{r.is_default?`${tr('افتراضي','Default')} · `:''}{valueLabel(r.default_language)}</small><pre>{r.system_prompt}</pre></div>)}
    </Card>
  </>
}
