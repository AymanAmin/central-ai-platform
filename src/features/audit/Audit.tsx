import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'
import { useI18n } from '../../lib/i18n'
interface Row{id:string;action:string;entity_type:string;entity_id:string|null;user_id:string|null;created_at:string}
export function Audit(){const {tr,formatDate}=useI18n();const [rows,setRows]=useState<Row[]>([]);useEffect(()=>{void supabase.from('audit_logs').select('id,action,entity_type,entity_id,user_id,created_at').order('created_at',{ascending:false}).limit(300).then(r=>setRows((r.data??[]) as Row[]))},[]);return <><PageHeader title={tr('سجل التدقيق','Audit Log')}/><Card>{rows.length===0?<Empty>{tr('لا توجد سجلات تدقيق.','No audit records found.')}</Empty>:<table><thead><tr><th>{tr('الإجراء','Action')}</th><th>{tr('الكيان','Entity')}</th><th>{tr('المستخدم','User')}</th><th>{tr('التاريخ','Date')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.action}</td><td>{r.entity_type} {r.entity_id?.slice(0,8)}</td><td>{r.user_id?.slice(0,8)??tr('النظام','system')}</td><td>{formatDate(r.created_at)}</td></tr>)}</tbody></table>}</Card></>}
