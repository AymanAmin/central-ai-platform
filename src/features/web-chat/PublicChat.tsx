import { useEffect,useMemo,useRef,useState } from 'react'
import { VoiceNotePlayer } from '../../components/VoiceNotePlayer'
import { customerDisplayName,customerIntakeKeys,normalizeCustomerIntakeFields,type CustomerIntakeFieldKey } from './intakeConfig'
import { loadWidgetConfig,loadWidgetDirectory,sendWidgetMessage,sendWidgetVoice,startWidgetConversation,syncWidgetConversation,widgetSession,type WidgetAudio,type WidgetCustomerInput,type WidgetDirectoryItem,type WidgetHistoryMessage,type WidgetPublicConfig,type WidgetSession } from './chatClient'

type Lang='ar'|'en'
type ChatItem={id:string;role:'assistant'|'user';text:string;createdAt?:string;actions?:Array<Record<string,unknown>>;source?:string;agentName?:string|null;voiceInput?:boolean;audio?:WidgetAudio|null}
type SyncOptions={before?:string;prependOlder?:boolean}

const HISTORY_PAGE_SIZE=20
const VOICE_REPLY_GRACE_MS=45_000
const hashWidget=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('widget')??''
const label=(lang:Lang,ar:string,en:string)=>lang==='ar'?ar:en
const fromHistory=(items:WidgetHistoryMessage[]):ChatItem[]=>items.map(item=>({id:item.id,role:item.role,text:item.text,createdAt:item.createdAt,actions:item.actions,source:item.source,agentName:item.agentName,voiceInput:item.voiceInput,audio:item.audio}))
const clock=(ms:number)=>{const total=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`}
const nextPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
const personalWelcome=(welcome:string,name:string,lang:Lang)=>{
  const customer=name.trim();if(!customer)return welcome
  if(lang==='ar'){
    const rest=welcome.trim().replace(/^(?:مرحب(?:اً|ًا)|أهلاً|أهلًا|ياهلا|هلا)[،,\s]*/u,'').trim()
    return `ياهلا ${customer}، ${rest||'كيف أقدر أساعدك؟'}`
  }
  const rest=welcome.trim().replace(/^(?:hello|hi|welcome)[,!\s]*/i,'').trim()
  return `Hello ${customer}, ${rest||'how can I help you?'}`
}
const mergeHistory=(existing:ChatItem[],incoming:ChatItem[],prependOlder=false)=>{
  const welcome=existing.find(item=>item.id==='welcome')
  const stable=existing.filter(item=>item.id!=='welcome'&&!item.id.startsWith('pending-')&&!item.id.startsWith('voice-pending-'))
  const map=new Map<string,ChatItem>(),source=prependOlder?[...incoming,...stable]:[...stable,...incoming]
  source.forEach(item=>map.set(item.id,item))
  const merged=[...map.values()].sort((a,b)=>Date.parse(a.createdAt??'')-Date.parse(b.createdAt??''))
  return welcome?[welcome,...merged]:merged
}
const latestCreatedAt=(items:ChatItem[])=>items.reduce((latest,item)=>{const value=item.createdAt??'';return value&&(!latest||Date.parse(value)>Date.parse(latest))?value:latest},'')

export function PublicChat(){
  const [directory,setDirectory]=useState<WidgetDirectoryItem[]>([]),[selectedKey,setSelectedKey]=useState(hashWidget),[config,setConfig]=useState<WidgetPublicConfig|null>(null)
  const [language,setLanguage]=useState<Lang>('ar'),[started,setStarted]=useState(false),[panelOpen,setPanelOpen]=useState(false),[unreadCount,setUnreadCount]=useState(0)
  const [hasMore,setHasMore]=useState(false),[nextBefore,setNextBefore]=useState<string|null>(null),[historyLoading,setHistoryLoading]=useState(false)
  const [firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[customerPhone,setCustomerPhone]=useState(''),[customerEmail,setCustomerEmail]=useState(''),[initialQuestion,setInitialQuestion]=useState('')
  const [messages,setMessages]=useState<ChatItem[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState(''),[humanTakeover,setHumanTakeover]=useState(false),[session,setSession]=useState<WidgetSession|null>(null)
  const [recording,setRecording]=useState(false),[recordingMs,setRecordingMs]=useState(0)
  const endRef=useRef<HTMLDivElement|null>(null),recorderRef=useRef<MediaRecorder|null>(null),streamRef=useRef<MediaStream|null>(null),chunksRef=useRef<Blob[]>([]),recordStartedRef=useRef(0),recordTimerRef=useRef<number|null>(null),cancelRecordingRef=useRef(false),sendLockRef=useRef(false),panelOpenRef=useRef(false),lastSeenAtRef=useRef(''),historyExpandedRef=useRef(false)

  useEffect(()=>{panelOpenRef.current=panelOpen},[panelOpen])
  const stopMedia=()=>{if(recordTimerRef.current!==null){window.clearInterval(recordTimerRef.current);recordTimerRef.current=null}streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;recorderRef.current=null;setRecording(false);setRecordingMs(0)}
  const seenStorageKey=(widgetKey:string)=>`central-ai:${widgetKey}:seen-at`
  const readSeen=(widgetKey:string)=>{try{return localStorage.getItem(seenStorageKey(widgetKey))??''}catch{return''}}
  const persistSeen=(widgetKey:string,value:string)=>{if(!value)return;lastSeenAtRef.current=value;try{localStorage.setItem(seenStorageKey(widgetKey),value)}catch{/* optional */}}
  const markSeen=(widget:WidgetPublicConfig,items:ChatItem[])=>{const latest=latestCreatedAt(items);if(latest)persistSeen(widget.key,latest);setUnreadCount(0)}
  const updateUnread=(widget:WidgetPublicConfig,history:ChatItem[])=>{
    const latest=latestCreatedAt(history);if(!latest)return
    if(panelOpenRef.current){persistSeen(widget.key,latest);setUnreadCount(0);return}
    const seen=lastSeenAtRef.current||readSeen(widget.key);if(!seen){persistSeen(widget.key,latest);return}
    const seenMs=Date.parse(seen);setUnreadCount(history.filter(item=>item.role==='assistant'&&Date.parse(item.createdAt??'')>seenMs).length)
  }
  const sync=async(widget:WidgetPublicConfig,current:WidgetSession,options:SyncOptions={})=>{
    const snapshot=await syncWidgetConversation(widget.key,{visitorId:current.visitorId,conversationId:current.conversationId,limit:HISTORY_PAGE_SIZE,before:options.before})
    setHumanTakeover(snapshot.humanTakeover)
    if(snapshot.conversationId&&snapshot.conversationId!==current.conversationId){const adopted=current.adopt(snapshot.conversationId);setSession({...current,conversationId:adopted,hasExistingConversation:true})}
    const history=fromHistory(snapshot.messages)
    if(options.prependOlder)setMessages(existing=>mergeHistory(existing,history,true))
    else if(snapshot.exists){setMessages(existing=>mergeHistory(existing,history,false));updateUnread(widget,history)}
    if(options.prependOlder||!historyExpandedRef.current){setHasMore(snapshot.hasMore);setNextBefore(snapshot.nextBefore??null)}
    return Boolean(snapshot.exists&&snapshot.messages.length)
  }

  useEffect(()=>{
    let cancelled=false
    if(selectedKey){
      void loadWidgetConfig(selectedKey).then(async widget=>{if(cancelled)return;setConfig(widget);setLanguage(widget.organization.defaultLanguage==='en'?'en':'ar');lastSeenAtRef.current=readSeen(widget.key);const current=widgetSession(widget.key);setSession(current);try{const resumed=await sync(widget,current);if(!cancelled&&resumed)setStarted(true)}catch{/* stale local state must not block a new chat */}}).catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:'widget_load_failed')})
      return()=>{cancelled=true}
    }
    void loadWidgetDirectory().then(items=>{if(!cancelled)setDirectory(items)}).catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:'directory_load_failed')})
    return()=>{cancelled=true}
  },[selectedKey])
  const newestMessageId=messages[messages.length-1]?.id??''
  useEffect(()=>{if(panelOpen)endRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[newestMessageId,busy,panelOpen])
  useEffect(()=>{
    if(!started||!config||!session)return
    let stopped=false
    const refresh=()=>{if(document.visibilityState==='visible'&&!sendLockRef.current)void sync(config,session).catch(()=>undefined)}
    const timer=window.setInterval(()=>{if(!stopped)refresh()},panelOpen?3500:7500)
    const onVisibility=()=>{if(document.visibilityState==='visible')refresh()};document.addEventListener('visibilitychange',onVisibility)
    return()=>{stopped=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)}
  },[started,config?.key,session?.conversationId,panelOpen])
  useEffect(()=>()=>{try{if(recorderRef.current?.state==='recording')recorderRef.current.stop()}catch{/* no-op */}stopMedia()},[])

  const orgName=useMemo(()=>config?(language==='ar'?config.organization.nameAr:config.organization.nameEn||config.organization.nameAr):'',[config,language])
  const title=config?(language==='ar'?config.titleAr:config.titleEn):'Central AI',welcome=config?(language==='ar'?config.welcomeAr:config.welcomeEn):'',placeholder=config?(language==='ar'?config.placeholderAr:config.placeholderEn):'',suggestions=config?(language==='ar'?config.suggestionsAr:config.suggestionsEn):[]
  const voiceReplyMode=config?.voiceReplyMode??'text_only',intakeFields=normalizeCustomerIntakeFields(config?.intakeFields),displayName=customerDisplayName(firstName,lastName)
  const customerInput:WidgetCustomerInput={firstName:firstName||undefined,lastName:lastName||undefined,name:displayName||undefined,email:customerEmail||undefined,phone:customerPhone||undefined}
  const intakeValues:Record<CustomerIntakeFieldKey,string>={firstName,lastName,phone:customerPhone,email:customerEmail,question:initialQuestion}
  const intakeReady=customerIntakeKeys.every(key=>!intakeFields[key].visible||!intakeFields[key].required||Boolean(intakeValues[key].trim()))
  const openPanel=()=>{setPanelOpen(true);if(config)markSeen(config,messages)}
  const closePanel=()=>{stopMedia();setPanelOpen(false)}
  const choose=(key:string)=>{stopMedia();historyExpandedRef.current=false;setError('');setConfig(null);setStarted(false);setMessages([]);setHasMore(false);setNextBefore(null);setUnreadCount(0);setHumanTakeover(false);setSelectedKey(key);setFirstName('');setLastName('');setCustomerPhone('');setCustomerEmail('');setInitialQuestion('')}

  const send=async(value?:string,forcedSession?:WidgetSession,existingPendingId?:string)=>{
    if(!config||sendLockRef.current||recording)return
    const message=(value??text).trim();if(!message)return
    const current=forcedSession??session??widgetSession(config.key);if(!session)setSession(current)
    sendLockRef.current=true;const pendingId=existingPendingId??`pending-${crypto.randomUUID()}`;setText('');setError('')
    if(!existingPendingId)setMessages(items=>[...items,{id:pendingId,role:'user',text:message,createdAt:new Date().toISOString()}])
    await nextPaint();setBusy(true)
    try{
      const response=await sendWidgetMessage(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,messageId:crypto.randomUUID(),text:message,language,customer:customerInput})
      try{await sync(config,current)}catch{if(response.answer)setMessages(items=>[...items,{id:`reply-${crypto.randomUUID()}`,role:'assistant',text:response.answer,createdAt:new Date().toISOString(),actions:response.actions,audio:response.voiceReply}])}
    }catch(err){setMessages(items=>items.map(item=>item.id===pendingId?{...item,text:`${item.text} · ${label(language,'تعذر الإرسال','Send failed')}`}:item));setError(err instanceof Error?err.message:label(language,'تعذر إرسال الرسالة.','Message could not be sent.'))}finally{setBusy(false);sendLockRef.current=false}
  }
  const start=async(event?:React.FormEvent)=>{
    event?.preventDefault();if(!config||starting||!intakeReady)return
    const current=session??widgetSession(config.key);setSession(current);setStarting(true);setError('')
    const question=intakeFields.question.visible?initialQuestion.trim():'';const pendingId=question?`pending-${crypto.randomUUID()}`:''
    const welcomeItem:ChatItem={id:'welcome',role:'assistant',text:personalWelcome(welcome,firstName.trim()||displayName,language),createdAt:new Date().toISOString()}
    setMessages(question?[welcomeItem,{id:pendingId,role:'user',text:question,createdAt:new Date().toISOString()}]:[welcomeItem]);setStarted(true);setInitialQuestion('');await nextPaint()
    try{await startWidgetConversation(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,language,customer:customerInput});if(question)await send(question,current,pendingId);else markSeen(config,[welcomeItem])}catch(err){setStarted(false);setMessages([]);setError(err instanceof Error?err.message:label(language,'تعذر بدء المحادثة.','Unable to start the chat.'))}finally{setStarting(false)}
  }
  const newChat=()=>{if(!config)return;stopMedia();const current=session??widgetSession(config.key),conversationId=current.reset();setSession({...current,conversationId,hasExistingConversation:false});historyExpandedRef.current=false;setMessages([{id:'welcome',role:'assistant',text:personalWelcome(welcome,firstName.trim()||displayName,language),createdAt:new Date().toISOString()}]);setHasMore(false);setNextBefore(null);setHumanTakeover(false);setUnreadCount(0);setError('')}
  const loadOlder=async()=>{if(!config||!session||!hasMore||!nextBefore||historyLoading)return;setHistoryLoading(true);try{await sync(config,session,{before:nextBefore,prependOlder:true});historyExpandedRef.current=true}catch(err){setError(err instanceof Error?err.message:label(language,'تعذر تحميل الرسائل الأقدم.','Older messages could not be loaded.'))}finally{setHistoryLoading(false)}}

  const voiceError=(value:string)=>value.includes('voice_not_enabled')?label(language,'الرسائل الصوتية غير مفعّلة لهذه الجهة.','Voice messages are not enabled for this organization.'):value.includes('voice_duration_exceeded')?label(language,`الرسالة الصوتية أطول من الحد المسموح (${config?.maxVoiceSeconds??120} ثانية).`,`Voice message exceeds the allowed limit (${config?.maxVoiceSeconds??120} seconds).`):value.includes('voice_monthly_limit_exceeded')?label(language,'تم الوصول إلى حد الدقائق الصوتية في باقة هذه الجهة.','This organization has reached its monthly voice-minute allowance.'):value.includes('unsupported_audio_type')?label(language,'صيغة التسجيل غير مدعومة على هذا الجهاز.','This device produced an unsupported audio format.'):label(language,'تعذر معالجة الرسالة الصوتية. حاول مرة أخرى.','The voice message could not be processed. Please try again.')
  const submitVoice=async(audio:Blob,durationMs:number)=>{
    if(!config||sendLockRef.current)return
    const current=session??widgetSession(config.key);if(!session)setSession(current);const pendingId=`voice-pending-${crypto.randomUUID()}`
    sendLockRef.current=true;setError('');setMessages(items=>[...items,{id:pendingId,role:'user',voiceInput:true,text:label(language,'🎙 رسالة صوتية — جارٍ تحويلها إلى نص…','🎙 Voice message — transcribing…'),createdAt:new Date().toISOString()}]);await nextPaint();setBusy(true)
    try{const response=await sendWidgetVoice(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,messageId:crypto.randomUUID(),audio,durationMs,language,customer:customerInput});try{await sync(config,current)}catch{if(response.transcript)setMessages(items=>items.map(item=>item.id===pendingId?{...item,text:response.transcript!,voiceInput:true}:item));if(response.answer)setMessages(items=>[...items,{id:`reply-${crypto.randomUUID()}`,role:'assistant',text:response.answer,createdAt:new Date().toISOString(),actions:response.actions,audio:response.voiceReply}])}}catch(err){setMessages(items=>items.filter(item=>item.id!==pendingId));setError(voiceError(err instanceof Error?err.message:'voice_failed'))}finally{setBusy(false);sendLockRef.current=false}
  }
  const startRecording=async()=>{
    if(!config?.voiceEnabled||sendLockRef.current||recording)return
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError(label(language,'المتصفح لا يدعم تسجيل الصوت.','This browser does not support audio recording.'));return}
    setError('');cancelRecordingRef.current=false;chunksRef.current=[]
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});streamRef.current=stream
      const mimeType=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type))??''
      const recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);recorderRef.current=recorder
      recorder.ondataavailable=event=>{if(event.data.size>0)chunksRef.current.push(event.data)}
      recorder.onerror=()=>{setError(label(language,'تعذر تسجيل الصوت من الميكروفون.','Microphone recording failed.'));stopMedia()}
      recorder.onstop=()=>{const duration=Math.max(250,Date.now()-recordStartedRef.current),cancelled=cancelRecordingRef.current,blob=new Blob(chunksRef.current,{type:recorder.mimeType||chunksRef.current[0]?.type||'audio/webm'});stopMedia();chunksRef.current=[];if(!cancelled&&blob.size>0)void submitVoice(blob,duration)}
      recordStartedRef.current=Date.now();setRecording(true);setRecordingMs(0);recorder.start(250);recordTimerRef.current=window.setInterval(()=>{const elapsed=Date.now()-recordStartedRef.current;setRecordingMs(elapsed);if(elapsed>=config.maxVoiceSeconds*1000&&recorder.state==='recording')recorder.stop()},250)
    }catch{stopMedia();setError(label(language,'اسمح بالوصول إلى الميكروفون لإرسال رسالة صوتية.','Allow microphone access to send a voice message.'))}
  }
  const finishRecording=()=>{if(recorderRef.current?.state==='recording')recorderRef.current.stop()}
  const cancelRecording=()=>{cancelRecordingRef.current=true;if(recorderRef.current?.state==='recording')recorderRef.current.stop();else stopMedia()}
  const action=(item:Record<string,unknown>)=>{const type=typeof item.type==='string'?item.type:'',actionLabel=typeof item.label==='string'?item.label:'';if(type==='open_url'&&typeof item.url==='string'){window.open(item.url,'_blank','noopener,noreferrer');return}if(type==='call_phone'&&typeof item.phone==='string'){location.href=`tel:${item.phone}`;return}if((type==='reply_option'||type==='custom')&&actionLabel)void send(typeof item.value==='string'?item.value:actionLabel)}
  const fieldTitle=(ar:string,en:string,key:CustomerIntakeFieldKey)=><>{label(language,ar,en)}{intakeFields[key].required?<span className="public-chat-required" aria-hidden="true">*</span>:<span className="public-chat-optional">{label(language,'اختياري','optional')}</span>}</>
  const position=config?.position==='bottom_left'?'left':'right',displayMessages=messages

  return <div className="public-chat-page" dir={language==='ar'?'rtl':'ltr'}>
    <div className="public-chat-atmosphere" aria-hidden="true"><span/><span/></div>
    <div className={`public-chat-floating ${position}${panelOpen?' open':''}`}>
      {panelOpen&&<main className={`public-chat-shell${started?' is-chat':' is-entry'}`} style={{'--chat-accent':config?.primaryColor??'#167D74'} as React.CSSProperties}>
        <header className="public-chat-header"><div className="public-chat-agent"><span className="public-chat-agent-avatar">✦</span><div><strong>{config?title:'Central AI'}</strong><small><i/>{started&&humanTakeover?label(language,'موظف الدعم يتابع المحادثة','A support agent is handling this chat'):config?`${orgName} · ${label(language,'متصل','Online')}`:label(language,'اختر الجهة للبدء','Choose an organization to begin')}</small></div></div><div className="public-chat-head-actions"><button onClick={()=>setLanguage(current=>current==='ar'?'en':'ar')} aria-label={label(language,'تغيير اللغة','Change language')}>{language==='ar'?'EN':'AR'}</button>{started&&config&&<button onClick={newChat} aria-label={label(language,'محادثة جديدة','New chat')}>↻</button>}<button className="public-chat-minimize" onClick={closePanel} aria-label={label(language,'تصغير الدردشة','Minimize chat')}>—</button></div></header>
        {!started&&<section className="public-chat-start-scroll">
          <div className="public-chat-entry-copy"><span className="public-chat-eyebrow">{label(language,'ابدأ من هنا','Start here')}</span><h1>{label(language,'ابدأ محادثتك','Start your conversation')}</h1><p>{label(language,'تُحفظ المحادثة على هذا الجهاز، ويمكنك تصغير النافذة والعودة إليها في أي وقت.','This device keeps your conversation so you can minimize it and return at any time.')}</p></div>
          {!hashWidget()&&<label className="public-chat-field"><span>{label(language,'الجهة','Organization')}</span><select value={selectedKey} onChange={event=>choose(event.target.value)}><option value="">{label(language,'اختر جهة…','Choose an organization…')}</option>{directory.map(item=><option value={item.key} key={item.key}>{language==='ar'?item.organization.nameAr:item.organization.nameEn||item.organization.nameAr}</option>)}</select></label>}
          {config&&<div className="public-chat-agent-card" style={{'--chat-accent':config.primaryColor} as React.CSSProperties}><span className="public-chat-agent-avatar">✦</span><div><strong>{title}</strong><small>{orgName}{config.agentName?` · ${config.agentName}`:''}{config.voiceEnabled?` · ${label(language,'صوت','Voice')}`:''}</small></div><span className="public-chat-live-dot">{label(language,'متصل','Online')}</span></div>}
          <form onSubmit={start}>{config&&<div className="public-chat-intake-grid">
            {intakeFields.firstName.visible&&<label className="public-chat-field"><span>{fieldTitle('الاسم الأول','First name','firstName')}</span><input required={intakeFields.firstName.required} autoComplete="given-name" value={firstName} onChange={event=>setFirstName(event.target.value)} placeholder={label(language,'مثال: محمد','e.g. Alex')}/></label>}
            {intakeFields.lastName.visible&&<label className="public-chat-field"><span>{fieldTitle('الاسم الأخير','Last name','lastName')}</span><input required={intakeFields.lastName.required} autoComplete="family-name" value={lastName} onChange={event=>setLastName(event.target.value)} placeholder={label(language,'مثال: أحمد','e.g. Smith')}/></label>}
            {intakeFields.phone.visible&&<label className="public-chat-field"><span>{fieldTitle('رقم الجوال','Mobile number','phone')}</span><input required={intakeFields.phone.required} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={customerPhone} onChange={event=>setCustomerPhone(event.target.value)} placeholder="05xxxxxxxx"/></label>}
            {intakeFields.email.visible&&<label className="public-chat-field"><span>{fieldTitle('البريد الإلكتروني','Email','email')}</span><input required={intakeFields.email.required} type="email" autoComplete="email" dir="ltr" value={customerEmail} onChange={event=>setCustomerEmail(event.target.value)} placeholder="name@example.com"/></label>}
            {intakeFields.question.visible&&<label className="public-chat-field public-chat-question"><span>{fieldTitle('السؤال','Question','question')}</span><textarea required={intakeFields.question.required} value={initialQuestion} onChange={event=>setInitialQuestion(event.target.value)} placeholder={label(language,'اكتب سؤالك لبدء المحادثة مباشرة…','Write your question to start the chat immediately…')}/></label>}
          </div>}<div className="public-chat-entry-actions"><button type="submit" disabled={!config||!intakeReady||starting}>{starting?label(language,'جارٍ البدء…','Starting…'):label(language,'بدء المحادثة','Start chat')}</button></div></form>{error&&<div className="public-chat-error" role="alert">{error}</div>}
        </section>}
        {started&&config&&<>
          <div className="public-chat-context"><span>{humanTakeover?label(language,'دعم بشري','HUMAN SUPPORT'):label(language,'مباشر','LIVE')}</span><p>{label(language,'يمكنك تصغير الدردشة؛ سننبهك عند وصول رد جديد.','You can minimize the chat; we will badge new replies.')}</p></div>
          <section className="public-chat-messages" aria-live="polite">{hasMore&&<div className="public-chat-history-control"><button type="button" disabled={historyLoading} onClick={()=>void loadOlder()}>{historyLoading?label(language,'جارٍ التحميل…','Loading…'):label(language,'عرض رسائل أقدم','Show older messages')}</button></div>}
            {displayMessages.map((item,index)=>{const assistantVoice=item.role==='assistant'&&item.audio?.source==='assistant_tts'&&Boolean(item.audio.url);let previousUser:ChatItem|undefined;for(let cursor=index-1;cursor>=0;cursor-=1){const candidate=displayMessages[cursor];if(candidate?.role==='user'){previousUser=candidate;break}}const expectsVoice=item.role==='assistant'&&item.source!=='human'&&item.id!=='welcome'&&config.voiceEnabled&&(voiceReplyMode==='always_voice'||(voiceReplyMode==='voice_for_voice'&&Boolean(previousUser?.voiceInput)));const createdAtMs=Date.parse(item.createdAt??'');const voicePreparing=expectsVoice&&!assistantVoice&&Number.isFinite(createdAtMs)&&Date.now()-createdAtMs<VOICE_REPLY_GRACE_MS;return <article key={item.id} className={`public-chat-message ${item.role}${assistantVoice?' has-voice-reply':''}`}>{assistantVoice?<VoiceNotePlayer src={item.audio?.url} durationMs={item.audio?.durationMs} title={label(language,'رد صوتي','Voice reply')} voiceName={item.audio?.voiceName} fallbackText={item.text} locale={language}/>:voicePreparing?<div className="voice-note-fallback" role="status">🔊 {label(language,'جارٍ تجهيز الرد الصوتي…','Preparing the voice reply…')}</div>:<><div>{item.text}</div>{item.voiceInput&&<small className="voice-origin-label">🎙 {label(language,'النص مُفرّغ من رسالة صوتية','Text transcribed from a voice message')}</small>}{item.audio?.url&&<VoiceNotePlayer src={item.audio.url} durationMs={item.audio.durationMs} title={item.audio.source==='customer_voice'?label(language,'رسالة صوتية','Voice message'):label(language,'رد صوتي','Voice reply')} voiceName={item.audio.voiceName} locale={language}/>}</>}{item.source==='human'&&<small>{item.agentName?`${label(language,'الموظف','Agent')}: ${item.agentName}`:label(language,'رد موظف الدعم','Support agent reply')}</small>}{item.actions?.length?<div className="public-chat-message-actions">{item.actions.map((entry,actionIndex)=>typeof entry.label==='string'?<button key={`${item.id}-${actionIndex}`} onClick={()=>action(entry)}>{entry.label}</button>:null)}</div>:null}</article>})}
            {messages.length===1&&suggestions.length>0&&<div className="public-chat-suggestions">{suggestions.map(suggestion=><button key={suggestion} onClick={()=>void send(suggestion)}>{suggestion}</button>)}</div>}{busy&&<div className="public-chat-typing" aria-label={label(language,'جارٍ تجهيز الرد','Preparing reply')}><span/><span/><span/></div>}{error&&<div className="public-chat-error" role="alert">{error}</div>}<div ref={endRef}/>
          </section>
          <form className={`public-chat-composer${config.voiceEnabled?' voice-enabled':''}${recording?' is-recording':''}`} onSubmit={event=>{event.preventDefault();void send()}}>{config.voiceEnabled&&<button type="button" className={`public-chat-mic${recording?' active':''}`} disabled={busy&&!recording} onClick={()=>recording?finishRecording():void startRecording()} aria-label={recording?label(language,'إيقاف وإرسال التسجيل','Stop and send recording'):label(language,'تسجيل رسالة صوتية','Record a voice message')}>🎙</button>}{recording?<div className="public-chat-recording"><span className="public-chat-record-dot"/><div><strong>{clock(recordingMs)}</strong><small>{label(language,'اضغط الميكروفون للإرسال','Tap the microphone to send')}</small></div><button type="button" onClick={cancelRecording} aria-label={label(language,'إلغاء التسجيل','Cancel recording')}>×</button></div>:<textarea rows={1} value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}} placeholder={placeholder} disabled={busy}/>}<button className="public-chat-send" disabled={busy||recording||!text.trim()} aria-label={label(language,'إرسال','Send')}>↑</button></form>
        </>}
        <footer className="public-chat-footer">Central AI · {config?.voiceEnabled?label(language,`نص وصوت آمن · حتى ${config.maxVoiceSeconds} ثانية`,`Secure text & voice · up to ${config.maxVoiceSeconds}s`):label(language,'محادثة آمنة مرتبطة بالجهة','Secure organization-scoped chat')}</footer>
      </main>}
      <button className="public-chat-launcher" type="button" onClick={()=>panelOpen?closePanel():openPanel()} aria-expanded={panelOpen} aria-label={panelOpen?label(language,'تصغير الدردشة','Minimize chat'):label(language,'فتح الدردشة','Open chat')} style={{'--chat-accent':config?.primaryColor??'#167D74'} as React.CSSProperties}>{unreadCount>0&&<span className="public-chat-unread" aria-label={label(language,`${unreadCount} رسائل جديدة`,`${unreadCount} new messages`)}>{unreadCount>99?'99+':unreadCount}</span>}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 17.5 4 20v-4.2A7.8 7.8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8-4 8-9 8c-2 0-3.8-.5-5.5-1.4Z"/></svg></button>
    </div>
  </div>
}
