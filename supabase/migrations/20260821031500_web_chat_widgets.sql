create table public.web_chat_widgets(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  api_client_id uuid not null,
  prompt_profile_id uuid references public.prompt_profiles(id) on delete set null,
  knowledge_base_id uuid references public.knowledge_bases(id) on delete set null,
  name text not null check(char_length(name) between 1 and 120),
  public_key text not null unique check(public_key ~ '^ai_widget_[A-Za-z0-9_-]{24,}$'),
  api_key_vault_ref text not null check(api_key_vault_ref like 'vault:%'),
  title_ar text not null default 'المساعد الذكي',
  title_en text not null default 'AI Assistant',
  welcome_ar text not null default 'مرحبًا، كيف يمكنني مساعدتك؟',
  welcome_en text not null default 'Hello, how can I help you?',
  placeholder_ar text not null default 'اكتب رسالتك…',
  placeholder_en text not null default 'Type your message…',
  suggestions_ar jsonb not null default '[]'::jsonb check(jsonb_typeof(suggestions_ar)='array'),
  suggestions_en jsonb not null default '[]'::jsonb check(jsonb_typeof(suggestions_en)='array'),
  primary_color text not null default '#167D74' check(primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  position text not null default 'bottom_right' check(position in('bottom_right','bottom_left')),
  allowed_origins jsonb not null default '[]'::jsonb check(jsonb_typeof(allowed_origins)='array'),
  public_test_enabled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(api_client_id),
  foreign key(api_client_id,organization_id) references public.api_clients(id,organization_id) on delete restrict
);

create index web_chat_widgets_org_idx on public.web_chat_widgets(organization_id,created_at desc);
create index web_chat_widgets_public_test_idx on public.web_chat_widgets(public_test_enabled,is_active) where public_test_enabled=true and is_active=true;
create trigger web_chat_widgets_set_updated_at before update on public.web_chat_widgets for each row execute function public.set_updated_at();

alter table public.web_chat_widgets enable row level security;
create policy web_chat_widgets_select on public.web_chat_widgets for select to authenticated
using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());

grant select on public.web_chat_widgets to authenticated;
grant all on public.web_chat_widgets to service_role;

create or replace function public.create_web_widget_api_key(p_widget_id uuid,p_secret text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
begin
  if p_secret is null or p_secret not like 'ai_live_%' then raise exception 'invalid_widget_api_key'; end if;
  v_id := vault.create_secret(p_secret,'web_widget_'||p_widget_id::text,'Central AI internal web widget API key');
  return 'vault:'||v_id::text;
end;
$$;
revoke all on function public.create_web_widget_api_key(uuid,text) from public,anon,authenticated;
grant execute on function public.create_web_widget_api_key(uuid,text) to service_role;

create or replace function public.get_web_widget_api_key(p_widget_id uuid)
returns text
language sql
security definer
set search_path=''
as $$
  select ds.decrypted_secret
  from public.web_chat_widgets w
  join vault.decrypted_secrets ds on ds.id=substring(w.api_key_vault_ref from 7)::uuid
  where w.id=p_widget_id and w.api_key_vault_ref like 'vault:%'
  limit 1;
$$;
revoke all on function public.get_web_widget_api_key(uuid) from public,anon,authenticated;
grant execute on function public.get_web_widget_api_key(uuid) to service_role;

create or replace function public.delete_web_widget_api_key(p_ref text)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_ref is not null and p_ref like 'vault:%' then
    delete from vault.secrets where id=substring(p_ref from 7)::uuid;
  end if;
end;
$$;
revoke all on function public.delete_web_widget_api_key(text) from public,anon,authenticated;
grant execute on function public.delete_web_widget_api_key(text) to service_role;

comment on table public.web_chat_widgets is 'Public website chat widget configurations. Public keys are identifiers, never API secrets.';
comment on column public.web_chat_widgets.api_key_vault_ref is 'Reference to the dedicated internal ai_live key stored in Supabase Vault.';
