import { functionsBaseUrl, supabase } from './supabase'

export type ProviderCatalogModel = {
  id: string
  name: string
  free: boolean
  contextLength: number | null
  structured: boolean
}

export type ProviderModelCatalog = {
  provider: string
  defaultChatModel: string
  defaultEmbeddingModel: string
  chatModels: ProviderCatalogModel[]
  embeddingModels: ProviderCatalogModel[]
  refreshedAt: string
}

export async function fetchProviderModelCatalog(provider: string): Promise<ProviderModelCatalog> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const response = await fetch(`${functionsBaseUrl}/model-catalog`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ provider }),
  })
  const payload = await response.json() as ProviderModelCatalog & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload
}
