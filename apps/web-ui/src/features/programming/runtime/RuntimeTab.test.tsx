import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingRuntime } from '../model/types'
import { RuntimeTab } from './RuntimeTab'

const runtime: ProgrammingRuntime = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY',
  activeRevisionId: 'revision-active',
  lkgRevisionId: 'revision-lkg',
  taskState: 'FAULT',
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: '2026-08-19T00:00:00Z'
}

function renderTab(value: ProgrammingRuntime, status: 'loading' | 'ready' | 'error' = 'ready') {
  return render(
    <I18nProvider>
      <RuntimeTab runtime={value} status={status} />
    </I18nProvider>
  )
}

function currentRuntimePanel(): HTMLElement {
  return screen.getByRole('heading', { name: 'Runtime hiện tại' }).closest('section')!
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('RuntimeTab truth-state', () => {
  it('chỉ hiển thị FAULT live khi producer READY', () => {
    renderTab(runtime)
    expect(screen.getAllByText('FAULT')).toHaveLength(1)
    expect(screen.queryByText('DEGRADED · FAULT')).not.toBeInTheDocument()
  })

  it('đưa bằng chứng runtime live lên đầu: task, chu kỳ, số lần chạy, safe-state và Active', () => {
    renderTab({
      ...runtime,
      taskState: 'RUNNING',
      safeState: false,
      task: {
        taskId: 'main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 42,
        missedReleaseCount: 0, lastExecNs: 1_500_000, maxExecNs: 2_000_000,
        overrunCount: 0, consecutiveOverruns: 0
      }
    })
    const currentRuntime = currentRuntimePanel()
    expect(within(currentRuntime).getByText('RUNNING')).toBeInTheDocument()
    expect(within(currentRuntime).getByText('1000 ms')).toBeInTheDocument()
    expect(within(currentRuntime).getByText('42')).toBeInTheDocument()
    expect(within(currentRuntime).getByText('Bình thường')).toBeInTheDocument()
    expect(screen.getByText('revision-active')).toBeInTheDocument()
  })

  it('không hiển thị Active hay metric task như dữ liệu live khi runtime chưa xác nhận', () => {
    renderTab({
      ...runtime,
      producerState: 'DEGRADED',
      task: {
        taskId: 'main', periodMs: 1000, budgetMs: 200, state: 'FAULT', runCount: 42,
        missedReleaseCount: 0, lastExecNs: 1, maxExecNs: 1, overrunCount: 0, consecutiveOverruns: 0
      }
    })
    const currentRuntime = currentRuntimePanel()
    expect(within(currentRuntime).getByText('DEGRADED · FAULT')).toBeInTheDocument()
    expect(within(currentRuntime).queryByText('revision-active')).not.toBeInTheDocument()
    expect(within(currentRuntime).queryByText('1000 ms')).not.toBeInTheDocument()
  })

  it('không biến task FAULT trong producer DEGRADED thành lỗi live', () => {
    renderTab({ ...runtime, producerState: 'DEGRADED' })
    expect(screen.getAllByText('DEGRADED · FAULT')).toHaveLength(1)
    expect(screen.getByText('Core suy giảm')).toBeInTheDocument()
  })

  it('gắn STALE cho task state lấy từ snapshot sau lỗi đọc', () => {
    renderTab(runtime, 'error')
    expect(screen.getAllByText('STALE · FAULT')).toHaveLength(1)
    expect(screen.getByText('Snapshot Core cũ')).toBeInTheDocument()
  })

  it('enum producer lạ fail-closed, không lộ FAULT như trạng thái live', () => {
    renderTab({ ...runtime, producerState: 'FUTURE_STATE' } as unknown as ProgrammingRuntime)
    expect(screen.getAllByText('UNKNOWN')).toHaveLength(1)
    expect(screen.queryByText('FAULT')).not.toBeInTheDocument()
  })
})
