import { app, BrowserWindow } from 'electron'

type ErrorContext = {
  scope: string
  detail?: Record<string, unknown>
}

function toError(value: unknown) {
  if (value instanceof Error) {
    return value
  }

  return new Error(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

function extractStackLocation(stack?: string) {
  if (!stack) {
    return null
  }

  const line = stack
    .split('\n')
    .map(item => item.trim())
    .find(item => /(?:file:\/\/\/|[A-Za-z]:\\).+:\d+:\d+/.test(item))

  if (!line) {
    return null
  }

  const match = line.match(/((?:file:\/\/\/)?(?:[A-Za-z]:[\\/]).+?):(\d+):(\d+)/)
  if (!match) {
    return null
  }

  return {
    file: match[1].replace(/^file:\/\//, ''),
    line: Number(match[2]),
    column: Number(match[3]),
    frame: line,
  }
}

function formatDetail(detail?: Record<string, unknown>) {
  if (!detail || Object.keys(detail).length === 0) {
    return ''
  }

  try {
    return `\n[Detail]\n${JSON.stringify(detail, null, 2)}`
  } catch {
    return ''
  }
}

export function logProcessError(context: ErrorContext, value: unknown) {
  const error = toError(value)
  const location = extractStackLocation(error.stack)
  const locationText = location
    ? `${location.file}:${location.line}:${location.column}`
    : 'unresolved'

  console.error(
    [
      `[Error][${context.scope}] ${error.name}: ${error.message}`,
      `[Location] ${locationText}`,
      location?.frame ? `[Frame] ${location.frame}` : '',
      error.stack ? `[Stack]\n${error.stack}` : '',
      formatDetail(context.detail),
    ].filter(Boolean).join('\n'),
  )
}

function attachWindowDiagnostics(win: BrowserWindow) {
  win.webContents.on('render-process-gone', (_event, details) => {
    logProcessError({
      scope: 'renderer-process-gone',
      detail: {
        reason: details.reason,
        exitCode: details.exitCode,
      },
    }, new Error(`Renderer process gone: ${details.reason}`))
  })

  win.webContents.on('unresponsive', () => {
    logProcessError({ scope: 'renderer-unresponsive' }, new Error('Renderer process became unresponsive'))
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logProcessError({
      scope: 'did-fail-load',
      detail: {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      },
    }, new Error(`Window failed to load: ${errorDescription}`))
  })
}

export function installGlobalErrorHandlers() {
  process.on('uncaughtException', error => {
    logProcessError({ scope: 'uncaughtException' }, error)
  })

  process.on('unhandledRejection', reason => {
    logProcessError({ scope: 'unhandledRejection' }, reason)
  })

  process.on('warning', warning => {
    logProcessError({ scope: 'process-warning' }, warning)
  })

  app.on('child-process-gone', (_event, details) => {
    logProcessError({
      scope: 'child-process-gone',
      detail: {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      },
    }, new Error(`Child process gone: ${details.type} ${details.reason}`))
  })

  app.on('browser-window-created', (_event, win) => {
    attachWindowDiagnostics(win)
  })
}
