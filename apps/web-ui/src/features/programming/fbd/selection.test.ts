import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import type { FbdDocument, FbdPoint, FbdSelection } from './commands'
import {
  boxSelectNodes,
  copySubgraph,
  createPastedSubgraph,
  getSelectedNodeIds,
  isNodeSelected,
  toggleNodeSelection,
} from './selection'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

describe('selection helpers FBD', () => {
  describe('toggleNodeSelection', () => {
    it('mode replace: trả về mảng chứa duy nhất targetId', () => {
      expect(toggleNodeSelection(['node-1', 'node-2'], 'node-3', 'replace')).toEqual(['node-3'])
    })

    it('mode toggle: thêm nếu chưa có, xóa nếu đã có, luôn sort tất định', () => {
      expect(toggleNodeSelection(['node-b'], 'node-a', 'toggle')).toEqual(['node-a', 'node-b'])
      expect(toggleNodeSelection(['node-a', 'node-b', 'node-c'], 'node-b', 'toggle')).toEqual(['node-a', 'node-c'])
    })

    it('mode range: chọn dải giữa anchor và target theo allOrderedIds', () => {
      const all = ['n1', 'n2', 'n3', 'n4', 'n5']
      expect(toggleNodeSelection([], 'n2', 'range', all)).toEqual(['n2'])
      expect(toggleNodeSelection(['n2'], 'n4', 'range', all)).toEqual(['n2', 'n3', 'n4'])
      expect(toggleNodeSelection(['n4'], 'n2', 'range', all)).toEqual(['n2', 'n3', 'n4'])
      expect(toggleNodeSelection(['n2'], 'unknown', 'range', all)).toEqual(['unknown'])
    })
  })

  describe('boxSelectNodes', () => {
    const nodes = [
      { id: 'b', x: 10, y: 10, width: 50, height: 50 },
      { id: 'a', x: 100, y: 100, width: 50, height: 50 },
      { id: 'c', x: 200, y: 200, width: 50, height: 50 },
    ]

    it('mode intersect: chọn các node chạm hoặc nằm trong box, sort tất định', () => {
      const box = { left: 0, top: 0, width: 70, height: 70 }
      expect(boxSelectNodes(nodes, box, 'intersect')).toEqual(['b'])
      const bigBox = { left: 0, top: 0, width: 160, height: 160 }
      expect(boxSelectNodes(nodes, bigBox, 'intersect')).toEqual(['a', 'b'])
    })

    it('mode contain: chỉ chọn node nằm trọn vẹn trong box', () => {
      const boxPartial = { left: 20, top: 20, width: 100, height: 100 }
      expect(boxSelectNodes(nodes, boxPartial, 'contain')).toEqual([])
      const boxFull = { left: 90, top: 90, width: 70, height: 70 }
      expect(boxSelectNodes(nodes, boxFull, 'contain')).toEqual(['a'])
    })
  })

  describe('isNodeSelected & getSelectedNodeIds', () => {
    it('xử lý selection null', () => {
      expect(isNodeSelected(null, 'node-1')).toBe(false)
      expect(getSelectedNodeIds(null)).toEqual([])
    })

    it('xử lý kind node', () => {
      const sel: FbdSelection = { kind: 'node', networkId: 'net-1', nodeId: 'node-1' }
      expect(isNodeSelected(sel, 'node-1')).toBe(true)
      expect(isNodeSelected(sel, 'node-2')).toBe(false)
      expect(getSelectedNodeIds(sel)).toEqual(['node-1'])
    })

    it('xử lý kind multi-node', () => {
      const sel: FbdSelection = { kind: 'multi-node', networkId: 'net-1', nodeIds: ['n-b', 'n-a'] }
      expect(isNodeSelected(sel, 'n-a')).toBe(true)
      expect(isNodeSelected(sel, 'n-b')).toBe(true)
      expect(isNodeSelected(sel, 'n-c')).toBe(false)
      expect(getSelectedNodeIds(sel)).toEqual(['n-a', 'n-b'])
    })

    it('xử lý kind khác: port, wire, network', () => {
      const portSel: FbdSelection = { kind: 'port', networkId: 'net-1', nodeId: 'node-1', portId: 'p-1' }
      expect(isNodeSelected(portSel, 'node-1')).toBe(false)
      expect(getSelectedNodeIds(portSel)).toEqual([])
    })
  })

  describe('copySubgraph & createPastedSubgraph', () => {
    const doc: FbdDocument = {
      ...golden(),
      layout: {
        schemaVersion: 1,
        nodes: {
          '30000000-0000-4000-8000-000000000001': { x: 50, y: 50 },
          '30000000-0000-4000-8000-000000000002': { x: 150, y: 50 },
          '30000000-0000-4000-8000-000000000003': { x: 250, y: 50 },
        },
      },
    }

    it('copySubgraph chỉ trích xuất internal wires và layoutNodes', () => {
      const netId = doc.networks[0].id
      // ahu_fan_enable có wire1: node0->node2, wire2: node1->node2, wire3: node2->node3
      // Chọn node0 và node2 -> wire1 là internal wire, wire2 và wire3 bị loại
      const node0 = doc.networks[0].nodes[0].id
      const node2 = doc.networks[0].nodes[2].id
      const copied = copySubgraph(doc, netId, [node0, node2])
      expect(copied).not.toBeNull()
      expect(copied?.nodes).toHaveLength(2)
      expect(copied?.internalWires).toHaveLength(1)
      expect(copied?.internalWires[0].id).toBe('50000000-0000-4000-8000-000000000001')
      expect(copied?.layoutNodes).toEqual({
        [node0]: { x: 50, y: 50 },
        [node2]: { x: 250, y: 50 },
      })

      // Network không tồn tại hoặc nodeIds rỗng -> trả về null
      expect(copySubgraph(doc, 'unknown-net', [node0])).toBeNull()
      expect(copySubgraph(doc, netId, [])).toBeNull()
      expect(copySubgraph(doc, netId, ['unknown-node'])).toBeNull()
    })

    it('createPastedSubgraph remap UUID cho node, port, wire và cộng offset', () => {
      const netId = doc.networks[0].id
      const node0 = doc.networks[0].nodes[0].id
      const node2 = doc.networks[0].nodes[2].id
      const copied = copySubgraph(doc, netId, [node0, node2])!

      let counter = 100
      const uuidGen = () => `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, '0')}`

      const offset: FbdPoint = { x: 20, y: 30 }
      const pasted = createPastedSubgraph(copied, offset, uuidGen)

      expect(pasted.nodes).toHaveLength(2)
      expect(pasted.wires).toHaveLength(1)
      expect(pasted.remappedNodeIds).toHaveLength(2)

      const newNode1 = pasted.nodes[0]
      const newNode2 = pasted.nodes[1]
      expect(newNode1.id).not.toBe(copied.nodes[0].id)
      expect(newNode2.id).not.toBe(copied.nodes[1].id)

      // Wire endpoint được remap đúng
      const wire = pasted.wires[0]
      expect(wire.from.nodeId).toBe(newNode1.id)
      expect(wire.from.portId).toBe(newNode1.ports[0].id)
      expect(wire.to.nodeId).toBe(newNode2.id)
      expect(wire.to.portId).toBe(newNode2.ports[0].id)

      // Layout được cộng offset
      expect(pasted.layoutNodes[newNode1.id]).toEqual({ x: 70, y: 80 })
      expect(pasted.layoutNodes[newNode2.id]).toEqual({ x: 270, y: 80 })
    })
  })
})
