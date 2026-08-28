import { runSequential, summarizeSequential, type SequentialOutcome, type SequentialStatus } from '../../shared/bulk/sequential'
import type { Point } from '../../shared/types'
import { pointDisplayTag, pointNumber } from '../../shared/utils'

/**
 * Ép tay hàng loạt — phần logic thuần của `T57-1.4` (đề xuất §6.2-P1a).
 *
 * Đặc tả trực quan: `docs/04_uiux/KX-DDC24-UX-WEB-OPERATIONS-001_VI.md` §2.
 *
 * ## Vì sao tách khỏi component
 *
 * Bốn luật an toàn dưới đây là thứ phải kiểm bằng test hành vi, và kiểm chúng
 * qua DOM thì vừa chậm vừa dễ viết thành "kiểm sự tồn tại": một `expect` thấy
 * chữ "2/3" trên màn hình KHÔNG chứng minh rằng điểm thứ ba đã bị bỏ qua đúng
 * cách. Ở đây chúng là giá trị trả về, so sánh được trực tiếp.
 *
 * ## Bốn luật an toàn
 *
 * 1. **Không có API ghi hàng loạt ở backend.** `PUT /api/v1/points/{id}` là một
 *    điểm một request. Ta gửi TUẦN TỰ và báo kết quả TỪNG điểm. Giả vờ đây là
 *    một giao dịch nguyên tử là nói dối về thứ không thể nguyên tử.
 * 2. **Một điểm hỏng KHÔNG được làm dừng các điểm còn lại.** Người vận hành
 *    đang chạy thử một AHU: dừng ở điểm thứ hai để lại một cụm nửa chạy nửa
 *    dừng, tệ hơn hẳn so với chạy hết rồi báo đúng cái nào hỏng.
 * 3. **Huỷ giữa chừng dừng các điểm CHƯA gửi, và nói ra các điểm ĐÃ gửi.**
 *    "Không để lại lệnh nửa vời" không thể có nghĩa "tự động rollback": rollback
 *    cũng là một lệnh ghi ra cơ cấu chấp hành và có thể hỏng y như lệnh gốc.
 * 4. **Không bịa giá trị hiện tại.** Điểm chưa có số đo thì `currentValue` là
 *    `undefined` và giao diện hiện `—`; không điền sẵn một con số đoán vào
 *    bảng hậu quả của một lệnh ghi ra thiết bị (cùng họ với `F-UX-09`).
 */

/** Điểm nhị phân theo BẢN CHẤT tín hiệu, không theo giá trị tức thời.
 *
 *  Dùng `typeof value === 'boolean'` một mình sẽ phân loại sai một điểm ảo kiểu
 *  boolean chưa có số đo (`value === undefined`) thành analog. */
export function isBulkBinaryPoint(point: Point): boolean {
  return point.kind === 'DO' || point.kind === 'DI' || point.signalType === 'boolean' || typeof point.value === 'boolean'
}

/**
 * Điểm có được chọn để ép tay hàng loạt không.
 *
 * Khớp ĐÚNG `canForcePoint` của `MonitorPage`: DO, AO, và điểm ảo `writable`.
 * Bày một ô chọn cho điểm mà lệnh chắc chắn bị từ chối là mời người dùng vào
 * một hộp thoại chỉ để nhận lỗi — cùng lớp mâu thuẫn với finding `N-05`.
 *
 * Điểm ảo cố ý **bị loại** khỏi ép tay hàng loạt dù `canForcePoint` cho phép
 * ghi lẻ: Core KHÔNG giữ TTL cho điểm ảo (`forcePointWithDuration` gửi không
 * kèm `ttlS`), nên gộp nó vào một hộp thoại có "thời hạn dùng chung" sẽ hứa một
 * thời hạn không tồn tại cho riêng nó.
 */
export function isBulkSelectable(point: Point): boolean {
  return point.kind === 'DO' || point.kind === 'AO'
}

export interface BulkPlanRow {
  pointId: string
  displayTag: string
  name: string
  isBinary: boolean
  /** `undefined` = chưa có số đo. Giao diện hiện `—`, không đoán. */
  currentValue: Point['value']
  unit?: string
  nextValue: number | boolean
}

/**
 * Dựng bảng hậu quả "hiện tại → sẽ thành" cho từng điểm đã chọn.
 *
 * Thứ tự trả về theo `id` để bảng ổn định giữa hai lần render, và để người đọc
 * đối chiếu được với bảng Monitor phía sau hộp thoại (cũng sắp theo `id`).
 */
export function planBulkOverride(points: Point[], binaryValue: boolean, analogValue: number): BulkPlanRow[] {
  return points
    .filter(isBulkSelectable)
    .map((point) => {
      const isBinary = isBulkBinaryPoint(point)
      return {
        pointId: point.id,
        displayTag: pointDisplayTag(point),
        name: point.name,
        isBinary,
        /* `pointNumber` trả `null` khi chưa có số đo dùng được. Chuyển về
           `undefined` để chỗ hiển thị dùng đúng một quy ước "không có dữ liệu". */
        currentValue: isBinary ? point.value : (pointNumber(point) ?? undefined),
        unit: point.unit,
        nextValue: isBinary ? binaryValue : analogValue
      }
    })
    .sort((left, right) => left.pointId.localeCompare(right.pointId, undefined, { numeric: true }))
}

export type BulkOverrideStatus = SequentialStatus

export interface BulkOverrideOutcome {
  pointId: string
  displayTag: string
  status: BulkOverrideStatus
  /** Nguyên văn lỗi backend. Không diễn dịch lại thành câu chung chung. */
  message?: string
}

/**
 * Gửi tuần tự và trả kết quả từng điểm.
 *
 * Uỷ thác cho `runSequential` — bộ chạy dùng chung với xác nhận cảnh báo hàng
 * loạt (`T57-1.6`). Hai màn hình phải có CÙNG hành vi cho nút Huỷ và cho một
 * phần tử hỏng; hai bản cài riêng là hai hành vi sẽ trôi khỏi nhau.
 *
 * `send` được tiêm vào để test không phải mock lớp mạng, và để chỗ gọi tự quyết
 * đi qua WebSocket hay REST.
 */
export async function runBulkOverride(
  plan: BulkPlanRow[],
  send: (row: BulkPlanRow) => Promise<void>,
  options: { isAborted?: () => boolean; onProgress?: (outcome: BulkOverrideOutcome) => void } = {}
): Promise<BulkOverrideOutcome[]> {
  const byId = new Map(plan.map((row) => [row.pointId, row]))
  const items = plan.map((row) => ({ id: row.pointId, label: row.displayTag }))
  const toOutcome = (outcome: SequentialOutcome): BulkOverrideOutcome => ({
    pointId: outcome.id,
    displayTag: outcome.label,
    status: outcome.status,
    message: outcome.message
  })
  const outcomes = await runSequential(
    items,
    (item) => send(byId.get(item.id) as BulkPlanRow),
    {
      isAborted: options.isAborted,
      onProgress: options.onProgress ? (outcome) => options.onProgress?.(toOutcome(outcome)) : undefined
    }
  )
  return outcomes.map(toOutcome)
}

export function summarizeBulkOutcomes(outcomes: BulkOverrideOutcome[]): Record<BulkOverrideStatus, number> {
  return summarizeSequential(outcomes.map((outcome) => ({ id: outcome.pointId, label: outcome.displayTag, status: outcome.status })))
}
