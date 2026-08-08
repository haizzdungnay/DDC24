import { Activity, Clock3, Cpu, Database, MemoryStick, Network, Router, Thermometer } from 'lucide-react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { ControllerDiagram } from '../../shared/components/ControllerDiagram'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { HealthChip, healthReasonLabel } from '../../shared/components/pa3/StateAtoms'
import { DEVICE_DEFAULTS } from '../../shared/config'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { useOverview } from '../../shared/overview/OverviewProvider'
import { useRealtime } from '../../shared/realtime'
import type { HealthResponse, Point } from '../../shared/types'
import { NO_DATA, formatDataAge, formatDateTime, formatUptime, isFreshIso, mergePointsById, metricStatusColor } from '../../shared/utils'

const REALTIME_STALE_MS = 2500
const emptyPoints: Point[] = []

/**
 * Diagnostics — PA3-206.
 *
 * Đây là NƠI ĐẾN của mọi thứ bị loại khỏi Landing theo UX-DES §4.2: CPU, RAM,
 * nhiệt độ, uptime, danh sách service, sơ đồ controller, số đo IOP/scan.
 *
 * Chúng không bị xoá — người làm commissioning vẫn cần — mà bị chuyển đúng
 * tầng. Landing trả lời "hệ thống có ổn không"; trang này trả lời "vì sao".
 *
 * Vai trò: `viewer` đọc được. Chẩn đoán là quan sát, không phải mutation.
 *
 * Nguyên tắc hiển thị: metric không có nguồn thật ⇒ `—`. Bản Dashboard cũ từng
 * có `?? 23` cho CPU và `?? 48` cho RAM; một thiết bị mất liên lạc vẫn vẽ đồng
 * hồ xanh 23%.
 */
export function DiagnosticsPage() {
  const navigate = useNavigate()
  const { pick } = useI18n()
  const { data: overview, status } = useOverview()
  const health = useApi(apiClient.getHealth, [], { refreshMs: 5000 })
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })
  const networkState = useApi(apiClient.getNetwork, [], { refreshMs: 10000 })
  const realtime = useRealtime()

  const polledPoints = pointsState.data ?? emptyPoints
  const points = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polledPoints, realtime.allPoints)
    : polledPoints
  const h = health.data ?? undefined
  const services = Object.entries(h?.services ?? {})
  const iop = h?.services.IOP ?? h?.services.iobus

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold leading-tight">{pick('Chẩn đoán', 'Diagnostics')}</h1>
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick(
            'Số đo hệ thống, dịch vụ và hạ tầng. Metric không có nguồn thật hiện dấu — thay vì một con số đoán.',
            'System, service and infrastructure metrics. Metrics without a real source show a dash instead of a guess.'
          )}
        </p>
      </header>

      {health.error && !h && (
        <StateBlock
          state="error"
          title={pick('Không đọc được trạng thái hệ thống', 'System status unavailable')}
          detail={health.error.message}
          onRetry={health.refetch}
        />
      )}

      <Panel title={pick('SỨC KHOẺ THEO PHÂN HỆ', 'SUBSYSTEM HEALTH')} className="p-3">
        {status === 'ready' && overview ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {overview.health.map((domain) => (
              <div key={domain.domain} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{domain.domain}</span>
                  <HealthChip state={domain.state} />
                </div>
                <div className="mt-2 text-xs text-[var(--c-text-dim)]">{healthReasonLabel(domain.reasonCode)}</div>
                {domain.detail && <div className="mt-1 text-xs text-[var(--c-text)]">{domain.detail}</div>}
                <div className="mono mt-2 text-[11px] text-[var(--c-text-dim)]">
                  {pick('Nguồn', 'Source')}: {domain.source} · {formatDataAge(domain.observedAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <StateBlock state="loading" title={pick('Đang đọc sức khoẻ phân hệ', 'Loading subsystem health')} />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Cpu} label="CPU" value={percentOrDash(h?.cpuPercent)} detail={clockDetail(h?.cpuClockMhz)} color={metricColor(h?.cpuPercent, 70, 90)} />
        <MetricCard icon={MemoryStick} label={pick('BỘ NHỚ', 'MEMORY')} value={percentOrDash(h?.ramPercent)} detail={ramDetail(h)} color={metricColor(h?.ramPercent, 70, 90)} />
        <MetricCard icon={Thermometer} label={pick('NHIỆT ĐỘ', 'TEMPERATURE')} value={typeof h?.tempC === 'number' ? `${h.tempC.toFixed(1)}°C` : NO_DATA} detail="" color={metricColor(h?.tempC, 60, 75)} />
        <MetricCard icon={Clock3} label="UPTIME" value={typeof h?.uptimeS === 'number' ? formatUptime(h.uptimeS) : NO_DATA} detail="" color="var(--c-text)" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title={pick('DỊCH VỤ', 'SERVICES')} className="p-3">
          {services.length === 0 ? (
            <StateBlock state="empty" title={pick('Không có dịch vụ nào được báo cáo', 'No services reported')} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
              {services.map(([name, service]) => (
                <div key={name} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{name}</div>
                    <StatusBadge state={service.status} />
                  </div>
                  <div className="mono mt-2 text-xs text-[var(--c-text-dim)]">
                    uptime {typeof service.uptime_s === 'number' && service.uptime_s > 0 ? formatUptime(service.uptime_s) : NO_DATA}
                  </div>
                  <div className="mono mt-1 text-xs" style={{ color: typeof service.last_scan_ms === 'number' && service.last_scan_ms > 0 ? metricStatusColor(service.last_scan_ms, 50, 100) : 'var(--c-text-dim)' }}>
                    scan {typeof service.last_scan_ms === 'number' && service.last_scan_ms > 0 ? `${service.last_scan_ms} ms` : NO_DATA}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={pick('IOP / SCAN', 'IOP / SCAN')} className="self-start p-3">
          <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">
            <dt className="text-[var(--c-text-dim)]">Overall</dt>
            <dd className="font-semibold">{h?.overall ?? NO_DATA}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Độ trễ IOP', 'IOP latency')}</dt>
            <dd className="mono">{typeof iop?.last_scan_ms === 'number' && iop.last_scan_ms > 0 ? `${iop.last_scan_ms} ms` : NO_DATA}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái WebSocket', 'WebSocket state')}</dt>
            <dd className="mono">{realtime.connectionState}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Sự kiện point gần nhất', 'Last point event')}</dt>
            <dd className="mono">{formatDataAge(realtime.lastPointEventAt)}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title={pick('TRẠNG THÁI TRUYỀN THÔNG', 'COMMUNICATION STATUS')} className="p-3">
        {/* PA3-F02: không còn ô `RS485-2`. Rev A KHÔNG có cổng RS-485 thứ hai;
            vẽ nó ra rồi ghi `unknown` khiến người đi hiện trường đi tìm một
            cổng không tồn tại. Số bus lấy từ `capabilities.modbusRtuBuses`. */}
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-5">
          <CommTile icon={Network} title="Ethernet / IPv4" value={overview?.controller.ip} ok={Boolean(overview?.controller.ip)} />
          {Array.from({ length: overview?.capabilities.modbusRtuBuses ?? 0 }, (_, index) => (
            <CommTile
              key={`bus-${index + 1}`}
              icon={Router}
              title={`RS-485 / Bus ${index + 1}`}
              value={modbusStateLabel(overview?.health.find((item) => item.domain === 'modbus')?.state)}
              ok={overview?.health.find((item) => item.domain === 'modbus')?.state === 'good'}
            />
          ))}
          <CommTile
            icon={Database}
            title="BACnet/IP"
            value={overview?.capabilities.bacnetIpEnabled ? pick('Đang bật', 'Enabled') : pick('Tắt (feature-gated)', 'Disabled (feature-gated)')}
            ok={Boolean(overview?.capabilities.bacnetIpEnabled)}
          />
        </div>
      </Panel>

      <Panel
        title={pick('SƠ ĐỒ BỘ ĐIỀU KHIỂN', 'CONTROLLER DIAGRAM')}
        className="p-3"
        action={<Button size="sm" variant="secondary" onClick={() => navigate('/eng/diagram')}>{pick('Mở rộng', 'Expand')}</Button>}
      >
        <ControllerDiagram
          points={points}
          health={h}
          network={networkState.data ?? undefined}
          dataAgeLabel={formatDataAge(realtime.lastPointEventAt)}
          compact
          onOpenNetwork={() => navigate('/settings/network')}
        />
      </Panel>

      <Panel title={pick('ĐỊNH DANH THIẾT BỊ', 'DEVICE IDENTITY')} className="p-3">
        <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--c-text-dim)]">{pick('Tên thiết bị', 'Device name')}</dt><dd>{orDash(overview?.controller.deviceName ?? h?.deviceName)}</dd>
          <dt className="text-[var(--c-text-dim)]">Model</dt><dd>{DEVICE_DEFAULTS.model}</dd>
          <dt className="text-[var(--c-text-dim)]">Firmware</dt><dd>{orDash(overview?.controller.firmware ?? h?.firmware)}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Phiên bản Web', 'Web version')}</dt><dd className="mono">{orDash(overview?.controller.webVersion)}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Địa chỉ IP', 'IP address')}</dt><dd className="mono">{orDash(overview?.controller.ip ?? h?.deviceIp)}</dd>
          <dt className="text-[var(--c-text-dim)]">MAC</dt><dd className="mono">{orDash(overview?.controller.mac ?? h?.deviceMac)}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Vị trí lắp đặt', 'Location')}</dt><dd>{orDash(overview?.controller.location ?? h?.location)}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Thời gian hệ thống', 'System time')}</dt><dd className="mono">{formatDateTime(overview?.controller.systemTime ?? h?.systemTime)}</dd>
        </dl>
      </Panel>
    </div>
  )
}

function modbusStateLabel(state: string | undefined): string {
  if (!state) return NO_DATA
  return state.toUpperCase()
}

function MetricCard({ icon: Icon, label, value, detail, color }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string; detail: string; color: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[var(--c-text-dim)]">
        <span>{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="mono mt-3 text-2xl font-bold" style={{ color }}>{value}</div>
      {detail && <div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{detail}</div>}
    </div>
  )
}

function CommTile({ icon: Icon, title, value, ok }: { icon: React.ComponentType<{ className?: string }>; title: string; value?: string; ok: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-[var(--c-accent-2)]" aria-hidden="true" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="mono mt-0.5 truncate text-xs text-[var(--c-text-dim)]">{value || NO_DATA}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs font-semibold" style={{ color: ok ? 'var(--c-good-fg)' : 'var(--c-text-dim)' }}>
        <Activity className="h-3.5 w-3.5" aria-hidden="true" />
        {ok ? 'OK' : 'N/A'}
      </div>
    </div>
  )
}

function percentOrDash(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(1))}%` : NO_DATA
}

function clockDetail(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  return value >= 1000 ? `${Number((value / 1000).toFixed(2))} GHz` : `${Math.round(value)} MHz`
}

function ramDetail(health: HealthResponse | undefined): string {
  if (typeof health?.ramUsedMb === 'number' && typeof health?.ramTotalMb === 'number' && health.ramTotalMb > 0) {
    return `${Math.round(health.ramUsedMb)} MB / ${Math.round(health.ramTotalMb)} MB`
  }
  return ''
}

function metricColor(value: number | undefined, warnAt: number, faultAt: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'var(--c-text-dim)'
  return metricStatusColor(value, warnAt, faultAt)
}

function orDash(value: string | undefined | null): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? NO_DATA : text
}
