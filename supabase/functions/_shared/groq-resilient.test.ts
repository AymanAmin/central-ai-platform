import { createResilientGroqProvider } from './groq-resilient.ts'

const assertEquals = (actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

Deno.test('Resilient Groq tries the other free strict model after persistent schema mismatch', async () => {
  const originalFetch = globalThis.fetch
  const models: string[] = []
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      const model = body.model ?? ''
      models.push(model)
      if (model === 'openai/gpt-oss-20b') {
        return new Response(JSON.stringify({ error: { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'Recovered', intent: 'general_question', requestHuman: false, actions: [] }) } }],
        usage: { prompt_tokens: 25, completion_tokens: 6 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const settings = { chat_model: 'openai/gpt-oss-20b', embedding_model: 'gemini-embedding-001' }
    const provider = createResilientGroqProvider(settings, 'gsk_123456789012345678901234567890')
    const result = await provider.chat({ instructions: 'Return valid JSON.', userInput: 'سؤال بسيط', maxOutputTokens: 200 })

    assertEquals(models, ['openai/gpt-oss-20b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b'])
    assertEquals(result.answer, 'Recovered')
    assertEquals(provider.chatModel, 'openai/gpt-oss-120b')
    assertEquals(settings.chat_model, 'openai/gpt-oss-120b')
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('Resilient Groq does not rotate models for unrelated provider errors', async () => {
  const originalFetch = globalThis.fetch
  const models: string[] = []
  try {
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      models.push(body.model ?? '')
      return new Response(JSON.stringify({ error: { message: 'Invalid request parameter' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }

    const settings = { chat_model: 'openai/gpt-oss-20b', embedding_model: 'gemini-embedding-001' }
    const provider = createResilientGroqProvider(settings, 'gsk_123456789012345678901234567890')
    try {
      await provider.chat({ instructions: 'Return valid JSON.', userInput: 'test', maxOutputTokens: 200 })
      throw new Error('Expected provider error')
    } catch (error) {
      assertEquals(error instanceof Error ? error.message : String(error), 'chat_provider_error:400:Invalid request parameter')
    }
    assertEquals(models, ['openai/gpt-oss-20b'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
