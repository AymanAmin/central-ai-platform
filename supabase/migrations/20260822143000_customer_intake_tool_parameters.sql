alter table public.web_chat_widgets
  add column if not exists intake_fields jsonb not null default '{"firstName":{"visible":true,"required":false},"lastName":{"visible":true,"required":false},"phone":{"visible":true,"required":false},"email":{"visible":true,"required":false},"question":{"visible":true,"required":false}}'::jsonb;

alter table public.web_chat_widgets
  drop constraint if exists web_chat_widgets_intake_fields_object_check;
alter table public.web_chat_widgets
  add constraint web_chat_widgets_intake_fields_object_check
  check (jsonb_typeof(intake_fields) = 'object');

update public.api_clients client
set capabilities = client.capabilities || '["use_read_tools"]'::jsonb
where client.id in (select widget.api_client_id from public.web_chat_widgets widget)
  and not (client.capabilities ? 'use_read_tools');
