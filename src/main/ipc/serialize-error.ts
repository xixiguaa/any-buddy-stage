import type { IpcError } from '../../shared/types.js'

export function toIpcError(error: unknown): IpcError {
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
    }
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Unknown error',
  }
}

