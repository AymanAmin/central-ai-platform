# Hybrid Gemini + Azure Provider Setup

## Decision

Central AI keeps the existing low-cost path as the primary runtime:

- Chat: Gemini
- RAG embeddings: Gemini Embeddings
- Saudi TTS: Microsoft Azure Speech (`ar-SA`)
- Chat fallback: Microsoft Azure OpenAI

Azure OpenAI is intentionally a chat/fallback-only provider in this phase. It is not offered as an embedding provider and is not promoted to the global default by the UI.

## Azure OpenAI deployment

The initial configured deployment name is:

```text
gpt-4.1-mini
```

Create the Azure OpenAI deployment with that deployment name, or update the global `ai_provider_settings.chat_model` value before assigning it to an organization.

The Azure resource endpoint must use the official Azure OpenAI resource shape:

```text
https://<resource>.openai.azure.com
```

The frontend never stores Azure credentials in Vite environment variables. Super Admin submits the endpoint and API key over HTTPS to `admin-api`, which stores them together as an encrypted Supabase Vault provider secret. The credential is never returned to the browser.

## Activation workflow

1. Open AI Settings as Super Admin.
2. Select Microsoft Azure OpenAI.
3. Enter the Azure OpenAI endpoint and API key.
4. Save the credentials.
5. Run **Test connection**.
6. Open Organization Agents & Plans.
7. Keep Gemini as Primary chat and Gemini as Knowledge embeddings.
8. Select Azure OpenAI / `gpt-4.1-mini` under Fallback.
9. Run **Test agent**.
10. Save only after the real runtime test passes.

The organization-agent editor already blocks model-route changes from being saved until the runtime contract test succeeds.

## Security

- Azure endpoint is restricted server-side to HTTPS `*.openai.azure.com` resource hosts.
- Username, password, query string, fragment, and arbitrary endpoint paths are rejected.
- Azure OpenAI cannot be selected as the embedding provider.
- API keys stay in Supabase Vault / Edge Function secrets and are not logged.
- Existing organization runtime rows are not modified by the migration, so no production organization silently switches providers.

## Implementation Notes

Completed:
- Azure OpenAI Responses API provider for structured chat and tool-plan output.
- Vault-backed endpoint/API-key configuration.
- Organization-level Azure chat/fallback selection.
- Provider and full-agent connectivity tests before activation.
- Model catalog support for the configured Azure deployment name.
- Endpoint validation tests.

Files Added:
- `supabase/functions/_shared/azure-openai.ts`
- `supabase/functions/_shared/azure-openai.test.ts`
- `supabase/migrations/20260822184500_azure_openai_chat_fallback.sql`
- `docs/AZURE_HYBRID_PROVIDER.md`

Files Modified:
- `supabase/functions/_shared/agent-runtime.ts`
- `supabase/functions/admin-api/index.ts`
- `supabase/functions/model-catalog/index.ts`
- `src/features/ai-settings/AiSettings.tsx`
- `src/features/agents/OrganizationAgents.tsx`

Database:
- Adds `azure_openai` to allowed organization chat and fallback providers.
- Adds an active, non-default global provider setting for `gpt-4.1-mini` if one does not already exist.
- Does not add Azure OpenAI to embedding-provider constraints.

Known Issues / Operator Input:
- Azure endpoint and API key must exist before Azure can pass its connectivity test.
- Azure deployment pricing should be maintained in `model_pricing` using the actual contracted/region price before relying on cost dashboards for Azure fallback usage.
