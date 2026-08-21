revoke all on table public.web_chat_widgets from public, anon, authenticated;
grant select on table public.web_chat_widgets to authenticated;
grant all on table public.web_chat_widgets to service_role;
