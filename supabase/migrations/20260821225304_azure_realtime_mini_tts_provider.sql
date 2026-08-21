alter table public.organization_agents
  drop constraint if exists organization_agents_voice_tts_provider_check;

alter table public.organization_agents
  add constraint organization_agents_voice_tts_provider_check
  check (voice_tts_provider = any (array['gemini'::text, 'azure'::text, 'azure_realtime'::text]));

comment on column public.organization_agents.voice_tts_provider is
  'Speech synthesis provider: Gemini TTS, Azure Speech, or Azure OpenAI GPT Realtime Mini.';
