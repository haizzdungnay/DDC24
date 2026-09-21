import type { FbdSelection } from './commands'
import type { FbdDocument, FbdIssue } from './model'
import type { ProgrammingDiagnostic } from '../model/types'

/**
 * `T59-806` / `AC-FBD-007` — "Problems jump to exact block/wire".
 *
 * Validator đã trả về đúng vị trí lỗi dưới dạng đường dẫn JSON
 * (`$.networks[0].nodes[2].typeRef`), nhưng UI chỉ hiện một con số "3 lỗi
 * Draft". Người dùng có toạ độ chính xác của lỗi mà vẫn phải tự đi tìm.
 *
 * Module này dịch đường dẫn đó thành một `FbdSelection` để canvas nhảy tới.
 * Đường dẫn không phân giải được trả `null` — **không đoán**: đưa người dùng
 * tới nhầm block tốn thời gian hơn là nói thẳng "lỗi này không neo vào block
 * nào".
 */

const PATH_SEGMENT = /^\$\.networks\[(\d+)\](?:\.(nodes|wires)\[(\d+)\])?/

export interface FbdIssueTarget {
  issue: FbdIssue
  selection: FbdSelection | null
  /** Nhãn ngắn cho danh sách: `NETWORK_1 › #2 AND` hoặc `NETWORK_1 › dây 3`. */
  label: string | null
}

export function fbdIssueTarget(document: FbdDocument, issue: FbdIssue): FbdIssueTarget {
  const match = PATH_SEGMENT.exec(issue.path)
  if (!match) return { issue, selection: null, label: null }

  const network = document.networks[Number(match[1])]
  if (!network) return { issue, selection: null, label: null }

  const collection = match[2]
  const index = match[3] === undefined ? -1 : Number(match[3])

  if (collection === 'nodes') {
    const node = network.nodes[index]
    if (!node) return { issue, selection: null, label: null }
    return {
      issue,
      selection: { kind: 'node', networkId: network.id, nodeId: node.id },
      label: `${network.name} › #${node.executionOrder} ${node.typeRef}`,
    }
  }

  if (collection === 'wires') {
    const wire = network.wires[index]
    if (!wire) return { issue, selection: null, label: null }
    return {
      issue,
      selection: { kind: 'wire', networkId: network.id, wireId: wire.id },
      label: `${network.name} › ${wire.id.slice(0, 8)}`,
    }
  }

  return {
    issue,
    selection: { kind: 'network', networkId: network.id },
    label: network.name,
  }
}

export function fbdIssueTargets(document: FbdDocument, issues: readonly FbdIssue[]): FbdIssueTarget[] {
  return issues.map((issue) => fbdIssueTarget(document, issue))
}

export function extractDiagnosticNodeId(
  diagnostic: ProgrammingDiagnostic,
  document: FbdDocument
): string | null {
  const loc = diagnostic.location as Record<string, unknown> | undefined
  const args = diagnostic.args as Record<string, unknown> | undefined

  if (typeof loc?.nodeId === 'string') return loc.nodeId
  if (typeof loc?.blockId === 'string') return loc.blockId
  if (typeof args?.nodeId === 'string') return args.nodeId
  if (typeof args?.blockId === 'string') return args.blockId

  if (typeof loc?.path === 'string') {
    const match = PATH_SEGMENT.exec(loc.path)
    if (match && match[2] === 'nodes' && match[3] !== undefined) {
      const net = document.networks[Number(match[1])]
      const node = net?.nodes[Number(match[3])]
      if (node) return node.id
    }
  }

  if (typeof loc?.line === 'number') {
    for (const net of document.networks) {
      const node = net.nodes.find((n) => n.executionOrder === loc.line)
      if (node) return node.id
    }
  }

  return null
}

