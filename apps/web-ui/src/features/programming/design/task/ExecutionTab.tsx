import { useEffect, useMemo, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StateBlock } from '../../../../shared/components/StateBlock'
import type { ProgrammingCapabilities, ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingTaskConfig, RemoteState } from '../../model/types'

type TaskPeriod = ProgrammingTaskConfig['periodMs']
const CONTRACT_PERIODS: TaskPeriod[] = [1000, 5000, 30000]

/**
 * Tab "Thực thi" của PGM-02 (`UJ-PROG-04`) — đúng một Task
 * `Control_Main`, chu kỳ chỉ `1/5/30 s`, thứ tự Program. Ngăn kéo nâng cao
 * (base step/watchdog/ngân sách) là placeholder chỉ-đọc: các trường đó đến
 * từ Core runtime profile, chưa có route đọc ở P5 (UX §3.1 — không đặt trên
 * luồng chính, chỉ ở đây khi thật sự có producer).
 */
export function ExecutionTab({
  document,
  saving,
  onSave,
  onPendingOperationsChange,
  discardVersion,
  capabilities,
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
  capabilities: RemoteState<ProgrammingCapabilities>
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const [period, setPeriod] = useState<TaskPeriod>(document.task.periodMs)
  const [order, setOrder] = useState<string[]>(document.task.programOrder)
  const previousCommittedTask = useRef(document.task)
  const allowedPeriods = useMemo(() => capabilityPeriods(capabilities.data?.taskPeriodsMs), [capabilities.data?.taskPeriodsMs])
  const capabilityReady = capabilities.status === 'ready' && capabilities.data?.targetState === 'READY' && allowedPeriods.length > 0
  const periodSupported = allowedPeriods.includes(period)
  const dirty = period !== document.task.periodMs || order.join(',') !== document.task.programOrder.join(',')
  const pendingOperations = useMemo<ProgrammingDraftOperation[]>(
    () => dirty && capabilityReady && periodSupported ? [{ op: 'setTask', task: { ...document.task, periodMs: period, programOrder: order } }] : [],
    [capabilityReady, dirty, document.task, order, period, periodSupported]
  )

  useEffect(() => {
    const previous = previousCommittedTask.current
    const hadLocalChanges = period !== previous.periodMs || order.join(',') !== previous.programOrder.join(',')
    previousCommittedTask.current = document.task
    if (!hadLocalChanges) {
      setPeriod(document.task.periodMs)
      setOrder(document.task.programOrder)
    }
  }, [document.task, order, period])

  useEffect(() => onPendingOperationsChange(pendingOperations), [onPendingOperationsChange, pendingOperations])
  useEffect(() => {
    setPeriod(document.task.periodMs)
    setOrder(document.task.programOrder)
    previousCommittedTask.current = document.task
  }, [discardVersion])

  const programName = (id: string) => document.programs.find((program) => program.programId === id)?.name ?? id

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--c-text)]">Control_Main</h3>
        <p className="mt-1 text-xs text-[var(--c-text-dim)]">
          {pick('Chu kỳ được đọc từ capability profile của Core; FE không tự tạo lựa chọn khác.', 'Periods come from the Core capability profile; the UI does not invent additional choices.')}
        </p>
        {capabilities.status === 'loading' && <div className="mt-2"><StateBlock state="loading" title={pick('Đang đọc capability chu kỳ…', 'Loading period capabilities…')} /></div>}
        {capabilities.status === 'error' && <div className="mt-2"><StateBlock state="error" title={pick('Không xác minh được capability chu kỳ.', 'Could not verify period capabilities.')} detail={capabilities.error ?? undefined} onRetry={capabilities.refresh} /></div>}
        {capabilities.status === 'ready' && allowedPeriods.length === 0 && (
          <div className="mt-2"><StateBlock state="empty" title={pick('Core không công bố chu kỳ Task hợp lệ.', 'Core did not publish any valid task periods.')} /></div>
        )}
        {capabilities.status === 'ready' && capabilities.data?.targetState !== 'READY' && (
          <div role="status" className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
            {pick(`Capability đang ở trạng thái ${capabilities.data?.targetState ?? 'UNKNOWN'}; thay đổi Task bị khóa.`, `Capabilities are ${capabilities.data?.targetState ?? 'UNKNOWN'}; task changes are locked.`)}
          </div>
        )}
        {capabilities.status === 'ready' && allowedPeriods.length > 0 && !periodSupported && (
          <div role="alert" className="mt-2 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
            {pick(`Chu kỳ Draft ${period} ms không nằm trong capability hiện tại; không thể lưu Task cho tới khi đọc lại hoặc chọn giá trị hợp lệ.`, `Draft period ${period} ms is outside the current capabilities; the task cannot be saved until capabilities are refreshed or a valid value is selected.`)}
          </div>
        )}
        <label className="mt-2 block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-task-period">
          {pick('Chu kỳ', 'Period')}
        </label>
        <select
          id="programming-task-period"
          className="mt-1 w-40 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
          value={period}
          disabled={!canEdit || !capabilityReady}
          onChange={(event) => setPeriod(Number(event.target.value) as TaskPeriod)}
        >
          {!allowedPeriods.includes(period) && <option value={period}>{period / 1000} s · {pick('Draft hiện tại', 'Current draft')}</option>}
          {allowedPeriods.map((value) => (
            <option key={value} value={value}>
              {value / 1000} s
            </option>
          ))}
        </select>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thứ tự chạy', 'Execution order')}</h4>
        {order.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Chưa có chương trình nào trong Task.', 'No programs in the task yet.')}</p>
        ) : (
          <ol className="mt-1 space-y-1">
            {order.map((programId, index) => (
              <li key={programId} className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--c-border)] px-3 py-1.5 text-sm">
                <span>
                  {index + 1}. {programName(programId)}
                </span>
                {canEdit && (
                  <span className="flex gap-1">
                    <button type="button" className="px-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] disabled:opacity-30" disabled={!capabilityReady || index === 0} onClick={() => move(index, -1)}>
                      ↑<span className="sr-only">{pick('Lên', 'Move up')}</span>
                    </button>
                    <button
                      type="button"
                      className="px-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] disabled:opacity-30"
                      disabled={!capabilityReady || index === order.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓<span className="sr-only">{pick('Xuống', 'Move down')}</span>
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {canEdit && (
        <Button
          size="sm"
          icon={<Save className="h-4 w-4" aria-hidden="true" />}
          loading={saving}
          disabled={!dirty || !capabilityReady || !periodSupported}
          onClick={() => void onSave([{ op: 'setTask', task: { ...document.task, periodMs: period, programOrder: order } }])}
        >
          {pick('Lưu', 'Save')}
        </Button>
      )}
    </div>
  )
}

function capabilityPeriods(values: number[] | undefined): TaskPeriod[] {
  if (!values) return []
  return [...new Set(values.filter((value): value is TaskPeriod => CONTRACT_PERIODS.includes(value as TaskPeriod)))].sort((left, right) => left - right)
}
