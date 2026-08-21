create or replace function public.sync_organization_agent_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organization_settings
  set
    monthly_message_limit = new.included_monthly_messages,
    monthly_token_limit = new.included_monthly_tokens,
    updated_at = now()
  where organization_id = new.organization_id;

  return new;
end;
$$;

revoke all on function public.sync_organization_agent_plan_limits() from public, anon, authenticated;

create trigger organization_agents_sync_plan_limits
after insert or update of included_monthly_messages, included_monthly_tokens
on public.organization_agents
for each row execute function public.sync_organization_agent_plan_limits();

update public.organization_settings s
set
  monthly_message_limit = a.included_monthly_messages,
  monthly_token_limit = a.included_monthly_tokens,
  updated_at = now()
from public.organization_agents a
where a.organization_id = s.organization_id;
