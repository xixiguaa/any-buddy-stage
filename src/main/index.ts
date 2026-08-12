import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { AppEventBus } from './runtime/event-bus.js'
import { AppStateRepository } from './repositories/app-state-repository.js'
import { AppService } from './services/app-service.js'
import { DockerSandboxBackend } from './services/docker-sandbox-backend.js'
import { registerIpcHandlers } from './ipc/register-ipc-handlers.js'
import { installGlobalErrorHandlers, logProcessError } from './runtime/error-logger.js'
import { createMainWindow } from './window/create-main-window.js'

const bus = new AppEventBus()
let mainWindow: BrowserWindow | null = null
let sandboxCleanupComplete = false
let sandboxCleanupPromise: Promise<void> | undefined

installGlobalErrorHandlers()

function openMainWindow() {
  mainWindow = createMainWindow()
  mainWindow.on('closed', () => {
    if (mainWindow?.isDestroyed()) {
      mainWindow = null
    }
  })
  return mainWindow
}

import { DB_FILE_NAME } from '../shared/constants.js'

async function bootstrap() {
  await app.whenReady()

  const repository = new AppStateRepository(join(app.getPath('userData'), DB_FILE_NAME))
  const service = new AppService(repository, bus)

  app.on('before-quit', event => {
    if (sandboxCleanupComplete) return

    event.preventDefault()
    if (sandboxCleanupPromise) return

    sandboxCleanupPromise = DockerSandboxBackend.closeGlobalSandbox()
      .catch(error => {
        logProcessError({ scope: 'sandbox-cleanup' }, error)
      })
      .finally(() => {
        sandboxCleanupComplete = true
        app.quit()
      })
  })

  await service.init()
  registerIpcHandlers(service)

  bus.on('agent-runs:active-changed', runs => {
    mainWindow?.webContents.send('agent-run:active-changed', runs)
  })

  const originalEmitTaskRuntime = bus.emitTaskRuntime.bind(bus)
  bus.emitTaskRuntime = ((taskId, payload) => {
    mainWindow?.webContents.send(`agent-run:task-changed:${taskId}`, payload)
    return originalEmitTaskRuntime(taskId, payload)
  }) as typeof bus.emitTaskRuntime

  openMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

bootstrap().catch(error => {
  logProcessError({ scope: 'bootstrap' }, error)
  app.quit()
})
