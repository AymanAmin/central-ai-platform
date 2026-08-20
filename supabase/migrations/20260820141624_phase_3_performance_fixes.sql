create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists conversations_api_client_org_fk_idx on public.conversations(api_client_id,organization_id);
create index if not exists conversations_customer_org_fk_idx on public.conversations(customer_id,organization_id);
create index if not exists conversations_assigned_user_id_idx on public.conversations(assigned_user_id);
create index if not exists messages_conversation_org_fk_idx on public.messages(conversation_id,organization_id);
