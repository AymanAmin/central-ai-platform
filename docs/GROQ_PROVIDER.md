# Groq Provider Setup

## Scope

Groq is integrated as a native chat provider for Central AI Platform.

Supported runtime roles:

- Primary chat
- Fallback chat

Not supported through Groq:

- Knowledge embeddings

RAG continues to use the embedding provider configured for the organization. The default Groq provider row points to `gemini-embedding-001` so the existing 1536-dimension knowledge path remains compatible.

## Default model

The default Groq chat model is:

```text
openai/gpt-oss-20b
```

The model catalog intentionally exposes only Groq models that currently support strict Structured Outputs because the platform requires a reliable JSON response contract:

```text
openai/gpt-oss-20b
openai/gpt-oss-120b
```

## Configuration

1. Open **AI Settings** as Super Admin.
2. Select **Groq**.
3. Paste the Groq API key.
4. Save the key. It is stored in Supabase Vault and is never returned to the browser.
5. Run **Test connection**.
6. Open **Organization Agents & Plans**.
7. Select Groq for **Primary chat** or **Fallback**.
8. Choose a Groq model from the live model catalog.
9. Keep **Knowledge embeddings** on Gemini, OpenAI, or OpenRouter.
10. Run **Test agent** before saving the runtime route.

## Security and reliability

- The browser never receives the Groq API key after it is stored.
- Groq calls are made only from Supabase Edge Functions.
- Provider requests use HTTPS and a 60-second timeout.
- The model catalog uses the official Groq Models API and a 15-second timeout.
- Groq cannot be selected as an embedding provider in the organization runtime editor or server-side runtime validation.
- Runtime changes still require a successful structured-response test before they can be saved.

## Pricing

The seed migration records the Groq prices used when this integration was added:

| Model | Input / 1M tokens | Output / 1M tokens |
| --- | ---: | ---: |
| `openai/gpt-oss-20b` | $0.075 | $0.30 |
| `openai/gpt-oss-120b` | $0.15 | $0.60 |

`model_pricing` remains the source used by the platform for estimated provider cost and should be updated when Groq changes pricing.
