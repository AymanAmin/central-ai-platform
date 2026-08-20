create or replace function public.set_agent_tool_secret(p_tool_id uuid,p_secret jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_ref text;v_id uuid;begin select auth_config_encrypted into v_ref from public.agent_tools where id=p_tool_id for update;if not found then raise exception 'tool_not_found';end if;
 if v_ref is not null and v_ref like 'vault:%' then v_id:=substring(v_ref from 7)::uuid;perform vault.update_secret(v_id,p_secret::text,null,null);
 else v_id:=vault.create_secret(p_secret::text,'agent_tool_'||p_tool_id::text,'Central AI agent tool credential');update public.agent_tools set auth_config_encrypted='vault:'||v_id::text,updated_at=now() where id=p_tool_id;end if;end;
$$;
create or replace function public.get_agent_tool_secret(p_tool_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select ds.decrypted_secret::jsonb from public.agent_tools t join vault.decrypted_secrets ds on ds.id=substring(t.auth_config_encrypted from 7)::uuid where t.id=p_tool_id and t.auth_config_encrypted like 'vault:%' limit 1
$$;
revoke all on function public.set_agent_tool_secret(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.get_agent_tool_secret(uuid) from public,anon,authenticated;
grant execute on function public.set_agent_tool_secret(uuid,jsonb),public.get_agent_tool_secret(uuid) to service_role;
