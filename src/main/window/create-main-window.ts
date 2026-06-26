import { app, BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(app.getAppPath(), 'dist/renderer/index.html'))
  }

  return win
}
