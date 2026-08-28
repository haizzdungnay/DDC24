import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useI18n } from '../../../shared/i18n'
import type { ProgrammingProject, ProgrammingProjectPage, RemoteState } from '../model/types'

export type ProgrammingProjectRouteState = 'missing' | 'loading' | 'valid' | 'invalid' | 'error'

export interface ProgrammingProjectRouteResolution {
  state: ProgrammingProjectRouteState
  project: ProgrammingProject | null
}

export function resolveProgrammingProjectRoute(
  projectId: string | undefined,
  projects: Pick<RemoteState<ProgrammingProjectPage>, 'status' | 'data'>
): ProgrammingProjectRouteResolution {
  if (!projectId) {
    return {
      state: 'missing',
      project: projects.status === 'ready' ? (projects.data?.items[0] ?? null) : null
    }
  }
  if (projects.status === 'loading') return { state: 'loading', project: null }
  if (projects.status === 'error' || !projects.data) return { state: 'error', project: null }

  const project = projects.data.items.find((item) => item.projectId === projectId) ?? null
  return project ? { state: 'valid', project } : { state: 'invalid', project: null }
}

export function ProjectRouteGuard({
  state,
  projectId,
  error,
  onRetry,
  children
}: {
  state: ProgrammingProjectRouteState
  projectId?: string
  error: string | null
  onRetry: () => void
  children: ReactNode
}) {
  const { pick } = useI18n()
  if (state === 'missing' || state === 'valid') return children

  if (state === 'loading') {
    return <StateBlock state="loading" title={pick('Đang xác minh Project…', 'Validating the project…')} />
  }

  return (
    <div className="space-y-3">
      <StateBlock
        state="error"
        title={
          state === 'invalid'
            ? pick('Project không tồn tại.', 'Project not found.')
            : pick('Không xác minh được Project.', 'Could not validate the project.')
        }
        detail={
          state === 'invalid'
            ? pick(
                `Không có Project mang ID “${projectId ?? ''}” trên controller này. URL được giữ nguyên và mọi thao tác thay đổi đã bị khóa.`,
                `No project with ID “${projectId ?? ''}” exists on this controller. The URL is preserved and all mutations are locked.`
              )
            : error ?? pick('Danh sách Project hiện không khả dụng; thao tác thay đổi được khóa để tránh nhầm đích.', 'The project list is unavailable; mutations are locked to avoid targeting the wrong project.')
        }
        onRetry={state === 'error' ? onRetry : undefined}
      />
      <Link className="inline-flex text-sm font-semibold text-[var(--c-accent)] underline" to="/eng/programming">
        {pick('Về Tổng quan Lập trình', 'Back to Programming overview')}
      </Link>
    </div>
  )
}

