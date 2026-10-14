import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initTelegram } from './utils/telegram'
import { applyTheme } from './utils/theme'
import './index.css'

initTelegram()
applyTheme()
window.Telegram?.WebApp?.onEvent?.('themeChanged', () => applyTheme())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
