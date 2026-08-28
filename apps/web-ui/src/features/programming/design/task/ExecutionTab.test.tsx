import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingCapabilities, ProgrammingDraftDocument, RemoteState } from '../../model/types'
import { ExecutionTab } from './ExecutionTab'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'u', role: auth.role, loginAt: '2026-08-20T00:00:00Z' } })
  }
})

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'p1', name: 'AHU', functionalTags: [] },
    programs: [
      { programId: 'a', name: 'Program A', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM A\nEND_PROGRAM' },
      { programId: 'b', name: 'Program B', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM B\nEND_PROGRAM' },
    ],
    variables: [],
    bindings: [],
    task: { taskId: 'main', periodMs: 1000, programOrder: ['a', 'b'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

function capabilities(overrides: Partial<RemoteState<ProgrammingCapabilities>> = {}): RemoteState<ProgrammingCapabilities> {
  return {
    status: 'ready',
    data: {
      schemaVersion: '1.0',
      profile: 'MK-DDC-24-REV-A',
      targetState: 'READY',
      languages: ['ST', 'FBD'],
      types: ['BOOL', 'REAL'],
      taskPeriodsMs: [1000, 5000],
      limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 },
    },
    error: null,
    refresh: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  auth.role = 'admin'
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('ExecutionTab capability-driven', () => {
  it('chỉ hiện chu kỳ Core công bố và lưu cùng thứ tự Program mới', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onPending = vi.fn()
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={onSave} onPendingOperationsChange={onPending} discardVersion={0} capabilities={capabilities()} />
      </I18nProvider>
    )
    const period = screen.getByLabelText('Chu kỳ')
    expect(within(period).getAllByRole('option').map((option) => option.textContent)).toEqual(['1 s', '5 s'])
    fireEvent.change(period, { target: { value: '5000' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Xuống/ })[0])
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith([
      { op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }
    ]))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }])
  })

  it('khóa thay đổi và cho đọc lại khi capability lỗi', () => {
    const refresh = vi.fn()
    render(
      <I18nProvider>
        <ExecutionTab
          document={documentFixture()}
          saving={false}
          onSave={vi.fn().mockResolvedValue(true)}
          onPendingOperationsChange={vi.fn()}
          discardVersion={0}
          capabilities={capabilities({ status: 'error', error: '503', refresh })}
        />
      </I18nProvider>
    )
    expect(screen.getByText('Không xác minh được capability chu kỳ.')).toBeInTheDocument()
    expect(screen.getByLabelText('Chu kỳ')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('fail-closed khi Core không công bố chu kỳ hợp lệ', () => {
    const state = capabilities()
    state.data = { ...state.data!, taskPeriodsMs: [] }
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={vi.fn().mockResolvedValue(true)} onPendingOperationsChange={vi.fn()} discardVersion={0} capabilities={state} />
      </I18nProvider>
    )
    expect(screen.getByText('Core không công bố chu kỳ Task hợp lệ.')).toBeInTheDocument()
    expect(screen.getByLabelText('Chu kỳ')).toBeDisabled()
  })
})
