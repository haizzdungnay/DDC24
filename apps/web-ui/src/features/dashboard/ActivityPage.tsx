import { Download, Filter, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { fetchActivity } from '../../shared/api/overview'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { useI18n } from '../../shared/i18n'
import { resolveDrilldown } from '../../shared/overview/drilldown'
import type { ActivityEvent, ActivityKind, ActivityPage as ActivityPageModel } from '../../shared/types'
import { NO_DATA, formatDateTime } from '../../shared/utils'

/**
 * Nhật ký hoạt động — PA3-306 / PA3-406.
 *
 * Đây là đích của deep link "xem vết audit" từ Point Detail: một lệnh ép tay
 * trên AO-01 dẫn thẳng tới `/activity?objectId=AO-01`, nơi thấy đủ ai ra lệnh,
 * lúc nào, TTL bao nhiêu và kết quả ra sao.
 *
 * Trước PA3, câu hỏi đó chỉ trả lời được bằng `journalctl` trên bo. Trang này
 * không tự tính gì cả — nó hiển thị nguyên văn thứ kho Activity đã ghi.
 */

const ACTION_LABELS: Record<string, [string, string]> = {
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

const PAGE_SIZE = 50

/** Một ô CSV: bọc nháy kép và nhân đôi nháy bên trong theo RFC 4180. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Xuất nhật ký đang hiển thị ra CSV.
 *
 * KHÔNG chứa secret: chỉ ghi đúng các trường đã hiển thị trên màn hình, vốn đã
 * qua bộ lọc của backend theo `REQ-PA3-X-1` ("mọi vết audit truy vấn được,
 * không chứa secret"). Không thêm trường nào từ payload thô.
 */
function downloadActivityCsv(rows: ActivityEvent[]) {
  const header = ['time', 'actor', 'role', 'action', 'objectType', 'objectId', 'outcome', 'detail']
  const body = rows.map((event) => [
    event.time, event.actor, event.role, event.action,
    event.objectType, event.objectId, event.outcome, event.detail
  ].map(csvCell).join(','))
  const blob = new Blob(['\ufeff' + [header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `activity-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** `datetime-local` cho ra giờ ĐỊA PHƯƠNG không có múi; API nhận ISO UTC. */
function localToIso(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

export function ActivityPage() {
  const { pick } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const kind = (searchParams.get('kind') as ActivityKind | null) ?? undefined
  const objectId = searchParams.get('objectId') ?? ''
  const action = searchParams.get('action') ?? ''
  /* `T57-2.2` — lọc theo khoảng thời gian. Điều tra sự cố luôn bắt đầu bằng
     "chuyện gì xảy ra quanh 14:05 hôm qua", nhưng trang chỉ có `kind`/`objectId`
     /`action` cộng phân trang theo cursor: muốn tới một mốc thời gian phải bấm
     "tải thêm" cho tới khi chạm nó. */
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; page: ActivityPageModel | null; message?: string }>({ status: 'loading', page: null })
  const [older, setOlder] = useState<ActivityEvent[]>([])

  const load = useCallback(async () => {
    setState({ status: 'loading', page: null })
    setOlder([])
    try {
      const page = await fetchActivity({ limit: PAGE_SIZE, kind, objectId: objectId || undefined, action: action || undefined, from: localToIso(from), to: localToIso(to) })
      setState({ status: 'ready', page })
    } catch (error) {
      setState({ status: 'error', page: null, message: error instanceof Error ? error.message : String(error) })
    }
  }, [action, from, kind, objectId, to])

  useEffect(() => { void load() }, [load])

  async function loadMore() {
    const cursor = older.length ? older[older.length - 1].id : state.page?.nextCursor
    if (!cursor) return
    const next = await fetchActivity({ limit: PAGE_SIZE, before: cursor, kind, objectId: objectId || undefined, action: action || undefined, from: localToIso(from), to: localToIso(to) })
    setOlder((current) => [...current, ...next.items])
  }

  function setFilter(key: 'kind' | 'objectId' | 'action' | 'from' | 'to', value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const rows = [...(state.page?.items ?? []), ...older]
  const hasMore = older.length ? true : Boolean(state.page?.nextCursor)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">{pick('Nhật ký hoạt động', 'Activity log')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick(
              'Ai đã làm gì trên thiết bị này, lúc nào và kết quả ra sao. Dữ liệu lấy nguyên văn từ kho audit, không suy diễn.',
              'Who did what on this device, when, and with what outcome. Read verbatim from the audit store.'
            )}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { void load() }}>
          {pick('Làm mới', 'Refresh')}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[170px_1fr_1fr_auto]">
        <select
          aria-label={pick('Lọc theo loại', 'Filter by kind')}
          value={kind ?? ''}
          onChange={(event) => setFilter('kind', event.target.value)}
          className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm"
        >
          <option value="">{pick('Loại - Tất cả', 'Kind - All')}</option>
          <option value="user">{pick('Người dùng', 'User')}</option>
          <option value="system">{pick('Hệ thống', 'System')}</option>
        </select>
        <input
          aria-label={pick('Lọc theo đối tượng', 'Filter by object')}
          value={objectId}
          onChange={(event) => setFilter('objectId', event.target.value)}
          placeholder={pick('Đối tượng, ví dụ AO-01', 'Object, e.g. AO-01')}
          className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm"
        />
        <input
          aria-label={pick('Lọc theo hành động', 'Filter by action')}
          value={action}
          onChange={(event) => setFilter('action', event.target.value)}
          placeholder={pick('Hành động, ví dụ point_override', 'Action, e.g. point_override')}
          className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm"
        />
        <label className="flex flex-col gap-1 text-xs text-[var(--c-text-dim)]">
          {pick('Từ', 'From')}
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFilter('from', event.target.value)}
            className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--c-text-dim)]">
          {pick('Đến', 'To')}
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setFilter('to', event.target.value)}
            className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text)]"
          />
        </label>
        <Button
          variant="secondary"
          icon={<Filter className="h-4 w-4" />}
          onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
        >
          {pick('Xoá lọc', 'Clear')}
        </Button>
        {/* `T57-2.15` — biên bản nghiệm thu và điều tra sự cố đều cần bản xuất;
            trước đây chỉ xem được trên màn hình. Xuất ĐÚNG những dòng đang hiển
            thị theo bộ lọc hiện tại, không phải toàn kho: người dùng tải về thứ
            họ đang nhìn. */}
        <Button
          variant="secondary"
          icon={<Download className="h-4 w-4" />}
          disabled={rows.length === 0}
          onClick={() => downloadActivityCsv(rows)}
        >
          {pick('Xuất CSV', 'Export CSV')}
        </Button>
      </div>

      <Panel className="p-0">
        {state.status === 'loading' && <StateBlock state="loading" title={pick('Đang tải nhật ký', 'Loading activity')} />}
        {state.status === 'error' && (
          <StateBlock state="error" title={pick('Không đọc được nhật ký hoạt động', 'Activity log unavailable')} detail={state.message} onRetry={() => { void load() }} />
        )}
        {state.status === 'ready' && rows.length === 0 && (
          <StateBlock
            state="empty"
            title={pick('Không có sự kiện nào khớp bộ lọc', 'No events match the filter')}
            detail={pick('Kho giữ tối đa ' + (state.page?.capacity ?? 0) + ' bản ghi gần nhất.', `The store keeps at most ${state.page?.capacity ?? 0} recent records.`)}
          />
        )}
        {state.status === 'ready' && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="bg-[var(--c-surface-2)] text-[10px] uppercase text-[var(--c-text-dim)]">
                <tr>
                  <th className="px-3 py-2">{pick('Thời gian', 'Time')}</th>
                  <th className="px-3 py-2">{pick('Loại', 'Kind')}</th>
                  <th className="px-3 py-2">{pick('Hành động', 'Action')}</th>
                  <th className="px-3 py-2">{pick('Đối tượng', 'Object')}</th>
                  <th className="px-3 py-2">{pick('Người thực hiện', 'Actor')}</th>
                  <th className="px-3 py-2">{pick('Kết quả', 'Outcome')}</th>
                  <th className="px-3 py-2">{pick('Chi tiết', 'Detail')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => <ActivityTableRow key={event.id} event={event} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {state.status === 'ready' && hasMore && (
        <div className="text-center">
          <Button variant="secondary" onClick={() => { void loadMore() }}>{pick('Tải thêm', 'Load more')}</Button>
        </div>
      )}

      {state.status === 'ready' && state.page && (
        <p className="text-center text-xs text-[var(--c-text-dim)]">
          {pick(
            `Đang giữ ${state.page.retained}/${state.page.capacity} bản ghi. Bản ghi cũ hơn đã bị xoá theo chính sách lưu trữ.`,
            `Retaining ${state.page.retained}/${state.page.capacity} records. Older records were dropped by the retention policy.`
          )}
        </p>
      )}
    </div>
  )
}

function ActivityTableRow({ event }: { event: ActivityEvent }) {
  const { pick } = useI18n()
  const link = event.objectType && event.objectId ? resolveDrilldown(event.objectType, event.objectId) : null
  const actionLabel = ACTION_LABELS[event.action]
  const outcomeColor = event.outcome === 'accepted' || event.outcome === 'ok'
    ? 'var(--c-good-fg)'
    : event.outcome === 'rejected' || event.outcome === 'denied' || event.outcome === 'not_found'
      ? 'var(--c-fault-fg)'
      : 'var(--c-text-dim)'
  return (
    <tr className="border-t border-[var(--c-border)]">
      <td className="mono whitespace-nowrap px-3 py-2">{formatDateTime(event.time)}</td>
      <td className="px-3 py-2">{event.kind}</td>
      <td className="px-3 py-2 font-semibold">{actionLabel ? pick(actionLabel[0], actionLabel[1]) : event.action}</td>
      <td className="mono px-3 py-2">
        {link ? <Link to={link} className="text-[var(--c-accent)]">{event.objectId}</Link> : (event.objectId || NO_DATA)}
      </td>
      <td className="px-3 py-2">{event.actor}{event.role ? ` · ${event.role}` : ''}</td>
      <td className="px-3 py-2 font-semibold" style={{ color: outcomeColor }}>
        {event.outcome}
        {event.reasonCode && event.reasonCode !== '-' && <span className="ml-1 font-normal text-[var(--c-text-dim)]">({event.reasonCode})</span>}
      </td>
      <td className="px-3 py-2 text-[var(--c-text-dim)]">{event.detail && event.detail !== '-' ? event.detail : NO_DATA}</td>
    </tr>
  )
}
