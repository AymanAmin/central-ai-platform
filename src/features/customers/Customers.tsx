import { useEffect,useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, Empty, PageHeader } from '../../components/Ui'
import type { Customer } from '../../types/domain'
import { useI18n } from '../../lib/i18n'
export function Customers(){const {tr,formatDate,valueLabel}=useI18n();const [rows,setRows]=useState<Customer[]>([]);useEffect(()=>{void supabase.from('customers').select('*').order('last_seen_at',{ascending:false}).limit(200).then(r=>setRows((r.data??[]) as Customer[]))},[]);return <><PageHeader title={tr('العملاء','Customers')}/><Card>{rows.length===0?<Empty>{tr('لا يوجد عملاء.','No customers found.')}</Empty>:<table><thead><tr><th>{tr('المعرف الخارجي','External ID')}</th><th>{tr('الاسم','Name')}</th><th>{tr('الهاتف','Phone')}</th><th>{tr('البريد','Email')}</th><th>{tr('اللغة','Language')}</th><th>{tr('آخر ظهور','Last seen')}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.external_customer_id}</td><td>{r.display_name??'—'}</td><td>{r.phone??'—'}</td><td>{r.email??'—'}</td><td>{valueLabel(r.language)}</td><td>{formatDate(r.last_seen_at)}</td></tr>)}</tbody></table>}</Card></>}
