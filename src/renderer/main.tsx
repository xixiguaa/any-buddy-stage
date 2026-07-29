import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.js'
import { createCulclawClients } from './api/clients.js'
import { rendererApi } from './api/bridge.js'
import { CulclawApiProvider } from './api/context.js'
import { useAppStore } from './stores/app-store.js'
import './styles/app.scss'

// 创建 Culclaw 客户端实例
const clients = createCulclawClients(rendererApi)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CulclawApiProvider clients={clients}>
      <HashRouter>
        <App />
      </HashRouter>
    </CulclawApiProvider>
  </React.StrictMode>,
)

useAppStore.getState().bootstrap().catch(error => {
  console.error('Bootstrap failed', error)
})
