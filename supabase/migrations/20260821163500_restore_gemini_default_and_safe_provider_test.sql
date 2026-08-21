-- Keep production on the proven Gemini chat path until an alternate provider passes
-- the same structured-chat contract used by the real agent. OpenRouter stays
-- configured and keeps Gemini embeddings so switching chat providers never
-- invalidates the existing knowledge vector space.
begin;

update public.ai_provider_settings
set is_default = false,
    updated_at = now()
where organization_id is null
  and is_default = true;

update public.ai_provider_settings
set is_default = true,
    updated_at = now()
where organization_id is null
  and provider = 'gemini'
  and is_active = true;

update public.ai_provider_settings
set chat_model = 'openrouter/free',
    embedding_model = 'gemini-embedding-001',
    updated_at = now()
where organization_id is null
  and provider = 'openrouter';

commit;
