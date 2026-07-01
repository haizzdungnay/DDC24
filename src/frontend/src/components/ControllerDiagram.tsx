import { useMemo, useState, type MouseEvent } from 'react'
import { getDemoNetwork, getDemoPoints } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { HealthResponse, IoChannel, Point, PointKind, PollState } from '../types'
import { cn } from '../utils'
import { Modal } from './Modal'

type QualityState = 'good' | 'uncertain' | 'bad' | 'off'
type SignalState = 'on' | 'off' | 'warn' | 'nosignal'
type MetricState = 'normal' | 'warning' | 'critical' | 'offline'
type TooltipPosition = { x: number; y: number }

type ControllerDiagramProps = {
  points: Point[]
  health?: HealthResponse
  dataAgeLabel?: string
  compact?: boolean
  className?: string
  onOpenNetwork?: () => void
}

const SVG_WIDTH = 1160
const SVG_HEIGHT = 600
const DEVICE_X = 28
const DEVICE_Y = 46
const DEVICE_W = 1104
const DEVICE_H = 508
const BODY_Y = 170
const BODY_H = 278

function formatPointValue(point?: Point): string {
  if (!point) return '---'
  if (typeof point.value === 'boolean') return point.value ? 'ON' : 'OFF'
  if (typeof point.value === 'number') return `${point.value.toFixed(1)} ${point.unit || ''}`.trim()
  return String(point.value)
}

function channelFromPoint(point: Point): IoChannel {
  return {
    id: `CH-${point.id}`,
    pointId: point.id,
    kind: point.kind,
    label: point.name,
    signal: point.sensorType ?? (point.kind === 'DO' ? 'Dry Contact' : point.kind === 'UI' ? 'Universal Input' : '0-10V'),
    range: point.kind === 'UI' || point.kind === 'AO' ? '0-100' : 'ON/OFF',
    safeState: point.kind === 'AO' || point.kind === 'DO' ? 'OFF' : 'n/a'
  }
}

function qualityState(point?: Point): QualityState {
  if (!point) return 'off'
  if (point.fault || point.quality === 'bad') return 'bad'
  if (point.quality === 'uncertain' || point.quality === 'stale' || point.forced) return 'uncertain'
  return 'good'
}

function qualityColor(state: QualityState): string {
  if (state === 'bad') return 'var(--c-fault)'
  if (state === 'uncertain') return 'var(--c-warn)'
  if (state === 'off') return 'var(--c-off)'
  return 'var(--c-online, var(--c-good))'
}

function networkColor(state?: PollState | 'online' | 'offline'): string {
  if (state === 'offline') return 'var(--c-fault)'
  if (state === 'degraded') return 'var(--c-warn)'
  return 'var(--c-online, var(--c-good))'
}

function qualityText(state: QualityState): string {
  if (state === 'bad') return 'FAULT'
  if (state === 'uncertain') return 'WARN'
  if (state === 'off') return 'OFF'
  return 'GOOD'
}

function signalState(point?: Point): SignalState {
  if (!point || point.fault || point.quality === 'bad' || point.quality === 'stale') return 'nosignal'
  if (point.quality === 'uncertain' || point.forced) return 'warn'
  if (typeof point.value === 'boolean') return point.value ? 'on' : 'off'
  return 'on'
}

function signalColor(state: SignalState): string {
  if (state === 'nosignal') return 'var(--c-fault)'
  if (state === 'warn') return 'var(--c-warn)'
  if (state === 'off') return 'var(--c-off)'
  return 'var(--c-online, var(--c-good))'
}

function signalText(state: SignalState): string {
  if (state === 'nosignal') return 'NO SIGNAL'
  if (state === 'warn') return 'WARNING'
  if (state === 'off') return 'OFF'
  return 'ON'
}

function signalGlyph(state: SignalState): string {
  if (state === 'nosignal') return '!'
  if (state === 'warn') return '?'
  if (state === 'off') return 'O'
  return 'I'
}

function metricState(value: number | null, warnAt: number, criticalAt: number): MetricState {
  if (value === null) return 'offline'
  if (value >= criticalAt) return 'critical'
  if (value >= warnAt) return 'warning'
  return 'normal'
}

function metricColor(state: MetricState): string {
  if (state === 'critical') return 'var(--c-fault)'
  if (state === 'warning') return 'var(--c-warn)'
  if (state === 'offline') return 'var(--c-off)'
  return 'var(--c-online, var(--c-good))'
}

function metricTextColor(state: MetricState): string {
  if (state === 'critical') return 'var(--c-fault-fg)'
  if (state === 'warning') return 'var(--c-warn-fg)'
  if (state === 'offline') return 'var(--c-text-dim)'
  return 'var(--c-good-fg)'
}

function clampMetricValue(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function pointTooltipPosition(event: MouseEvent<SVGGElement>): TooltipPosition {
  const gap = 12
  const tooltipW = 240
  const tooltipH = 108
  return {
    x: Math.max(gap, Math.min(event.clientX + gap, window.innerWidth - tooltipW - gap)),
    y: Math.max(gap, Math.min(event.clientY + gap, window.innerHeight - tooltipH - gap))
  }
}

export function ControllerDiagram({ points, health, dataAgeLabel = 'API', compact = false, className, onOpenNetwork }: ControllerDiagramProps) {
  const { pick, t } = useI18n()
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ x: 0, y: 0 })

  const displayPoints = points.length ? points : getDemoPoints()
  const channels = [...displayPoints]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
    .map(channelFromPoint)
  const network = getDemoNetwork()
  const pointById = useMemo(() => new Map(displayPoints.map((point) => [point.id, point])), [displayPoints])
  const channelsByKind = useMemo(() => {
    const byKind = new Map<PointKind, IoChannel[]>()
    for (const channel of channels) byKind.set(channel.kind, [...(byKind.get(channel.kind) ?? []), channel])
    return byKind
  }, [channels])

  const ui = channelsByKind.get('UI') ?? []
  const ao = channelsByKind.get('AO') ?? []
  const doChannels = channelsByKind.get('DO') ?? []
  const southbound = network.southbound ?? []
  const degradedCount = southbound.filter((device) => device.pollState === 'degraded').length
  const offlineCount = southbound.filter((device) => device.pollState === 'offline').length
  const rs485State: PollState = offlineCount > 0 ? 'offline' : degradedCount > 0 ? 'degraded' : 'online'
  const totalFaults = displayPoints.filter((point) => qualityState(point) === 'bad').length
  const totalWarnings = displayPoints.filter((point) => qualityState(point) === 'uncertain').length
  const selectedPoint = selectedPointId ? pointById.get(selectedPointId) : undefined
  const selectedChannel = selectedPointId ? channels.find((channel) => channel.pointId === selectedPointId) : undefined
  const hoveredPoint = hoveredPointId ? pointById.get(hoveredPointId) : undefined
  const hoveredChannel = hoveredPointId ? channels.find((channel) => channel.pointId === hoveredPointId) : undefined
  const cpuValue = typeof health?.cpuPercent === 'number' ? health.cpuPercent : null
  const ramValue = typeof health?.ramPercent === 'number' ? health.ramPercent : null
  const tempValue = typeof health?.tempC === 'number' ? health.tempC : null

  function renderTerminalStrip(
    title: string,
    group: IoChannel[],
    x: number,
    y: number,
    stripW: number,
    slotH: number,
    direction: 'top' | 'bottom'
  ) {
    const rows = 1
    const cols = Math.max(1, Math.ceil(group.length / rows))
    const pitch = stripW / cols
    const slotW = Math.min(48, Math.max(24, pitch - 12))
    const rowGap = title === 'UI' ? 54 : 44
    const showTerminalIds = pitch >= 28
    const labelY = y + slotH / 2 + 6
    return (
      <g key={title}>
        <text x={x - 12} y={labelY} textAnchor="end" fontSize="16" fontWeight="900" fill="var(--c-text)">
          {title}
        </text>
        {group.map((channel, index) => {
          const point = pointById.get(channel.pointId)
          const signal = signalState(point)
          const row = Math.floor(index / cols)
          const col = index % cols
          const sx = x + col * pitch + (pitch - slotW) / 2
          const sy = direction === 'top' ? y + row * rowGap : y - row * rowGap
          const wireY = direction === 'top' ? sy + slotH + 11 : sy - 13
          const active = selectedPointId === channel.pointId
          return (
            <g
              key={channel.id}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              onClick={() => {
                setHoveredPointId(null)
                setSelectedPointId(channel.pointId)
              }}
              onMouseEnter={(event) => {
                setHoveredPointId(channel.pointId)
                setTooltipPos(pointTooltipPosition(event))
              }}
              onMouseMove={(event) => setTooltipPos(pointTooltipPosition(event))}
              onMouseLeave={() => setHoveredPointId(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  setHoveredPointId(null)
                  setSelectedPointId(channel.pointId)
                }
              }}
            >
              <rect
                x={sx}
                y={sy}
                width={slotW}
                height={slotH}
                rx={3}
                fill={active ? 'var(--c-bg)' : 'var(--c-surface-2)'}
                stroke={active ? 'var(--c-accent)' : 'var(--c-line-strong)'}
                strokeWidth={active ? '2' : '1'}
              />
              <circle cx={sx + slotW / 2} cy={sy + slotH / 2} r={7} fill="var(--c-bg)" stroke="var(--c-line-strong)" strokeWidth="1" />
              <circle cx={sx + slotW / 2} cy={sy + slotH / 2} r={4.8} fill={signalColor(signal)} />
              <text x={sx + slotW / 2} y={sy + slotH / 2 + 3} textAnchor="middle" fontSize="7" fontWeight="900" fill="var(--c-bg)">
                {signalGlyph(signal)}
              </text>
              <rect x={sx + 8} y={wireY} width={slotW - 16} height={5} rx={1} fill={signalColor(signal)} />
              {showTerminalIds && (
                <text
                  x={sx + slotW / 2}
                  y={direction === 'top' ? sy + slotH + 25 : sy - 20}
                  textAnchor="middle"
                  fontSize="7"
                  fontWeight="800"
                  fill="var(--c-text)"
                >
                  {channel.pointId.replace('-', '')}
                </text>
              )}
            </g>
          )
        })}
      </g>
    )
  }

  function renderLed(label: string, x: number, y: number, state: QualityState = 'good') {
    return (
      <g key={label}>
        <circle cx={x} cy={y} r={9} fill={qualityColor(state)} stroke="var(--c-line-strong)" strokeWidth="1.2" />
        <text x={x} y={y - 17} textAnchor="middle" fontSize="10" fill="var(--c-text-dim)">
          {label}
        </text>
      </g>
    )
  }

  function renderMetricDial(label: string, value: number | null, unit: string, x: number, y: number, warnAt: number, criticalAt: number, detail = '') {
    const radius = 23
    const circumference = 2 * Math.PI * radius
    const clamped = clampMetricValue(value)
    const state = metricState(value, warnAt, criticalAt)
    const color = metricColor(state)
    const textColor = metricTextColor(state)
    const statusLabel = state === 'critical'
      ? 'CRITICAL'
      : state === 'warning'
        ? pick('Warning', 'Warning')
        : state === 'offline'
          ? pick('No data', 'No data')
          : pick('Normal', 'Normal')
    return (
      <g key={label}>
        <text x={x} y={y - 34} textAnchor="middle" fontSize="9.5" fontWeight="800" fill="var(--c-text-dim)">
          {label}
        </text>
        <circle cx={x} cy={y} r={radius} fill="var(--c-surface)" stroke="var(--c-border)" strokeWidth="8" />
        <circle
          cx={x}
          cy={y}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${x} ${y})`}
        />
        <text x={x} y={y + 4} textAnchor="middle" fontSize={unit === '\u00B0C' ? '12' : '13'} fontWeight="900" fill={textColor}>
          {value === null ? 'N/A' : `${unit === '\u00B0C' ? value.toFixed(1) : Math.round(value)}${unit}`}
        </text>
        <text x={x} y={y + 40} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={textColor}>
          {statusLabel}
        </text>
        {detail && (
          <text x={x} y={y + 54} textAnchor="middle" fontSize="8.5" fill="var(--c-text-dim)">
            {detail}
          </text>
        )}
      </g>
    )
  }

  const networkControlClass = cn('transition-colors', onOpenNetwork && 'cursor-pointer hover:fill-[var(--c-surface-3)]')

  return (
    <>
      <div className={cn('overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]', className)}>
        <svg
          width="100%"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className={compact ? 'block w-full min-w-[720px] font-sans' : 'mx-auto block w-[92%] min-w-[860px] max-w-[1120px] font-sans'}
          role="img"
          aria-label={pick('MK-DDC-24 front-panel I/O diagram', 'MK-DDC-24 front-panel I/O diagram')}
        >
          <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="var(--c-bg)" />
          <text x={DEVICE_X} y={28} fontSize="16" fontWeight="800" fill="var(--c-text)">
            MK-DDC-24
          </text>
          <text x={DEVICE_X + 108} y={28} fontSize="10" fill="var(--c-text-dim)">
            {channels.length} I/O | {southbound.length} Modbus | {totalWarnings} WARN | {totalFaults} FAULT | {dataAgeLabel}
          </text>

          <rect x={DEVICE_X} y={DEVICE_Y} width={DEVICE_W} height={DEVICE_H} rx={8} fill="var(--c-surface)" stroke="var(--c-line-strong)" strokeWidth="2" />
          <rect x={DEVICE_X + 10} y={DEVICE_Y + 10} width={DEVICE_W - 20} height={DEVICE_H - 20} rx={4} fill="none" stroke="var(--c-border)" />
          <line x1={DEVICE_X} y1={BODY_Y} x2={DEVICE_X + DEVICE_W} y2={BODY_Y} stroke="var(--c-line-strong)" />
          <line x1={DEVICE_X} y1={BODY_Y + BODY_H} x2={DEVICE_X + DEVICE_W} y2={BODY_Y + BODY_H} stroke="var(--c-line-strong)" />

          {renderTerminalStrip('AO', ao, 96, 80, 330, 30, 'top')}
          {renderTerminalStrip('DO', doChannels, 680, 80, 420, 30, 'top')}
          {renderTerminalStrip('UI', ui, 96, 502, 1004, 34, 'bottom')}

          <rect x={454} y={286} width={82} height={48} rx={6} fill="var(--c-surface-2)" stroke="var(--c-line-strong)" strokeWidth="1.5" className={networkControlClass} onClick={onOpenNetwork} />
          <rect x={552} y={286} width={82} height={48} rx={6} fill="var(--c-surface-2)" stroke="var(--c-line-strong)" strokeWidth="1.5" className={networkControlClass} onClick={onOpenNetwork} />
          <text x={495} y={315} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--c-text-dim)" className="pointer-events-none">LAN1</text>
          <text x={593} y={315} textAnchor="middle" fontSize="13" fontWeight="800" fill="var(--c-text-dim)" className="pointer-events-none">LAN2</text>

          <g>
            {renderLed('Power', 84, 238)}
            {renderLed('LAN1', 162, 238)}
            {renderLed('LAN2', 240, 238)}
            {renderLed('RS485', 318, 238, rs485State === 'online' ? 'good' : rs485State === 'degraded' ? 'uncertain' : 'bad')}
            {renderLed('Status', 396, 238, totalFaults > 0 ? 'bad' : totalWarnings > 0 ? 'uncertain' : 'good')}
          </g>

          <text x={82} y={311} fontSize="48" fontWeight="900" fill="var(--c-text)">MK-DDC-24</text>
          <text x={84} y={344} fontSize="20" fill="var(--c-text-dim)">
            Direct Digital Controller
          </text>
          <text x={84} y={378} fontSize="13" fill="var(--c-text-dim)">
            Click a terminal to inspect point details
          </text>

          <rect x={650} y={192} width={420} height={230} rx={10} fill="var(--c-surface-2)" stroke="var(--c-line-strong)" strokeWidth="1.5" />
          <text x={674} y={228} fontSize="15" fontWeight="800" fill="var(--c-text)">
            I/O Summary
          </text>
          <text x={1046} y={227} textAnchor="end" fontSize="12" fontWeight="600" fill="var(--c-text-dim)">UI {ui.length} | AO {ao.length} | DO {doChannels.length}</text>
          {renderMetricDial('CPU', cpuValue, '%', 720, 314, 70, 90)}
          {renderMetricDial('Memory', ramValue, '%', 854, 314, 70, 90)}
          {renderMetricDial('Temp', tempValue, '\u00B0C', 988, 314, 45, 70)}
          <circle cx={676} cy={374} r={5} fill={qualityColor(totalFaults > 0 ? 'bad' : totalWarnings > 0 ? 'uncertain' : 'good')} />
          <text x={692} y={378} fontSize="11" fill="var(--c-text)">
            System {totalFaults > 0 ? 'FAULT' : totalWarnings > 0 ? 'WARN' : 'NORMAL'}
          </text>
          <circle cx={676} cy={393} r={5} fill={networkColor(network.northbound.bmsLink)} />
          <text x={692} y={397} fontSize="11" fill="var(--c-text)">BACnet {network.northbound.ip || 'DHCP'} | ID {network.northbound.bacnetDeviceId || 'N/A'}</text>
          <circle cx={676} cy={412} r={5} fill={networkColor(rs485State)} />
          <text x={692} y={416} fontSize="11" fill="var(--c-text)">
            {t('rs485')} / {t('modbus')} {southbound.length} dev | {degradedCount} deg | {offlineCount} offline
          </text>
          <text x={84} y={468} fontSize="10" fill="var(--c-text-dim)">
            I=ON/signal | O=OFF | !=no signal | ?=warning
          </text>
        </svg>
      </div>
      {hoveredPointId && !selectedPoint && (
        <div
          className="pointer-events-none fixed z-50 w-[240px] rounded-[var(--radius)] border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-3 py-2 text-xs text-[var(--c-text)] panel-shadow"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="flex items-center justify-between gap-2">
            <strong className="truncate text-[var(--c-text)]">{hoveredPointId}</strong>
            <span className="shrink-0 font-bold" style={{ color: signalColor(signalState(hoveredPoint)) }}>
              {signalText(signalState(hoveredPoint))}
            </span>
          </div>
          <div className="mt-1 truncate text-[var(--c-text-dim)]">{hoveredChannel?.label ?? hoveredPoint?.name ?? 'N/A'}</div>
          <div className="mt-2 grid grid-cols-[70px_1fr] gap-x-2 gap-y-1">
            <span className="text-[var(--c-text-dim)]">{pick('Value', 'Value')}</span>
            <span className="truncate font-semibold text-[var(--c-text)]">{formatPointValue(hoveredPoint)}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Signal', 'Signal')}</span>
            <span className="truncate text-[var(--c-text)]">{hoveredChannel?.signal ?? hoveredPoint?.sensorType ?? 'N/A'}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Quality', 'Quality')}</span>
            <span className="font-semibold" style={{ color: qualityColor(qualityState(hoveredPoint)) }}>
              {qualityText(qualityState(hoveredPoint))}
            </span>
          </div>
        </div>
      )}
      <Modal
        open={Boolean(selectedPoint)}
        title={selectedPoint ? `${selectedPoint.id} - ${selectedPoint.name}` : ''}
        cancelLabel={pick('Close', 'Close')}
        onClose={() => setSelectedPointId(null)}
      >
        {selectedPoint && (
          <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
            <span className="text-[var(--c-text-dim)]">{pick('Value', 'Value')}</span>
            <strong className="text-[var(--c-text)]">{formatPointValue(selectedPoint)}</strong>
            <span className="text-[var(--c-text-dim)]">{pick('Point kind', 'Point kind')}</span>
            <span className="text-[var(--c-text)]">{selectedPoint.kind}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Signal', 'Signal')}</span>
            <span className="text-[var(--c-text)]">{selectedChannel?.signal ?? selectedPoint.sensorType ?? 'N/A'}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Quality', 'Quality')}</span>
            <span className="font-semibold" style={{ color: qualityColor(qualityState(selectedPoint)) }}>
              {qualityText(qualityState(selectedPoint))}
            </span>
            <span className="text-[var(--c-text-dim)]">{pick('Signal state', 'Signal state')}</span>
            <span className="font-semibold" style={{ color: signalColor(signalState(selectedPoint)) }}>
              {signalText(signalState(selectedPoint))}
            </span>
            <span className="text-[var(--c-text-dim)]">{pick('Source', 'Source')}</span>
            <span className="text-[var(--c-text)]">{selectedPoint.source}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Priority', 'Priority')}</span>
            <span className="text-[var(--c-text)]">{selectedPoint.priority ?? 'Auto'}</span>
            <span className="text-[var(--c-text-dim)]">{pick('Updated', 'Updated')}</span>
            <span className="mono text-[var(--c-text)]">{new Date(selectedPoint.updatedAt).toLocaleString('vi-VN')}</span>
          </div>
        )}
      </Modal>
    </>
  )
}
