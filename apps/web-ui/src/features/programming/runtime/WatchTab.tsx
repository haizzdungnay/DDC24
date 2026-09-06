import { useEffect, useMemo, useState } from 'react'
import { Square, TimerReset } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { formatTechnicalDateTime, type HmiLocale } from '../../../shared/dateTime'
import { createUuid } from '../../../shared/crypto'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingApiClient } from '../api/authClient'
import { useProgrammingActionAllowed } from '../api/authorization'
import { useProgrammingRuntimeMonitor, useProgrammingRuntimeSignals } from '../api/queries'
import type {
  ProgrammingMonitorPage,
  ProgrammingMonitorSample,
  ProgrammingPointCategory,
  ProgrammingRuntimeSignal,
  ProgrammingRuntimeSignalPage,
  ProgrammingTrace,
  ProgrammingTraceAccepted,
  ProgrammingTraceRequest,
  ProgrammingTraceValue
} from '../model/types'

type PickCopy = (vi: string, en: string) => string
type CategoryFilter = 'ALL' | ProgrammingPointCategory

const CATEGORIES: ProgrammingPointCategory[] = ['LOCAL', 'VP', 'MB_RTU']

/** PGM-06/UJ-PROG-07, T59-504 — monitor 1 Hz chỉ đọc và trace bounded. Mọi
 * candidate, actual, quality, freshness, priority và TTL đều đến từ snapshot
 * Core/BE. `null`/giá trị không hợp lệ luôn hiển thị là chưa có dữ liệu, không
 * bị đổi thành 0. */
export function WatchTab() {
  const { pick } = useI18n()
  const canTrace = useProgrammingActionAllowed('trace')
  const client = useProgrammingApiClient()
  const monitor = useProgrammingRuntimeMonitor()
  const signals = useProgrammingRuntimeSignals()
  const [category, setCategory] = useState<CategoryFilter>('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [durationMs, setDurationMs] = useState(60_000)
  const [samplePeriodMs, setSamplePeriodMs] = useState(1_000)
  const [trace, setTrace] = useState<ProgrammingTrace | null>(null)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [traceBusy, setTraceBusy] = useState(false)

  const items = monitor.data?.items ?? []
  const itemByVariableId = useMemo(
    () => new Map(items.map((item) => [item.variableId, item] as const)),
    [items]
  )
  const categoryCounts = useMemo(() => {
    const counts: Record<ProgrammingPointCategory, number> = { LOCAL: 0, VP: 0, MB_RTU: 0 }
    for (const item of items) {
      if (CATEGORIES.includes(item.point.category)) counts[item.point.category] += 1
    }
    return counts
  }, [items])
  const visibleItems = useMemo(
    () => category === 'ALL' ? items : items.filter((item) => item.point.category === category),
    [category, items]
  )
  const selectedAvailable = useMemo(() => {
    const available = new Set(items.map((item) => item.variableId))
    return [...selected].filter((id) => available.has(id)).slice(0, 32)
  }, [items, selected])

  const runningTraceId = trace?.state === 'RUNNING' ? trace.traceId : null
  useEffect(() => {
    if (!runningTraceId) return undefined
    let active = true
    const poll = () => {
      client.request<ProgrammingTrace>('getProgrammingTrace', { path: { traceId: runningTraceId } }).then(
        (value) => {
          if (!active) return
          setTrace(value)
          setTraceError(null)
        },
        (reason: unknown) => {
          if (!active) return
          setTraceError(reason instanceof Error ? reason.message : pick('Không đọc được trace.', 'Could not read trace.'))
        }
      )
    }
    const timer = window.setInterval(poll, 500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [client, pick, runningTraceId])

  async function startTrace() {
    if (selectedAvailable.length === 0) return
    setTraceBusy(true)
    setTraceError(null)
    const body: ProgrammingTraceRequest = { schemaVersion: '1.0', variableIds: selectedAvailable, durationMs, samplePeriodMs }
    try {
      const accepted = await client.request<ProgrammingTraceAccepted, ProgrammingTraceRequest>('createProgrammingTrace', {
        body,
        idempotencyKey: createUuid(),
        correlationId: createUuid()
      })
      const value = await client.request<ProgrammingTrace>('getProgrammingTrace', { path: { traceId: accepted.traceId } })
      setTrace(value)
    } catch (reason) {
      setTraceError(reason instanceof Error ? reason.message : pick('Không tạo được trace.', 'Could not create trace.'))
    } finally {
      setTraceBusy(false)
    }
  }

  async function stopTrace() {
    if (!trace) return
    setTraceBusy(true)
    try {
      await client.request<void>('stopProgrammingTrace', { path: { traceId: trace.traceId } })
      const value = await client.request<ProgrammingTrace>('getProgrammingTrace', { path: { traceId: trace.traceId } })
      setTrace(value)
      setTraceError(null)
    } catch (reason) {
      setTraceError(reason instanceof Error ? reason.message : pick('Không dừng được trace.', 'Could not stop trace.'))
    } finally {
      setTraceBusy(false)
    }
  }

  const traceRunning = trace?.state === 'RUNNING'

  return (
    <div className="space-y-4">
      <h3 className="sr-only">{pick('Theo dõi trực tuyến', 'Online watch')}</h3>
      <Panel
        title={pick('Theo dõi trực tuyến', 'Online watch')}
        subtitle={pick('Snapshot cuối chu kỳ từ Core, làm mới mỗi 1 giây.', 'End-of-scan snapshot from Core, refreshed every second.')}
        action={<StatusBadge state="normal" label={pick('CHỈ ĐỌC', 'READ ONLY')} />}
      >
        {monitor.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải monitor…', 'Loading monitor…')} />
        ) : monitor.status === 'error' || !monitor.data ? (
          <MonitorFailure failure={monitor.failure} detail={monitor.error} onRetry={monitor.refresh} pick={pick} />
        ) : monitor.data.activeRevisionId === null ? (
          <StateBlock
            state="empty"
            title={pick('Chưa có Revision đang chạy.', 'There is no running revision.')}
            detail={pick('Monitor không suy giá trị từ bản nháp.', 'The monitor does not infer values from the draft.')}
          />
        ) : monitor.data.items.length === 0 ? (
          <StateBlock state="empty" title={pick('Revision đang chạy chưa có biến ánh xạ.', 'The running revision has no mapped variables.')} />
        ) : (
          <div className="space-y-4">
            <MonitorContext data={monitor.data} pick={pick} />
            <CategoryFilters category={category} counts={categoryCounts} onChange={setCategory} pick={pick} />
            {visibleItems.length === 0 ? (
              <StateBlock state="empty" title={pick('Không có biến trong nhóm đã chọn.', 'There are no variables in the selected category.')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1280px] text-left text-sm">
                  <caption className="sr-only">
                    {pick('Giá trị runtime tách biệt đề xuất đầu ra của Program với giá trị thực tế và nguồn phân xử.', 'Runtime values separating the Program output candidate from actual value and arbitration source.')}
                  </caption>
                  <thead>
                    <tr className="border-b border-[var(--c-border)] text-xs uppercase text-[var(--c-text-dim)]">
                      <th scope="col" className="py-1 pr-2"><span className="sr-only">{pick('Chọn trace', 'Select for trace')}</span></th>
                      <th scope="col" className="py-1 pr-3">{pick('Program / Biến', 'Program / Variable')}</th>
                      <th scope="col" className="py-1 pr-3">Point</th>
                      <th scope="col" className="py-1 pr-3">{pick('Đề xuất đầu ra (mức 5)', 'Output candidate (level 5)')}</th>
                      <th scope="col" className="py-1 pr-3">{pick('Giá trị thực tế', 'Actual value')}</th>
                      <th scope="col" className="py-1 pr-3">{pick('Nguồn hiệu lực', 'Effective source')}</th>
                      <th scope="col" className="py-1 pr-3">{pick('Ưu tiên', 'Priority')}</th>
                      <th scope="col" className="py-1 pr-3">TTL</th>
                      <th scope="col" className="py-1">{pick('Chất lượng / độ tươi', 'Quality / freshness')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <MonitorRow
                        key={item.variableId}
                        item={item}
                        selected={selected.has(item.variableId)}
                        selectDisabled={!canTrace || traceRunning || (!selected.has(item.variableId) && selectedAvailable.length >= 32)}
                        onSelect={(checked) => setSelected((current) => {
                          const next = new Set(current)
                          if (checked && next.size < 32) next.add(item.variableId)
                          else if (!checked) next.delete(item.variableId)
                          return next
                        })}
                        pick={pick}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>

      <SignalPanel signals={signals} pick={pick} />

      <Panel title={pick('Bản ghi (Trace)', 'Trace')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--c-text-dim)]">{pick('Thời lượng', 'Duration')}
            <select className="mt-1 block rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={durationMs} disabled={!canTrace || traceRunning} onChange={(event) => setDurationMs(Number(event.target.value))}>
              <option value={10_000}>10 s</option><option value={60_000}>60 s</option><option value={300_000}>5 min</option><option value={600_000}>10 min</option>
            </select>
          </label>
          <label className="text-xs text-[var(--c-text-dim)]">{pick('Chu kỳ lấy mẫu', 'Sample period')}
            <select className="mt-1 block rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={samplePeriodMs} disabled={!canTrace || traceRunning} onChange={(event) => setSamplePeriodMs(Number(event.target.value))}>
              <option value={100}>100 ms</option><option value={1_000}>1 s</option><option value={5_000}>5 s</option>
            </select>
          </label>
          <span className="pb-2 text-xs text-[var(--c-text-dim)]">{selectedAvailable.length}/32 {pick('biến', 'variables')}</span>
          {canTrace && !traceRunning && <Button size="sm" icon={<TimerReset className="h-4 w-4" aria-hidden="true" />} loading={traceBusy} disabled={selectedAvailable.length === 0} onClick={() => void startTrace()}>{pick('Bắt đầu trace', 'Start trace')}</Button>}
          {canTrace && traceRunning && <Button size="sm" variant="danger" icon={<Square className="h-4 w-4" aria-hidden="true" />} loading={traceBusy} onClick={() => void stopTrace()}>{pick('Dừng trace', 'Stop trace')}</Button>}
        </div>
        {!canTrace && (
          <p role="note" className="mt-2 text-xs text-[var(--c-text-dim)]">
            {pick('Bạn có quyền xem monitor; cần quyền sửa Programming để chọn biến, tạo hoặc dừng trace.', 'You may view the monitor; Programming edit permission is required to select variables or start and stop a trace.')}
          </p>
        )}
        {traceError && <p role="alert" className="mt-3 text-sm text-[var(--c-fault-fg)]">{traceError}</p>}
        {trace && (
          <div className="mt-3 space-y-2">
            <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs text-[var(--c-text-dim)]">
              <StatusBadge state={trace.state === 'RUNNING' ? 'online' : trace.state === 'FAILED' ? 'fault' : 'unknown'} label={trace.state} />
              <span className="font-mono">{trace.traceId}</span>
              <span>{trace.samples.length} {pick('mẫu', 'samples')}</span>
              <span className={trace.droppedSamples > 0 ? 'font-semibold text-[var(--c-warn-fg)]' : undefined}>
                · {trace.droppedSamples} {pick('mẫu rơi', 'dropped samples')}
              </span>
              {trace.stopReason && <span>· {trace.stopReason}</span>}
            </div>
            {/* `T59-810` — `SOURCE_UNAVAILABLE` gộp hai chuyện rất khác nhau:
                mất nguồn, và nguồn ĐỔI THÀNH chương trình khác. Với phiên có
                pin, nói rõ vế thứ hai — nếu không người đọc sẽ đi tìm một sự cố
                kết nối không hề tồn tại. */}
            {trace.stopReason === 'SOURCE_UNAVAILABLE' && trace.pin && (
              <p role="status" className="mt-1 rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]">
                {pick(
                  `Phiên dừng vì nguồn đã rời khỏi tuple đã neo (Revision ${trace.pin.revisionId ?? '—'}). Dãy mẫu chỉ thuộc về tuple đó và không nối tiếp sang cái mới.`,
                  `The session stopped because the source left the pinned tuple (revision ${trace.pin.revisionId ?? '—'}). The samples belong to that tuple only and do not continue into the new one.`,
                )}
              </p>
            )}
            <TraceTable trace={trace} itemByVariableId={itemByVariableId} pick={pick} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function SignalPanel({ signals, pick }: {
  signals: ReturnType<typeof useProgrammingRuntimeSignals>
  pick: PickCopy
}) {
  const producerState = signals.data?.producerState
  return (
    <Panel
      title="Published Signal"
      subtitle={pick('Snapshot riêng từ StSignalBus; không suy từ Binding/Point.', 'A separate StSignalBus snapshot; never inferred from Binding/Point data.')}
      action={producerState ? <StatusBadge state={producerState === 'READY' ? 'online' : producerState === 'DEGRADED' ? 'degraded' : 'offline'} label={producerState} /> : undefined}
    >
      {signals.status === 'loading' ? (
        <StateBlock state="loading" title={pick('Đang tải Published Signal…', 'Loading Published Signals…')} />
      ) : signals.status === 'error' || !signals.data ? (
        <StateBlock state="error" title={pick('Không đọc được Published Signal.', 'Published Signals could not be read.')} detail={signals.error ?? undefined} onRetry={signals.refresh} />
      ) : signals.data.producerState === 'UNAVAILABLE' ? (
        <StateBlock state="offline" title={pick('Nguồn Published Signal đang ngoại tuyến.', 'The Published Signal source is offline.')} onRetry={signals.refresh} />
      ) : signals.data.activeRevisionId === null ? (
        <StateBlock state="empty" title={pick('Chưa có Revision đang chạy để công bố signal.', 'There is no running revision publishing signals.')} />
      ) : signals.data.items.length === 0 ? (
        <StateBlock state="empty" title={pick('Revision đang chạy chưa khai báo Published Signal.', 'The running revision declares no Published Signals.')} />
      ) : (
        <div className="space-y-3">
          <SignalSnapshotContext data={signals.data} pick={pick} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <caption className="sr-only">{pick('Published Signal theo Program producer, giá trị, chất lượng, độ tươi và chính sách stale.', 'Published Signals by producing Program, value, quality, freshness, and stale policy.')}</caption>
              <thead><tr className="border-b border-[var(--c-border)] text-xs uppercase text-[var(--c-text-dim)]">
                <th scope="col" className="py-1 pr-3">Signal</th>
                <th scope="col" className="py-1 pr-3">{pick('Program phát', 'Producing Program')}</th>
                <th scope="col" className="py-1 pr-3">{pick('Giá trị', 'Value')}</th>
                <th scope="col" className="py-1 pr-3">{pick('Chất lượng / độ tươi', 'Quality / freshness')}</th>
                <th scope="col" className="py-1 pr-3">{pick('Chính sách stale', 'Stale policy')}</th>
                <th scope="col" className="py-1">{pick('Định nghĩa / thế hệ', 'Definition / generation')}</th>
              </tr></thead>
              <tbody>{signals.data.items.map((signal) => <SignalRow key={`${signal.signalId ?? 'core'}:${signal.name}`} signal={signal} pick={pick} />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

function SignalSnapshotContext({ data, pick }: { data: ProgrammingRuntimeSignalPage; pick: PickCopy }) {
  const observed = formatObservedAt(data.observedAt, pick)
  return (
    <div role={data.producerState === 'DEGRADED' ? 'alert' : 'status'} className="flex flex-wrap gap-x-5 gap-y-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs">
      <span><span className="text-[var(--c-text-dim)]">Active Revision:</span> <span className="break-all font-mono">{data.activeRevisionId}</span></span>
      <span><span className="text-[var(--c-text-dim)]">{pick('Quan sát', 'Observed')}:</span> <time dateTime={data.observedAt} title={data.observedAt}>{observed.text}</time></span>
      {data.producerState === 'DEGRADED' && <strong className="text-[var(--c-warn-fg)]">{pick('Dữ liệu signal đang suy giảm; kiểm tra từng quality/freshness.', 'Signal data is degraded; inspect each quality/freshness state.')}</strong>}
    </div>
  )
}

function SignalRow({ signal, pick }: { signal: ProgrammingRuntimeSignal; pick: PickCopy }) {
  const usable = signalValueIsUsable(signal)
  return (
    <tr className="border-b border-[var(--c-border)] align-top">
      <th scope="row" className="py-2 pr-3 font-normal"><strong>{signal.name}</strong><br/><span className="font-mono text-xs text-[var(--c-text-dim)]">{signal.signalId ?? pick('Không có ID trong Revision', 'No Revision ID')}</span></th>
      <td className="py-2 pr-3"><span className="font-mono" title={signal.producerProgramId}>Program {shortId(signal.producerProgramId)}</span><br/><span className="text-xs text-[var(--c-text-dim)]">{signal.dataType}{signal.unit ? ` · ${signal.unit}` : ''}</span></td>
      <td className="py-2 pr-3 font-mono"><Value value={signal.value} unit={signal.unit ?? undefined} unavailable={!usable} pick={pick} />{!signal.valid && <><br/><StatusBadge state="bad" label="INVALID" /></>}</td>
      <td className="py-2 pr-3"><div className="flex flex-wrap gap-1"><StatusBadge state={signalQualityBadgeState(signal.quality)} label={signal.quality} /><StatusBadge state={signalFreshnessBadgeState(signal.freshness)} label={signal.freshness} /></div></td>
      <td className="py-2 pr-3"><span>{signal.stalePolicy}</span><br/><span className="text-xs text-[var(--c-text-dim)]">freshness {signal.freshnessMs} ms</span></td>
      <td className="py-2"><StatusBadge state={signal.definitionState === 'MATCHED' ? 'good' : signal.definitionState === 'MISMATCH' ? 'bad' : 'unknown'} label={signal.definitionState} /><br/><span className="text-xs text-[var(--c-text-dim)]">generation <span className="font-mono">{signal.generation}</span> · mono ns <span className="font-mono">{signal.publishedAtMonoNs}</span></span></td>
    </tr>
  )
}

function MonitorFailure({ failure, detail, onRetry, pick }: {
  failure: 'permission' | 'offline' | 'error' | null
  detail: string | null
  onRetry: () => void
  pick: PickCopy
}) {
  if (failure === 'permission') {
    return <StateBlock state="error" title={pick('Bạn không có quyền xem monitor.', 'You do not have permission to view the monitor.')} detail={detail ?? undefined} onRetry={onRetry} />
  }
  if (failure === 'offline') {
    return <StateBlock state="offline" title={pick('Monitor đang ngoại tuyến.', 'The monitor is offline.')} detail={detail ?? undefined} onRetry={onRetry} />
  }
  return <StateBlock state="error" title={pick('Không đọc được monitor', 'Monitor could not be read')} detail={detail ?? undefined} onRetry={onRetry} />
}

function MonitorContext({ data, pick }: { data: ProgrammingMonitorPage; pick: PickCopy }) {
  const taskState = data.task?.state ?? 'UNKNOWN'
  const taskBadge = taskState === 'RUNNING' ? 'online' : taskState === 'FAULT' ? 'fault' : 'unknown'
  return (
    <div
      role={data.safeState ? 'alert' : 'status'}
      aria-label={pick('Ngữ cảnh snapshot monitor', 'Monitor snapshot context')}
      className={`grid gap-3 rounded-[var(--radius)] border p-3 text-xs sm:grid-cols-3 ${data.safeState ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)]' : 'border-[var(--c-border)] bg-[var(--c-surface-2)]'}`}
    >
      <div><span className="text-[var(--c-text-dim)]">Active Revision</span><br/><span className="break-all font-mono text-[var(--c-text)]">{data.activeRevisionId}</span></div>
      <div><span className="mr-2 text-[var(--c-text-dim)]">Task</span><StatusBadge state={taskBadge} label={taskState} /></div>
      <div><span className="mr-2 text-[var(--c-text-dim)]">Safe-state</span><StatusBadge state={data.safeState ? 'safety' : 'normal'} label={data.safeState ? pick('ĐANG KÍCH HOẠT', 'ACTIVE') : pick('Không kích hoạt', 'Inactive')} /></div>
    </div>
  )
}

function CategoryFilters({ category, counts, onChange, pick }: {
  category: CategoryFilter
  counts: Record<ProgrammingPointCategory, number>
  onChange: (category: CategoryFilter) => void
  pick: PickCopy
}) {
  const total = CATEGORIES.reduce((sum, value) => sum + counts[value], 0)
  return (
    <div role="group" aria-label={pick('Lọc theo nhóm Point', 'Filter by point category')} className="flex flex-wrap gap-2">
      <CategoryButton active={category === 'ALL'} label={pick('Tất cả', 'All')} count={total} onClick={() => onChange('ALL')} />
      {CATEGORIES.map((value) => (
        <CategoryButton key={value} active={category === value} label={categoryLabel(value, pick)} count={counts[value]} onClick={() => onChange(value)} />
      ))}
    </div>
  )
}

function CategoryButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`min-h-11 rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)] hover:border-[var(--c-accent)]'}`}
      onClick={onClick}
    >
      {label} · {count}
    </button>
  )
}

function MonitorRow({ item, selected, selectDisabled, onSelect, pick }: {
  item: ProgrammingMonitorSample
  selected: boolean
  selectDisabled: boolean
  onSelect: (checked: boolean) => void
  pick: PickCopy
}) {
  const isOutput = item.direction === 'WRITE' || item.direction === 'READ_WRITE'
  const actualUnavailable = actualIsUnavailable(item.quality, item.freshness)
  const owner = effectiveOwner(item, pick)
  return (
    <tr className="border-b border-[var(--c-border)] align-top">
      <td className="py-2 pr-2">
        <input className="h-5 w-5" type="checkbox" aria-label={`${pick('Trace', 'Trace')} ${item.variableName}`} checked={selected} disabled={selectDisabled} onChange={(event) => onSelect(event.target.checked)} />
      </td>
      <th scope="row" className="py-2 pr-3 font-normal">
        <strong className="text-[var(--c-text)]">{item.variableName}</strong><br/>
        <span className="font-mono text-xs text-[var(--c-text-dim)]" title={item.programId}>Program {shortId(item.programId)}</span>
      </th>
      <td className="py-2 pr-3">
        <span className="font-medium text-[var(--c-text)]">{categoryLabel(item.point.category, pick)}</span><br/>
        <span className="font-mono text-xs text-[var(--c-text-dim)]">{item.point.deviceId ? `${item.point.deviceId}:` : ''}{item.point.pointId}</span>
      </td>
      <td className="py-2 pr-3 font-mono">{isOutput ? <Value value={item.programValue} unit={item.unit} pick={pick} /> : <NotApplicable pick={pick} />}</td>
      <td className="py-2 pr-3 font-mono"><Value value={item.actualValue} unit={item.unit} unavailable={actualUnavailable} pick={pick} /></td>
      <td className="py-2 pr-3"><span className="text-[var(--c-text)]">{owner.primary}</span>{owner.secondary && <><br/><span className="text-xs text-[var(--c-text-dim)]">{owner.secondary}</span></>}</td>
      <td className="py-2 pr-3">{item.effectivePriority === null ? <NoData pick={pick} /> : `${pick('Mức', 'Level')} ${item.effectivePriority}`}</td>
      <td className="py-2 pr-3">{item.overrideRemainingS === null ? <NoData pick={pick} /> : `${item.overrideRemainingS} s`}</td>
      <td className="py-2"><QualityFreshness item={item} pick={pick} /></td>
    </tr>
  )
}

function QualityFreshness({ item, pick }: { item: ProgrammingMonitorSample; pick: PickCopy }) {
  const observed = formatObservedAt(item.observedAt, pick)
  return (
    <div className="min-w-44 space-y-1.5">
      <div className="flex flex-wrap gap-1">
        <StatusBadge state={qualityBadgeState(item.quality)} label={item.quality} title={pick('Chất lượng do producer cung cấp', 'Quality supplied by the producer')} />
        <StatusBadge state={freshnessBadgeState(item.freshness)} label={item.freshness} title={pick('Độ tươi tính từ thời điểm producer', 'Freshness computed from the producer timestamp')} />
      </div>
      {observed.valid
        ? <time dateTime={item.observedAt} title={item.observedAt} className="block text-xs text-[var(--c-text-dim)]">{pick('Quan sát', 'Observed')}: {observed.text}</time>
        : <span className="block text-xs text-[var(--c-text-dim)]">{pick('Thời điểm quan sát', 'Observed at')}: <NoData pick={pick} /></span>}
    </div>
  )
}

function TraceTable({ trace, itemByVariableId, pick }: { trace: ProgrammingTrace; itemByVariableId: Map<string, ProgrammingMonitorSample>; pick: PickCopy }) {
  const recent = trace.samples.slice(-10).reverse()
  if (recent.length === 0) return <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có mẫu.', 'No samples yet.')}</p>
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full min-w-[900px] text-left text-xs">
        <caption className="sr-only">{pick('Mười snapshot trace gần nhất; các giá trị trong cùng sequence thuộc cùng một chu kỳ Core.', 'The ten most recent trace snapshots; values sharing a sequence come from one Core scan.')}</caption>
        <thead><tr className="text-[var(--c-text-dim)]"><th scope="col"># / time</th><th scope="col">{pick('Biến', 'Variable')}</th><th scope="col">{pick('Đề xuất đầu ra', 'Output candidate')}</th><th scope="col">Actual</th><th scope="col">{pick('Nguồn / ưu tiên', 'Source / priority')}</th><th scope="col">{pick('Chất lượng', 'Quality')}</th></tr></thead>
        <tbody>{recent.flatMap((sample) => sample.values.map((value, index) => {
          const item = itemByVariableId.get(value.variableId)
          const isKnownInput = item?.direction === 'READ'
          const owner = effectiveTraceOwner(value, item, pick)
          return (
            <tr key={`${sample.sequence}-${value.variableId}`} className="border-t border-[var(--c-border)] align-top">
              <td>{index === 0 ? `${sample.sequence} · ${formatObservedAt(sample.observedAt, pick).text}` : ''}</td>
              <th scope="row" className="font-normal"><span className="text-[var(--c-text)]">{item?.variableName ?? shortId(value.variableId)}</span><br/><span className="font-mono text-[var(--c-text-dim)]">{shortId(value.variableId)}</span></th>
              <td className="font-mono">{isKnownInput ? <NotApplicable pick={pick} /> : <Value value={value.programValue} unit={item?.unit} pick={pick} />}</td>
              <td className="font-mono"><Value value={value.actualValue} unit={item?.unit} unavailable={actualIsUnavailable(value.quality, value.freshness)} pick={pick} /></td>
              <td>{owner} / {value.effectivePriority === null ? <NoData pick={pick} /> : `${pick('mức', 'level')} ${value.effectivePriority}`}</td>
              <td>{value.quality} · {value.freshness}</td>
            </tr>
          )
        }))}</tbody>
      </table>
    </div>
  )
}

function Value({ value, unit, unavailable = false, pick }: { value: unknown; unit?: string; unavailable?: boolean; pick: PickCopy }) {
  if (unavailable || !isDisplayScalar(value)) return <NoData pick={pick} />
  return <>{String(value)}{unit ? ` ${unit}` : ''}</>
}

function NoData({ pick }: { pick: PickCopy }) {
  return <span aria-label={pick('Không có dữ liệu', 'No data')} title={pick('Không có dữ liệu', 'No data')}>—</span>
}

function NotApplicable({ pick }: { pick: PickCopy }) {
  return <span className="text-[var(--c-text-dim)]">{pick('Không áp dụng', 'N/A')}</span>
}

function isDisplayScalar(value: unknown): value is number | boolean | string {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'boolean' || typeof value === 'string'
}

function actualIsUnavailable(quality: ProgrammingMonitorSample['quality'], freshness: ProgrammingMonitorSample['freshness']): boolean {
  return quality === 'BAD' || quality === 'OFFLINE' || quality === 'UNKNOWN' || freshness === 'UNAVAILABLE'
}

function signalValueIsUsable(signal: ProgrammingRuntimeSignal): boolean {
  if (!signal.valid || signal.definitionState !== 'MATCHED' || signal.quality === 'BAD') return false
  return signal.freshness !== 'UNAVAILABLE' && signal.freshness !== 'NOT_DECLARED'
}

function effectiveOwner(item: ProgrammingMonitorSample, pick: PickCopy): { primary: string; secondary?: string } {
  if (item.overriddenBy) return { primary: `${item.overriddenBy}${item.overrideActor ? ` · ${item.overrideActor}` : ''}` }
  if ((item.direction === 'WRITE' || item.direction === 'READ_WRITE') && item.effectivePriority === 5) {
    return { primary: pick('Program (logic cục bộ)', 'Program (local logic)'), secondary: pick('Đề xuất mức 5 đang thắng', 'Level 5 candidate is winning') }
  }
  if (item.direction === 'READ') {
    return { primary: `${pick('Point đầu vào', 'Input point')} · ${item.point.category}`, secondary: pick('Contract không công bố tên producer', 'Producer name is not exposed by the contract') }
  }
  return { primary: pick('Không rõ nguồn', 'Unknown source') }
}

function effectiveTraceOwner(value: ProgrammingTraceValue, item: ProgrammingMonitorSample | undefined, pick: PickCopy): string {
  if (value.overriddenBy) return value.overriddenBy
  if (value.effectivePriority === 5 && item?.direction !== 'READ') return pick('Program', 'Program')
  if (item?.direction === 'READ') return `${pick('Point đầu vào', 'Input point')} · ${item.point.category}`
  return pick('Không rõ nguồn', 'Unknown source')
}

function categoryLabel(category: ProgrammingPointCategory, pick: PickCopy): string {
  if (category === 'LOCAL') return pick('Cục bộ (LOCAL)', 'Local (LOCAL)')
  if (category === 'VP') return pick('Điểm ảo (VP)', 'Virtual point (VP)')
  if (category === 'MB_RTU') return 'Modbus RTU (MB_RTU)'
  return pick('Nhóm Point không rõ', 'Unknown point category')
}

function qualityBadgeState(quality: ProgrammingMonitorSample['quality']): 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown' {
  return quality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'
}

function freshnessBadgeState(freshness: ProgrammingMonitorSample['freshness']): 'live' | 'stale' | 'unknown' {
  if (freshness === 'LIVE') return 'live'
  if (freshness === 'STALE') return 'stale'
  return 'unknown'
}

function signalQualityBadgeState(quality: ProgrammingRuntimeSignal['quality']): 'good' | 'uncertain' | 'bad' {
  return quality.toLowerCase() as 'good' | 'uncertain' | 'bad'
}

function signalFreshnessBadgeState(freshness: ProgrammingRuntimeSignal['freshness']): 'live' | 'stale' | 'offline' | 'unknown' {
  if (freshness === 'FRESH') return 'live'
  if (freshness === 'STALE_HELD' || freshness === 'STALE_FALLBACK') return 'stale'
  if (freshness === 'UNAVAILABLE') return 'offline'
  return 'unknown'
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value
}

function formatObservedAt(value: string, pick: PickCopy): { valid: boolean; text: string } {
  const locale = pick('vi-VN', 'en-US') as HmiLocale
  const text = formatTechnicalDateTime(value, locale)
  return text === '—' ? { valid: false, text: pick('Không rõ', 'Unknown') } : { valid: true, text }
}
