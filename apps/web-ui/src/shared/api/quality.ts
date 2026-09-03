/* `ISS-PIO-35`/`F-PIO-001` — hợp đồng quality của Point ở tầng FE.
 *
 * Triệu chứng đã truy đủ đường: một Virtual Point có `source = PROGRAM`,
 * `boundPointId = "AV-3"`, Core chưa publish slot. Backend làm ĐÚNG — trả
 * `{"value": null, "quality": "unknown"}`. FE nhận, không khớp `offline`,
 * `fault` không `true`, `online` không `false`, rồi `normalizeQuality("unknown")`
 * rơi vào nhánh cuối và trả **`good`**. Trang Giám sát vẽ huy hiệu **GOOD** cho
 * một điểm KHÔNG AI ĐỌC ĐƯỢC.
 *
 * Nguyên tắc đúng đã có sẵn ở tầng Go (`mapExtQuality`: *"Giá trị lạ = producer
 * mới hơn consumer. Trả UNKNOWN chứ không đoán bừa về GOOD"*) rồi bị FE phá ở
 * tầng cuối. Đây là lý do hợp đồng phải nằm ở một chỗ và được kiểm hai chiều,
 * chứ không phải được nhắc lại bằng lời ở từng tầng.
 *
 * Danh sách dưới đây phải khớp `contracts/quality/point_quality_v1.json`;
 * `quality.test.ts` đọc thẳng tệp đó và so từng giá trị. */

export const POINT_QUALITY_CONTRACT_VERSION = 1

/** Thứ tự KHÔNG tuỳ tiện: từ tin được nhất tới không biết gì. */
export const POINT_QUALITY_VALUES = ['good', 'uncertain', 'stale', 'bad', 'offline', 'config_error', 'unknown'] as const

export type PointQuality = (typeof POINT_QUALITY_VALUES)[number]

/** Giá trị lạ hoặc thiếu rơi về ĐÂY. Không bao giờ về `good`. */
export const POINT_QUALITY_FALLBACK: PointQuality = 'unknown'

const recognized = new Set<string>(POINT_QUALITY_VALUES)

/**
 * Chuẩn hoá quality từ bất kỳ nguồn nào (JSON API, WebSocket, demo).
 *
 * Nhận cả dạng dây `GOOD`/`CONFIG_ERROR` lẫn dạng thường `good`/`config_error`,
 * và cả `CONFIG-ERROR`/`config error` vì ba tầng sinh chuỗi này độc lập nhau.
 *
 * Mọi thứ còn lại — kể cả `undefined`, `null`, chuỗi rỗng, hay một mức mà
 * producer đời mới vừa thêm — ra `unknown`. Đó là toàn bộ nội dung của
 * `ISS-PIO-35`: **thiếu thông tin không phải là tin tốt**.
 */
export function normalizePointQuality(value: unknown): PointQuality {
  if (value === null || value === undefined) return POINT_QUALITY_FALLBACK
  const raw = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (recognized.has(raw)) return raw as PointQuality
  return POINT_QUALITY_FALLBACK
}

/** Quality này có nghĩa là "số đo dùng được" không?
 *
 * Chỉ `good`. Gộp `uncertain`/`stale` vào đây là cách một số đo quá hạn được
 * dùng để ra quyết định điều khiển. */
export function isTrustworthyQuality(quality: PointQuality): boolean {
  return quality === 'good'
}
