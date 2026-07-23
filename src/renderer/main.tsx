import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.js'
import { createAnybuddyClients } from './api/clients.js'
import { AnybuddyApiProvider } from './api/context.js'
import { useAppStore } from './stores/app-store.js'
import './styles/app.css'

if (!window.anybuddy) {
  console.error('window.anybuddy is undefined. Make sure Electron preload script is loaded.')
}

const clients = createAnybuddyClients(window.anybuddy)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnybuddyApiProvider clients={clients}>
      <HashRouter>
        <App />
      </HashRouter>
    </AnybuddyApiProvider>
  </React.StrictMode>,
)

useAppStore.getState().bootstrap().catch(error => {
  console.error('Bootstrap failed', error)
})
