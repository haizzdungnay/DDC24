import { createContext, useContext, useMemo, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useProgrammingCapabilities, useProgrammingProgramIntents, useProgrammingProjects, useProgrammingRuntime } from '../api/queries'
import type { ProgrammingCapabilities, ProgrammingProgramIntentList, ProgrammingProjectPage, ProgrammingRuntime, RemoteState } from '../model/types'
import { roleAtLeast, useAuth } from '../../auth'
import { ProgrammingHeader } from './ProgrammingHeader'
import { ProgrammingContextBar } from './ProgrammingContextBar'
import { ProgrammingDesktopNav } from './ProgrammingDesktopNav'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'

interface ProgrammingRuntimeContextValue {
  capabilities: RemoteState<ProgrammingCapabilities>
  runtime: RemoteState<ProgrammingRuntime>
  projects: RemoteState<ProgrammingProjectPage>
  programIntents: RemoteState<ProgrammingProgramIntentList>
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

/** Sáu workspace dùng chung các read-model ở tầng layout — tránh poll trùng
 * lặp và giữ đúng một nguồn cho `ProgrammingContextBar`. */
export function useProgrammingRuntimeContext(): ProgrammingRuntimeContextValue {
  const ctx = useContext(ProgrammingRuntimeContext)
  if (!ctx) throw new Error('useProgrammingRuntimeContext phải nằm trong ProgrammingLayout')
  return ctx
}

/**
 * `ProgrammingLayout` — TASK-PROG-500/T59-503. Bọc cả sáu workspace bên trong
 * `AppShell` (đã có `<main>`, skip-link và `RouteErrorBoundary` riêng —
 * KHÔNG mở thêm `<main>`/boundary ở đây, cùng lý do đã ghi ở
 * `ModbusRtuLayout`). Có đúng một `<h1>` (trong `ProgrammingHeader`).
 */
export function ProgrammingLayout() {
  const { session } = useAuth()
  const capabilities = useProgrammingCapabilities()
  const runtime = useProgrammingRuntime()
  const projects = useProgrammingProjects()
  const [editingContext, setEditingContext] = useState<ProgrammingEditingContext | null>(null)
  const { projectId } = useParams<{ projectId?: string }>()

  const listedProject = useMemo(() => {
    if (projects.status !== 'ready' || !projects.data) return null
    if (projectId) return projects.data.items.find((item) => item.projectId === projectId) ?? null
    return projects.data.items[0] ?? null
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
  // Khi API Project tạm lỗi, vẫn giữ nguyên định danh từ URL để điều hướng giữa
  // PGM-02..05 và thử read-model intent của đúng Project; không thay bằng
  // Project đầu tiên hoặc tự dựng định danh mới.
  const scopedProjectId = visibleEditingContext?.projectId ?? projectId
  const programIntents = useProgrammingProgramIntents(scopedProjectId)
  const refreshing =
    capabilities.status === 'loading' ||
    runtime.status === 'loading' ||
    projects.status === 'loading' ||
    programIntents.status === 'loading'

  return (
    <ProgrammingRuntimeContext.Provider value={{ capabilities, runtime, projects, programIntents, setEditingContext }}>
      <div className="space-y-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <ProgrammingHeader
          refreshing={refreshing}
          onRefresh={() => {
            capabilities.refresh()
            runtime.refresh()
            projects.refresh()
            programIntents.refresh()
          }}
        />
        <ProgrammingDesktopNav projectId={scopedProjectId ?? null} />
        <ProgrammingContextBar
          projectStatus={projects.status}
          runtimeStatus={runtime.status}
          runtime={runtime.data}
          intentStatus={programIntents.status}
          intents={programIntents.data}
          intentError={programIntents.error}
          editing={visibleEditingContext}
          canMutate={roleAtLeast(session?.role, 'admin')}
        />
        <Outlet />
      </div>
      <ProgrammingMobileNav projectId={scopedProjectId ?? null} />
    </ProgrammingRuntimeContext.Provider>
  )
}
