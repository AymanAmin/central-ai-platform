import type { PropsWithChildren, ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

export function Card({children,className=''}:PropsWithChildren<{className?:string}>){return <section className={`card ${className}`}>{children}</section>}
export function PageHeader({title,description,actions}:{title:string;description?:string;actions?:ReactNode}){const {tr}=useI18n();return <header className="page-header"><div className="page-heading"><span className="page-kicker">{tr('مساحة التحكم','Control workspace')}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="actions">{actions}</div>}</header>}
export function Empty({children}:PropsWithChildren){return <div className="empty"><span className="empty-mark" aria-hidden="true"/><div>{children}</div></div>}
export function Badge({children,tone='neutral'}:PropsWithChildren<{tone?:'neutral'|'good'|'warn'|'bad'}>){return <span className={`badge ${tone}`}>{children}</span>}
export function Spinner(){const {tr}=useI18n();return <div className="spinner" role="status" aria-label={tr('جارٍ التحميل','Loading')} />}
export function ErrorNotice({message}:{message:string}){return <div className="notice error" role="alert">{message}</div>}
export function SuccessNotice({message}:{message:string}){return <div className="notice success" role="status">{message}</div>}
