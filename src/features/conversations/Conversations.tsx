import { useEffect,useMemo,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { resourceAdmin } from '../../lib/resourceAdmin'
import { sendSupportMessage } from '../../lib/supportMessage'
import { Badge, Card, Empty, Modal, PageHeader, PanelHeader } from '../../components/Ui'
import type { Conversation, Customer, Profile } from '../../types/domain'
import { useI18n } from '../../lib/i18n'

interface Message{id:string;role:string;direction:string;content:string|null;content_json:Record<string,unknown>|null;intent:string|null;confidence:number|null;requires_human:boolean;created_at:string}
type HandoffReason='customer_requested'|'low_confidence'|'complaint'|'payment_issue'|'sensitive_request'|'tool_failed'|'manual'|'policy'

const conversationTargetKey='central-ai:selected-conversation'
const customerFilterKey='central-ai:customer-filter'
const reasons:HandoffReason[]=['manual','customer_requested','low_confidence','complaint','payment_issue','sensitive_request','tool_failed','policy']

export function Conversations({profile}:{profile:Profile}){
  const {tr,formatDate,valueLabel}=useI18n()
  const canOperate=profile.role!=='VIEWER'
  const [rows,setRows]=useState<Conversation[]>([])
  const [selected,setSelected]=useState(()=>sessionStorage.getItem(conversationTargetKey)??'')
  const [messages,setMessages]=useState<Message[]>([])
  const [customer,setCustomer]=useState<Customer|null>(null)
  const [notice,setNotice]=useState('')
  const [busy,setBusy]=useState('')
  const [search,setSearch]=useState('')
  const [statusFilter,setStatusFilter]=useState('all')
  const [customerFilter,setCustomerFilter]=useState(()=>sessionStorage.getItem(customerFilterKey)??'')
  const [handoffOpen,setHandoffOpen]=useState(false)
  const [handoffReason,setHandoffReason]=useState<HandoffReason>('manual')
  const [handoffNotes,setHandoffNotes]=useState('')
  const [replyText,setReplyText]=useState('')

  const load=async()=>{
    let query=supabase.from('conversations').select('*').order('last_message_at',{ascending:false}).limit(100)
    if(customerFilter)query=query.eq('customer_id',customerFilter)
    const result=await query
    const data=(result.data??[]) as Conversation[]
    setRows(data)
    const target=sessionStorage.getItem(conversationTargetKey)
    if(target&&data.some(row=>row.id===target))setSelected(target)
    sessionStorage.removeItem(conversationTargetKey)
    sessionStorage.removeItem(customerFilterKey)
  }
  const loadMessages=async(conversationId:string)=>{
    const result=await supabase.from('messages').select('id,role,direction,content,content_json,intent,confidence,requires_human,created_at').eq('conversation_id',conversationId).order('created_at')
    setMessages((result.data??[]) as Message[])
  }

  useEffect(()=>{void load()},[customerFilter])
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState==='visible')void load()}
    const timer=window.setInterval(refresh,5000)
    document.addEventListener('visibilitychange',refresh)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[customerFilter])
  useEffect(()=>{
    if(!selected){setMessages([]);return}
    void loadMessages(selected)
    const refresh=()=>{if(document.visibilityState==='visible')void loadMessages(selected)}
    const timer=window.setInterval(refresh,2500)
    document.addEventListener('visibilitychange',refresh)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[selected])

  const selectedRow=rows.find(row=>row.id===selected)??null
  useEffect(()=>{
    if(!selectedRow){setCustomer(null);return}
    void supabase.from('customers').select('*').eq('id',selectedRow.customer_id).single().then(result=>setCustomer((result.data??null) as Customer|null))
  },[selectedRow?.customer_id])

  const visibleRows=useMemo(()=>rows.filter(row=>{
    if(statusFilter!=='all'&&row.status!==statusFilter)return false
    if(!search.trim())return true
    const needle=search.trim().toLowerCase()
    return row.external_conversation_id.toLowerCase().includes(needle)||row.channel.toLowerCase().includes(needle)||row.status.toLowerCase().includes(needle)
  }),[rows,search,statusFilter])

  const run=async(action:string,success:string,extra:Record<string,unknown>={})=>{
    if(!selectedRow||busy)return
    setBusy(action);setNotice('')
    try{await resourceAdmin({action,id:selectedRow.id,...extra});setNotice(success);await load();await loadMessages(selectedRow.id)}
    catch(err){setNotice(valueLabel(err instanceof Error?err.message:tr('تعذر تنفيذ العملية.','Unable to complete the operation.')))}finally{setBusy('')}
  }
  const setStatus=async(status:'open'|'waiting_customer'|'closed'|'archived')=>{
    if((status==='closed'||status==='archived')&&!confirm(status==='closed'?tr('إغلاق المحادثة؟ سيُنهي أي تحويل بشري مفتوح.','Close this conversation? This ends any active human handoff.'):tr('أرشفة المحادثة؟ ستبقى محفوظة كسجل تاريخي.','Archive this conversation? It will remain available as historical record.')))return
    const success=status==='open'?tr('تمت إعادة فتح المحادثة.','Conversation reopened.'):status==='waiting_customer'?tr('تم وضع المحادثة بانتظار العميل.','Conversation is now waiting for the customer.'):status==='closed'?tr('تم إغلاق المحادثة.','Conversation closed.'):tr('تمت أرشفة المحادثة.','Conversation archived.')
    await run('set_conversation_status',success,{status})
  }
  const submitHandoff=async(e:React.FormEvent)=>{e.preventDefault();await run('request_handoff',tr('تم إرسال المحادثة إلى قائمة الدعم البشري.','Conversation sent to the human support queue.'),{reason:handoffReason,notes:handoffNotes});setHandoffOpen(false);setHandoffNotes('');setHandoffReason('manual')}
  const sendReply=async(e:React.FormEvent)=>{
    e.preventDefault();if(!selectedRow||busy||!replyText.trim())return
    setBusy('reply');setNotice('')
    try{await sendSupportMessage(selectedRow.id,replyText.trim());setReplyText('');setNotice(tr('تم إرسال الرد إلى العميل.','Reply sent to the customer.'));await Promise.all([load(),loadMessages(selectedRow.id)])}
    catch(err){setNotice(valueLabel(err instanceof Error?err.message:tr('تعذر إرسال الرد.','Unable to send reply.')))}finally{setBusy('')}
  }
  const clearCustomerFilter=()=>{setCustomerFilter('');setSelected('')}
  const statusTone=(status:string)=>status==='closed'||status==='archived'?'bad':status==='waiting_customer'||status==='waiting_human'?'warn':'good'
  const replyAllowed=Boolean(selectedRow&&canOperate&&selectedRow.human_takeover&&selectedRow.status==='human_assigned'&&selectedRow.assigned_user_id&&(profile.role!=='SUPPORT_AGENT'||selectedRow.assigned_user_id===profile.id))
  const waitingForClaim=Boolean(selectedRow?.human_takeover&&selectedRow.status==='waiting_human')

  return <div className="screen screen-conversations">
    <PageHeader title={tr('المحادثات','Conversations')} description={tr('مساحة تشغيل مباشرة: تصل رسائل العميل تلقائيًا، ويمكن للموظف المستلم الرد من نفس الشاشة.','Live support workspace: customer messages refresh automatically and the assigned agent can reply from the same screen.')} actions={<button className="ghost" onClick={()=>{location.hash='handoff'}}>{tr('قائمة التحويل البشري','Human handoff queue')}</button>}/>
    {notice&&<div className="inline-feedback" role="status">{notice}</div>}
    {customerFilter&&<div className="support-filter-banner"><span>{tr('يتم عرض محادثات العميل المحدد فقط.','Showing conversations for the selected customer only.')}</span><button className="small ghost" onClick={clearCustomerFilter}>{tr('إلغاء التصفية','Clear filter')}</button></div>}
    <div className="support-workspace">
      <Card className="support-inbox">
        <PanelHeader title={tr('صندوق المحادثات','Conversation inbox')} description={tr('يتحدث تلقائيًا أثناء بقاء الشاشة مفتوحة.','Automatically refreshes while this screen is open.')} meta={<Badge>{visibleRows.length}</Badge>}/>
        <div className="support-list-filters"><input aria-label={tr('بحث في المحادثات','Search conversations')} placeholder={tr('بحث بالمعرف أو القناة…','Search ID or channel…')} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label={tr('تصفية حسب الحالة','Filter by status')} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">{tr('كل الحالات','All statuses')}</option><option value="open">{valueLabel('open')}</option><option value="waiting_customer">{valueLabel('waiting_customer')}</option><option value="waiting_human">{valueLabel('waiting_human')}</option><option value="human_assigned">{valueLabel('human_assigned')}</option><option value="closed">{valueLabel('closed')}</option><option value="archived">{valueLabel('archived')}</option></select></div>
        {visibleRows.length===0?<Empty>{tr('لا توجد محادثات مطابقة.','No matching conversations found.')}</Empty>:<div className="support-conversation-list">{visibleRows.map(row=><button className={`list-row support-conversation-row ${selected===row.id?'selected':''}`} key={row.id} onClick={()=>setSelected(row.id)}><span className="support-row-main"><strong>{row.external_conversation_id}</strong><small>{valueLabel(row.channel)} · {formatDate(row.last_message_at)}</small></span><span className="support-row-state"><Badge tone={statusTone(row.status)}>{valueLabel(row.status)}</Badge>{row.human_takeover&&<small>{tr('تحكم بشري','Human')}</small>}</span></button>)}</div>}
      </Card>

      <div className="support-detail-stack">
        {!selectedRow?<Card className="support-detail-empty"><Empty>{tr('اختر محادثة من القائمة لعرض سجلها والعمليات المتاحة.','Select a conversation to see its history and available operations.')}</Empty></Card>:<>
          <Card className="support-operations-card">
            <div className="support-detail-heading"><div><span className="support-eyebrow">{tr('المحادثة النشطة','Active conversation')}</span><h2>{selectedRow.external_conversation_id}</h2><div className="support-status-line"><Badge tone={statusTone(selectedRow.status)}>{valueLabel(selectedRow.status)}</Badge><Badge tone={selectedRow.human_takeover?'warn':'good'}>{selectedRow.human_takeover?tr('التحكم: موظف','Control: Human'):tr('التحكم: AI','Control: AI')}</Badge><span>{valueLabel(selectedRow.channel)}</span></div></div>{canOperate&&<div className="support-primary-actions">{waitingForClaim?<button disabled={Boolean(busy)} onClick={()=>void run('take_conversation',tr('تم استلام المحادثة ويمكنك الرد الآن.','Conversation claimed. You can reply now.'))}>{tr('استلام المحادثة','Take over')}</button>:selectedRow.human_takeover?<button disabled={Boolean(busy)} className="success-action" onClick={()=>void run('resume_ai',tr('تم استئناف الذكاء الاصطناعي.','AI resumed.'))}>{tr('استئناف AI','Resume AI')}</button>:<button disabled={Boolean(busy)||['closed','archived'].includes(selectedRow.status)} onClick={()=>void run('take_conversation',tr('تم استلام المحادثة ويمكنك الرد الآن.','Conversation taken over. You can reply now.'))}>{tr('استلام المحادثة','Take over')}</button>}</div>}</div>
            {canOperate&&<div className="support-action-grid"><button className="ghost" disabled={Boolean(busy)||['closed','archived'].includes(selectedRow.status)} onClick={()=>setHandoffOpen(true)}><strong>{tr('تحويل لموظف','Send to agent queue')}</strong><span>{tr('إيقاف الرد الآلي ووضعها في قائمة الدعم.','Pause AI and place it in the support queue.')}</span></button><button className="ghost" disabled={Boolean(busy)||selectedRow.status==='waiting_customer'||['closed','archived'].includes(selectedRow.status)||selectedRow.human_takeover} onClick={()=>void setStatus('waiting_customer')}><strong>{tr('بانتظار العميل','Wait for customer')}</strong><span>{tr('استخدمها عندما يكون التحكم لدى AI.','Use this while AI controls the conversation.')}</span></button>{selectedRow.status==='closed'||selectedRow.status==='archived'?<button className="ghost" disabled={Boolean(busy)} onClick={()=>void setStatus('open')}><strong>{tr('إعادة فتح','Reopen')}</strong><span>{tr('إعادة المحادثة إلى قائمة العمل النشطة.','Return the conversation to the active queue.')}</span></button>:<button className="ghost warning-action" disabled={Boolean(busy)} onClick={()=>void setStatus('closed')}><strong>{tr('إغلاق المحادثة','Close conversation')}</strong><span>{tr('إنهاء المتابعة مع الاحتفاظ بالسجل.','End follow-up while preserving history.')}</span></button>}</div>}
          </Card>

          <Card className="support-customer-card"><PanelHeader title={tr('العميل','Customer')} description={tr('بيانات العميل المرتبط بهذه المحادثة.','Customer details linked to this conversation.')}/>{customer?<div className="support-customer-grid"><div><small>{tr('الاسم','Name')}</small><strong>{customer.display_name??'—'}</strong></div><div><small>{tr('المعرف الخارجي','External ID')}</small><code>{customer.external_customer_id}</code></div><div><small>{tr('الهاتف','Phone')}</small><span dir="ltr">{customer.phone??'—'}</span></div><div><small>{tr('البريد','Email')}</small><span dir="ltr">{customer.email??'—'}</span></div></div>:<Empty>{tr('تعذر تحميل بيانات العميل.','Customer details are unavailable.')}</Empty>}</Card>

          <Card className="support-timeline-card"><PanelHeader title={tr('الخط الزمني','Timeline')} description={tr('تظهر رسائل العميل وردود AI والموظف تلقائيًا.','Customer, AI, and human-agent messages appear automatically.')}/>{messages.length===0?<Empty>{tr('لا توجد رسائل في هذه المحادثة.','No messages in this conversation.')}</Empty>:<div className="timeline">{messages.map(item=>{const human=item.content_json?.source==='human';return <div key={item.id} className={`bubble ${item.role}${human?' human-message':''}`}><div>{item.content}</div><small>{human?`${tr('موظف الدعم','Support agent')}${typeof item.content_json?.agentName==='string'?`: ${item.content_json.agentName}`:''}`:`${tr('النية','Intent')}: ${valueLabel(item.intent)} · ${tr('الثقة','Confidence')}: ${item.confidence??'—'}`} · {formatDate(item.created_at)} {item.requires_human?`· ${tr('يتطلب موظفًا','Human required')}`:''}</small></div>})}</div>}</Card>

          {selectedRow.human_takeover&&<Card className="support-reply-card"><PanelHeader title={tr('الرد على العميل','Reply to customer')} description={replyAllowed?tr('أنت تتحكم بالمحادثة. سيظهر ردك للعميل تلقائيًا.','You control this conversation. Your reply will appear to the customer automatically.'):waitingForClaim?tr('استلم المحادثة أولًا لتفعيل الرد.','Take over the conversation first to enable replies.'):tr('هذه المحادثة مسندة لموظف آخر.','This conversation is assigned to another agent.')}/>{replyAllowed?<form className="support-reply-form" onSubmit={e=>void sendReply(e)}><textarea rows={3} maxLength={4000} value={replyText} onChange={e=>setReplyText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void sendReply(e as unknown as React.FormEvent)}}} placeholder={tr('اكتب رد الموظف هنا…','Type the agent reply here…')} disabled={Boolean(busy)}/><div className="support-reply-actions"><span>{tr('Enter للإرسال · Shift+Enter لسطر جديد','Enter to send · Shift+Enter for a new line')}</span><button disabled={Boolean(busy)||!replyText.trim()}>{busy==='reply'?tr('جارٍ الإرسال…','Sending…'):tr('إرسال للعميل','Send to customer')}</button></div></form>:<div className="support-reply-disabled">{waitingForClaim&&<button disabled={Boolean(busy)} onClick={()=>void run('take_conversation',tr('تم استلام المحادثة ويمكنك الرد الآن.','Conversation claimed. You can reply now.'))}>{tr('استلام المحادثة وبدء الرد','Take over and start replying')}</button>}</div>}</Card>}
        </>}
      </div>
    </div>

    <Modal open={handoffOpen} onClose={()=>setHandoffOpen(false)} title={tr('تحويل المحادثة لموظف','Send conversation to an agent')} description={tr('سيتم إيقاف ردود AI لهذه المحادثة حتى يستلمها موظف أو يتم استئناف AI.','AI replies will pause for this conversation until an agent claims it or AI is resumed.')}><form className="modal-stack" onSubmit={submitHandoff}><label>{tr('سبب التحويل','Handoff reason')}<select value={handoffReason} onChange={e=>setHandoffReason(e.target.value as HandoffReason)}>{reasons.map(reason=><option key={reason} value={reason}>{valueLabel(reason)}</option>)}</select></label><label>{tr('ملاحظات للموظف','Agent notes')}<textarea maxLength={1000} placeholder={tr('معلومة مختصرة تساعد الموظف عند الاستلام…','A short note that helps the agent when claiming…')} value={handoffNotes} onChange={e=>setHandoffNotes(e.target.value)}/></label><div className="form-actions"><button disabled={Boolean(busy)}>{tr('تحويل','Send to queue')}</button><button type="button" className="ghost" onClick={()=>setHandoffOpen(false)}>{tr('إلغاء','Cancel')}</button></div></form></Modal>
  </div>
}
