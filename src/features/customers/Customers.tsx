import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'
import type { Customer } from '../../types/domain'
export function Customers(){const [rows,setRows]=useState<Customer[]>([]);useEffect(()=>{void supabase.from('customers').select('*').order('last_seen_at',{ascending:false}).limit(200).then(r=>setRows((r.data??[]) as Customer[]))},[]);return <><PageHeader title="العملاء"/><Card>{rows.length===0?<Empty>لا يوجد عملاء.</Empty>:<table><thead><tr><th>External ID</th><th>الاسم</th><th>الهاتف</th><th>البريد</th><th>اللغة</th><th>آخر ظهور</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.external_customer_id}</td><td>{r.display_name??'—'}</td><td>{r.phone??'—'}</td><td>{r.email??'—'}</td><td>{r.language??'—'}</td><td>{new Date(r.last_seen_at).toLocaleString('ar-SA')}</td></tr>)}</tbody></table>}</Card></>}
