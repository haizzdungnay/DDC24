import { describe, expect, it } from 'vitest'
import {
  computeReferenceGeometry,
  computeStubWidth,
  FBD_REF_PORT_GAP,
  FBD_REF_STUB_HEIGHT,
  FBD_REF_STUB_WIDTH,
} from './referenceGeometry'
import type { FbdNetwork } from './model'
import type { FbdNetworkGeometry, FbdNodeGeometry, FbdPortGeometry } from './geometry'
import type { FbdWireReferenceMap } from './wireReferences'

describe('Module G: referenceGeometry & SVG Layout', () => {
  it('TEST-G-001: Tính toán Tọa độ Source Stub Anchor (Port OUTPUT tại 200, 100)', () => {
    const network: FbdNetwork = {
      id: 'net1',
      name: 'NW',
      order: 0,
      nodes: [],
      wires: [
        {
          id: 'wire1',
          from: { nodeId: 'node1', portId: 'portOut' },
          to: { nodeId: 'node2', portId: 'portIn' },
        },
      ],
    }

    const byPortId = new Map<string, FbdPortGeometry>([
      ['portOut', { id: 'portOut', nodeId: 'node1', direction: 'OUTPUT', cx: 200, cy: 100 }],
      ['portIn', { id: 'portIn', nodeId: 'node2', direction: 'INPUT', cx: 400, cy: 100 }],
    ])

    const byNodeId = new Map<string, FbdNodeGeometry>([
      ['node1', { id: 'node1', x: 50, y: 50, width: 100, height: 100, ports: [], auto: false }],
      ['node2', { id: 'node2', x: 500, y: 50, width: 150, height: 100, ports: [], auto: false }],
    ])

    const geom: FbdNetworkGeometry = {
      nodes: [],
      byNodeId,
      byPortId,
      wires: [],
      width: 1000,
      height: 1000,
      minX: 0,
      minY: 0,
    }

    const wireReferences: FbdWireReferenceMap = {
      wire1: { wireId: 'wire1', signalName: 'SIG_TEMP', createdAt: 1 },
    }

    const refGeom = computeReferenceGeometry(network, geom, wireReferences)
    expect(refGeom.sources).toHaveLength(1)
    const source = refGeom.sources[0]
    expect(source.x).toBe(200 + FBD_REF_PORT_GAP) // 208
    expect(source.y).toBe(100 - FBD_REF_STUB_HEIGHT / 2) // 90
    expect(source.width).toBe(FBD_REF_STUB_WIDTH) // 96
    expect(source.neckPath).toBe('M 200 100 L 208 100')
  })

  it('TEST-G-002: Tính toán Tọa độ Sink Stub Chevron (Port INPUT tại 400, 100)', () => {
    const network: FbdNetwork = {
      id: 'net1',
      name: 'NW',
      order: 0,
      nodes: [],
      wires: [
        {
          id: 'wire1',
          from: { nodeId: 'node1', portId: 'portOut' },
          to: { nodeId: 'node2', portId: 'portIn' },
        },
      ],
    }

    const byPortId = new Map<string, FbdPortGeometry>([
      ['portOut', { id: 'portOut', nodeId: 'node1', direction: 'OUTPUT', cx: 200, cy: 100 }],
      ['portIn', { id: 'portIn', nodeId: 'node2', direction: 'INPUT', cx: 400, cy: 100 }],
    ])

    const byNodeId = new Map<string, FbdNodeGeometry>([
      ['node1', { id: 'node1', x: 50, y: 50, width: 100, height: 100, ports: [], auto: false }],
      ['node2', { id: 'node2', x: 400, y: 50, width: 150, height: 100, ports: [], auto: false }],
    ])

    const geom: FbdNetworkGeometry = {
      nodes: [],
      byNodeId,
      byPortId,
      wires: [],
      width: 1000,
      height: 1000,
      minX: 0,
      minY: 0,
    }

    const wireReferences: FbdWireReferenceMap = {
      wire1: { wireId: 'wire1', signalName: 'SIG_TEMP', createdAt: 1 },
    }

    const refGeom = computeReferenceGeometry(network, geom, wireReferences)
    expect(refGeom.sinks).toHaveLength(1)
    const sink = refGeom.sinks[0]
    expect(sink.x).toBe(400 - FBD_REF_PORT_GAP - FBD_REF_STUB_WIDTH) // 400 - 8 - 96 = 296
    expect(sink.neckPath).toBe('M 392 100 L 400 100')
    // Mũi tên vát nhọn chĩa về (392, 100)
    expect(sink.path).toContain('L 392 100')
  })

  it('TEST-G-003: Xử lý chống va chạm khi khoảng cách hẹp (Hai khối cách nhau 80px -> Stub co về 56px)', () => {
    const node1: FbdNodeGeometry = { id: 'n1', x: 100, y: 100, width: 100, height: 80, ports: [], auto: false }
    // Khoảng cách giữa 2 khối = node2.x - (node1.x + node1.width) = 280 - 200 = 80px
    const node2: FbdNodeGeometry = { id: 'n2', x: 280, y: 100, width: 100, height: 80, ports: [], auto: false }

    const width = computeStubWidth(node1, node2)
    // DeltaX = 80 < 120 -> width = 80 - 24 = 56px
    expect(width).toBe(56)
  })

  it('TEST-G-004: Vị trí Value Chip trực tuyến (Stub tại 208, 90 với width 96 -> Chip tại 256, 82)', () => {
    const network: FbdNetwork = {
      id: 'net1',
      name: 'NW',
      order: 0,
      nodes: [],
      wires: [{ id: 'w1', from: { nodeId: 'n1', portId: 'pOut' }, to: { nodeId: 'n2', portId: 'pIn' } }],
    }
    const byPortId = new Map<string, FbdPortGeometry>([
      ['pOut', { id: 'pOut', nodeId: 'n1', direction: 'OUTPUT', cx: 200, cy: 100 }],
      ['pIn', { id: 'pIn', nodeId: 'n2', direction: 'INPUT', cx: 500, cy: 100 }],
    ])
    const byNodeId = new Map<string, FbdNodeGeometry>([
      ['n1', { id: 'n1', x: 50, y: 50, width: 150, height: 100, ports: [], auto: false }],
      ['n2', { id: 'n2', x: 500, y: 50, width: 150, height: 100, ports: [], auto: false }],
    ])
    const geom: FbdNetworkGeometry = {
      nodes: [],
      byNodeId,
      byPortId,
      wires: [],
      width: 1000,
      height: 1000,
      minX: 0,
      minY: 0,
    }
    const wireReferences: FbdWireReferenceMap = {
      w1: { wireId: 'w1', signalName: 'SIG_1', createdAt: 1 },
    }
    const refGeom = computeReferenceGeometry(network, geom, wireReferences)
    const source = refGeom.sources[0]
    expect(source.valueChipCenter).toEqual({ x: 256, y: 82 })
  })

  it("TEST-G-005: Xử lý va chạm khi 2 khối cách nhau 150px (cả 2 stub co về 59px tránh đè nhau)", () => {
    const node1: FbdNodeGeometry = { id: 'n1', x: 100, y: 100, width: 100, height: 80, ports: [], auto: false }
    // Khoảng cách deltaX = 350 - (100 + 100) = 150px
    const node2: FbdNodeGeometry = { id: 'n2', x: 350, y: 100, width: 100, height: 80, ports: [], auto: false }

    const width = computeStubWidth(node1, node2)
    // (150 - 32) / 2 = 59px
    expect(width).toBe(59)
  })

})
