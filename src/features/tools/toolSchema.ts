export type ToolParameterType='text'|'number'|'phone'|'email'
export interface ToolParameter{key:string;labelAr:string;labelEn:string;type:ToolParameterType;required:boolean}
export interface ToolRequestSchema{parameters:ToolParameter[]}

export const emptyToolParameter=():ToolParameter=>({key:'',labelAr:'',labelEn:'',type:'text',required:true})

export const parseToolParameters=(value:unknown):ToolParameter[]=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return []
  const rows=(value as Record<string,unknown>).parameters
  if(!Array.isArray(rows))return []
  return rows.flatMap(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row))return []
    const item=row as Record<string,unknown>
    const type=['text','number','phone','email'].includes(String(item.type))?String(item.type) as ToolParameterType:'text'
    return [{key:String(item.key??''),labelAr:String(item.labelAr??''),labelEn:String(item.labelEn??''),type,required:item.required!==false}]
  }).slice(0,12)
}

export const validateToolParameters=(rows:ToolParameter[])=>{
  if(rows.length>12)return 'too_many_tool_parameters'
  const seen=new Set<string>()
  for(const row of rows){
    const key=row.key.trim()
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))return 'invalid_tool_parameter_key'
    const normalized=key.toLowerCase();if(seen.has(normalized))return 'duplicate_tool_parameter_key';seen.add(normalized)
    if(!row.labelAr.trim()||!row.labelEn.trim())return 'tool_parameter_labels_required'
  }
  return null
}
