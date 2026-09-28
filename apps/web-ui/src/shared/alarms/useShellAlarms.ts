import { useCallback, useRef } from 'react'
import { apiClient } from '../api/client'
import { useApi } from '../hooks/useApi'
import type { OverviewContextValue } from '../overview/OverviewProvider'
import type { Alarm } from '../types'

/**
 * `useShellAlarms` — số trên chuông cảnh báo của shell (T63-108, PERF-API-03).
 *
 * TRƯỚC: `AppShell` poll `GET /alarms` mỗi 1 s CHỈ để đếm, song song với
 * `OverviewProvider` poll `/overview` — hai vòng poll trên cùng danh sách cảnh
 * báo sống (`currentAlarms`).
 *
 * SAU: chuông đọc từ snapshot overview (nhịp 1 s, bằng nhịp cũ của chuông).
 * CHỈ ĐỔI NGUỒN, KHÔNG ĐỔI NGỮ NGHĨA: số trên chuông là
 * `overview.alarms.activeOrUnacked`, do server tính đúng quy tắc
 * `countShellAlarms` bên dưới trên đúng danh sách `/alarms` trả về. KHÔNG dùng
 * `alarms.total` — `total` đếm mọi hàng khác `cleared`, gồm cả hàng `shelved`
 * đã hết điều kiện mà chuông chưa bao giờ đếm. `unacked` vẫn lấy từ
 * `alarms.unacked` (cùng định nghĩa `status === 'unack'`).
 *
 * FAIL-SAFE — khi snapshot KHÔNG đáng tin cho chuông thì quay về đường cũ:
 *   - overview chưa có / lỗi / lệch schema, hoặc
 *   - backend báo `degraded` chứa `alarms` (không đọc được Core: số đếm khi đó
 *     chỉ còn cảnh báo điểm ảo, đếm nó sẽ báo THIẾU), hoặc
 *   - `activeOrUnacked` vắng hay không phải số hữu hạn ≥ 0 (server đời cũ):
 *     tuyệt đối không lấy `total` thế vào.
 *   Lúc đó hook poll lại `GET /alarms` mỗi 1 s như trước bản này — endpoint đó
 *   dựng lại cảnh báo từ lịch sử khi Core im, đúng hành vi chuông đã có. Trong
 *   khoảng chờ lượt `/alarms` đầu tiên, chuông giữ số của snapshot đáng tin gần
 *   nhất thay vì rơi về 0: rơi về 0 là nói "hết cảnh báo" trong lúc thật ra là
 *   "chưa biết".
 */
export const SHELL_ALARM_FALLBACK_MS = 1000

export interface ShellAlarmCounts {
  /** Số trên chuông: đang hoạt động hoặc chưa xác nhận (`countShellAlarms`). */
  total: number
  /** Số cảnh báo chưa xác nhận — đầu vào của annunciation. */
  unacked: number
  /** Nguồn đang dùng: snapshot overview, hay vòng poll `/alarms` dự phòng. */
  source: 'overview' | 'alarms'
  refresh: () => void
}

/** Cách đếm của chuông trên danh sách `/alarms` (giữ nguyên định nghĩa cũ).
 *  Server chép đúng quy tắc này vào `overview.alarms.activeOrUnacked`
 *  (`countShellBellAlarms`, overview.go). Lưu ý: `/alarms` bỏ `active` khi nó
 *  là `false` (`omitempty`), nên `alarm.active` ở đây chỉ là `true` hoặc
 *  `undefined`. */
export function countShellAlarms(alarms: Alarm[]): { total: number; unacked: number } {
  return {
    total: alarms.filter((alarm) => (alarm.active ?? (alarm.status === 'active' || alarm.status === 'acked')) || alarm.status === 'unack').length,
    unacked: alarms.filter((alarm) => alarm.status === 'unack').length
  }
}

function bellCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function overviewAlarmsTrusted(overview: OverviewContextValue | null): boolean {
  return Boolean(
    overview &&
    overview.status === 'ready' &&
    overview.data &&
    !overview.data.degraded.includes('alarms') &&
    bellCount(overview.data.alarms.activeOrUnacked) &&
    bellCount(overview.data.alarms.unacked)
  )
}

export function useShellAlarms(overview: OverviewContextValue | null): ShellAlarmCounts {
  const trusted = overviewAlarmsTrusted(overview)
  const fallback = useApi<Alarm[] | null>(
    useCallback(() => (trusted ? Promise.resolve(null) : apiClient.getAlarms()), [trusted]),
    [trusted],
    { refreshMs: trusted ? undefined : SHELL_ALARM_FALLBACK_MS }
  )
  const lastTrusted = useRef<{ total: number; unacked: number } | null>(null)

  let counts: { total: number; unacked: number }
  const snapshotAlarms = overview?.data?.alarms
  if (trusted && snapshotAlarms && bellCount(snapshotAlarms.activeOrUnacked)) {
    counts = { total: snapshotAlarms.activeOrUnacked, unacked: snapshotAlarms.unacked }
    lastTrusted.current = counts
  } else if (fallback.data) {
    counts = countShellAlarms(fallback.data)
  } else {
    counts = lastTrusted.current ?? { total: 0, unacked: 0 }
  }

  const refreshOverview = overview?.refresh
  const refetchFallback = fallback.refetch
  const refresh = useCallback(() => {
    if (refreshOverview) void refreshOverview()
    if (!trusted) void refetchFallback()
  }, [refreshOverview, refetchFallback, trusted])

  return { ...counts, source: trusted ? 'overview' : 'alarms', refresh }
}
