import { useEffect,useMemo,useRef,useState } from 'react'
import { loadWidgetConfig,loadWidgetDirectory,sendWidgetMessage,widgetSession,type WidgetDirectoryItem,type WidgetPublicConfig } from './chatClient'

type Lang='ar'|'en'
type ChatItem={id:string;role:'assistant'|'user';text:string;actions?:Array<Record<string,unknown>>}

const hashWidget=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('widget')??''
const label=(lang:Lang,ar:string,en:string)=>lang==='ar'?ar:en

export function PublicChat(){
  const [directory,setDirectory]=useState<WidgetDirectoryItem[]>([])
  const [selectedKey,setSelectedKey]=useState(hashWidget)
  const [config,setConfig]=useState<WidgetPublicConfig|null>(null)
  const [language,setLanguage]=useState<Lang>('ar')
  const [started,setStarted]=useState(false)
  const [customerName,setCustomerName]=useState('')
  const [customerEmail,setCustomerEmail]=useState('')
  const [messages,setMessages]=useState<ChatItem[]>([])
  const [text,setText]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [session,setSession]=useState<{visitorId:string;conversationId:string;reset:()=>string}|null>(null)
  const endRef=useRef<HTMLDivElement|null>(null)

  useEffect(()=>{
    if(selectedKey){void loadWidgetConfig(selectedKey).then(widget=>{setConfig(widget);setLanguage(widget.organization.defaultLanguage==='en'?'en':'ar')}).catch(err=>setError(err instanceof Error?err.message:'widget_load_failed'));return}
    void loadWidgetDirectory().then(setDirectory).catch(err=>setError(err instanceof Error?err.message:'directory_load_failed'))
  },[selectedKey])
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[messages,busy])

  const orgName=useMemo(()=>config?(language==='ar'?config.organization.nameAr:config.organization.nameEn||config.organization.nameAr):'',[config,language])
  const title=config?(language==='ar'?config.titleAr:config.titleEn):''
  const welcome=config?(language==='ar'?config.welcomeAr:config.welcomeEn):''
  const placeholder=config?(language==='ar'?config.placeholderAr:config.placeholderEn):''
  const suggestions=config?(language==='ar'?config.suggestionsAr:config.suggestionsEn):[]

  const choose=(key:string)=>{setError('');setConfig(null);setSelectedKey(key)}
  const start=()=>{
    if(!config)return
    const next=widgetSession(config.key);setSession(next);setStarted(true);setMessages([{id:crypto.randomUUID(),role:'assistant',text:welcome}])
  }
  const newChat=()=>{
    if(!config)return
    const current=session??widgetSession(config.key);const conversationId=current.reset();setSession({...current,conversationId});setMessages([{id:crypto.randomUUID(),role:'assistant',text:welcome}]);setError('')
  }
  const send=async(value?:string)=>{
    if(!config||busy)return
    const message=(value??text).trim();if(!message)return
    const current=session??widgetSession(config.key);if(!session)setSession(current)
    setText('');setError('');setMessages(items=>[...items,{id:crypto.randomUUID(),role:'user',text:message}]);setBusy(true)
    try{
      const response=await sendWidgetMessage(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,messageId:crypto.randomUUID(),text:message,language,customer:{name:customerName||undefined,email:customerEmail||undefined}})
      setMessages(items=>[...items,{id:crypto.randomUUID(),role:'assistant',text:response.answer||label(language,'تم استلام رسالتك.','Your message was received.'),actions:response.actions}])
    }catch(err){setError(err instanceof Error?err.message:label(language,'تعذر إرسال الرسالة.','Message could not be sent.'))}finally{setBusy(false)}
  }
  const action=(item:Record<string,unknown>)=>{
    const type=typeof item.type==='string'?item.type:'';const actionLabel=typeof item.label==='string'?item.label:''
    if(type==='open_url'&&typeof item.url==='string'){window.open(item.url,'_blank','noopener,noreferrer');return}
    if(type==='call_phone'&&typeof item.phone==='string'){location.href=`tel:${item.phone}`;return}
    if((type==='reply_option'||type==='custom')&&actionLabel)void send(typeof item.value==='string'?item.value:actionLabel)
  }

  return <div className="public-chat-page" dir={language==='ar'?'rtl':'ltr'}>
    <div className="public-chat-atmosphere" aria-hidden="true"><span/><span/></div>
    {!started&&<main className="public-chat-entry">
      <div className="public-chat-brand"><span className="public-chat-brandmark" aria-hidden="true">AI</span><div><strong>Central AI</strong><small>{label(language,'محادثة خارجية حقيقية','Live external chat')}</small></div></div>
      <section className="public-chat-entry-card">
        <div className="public-chat-entry-copy"><span className="public-chat-eyebrow">{label(language,'قبل بدء المحادثة','Before you start')}</span><h1>{label(language,'اختر الجهة ثم ابدأ محادثة حقيقية','Choose the organization, then start a real conversation')}</h1><p>{label(language,'هذه المحادثة تستخدم نفس الذاكرة وقاعدة المعرفة والتحويل البشري المستخدمة في القنوات الفعلية.','This conversation uses the same memory, knowledge and human-handoff pipeline as production channels.')}</p></div>
        {!hashWidget()&&<label className="public-chat-field"><span>{label(language,'الجهة','Organization')}</span><select value={selectedKey} onChange={event=>choose(event.target.value)}><option value="">{label(language,'اختر جهة…','Choose an organization…')}</option>{directory.map(item=><option value={item.key} key={item.key}>{language==='ar'?item.organization.nameAr:item.organization.nameEn||item.organization.nameAr}</option>)}</select></label>}
        {config&&<div className="public-chat-agent-card" style={{'--chat-accent':config.primaryColor} as React.CSSProperties}><span className="public-chat-agent-avatar">✦</span><div><strong>{title}</strong><small>{orgName}{config.agentName?` · ${config.agentName}`:''}</small></div><span className="public-chat-live-dot">{label(language,'متصل','Online')}</span></div>}
        <div className="public-chat-form-grid"><label className="public-chat-field"><span>{label(language,'الاسم (اختياري)','Name (optional)')}</span><input value={customerName} onChange={event=>setCustomerName(event.target.value)} placeholder={label(language,'مثال: محمد أحمد','e.g. Alex Smith')}/></label><label className="public-chat-field"><span>{label(language,'البريد (اختياري)','Email (optional)')}</span><input type="email" dir="ltr" value={customerEmail} onChange={event=>setCustomerEmail(event.target.value)} placeholder="name@example.com"/></label></div>
        <div className="public-chat-entry-actions"><button disabled={!config} onClick={start}>{label(language,'بدء المحادثة','Start chat')}</button><button className="public-chat-language" onClick={()=>setLanguage(current=>current==='ar'?'en':'ar')}>{language==='ar'?'English':'العربية'}</button></div>
        {error&&<div className="public-chat-error" role="alert">{error}</div>}
      </section>
    </main>}

    {started&&config&&<main className="public-chat-shell" style={{'--chat-accent':config.primaryColor} as React.CSSProperties}>
      <header className="public-chat-header"><div className="public-chat-agent"><span className="public-chat-agent-avatar">✦</span><div><strong>{title}</strong><small><i/>{orgName} · {label(language,'متصل','Online')}</small></div></div><div className="public-chat-head-actions"><button onClick={()=>setLanguage(current=>current==='ar'?'en':'ar')} aria-label={label(language,'تغيير اللغة','Change language')}>{language==='ar'?'EN':'AR'}</button><button onClick={newChat} aria-label={label(language,'محادثة جديدة','New chat')}>↻</button></div></header>
      <div className="public-chat-context"><span>{label(language,'اختبار مباشر','LIVE TEST')}</span><p>{label(language,'الرسائل هنا تُحفظ كمحادثة عميل فعلية داخل المنصة.','Messages here are stored as a real customer conversation in the platform.')}</p></div>
      <section className="public-chat-messages" aria-live="polite">{messages.map(item=><article key={item.id} className={`public-chat-message ${item.role}`}><div>{item.text}</div>{item.actions?.length?<div className="public-chat-message-actions">{item.actions.map((entry,index)=>typeof entry.label==='string'?<button key={`${item.id}-${index}`} onClick={()=>action(entry)}>{entry.label}</button>:null)}</div>:null}</article>)}{messages.length===1&&suggestions.length>0&&<div className="public-chat-suggestions">{suggestions.map(suggestion=><button key={suggestion} onClick={()=>void send(suggestion)}>{suggestion}</button>)}</div>}{busy&&<div className="public-chat-typing" aria-label={label(language,'المساعد يكتب','Assistant is typing')}><span/><span/><span/></div>}{error&&<div className="public-chat-error" role="alert">{error}</div>}<div ref={endRef}/></section>
      <form className="public-chat-composer" onSubmit={event=>{event.preventDefault();void send()}}><textarea rows={1} value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}} placeholder={placeholder} disabled={busy}/><button disabled={busy||!text.trim()} aria-label={label(language,'إرسال','Send')}>↑</button></form>
      <footer className="public-chat-footer">Central AI · {label(language,'محادثة آمنة مرتبطة بالجهة','Secure organization-scoped chat')}</footer>
    </main>}
  </div>
}
