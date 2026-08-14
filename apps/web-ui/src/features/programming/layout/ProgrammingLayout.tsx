import { createContext, useContext, useMemo, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useProgrammingCapabilities, useProgrammingProjects, useProgrammingRuntime } from '../api/queries'
import type { ProgrammingCapabilities, ProgrammingRuntime, RemoteState } from '../model/types'
import { ProgrammingHeader } from './ProgrammingHeader'
import { ProgrammingContextBar } from './ProgrammingContextBar'
import { ProgrammingDesktopNav } from './ProgrammingDesktopNav'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'

interface ProgrammingRuntimeContextValue {
  capabilities: RemoteState<ProgrammingCapabilities>
  runtime: RemoteState<ProgrammingRuntime>
  setEditingContext: (context: ProgrammingEditingContext | null) => void
}

export interface ProgrammingEditingContext {
  projectId: string
  projectName: string
  draftRevisionId: string
  dirty: boolean
  checkState: 'idle' | 'checking' | 'passed' | 'failed' | 'unknown'
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
  const projects = useProgrammingProjects()
  const [editingContext, setEditingContext] = useState<ProgrammingEditingContext | null>(null)
  const { projectId } = useParams<{ projectId?: string }>()
  const refreshing = capabilities.status === 'loading' || runtime.status === 'loading'

  const listedProject = useMemo(() => {
    if (projects.status !== 'ready' || !projects.data) return null
    return projects.data.items.find((item) => item.projectId === projectId) ?? projects.data.items[0] ?? null
  }, [projectId, projects.data, projects.status])
  const routeEditingContext = editingContext && (!projectId || editingContext.projectId === projectId) ? editingContext : null
  const visibleEditingContext = listedProject
    ? {
        projectId: listedProject.projectId,
        projectName: routeEditingContext?.projectName || listedProject.name,
        draftRevisionId: routeEditingContext?.draftRevisionId || listedProject.draftRevisionId,
        dirty: routeEditingContext?.dirty ?? false,
        checkState: routeEditingContext?.checkState ?? ('idle' as const)
      }
    : routeEditingContext

  return (
    <ProgrammingRuntimeContext.Provider value={{ capabilities, runtime, setEditingContext }}>
      <div className="space-y-4 pb-16 md:pb-0">
        <ProgrammingHeader
          refreshing={refreshing}
          onRefresh={() => {
            capabilities.refresh()
            runtime.refresh()
          }}
        />
        <ProgrammingDesktopNav projectId={visibleEditingContext?.projectId ?? null} />
        <ProgrammingContextBar runtimeStatus={runtime.status} runtime={runtime.data} editing={visibleEditingContext} />
        <Outlet />
      </div>
      <ProgrammingMobileNav projectId={visibleEditingContext?.projectId ?? null} />
    </ProgrammingRuntimeContext.Provider>
  )
}
