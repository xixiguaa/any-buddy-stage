import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logProcessError } from '../runtime/error-logger.js'

export function createMainWindow() {
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#f4f1eb',
    title: 'anybuddy',
    webPreferences: {
      preload: join(currentDir, 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (!app.isPackaged) {
    const devUrl = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    void win.loadURL(devUrl).catch(error => {
      logProcessError({ scope: 'loadURL', detail: { devUrl } }, error)
    })
  } else {
    const file = join(app.getAppPath(), 'dist/renderer/index.html')
    void win.loadFile(file).catch(error => {
      logProcessError({ scope: 'loadFile', detail: { file } }, error)
    })
  }

  return win
}
