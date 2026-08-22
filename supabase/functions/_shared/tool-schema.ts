type JsonObject=Record<string,unknown>
export type ToolParameterType='text'|'number'|'phone'|'email'
export interface ToolRequestParameter{key:string;labelAr:string;labelEn:string;type:ToolParameterType;required:boolean}
export interface ToolRequestSchema{parameters:ToolRequestParameter[]}

const isObject=(value:unknown):value is JsonObject=>!!value&&typeof value==='object'&&!Array.isArray(value)
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):''
const parameterTypes=new Set<ToolParameterType>(['text','number','phone','email'])

export function normalizeToolRequestSchema(value:unknown):ToolRequestSchema{
  if(value===undefined||value===null)return{parameters:[]}
  if(!isObject(value))throw new Error('invalid_tool_request_schema')
  const raw=value.parameters
  if(raw===undefined)return{parameters:[]}
  if(!Array.isArray(raw)||raw.length>12)throw new Error(raw instanceof Array?'too_many_tool_parameters':'invalid_tool_request_schema')
  const seen=new Set<string>()
  const parameters=raw.map((entry,index)=>{
    if(!isObject(entry))throw new Error(`invalid_tool_parameter:${index}`)
    const key=clean(entry.key,64)
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))throw new Error(`invalid_tool_parameter_key:${index}`)
    const normalizedKey=key.toLowerCase();if(seen.has(normalizedKey))throw new Error('duplicate_tool_parameter_key');seen.add(normalizedKey)
    const labelAr=clean(entry.labelAr,120),labelEn=clean(entry.labelEn,120)
    if(!labelAr||!labelEn)throw new Error(`tool_parameter_labels_required:${index}`)
    const type=String(entry.type??'text') as ToolParameterType
    if(!parameterTypes.has(type))throw new Error(`invalid_tool_parameter_type:${index}`)
    return{key,labelAr,labelEn,type,required:entry.required!==false}
  })
  return{parameters}
}

const hasValue=(value:unknown)=>value!==null&&value!==undefined&&!(typeof value==='string'&&value.trim()==='')
const normalizedValue=(parameter:ToolRequestParameter,value:unknown):unknown=>{
  if(parameter.type==='number'){
    if(typeof value==='number'&&Number.isFinite(value))return value
    if(typeof value==='string'&&value.trim()&&Number.isFinite(Number(value)))return Number(value)
    return undefined
  }
  if(typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')return undefined
  const text=String(value).trim()
  if(!text||text.length>500)return undefined
  if(parameter.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return undefined
  if(parameter.type==='phone'&&!/^[0-9+() .-]{5,40}$/.test(text))return undefined
  return text
}

export function validateToolInput(schemaValue:unknown,input:JsonObject){
  const schema=normalizeToolRequestSchema(schemaValue)
  if(schema.parameters.length===0)return{schema,input,missing:[] as ToolRequestParameter[]}
  const sanitized:JsonObject={};const missing:ToolRequestParameter[]=[]
  for(const parameter of schema.parameters){
    const raw=input[parameter.key]
    if(!hasValue(raw)){if(parameter.required)missing.push(parameter);continue}
    const value=normalizedValue(parameter,raw)
    if(value===undefined){if(parameter.required)missing.push(parameter);continue}
    sanitized[parameter.key]=value
  }
  return{schema,input:sanitized,missing}
}

const arabicList=(values:string[])=>values.length<=1?(values[0]??''):values.length===2?`${values[0]} و${values[1]}`:`${values.slice(0,-1).join('، ')}، و${values.at(-1)}`
const englishList=(values:string[])=>values.length<=1?(values[0]??''):values.length===2?`${values[0]} and ${values[1]}`:`${values.slice(0,-1).join(', ')}, and ${values.at(-1)}`

export function missingToolParametersMessage(parameters:ToolRequestParameter[],language:'ar'|'en'){
  const labels=parameters.map(parameter=>language==='ar'?parameter.labelAr:parameter.labelEn)
  return language==='ar'?`لإكمال طلبك، أحتاج ${arabicList(labels)}.`:`To complete your request, I need ${englishList(labels)}.`
}

export function toolSchemaForPrompt(value:unknown){
  const schema=normalizeToolRequestSchema(value)
  if(!schema.parameters.length)return'no customer parameters'
  return schema.parameters.map(parameter=>`${parameter.key} (${parameter.type}, ${parameter.required?'required':'optional'}; ar="${parameter.labelAr}"; en="${parameter.labelEn}")`).join('; ')
}
