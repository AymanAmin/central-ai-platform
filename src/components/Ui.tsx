import type { PropsWithChildren, ReactNode } from 'react'

export function Card({children,className=''}:PropsWithChildren<{className?:string}>){return <section className={`card ${className}`}>{children}</section>}
export function PageHeader({title,description,actions}:{title:string;description?:string;actions?:ReactNode}){return <header className="page-header"><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="actions">{actions}</div>}</header>}
export function Empty({children}:PropsWithChildren){return <div className="empty">{children}</div>}
export function Badge({children,tone='neutral'}:PropsWithChildren<{tone?:'neutral'|'good'|'warn'|'bad'}>){return <span className={`badge ${tone}`}>{children}</span>}
export function Spinner(){return <div className="spinner" aria-label="Loading" />}
export function ErrorNotice({message}:{message:string}){return <div className="notice error">{message}</div>}
export function SuccessNotice({message}:{message:string}){return <div className="notice success">{message}</div>}
