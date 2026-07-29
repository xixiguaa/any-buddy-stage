import { createContext, useContext, type ReactNode } from 'react'
import type { CulclawClients } from './clients.js'

// 创建 Culclaw API 客户端 Context
const CulclawApiContext = createContext<CulclawClients | null>(null)

/**
 * Culclaw API 上下文提供者组件
 */
export function CulclawApiProvider({
  clients,
  children,
}: {
  clients: CulclawClients
  children: ReactNode
}) {
  return <CulclawApiContext.Provider value={clients}>{children}</CulclawApiContext.Provider>
}

/**
 * 获取 Culclaw API 客户端实例 Hook
 */
export function useCulclawClients() {
  const value = useContext(CulclawApiContext)
  if (!value) {
    throw new Error('CulclawApiProvider is missing')
  }
  return value
}

// 兼容性导出别名
export const AnybuddyApiContext = CulclawApiContext
export const AnybuddyApiProvider = CulclawApiProvider
export const useAnybuddyClients = useCulclawClients
