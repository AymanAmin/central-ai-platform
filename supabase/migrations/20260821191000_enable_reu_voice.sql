update public.organization_agents a
set
  voice_enabled = true,
  voice_provider = 'gemini',
  voice_model = 'gemini-3.5-flash-lite',
  max_voice_seconds = 120,
  included_monthly_voice_minutes = null
from public.organizations o
where o.id = a.organization_id
  and o.code = 'REU';
