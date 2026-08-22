-- Separate real account spend from commercial list-price estimates.
-- Existing `usage_logs.estimated_cost` is retained as the accounting/actual-cost
-- column for backward compatibility with quotas and existing runtime code.

create table if not exists public.provider_billing_settings (
  provider text primary key check (char_length(provider) between 2 and 80),
  billing_mode text not null default 'paid' check (billing_mode in ('free', 'paid')),
  updated_at timestamptz not null default now()
);

alter table public.provider_billing_settings enable row level security;

create policy provider_billing_settings_select
on public.provider_billing_settings
for select to authenticated
using (true);

create policy provider_billing_settings_insert
on public.provider_billing_settings
for insert to authenticated
with check (app_private.is_super_admin());

create policy provider_billing_settings_update
on public.provider_billing_settings
for update to authenticated
using (app_private.is_super_admin())
with check (app_private.is_super_admin());

create policy provider_billing_settings_delete
on public.provider_billing_settings
for delete to authenticated
using (app_private.is_super_admin());

grant select, insert, update, delete on public.provider_billing_settings to authenticated;
grant all on public.provider_billing_settings to service_role;

create trigger provider_billing_settings_set_updated_at
before update on public.provider_billing_settings
for each row execute function public.set_updated_at();

insert into public.provider_billing_settings (provider, billing_mode)
values
  ('gemini', 'paid'),
  ('openrouter', 'paid'),
  ('openai', 'paid'),
  ('azure_openai', 'paid'),
  ('groq', 'free'),
  ('cloudflare', 'paid'),
  ('azure', 'paid')
on conflict (provider) do nothing;

alter table public.usage_logs
  add column if not exists commercial_estimated_cost numeric not null default 0 check (commercial_estimated_cost >= 0),
  add column if not exists billing_mode text not null default 'paid' check (billing_mode in ('free', 'paid'));

comment on column public.usage_logs.estimated_cost is
  'Actual/accounting cost used for budget limits. Zero when the provider/model is configured as free.';
comment on column public.usage_logs.commercial_estimated_cost is
  'Commercial list-price estimate independent of the configured provider billing mode.';
comment on column public.usage_logs.billing_mode is
  'Billing mode snapshot at the time the usage event was recorded.';

-- Preserve the previously calculated list-price estimate before changing the
-- accounting meaning of `estimated_cost`.
update public.usage_logs
set commercial_estimated_cost = estimated_cost;

-- The current Groq account is explicitly operated on Groq Free Tier.
-- OpenRouter model IDs ending in :free (and the openrouter/free router) are
-- intrinsically free even if the provider-level default is paid.
update public.usage_logs u
set
  billing_mode = case
    when u.provider = 'openrouter' and (u.model = 'openrouter/free' or u.model like '%:free') then 'free'
    else coalesce(p.billing_mode, 'paid')
  end,
  estimated_cost = case
    when u.provider = 'openrouter' and (u.model = 'openrouter/free' or u.model like '%:free') then 0
    when coalesce(p.billing_mode, 'paid') = 'free' then 0
    else u.commercial_estimated_cost
  end
from (select 1) seed
left join public.provider_billing_settings p on p.provider = u.provider;

create or replace function app_private.apply_usage_billing_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_commercial numeric;
begin
  v_commercial := greatest(coalesce(new.estimated_cost, 0), 0);

  if new.provider = 'openrouter'
     and (new.model = 'openrouter/free' or new.model like '%:free') then
    v_mode := 'free';
  else
    select p.billing_mode
      into v_mode
      from public.provider_billing_settings p
     where p.provider = new.provider;
    v_mode := coalesce(v_mode, 'paid');
  end if;

  new.commercial_estimated_cost := v_commercial;
  new.billing_mode := v_mode;
  new.estimated_cost := case when v_mode = 'free' then 0 else v_commercial end;
  return new;
end;
$$;

revoke all on function app_private.apply_usage_billing_mode() from public, anon, authenticated;

drop trigger if exists usage_logs_apply_billing_mode_before_insert on public.usage_logs;
create trigger usage_logs_apply_billing_mode_before_insert
before insert on public.usage_logs
for each row execute function app_private.apply_usage_billing_mode();

-- Keep the existing `estimated_cost_usd` view field as a compatibility alias
-- for actual spend, and expose the list-price estimate separately.
create or replace view public.organization_agent_monthly_usage
with (security_invoker = true)
as
with usage_month as (
  select
    organization_id,
    coalesce(sum(input_tokens + output_tokens + embedding_tokens), 0)::bigint as total_tokens,
    coalesce(sum(estimated_cost), 0)::numeric as actual_cost_usd,
    coalesce(sum(commercial_estimated_cost), 0)::numeric as commercial_estimated_cost_usd
  from public.usage_logs
  where created_at >= date_trunc('month', now())
  group by organization_id
), message_month as (
  select organization_id, count(*)::bigint as customer_messages
  from public.messages
  where role = 'user' and created_at >= date_trunc('month', now())
  group by organization_id
), voice_month as (
  select organization_id, coalesce(sum(duration_ms), 0)::bigint as voice_duration_ms
  from public.message_attachments
  where kind = 'audio'
    and audio_source = 'customer_voice'
    and created_at >= date_trunc('month', now())
  group by organization_id
), tts_month as (
  select organization_id, coalesce(sum(duration_ms), 0)::bigint as tts_duration_ms
  from public.message_attachments
  where kind = 'audio'
    and audio_source = 'assistant_tts'
    and created_at >= date_trunc('month', now())
  group by organization_id
)
select
  o.id as organization_id,
  coalesce(m.customer_messages, 0) as customer_messages,
  coalesce(u.total_tokens, 0) as total_tokens,
  coalesce(u.actual_cost_usd, 0) as estimated_cost_usd,
  coalesce(v.voice_duration_ms, 0) as voice_duration_ms,
  coalesce(t.tts_duration_ms, 0) as tts_duration_ms,
  coalesce(u.actual_cost_usd, 0) as actual_cost_usd,
  coalesce(u.commercial_estimated_cost_usd, 0) as commercial_estimated_cost_usd
from public.organizations o
left join usage_month u on u.organization_id = o.id
left join message_month m on m.organization_id = o.id
left join voice_month v on v.organization_id = o.id
left join tts_month t on t.organization_id = o.id;

grant select on public.organization_agent_monthly_usage to authenticated;
