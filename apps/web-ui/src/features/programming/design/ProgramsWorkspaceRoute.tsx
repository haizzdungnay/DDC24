import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../../shared/components/Button'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useI18n } from '../../../shared/i18n'
import { roleAtLeast, useAuth } from '../../auth'
import { useCreateProgrammingProject } from '../api/mutations'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingMobileReadOnly } from '../layout/useProgrammingViewport'
import {
  canonicalProgramsPath,
  isProgramsWorkspaceMode,
  resolveProgramsProject
} from '../shared/programsRoute'
import { DesignWorkspacePage } from './DesignWorkspacePage'

/**
 * Route resolver PGM-02 v2. Nó chặn mount editor tới khi Project/mode được
 * phân giải tường minh; không có nhánh "lấy Project đầu tiên cho tiện".
 */
export function ProgramsWorkspaceRoute() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { projects } = useProgrammingRuntimeContext()
  const mobileReadOnly = useProgrammingMobileReadOnly()
  const requestedProjectId = searchParams.has('project') ? (searchParams.get('project') ?? '') : null
  const resolution = resolveProgramsProject(projects.status, projects.data?.items ?? [], requestedProjectId)

  if (resolution.kind === 'LOADING') {
    return <StateBlock state="loading" title={pick('Đang phân giải Project…', 'Resolving the project…')} />
  }
  if (resolution.kind === 'ERROR') {
    return (
      <StateBlock
        state="error"
        title={pick('Không đọc được danh sách Project.', 'Could not read the project list.')}
        detail={projects.error ?? undefined}
        onRetry={projects.refresh}
      />
    )
  }
  if (resolution.kind === 'NOT_FOUND') {
    return (
      <StateBlock
        state="error"
        title={pick('Không tìm thấy Project hoặc bạn không có quyền truy cập.', 'The project was not found or is outside your access scope.')}
        detail={pick('Workspace không mở một Project khác để thay thế.', 'The workspace did not fall back to another project.')}
      />
    )
  }
  if (resolution.kind === 'EMPTY') {
    return <EmptyProjectState canCreate={roleAtLeast(session?.role, 'admin') && !mobileReadOnly} onCreated={(projectId) => navigate(canonicalProgramsPath(projectId), { replace: true })} />
  }
  if (resolution.kind === 'CHOOSE') {
    return (
      <Panel
        title={pick('Chọn Project', 'Choose a project')}
        subtitle={pick('Có nhiều Project nên workspace không tự đoán Project gần nhất.', 'Multiple projects exist, so the workspace will not guess one.')}
      >
        <ul className="space-y-2" aria-label={pick('Danh sách Project', 'Project list')}>
          {(projects.data?.items ?? []).map((project) => (
            <li key={project.projectId}>
              <Link
                className="flex min-h-11 items-center rounded-[var(--radius)] border border-[var(--c-border)] px-3 text-sm font-medium text-[var(--c-text)] hover:border-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                to={canonicalProgramsPath(project.projectId, { search: location.search, hash: location.hash })}
                replace
              >
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    )
  }
  if (resolution.kind === 'CANONICALIZE') {
    return <Navigate to={canonicalProgramsPath(resolution.projectId, { search: location.search, hash: location.hash })} replace />
  }

  const canonical = canonicalProgramsPath(resolution.project.projectId, { search: location.search, hash: location.hash })
  const current = `${location.pathname}${location.search}${location.hash}`
  if (current !== canonical) return <Navigate to={canonical} replace />

  const mode = searchParams.get('mode')
  if (!isProgramsWorkspaceMode(mode)) {
    return (
      <StateBlock
        state="error"
        title={pick('Chế độ workspace không hợp lệ.', 'The workspace mode is invalid.')}
        detail={pick('Chỉ chấp nhận EDIT, LIVE hoặc SIMULATE; URL không được tự hạ về một chế độ khác.', 'Only EDIT, LIVE, or SIMULATE is accepted; the URL was not silently downgraded.')}
      />
    )
  }
  /* `T59-811` mở LIVE ở increment R2. SIMULATE vẫn đóng tới R3 — và vẫn KHÔNG
   * có fallback: một chế độ chưa có capability phải nói ra, không được âm thầm
   * hiện dữ liệu của chế độ khác. */
  if (mode === 'SIMULATE') {
    return (
      <StateBlock
        state="empty"
        title={pick('SIMULATE chưa khả dụng trong increment này.', 'SIMULATE is unavailable in this increment.')}
        detail={pick('Không có fallback sang dữ liệu Draft hoặc runtime gần nhất.', 'There is no fallback to draft data or a nearby runtime revision.')}
      />
    )
  }

  return (
    /* KHÔNG truyền `route`: trên canonical route, `?tab=` là thứ quyết định tab
       đang mở, nhờ vậy đổi tab chỉ là đổi query trong CÙNG một mount và không
       làm mất buffer chưa lưu. `route` cố định tab thuộc về IA sáu trang cũ. */
    <DesignWorkspacePage
      projectIdOverride={resolution.project.projectId}
      mobileReadOnlyOverride={mobileReadOnly}
    />
  )
}

function EmptyProjectState({ canCreate, onCreated }: { canCreate: boolean; onCreated: (projectId: string) => void }) {
  const { pick } = useI18n()
  const { createProject, creating, error } = useCreateProgrammingProject()
  const [name, setName] = useState('')

  return (
    <Panel title={pick('Chưa có Project', 'No project yet')}>
      <p className="text-sm text-[var(--c-text-dim)]">
        {pick('Controller này chưa có Project để mở trong workspace Programs.', 'This controller has no project to open in the Programs workspace.')}
      </p>
      {canCreate ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void createProject(name || pick('Ứng dụng điều khiển', 'Control application')).then((created) => {
              if (created) onCreated(created.projectId)
            })
          }}
        >
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programs-v2-project-name">
            {pick('Tên Project', 'Project name')}
          </label>
          <input
            id="programs-v2-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
          />
          <Button type="submit" size="sm" loading={creating} icon={<FolderPlus className="h-4 w-4" aria-hidden="true" />}>
            {pick('Tạo bản nháp', 'Create draft')}
          </Button>
          {error && <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{error}</p>}
        </form>
      ) : (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]">
          {pick('Màn hình hẹp và vai không có quyền tạo đều ở chế độ chỉ đọc.', 'Narrow screens and roles without create permission remain read-only.')}
        </p>
      )}
    </Panel>
  )
}
