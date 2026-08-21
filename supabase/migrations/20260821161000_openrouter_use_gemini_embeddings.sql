-- OpenRouter is the chat provider, but the existing knowledge base was embedded with
-- gemini-embedding-001. Keep query and document vectors in that same embedding
-- space so changing the chat provider never invalidates RAG retrieval.
update public.ai_provider_settings
set embedding_model = 'gemini-embedding-001',
    updated_at = now()
where organization_id is null
  and provider = 'openrouter';

-- Usage is still attributed to the selected provider in the current logging model.
-- The Gemini embedding API is used server-side and its key remains in Supabase Vault.
insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, effective_from, is_active
)
values ('openrouter', 'gemini-embedding-001', 0, 0, 0, date '2026-08-21', true)
on conflict (provider, model, effective_from)
do update set
  embedding_cost_per_million = excluded.embedding_cost_per_million,
  is_active = excluded.is_active;
