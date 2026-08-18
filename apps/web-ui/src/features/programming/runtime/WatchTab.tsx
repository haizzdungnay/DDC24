import { useEffect, useMemo, useState } from 'react'
import { Square, TimerReset } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useAuth, roleAtLeast } from '../../auth'
import { useProgrammingApiClient } from '../api/authClient'
import { useProgrammingRuntimeMonitor } from '../api/queries'
import type { ProgrammingMonitorSample, ProgrammingTrace, ProgrammingTraceAccepted, ProgrammingTraceRequest } from '../model/types'

/** PGM-04/UJ-PROG-07 — monitor 1 Hz chỉ đọc và trace bounded. Mọi giá trị,
 * quality, freshness, priority và TTL đều đến từ snapshot Core/BE; `null`
 * luôn hiển thị `—`, không bị đổi thành 0. */
export function WatchTab() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canTrace = roleAtLeast(session?.role, 'admin')
  const client = useProgrammingApiClient()
  const monitor = useProgrammingRuntimeMonitor()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [durationMs, setDurationMs] = useState(60_000)
  const [samplePeriodMs, setSamplePeriodMs] = useState(1_000)
  const [trace, setTrace] = useState<ProgrammingTrace | null>(null)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [traceBusy, setTraceBusy] = useState(false)

  const selectedAvailable = useMemo(() => {
    const available = new Set((monitor.data?.items ?? []).map((item) => item.variableId))
    return [...selected].filter((id) => available.has(id)).slice(0, 32)
  }, [monitor.data?.items, selected])

  useEffect(() => {
    if (!trace || trace.state !== 'RUNNING') return undefined
    const traceId = trace.traceId
    const poll = () => {
      client.request<ProgrammingTrace>('getProgrammingTrace', { path: { traceId } }).then(
        (value) => { setTrace(value); setTraceError(null) },
        (reason: unknown) => setTraceError(reason instanceof Error ? reason.message : pick('Không đọc được trace.', 'Could not read trace.'))
      )
    }
    const timer = window.setInterval(poll, 500)
    return () => window.clearInterval(timer)
  }, [client, pick, trace])

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

  return (
    <div className="space-y-4">
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Theo dõi trực tuyến', 'Online watch')}</h3>
      <Panel title={pick('Theo dõi trực tuyến', 'Online watch')}>
        {monitor.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : monitor.status === 'error' || !monitor.data ? (
          <StateBlock state="offline" title={pick('Không đọc được monitor', 'Monitor unavailable')} detail={monitor.error ?? undefined} onRetry={monitor.refresh} />
        ) : monitor.data.items.length === 0 ? (
          <StateBlock state="empty" title={pick('Revision đang chạy chưa có biến ánh xạ.', 'The running revision has no mapped variables.')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead><tr className="border-b border-[var(--c-border)] text-xs uppercase text-[var(--c-text-dim)]">
                <th className="py-1 pr-2"><span className="sr-only">{pick('Chọn trace', 'Select for trace')}</span></th>
                <th className="py-1 pr-3">{pick('Biến / Point', 'Variable / Point')}</th>
                <th className="py-1 pr-3">{pick('Giá trị Program', 'Program value')}</th>
                <th className="py-1 pr-3">{pick('Giá trị thực tế', 'Actual value')}</th>
                <th className="py-1 pr-3">{pick('Nguồn đang giữ', 'Effective owner')}</th>
                <th className="py-1 pr-3">{pick('Ưu tiên', 'Priority')}</th>
                <th className="py-1 pr-3">TTL</th>
                <th className="py-1">{pick('Chất lượng / độ tươi', 'Quality / freshness')}</th>
              </tr></thead>
              <tbody>{monitor.data.items.map((item) => (
                <MonitorRow key={item.variableId} item={item} selected={selected.has(item.variableId)} onSelect={(checked) => setSelected((current) => {
                  const next = new Set(current)
                  if (checked && next.size < 32) next.add(item.variableId)
                  else if (!checked) next.delete(item.variableId)
                  return next
                })} />
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={pick('Bản ghi (Trace)', 'Trace')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--c-text-dim)]">{pick('Thời lượng', 'Duration')}
            <select className="mt-1 block rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={durationMs} disabled={!canTrace || trace?.state === 'RUNNING'} onChange={(event) => setDurationMs(Number(event.target.value))}>
              <option value={10_000}>10 s</option><option value={60_000}>60 s</option><option value={300_000}>5 min</option><option value={600_000}>10 min</option>
            </select>
          </label>
          <label className="text-xs text-[var(--c-text-dim)]">{pick('Chu kỳ lấy mẫu', 'Sample period')}
            <select className="mt-1 block rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={samplePeriodMs} disabled={!canTrace || trace?.state === 'RUNNING'} onChange={(event) => setSamplePeriodMs(Number(event.target.value))}>
              <option value={100}>100 ms</option><option value={1_000}>1 s</option><option value={5_000}>5 s</option>
            </select>
          </label>
          <span className="pb-2 text-xs text-[var(--c-text-dim)]">{selectedAvailable.length}/32 {pick('biến', 'variables')}</span>
          {canTrace && trace?.state !== 'RUNNING' && <Button size="sm" icon={<TimerReset className="h-4 w-4" aria-hidden="true" />} loading={traceBusy} disabled={selectedAvailable.length === 0} onClick={() => void startTrace()}>{pick('Bắt đầu trace', 'Start trace')}</Button>}
          {canTrace && trace?.state === 'RUNNING' && <Button size="sm" variant="danger" icon={<Square className="h-4 w-4" aria-hidden="true" />} loading={traceBusy} onClick={() => void stopTrace()}>{pick('Dừng trace', 'Stop trace')}</Button>}
        </div>
        {!canTrace && <p className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Viewer/operator được xem trace; chỉ admin được tạo hoặc dừng.', 'Viewer/operator can read traces; only admin can create or stop one.')}</p>}
        {traceError && <p role="alert" className="mt-3 text-sm text-[var(--c-fault-fg)]">{traceError}</p>}
        {trace && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--c-text-dim)]">
              <StatusBadge state={trace.state === 'RUNNING' ? 'online' : trace.state === 'FAILED' ? 'fault' : 'unknown'} label={trace.state} />
              <span className="font-mono">{trace.traceId}</span>
              <span>{trace.samples.length} {pick('mẫu', 'samples')} · {trace.droppedSamples} {pick('mẫu rơi', 'dropped')}</span>
              {trace.stopReason && <span>· {trace.stopReason}</span>}
            </div>
            <TraceTable trace={trace} />
          </div>
        )}
      </Panel>
    </div>
  )
}

function MonitorRow({ item, selected, onSelect }: { item: ProgrammingMonitorSample; selected: boolean; onSelect: (checked: boolean) => void }) {
  return (
    <tr className="border-b border-[var(--c-border)]">
      <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Trace ${item.variableName}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} /></td>
      <td className="py-1.5 pr-3"><strong className="text-[var(--c-text)]">{item.variableName}</strong><br/><span className="font-mono text-xs text-[var(--c-text-dim)]">{item.point.category}:{item.point.deviceId ? `${item.point.deviceId}:` : ''}{item.point.pointId}</span></td>
      <td className="py-1.5 pr-3 font-mono">{displayValue(item.programValue, item.unit)}</td>
      <td className="py-1.5 pr-3 font-mono">{displayValue(item.actualValue, item.unit)}</td>
      <td className="py-1.5 pr-3">{item.overriddenBy ?? 'PROGRAM'}{item.overrideActor ? ` · ${item.overrideActor}` : ''}</td>
      <td className="py-1.5 pr-3">{item.effectivePriority ?? '—'}</td>
      <td className="py-1.5 pr-3">{item.overrideRemainingS === null ? '—' : `${item.overrideRemainingS}s`}</td>
      <td className="py-1.5"><span className={item.freshness === 'LIVE' && item.quality === 'GOOD' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-warn-fg)]'}>{item.quality} · {item.freshness}</span></td>
    </tr>
  )
}

function TraceTable({ trace }: { trace: ProgrammingTrace }) {
  const recent = trace.samples.slice(-10).reverse()
  if (recent.length === 0) return <p className="text-sm text-[var(--c-text-dim)]">Chưa có mẫu.</p>
  return <div className="max-h-72 overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead><tr className="text-[var(--c-text-dim)]"><th># / time</th><th>Variable</th><th>Program</th><th>Actual</th><th>Owner / priority</th><th>Quality</th></tr></thead><tbody>{recent.flatMap((sample) => sample.values.map((value, index) => <tr key={`${sample.sequence}-${value.variableId}`} className="border-t border-[var(--c-border)]"><td>{index === 0 ? `${sample.sequence} · ${new Date(sample.observedAt).toLocaleTimeString()}` : ''}</td><td className="font-mono">{value.variableId.slice(0, 8)}</td><td>{displayValue(value.programValue)}</td><td>{displayValue(value.actualValue)}</td><td>{value.overriddenBy ?? 'PROGRAM'} / {value.effectivePriority ?? '—'}</td><td>{value.quality} · {value.freshness}</td></tr>))}</tbody></table></div>
}

function displayValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' && !Number.isFinite(value)) return '—'
  return `${String(value)}${unit ? ` ${unit}` : ''}`
}
