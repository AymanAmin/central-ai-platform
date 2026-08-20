const endpoint = process.env.CENTRAL_AI_URL || 'https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat'
const apiKey = process.env.CENTRAL_AI_API_KEY

if (!apiKey?.startsWith('ai_live_')) {
  console.error('CENTRAL_AI_API_KEY must be set to a valid ai_live_* server secret.')
  process.exit(2)
}

const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
const request = {
  channel: 'smoke_test',
  customer: {
    externalId: `smoke-customer-${runId}`,
    name: 'Central AI Smoke Test',
    language: 'ar',
    metadata: { smokeTest: true },
  },
  conversation: {
    externalId: `smoke-conversation-${runId}`,
    metadata: { smokeTest: true },
  },
  message: {
    externalId: `smoke-message-${runId}`,
    type: 'text',
    text: 'مرحبا',
  },
  context: { smokeTest: true },
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function send() {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  })

  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`Chat returned non-JSON HTTP ${response.status}`)
  }

  if (!response.ok) {
    throw new Error(`Chat HTTP ${response.status}: ${String(payload?.error ?? 'unknown_error')}`)
  }
  return payload
}

function validate(payload) {
  assert(payload?.success === true, 'Expected success=true')
  assert(typeof payload.requestId === 'string' && payload.requestId.length > 0, 'Missing requestId')
  assert(typeof payload.conversationId === 'string' && payload.conversationId.length > 0, 'Missing conversationId')
  assert(typeof payload.status === 'string', 'Missing status')
  assert(typeof payload.answer === 'string', 'Missing answer')
  assert(typeof payload.language === 'string', 'Missing language')
  assert(typeof payload.intent === 'string', 'Missing intent')
  assert(typeof payload.confidence === 'number', 'Missing numeric confidence')
  assert(typeof payload.requiresHuman === 'boolean', 'Missing requiresHuman')
  assert(Array.isArray(payload.actions), 'Missing actions array')
  assert(payload.usage && typeof payload.usage === 'object', 'Missing usage object')
  assert(Number.isFinite(Number(payload.usage.inputTokens ?? 0)), 'Invalid input token count')
  assert(Number.isFinite(Number(payload.usage.outputTokens ?? 0)), 'Invalid output token count')
  assert(Number.isFinite(Number(payload.usage.estimatedCost ?? 0)), 'Invalid estimated cost')
}

try {
  const first = await send()
  validate(first)
  assert(first.idempotentReplay !== true, 'First request unexpectedly reported replay')

  const second = await send()
  validate(second)
  assert(second.conversationId === first.conversationId, 'Replay changed conversationId')
  assert(second.idempotentReplay === true, 'Duplicate request did not use idempotent replay')

  console.log(JSON.stringify({
    ok: true,
    conversationId: first.conversationId,
    firstStatus: first.status,
    replayVerified: true,
    modelCost: Number(first.usage?.estimatedCost ?? 0),
  }))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
