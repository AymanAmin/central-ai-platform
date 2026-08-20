create table public.ai_provider_settings(
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade, provider text not null, chat_model text not null, embedding_model text not null,
 is_active boolean not null default true, is_default boolean not null default false, max_input_tokens integer, max_output_tokens integer, temperature numeric not null default .2 check(temperature between 0 and 2),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.prompt_profiles(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, system_prompt text not null,
 default_language text not null default 'ar' check(default_language in('ar','en')), tone text, knowledge_only boolean not null default true, allow_general_knowledge boolean not null default false,
 is_default boolean not null default false, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.model_pricing(
 id uuid primary key default gen_random_uuid(), provider text not null, model text not null, input_cost_per_million numeric not null default 0,
 output_cost_per_million numeric not null default 0, embedding_cost_per_million numeric not null default 0, effective_from date not null, is_active boolean not null default true,
 unique(provider,model,effective_from)
);
create table public.usage_logs(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, api_client_id uuid, conversation_id uuid, message_id uuid,
 operation text not null, provider text, model text, input_tokens integer not null default 0 check(input_tokens>=0), output_tokens integer not null default 0 check(output_tokens>=0),
 embedding_tokens integer not null default 0 check(embedding_tokens>=0), estimated_cost numeric not null default 0 check(estimated_cost>=0), latency_ms integer, created_at timestamptz not null default now(),
 foreign key(api_client_id,organization_id) references public.api_clients(id,organization_id) on delete set null,
 foreign key(conversation_id,organization_id) references public.conversations(id,organization_id) on delete set null,
 foreign key(message_id,organization_id) references public.messages(id,organization_id) on delete set null
);
create trigger ai_provider_settings_set_updated_at before update on public.ai_provider_settings for each row execute function public.set_updated_at();
create trigger prompt_profiles_set_updated_at before update on public.prompt_profiles for each row execute function public.set_updated_at();
create index ai_provider_settings_org_idx on public.ai_provider_settings(organization_id,is_default) where is_active=true;
create index prompt_profiles_org_idx on public.prompt_profiles(organization_id,is_default) where is_active=true;
create index usage_logs_org_created_idx on public.usage_logs(organization_id,created_at desc);
create index usage_logs_api_client_org_fk_idx on public.usage_logs(api_client_id,organization_id);
create index usage_logs_conversation_org_fk_idx on public.usage_logs(conversation_id,organization_id);
create index usage_logs_message_org_fk_idx on public.usage_logs(message_id,organization_id);
alter table public.ai_provider_settings enable row level security; alter table public.prompt_profiles enable row level security; alter table public.model_pricing enable row level security; alter table public.usage_logs enable row level security;
create policy ai_provider_settings_select on public.ai_provider_settings for select to authenticated using(app_private.is_super_admin() or organization_id is null or organization_id=app_private.current_user_organization_id());
create policy ai_provider_settings_insert on public.ai_provider_settings for insert to authenticated with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy ai_provider_settings_update on public.ai_provider_settings for update to authenticated using(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy ai_provider_settings_delete on public.ai_provider_settings for delete to authenticated using(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy prompt_profiles_select on public.prompt_profiles for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
create policy prompt_profiles_insert on public.prompt_profiles for insert to authenticated with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy prompt_profiles_update on public.prompt_profiles for update to authenticated using(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id())) with check(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy prompt_profiles_delete on public.prompt_profiles for delete to authenticated using(app_private.is_org_admin() and (app_private.is_super_admin() or organization_id=app_private.current_user_organization_id()));
create policy model_pricing_select on public.model_pricing for select to authenticated using(true);
create policy model_pricing_insert on public.model_pricing for insert to authenticated with check(app_private.is_super_admin());
create policy model_pricing_update on public.model_pricing for update to authenticated using(app_private.is_super_admin()) with check(app_private.is_super_admin());
create policy model_pricing_delete on public.model_pricing for delete to authenticated using(app_private.is_super_admin());
create policy usage_logs_select on public.usage_logs for select to authenticated using(app_private.is_super_admin() or organization_id=app_private.current_user_organization_id());
grant select,insert,update,delete on public.ai_provider_settings,public.prompt_profiles,public.model_pricing to authenticated; grant select on public.usage_logs to authenticated; grant all on public.ai_provider_settings,public.prompt_profiles,public.model_pricing,public.usage_logs to service_role;
