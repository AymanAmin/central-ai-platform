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

Groq exposes other Free Plan models, but they serve different purposes or do not support the platform's strict JSON contract. Examples include Qwen chat without Strict Structured Outputs, Compound agentic systems, Prompt Guard/Safeguard safety models, Whisper speech-to-text, and Orpheus text-to-speech.

## Groq Free Plan limits

The official Groq Free Plan limits verified on 2026-08-23 include:

| Model | Purpose | RPM | RPD | TPM | TPD |
| --- | --- | ---: | ---: | ---: | ---: |
| `openai/gpt-oss-20b` | Agent chat | 30 | 1,000 | 8,000 | 200,000 |
| `openai/gpt-oss-120b` | Agent chat | 30 | 1,000 | 8,000 | 200,000 |
| `qwen/qwen3.6-27b` | General chat | 30 | 1,000 | 8,000 | 200,000 |
| `groq/compound` | Agentic system | 30 | 250 | 70,000 | - |
| `groq/compound-mini` | Agentic system | 30 | 250 | 70,000 | - |

Speech models use additional audio-window limits. The current official Free Plan table is also mirrored in `supabase/functions/_shared/groq-models.ts` so runtime compatibility and free-tier metadata have one maintained source in the codebase.

These are rate-limit windows, not monthly credits:

- RPM and TPM reset according to their minute windows.
- RPD and TPD reset according to their daily windows.
- Audio models may use ASH/ASD hour/day windows.
- Groq returns HTTP `429` when a limit is reached.
- Free Plan usage is not automatically converted into paid usage; billing starts only after the account is upgraded to a paid Developer plan.

Rate limits apply at the Groq organization/project level according to the limits configured in Groq Console, not separately per Central AI end user.

## Automatic same-provider failover

For the production agent contract, both `openai/gpt-oss-20b` and `openai/gpt-oss-120b` are Free Plan models and support Strict Structured Outputs.

If the selected Groq model returns HTTP `429`, Central AI now tries the other compatible Free Plan Groq model before using the organization's configured cross-provider fallback. The model that actually succeeds is propagated back into the in-memory runtime settings so usage and cost logs are attributed to the model that served the response.

The automatic rotation is intentionally limited to models that satisfy all of these conditions:

1. Available on Groq Free Plan.
2. General chat role suitable for the platform agent.
3. Strict Structured Outputs support required by the Central AI response contract.

This prevents speech, safety, preview, or best-effort JSON models from silently becoming the production chat model.

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
- Same-provider rotation happens only after a Groq `429`; schema, authentication, and other provider errors are not hidden by model rotation.

## Pricing

The seed migration records the Groq prices used when this integration was added:

| Model | Input / 1M tokens | Output / 1M tokens |
| --- | ---: | ---: |
| `openai/gpt-oss-20b` | $0.075 | $0.30 |
| `openai/gpt-oss-120b` | $0.15 | $0.60 |

`model_pricing` remains the source used by the platform for estimated provider cost and should be updated when Groq changes pricing.

When Groq is configured as Free Tier in Central AI billing mode, the actual platform cost remains `$0` while the commercial-list-price estimate can still be retained for comparison.
