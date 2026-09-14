/**
 * Bộ máy nối dây của canvas FBD — phần THUẦN, không đọc DOM.
 *
 * Trước bản này, một cử chỉ kéo dây chỉ thành công khi con trỏ nhả ra ĐÚNG
 * trên `<circle r="4">` của cổng đích: chỉ phần tử đó mang `onPointerUp` tạo
 * dây. Nhả lệch 5 px — rơi vào thân khối, vào nhãn cổng, vào lưới — thì cử chỉ
 * bị `window` huỷ lặng lẽ, không dây, không thông báo. Đó là lý do "không kéo
 * được dây" dù reducer `ADD_WIRE` vẫn đúng: lỗi nằm ở phép BẮT ĐÍCH, không nằm
 * ở phép ghi.
 *
 * Module này đưa phép bắt đích về TOẠ ĐỘ: cho một điểm con trỏ trong hệ graph,
 * nó trả về cổng đích tốt nhất kèm phán quyết hợp lệ/không hợp lệ và mã lý do.
 * Nhờ đó canvas quyết định được ba việc mà trước đây không làm nổi — hiện dây
 * xem trước đúng màu, bám (snap) vào cổng gần nhất, và nói ra lý do khi từ chối
 * — mà vẫn dùng CHÍNH `validateFbdWireCandidate` của reducer làm thẩm quyền,
 * nên không sinh ra tập luật thứ hai lệch với nơi ghi thật.
 */
import { validateFbdWireCandidate, type FbdWireRejection } from './commands'
import type { FbdNetworkGeometry, FbdNodeGeometry, FbdPortGeometry } from './geometry'
import type { FbdDocument, FbdNetwork, FbdPoint, FbdWire } from './model'

/** Bán kính vùng bắt con trỏ của một cổng, theo đơn vị graph. Lớn hơn hẳn bán
 * kính vẽ (4 px) vì đích ngắm phải rộng hơn hình vẽ — chuẩn của mọi editor sơ
 * đồ, và là điều kiện để kéo dây bằng chuột không đòi độ chính xác pixel. */
export const FBD_PORT_HIT_RADIUS = 13

/** Khoảng bám của cử chỉ kéo dây. Ngoài bán kính này, con trỏ vẫn có thể bắt
 * đích qua thân khối (xem `resolveWireDropTarget`). */
export const FBD_WIRE_SNAP_RADIUS = 34

export interface FbdWireEndpoints {
  sourcePortId: string
  targetPortId: string
}

/**
 * Chuẩn hoá chiều của một cặp cổng thành (nguồn OUTPUT, đích INPUT).
 *
 * Người dùng kéo từ đầu nào cũng được — kéo ngược từ IN về OUT là thao tác
 * quen của mọi editor sơ đồ. Mô hình dữ liệu thì chỉ có một chiều, nên phép
 * chuẩn hoá phải nằm ở đây chứ không rải trong handler.
 */
export function orientWireEndpoints(
  a: Pick<FbdPortGeometry, 'id' | 'direction'>,
  b: Pick<FbdPortGeometry, 'id' | 'direction'>,
): FbdWireEndpoints | null {
  if (a.id === b.id) return null
  if (a.direction === 'OUTPUT' && b.direction === 'INPUT') {
    return { sourcePortId: a.id, targetPortId: b.id }
  }
  if (a.direction === 'INPUT' && b.direction === 'OUTPUT') {
    return { sourcePortId: b.id, targetPortId: a.id }
  }
  return null
}

/** Dựng dây ứng viên đúng hình dạng mà `validateFbdWireCandidate` đòi
 * (endpoint phải khớp cả nodeId lẫn portId). `wireId` do phía gọi cấp và giữ
 * NGUYÊN suốt một cử chỉ kéo: nếu sinh id mới mỗi frame thì phán quyết hợp lệ
 * hiện trên màn hình không còn là phán quyết của dây sẽ được ghi. */
export function buildCandidateWire(
  document: FbdDocument,
  endpoints: FbdWireEndpoints,
  wireId: string,
): FbdWire | null {
  const source = findPortOwner(document, endpoints.sourcePortId)
  const target = findPortOwner(document, endpoints.targetPortId)
  if (!source || !target) return null
  return {
    id: wireId,
    from: { nodeId: source.nodeId, portId: endpoints.sourcePortId },
    to: { nodeId: target.nodeId, portId: endpoints.targetPortId },
  }
}

function findPortOwner(document: FbdDocument, portId: string): { nodeId: string } | null {
  for (const network of document.networks) {
    for (const node of network.nodes) {
      if (node.ports.some((port) => port.id === portId)) return { nodeId: node.id }
    }
  }
  return null
}

export interface FbdWireVerdict {
  ok: boolean
  code: FbdWireRejection | null
  wire: FbdWire | null
}

/** Phán quyết một cặp cổng bằng CHÍNH validator của reducer. */
export function evaluateWireCandidate(
  document: FbdDocument,
  endpoints: FbdWireEndpoints,
  wireId: string,
): FbdWireVerdict {
  const wire = buildCandidateWire(document, endpoints, wireId)
  if (!wire) return { ok: false, code: 'port-not-found', wire: null }
  const result = validateFbdWireCandidate(document, endpoints.sourcePortId, endpoints.targetPortId, wire)
  return result.ok ? { ok: true, code: null, wire } : { ok: false, code: result.code, wire }
}

export interface FbdWireCandidate {
  /** Cổng đích đã bắt được. */
  port: FbdPortGeometry
  endpoints: FbdWireEndpoints
  /** Dây sẽ được ghi nếu người dùng nhả chuột ở đây. */
  wire: FbdWire
  ok: boolean
  code: FbdWireRejection | null
  /** `port` — bắt trực tiếp theo khoảng cách; `node` — bắt qua thân khối. */
  via: 'port' | 'node'
}

export interface ResolveWireDropOptions {
  document: FbdDocument
  network: FbdNetwork
  geometry: Pick<FbdNetworkGeometry, 'nodes'>
  source: FbdPortGeometry
  cursor: FbdPoint
  wireId: string
  snapRadius?: number
}

/**
 * Cổng đích tốt nhất cho một cử chỉ kéo dây đang diễn ra.
 *
 * Hai tầng bắt đích, theo đúng thứ tự người dùng kỳ vọng:
 *
 * 1. **Theo cổng** — cổng ngược chiều gần con trỏ nhất trong `snapRadius`.
 *    Ứng viên HỢP LỆ luôn thắng ứng viên không hợp lệ dù xa hơn: bám vào một
 *    cổng chắc chắn bị từ chối là dẫn người dùng vào chỗ chết.
 * 2. **Theo thân khối** — con trỏ ở trong hộp một khối thì chọn cổng ngược
 *    chiều đầu tiên còn nối được của khối đó. "Kéo dây vào khối" là cách người
 *    ta thật sự thao tác khi chưa cần chọn đúng chân nào.
 *
 * Trả về ứng viên KHÔNG hợp lệ (kèm mã) thay vì `null` khi đã bắt được đích:
 * "sai chỗ này vì lý do X" là phản hồi, còn `null` thì màn hình im lặng.
 */
export function resolveWireDropTarget(options: ResolveWireDropOptions): FbdWireCandidate | null {
  const { document, network, geometry, source, cursor, wireId } = options
  const snapRadius = options.snapRadius ?? FBD_WIRE_SNAP_RADIUS
  const wanted = source.direction === 'OUTPUT' ? 'INPUT' : 'OUTPUT'

  let best: (FbdWireCandidate & { distance: number }) | null = null

  for (const node of geometry.nodes) {
    for (const port of node.ports) {
      if (port.id === source.id || port.direction !== wanted) continue
      const distance = Math.hypot(port.cx - cursor.x, port.cy - cursor.y)
      if (distance > snapRadius) continue
      const candidate = judge(document, source, port, wireId, 'port')
      if (!candidate) continue
      if (best === null || betterThan({ ...candidate, distance }, best)) {
        best = { ...candidate, distance }
      }
    }
  }

  if (best) {
    const { distance: _distance, ...candidate } = best
    return candidate
  }

  const hovered = nodeAtPoint(geometry.nodes, cursor)
  if (!hovered) return null
  const node = network.nodes.find((item) => item.id === hovered.id)
  if (!node) return null

  const ports = hovered.ports.filter((port) => port.direction === wanted && port.id !== source.id)
  let fallback: FbdWireCandidate | null = null
  for (const port of ports) {
    const candidate = judge(document, source, port, wireId, 'node')
    if (!candidate) continue
    if (candidate.ok) return candidate
    if (fallback === null) fallback = candidate
  }
  return fallback
}

function judge(
  document: FbdDocument,
  source: FbdPortGeometry,
  port: FbdPortGeometry,
  wireId: string,
  via: 'port' | 'node',
): FbdWireCandidate | null {
  const endpoints = orientWireEndpoints(source, port)
  if (!endpoints) return null
  const verdict = evaluateWireCandidate(document, endpoints, wireId)
  if (!verdict.wire) return null
  return { port, endpoints, wire: verdict.wire, ok: verdict.ok, code: verdict.code, via }
}

function betterThan(
  next: FbdWireCandidate & { distance: number },
  current: FbdWireCandidate & { distance: number },
): boolean {
  if (next.ok !== current.ok) return next.ok
  return next.distance < current.distance
}

/** Khối nằm dưới một điểm graph; khối vẽ sau (ở trên) thắng. */
export function nodeAtPoint(
  nodes: readonly FbdNodeGeometry[],
  point: FbdPoint,
): FbdNodeGeometry | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (
      point.x >= node.x &&
      point.x <= node.x + node.width &&
      point.y >= node.y &&
      point.y <= node.y + node.height
    ) {
      return node
    }
  }
  return null
}

/** Cổng nằm dưới một điểm graph, trong `FBD_PORT_HIT_RADIUS`. */
export function portAtPoint(
  nodes: readonly FbdNodeGeometry[],
  point: FbdPoint,
  radius = FBD_PORT_HIT_RADIUS,
): FbdPortGeometry | null {
  let best: FbdPortGeometry | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const node of nodes) {
    for (const port of node.ports) {
      const distance = Math.hypot(port.cx - point.x, port.cy - point.y)
      if (distance <= radius && distance < bestDistance) {
        best = port
        bestDistance = distance
      }
    }
  }
  return best
}

/**
 * Lý do từ chối, viết cho người đang kéo chuột.
 *
 * `translateFbdAnnouncement` đã có bản dịch cho các mã này, nhưng nó nói ở
 * thời quá khứ ("không nối được") và chỉ phát vào vùng `aria-live`. Trong lúc
 * kéo, câu cần nói là ĐIỀU KIỆN còn thiếu, và nó phải hiện ra mắt thường.
 */
export function describeWireRejection(
  code: FbdWireRejection | null,
  pick: (vi: string, en: string) => string,
): string {
  switch (code) {
    case 'select-output-port':
      return pick('Phải bắt đầu từ cổng ra (OUT).', 'Start from an output (OUT) port.')
    case 'connect-incompatible':
      return pick('Cổng không tương thích: khác chiều, khác kiểu dữ liệu hoặc khác đơn vị.', 'Incompatible ports: different direction, data type or unit.')
    case 'connect-reverse-order':
      return pick('Nối ngược thứ tự thực thi: khối nguồn phải chạy trước khối đích.', 'Reverse execution order: the source block must run before the target.')
    case 'input-has-driver-or-limit':
      return pick('Cổng vào đã có dây điều khiển, hoặc đã đạt trần số dây.', 'That input already has a driver, or the wire limit is reached.')
    case 'port-not-found':
      return pick('Không tìm thấy cổng đích.', 'The target port no longer exists.')
    case 'wire-mismatch':
    case 'wire-uuid-invalid':
      return pick('Dây ứng viên không hợp lệ; thử kéo lại.', 'The candidate wire is invalid; try the drag again.')
    default:
      return pick('Không thể nối hai cổng này.', 'These two ports cannot be connected.')
  }
}
