alter table public.organization_agents
  drop constraint if exists organization_agents_voice_tts_provider_check,
  add constraint organization_agents_voice_tts_provider_check
    check (voice_tts_provider in ('gemini','azure'));

comment on column public.organization_agents.voice_tts_provider is
  'Speech synthesis provider selected per organization. Supported values are gemini and azure.';
comment on column public.organization_agents.voice_tts_model is
  'Provider-specific speech model identifier. Azure Speech uses neural-tts.';
comment on column public.organization_agents.voice_tts_voice is
  'Provider-specific voice. Azure Speech is restricted in the runtime to ar-SA-HamedNeural or ar-SA-ZariyahNeural.';
