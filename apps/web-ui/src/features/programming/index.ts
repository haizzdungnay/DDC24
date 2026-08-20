/* Public API của feature Programming.
 *
 * Chỉ export thứ THẬT SỰ được dùng ngoài feature. Toàn bộ `design/`, `fbd/`,
 * `runtime/`, `commission/`, `overview/`, `model/`, `api/`, `shared/` là nội bộ
 * và phải ở lại sau ranh giới này — chúng là chi tiết cài đặt, không phải hợp
 * đồng với phần còn lại của ứng dụng.
 *
 * CỐ Ý không dùng `export * from './...'`: re-export toàn bộ sẽ biến barrel
 * thành một cái cửa mở, làm lộ nội bộ và khiến ranh giới chỉ còn trên giấy.
 *
 * `App.tsx` CHỈ được import barrel này bằng `import()` ĐỘNG. Trộn một import
 * tĩnh và một import động vào cùng barrel sẽ khiến rollup gộp chunk và `lazy()`
 * mất tác dụng (`INEFFECTIVE_DYNAMIC_IMPORT`) — xem ghi chú ở đầu `App.tsx`. */
export { ProgrammingRoutes } from './ProgrammingRoutes'
