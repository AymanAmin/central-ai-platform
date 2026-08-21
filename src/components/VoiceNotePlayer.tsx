import { useEffect,useRef,useState } from 'react'

interface VoiceNotePlayerProps{
  src?:string|null
  durationMs?:number|null
  title:string
  voiceName?:string|null
  fallbackText?:string
  locale?:'ar'|'en'
}

const time=(seconds:number)=>{
  const total=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0))
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`
}

export function VoiceNotePlayer({src,durationMs,title,voiceName,fallbackText,locale='ar'}:VoiceNotePlayerProps){
  const audioRef=useRef<HTMLAudioElement|null>(null)
  const sourceLockedRef=useRef(false)
  const pendingSourceRef=useRef('')
  const [activeSrc,setActiveSrc]=useState(src??'')
  const [playing,setPlaying]=useState(false)
  const [currentTime,setCurrentTime]=useState(0)
  const [duration,setDuration]=useState(Math.max(0,Number(durationMs??0)/1000))
  const [failed,setFailed]=useState(!src)

  useEffect(()=>{
    const next=src??''
    if(sourceLockedRef.current){pendingSourceRef.current=next;return}
    setActiveSrc(next);setFailed(!next)
  },[src])

  useEffect(()=>{
    const hint=Math.max(0,Number(durationMs??0)/1000)
    if(hint>0)setDuration(current=>current>0?current:hint)
  },[durationMs])

  const adoptPendingSource=()=>{
    sourceLockedRef.current=false
    const pending=pendingSourceRef.current
    pendingSourceRef.current=''
    if(pending&&pending!==activeSrc){setActiveSrc(pending);setFailed(false)}
  }

  const toggle=async()=>{
    const audio=audioRef.current
    if(!audio||failed||!activeSrc)return
    if(!audio.paused){audio.pause();return}
    sourceLockedRef.current=true
    try{await audio.play()}catch{sourceLockedRef.current=false;setPlaying(false);setFailed(true)}
  }

  const seek=(value:number)=>{
    const audio=audioRef.current
    if(!audio||!Number.isFinite(value))return
    audio.currentTime=value;setCurrentTime(value)
  }

  const onError=()=>{
    setPlaying(false)
    const pending=pendingSourceRef.current
    if(pending&&pending!==activeSrc){
      sourceLockedRef.current=false;pendingSourceRef.current='';setFailed(false);setActiveSrc(pending);return
    }
    sourceLockedRef.current=false;setFailed(true)
  }

  if(failed||!activeSrc)return fallbackText?<div className="voice-note-fallback">{fallbackText}</div>:null

  const safeDuration=Math.max(duration,Number(durationMs??0)/1000,0)
  const progress=safeDuration>0?Math.min(100,Math.max(0,currentTime/safeDuration*100)):0
  const playLabel=locale==='ar'?'تشغيل الرسالة الصوتية':'Play voice message'
  const pauseLabel=locale==='ar'?'إيقاف الرسالة الصوتية مؤقتًا':'Pause voice message'
  const seekLabel=locale==='ar'?'موضع تشغيل الرسالة الصوتية':'Voice message position'

  return <div className="voice-note-player" dir={locale==='ar'?'rtl':'ltr'}>
    <audio
      ref={audioRef}
      src={activeSrc}
      preload="metadata"
      onLoadedMetadata={event=>{const value=event.currentTarget.duration;if(Number.isFinite(value)&&value>0)setDuration(value)}}
      onTimeUpdate={event=>setCurrentTime(event.currentTarget.currentTime)}
      onPlay={()=>{sourceLockedRef.current=true;setPlaying(true)}}
      onPause={()=>setPlaying(false)}
      onEnded={()=>{setPlaying(false);setCurrentTime(0);adoptPendingSource()}}
      onError={onError}
    />
    <button type="button" className="voice-note-play" onClick={()=>void toggle()} aria-label={playing?pauseLabel:playLabel}>
      {playing?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>}
    </button>
    <div className="voice-note-body">
      <div className="voice-note-head"><strong>{title}</strong>{voiceName&&<span>{voiceName}</span>}</div>
      <div className="voice-note-track">
        <div className="voice-note-wave" aria-hidden="true">{Array.from({length:18},(_,index)=><i key={index}/>)}</div>
        <input aria-label={seekLabel} type="range" min="0" max={safeDuration||1} step="0.05" value={Math.min(currentTime,safeDuration||0)} onChange={event=>seek(Number(event.target.value))} style={{background:`linear-gradient(to right,var(--chat-accent) ${progress}%,rgba(68,101,99,.16) ${progress}%)`}}/>
      </div>
      <div className="voice-note-time"><span>{time(currentTime)}</span><span>{time(safeDuration)}</span></div>
    </div>
  </div>
}
