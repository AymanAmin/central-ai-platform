create or replace function public.create_organization_with_settings(
  p_code text,
  p_name_ar text,
  p_name_en text,
  p_default_language text default 'ar'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text := upper(trim(p_code));
  v_name_ar text := trim(p_name_ar);
  v_name_en text := nullif(trim(p_name_en), '');
begin
  if v_code = '' or v_code !~ '^[A-Z0-9_-]+$' or length(v_code) > 64 then
    raise exception 'invalid_organization_code';
  end if;
  if v_name_ar = '' or length(v_name_ar) > 200 then
    raise exception 'invalid_organization_name_ar';
  end if;
  if v_name_en is not null and length(v_name_en) > 200 then
    raise exception 'invalid_organization_name_en';
  end if;
  if p_default_language not in ('ar','en') then
    raise exception 'invalid_default_language';
  end if;

  insert into public.organizations(code,name_ar,name_en,default_language)
  values(v_code,v_name_ar,v_name_en,p_default_language)
  returning id into v_id;

  insert into public.organization_settings(organization_id)
  values(v_id);

  return v_id;
end;
$$;

revoke all on function public.create_organization_with_settings(text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_organization_with_settings(text,text,text,text) to service_role;
