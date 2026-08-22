import { GroqProvider, compactGroqRuntimeInput, compactGroqRuntimeInstructions, createGroqProvider, normalizeGroqActions, normalizeGroqText } from './groq.ts'

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const assertRejectsCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), code)
    return
  }
  throw new Error(`Expected ${code}`)
}

Deno.test('Groq provider sends compact strict action schema and maps token usage', async () => {
  const originalFetch = globalThis.fetch
  const seen: { body?: Record<string, unknown> } = {}
  try {
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      assertEquals(String(input), 'https://api.groq.com/openai/v1/chat/completions')
      seen.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'OK', intent: 'connection_test', requestHuman: false, actions: [] }) } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
    const result = await provider.chat({ instructions: 'Return the contract.', userInput: 'Connection test', maxOutputTokens: 512 })
    const responseFormat = seen.body?.response_format as { type?: string; json_schema?: { strict?: boolean; schema?: Record<string, unknown> } } | undefined
    const schema = responseFormat?.json_schema?.schema as { properties?: { actions?: { items?: { properties?: Record<string, unknown>; required?: string[] } } } } | undefined
    const actionItems = schema?.properties?.actions?.items
    assertEquals(responseFormat?.type, 'json_schema')
    assertEquals(responseFormat?.json_schema?.strict, true)
    assertEquals(Object.keys(actionItems?.properties ?? {}), ['type', 'label', 'target', 'value'])
    assertEquals(actionItems?.required, ['type', 'label', 'target', 'value'])
    assertEquals(seen.body?.reasoning_effort, 'low')
    assertEquals(result.answer, 'OK')
    assertEquals(result.inputTokens, 11)
    assertEquals(result.outputTokens, 7)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq compacts Central AI runtime history and RAG context without dropping the current message', () => {
  const history = Array.from({ length: 12 }, (_, index) => `${index % 2 ? 'assistant' : 'user'}: ${'س'.repeat(220)}`).join('\n')
  const knowledge = `[Source 1 | document=1 | page=1 | similarity=0.910]\n${'م'.repeat(2100)}\n\n[Source 2 | document=2 | page=2 | similarity=0.870]\n${'ع'.repeat(1900)}`
  const input = `Customer profile:\n${JSON.stringify({ name: 'محمد', metadata: 'x'.repeat(900) })}\n\nConversation summary:\n${'خ'.repeat(1200)}\n\nRecent messages:\n${history}\n\nRetrieved knowledge:\n${knowledge}\n\nCurrent customer message:\nطيب اعطني نبذه عن بكالوريوس الطب البشري`
  const compacted = compactGroqRuntimeInput(input)
  if (compacted.length >= input.length * .55) throw new Error(`Expected substantial Groq prompt reduction, got ${compacted.length}/${input.length}`)
  if (!compacted.endsWith('طيب اعطني نبذه عن بكالوريوس الطب البشري')) throw new Error('Current customer message was not preserved')
  if (!compacted.includes('[Source 1 |')) throw new Error('Top RAG source was not preserved')
})

Deno.test('Groq compacts verbose tool instructions only for the runtime tool section', () => {
  const instructions = `System policy stays intact.\n\nAvailable read-only tools:\n- GET_APPOINTMENT: ${'تفاصيل وأمثلة '.repeat(160)}`
  const compacted = compactGroqRuntimeInstructions(instructions)
  if (!compacted.startsWith('System policy stays intact.')) throw new Error('System instructions changed unexpectedly')
  if (compacted.length >= instructions.length) throw new Error('Tool instructions were not compacted')
})

Deno.test('Groq compact actions map to platform action fields', () => {
  assertEquals(normalizeGroqActions([
    { type: 'open_url', label: 'بوابة القبول', target: 'https://example.com/admission', value: null },
    { type: 'call_phone', label: 'اتصل بنا', target: '+966112100000', value: null },
    { type: 'open_screen', label: 'المحادثات', target: 'conversations', value: null },
    { type: 'reply_option', label: 'نعم', target: null, value: 'yes' },
  ]), [
    { type: 'open_url', label: 'بوابة القبول', url: 'https://example.com/admission', phone: null, screen: null, value: null },
    { type: 'call_phone', label: 'اتصل بنا', url: null, phone: '+966112100000', screen: null, value: null },
    { type: 'open_screen', label: 'المحادثات', url: null, phone: null, screen: 'conversations', value: null },
    { type: 'reply_option', label: 'نعم', url: null, phone: null, screen: null, value: 'yes' },
  ])
})

Deno.test('Groq response normalization removes escaped newlines and raw markdown markers', () => {
  assertEquals(
    normalizeGroqText('**العنوان**\\n\\n- البند الأول\\n- `البند الثاني`'),
    'العنوان\n\n• البند الأول\n• البند الثاني',
  )
})

Deno.test('Groq chat returns normalized answer text', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ answer: '**رسوم القبول**\\n\\n- راجع البوابة', intent: 'fees', requestHuman: false, actions: [] }) } }],
      usage: { prompt_tokens: 9, completion_tokens: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
    const result = await provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 })
    assertEquals(result.answer, 'رسوم القبول\n\n• راجع البوابة')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq retries once when generated JSON misses the expected schema', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ role?: string; content?: string }>; temperature?: number }
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "Generated JSON does not match the expected schema. Please adjust your prompt. Error: jsonschema: '/actions/0' is missing properties" } }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      assertEquals(body.temperature, 0)
      assertEquals(body.messages?.some(message => message.content?.includes('Schema repair:')), true)
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'OK', intent: 'test', requestHuman: false, actions: [{ type: 'open_url', label: 'Open', target: 'https://example.com', value: null }] }) } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
    const result = await provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 })
    assertEquals(calls, 2)
    assertEquals(result.actions[0]?.url, 'https://example.com')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq switches to the other free strict model when the selected model returns 429', async () => {
  const originalFetch = globalThis.fetch
  const models: string[] = []
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      models.push(body.model ?? '')
      if (body.model === 'openai/gpt-oss-20b') {
        return new Response(JSON.stringify({ error: { message: 'Rate limit reached for model' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60' } })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'Fallback worked', intent: 'test', requestHuman: false, actions: [] }) } }],
        usage: { prompt_tokens: 13, completion_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const settings = { chat_model: 'openai/gpt-oss-20b', embedding_model: 'gemini-embedding-001' }
    const provider = createGroqProvider(settings, 'gsk_123456789012345678901234567890')
    const result = await provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 })
    assertEquals(models, ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])
    assertEquals(result.answer, 'Fallback worked')
    assertEquals(provider.chatModel, 'openai/gpt-oss-120b')
    assertEquals(settings.chat_model, 'openai/gpt-oss-120b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq surfaces 429 after both free strict models are exhausted', async () => {
  const originalFetch = globalThis.fetch
  const models: string[] = []
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      models.push(body.model ?? '')
      return new Response(JSON.stringify({ error: { message: `Rate limit reached for ${body.model}` } }), { status: 429, headers: { 'content-type': 'application/json' } })
    }
    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-120b', 'gemini-embedding-001')
    await assertRejectsCode(provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 }), 'chat_provider_error:429:Rate limit reached for openai/gpt-oss-20b')
    assertEquals(models, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq provider surfaces a sanitized non-schema provider 400 message without retry', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ error: { message: 'Invalid schema keyword maxItems\n' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
    await assertRejectsCode(provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 }), 'chat_provider_error:400:Invalid schema keyword maxItems')
    assertEquals(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Groq provider rejects embedding calls to protect RAG routing', async () => {
  const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
  await assertRejectsCode(provider.embedding(['hello']), 'groq_embeddings_not_supported')
})

Deno.test('Groq provider rejects invalid short API keys', () => {
  try {
    createGroqProvider({ chat_model: 'openai/gpt-oss-20b', embedding_model: 'gemini-embedding-001' }, 'short')
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), 'groq_api_key_invalid')
    return
  }
  throw new Error('Expected groq_api_key_invalid')
})
