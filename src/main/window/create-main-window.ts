import { app, BrowserWindow, Menu } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logProcessError } from '../runtime/error-logger.js'

export function createMainWindow() {
  const currentDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
  // 打包后图标位于 resources 目录；开发环境仍从源码目录读取。
  const windowIcon = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'src/renderer/assets/img/icon.ico')
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#f4f1eb',
    title: 'CulClaw',
    /* 设置应用窗口图标 */
    icon: windowIcon,
    webPreferences: {
      preload: join(currentDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      /* 打包后彻底禁用 DevTools 开发者工具；仅开发模式下可用 */
      devTools: !app.isPackaged,
    },
  })

  /* 移除原生菜单栏（File / Edit / View / Window 那一行） */
  Menu.setApplicationMenu(null)

  /* 仅在开发模式下允许按 F12 或 Ctrl+Shift+I 开关调试控制台 */
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      const isF12 = input.key.toLowerCase() === 'f12' || input.code === 'F12'
      const isControlShiftI =
        (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i'

      if (isF12 || isControlShiftI) {
        event.preventDefault()
        win.webContents.toggleDevTools()
      }
    })
  }

  if (!app.isPackaged) {
    const devUrl = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL ?? 'http://localhost:5173'
    void win.loadURL(devUrl).catch(error => {
      logProcessError({ scope: 'loadURL', detail: { devUrl } }, error)
    })
  } else {
    const file = join(app.getAppPath(), '.vite/renderer/main_window/index.html')
    void win.loadFile(file).catch(error => {
      logProcessError({ scope: 'loadFile', detail: { file } }, error)
    })
  }

  return win
}
