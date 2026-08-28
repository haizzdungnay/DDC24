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
import type { ProgrammingMonitorPage, ProgrammingMonitorSample, ProgrammingTrace, ProgrammingTraceAccepted, ProgrammingTraceRequest } from '../model/types'

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
      <Panel title={pick('Theo dõi trực tuyến', 'Online watch')}>
        {monitor.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : monitor.status === 'error' || !monitor.data ? (
          <StateBlock state="offline" title={pick('Không đọc được monitor', 'Monitor unavailable')} detail={monitor.error ?? undefined} onRetry={monitor.refresh} />
        ) : monitor.data.items.length === 0 ? (
          <StateBlock state="empty" title={pick('Revision đang chạy chưa có biến ánh xạ.', 'The running revision has no mapped variables.')} />
        ) : (
          <>
            <MonitorEvidence monitor={monitor.data} />
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
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
            <div className="mt-4 space-y-2 md:hidden">
              {monitor.data.items.map((item) => (
                <MonitorCard key={item.variableId} item={item} selected={selected.has(item.variableId)} onSelect={(checked) => setSelected((current) => {
                  const next = new Set(current)
                  if (checked && next.size < 32) next.add(item.variableId)
                  else if (!checked) next.delete(item.variableId)
                  return next
                })} />
              ))}
            </div>
          </>
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

function MonitorEvidence({ monitor }: { monitor: ProgrammingMonitorPage }) {
  const { pick } = useI18n()
  const sampleTimes = monitor.items.map((item) => Date.parse(item.observedAt)).filter(Number.isFinite)
  const newestObservedAt = sampleTimes.length > 0 ? new Date(Math.max(...sampleTimes)).toLocaleString() : '—'
  return (
    <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-border)] sm:grid-cols-2 lg:grid-cols-4" aria-label={pick('Bằng chứng monitor', 'Monitor evidence')}>
      <EvidenceCell label={pick('Bản đang Active', 'Active revision')} value={monitor.activeRevisionId ?? '—'} mono />
      <EvidenceCell label={pick('Tác vụ / chu kỳ', 'Task / period')} value={monitor.task ? `${monitor.task.taskId} · ${monitor.task.periodMs} ms` : '—'} />
      <EvidenceCell label={pick('Trạng thái an toàn', 'Safe state')} value={monitor.safeState ? pick('ĐANG TÁC ĐỘNG', 'ACTIVE') : pick('Bình thường', 'Normal')} tone={monitor.safeState ? 'warn' : 'good'} />
      <EvidenceCell label={pick('Snapshot mới nhất', 'Newest snapshot')} value={newestObservedAt} />
    </div>
  )
}

function EvidenceCell({ label, value, mono = false, tone }: { label: string; value: string; mono?: boolean; tone?: 'good' | 'warn' }) {
  return (
    <div className="min-w-0 bg-[var(--c-surface-2)] px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--c-text-dim)]">{label}</p>
      <p className={`mt-1 break-all text-sm font-semibold ${mono ? 'font-mono text-xs' : ''} ${tone === 'good' ? 'text-[var(--c-good-fg)]' : tone === 'warn' ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-text)]'}`}>{value}</p>
    </div>
  )
}

function MonitorRow({ item, selected, onSelect }: { item: ProgrammingMonitorSample; selected: boolean; onSelect: (checked: boolean) => void }) {
  return (
    <tr className="border-b border-[var(--c-border)]">
      <td className="py-1.5 pr-2"><input type="checkbox" aria-label={`Trace ${item.variableName}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} /></td>
      <td className="py-1.5 pr-3"><strong className="text-[var(--c-text)]">{item.variableName}</strong><br/><span className="font-mono text-xs text-[var(--c-text-dim)]">{item.point.category}:{item.point.deviceId ? `${item.point.deviceId}:` : ''}{item.point.pointId}</span><br/><span className="text-[10px] text-[var(--c-text-dim)]">{item.programId.slice(0, 8)} · {item.direction} · {item.dataType}</span><br/><span className="text-[10px] text-[var(--c-text-dim)]">{new Date(item.observedAt).toLocaleString()}</span></td>
      <td className="py-1.5 pr-3 font-mono">{displayValue(item.programValue, item.unit)}</td>
      <td className="py-1.5 pr-3 font-mono">{displayValue(item.actualValue, item.unit)}</td>
      <td className="py-1.5 pr-3">{item.overriddenBy ?? 'PROGRAM'}{item.overrideActor ? ` · ${item.overrideActor}` : ''}</td>
      <td className="py-1.5 pr-3">{item.effectivePriority ?? '—'}</td>
      <td className="py-1.5 pr-3">{item.overrideRemainingS === null ? '—' : `${item.overrideRemainingS}s`}</td>
      <td className="py-1.5"><span className={item.freshness === 'LIVE' && item.quality === 'GOOD' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-warn-fg)]'}>{item.quality} · {item.freshness}</span></td>
    </tr>
  )
}

function MonitorCard({ item, selected, onSelect }: { item: ProgrammingMonitorSample; selected: boolean; onSelect: (checked: boolean) => void }) {
  const point = `${item.point.category}:${item.point.deviceId ? `${item.point.deviceId}:` : ''}${item.point.pointId}`
  return (
    <article className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><strong className="block break-words">{item.variableName}</strong><span className="font-mono text-xs text-[var(--c-text-dim)]">{point}</span><span className="mt-1 block text-xs text-[var(--c-text-dim)]">{item.programId.slice(0, 8)} · {item.direction} · {item.dataType}</span></div>
        <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" aria-label={`Trace ${item.variableName}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} /> Trace</label>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-[var(--c-text-dim)]">Giá trị Program</dt><dd className="font-mono">{displayValue(item.programValue, item.unit)}</dd></div>
        <div><dt className="text-[var(--c-text-dim)]">Giá trị thực tế</dt><dd className="font-mono">{displayValue(item.actualValue, item.unit)}</dd></div>
        <div><dt className="text-[var(--c-text-dim)]">Nguồn đang giữ</dt><dd>{item.overriddenBy ?? 'PROGRAM'}{item.overrideActor ? ` · ${item.overrideActor}` : ''}</dd></div>
        <div><dt className="text-[var(--c-text-dim)]">Ưu tiên / TTL</dt><dd>{item.effectivePriority ?? '—'} / {item.overrideRemainingS === null ? '—' : `${item.overrideRemainingS}s`}</dd></div>
        <div className="col-span-2"><dt className="text-[var(--c-text-dim)]">Chất lượng / độ tươi</dt><dd className={item.freshness === 'LIVE' && item.quality === 'GOOD' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-warn-fg)]'}>{item.quality} · {item.freshness}</dd><dd className="mt-1 text-[10px] text-[var(--c-text-dim)]">{new Date(item.observedAt).toLocaleString()}</dd></div>
      </dl>
    </article>
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
  const displayed = typeof value === 'number' ? new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value) : String(value)
  return `${displayed}${unit ? ` ${unit}` : ''}`
}
