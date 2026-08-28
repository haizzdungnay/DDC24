import type { ActivityEvent, AlarmHistoryEntry } from '../../shared/types'

/**
 * Dấu sự kiện trên biểu đồ xu hướng — `T57-2.6` (§6.4-P2c của review).
 *
 * VÌ SAO CẦN
 *
 * Một đường xu hướng nói *cái gì đã xảy ra*, không nói *vì sao*. Khi nhiệt độ
 * gãy khúc lúc 14:03, câu hỏi thật là "lúc đó có ai ép tay van không, hay
 * cảnh báo nào vừa bật?" — và trả lời nó hiện phải mở thêm hai trang khác rồi
 * so mốc thời gian bằng mắt. Đặt dấu ngay trên trục thời gian biến ba lần đối
 * chiếu thủ công thành một cái nhìn.
 *
 * BA LUẬT
 *
 *  1. **Chỉ dấu sự kiện CÓ THẬT.** Nguồn là kho Activity và nhật ký cảnh báo,
 *     không suy diễn từ chính đường dữ liệu ("đoạn này dốc chắc do ép tay") —
 *     đó là bịa nguyên nhân, thứ nguy hiểm hơn không có dấu nào.
 *  2. **Chỉ sự kiện của ĐÚNG những điểm đang vẽ**, trong đúng khoảng thời gian
 *     đang xem. Dấu của một điểm không có trên biểu đồ là nhiễu thuần tuý.
 *  3. **Quá nhiều thì nói ra, không vẽ hết.** Một biểu đồ dày đặc vạch đứng
 *     không đọc được nữa; cắt bớt và nói rõ đã cắt bao nhiêu thì trung thực
 *     hơn là vẽ tất cả rồi để người đọc tự bỏ cuộc.
 */

export interface TrendMarker {
  /** Mốc thời gian, ms. Trục X của biểu đồ dùng chính đơn vị này. */
  ts: number
  kind: 'override' | 'alarm'
  /** Điểm mà sự kiện thuộc về — luôn nằm trong tập đang vẽ. */
  pointId: string
  /** Câu ngắn nói sự kiện gì. */
  label: string
  /** Ai ra lệnh. `undefined` = mất vết trong kho Activity, KHÔNG phải "hệ thống". */
  actor?: string
}

/** Trần số dấu vẽ lên biểu đồ. 24 vạch đứng đã là ngưỡng còn đọc được trên một
 *  khung 360 px cao; nhiều hơn thì chúng dính vào nhau. */
export const TREND_MARKER_LIMIT = 24

/** `action` trong Activity mang nghĩa "một người vừa ra lệnh ghi/ép tay điểm
 *  này". Cùng danh sách với `shared/overview/overrides.ts`; nhận bừa mọi action
 *  có `objectId` trùng sẽ gắn dấu cho cả thao tác đổi tên điểm. */
const OVERRIDE_ACTIONS = new Set(['point_force', 'point_override'])

/** Sự kiện nhật ký cảnh báo đáng đánh dấu: lúc cảnh báo **bật**. `acked`/`ended`
 *  là diễn biến xử lý, không phải thời điểm hiện tượng xảy ra trên đường đo. */
const ALARM_RAISE_EVENTS = new Set(['started', 'returned'])

export interface BuildTrendMarkersInput {
  activity: ActivityEvent[]
  alarms: AlarmHistoryEntry[]
  /** Tập id điểm đang vẽ. Rỗng ⇒ không có dấu nào. */
  pointIds: string[]
  fromMs: number
  toMs: number
  pick: (vi: string, en: string) => string
}

export interface TrendMarkerResult {
  markers: TrendMarker[]
  /** Số dấu bị cắt vì vượt trần. Trang phải nói ra con số này. */
  omitted: number
}

export function buildTrendMarkers({ activity, alarms, pointIds, fromMs, toMs, pick }: BuildTrendMarkersInput): TrendMarkerResult {
  if (!pointIds.length) return { markers: [], omitted: 0 }
  const wanted = new Set(pointIds.map((id) => id.trim().toUpperCase()))
  const collected: TrendMarker[] = []

  for (const event of activity) {
    if (!OVERRIDE_ACTIONS.has(event.action)) continue
    const objectId = event.objectId?.trim().toUpperCase()
    if (!objectId || !wanted.has(objectId)) continue
    const ts = Date.parse(event.time)
    if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue
    /* Lệnh bị từ chối KHÔNG tới thiết bị nên không giải thích được gãy khúc nào
       trên đường đo; đánh dấu nó là mời người đọc kết luận sai. */
    if (event.outcome && event.outcome !== 'accepted' && event.outcome !== 'ok') continue
    collected.push({
      ts,
      kind: 'override',
      pointId: objectId,
      label: pick('Ép tay', 'Manual override'),
      actor: event.actor || undefined
    })
  }

  for (const entry of alarms) {
    if (entry.event && !ALARM_RAISE_EVENTS.has(entry.event)) continue
    const pointId = sourcePointIdOf(entry.source)
    if (!pointId || !wanted.has(pointId)) continue
    const ts = Date.parse(entry.time)
    if (!Number.isFinite(ts) || ts < fromMs || ts > toMs) continue
    collected.push({
      ts,
      kind: 'alarm',
      pointId,
      label: `${pick('Cảnh báo bật', 'Alarm raised')}: ${entry.id}`,
      actor: undefined
    })
  }

  collected.sort((left, right) => left.ts - right.ts || left.pointId.localeCompare(right.pointId))
  /* Trùng khít mốc + cùng điểm + cùng loại = cùng một sự kiện đến từ hai lần
     tải chồng nhau; vẽ hai vạch chồng lên nhau chỉ làm dày nét. */
  const unique = collected.filter((marker, index) => {
    const previous = collected[index - 1]
    return !previous || previous.ts !== marker.ts || previous.pointId !== marker.pointId || previous.kind !== marker.kind
  })

  return {
    markers: unique.slice(0, TREND_MARKER_LIMIT),
    omitted: Math.max(0, unique.length - TREND_MARKER_LIMIT)
  }
}

/** Suy id điểm nguồn từ chuỗi `source` của cảnh báo — cùng quy tắc với
 *  `shared/components/AlarmRow.tsx`: không khớp khuôn id thì bỏ qua, không đoán. */
function sourcePointIdOf(source: string | undefined): string | null {
  const match = /\b((?:UI|AI|DI|AO|DO|VP)-\d{2,})\b/i.exec(source ?? '')
  return match ? match[1].toUpperCase() : null
}
