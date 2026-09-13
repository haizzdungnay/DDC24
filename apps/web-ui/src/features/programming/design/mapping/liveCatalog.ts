import type { Point } from '../../../../shared/types'
import type { ProgrammingPointCatalogEntry } from '../../model/types'

/**
 * `SW-PGM03-LIVE-001` — hợp nhất DANH MỤC điểm (`point-catalog`) với GIÁ TRỊ
 * SỐNG đến từ WebSocket `/api/v1/ws/monitor`.
 *
 * Trước đây workbench Ánh xạ lấy cả hai từ một kênh: `point-catalog` bị đọc lại
 * toàn bộ mỗi 10 giây. Số đo trên bo (72 điểm): 38,9 KiB mỗi lần, trong đó 86%
 * là metadata KHÔNG đổi, và `observedAt` — mốc ĐỌC chứ không phải mốc giá trị
 * đổi — nhích ở cả 72/72 điểm mỗi lần, khiến mọi phép so sánh nội dung đều ra
 * "khác" và cả workbench vẽ lại hai lần mỗi chu kỳ.
 *
 * WebSocket đã có sẵn và chỉ đẩy khi tập điểm thật sự đổi, nên nó là nguồn đúng
 * cho `value`/`quality`/`observedAt`.
 */

/** Giá trị sống của một điểm, đã chuẩn hoá về hình dạng của catalog. */
export interface LivePointSample {
  value: unknown
  quality: ProgrammingPointCatalogEntry['quality']
  observedAt?: string
}

const CATALOG_QUALITIES = new Set<ProgrammingPointCatalogEntry['quality']>([
  'GOOD', 'UNCERTAIN', 'BAD', 'STALE', 'OFFLINE', 'UNKNOWN',
])

/** WS phát `good`, catalog phát `GOOD`. Một chữ hoa/thường lệch nhau ở đây sẽ
 *  đi thẳng vào `StatusBadge` và hiện một trạng thái không có trong bảng màu. */
export function normalizeLiveQuality(quality: unknown): ProgrammingPointCatalogEntry['quality'] {
  const upper = typeof quality === 'string' ? quality.toUpperCase() : ''
  return CATALOG_QUALITIES.has(upper as ProgrammingPointCatalogEntry['quality'])
    ? (upper as ProgrammingPointCatalogEntry['quality'])
    : 'UNKNOWN'
}

/**
 * Chỉ mục giá trị sống theo định danh điểm.
 *
 * Khoá là `point.id` của WS, khớp 1-1 với `entry.pointId` của catalog — đã kiểm
 * trên bo ngày 2026-09-13: 72/72 điểm khớp, định danh duy nhất toàn cục ở cả
 * hai phía, gồm 48 điểm `MB_RTU` trải trên 4 slave.
 */
export function indexLivePoints(points: readonly Point[]): Map<string, LivePointSample> {
  const index = new Map<string, LivePointSample>()
  for (const point of points) {
    if (!point?.id) continue
    index.set(point.id, {
      value: point.value,
      quality: normalizeLiveQuality(point.quality),
      /* Mốc của MẪU ĐO do producer cấp. Vắng mặt là "producer không nói", nên
       * để trống chứ không điền giờ hiện tại — điền vào là dựng lên một mốc
       * không ai đo được, đúng lỗi PA3-F04. */
      observedAt: point.updatedAt,
    })
  }
  return index
}

function sameSample(entry: ProgrammingPointCatalogEntry, sample: LivePointSample): boolean {
  return Object.is(entry.value, sample.value)
    && entry.quality === sample.quality
    && (entry.observedAt ?? undefined) === (sample.observedAt ?? undefined)
}

/**
 * Ghép giá trị sống vào danh mục, GIỮ NGUYÊN reference của mọi thứ không đổi.
 *
 * - Không điểm nào đổi ⇒ trả về **chính mảng đầu vào**, nên `useMemo` phía trên
 *   không tính lại và React không vẽ lại gì.
 * - Có điểm đổi ⇒ chỉ item đó là object mới; 71 item còn lại giữ nguyên
 *   reference, để hàng của chúng không vẽ lại theo.
 *
 * Điểm không có mẫu sống (WS chưa gửi, hoặc vừa bị gỡ khỏi cấu hình) giữ
 * nguyên giá trị của lần đọc catalog — lần đọc đó mang `value`/`quality` thật
 * và là seed hợp lệ cho tới gói WS đầu tiên.
 */
export function mergeCatalogWithLive(
  items: readonly ProgrammingPointCatalogEntry[],
  live: ReadonlyMap<string, LivePointSample>,
  options: { stale?: boolean } = {},
): ProgrammingPointCatalogEntry[] {
  const stale = options.stale === true
  if (live.size === 0 && !stale) return items as ProgrammingPointCatalogEntry[]
  let changed = false
  const merged = items.map((entry) => {
    const sample = live.get(entry.pointId)
    /* Mất kênh sống thì GIÁ TRỊ CUỐI CÙNG ĐÃ ĐỌC ĐƯỢC vẫn hiện — người trực ca
     * cần biết số cuối là bao nhiêu — nhưng phải mang nhãn `STALE`. Vẽ tiếp nó
     * như số đang sống mới là dối trá, và tự ý quay về số của lần đọc danh mục
     * cũng vậy: đó là một số khác, cũ hơn, mà không nói ra. */
    const next = stale
      ? { ...entry, ...(sample ? { value: sample.value, observedAt: sample.observedAt } : {}), quality: 'STALE' as const }
      : (!sample || sameSample(entry, sample))
        ? entry
        : { ...entry, value: sample.value, quality: sample.quality, observedAt: sample.observedAt }
    if (next === entry) return entry
    if (stale && sameSample(entry, { value: next.value, quality: next.quality, observedAt: next.observedAt })) return entry
    changed = true
    return next
  })
  return changed ? merged : (items as ProgrammingPointCatalogEntry[])
}

/**
 * Tập định danh của hai nguồn có còn khớp không.
 *
 * Đây là tín hiệu revalidate CHÍNH XÁC thay cho nhịp poll: người vận hành thêm
 * hay bớt một điểm thì WS biết ngay (nó đọc thẳng runtime), còn danh mục thì
 * không. Lệch tập định danh ⇒ cấu hình vừa đổi ⇒ nạp lại danh mục.
 *
 * Trả `false` khi chưa có gói WS nào: lúc đó không có gì để so, và coi là
 * "lệch" sẽ tạo một vòng nạp lại vô hạn ngay khi vào trang.
 */
export function catalogIdentitiesDiverged(
  items: readonly ProgrammingPointCatalogEntry[],
  live: ReadonlyMap<string, LivePointSample>,
): boolean {
  if (live.size === 0) return false
  if (live.size !== items.length) return true
  for (const entry of items) {
    if (!live.has(entry.pointId)) return true
  }
  return false
}
