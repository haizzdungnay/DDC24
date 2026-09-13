import {
  presentStRuntimeValue,
  type StRuntimeOverlayItem,
  type StRuntimeOverlayState,
  type StRuntimePresentation,
} from '../design/editor/StRuntimeValueOverlay'
import type { FbdDocument, FbdNode } from './model'

/**
 * `REV-PGM02-FE-REFACTOR-2026-09-13` — chiếu giá trị runtime lên **sơ đồ FBD**.
 *
 * VÌ SAO MODULE NÀY TỒN TẠI
 *
 * Trước lát này, canvas FBD ở chế độ LIVE chỉ vẽ topology. Người vận hành nhìn
 * thấy hình dạng chương trình nhưng không thấy một con số nào, nên muốn biết
 * PID đang ra bao nhiêu thì phải đọc khay Watch ở đáy rồi TỰ ĐỐI CHIẾU tên biến
 * với khối trên hình. Đó chính là việc mà máy phải làm, và làm bằng mắt thì sai
 * lúc nào không biết — nhất là khi hai POU được phép có biến trùng tên.
 *
 * BA LUẬT KHÔNG ĐƯỢC PHÁ
 *
 * 1. **Không diễn giải lại giá trị.** `presentStRuntimeValue` là nơi DUY NHẤT
 *    biết luật "null/BAD/OFFLINE/UNAVAILABLE không bao giờ thành 0". Module này
 *    gọi lại đúng hàm ấy; nó không tự quyết định khi nào một số là hợp lệ.
 *
 * 2. **Chưa sẵn sàng thì KHÔNG vẽ gì.** `status !== 'ready'` trả về `null`, và
 *    canvas không vẽ ô giá trị nào. Điều này quan trọng hơn vẻ ngoài: overlay
 *    `unavailable` là kết luận fail-closed của `runtimeOverlayByProgramId` khi
 *    Revision lệch hoặc dấu producer không đọc được — tức "số này có thể không
 *    thuộc sơ đồ đang hiện". Vẽ số cũ lên một topology khác là đúng thứ
 *    `AC-FBD-010` tồn tại để cấm.
 *
 * 3. **Ánh xạ theo DANH TÍNH đã khai trong tài liệu, không đoán.** Nút vào/ra
 *    mang `parameters.variable`; khối hàm mang `parameters.instance` và chân của
 *    nó đọc theo `instance.PORT`. Không có danh tính thì không có giá trị —
 *    không suy từ vị trí, không suy từ kiểu dữ liệu.
 */

export interface FbdRuntimeReading {
  /** Đã trình bày xong; `—` khi authority nói không đọc được. */
  display: string
  state: StRuntimePresentation['state']
  /** Đơn vị kỹ thuật, `null` khi nguồn không công bố. */
  unit: string | null
  /** Tên biến/chân đã khớp — dùng cho `title` và cho trình đọc màn hình. */
  name: string
}

export interface FbdRuntimeOverlay {
  /** Giá trị tiêu biểu của cả khối (ưu tiên chân ra đầu tiên). */
  byNodeId: ReadonlyMap<string, FbdRuntimeReading>
  /** Giá trị tại từng chân, cho khối hàm có nhiều đầu ra. */
  byPortId: ReadonlyMap<string, FbdRuntimeReading>
}

function readingFor(item: StRuntimeOverlayItem): FbdRuntimeReading {
  const presented = presentStRuntimeValue(item)
  return {
    display: presented.displayValue,
    state: presented.state,
    /* Đơn vị chỉ đi kèm một giá trị THẬT. `— °C` đọc như một phép đo bằng không
       độ C, trong khi nó là "không đọc được". */
    unit: presented.state === 'invalid' ? null : (item.unit ?? null),
    name: item.variableName,
  }
}

function textParameter(node: FbdNode, key: string): string | null {
  const value = node.parameters[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Danh tính runtime của một node, theo đúng những gì tài liệu khai.
 *
 * `CONSTANT` cố ý KHÔNG có: giá trị của nó nằm ngay trong tài liệu và đã vẽ
 * trên khối; hỏi runtime về nó là mở một đường cho hai con số khác nhau về cùng
 * một hằng số.
 */
export function fbdNodeRuntimeName(node: FbdNode): string | null {
  switch (node.kind) {
    case 'INPUT':
    case 'OUTPUT':
      return textParameter(node, 'variable')
    case 'SIGNAL_READ':
    case 'SIGNAL_PUBLISH':
      return textParameter(node, 'signal') ?? textParameter(node, 'variable')
    case 'FUNCTION_BLOCK':
      return textParameter(node, 'instance')
    default:
      return null
  }
}

export function buildFbdRuntimeOverlay(
  document: FbdDocument,
  overlay: StRuntimeOverlayState | null | undefined,
): FbdRuntimeOverlay | null {
  if (!overlay || overlay.status !== 'ready') return null

  const byName = new Map<string, StRuntimeOverlayItem>()
  for (const item of overlay.items) {
    /* Trùng tên trong cùng một POU không được phép lặng lẽ chọn bừa. Giữ bản
       ĐẦU TIÊN (danh sách đã sắp xếp tất định ở `runtimeOverlayByProgramId`) để
       hai lần mở cùng một trang cho cùng một kết quả. */
    if (!byName.has(item.variableName)) byName.set(item.variableName, item)
  }

  const byNodeId = new Map<string, FbdRuntimeReading>()
  const byPortId = new Map<string, FbdRuntimeReading>()

  for (const network of document.networks) {
    for (const node of network.nodes) {
      const identity = fbdNodeRuntimeName(node)
      if (identity === null) continue

      if (node.kind === 'FUNCTION_BLOCK') {
        /* Khối hàm không có MỘT giá trị: nó có một giá trị cho mỗi chân. Đọc
           theo `instance.PORT` — đúng cách Core đặt tên biến của instance. */
        let representative: FbdRuntimeReading | null = null
        for (const port of node.ports) {
          const item = byName.get(`${identity}.${port.name}`)
          if (!item) continue
          const reading = readingFor(item)
          byPortId.set(port.id, reading)
          if (representative === null && port.direction === 'OUTPUT') representative = reading
        }
        if (representative !== null) byNodeId.set(node.id, representative)
        continue
      }

      const item = byName.get(identity)
      if (!item) continue
      const reading = readingFor(item)
      byNodeId.set(node.id, reading)
      /* Nút vào/ra có đúng một chân, nên giá trị của nút cũng là giá trị của
         chân ấy — tiện cho việc tô dây theo trạng thái sau này. */
      for (const port of node.ports) byPortId.set(port.id, reading)
    }
  }

  if (byNodeId.size === 0 && byPortId.size === 0) return null
  return { byNodeId, byPortId }
}
