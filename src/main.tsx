import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './lib/i18n'
import './app/styles.css'
import './app/refinements.css'
import './app/admin-actions.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><I18nProvider><App /></I18nProvider></StrictMode>,
)
