import { useEffect, useMemo, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'

const ALLOWED_PERIODS = [1000, 5000, 30000] as const

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
  forceReadOnly = false
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
  forceReadOnly?: boolean
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin') && !forceReadOnly
  const [period, setPeriod] = useState<number>(document.task.periodMs)
  const [order, setOrder] = useState<string[]>(document.task.programOrder)
  const previousCommittedTask = useRef(document.task)
  const dirty = period !== document.task.periodMs || order.join(',') !== document.task.programOrder.join(',')
  const pendingOperations = useMemo<ProgrammingDraftOperation[]>(
    () => dirty ? [{ op: 'setTask', task: { ...document.task, periodMs: period as 1000 | 5000 | 30000, programOrder: order } }] : [],
    [dirty, document.task, order, period]
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
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Tác vụ thực thi', 'Execution task')}</h3>
      <div>
        <h4 className="text-sm font-semibold text-[var(--c-text)]">Control_Main</h4>
        <label className="mt-2 block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-task-period">
          {pick('Chu kỳ', 'Period')}
        </label>
        <select
          id="programming-task-period"
          className="mt-1 w-40 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
          value={period}
          disabled={!canEdit}
          onChange={(event) => setPeriod(Number(event.target.value))}
        >
          {ALLOWED_PERIODS.map((value) => (
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
                    <button type="button" className="px-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)}>
                      ↑<span className="sr-only">{pick('Lên', 'Move up')}</span>
                    </button>
                    <button
                      type="button"
                      className="px-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)] disabled:opacity-30"
                      disabled={index === order.length - 1}
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
          disabled={!dirty}
          onClick={() => void onSave([{ op: 'setTask', task: { ...document.task, periodMs: period as 1000 | 5000 | 30000, programOrder: order } }])}
        >
          {pick('Lưu', 'Save')}
        </Button>
      )}
    </div>
  )
}
