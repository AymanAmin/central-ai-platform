alter table public.organization_agents
  drop constraint if exists organization_agents_chat_provider_check;

alter table public.organization_agents
  add constraint organization_agents_chat_provider_check
  check (chat_provider = any (array['gemini'::text, 'openrouter'::text, 'openai'::text, 'groq'::text, 'cloudflare'::text, 'azure_openai'::text]));

alter table public.organization_agents
  drop constraint if exists organization_agents_fallback_provider_check;

alter table public.organization_agents
  add constraint organization_agents_fallback_provider_check
  check (fallback_provider is null or fallback_provider = any (array['gemini'::text, 'openrouter'::text, 'openai'::text, 'groq'::text, 'cloudflare'::text, 'azure_openai'::text]));

insert into public.ai_provider_settings (
  organization_id,
  provider,
  chat_model,
  embedding_model,
  is_active,
  is_default,
  max_output_tokens,
  temperature
)
select
  null,
  'azure_openai',
  'gpt-4.1-mini',
  'gemini-embedding-001',
  true,
  false,
  600,
  0.2
where not exists (
  select 1
  from public.ai_provider_settings
  where organization_id is null
    and provider = 'azure_openai'
);
