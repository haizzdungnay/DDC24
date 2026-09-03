import { IS_DEMO } from '../config'
import { requestJson } from './client'

/* `ISS-PIO-13` — FE dựng số kênh và dropdown mode TỪ CAPABILITY.
 *
 * Đề bài §6.1: *"Hardware capability phải do firmware/backend cấp. FE không được
 * hard-code số channel hoặc mode."* Trước tệp này, FE liệt kê cứng `signalType
 * 0..8` cho MỌI kênh — kể cả `7 = ánh sáng` và `8 = xung` vốn phụ thuộc mạch —
 * và `VISIBLE_UI_CHANNELS = 16` là nguồn sự thật thứ tư cho số kênh
 * (`F-PIO-008`/`F-PIO-009`).
 *
 * Nguồn dữ liệu là `GET /api/v1/system/capabilities` (`ISS-PIO-12`), gốc xa hơn
 * là `BOARD_CAP_MAP` do MCU trả ở handshake IOP (`ISS-PIO-11`). */

export type CapabilityAvailability = 'confirmed' | 'unverified' | 'withheld'
export type CapabilityPresence = 'yes' | 'no' | 'unknown'
export type CapabilityKind = 'UI' | 'DI' | 'AO' | 'DO'

export interface CapabilityMode {
  id: string
  availability: CapabilityAvailability
  reason?: string
}

export interface CapabilityChannel {
  id: string
  index: number
  modes: CapabilityMode[]
}

export interface CapabilityBlock {
  kind: CapabilityKind
  presence: CapabilityPresence
  /** Số kênh THẬT SỰ công bố, không phải sức chứa ABI. */
  count: number
  abi_capacity: number
  optional: boolean
  channels: CapabilityChannel[]
}

export interface SystemCapabilities {
  /** `false` = CHƯA HỎI ĐƯỢC bo. KHÔNG có nghĩa "bo không có năng lực nào". */
  board_cap_known: boolean
  board_cap_map?: string
  blocks: CapabilityBlock[]
}

/* Nhóm mode điện của giao diện. Khai báo ở ĐÂY chứ không ở `InputsPage` vì nó
 * phải đi cùng bảng ánh xạ sang mã hợp đồng ngay dưới — tách hai thứ đó ra hai
 * tệp là cách chúng lệch nhau. */
export type ElectricalMode = 'none' | 'volt' | 'voltCurrent' | 'resistance' | 'dry' | 'potentiometer' | 'light' | 'pulse'

export const electricalModes: ElectricalMode[] = ['none', 'volt', 'voltCurrent', 'resistance', 'dry', 'potentiometer', 'light', 'pulse']

/* Một nhóm mode của giao diện gộp NHIỀU mã hợp đồng. `resistance` là ví dụ rõ
 * nhất: nó gộp cả PT100/PT1000 (đòi `IOP_BOARD_CAP_RTD`) lẫn NTC10k/NTC20k
 * (không có bit năng lực nào phủ). Vì thế mức tin cậy của một NHÓM không đọc
 * được từ một mode đơn lẻ nào. */
const electricalModeContractIds: Record<ElectricalMode, string[]> = {
  none: ['none'],
  volt: ['0-10V'],
  voltCurrent: ['2-10V', '4-20mA'],
  resistance: ['PT100', 'PT1000', 'NTC10k', 'NTC20k'],
  dry: ['dry'],
  potentiometer: ['potentiometer'],
  light: ['light'],
  pulse: ['pulse']
}

export interface ElectricalModeAvailability {
  availability: CapabilityAvailability
  /** Lý do của những mã hợp đồng KHÔNG được xác nhận trong nhóm. Hiện lên
   *  tooltip để người vận hành biết mình đang chọn một mode chưa ai xác nhận. */
  reasons: string[]
}

const availabilityRank: Record<CapabilityAvailability, number> = {
  confirmed: 2,
  unverified: 1,
  withheld: 0
}

const NO_CAPABILITY_REASON = 'chưa đọc được /api/v1/system/capabilities nên chưa xác nhận được bằng bo'

export async function fetchSystemCapabilities(): Promise<SystemCapabilities> {
  if (IS_DEMO) return demoCapabilities()
  const payload = await requestJson<SystemCapabilities>('/system/capabilities', { cache: 'no-store', suppressAuthExpired: true })
  return { ...payload, blocks: payload?.blocks ?? [] }
}

export function capabilityBlock(doc: SystemCapabilities | null, kind: CapabilityKind): CapabilityBlock | undefined {
  return doc?.blocks?.find((block) => block.kind === kind)
}

/**
 * Số kênh của KHÔNG GIAN ĐIỂM Universal Input, tức UI cộng DI.
 *
 * Backend công bố DI thành một khối riêng nhưng định danh kênh của nó nằm trong
 * chính không gian UI (`UI-17`..`UI-24`, xem `internal/capabilities`), nên trần
 * kênh mà giao diện dùng để lọc điểm là TỔNG hai khối — không phải riêng UI.
 *
 * Trả `null` khi chưa có tài liệu capability: nơi gọi phải tự chọn cách xoay xở
 * (thường là suy từ chính danh sách cấu hình mà backend trả), chứ tuyệt đối
 * không rơi về một hằng viết cứng — đó đúng là thứ `ISS-PIO-13` đang dẹp.
 */
export function universalInputChannelCount(doc: SystemCapabilities | null): number | null {
  if (!doc) return null
  const ui = capabilityBlock(doc, 'UI')
  const di = capabilityBlock(doc, 'DI')
  if (!ui && !di) return null
  return (ui?.count ?? 0) + (di?.count ?? 0)
}

/**
 * Mức tin cậy của một nhóm mode điện trên kênh UI.
 *
 * Lấy mức TỐT NHẤT trong nhóm: chỉ cần một mã hợp đồng còn dùng được thì nhóm
 * còn dùng được. Nhưng lý do của những mã KHÔNG được xác nhận vẫn được giữ lại
 * và hiện ra — `resistance` trên bo không có mạch RTD vẫn chọn được (nhờ NTC)
 * nhưng người vận hành phải thấy rằng PT100/PT1000 đã bị giữ lại.
 *
 * Không có tài liệu capability ⇒ `unverified` chứ KHÔNG phải `withheld`: giấu
 * hết mode chỉ vì một lần gọi mạng hỏng sẽ khoá cứng trang cấu hình, trong khi
 * đường ghi phía backend vẫn chặn đúng chỗ cần chặn.
 */
export function electricalModeAvailability(doc: SystemCapabilities | null, mode: ElectricalMode): ElectricalModeAvailability {
  const contractIds = electricalModeContractIds[mode]
  if (!doc) return { availability: 'unverified', reasons: [NO_CAPABILITY_REASON] }
  const ui = capabilityBlock(doc, 'UI')
  const channel = ui?.channels?.[0]
  if (!channel) {
    // Bo nói KHÔNG có khối UI (hoặc tài liệu rỗng): không có kênh nào để cấu hình.
    return { availability: ui?.presence === 'no' ? 'withheld' : 'unverified', reasons: [NO_CAPABILITY_REASON] }
  }
  let best: CapabilityAvailability = 'withheld'
  const reasons: string[] = []
  for (const id of contractIds) {
    const found = channel.modes.find((item) => item.id === id)
    if (!found) continue
    if (availabilityRank[found.availability] > availabilityRank[best]) best = found.availability
    if (found.availability !== 'confirmed' && found.reason && !reasons.includes(found.reason)) reasons.push(found.reason)
  }
  return { availability: best, reasons }
}

/** Mode được PHÉP hiện trong dropdown. `withheld` nghĩa là có bằng chứng nó
 *  không dùng được, hoặc nó đòi bằng chứng mà chưa ai hỏi — cả hai đều không
 *  được mời chọn (đề bài §6.1). */
export function isElectricalModeOffered(doc: SystemCapabilities | null, mode: ElectricalMode): boolean {
  return electricalModeAvailability(doc, mode).availability !== 'withheld'
}

function demoCapabilities(): SystemCapabilities {
  // Base SKU Rev A: 16 UI + 4 AO + 4 DO, KHÔNG module DI, KHÔNG mạch RTD.
  const uiModes: CapabilityMode[] = [
    { id: 'none', availability: 'confirmed' },
    { id: '0-10V', availability: 'confirmed' },
    { id: '2-10V', availability: 'confirmed' },
    { id: '4-20mA', availability: 'confirmed' },
    { id: 'PT100', availability: 'withheld', reason: 'IOP_BOARD_CAP_RTD không có trong BOARD_CAP_MAP: bo không gắn mạch nhiệt trở' },
    { id: 'PT1000', availability: 'withheld', reason: 'IOP_BOARD_CAP_RTD không có trong BOARD_CAP_MAP: bo không gắn mạch nhiệt trở' },
    { id: 'NTC10k', availability: 'unverified', reason: 'hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo' },
    { id: 'NTC20k', availability: 'unverified', reason: 'hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo' },
    { id: 'dry', availability: 'confirmed' },
    { id: 'potentiometer', availability: 'unverified', reason: 'hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo' },
    { id: 'light', availability: 'unverified', reason: 'hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo' },
    { id: 'pulse', availability: 'unverified', reason: 'hợp đồng IOP chưa có bit năng lực cho mode này nên không xác nhận được bằng bo' }
  ]
  return {
    board_cap_known: true,
    board_cap_map: '0x000D',
    blocks: [
      {
        kind: 'UI',
        presence: 'yes',
        count: 16,
        abi_capacity: 16,
        optional: false,
        channels: Array.from({ length: 16 }, (_, index) => ({ id: `UI-${String(index + 1).padStart(2, '0')}`, index: index + 1, modes: uiModes }))
      },
      { kind: 'DI', presence: 'no', count: 0, abi_capacity: 8, optional: true, channels: [] },
      {
        kind: 'AO',
        presence: 'yes',
        count: 4,
        abi_capacity: 4,
        optional: false,
        channels: Array.from({ length: 4 }, (_, index) => ({
          id: `AO-${String(index + 1).padStart(2, '0')}`,
          index: index + 1,
          modes: [{ id: '0-10V', availability: 'confirmed' }, { id: '4-20mA', availability: 'confirmed' }]
        }))
      },
      {
        kind: 'DO',
        presence: 'yes',
        count: 4,
        abi_capacity: 4,
        optional: false,
        channels: Array.from({ length: 4 }, (_, index) => ({
          id: `DO-${String(index + 1).padStart(2, '0')}`,
          index: index + 1,
          modes: [{ id: 'open', availability: 'confirmed' }, { id: 'closed', availability: 'confirmed' }]
        }))
      }
    ]
  }
}

/**
 * Kênh vật lý này có được bo XÁC NHẬN là tồn tại không?
 *
 * - `true`  — bo công bố đúng kênh này.
 * - `false` — định danh trông như kênh cục bộ (`UI-`/`AO-`/`DO-`) nhưng KHÔNG
 *   nằm trong danh sách bo công bố: hoặc bo không có, hoặc chưa xác nhận.
 * - `null`  — không phải kênh trên bo (Virtual Point, điểm Modbus của thiết bị
 *   ngoài), nên `BOARD_CAP_MAP` không có thẩm quyền gì ở đây.
 *
 * Ba giá trị chứ không hai: gộp "không áp dụng" vào "không có" sẽ khiến mọi
 * điểm VP và Modbus bị loại oan khỏi gợi ý.
 */
export function boardChannelConfirmed(doc: SystemCapabilities | null, pointId: string): boolean | null {
  const id = pointId.trim().toUpperCase()
  if (!/^(UI|AI|DI|AO|DO)-?\d+$/.test(id)) return null
  if (!doc) return false
  for (const block of doc.blocks ?? []) {
    if (block.channels.some((channel) => channel.id.toUpperCase() === id)) return true
  }
  return false
}
