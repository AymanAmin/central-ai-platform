-- Add OpenRouter as an optional global AI provider without changing the current default.
-- Chat uses the zero-cost OpenRouter free router. RAG embeddings stay on a fixed
-- 1536-dimensional model so they remain compatible with knowledge_chunks.vector(1536).
insert into public.ai_provider_settings (
  organization_id, provider, chat_model, embedding_model,
  is_active, is_default, max_input_tokens, max_output_tokens, temperature
)
select
  null, 'openrouter', 'openrouter/free', 'openai/text-embedding-3-small',
  true, false, 128000, 600, 0.2
where not exists (
  select 1
  from public.ai_provider_settings
  where organization_id is null and provider = 'openrouter'
);

insert into public.model_pricing (
  provider, model, input_cost_per_million, output_cost_per_million,
  embedding_cost_per_million, effective_from, is_active
)
values
  ('openrouter', 'openrouter/free', 0, 0, 0, date '2026-08-21', true),
  ('openrouter', 'openai/text-embedding-3-small', 0, 0, 0.02, date '2026-08-21', true)
on conflict (provider, model, effective_from)
do update set
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  embedding_cost_per_million = excluded.embedding_cost_per_million,
  is_active = excluded.is_active;

create or replace function public.set_default_ai_provider(p_provider_setting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.ai_provider_settings
    where id = p_provider_setting_id
      and organization_id is null
      and is_active = true
  ) then
    raise exception 'provider_setting_not_found';
  end if;

  update public.ai_provider_settings
  set is_default = false, updated_at = now()
  where organization_id is null and is_default = true;

  update public.ai_provider_settings
  set is_default = true, updated_at = now()
  where id = p_provider_setting_id
    and organization_id is null
    and is_active = true;
end;
$$;

revoke all on function public.set_default_ai_provider(uuid) from public, anon, authenticated;
grant execute on function public.set_default_ai_provider(uuid) to service_role;
