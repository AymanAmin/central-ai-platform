import { GroqProvider, createGroqProvider, normalizeGroqText } from './groq.ts'

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

Deno.test('Groq provider sends strict compatible JSON schema requests and maps token usage', async () => {
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
    const schema = responseFormat?.json_schema?.schema as { properties?: { actions?: Record<string, unknown> } } | undefined
    assertEquals(responseFormat?.type, 'json_schema')
    assertEquals(responseFormat?.json_schema?.strict, true)
    assertEquals('maxItems' in (schema?.properties?.actions ?? {}), false)
    assertEquals(seen.body?.reasoning_effort, 'low')
    assertEquals(result.answer, 'OK')
    assertEquals(result.inputTokens, 11)
    assertEquals(result.outputTokens, 7)
  } finally {
    globalThis.fetch = originalFetch
  }
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

Deno.test('Groq provider surfaces a sanitized provider 400 message', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid schema keyword maxItems\n' } }), { status: 400, headers: { 'content-type': 'application/json' } })
    const provider = new GroqProvider('gsk_123456789012345678901234567890', 'openai/gpt-oss-20b', 'gemini-embedding-001')
    await assertRejectsCode(provider.chat({ instructions: 'Return JSON.', userInput: 'test', maxOutputTokens: 512 }), 'chat_provider_error:400:Invalid schema keyword maxItems')
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
