import { useEffect, type PropsWithChildren, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'

export function Card({children,className=''}:PropsWithChildren<{className?:string}>){return <section className={`card ${className}`}>{children}</section>}
export function PageHeader({title,description,actions}:{title:string;description?:string;actions?:ReactNode}){const {tr}=useI18n();return <header className="page-header"><div className="page-heading"><span className="page-kicker">{tr('مساحة التحكم','Control workspace')}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="actions">{actions}</div>}</header>}
export function PanelHeader({title,description,meta}:{title:string;description?:string;meta?:ReactNode}){return <div className="panel-header"><div className="panel-heading-copy"><h2>{title}</h2>{description&&<p>{description}</p>}</div>{meta&&<div className="panel-meta">{meta}</div>}</div>}
export function Empty({children}:PropsWithChildren){return <div className="empty"><span className="empty-mark" aria-hidden="true"/><div>{children}</div></div>}
export function Badge({children,tone='neutral'}:PropsWithChildren<{tone?:'neutral'|'good'|'warn'|'bad'}>){return <span className={`badge ${tone}`}>{children}</span>}
export function FieldHint({children}:PropsWithChildren){return <small className="field-help">{children}</small>}
export function Spinner(){const {tr}=useI18n();return <div className="spinner" role="status" aria-label={tr('جارٍ التحميل','Loading')} />}
export function ErrorNotice({message}:{message:string}){return <div className="notice error" role="alert">{message}</div>}
export function SuccessNotice({message}:{message:string}){return <div className="notice success" role="status">{message}</div>}

export function Modal({open,title,description,onClose,children,footer}:{open:boolean;title:string;description?:string;onClose:()=>void;children:ReactNode;footer?:ReactNode}){
  const {tr}=useI18n()
  useEffect(()=>{
    if(!open)return
    const previous=document.body.style.overflow
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()}
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',onKey)
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',onKey)}
  },[open,onClose])
  if(!open)return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="admin-modal-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div><button type="button" className="modal-close ghost" aria-label={tr('إغلاق','Close')} onClick={onClose}>×</button></header>
      <div className="admin-modal-body">{children}</div>
      {footer&&<footer className="admin-modal-footer">{footer}</footer>}
    </section>
  </div>
}
