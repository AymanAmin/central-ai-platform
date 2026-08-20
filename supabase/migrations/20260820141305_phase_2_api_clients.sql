create table public.api_clients(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, code text not null,
 api_key_hash text not null, api_key_prefix text not null, is_active boolean not null default true, rate_limit_per_minute integer not null default 60 check(rate_limit_per_minute>0),
 capabilities jsonb not null default '["chat"]'::jsonb, allowed_ips jsonb not null default '[]'::jsonb, last_used_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,code), unique(id,organization_id), unique(api_key_hash)
);
create index api_clients_organization_id_idx on public.api_clients(organization_id);
create trigger api_clients_set_updated_at before update on public.api_clients for each row execute function public.set_updated_at();
alter table public.api_clients enable row level security;
create policy api_clients_select on public.api_clients for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create view public.api_clients_safe with(security_invoker=true) as select id,organization_id,name,code,api_key_prefix,is_active,rate_limit_per_minute,capabilities,allowed_ips,last_used_at,created_at,updated_at from public.api_clients;
revoke all on public.api_clients from anon,authenticated;
grant select on public.api_clients_safe to authenticated;
grant all on public.api_clients to service_role;
