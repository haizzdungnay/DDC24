import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument } from '../../model/types'
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

beforeEach(() => {
  auth.role = 'admin'
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('ExecutionTab', () => {
  it('hiển thị chu kỳ 1s/5s/30s và lưu cùng thứ tự Program mới', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onPending = vi.fn()
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={onSave} onPendingOperationsChange={onPending} discardVersion={0} />
      </I18nProvider>
    )
    const period = screen.getByLabelText('Chu kỳ')
    expect(within(period).getAllByRole('option').map((option) => option.textContent?.trim())).toEqual(['1 s', '5 s', '30 s'])
    fireEvent.change(period, { target: { value: '5000' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Xuống/ })[0])
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith([
      { op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }
    ]))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }])
  })

  it('viewer bị khóa quyền sửa và không thấy nút Lưu', () => {
    auth.role = 'viewer'
    const onSave = vi.fn()
    const onPending = vi.fn()
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={onSave} onPendingOperationsChange={onPending} discardVersion={0} />
      </I18nProvider>
    )
    expect(screen.getByLabelText('Chu kỳ')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Xuống/ })).not.toBeInTheDocument()
  })
})
