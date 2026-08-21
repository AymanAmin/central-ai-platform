import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createAdminClient, json } from '../_shared/runtime.ts'
import { createRuntimeProvider, resolveOrganizationAgent } from '../_shared/agent-runtime.ts'

interface Job { id: string; organization_id: string | null; job_type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }

async function authenticate(req: Request, admin: ReturnType<typeof createAdminClient>) {
  const supplied = req.headers.get('x-worker-token')
  if (supplied) {
    const secret = await admin.rpc('get_background_worker_token')
    if (!secret.error && secret.data === supplied) return true
  }
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    const user = await admin.auth.getUser(auth.slice(7))
    if (!user.error && user.data.user) {
      const profile = await admin.from('profiles').select('role,is_active').eq('id', user.data.user.id).single()
      if (!profile.error && profile.data?.is_active && profile.data.role === 'SUPER_ADMIN') return true
    }
  }
  return false
}

async function summarize(admin: ReturnType<typeof createAdminClient>, job: Job) {
  const conversationId = String(job.payload.conversationId ?? '')
  if (!conversationId || !job.organization_id) throw new Error('invalid_summary_job')
  const conv = await admin.from('conversations').select('id,summary').eq('id', conversationId).eq('organization_id', job.organization_id).single()
  if (conv.error || !conv.data) throw conv.error ?? new Error('conversation_not_found')
  const messages = await admin.from('messages').select('id,role,content,created_at').eq('conversation_id', conversationId).eq('organization_id', job.organization_id).order('created_at', { ascending: true }).limit(80)
  if (messages.error) throw messages.error
  const rows = messages.data ?? []
  if (rows.length < 8) return { skipped: true, reason: 'too_few_messages' }

  const agent = await resolveOrganizationAgent(admin, job.organization_id)
  const primary = await createRuntimeProvider(admin, agent.chat_provider, agent.chat_model, agent.embedding_model)
  const fallback = agent.fallback_provider && agent.fallback_model && (agent.fallback_provider !== agent.chat_provider || agent.fallback_model !== agent.chat_model)
    ? await createRuntimeProvider(admin, agent.fallback_provider, agent.fallback_model, agent.embedding_model)
    : null
  const transcript = rows.map(row => `${row.role}: ${row.content ?? ''}`).join('\n')
  const input = `Previous summary:\n${conv.data.summary ?? '(none)'}\n\nMessages:\n${transcript}`
  const instructions = 'Summarize the conversation compactly for future conversational memory. Preserve confirmed facts, customer goals, referenced entities, unresolved questions, and commitments. Do not include hidden reasoning. Return only the summary in the conversation language.'
  let active = primary
  let result
  try {
    result = await primary.ai.text(instructions, input, 700)
  } catch (error) {
    if (!fallback) throw error
    console.warn('summary_primary_provider_failed_using_fallback', { organizationId: job.organization_id, error: error instanceof Error ? error.message : 'unknown' })
    active = fallback
    result = await fallback.ai.text(instructions, input, 700)
  }

  const first = rows[0]!, last = rows[rows.length - 1]!
  const created = await admin.from('conversation_summaries').insert({ organization_id: job.organization_id, conversation_id: conversationId, summary: result.text, from_message_id: first.id, to_message_id: last.id, model: active.settings.chat_model, token_count: result.outputTokens })
  if (created.error) throw created.error
  await admin.from('conversations').update({ summary: result.text, summary_updated_at: new Date().toISOString() }).eq('id', conversationId)
  const pricing = await admin.from('model_pricing').select('input_cost_per_million,output_cost_per_million').eq('provider', active.settings.provider).eq('model', active.settings.chat_model).eq('is_active', true).lte('effective_from', new Date().toISOString().slice(0, 10)).order('effective_from', { ascending: false }).limit(1).maybeSingle()
  const cost = result.inputTokens / 1_000_000 * Number(pricing.data?.input_cost_per_million ?? 0) + result.outputTokens / 1_000_000 * Number(pricing.data?.output_cost_per_million ?? 0)
  await admin.from('usage_logs').insert({ organization_id: job.organization_id, conversation_id: conversationId, operation: active === primary ? 'conversation_summary' : 'conversation_summary_fallback', provider: active.settings.provider, model: active.settings.chat_model, input_tokens: result.inputTokens, output_tokens: result.outputTokens, estimated_cost: cost })
  return { summaryTokens: result.outputTokens, estimatedCost: cost }
}

async function cleanup(admin: ReturnType<typeof createAdminClient>) {
  const oldWindows = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const oldJobs = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await admin.from('api_rate_limit_windows').delete().lt('window_started_at', oldWindows)
  await admin.from('background_jobs').delete().eq('status', 'completed').lt('completed_at', oldJobs)
  return { cleaned: true }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  const admin = createAdminClient()
  if (!await authenticate(req, admin)) return json({ success: false, error: 'unauthorized' }, 401)
  try {
    const body = await req.json().catch(() => ({})) as { limit?: number }
    const limit = Math.max(1, Math.min(10, body.limit ?? 4))
    const pending = await admin.from('background_jobs').select('id,organization_id,job_type,payload,attempts,max_attempts').eq('status', 'pending').lte('next_run_at', new Date().toISOString()).order('priority', { ascending: false }).order('created_at', { ascending: true }).limit(limit)
    if (pending.error) throw pending.error
    const results: Array<Record<string, unknown>> = []
    for (const raw of pending.data ?? []) {
      const job = raw as Job
      const claim = await admin.from('background_jobs').update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 }).eq('id', job.id).eq('status', 'pending').select('id').maybeSingle()
      if (claim.error || !claim.data) continue
      try {
        let result: unknown
        if (job.job_type === 'process_document') {
          const token = await admin.rpc('get_background_worker_token')
          if (token.error || !token.data) throw new Error('worker_token_unavailable')
          const url = Deno.env.get('SUPABASE_URL')
          if (!url) throw new Error('supabase_url_missing')
          const response = await fetch(`${url}/functions/v1/knowledge-process`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-token': String(token.data) }, body: JSON.stringify({ documentId: String(job.payload.documentId ?? '') }), signal: AbortSignal.timeout(90000) })
          const payload = await response.json() as Record<string, unknown>
          if (!response.ok) throw new Error(String(payload.error ?? `knowledge_process_http_${response.status}`))
          result = payload
        } else if (job.job_type === 'update_conversation_summary') result = await summarize(admin, { ...job, attempts: job.attempts + 1 })
        else if (job.job_type === 'cleanup') result = await cleanup(admin)
        else throw new Error(`unsupported_job_type:${job.job_type}`)
        await admin.from('background_jobs').update({ status: 'completed', completed_at: new Date().toISOString(), last_error: null }).eq('id', job.id)
        results.push({ jobId: job.id, status: 'completed', result })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'job_failed'
        const attempt = job.attempts + 1
        const terminal = attempt >= job.max_attempts
        const delayMinutes = Math.min(60, 2 ** Math.min(attempt, 6))
        await admin.from('background_jobs').update({ status: terminal ? 'failed' : 'pending', last_error: message, next_run_at: new Date(Date.now() + delayMinutes * 60000).toISOString(), started_at: null }).eq('id', job.id)
        results.push({ jobId: job.id, status: terminal ? 'failed' : 'retry_scheduled', error: message })
      }
    }
    return json({ success: true, processed: results.length, results })
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'worker_failed' }, 500)
  }
})
