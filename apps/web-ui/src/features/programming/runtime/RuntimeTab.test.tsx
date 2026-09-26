import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

function renderTab(value: ProgrammingRuntime | null, status: 'loading' | 'ready' | 'error' = 'ready') {
  return render(
    <I18nProvider>
      <RuntimeTab runtime={value} status={status} />
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('RuntimeTab', () => {
  it('hiển thị thông tin Active, LKG và trạng thái kết nối Core', () => {
    renderTab(runtime)
    expect(screen.getByText('revision-active')).toBeInTheDocument()
    expect(screen.getByText('revision-lkg')).toBeInTheDocument()
    expect(screen.getByText('Core đang chạy')).toBeInTheDocument()
    expect(screen.getByText('FAULT')).toBeInTheDocument()
  })

  it('hiển thị metric task khi có thông tin task trong runtime', () => {
    renderTab({
      ...runtime,
      taskState: 'RUNNING',
      task: {
        taskId: 'main', periodMs: 1000, budgetMs: 200, state: 'RUNNING', runCount: 42,
        missedReleaseCount: 0, lastExecNs: 1_500_000, maxExecNs: 2_000_000,
        overrunCount: 0, consecutiveOverruns: 0
      }
    })
    expect(screen.getByText('RUNNING')).toBeInTheDocument()
    expect(screen.getByText('1.50 ms')).toBeInTheDocument()
    expect(screen.getByText('2.00 ms')).toBeInTheDocument()
    expect(screen.getByText(/Chu kỳ: 1 s · Ngân sách: 200 ms · Lỡ nhịp: 0/)).toBeInTheDocument()
    // Core đời cũ không công bố metric C4: không dựng khối số 0 giả.
    expect(screen.queryByTestId('runtime-task-cycle-metrics')).not.toBeInTheDocument()
  })

  // ADR-061 mục 4.9 — metric C2–C4 của Task hiện nguyên số Core công bố, ngân
  // sách bằng µs, và `null` hiện `—` chứ không phải 0.
  it('hiển thị metric C4 và sức khoẻ Task khi Core công bố', () => {
    renderTab({
      ...runtime,
      taskState: 'RUNNING',
      task: {
        taskId: 'main', periodMs: 10, budgetMs: 1, state: 'RUNNING', runCount: 6000,
        missedReleaseCount: 0, lastExecNs: 350_000, maxExecNs: 910_000,
        overrunCount: 0, consecutiveOverruns: 0,
        budgetUs: 1999, baseStepUs: 10_000, jitterMaxUs: 142, jitterViolationCount: 3, missedBaseStepCount: null,
        health: 'DEGRADED', healthReasons: ['JITTER_VIOLATION', 'JITTER_MAX_EXCEEDED']
      }
    })
    expect(screen.getByTestId('runtime-task-summary')).toHaveTextContent('Chu kỳ: 10 ms · Ngân sách: 1999 µs · Lỡ nhịp: 0')
    const metrics = screen.getByTestId('runtime-task-cycle-metrics')
    expect(metrics).toHaveTextContent('DEGRADED')
    expect(metrics).toHaveTextContent('Lệch nhịp > 100 µs')
    expect(metrics).toHaveTextContent('Lệch nhịp lớn nhất > 100 µs')
    expect(metrics).toHaveTextContent('142 µs')
    expect(metrics).toHaveTextContent('10 ms')
    expect(metrics).toHaveTextContent('3')
    expect(metrics).toHaveTextContent('—')
  })

  it('hiển thị Core suy giảm khi producerState là DEGRADED', () => {
    renderTab({ ...runtime, producerState: 'DEGRADED' })
    expect(screen.getByText('Core suy giảm')).toBeInTheDocument()
    expect(screen.getByText(/Giá trị runtime mang nhãn dữ liệu cũ/)).toBeInTheDocument()
  })

  it('hiển thị Không kết nối được Core khi status là error', () => {
    renderTab(runtime, 'error')
    expect(screen.getByText('Không kết nối được Core')).toBeInTheDocument()
  })

  it('safe-state có cảnh báo PRG-SAFE-ACTIVE khi safeState=true', () => {
    renderTab({ ...runtime, safeState: true, safeStateNoControllerOnly: false })
    expect(screen.getByText(/PRG-SAFE-ACTIVE — Safe-state đang tác động do lỗi/)).toBeInTheDocument()
  })
})
