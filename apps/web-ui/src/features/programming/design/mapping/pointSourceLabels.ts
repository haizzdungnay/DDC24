import type { MappingPointRow } from './mappingViewModel'

/* ISS-PIO-09 (F-PIO-026, đề bài §29) — nhãn NGUỒN cho hàng Point.
 *
 * Hai việc tách bạch ở đây:
 *
 * 1. `category` (`LOCAL`/`VP`/`MB_RTU`) là giá trị TRÊN DÂY. Đề bài muốn người
 *    đọc thấy `PHYSICAL`/`VIRTUAL`/`MODBUS`. Đây là đổi tên một enum ĐÓNG nên
 *    FE làm được mà không phải suy diễn gì.
 *
 * 2. Quyết định `AO`/`UO` của chủ sở hữu (ghi trong thân #395): giữ `AO` xuyên
 *    suốt code / API / SHM để KHÔNG phá contract; chỉ giao diện được hiện
 *    "UO — Universal Output". Vì thế `UO` chỉ tồn tại trong hàm nhãn dưới đây
 *    và không bao giờ là một giá trị được gửi đi, so sánh, hay lưu lại.
 */

export type PointSourceKind = 'UI' | 'AO' | 'DO' | 'VP' | 'MB_RTU' | 'UNKNOWN'

/** Nhóm kênh của một hàng Point, suy từ tiền tố `pointId` của khối cấu hình
 *  sinh ra nó (`UI-01`/`AO-02`/`DO-03`). Không phải phỏng đoán: `formatPointID`
 *  ở web-api dựng chính tiền tố đó từ khối cấu hình. */
export function pointSourceKind(row: Pick<MappingPointRow, 'category' | 'pointId'>): PointSourceKind {
  if (row.category === 'VP') return 'VP'
  if (row.category === 'MB_RTU') return 'MB_RTU'
  const prefix = row.pointId.split('-', 1)[0].toUpperCase()
  return prefix === 'UI' || prefix === 'AO' || prefix === 'DO' ? prefix : 'UNKNOWN'
}

/**
 * Nhãn hiển thị của nhóm kênh. `AO` → `UO` theo quyết định của chủ sở hữu.
 *
 * `ISS-PGUI-02` — chỉ `ALL` là chữ dành cho người đọc, nên chỉ nó cần `pick`.
 * `UI`/`UO`/`DO`/`MB_RTU` là ĐỊNH DANH kỹ thuật: dịch chúng sẽ làm nhãn trên
 * màn hình không còn khớp với thứ người dùng tra trong tài liệu và API.
 */
export function pointKindLabel(
  kind: PointSourceKind | 'ALL',
  pick: (vi: string, en: string) => string,
): string {
  if (kind === 'ALL') return pick('Tất cả', 'All')
  if (kind === 'AO') return 'UO'
  if (kind === 'MB_RTU') return 'MB_RTU'
  if (kind === 'UNKNOWN') return '—'
  return kind
}

/** Vế nào cũng như nhau vì chỗ gọi duy nhất chỉ đi qua các nhánh định danh. */
const identity = (vi: string, _en: string) => vi

/** Nhãn nguồn của hàng: `PHYSICAL · UO`, `VIRTUAL`, `MODBUS · CK508-04`.
 *
 *  Thiết bị Modbus chưa có nhãn thì CHỈ hiện `MODBUS` — `bus-1-slave-3` là
 *  danh tính canonical của tầng Programming, không phải cái tên trong tủ, và
 *  đưa nó ra màn hình chính là khiếm khuyết mà issue này đang sửa. */
export function pointSourceLabel(row: Pick<MappingPointRow, 'category' | 'pointId' | 'deviceLabel'>): string {
  if (row.category === 'VP') return 'VIRTUAL'
  if (row.category === 'MB_RTU') {
    return row.deviceLabel ? `MODBUS · ${row.deviceLabel}` : 'MODBUS'
  }
  const kind = pointSourceKind(row)
  /* `pointSourceLabel` chỉ ghép ĐỊNH DANH (`PHYSICAL`/`VIRTUAL`/`MODBUS` +
     nhóm kênh), không có chữ nào dành cho người đọc — nên nó không cần `pick`.
     `identity` ở đây là một `pick` không bao giờ được gọi tới vế nào khác. */
  return kind === 'UNKNOWN' ? 'PHYSICAL' : `PHYSICAL · ${pointKindLabel(kind, identity)}`
}

/** Định danh ngắn hiện đầu hàng. Máy chủ chưa dựng được thì quay về `pointId` —
 *  hàng vẫn phải nhận diện được, và `pointId` là sự thật sẵn có gần nhất. */
export function pointDisplayId(row: Pick<MappingPointRow, 'displayId' | 'pointId'>): string {
  return row.displayId && row.displayId.trim() !== '' ? row.displayId : row.pointId
}
