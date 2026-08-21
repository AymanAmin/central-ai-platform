alter table public.organization_agents
  add column if not exists voice_retention_mode text not null default 'audio_and_transcript';

alter table public.organization_agents
  drop constraint if exists organization_agents_voice_retention_mode_check,
  add constraint organization_agents_voice_retention_mode_check
    check (voice_retention_mode in ('audio_and_transcript','transcript_only'));

alter table public.message_attachments
  add column if not exists original_audio_stored boolean not null default true,
  alter column storage_path drop not null,
  alter column bucket drop not null;

alter table public.message_attachments
  drop constraint if exists message_attachments_audio_storage_consistency_check,
  add constraint message_attachments_audio_storage_consistency_check check (
    (original_audio_stored and storage_path is not null and bucket is not null)
    or
    (not original_audio_stored and storage_path is null and bucket is null)
  );

comment on column public.organization_agents.voice_retention_mode is
  'Controls whether newly received voice messages keep the private original audio or retain transcript metadata only.';
comment on column public.message_attachments.original_audio_stored is
  'True only when the original audio file is retained in private Storage. Transcript-only records keep no original file.';
