import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingProgramIntentList, ProgrammingRuntime } from '../model/types'
import { ProgrammingContextBar } from './ProgrammingContextBar'

const editing = {
  projectId: 'project-1',
  projectName: 'AHU-01',
  draftRevisionId: 'draft-revision',
  dirty: true,
  checkState: 'passed' as const
}

const runtime: ProgrammingRuntime = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY',
  activeRevisionId: 'active-revision',
  lkgRevisionId: 'lkg-revision',
  taskState: 'RUNNING',
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: '2026-08-21T10:00:00Z'
}

const intents: ProgrammingProgramIntentList = {
  items: [
    { programId: 'ahu-1', desiredEnabled: true, generation: 3, runtimeState: 'UNKNOWN', updatedBy: 'admin', updatedAtUtcMs: 1 },
    { programId: 'ahu-2', desiredEnabled: false, generation: 4, runtimeState: 'RUNNING', updatedBy: 'admin', updatedAtUtcMs: 2 }
  ]
}

function renderBar(overrides: Partial<Parameters<typeof ProgrammingContextBar>[0]> = {}) {
  return render(
    <I18nProvider>
      <ProgrammingContextBar
        projectStatus="ready"
        runtimeStatus="ready"
        runtime={runtime}
        intentStatus="ready"
        intents={intents}
        intentError={null}
        editing={editing}
        canMutate
        {...overrides}
      />
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingContextBar — T59-503', () => {
  it('tách Draft, Active, desired intent và runtime read-back; không suy Enabled thành RUNNING', () => {
    renderBar()
    const context = screen.getByRole('region', { name: 'Ngữ cảnh Lập trình hiện tại' })
    expect(within(context).getByText('draft-revision')).toBeInTheDocument()
    expect(within(context).getByText('active-revision')).toBeInTheDocument()
    expect(within(context).getByText('1/2 muốn bật')).toBeInTheDocument()
    expect(within(context).getByText('UNKNOWN 1 · RUNNING 1')).toBeInTheDocument()
    expect(within(context).getByRole('alert')).toHaveTextContent('Chưa xác định kết quả — đang đối soát')
    expect(within(context).getByRole('alert')).toHaveTextContent('không tự suy Program đang chạy')
  })

  it.each([
    ['loading', { projectStatus: 'loading', runtimeStatus: 'loading', runtime: null, intentStatus: 'loading', intents: null }, 'Đang tải dữ liệu Programming…', 'status'],
    ['empty', { editing: null, intents: { items: [] } }, 'Chưa có chương trình', 'status'],
    ['error', { intentStatus: 'error', intents: null, intentError: 'HTTP 500' }, 'Không tải được trạng thái chương trình.', 'alert'],
    ['permission', { canMutate: false, intents: { items: [{ ...intents.items[1], runtimeState: 'DISABLED' }] } }, 'Bạn không có quyền thực hiện thao tác này', 'status'],
    ['stale', { runtime: { ...runtime, producerState: 'DEGRADED' }, intents: { items: [{ ...intents.items[1], runtimeState: 'RUNNING' }] } }, 'Dữ liệu đã cũ', 'status'],
    ['offline', { runtimeStatus: 'error', runtime: null }, 'Không kết nối được Core', 'alert'],
    ['unknown', {}, 'Chưa xác định kết quả — đang đối soát', 'alert']
  ] as const)('hiện trạng thái %s bằng copy và vai trò ngữ nghĩa riêng', (_name, overrides, copy, role) => {
    renderBar(overrides as Partial<Parameters<typeof ProgrammingContextBar>[0]>)
    expect(screen.getByRole(role)).toHaveTextContent(copy)
  })
})
