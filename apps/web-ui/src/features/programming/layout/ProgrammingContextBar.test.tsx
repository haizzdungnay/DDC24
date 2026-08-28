import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingRuntime, RemoteState } from '../model/types'
import { ProgrammingContextBar } from './ProgrammingContextBar'
import type { ProgrammingEditingContext } from './ProgrammingLayout'

vi.mock('../../auth', () => ({ useAuth: () => ({ session: { role: 'admin' } }) }))

const snapshot: ProgrammingRuntime = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY',
  activeRevisionId: 'active-revision-1234',
  lkgRevisionId: 'lkg-revision-1234',
  taskState: 'RUNNING',
  task: { taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 10, missedReleaseCount: 0, lastExecNs: 1000, maxExecNs: 2000, overrunCount: 0, consecutiveOverruns: 0 },
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: new Date(Date.now() - 5000).toISOString()
}

const editing: ProgrammingEditingContext = {
  projectId: 'project-1',
  projectName: 'AHU-01',
  draftRevisionId: 'draft-revision-5678',
  dirty: true,
  checkState: 'passed'
}

function runtimeState(overrides: Partial<RemoteState<ProgrammingRuntime>> = {}): RemoteState<ProgrammingRuntime> {
  return {
    status: 'ready',
    data: snapshot,
    error: null,
    refresh: () => undefined,
    lastSuccessAt: Date.now(),
    ...overrides
  }
}

function renderBar(runtime = runtimeState()) {
  return render(
    <I18nProvider>
      <ProgrammingContextBar
        runtime={runtime}
        capabilities={{ status: 'ready', data: { schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY', languages: ['ST', 'FBD'], types: ['BOOL', 'REAL'], taskPeriodsMs: [1000], limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 } }, error: null, refresh: () => undefined, lastSuccessAt: Date.now() }}
        editing={editing}
      />
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingContextBar', () => {
  it('tách Editing, Check, Active Revision và Core; không gọi revision là RUNNING', () => {
    renderBar()
    expect(screen.getAllByText('controller-local').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BẢN ĐANG ACTIVE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Core sẵn sàng').length).toBeGreaterThan(0)
    expect(screen.queryByText('ĐANG VẬN HÀNH')).not.toBeInTheDocument()
    expect(screen.queryByText('Core đang chạy')).not.toBeInTheDocument()
  })

  it('hiển thị draft khác active, Check đạt và task RUNNING như các sự thật độc lập', () => {
    renderBar()
    expect(screen.getAllByText(/Sửa draft-re ≠ Active active-r/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Đạt').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/RUNNING · 1000 ms/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Chưa chạy')).not.toBeInTheDocument()
  })

  it('snapshot giữ lại sau lỗi luôn có STALE, tuổi và khóa mutation', () => {
    renderBar(runtimeState({ status: 'error', error: 'Core offline' }))
    expect(screen.getAllByText('STALE').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/snapshot cuối, không phải dữ liệu live/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/thao tác phụ thuộc authority runtime đang bị khóa/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Core sẵn sàng')).not.toBeInTheDocument()
  })

  it('producer state lạ fail-closed thành UNKNOWN', () => {
    const unknownSnapshot = { ...snapshot, producerState: 'FUTURE_STATE' } as unknown as ProgrammingRuntime
    renderBar(runtimeState({ data: unknownSnapshot }))
    expect(screen.getAllByText('UNKNOWN').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Core trả trạng thái thiếu hoặc không được hỗ trợ/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Core sẵn sàng')).not.toBeInTheDocument()
  })

  it.each([
    ['DEGRADED', 'Core suy giảm'],
    ['UNAVAILABLE', 'Không kết nối được Core']
  ] as const)('producer state %s giữ đúng semantics %s', (producerState, label) => {
    renderBar(runtimeState({ data: { ...snapshot, producerState } }))
    expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.queryByText('Core sẵn sàng')).not.toBeInTheDocument()
  })

  it('sticky offset nằm dưới cả TopBar và reconnect banner', () => {
    const banner = document.createElement('div')
    banner.setAttribute('data-app-reconnect-banner', '')
    banner.getBoundingClientRect = () => ({ height: 36 } as DOMRect)
    document.body.appendChild(banner)
    renderBar()
    expect(screen.getByRole('region', { name: 'Ngữ cảnh Lập trình' })).toHaveStyle({ top: '100px' })
    banner.remove()
  })

  it('drawer mobile trap focus, đóng bằng Escape và trả focus về trigger', () => {
    renderBar()
    const trigger = screen.getByRole('button', { name: 'Mở chi tiết ngữ cảnh Lập trình' })
    expect(trigger).toHaveAttribute('aria-controls', 'programming-context-drawer')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Ngữ cảnh Lập trình' })).toHaveAttribute('id', 'programming-context-drawer')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ngữ cảnh Lập trình' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
