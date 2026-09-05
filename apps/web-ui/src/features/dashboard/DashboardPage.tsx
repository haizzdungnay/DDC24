import { ArrowRight, ChevronRight, Download, ListFilter, Maximize2, Pin, PinOff, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { apiClient } from '../../shared/api/client'
import { fetchActivity } from '../../shared/api/overview'
import { Button } from '../../shared/components/Button'
import { buildSnapshot, downloadJson, snapshotFilename } from '../../shared/diagnosticsExport'
import { Modal } from '../../shared/components/Modal'
import { OverrideRemaining } from '../../shared/components/OverrideRemaining'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { TrendChart, type TrendSeries } from '../../shared/components/TrendChart'
import {
  ForcedBadge,
  HEALTH_DOMAIN_LABELS,
  HealthChip,
  QualityBadge,
  SeverityBadge,
} from '../../shared/components/pa3/StateAtoms'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { resolveDrilldown, safeInternalLink } from '../../shared/overview/drilldown'
import {
  collectOverrideOwners,
  isOverrideExpiringSoon,
  summarizeOverrides,
  type OverrideOwner
} from '../../shared/overview/overrides'
import { useOverview } from '../../shared/overview/OverviewProvider'
import { useRealtime } from '../../shared/realtime'
import type { ActivityEvent, OverviewAttentionItem, OverviewDomainHealth, OverviewResponse, Point, TrendSample } from '../../shared/types'
import {
  attentionDetailText,
  attentionTitleText,
  healthDetailIsIdentifier,
  healthDetailText,
  healthReasonText,
} from './overviewCopy'
import {
  NO_DATA,
  cn,
  formatCountdown,
  formatDataAge,
  formatDateTime,
  formatValue,
  isChannelNotConfigured,
  isFreshIso,
  mergePointsById,
  pointDisplayTag,
  pointNumber
} from '../../shared/utils'

const REALTIME_STALE_MS = 2500
const MAX_LANDING_TREND_SERIES = 4
const TREND_SAMPLE_LIMIT = 60
const trendColors = ['var(--c-accent)', 'var(--c-good-fg)', 'var(--c-warn-fg)', 'var(--c-accent-2)']
const emptyPoints: Point[] = []

/**
 * Landing PA3 — Adaptive Hybrid Control Workspace.
 *
 * THỨ TỰ ƯU TIÊN (UX-DES §4.1) quyết định thứ tự khối trên trang:
 *
 *   1. Overall state         → dải trạng thái đầu trang
 *   2. Critical/High alarm   → Attention, nằm trên nếp gấp ở 1440×900
 *   3. Mất liên lạc/suy giảm → Health Strip
 *   4. Suy giảm chất lượng   → Operating Summary
 *   5. Ghim của người dùng   → My Workspace
 *   6. Bối cảnh xu hướng     → Trend preview
 *   7. Hoạt động gần đây     → Activity
 *
 * KHÔNG có trên trang này (UX-DES §4.2, finding PA3-F01): CPU, RAM, nhiệt độ,
 * uptime, danh sách service, sơ đồ controller. Tất cả đã chuyển sang
 * `DiagnosticsPage`. Bản trước dùng nửa trên của Landing cho sáu đồng hồ đo máy
 * chủ, trong khi câu hỏi đầu tiên của ca trực — "có gì cần xử lý không" —
 * không có chỗ nào trả lời.
 */
export function DashboardPage() {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const { data: overview, status, error, receivedAt, refresh } = useOverview()

  if (status === 'incompatible') {
    return (
      <StateBlock
        state="error"
        title={pick('Giao diện và thiết bị lệch phiên bản dữ liệu', 'UI and device data versions do not match')}
        detail={pick(
          `${error?.message ?? ''} Không hiển thị tổng quan bằng dữ liệu đoán. Hãy nạp lại trang sau khi cập nhật gói web.`,
          `${error?.message ?? ''} The overview is not rendered from guessed data. Reload after updating the web bundle.`
        )}
        onRetry={refresh}
      />
    )
  }

  if (status === 'loading' && !overview) {
    return <StateBlock state="loading" title={pick('Đang tải tổng quan hệ thống', 'Loading system overview')} />
  }

  if (!overview) {
    return (
      <StateBlock
        state="error"
        title={pick('Không đọc được tổng quan hệ thống', 'System overview unavailable')}
        detail={error?.message}
        onRetry={refresh}
      />
    )
  }

  return (
    <div className="space-y-4">
      <OverviewHeader overview={overview} receivedAt={receivedAt} degradedFetch={status === 'error'} onRefresh={refresh} />
      <HealthStrip health={overview.health} onOpen={(link) => navigate(link)} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <AttentionPanel items={overview.attention} alarms={overview.alarms} />
        <OperatingSummary overview={overview} />
      </div>
      {/* T57-1.2 — khối này đứng NGAY DƯỚI "CẦN XỬ LÝ" và TRÊN "KHÔNG GIAN CỦA
          TÔI". Thứ tự ưu tiên của Landing (UX-DES §4.1) xếp "mất liên lạc/suy
          giảm" trên "ghim của người dùng"; một lệnh tay đang giữ đầu ra là
          thông tin cùng hạng an toàn với hai mục đó, và cao hơn hẳn không gian
          cá nhân. Đặc tả: `KX-DDC24-UX-WEB-OPERATIONS-001` §1. */}
      <OverrideOwnershipPanel />
      <MyWorkspace overview={overview} />
      <TrendPreview />
      <ActivityPanel />
    </div>
  )
}

/* ── 1. Overall state ───────────────────────────────────────────────────── */

function OverviewHeader({ overview, receivedAt, degradedFetch, onRefresh }: {
  overview: OverviewResponse
  receivedAt: number | null
  degradedFetch: boolean
  onRefresh: () => void
}) {
  const { pick } = useI18n()
  const [, setTick] = useState(0)
  // Tuổi dữ liệu phải TRÔI theo thời gian thật. Nếu chỉ render lại khi có
  // snapshot mới, mất mạng sẽ đóng băng chữ "1s" mãi mãi.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const severities = [
    { key: 'critical' as const, count: overview.alarms.critical },
    { key: 'high' as const, count: overview.alarms.high },
    { key: 'medium' as const, count: overview.alarms.medium }
  ]

  return (
    <header className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold leading-none">{overview.controller.deviceName || 'MK-DDC-24'}</h1>
            <HealthChip state={overview.overallState} />
            {overview.controller.location && (
              <span className="text-sm text-[var(--c-text-dim)]">{overview.controller.location}</span>
            )}
          </div>
          <p className="mt-2 text-sm text-[var(--c-text-dim)]">
            {/* `ISS-PGUI-02` — mã lạ ra câu trung tính KÈM mã, không in mã trần
                 và cũng không im lặng. */}
            {healthReasonText(overview.overallReasonCode, pick)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {severities.map((item) => <SeverityBadge key={item.key} severity={item.key} count={item.count} />)}
          <Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
            {pick('Làm mới', 'Refresh')}
          </Button>
          {/* `T57-2.21` — đính vào phiếu sự cố mà không phải chụp năm màn hình.
              Ảnh chụp mất khả năng tìm kiếm, mất số chính xác, và không mang
              theo phiên bản phần mềm hay mốc thời gian. */}
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadJson(snapshotFilename('status-snapshot'), buildSnapshot('status-snapshot', overview.controller.webVersion ?? '', { overview }))}
          >
            {pick('Xuất ảnh chụp', 'Export snapshot')}
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div className="flex gap-2">
          <dt className="text-[var(--c-text-dim)]">{pick('Kết nối', 'Connectivity')}</dt>
          <dd className="font-semibold" style={{ color: overview.connected ? 'var(--c-good-fg)' : 'var(--c-fault-fg)' }}>
            {overview.connected ? pick('Trực tuyến', 'Online') : pick('Mất liên lạc', 'Offline')}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--c-text-dim)]">{pick('Dữ liệu mới nhất', 'Last data')}</dt>
          {/* PA3-F04: `lastDataAt = null` nghĩa là KHÔNG point nào có mốc thời
              gian thật. Hiện `—`, tuyệt đối không thay bằng giờ hiện tại. */}
          <dd className="mono font-semibold">{formatDataAge(overview.lastDataAt)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--c-text-dim)]">{pick('Ảnh chụp', 'Snapshot')}</dt>
          <dd className="mono">{receivedAt ? formatDataAge(new Date(receivedAt).toISOString()) : NO_DATA}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--c-text-dim)]">{pick('Cảnh báo chưa xác nhận', 'Unacked alarms')}</dt>
          <dd className="mono font-semibold">{overview.alarms.unacked}</dd>
        </div>
        {/* T57-1.11 (§6.1-P2b) — "tuổi dữ liệu tệ nhất trong các phân hệ".
            Overall `good` vẫn có thể che một phân hệ có `observedAt` 40 phút
            trước, và hiện người trực phải tự đọc 5 ô của Health Strip rồi so
            bằng mắt. Ô này làm phép so đó một lần, ở chỗ dễ thấy nhất. */}
        <StalestSubsystem health={overview.health} />
      </dl>

      {degradedFetch && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          {pick(
            'Không lấy được ảnh chụp mới nhất. Các số bên dưới là lần đọc gần nhất, không phải trạng thái hiện tại.',
            'The latest snapshot could not be fetched. The values below are the last successful read, not the current state.'
          )}
        </p>
      )}

      {overview.degraded.length > 0 && (
        <p className="mt-2 text-xs text-[var(--c-warn-fg)]">
          {pick('Nguồn dữ liệu suy giảm', 'Degraded data sources')}: {overview.degraded.join(', ')}
        </p>
      )}
    </header>
  )
}

/**
 * Phân hệ có dữ liệu CŨ NHẤT — `T57-1.11`, đề xuất §6.1-P2b.
 *
 * Trả về phân hệ có `observedAt` xa hiện tại nhất, hoặc `null` khi **không**
 * phân hệ nào có mốc thời gian dùng được.
 *
 * Vì sao tách thành hàm thuần và xuất ra: nó là thứ duy nhất trong ô này có thể
 * sai theo cách im lặng, nên nó phải test được mà không phải dựng cả trang.
 */
export function stalestSubsystem(
  health: OverviewDomainHealth[],
  now = Date.now()
): { domain: string; observedAt: string; ageMs: number } | null {
  let worst: { domain: string; observedAt: string; ageMs: number } | null = null
  for (const item of health) {
    if (!item.observedAt) continue
    const time = Date.parse(item.observedAt)
    if (!Number.isFinite(time)) continue
    /* Mốc trong TƯƠNG LAI (lệch đồng hồ giữa bo và máy trạm) cho ra tuổi âm.
       Kẹp về 0 thay vì để số âm thắng phép so `>` — một phân hệ "âm 3 giây"
       không phải phân hệ cũ nhất, nó là phân hệ có đồng hồ lệch. */
    const ageMs = Math.max(0, now - time)
    if (worst === null || ageMs > worst.ageMs) worst = { domain: item.domain, observedAt: item.observedAt, ageMs }
  }
  return worst
}

function StalestSubsystem({ health }: { health: OverviewDomainHealth[] }) {
  const { lang, pick } = useI18n()
  const worst = stalestSubsystem(health)
  if (!worst) {
    /* Không phân hệ nào cấp mốc thời gian ⇒ nói ra là KHÔNG BIẾT. Ẩn hẳn ô này
       sẽ khiến người đọc tưởng mọi phân hệ đều tươi. */
    return (
      <div className="flex gap-2">
        <dt className="text-[var(--c-text-dim)]">{pick('Phân hệ cũ nhất', 'Stalest subsystem')}</dt>
        <dd className="mono">{NO_DATA}</dd>
      </div>
    )
  }
  const label = HEALTH_DOMAIN_LABELS[worst.domain]
  const title = label ? (lang === 'vi' ? label.vi : label.en) : worst.domain
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--c-text-dim)]">{pick('Phân hệ cũ nhất', 'Stalest subsystem')}</dt>
      <dd className="mono font-semibold">{title} · {formatDataAge(worst.observedAt)}</dd>
    </div>
  )
}

/* ── 2. Health strip ────────────────────────────────────────────────────── */

function HealthStrip({ health, onOpen }: { health: OverviewDomainHealth[]; onOpen: (link: string) => void }) {
  const { lang, pick } = useI18n()
  if (health.length === 0) {
    return <StateBlock state="empty" title={pick('Không có phân hệ nào báo cáo sức khoẻ', 'No subsystem reported health')} />
  }
  return (
    <section aria-label={pick('Sức khoẻ phân hệ', 'Subsystem health')} className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {health.map((domain) => {
        const label = HEALTH_DOMAIN_LABELS[domain.domain]
        const link = safeInternalLink(domain.link) ?? resolveDrilldown('subsystem', domain.domain)
        const title = label ? (lang === 'vi' ? label.vi : label.en) : domain.domain
        const content = (
          <>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold">{title}</span>
              {link && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />}
            </div>
            <div className="mt-2"><HealthChip state={domain.state} /></div>
            {/* `ISS-PGUI-02` — câu dựng ở CLIENT từ `reasonCode` + `detailCount`.
                 Bản trước là `domain.detail || nhãn`, nên một chuỗi tiếng Việt do
                 máy chủ nối sẵn luôn THẮNG chính cái nhãn đã dịch ngay bên cạnh —
                 đó là toàn bộ cơ chế của `pm-014`. `detail` nay chỉ in nguyên văn
                 khi nó là một GIÁ TRỊ (địa chỉ IPv4 của ô `network`). */}
            <div className="mt-2 text-xs text-[var(--c-text-dim)]">
              {healthDetailIsIdentifier(domain) ? (domain.detail || '—') : healthDetailText(domain, pick)}
            </div>
            {/* §5.1: mỗi ô phải nói ra nguồn và tuổi dữ liệu của chính nó. */}
            <div className="mono mt-1 text-[11px] text-[var(--c-text-dim)]">{domain.source} · {formatDataAge(domain.observedAt)}</div>
          </>
        )
        const className = 'rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-left'
        return link ? (
          <button key={domain.domain} type="button" className={`${className} transition hover:border-[var(--c-accent)]`} onClick={() => onOpen(link)}>
            {content}
          </button>
        ) : (
          <div key={domain.domain} className={className}>{content}</div>
        )
      })}
    </section>
  )
}

/* ── 3. Attention ───────────────────────────────────────────────────────── */

function AttentionPanel({ items, alarms }: { items: OverviewAttentionItem[]; alarms: OverviewResponse['alarms'] }) {
  const { pick } = useI18n()
  return (
    <Panel
      title={pick('CẦN XỬ LÝ', 'ATTENTION')}
      className="p-3"
      action={<Link to="/alarms" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--c-accent)]">{pick('Tất cả cảnh báo', 'All alarms')} <ArrowRight className="h-4 w-4" /></Link>}
    >
      {items.length === 0 ? (
        <StateBlock
          state="empty"
          title={pick('Không có mục nào cần xử lý', 'Nothing needs attention')}
          detail={pick(
            `Không có cảnh báo Critical/High/Medium, không có điểm bad/stale/offline và không có lệnh ép tay đang chạy. Tổng cảnh báo đang hoạt động: ${alarms.total}.`,
            `No critical/high/medium alarms, no bad/stale/offline points and no active manual overrides. Total active alarms: ${alarms.total}.`
          )}
        />
      ) : (
        <ul className="divide-y divide-[var(--c-border)]">
          {items.map((item) => <AttentionRow key={item.id} item={item} />)}
        </ul>
      )}
    </Panel>
  )
}

function AttentionRow({ item }: { item: OverviewAttentionItem }) {
  const { pick } = useI18n()
  const link = resolveDrilldown(item.targetType, item.targetId)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        <SeverityBadge severity={item.severity} />
        <div className="min-w-0">
          {/* `ISS-PGUI-02` — `title`/`detail` của máy chủ là DIAGNOSTIC FALLBACK.
               Có `titleCode`/`detailCode` thì câu dựng ở đây theo locale; không có
               mã thì đó là văn bản ĐỤC của authority thượng nguồn (thông điệp alarm
               của Core) và được in nguyên văn. */}
          <div className="truncate text-sm font-semibold">{attentionTitleText(item, pick)}</div>
          <div className="mt-0.5 text-xs text-[var(--c-text-dim)]">
            {[attentionDetailText(item, pick), item.observedAt ? formatDateTime(item.observedAt) : null].filter(Boolean).join(' · ') || NO_DATA}
          </div>
        </div>
      </div>
      {/* PA3-D06: đường đi do resolver của FE dựng từ (targetType, targetId).
          Không nhận URL tuỳ ý từ payload. Loại không nhận ra thì không bấm được. */}
      {link ? (
        <Link
          to={link}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[var(--radius)] border border-[var(--c-border)] px-3 text-xs font-semibold text-[var(--c-accent)] hover:border-[var(--c-accent)]"
        >
          {pick('Xem chi tiết', 'Investigate')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="shrink-0 text-xs text-[var(--c-text-dim)]">{pick('Không có trang chi tiết', 'No detail page')}</span>
      )}
    </li>
  )
}

/* ── 4. Operating summary ───────────────────────────────────────────────── */

const kindLabels: Record<string, string> = {
  UI: 'UI',
  AO: 'AO',
  DO: 'DO',
  virtual: 'Virtual',
  modbus_rtu: 'Modbus'
}

function OperatingSummary({ overview }: { overview: OverviewResponse }) {
  const { pick } = useI18n()
  const { points } = overview
  return (
    <Panel
      title={pick('TỔNG HỢP ĐIỂM', 'OPERATING SUMMARY')}
      className="p-3"
      action={<Link to="/monitor" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--c-accent)]">Monitor <ArrowRight className="h-4 w-4" /></Link>}
    >
      {points.total === 0 ? (
        <StateBlock
          state="empty"
          title={pick('Authority không trả điểm nào', 'The authority reported no points')}
          detail={pick('Kiểm tra dịch vụ core/iobus trước khi tin vào các số 0.', 'Check the core/iobus services before trusting any zero.')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-left text-[10px] uppercase text-[var(--c-text-dim)]">
                <th className="py-2 pr-2 font-semibold">{pick('Loại', 'Type')}</th>
                <th className="py-2 pr-2 text-right font-semibold">Good</th>
                <th className="py-2 pr-2 text-right font-semibold">Uncertain</th>
                <th className="py-2 pr-2 text-right font-semibold">Bad</th>
                <th className="py-2 pr-2 text-right font-semibold">Stale</th>
                <th className="py-2 pr-2 text-right font-semibold">Offline</th>
                <th className="py-2 text-right font-semibold">{pick('Tổng', 'Total')}</th>
              </tr>
            </thead>
            <tbody>
              {/* §7: KHÔNG có hàng DI. Base SKU Rev A không có DI công nghiệp
                  riêng, và backend chỉ phát nhóm nào thật sự có điểm. */}
              {points.groups.map((group) => (
                <tr key={group.kind} className="border-b border-[var(--c-border)] last:border-0">
                  <td className="py-2 pr-2 font-semibold">
                    <Link to={`/monitor?kind=${encodeURIComponent(group.kind)}`} className="text-[var(--c-accent)]">
                      {kindLabels[group.kind] ?? group.kind}
                    </Link>
                  </td>
                  <NumberCell value={group.good} />
                  <NumberCell value={group.uncertain} warn={group.uncertain > 0} />
                  <NumberCell value={group.bad} danger={group.bad > 0} />
                  <NumberCell value={group.stale} warn={group.stale > 0} />
                  <NumberCell value={group.offline} danger={group.offline > 0} />
                  <td className="py-2 text-right font-semibold">{group.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {points.forced > 0 && (
            <p className="mt-3 text-xs text-[var(--c-force)]">
              {pick(`${points.forced} điểm đang bị ép tay`, `${points.forced} points are under manual override`)}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

function NumberCell({ value, warn, danger }: { value: number; warn?: boolean; danger?: boolean }) {
  const color = danger && value > 0 ? 'var(--c-fault-fg)' : warn && value > 0 ? 'var(--c-warn-fg)' : 'var(--c-text)'
  return <td className="mono py-2 pr-2 text-right" style={{ color }}>{value}</td>
}

/* ── 4.5. Ai đang giữ quyền điều khiển ──────────────────────────────────── */

/**
 * Khối "AI ĐANG GIỮ QUYỀN ĐIỀU KHIỂN" — `T57-1.2`, đề xuất §6.1-P1a.
 *
 * TRIỆU CHỨNG: `points.forced` hôm nay chỉ là MỘT CON SỐ trong khối TỔNG HỢP
 * ĐIỂM. Câu hỏi bắt buộc khi bàn giao ca — "còn lệnh tay nào chưa nhả không,
 * của ai, còn bao lâu" — không có chỗ nào trả lời.
 *
 * NGUYÊN NHÂN GỐC: dữ liệu đã có đủ trên wire (`forced`, `overrideExpiresInS`,
 * và Activity có vết `point_force`), nhưng chưa nơi nào ghép ba nguồn đó lại.
 * Người trực phải vào Monitor, lọc `state=forced`, rồi bấm từng điểm để đọc TTL
 * trong khung chi tiết — ba thao tác cho một câu hỏi hỏi mỗi ngày hai lần.
 *
 * CÁCH SỬA: một khối đọc-thuần dựng từ `collectOverrideOwners`, đặt trên nếp
 * gấp ưu tiên. Đặc tả trực quan: `docs/04_uiux/KX-DDC24-UX-WEB-OPERATIONS-001_VI.md` §1.
 *
 * QUYỀN: khối chỉ ĐỌC. `GET /points` và `GET /activity` đều là `RoleViewer` ở
 * backend, nên nó hiện cho mọi vai trò và `ROUTE_MIN_ROLE` của Landing KHÔNG
 * đổi. Ca trực chỉ-đọc phải nhìn thấy ai đang giữ quyền — đó chính là câu hỏi
 * bàn giao ca, và giấu nó đi không làm hệ thống an toàn hơn.
 */
function OverrideOwnershipPanel() {
  const { pick } = useI18n()
  const realtime = useRealtime()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })
  /* Lấy nhật ký NGƯỜI DÙNG để tìm ai ra lệnh. `limit` kịch trần trang của
     backend (`activityMaxPage = 200`) vì một lệnh ép tay cũ hơn 200 sự kiện sẽ
     không tìm thấy actor — và khi đó cột "Người ra lệnh" hiện `—` kèm lý do,
     không bịa ra "hệ thống". */
  const activityState = useApi(useCallback(() => fetchActivity({ limit: 200, kind: 'user' }), []), [], { refreshMs: 10000 })

  const polled = pointsState.data ?? emptyPoints
  const points = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polled, realtime.allPoints)
    : polled
  const owners = useMemo(
    () => collectOverrideOwners(points, activityState.data?.items ?? []),
    [points, activityState.data]
  )
  const summary = useMemo(() => summarizeOverrides(owners), [owners])

  /* Chưa đọc được bảng điểm LẦN NÀO ⇒ không kết luận được là có hay không có
     lệnh ép tay. Đây KHÔNG phải "không có lệnh nào": trình bày "không đọc được"
     thành "mọi thứ bình thường" trên màn hình bàn giao ca là lỗi an toàn vận
     hành, cùng họ với `FE-DATA-01`. */
  const cannotConclude = pointsState.data === null

  return (
    <Panel
      title={pick('AI ĐANG GIỮ QUYỀN ĐIỀU KHIỂN', 'WHO HOLDS CONTROL')}
      className="p-3"
      action={
        <Link to="/activity" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--c-accent)]">
          {pick('Mở nhật ký hoạt động', 'Open activity log')} <ArrowRight className="h-4 w-4" />
        </Link>
      }
    >
      {cannotConclude ? (
        <StateBlock
          state={pointsState.error ? 'error' : 'loading'}
          title={pointsState.error
            ? pick('Không đọc được bảng điểm', 'Could not read the point table')
            : pick('Đang đọc bảng điểm', 'Reading the point table')}
          detail={pointsState.error
            ? pick(
              `Không kết luận được là có hay không có lệnh ép tay. ${pointsState.error.message}`,
              `Cannot conclude whether any manual override is active. ${pointsState.error.message}`
            )
            : undefined}
          onRetry={pointsState.error ? pointsState.refetch : undefined}
        />
      ) : owners.length === 0 ? (
        <StateBlock
          state="empty"
          title={pick('Không có lệnh tay nào đang giữ quyền', 'No manual override holds control')}
          detail={pick(
            `Mọi đầu ra đang do logic điều khiển và lịch vận hành quyết định. Đã đọc được ${points.length} điểm — đây là kết luận từ dữ liệu đủ, không phải màn hình trống vì không đọc được gì.`,
            `Every output is driven by control logic and schedules. ${points.length} points were read — this is a conclusion from complete data, not an empty screen caused by a failed read.`
          )}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] border-2 border-[var(--c-force)] bg-[var(--c-force-bg)] px-3 py-2">
            <ForcedBadge />
            <span className="text-sm font-bold text-[var(--c-force)]">
              {pick(`${summary.total} điểm đang bị ép tay`, `${summary.total} points under manual override`)}
            </span>
            {summary.expiringSoon > 0 && (
              <span className="text-xs text-[var(--c-warn-fg)]">
                {pick(`· ${summary.expiringSoon} điểm sắp hết hạn`, `· ${summary.expiringSoon} expiring soon`)}
              </span>
            )}
            {summary.withoutTtl > 0 && (
              <span className="text-xs text-[var(--c-text-dim)]">
                {pick(
                  `· ${summary.withoutTtl} điểm không có thời hạn tự nhả`,
                  `· ${summary.withoutTtl} without an automatic release`
                )}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <ul className="min-w-[640px] divide-y divide-[var(--c-border)] max-lg:min-w-0">
              {owners.map((owner) => <OverrideOwnerRow key={owner.pointId} owner={owner} />)}
            </ul>
          </div>
        </>
      )}
    </Panel>
  )
}

function OverrideOwnerRow({ owner }: { owner: OverrideOwner }) {
  const { pick } = useI18n()
  const expiringSoon = isOverrideExpiringSoon(owner.remainingS)
  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-xs first:pt-0 last:pb-0', expiringSoon && 'bg-[var(--c-warn-bg)]')}>
      <span className="mono w-[92px] shrink-0 font-semibold">{owner.displayTag}</span>
      <span className="min-w-[150px] flex-1 truncate font-semibold">{owner.name}</span>
      <span className="mono w-[92px] shrink-0">{formatValue(owner.value, owner.unit)}</span>
      {/* Không có vết trong Activity ⇒ `—` KÈM LÝ DO. Ghi "hệ thống" ở đây là
          bịa: lệnh ép tay do người phát, ta chỉ mất vết vì vòng nhớ Activity có
          hạn (2000 sự kiện). */}
      <span className="w-[190px] shrink-0 truncate">
        {owner.actor
          ? `${owner.actor}${owner.actorRole ? ` · ${owner.actorRole}` : ''}`
          : <span className="text-[var(--c-text-dim)]">{NO_DATA} <span className="text-[10px]">({pick('không có vết trong nhật ký', 'no trace in the activity log')})</span></span>}
      </span>
      <span className="mono w-[130px] shrink-0 text-[var(--c-text-dim)]">
        {owner.commandedAt ? formatDateTime(owner.commandedAt) : NO_DATA}
      </span>
      <span className="w-[132px] shrink-0"><OverrideRemaining remainingS={owner.remainingS} /></span>
      <span className="flex shrink-0 gap-2">
        <Link to={`/monitor?point=${encodeURIComponent(owner.pointId)}`} className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 font-semibold text-[var(--c-accent)] hover:border-[var(--c-accent)]">
          {pick('Xem điểm', 'View point')}
        </Link>
        {/* `objectId` là tham số mà `ActivityPage` THẬT SỰ đọc (`fetchActivity`
            → `params.set('objectId', …)`). Dùng tên khác cho đẹp sẽ cho ra một
            liên kết mở đúng trang nhưng không lọc gì — kiểu hỏng im lặng mà
            `drilldown.ts` đã cảnh báo (F-UX-02/03/04). */}
        <Link to={`/activity?objectId=${encodeURIComponent(owner.pointId)}`} className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 font-semibold text-[var(--c-accent)] hover:border-[var(--c-accent)]">
          {pick('Xem vết lệnh', 'View trace')}
        </Link>
      </span>
    </li>
  )
}

/* ── 5. My Workspace ────────────────────────────────────────────────────── */

/**
 * Khoá localStorage có namespace theo controller + người dùng (PA3-D04).
 *
 * Một kỹ thuật viên mở nhiều bo từ cùng một laptop; một bo có nhiều tài khoản.
 * Dùng chung một khoá thì ghim của bo A hiện trên bo B — và người xem không có
 * cách nào biết là đang xem ghim của nơi khác.
 */
function workspaceKey(controller: string, username: string): string {
  return `mkddc:v1:workspace:${controller || 'unknown'}:${username || 'anon'}`
}

function readPins(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, 12) : []
  } catch {
    return []
  }
}

function writePins(key: string, ids: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // localStorage bị khoá (chế độ riêng tư) — ghim chỉ mất tính bền, không
    // ảnh hưởng dữ liệu vận hành.
  }
}

function MyWorkspace({ overview }: { overview: OverviewResponse }) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const realtime = useRealtime()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })
  const [pickerOpen, setPickerOpen] = useState(false)

  const storageKey = workspaceKey(overview.controller.deviceName ?? '', session?.username ?? '')
  const [pins, setPins] = useState<string[]>(() => readPins(storageKey))
  useEffect(() => { setPins(readPins(storageKey)) }, [storageKey])

  const polled = pointsState.data ?? emptyPoints
  const points = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polled, realtime.allPoints)
    : polled
  const byId = useMemo(() => new Map(points.map((point) => [point.id, point])), [points])

  const toggle = useCallback((id: string) => {
    setPins((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 12)
      writePins(storageKey, next)
      return next
    })
  }, [storageKey])

  const resolved = pins.map((id) => ({ id, point: byId.get(id) }))
  const orphans = resolved.filter((item) => !item.point && pointsState.data !== null)

  return (
    <Panel
      title={pick('KHÔNG GIAN CỦA TÔI', 'MY WORKSPACE')}
      className="p-3"
      action={<Button size="sm" variant="secondary" icon={<ListFilter className="h-4 w-4" />} onClick={() => setPickerOpen(true)}>{pick('Quản lý ghim', 'Manage pins')}</Button>}
    >
      {pins.length === 0 ? (
        <StateBlock
          state="empty"
          title={pick('Chưa ghim điểm nào', 'No pinned points yet')}
          detail={pick('Ghim các điểm bạn theo dõi thường xuyên để chúng hiện ngay trên trang đầu.', 'Pin the points you watch most so they appear on the landing page.')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {resolved.map(({ id, point }) => <WorkspaceTile key={id} id={id} point={point} onUnpin={() => toggle(id)} />)}
        </div>
      )}

      {orphans.length > 0 && (
        <p role="status" className="mt-3 text-xs text-[var(--c-warn-fg)]">
          {/* Ghim trỏ tới point không còn tồn tại phải NÓI RA, không im lặng
              biến mất: người dùng cần biết cấu hình đã đổi. */}
          {pick(
            `${orphans.length} ghim trỏ tới điểm không còn trong cấu hình hiện tại.`,
            `${orphans.length} pins point to objects that no longer exist in the current configuration.`
          )}
        </p>
      )}

      <Modal open={pickerOpen} title={pick('Chọn điểm để ghim', 'Choose points to pin')} cancelLabel={pick('Xong', 'Done')} onClose={() => setPickerOpen(false)}>
        <p className="mb-3 text-sm text-[var(--c-text-dim)]">
          {pick(`Đã ghim ${pins.length}/12 điểm.`, `${pins.length}/12 points pinned.`)}
        </p>
        <div className="grid max-h-[52vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {points.map((point) => {
            const selected = pins.includes(point.id)
            return (
              <label key={point.id} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                <input type="checkbox" checked={selected} disabled={!selected && pins.length >= 12} onChange={() => toggle(point.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{pointDisplayTag(point)}</span>
                  <span className="block truncate text-xs text-[var(--c-text-dim)]">{point.name}</span>
                </span>
              </label>
            )
          })}
        </div>
      </Modal>
    </Panel>
  )
}

function WorkspaceTile({ id, point, onUnpin }: { id: string; point: Point | undefined; onUnpin: () => void }) {
  const { pick } = useI18n()
  if (!point) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="mono text-sm font-semibold">{id}</span>
          <button type="button" onClick={onUnpin} aria-label={pick('Bỏ ghim', 'Unpin')} className="text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
            <PinOff className="h-4 w-4" />
          </button>
        </div>
        <div className="mono mt-3 text-2xl font-bold text-[var(--c-text-dim)]">{NO_DATA}</div>
        <div className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Không còn trong cấu hình', 'No longer in configuration')}</div>
      </div>
    )
  }
  /* §8: point offline hiện `—`, KHÔNG hiện `0`. Một quạt mất liên lạc và một
     quạt đang dừng là hai chuyện khác nhau, và trên màn hình phải trông khác
     nhau. */
  const notConfigured = isChannelNotConfigured(point)
  const showValue = point.quality !== 'offline' && !notConfigured
  return (
    <Link to={`/monitor?point=${encodeURIComponent(point.id)}`} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 transition hover:border-[var(--c-accent)]">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{point.name}</span>
        <button
          type="button"
          onClick={(event) => { event.preventDefault(); onUnpin() }}
          aria-label={pick('Bỏ ghim', 'Unpin')}
          className="shrink-0 text-[var(--c-accent)] hover:text-[var(--c-accent-2)]"
        >
          <Pin className="h-4 w-4" />
        </button>
      </div>
      <div className="mono mt-2 text-2xl font-bold">{showValue ? formatValue(point.value, point.unit) : NO_DATA}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {notConfigured
          ? <StatusBadge state="inactive" label={pick('Chưa cấu hình', 'Not configured')} />
          : <QualityBadge quality={point.quality} reason={point.qualityReason} />}
        {point.forced && <ForcedBadge remainingLabel={formatCountdown(point.overrideExpiresInS)} />}
      </div>
      <div className="mono mt-2 text-[11px] text-[var(--c-text-dim)]">
        {pointDisplayTag(point)} · {formatDataAge(point.updatedAt)}
      </div>
    </Link>
  )
}

/* ── 6. Trend preview ───────────────────────────────────────────────────── */

const trendPrefsKey = 'mkddc:v1:landing-trend-points'

function TrendPreview() {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const realtime = useRealtime()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(trendPrefsKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_LANDING_TREND_SERIES) : []
    } catch {
      return []
    }
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [samples, setSamples] = useState<TrendSample[]>([])

  const polled = pointsState.data ?? emptyPoints
  const points = realtime.allPoints.length && isFreshIso(realtime.lastPointEventAt, REALTIME_STALE_MS)
    ? mergePointsById(polled, realtime.allPoints)
    : polled
  const candidates = useMemo(
    () => points.filter((point) => pointNumber(point) !== null).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    [points]
  )
  const chosen = useMemo(
    () => selected.map((id) => candidates.find((point) => point.id === id)).filter((point): point is Point => Boolean(point)),
    [selected, candidates]
  )
  const series = useMemo<TrendSeries[]>(
    () => chosen.map((point, index) => ({ key: point.id, label: pointDisplayTag(point), color: trendColors[index % trendColors.length], unit: point.unit })),
    [chosen]
  )

  /* Mốc `updatedAt` gần nhất ĐÃ ghi vào buffer, theo từng điểm. Đây là thứ
     phân biệt "producer vừa phát giá trị mới" với "trình duyệt vừa tick". */
  const lastSampledAtRef = useRef<Record<string, string>>({})
  useEffect(() => {
    setSamples([])
    lastSampledAtRef.current = {}
  }, [selected])

  /* F-UX-14 (`REV-FE-UIUX-UC-2026-08-18` §7.1) — lấy mẫu theo producer, không
     theo đồng hồ trình duyệt.
  
     TRIỆU CHỨNG: buffer được dựng bằng `setInterval(append, 1000)`, nên mỗi
     giây ghi một mẫu bất kể producer có phát gì mới hay không. Một điểm Modbus
     cập nhật 5 s/lần cho ra 5 mẫu giống hệt nhau: mật độ dữ liệu GIẢ. Biểu đồ
     trông dày và mượt đúng ở chỗ ta không biết gì thêm, và người đọc không có
     cách nào phân biệt "đo được liên tục" với "đọc lại đúng con số cũ".
  
     NGUYÊN NHÂN GỐC: nhịp lấy mẫu lấy từ tab trình duyệt thay vì từ `updatedAt`
     của chính điểm — cùng lớp lỗi với việc đóng dấu giờ máy trạm lên số đo.
  
     CÁCH SỬA: chỉ ghi mẫu khi `updatedAt` của ít nhất một điểm đang chọn ĐỔI,
     và trục thời gian lấy từ chính mốc đó chứ không phải `Date.now()`. Điểm nào
     không có mốc mới thì KHÔNG có khoá trong mẫu ⇒ `TrendChart`
     (`connectNulls={false}`) để ĐỨT đường. Đứt mới là đúng: giữ giá trị cuối sẽ
     vẽ một đường thẳng khẳng định "vẫn đo được" trong khoảng mà không producer
     nào nói gì (quyết định Q3, Plan 57 §12). */
  useEffect(() => {
    if (!chosen.length) return
    /* N-01 (kiểm tra viên độc lập): MỘT HÀNG CHO MỖI MỐC THỜI GIAN, không gộp
       cả nhóm vào một hàng rồi đóng dấu mốc mới nhất lên tất cả.
       Bản trước lấy `newestStamp` của cả nhóm làm nhãn thời gian cho mọi giá
       trị trong hàng, nên số đo của điểm A tại t1 bị vẽ dưới nhãn t2 của điểm
       B. Đó đúng là lớp lỗi mà chú thích ngay bên trên cấm ("tuyệt đối không
       đóng dấu giờ máy trạm lên số đo") — chỉ khác ở chỗ đóng dấu đồng hồ của
       producer khác thay vì của trình duyệt. */
    const byStamp = new Map<number, Record<string, number>>()
    for (const point of chosen) {
      const stamp = point.updatedAt
      /* Không có mốc thời gian thật ⇒ bỏ qua, tuyệt đối không đóng dấu giờ máy
         trạm lên số đo của producer (PA3-F04). */
      if (!stamp) continue
      const stampMs = Date.parse(stamp)
      if (Number.isNaN(stampMs)) continue
      if (lastSampledAtRef.current[point.id] === stamp) continue
      const value = pointNumber(point)
      /* G-04: chỉ "đốt" mốc SAU khi đã có giá trị dùng được. Ghi ref trước phép
         kiểm này làm một mốc kèm giá trị hỏng khoá luôn mốc đó, và nếu sau đó
         đọc lại được giá trị dưới cùng mốc thì nó không bao giờ vào biểu đồ. */
      if (value === null) continue
      lastSampledAtRef.current[point.id] = stamp
      const row = byStamp.get(stampMs) ?? {}
      row[point.id] = Number(value.toFixed(2))
      byStamp.set(stampMs, row)
    }
    if (byStamp.size === 0) return
    const rows: TrendSample[] = [...byStamp.entries()]
      .sort(([left], [right]) => left - right)
      .map(([stampMs, values]) => ({
        /* `__ts` bật trục thời gian SỐ của `TrendChart`: khoảng cách trên trục
           phản ánh khoảng cách thật, thay vì trục `category` vẽ đều nhau bất kể
           nhịp lấy mẫu (N-02). */
        __ts: stampMs,
        time: new Date(stampMs).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        ...values
      }))
    setSamples((previous) => [...previous, ...rows].slice(-TREND_SAMPLE_LIMIT))
  }, [chosen])

  function toggle(id: string) {
    setSelected((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < MAX_LANDING_TREND_SERIES ? [...current, id] : current
      try { window.localStorage.setItem(trendPrefsKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <Panel
      title={pick('XU HƯỚNG NHANH', 'TREND PREVIEW')}
      className="p-3"
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" icon={<ListFilter className="h-4 w-4" />} onClick={() => setPickerOpen(true)}>
            {pick('Điểm', 'Points')} {selected.length}/{MAX_LANDING_TREND_SERIES}
          </Button>
          <Button size="sm" variant="ghost" icon={<Maximize2 className="h-4 w-4" />} onClick={() => navigate('/trends')}>
            {pick('Mở Trends', 'Open Trends')}
          </Button>
        </div>
      }
    >
      {samples.length > 1 && series.length ? (
        <TrendChart data={samples} series={series} height={240} showTable={false} showDots />
      ) : (
        <StateBlock
          state="empty"
          title={pick('Chưa có dữ liệu xu hướng trực tiếp', 'No live trend data yet')}
          detail={pick(
            'Chọn tối đa 4 điểm có giá trị số; biểu đồ bắt đầu khi authority trả về giá trị kèm mốc thời gian.',
            'Choose up to 4 numeric points; the chart starts once the authority returns values with timestamps.'
          )}
        />
      )}

      <Modal open={pickerOpen} title={pick('Chọn điểm cho biểu đồ', 'Choose chart points')} cancelLabel={pick('Xong', 'Done')} onClose={() => setPickerOpen(false)}>
        <p className="mb-3 text-sm text-[var(--c-text-dim)]">
          {pick(`Tối đa ${MAX_LANDING_TREND_SERIES} chuỗi trên trang đầu; Trends đầy đủ hỗ trợ tới 8.`, `At most ${MAX_LANDING_TREND_SERIES} series on the landing page; full Trends supports up to 8.`)}
        </p>
        <div className="grid max-h-[52vh] gap-2 overflow-y-auto sm:grid-cols-2">
          {candidates.map((point) => {
            const isSelected = selected.includes(point.id)
            return (
              <label key={point.id} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                <input type="checkbox" checked={isSelected} disabled={!isSelected && selected.length >= MAX_LANDING_TREND_SERIES} onChange={() => toggle(point.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{pointDisplayTag(point)}</span>
                  <span className="block truncate text-xs text-[var(--c-text-dim)]">{point.name}</span>
                </span>
                <span className="text-xs text-[var(--c-text-dim)]">{point.unit ?? NO_DATA}</span>
              </label>
            )
          })}
        </div>
      </Modal>
    </Panel>
  )
}

/* ── 7. Activity ────────────────────────────────────────────────────────── */

const activityActionLabels: Record<string, [string, string]> = {
  login: ['Đăng nhập', 'Login'],
  point_force: ['Ép giá trị điểm', 'Force point value'],
  point_release: ['Nhả lệnh ép', 'Release force'],
  point_override: ['Ép tay có thời hạn', 'Timed manual override'],
  point_metadata: ['Sửa siêu dữ liệu điểm', 'Edit point metadata'],
  alarm_ack: ['Xác nhận cảnh báo', 'Acknowledge alarm'],
  alarm_suppress: ['Tạm ẩn cảnh báo', 'Suppress alarm'],
  commissioning_test: ['Kiểm tra commissioning', 'Commissioning test'],
  override_expired: ['Hết hạn ép tay', 'Override expired']
}

function ActivityPanel() {
  const { pick } = useI18n()
  const [kind, setKind] = useState<'user' | 'system'>('user')
  const activity = useApi(useCallback(() => fetchActivity({ limit: 12, kind }), [kind]), [kind], { refreshMs: 10000 })

  return (
    <Panel
      title={pick('HOẠT ĐỘNG GẦN ĐÂY', 'RECENT ACTIVITY')}
      className="p-3"
      action={
        <div role="tablist" aria-label={pick('Loại hoạt động', 'Activity kind')} className="flex gap-1">
          {(['user', 'system'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              onClick={() => setKind(value)}
              className={`h-9 rounded-[var(--radius)] border px-3 text-xs font-semibold ${kind === value ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)]'}`}
            >
              {value === 'user' ? pick('Người dùng', 'User') : pick('Hệ thống', 'System')}
            </button>
          ))}
        </div>
      }
    >
      {activity.loading && !activity.data && <StateBlock state="loading" title={pick('Đang tải hoạt động', 'Loading activity')} />}
      {activity.error && !activity.data && (
        <StateBlock state="error" title={pick('Không đọc được nhật ký hoạt động', 'Activity log unavailable')} detail={activity.error.message} onRetry={activity.refetch} />
      )}
      {activity.data && activity.data.items.length === 0 && (
        <StateBlock
          state="empty"
          title={kind === 'user' ? pick('Chưa có thao tác nào của người dùng', 'No user actions yet') : pick('Chưa có sự kiện hệ thống nào', 'No system events yet')}
        />
      )}
      {activity.data && activity.data.items.length > 0 && (
        <ul className="divide-y divide-[var(--c-border)]">
          {activity.data.items.map((event) => <ActivityRow key={event.id} event={event} />)}
        </ul>
      )}
    </Panel>
  )
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const { pick } = useI18n()
  const link = event.objectType && event.objectId ? resolveDrilldown(event.objectType, event.objectId) : null
  const actionLabel = activityActionLabels[event.action]
  const outcomeColor = event.outcome === 'accepted' || event.outcome === 'ok'
    ? 'var(--c-good-fg)'
    : event.outcome === 'rejected' || event.outcome === 'denied'
      ? 'var(--c-fault-fg)'
      : 'var(--c-text-dim)'
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-xs">
      <div className="min-w-0">
        <div className="font-semibold">
          {actionLabel ? pick(actionLabel[0], actionLabel[1]) : event.action}
          {event.objectId && <span className="mono ml-2 text-[var(--c-text-dim)]">{event.objectId}</span>}
        </div>
        <div className="mt-0.5 text-[var(--c-text-dim)]">
          {[event.actor, event.role, event.detail].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-semibold" style={{ color: outcomeColor }}>{event.outcome}</span>
        <span className="mono text-[var(--c-text-dim)]">{formatDateTime(event.time)}</span>
        {link && <Link to={link} className="text-[var(--c-accent)]"><ArrowRight className="h-4 w-4" /></Link>}
      </div>
    </li>
  )
}
