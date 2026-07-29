import type { CulclawApi } from '../../shared/ipc.js'

// 统一维护预加载层注入的 API，兼容旧版 anybuddyApi 名称。
export const rendererApi: CulclawApi = window.culclawApi ?? window.anybuddyApi ?? (() => {
  throw new Error('Electron preload API is unavailable. Make sure the preload script is loaded.')
})()
