import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import type { FbdDocument, FbdNetwork, FbdNode } from './model'
import type { FbdEditorAction, FbdSelection } from './commands'
import { FbdCanvas } from './FbdCanvas'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
  ProgrammingVariable,
} from '../model/types'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function mockPick(viStr: string, _enStr: string) {
  return viStr
}

interface RenderCanvasOptions {
  network?: FbdNetwork
  document?: FbdDocument
  layout?: FbdDocument['layout']
  selection?: FbdSelection | null
  issueNodeIds?: ReadonlySet<string>
  connectionFromPortId?: string | null
  canEdit?: boolean
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
}

function renderPresentationCanvas(options: RenderCanvasOptions = {}) {
  const doc = options.document ?? golden()
  const network = options.network ?? doc.networks[0]
  const layout = options.layout ?? doc.layout
  const selection = options.selection !== undefined ? options.selection : null
  const connectionFromPortId = options.connectionFromPortId ?? null
  const canEdit = options.canEdit !== undefined ? options.canEdit : true
  const dispatch = vi.fn((_action: FbdEditorAction) => {})
  const registerPort = vi.fn()

  const utils = render(
    <FbdCanvas
      network={network}
      document={doc}
      layout={layout}
      selection={selection}
      issueNodeIds={options.issueNodeIds}
      connectionFromPortId={connectionFromPortId}
      canEdit={canEdit}
      dispatch={dispatch}
      pick={mockPick}
      registerPort={registerPort}
      bindings={options.bindings}
      variables={options.variables}
      pointCatalogItems={options.pointCatalogItems}
    />
  )

  const surface = screen.getByRole('group', { name: new RegExp(`Sơ đồ ${network.name}`) })
  surface.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  })

  return { ...utils, dispatch, registerPort, surface, network }
}

beforeEach(() => {
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})

afterEach(cleanup)

describe('FbdCanvas — Luồng C: Presentation tests (C-T1..C-T7)', () => {
  it('C-T1: Node có port REAL kèm unit — canvas hiện `name : REAL (unit)`', () => {
    const doc = golden()
    const net = doc.networks[0]
    // Thêm port có dataType REAL và unit degC vào node đầu tiên
    const node = net.nodes[0]
    node.ports[0] = {
      id: 'port-real-unit',
      name: 'TEMP',
      direction: 'OUTPUT',
      dataType: 'REAL',
      unit: 'degC',
      order: 0,
    }

    const { surface } = renderPresentationCanvas({ document: doc, network: net })
    const portText = surface.querySelector('text[data-fbd-port-text="true"]')
    expect(portText).not.toBeNull()
    expect(portText?.textContent).toBe('TEMP : REAL (degC)')
  })

  it('khi chân cổng đã mapping: canvas hiển thị tên điểm đã map kèm giá trị realtime', () => {
    const doc = golden()
    const net = doc.networks[0]
    // Node 0 là INPUT có parameters.variable: "OCCUPIED"
    const targetPortId = "OCCUPIED"

    const bindings: ProgrammingBinding[] = [
      {
        bindingId: 'b-in1',
        variableId: targetPortId,
        point: { category: 'LOCAL', pointId: 'AO-01' },
        direction: 'READ',
        dataType: 'REAL',
        unit: 'V',
        writable: true,
        qualityPolicy: 'REQUIRE_GOOD',
      },
    ]

    const pointCatalogItems: ProgrammingPointCatalogEntry[] = [
      {
        category: 'LOCAL',
        pointId: 'AO-01',
        displayId: 'AO-01',
        name: 'Fan Speed',
        dataType: 'REAL',
        unit: 'V',
        direction: 'READ_WRITE',
        writable: true,
        quality: 'GOOD',
        value: 5,
      },
    ]

    const { surface } = renderPresentationCanvas({
      document: doc,
      network: net,
      bindings,
      pointCatalogItems,
    })

    const mappedText = surface.querySelector('text[data-fbd-port-mapped="true"]')
    expect(mappedText).not.toBeNull()
    expect(mappedText?.textContent).toBe('AO-01: 5V')
  })

  it('C-T2: Node INPUT có parameters.variable — canvas hiện tên biến', () => {
    const doc = golden()
    const net = doc.networks[0]
    // Node 0 là INPUT có parameters.variable: "OCCUPIED"
    const { surface } = renderPresentationCanvas({ document: doc, network: net })
    const paramText = surface.querySelector('text[data-fbd-node-param="true"]')
    expect(paramText).not.toBeNull()
    expect(paramText?.textContent).toBe('OCCUPIED')
  })

  it('C-T3: Node CONSTANT có parameters.value — canvas hiện giá trị', () => {
    const doc = golden()
    const net = doc.networks[0]
    const constNode: FbdNode = {
      id: 'const-node-1',
      kind: 'CONSTANT',
      typeRef: 'REAL',
      executionOrder: 4,
      parameters: { value: 25.5 },
      ports: [
        { id: 'const-port-1', name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: null, order: 0 },
      ],
    }
    net.nodes.push(constNode)

    const { surface } = renderPresentationCanvas({ document: doc, network: net })
    const nodeGroup = surface.querySelector(`g[data-fbd-node-id="${constNode.id}"]`)
    expect(nodeGroup).not.toBeNull()
    const paramText = nodeGroup?.querySelector('text[data-fbd-node-param="true"]')
    expect(paramText?.textContent).toBe('25.5')
  })

  it('C-T4: Node thiếu parameter — để trống, không hiện chuỗi mẫu', () => {
    const doc = golden()
    const net = doc.networks[0]
    const emptyNode: FbdNode = {
      id: 'empty-node-1',
      kind: 'INPUT',
      typeRef: 'BOOL',
      executionOrder: 5,
      parameters: {}, // Thiếu variable
      ports: [
        { id: 'empty-port-1', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 0 },
      ],
    }
    net.nodes.push(emptyNode)

    const { surface } = renderPresentationCanvas({ document: doc, network: net })
    const nodeGroup = surface.querySelector(`g[data-fbd-node-id="${emptyNode.id}"]`)
    expect(nodeGroup).not.toBeNull()
    const paramText = nodeGroup?.querySelector('text[data-fbd-node-param="true"]')
    expect(paramText).toBeNull()
  })

  it('C-T5: Node nằm trong issueNodeIds — có marker cảnh báo + aria-label nêu có lỗi', () => {
    const doc = golden()
    const net = doc.networks[0]
    const targetNode = net.nodes[0]
    const issueNodeIds = new Set<string>([targetNode.id])

    const { surface } = renderPresentationCanvas({
      document: doc,
      network: net,
      issueNodeIds,
    })

    const nodeBtn = surface.querySelector(`g[data-fbd-node-id="${targetNode.id}"] [role="button"]`)
    expect(nodeBtn).not.toBeNull()
    expect(nodeBtn?.getAttribute('aria-label')).toMatch(/(Có lỗi chẩn đoán|Has diagnostic issue)/)

    const issueMarker = surface.querySelector(`g[data-fbd-node-id="${targetNode.id}"] [data-fbd-node-issue="true"]`)
    expect(issueMarker).not.toBeNull()
  })

  it('C-T6: Chế độ EDIT — 0 giá trị runtime trên node (R-02)', () => {
    const { surface } = renderPresentationCanvas({ canEdit: true })
    const runtimeOverlays = surface.querySelectorAll('[data-fbd-runtime-value]')
    expect(runtimeOverlays).toHaveLength(0)

    // Khẳng định text không bị fallback thành số 0 runtime
    const nodeTexts = Array.from(surface.querySelectorAll('text')).map((t) => t.textContent)
    expect(nodeTexts).not.toContain('0.00')
  })

  it('C-T7: Kéo node sau khi thêm text — executionOrder không đổi (R-07)', () => {
    const { surface, dispatch, network } = renderPresentationCanvas({ canEdit: true })
    const node = network.nodes[0]
    const originalOrder = node.executionOrder

    const nodeBtn = surface.querySelector(`g[data-fbd-node-id="${node.id}"] [role="button"]`) as SVGGElement
    expect(nodeBtn).not.toBeNull()

    // Bắt đầu kéo
    fireEvent.pointerDown(nodeBtn, { pointerId: 1, button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(nodeBtn, { pointerId: 1, clientX: 70, clientY: 50 })
    fireEvent.pointerUp(nodeBtn, { pointerId: 1, clientX: 70, clientY: 50 })

    expect(dispatch).toHaveBeenCalled()
    // executionOrder không đổi
    expect(node.executionOrder).toBe(originalOrder)
  })
})

/* `#677` — mặt vẽ không được nuôi lại phép đo của chính nó. */
describe('FbdCanvas — phạm vi quan sát kích thước', () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    targets: Element[] = []
    constructor(public readonly callback: ResizeObserverCallback) {
      FakeResizeObserver.instances.push(this)
    }
    observe(target: Element) { this.targets.push(target) }
    unobserve(target: Element) { this.targets = this.targets.filter((t) => t !== target) }
    disconnect() { this.targets = [] }
    static allTargets(): Element[] {
      return FakeResizeObserver.instances.flatMap((i) => i.targets)
    }
  }

  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('quan sát ĐÚNG khung cuộn, không quan sát body hay mặt vẽ', () => {
    const { surface } = renderPresentationCanvas()
    const targets = FakeResizeObserver.allTargets()

    expect(targets).toHaveLength(1)
    const observed = targets[0] as HTMLElement
    expect(observed.className).toContain('overflow-auto')

    /* Mặt vẽ là NỘI DUNG của khay: chiều cao của nó tính từ `containerHeight`,
     * nên quan sát nó khép kín vòng và bố cục không bao giờ đứng yên. */
    expect(targets).not.toContain(surface)
    expect(targets).not.toContain(document.body)
    expect(observed.contains(surface)).toBe(true)
  })
})
