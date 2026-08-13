import { createContext, useContext } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useProgrammingCapabilities, useProgrammingRuntime } from '../api/queries'
import type { ProgrammingCapabilities, ProgrammingRuntime, RemoteState } from '../model/types'
import { ProgrammingHeader } from './ProgrammingHeader'
import { ProgrammingContextBar } from './ProgrammingContextBar'

interface ProgrammingRuntimeContextValue {
  capabilities: RemoteState<ProgrammingCapabilities>
  runtime: RemoteState<ProgrammingRuntime>
}

const ProgrammingRuntimeContext = createContext<ProgrammingRuntimeContextValue | null>(null)

/** Bốn workspace dùng chung một `GET /capabilities` + `GET /runtime` — tránh
 * poll trùng lặp và giữ đúng một nguồn cho `ProgrammingContextBar`. */
export function useProgrammingRuntimeContext(): ProgrammingRuntimeContextValue {
  const ctx = useContext(ProgrammingRuntimeContext)
  if (!ctx) throw new Error('useProgrammingRuntimeContext phải nằm trong ProgrammingLayout')
  return ctx
}

/**
 * `ProgrammingLayout` — TASK-PROG-500. Bọc cả bốn workspace bên trong
 * `AppShell` (đã có `<main>`, skip-link và `RouteErrorBoundary` riêng —
 * KHÔNG mở thêm `<main>`/boundary ở đây, cùng lý do đã ghi ở
 * `ModbusRtuLayout`). Có đúng một `<h1>` (trong `ProgrammingHeader`).
 */
export function ProgrammingLayout() {
  const capabilities = useProgrammingCapabilities()
  const runtime = useProgrammingRuntime()
  const { projectId } = useParams<{ projectId?: string }>()
  const refreshing = capabilities.status === 'loading' || runtime.status === 'loading'

  return (
    <ProgrammingRuntimeContext.Provider value={{ capabilities, runtime }}>
      <div className="space-y-4">
        <ProgrammingHeader
          refreshing={refreshing}
          onRefresh={() => {
            capabilities.refresh()
            runtime.refresh()
          }}
        />
        <ProgrammingContextBar runtimeStatus={runtime.status} runtime={runtime.data} activeProjectId={projectId} />
        <Outlet />
      </div>
    </ProgrammingRuntimeContext.Provider>
  )
}
