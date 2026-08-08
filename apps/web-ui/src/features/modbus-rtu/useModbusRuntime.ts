import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { useRealtime } from '../../shared/realtime'
import type { ModbusQuality, Point } from '../../shared/types'

/**
 * MBR-B310 — giá trị runtime của Point Modbus RTU lấy qua WebSocket.
 *
 * Trước bản này mỗi trang tự gọi `apiClient.getPoints()` theo nhịp 5 giây. Ba
 * hệ quả, và cái thứ ba mới là cái đáng sửa:
 *
 *  1. Toàn bộ bảng điểm được kéo lại mỗi 5 s dù không có gì đổi.
 *  2. Thay đổi xuất hiện chậm tới 5 s — đủ lâu để người đang chỉnh setpoint
 *     tưởng lệnh không ăn và bấm lần nữa.
 *  3. **Không phân biệt được "giá trị mới" với "giá trị cũ vì mất kết nối".**
 *     Polling thất bại lặng lẽ giữ nguyên số cũ trên màn hình.
 *
 * Hook này dùng luồng WS sẵn có, và xử lý đúng chỗ khó nhất: **khi kết nối lại,
 * phải lấy một ẢNH ĐẦY ĐỦ trước khi tin vào cập nhật tiếp theo.** Trong lúc mất
 * kết nối, giá trị có thể đã đổi nhiều lần; áp tiếp delta lên trạng thái cũ cho
 * ra một bảng trộn giữa hai thời điểm — sai mà trông vẫn hợp lý.
 */

export interface ModbusRuntimeEntry {
  /** `undefined` = point đã khai nhưng CHƯA có số đo (REV-FE-04). */
  value: number | boolean | string | undefined
  quality: ModbusQuality
  qualityReason?: string
  /** `undefined` = producer không cấp mốc thời gian (PA3-F04). */
  updatedAt?: string
  writable: boolean
}

export interface ModbusRuntime {
  /** Theo `point_id`. Thiếu khoá = chưa có dữ liệu, KHÔNG phải giá trị 0. */
  points: Record<string, ModbusRuntimeEntry>
  /** `true` khi số đang hiển thị đến từ luồng trực tiếp. */
  live: boolean
  /** Vì sao không live — để UI nói ra thay vì im lặng hiện số cũ. */
  staleReason: string
  refresh: () => Promise<void>
}

/** Quality của Point Modbus do producer cấp; FE chỉ chuyển chữ hoa. */
function toModbusQuality(raw: string | undefined): ModbusQuality {
  const upper = (raw ?? '').toUpperCase()
  switch (upper) {
    case 'GOOD':
    case 'STALE':
    case 'BAD':
    case 'OFFLINE':
    case 'CONFIG_ERROR':
      return upper
    default:
      // Giá trị lạ ⇒ UNKNOWN. Đoán về GOOD ở đây là bịa trạng thái thiết bị.
      return 'UNKNOWN'
  }
}

function indexModbusPoints(points: Point[]): Record<string, ModbusRuntimeEntry> {
  const out: Record<string, ModbusRuntimeEntry> = {}
  for (const point of points) {
    if (point.kind !== 'modbus_rtu') continue
    out[point.id] = {
      value: point.value,
      quality: toModbusQuality(point.quality as unknown as string),
      qualityReason: point.qualityReason,
      updatedAt: point.updatedAt,
      writable: Boolean(point.writable)
    }
  }
  return out
}

export function useModbusRuntime(): ModbusRuntime {
  const { allPoints, connectionState } = useRealtime()
  const [snapshot, setSnapshot] = useState<Record<string, ModbusRuntimeEntry>>({})
  const [staleReason, setStaleReason] = useState('')
  /* Chỉ tin luồng WS sau khi đã có một ảnh đầy đủ kể từ lần kết nối gần nhất. */
  const [snapshotFresh, setSnapshotFresh] = useState(false)
  const previousState = useRef(connectionState)

  const refresh = useCallback(async () => {
    try {
      const points = await apiClient.getPoints()
      setSnapshot(indexModbusPoints(points))
      setSnapshotFresh(true)
      setStaleReason('')
    } catch (error) {
      setSnapshotFresh(false)
      setStaleReason(error instanceof Error ? error.message : 'không đọc được bảng điểm')
    }
  }, [])

  // Ảnh đầu tiên: WS chỉ phát khi CÓ thay đổi, nên nếu chờ nó thì một hệ thống
  // đứng yên sẽ hiện bảng rỗng vô thời hạn.
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const previous = previousState.current
    previousState.current = connectionState

    if (connectionState === 'connected') {
      // Vừa kết nối LẠI ⇒ ảnh trong tay đã cũ. Lấy ảnh mới TRƯỚC khi tin delta.
      if (previous !== 'connected') {
        setSnapshotFresh(false)
        void refresh()
      }
      return
    }
    setSnapshotFresh(false)
    setStaleReason(
      connectionState === 'reconnecting'
        ? 'đang kết nối lại — số đang hiển thị là lần đọc trước'
        : 'mất kết nối tới bộ điều khiển — số đang hiển thị là lần đọc trước'
    )
  }, [connectionState, refresh])

  const live = connectionState === 'connected' && snapshotFresh
  /* Chỉ hợp nhất luồng WS khi ảnh nền đã tươi. Ngược lại giữ nguyên ảnh cũ và
   * nói rõ là cũ — trộn delta lên nền cũ tạo ra bảng nửa mới nửa cũ. */
  const points = live ? { ...snapshot, ...indexModbusPoints(allPoints) } : snapshot

  return { points, live, staleReason, refresh }
}
