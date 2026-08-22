import { resolveAzureOpenAiCredentials } from './azure-openai.ts'

const key = '12345678901234567890123456789012'

const assertEquals = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
}

const assertThrowsCode = (fn: () => unknown, code: string) => {
  try {
    fn()
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), code)
    return
  }
  throw new Error(`Expected ${code}`)
}

Deno.test('Azure OpenAI credentials accept and normalize the official HTTPS resource endpoint', () => {
  const credentials = resolveAzureOpenAiCredentials(JSON.stringify({ apiKey: key, endpoint: 'https://my-resource.openai.azure.com/' }))
  assertEquals(credentials.apiKey, key)
  assertEquals(credentials.endpoint, 'https://my-resource.openai.azure.com')
})

Deno.test('Azure OpenAI credentials reject non-HTTPS endpoints', () => {
  assertThrowsCode(() => resolveAzureOpenAiCredentials(JSON.stringify({ apiKey: key, endpoint: 'http://my-resource.openai.azure.com' })), 'azure_openai_endpoint_invalid')
})

Deno.test('Azure OpenAI credentials reject lookalike hosts', () => {
  assertThrowsCode(() => resolveAzureOpenAiCredentials(JSON.stringify({ apiKey: key, endpoint: 'https://my-resource.openai.azure.com.attacker.example' })), 'azure_openai_endpoint_invalid')
})

Deno.test('Azure OpenAI credentials reject unexpected endpoint paths', () => {
  assertThrowsCode(() => resolveAzureOpenAiCredentials(JSON.stringify({ apiKey: key, endpoint: 'https://my-resource.openai.azure.com/private' })), 'azure_openai_endpoint_invalid')
})
