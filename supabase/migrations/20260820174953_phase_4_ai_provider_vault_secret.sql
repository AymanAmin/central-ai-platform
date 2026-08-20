create or replace function public.set_ai_provider_secret(p_provider_setting_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'ai_provider_' || p_provider_setting_id::text;
  v_id uuid;
begin
  if nullif(trim(p_secret), '') is null then
    raise exception 'provider_secret_required';
  end if;
  if not exists (select 1 from public.ai_provider_settings where id = p_provider_setting_id) then
    raise exception 'provider_setting_not_found';
  end if;
  select ds.id into v_id from vault.decrypted_secrets ds where ds.name = v_name limit 1;
  if v_id is null then
    perform vault.create_secret(p_secret, v_name, 'Central AI provider credential');
  else
    perform vault.update_secret(v_id, p_secret, null, null);
  end if;
end;
$$;

create or replace function public.get_ai_provider_secret(p_provider_setting_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = 'ai_provider_' || p_provider_setting_id::text
  limit 1;
$$;

create or replace function public.has_ai_provider_secret(p_provider_setting_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists(
    select 1 from vault.decrypted_secrets ds
    where ds.name = 'ai_provider_' || p_provider_setting_id::text
  );
$$;

revoke all on function public.set_ai_provider_secret(uuid,text) from public, anon, authenticated;
revoke all on function public.get_ai_provider_secret(uuid) from public, anon, authenticated;
revoke all on function public.has_ai_provider_secret(uuid) from public, anon, authenticated;
grant execute on function public.set_ai_provider_secret(uuid,text) to service_role;
grant execute on function public.get_ai_provider_secret(uuid) to service_role;
grant execute on function public.has_ai_provider_secret(uuid) to service_role;
