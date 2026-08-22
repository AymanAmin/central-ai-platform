import { FieldHint } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
import { emptyToolParameter,type ToolParameter,type ToolParameterType } from './toolSchema'

export function ToolParameterEditor({value,onChange}:{value:ToolParameter[];onChange:(next:ToolParameter[])=>void}){
  const {tr}=useI18n()
  const update=(index:number,patch:Partial<ToolParameter>)=>onChange(value.map((row,rowIndex)=>rowIndex===index?{...row,...patch}:row))
  const remove=(index:number)=>onChange(value.filter((_,rowIndex)=>rowIndex!==index))
  const add=()=>{if(value.length<12)onChange([...value,emptyToolParameter()])}
  return <section className="tool-parameter-editor span-2">
    <div className="tool-parameter-head">
      <div className="tool-parameter-title">
        <span className="tool-parameter-kicker">{tr('مدخلات الأداة','Tool inputs')}</span>
        <strong>{tr('متغيرات نقطة الاتصال','Endpoint variables')}</strong>
        <p>{tr('عرّف البيانات التي يحتاجها الـ endpoint. الوكيل سيطلب القيم الناقصة من العميل قبل تنفيذ الأداة.','Define the values the endpoint needs. The agent asks the customer for missing values before executing the tool.')}</p>
      </div>
      <div className="tool-parameter-head-actions">
        <span className="tool-parameter-count" aria-label={tr(`${value.length} من 12 متغيرًا`,`${value.length} of 12 variables`)}>{value.length}<small>/12</small></span>
        <button type="button" className="small ghost" onClick={add} disabled={value.length>=12}>+ {tr('إضافة متغير','Add variable')}</button>
      </div>
    </div>
    {value.length===0?<div className="tool-parameter-empty"><span className="tool-parameter-empty-mark" aria-hidden="true"/><div><strong>{tr('لا توجد متغيرات بعد','No variables yet')}</strong><p>{tr('ستعمل الأداة بدون بيانات من العميل. أضف متغيرًا عندما يحتاج الـ endpoint إلى قيمة مثل رقم الملف أو الهوية.','The tool will run without customer-provided input. Add a variable when the endpoint needs a value such as a file number or ID.')}</p></div></div>:<div className="tool-parameter-list">{value.map((row,index)=><div className="tool-parameter-row" key={`${row.key}-${index}`}>
      <label>{tr('اسم المتغير','Variable key')}<input required dir="ltr" maxLength={64} value={row.key} onChange={event=>update(index,{key:event.target.value})} placeholder="file_number"/><FieldHint>{tr('حروف إنجليزية وأرقام و underscore فقط.','English letters, numbers, and underscore only.')}</FieldHint></label>
      <label>{tr('الاسم بالعربية','Arabic label')}<input required maxLength={120} value={row.labelAr} onChange={event=>update(index,{labelAr:event.target.value})} placeholder="رقم الملف"/></label>
      <label>{tr('الاسم بالإنجليزية','English label')}<input required dir="ltr" maxLength={120} value={row.labelEn} onChange={event=>update(index,{labelEn:event.target.value})} placeholder="File number"/></label>
      <label>{tr('نوع القيمة','Value type')}<select value={row.type} onChange={event=>update(index,{type:event.target.value as ToolParameterType})}><option value="text">{tr('نص','Text')}</option><option value="number">{tr('رقم','Number')}</option><option value="phone">{tr('جوال','Phone')}</option><option value="email">{tr('بريد','Email')}</option></select></label>
      <label className="compact-toggle parameter-required"><span>{tr('إجباري','Required')}</span><input type="checkbox" checked={row.required} onChange={event=>update(index,{required:event.target.checked})}/></label>
      <button type="button" className="small danger-action parameter-remove" onClick={()=>remove(index)}>{tr('إزالة','Remove')}</button>
    </div>)}</div>}
    <div className="tool-parameter-note"><span aria-hidden="true">i</span><FieldHint>{tr('GET يرسل القيم كـ query parameters. POST يرسلها داخل JSON body. لا يستطيع النموذج إضافة مفاتيح غير معرفة هنا عند وجود متغيرات معرفة.','GET sends values as query parameters. POST sends them in the JSON body. When variables are defined, the model cannot add undeclared keys.')}</FieldHint></div>
  </section>
}
