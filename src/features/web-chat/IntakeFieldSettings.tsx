import { useI18n } from '../../lib/i18n'
import { customerIntakeKeys,type CustomerIntakeFieldKey,type CustomerIntakeFields } from './intakeConfig'

const fieldLabels:Record<CustomerIntakeFieldKey,{ar:string;en:string;hintAr:string;hintEn:string}>={
  firstName:{ar:'الاسم الأول',en:'First name',hintAr:'يُستخدم في تحية العميل وحفظ الاسم.',hintEn:'Used to greet the customer and save their name.'},
  lastName:{ar:'الاسم الأخير',en:'Last name',hintAr:'يُضاف إلى الاسم الكامل للعميل.',hintEn:'Added to the customer full name.'},
  phone:{ar:'رقم الجوال',en:'Mobile number',hintAr:'يُحفظ في بيانات العميل ويمكن للوكيل استخدامه للأدوات.',hintEn:'Saved on the customer and can be used by agent tools.'},
  email:{ar:'البريد الإلكتروني',en:'Email',hintAr:'يُحفظ في بيانات العميل.',hintEn:'Saved on the customer profile.'},
  question:{ar:'السؤال',en:'Question',hintAr:'إذا أدخله العميل يبدأ به المحادثة مباشرة.',hintEn:'When entered, it becomes the first chat message.'},
}

export function IntakeFieldSettings({value,onChange}:{value:CustomerIntakeFields;onChange:(next:CustomerIntakeFields)=>void}){
  const {tr}=useI18n()
  const update=(key:CustomerIntakeFieldKey,patch:Partial<{visible:boolean;required:boolean}>)=>{
    const current=value[key]
    const nextVisible=patch.visible??current.visible
    onChange({...value,[key]:{visible:nextVisible,required:nextVisible&&(patch.required??current.required)}})
  }
  return <section className="intake-config span-2" aria-labelledby="intake-config-title">
    <div className="intake-config-head">
      <div><strong id="intake-config-title">{tr('بيانات العميل قبل المحادثة','Pre-chat customer fields')}</strong><p>{tr('تحكم بما يظهر للعميل، وحدد إن كان كل حقل إجباريًا أو اختياريًا.','Choose which fields customers see and whether each one is required or optional.')}</p></div>
      <span>{tr('5 حقول ثابتة وآمنة','5 safe fixed fields')}</span>
    </div>
    <div className="intake-config-list">
      {customerIntakeKeys.map(key=>{
        const meta=fieldLabels[key],rule=value[key]
        return <div className={`intake-config-row${rule.visible?'':' is-hidden'}`} key={key}>
          <div className="intake-config-copy"><strong>{tr(meta.ar,meta.en)}</strong><small>{tr(meta.hintAr,meta.hintEn)}</small></div>
          <div className="intake-config-controls">
            <label className="compact-toggle"><span>{tr('إظهار','Show')}</span><input type="checkbox" checked={rule.visible} onChange={event=>update(key,{visible:event.target.checked})}/></label>
            <label className="compact-toggle"><span>{tr('إجباري','Required')}</span><input type="checkbox" checked={rule.required} disabled={!rule.visible} onChange={event=>update(key,{required:event.target.checked})}/></label>
          </div>
        </div>
      })}
    </div>
  </section>
}
