create index if not exists message_attachments_conversation_idx
  on public.message_attachments(conversation_id);
