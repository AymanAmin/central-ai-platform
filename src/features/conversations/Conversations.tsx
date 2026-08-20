import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { resourceAdmin } from '../../lib/resourceAdmin'
import { Badge, Card, Empty, PageHeader, PanelHeader } from '../../components/Ui'
import type { Conversation } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

interface Message{id:string;role:string;direction:string;content:string|null;intent:string|null;confidence:number|null;requires_human:boolean;created_at:string}

export function Conversations(){
  const {tr,formatDate,valueLabel}=useI18n();const [rows,setRows]=useState<Conversation[]>([]);const [selected,setSelected]=useState('');const [messages,setMessages]=useState<Message[]>([]);const [message,setMessage]=useState('')
  const load=async()=>{const result=await supabase.from('conversations').select('*').order('last_message_at',{ascending:false}).limit(100);setRows((result.data??[]) as Conversation[])}
  useEffect(()=>{void load()},[])
  useEffect(()=>{if(!selected){setMessages([]);return}void supabase.from('messages').select('id,role,direction,content,intent,confidence,requires_human,created_at').eq('conversation_id',selected).order('created_at').then(result=>setMessages((result.data??[]) as Message[]))},[selected])
  const selectedRow=rows.find(row=>row.id===selected)??null
  const setStatus=async(row:Conversation,status:'open'|'closed')=>{if(status==='closed'&&!confirm(tr('إغلاق المحادثة؟ سيتم إنهاء وضع الاستلام البشري أيضًا.','Close this conversation? Human takeover will also end.')))return;try{await resourceAdmin({action:'set_conversation_status',id:row.id,status});setMessage(status==='closed'?tr('تم إغلاق المحادثة.','Conversation closed.'):tr('تمت إعادة فتح المحادثة.','Conversation reopened.'));await load()}catch(err){setMessage(err instanceof Error?err.message:tr('تعذر تغيير حالة المحادثة.','Unable to change conversation status.'))}}

  return <div className="screen screen-conversations">
    <PageHeader title={tr('المحادثات','Conversations')} description={tr('سجل المحادثة تاريخ تشغيلي؛ لذلك لا يُحذف. يمكن إغلاق المحادثة أو إعادة فتحها حسب سير العمل.','Conversation history is an operational record and is not deleted. You can close or reopen a conversation as workflow requires.')}/>
    {message&&<div className="inline-feedback" role="status">{message}</div>}
    <div className="split">
      <Card><PanelHeader title={tr('قائمة المحادثات','Conversation list')} meta={<Badge>{rows.length}</Badge>}/>{rows.length===0?<Empty>{tr('لا توجد محادثات.','No conversations found.')}</Empty>:rows.map(row=><button className={`list-row ${selected===row.id?'selected':''}`} key={row.id} onClick={()=>setSelected(row.id)}><strong>{row.external_conversation_id}</strong><span>{valueLabel(row.channel)} · {valueLabel(row.status)}</span><small>{formatDate(row.last_message_at)}</small></button>)}</Card>
      <Card><div className="management-toolbar"><div><h2>{tr('الخط الزمني','Timeline')}</h2>{selectedRow&&<Badge tone={selectedRow.status==='closed'?'bad':'good'}>{valueLabel(selectedRow.status)}</Badge>}</div>{selectedRow&&<div className="actions">{selectedRow.status==='closed'?<button className="small success-action" onClick={()=>void setStatus(selectedRow,'open')}>{tr('إعادة فتح','Reopen')}</button>:<button className="small warning-action" onClick={()=>void setStatus(selectedRow,'closed')}>{tr('إغلاق المحادثة','Close conversation')}</button>}</div>}</div>{messages.length===0?<Empty>{tr('اختر محادثة لعرض الرسائل.','Select a conversation to view messages.')}</Empty>:<div className="timeline">{messages.map(item=><div key={item.id} className={`bubble ${item.role}`}><div>{item.content}</div><small>{tr('النية','Intent')}: {valueLabel(item.intent)} · {tr('الثقة','Confidence')}: {item.confidence??'—'} {item.requires_human?`· ${tr('يتطلب موظفًا','Human required')}`:''}</small></div>)}</div>}</Card>
    </div>
  </div>
}
