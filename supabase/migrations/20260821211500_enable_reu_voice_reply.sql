update public.organization_agents
set
  voice_reply_mode = 'voice_on_voice',
  tts_provider = 'gemini',
  tts_model = 'gemini-2.5-flash-preview-tts',
  tts_voice_ar = 'Sulafat',
  tts_voice_en = 'Achird'
where organization_id = (
  select id from public.organizations where code = 'REU' limit 1
);
