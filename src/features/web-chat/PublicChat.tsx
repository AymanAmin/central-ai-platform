import { useEffect,useMemo,useRef,useState } from 'react'
import { VoiceNotePlayer } from '../../components/VoiceNotePlayer'
import { loadWidgetConfig,loadWidgetDirectory,sendWidgetMessage,sendWidgetVoice,syncWidgetConversation,widgetSession,type WidgetAudio,type WidgetDirectoryItem,type WidgetHistoryMessage,type WidgetPublicConfig,type WidgetSession } from './chatClient'

type Lang='ar'|'en'
type ChatItem={id:string;role:'assistant'|'user';text:string;actions?:Array<Record<string,unknown>>;source?:string;agentName?:string|null;voiceInput?:boolean;audio?:WidgetAudio|null}

const hashWidget=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('widget')??''
const label=(lang:Lang,ar:string,en:string)=>lang==='ar'?ar:en
const fromHistory=(items:WidgetHistoryMessage[]):ChatItem[]=>items.map(item=>({id:item.id,role:item.role,text:item.text,actions:item.actions,source:item.source,agentName:item.agentName,voiceInput:item.voiceInput,audio:item.audio}))
const clock=(ms:number)=>{const total=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`}

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
  const [humanTakeover,setHumanTakeover]=useState(false)
  const [session,setSession]=useState<WidgetSession|null>(null)
  const [recording,setRecording]=useState(false)
  const [recordingMs,setRecordingMs]=useState(0)
  const endRef=useRef<HTMLDivElement|null>(null)
  const recorderRef=useRef<MediaRecorder|null>(null)
  const streamRef=useRef<MediaStream|null>(null)
  const chunksRef=useRef<Blob[]>([])
  const recordStartedRef=useRef(0)
  const recordTimerRef=useRef<number|null>(null)
  const cancelRecordingRef=useRef(false)

  const stopMedia=()=>{
    if(recordTimerRef.current!==null){window.clearInterval(recordTimerRef.current);recordTimerRef.current=null}
    streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null
    recorderRef.current=null;setRecording(false);setRecordingMs(0)
  }

  const sync=async(widget:WidgetPublicConfig,current:WidgetSession)=>{
    const snapshot=await syncWidgetConversation(widget.key,{visitorId:current.visitorId,conversationId:current.conversationId})
    setHumanTakeover(snapshot.humanTakeover)
    if(snapshot.conversationId&&snapshot.conversationId!==current.conversationId){
      const adopted=current.adopt(snapshot.conversationId)
      setSession({...current,conversationId:adopted,hasExistingConversation:true})
    }
    if(snapshot.exists&&snapshot.messages.length){setMessages(fromHistory(snapshot.messages));return true}
    return false
  }

  useEffect(()=>{
    let cancelled=false
    if(selectedKey){
      void loadWidgetConfig(selectedKey).then(async widget=>{
        if(cancelled)return
        setConfig(widget);setLanguage(widget.organization.defaultLanguage==='en'?'en':'ar')
        const current=widgetSession(widget.key);setSession(current)
        try{const resumed=await sync(widget,current);if(!cancelled&&resumed)setStarted(true)}catch{/* A stale local conversation must not block a new chat. */}
      }).catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:'widget_load_failed')})
      return()=>{cancelled=true}
    }
    void loadWidgetDirectory().then(items=>{if(!cancelled)setDirectory(items)}).catch(err=>{if(!cancelled)setError(err instanceof Error?err.message:'directory_load_failed')})
    return()=>{cancelled=true}
  },[selectedKey])

  const newestMessageId=messages[messages.length-1]?.id??''
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth',block:'end'})},[newestMessageId,busy])
  useEffect(()=>{
    if(!started||!config||!session)return
    let stopped=false
    const refresh=()=>{if(document.visibilityState==='visible')void sync(config,session).catch(()=>undefined)}
    const timer=window.setInterval(()=>{if(!stopped)refresh()},3500)
    const onVisibility=()=>{if(document.visibilityState==='visible')refresh()}
    document.addEventListener('visibilitychange',onVisibility)
    return()=>{stopped=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility)}
  },[started,config?.key,session?.conversationId])
  useEffect(()=>()=>{try{if(recorderRef.current?.state==='recording')recorderRef.current.stop()}catch{/* no-op */}stopMedia()},[])

  const orgName=useMemo(()=>config?(language==='ar'?config.organization.nameAr:config.organization.nameEn||config.organization.nameAr):'',[config,language])
  const title=config?(language==='ar'?config.titleAr:config.titleEn):''
  const welcome=config?(language==='ar'?config.welcomeAr:config.welcomeEn):''
  const placeholder=config?(language==='ar'?config.placeholderAr:config.placeholderEn):''
  const suggestions=config?(language==='ar'?config.suggestionsAr:config.suggestionsEn):[]

  const choose=(key:string)=>{stopMedia();setError('');setConfig(null);setStarted(false);setMessages([]);setHumanTakeover(false);setSelectedKey(key)}
  const start=async()=>{
    if(!config)return
    const current=session??widgetSession(config.key);setSession(current);setStarted(true);setError('')
    try{const resumed=await sync(config,current);if(!resumed)setMessages([{id:'welcome',role:'assistant',text:welcome}])}
    catch{setMessages([{id:'welcome',role:'assistant',text:welcome}])}
  }
  const newChat=()=>{
    if(!config)return
    stopMedia();const current=session??widgetSession(config.key);const conversationId=current.reset();setSession({...current,conversationId,hasExistingConversation:false});setMessages([{id:'welcome',role:'assistant',text:welcome}]);setHumanTakeover(false);setError('')
  }
  const send=async(value?:string)=>{
    if(!config||busy||recording)return
    const message=(value??text).trim();if(!message)return
    const current=session??widgetSession(config.key);if(!session)setSession(current)
    setText('');setError('');setMessages(items=>[...items,{id:`pending-${crypto.randomUUID()}`,role:'user',text:message}]);setBusy(true)
    try{
      const response=await sendWidgetMessage(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,messageId:crypto.randomUUID(),text:message,language,customer:{name:customerName||undefined,email:customerEmail||undefined}})
      try{await sync(config,current)}catch{if(response.answer)setMessages(items=>[...items,{id:`reply-${crypto.randomUUID()}`,role:'assistant',text:response.answer,actions:response.actions,audio:response.voiceReply}])}
    }catch(err){setError(err instanceof Error?err.message:label(language,'تعذر إرسال الرسالة.','Message could not be sent.'))}finally{setBusy(false)}
  }

  const voiceError=(value:string)=>value.includes('voice_not_enabled')?label(language,'الرسائل الصوتية غير مفعّلة لهذه الجهة.','Voice messages are not enabled for this organization.')
    :value.includes('voice_duration_exceeded')?label(language,`الرسالة الصوتية أطول من الحد المسموح (${config?.maxVoiceSeconds??120} ثانية).`,`Voice message exceeds the allowed limit (${config?.maxVoiceSeconds??120} seconds).`)
    :value.includes('voice_monthly_limit_exceeded')?label(language,'تم الوصول إلى حد الدقائق الصوتية في باقة هذه الجهة.','This organization has reached its monthly voice-minute allowance.')
    :value.includes('unsupported_audio_type')?label(language,'صيغة التسجيل غير مدعومة على هذا الجهاز.','This device produced an unsupported audio format.')
    :label(language,'تعذر معالجة الرسالة الصوتية. حاول مرة أخرى.','The voice message could not be processed. Please try again.')

  const submitVoice=async(audio:Blob,durationMs:number)=>{
    if(!config||busy)return
    const current=session??widgetSession(config.key);if(!session)setSession(current)
    const pendingId=`voice-${crypto.randomUUID()}`
    setBusy(true);setError('');setMessages(items=>[...items,{id:pendingId,role:'user',voiceInput:true,text:label(language,'🎙 رسالة صوتية — جارٍ تحويلها إلى نص…','🎙 Voice message — transcribing…')}])
    try{
      const response=await sendWidgetVoice(config.key,{visitorId:current.visitorId,conversationId:current.conversationId,messageId:crypto.randomUUID(),audio,durationMs,language,customer:{name:customerName||undefined,email:customerEmail||undefined}})
      try{await sync(config,current)}catch{
        if(response.transcript)setMessages(items=>items.map(item=>item.id===pendingId?{...item,text:response.transcript!,voiceInput:true}:item))
        if(response.answer)setMessages(items=>[...items,{id:`reply-${crypto.randomUUID()}`,role:'assistant',text:response.answer,actions:response.actions,audio:response.voiceReply}])
      }
    }catch(err){setMessages(items=>items.filter(item=>item.id!==pendingId));setError(voiceError(err instanceof Error?err.message:'voice_failed'))}finally{setBusy(false)}
  }

  const startRecording=async()=>{
    if(!config?.voiceEnabled||busy||recording)return
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError(label(language,'المتصفح لا يدعم تسجيل الصوت.','This browser does not support audio recording.'));return}
    setError('');cancelRecordingRef.current=false;chunksRef.current=[]
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      streamRef.current=stream
      const candidates=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4']
      const mimeType=candidates.find(type=>MediaRecorder.isTypeSupported(type))??''
      const recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);recorderRef.current=recorder
      recorder.ondataavailable=event=>{if(event.data.size>0)chunksRef.current.push(event.data)}
      recorder.onerror=()=>{setError(label(language,'تعذر تسجيل الصوت من الميكروفون.','Microphone recording failed.'));stopMedia()}
      recorder.onstop=()=>{
        const duration=Math.max(250,Date.now()-recordStartedRef.current)
        const cancelled=cancelRecordingRef.current
        const blob=new Blob(chunksRef.current,{type:recorder.mimeType||chunksRef.current[0]?.type||'audio/webm'})
        stopMedia();chunksRef.current=[]
        if(!cancelled&&blob.size>0)void submitVoice(blob,duration)
      }
      recordStartedRef.current=Date.now();setRecording(true);setRecordingMs(0);recorder.start(250)
      recordTimerRef.current=window.setInterval(()=>{
        const elapsed=Date.now()-recordStartedRef.current;setRecordingMs(elapsed)
        if(elapsed>=config.maxVoiceSeconds*1000&&recorder.state==='recording')recorder.stop()
      },250)
    }catch{stopMedia();setError(label(language,'اسمح بالوصول إلى الميكروفون لإرسال رسالة صوتية.','Allow microphone access to send a voice message.'))}
  }
  const finishRecording=()=>{if(recorderRef.current?.state==='recording')recorderRef.current.stop()}
  const cancelRecording=()=>{cancelRecordingRef.current=true;if(recorderRef.current?.state==='recording')recorderRef.current.stop();else stopMedia()}

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
        <div className="public-chat-entry-copy"><span className="public-chat-eyebrow">{label(language,'قبل بدء المحادثة','Before you start')}</span><h1>{label(language,'اختر الجهة ثم ابدأ محادثة حقيقية','Choose the organization, then start a real conversation')}</h1><p>{label(language,'عند عودتك من نفس الجهاز سنعيد فتح نفس المحادثة وسجل الرسائل تلقائيًا.','When you return on the same device, your conversation and message history resume automatically.')}</p></div>
        {!hashWidget()&&<label className="public-chat-field"><span>{label(language,'الجهة','Organization')}</span><select value={selectedKey} onChange={event=>choose(event.target.value)}><option value="">{label(language,'اختر جهة…','Choose an organization…')}</option>{directory.map(item=><option value={item.key} key={item.key}>{language==='ar'?item.organization.nameAr:item.organization.nameEn||item.organization.nameAr}</option>)}</select></label>}
        {config&&<div className="public-chat-agent-card" style={{'--chat-accent':config.primaryColor} as React.CSSProperties}><span className="public-chat-agent-avatar">✦</span><div><strong>{title}</strong><small>{orgName}{config.agentName?` · ${config.agentName}`:''}{config.voiceEnabled?` · ${label(language,'صوت','Voice')}`:''}</small></div><span className="public-chat-live-dot">{label(language,'متصل','Online')}</span></div>}
        <div className="public-chat-form-grid"><label className="public-chat-field"><span>{label(language,'الاسم (اختياري)','Name (optional)')}</span><input value={customerName} onChange={event=>setCustomerName(event.target.value)} placeholder={label(language,'مثال: محمد أحمد','e.g. Alex Smith')}/></label><label className="public-chat-field"><span>{label(language,'البريد (اختياري)','Email (optional)')}</span><input type="email" dir="ltr" value={customerEmail} onChange={event=>setCustomerEmail(event.target.value)} placeholder="name@example.com"/></label></div>
        <div className="public-chat-entry-actions"><button disabled={!config} onClick={()=>void start()}>{label(language,'بدء المحادثة','Start chat')}</button><button className="public-chat-language" onClick={()=>setLanguage(current=>current==='ar'?'en':'ar')}>{language==='ar'?'English':'العربية'}</button></div>
        {error&&<div className="public-chat-error" role="alert">{error}</div>}
      </section>
    </main>}

    {started&&config&&<main className="public-chat-shell" style={{'--chat-accent':config.primaryColor} as React.CSSProperties}>
      <header className="public-chat-header"><div className="public-chat-agent"><span className="public-chat-agent-avatar">✦</span><div><strong>{title}</strong><small><i/>{humanTakeover?label(language,'موظف الدعم يتابع المحادثة','A support agent is handling this chat'):orgName+' · '+label(language,'متصل','Online')}</small></div></div><div className="public-chat-head-actions"><button onClick={()=>setLanguage(current=>current==='ar'?'en':'ar')} aria-label={label(language,'تغيير اللغة','Change language')}>{language==='ar'?'EN':'AR'}</button><button onClick={newChat} aria-label={label(language,'محادثة جديدة','New chat')}>↻</button></div></header>
      <div className="public-chat-context"><span>{humanTakeover?label(language,'دعم بشري','HUMAN SUPPORT'):label(language,'اختبار مباشر','LIVE TEST')}</span><p>{label(language,'الرسائل الجديدة تظهر تلقائيًا دون إعادة تحميل الصفحة.','New messages appear automatically without reloading the page.')}</p></div>
      <section className="public-chat-messages" aria-live="polite">{messages.map(item=>{
        const assistantVoice=item.role==='assistant'&&item.audio?.source==='assistant_tts'&&Boolean(item.audio.url)
        return <article key={item.id} className={`public-chat-message ${item.role}${assistantVoice?' has-voice-reply':''}`}>
          {assistantVoice?<VoiceNotePlayer src={item.audio?.url} durationMs={item.audio?.durationMs} title={label(language,'رد صوتي','Voice reply')} voiceName={item.audio?.voiceName} fallbackText={item.text} locale={language}/>:<>
            <div>{item.text}</div>
            {item.voiceInput&&<small className="voice-origin-label">🎙 {label(language,'النص مُفرّغ من رسالة صوتية','Text transcribed from a voice message')}</small>}
            {item.audio?.url&&<VoiceNotePlayer src={item.audio.url} durationMs={item.audio.durationMs} title={item.audio.source==='customer_voice'?label(language,'رسالة صوتية','Voice message'):label(language,'رد صوتي','Voice reply')} voiceName={item.audio.voiceName} locale={language}/>} 
          </>}
          {item.source==='human'&&<small>{item.agentName?`${label(language,'الموظف','Agent')}: ${item.agentName}`:label(language,'رد موظف الدعم','Support agent reply')}</small>}
          {item.actions?.length?<div className="public-chat-message-actions">{item.actions.map((entry,index)=>typeof entry.label==='string'?<button key={`${item.id}-${index}`} onClick={()=>action(entry)}>{entry.label}</button>:null)}</div>:null}
        </article>
      })}{messages.length===1&&suggestions.length>0&&<div className="public-chat-suggestions">{suggestions.map(suggestion=><button key={suggestion} onClick={()=>void send(suggestion)}>{suggestion}</button>)}</div>}{busy&&<div className="public-chat-typing" aria-label={label(language,'جارٍ إرسال الرسالة','Sending message')}><span/><span/><span/></div>}{error&&<div className="public-chat-error" role="alert">{error}</div>}<div ref={endRef}/></section>
      <form className={`public-chat-composer${config.voiceEnabled?' voice-enabled':''}${recording?' is-recording':''}`} onSubmit={event=>{event.preventDefault();void send()}}>
        {config.voiceEnabled&&<button type="button" className={`public-chat-mic${recording?' active':''}`} disabled={busy&&!recording} onClick={()=>recording?finishRecording():void startRecording()} aria-label={recording?label(language,'إيقاف وإرسال التسجيل','Stop and send recording'):label(language,'تسجيل رسالة صوتية','Record a voice message')}>🎙</button>}
        {recording?<div className="public-chat-recording"><span className="public-chat-record-dot"/><div><strong>{clock(recordingMs)}</strong><small>{label(language,'اضغط الميكروفون للإرسال','Tap the microphone to send')}</small></div><button type="button" onClick={cancelRecording} aria-label={label(language,'إلغاء التسجيل','Cancel recording')}>×</button></div>:<textarea rows={1} value={text} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send()}}} placeholder={placeholder} disabled={busy}/>}<button className="public-chat-send" disabled={busy||recording||!text.trim()} aria-label={label(language,'إرسال','Send')}>↑</button>
      </form>
      <footer className="public-chat-footer">Central AI · {config.voiceEnabled?label(language,`نص وصوت آمن · حتى ${config.maxVoiceSeconds} ثانية`,`Secure text & voice · up to ${config.maxVoiceSeconds}s`):label(language,'محادثة آمنة مرتبطة بالجهة','Secure organization-scoped chat')}</footer>
    </main>}
  </div>
}