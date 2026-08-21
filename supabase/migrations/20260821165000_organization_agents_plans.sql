create table if not exists public.organization_agents (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  agent_name text not null default 'AI Agent' check (char_length(agent_name) between 2 and 120),
  plan_name text not null default 'Standard' check (char_length(plan_name) between 2 and 120),
  chat_provider text not null default 'gemini' check (chat_provider in ('gemini','openrouter','openai')),
  chat_model text not null default 'gemini-3.1-flash-lite' check (char_length(chat_model) between 2 and 180),
  embedding_provider text not null default 'gemini' check (embedding_provider in ('gemini','openrouter','openai')),
  embedding_model text not null default 'gemini-embedding-001' check (char_length(embedding_model) between 2 and 180),
  fallback_provider text check (fallback_provider is null or fallback_provider in ('gemini','openrouter','openai')),
  fallback_model text check (fallback_model is null or char_length(fallback_model) between 2 and 180),
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  billing_currency text not null default 'SAR' check (billing_currency in ('SAR','USD','AED','EUR')),
  included_monthly_messages integer check (included_monthly_messages is null or included_monthly_messages >= 0),
  included_monthly_tokens bigint check (included_monthly_tokens is null or included_monthly_tokens >= 0),
  monthly_ai_cost_limit_usd numeric(12,4) check (monthly_ai_cost_limit_usd is null or monthly_ai_cost_limit_usd >= 0),
  markup_percent numeric(7,2) not null default 0 check (markup_percent >= 0 and markup_percent <= 10000),
  notes text,
  is_active boolean not null default true,
  last_tested_at timestamptz,
  last_test_status text not null default 'untested' check (last_test_status in ('untested','passed','failed')),
  last_test_latency_ms integer check (last_test_latency_ms is null or last_test_latency_ms >= 0),
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((fallback_provider is null and fallback_model is null) or (fallback_provider is not null and fallback_model is not null))
);

create index if not exists idx_organization_agents_chat_provider on public.organization_agents(chat_provider) where is_active = true;
create index if not exists idx_usage_logs_org_created on public.usage_logs(organization_id, created_at desc);
create index if not exists idx_messages_org_role_created on public.messages(organization_id, role, created_at desc);

alter table public.organization_agents enable row level security;

create policy organization_agents_select on public.organization_agents
for select to authenticated
using (app_private.is_super_admin());

create policy organization_agents_insert on public.organization_agents
for insert to authenticated
with check (app_private.is_super_admin());

create policy organization_agents_update on public.organization_agents
for update to authenticated
using (app_private.is_super_admin())
with check (app_private.is_super_admin());

create policy organization_agents_delete on public.organization_agents
for delete to authenticated
using (app_private.is_super_admin());

create trigger organization_agents_set_updated_at
before update on public.organization_agents
for each row execute function public.set_updated_at();

insert into public.organization_agents (
  organization_id, agent_name, plan_name, chat_provider, chat_model,
  embedding_provider, embedding_model, fallback_provider, fallback_model,
  monthly_price, billing_currency, is_active
)
select
  o.id,
  'وكيل ' || o.name_ar,
  'Standard',
  coalesce(g.provider, 'gemini'),
  coalesce(g.chat_model, 'gemini-3.1-flash-lite'),
  case
    when coalesce(g.embedding_model, 'gemini-embedding-001') like 'gemini-%' then 'gemini'
    else coalesce(g.provider, 'gemini')
  end,
  coalesce(g.embedding_model, 'gemini-embedding-001'),
  case when coalesce(g.provider, 'gemini') = 'gemini' then null else 'gemini' end,
  case when coalesce(g.provider, 'gemini') = 'gemini' then null else 'gemini-3.1-flash-lite' end,
  0,
  'SAR',
  true
from public.organizations o
left join lateral (
  select provider, chat_model, embedding_model
  from public.ai_provider_settings
  where organization_id is null and is_active = true and is_default = true
  order by updated_at desc
  limit 1
) g on true
on conflict (organization_id) do nothing;

create or replace function public.create_default_organization_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_provider text := 'gemini';
  p_chat_model text := 'gemini-3.1-flash-lite';
  p_embedding_model text := 'gemini-embedding-001';
  p_embedding_provider text := 'gemini';
begin
  select provider, chat_model, embedding_model,
    case when embedding_model like 'gemini-%' then 'gemini' else provider end
  into p_provider, p_chat_model, p_embedding_model, p_embedding_provider
  from public.ai_provider_settings
  where organization_id is null and is_active = true and is_default = true
  order by updated_at desc
  limit 1;

  insert into public.organization_agents (
    organization_id, agent_name, plan_name, chat_provider, chat_model,
    embedding_provider, embedding_model, fallback_provider, fallback_model,
    billing_currency, is_active
  ) values (
    new.id, 'وكيل ' || new.name_ar, 'Standard',
    coalesce(p_provider, 'gemini'), coalesce(p_chat_model, 'gemini-3.1-flash-lite'),
    coalesce(p_embedding_provider, 'gemini'), coalesce(p_embedding_model, 'gemini-embedding-001'),
    case when coalesce(p_provider, 'gemini') = 'gemini' then null else 'gemini' end,
    case when coalesce(p_provider, 'gemini') = 'gemini' then null else 'gemini-3.1-flash-lite' end,
    'SAR', true
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_default_organization_agent() from public, anon, authenticated;

create trigger organizations_create_default_agent
after insert on public.organizations
for each row execute function public.create_default_organization_agent();

create or replace function public.reindex_knowledge_on_agent_embedding_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.embedding_provider is distinct from old.embedding_provider
     or new.embedding_model is distinct from old.embedding_model then
    update public.knowledge_documents
    set processing_status = 'pending', processing_error = null
    where organization_id = new.organization_id and is_active = true;

    insert into public.background_jobs (organization_id, job_type, payload, priority)
    select d.organization_id, 'process_document', jsonb_build_object('documentId', d.id), 100
    from public.knowledge_documents d
    where d.organization_id = new.organization_id
      and d.is_active = true
      and not exists (
        select 1
        from public.background_jobs j
        where j.organization_id = d.organization_id
          and j.job_type = 'process_document'
          and j.status in ('pending', 'running')
          and j.payload @> jsonb_build_object('documentId', d.id)
      );
  end if;
  return new;
end;
$$;

revoke all on function public.reindex_knowledge_on_agent_embedding_change() from public, anon, authenticated;

create trigger organization_agents_reindex_knowledge
after update of embedding_provider, embedding_model on public.organization_agents
for each row execute function public.reindex_knowledge_on_agent_embedding_change();

create or replace view public.organization_agent_monthly_usage
with (security_invoker = true)
as
with usage_month as (
  select
    organization_id,
    coalesce(sum(input_tokens + output_tokens + embedding_tokens), 0)::bigint as total_tokens,
    coalesce(sum(estimated_cost), 0)::numeric as estimated_cost_usd
  from public.usage_logs
  where created_at >= date_trunc('month', now())
  group by organization_id
), message_month as (
  select organization_id, count(*)::bigint as customer_messages
  from public.messages
  where role = 'user' and created_at >= date_trunc('month', now())
  group by organization_id
)
select
  o.id as organization_id,
  coalesce(m.customer_messages, 0) as customer_messages,
  coalesce(u.total_tokens, 0) as total_tokens,
  coalesce(u.estimated_cost_usd, 0) as estimated_cost_usd
from public.organizations o
left join usage_month u on u.organization_id = o.id
left join message_month m on m.organization_id = o.id;

grant select on public.organization_agent_monthly_usage to authenticated;
