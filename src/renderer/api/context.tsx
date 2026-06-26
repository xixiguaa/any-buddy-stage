import { createContext, useContext, type ReactNode } from 'react'
import type { AnybuddyClients } from './clients.js'

const AnybuddyApiContext = createContext<AnybuddyClients | null>(null)

export function AnybuddyApiProvider({
  clients,
  children,
}: {
  clients: AnybuddyClients
  children: ReactNode
}) {
  return <AnybuddyApiContext.Provider value={clients}>{children}</AnybuddyApiContext.Provider>
}

export function useAnybuddyClients() {
  const value = useContext(AnybuddyApiContext)
  if (!value) {
    throw new Error('AnybuddyApiProvider is missing')
  }
  return value
}
