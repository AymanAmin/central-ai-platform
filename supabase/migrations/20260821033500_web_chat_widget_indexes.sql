create index if not exists web_chat_widgets_api_client_org_idx on public.web_chat_widgets(api_client_id,organization_id);
create index if not exists web_chat_widgets_prompt_profile_idx on public.web_chat_widgets(prompt_profile_id) where prompt_profile_id is not null;
create index if not exists web_chat_widgets_knowledge_base_idx on public.web_chat_widgets(knowledge_base_id) where knowledge_base_id is not null;
create index if not exists web_chat_widgets_created_by_idx on public.web_chat_widgets(created_by) where created_by is not null;
