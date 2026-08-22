create or replace function public.set_agent_tool_guidance(p_tool_id uuid, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tool_org uuid;
  v_actor_org uuid;
  v_actor_role text;
  v_actor_active boolean;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'unauthorized';
  end if;

  select t.organization_id
    into v_tool_org
  from public.agent_tools t
  where t.id = p_tool_id;

  if v_tool_org is null then
    raise exception using errcode = 'P0002', message = 'tool_not_found';
  end if;

  select p.organization_id, p.role::text, p.is_active
    into v_actor_org, v_actor_role, v_actor_active
  from public.profiles p
  where p.id = auth.uid();

  if coalesce(v_actor_active, false) is not true
     or v_actor_role not in ('SUPER_ADMIN', 'ORGANIZATION_ADMIN')
     or (v_actor_role <> 'SUPER_ADMIN' and v_actor_org is distinct from v_tool_org) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  if length(coalesce(v_description, '')) > 4000 then
    raise exception using errcode = '22001', message = 'tool_guidance_too_long';
  end if;

  update public.agent_tools
  set description = v_description
  where id = p_tool_id;
end;
$$;

revoke all on function public.set_agent_tool_guidance(uuid, text) from public;
grant execute on function public.set_agent_tool_guidance(uuid, text) to authenticated;
