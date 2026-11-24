import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/baloo-2'
import '@fontsource-variable/lora'
import './styles/global.css'
import './styles/home.css'
import './styles/notes.css'
import './styles/capture.css'
import './styles/note.css'
import './styles/settings.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
