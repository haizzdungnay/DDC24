import { describe, expect, it } from 'vitest'
import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import type { FbdDocument, FbdNetwork } from './model'
import {
  FBD_NODE_WIDTH,
  buildFbdNetworkGeometry,
  fbdNodeHeight,
  fbdWirePath,
} from './geometry'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

describe('buildFbdNetworkGeometry', () => {
  it('xếp tất định: INPUT trái, OUTPUT phải, còn lại ở giữa theo executionOrder', () => {
    const document = golden()
    const network = document.networks[0]
    const geometry = buildFbdNetworkGeometry(network)

    const byId = geometry.byNodeId
    const inputs = network.nodes.filter((node) => node.kind === 'INPUT')
    const outputs = network.nodes.filter((node) => node.kind === 'OUTPUT')
    const middle = network.nodes.filter((node) => node.kind !== 'INPUT' && node.kind !== 'OUTPUT')

    for (const node of inputs) expect(byId.get(node.id)!.x).toBeLessThan(byId.get(middle[0].id)!.x)
    for (const node of outputs) expect(byId.get(node.id)!.x).toBeGreaterThan(byId.get(middle[0].id)!.x)
    // hai INPUT cùng cột nhưng khác hàng — không chồng lên nhau
    expect(byId.get(inputs[0].id)!.x).toBe(byId.get(inputs[1].id)!.x)
    expect(byId.get(inputs[0].id)!.y).not.toBe(byId.get(inputs[1].id)!.y)
  })

  it('cùng tài liệu cho cùng hình học — tất định, so sánh được', () => {
    const first = buildFbdNetworkGeometry(golden().networks[0])
    const second = buildFbdNetworkGeometry(golden().networks[0])
    expect(JSON.stringify(first.nodes)).toBe(JSON.stringify(second.nodes))
  })

  it('toạ độ đã lưu THẮNG vị trí tự xếp', () => {
    const document = golden()
    const target = document.networks[0].nodes[0]
    const geometry = buildFbdNetworkGeometry(document.networks[0], {
      schemaVersion: 1,
      nodes: { [target.id]: { x: 777, y: 555 } },
    })
    const placed = geometry.byNodeId.get(target.id)!
    expect(placed.x).toBe(777)
    expect(placed.y).toBe(555)
    expect(placed.auto).toBe(false)
    // node không có toạ độ lưu vẫn được tự xếp
    expect(geometry.byNodeId.get(document.networks[0].nodes[1].id)!.auto).toBe(true)
  })

  it('port INPUT nằm cạnh trái, OUTPUT cạnh phải của đúng block', () => {
    const document = golden()
    const geometry = buildFbdNetworkGeometry(document.networks[0])
    for (const node of geometry.nodes) {
      for (const port of node.ports) {
        expect(port.cx).toBe(port.direction === 'INPUT' ? node.x : node.x + FBD_NODE_WIDTH)
        expect(port.cy).toBeGreaterThan(node.y)
        expect(port.cy).toBeLessThan(node.y + node.height)
      }
    }
  })

  it('mỗi wire hợp lệ thành một đường nối đúng hai đầu port', () => {
    const document = golden()
    const network = document.networks[0]
    const geometry = buildFbdNetworkGeometry(network)
    expect(geometry.wires).toHaveLength(network.wires.length)
    for (const wire of network.wires) {
      const drawn = geometry.wires.find((item) => item.id === wire.id)!
      expect(drawn.from).toEqual({ x: geometry.byPortId.get(wire.from.portId)!.cx, y: geometry.byPortId.get(wire.from.portId)!.cy })
      expect(drawn.to).toEqual({ x: geometry.byPortId.get(wire.to.portId)!.cx, y: geometry.byPortId.get(wire.to.portId)!.cy })
      expect(drawn.path.startsWith('M ')).toBe(true)
    }
  })

  it('wire trỏ tới port không tồn tại thì KHÔNG vẽ, thay vì bịa toạ độ', () => {
    const document = golden()
    const network = document.networks[0]
    network.wires[0].to.portId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const geometry = buildFbdNetworkGeometry(network)
    expect(geometry.wires).toHaveLength(network.wires.length - 1)
  })

  it('chiều cao block theo số hàng port nhiều nhất của hai phía', () => {
    const document = golden()
    const and = document.networks[0].nodes.find((node) => node.typeRef === 'AND')!
    const input = document.networks[0].nodes.find((node) => node.kind === 'INPUT')!
    // AND có 2 input + 1 output ⇒ cao hơn node chỉ có 1 port
    expect(fbdNodeHeight(and)).toBeGreaterThan(fbdNodeHeight(input))
  })

  it('khung canvas bao hết block, kể cả block bị kéo ra xa', () => {
    const document = golden()
    const target = document.networks[0].nodes[0]
    const geometry = buildFbdNetworkGeometry(document.networks[0], {
      schemaVersion: 1,
      nodes: { [target.id]: { x: 2000, y: 1500 } },
    })
    expect(geometry.width).toBeGreaterThan(2000 + FBD_NODE_WIDTH)
    expect(geometry.height).toBeGreaterThan(1500)
  })

  it('network rỗng cho khung hợp lệ, không NaN', () => {
    const geometry = buildFbdNetworkGeometry({ id: 'x', name: 'EMPTY', order: 0, nodes: [], wires: [] })
    expect(Number.isFinite(geometry.width)).toBe(true)
    expect(Number.isFinite(geometry.height)).toBe(true)
    expect(geometry.wires).toHaveLength(0)
  })

  it('đường dây đi ngang nên dây nối ngược vẫn nhìn ra là một dây', () => {
    // đích nằm BÊN TRÁI nguồn: nếu vẽ thẳng thì dây thành một vạch đè lên block
    const backward = fbdWirePath({ x: 400, y: 100 }, { x: 100, y: 100 })
    // khoảng cách 300 ⇒ điểm điều khiển đẩy ra 150 mỗi bên, vượt ra ngoài cả
    // hai đầu nên đường cong phình ra thay vì trùng đường thẳng nối hai điểm
    expect(backward).toBe('M 400 100 C 550 100, -50 100, 100 100')

    // hai điểm sát nhau vẫn có độ phình tối thiểu, không thành đoạn thẳng
    expect(fbdWirePath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M 0 0 C 40 0, -30 0, 10 0')
  })
})

/* `WP-05` AC: "256 block/512 wire fixture usable". Đồ thị lớn nhất mà hợp đồng
 * cho phép phải dựng được hình học trong thời gian dùng được — nếu hàm này là
 * O(n²) thì canvas sẽ đứng đúng lúc sơ đồ trở nên đáng vẽ nhất. */
describe('buildFbdNetworkGeometry — fixture lớn nhất hợp đồng cho phép', () => {
  function hugeNetwork(): FbdNetwork {
    const nodes: FbdNetwork['nodes'] = []
    const wires: FbdNetwork['wires'] = []
    for (let index = 0; index < 256; index += 1) {
      const nodeId = `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
      nodes.push({
        id: nodeId,
        kind: 'FUNCTION',
        typeRef: 'AND',
        executionOrder: index,
        parameters: {},
        ports: [
          { id: `4000${index.toString(16).padStart(4, '0')}-0000-4000-8000-000000000001`, name: 'IN1', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
          { id: `4000${index.toString(16).padStart(4, '0')}-0000-4000-8000-000000000002`, name: 'IN2', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
          { id: `4000${index.toString(16).padStart(4, '0')}-0000-4000-8000-000000000003`, name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
        ],
      })
    }
    for (let index = 0; index + 1 < 256 && wires.length < 512; index += 1) {
      wires.push({
        id: `50000000-0000-4000-8000-${wires.length.toString(16).padStart(12, '0')}`,
        from: { nodeId: nodes[index].id, portId: nodes[index].ports[2].id },
        to: { nodeId: nodes[index + 1].id, portId: nodes[index + 1].ports[0].id },
      })
    }
    return { id: '20000000-0000-4000-8000-000000000001', name: 'HUGE', order: 0, nodes, wires }
  }

  it('256 block / 255 wire dựng xong dưới 250 ms và không chồng vị trí', () => {
    const network = hugeNetwork()
    const started = performance.now()
    const geometry = buildFbdNetworkGeometry(network)
    const elapsed = performance.now() - started

    expect(geometry.nodes).toHaveLength(256)
    expect(geometry.wires).toHaveLength(network.wires.length)
    expect(elapsed).toBeLessThan(250)

    const seen = new Set(geometry.nodes.map((node) => `${node.x}:${node.y}`))
    expect(seen.size).toBe(geometry.nodes.length)
  })
})
