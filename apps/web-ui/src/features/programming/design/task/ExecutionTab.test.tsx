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
  it('hiển thị tập chu kỳ ADR-061 (10 ms … 50 s) và lưu cùng thứ tự Program mới', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onPending = vi.fn()
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={onSave} onPendingOperationsChange={onPending} discardVersion={0} />
      </I18nProvider>
    )
    const period = screen.getByLabelText('Chu kỳ')
    expect(within(period).getAllByRole('option').map((option) => option.textContent?.trim())).toEqual(
      ['10 ms', '50 ms', '100 ms', '500 ms', '1 s', '5 s', '10 s', '50 s']
    )
    expect(screen.queryByTestId('programming-task-period-invalid')).not.toBeInTheDocument()
    fireEvent.change(period, { target: { value: '5000' } })
    fireEvent.click(screen.getAllByRole('button', { name: /Xuống/ })[0])
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith([
      { op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }
    ]))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(onSave).toHaveBeenCalledWith([{ op: 'setTask', task: { taskId: 'main', periodMs: 5000, programOrder: ['b', 'a'] } }])
  })

  it('danh sách chu kỳ lấy từ capabilities khi thiết bị công bố', () => {
    render(
      <I18nProvider>
        <ExecutionTab document={documentFixture()} saving={false} onSave={vi.fn()} onPendingOperationsChange={vi.fn()} discardVersion={0} allowedPeriodsMs={[1000, 10, 100]} />
      </I18nProvider>
    )
    expect(within(screen.getByLabelText('Chu kỳ')).getAllByRole('option').map((option) => option.textContent?.trim()))
      .toEqual(['10 ms', '100 ms', '1 s'])
  })

  // ADR-061 mục 4.14 — Draft cũ lưu 30000 ms: hiện đúng "30 s — không còn hợp
  // lệ", gợi ý chọn 10 s hoặc 50 s, KHÔNG ép về 1000 ms, và không gửi setTask
  // nào cho tới khi người dùng tự chọn chu kỳ hợp lệ.
  it('chu kỳ legacy 30000 ms hiện rõ là không còn hợp lệ, không bị ép và không được Lưu', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const onPending = vi.fn()
    const legacy = documentFixture()
    legacy.task = { ...legacy.task, periodMs: 30000 }
    render(
      <I18nProvider>
        <ExecutionTab document={legacy} saving={false} onSave={onSave} onPendingOperationsChange={onPending} discardVersion={0} />
      </I18nProvider>
    )
    const period = screen.getByLabelText('Chu kỳ') as HTMLSelectElement
    expect(period.value).toBe('30000')
    expect(period).toHaveAttribute('aria-invalid', 'true')
    const legacyOption = within(period).getByRole('option', { name: '30 s — không còn hợp lệ' }) as HTMLOptionElement
    expect(legacyOption.disabled).toBe(true)
    expect(screen.getByTestId('programming-task-period-invalid')).toHaveTextContent('30 s — không còn hợp lệ, chọn 10 s hoặc 50 s')
    // Đổi thứ tự khi chu kỳ còn không hợp lệ KHÔNG sinh thao tác nào.
    fireEvent.click(screen.getAllByRole('button', { name: /Xuống/ })[0])
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    expect(onPending).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ op: 'setTask' })]))
    fireEvent.change(period, { target: { value: '50000' } })
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith([
      { op: 'setTask', task: { taskId: 'main', periodMs: 50000, programOrder: ['b', 'a'] } }
    ]))
    expect(screen.queryByTestId('programming-task-period-invalid')).not.toBeInTheDocument()
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
