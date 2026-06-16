import { createContext, useContext } from 'react'
import type React from 'react'
import { useWebSocket } from './hooks/useWebSocket'

type RealtimeValue = ReturnType<typeof useWebSocket>
const RealtimeContext = createContext<RealtimeValue | null>(null)

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const value = useWebSocket()
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider')
  return ctx
}
