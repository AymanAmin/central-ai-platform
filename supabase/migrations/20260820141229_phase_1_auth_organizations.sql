create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end;
$$;

create table public.organizations(
 id uuid primary key default gen_random_uuid(), code text not null unique, name_ar text not null, name_en text, description text,
 default_language text not null default 'ar' check(default_language in('ar','en')), timezone text not null default 'Asia/Riyadh',
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.profiles(
 id uuid primary key references auth.users(id) on delete cascade, organization_id uuid references public.organizations(id) on delete restrict,
 full_name text not null, email text not null, role text not null check(role in('SUPER_ADMIN','ORGANIZATION_ADMIN','KNOWLEDGE_MANAGER','SUPPORT_AGENT','VIEWER')),
 is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.organization_settings(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 default_language text not null default 'ar' check(default_language in('ar','en')), ai_enabled boolean not null default true,
 knowledge_only boolean not null default true, allow_general_knowledge boolean not null default false,
 recent_messages_count integer not null default 6 check(recent_messages_count between 0 and 50), summarize_after_count integer not null default 16 check(summarize_after_count between 4 and 500),
 rag_top_k integer not null default 4 check(rag_top_k between 1 and 20), min_similarity numeric not null default .60 check(min_similarity between 0 and 1),
 max_context_tokens integer not null default 3000 check(max_context_tokens>0), max_output_tokens integer not null default 600 check(max_output_tokens>0),
 human_handoff_threshold numeric not null default .60 check(human_handoff_threshold between 0 and 1), daily_message_limit integer, monthly_message_limit integer,
 daily_token_limit bigint, monthly_token_limit bigint, direct_faq_enabled boolean not null default true, greeting_fast_path_enabled boolean not null default true,
 greeting_ar text not null default 'مرحبًا، كيف يمكنني مساعدتك؟', greeting_en text not null default 'Hello, how can I help you?',
 no_answer_ar text not null default 'لم أجد معلومة مؤكدة حول هذا الموضوع في قاعدة المعرفة الحالية.', no_answer_en text not null default 'I could not find confirmed information about this in the current knowledge base.',
 handoff_ar text not null default 'سأحوّل طلبك إلى أحد الموظفين لمساعدتك.', handoff_en text not null default 'I will hand this request over to a team member for assistance.',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.audit_logs(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete set null,
 user_id uuid references public.profiles(id) on delete set null, action text not null, entity_type text not null, entity_id text,
 metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create or replace function app_private.current_user_role() returns text language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p where p.id=auth.uid() and p.is_active=true limit 1
$$;
create or replace function app_private.current_user_organization_id() returns uuid language sql stable security definer set search_path='' as $$
 select p.organization_id from public.profiles p where p.id=auth.uid() and p.is_active=true limit 1
$$;
create or replace function app_private.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.current_user_role()='SUPER_ADMIN',false)
$$;
create or replace function app_private.is_org_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.current_user_role() in('SUPER_ADMIN','ORGANIZATION_ADMIN'),false)
$$;
create or replace function app_private.can_manage_knowledge() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.current_user_role() in('SUPER_ADMIN','ORGANIZATION_ADMIN','KNOWLEDGE_MANAGER'),false)
$$;
create or replace function app_private.can_support() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(app_private.current_user_role() in('SUPER_ADMIN','ORGANIZATION_ADMIN','SUPPORT_AGENT'),false)
$$;
revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organization_settings_set_updated_at before update on public.organization_settings for each row execute function public.set_updated_at();
create index profiles_organization_id_idx on public.profiles(organization_id);
create index audit_logs_org_created_idx on public.audit_logs(organization_id,created_at desc);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_select on public.organizations for select to authenticated using(app_private.is_super_admin() or id=app_private.current_user_organization_id());
create policy organizations_insert on public.organizations for insert to authenticated with check(app_private.is_super_admin());
create policy organizations_update on public.organizations for update to authenticated using(app_private.is_super_admin()) with check(app_private.is_super_admin());
create policy organizations_delete on public.organizations for delete to authenticated using(app_private.is_super_admin());
create policy profiles_select on public.profiles for select to authenticated using(app_private.is_super_admin() or id=(select auth.uid()) or organization_id=app_private.current_user_organization_id());
create policy profiles_insert on public.profiles for insert to authenticated with check(app_private.is_super_admin() or (app_private.current_user_role()='ORGANIZATION_ADMIN' and organization_id=app_private.current_user_organization_id() and role<>'SUPER_ADMIN'));
create policy profiles_update on public.profiles for update to authenticated using(app_private.is_super_admin() or (app_private.current_user_role()='ORGANIZATION_ADMIN' and organization_id=app_private.current_user_organization_id())) with check(app_private.is_super_admin() or (organization_id=app_private.current_user_organization_id() and role<>'SUPER_ADMIN'));
create policy organization_settings_select on public.organization_settings for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy organization_settings_insert on public.organization_settings for insert to authenticated with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy organization_settings_update on public.organization_settings for update to authenticated using(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy audit_logs_select on public.audit_logs for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());

grant select,insert,update,delete on public.organizations,public.profiles,public.organization_settings to authenticated;
grant select on public.audit_logs to authenticated;
grant all on public.organizations,public.profiles,public.organization_settings,public.audit_logs to service_role;
