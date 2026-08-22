export type CustomerIntakeFieldKey='firstName'|'lastName'|'phone'|'email'|'question'
export interface CustomerIntakeFieldRule{visible:boolean;required:boolean}
export type CustomerIntakeFields=Record<CustomerIntakeFieldKey,CustomerIntakeFieldRule>

export const customerIntakeKeys:CustomerIntakeFieldKey[]=['firstName','lastName','phone','email','question']

export const defaultCustomerIntakeFields=():CustomerIntakeFields=>({
  firstName:{visible:true,required:false},
  lastName:{visible:true,required:false},
  phone:{visible:true,required:false},
  email:{visible:true,required:false},
  question:{visible:true,required:false},
})

export const normalizeCustomerIntakeFields=(value:unknown):CustomerIntakeFields=>{
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
  const defaults=defaultCustomerIntakeFields()
  return customerIntakeKeys.reduce((result,key)=>{
    const raw=source[key]
    if(!raw||typeof raw!=='object'||Array.isArray(raw)){result[key]=defaults[key];return result}
    const row=raw as Record<string,unknown>
    const visible=typeof row.visible==='boolean'?row.visible:defaults[key].visible
    result[key]={visible,required:visible&&row.required===true}
    return result
  },{} as CustomerIntakeFields)
}

export const customerDisplayName=(firstName:string,lastName:string)=>[firstName.trim(),lastName.trim()].filter(Boolean).join(' ')
