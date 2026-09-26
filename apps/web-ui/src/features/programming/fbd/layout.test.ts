import { describe, expect, it } from 'vitest'
import type { FbdNetwork, FbdNode, FbdPoint } from './model'
import {
  alignNodes,
  computeAutoLayout,
  distributeNodes,
  findFreeNodePosition,
  type FbdNodeRect,
} from './layout'
import { FBD_CANVAS_MARGIN, FBD_COLUMN_GAP, FBD_ROW_GAP, fbdNodeHeight } from './geometry'

function makeTestNode(
  id: string,
  kind: FbdNode['kind'],
  order: number,
  inputCount = 1,
  outputCount = 1,
): FbdNode {
  return {
    id,
    kind,
    typeRef: kind,
    executionOrder: order,
    parameters: {},
    ports: [
      ...Array.from({ length: inputCount }, (_, i) => ({
        id: `${id}-in-${i}`,
        name: `IN${i}`,
        direction: 'INPUT' as const,
        dataType: 'BOOL' as const,
        unit: null,
        order: i,
      })),
      ...Array.from({ length: outputCount }, (_, i) => ({
        id: `${id}-out-${i}`,
        name: `OUT${i}`,
        direction: 'OUTPUT' as const,
        dataType: 'BOOL' as const,
        unit: null,
        order: inputCount + i,
      })),
    ],
  }
}

describe('computeAutoLayout', () => {
  it('xếp 3 tầng cột: Nguồn (col 0), Trung gian (col 1), Đích (col 2)', () => {
    const inputNode = makeTestNode('node-in', 'INPUT', 0, 0, 1)
    const constNode = makeTestNode('node-const', 'CONSTANT', 1, 0, 1)
    const sigReadNode = makeTestNode('node-read', 'SIGNAL_READ', 2, 0, 1)
    const fnNode = makeTestNode('node-fn', 'FUNCTION', 3, 2, 1)
    const fbNode = makeTestNode('node-fb', 'FUNCTION_BLOCK', 4, 2, 2)
    const outNode = makeTestNode('node-out', 'OUTPUT', 5, 1, 0)
    const sigPubNode = makeTestNode('node-pub', 'SIGNAL_PUBLISH', 6, 1, 0)

    const network: FbdNetwork = {
      id: 'net-1',
      name: 'NET_1',
      order: 0,
      nodes: [outNode, fnNode, sigPubNode, inputNode, constNode, fbNode, sigReadNode],
      wires: [],
    }

    const { positions, warnings } = computeAutoLayout(network)
    expect(warnings).toEqual([])

    const col0X = FBD_CANVAS_MARGIN
    const col1X = FBD_CANVAS_MARGIN + FBD_COLUMN_GAP
    const col2X = FBD_CANVAS_MARGIN + 2 * FBD_COLUMN_GAP

    expect(positions['node-in'].x).toBe(col0X)
    expect(positions['node-const'].x).toBe(col0X)
    expect(positions['node-read'].x).toBe(col0X)

    expect(positions['node-fn'].x).toBe(col1X)
    expect(positions['node-fb'].x).toBe(col1X)

    expect(positions['node-out'].x).toBe(col2X)
    expect(positions['node-pub'].x).toBe(col2X)

    // Y tăng dần theo fbdNodeHeight + rowGap
    const hIn = fbdNodeHeight(inputNode)
    const hConst = fbdNodeHeight(constNode)
    expect(positions['node-in'].y).toBe(FBD_CANVAS_MARGIN)
    expect(positions['node-const'].y).toBe(FBD_CANVAS_MARGIN + hIn + FBD_ROW_GAP)
    expect(positions['node-read'].y).toBe(FBD_CANVAS_MARGIN + hIn + FBD_ROW_GAP + hConst + FBD_ROW_GAP)
  })

  it('xử lý scope SELECTED: chỉ xếp các node được chọn, giữ nguyên node khác', () => {
    const nodeA = makeTestNode('node-a', 'INPUT', 0)
    const nodeB = makeTestNode('node-b', 'FUNCTION', 1)
    const nodeC = makeTestNode('node-c', 'OUTPUT', 2)

    const network: FbdNetwork = {
      id: 'net-2',
      name: 'NET_2',
      order: 0,
      nodes: [nodeA, nodeB, nodeC],
      wires: [],
    }

    const currentPositions: Record<string, FbdPoint> = {
      'node-a': { x: 500, y: 600 },
      'node-b': { x: 100, y: 200 },
      'node-c': { x: 800, y: 900 },
    }

    const result = computeAutoLayout(network, currentPositions, {
      scope: 'SELECTED',
      selectedNodeIds: ['node-b'],
    })

    expect(result.positions['node-a']).toEqual({ x: 500, y: 600 })
    expect(result.positions['node-c']).toEqual({ x: 800, y: 900 })
    expect(result.positions['node-b']).not.toEqual({ x: 100, y: 200 })
  })

  it('custom gap và margin', () => {
    const node1 = makeTestNode('n1', 'INPUT', 0)
    const node2 = makeTestNode('n2', 'INPUT', 1)
    const network: FbdNetwork = {
      id: 'net-3',
      name: 'NET_3',
      order: 0,
      nodes: [node1, node2],
      wires: [],
    }

    const result = computeAutoLayout(network, {}, {
      columnGap: 300,
      rowGap: 50,
      margin: 100,
    })

    expect(result.positions['n1'].x).toBe(100)
    expect(result.positions['n1'].y).toBe(100)
    expect(result.positions['n2'].y).toBe(100 + fbdNodeHeight(node1) + 50)
  })

  it('bắt bounds vượt [-100000..100000], NaN, Infinity và sinh warning', () => {
    const node1 = makeTestNode('n1', 'INPUT', 0)
    const network: FbdNetwork = {
      id: 'net-4',
      name: 'NET_4',
      order: 0,
      nodes: [node1],
      wires: [],
    }

    const currentPositions: Record<string, FbdPoint> = {
      n1: { x: 10, y: 20 },
    }

    const result = computeAutoLayout(network, currentPositions, {
      margin: 200_000,
    })

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.positions['n1']).toEqual({ x: 10, y: 20 })
  })

  it('xếp đa tầng DAG theo dây nối: In -> F1 -> F2 -> Out qua các cột riêng biệt', () => {
    const nodeIn = makeTestNode('in-1', 'INPUT', 0, 0, 1)
    const nodeF1 = makeTestNode('fn-1', 'FUNCTION', 1, 1, 1)
    const nodeF2 = makeTestNode('fn-2', 'FUNCTION', 2, 1, 1)
    const nodeOut = makeTestNode('out-1', 'OUTPUT', 3, 1, 0)

    const network: FbdNetwork = {
      id: 'net-dag',
      name: 'NET_DAG',
      order: 0,
      nodes: [nodeOut, nodeF2, nodeF1, nodeIn],
      wires: [
        { id: 'w1', from: { nodeId: 'in-1', portId: 'in-1-out-0' }, to: { nodeId: 'fn-1', portId: 'fn-1-in-0' } },
        { id: 'w2', from: { nodeId: 'fn-1', portId: 'fn-1-out-0' }, to: { nodeId: 'fn-2', portId: 'fn-2-in-0' } },
        { id: 'w3', from: { nodeId: 'fn-2', portId: 'fn-2-out-0' }, to: { nodeId: 'out-1', portId: 'out-1-in-0' } },
      ],
    }

    const { positions } = computeAutoLayout(network)
    expect(positions['in-1'].x).toBeLessThan(positions['fn-1'].x)
    expect(positions['fn-1'].x).toBeLessThan(positions['fn-2'].x)
    expect(positions['fn-2'].x).toBeLessThan(positions['out-1'].x)
  })

  it('đẩy cột kế tiếp khi có khối rộng tùy chỉnh tránh chồng lấn', () => {
    const nodeA = makeTestNode('n-wide', 'INPUT', 0)
    const nodeB = makeTestNode('n-next', 'FUNCTION', 1)
    const network: FbdNetwork = {
      id: 'net-wide',
      name: 'NET_WIDE',
      order: 0,
      nodes: [nodeA, nodeB],
      wires: [
        { id: 'w1', from: { nodeId: 'n-wide', portId: 'n-wide-out-0' }, to: { nodeId: 'n-next', portId: 'n-next-in-0' } },
      ],
    }

    const { positions } = computeAutoLayout(network, {}, {
      margin: 40,
      nodeSizes: { 'n-wide': { width: 300 } },
    })

    // nodeA tại x=40, rộng 300 -> nodeB phải cách ít nhất 40 + 300 = 340
    expect(positions['n-wide'].x).toBe(40)
    expect(positions['n-next'].x).toBeGreaterThanOrEqual(340)
  })
})

describe('alignNodes', () => {
  const node1 = makeTestNode('n1', 'FUNCTION', 0, 1, 1) // height = 38 + 1*22 + 10 = 70
  const node2 = makeTestNode('n2', 'FUNCTION', 1, 3, 3) // height = 38 + 3*22 + 10 = 114
  const nodes = [node1, node2]

  const initialPositions: Record<string, FbdPoint> = {
    n1: { x: 100, y: 50 },
    n2: { x: 300, y: 200 },
  }

  it('căn LEFT theo min(x)', () => {
    const aligned = alignNodes(nodes, initialPositions, 'LEFT')
    expect(aligned['n1'].x).toBe(100)
    expect(aligned['n2'].x).toBe(100)
    expect(aligned['n1'].y).toBe(50)
    expect(aligned['n2'].y).toBe(200)
  })

  it('căn RIGHT theo max(x)', () => {
    const aligned = alignNodes(nodes, initialPositions, 'RIGHT')
    expect(aligned['n1'].x).toBe(300)
    expect(aligned['n2'].x).toBe(300)
  })

  it('căn TOP theo min(y)', () => {
    const aligned = alignNodes(nodes, initialPositions, 'TOP')
    expect(aligned['n1'].y).toBe(50)
    expect(aligned['n2'].y).toBe(50)
    expect(aligned['n1'].x).toBe(100)
    expect(aligned['n2'].x).toBe(300)
  })

  it('căn BOTTOM theo max(y + height) - nodeHeight', () => {
    // node 1: y = 50, h = 70 -> bottom = 120
    // node 2: y = 200, h = 114 -> bottom = 314
    // max bottom = 314
    // node 1 new y: 314 - 70 = 244
    // node 2 new y: 314 - 114 = 200
    const aligned = alignNodes(nodes, initialPositions, 'BOTTOM')
    expect(aligned['n1'].y).toBe(314 - fbdNodeHeight(node1))
    expect(aligned['n2'].y).toBe(314 - fbdNodeHeight(node2))
  })

  it('không làm thay đổi tham số truyền vào (immutability)', () => {
    const posCopy = { ...initialPositions }
    alignNodes(nodes, initialPositions, 'LEFT')
    expect(initialPositions).toEqual(posCopy)
  })
})

describe('distributeNodes', () => {
  const node1 = makeTestNode('n1', 'FUNCTION', 0, 1, 1)
  const node2 = makeTestNode('n2', 'FUNCTION', 1, 1, 1)
  const node3 = makeTestNode('n3', 'FUNCTION', 2, 1, 1)
  const nodes = [node1, node2, node3]

  it('phân bổ đều HORIZONTAL', () => {
    const positions: Record<string, FbdPoint> = {
      n1: { x: 0, y: 100 },
      n2: { x: 50, y: 120 },
      n3: { x: 200, y: 150 },
    }

    const distributed = distributeNodes(nodes, positions, 'HORIZONTAL')
    expect(distributed['n1'].x).toBe(0)
    expect(distributed['n2'].x).toBe(100)
    expect(distributed['n3'].x).toBe(200)
    expect(distributed['n1'].y).toBe(100)
    expect(distributed['n2'].y).toBe(120)
  })

  it('phân bổ đều VERTICAL', () => {
    const positions: Record<string, FbdPoint> = {
      n1: { x: 100, y: 0 },
      n2: { x: 120, y: 20 },
      n3: { x: 150, y: 300 },
    }

    const distributed = distributeNodes(nodes, positions, 'VERTICAL')
    expect(distributed['n1'].y).toBe(0)
    expect(distributed['n2'].y).toBe(150)
    expect(distributed['n3'].y).toBe(300)
  })

  it('dưới 3 node: no-op trả về nguyên vẹn positions', () => {
    const twoNodes = [node1, node2]
    const positions: Record<string, FbdPoint> = {
      n1: { x: 10, y: 10 },
      n2: { x: 50, y: 50 },
    }
    const distributed = distributeNodes(twoNodes, positions, 'HORIZONTAL')
    expect(distributed).toEqual(positions)
  })
})

/* `#765` — khối mới đặt ở tâm khung nhìn (`99f4ae8f`) nhưng không được chồng
 * khít lên khối đã có: bốn khối liền nhau từng rơi đúng một chỗ, cổng khối dưới
 * bị khối trên che và e2e `TC-FBD-USABLE-001` không kéo được dây nào. */
describe('findFreeNodePosition', () => {
  const size = { width: 168, height: 92 }
  const overlaps = (a: FbdNodeRect, b: FbdNodeRect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  it('mặt vẽ trống thì giữ đúng vị trí ưu tiên', () => {
    expect(findFreeNodePosition({ x: 320, y: 256 }, size, [])).toEqual({ x: 320, y: 256 })
  })

  it('vị trí ưu tiên đã có khối thì dời sang PHẢI trước, giữ trên lưới 16 px', () => {
    const occupied = [{ x: 320, y: 256, ...size }]
    const point = findFreeNodePosition({ x: 320, y: 256 }, size, occupied)
    expect(point.y).toBe(256)
    expect(point.x).toBeGreaterThan(320 + size.width)
    expect(point.x % 16).toBe(0)
    expect(overlaps({ ...point, ...size }, occupied[0])).toBe(false)
  })

  it('25 lần thêm liền nhau ở cùng một tâm cho 25 khối không chồng nhau', () => {
    const placed: FbdNodeRect[] = []
    for (let index = 0; index < 25; index += 1) {
      const point = findFreeNodePosition({ x: 320, y: 256 }, size, placed)
      placed.push({ ...point, ...size })
    }
    for (let a = 0; a < placed.length; a += 1) {
      for (let b = a + 1; b < placed.length; b += 1) {
        expect(overlaps(placed[a], placed[b]), `khối ${a} chồng khối ${b}`).toBe(false)
      }
    }
    expect(placed.every((rect) => rect.x >= FBD_CANVAS_MARGIN && rect.y >= FBD_CANVAS_MARGIN)).toBe(true)
  })

  it('không đặt ra ngoài mép trong của mặt vẽ khi vòng tìm đi sang trái/lên trên', () => {
    const occupied = [
      { x: 24, y: 24, ...size },
      { x: 24 + 192, y: 24, ...size },
      { x: 24, y: 24 + 112, ...size },
      { x: 24 + 192, y: 24 + 112, ...size },
    ]
    const point = findFreeNodePosition({ x: 24, y: 24 }, size, occupied, { snap: 8 })
    expect(point.x).toBeGreaterThanOrEqual(FBD_CANVAS_MARGIN)
    expect(point.y).toBeGreaterThanOrEqual(FBD_CANVAS_MARGIN)
    expect(occupied.some((rect) => overlaps({ ...point, ...size }, rect))).toBe(false)
  })

  it('hết vòng tìm mà vẫn kín thì trả vị trí ưu tiên thay vì từ chối', () => {
    const occupied = [{ x: -10_000, y: -10_000, width: 20_000, height: 20_000 }]
    expect(findFreeNodePosition({ x: 320, y: 256 }, size, occupied, { maxRings: 2 })).toEqual({ x: 320, y: 256 })
  })
})
