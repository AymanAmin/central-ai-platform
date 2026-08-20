import type { Profile } from '../types/domain'

export type AppRole=Profile['role']
export type PageKey=
  |'dashboard'|'setup'|'organizations'|'users'|'api-clients'|'integration'
  |'knowledge'|'playground'|'ai-settings'|'prompts'|'tools'
  |'customers'|'conversations'|'handoff'|'usage'|'audit'

const rolePages:Record<AppRole,ReadonlySet<PageKey>>={
  SUPER_ADMIN:new Set<PageKey>([
    'dashboard','setup','organizations','users','api-clients','integration','knowledge','playground','ai-settings','prompts','tools',
    'customers','conversations','handoff','usage','audit',
  ]),
  ORGANIZATION_ADMIN:new Set<PageKey>([
    'dashboard','users','api-clients','integration','knowledge','playground','ai-settings','prompts','tools',
    'customers','conversations','handoff','usage','audit',
  ]),
  KNOWLEDGE_MANAGER:new Set<PageKey>(['dashboard','knowledge','playground']),
  SUPPORT_AGENT:new Set<PageKey>(['dashboard','customers','conversations','handoff']),
  VIEWER:new Set<PageKey>(['dashboard','customers','conversations','usage','audit']),
}

export const isPageKey=(value:string):value is PageKey=>Object.prototype.hasOwnProperty.call(pageOwners,value)

const pageOwners:Record<PageKey,true>={
  dashboard:true,setup:true,organizations:true,users:true,'api-clients':true,integration:true,
  knowledge:true,playground:true,'ai-settings':true,prompts:true,tools:true,
  customers:true,conversations:true,handoff:true,usage:true,audit:true,
}

export function canAccessPage(role:AppRole,page:string):page is PageKey{
  return isPageKey(page)&&rolePages[role].has(page)
}
