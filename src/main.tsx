import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './lib/i18n'
import './app/styles.css'
import './app/refinements.css'
import './app/modals.css'
import './app/admin-actions.css'
import './app/web-chat.css'
import './app/external-chat-placement.css'
import './app/integration-guide.css'
import './app/interaction-config.css'
import './app/customer-chat-continuity.css'
import './app/agent-plans.css'
import './app/voice-chat.css'
import './app/voice-contrast.css'
import './app/responsive-admin-workspaces.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><I18nProvider><App /></I18nProvider></StrictMode>,
)
