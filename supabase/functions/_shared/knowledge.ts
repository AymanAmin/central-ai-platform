import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.112.3'
import { createRuntimeProvider, resolveOrganizationAgent } from './agent-runtime.ts'
import { vectorLiteral } from './runtime.ts'
import { fetchKnowledgeUrl } from './url-source.ts'

type DocumentRow = {
  id: string
  organization_id: string
  knowledge_base_id: string
  title: string
  source_type: string
  original_file_name: string | null
  storage_path: string | null
  source_url: string | null
  checksum: string | null
  metadata: Record<string, unknown>
  processing_status: string
}

const EMBEDDING_INPUT_VERSION = 3
const hashBytes = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
const decodeXml = (v: string) => v.replace(/<w:tab\s*\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<w:br\s*\/>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
const normalize = (t: string) => t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()

async function extractPdf(bytes: Uint8Array) {
  const pdfjs = await import('npm:pdfjs-dist@6.2.108/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true })
  const doc = await task.promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ')
    pages.push(`[[PAGE:${n}]]\n${text}`)
  }
  return normalize(pages.join('\n\n'))
}

async function extractDocx(bytes: Uint8Array) {
  const { default: JSZip } = await import('npm:jszip@3.10.1')
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('docx_document_xml_missing')
  return normalize(decodeXml(await file.async('text')))
}

function splitPages(text: string) {
  const parts = text.split(/\[\[PAGE:(\d+)\]\]/g)
  const out: Array<{ page: number | null; text: string }> = []
  if (parts.length === 1) return [{ page: null, text }]
  for (let i = 1; i < parts.length; i += 2) out.push({ page: Number(parts[i]), text: (parts[i + 1] ?? '').trim() })
  return out
}

function chunkText(text: string) {
  const pages = splitPages(text)
  const chunks: Array<{ content: string; page_number: number | null; token_count: number }> = []
  const target = 2600
  const overlap = 320
  for (const page of pages) {
    let start = 0
    while (start < page.text.length) {
      let end = Math.min(page.text.length, start + target)
      if (end < page.text.length) {
        const boundary = Math.max(page.text.lastIndexOf('\n', end), page.text.lastIndexOf('. ', end), page.text.lastIndexOf('، ', end))
        if (boundary > start + 1200) end = boundary + 1
      }
      const content = page.text.slice(start, end).trim()
      if (content) chunks.push({ content, page_number: page.page, token_count: Math.max(1, Math.ceil(content.length / 4)) })
      if (end >= page.text.length) break
      start = Math.max(start + 1, end - overlap)
    }
  }
  return chunks
}

async function updateDocument(admin: SupabaseClient, documentId: string, values: Record<string, unknown>) {
  const updated = await admin.from('knowledge_documents').update(values).eq('id', documentId)
  if (updated.error) throw updated.error
}

function chunkEmbeddingInput(document: DocumentRow, content: string) {
  const identity = [
    `Document title: ${document.title}`,
    document.source_url ? `Source URL: ${document.source_url}` : '',
    document.original_file_name ? `File name: ${document.original_file_name}` : '',
  ].filter(Boolean).join('\n')
  return `${identity}\n\nContent:\n${content}`
}

function isCurrentEmbedding(metadata: unknown, embeddingModel: string | null, expectedModel: string, expectedProvider: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const row = metadata as Record<string, unknown>
  return row.embeddingInputVersion === EMBEDDING_INPUT_VERSION && row.embeddingProvider === expectedProvider && embeddingModel === expectedModel
}

export async function processDocument(admin: SupabaseClient, documentId: string) {
  const started = performance.now()
  const { data: doc, error } = await admin
    .from('knowledge_documents')
    .select('id,organization_id,knowledge_base_id,title,source_type,original_file_name,storage_path,source_url,checksum,metadata,processing_status')
    .eq('id', documentId)
    .single()
  if (error || !doc) throw error ?? new Error('document_not_found')
  const d = doc as DocumentRow

  try {
    await updateDocument(admin, d.id, { processing_status: 'processing', processing_error: null })

    let bytes: Uint8Array
    let text: string
    let fetchedMetadata: Record<string, unknown> | null = null

    if (d.source_type === 'manual_text') {
      text = String(d.metadata?.manualText ?? '').trim()
      bytes = new TextEncoder().encode(text)
    } else if (d.source_type === 'url') {
      if (!d.source_url) throw new Error('source_url_missing')
      const fetched = await fetchKnowledgeUrl(d.source_url)
      text = fetched.text
      bytes = new TextEncoder().encode(text)
      fetchedMetadata = {
        ...d.metadata,
        fetchedAt: new Date().toISOString(),
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        pageTitle: fetched.pageTitle,
      }
    } else {
      if (!d.storage_path) throw new Error('storage_path_missing')
      const downloaded = await admin.storage.from('knowledge').download(d.storage_path)
      if (downloaded.error || !downloaded.data) throw downloaded.error ?? new Error('download_failed')
      bytes = new Uint8Array(await downloaded.data.arrayBuffer())
      const name = (d.original_file_name ?? d.storage_path).toLowerCase()
      if (name.endsWith('.txt')) text = normalize(new TextDecoder().decode(bytes))
      else if (name.endsWith('.docx')) text = await extractDocx(bytes)
      else if (name.endsWith('.pdf')) text = await extractPdf(bytes)
      else throw new Error('unsupported_file_type')
    }

    if (!text.trim()) throw new Error('no_extractable_text')
    const agent = await resolveOrganizationAgent(admin, d.organization_id)
    const embeddingSession = await createRuntimeProvider(admin, agent.embedding_provider, agent.chat_model, agent.embedding_model)

    const contentChecksum = await hashBytes(bytes)
    const checksum = d.source_type === 'url'
      ? await hashBytes(new TextEncoder().encode(`${d.source_url ?? ''}\n${contentChecksum}`))
      : contentChecksum

    if (fetchedMetadata) {
      fetchedMetadata.contentFingerprint = contentChecksum
      fetchedMetadata.embeddingInputVersion = EMBEDDING_INPUT_VERSION
      fetchedMetadata.embeddingProvider = agent.embedding_provider
      await updateDocument(admin, d.id, { metadata: fetchedMetadata })
    }

    if (d.checksum === checksum) {
      const current = await admin.from('knowledge_chunks').select('id,embedding_model,metadata', { count: 'exact' }).eq('document_id', d.id).limit(1)
      if (current.error) throw current.error
      const first = current.data?.[0]
      if ((current.count ?? 0) > 0 && first && isCurrentEmbedding(first.metadata, first.embedding_model, agent.embedding_model, agent.embedding_provider)) {
        await updateDocument(admin, d.id, { processing_status: 'ready', processed_at: new Date().toISOString(), processing_error: null })
        return { documentId: d.id, chunks: current.count, deduplicated: true, sameDocument: true, latencyMs: Math.round(performance.now() - started) }
      }
    }

    const existing = await admin.from('knowledge_documents').select('id').eq('organization_id', d.organization_id).eq('knowledge_base_id', d.knowledge_base_id).eq('checksum', checksum).eq('processing_status', 'ready').neq('id', d.id).limit(1).maybeSingle()
    if (existing.error) throw existing.error

    const removed = await admin.from('knowledge_chunks').delete().eq('document_id', d.id)
    if (removed.error) throw removed.error

    if (existing.data) {
      const source = await admin.from('knowledge_chunks').select('chunk_index,content,token_count,page_number,section_title,embedding,embedding_model,metadata').eq('document_id', existing.data.id).order('chunk_index')
      if (source.error) throw source.error
      const sourceIsCurrent = (source.data ?? []).length > 0 && (source.data ?? []).every(c => isCurrentEmbedding(c.metadata, c.embedding_model, agent.embedding_model, agent.embedding_provider))
      if (sourceIsCurrent) {
        const copies = (source.data ?? []).map(c => ({ ...c, id: crypto.randomUUID(), organization_id: d.organization_id, knowledge_base_id: d.knowledge_base_id, document_id: d.id }))
        if (copies.length) {
          const inserted = await admin.from('knowledge_chunks').insert(copies)
          if (inserted.error) throw inserted.error
        }
        await updateDocument(admin, d.id, { checksum, processing_status: 'ready', processed_at: new Date().toISOString(), processing_error: null })
        return { documentId: d.id, chunks: copies.length, deduplicated: true, latencyMs: Math.round(performance.now() - started) }
      }
    }

    const chunks = chunkText(text)
    if (!chunks.length) throw new Error('no_chunks_created')
    let embeddingTokens = 0
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < chunks.length; i += 32) {
      const batch = chunks.slice(i, i + 32)
      const embedded = await embeddingSession.ai.embedding(batch.map(c => chunkEmbeddingInput(d, c.content)), 'RETRIEVAL_DOCUMENT')
      embeddingTokens += embedded.tokens
      batch.forEach((c, j) => rows.push({
        id: crypto.randomUUID(), organization_id: d.organization_id, knowledge_base_id: d.knowledge_base_id, document_id: d.id,
        chunk_index: i + j, content: c.content, token_count: c.token_count, page_number: c.page_number, section_title: null,
        embedding: vectorLiteral(embedded.vectors[j]!), embedding_model: agent.embedding_model,
        metadata: { embeddingInputVersion: EMBEDDING_INPUT_VERSION, embeddingProvider: agent.embedding_provider, sourceTitle: d.title, sourceUrl: d.source_url },
      }))
    }

    const inserted = await admin.from('knowledge_chunks').insert(rows)
    if (inserted.error) throw inserted.error

    const pricing = await admin.from('model_pricing').select('embedding_cost_per_million').eq('provider', agent.embedding_provider).eq('model', agent.embedding_model).eq('is_active', true).lte('effective_from', new Date().toISOString().slice(0, 10)).order('effective_from', { ascending: false }).limit(1).maybeSingle()
    if (pricing.error) throw pricing.error
    const cost = embeddingTokens / 1_000_000 * Number(pricing.data?.embedding_cost_per_million ?? 0)

    const usage = await admin.from('usage_logs').insert({ organization_id: d.organization_id, operation: 'document_embedding', provider: agent.embedding_provider, model: agent.embedding_model, embedding_tokens: embeddingTokens, estimated_cost: cost, latency_ms: Math.round(performance.now() - started) })
    if (usage.error) throw usage.error

    await updateDocument(admin, d.id, { checksum, processing_status: 'ready', processed_at: new Date().toISOString(), processing_error: null })
    return { documentId: d.id, chunks: rows.length, deduplicated: false, embeddingTokens, estimatedCost: cost, latencyMs: Math.round(performance.now() - started) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'processing_failed'
    const failed = await admin.from('knowledge_documents').update({ processing_status: 'failed', processing_error: message }).eq('id', d.id)
    if (failed.error) console.error('knowledge_status_update_failed', { documentId: d.id, error: failed.error.message, originalError: message })
    throw err
  }
}
