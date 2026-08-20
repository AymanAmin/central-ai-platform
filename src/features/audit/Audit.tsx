import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'
interface Row{id:string;action:string;entity_type:string;entity_id:string|null;user_id:string|null;created_at:string}
export function Audit(){const [rows,setRows]=useState<Row[]>([]);useEffect(()=>{void supabase.from('audit_logs').select('id,action,entity_type,entity_id,user_id,created_at').order('created_at',{ascending:false}).limit(300).then(r=>setRows((r.data??[]) as Row[]))},[]);return <><PageHeader title="Audit"/><Card>{rows.length===0?<Empty>لا توجد سجلات Audit.</Empty>:<table><thead><tr><th>Action</th><th>Entity</th><th>User</th><th>Date</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.action}</td><td>{r.entity_type} {r.entity_id?.slice(0,8)}</td><td>{r.user_id?.slice(0,8)??'system'}</td><td>{new Date(r.created_at).toLocaleString('ar-SA')}</td></tr>)}</tbody></table>}</Card></>}
